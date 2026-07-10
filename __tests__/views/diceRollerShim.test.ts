/**
 * Tests for the window.DiceRoller API shim — the surface Fantasy
 * Statblocks (and other Dice Roller consumers) actually use.
 */

import {
    DiceRollerApiShim,
    ShimStackRoller,
} from "../../src/views/diceRollerShim";
import { translateDiceExpression } from "../../src/compat/diceCompat";

describe("DiceRollerApiShim.getRollerString", () => {
    test("mirrors Dice Roller's flag appending for Fantasy Statblocks' registration", () => {
        const shim = new DiceRollerApiShim();
        // Exactly what Fantasy Statblocks passes to registerSource.
        shim.registerSource("FANTASY_STATBLOCKS_PLUGIN", {
            showDice: true,
            shouldRender: false,
            showFormula: false,
            showParens: false,
            expectedValue: "Average",
            text: null,
        });
        expect(
            shim.getRollerString("1d20 + 7", "FANTASY_STATBLOCKS_PLUGIN")
        ).toBe("1d20 + 7|norender|noform|avg|noparen");
        // renderDice on flips just the render flag.
        shim.registerSource("FANTASY_STATBLOCKS_PLUGIN", {
            showDice: true,
            shouldRender: true,
            showFormula: false,
            showParens: false,
            expectedValue: "Average",
            text: null,
        });
        expect(
            shim.getRollerString("2d6 + 3", "FANTASY_STATBLOCKS_PLUGIN")
        ).toBe("2d6 + 3|render|noform|avg|noparen");
    });

    test("unknown or missing source returns the string unchanged", () => {
        const shim = new DiceRollerApiShim();
        expect(shim.getRollerString("1d8 + 2")).toBe("1d8 + 2");
        expect(shim.getRollerString("1d8 + 2", "nobody")).toBe("1d8 + 2");
    });

    test("position, text, round, and signed flags", () => {
        const shim = new DiceRollerApiShim();
        shim.registerSource("s", {
            position: "NONE",
            text: "to hit",
            round: "Down",
            signed: true,
        });
        expect(shim.getRollerString("1d20", "s")).toBe(
            "1d20|nodice|text(to hit)|floor|signed"
        );
    });
});

describe("shim flag output survives our own compat translation", () => {
    test.each([
        "1d20 + 7|norender|noform|avg|noparen",
        "2d6 + 3|render|noform|avg|noparen",
        "1d20|nodice|text(to hit)|floor|signed",
        "1d4|paren|ceil|round|noround|none",
    ])("%s translates without error", (raw) => {
        const { expr } = translateDiceExpression(raw);
        expect(expr).not.toContain("|");
    });
});

describe("ShimStackRoller", () => {
    test("getRollerSync rolls plain formulas within bounds and notifies", async () => {
        const shim = new DiceRollerApiShim();
        const roller = shim.getRollerSync("1d20 + 7|noform", "s");
        expect(roller).toBeInstanceOf(ShimStackRoller);
        let notified = 0;
        roller!.on("new-result", () => notified++);
        for (let i = 0; i < 30; i++) {
            const total = roller!.rollSync();
            expect(total).toBeGreaterThanOrEqual(8);
            expect(total).toBeLessThanOrEqual(27);
            expect(roller!.result).toBe(total);
        }
        expect(notified).toBe(30);
        await expect(roller!.roll()).resolves.toBeGreaterThanOrEqual(8);
    });

    test("anything beyond plain dice sums returns null, like Dice Roller's lexer errors", () => {
        const shim = new DiceRollerApiShim();
        expect(shim.getRollerSync("[[Note^loot]]")).toBeNull();
        expect(shim.getRollerSync("#tag")).toBeNull();
        expect(shim.getRollerSync("")).toBeNull();
        expect(shim.getRollerSync("totally not dice")).toBeNull();
    });

    test("parseDice returns a rolled result", async () => {
        const shim = new DiceRollerApiShim();
        const { result, roller } = await shim.parseDice("2d6");
        expect(roller).not.toBeNull();
        expect(result).toBeGreaterThanOrEqual(2);
        expect(result).toBeLessThanOrEqual(12);
    });
});
