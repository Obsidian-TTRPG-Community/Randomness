/**
 * Inline rolls in Live Preview.
 *
 * `registerMarkdownPostProcessor` fires for BLOCK-level elements, which
 * is why ```randomness codeblocks have always rendered in the editor.
 * Obsidian draws inline code spans itself, with its own CodeMirror
 * decoration, and never hands them to a post-processor — so an inline
 * `` `rdm:[@x]` `` has never rendered in Live Preview in the plugin's
 * whole history. People saw the raw text, clicked it, watched the
 * backticks appear, and reported it as "clicking flips me to source
 * mode". Verified in the real app before this was written: the same
 * note renders in Reading view and stays as text in Live Preview.
 *
 * This is the other half of the rendering story — a CodeMirror
 * extension that replaces those spans with the SAME DOM the
 * post-processor builds, so the two views agree on what a note looks
 * like and on what its buttons do.
 *
 * Three things make it behave:
 *
 *   - `ignoreEvent()` returns true, so CodeMirror does not treat a
 *     click inside the widget as a click into the document. This is
 *     the CM-native answer to the caret problem, confirmed against a
 *     real CodeMirror in a browser.
 *   - The selection reveals the source (see `inlineCallRanges`), which
 *     is how you edit a roll.
 *   - Evaluation is async but `toDOM` is not, so a first sighting
 *     renders a placeholder, evaluates, and asks for a rebuild. The
 *     PreviewRegistry is shared with the Reading-view path, so a roll
 *     you have already seen shows the same value in both.
 */

import { Extension, Prec, StateEffect } from "@codemirror/state";
import {
    Decoration,
    DecorationSet,
    EditorView,
    ViewPlugin,
    ViewUpdate,
    WidgetType,
} from "@codemirror/view";
import { MarkdownView, editorLivePreviewField } from "obsidian";
import type RandomnessPlugin from "./main";
import { InlineCall, PreviewKey, callKey } from "./lockingService";
import { diceCompatEnabled } from "./settings";
import { inlineCallRanges } from "./livePreviewRanges";
import {
    applyVisibleFaces,
    bakeCall,
    decorateDiceResult,
    lockCall,
    replaceCodeElement,
    rerollCall,
    evaluateInlineExpression,
} from "./inlineProcessor";
import { evalSourceOf } from "./lockingService";
import { DiceTraceEntry } from "../engine/dice";

/** Dispatched when an async evaluation lands, to force a rebuild. */
const refresh = StateEffect.define<null>();

/**
 * The note a given editor is showing.
 *
 * An editor extension is registered globally, so the widget has to
 * work out which file it belongs to. Matching the CodeMirror instance
 * against each markdown leaf's editor is the standard way; `cm` is
 * untyped in the public API, hence the cast.
 */
function sourcePathFor(
    plugin: RandomnessPlugin,
    view: EditorView
): string | null {
    try {
        for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
            const md = leaf.view;
            if (!(md instanceof MarkdownView)) continue;
            const cm = (md.editor as unknown as { cm?: EditorView }).cm;
            if (cm === view) return md.file?.path ?? null;
        }
    } catch {
        // Defensive, as everywhere else that reaches into the
        // workspace: no path means we render nothing rather than throw
        // inside a decoration build.
    }
    return null;
}

class InlineRollWidget extends WidgetType {
    constructor(
        private readonly plugin: RandomnessPlugin,
        private readonly call: InlineCall,
        private readonly occurrence: number,
        private readonly sourcePath: string,
        /** Cached display text, or null when it still has to be evaluated. */
        private readonly cached: string | null
    ) {
        super();
    }

    /**
     * Rebuild the DOM only when something the reader would notice has
     * changed. Without this every keystroke anywhere in the note
     * rebuilds every widget, which throws away the button elements
     * mid-click.
     */
    eq(other: InlineRollWidget): boolean {
        return (
            this.call.expr === other.call.expr &&
            this.call.locked === other.call.locked &&
            (this.call.prefix ?? "") === (other.call.prefix ?? "") &&
            this.occurrence === other.occurrence &&
            this.sourcePath === other.sourcePath &&
            this.cached === other.cached
        );
    }

    /**
     * Let our own handlers see events; keep CodeMirror from treating
     * them as clicks into the document. This is what stops the caret
     * landing in the codespan and unrendering it.
     */
    ignoreEvent(): boolean {
        return true;
    }

    toDOM(view: EditorView): HTMLElement {
        // Always hand CodeMirror a wrapper we control, and build into
        // it. Returning the inner span directly meant that any failure
        // — or any doubt about whether this method ran at all — looked
        // identical from the outside: CodeMirror hides the source text
        // regardless, so the roll just vanished from the note with no
        // clue anywhere. The wrapper is always in the DOM, so there is
        // always something to find.
        const wrap = activeDocument.createElement("span");
        wrap.className = "randomness-lp-widget";
        try {
            wrap.appendChild(this.build(view));
        } catch (e) {
            wrap.classList.add("randomness-inline-error");
            wrap.textContent = `⚠ ${(e as Error).message}`;
        }
        return wrap;
    }

    private build(view: EditorView): HTMLElement {
        const isLocked = this.call.locked !== undefined;
        const text = this.cached;
        if (text === null) {
            // Not evaluated yet. Render a quiet placeholder and ask for
            // a rebuild once the value arrives.
            const pending = activeDocument.createElement("span");
            pending.className = "randomness-inline randomness-inline-preview";
            pending.textContent = "…";
            void this.evaluate(view);
            return pending;
        }
        const code = activeDocument.createElement("code");
        code.textContent = "";
        // replaceCodeElement wants a node to swap out; give it a
        // detached one so the widget owns the result.
        const holder = activeDocument.createElement("span");
        holder.appendChild(code);
        return replaceCodeElement(code, {
            result: text,
            isLocked,
            expr: this.call.expr,
            onLock: () =>
                lockCall(this.sourcePath, this.plugin, this.call, this.occurrence),
            onBake: () =>
                bakeCall(
                    this.sourcePath,
                    this.plugin,
                    this.call,
                    this.occurrence,
                    text
                ),
            onReroll: () =>
                this.reroll(view),
            plugin: this.plugin,
            sourcePath: this.sourcePath,
        });
    }

    /** The preview slot this widget reads and writes. */
    private key(): PreviewKey {
        return {
            sourcePath: this.sourcePath,
            expr: callKey(this.call),
            occurrence: this.occurrence,
        };
    }

    /**
     * Re-roll from inside the editor.
     *
     * The Reading-view handler repaints its span in place; here the
     * widget is owned by CodeMirror, so the value goes into the
     * registry and a rebuild draws it. A locked call still goes
     * through the shared handler, which rewrites the note.
     */
    private async reroll(view: EditorView): Promise<void> {
        if (this.call.locked !== undefined) {
            await rerollCall(
                this.sourcePath,
                this.plugin,
                this.call,
                this.occurrence,
                this.key(),
                true,
                activeDocument.createElement("span")
            );
            return;
        }
        this.plugin.previewRegistry.delete(this.key());
        await this.evaluate(view, true);
    }

    /**
     * Evaluate into the shared registry, then ask the editor to
     * rebuild. `commitDeckDraws` only on an explicit re-roll — a
     * passive render must never burn a card, the same rule the
     * codeblock and Reading-view paths follow.
     */
    private async evaluate(view: EditorView, explicit = false): Promise<void> {
        const key = this.key();
        const pendingKey = `${key.sourcePath} ${key.occurrence} ${key.expr}`;
        const pending = pendingEvaluations(this.plugin);
        if (!explicit && pending.has(pendingKey)) return;
        pending.add(pendingKey);
        try {
            const trace: DiceTraceEntry[] = [];
            const raw = await evaluateInlineExpression(
                evalSourceOf(this.call, this.plugin.settings.diceFormulas),
                this.sourcePath,
                this.plugin,
                { commitDeckDraws: explicit, diceTrace: trace }
            );
            const shown = decorateDiceResult(
                this.call,
                raw,
                this.plugin,
                trace
            ).display;
            this.plugin.previewRegistry.set(
                key,
                applyVisibleFaces(this.call, raw, this.plugin, trace),
                trace
            );
            // Store the DISPLAY form too — the widget renders that, and
            // recomputing it on every rebuild would re-apply flags to
            // an already-decorated string.
            displayCache(this.plugin).set(pendingKey, shown);
        } catch (e) {
            displayCache(this.plugin).set(
                pendingKey,
                `⚠ ${(e as Error).message}`
            );
        } finally {
            pending.delete(pendingKey);
            // A rebuild, not a document change: the note is untouched.
            view.dispatch({ effects: refresh.of(null) });
        }
    }
}

/**
 * Per-plugin scratch state. Hung off the plugin rather than module
 * globals so unloading the plugin takes them with it, and so two
 * vaults in one Obsidian process don't share a cache.
 */
interface Scratch {
    pending: Set<string>;
    display: Map<string, string>;
}
const SCRATCH = new WeakMap<object, Scratch>();
function scratch(plugin: RandomnessPlugin): Scratch {
    let s = SCRATCH.get(plugin);
    if (!s) {
        s = { pending: new Set(), display: new Map() };
        SCRATCH.set(plugin, s);
    }
    return s;
}
const pendingEvaluations = (p: RandomnessPlugin) => scratch(p).pending;
const displayCache = (p: RandomnessPlugin) => scratch(p).display;

/**
 * The editor extension. Register with `registerEditorExtension`.
 */
export function inlineRollLivePreview(plugin: RandomnessPlugin): Extension {
    const build = (view: EditorView): DecorationSet => {
        // Source mode shows you the text you wrote, on purpose.
        if (!view.state.field(editorLivePreviewField)) {
            return Decoration.none;
        }
        const sourcePath = sourcePathFor(plugin, view);
        if (sourcePath === null) return Decoration.none;
        const text = view.state.doc.toString();
        const sel = view.state.selection.main;
        const ranges = inlineCallRanges({
            text,
            selection: { from: sel.from, to: sel.to },
            compatOn: diceCompatEnabled(plugin),
        });
        const cache = displayCache(plugin);
        return Decoration.set(
            ranges.map((r) => {
                const key = `${sourcePath} ${r.occurrence} ${callKey(r.call)}`;
                // A locked call carries its own answer in the note —
                // no evaluation, no waiting, exactly like Reading view.
                const cached =
                    r.call.locked !== undefined
                        ? r.call.locked
                        : cache.get(key) ?? null;
                return Decoration.replace({
                    widget: new InlineRollWidget(
                        plugin,
                        r.call,
                        r.occurrence,
                        sourcePath,
                        cached
                    ),
                }).range(r.from, r.to);
            }),
            true
        );
    };

    // Highest precedence, because we are competing for the same range.
    // Obsidian renders inline code spans with its own replace
    // decoration; where two replace decorations cover the same text,
    // CodeMirror keeps one and drops the other. Without this ours
    // loses: the text is hidden (theirs replaced it) and our widget is
    // never asked for its DOM, so the roll vanishes leaving an empty
    // span behind. Verified against the real app — the widget in the
    // document had no class of ours and no content.
    return Prec.highest(
        ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            constructor(view: EditorView) {
                this.decorations = build(view);
            }
            update(u: ViewUpdate) {
                if (
                    u.docChanged ||
                    u.selectionSet ||
                    u.viewportChanged ||
                    u.transactions.some((t) =>
                        t.effects.some((e) => e.is(refresh))
                    )
                ) {
                    this.decorations = build(u.view);
                }
            }
        },
            { decorations: (v) => v.decorations }
        )
    );
}
