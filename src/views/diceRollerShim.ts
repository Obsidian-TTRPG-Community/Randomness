/**
 * Dice Roller `window.DiceRoller` API shim.
 *
 * Fantasy Statblocks (and other Dice Roller consumers) integrate
 * through a global API object, not the plugin registry:
 *
 *   - the *presence* of `window.DiceRoller` gates all dice features;
 *   - `registerSource(id, options)` stores per-consumer display
 *     options;
 *   - `getRollerString(str, id)` appends the matching display flags
 *     (`|render`, `|noform`, `|avg`, …) to a formula, which the
 *     consumer then renders as a `dice: …` code span through
 *     MarkdownRenderer — so the actual rolling happens in the inline
 *     post-processor (ours, when compat is on), not the API;
 *   - the `dice-roller:loaded` workspace event tells consumers that
 *     the API appeared after their own onload.
 *
 * The shim therefore has three jobs: exist, mirror Dice Roller's
 * flag-appending exactly, and offer a best-effort roller object for
 * consumers that roll through the API directly. It is installed only
 * when the standalone Dice Roller plugin is not enabled (the real
 * plugin overwrites the global if it loads later, and we never
 * clobber an existing one).
 */

import { setIcon } from "obsidian";
import type RandomnessPlugin from "./main";
import { diceCompatEnabled, isDiceRollerPluginEnabled } from "./settings";
import { translateDiceExpression } from "../compat/diceCompat";
import {
    parsePureDiceFormula,
    rollPureDiceFormula,
    PureDiceTerm,
} from "../render3d/diceOverlay";

declare global {
    interface Window {
        DiceRoller?: unknown;
    }
}

/**
 * The option bag consumers pass to registerSource. Key names and
 * string values mirror Dice Roller's RollerOptions / enums
 * (ExpectedValue "Average"/"None"/"Roll", Round "None"/"Normal"/
 * "Up"/"Down", ButtonPosition "LEFT"/"RIGHT"/"NONE").
 */
export interface ShimSourceOptions {
    position?: string;
    shouldRender?: boolean;
    showFormula?: boolean;
    expectedValue?: string;
    round?: string;
    text?: string | null;
    showParens?: boolean;
    signed?: boolean;
    [key: string]: unknown;
}

/**
 * A minimal stand-in for Dice Roller's StackRoller, for API consumers
 * that roll directly. Backed by the Randomness dice core; supports
 * plain dice sums with modifiers (what such consumers pass —
 * `1d20 + 7`, `2d6kh1`), not tables or tags.
 */
export class ShimStackRoller {
    result = 0;
    /**
     * Mirrors StackRoller.isStatic: true when the formula contains no
     * dice (a flat number). Consumers branch on it — Initiative
     * Tracker renders static encounter counts as plain text and
     * dice-rolled ones through `containerEl`.
     */
    isStatic: boolean;
    #terms: PureDiceTerm[];
    #listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    #el: HTMLElement | null = null;

    constructor(terms: PureDiceTerm[], public original: string) {
        this.#terms = terms;
        this.isStatic = terms.every((t) => t.sides === null);
    }

    /**
     * Mirrors StackRoller.containerEl: the latest result plus a small
     * die icon; clicking re-rolls. Initiative Tracker appends this
     * element for `encounter:` counts like `1d6: [[Monster]]`. Built
     * lazily so headless consumers never touch the DOM.
     */
    get containerEl(): HTMLElement {
        if (this.#el === null) {
            const el = activeDocument.createElement("span");
            el.className = "dice-roller randomness-shim-roller";
            el.setAttribute(
                "aria-label",
                `${this.original} — click to re-roll`
            );
            el.title = `${this.original} — click to re-roll`;
            const value = activeDocument.createElement("span");
            value.className = "randomness-shim-roller-value";
            el.appendChild(value);
            const die = activeDocument.createElement("span");
            die.className = "randomness-shim-roller-die";
            try {
                setIcon(die, "dices");
            } catch {
                die.textContent = "🎲";
            }
            el.appendChild(die);
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                this.rollSync();
            });
            this.#el = el;
            this.#valueEl = value;
            this.#paint();
        }
        return this.#el;
    }

    #valueEl: HTMLElement | null = null;

    #paint(): void {
        if (this.#valueEl !== null) {
            this.#valueEl.textContent = String(this.result);
        }
    }

    rollSync(): number {
        const { total } = rollPureDiceFormula(this.#terms);
        this.result = total;
        this.#paint();
        for (const cb of this.#listeners.get("new-result") ?? []) {
            try {
                cb(this);
            } catch {
                /* listener errors are the listener's problem */
            }
        }
        return total;
    }

    roll(): Promise<number> {
        return Promise.resolve(this.rollSync());
    }

    on(event: string, callback: (...args: unknown[]) => void): void {
        let set = this.#listeners.get(event);
        if (!set) {
            set = new Set();
            this.#listeners.set(event, set);
        }
        set.add(callback);
    }

    off(event: string, callback: (...args: unknown[]) => void): void {
        this.#listeners.get(event)?.delete(callback);
    }
}

export class DiceRollerApiShim {
    sources = new Map<string, ShimSourceOptions>();

    registerSource(source: string, options: ShimSourceOptions): void {
        this.sources.set(source, options);
    }

    /**
     * Append the display flags a registered source asked for —
     * byte-for-byte what Dice Roller's getRollerString produces, so
     * consumers' spans parse identically under either plugin.
     */
    getRollerString(roll: string, source?: string): string {
        if (!source) return roll;
        const options = this.sources.get(source);
        if (!options) return roll;
        if ("position" in options) {
            roll += options.position !== "NONE" ? "" : "|nodice";
        }
        if ("shouldRender" in options) {
            roll += options.shouldRender ? "|render" : "|norender";
        }
        if ("showFormula" in options) {
            roll += options.showFormula ? "|form" : "|noform";
        }
        if ("expectedValue" in options) {
            if (options.expectedValue === "Average") roll += "|avg";
            if (options.expectedValue === "None") roll += "|none";
        }
        if ("text" in options && options.text) {
            roll += "|text(" + options.text + ")";
        }
        if ("showParens" in options) {
            roll += options.showParens ? "|paren" : "|noparen";
        }
        if ("round" in options) {
            switch (options.round) {
                case "Down":
                    roll += "|floor";
                    break;
                case "Up":
                    roll += "|ceil";
                    break;
                case "Normal":
                    roll += "|round";
                    break;
                case "None":
                    roll += "|noround";
            }
        }
        if (options.signed) {
            roll += "|signed";
        }
        return roll;
    }

    /**
     * Best-effort roller. Returns null (like Dice Roller does on a
     * lexer error) for anything beyond plain dice sums.
     */
    getRollerSync(raw: string, _source?: string): ShimStackRoller | null {
        try {
            // The translator wraps formulas in rdm expression braces
            // ({2d6+3}); the pure-dice parser wants the bare sum.
            const { expr } = translateDiceExpression(raw);
            const bare =
                expr.startsWith("{") && expr.endsWith("}")
                    ? expr.slice(1, -1)
                    : expr;
            const terms = parsePureDiceFormula(bare);
            if (!terms) return null;
            return new ShimStackRoller(terms, raw);
        } catch {
            return null;
        }
    }

    getRoller(raw: string, source?: string): ShimStackRoller | null {
        return this.getRollerSync(raw, source);
    }

    async parseDice(
        content: string,
        source = ""
    ): Promise<{ result: number | null; roller: ShimStackRoller | null }> {
        const roller = this.getRollerSync(content, source);
        return { result: roller ? await roller.roll() : null, roller };
    }
}

/**
 * Install the shim if the coast is clear: compat on, standalone Dice
 * Roller not enabled, nothing already occupying the global. Fires
 * `dice-roller:loaded` so consumers that loaded first re-register.
 * Safe to call repeatedly — the settings toggle and the live
 * takeover below both re-attempt through here.
 */
export function tryInstallDiceRollerShim(plugin: RandomnessPlugin): void {
    if (!diceCompatEnabled(plugin)) return;
    if (isDiceRollerPluginEnabled(plugin.app)) return;
    if (window.DiceRoller != null) return;
    const shim = new DiceRollerApiShim();
    window.DiceRoller = shim;
    plugin.register(() => {
        if (window.DiceRoller === shim) delete window.DiceRoller;
    });
    plugin.app.workspace.trigger("dice-roller:loaded");
}

/**
 * One-time wiring (plugin onload): install if possible now, and take
 * over LIVE when the standalone Dice Roller plugin is disabled later
 * — it fires `dice-roller:unloaded` on unload. Without this, users
 * who flip Dice Roller off mid-session lose `window.DiceRoller`
 * until the next app restart, and consumers quietly degrade
 * (Initiative Tracker parses `1d6: [[Monster]]` counts as a flat 1).
 * The timeout lets Dice Roller finish deleting its global first.
 */
export function installDiceRollerShim(plugin: RandomnessPlugin): void {
    tryInstallDiceRollerShim(plugin);
    try {
        plugin.registerEvent(
            (plugin.app.workspace as unknown as {
                on(name: string, cb: () => void): import("obsidian").EventRef;
            }).on("dice-roller:unloaded", () => {
                window.setTimeout(() => tryInstallDiceRollerShim(plugin), 100);
            })
        );
    } catch {
        // Partial plugin fixtures (tests, embedders) may lack the
        // workspace event surface; the startup install still ran.
    }
}
