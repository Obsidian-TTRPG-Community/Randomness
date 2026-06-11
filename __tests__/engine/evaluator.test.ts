/**
 * Evaluator-level tests for run-loop semantics (reps, MaxReps, header/footer).
 *
 * Existing engine tests focus on parsing and per-table behaviour;
 * these test what happens when run() ties everything together: how
 * many times the main table fires, how MaxReps interacts with
 * explicit reps requests, and how header/footer wrap the output.
 */

import { parseGeneratorFile } from "../../src/engine/fileParser";
import { Evaluator } from "../../src/engine/evaluator";

function run(source: string, opts: ConstructorParameters<typeof Evaluator>[2] = {}): string {
    const file = parseGeneratorFile(source);
    return new Evaluator(file, [], opts).run();
}

describe("Evaluator: reps and MaxReps", () => {
    test("default reps is 1 when neither caller nor file specifies", () => {
        const out = run(["Table: T", "X"].join("\n"));
        expect(out).toBe("X");
        // Single rep — no newline between repeated outputs.
        expect(out.split("\n").length).toBe(1);
    });

    test("MaxReps: N in the file produces N results by default", () => {
        // The reported user expectation: a generator file with
        // `MaxReps: 3` should produce 3 rolls when invoked with no
        // explicit reps argument. This matches IPP3 behaviour.
        const source = [
            "MaxReps: 3",
            "Table: T",
            "X",
        ].join("\n");
        const out = run(source);
        // Reps are separated by a blank line (`\n\n`), so we
        // split on the rep-boundary marker to count.
        expect(out.split("\n\n").length).toBe(3);
        expect(out).toBe("X\n\nX\n\nX");
    });

    test("MaxReps: N with explicit reps=K runs min(K, N) reps", () => {
        const source = [
            "MaxReps: 5",
            "Table: T",
            "X",
        ].join("\n");
        // Caller asks for 2, MaxReps caps at 5 → 2 reps.
        expect(run(source, { reps: 2 }).split("\n\n").length).toBe(2);
        // Caller asks for 10, MaxReps caps at 5 → 5 reps.
        expect(run(source, { reps: 10 }).split("\n\n").length).toBe(5);
    });

    test("explicit reps with no MaxReps runs exactly that many", () => {
        const source = ["Table: T", "X"].join("\n");
        expect(run(source, { reps: 4 }).split("\n\n").length).toBe(4);
    });

    test("MaxReps: 1 produces a single result", () => {
        // Common pattern: an author who wants a single roll regardless
        // of caller-supplied reps.
        const source = [
            "MaxReps: 1",
            "Table: T",
            "X",
        ].join("\n");
        expect(run(source, { reps: 50 })).toBe("X");
    });

    test("rep variable is set per repetition", () => {
        const source = [
            "MaxReps: 3",
            "Table: T",
            "rep {rep}",
        ].join("\n");
        const out = run(source);
        // Reps are separated by a BLANK LINE so each is visually
        // distinct when rendered (double newline → `<br><br>` →
        // paragraph break on paste). Tightly-packed reps were
        // unreadable for multi-line content like the altar
        // generator that prompted this fix.
        expect(out).toBe("rep 1\n\nrep 2\n\nrep 3");
    });

    test("Header and Footer wrap the joined repetitions, not each one", () => {
        const source = [
            "Header: BEGIN",
            "Footer: END",
            "MaxReps: 2",
            "Table: T",
            "X",
        ].join("\n");
        const out = run(source);
        // Same blank-line separation between Header, reps, and
        // Footer — they're independent blocks, not a continuous
        // line.
        expect(out).toBe("BEGIN\n\nX\n\nX\n\nEND");
    });
});

// ────────── [#n table] forced-pick semantics (IPP3 contract) ──────────

/**
 * `[#n table]` means different things depending on the table's type:
 *   - Lookup tables: n is treated as the lookup-roll value, matched
 *     against each item's range. This is what `[#{1d6} Weapons]`
 *     does — roll a d6, find the lookup range that contains the
 *     result. Allows tier-limiting equipment by dice expression.
 *   - Weighted (and default-typed) tables: n is 1-indexed positional.
 *     `[#3 Names]` returns the third listed item.
 *
 * Originally these tests didn't exist; the implementation positional-
 * indexed both kinds of tables, silently producing wrong items
 * whenever a lookup table had multi-row ranges (Common case).
 */
describe("Evaluator: [#n table] forced pick", () => {
    test("on a Lookup table, n is matched against item ranges", () => {
        // n=5 should match the 5-6 range and return "Spear", NOT
        // the positional 5th item.
        const source = [
            "Table: Main",
            "[#5 Sub]",
            "",
            "Table: Sub",
            "Type: Lookup",
            "Roll: 1d12",
            "1:None",
            "2-3:Club",
            "4:Javelin",
            "5-6:Spear",
            "7-9:Short Sword",
            "10-11:Long Sword",
            "12:Great Sword",
        ].join("\n");
        const out = run(source, { seed: 1 });
        expect(out).toBe("Spear");
    });

    test("[#{1d6} weapons] only selects items in the 1-6 range", () => {
        // The real-world pattern: roll a tier-limited dice into a
        // wider lookup table. Should never produce items from
        // ranges starting at 7 or higher.
        const source = [
            "Table: Main",
            "[#{1d6} Sub]",
            "",
            "Table: Sub",
            "Type: Lookup",
            "Roll: 1d12",
            "1:None",
            "2-3:Club",
            "4:Javelin",
            "5-6:Spear",
            "7-9:Short Sword",
            "10-11:Long Sword",
            "12:Great Sword",
        ].join("\n");
        for (let seed = 1; seed <= 50; seed++) {
            const out = run(source, { seed });
            expect(out).not.toMatch(/Sword/);
            expect([
                "None",
                "Club",
                "Javelin",
                "Spear",
            ]).toContain(out);
        }
    });

    test("on a Lookup table, n outside any range falls back to Default", () => {
        const source = [
            "Table: Main",
            "[#99 Sub]",
            "",
            "Table: Sub",
            "Type: Lookup",
            "Roll: 1d6",
            "Default: missing",
            "1-6:Hit",
        ].join("\n");
        expect(run(source, { seed: 1 })).toBe("missing");
    });

    test("on a Weighted table (no Type:), n is 1-indexed positional", () => {
        // The other half of the contract: weighted tables don't have
        // ranges, so n picks by listing order.
        const source = [
            "Table: Main",
            "[#3 Sub]",
            "",
            "Table: Sub",
            "Alpha",
            "Beta",
            "Gamma",
            "Delta",
        ].join("\n");
        expect(run(source, { seed: 1 })).toBe("Gamma");
    });

    test("on an explicit Type: Weighted table, n is 1-indexed positional", () => {
        const source = [
            "Table: Main",
            "[#2 Sub]",
            "",
            "Table: Sub",
            "Type: Weighted",
            "Alpha",
            "Beta",
            "Gamma",
        ].join("\n");
        expect(run(source, { seed: 1 })).toBe("Beta");
    });
});

// ────────── [#<key> <table>] dictionary semantics ──────────

/**
 * Dictionary tables are picked by string key, not by number or
 * range. The IPP3 contract is `[#<key> <table>]` where `<key>`
 * may be a literal identifier, a `{var}` reference, or any other
 * expression that resolves to a string.
 *
 * Originally the parser only accepted numeric or `{...}` leading
 * tokens for the index, treating plain identifiers as part of the
 * table name — so `[#fighter hitdice]` was looked up as a single
 * table named "fighter hitdice" and threw "Unknown table". And
 * `[#{class} hitdice]` had its braces stripped to bare `class`,
 * which then rendered as literal text instead of resolving the
 * variable.
 */
describe("Evaluator: dictionary table picks", () => {
    test("[#key table] picks the value for that key", () => {
        const source = [
            "Table: Main",
            "[#fighter hitdice]",
            "",
            "Table: hitdice",
            "Type: Dictionary",
            "fighter: d10",
            "mage: d4",
        ].join("\n");
        expect(run(source, { seed: 1 })).toBe("d10");
    });

    test("[#unknown table] falls back to Default", () => {
        const source = [
            "Table: Main",
            "[#unknown hitdice]",
            "",
            "Table: hitdice",
            "Type: Dictionary",
            "Default: d6",
            "fighter: d10",
        ].join("\n");
        expect(run(source, { seed: 1 })).toBe("d6");
    });

    test("[#{var} table] resolves variable as the key", () => {
        // The example straight out of the IPP3 dictionary docs:
        // class is set, then used as the key against the dict.
        const source = [
            "Set: class=mage",
            "Table: Main",
            "[#{class} hitdice]",
            "",
            "Table: hitdice",
            "Type: Dictionary",
            "fighter: d10",
            "mage: d4",
        ].join("\n");
        expect(run(source, { seed: 1 })).toBe("d4");
    });

    test("[#[@subtable] table] resolves sub-table call as the key", () => {
        // Another nesting pattern: the key comes from a roll on
        // another table. Single-item table for determinism here.
        const source = [
            "Table: Main",
            "[#[@class] hitdice]",
            "",
            "Table: class",
            "fighter",
            "",
            "Table: hitdice",
            "Type: Dictionary",
            "fighter: d10",
        ].join("\n");
        expect(run(source, { seed: 1 })).toBe("d10");
    });

    test("dictionary item value has no leading space from cosmetic ': '", () => {
        // Regression: `fighter: d10` should yield "d10", not " d10".
        // IPP3 strips the single space after `:` as cosmetic.
        const source = [
            "Table: Main",
            "[#fighter hitdice]",
            "",
            "Table: hitdice",
            "Type: Dictionary",
            "fighter: d10",
        ].join("\n");
        const out = run(source, { seed: 1 });
        expect(out).toBe("d10");
        expect(out.startsWith(" ")).toBe(false);
    });
});

// ────────── [#table] "current-index pick" (no leading token) ──────────

/*
 * IPP3 docs verbatim: "If n is not specified, the item that is
 * picked in table is the item that's at the current index of the
 * current table item being processed. So, if the 5th item in a
 * table is selected, and that item has a table pick tag such as
 * [#sometable], the fifth item in sometable would be picked."
 *
 * Used for cross-indexing parallel tables — e.g. a NameTable and
 * a DescriptionTable where each name pairs with its description.
 * Implementation tracks current item position on a stack so
 * nested calls inherit naturally and outer indices restore after
 * the inner call pops.
 */
describe("Evaluator: [#table] current-index pick (no leading token)", () => {
    test("simple cross-index pairs N-th item of caller with N-th of target", () => {
        // 1-item A picks position 1; the [#B] inside picks B's
        // position 1 — single-item tables make this deterministic
        // without RNG seed sensitivity.
        const source = [
            "Table: A",
            "[#B]",
            "",
            "Table: B",
            "second-row-of-B",
        ].join("\n");
        expect(run(source, { seed: 1 })).toBe("second-row-of-B");
    });

    test("docs example: GetFifth → NextTable", () => {
        // The literal docs example: a single-item GetFifth calls
        // [#NextTable] which picks NextTable's item at position 1
        // (matching GetFifth's only item).
        const source = [
            "Table: GetFifth",
            "Return the fifth - [#NextTable]",
            "",
            "Table: NextTable",
            "first",
            "second",
            "third",
            "fourth",
            "fifth",
        ].join("\n");
        expect(run(source, { seed: 1 })).toBe(
            "Return the fifth - first"
        );
    });

    test("multi-item table picks the index-paired item across seeds", () => {
        // Each An item references [#B], which should resolve to
        // Bn at the same position. Across 30 seeds we'll exercise
        // multiple positions; whichever An is picked, the paired
        // Bn is what we see.
        const source = [
            "Table: A",
            "1: A1=[#B]",
            "2: A2=[#B]",
            "3: A3=[#B]",
            "4: A4=[#B]",
            "5: A5=[#B]",
            "",
            "Table: B",
            "Bone",
            "Btwo",
            "Bthree",
            "Bfour",
            "Bfive",
        ].join("\n");
        for (let seed = 1; seed <= 30; seed++) {
            const out = run(source, { seed });
            const m = out.match(/^A(\d)=B(\w+)$/);
            expect(m).not.toBeNull();
            const aIdx = parseInt(m![1], 10);
            const bWord = m![2];
            const expectedB = [
                "one",
                "two",
                "three",
                "four",
                "five",
            ][aIdx - 1];
            expect(bWord).toBe(expectedB);
        }
    });

    test("nested table calls restore outer index after popping back", () => {
        // After `[@B]` returns, the outer A's index must be back
        // on the stack so a subsequent `[#X]` in A's item sees
        // A's position. This pins the stack discipline.
        const source = [
            "Table: A",
            "1: A1: [@B] back=[#X]",
            "2: A2: [@B] back=[#X]",
            "",
            "Table: B",
            "1: b1",
            "2: b2",
            "",
            "Table: X",
            "X-pos-1",
            "X-pos-2",
        ].join("\n");
        for (let seed = 1; seed <= 20; seed++) {
            const out = run(source, { seed });
            const m = out.match(
                /^A(\d): b\d back=X-pos-(\d)$/
            );
            expect(m).not.toBeNull();
            // Whatever A item was picked, the trailing [#X]
            // resolves to A's position, not B's.
            expect(m![1]).toBe(m![2]);
        }
    });

    test("[#n table] with explicit index still uses that index", () => {
        // Sanity check: an explicit leading token bypasses the
        // current-index fallback.
        const source = [
            "Table: A",
            "[#3 B]",
            "",
            "Table: B",
            "first",
            "second",
            "third",
            "fourth",
        ].join("\n");
        expect(run(source, { seed: 1 })).toBe("third");
    });
});

describe("prompts seed label-named variables", () => {
    const { parseFileSource } = require("../../src/resolver/fileResolver");
    const src = [
        "Prompt: keeperName {} ",
        "Prompt: two words {} fallback",
        "",
        "Table: Main",
        "({$keeperName}|{$prompt1}|{$prompt2})",
    ].join("\n");

    test("identifier labels become vars; positional still works", () => {
        const f = parseFileSource("t.ipt", src);
        const out = new Evaluator(f, [], {
            promptValues: { keeperName: "Tizzy" },
        }).run();
        expect(out).toBe("(Tizzy|Tizzy|fallback)");
    });

    test("empty override falls back to default; non-identifier labels skipped", () => {
        const f = parseFileSource("t.ipt", src);
        const out = new Evaluator(f, [], {}).run();
        // {$keeperName} default is empty; "two words" only via prompt2
        expect(out).toBe("(||fallback)");
    });
});
