import { parseGeneratorFile } from "../../src/engine/fileParser";
import { Evaluator, EvaluatorOptions } from "../../src/engine/evaluator";
import { RNG } from "../../src/engine/rng";
import { inMemorySource, parseFileSource, resolveBundle } from "../../src/resolver/fileResolver";
import { parseDirectTagCall, sampleTagFiles, TagRollFilter, TAG_FILE_CAP } from "../../src/resolver/mdContent";
import { nativeQueryItems, parseQueryTableSource } from "../../src/resolver/nativeQuery";
import { createQueryTableSource, QueryTableOptions } from "../../src/resolver/queryTables";
import { buildInlineBundle } from "../../src/resolver/scope";

function harness(
    files: Record<string, string> = {},
    paths = Object.keys(files).sort(),
    metadata: Record<string, Record<string, unknown>> = {}
) {
    const read = jest.fn(async (path: string) => files[path] ?? null);
    const lookup = jest.fn((_filter: TagRollFilter) => paths);
    const options: QueryTableOptions = {
        source: { read, exists: async (path) => path in files },
        files: lookup,
        frontmatter: (path) => metadata[path],
        seed: 123,
    };
    const evaluator = (
        source: string,
        overrides: Partial<QueryTableOptions> = {},
        evaluation: EvaluatorOptions = {}
    ) => {
        const bundle = { main: parseGeneratorFile(source), extras: [], loadedPaths: ["test.rdm"] };
        return new Evaluator(bundle.main, [], {
            seed: 123, ...evaluation,
            tableSource: createQueryTableSource(bundle, { ...options, ...overrides }),
        });
    };
    return { options, read, lookup, evaluator };
}

describe("QueryTable declarations", () => {
    test("split only the first equals sign and retain declaration order", () => {
        const file = parseGeneratorFile(
            "qUeRyTaBlE : Merchants = #npc|universe=Eldara|link\nTable: Main\n[@Merchants]"
        );
        expect(file.tables.map((table) => table.name)).toEqual(["Merchants", "Main"]);
        expect(file.tables[0].query).toEqual({ source: "#npc|universe=Eldara|link", line: 1 });
        expect(file.tables[0].items).toEqual([]);
    });

    test.each([
        ["QueryTable: Missing", "expected Name=query"],
        ["QueryTable: =#npc", "must not be empty"],
        ["QueryTable: N=", "must not be empty"],
        ["QueryTable: N=#npc\nHandwritten", "handwritten"],
        ["QueryTable: N=#npc\nType: lookup", "weighted"],
        ["QueryTable: N=#npc\nType: dictionary", "weighted"],
        ["QueryTable: N=#npc\nRoll: 1d6", "Roll:"],
        ["QueryTable: N=#npc\nDeck: persistent", "persistent"],
    ])("reject %s", (source, message) => {
        expect(() => parseGeneratorFile(source)).toThrow(message);
    });

    test("accept ordinary metadata and retain a trailing ampersand", () => {
        const file = parseGeneratorFile(
            "QueryTable: N=#npc|prop:{{name}} &\nHidden: yes\nDefault: nobody\n" +
            "Deck: session\nType: weighted\nSet: x=1\nFlip: 50%\nTurn: half\nShuffle: Other\nEndTable:"
        );
        expect(file.tables[0]).toMatchObject({
            hidden: true, defaultValue: "nobody", deckPersistent: false,
            query: { source: "#npc|prop:{{name}} &" }, shuffleTargets: ["Other"],
        });
    });

    test("preserve names and provenance in markdown and imports", () => {
        const md = "```randomness\nQueryTable: People=#npc|link\n```";
        expect(parseFileSource("People.md", md).tables[0].query?.path).toBe("People.md");
        const bundle = resolveBundle("Main.rdm", "Use: People.md\nTable: Main\n[@People]", {
            callerDir: "", source: inMemorySource({ "People.md": md }),
        });
        expect(bundle.extras[0].tables[0].name).toBe("People");
    });

    test.each(["nonsense", "#npc|folder={$place}|link"])("reject malformed source %s", (source) => {
        expect(() => parseQueryTableSource(source)).toThrow();
    });

    test("retain inline controls and template-owned text", () => {
        expect(parseQueryTableSource("3#npc|unique|sep:;|link")).toMatchObject({
            reps: "3", unique: true, sep: ";", mode: "link",
        });
        expect(parseQueryTableSource("#npc|prop:{{name}}|unique|sep:;").template)
            .toBe("{{name}}|unique|sep:;");
        expect(parseGeneratorFile("QueryTable: Q=#npc|prop:{{name}} https://example.com/a=b|literal")
            .tables[0].query?.source).toBe("#npc|prop:{{name}} https://example.com/a=b|literal");
    });

    test("a synchronous evaluation still requires prepared query rows", () => {
        expect(() => new Evaluator(parseGeneratorFile("QueryTable: N=#npc|link")).run())
            .toThrow("must be prepared");
    });
});

describe("lazy query evaluation", () => {
    test("500 notes and 20 unused queries cause no metadata scans or candidate reads", async () => {
        const notes = Object.fromEntries(Array.from({ length: 500 }, (_, n) => [`N${n}.md`, "A block."]));
        const h = harness(notes);
        const source = "Table: Main\nplain result\n" + Array.from({ length: 20 }, (_, n) =>
            `QueryTable: Unused${n}=#tag${n}${n % 2 ? "|link" : ""}`
        ).join("\n");
        expect(await h.evaluator(source).runAsync()).toBe("plain result");
        expect(h.lookup).not.toHaveBeenCalled();
        expect(h.read).not.toHaveBeenCalled();
    });

    test("untaken branches, unselected rows, defaults and lazy definitions do not run queries", async () => {
        const h = harness({}, ["A.md"]);
        const source =
            "Define: unused=[@Unused]\nTable: Main\n" +
            "[when]1[do]plain[else][@Unused][end]\n" +
            "Default: [@Unused]\nTable: Rows\nplain row\n[@Unused]\nQueryTable: Unused=invalid";
        const evaluator = h.evaluator(source);
        expect(await evaluator.runAsync()).toBe("plain");
        expect(await evaluator.evalRawTextAsync("[#1 Rows]")).toBe("plain row");
        expect(h.lookup).not.toHaveBeenCalled();
    });

    test("dynamic names load exactly the table chosen at runtime", async () => {
        const h = harness({}, ["A.md"]);
        const evaluator = h.evaluator(
            "Table: Main\n[@{$which}]\nQueryTable: Wanted=#npc|link\nQueryTable: Other=invalid",
            {}, { presetVars: { which: "Wanted" } }
        );
        expect(await evaluator.runAsync()).toBe("[[A|A]]");
        expect(h.lookup).toHaveBeenCalledTimes(1);
        expect(h.lookup).toHaveBeenCalledWith(expect.objectContaining({ tagGroups: [["npc"]] }));
    });

    test("a named roll does not load the defining file's main query", async () => {
        const h = harness({}, ["A.md"]);
        expect(await h.evaluator(
            "QueryTable: Main=invalid\nTable: Named\n[@Q]\nQueryTable: Q=#npc|link"
        ).runByNameAsync("Named")).toBe("[[A|A]]");
        expect(h.lookup).toHaveBeenCalledTimes(1);
    });

    test.each(["link", "linkpath", "prop:{{name}}"])("inline controls leave %s rows unchanged", async (mode) => {
        const h = harness({}, ["A.md", "B.md", "C.md"]);
        for (const controls of ["", "3", "0", "{1d4}"]) {
            expect(await h.evaluator(`QueryTable: Q=${controls}#npc|unique|sep:;|${mode}`).evalRawTextAsync("{count(Q)}"))
                .toBe("3");
        }
        expect(h.read).not.toHaveBeenCalled();
    });

    test.each(["#npc|link", "#npc|linkpath", "#npc|prop:rumours", "#npc|prop:{{name}} ({{cr}})"])(
        "preserve inline row selection for %s", async (query) => {
            const paths = ["A.md", "B.md", "C.md"];
            const fm = Object.fromEntries(paths.map((path) => [path, { cr: 3, rumours: ["one", "two"] }]));
            const h = harness({}, paths, fm);
            const inline = buildInlineBundle(query, {
                notePath: "note.md", noteSource: "", source: inMemorySource({}),
                tagFiles: h.lookup, tagFrontmatter: h.options.frontmatter,
            });
            for (const seed of [1, 7, 123, 999]) {
                expect(await h.evaluator(`Table: Main\n[@Q]\nQueryTable: Q=${query}`, { seed }, { seed }).runAsync())
                    .toBe(new Evaluator(inline.main, inline.extras, { seed }).run());
            }
            expect(h.read).not.toHaveBeenCalled();
        }
    );

    test("list values and hyphenated properties remain literal data", async () => {
        for (const key of ["-", "-value", "challenge-rating"]) {
            const h = harness({}, ["A.md"], { "A.md": { [key]: ["[@Missing]", "{1d6}"] } });
            expect(await h.evaluator(`QueryTable: Q=#npc|prop:{{${key}}}`).runAsync()).toBe("[@Missing], {1d6}");
        }
    });

    test("empty results, defaults, indexed picks and session draws retain table behavior", async () => {
        const empty = harness({}, []);
        expect(await empty.evaluator("QueryTable: Q=#npc|link").runAsync()).toBe("");
        expect(await empty.evaluator("QueryTable: Q=#npc|link\nDefault: nobody").runAsync()).toBe("nobody");
        const h = harness({}, ["A.md", "B.md", "C.md"]);
        expect(await h.evaluator("QueryTable: Q=#npc|link").evalRawTextAsync("[#2 Q]")).toBe("[[B|B]]");
        const result = await h.evaluator("QueryTable: Q=#npc|link").evalRawTextAsync("[!4 Q >> implode]");
        const draws = result.match(/\[\[[ABC]\|[ABC]\]\]/g);
        expect(draws).toHaveLength(3);
        expect(new Set(draws).size).toBe(3);
    });

    test("query rows are reused within a scope and discarded on completion", async () => {
        const fm = { "A.md": { value: "old" } };
        const h = harness({}, ["A.md"], fm);
        const evaluator = h.evaluator("QueryTable: Q=#npc|prop:value");
        expect(await evaluator.evalRawTextAsync("[@Q] [@Q] {count(Q)}")).toBe("old old 1");
        expect(h.lookup).toHaveBeenCalledTimes(1);
        fm["A.md"].value = "new";
        expect(await evaluator.evalRawTextAsync("[@Q]")).toBe("new");
        expect(h.lookup).toHaveBeenCalledTimes(2);
    });

    test("session query draws reset between async scopes", async () => {
        const h = harness({}, ["A.md"]);
        const evaluator = h.evaluator("QueryTable: Q=#npc|link");
        expect(await evaluator.evalRawTextAsync("[!Q] / [!Q]")).toBe("[[A|A]] / ");
        expect(await evaluator.evalRawTextAsync("[!Q]")).toBe("[[A|A]]");
        expect(h.lookup).toHaveBeenCalledTimes(2);
    });

    test("loading leaves the original parsed declarations unchanged", async () => {
        const h = harness({}, ["A.md"]);
        const main = parseGeneratorFile("QueryTable: Q=#npc|link");
        const bundle = { main, extras: [], loadedPaths: [] };
        expect(await new Evaluator(main, [], { tableSource: createQueryTableSource(bundle, h.options) }).runAsync())
            .toBe("[[A|A]]");
        expect(main.tables[0].query).toEqual({ source: "#npc|link", line: 1 });
        expect(main.tables[0].items).toEqual([]);
        expect(bundle.extras).toEqual([]);
        expect(bundle.loadedPaths).toEqual([]);
    });

    test("block mode chooses a note first and reads only that selected note", async () => {
        const files = { "A.md": "Only block", "B.md": "First\n\nSecond\n\nThird" };
        const h = harness(files);
        const inline = buildInlineBundle("#rumour", {
            notePath: "note.md", noteSource: "", source: inMemorySource(files), tagFiles: h.lookup,
        });
        for (const seed of [1, 7, 123, 999]) {
            h.read.mockClear();
            expect(await h.evaluator("Table: Main\n[@Q]\nQueryTable: Q=#rumour", { seed }, { seed }).runAsync())
                .toBe(new Evaluator(inline.main, inline.extras, { seed }).run());
            expect(h.read).toHaveBeenCalledTimes(1);
        }
    });

    test("sample exactly 50 candidates without reading all 50 bodies", async () => {
        const paths = Array.from({ length: 100 }, (_, n) => `N${n}.md`).sort();
        const notes = Object.fromEntries(paths.map((path) => [path, `Block ${path}`]));
        const h = harness(notes, paths);
        const result = await h.evaluator("QueryTable: Q=#rumour").runAsync();
        expect(sampleTagFiles(paths, TAG_FILE_CAP, new RNG(123))).toContain(h.read.mock.calls[0][0]);
        expect(h.read).toHaveBeenCalledTimes(1);
        expect(result).toMatch(/^Block N\d+\.md$/);
    });

    test("same filter and selected note are loaded once within a scope", async () => {
        const h = harness({ "A.md": "block" });
        expect(await h.evaluator(
            "Table: Main\n[@A] [@B] [@A]\nQueryTable: A=#rumour\nQueryTable: B=#rumour"
        ).runAsync()).toBe("block block block");
        expect(h.lookup).toHaveBeenCalledTimes(1);
        expect(h.read).toHaveBeenCalledTimes(1);
    });

    test("identical basenames use separate private block helpers", async () => {
        const h = harness({ "One/Same.md": "one", "Two/Same.md": "two" });
        expect(await h.evaluator("QueryTable: Q=#rumour").evalRawTextAsync("[#1 Q] / [#2 Q]")).toBe("one / two");
    });

    test("note imports and new queries load only when block content calls them", async () => {
        const h = harness({
            "A.md": "[@Needed]\n\n```randomness\nUse: Helpers.rdm\n```",
            "Helpers.rdm": "QueryTable: Needed=#npc|link\nQueryTable: Unused=invalid",
        }, ["A.md"]);
        expect(await h.evaluator("QueryTable: Q=#rumour").evalRawTextAsync("[@Q]")).toContain("[[A|A]]");
        expect(h.lookup.mock.calls.map(([filter]) => filter.tagGroups)).toEqual([[["rumour"]], [["npc"]]]);
    });

    test("runtime discovery handles templates, expression calls, counts and filter targets", async () => {
        const h = harness({ "Other.rdm": "QueryTable: Other=#npc|prop:cr" }, ["A.md"], { "A.md": { cr: 3 } });
        const resolve = jest.fn((name: string) => name === "other" ? ["Other.rdm"] : []);
        const evaluator = h.evaluator("QueryTable: Q=#npc|prop:{{name}} [@Other]", { resolveTableName: resolve });
        expect(await evaluator.runAsync()).toBe("A 3");
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(await evaluator.evalRawTextAsync("{[@Other]+1} {count(Other)} [x >> each Other]")).toBe("4 1 3");
    });

    test("resuming loads does not replay dice, assignments or committed draws", async () => {
        const h = harness({}, ["A.md"]);
        const dice: number[] = [];
        const draw = jest.fn(() => 0);
        const evaluator = h.evaluator(
            "Table: Main\n[!Deck]\nTable: Deck\nDeck: persistent\n{1d6} [@Q] {1d6}\nQueryTable: Q=#npc|link",
            {}, { deckHost: { draw, reset() {} }, onDice: (entry) => dice.push(entry.total) }
        );
        expect(await evaluator.runAsync()).toMatch(/^\d \[\[A\|A\]\] \d$/);
        expect(draw).toHaveBeenCalledTimes(1);
        expect(dice).toHaveLength(2);
        expect(h.lookup).toHaveBeenCalledTimes(1);
    });

    test("eager assignments load queries before the entry, lazy definitions only when used", async () => {
        const h = harness({}, ["A.md"]);
        expect(await h.evaluator(
            "Set: initial=[@Q]\nDefine: unused=[@Bad]\nTable: Main\n{$initial}\nQueryTable: Q=#npc|link\nQueryTable: Bad=invalid"
        ).runAsync()).toBe("[[A|A]]");
        expect(h.lookup).toHaveBeenCalledTimes(1);
    });

    test("load failures clear the scope cache and preserve query provenance", async () => {
        const notes: Record<string, string> = {};
        const h = harness(notes, ["A.md"]);
        const evaluator = h.evaluator("QueryTable: Q=#rumour");
        await expect(evaluator.runAsync()).rejects.toThrow("query candidate");
        notes["A.md"] = "now available";
        expect(await evaluator.runAsync()).toBe("now available");
        await expect(h.evaluator("QueryTable: Q=invalid").runAsync()).rejects.toThrow("QueryTable 'Q'");
        await expect(h.evaluator("QueryTable: Q=#npc|link", {
            files: () => { throw new Error("metadata offline"); },
        }).runAsync()).rejects.toThrow("metadata offline");
    });

    test("shadowed queries are not evaluated", async () => {
        const main = parseGeneratorFile("Table: Main\n[@Q]\nQueryTable: Q=invalid");
        const extras = [parseGeneratorFile("Table: Q\nwinner")];
        const h = harness();
        const bundle = { main, extras, loadedPaths: [] };
        expect(await new Evaluator(main, extras, { tableSource: createQueryTableSource(bundle, h.options) }).runAsync())
            .toBe("winner");
        expect(h.lookup).not.toHaveBeenCalled();
    });

    test("the shared row builder reports an unavailable property provider", () => {
        const query = parseDirectTagCall("#npc|prop:name");
        if (!query) throw new Error("Fixture did not parse");
        expect(() => nativeQueryItems(query, ["A.md"])).toThrow("metadata cache");
    });
});
