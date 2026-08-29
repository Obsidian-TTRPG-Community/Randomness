/**
 * Codeblock processor for ```randomness blocks.
 *
 * Renders a single codeblock by:
 *   1. Prefetching the Use: graph (async, via Vault).
 *   2. Running the synchronous resolver + Evaluator on the result.
 *   3. Writing output to the codeblock's container element.
 *
 * Each codeblock prefetches independently. We could share a cache
 * across the note (or vault) and invalidate on file edits, but until
 * we know the actual perf shape that's premature. The synchronous
 * resolver does deduplicate within a single render, so within one
 * codeblock the graph is walked once.
 *
 * Error handling:
 *   - ResolveError / ImportCycleError → rendered as an error message
 *     inside the codeblock's container, with the underlying message.
 *   - RecursionLimitError (engine) → same.
 *   - Anything else → fall back to a generic "Render failed" message
 *     plus the error text, since we don't want a malformed generator
 *     to break Obsidian's rendering pipeline.
 *
 * This module deliberately stops short of the preview/lock state
 * machine — that's the next session's `lockingService` + a richer
 * processor that wraps this one. For now: render the result, that's
 * it.
 */

import {
    MarkdownPostProcessorContext,
    MarkdownRenderChild,
} from "obsidian";
import { Evaluator } from "../engine/evaluator";
import { resolveBundle } from "../resolver/fileResolver";
import { prefetchUseGraph } from "../resolver/asyncPrefetcher";
import { discoverReferencedTables } from "../resolver/autoDiscover";
import {
    makeLinkAwareBasenameResolver,
    vaultFileSource,
} from "./vaultFileSource";
import type RandomnessPlugin from "./main";
import { stableSeedFor } from "./settings";
import { renderPromptControls, initialPromptValues } from "./promptUI";
import type { PromptDecl } from "../engine/ast";
import { setSanitisedHtmlWithLinks } from "./sanitiser";
import { parseDeckBlock, renderDeckBlock } from "./deckInlineProcessor";
import { makeEditorSafe } from "./editorSafeControls";
import { findBlocks } from "../resolver/mdExtractor";
import { parseFileSource } from "../resolver/fileResolver";
import {
    extractMarkdownContentTables,
    noteBaseName,
} from "../resolver/mdContent";
import type { GeneratorFile } from "../engine/ast";

/**
 * Build the codeblock-processor function to pass to
 * `registerMarkdownCodeBlockProcessor`. It closes over the plugin so
 * it can read live settings on each render.
 */
export function buildCodeblockProcessor(plugin: RandomnessPlugin) {
    return async function processor(
        source: string,
        el: HTMLElement,
        ctx: MarkdownPostProcessorContext
    ): Promise<void> {
        // Wrap in a MarkdownRenderChild so Obsidian can clean up if the
        // section is removed before the async render completes.
        const child = new RandomnessCodeblockChild(el, source, ctx, plugin);
        ctx.addChild(child);
        await child.render();
    };
}

/**
 * Renders one codeblock. Lives as a MarkdownRenderChild so its
 * lifetime is tied to the rendered section; if the section is removed
 * mid-render, `unloaded` flips to true and the in-flight handler
 * bails before writing to a detached element.
 */
class RandomnessCodeblockChild extends MarkdownRenderChild {
    private unloaded = false;
    /**
     * Prompt values keyed by label. Initialised from the generator's
     * declared defaults on first render; updated when the user
     * interacts with a prompt control, triggering a re-render.
     */
    private promptValues: Record<string, string> = {};
    /**
     * Whether promptValues has been seeded yet. We can only seed
     * after we've parsed the source for the first time, which happens
     * inside runRender — so we track this rather than seed up-front.
     */
    private promptsSeeded = false;
    /**
     * Bumped each time the user clicks Reroll. Folded into the stable
     * seed so a manual reroll produces a fresh result even when
     * `stableCodeblockSeeds` is on — and that new result then persists
     * across passive re-renders (scroll, note reload) rather than
     * snapping back to the seed-0 roll. When stable seeds are off the
     * seed is unused (every render is fresh anyway), so the button
     * still rerolls — the counter just goes along for the ride.
     */
    private rerollCounter = 0;

    constructor(
        containerEl: HTMLElement,
        private source: string,
        private ctx: MarkdownPostProcessorContext,
        private plugin: RandomnessPlugin
    ) {
        super(containerEl);
    }

    onunload(): void {
        this.unloaded = true;
    }

    async render(): Promise<void> {
        // Deck display block (persistent-decks design): a codeblock
        // whose whole body is one `deck:Name` line renders the deck's
        // last-drawn card at full size with a Draw button, instead of
        // running the engine. Rendering never draws.
        const deckCall = parseDeckBlock(this.source);
        if (deckCall !== null && this.plugin.decks) {
            clearElement(this.containerEl);
            await renderDeckBlock(this.plugin, this.containerEl, deckCall);
            return;
        }

        // Use a placeholder while async work runs. Replaced (or
        // discarded if we unload first) before this function returns.
        clearElement(this.containerEl);
        const placeholder = makeChildDiv(this.containerEl, "randomness-loading");
        placeholder.textContent = "Rolling…";

        try {
            const renderState = await this.runRender();
            if (this.unloaded) return;
            clearElement(this.containerEl);
            // Render prompts (if any) ABOVE the output, so the user
            // can change them and trigger a re-render.
            if (renderState.prompts.length > 0) {
                renderPromptControls(this.containerEl, {
                    prompts: renderState.prompts,
                    values: this.promptValues,
                    onChange: (newValues) => {
                        this.promptValues = newValues;
                        // Fire-and-forget — render() handles its own
                        // errors. Don't await; the click handler that
                        // triggered this doesn't need to block.
                        void this.render();
                    },
                });
            }
            // Reroll button. Rendered for every roller (with or without
            // prompts) so a codeblock has the same "give me another"
            // affordance the .rdm file view and inline calls already
            // have. Clicking bumps rerollCounter and re-renders, which
            // rerolls while keeping the current prompt values (they
            // live on this instance and promptsSeeded stays true).
            renderRerollButton(this.containerEl, () => {
                this.rerollCounter++;
                void this.render();
            });
            renderOutput(
                this.containerEl,
                renderState.output,
                this.plugin,
                this.ctx.sourcePath
            );
        } catch (err) {
            if (this.unloaded) return;
            clearElement(this.containerEl);
            renderError(this.containerEl, err);
        }
    }

    /**
     * Core async render. Separated from render() so the error-handling
     * boilerplate stays out of the way of the actual sequence.
     */
    private async runRender(): Promise<{
        output: string;
        prompts: PromptDecl[];
    }> {
        const { vault } = this.plugin.app;
        const settings = this.plugin.settings;
        const notePath = this.ctx.sourcePath;

        // Step 1: prefetch the Use: graph. The codeblock source itself
        // is the entry — we treat it as a virtual file at the note's
        // path with `.__codeblock.ipt` appended (forces .ipt dispatch
        // when the synchronous resolver re-parses it; see scope.ts
        // for the same trick on inline calls).
        const virtualPath = notePath + ".__codeblock.ipt";
        const asyncSource = vaultFileSource(vault);
        const basenameResolver = makeLinkAwareBasenameResolver(
            this.plugin
        );
        const prefetch = await prefetchUseGraph({
            entryPath: virtualPath,
            entrySource: this.source,
            generatorRoot: settings.generatorRoot || undefined,
            source: asyncSource,
            basenameResolver,
        });

        // Step 2: synchronous resolve.
        const bundle = resolveBundle(virtualPath, this.source, {
            callerDir: dirOf(notePath),
            generatorRoot: settings.generatorRoot || undefined,
            source: prefetch.source,
            basenameResolver,
        });

        // Step 2a: the rest of THIS NOTE.
        //
        // An inline `rdm:` call has always seen the note's other
        // `randomness` blocks and its `^block-id` tables; a codeblock
        // saw neither, so `[@Party]` in one block could not reach a
        // `Table: Party` defined in the block below it — the same note,
        // in front of the user, invisible. That asymmetry had no
        // rationale behind it, only history, and it read as a bug every
        // time someone hit it (issue #5).
        //
        // Added as extras filtered against what is already defined, so
        // this block's own tables and anything it explicitly `Use:`s
        // still win. Sitting before discovery means a name the note
        // defines is never fetched from a generator file instead: the
        // table you can see beats the one you cannot.
        let extras = bundle.extras;
        const noteScope = this.noteScopeFile(bundle.main, bundle.extras);
        if (noteScope !== null) extras = [...extras, noteScope];

        // Step 2b: auto-discover tables referenced by name but not
        // defined here, in a Use:'d file, or elsewhere in the note —
        // the vault index maps a table name to the file that defines
        // it. Purely additive and lowest-priority, so explicit
        // definitions always win.
        if (this.plugin.vaultIndex) {
            await this.plugin.vaultIndex.prewarm();
            const discovered = await discoverReferencedTables({
                main: bundle.main,
                extras: bundle.extras,
                alreadyLoaded: bundle.loadedPaths,
                resolveTableName: (n) =>
                    this.plugin.vaultIndex.resolveTable(n),
                source: asyncSource,
                generatorRoot: settings.generatorRoot || undefined,
            });
            if (discovered.length > 0) {
                extras = [...bundle.extras, ...discovered];
            }
        }

        // Seed prompt values on first render (we need the parsed file
        // to know what prompts exist). Subsequent renders preserve
        // whatever the user has selected.
        if (!this.promptsSeeded) {
            this.promptValues = initialPromptValues(bundle.main.prompts);
            this.promptsSeeded = true;
        }

        // Step 3: run the engine. Seed strategy: stable seed if the
        // setting is on, otherwise unseeded (which the RNG class
        // interprets as "use Math.random()").
        const sectionInfo = this.ctx.getSectionInfo(this.containerEl);
        // Fold rerollCounter into the hashed source so each Reroll click
        // advances the stable seed. At counter 0 this is equivalent to
        // the old behaviour, so two fresh renders of the same block
        // still match (passive re-renders stay stable); only an explicit
        // reroll changes the seed.
        const seed = settings.stableCodeblockSeeds
            ? stableSeedFor(
                  this.source + " reroll:" + this.rerollCounter,
                  sectionInfo?.lineStart ?? 0
              )
            : undefined;
        // Deck hosts, NON-committing: codeblocks re-render passively
        // (note opened, scrolled into view), and a passive render must
        // never burn a card. Draws here come from a throwaway copy of
        // the deck state — plausible previews, no consumption
        // (persistent-decks design, interaction rule).
        const hosts = this.plugin.decks
            ? await this.plugin.decks.buildEvalHosts(
                  this.ctx.sourcePath,
                  false
              )
            : undefined;
        const evaluator = new Evaluator(bundle.main, extras, {
            seed,
            promptValues: this.promptValues,
            deckHost: hosts?.deckHost,
            folderDeckHost: hosts?.folderDeckHost,
        });
        return {
            output: evaluator.run(),
            prompts: bundle.main.prompts,
        };
    }

    /**
     * The rest of the containing note as a GeneratorFile: every OTHER
     * `randomness` block's tables, plus the note's `^block-id` tables
     * and lists.
     *
     * Names already defined by `already` (this block, and anything it
     * `Use:`s) are dropped, so note scope can only ever ADD — the
     * table you wrote in this block always wins over a same-named one
     * further down the note.
     *
     * Returns null when the note contributes nothing, so the common
     * case allocates nothing and the bundle is byte-identical to what
     * it was before.
     */
    private noteScopeFile(
        main: GeneratorFile,
        useExtras: GeneratorFile[]
    ): GeneratorFile | null {
        // `getSectionInfo().text` is the whole note source, already in
        // memory — no disk read, and it is what the inline path pays
        // for separately. Null in some render contexts (exports, some
        // previews); note scope is simply absent there rather than
        // worth an async read in a synchronous stretch.
        const noteSource = this.ctx.getSectionInfo(this.containerEl)?.text;
        if (!noteSource) return null;

        const taken = new Set<string>();
        for (const f of [main, ...useExtras]) {
            for (const t of f.tables) taken.add(t.name.toLowerCase());
        }

        // Other blocks are concatenated and parsed as one file, so
        // tables split across several blocks share a namespace the way
        // the inline path already treats them.
        //
        // Their `Use:` lines are NOT followed. Parsing records them but
        // resolving them would need its own prefetch pass — the
        // synchronous resolver can only read files the async prefetch
        // already pulled in, and that pass walked this block's imports
        // only. In practice auto-discovery covers it: a table named in
        // this block is looked up in the vault index regardless of
        // which file holds it. What is genuinely out of reach is a
        // sibling block importing a file whose tables this block never
        // names — rare, and `Use:` here fixes it.
        const blockSource = findBlocks(noteSource)
            .map((b) => b.content)
            .join("\n\n");
        const virtualPath = this.ctx.sourcePath + ".__noteScope.ipt";
        const parsed =
            blockSource.trim() === ""
                ? null
                : parseFileSource(virtualPath, blockSource);

        const tables = (parsed?.tables ?? []).filter(
            (t) => !taken.has(t.name.toLowerCase())
        );
        for (const t of tables) taken.add(t.name.toLowerCase());

        // `^block-id` tables and lists in the note's markdown. Lowest
        // of the low: a codeblock definition of the same name wins.
        for (const t of extractMarkdownContentTables(
            noteSource,
            noteBaseName(this.ctx.sourcePath)
        )) {
            if (taken.has(t.name.toLowerCase())) continue;
            taken.add(t.name.toLowerCase());
            tables.push(t);
        }

        if (tables.length === 0) return null;
        // Tables only. Directives are deliberately NOT inherited: a
        // sibling block's `MaxReps:`, `Prompt:` or `Set:` belongs to
        // that block, and pulling them in here would let one block
        // silently change how another renders. `uses` is empty for the
        // reason given above: sibling imports are not resolved here.
        return {
            uses: [],
            topLevelSets: [],
            prompts: [],
            tables,
        };
    }
}

// ────────────────────────────────────────────────────────────────────
// DOM rendering helpers — kept separate so they're easy to test in
// isolation (without needing to assemble a full plugin).
// ────────────────────────────────────────────────────────────────────

/**
 * Render the engine's output into a container. The engine emits HTML
 * when formatting=html (the default); we route it through the
 * sanitiser to strip any tags / attributes outside our whitelist
 * before attaching to the DOM. See sanitiser.ts for the policy.
 *
 * Text-mode output is also routed through the sanitiser — it'll have
 * no tags, so the sanitiser is effectively a no-op for it, but the
 * uniform code path is cleaner than branching on settings.formatting
 * here.
 */
export function renderOutput(
    container: HTMLElement,
    output: string,
    plugin: import("./main").default,
    sourcePath: string
): void {
    const div = makeChildDiv(container, "randomness-output");
    setSanitisedHtmlWithLinks(div, output, plugin, sourcePath);
}

/**
 * Render an error into a container. Friendly message; the underlying
 * error message is exposed for debugging but not the stack.
 */
export function renderError(container: HTMLElement, err: unknown): void {
    const wrap = makeChildDiv(container, "randomness-error");
    const heading = activeDocument.createElement("strong");
    heading.textContent = "Randomness: render failed";
    wrap.appendChild(heading);
    const messageDiv = makeChildDiv(wrap, "randomness-error-message");
    messageDiv.textContent =
        err instanceof Error ? err.message : String(err);
}

/**
 * Render a Reroll button into the container. Clicking it invokes
 * `onReroll`, which the codeblock child wires to bump its reroll
 * counter and re-render — a fresh roll that keeps the current prompt
 * values. Kept here (rather than in promptUI) because it's tied to the
 * codeblock's reroll lifecycle, not to prompt controls; a roller with
 * no prompts still gets the button.
 */
export function renderRerollButton(
    container: HTMLElement,
    onReroll: () => void
): HTMLButtonElement {
    const bar = makeChildDiv(container, "randomness-codeblock-controls");
    const button = activeDocument.createElement("button");
    button.className = "randomness-reroll-btn";
    button.type = "button";
    button.textContent = "🎲 Reroll";
    button.setAttribute("aria-label", "Reroll");
    button.addEventListener("click", () => onReroll());
    // Live Preview: pressing Reroll must not drop the caret into the
    // codeblock and unrender it.
    makeEditorSafe(button);
    bar.appendChild(button);
    return button;
}

// ────────────────────────────────────────────────────────────────────
// Tiny DOM helpers — kept as standard-DOM wrappers rather than relying
// on Obsidian's HTMLElement extensions (which jsdom doesn't have, and
// which Obsidian inherits by augmenting the prototype globally — fine
// in the plugin runtime, but couples us to that augmentation
// unnecessarily).
// ────────────────────────────────────────────────────────────────────

function clearElement(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function makeChildDiv(parent: HTMLElement, className?: string): HTMLDivElement {
    const div = activeDocument.createElement("div");
    if (className) div.className = className;
    parent.appendChild(div);
    return div;
}

/**
 * Local dirname — duplicates fileResolver.dirname rather than imports
 * it, because importing would pull the resolver into this module's
 * dep graph for no real benefit. Tiny enough to keep co-located.
 */
function dirOf(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const i = norm.lastIndexOf("/");
    if (i === -1) return "";
    if (i === 0) return "/";
    return norm.slice(0, i);
}
