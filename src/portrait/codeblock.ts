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
 * Unlocked blocks render a grid with a Reroll control; each tile offers
 * Lock (rewrites this block's body to `recipe: {…}` — the set-in-stone
 * state, drift-proof via composeFromRecipe) and PNG (rasterises the
 * portrait and saves it next to the note).
 *
 * Gating: if no pack manifest is found at the resolved pack path the
 * block renders a pointer to Settings → Randomness instead of UI.
 */

import {
    MarkdownPostProcessorContext,
    MarkdownRenderChild,
    Notice,
    TFile,
    normalizePath,
} from "obsidian";
import type RandomnessPlugin from "../views/main";
import { composePack, composeFromRecipe, Composed, PortraitRecipe } from "./pack";

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
            this.renderTile(grid, composed, params, true);
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
            this.renderTile(grid, composed, params, false);
        }
    }

    private renderTile(
        grid: HTMLElement,
        composed: Composed,
        params: PortraitBlockParams,
        locked: boolean
    ): void {
        const tile = makeChildDiv(grid, "randomness-portrait-tile");
        const art = makeChildDiv(tile, "randomness-portrait-art");
        art.style.width = `${params.size}px`;
        // The svg is built locally by the compositor from pack data —
        // same trust level as the pack itself (user-installed files).
        if (composed.svg.startsWith("<svg")) art.innerHTML = composed.svg;

        const caption = makeChildDiv(tile, "randomness-portrait-caption");
        caption.textContent = locked ? "locked" : composed.seed;

        const actions = makeChildDiv(tile, "randomness-portrait-actions");
        if (!locked) {
            const lockBtn = activeDocument.createElement("button");
            lockBtn.textContent = "Lock";
            lockBtn.title =
                "Set in stone: store this exact portrait's recipe in the block";
            lockBtn.addEventListener("click", () => {
                void this.lockBlock(composed.recipe);
            });
            actions.appendChild(lockBtn);
        }
        const pngBtn = activeDocument.createElement("button");
        pngBtn.textContent = "PNG";
        pngBtn.title = "Save this portrait as a PNG next to the note";
        pngBtn.addEventListener("click", () => {
            void this.savePng(composed);
        });
        actions.appendChild(pngBtn);
    }

    /**
     * Rewrite this block's body to the locked form. Uses the section
     * info to find the fenced block in the note and vault.process for
     * an atomic read-modify-write. If the note changed underneath us
     * (section info stale), we bail with a Notice rather than guess.
     */
    private async lockBlock(recipe: PortraitRecipe): Promise<void> {
        const info = this.ctx.getSectionInfo(this.containerEl);
        const af = this.plugin.app.vault.getAbstractFileByPath(
            this.ctx.sourcePath
        );
        if (!info || !(af instanceof TFile)) {
            new Notice("Portrait: couldn't locate this block in the note.");
            return;
        }
        const newBody = lockedBlockBody(this.source, recipe);
        await this.plugin.app.vault.process(af, (data) => {
            const lines = data.split("\n");
            // Fence sanity: the recorded start line must still open a
            // ```portrait fence. Otherwise the note shifted — bail.
            const fence = lines[info.lineStart];
            if (fence === undefined || !/^\s*```+\s*portrait\b/.test(fence)) {
                new Notice("Portrait: note changed — lock skipped, reroll first.");
                return data;
            }
            lines.splice(
                info.lineStart + 1,
                info.lineEnd - info.lineStart - 1,
                ...newBody.split("\n")
            );
            return lines.join("\n");
        });
        new Notice("Portrait locked.");
    }

    /** Rasterise the composed SVG and save it next to the note. */
    private async savePng(composed: Composed): Promise<void> {
        try {
            const vb = /viewBox="([^"]+)"/.exec(composed.svg);
            const dims = vb ? vb[1].split(/\s+/).map(Number) : [0, 0, 1024, 1024];
            const w = dims[2] || 1024;
            const h = dims[3] || 1024;
            const img = new Image();
            const loadedPromise = new Promise<void>((res, rej) => {
                img.onload = () => res();
                img.onerror = () => rej(new Error("svg rasterise failed"));
            });
            img.src =
                "data:image/svg+xml;charset=utf-8," +
                encodeURIComponent(composed.svg);
            await loadedPromise;
            const canvas = activeDocument.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const cx = canvas.getContext("2d");
            if (!cx) throw new Error("no canvas context");
            cx.drawImage(img, 0, 0, w, h);
            const blob = await new Promise<Blob>((res, rej) =>
                canvas.toBlob(
                    (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
                    "image/png"
                )
            );
            const dir = dirOf(this.ctx.sourcePath);
            const stem = `portrait-${composed.seed || "locked"}`;
            let path = normalizePath(dir === "" ? `${stem}.png` : `${dir}/${stem}.png`);
            let n = 1;
            while (await this.plugin.app.vault.adapter.exists(path)) {
                path = normalizePath(
                    dir === "" ? `${stem}-${n}.png` : `${dir}/${stem}-${n}.png`
                );
                n++;
            }
            await this.plugin.app.vault.createBinary(
                path,
                await blob.arrayBuffer()
            );
            new Notice(`Portrait saved: ${path}`);
        } catch (err) {
            new Notice(
                "Portrait: PNG export failed — " +
                    (err instanceof Error ? err.message : String(err))
            );
        }
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
