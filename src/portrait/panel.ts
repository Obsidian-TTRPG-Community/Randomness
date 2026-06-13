/**
 * Portrait tabs for the generator browser pane: "Portraits" (random
 * roller) and "Builder" (pick every part by hand, live preview).
 *
 * Both are plain render-into-container functions so the browser view
 * can host them as tabs without owning any portrait logic. Both gate
 * on a pack being installed.
 *
 * Tile actions (matching the codeblock conventions):
 *   - PNG icon, top-left: save into Portraits/ and copy ![[name]] to
 *     the clipboard, ready to paste into a note.
 *   - Copy icon, top-right (roller) / button (builder): copy the
 *     recipe JSON for pinning in a ```portrait block or inline span.
 * Captions show a rolled, race/gender-appropriate name (seed in the
 * tooltip) — names come from the engine via names.ts.
 */

import { Notice } from "obsidian";
import type RandomnessPlugin from "../views/main";
import {
    composePack,
    composeFromRecipe,
    normalizeManifest,
    Composed,
    PortraitRecipe,
    Age,
    RawManifest,
} from "./pack";
import { saveComposedPng } from "./png";
import { nameFor } from "./names";
import {
    clearElement,
    makeChildDiv,
    overlayIconButton,
    portraitBlockSnippet,
    portraitInlineSnippet,
    mountSvg,
    setWidthPx,
} from "./ui";

/** Vault folder pane exports land in (created on demand). */
const PANE_PNG_FOLDER = "Portraits";

async function pngToClipboard(
    plugin: RandomnessPlugin,
    composed: Composed
): Promise<void> {
    try {
        const path = await saveComposedPng(plugin, composed, PANE_PNG_FOLDER);
        const name = path.split("/").pop() ?? path;
        const embed = `![[${name}]]`;
        await navigator.clipboard.writeText(embed);
        new Notice(`Saved ${path} — ${embed} copied.`);
    } catch (err) {
        new Notice(
            "Portrait: PNG export failed — " +
                (err instanceof Error ? err.message : String(err))
        );
    }
}

function copyBlock(recipe: PortraitRecipe): void {
    void navigator.clipboard
        .writeText(portraitBlockSnippet(JSON.stringify(recipe)))
        .then(() => new Notice("```portrait block copied — paste into a note."));
}

function copyInline(recipe: PortraitRecipe): void {
    void navigator.clipboard
        .writeText(portraitInlineSnippet(JSON.stringify(recipe)))
        .then(() => new Notice("Inline `portrait:` span copied — paste into a line."));
}

function renderTile(
    plugin: RandomnessPlugin,
    grid: HTMLElement,
    composed: Composed,
    manifestRaw: RawManifest,
    width: number
): void {
    const tile = makeChildDiv(grid, "randomness-portrait-tile");
    const art = makeChildDiv(tile, "randomness-portrait-art");
    setWidthPx(art, width);
    mountSvg(art, composed.svg);

    overlayIconButton(
        art,
        "image-down",
        `Save PNG into ${PANE_PNG_FOLDER}/ and copy ![[name]] to the clipboard`,
        "top-left",
        () => void pngToClipboard(plugin, composed)
    );
    overlayIconButton(
        art,
        "copy",
        "Copy as a ```portrait code-block (locked to this exact portrait)",
        "top-right",
        () => copyBlock(composed.recipe)
    );
    overlayIconButton(
        art,
        "code",
        "Copy as an inline `portrait:` span (for infoboxes)",
        "bottom-right",
        () => copyInline(composed.recipe),
        true
    );

    const caption = makeChildDiv(tile, "randomness-portrait-caption");
    let label = composed.seed;
    try {
        label = nameFor(composed.recipe, manifestRaw);
    } catch {
        // names must never break rendering — fall back to the seed
    }
    caption.textContent = label;
    caption.title = `seed: ${composed.seed}`;
}

/** Shared no-pack gate. Returns true when the tab can proceed. */
async function gate(
    plugin: RandomnessPlugin,
    container: HTMLElement
): Promise<boolean> {
    if (await plugin.portraits.available()) return true;
    clearElement(container);
    const hint = makeChildDiv(container, "randomness-portrait-hint");
    hint.textContent =
        "No portrait pack found — configure or install one in " +
        "Settings → Randomness.";
    return false;
}

// ────────────────────────────────────────────────────────────────────
// Portraits tab — the random roller.
// ────────────────────────────────────────────────────────────────────

export function renderRollerTab(
    plugin: RandomnessPlugin,
    container: HTMLElement
): void {
    clearElement(container);
    container.classList.add("randomness-portrait-pane");

    const controls = makeChildDiv(container, "randomness-portrait-pane-controls");
    const countInput = activeDocument.createElement("input");
    countInput.type = "number";
    countInput.min = "1";
    countInput.max = "24";
    countInput.value = "9";
    countInput.title = "How many portraits per roll";
    controls.appendChild(countInput);
    const rollBtn = activeDocument.createElement("button");
    rollBtn.textContent = "⟳ Roll";
    controls.appendChild(rollBtn);

    const grid = makeChildDiv(container, "randomness-portrait-grid");

    const roll = async (): Promise<void> => {
        rollBtn.disabled = true;
        try {
            if (!(await gate(plugin, container))) return;
            const count = Math.max(
                1,
                Math.min(24, parseInt(countInput.value, 10) || 9)
            );
            countInput.value = String(count);
            clearElement(grid);
            const manifest = await plugin.portraits.manifest();
            const load = plugin.portraits.loader();
            for (let i = 0; i < count; i++) {
                renderTile(
                    plugin,
                    grid,
                    await composePack(manifest, load),
                    manifest,
                    200
                );
            }
        } catch (err) {
            new Notice(
                "Portrait roll failed: " +
                    (err instanceof Error ? err.message : String(err))
            );
        } finally {
            rollBtn.disabled = false;
        }
    };
    rollBtn.addEventListener("click", () => void roll());
    void roll();
}

// ────────────────────────────────────────────────────────────────────
// Builder tab — pick every part, live preview.
// ────────────────────────────────────────────────────────────────────

/** Strip extension + category prefix for a readable option label. */
function optionLabel(cat: string, file: string): string {
    let n = file;
    const slash = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\"));
    if (slash >= 0) n = n.slice(slash + 1);
    n = n.replace(/\.(png|jpe?g|webp|svg)$/i, "");
    if (n.startsWith(cat + "_")) n = n.slice(cat.length + 1);
    return n.replace(/_/g, " ");
}

export function renderBuilderTab(
    plugin: RandomnessPlugin,
    container: HTMLElement,
    initial?: PortraitRecipe
): void {
    clearElement(container);
    container.classList.add("randomness-portrait-pane");

    void (async () => {
        if (!(await gate(plugin, container))) return;
        const manifestRaw = await plugin.portraits.manifest();
        const man = normalizeManifest(manifestRaw);
        const load = plugin.portraits.loader();

        // Start from the given recipe, or a random roll so every
        // control has a sane value.
        let recipe: PortraitRecipe =
            initial ?? (await composePack(manifestRaw, load)).recipe;

        // Roll fresh recipes until one matches the wanted gender —
        // gender is derived from the seed hash, and gendered gating
        // (facial hair) happens at ROLL time, so editing the field in
        // place would leave e.g. a beard on a female portrait. A
        // constrained reroll keeps every roll rule honest. ~2 tries
        // expected; the cap is paranoia, not a real ceiling.
        const rollWithGender = async (
            g: "male" | "female"
        ): Promise<PortraitRecipe> => {
            for (let i = 0; i < 80; i++) {
                const r = (await composePack(manifestRaw, load)).recipe;
                if (r.gender === g) return r;
            }
            return recipe; // statistically unreachable
        };

        clearElement(container);
        const wrap = makeChildDiv(container, "randomness-portrait-builder");
        const left = makeChildDiv(wrap, "randomness-portrait-builder-preview");
        const art = makeChildDiv(left, "randomness-portrait-art");
        setWidthPx(art, 240);
        const caption = makeChildDiv(left, "randomness-portrait-caption");
        const form = makeChildDiv(wrap, "randomness-portrait-builder-form");

        const redraw = async (): Promise<void> => {
            try {
                const composed = await composeFromRecipe(
                    recipe,
                    manifestRaw,
                    load
                );
                mountSvg(art, composed.svg);
                overlayIconButton(
                    art,
                    "image-down",
                    `Save PNG into ${PANE_PNG_FOLDER}/ and copy ![[name]] to the clipboard`,
                    "top-left",
                    () => void pngToClipboard(plugin, composed)
                );
                overlayIconButton(
                    art,
                    "copy",
                    "Copy as a ```portrait code-block (locked to this exact portrait)",
                    "top-right",
                    () => copyBlock(recipe)
                );
                overlayIconButton(
                    art,
                    "code",
                    "Copy as an inline `portrait:` span (for infoboxes)",
                    "bottom-right",
                    () => copyInline(recipe),
                    true
                );
                try {
                    caption.textContent = nameFor(recipe, manifestRaw);
                    caption.title = `seed: ${recipe.seed}`;
                } catch {
                    caption.textContent = recipe.seed;
                }
            } catch (err) {
                clearElement(art);
                art.textContent =
                    "render failed: " +
                    (err instanceof Error ? err.message : String(err));
            }
        };

        const row = (label: string): HTMLElement => {
            const r = makeChildDiv(form, "randomness-portrait-builder-row");
            const l = activeDocument.createElement("label");
            l.textContent = label;
            r.appendChild(l);
            return r;
        };
        const select = (
            parent: HTMLElement,
            options: [string, string][],
            value: string,
            onPick: (v: string) => void
        ): HTMLSelectElement => {
            const s = activeDocument.createElement("select");
            for (const [v, label] of options) {
                const o = activeDocument.createElement("option");
                o.value = v;
                o.textContent = label;
                s.appendChild(o);
            }
            s.value = value;
            s.addEventListener("change", () => {
                onPick(s.value);
                void redraw();
            });
            parent.appendChild(s);
            return s;
        };

        // Axes: gender, age, skin tone. Gender REROLLS (see above)
        // and rebuilds the whole form; age/skin re-render in place.
        const axes = row("gender / age / skin");
        select(
            axes,
            [["male", "male"], ["female", "female"]],
            recipe.gender ?? "male",
            (v) => {
                void (async () => {
                    const rolled = await rollWithGender(
                        v === "female" ? "female" : "male"
                    );
                    renderBuilderTab(plugin, container, rolled);
                })();
            }
        );
        select(
            axes,
            [["young", "young"], ["adult", "adult"], ["old", "old"]],
            recipe.age ?? "adult",
            (v) => {
                recipe.age = v as Age;
            }
        );
        const meta = (manifestRaw as { meta?: { skin?: { names?: string[]; tones?: unknown[] } } }).meta;
        const skinNames: string[] =
            meta?.skin?.names ??
            ["porcelain", "fair", "olive", "tan", "brown", "deep"];
        select(
            axes,
            skinNames.map((n, i) => [String(i), n] as [string, string]),
            String(recipe.skin ?? 0),
            (v) => {
                recipe.skin = parseInt(v, 10);
            }
        );

        // One select per category, in layer order.
        const order = (man.suggestedOrder ?? Object.keys(man.layers)).filter(
            (c) => man.layers[c] && man.layers[c].length > 0
        );
        for (const cat of order) {
            const r = row(cat.replace(/_/g, " "));
            const files = man.layers[cat];
            const opts: [string, string][] = [["-1", "— none —"]];
            files.forEach((f, i) =>
                opts.push([String(i), optionLabel(cat, f)])
            );
            select(r, opts, String(recipe.parts[cat] ?? -1), (v) => {
                recipe.parts[cat] = parseInt(v, 10);
            });
        }

        // Footer actions.
        const footer = makeChildDiv(form, "randomness-portrait-builder-row");
        const rerollBtn = activeDocument.createElement("button");
        rerollBtn.textContent = "⟳ Random";
        rerollBtn.title = "Replace everything with a fresh random roll";
        rerollBtn.addEventListener("click", () => {
            void (async () => {
                const rolled = (await composePack(manifestRaw, load)).recipe;
                renderBuilderTab(plugin, container, rolled);
            })();
        });
        footer.appendChild(rerollBtn);

        await redraw();
    })();
}
