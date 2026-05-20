/**
 * Custom view for `.ipt` files.
 *
 * When the user clicks a `.ipt` file in Obsidian's file explorer,
 * this view opens. It reads the file as a standalone generator, runs
 * it through the engine, and shows the rolled output along with a
 * Reroll button and an "Open as Markdown" action for editing the
 * source.
 *
 * Design notes:
 *
 * 1. Extends `TextFileView` so Obsidian handles the read/save plumbing.
 *    `setViewData` is called on open (with the file contents); we cache
 *    them on `this.data` so the view can re-render via Reroll without
 *    re-reading the file. `getViewData` returns the cached source
 *    unchanged — the view is presentational, never modifies the file.
 *
 * 2. The view treats the .ipt file as the entry point of a Use: graph,
 *    same as a codeblock would. The note path is the .ipt's own path,
 *    so any `Use:` paths resolve relative to its folder first, then
 *    the configured generator root.
 *
 * 3. Rerolling means calling render() again — the engine uses
 *    fresh entropy (no stable-seed setting here; the file view is
 *    explicitly about "show me a fresh roll"). Lock-style stickiness
 *    doesn't make sense for a whole-file view; the user can copy the
 *    output out if they want to keep it.
 *
 * 4. "Open as Markdown" switches the leaf's view type back to the
 *    default markdown editor so the user can edit the source. The
 *    Obsidian pattern for this is `leaf.setViewState({ type: "markdown" })`.
 */

import {
    TextFileView,
    WorkspaceLeaf,
    TFile,
} from "obsidian";
import { Evaluator } from "../engine/evaluator";
import { resolveBundle } from "../resolver/fileResolver";
import { prefetchUseGraph } from "../resolver/asyncPrefetcher";
import { vaultFileSource } from "./vaultFileSource";
import { setSanitisedHtmlWithLinks } from "./sanitiser";
import { renderPromptControls, initialPromptValues } from "./promptUI";
import type RandomnessPlugin from "./main";

export const VIEW_TYPE_IPT = "randomness-ipt-view";

export class IptView extends TextFileView {
    private plugin: RandomnessPlugin;
    /** Prompt values for the current file. Reset when a new file loads. */
    private promptValues: Record<string, string> = {};
    /**
     * Container for the rendered output (and Reroll button + prompts).
     * Lazily initialised in onOpen so we can be sure Obsidian has set
     * up containerEl.children[1]. Renamed from the obvious "contentEl"
     * because `TextFileView` already has a `contentEl` property on its
     * own that we shouldn't shadow.
     */
    private renderTarget: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: RandomnessPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_IPT;
    }

    getDisplayText(): string {
        return this.file?.basename ?? "Generator";
    }

    async onOpen(): Promise<void> {
        // containerEl is the leaf's wrapper; children[0] is the header,
        // children[1] is where we render content. We don't want to
        // touch children[0] — Obsidian owns the title bar.
        const root = this.containerEl.children[1] as HTMLElement;
        clearElement(root);
        const wrap = document.createElement("div");
        wrap.className = "randomness-ipt-view";
        root.appendChild(wrap);
        this.renderTarget = wrap;

        // Add a Reroll action button to the view's title-bar action area.
        // Obsidian shows these as small icon buttons next to the view title.
        this.addAction("dice", "Reroll", () => {
            void this.render();
        });
        // "Open as Markdown" is a less-frequent action — also pinned to
        // the title bar.
        this.addAction("file-text", "Open as Markdown", () => {
            void this.openAsMarkdown();
        });
    }

    async onClose(): Promise<void> {
        // Nothing to dispose explicitly — the leaf cleans up children.
    }

    /**
     * Called by Obsidian when the file is loaded (or reloaded after
     * external edit). `clear` is true when switching to a different
     * file (vs reloading the same one).
     */
    setViewData(data: string, clear: boolean): void {
        this.data = data;
        if (clear) {
            // Reset per-file state when switching files.
            this.promptValues = {};
        }
        void this.render();
    }

    /** Source-of-truth for Obsidian's save path. Never mutated by the view. */
    getViewData(): string {
        return this.data;
    }

    clear(): void {
        this.data = "";
        this.promptValues = {};
        if (this.renderTarget) clearElement(this.renderTarget);
    }

    // ────────────────────────────────────────────────────────────────
    // Render pipeline
    // ────────────────────────────────────────────────────────────────

    private async render(): Promise<void> {
        const target = this.renderTarget;
        if (!target) return;
        clearElement(target);
        const loading = document.createElement("div");
        loading.className = "randomness-loading";
        loading.textContent = "Rolling…";
        target.appendChild(loading);

        try {
            const { output, prompts } = await this.evaluate();
            clearElement(target);
            // Render prompts above the output if the generator has any.
            if (prompts.length > 0) {
                renderPromptControls(target, {
                    prompts,
                    values: this.promptValues,
                    onChange: (newValues) => {
                        this.promptValues = newValues;
                        void this.render();
                    },
                });
            }
            const outputDiv = document.createElement("div");
            outputDiv.className = "randomness-output";
            setSanitisedHtmlWithLinks(
                outputDiv,
                output,
                this.plugin,
                this.file?.path ?? ""
            );
            target.appendChild(outputDiv);
        } catch (err) {
            clearElement(target);
            const wrap = document.createElement("div");
            wrap.className = "randomness-error";
            const heading = document.createElement("strong");
            heading.textContent = "Randomness: render failed";
            wrap.appendChild(heading);
            const messageDiv = document.createElement("div");
            messageDiv.className = "randomness-error-message";
            messageDiv.textContent =
                err instanceof Error ? err.message : String(err);
            wrap.appendChild(messageDiv);
            target.appendChild(wrap);
        }
    }

    /**
     * Run the engine on the current file's source. Mirrors the
     * codeblock processor's pipeline but uses the .ipt file's own
     * path as the entry, rather than a synthetic codeblock path.
     */
    private async evaluate(): Promise<{
        output: string;
        prompts: import("../engine/ast").PromptDecl[];
    }> {
        const { vault } = this.plugin.app;
        const settings = this.plugin.settings;
        const notePath = this.file?.path ?? "";

        const asyncSource = vaultFileSource(vault);
        const prefetch = await prefetchUseGraph({
            entryPath: notePath,
            entrySource: this.data,
            generatorRoot: settings.generatorRoot || undefined,
            source: asyncSource,
        });

        const bundle = resolveBundle(notePath, this.data, {
            callerDir: dirOf(notePath),
            generatorRoot: settings.generatorRoot || undefined,
            source: prefetch.source,
        });

        // Seed promptValues from declared defaults on first render
        // (or after a `clear`). Don't overwrite the user's selections
        // on subsequent renders — that's the change-and-re-render flow.
        if (Object.keys(this.promptValues).length === 0) {
            this.promptValues = initialPromptValues(bundle.main.prompts);
        }

        const evaluator = new Evaluator(bundle.main, bundle.extras, {
            promptValues: this.promptValues,
        });
        return {
            output: evaluator.run(),
            prompts: bundle.main.prompts,
        };
    }

    /**
     * Switch this leaf to the default markdown editor view. Used by
     * the "Open as Markdown" action — gives the user direct access to
     * edit the raw .ipt source.
     *
     * Caveat: Obsidian only registers the markdown view for .md
     * extension by default. For .ipt files we're stretching slightly —
     * the markdown editor will open the file as text regardless, which
     * is what we want.
     */
    private async openAsMarkdown(): Promise<void> {
        const file = this.file;
        if (!file) return;
        // The trick: set the leaf's view state to type "markdown" with
        // the current file. The leaf re-creates with the markdown view,
        // which renders the raw source as editable text.
        await this.leaf.setViewState({
            type: "markdown",
            state: { file: file.path },
        });
    }
}

// ────────────────────────────────────────────────────────────────────
// Local DOM helpers (mirror what codeblockProcessor uses; small
// duplication to keep this file self-contained).
// ────────────────────────────────────────────────────────────────────

function clearElement(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function dirOf(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const i = norm.lastIndexOf("/");
    if (i === -1) return "";
    if (i === 0) return "/";
    return norm.slice(0, i);
}

// ────────────────────────────────────────────────────────────────────
// Registration helper — main.ts calls this in onload.
// ────────────────────────────────────────────────────────────────────

/**
 * Register the .ipt view type and associate the .ipt extension with
 * it. Called from RandomnessPlugin.onload.
 *
 * `registerExtensions` can throw if another plugin (e.g. one of the
 * "Custom File Extensions" plugins) has already claimed `.ipt`. We
 * catch that case: the view type itself still registers, so the
 * plugin loads, and the user can either disable the conflicting
 * plugin or manually set the extension via that plugin's settings.
 * A console warning surfaces the conflict without blocking onload.
 */
export function registerIptView(plugin: RandomnessPlugin): void {
    plugin.registerView(
        VIEW_TYPE_IPT,
        (leaf: WorkspaceLeaf) => new IptView(leaf, plugin)
    );
    try {
        plugin.registerExtensions(["ipt"], VIEW_TYPE_IPT);
    } catch (err) {
        console.warn(
            "Randomness: could not register .ipt extension — another " +
                "plugin may already own it. The plugin will still work " +
                "for codeblocks and inline calls; only the .ipt file " +
                "view is affected.",
            err
        );
    }
}

// Re-export TFile in case consumers need it — small convenience.
export { TFile };
