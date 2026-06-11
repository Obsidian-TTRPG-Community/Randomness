/**
 * Codeblock processor for ```portrait blocks.
 *
 * Body is `key: value` lines (all optional):
 *   pack: <vault-relative pack folder>   default: settings.portraitPackPath
 *   seed: <string>                       stable seed; count>1 derives seed#i
 *   count: <1..24>                       portraits per block, default 1
 *   size: <64..1024>                     tile width in px, default 256
 *   recipe: <PortraitRecipe JSON>        locked portrait — renders exactly
 *                                        this, no roll controls
 *
 * Unlocked blocks render a grid with a Reroll control. Each tile has a
 * lock icon overlaid top-right of the art (lock = rewrite this block's
 * body to `recipe: {…}`, the set-in-stone state; on a locked block the
 * icon flips to unlock = remove the recipe line and roll again) and a
 * PNG action that saves the image next to the note and REPLACES the
 * whole block with an `![[file.png]]` embed.
 *
 * Gating: if no pack manifest is found at the resolved pack path the
 * block renders a pointer to Settings → Randomness instead of UI.
 */

import {
    MarkdownPostProcessorContext,
    MarkdownRenderChild,
    Notice,
    TFile,
} from "obsidian";
import type RandomnessPlugin from "../views/main";
import { composePack, composeFromRecipe, Composed, PortraitRecipe } from "./pack";
import { saveComposedPng } from "./png";
import { nameFor } from "./names";
import { overlayIconButton } from "./ui";

export interface PortraitBlockParams {
    pack: string;
    seed?: string;
    count: number;
    size: number;
    recipe?: string;
}

/** Pure parse of the block body. Unknown keys ignored; bounds clamped. */
export function parsePortraitParams(
    source: string,
    defaultPack: string
): PortraitBlockParams {
    const p: PortraitBlockParams = { pack: defaultPack, count: 1, size: 256 };
    for (const line of source.split("\n")) {
        const i = line.indexOf(":");
        if (i < 1) continue;
        const key = line.slice(0, i).trim().toLowerCase();
        const val = line.slice(i + 1).trim();
        if (key === "pack" && val !== "") {
            p.pack = val.replace(/^\/+|\/+$/g, "");
        } else if (key === "seed" && val !== "") {
            p.seed = val;
        } else if (key === "count") {
            const n = parseInt(val, 10);
            if (!isNaN(n)) p.count = Math.max(1, Math.min(24, n));
        } else if (key === "size") {
            const n = parseInt(val, 10);
            if (!isNaN(n)) p.size = Math.max(64, Math.min(1024, n));
        } else if (key === "recipe" && val !== "") {
            p.recipe = val;
        }
    }
    return p;
}

/**
 * Build the new locked block body from the current one: keeps explicit
 * pack/size lines (they affect rendering), drops seed/count (the recipe
 * supersedes them), appends the recipe line. Pure — tested directly.
 */
export function lockedBlockBody(source: string, recipe: PortraitRecipe): string {
    const kept: string[] = [];
    for (const line of source.split("\n")) {
        const i = line.indexOf(":");
        if (i < 1) continue;
        const key = line.slice(0, i).trim().toLowerCase();
        if (key === "pack" || key === "size") kept.push(line.trimEnd());
    }
    kept.push(`recipe: ${JSON.stringify(recipe)}`);
    return kept.join("\n");
}

/**
 * Inverse of lockedBlockBody: drop the recipe line, keep pack/size —
 * the block becomes rollable again. Pure — tested directly.
 */
export function unlockedBlockBody(source: string): string {
    const kept: string[] = [];
    for (const line of source.split("\n")) {
        const i = line.indexOf(":");
        if (i < 1) continue;
        const key = line.slice(0, i).trim().toLowerCase();
        if (key !== "recipe") kept.push(line.trimEnd());
    }
    return kept.join("\n");
}

export function buildPortraitProcessor(plugin: RandomnessPlugin) {
    return async function processor(
        source: string,
        el: HTMLElement,
        ctx: MarkdownPostProcessorContext
    ): Promise<void> {
        const child = new PortraitCodeblockChild(el, source, ctx, plugin);
        ctx.addChild(child);
        await child.render();
    };
}

class PortraitCodeblockChild extends MarkdownRenderChild {
    private unloaded = false;

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
        clearElement(this.containerEl);
        this.containerEl.classList.add("randomness-portrait");
        const placeholder = makeChildDiv(this.containerEl, "randomness-loading");
        placeholder.textContent = "Rolling…";

        try {
            await this.runRender();
        } catch (err) {
            if (this.unloaded) return;
            clearElement(this.containerEl);
            const wrap = makeChildDiv(this.containerEl, "randomness-error");
            wrap.textContent =
                "Portrait: render failed — " +
                (err instanceof Error ? err.message : String(err));
        }
    }

    private async runRender(): Promise<void> {
        const params = parsePortraitParams(
            this.source,
            this.plugin.settings.portraitPackPath
        );

        // Gate: no pack, no UI — point at settings instead.
        if (!(await this.plugin.portraits.available(params.pack))) {
            if (this.unloaded) return;
            clearElement(this.containerEl);
            const hint = makeChildDiv(this.containerEl, "randomness-portrait-hint");
            hint.textContent =
                params.pack === ""
                    ? "Portraits need a pack: set a pack folder in Settings → Randomness."
                    : `Portrait pack not found at "${params.pack}" — install or configure it in Settings → Randomness.`;
            return;
        }

        const manifest = await this.plugin.portraits.manifest(params.pack);
        const load = this.plugin.portraits.loader(params.pack);

        // Locked block: render exactly the stored recipe, nothing else.
        if (params.recipe !== undefined) {
            let recipe: PortraitRecipe;
            try {
                recipe = JSON.parse(params.recipe) as PortraitRecipe;
            } catch (e) {
                throw new Error(
                    "bad recipe JSON: " +
                        (e instanceof Error ? e.message : String(e))
                );
            }
            const composed = await composeFromRecipe(recipe, manifest, load);
            if (this.unloaded) return;
            clearElement(this.containerEl);
            const grid = makeChildDiv(this.containerEl, "randomness-portrait-grid");
            this.renderTile(grid, composed, params, true, manifest);
            return;
        }

        // Unlocked: roll `count` portraits.
        const composedAll: Composed[] = [];
        for (let i = 0; i < params.count; i++) {
            const seed =
                params.seed !== undefined
                    ? params.count > 1
                        ? `${params.seed}#${i}`
                        : params.seed
                    : undefined;
            composedAll.push(await composePack(manifest, load, seed));
        }
        if (this.unloaded) return;
        clearElement(this.containerEl);

        const bar = makeChildDiv(this.containerEl, "randomness-portrait-bar");
        const reroll = activeDocument.createElement("button");
        reroll.textContent = "⟳ Reroll";
        reroll.disabled = params.seed !== undefined;
        reroll.title =
            params.seed !== undefined
                ? "Block has a fixed seed — edit or remove the seed line to reroll"
                : "Roll new portraits";
        reroll.addEventListener("click", () => void this.render());
        bar.appendChild(reroll);

        const grid = makeChildDiv(this.containerEl, "randomness-portrait-grid");
        for (const composed of composedAll) {
            this.renderTile(grid, composed, params, false, manifest);
        }
    }

    private renderTile(
        grid: HTMLElement,
        composed: Composed,
        params: PortraitBlockParams,
        locked: boolean,
        manifestRaw: unknown
    ): void {
        const tile = makeChildDiv(grid, "randomness-portrait-tile");
        const art = makeChildDiv(tile, "randomness-portrait-art");
        art.style.width = `${params.size}px`;
        // The svg is built locally by the compositor from pack data —
        // same trust level as the pack itself (user-installed files).
        if (composed.svg.startsWith("<svg")) art.innerHTML = composed.svg;

        // PNG icon, top-left: save next to the note and replace this
        // block with the ![[embed]].
        overlayIconButton(
            art,
            "image-down",
            "Save as PNG next to the note and replace this block with the image embed",
            "top-left",
            () => void this.savePngAndReplace(composed, locked)
        );

        // Lock/unlock icon, top-right. Shows the ACTION: closed lock
        // on rollable tiles ("freeze this one"), open lock on a locked
        // tile ("roll again").
        overlayIconButton(
            art,
            locked ? "unlock" : "lock",
            locked
                ? "Unlock: remove the stored recipe and roll again"
                : "Lock: set in stone — store this exact portrait's recipe in the block",
            "top-right",
            () => {
                void (locked
                    ? this.rewriteBody(
                          unlockedBlockBody(this.source),
                          "Portrait unlocked."
                      )
                    : this.rewriteBody(
                          lockedBlockBody(this.source, composed.recipe),
                          "Portrait locked."
                      ));
            }
        );

        // Caption: a race/gender-appropriate name rolled through the
        // Randomness engine, deterministic per seed. Seed in tooltip.
        const caption = makeChildDiv(tile, "randomness-portrait-caption");
        let label = locked ? "locked" : composed.seed;
        try {
            label = nameFor(composed.recipe, manifestRaw);
        } catch {
            // names must never break rendering — keep the fallback
        }
        caption.textContent = label;
        caption.title = `seed: ${composed.seed}` + (locked ? " (locked)" : "");
    }

    /**
     * Rewrite this block's BODY (fence lines kept). Used by lock and
     * unlock. Uses section info + vault.process for an atomic
     * read-modify-write; bails with a Notice if the note shifted.
     */
    private async rewriteBody(newBody: string, notice: string): Promise<void> {
        const replaced = await this.withBlockLines((lines, start, end) => {
            const body = newBody === "" ? [] : newBody.split("\n");
            lines.splice(start + 1, end - start - 1, ...body);
            return lines;
        });
        if (replaced) new Notice(notice);
    }

    /**
     * Save the PNG next to the note, then replace the WHOLE block with
     * an ![[embed]]. A locked block's recipe is preserved in an
     * invisible %% comment %% after the embed so the portrait can be
     * reconstructed later if wanted.
     */
    private async savePngAndReplace(
        composed: Composed,
        locked: boolean
    ): Promise<void> {
        try {
            const path = await saveComposedPng(
                this.plugin,
                composed,
                dirOf(this.ctx.sourcePath)
            );
            const name = path.split("/").pop() ?? path;
            const replacement = [`![[${name}]]`];
            if (locked) {
                replacement.push(
                    `%% portrait recipe: ${JSON.stringify(composed.recipe)} %%`
                );
            }
            const replaced = await this.withBlockLines((lines, start, end) => {
                lines.splice(start, end - start + 1, ...replacement);
                return lines;
            });
            new Notice(
                replaced
                    ? `Portrait saved + embedded: ${name}`
                    : `Portrait saved: ${path} (block not replaced — note changed)`
            );
        } catch (err) {
            new Notice(
                "Portrait: PNG export failed — " +
                    (err instanceof Error ? err.message : String(err))
            );
        }
    }

    /**
     * Shared block-edit plumbing: locate this block via section info,
     * verify the fence still opens a ```portrait block, hand the note's
     * lines to `edit` (start/end are the fence lines, inclusive), write
     * back atomically. Returns false (plus a Notice) when the block
     * can't be safely located.
     */
    private async withBlockLines(
        edit: (lines: string[], start: number, end: number) => string[]
    ): Promise<boolean> {
        const info = this.ctx.getSectionInfo(this.containerEl);
        const af = this.plugin.app.vault.getAbstractFileByPath(
            this.ctx.sourcePath
        );
        if (!info || !(af instanceof TFile)) {
            new Notice("Portrait: couldn't locate this block in the note.");
            return false;
        }
        let ok = true;
        await this.plugin.app.vault.process(af, (data) => {
            const lines = data.split("\n");
            const fence = lines[info.lineStart];
            if (fence === undefined || !/^\s*```+\s*portrait\b/.test(fence)) {
                ok = false;
                return data;
            }
            return edit(lines, info.lineStart, info.lineEnd).join("\n");
        });
        if (!ok) {
            new Notice("Portrait: note changed — action skipped, reroll first.");
        }
        return ok;
    }
}

// Tiny DOM helpers — same conventions as codeblockProcessor.ts.

function clearElement(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function makeChildDiv(parent: HTMLElement, className?: string): HTMLDivElement {
    const div = activeDocument.createElement("div");
    if (className) div.className = className;
    parent.appendChild(div);
    return div;
}

function dirOf(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const i = norm.lastIndexOf("/");
    if (i === -1) return "";
    if (i === 0) return "/";
    return norm.slice(0, i);
}
