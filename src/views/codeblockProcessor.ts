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

        // Step 2b: auto-discover tables referenced by name but not
        // defined here or in a Use:'d file — the vault index maps a
        // table name to the file that defines it. Purely additive and
        // lowest-priority, so explicit definitions always win.
        let extras = bundle.extras;
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
        const seed = settings.stableCodeblockSeeds
            ? stableSeedFor(this.source, sectionInfo?.lineStart ?? 0)
            : undefined;
        const evaluator = new Evaluator(bundle.main, extras, {
            seed,
            promptValues: this.promptValues,
        });
        return {
            output: evaluator.run(),
            prompts: bundle.main.prompts,
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
