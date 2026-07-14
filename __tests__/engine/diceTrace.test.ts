/**
 * Dice trace — capturing what each die rolled (Ironsworn & co).
 *
 * Layers:
 *   1. ExprContext.onDice: every `NdX[mods]` term reports notation,
 *      per-die faces, and total, including d66-style digit dice.
 *   2. EvaluatorOptions.onDice: dice inside table calls are traced
 *      through a full evaluation.
 *   3. Formatting helpers (long breakdown / compact face list).
 */

import {
    DiceTraceEntry,
    formatDiceBreakdown,
    formatDiceFacesInline,
    formatDiceTraceEntry,
} from "../../src/engine/dice";
import { evaluateExpression, ExprContext } from "../../src/engine/expressions";
import { RNG } from "../../src/engine/rng";
import { Evaluator } from "../../src/engine/evaluator";
import { parseFileSource } from "../../src/resolver/fileResolver";

function ctxWith(trace: DiceTraceEntry[], seed = 1): ExprContext {
    return {
        getVar: () => "",
        setVar: () => undefined,
        evalEmbeddedCall: () => "",
        rng: new RNG(seed),
        onDice: (e) => trace.push(e),
    };
}

describe("ExprContext.onDice", () => {
    test("a plain dice term reports notation, faces, and total", () => {
        const trace: DiceTraceEntry[] = [];
        const { value } = evaluateExpression("2d10", ctxWith(trace));
        expect(trace).toHaveLength(1);
        expect(trace[0].notation).toBe("2d10");
        expect(trace[0].dice).toHaveLength(2);
        for (const d of trace[0].dice) {
            expect(d.value).toBeGreaterThanOrEqual(1);
            expect(d.value).toBeLessThanOrEqual(10);
            expect(d.kept).toBe(true);
        }
        expect(trace[0].total).toBe(
            trace[0].dice.reduce((a, d) => a + d.value, 0)
        );
        expect(value).toBe(trace[0].total);
    });

    test("modifiers keep their notation and mark dropped dice", () => {
        const trace: DiceTraceEntry[] = [];
        evaluateExpression("4d6dl1", ctxWith(trace));
        expect(trace[0].notation).toBe("4d6dl1");
        expect(trace[0].dice).toHaveLength(4);
        expect(trace[0].dice.filter((d) => !d.kept)).toHaveLength(1);
    });

    test("multiple terms report in roll order", () => {
        const trace: DiceTraceEntry[] = [];
        evaluateExpression("1d6 + 2d10 + 3", ctxWith(trace));
        expect(trace.map((e) => e.notation)).toEqual(["1d6", "2d10"]);
    });

    test("digit dice (d66) report one composed die per set", () => {
        const trace: DiceTraceEntry[] = [];
        const { value } = evaluateExpression("1d66%", ctxWith(trace));
        expect(trace[0].notation).toBe("1d66%");
        expect(trace[0].dice).toHaveLength(1);
        expect(value).toBe(trace[0].total);
    });

    test("plain numbers trace nothing", () => {
        const trace: DiceTraceEntry[] = [];
        evaluateExpression("2 + 3", ctxWith(trace));
        expect(trace).toHaveLength(0);
    });
});

describe("EvaluatorOptions.onDice", () => {
    test("dice inside table calls are traced through a full run", () => {
        const file = parseFileSource(
            "t.rdm",
            [
                "Table: main",
                "Attack: {1d20+5} for {2d6} damage",
                "",
                "Table: unused",
                "x",
            ].join("\n")
        );
        const trace: DiceTraceEntry[] = [];
        const out = new Evaluator(file, [], {
            seed: 7,
            onDice: (e) => trace.push(e),
        }).run();
        // "+5" is arithmetic outside the dice term, so the notation
        // is just the term itself.
        expect(trace.map((e) => e.notation)).toEqual(["1d20", "2d6"]);
        // The rendered numbers match the traced totals.
        expect(out).toBe(
            `Attack: ${trace[0].total + 5} for ${trace[1].total} damage`
        );
    });

    test("seeded runs trace identically", () => {
        const file = parseFileSource("t.rdm", "Table: main\n{3d8}");
        const runTrace = (): DiceTraceEntry[] => {
            const t: DiceTraceEntry[] = [];
            new Evaluator(file, [], { seed: 42, onDice: (e) => t.push(e) }).run();
            return t;
        };
        expect(runTrace()).toEqual(runTrace());
    });
});

describe("breakdown formatting", () => {
    const entry = (
        notation: string,
        faces: [number, boolean][]
    ): DiceTraceEntry => ({
        notation,
        total: faces.filter(([, k]) => k).reduce((a, [v]) => a + v, 0),
        dice: faces.map(([value, kept]) => ({
            value,
            kept,
            exploded: false,
            rerolled: false,
        })),
    });

    test("long form marks dropped dice", () => {
        expect(
            formatDiceTraceEntry(entry("4d6dl1", [[5, true], [3, true], [1, false], [6, true]]))
        ).toBe("4d6dl1 → 5, 3, (1), 6");
    });

    test("long form joins entries with ;", () => {
        expect(
            formatDiceBreakdown([
                entry("2d10", [[7, true], [3, true]]),
                entry("1d6", [[4, true]]),
            ])
        ).toBe("2d10 → 7, 3; 1d6 → 4");
    });

    test("compact form omits notation for a single term", () => {
        expect(formatDiceFacesInline([entry("2d10", [[7, true], [3, true]])])).toBe(
            "7, 3"
        );
        expect(
            formatDiceFacesInline([
                entry("2d10", [[7, true], [3, true]]),
                entry("1d6", [[4, true]]),
            ])
        ).toBe("2d10: 7, 3; 1d6: 4");
    });

    test("exploded dice are marked", () => {
        const e = entry("1d6!", [[6, true], [4, true]]);
        e.dice[0].exploded = false;
        e.dice[1].exploded = true;
        expect(formatDiceTraceEntry(e)).toBe("1d6! → 6, 4!");
    });
});
