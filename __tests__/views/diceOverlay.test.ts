/**
 * @jest-environment jsdom
 */

/**
 * Tests for the graphical dice module (merge Phase 6) — pure formula
 * parsing/rolling plus an overlay DOM smoke test.
 */

import {
    parsePureDiceFormula,
    rollPureDiceFormula,
    showDiceOverlay,
} from "../../src/render3d/diceOverlay";
import { RNG } from "../../src/engine/rng";

describe("parsePureDiceFormula", () => {
    test("plain sums of dice and constants parse", () => {
        expect(parsePureDiceFormula("1d20")).toHaveLength(1);
        expect(parsePureDiceFormula("2d6 + 1d20 + 5")).toHaveLength(3);
        expect(parsePureDiceFormula("d20")).toHaveLength(1); // bare d
        expect(parsePureDiceFormula("4d6dl1")).toHaveLength(1); // modifiers ok
        expect(parsePureDiceFormula("2d20kh - 2")).toHaveLength(2);
    });

    test("anything fancier is rejected (falls back to plain roll)", () => {
        expect(parsePureDiceFormula("[[Note^loot]]")).toBeNull();
        expect(parsePureDiceFormula("#tag")).toBeNull();
        expect(parsePureDiceFormula("(1d6+2)*3")).toBeNull();
        expect(parsePureDiceFormula("1d6*2")).toBeNull();
        expect(parsePureDiceFormula("1d7")).toBeNull(); // not a tray die
        expect(parsePureDiceFormula("1d%")).toBeNull();
        expect(parsePureDiceFormula("5")).toBeNull(); // no dice at all
        expect(parsePureDiceFormula("30d6")).toBeNull(); // overlay cap
        expect(parsePureDiceFormula("")).toBeNull();
    });
});

describe("rollPureDiceFormula", () => {
    test("totals match the per-die values plus constants", () => {
        for (let seed = 1; seed <= 50; seed++) {
            const terms = parsePureDiceFormula("2d6 + 1d20 + 5")!;
            const { dice, total } = rollPureDiceFormula(terms, new RNG(seed));
            expect(dice).toHaveLength(3);
            const diceSum = dice.reduce((n, d) => n + d.value, 0);
            expect(total).toBe(diceSum + 5);
            for (const d of dice) {
                expect(d.value).toBeGreaterThanOrEqual(1);
                expect(d.value).toBeLessThanOrEqual(d.sides);
            }
        }
    });

    test("keep/drop modifiers mark dropped dice", () => {
        const terms = parsePureDiceFormula("4d6dl1")!;
        const { dice, total } = rollPureDiceFormula(terms, new RNG(9));
        expect(dice).toHaveLength(4);
        expect(dice.filter((d) => !d.kept)).toHaveLength(1);
        expect(total).toBe(
            dice.filter((d) => d.kept).reduce((n, d) => n + d.value, 0)
        );
    });

    test("subtraction terms subtract", () => {
        const terms = parsePureDiceFormula("1d6 - 2")!;
        const { dice, total } = rollPureDiceFormula(terms, new RNG(3));
        expect(total).toBe(dice[0].value - 2);
    });
});

describe("showDiceOverlay", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    test("renders a die per value, settles, and dismisses", async () => {
        const p = showDiceOverlay(
            [
                { sides: 6, value: 4, kept: true },
                { sides: 20, value: 17, kept: true },
                { sides: 6, value: 1, kept: false },
            ],
            22
        );
        const layer = document.querySelector(".randomness-dice3d-layer")!;
        expect(layer).not.toBeNull();
        expect(layer.querySelectorAll(".randomness-dice3d-die")).toHaveLength(3);
        // d6 builds a cube landing on its value; d20 builds a chip.
        expect(
            layer.querySelector(".randomness-dice3d-land-4")
        ).not.toBeNull();
        expect(layer.querySelectorAll(".randomness-dice3d-chip")).toHaveLength(1);
        expect(layer.querySelector(".is-dropped")).not.toBeNull();
        // The total badge reserves its space from the start (hidden),
        // so the card never resizes when it appears.
        expect(
            layer.querySelector(".randomness-dice3d-total.is-pending")
                ?.textContent
        ).toBe("= 22");

        // Settle (tumble + per-die stagger).
        jest.advanceTimersByTime(1400);
        await p;
        const totalEl = layer.querySelector(".randomness-dice3d-total");
        expect(totalEl?.textContent).toBe("= 22");
        expect(totalEl?.classList.contains("is-pending")).toBe(false);
        // Chip shows its final value once settled.
        const chipValue = layer.querySelector(
            ".randomness-dice3d-d20 .randomness-dice3d-value"
        );
        expect(chipValue?.textContent).toBe("17");

        // Linger, then auto-dismiss.
        jest.advanceTimersByTime(3300);
        expect(document.querySelector(".randomness-dice3d-layer")).toBeNull();
    });

    test("a new roll replaces any overlay still on screen", () => {
        void showDiceOverlay([{ sides: 6, value: 2, kept: true }]);
        void showDiceOverlay([{ sides: 20, value: 19, kept: true }]);
        const layers = document.querySelectorAll(".randomness-dice3d-layer");
        expect(layers).toHaveLength(1);
        expect(
            layers[0].querySelector(".randomness-dice3d-d20")
        ).not.toBeNull();
        (layers[0] as HTMLElement).click();
    });

    test("click dismisses early and the promise still resolves", async () => {
        const p = showDiceOverlay([{ sides: 8, value: 3, kept: true }]);
        const layer = document.querySelector<HTMLElement>(
            ".randomness-dice3d-layer"
        )!;
        layer.click();
        expect(document.querySelector(".randomness-dice3d-layer")).toBeNull();
        jest.advanceTimersByTime(1400);
        await expect(p).resolves.toBeUndefined();
    });
});
