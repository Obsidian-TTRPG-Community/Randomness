/**
 * Recursion-depth guard for the evaluator.
 *
 * The corpus's AddCommas function proves legitimate recursion is in
 * scope — it calls itself once per group of three digits. A malformed
 * generator can recurse forever; without a guard, that's a stack
 * overflow with no helpful message. The guard throws RecursionLimitError
 * before the stack tips over.
 *
 * Tests here go directly through the Evaluator with synthetic
 * GeneratorFiles (no parser involvement) to keep the cases minimal and
 * the assertions sharp.
 */

import {
    Evaluator,
    RecursionLimitError,
} from "../../src/engine/evaluator";
import { GeneratorFile, TableDecl } from "../../src/engine/ast";

function makeFile(tables: TableDecl[]): GeneratorFile {
    return {
        uses: [],
        topLevelSets: [],
        prompts: [],
        tables,
        formatting: "text",
    };
}

function tbl(name: string, items: { rawContent: string; weight?: number }[]): TableDecl {
    return {
        name,
        type: "weighted",
        shuffleTargets: [],
        inTableSets: [],
        items: items.map((i) => ({ weight: i.weight ?? 1, rawContent: i.rawContent })),
    };
}

describe("evaluator: recursion guard", () => {
    test("self-recursive table with no base case throws RecursionLimitError", () => {
        // Single table, single item, item is "[@Loop]" → calls itself.
        const file = makeFile([tbl("Loop", [{ rawContent: "[@Loop]" }])]);
        const e = new Evaluator(file, [], { seed: 1 });
        expect(() => e.run()).toThrow(RecursionLimitError);
    });

    test("error message names the offending table", () => {
        const file = makeFile([tbl("Bottomless", [{ rawContent: "[@Bottomless]" }])]);
        const e = new Evaluator(file, [], { seed: 1 });
        try {
            e.run();
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(RecursionLimitError);
            const re = err as RecursionLimitError;
            expect(re.tableName.toLowerCase()).toBe("bottomless");
            expect(re.message).toMatch(/recursion limit/i);
        }
    });

    test("indirect (mutual) recursion is also caught", () => {
        // A calls B, B calls A — same outcome, just one level of indirection.
        const file = makeFile([
            tbl("A", [{ rawContent: "[@B]" }]),
            tbl("B", [{ rawContent: "[@A]" }]),
        ]);
        const e = new Evaluator(file, [], { seed: 1 });
        expect(() => e.run()).toThrow(RecursionLimitError);
    });

    test("custom maxRecursionDepth is honoured", () => {
        // With a very small budget, even a short chain trips the guard.
        const file = makeFile([tbl("Loop", [{ rawContent: "[@Loop]" }])]);
        const e = new Evaluator(file, [], { seed: 1, maxRecursionDepth: 5 });
        try {
            e.run();
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(RecursionLimitError);
            expect((err as RecursionLimitError).depth).toBe(5);
        }
    });

    test("legitimate bounded recursion completes (corpus AddCommas runs)", () => {
        // The clearest proof that legitimate recursion is unaffected is
        // running the actual corpus stress-test file — the existing
        // integration suite already covers it, but we re-run it here
        // explicitly with a budget that's well above its real depth
        // (which tops out under 10) to make the assertion about the
        // guard concrete.
        //
        // We invoke AddCommas directly via evalRawText rather than the
        // file's main table, because the main table now (correctly)
        // throws "Unknown table" when its Use'd dependencies aren't
        // present. AddCommas itself is self-contained — it recurses
        // on itself — so it exercises the recursion guard cleanly.
        const fs = require("fs") as typeof import("fs");
        const path = require("path") as typeof import("path");
        const { parseGeneratorFile } = require("../../src/engine/fileParser") as typeof import("../../src/engine/fileParser");
        const corpus = fs.readFileSync(
            path.resolve(__dirname, "../../corpus/Random Treasure CR1-CR30.ipt"),
            "utf8"
        );
        const file = parseGeneratorFile(corpus);
        const e = new Evaluator(file, [], { seed: 42, maxRecursionDepth: 50 });
        // AddCommas recurses on itself; should complete without
        // tripping the guard.
        expect(() => e.evalRawText("[@AddCommas with 123456]")).not.toThrow();
        expect(e.evalRawText("[@AddCommas with 123456]")).toBe("123,456");
    });

    test("depth counter is reset between top-level reps", () => {
        // Run a normal generator across many reps — depth must not leak
        // upward across reps (else the second rep would start partway up
        // the budget and could falsely trip).
        const file = makeFile([
            tbl("Greeting", [{ rawContent: "hello" }]),
        ]);
        const e = new Evaluator(file, [], { seed: 1, reps: 50, maxRecursionDepth: 2 });
        // 50 sequential reps at depth 1 each, with a budget of 2 — fine
        // unless depth carries over.
        expect(() => e.run()).not.toThrow();
    });

    test("guard does not interfere with each-filter table calls under the limit", () => {
        // `each Tag` runs an inner table per item — that goes through runTable.
        // A list of 3 items with budget 5 should be fine; one round of each
        // adds one level of depth, not three.
        const file = makeFile([
            tbl("Main", [{ rawContent: "[@List >> each Wrap]" }]),
            tbl("List", [{ rawContent: "[|alpha|beta|gamma]" }]),
            tbl("Wrap", [{ rawContent: "<{$1}>" }]),
        ]);
        const e = new Evaluator(file, [], { seed: 1, maxRecursionDepth: 10 });
        expect(() => e.run()).not.toThrow();
    });
});
