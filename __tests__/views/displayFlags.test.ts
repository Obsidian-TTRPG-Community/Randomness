/**
 * @jest-environment jsdom
 */

/**
 * Tests for the Phase 3 completion slice — formula aliases and the
 * honoured display flags (`|text(…)` tooltip labels via
 * replaceCodeElement's tooltip prop).
 */

import { translateDiceExpression } from "../../src/compat/diceCompat";
import { evalSourceOf } from "../../src/views/lockingService";
import { replaceCodeElement } from "../../src/views/inlineProcessor";

describe("formula aliases", () => {
    const aliases = {
        sneak: "4d6dl1",
        adv: "2d20kh",
        "Dex Save": "1d20+2|text(Dexterity +2)",
    };

    test("whole-expression alias substitutes its formula", () => {
        expect(translateDiceExpression("sneak", aliases).expr).toBe(
            "{4d6dl1}"
        );
        expect(translateDiceExpression("ADV", aliases).expr).toBe(
            "{2d20kh}"
        ); // case-insensitive
    });

    test("alias flags are stripped and honoured", () => {
        const r = translateDiceExpression("dex save", aliases);
        expect(r.expr).toBe("{1d20+2}");
        expect(r.flags).toEqual(["text(Dexterity +2)"]);
    });

    test("flags on the alias call itself survive", () => {
        const r = translateDiceExpression("sneak|nodice", aliases);
        expect(r.expr).toBe("{4d6dl1}");
        expect(r.flags).toEqual(["nodice"]);
    });

    test("non-aliases translate normally; no aliases map is fine", () => {
        expect(translateDiceExpression("1d20", aliases).expr).toBe("{1d20}");
        expect(translateDiceExpression("1d20").expr).toBe("{1d20}");
        // Partial matches are NOT aliases.
        expect(translateDiceExpression("sneak+1", aliases).expr).toBe(
            "{sneak+1}"
        );
    });

    test("evalSourceOf passes aliases through for compat prefixes", () => {
        expect(
            evalSourceOf({ expr: "sneak", prefix: "dice:" }, aliases)
        ).toBe("{4d6dl1}");
        // rdm: never aliases.
        expect(evalSourceOf({ expr: "sneak" }, aliases)).toBe("sneak");
    });
});

describe("display flags rendering", () => {
    test("tooltip prop sets the span title", () => {
        const code = document.createElement("code");
        document.body.appendChild(code);
        const span = replaceCodeElement(code, {
            result: "Dexterity +2",
            tooltip: "17",
            isLocked: false,
            expr: "1d20+2",
            onLock: () => undefined,
            onReroll: () => undefined,
        });
        expect(span.title).toBe("17");
        expect(span.textContent).toContain("Dexterity +2");
    });

    test("no tooltip → no title attribute", () => {
        const code = document.createElement("code");
        document.body.appendChild(code);
        const span = replaceCodeElement(code, {
            result: "9",
            isLocked: false,
            expr: "1d20",
            onLock: () => undefined,
            onReroll: () => undefined,
        });
        expect(span.title).toBe("");
    });
});
