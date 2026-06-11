/**
 * Portrait roller pane — the "window that rolls random NPCs" from the
 * npc-forge harness, rebuilt on the Randomness portrait service.
 *
 * Roll a grid of portraits from the configured pack; per tile:
 *   - PNG: saves into the Portraits/ folder and puts `![[name.png]]`
 *     on the clipboard, ready to paste into any note.
 *   - Recipe: puts the portrait's recipe JSON on the clipboard (paste
 *     into a ```portrait block as `recipe: {…}` to pin it).
 *
 * Gates like everything portrait: no pack found → settings pointer.
 */

import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type RandomnessPlugin from "../views/main";
import { composePack, Composed } from "./pack";
import { saveComposedPng } from "./png";

export const VIEW_TYPE_PORTRAIT = "randomness-portrait-roller";

/** Vault folder pane exports land in (created on demand). */
const PANE_PNG_FOLDER = "Portraits";

export class PortraitView extends ItemView {
    private plugin: RandomnessPlugin;
    private count = 9;

    constructor(leaf: WorkspaceLeaf, plugin: RandomnessPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_PORTRAIT;
    }

    getDisplayText(): string {
        return "Portrait roller";
    }

    getIcon(): string {
        return "dice";
    }

    async onOpen(): Promise<void> {
        this.build();
    }

    private build(): void {
        const root = this.contentEl;
        clearElement(root);
        root.classList.add("randomness-portrait-pane");

        const controls = makeChildDiv(root, "randomness-portrait-pane-controls");

        const countInput = activeDocument.createElement("input");
        countInput.type = "number";
        countInput.min = "1";
        countInput.max = "24";
        countInput.value = String(this.count);
        countInput.title = "How many portraits per roll";
        controls.appendChild(countInput);

        const rollBtn = activeDocument.createElement("button");
        rollBtn.textContent = "⟳ Roll";
        controls.appendChild(rollBtn);

        const status = makeChildDiv(root, "randomness-portrait-hint");
        const grid = makeChildDiv(root, "randomness-portrait-grid");

        const roll = async (): Promise<void> => {
            rollBtn.disabled = true;
            try {
                this.count = Math.max(
                    1,
                    Math.min(24, parseInt(countInput.value, 10) || 9)
                );
                countInput.value = String(this.count);
                clearElement(grid);

                if (!(await this.plugin.portraits.available())) {
                    status.textContent =
                        "No portrait pack found — configure or install one " +
                        "in Settings → Randomness.";
                    return;
                }
                status.textContent = "";

                const manifest = await this.plugin.portraits.manifest();
                const load = this.plugin.portraits.loader();
                for (let i = 0; i < this.count; i++) {
                    let composed: Composed;
                    try {
                        composed = await composePack(manifest, load);
                    } catch (err) {
                        status.textContent =
                            "Roll failed: " +
                            (err instanceof Error ? err.message : String(err));
                        break;
                    }
                    this.renderTile(grid, composed);
                }
            } finally {
                rollBtn.disabled = false;
            }
        };

        rollBtn.addEventListener("click", () => void roll());
        void roll();
    }

    private renderTile(grid: HTMLElement, composed: Composed): void {
        const tile = makeChildDiv(grid, "randomness-portrait-tile");
        const art = makeChildDiv(tile, "randomness-portrait-art");
        art.style.width = "200px";
        if (composed.svg.startsWith("<svg")) art.innerHTML = composed.svg;

        const caption = makeChildDiv(tile, "randomness-portrait-caption");
        caption.textContent = composed.seed;

        const actions = makeChildDiv(tile, "randomness-portrait-actions");

        const pngBtn = activeDocument.createElement("button");
        pngBtn.textContent = "PNG";
        pngBtn.title =
            `Save into ${PANE_PNG_FOLDER}/ and copy ![[name]] to the ` +
            "clipboard — paste straight into a note";
        pngBtn.addEventListener("click", () => {
            void (async () => {
                try {
                    const path = await saveComposedPng(
                        this.plugin,
                        composed,
                        PANE_PNG_FOLDER
                    );
                    const name = path.split("/").pop() ?? path;
                    const embed = `![[${name}]]`;
                    await navigator.clipboard.writeText(embed);
                    new Notice(`Saved ${path} — ${embed} copied.`);
                } catch (err) {
                    new Notice(
                        "Portrait: PNG export failed — " +
                            (err instanceof Error
                                ? err.message
                                : String(err))
                    );
                }
            })();
        });
        actions.appendChild(pngBtn);

        const recipeBtn = activeDocument.createElement("button");
        recipeBtn.textContent = "Recipe";
        recipeBtn.title =
            "Copy this portrait's recipe JSON — paste into a " +
            "```portrait block as `recipe: {…}` to pin it";
        recipeBtn.addEventListener("click", () => {
            void navigator.clipboard
                .writeText(JSON.stringify(composed.recipe))
                .then(() => new Notice("Portrait recipe copied."));
        });
        actions.appendChild(recipeBtn);
    }
}

export async function openPortraitView(
    plugin: RandomnessPlugin
): Promise<void> {
    const { workspace } = plugin.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_PORTRAIT)[0];
    if (!leaf) {
        const right = workspace.getRightLeaf(false);
        if (!right) return;
        await right.setViewState({ type: VIEW_TYPE_PORTRAIT, active: true });
        leaf = right;
    }
    workspace.revealLeaf(leaf);
}

export function registerPortraitView(plugin: RandomnessPlugin): void {
    plugin.registerView(
        VIEW_TYPE_PORTRAIT,
        (leaf) => new PortraitView(leaf, plugin)
    );
    plugin.addRibbonIcon("dice", "Randomness: portrait roller", () => {
        void openPortraitView(plugin);
    });
    plugin.addCommand({
        id: "open-portrait-roller",
        name: "Open portrait roller",
        callback: () => void openPortraitView(plugin),
    });
}

// Tiny DOM helpers — same conventions as the codeblock module.

function clearElement(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function makeChildDiv(parent: HTMLElement, className?: string): HTMLDivElement {
    const div = activeDocument.createElement("div");
    if (className) div.className = className;
    parent.appendChild(div);
    return div;
}
