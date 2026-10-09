import { Evaluator, EvaluationTableSource, RecursionLimitError } from "../../src/engine/evaluator";
import { parseGeneratorFile } from "../../src/engine/fileParser";
import { GeneratorFile } from "../../src/engine/ast";

function sourceFor(rows: string, delay?: () => Promise<void>): EvaluationTableSource {
    return {
        async load(name, query) {
            await delay?.();
            if (!query) return undefined;
            return { table: parseGeneratorFile(`Table: ${name}\n${rows}`).tables[0], files: [] };
        },
        clear: jest.fn(),
    };
}

describe("one execution path for sync and async evaluation", () => {
    test.each([
        "Table: Main\n{1d6} [@3 Other >> implode]\nTable: Other\none\ntwo\nthree",
        "Set: initial={1d6}\nDefine: lazy={1d4}\nTable: Main\n{$initial} {$lazy} {lazy+1}",
        "Table: Main\n[when]{1d6}>3[do]yes[else]no[end]",
        "Table: Main\n[!4 Cards >> implode]\nTable: Cards\none\ntwo\nthree",
        "Table: Main\n[#2 Numbers] {count(Numbers)}\nTable: Numbers\nType: lookup\nRoll: 1d6\n1-3: one\n4-6: two",
        "Table: Main\n[x >> each Wrap]\nTable: Wrap\n<{$1}>",
    ])("sync and async results and dice order match: %s", async (text) => {
        const file = parseGeneratorFile(text);
        const syncDice: number[] = [];
        const asyncDice: number[] = [];
        const sync = new Evaluator(file, [], { seed: 17, onDice: (dice) => syncDice.push(dice.total) });
        const async = new Evaluator(file, [], { seed: 17, onDice: (dice) => asyncDice.push(dice.total) });
        expect(await async.runAsync()).toBe(sync.run());
        expect(asyncDice).toEqual(syncDice);
    });

    test("expressions, lazy variables, conditionals and filter arguments can suspend", async () => {
        const file = parseGeneratorFile(
            "Define: lazy=[@Q]\nTable: Main\n" +
            "{lazy+1} [when]{count(Q)}=1[do]yes[else]wrong[end] [hello >> left {$lazy}]\n" +
            "QueryTable: Q=#npc|link"
        );
        const source = sourceFor("2", async () => { await Promise.resolve(); });
        const load = jest.spyOn(source, "load");
        expect(await new Evaluator(file, [], { tableSource: source }).runAsync()).toBe("3 yes he");
        expect(load).toHaveBeenCalledTimes(1);
        expect(source.clear).toHaveBeenCalledTimes(1);
    });

    test("failed loads unwind parameter and recursion state, and clear their scope", async () => {
        const file = parseGeneratorFile(
            "Table: Main\n[@Helper with value]\nTable: Helper\n[@Q]\nQueryTable: Q=#npc|link"
        );
        let fail = true;
        const source = sourceFor("loaded", async () => {
            if (fail) throw new Error("read failed");
        });
        const evaluator = new Evaluator(file, [], { tableSource: source, maxRecursionDepth: 3 });
        await expect(evaluator.runAsync()).rejects.toThrow("read failed");
        expect(source.clear).toHaveBeenCalledTimes(1);
        fail = false;
        expect(await evaluator.evalRawTextAsync("{$1}[@Main]")).toBe("loaded");
        expect(source.clear).toHaveBeenCalledTimes(2);
    });

    test("async initializer failures can be retried without a partial initialized state", async () => {
        const file = parseGeneratorFile("Set: initial=[@Q]\nTable: Main\n{$initial}\nQueryTable: Q=#npc|link");
        let fail = true;
        const source = sourceFor("loaded", async () => { if (fail) throw new Error("initial failure"); });
        const evaluator = new Evaluator(file, [], { tableSource: source });
        await expect(evaluator.runAsync()).rejects.toThrow("initial failure");
        fail = false;
        expect(await evaluator.runAsync()).toBe("loaded");
    });

    test("dictionary keys do not load queries in other entries", async () => {
        const file = parseGeneratorFile("Table: Cards\nType: dictionary\nchosen: plain\nunused: [@Q]\nQueryTable: Q=invalid");
        const source = sourceFor("loaded");
        const load = jest.spyOn(source, "load");
        expect(await new Evaluator(file, [], { tableSource: source }).runByKeyAsync("Cards", "chosen")).toBe("plain");
        expect(load).not.toHaveBeenCalled();
    });

    test("query recursion still uses the existing depth limit", async () => {
        const file = parseGeneratorFile("QueryTable: Q=#npc|link");
        const source = sourceFor("[@Q]");
        await expect(new Evaluator(file, [], { tableSource: source, maxRecursionDepth: 5 }).runAsync())
            .rejects.toThrow(RecursionLimitError);
        expect(source.clear).toHaveBeenCalledTimes(1);
    });

    test("new definitions keep existing scope precedence and initialize once", async () => {
        const file = parseGeneratorFile("Table: Main\n[@Missing] [@Missing]\nTable: Existing\nlocal");
        const extra: GeneratorFile = parseGeneratorFile("Set: value=from import\nTable: Missing\n{$value} [@Existing]\nTable: Existing\nwrong");
        const source: EvaluationTableSource = {
            load: jest.fn(async () => ({ files: [extra] })), clear: jest.fn(),
        };
        expect(await new Evaluator(file, [], { tableSource: source }).runAsync())
            .toBe("from import local from import local");
        expect(source.load).toHaveBeenCalledTimes(1);
    });

    test("concurrent runs on one evaluator are rejected without disturbing the active scope", async () => {
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => { release = resolve; });
        const source = sourceFor("loaded", () => blocked);
        const evaluator = new Evaluator(parseGeneratorFile("QueryTable: Q=#npc|link"), [], { tableSource: source });
        const active = evaluator.runAsync();
        await expect(evaluator.runAsync()).rejects.toThrow("concurrent evaluations");
        expect(source.clear).not.toHaveBeenCalled();
        release();
        expect(await active).toBe("loaded");
        expect(source.clear).toHaveBeenCalledTimes(1);
    });
});
