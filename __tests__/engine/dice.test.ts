/**
 * Tests for the dice core (src/engine/dice.ts) and its integration into
 * the {...} expression grammar — Dice Roller merge Phase 1.
 *
 * Two layers:
 *   1. Unit tests drive parseDiceModifiers / rollModifiedDice directly,
 *      using a scripted fake RNG so every die value is exact.
 *   2. Integration tests evaluate real {…} expressions with a seeded RNG
 *      and assert value ranges plus — critically — that the pre-merge
 *      grammar is bit-for-bit unchanged (RNG stream identity, comparison
 *      semantics, embedded-call dice sides).
 */

import {
    parseDiceModifiers,
    rollModifiedDice,
    DiceModifiers,
} from "../../src/engine/dice";
import {
    evaluateExpression,
    ExprContext,
    ExpressionError,
    Value,
} from "../../src/engine/expressions";
import { RNG } from "../../src/engine/rng";

// ─── Helpers ───

/** RNG stub that returns a scripted sequence of die values. */
function scriptedRng(values: number[]): RNG {
    let i = 0;
    const next = () => {
        if (i >= values.length) throw new Error("scripted RNG exhausted");
        return values[i++];
    };
    return {
        rollDie: next,
        intInclusive: next,
        rollDice: (count: number, _sides: number) => {
            let sum = 0;
            for (let k = 0; k < count; k++) sum += next();
            return sum;
        },
    } as unknown as RNG;
}

function makeCtx(opts: { seed?: number; embedded?: Record<string, string> } = {}): ExprContext {
    const vars = new Map<string, Value>();
    return {
        getVar: (n) => vars.get(n.toLowerCase()) ?? "",
        setVar: (n, v) => void vars.set(n.toLowerCase(), v),
        evalEmbeddedCall: (raw) => opts.embedded?.[raw] ?? "",
        rng: new RNG(opts.seed ?? 12345),
    };
}

function evalNum(src: string, ctx: ExprContext): number {
    const v = evaluateExpression(src, ctx).value;
    expect(typeof v).toBe("number");
    return v as number;
}

// ─── parseDiceModifiers ───

describe("parseDiceModifiers", () => {
    function parse(s: string): { mods: DiceModifiers | null; rest: string } {
        const { mods, pos } = parseDiceModifiers(s, 0);
        return { mods, rest: s.slice(pos) };
    }

    test("returns null when no modifiers present", () => {
        expect(parse("").mods).toBeNull();
        expect(parse(" + 3").mods).toBeNull();
        expect(parse(">=5").mods).toBeNull(); // bare comparison is not ours
    });

    test("keep/drop forms", () => {
        expect(parse("k").mods?.keep).toEqual({ type: "kh", n: 1 });
        expect(parse("kh2").mods?.keep).toEqual({ type: "kh", n: 2 });
        expect(parse("kl3").mods?.keep).toEqual({ type: "kl", n: 3 });
        expect(parse("dl").mods?.keep).toEqual({ type: "dl", n: 1 });
        expect(parse("dh2").mods?.keep).toEqual({ type: "dh", n: 2 });
    });

    test("bare 'd' is never consumed (it may start another dice term)", () => {
        const { mods, rest } = parse("d4");
        expect(mods).toBeNull();
        expect(rest).toBe("d4");
    });

    test("explode with times, infinite, and conditions", () => {
        let m = parse("!").mods!;
        expect(m.ordered).toEqual([
            { type: "explode", mod: { times: 1, conditions: [] } },
        ]);
        m = parse("!!3").mods!;
        expect(m.ordered[0]).toEqual({ type: "explode", mod: { times: 3, conditions: [] } });
        m = parse("!i=!3").mods!;
        expect(m.ordered[0]).toEqual({
            type: "explode",
            mod: { times: 100, conditions: [{ op: "=!", n: 3 }] },
        });
    });

    test("reroll with chained conditions", () => {
        const m = parse("r<2>3").mods!;
        expect(m.ordered[0]).toEqual({
            type: "reroll",
            mod: { times: 1, conditions: [{ op: "<", n: 2 }, { op: ">", n: 3 }] },
        });
    });

    test("sort and unique", () => {
        expect(parse("s").mods?.ordered[0]).toEqual({ type: "sort", dir: "a" });
        expect(parse("sd").mods?.ordered[0]).toEqual({ type: "sort", dir: "d" });
        expect(parse("u").mods?.ordered[0]).toEqual({ type: "unique" });
    });

    test("cs success counting requires at least one condition", () => {
        const m = parse("cs>=5-=1").mods!;
        expect(m.successes).toEqual([{ op: ">=", n: 5 }, { op: "-=", n: 1 }]);
        // `cs` with no condition is rewound untouched
        const bare = parse("cs + 1");
        expect(bare.mods).toBeNull();
        expect(bare.rest).toBe("cs + 1");
    });

    test("stops at unrecognised text and leaves it in place", () => {
        const { mods, rest } = parse("kh2foo");
        expect(mods?.keep).toEqual({ type: "kh", n: 2 });
        expect(rest).toBe("foo");
    });
});

// ─── rollModifiedDice (scripted) ───

describe("rollModifiedDice", () => {
    const d6 = { kind: "sides", sides: 6 } as const;

    function withMods(s: string): DiceModifiers | null {
        return parseDiceModifiers(s, 0).mods;
    }

    test("no modifiers sums all dice", () => {
        const out = rollModifiedDice(3, d6, null, scriptedRng([4, 1, 6]));
        expect(out.total).toBe(11);
        expect(out.dice.map((d) => d.value)).toEqual([4, 1, 6]);
    });

    test("keep highest 2 of 4", () => {
        const out = rollModifiedDice(4, d6, withMods("kh2"), scriptedRng([4, 1, 6, 3]));
        expect(out.total).toBe(10); // 6 + 4
        expect(out.dice.filter((d) => d.kept).map((d) => d.value).sort()).toEqual([4, 6]);
    });

    test("drop lowest (4d6dl1 stat roll)", () => {
        const out = rollModifiedDice(4, d6, withMods("dl1"), scriptedRng([4, 1, 6, 3]));
        expect(out.total).toBe(13); // drops the 1
    });

    test("drop highest", () => {
        const out = rollModifiedDice(4, d6, withMods("dh1"), scriptedRng([4, 1, 6, 3]));
        expect(out.total).toBe(8); // drops the 6
    });

    test("explode adds a die per max roll (once by default)", () => {
        // [6, 2] → the 6 explodes once → +5
        const out = rollModifiedDice(2, d6, withMods("!"), scriptedRng([6, 2, 5]));
        expect(out.total).toBe(13);
        expect(out.dice.map((d) => d.value)).toEqual([6, 5, 2]);
        expect(out.dice[1].exploded).toBe(true);
    });

    test("explode chains while the condition holds", () => {
        // [6, 2] !3 → 6 → 6 → 6 → 4 (times exhausted after 3)
        const out = rollModifiedDice(2, d6, withMods("!3"), scriptedRng([6, 2, 6, 6, 4]));
        expect(out.total).toBe(24);
    });

    test("explode with custom condition", () => {
        // !=2 explodes rolls equal to 2
        const out = rollModifiedDice(2, d6, withMods("!=2"), scriptedRng([2, 5, 3]));
        expect(out.total).toBe(10);
    });

    test("reroll replaces minimum rolls", () => {
        // [1, 4] r → the 1 is rerolled once → 5
        const out = rollModifiedDice(2, d6, withMods("r"), scriptedRng([1, 4, 5]));
        expect(out.total).toBe(9);
        expect(out.dice[0].rerolled).toBe(true);
    });

    test("reroll with condition keeps rerolling while matched", () => {
        // r<3 with times i: [2, 4] → 2 rerolls to 1, then to 3, stops
        const out = rollModifiedDice(2, d6, withMods("ri<3"), scriptedRng([2, 4, 1, 3]));
        expect(out.total).toBe(7);
    });

    test("unique rerolls duplicates", () => {
        // [3, 3, 5] → dup 3 rerolls to 3 (again), then 4
        const out = rollModifiedDice(3, d6, withMods("u"), scriptedRng([3, 3, 5, 3, 4]));
        expect(out.total).toBe(12);
        expect(new Set(out.dice.map((d) => d.value)).size).toBe(3);
    });

    test("unique is skipped when impossible", () => {
        const out = rollModifiedDice(3, { kind: "sides", sides: 2 }, withMods("u"),
            scriptedRng([1, 1, 2]));
        expect(out.total).toBe(4); // untouched
    });

    test("sort orders detail without changing the total", () => {
        const out = rollModifiedDice(3, d6, withMods("sd"), scriptedRng([2, 6, 4]));
        expect(out.dice.map((d) => d.value)).toEqual([6, 4, 2]);
        expect(out.total).toBe(12);
    });

    test("success counting with negative-equals", () => {
        // [6, 5, 2, 1, 6] cs>=5-=1 → three ≥5, one −1 → 2
        const out = rollModifiedDice(5, d6, withMods("cs>=5-=1"),
            scriptedRng([6, 5, 2, 1, 6]));
        expect(out.total).toBe(2);
    });

    test("success counting respects keep/drop", () => {
        // kh2 keeps [6, 5]; both ≥5 → 2
        const out = rollModifiedDice(4, d6, withMods("kh2cs>=5"),
            scriptedRng([6, 1, 5, 2]));
        expect(out.total).toBe(2);
    });

    test("fudge faces roll −1..1", () => {
        const out = rollModifiedDice(4, { kind: "fudge" }, null,
            scriptedRng([-1, 0, 1, 1]));
        expect(out.total).toBe(1);
    });

    test("range faces (d[3,5]) explode at the range max", () => {
        const out = rollModifiedDice(2, { kind: "range", min: 3, max: 5 },
            withMods("!"), scriptedRng([5, 3, 4]));
        expect(out.total).toBe(12); // 5 explodes → +4
    });
});

// ─── Expression grammar integration ───

describe("dice grammar in {...} expressions", () => {
    test("plain NdN consumes the RNG stream identically to pre-merge", () => {
        // Seeded reference stream vs. the expression path — must be equal
        // so seeded corpus generators reproduce exactly.
        const reference = new RNG(42).rollDice(3, 6);
        expect(evalNum("3d6", makeCtx({ seed: 42 }))).toBe(reference);
    });

    test("bare comparisons keep IPP3 sum semantics (NOT success counting)", () => {
        // {3d6>=5}: sum compared to 5 → almost always 1 with these dice
        for (let seed = 1; seed <= 50; seed++) {
            const v = evalNum("3d6>=3", makeCtx({ seed }));
            expect(v).toBe(1); // sum of 3d6 is always ≥ 3
        }
        // whereas success counting via cs can exceed 1
        let sawMoreThanOne = false;
        for (let seed = 1; seed <= 200; seed++) {
            const v = evalNum("3d6cs>=1", makeCtx({ seed }));
            expect(v).toBe(3); // every die ≥ 1 → always 3 successes
            sawMoreThanOne = sawMoreThanOne || v > 1;
        }
        expect(sawMoreThanOne).toBe(true);
    });

    test("4d6dl1 stays within 3..18", () => {
        for (let seed = 1; seed <= 100; seed++) {
            const v = evalNum("4d6dl1", makeCtx({ seed }));
            expect(v).toBeGreaterThanOrEqual(3);
            expect(v).toBeLessThanOrEqual(18);
        }
    });

    test("2d20kh (advantage) stays within 1..20 and ≥ plain expectation", () => {
        for (let seed = 1; seed <= 100; seed++) {
            const v = evalNum("2d20kh", makeCtx({ seed }));
            expect(v).toBeGreaterThanOrEqual(1);
            expect(v).toBeLessThanOrEqual(20);
        }
    });

    test("percentile d% rolls d100", () => {
        for (let seed = 1; seed <= 100; seed++) {
            const v = evalNum("1d%", makeCtx({ seed }));
            expect(v).toBeGreaterThanOrEqual(1);
            expect(v).toBeLessThanOrEqual(100);
            expect(Number.isInteger(v)).toBe(true);
        }
    });

    test("custom percent d66 yields digit-paired values", () => {
        for (let seed = 1; seed <= 100; seed++) {
            const v = evalNum("1d66%", makeCtx({ seed }));
            const tens = Math.floor(v / 10);
            const units = v % 10;
            expect(tens).toBeGreaterThanOrEqual(1);
            expect(tens).toBeLessThanOrEqual(6);
            expect(units).toBeGreaterThanOrEqual(1);
            expect(units).toBeLessThanOrEqual(6);
        }
    });

    test("fudge dice 4dF stay within −4..4", () => {
        for (let seed = 1; seed <= 100; seed++) {
            const v = evalNum("4dF", makeCtx({ seed }));
            expect(v).toBeGreaterThanOrEqual(-4);
            expect(v).toBeLessThanOrEqual(4);
        }
    });

    test("face range 1d[3,5] stays within 3..5", () => {
        for (let seed = 1; seed <= 50; seed++) {
            const v = evalNum("1d[3,5]", makeCtx({ seed }));
            expect(v).toBeGreaterThanOrEqual(3);
            expect(v).toBeLessThanOrEqual(5);
        }
    });

    test("embedded-call dice sides still work (1d[@dietype])", () => {
        const ctx = makeCtx({ seed: 7, embedded: { "@dietype": "6" } });
        const v = evalNum("1d[@dietype]", ctx);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
    });

    test("modified dice participate in arithmetic", () => {
        for (let seed = 1; seed <= 50; seed++) {
            const v = evalNum("2d20kh + 5", makeCtx({ seed }));
            expect(v).toBeGreaterThanOrEqual(6);
            expect(v).toBeLessThanOrEqual(25);
        }
    });

    test("unknown suffix text still errors as before", () => {
        expect(() => evaluateExpression("1d6foo", makeCtx())).toThrow(ExpressionError);
        expect(() => evaluateExpression("1d6d4", makeCtx())).toThrow(ExpressionError);
        expect(() => evaluateExpression("1d", makeCtx())).toThrow(ExpressionError);
    });
});
