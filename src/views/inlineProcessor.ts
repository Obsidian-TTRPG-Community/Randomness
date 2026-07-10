/**
 * Inline `rdm:` post-processor.
 *
 * Obsidian renders inline code spans (`backtick-wrapped`) as <code>
 * elements in the DOM. We walk the rendered DOM looking for <code>
 * nodes whose text starts with `rdm:`, evaluate the expression
 * against the note's scope, and replace the <code> with a custom
 * span that:
 *
 *   - Shows the result (preview or locked, same display).
 *   - Has a "Lock" button if currently unfilled.
 *   - Has a "Reroll" button if currently locked (and the reroll
 *     button is also available pre-lock to refresh the preview).
 *   - Click on the result itself does nothing (don't accidentally
 *     fire on bumps).
 *
 * Preview state lives in the plugin's PreviewRegistry. Re-renders of
 * the same expression (scrolling, edits elsewhere) consult the
 * registry and re-display the same result rather than re-rolling.
 *
 * The async pipeline (prefetch → resolve → engine) is reused from the
 * codeblock processor's logic — just shaped for a single expression
 * rather than a whole codeblock source.
 */

import {
    MarkdownPostProcessorContext,
    TFile,
} from "obsidian";
import { Evaluator } from "../engine/evaluator";
import { buildInlineBundle } from "../resolver/scope";
import { prefetchUseGraph } from "../resolver/asyncPrefetcher";
import { discoverReferencedTables } from "../resolver/autoDiscover";
import {
    makeLinkAwareBasenameResolver,
    makeTagFilesLookup,
    vaultFileSource,
} from "./vaultFileSource";
import {
    parseDirectTagCall,
    parseDirectWikilinkCall,
    TAG_FILE_CAP,
} from "../resolver/mdContent";
import { translateDiceExpression } from "../compat/diceCompat";
import { diceCompatEnabled } from "./settings";
import { FileSource } from "../resolver/fileResolver";
import {
    parseInlineCall,
    applyLockToSource,
    applyUnlockToSource,
    PreviewKey,
    INLINE_PREFIX,
    matchInlinePrefix,
    callKey,
    evalSourceOf,
    InlineCall,
    findAllInlineCallPositions,
    InlineCallPosition,
} from "./lockingService";
import {
    markdownLite,
    setSanitisedHtml,
    setSanitisedHtmlWithLinks,
} from "./sanitiser";
import type RandomnessPlugin from "./main";

/**
 * Build the post-processor function for inline rdm: calls. Closes
 * over the plugin so it can read settings, access vault, and share
 * the preview registry across calls.
 */
export function buildInlineProcessor(plugin: RandomnessPlugin) {
    return async function process(
        el: HTMLElement,
        ctx: MarkdownPostProcessorContext
    ): Promise<void> {
        // Walk all <code> elements. Each one is a potential inline
        // call. Snapshot the list because we mutate as we go.
        const codeNodes = Array.from(el.querySelectorAll("code"));
        // Which prefixes are live: `rdm:` always; the Dice Roller
        // compat prefixes only when the setting is on (merge Phase 3)
        // so the standalone Dice Roller plugin can keep owning
        // `dice:` spans until the user opts in.
        const compatOn = diceCompatEnabled(plugin);
        const isCall = (t: string): boolean => {
            const p = matchInlinePrefix(t);
            return p !== null && (compatOn || p === INLINE_PREFIX);
        };
        // Fast path: no inline calls in this block.
        if (!codeNodes.some((c) => isCall(c.textContent ?? ""))) {
            return;
        }

        // Read the note's source so we can compute SOURCE-LEVEL
        // occurrence indices for every call. This is the key to
        // distinguishing identical inline calls: by occurrence in
        // source order (matching what applyLockToSource expects),
        // not by render-time DOM position which collapses to 0
        // when prior calls have already been replaced.
        const sourcePositions = await readSourcePositions(
            plugin,
            ctx,
            el
        );

        // Walk DOM `code` elements in activeDocument order and pair each
        // with its source position. The N-th `rdm:` code element in
        // the block corresponds to the N-th call in `sourcePositions`
        // restricted to this block's line range — provided the
        // expressions match.
        let sourceIdx = 0;
        for (const code of codeNodes) {
            const text = code.textContent ?? "";
            if (!isCall(text)) continue;
            const call = parseInlineCall(text);
            if (!call) continue;

            // Advance `sourceIdx` past entries whose expr doesn't
            // match — defensive: lets us recover gracefully if
            // markdown processing skipped or reordered something.
            // The vast majority of the time we land on the right
            // entry on the first try.
            let sourcePos: InlineCallPosition | undefined;
            while (sourceIdx < sourcePositions.length) {
                const candidate = sourcePositions[sourceIdx];
                sourceIdx++;
                if (callKey(candidate.call) === callKey(call)) {
                    sourcePos = candidate;
                    break;
                }
            }

            // If we couldn't find a matching source position (e.g.
            // getSectionInfo returned null, or the source diverged
            // from the DOM), fall back to occurrence 0. This
            // restores the old behaviour for the edge case — not
            // ideal, but at least nothing crashes.
            const occurrence = sourcePos?.occurrence ?? 0;
            await processOne(code, text, ctx, plugin, occurrence);
        }
    };
}

/**
 * Read the note's source and return only the inline-call positions
 * that fall within the current block's source range.
 *
 * Strategy:
 *   1. Get the block's line range via `getSectionInfo(el)`.
 *   2. Read the full note source from the vault.
 *   3. Enumerate every inline call with its source line.
 *   4. Return only calls whose line is in [lineStart, lineEnd].
 *
 * If any step fails (no section info, file unreadable, etc.) we
 * return an empty array. The caller treats that as "fall back to
 * occurrence 0", which restores the buggy old behaviour for the
 * edge case — but only in cases where we genuinely don't have
 * enough information to do better.
 */
async function readSourcePositions(
    plugin: RandomnessPlugin,
    ctx: MarkdownPostProcessorContext,
    el: HTMLElement
): Promise<InlineCallPosition[]> {
    try {
        const sectionInfo = ctx.getSectionInfo(el);
        const file = plugin.app.vault.getAbstractFileByPath(
            ctx.sourcePath
        );
        if (!(file instanceof TFile)) return [];
        const source = await plugin.app.vault.read(file);
        const all = findAllInlineCallPositions(source);
        if (!sectionInfo) {
            // No section bounds — return all positions and rely on
            // the expr-match in the caller to align correctly.
            // Works fine when the entire note renders in one
            // post-processor call (Reading view); less reliable
            // under partial re-renders.
            return all;
        }
        // Filter to calls whose source line is in the block's range.
        // `lineEnd` is inclusive in Obsidian's API.
        return all.filter(
            (p) =>
                p.line >= sectionInfo.lineStart &&
                p.line <= sectionInfo.lineEnd
        );
    } catch {
        return [];
    }
}

/**
 * Process a single inline call's <code> element. Replaces it with a
 * span carrying the preview/locked state and the lock/reroll
 * controls.
 *
 * `occurrence` is the source-level position of this call among
 * same-expression calls in the note (0-indexed). Used both as the
 * preview-registry key and as the target index for lock/reroll
 * operations against the source.
 */
async function processOne(
    codeEl: HTMLElement,
    text: string,
    ctx: MarkdownPostProcessorContext,
    plugin: RandomnessPlugin,
    occurrence: number
): Promise<void> {
    const call = parseInlineCall(text);
    if (!call) return;

    // Source-level occurrence: passed in by the caller, who computed
    // it by aligning DOM order with source order. Reliable across
    // re-renders and partial section updates because it's grounded
    // in the persisted source text, not transient DOM state.
    // Keyed by prefix+expr: `rdm:X` and `dice:X` are different calls
    // (the latter is translated before evaluation) and must not share
    // cached previews.
    const previewKey: PreviewKey = {
        sourcePath: ctx.sourcePath,
        expr: callKey(call),
        occurrence,
    };

    // Determine the result to display.
    let result: string;
    let isLocked: boolean;
    if (call.locked !== undefined) {
        // Locked: source-of-truth is the text, ignore any stale preview.
        result = call.locked;
        isLocked = true;
    } else {
        // Unfilled: use any cached preview, else compute fresh.
        const cached = plugin.previewRegistry.get(previewKey);
        if (cached !== undefined) {
            result = cached;
        } else {
            try {
                // Dice Roller prefixes are translated to rdm grammar
                // here (evalSourceOf); unsupported constructs throw a
                // DiceCompatError with a user-facing message. Formula
                // aliases from settings apply to compat prefixes.
                result = await evaluateExpression(
                    evalSourceOf(call, plugin.settings.diceFormulas),
                    ctx,
                    plugin
                );
            } catch (err) {
                renderInlineError(codeEl, err);
                return;
            }
            plugin.previewRegistry.set(previewKey, result);
        }
        isLocked = false;
    }

    // Dice Roller's `dice-mod:` writes its roll straight into the
    // note. A lock is our durable form of exactly that, so an
    // unfilled dice-mod span commits itself on first render — the
    // write triggers a re-render, which shows the locked state.
    if (!isLocked && (call.prefix ?? INLINE_PREFIX) === "dice-mod:") {
        await lockCall(ctx, plugin, call, occurrence);
        return;
    }

    // Display flags (Dice Roller compat): `|text(label)` shows the
    // label with the rolled value in the tooltip; `|form` shows the
    // formula alongside the result. Other flags stay inert for now.
    let displayResult = result;
    let tooltip: string | undefined;
    if ((call.prefix ?? INLINE_PREFIX) !== INLINE_PREFIX) {
        try {
            const { flags } = translateDiceExpression(
                call.expr,
                plugin.settings.diceFormulas
            );
            const textFlag = flags.find((f) => /^text\(.*\)$/i.test(f));
            if (textFlag !== undefined) {
                displayResult = textFlag.replace(/^text\(/i, "").slice(0, -1);
                tooltip = result;
            } else if (flags.some((f) => f.toLowerCase() === "form")) {
                displayResult = `${call.expr.trim()} → ${result}`;
            }
        } catch {
            // Translation errors were already surfaced above.
        }
    }

    // Render and keep a handle on the span we built — onReroll for an
    // unfilled call updates it in place without needing a re-render
    // from Obsidian.
    const span = replaceCodeElement(codeEl, {
        result: displayResult,
        tooltip,
        isLocked,
        expr: call.expr,
        onLock: () => lockCall(ctx, plugin, call, occurrence),
        onReroll: () =>
            rerollCall(
                ctx,
                plugin,
                call,
                occurrence,
                previewKey,
                isLocked,
                span
            ),
        plugin,
        sourcePath: ctx.sourcePath,
    });
}

/**
 * Evaluate an inline expression against its containing note's scope.
 * Composes prefetch + buildInlineBundle + Evaluator.
 *
 * Exported so commands ("Lock all in note") can evaluate uncached
 * expressions without duplicating the pipeline.
 */
export async function evaluateInlineExpression(
    expr: string,
    notePath: string,
    plugin: RandomnessPlugin,
    opts?: { seed?: number; promptValues?: Record<string, string> }
): Promise<string> {
    const { vault } = plugin.app;
    const settings = plugin.settings;

    // Read the note source so the inline scope can see same-note
    // codeblocks. If the file isn't readable (e.g. we're inside a
    // freshly-created note that hasn't persisted yet), fall back to
    // empty source — the expression still evaluates, just without
    // codeblock context.
    let noteSource = "";
    try {
        noteSource = await vault.adapter.read(notePath);
    } catch {
        // intentionally swallowed; see comment above
    }

    // Prefetch the Use: graph reachable from the note's codeblocks —
    // plus the target of a direct wikilink roll, whose Use: line is
    // injected by buildInlineBundle after prefetch has already run.
    const asyncSource = vaultFileSource(vault);
    const basenameResolver = makeLinkAwareBasenameResolver(plugin);
    const direct = parseDirectWikilinkCall(expr);
    const prefetch = await prefetchUseGraph({
        entryPath: notePath,
        entrySource: noteSource,
        generatorRoot: settings.generatorRoot || undefined,
        source: asyncSource,
        basenameResolver,
        extraUses: direct !== null ? [direct.fileRef] : undefined,
    });

    // Tag rolls (merge Phase 4) inject Use: lines for tagged notes at
    // bundle-build time — after prefetch has already run — so those
    // files must be fetched here and layered onto the sync source.
    const tagLookup = makeTagFilesLookup(plugin);
    let syncSource: FileSource = prefetch.source;
    const tagCall = parseDirectTagCall(expr);
    if (tagCall !== null) {
        const tagged: Map<string, string> = new Map();
        for (const p of tagLookup(tagCall.tag).slice(0, TAG_FILE_CAP)) {
            try {
                tagged.set(p, await vault.adapter.read(p));
            } catch {
                // Unreadable tagged note: skip it rather than failing
                // the whole roll.
            }
        }
        const base = prefetch.source;
        syncSource = {
            read: (p) => (tagged.has(p) ? (tagged.get(p) as string) : base.read(p)),
            exists: (p) => tagged.has(p) || base.exists(p),
        };
    }

    const bundle = buildInlineBundle(expr, {
        notePath,
        noteSource,
        source: syncSource,
        generatorRoot: settings.generatorRoot || undefined,
        basenameResolver,
        tagFiles: tagLookup,
    });

    // Auto-discover tables referenced by name but not defined in the
    // note's own codeblocks or a Use:'d file — same mechanism as the
    // codeblock processor. Lowest-priority, so explicit scope wins.
    let extras = bundle.extras;
    if (plugin.vaultIndex) {
        await plugin.vaultIndex.prewarm();
        const discovered = await discoverReferencedTables({
            main: bundle.main,
            extras: bundle.extras,
            alreadyLoaded: bundle.loadedPaths,
            resolveTableName: (n) => plugin.vaultIndex.resolveTable(n),
            source: asyncSource,
            generatorRoot: settings.generatorRoot || undefined,
        });
        if (discovered.length > 0) {
            extras = [...bundle.extras, ...discovered];
        }
    }

    const evaluator = new Evaluator(bundle.main, extras, {
        // Thread seed + promptValues through when provided (used by
        // the public API's roll options). Both are first-class
        // EvaluatorOptions fields, so this is a clean pass-through:
        // seed → deterministic RNG, promptValues → prompt overrides.
        // Omitting them (the in-render path) preserves prior
        // behaviour: random seed, prompt defaults.
        seed: opts?.seed,
        promptValues: opts?.promptValues,
    });
    return evaluator.run();
}

/**
 * Original ctx-flavoured wrapper kept for the in-render path, which
 * doesn't have a notePath without going through ctx.sourcePath.
 */
async function evaluateExpression(
    expr: string,
    ctx: MarkdownPostProcessorContext,
    plugin: RandomnessPlugin
): Promise<string> {
    return evaluateInlineExpression(expr, ctx.sourcePath, plugin);
}

// ────────────────────────────────────────────────────────────────────
// DOM rendering — kept simple. Standard DOM methods only (Obsidian's
// HTMLElement extensions aren't in jsdom).
// ────────────────────────────────────────────────────────────────────

interface InlineRenderProps {
    result: string;
    /** Optional hover text (e.g. the rolled value behind a |text label). */
    tooltip?: string;
    isLocked: boolean;
    expr: string;
    onLock: () => Promise<void> | void;
    onReroll: () => Promise<void> | void;
    /**
     * Optional: when present, the result is rendered with wiki-
     * link interpolation enabled (`![[image.png]]` becomes an
     * `<img>`, `[[note]]` becomes a clickable `<a>`). Required
     * when used from the post-processor; tests that exercise
     * replaceCodeElement directly can omit them.
     */
    plugin?: import("./main").default;
    sourcePath?: string;
}

/**
 * Replace a <code> element with our custom span. Returns the new span
 * so callers can hold a reference for in-place updates (notably the
 * reroll-on-unfilled flow updates the result text without rebuilding
 * the whole element). Exported so tests can exercise it directly
 * without going through the full processor pipeline.
 */
export function replaceCodeElement(
    codeEl: HTMLElement,
    props: InlineRenderProps
): HTMLElement {
    const span = activeDocument.createElement("span");
    span.className = "randomness-inline";
    if (props.tooltip !== undefined) span.title = props.tooltip;
    if (props.isLocked) span.classList.add("randomness-inline-locked");
    else span.classList.add("randomness-inline-preview");

    // Controls — anchored on the LEFT of the result text. Rationale:
    // result lengths vary on reroll ("Bob" → "Selene Coalheart"), and
    // if controls were on the right they'd shift each render, forcing
    // the user to chase the buttons with the mouse.
    //
    // Within the controls, Reroll (🎲) is placed FIRST because it's
    // present in both unfilled and locked states. Lock (🔒) is only
    // shown in the unfilled state and goes second, so toggling from
    // unfilled → locked doesn't shift the 🎲's x-position either.
    // CSS hides whichever button is contextually irrelevant later.
    const controls = activeDocument.createElement("span");
    controls.className = "randomness-inline-controls";

    // Locked spans wear the open-padlock icon: clicking it unlocks
    // (strips the ⟹result from the source), and the re-render shows a
    // fresh preview. Functionally that IS a re-roll, but the icon
    // should say what it undoes.
    const rerollBtn = props.isLocked
        ? makeControlButton("🔓", "Unlock (rolls a fresh preview)")
        : makeControlButton("🎲", "Re-roll");
    rerollBtn.addEventListener("click", (e) => {
        // addEventListener expects a void-returning handler. Wrap
        // the async work and void the promise — uncaught rejections
        // would otherwise be invisible.
        e.stopPropagation();
        e.preventDefault();
        void props.onReroll();
    });
    controls.appendChild(rerollBtn);

    if (!props.isLocked) {
        const lockBtn = makeControlButton("🔒", "Lock this preview");
        lockBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            void props.onLock();
        });
        controls.appendChild(lockBtn);
    }

    span.appendChild(controls);

    // Result text — appended AFTER controls so it renders to the
    // right. Wrapped so we can style it separately from the controls
    // and so reroll-in-place can find just the result element.
    //
    // Route through the same sanitiser the codeblock processor uses
    // — the engine emits real HTML (e.g. >> bold yields <b>X</b>),
    // and using textContent here would render those tags as literal
    // characters instead of bolding. Sanitiser drops anything outside
    // the whitelist (scripts, iframes, attributes); same safety
    // contract as codeblocks.
    const resultSpan = activeDocument.createElement("span");
    resultSpan.className = "randomness-inline-result";
    if (props.plugin !== undefined && props.sourcePath !== undefined) {
        setSanitisedHtmlWithLinks(
            resultSpan,
            markdownLite(props.result),
            props.plugin,
            props.sourcePath
        );
    } else {
        setSanitisedHtml(resultSpan, markdownLite(props.result));
    }
    resultSpan.title = props.expr; // hover shows the expression
    span.appendChild(resultSpan);

    // Swap into the DOM.
    codeEl.replaceWith(span);
    return span;
}

function makeControlButton(label: string, title: string): HTMLElement {
    const btn = activeDocument.createElement("button");
    btn.className = "randomness-inline-button";
    btn.type = "button";
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    return btn;
}

/** Render an inline error in place of the code element. */
export function renderInlineError(
    codeEl: HTMLElement,
    err: unknown
): void {
    const span = activeDocument.createElement("span");
    span.className = "randomness-inline randomness-inline-error";
    span.textContent =
        "[error: " +
        (err instanceof Error ? err.message : String(err)) +
        "]";
    codeEl.replaceWith(span);
}

// ────────────────────────────────────────────────────────────────────
// Lock / Reroll — write back to the note's source.
//
// Both use vault.process(file, fn) which is the atomic read-modify-
// write primitive in Obsidian. The function we pass receives the
// current file contents and returns the new contents; Obsidian
// handles the rest, including triggering re-renders.
// ────────────────────────────────────────────────────────────────────

async function lockCall(
    ctx: MarkdownPostProcessorContext,
    plugin: RandomnessPlugin,
    call: InlineCall,
    occurrence: number
): Promise<void> {
    // Read the current preview value from THIS specific call's
    // registry slot. Previously this hard-coded occurrence=0 with
    // a comment claiming all same-expression calls shared one
    // cache key — but processOne writes per-occurrence, so the
    // hard-coded lookup would either miss the fresh value for
    // occurrences 1+ or pick up a stale value from another call.
    //
    // The user-visible symptom: clicking Lock on the bottom of
    // three identical calls would commit the TOP one's value into
    // the source at the top one's position, while the bottom
    // stayed unfilled. By keying the lookup AND the source-write
    // by occurrence, each call's lock now targets its own data.
    const previewKey: PreviewKey = {
        sourcePath: ctx.sourcePath,
        expr: callKey(call),
        occurrence,
    };
    const cached = plugin.previewRegistry.get(previewKey);
    if (cached === undefined) {
        // No preview to lock. Shouldn't happen in normal flow — the
        // post-processor populates the registry before showing the
        // Lock button. If it does happen, evaluate on the fly so the
        // click does *something* useful.
        try {
            const fresh = await evaluateInlineExpression(
                evalSourceOf(call, plugin.settings.diceFormulas),
                ctx.sourcePath,
                plugin
            );
            plugin.previewRegistry.set(previewKey, fresh);
            return lockWithResult(ctx, plugin, call, occurrence, fresh);
        } catch {
            return; // give up silently
        }
    }
    return lockWithResult(ctx, plugin, call, occurrence, cached);
}

async function lockWithResult(
    ctx: MarkdownPostProcessorContext,
    plugin: RandomnessPlugin,
    call: InlineCall,
    occurrence: number,
    result: string
): Promise<void> {
    await modifyNote(plugin, ctx.sourcePath, (source) => {
        // Target THIS occurrence in the source — applyLockToSource
        // treats occurrence as the 0-indexed position among ALL
        // same-expression calls (locked or not), which is the
        // same scheme used by findAllInlineCallPositions when
        // computing the render-time occurrence. They line up.
        return applyLockToSource(
            source,
            call.expr,
            occurrence,
            result,
            call.prefix ?? INLINE_PREFIX
        );
    });
}

/**
 * Re-roll a call.
 *
 *   - **Unfilled**: evaluate a fresh value, update the registry, and
 *     update the visible span in place. No vault write — the source
 *     text is already what we want, and Obsidian wouldn't re-render
 *     anyway because nothing changed.
 *   - **Locked**: write `applyUnlockToSource` to strip the `⟹result`
 *     suffix. Obsidian sees the file change and re-renders, the
 *     post-processor fires, and the freshly-rendered span shows a
 *     new preview.
 *
 * The `span` param is the live `<span>` element produced by
 * `replaceCodeElement` — we mutate its result-text node directly in
 * the unfilled case rather than swapping the element. This keeps
 * event listeners attached to the buttons (we'd lose them if we
 * replaced the whole span), and means a rapid sequence of rerolls
 * doesn't accumulate orphaned DOM nodes.
 */
async function rerollCall(
    ctx: MarkdownPostProcessorContext,
    plugin: RandomnessPlugin,
    call: InlineCall,
    occurrence: number,
    previewKey: PreviewKey,
    wasLocked: boolean,
    span: HTMLElement
): Promise<void> {
    if (wasLocked) {
        // Locked → strip the lock from the source at THIS specific
        // occurrence. Previously this used `findFirstLockedOccurrence`
        // which always targeted the first locked call regardless of
        // which Reroll button the user clicked — same shape of bug
        // as the lock-targets-the-top one. Both are now position-
        // aware.
        plugin.previewRegistry.delete(previewKey);
        await modifyNote(plugin, ctx.sourcePath, (source) => {
            return applyUnlockToSource(
                source,
                call.expr,
                occurrence,
                call.prefix ?? INLINE_PREFIX
            );
        });
        return;
    }

    // Unfilled → evaluate fresh, update the registry, repaint in place.
    // Explicit user action, so this is also where |render animates.
    // Crucially the animated roll IS the result — one roll feeds both
    // the overlay and the span (same contract as the dice tray) — so
    // what the dice show always matches what the span says.
    let fresh: string;
    try {
        const rendered = await renderRollIfEligible(call, plugin);
        fresh =
            rendered ??
            (await evaluateInlineExpression(
                evalSourceOf(call, plugin.settings.diceFormulas),
                ctx.sourcePath,
                plugin
            ));
    } catch (err) {
        // Replace the span with an error indicator. The user can edit
        // the source to fix the expression.
        renderInlineError(span, err);
        return;
    }
    plugin.previewRegistry.set(previewKey, fresh);

    // Update the visible result. Find the result subspan we created
    // in replaceCodeElement; if it's missing (DOM was restructured by
    // another plugin?), fall back to the parent span as a target.
    //
    // Route through the sanitiser for the same reason as the initial
    // render — the engine emits real HTML for >> bold etc., which
    // must be parsed as tags, not displayed as literal characters.
    // Link-aware variant so wiki-syntax in rerolled output renders
    // the same way as on the initial pass.
    const resultSpan = span.querySelector<HTMLElement>(
        ".randomness-inline-result"
    );
    setSanitisedHtmlWithLinks(
        resultSpan ?? span,
        markdownLite(fresh),
        plugin,
        ctx.sourcePath
    );
}

/**
 * Helper: open the note, transform its contents, write it back. Uses
 * vault.process for atomic read-modify-write. If the file isn't a
 * TFile (e.g. it's a folder or doesn't exist), we silently do
 * nothing — the user just clicked a stale button on a deleted note,
 * which is a rare edge case not worth a notification.
 */
async function modifyNote(
    plugin: RandomnessPlugin,
    notePath: string,
    transform: (source: string) => string
): Promise<void> {
    const file = plugin.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return;
    await plugin.app.vault.process(file, transform);
}

/**
 * |render handling for an inline dice: span, fired only from explicit
 * re-rolls. Gates itself: compat prefix, graphical dice on, |render
 * flag present (and |norender absent), and the expression must be a
 * plain dice sum — matching Dice Roller, which could only render the
 * basic d20 set. When it plays, the animated roll IS the span's
 * result (returned as a string); returns null to fall back to the
 * normal evaluation path with no animation.
 */
async function renderRollIfEligible(
    call: InlineCall,
    plugin: RandomnessPlugin
): Promise<string | null> {
    try {
        if ((call.prefix ?? INLINE_PREFIX) === INLINE_PREFIX) return null;
        if (!plugin.settings.graphicalDice) return null;
        const { flags } = translateDiceExpression(
            call.expr,
            plugin.settings.diceFormulas
        );
        if (!flags.some((f) => f.toLowerCase() === "render")) return null;
        if (flags.some((f) => f.toLowerCase() === "norender")) return null;
        const { parsePureDiceFormula, rollPureDiceFormula, showDiceOverlay } =
            await import("../render3d/diceOverlay");
        // Strip flags the same way translation does, then see if
        // what's left is a plain dice sum.
        const stripped = call.expr.replace(/\|[^|]*$/g, "").trim();
        const terms = parsePureDiceFormula(stripped);
        if (terms === null) return null;
        const rolled = rollPureDiceFormula(terms);
        await showDiceOverlay(rolled.dice, rolled.total);
        return String(rolled.total);
    } catch {
        // Never let decoration break rolling — fall back silently.
        return null;
    }
}
