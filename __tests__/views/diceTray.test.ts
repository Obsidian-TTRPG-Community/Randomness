/**
 * @jest-environment jsdom
 */

/**
 * Tests for the dice tray (merge Phase 5) — the pure pool-to-formula
 * logic plus a smoke test that the view builds its DOM.
 */

import {
    trayFormula,
    emptyTrayState,
    TrayState,
    renderDiceTrayTab,
} from "../../src/views/diceTrayView";

describe("trayFormula", () => {
    const state = (over: Partial<TrayState>): TrayState => ({
        ...emptyTrayState(),
        ...over,
    });

    test("empty pool is an empty formula", () => {
        expect(trayFormula(emptyTrayState())).toBe("");
    });

    test("pools combine in die order with the modifier last", () => {
        expect(trayFormula(state({ counts: { d6: 3 } }))).toBe("3d6");
        expect(
            trayFormula(state({ counts: { d20: 1, d6: 2 }, modifier: 5 }))
        ).toBe("2d6 + 1d20 + 5");
        expect(
            trayFormula(state({ counts: { d8: 1 }, modifier: -2 }))
        ).toBe("1d8 - 2");
    });

    test("advantage/disadvantage rewrites each d20 as a paired roll", () => {
        expect(
            trayFormula(state({ counts: { d20: 1 }, adv: "adv" }))
        ).toBe("2d20kh");
        expect(
            trayFormula(state({ counts: { d20: 2 }, adv: "dis" }))
        ).toBe("2d20kl + 2d20kl");
        // Other dice unaffected.
        expect(
            trayFormula(state({ counts: { d20: 1, d6: 1 }, adv: "adv" }))
        ).toBe("1d6 + 2d20kh");
    });

    test("zero-count entries are skipped", () => {
        expect(trayFormula(state({ counts: { d6: 0, d8: 1 } }))).toBe("1d8");
    });

    test("modifier alone (no dice) stays empty", () => {
        expect(trayFormula(state({ modifier: 3 }))).toBe("");
    });
});

describe("dice tray panel smoke", () => {
    test("renderDiceTrayTab builds the tray DOM", () => {
        const plugin = {
            settings: { diceFormulas: { sneak: "4d6dl1" }, graphicalDice: false },
            saveSettings: async () => undefined,
            app: { workspace: { getActiveFile: () => null } },
        } as never;
        const root = document.createElement("div");
        document.body.appendChild(root);
        renderDiceTrayTab(plugin, root);
        expect(root.querySelectorAll(".randomness-tray-die")).toHaveLength(7);
        expect(root.querySelector(".randomness-tray-result")).not.toBeNull();
        expect(root.querySelector(".randomness-tray-input")).not.toBeNull();
        // Saved formulas from settings render.
        expect(
            root.querySelector(".randomness-tray-saved-roll")?.textContent
        ).toBe("sneak");
    });
});
