/**
 * Dice tray — Dice Roller merge, Phase 5 (re-homed).
 *
 * Originally a standalone right-sidebar view; now a **tab inside the
 * Randomness browser pane** (Generators | Portraits | Builder | Dice),
 * so the plugin keeps a single sidebar presence and a single ribbon
 * icon. This module exports the panel renderer the browser view calls
 * on first activation, plus the pure pool-to-formula logic.
 *
 * Panel contents, top to bottom:
 *   - **Result panel** — the latest roll, big; click to copy.
 *   - **Die buttons** — d4…d100. Click adds a die; right-click removes.
 *   - **Advantage / disadvantage** — each pooled d20 → `2d20kh`/`2d20kl`.
 *   - **Modifier stepper**, **Roll / Clear**.
 *   - **Formula box** — full Dice Roller syntax (modifiers, `[[Note^id]]`,
 *     `#tag`, aliases), scoped to the active note.
 *   - **Saved formulas** — shared with the "Dice formula aliases"
 *     setting, so tray-saved formulas also roll as `dice: <name>`.
 *   - **History** — last twenty rolls, click to re-roll.
 */

import { Modal, Notice } from "obsidian";
import type RandomnessPlugin from "./main";
import { evaluateInlineExpression } from "./inlineProcessor";
import { translateDiceExpression } from "../compat/diceCompat";
import {
    parsePureDiceFormula,
    rollPureDiceFormula,
    showDiceOverlay,
} from "../render3d/diceOverlay";

// ────────────────────────────────────────────────────────────────────
// Pure tray state → formula (exported for tests)
// ────────────────────────────────────────────────────────────────────

export const TRAY_DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"] as const;
export type TrayDie = (typeof TRAY_DICE)[number];

export interface TrayState {
    counts: Partial<Record<TrayDie, number>>;
    modifier: number;
    adv: "none" | "adv" | "dis";
}

export function emptyTrayState(): TrayState {
    return { counts: {}, modifier: 0, adv: "none" };
}

/**
 * Serialise the button-built pool into a Dice Roller formula.
 * Advantage/disadvantage turns each pooled d20 into `2d20kh`/`2d20kl`
 * (the standard 5e reading); other dice are unaffected.
 */
export function trayFormula(state: TrayState): string {
    const parts: string[] = [];
    for (const die of TRAY_DICE) {
        const n = state.counts[die] ?? 0;
        if (n <= 0) continue;
        if (die === "d20" && state.adv !== "none") {
            const mod = state.adv === "adv" ? "kh" : "kl";
            for (let i = 0; i < n; i++) parts.push(`2d20${mod}`);
        } else {
            parts.push(`${n}${die}`);
        }
    }
    let formula = parts.join(" + ");
    if (state.modifier !== 0 && formula !== "") {
        formula +=
            state.modifier > 0
                ? ` + ${state.modifier}`
                : ` - ${-state.modifier}`;
    }
    return formula;
}

interface HistoryEntry {
    formula: string;
    result: string;
}

const HISTORY_CAP = 20;

// ────────────────────────────────────────────────────────────────────
// The panel
// ────────────────────────────────────────────────────────────────────

/**
 * Render the dice tray into `container`. Called by the browser view
 * when the Dice tab first activates; state lives for the lifetime of
 * the rendered panel.
 */
export function renderDiceTrayTab(
    plugin: RandomnessPlugin,
    container: HTMLElement
): void {
    let state = emptyTrayState();
    const history: HistoryEntry[] = [];

    container.classList.add("randomness-tray");

    // Result panel
    const resultEl = el(container, "div", "randomness-tray-result");
    resultEl.setAttribute("title", "Click to copy");
    resultEl.textContent = "—";
    resultEl.addEventListener("click", () => {
        const text = resultEl.textContent ?? "";
        if (text !== "" && text !== "—") {
            void navigator.clipboard?.writeText(text);
            new Notice("Randomness: result copied");
        }
    });

    // Die buttons
    const diceRow = el(container, "div", "randomness-tray-dice");
    for (const die of TRAY_DICE) {
        const btn = el(diceRow, "button", "randomness-tray-die");
        btn.textContent = die;
        btn.setAttribute("title", `Add one ${die} (right-click removes one)`);
        btn.addEventListener("click", () => {
            state.counts[die] = (state.counts[die] ?? 0) + 1;
            renderPool();
        });
        btn.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            const n = state.counts[die] ?? 0;
            if (n > 0) state.counts[die] = n - 1;
            renderPool();
        });
    }

    // Advantage / modifier row
    const optsRow = el(container, "div", "randomness-tray-opts");
    const advBtn = el(optsRow, "button", "randomness-tray-adv");
    const advLabel = () =>
        state.adv === "none"
            ? "adv: off"
            : state.adv === "adv"
              ? "advantage"
              : "disadvantage";
    advBtn.textContent = advLabel();
    advBtn.setAttribute("title", "d20s roll twice: keep highest / lowest");
    advBtn.addEventListener("click", () => {
        state.adv =
            state.adv === "none" ? "adv" : state.adv === "adv" ? "dis" : "none";
        advBtn.textContent = advLabel();
        renderPool();
    });
    const minus = el(optsRow, "button", "randomness-tray-mod");
    minus.textContent = "−";
    const modValue = el(optsRow, "span", "randomness-tray-mod-value");
    modValue.textContent = "+0";
    const plus = el(optsRow, "button", "randomness-tray-mod");
    plus.textContent = "+";
    const bumpMod = (d: number) => {
        state.modifier += d;
        modValue.textContent =
            state.modifier >= 0 ? `+${state.modifier}` : `${state.modifier}`;
        renderPool();
    };
    minus.addEventListener("click", () => bumpMod(-1));
    plus.addEventListener("click", () => bumpMod(+1));

    // Pool display + roll/clear
    const poolEl = el(container, "div", "randomness-tray-pool");
    const actions = el(container, "div", "randomness-tray-actions");
    const rollBtn = el(actions, "button", "randomness-tray-roll");
    rollBtn.textContent = "Roll";
    rollBtn.classList.add("mod-cta");
    rollBtn.addEventListener("click", () => void rollPool());
    const clearBtn = el(actions, "button", "randomness-tray-clear");
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
        state = emptyTrayState();
        modValue.textContent = "+0";
        advBtn.textContent = advLabel();
        renderPool();
    });

    // Formula box
    const formulaRow = el(container, "div", "randomness-tray-formula");
    const formulaInput = el(
        formulaRow,
        "input",
        "randomness-tray-input"
    ) as HTMLInputElement;
    formulaInput.type = "text";
    formulaInput.placeholder = "1d20+5, 4d6dl1, [[Note^loot]], #tag…";
    formulaInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void roll(formulaInput.value);
    });
    const goBtn = el(formulaRow, "button", "randomness-tray-go");
    goBtn.textContent = "Roll";
    goBtn.addEventListener("click", () => void roll(formulaInput.value));
    const saveBtn = el(formulaRow, "button", "randomness-tray-save");
    saveBtn.textContent = "★";
    saveBtn.setAttribute(
        "title",
        "Save this formula (also usable as a dice: alias)"
    );
    saveBtn.addEventListener("click", () => void saveFormula());

    // Saved formulas + history
    const savedEl = el(container, "div", "randomness-tray-saved");
    const historyEl = el(container, "div", "randomness-tray-history");
    renderSaved();
    renderPool();

    // ── behaviour ──

    async function roll(formula: string): Promise<void> {
        const source = formula.trim();
        if (source === "") return;
        let result: string;
        try {
            if (plugin.settings.graphicalDice) {
                const terms = parsePureDiceFormula(source);
                if (terms !== null) {
                    const rolled = rollPureDiceFormula(terms);
                    await showDiceOverlay(rolled.dice, rolled.total);
                    finishRoll(source, String(rolled.total));
                    return;
                }
            }
            const translated = translateDiceExpression(
                source,
                plugin.settings.diceFormulas
            ).expr;
            result = await evaluateInlineExpression(
                translated,
                plugin.app.workspace.getActiveFile()?.path ?? "",
                plugin
            );
        } catch (err) {
            result = `⚠ ${err instanceof Error ? err.message : String(err)}`;
        }
        finishRoll(source, result);
    }

    async function rollPool(): Promise<void> {
        const formula = trayFormula(state);
        if (formula === "") {
            new Notice("Randomness: tap some dice first");
            return;
        }
        await roll(formula);
    }

    async function saveFormula(): Promise<void> {
        const formula = formulaInput.value.trim() || trayFormula(state);
        if (formula === "") {
            new Notice("Randomness: nothing to save");
            return;
        }
        // A Modal, not window.prompt — Electron blocks prompt() outright.
        new SaveFormulaModal(plugin, formula, async (name) => {
            plugin.settings.diceFormulas[name] = formula;
            await plugin.saveSettings();
            renderSaved();
            new Notice(`Randomness: saved '${name}'`);
        }).open();
    }

    function finishRoll(formula: string, result: string): void {
        resultEl.textContent = result;
        history.unshift({ formula, result });
        if (history.length > HISTORY_CAP) history.pop();
        renderHistory();
    }

    // ── rendering ──

    function renderPool(): void {
        const formula = trayFormula(state);
        poolEl.textContent =
            formula === "" ? "· tap dice to build a roll ·" : formula;
        poolEl.classList.toggle("is-empty", formula === "");
    }

    function renderSaved(): void {
        clear(savedEl);
        const entries = Object.entries(plugin.settings.diceFormulas);
        if (entries.length === 0) return;
        const title = el(savedEl, "div", "randomness-tray-heading");
        title.textContent = "Saved";
        for (const [name, formula] of entries) {
            const row = el(savedEl, "div", "randomness-tray-saved-row");
            const btn = el(row, "button", "randomness-tray-saved-roll");
            btn.textContent = name;
            btn.setAttribute("title", formula);
            btn.addEventListener("click", () => void roll(formula));
            const del = el(row, "button", "randomness-tray-saved-del");
            del.textContent = "×";
            del.setAttribute("title", `Forget '${name}'`);
            del.addEventListener("click", async () => {
                delete plugin.settings.diceFormulas[name];
                await plugin.saveSettings();
                renderSaved();
            });
        }
    }

    function renderHistory(): void {
        clear(historyEl);
        if (history.length === 0) return;
        const title = el(historyEl, "div", "randomness-tray-heading");
        title.textContent = "History";
        for (const entry of history) {
            const row = el(historyEl, "div", "randomness-tray-history-row");
            row.setAttribute("title", "Click to re-roll");
            const f = el(row, "span", "randomness-tray-history-formula");
            f.textContent = entry.formula;
            const r = el(row, "span", "randomness-tray-history-result");
            r.textContent = entry.result;
            row.addEventListener("click", () => void roll(entry.formula));
        }
    }
}

/**
 * Names a formula being saved from the tray. The saved name doubles
 * as a `dice: <name>` alias in notes (shared settings store).
 */
class SaveFormulaModal extends Modal {
    constructor(
        plugin: import("./main").default,
        private formula: string,
        private onSubmit: (name: string) => void | Promise<void>
    ) {
        super(plugin.app);
    }

    onOpen(): void {
        this.titleEl?.setText?.("Save formula");
        const body = this.contentEl;
        const hint = el(body, "div", "randomness-tray-save-hint");
        hint.textContent =
            `Name for '${this.formula}' — also rolls inline as ` +
            "dice: <name>.";
        const input = el(
            body,
            "input",
            "randomness-tray-save-input"
        ) as HTMLInputElement;
        input.type = "text";
        input.placeholder = "e.g. sneak";
        const submit = () => {
            const name = input.value.trim();
            if (name === "") return;
            this.close();
            void this.onSubmit(name);
        };
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") submit();
        });
        const row = el(body, "div", "randomness-tray-save-actions");
        const ok = el(row, "button", "randomness-tray-save-ok");
        ok.textContent = "Save";
        ok.classList.add("mod-cta");
        ok.addEventListener("click", submit);
        input.focus?.();
    }

    onClose(): void {
        while (this.contentEl.firstChild) {
            this.contentEl.removeChild(this.contentEl.firstChild);
        }
    }
}

// ── Local DOM helpers ──

function el(parent: HTMLElement, tag: string, className: string): HTMLElement {
    const node = activeDocument.createElement(tag);
    node.className = className;
    parent.appendChild(node);
    return node as HTMLElement;
}

function clear(node: HTMLElement): void {
    while (node.firstChild) node.removeChild(node.firstChild);
}
