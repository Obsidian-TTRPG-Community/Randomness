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
import {
    applyVisibleFaces,
    decorateDiceResult,
    replaceCodeElement,
} from "../../src/views/inlineProcessor";
import { DiceTraceEntry } from "../../src/engine/dice";
import type RandomnessPlugin from "../../src/views/main";

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

    test("breakdown prop lands in the result span's hover title", () => {
        const code = document.createElement("code");
        document.body.appendChild(code);
        const span = replaceCodeElement(code, {
            result: "10",
            breakdown: "2d10 → 7, 3",
            isLocked: false,
            expr: "{2d10}",
            onLock: () => undefined,
            onReroll: () => undefined,
        });
        const result = span.querySelector<HTMLElement>(
            ".randomness-inline-result"
        );
        expect(result?.title).toBe("{2d10}\n2d10 → 7, 3");
    });
});

describe("dice breakdown display", () => {
    const fakePlugin = (showDiceBreakdown: boolean): RandomnessPlugin =>
        ({
            settings: { diceFormulas: {}, showDiceBreakdown },
        }) as unknown as RandomnessPlugin;

    const trace = (
        notation: string,
        values: number[],
        total = values.reduce((a, b) => a + b, 0)
    ): DiceTraceEntry[] => [
        {
            notation,
            total,
            dice: values.map((value) => ({
                value,
                kept: true,
                exploded: false,
                rerolled: false,
            })),
        },
    ];

    test("tooltip breakdown is always returned when dice rolled", () => {
        const r = decorateDiceResult(
            { expr: "{2d10}" },
            "10",
            fakePlugin(false),
            trace("2d10", [7, 3])
        );
        expect(r.breakdown).toBe("2d10 → 7, 3");
        expect(r.display).toBe("10"); // setting off → not visible
    });

    test("setting on appends the face list, rdm: and dice: alike", () => {
        expect(
            decorateDiceResult(
                { expr: "{2d10}" },
                "10",
                fakePlugin(true),
                trace("2d10", [7, 3])
            ).display
        ).toBe("10 (7, 3)");
        expect(
            decorateDiceResult(
                { expr: "2d10", prefix: "dice:" },
                "10",
                fakePlugin(true),
                trace("2d10", [7, 3])
            ).display
        ).toBe("10 (7, 3)");
    });

    test("|dice flag opts a compat span in with the setting off", () => {
        expect(
            decorateDiceResult(
                { expr: "2d10|dice", prefix: "dice:" },
                "10",
                fakePlugin(false),
                trace("2d10", [7, 3])
            ).display
        ).toBe("10 (7, 3)");
    });

    test("single bare die is not repeated: no '14 (14)'", () => {
        expect(
            applyVisibleFaces(
                { expr: "{1d20}" },
                "14",
                fakePlugin(true),
                trace("1d20", [14])
            )
        ).toBe("14");
        // …but a modifier makes the face informative again.
        expect(
            applyVisibleFaces(
                { expr: "{1d20+5}" },
                "19",
                fakePlugin(true),
                trace("1d20+5", [14])
            )
        ).toBe("19 (14)");
    });

    test("no trace → display untouched", () => {
        expect(
            decorateDiceResult({ expr: "[@Names]" }, "Alice", fakePlugin(true))
                .display
        ).toBe("Alice");
    });

    test("|text label keeps faces out of the visible display", () => {
        const r = decorateDiceResult(
            { expr: "1d20+2|text(Dex +2)", prefix: "dice:" },
            "17",
            fakePlugin(true),
            trace("1d20+2", [15])
        );
        expect(r.display).toBe("Dex +2");
        expect(r.tooltip).toBe("17");
        expect(r.breakdown).toBe("1d20+2 → 15");
    });
});
