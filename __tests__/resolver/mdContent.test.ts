/**
 * Tests for markdown content tables — Dice Roller merge Phase 2.
 *
 * Three layers:
 *   1. Extractor unit tests: markdown tables/lists with ^block-ids
 *      become the right TableDecls (uniform, multi-column variants,
 *      lookup form, lists, pipe masking, missing-id skips).
 *   2. Wikilink helpers: `Use: [[Note^id]]` normalisation and direct
 *      `rdm:[[Note^id]]` call detection.
 *   3. End-to-end: resolver + engine roll markdown tables through
 *      `Use:` imports and direct inline calls, including nested
 *      rollers inside cells and lookup range picks.
 */

import {
    extractMarkdownContentTables,
    wikilinkToPath,
    parseDirectWikilinkCall,
} from "../../src/resolver/mdContent";
import {
    inMemorySource,
    parseFileSource,
    resolveBundle,
    resolveUsePath,
} from "../../src/resolver/fileResolver";
import { buildInlineBundle } from "../../src/resolver/scope";
import { Evaluator } from "../../src/engine/evaluator";
import { TableDecl } from "../../src/engine/ast";

// ─── Helpers ───

function byName(decls: TableDecl[], name: string): TableDecl | undefined {
    return decls.find((t) => t.name === name);
}

function items(t: TableDecl | undefined): string[] {
    return (t?.items ?? []).map((i) => i.rawContent);
}

// ─── Extractor ───

describe("extractMarkdownContentTables", () => {
    test("single-column table with block id", () => {
        const md = [
            "Some prose.",
            "",
            "| Tavern |",
            "| ------ |",
            "| The Prancing Pony |",
            "| The Green Dragon |",
            "",
            "^taverns",
        ].join("\n");
        const decls = extractMarkdownContentTables(md);
        expect(decls).toHaveLength(1);
        expect(decls[0].name).toBe("taverns");
        expect(decls[0].type).toBe("weighted");
        expect(items(decls[0])).toEqual([
            "The Prancing Pony",
            "The Green Dragon",
        ]);
    });

    test("table without a block id is skipped", () => {
        const md = ["| A |", "| - |", "| x |"].join("\n");
        expect(extractMarkdownContentTables(md)).toHaveLength(0);
    });

    test("block id directly after the table (no blank line)", () => {
        const md = ["| A |", "| - |", "| x |", "^direct"].join("\n");
        const decls = extractMarkdownContentTables(md);
        expect(decls[0]?.name).toBe("direct");
    });

    test("multi-column table produces row, column, and xy tables", () => {
        const md = [
            "| Name | Trait |",
            "| ---- | ----- |",
            "| Alia | brave |",
            "| Borin | greedy |",
            "",
            "^npcs",
        ].join("\n");
        const decls = extractMarkdownContentTables(md);
        expect(decls.map((d) => d.name).sort()).toEqual(
            ["npcs", "npcs.Name", "npcs.Trait", "npcs.xy"].sort()
        );
        expect(items(byName(decls, "npcs"))).toEqual([
            "Alia, brave",
            "Borin, greedy",
        ]);
        expect(items(byName(decls, "npcs.Trait"))).toEqual([
            "brave",
            "greedy",
        ]);
        expect(items(byName(decls, "npcs.xy"))).toEqual([
            "Alia",
            "brave",
            "Borin",
            "greedy",
        ]);
    });

    test("lookup form: dice header + ranges (incl. en-dash and comma lists)", () => {
        const md = [
            "| dice: 1d20 | Result |",
            "| ---------- | ------ |",
            "| 1-2        | Ambush |",
            "| 3–10       | Nothing |",
            "| 11         | Merchant |",
            "| 13,14      | Storm |",
            "| 15-20      | Ruins |",
            "",
            "^encounters",
        ].join("\n");
        const decls = extractMarkdownContentTables(md);
        expect(decls).toHaveLength(1);
        const t = decls[0];
        expect(t.type).toBe("lookup");
        expect(t.rollExpr).toBe("1d20");
        expect(t.items.map((i) => i.lookupRange)).toEqual([
            [1, 2],
            [3, 10],
            [11, 11],
            [13, 13],
            [14, 14],
            [15, 20],
        ]);
        expect(t.items[3].rawContent).toBe("Storm");
        expect(t.items[4].rawContent).toBe("Storm");
    });

    test("bolded lookup keys still read as ranges (1E Inns style)", () => {
        // Authors habitually bold the dice column; Dice Roller
        // tolerated it, so we do too. Also: no space after `dice:`.
        const md = [
            "| dice:1d10 | Meal |",
            "| --------- | ---- |",
            "| **1**     | Braised beef |",
            "| **2-9**   | Roasted cod |",
            "| **10**    | Roll on a locale table |",
            "",
            "^city1",
        ].join("\n");
        const decls = extractMarkdownContentTables(md);
        expect(decls).toHaveLength(1);
        const t = decls[0];
        expect(t.type).toBe("lookup");
        expect(t.rollExpr).toBe("1d10");
        expect(t.items.map((i) => i.lookupRange)).toEqual([
            [1, 1],
            [2, 9],
            [10, 10],
        ]);
        expect(t.items[0].rawContent).toBe("Braised beef");
    });

    test("embedded dice: spans in cell text become engine dice", () => {
        // 1E Inns corpus: "Bustling `dice:1d8+5` x # Inn Rooms" —
        // Dice Roller revived such spans as live rollers in results;
        // we translate them into engine dice at extraction time.
        const md = [
            "| dice:1d4 | Patrons |",
            "| -------- | ------- |",
            "| **1**    | Empty |",
            "| **2-3**  | Bustling `dice:1d8+5` x # Inn Rooms |",
            "| **4**    | Left as-is: `dice: [[Other^tbl]]` |",
            "",
            "^patron",
        ].join("\n");
        const decls = extractMarkdownContentTables(md);
        expect(decls).toHaveLength(1);
        const items = decls[0].items;
        expect(items[1].rawContent).toBe("Bustling {1d8+5} x # Inn Rooms");
        // Table rollers aren't pure formulas — literal text survives.
        expect(items[2].rawContent).toBe(
            "Left as-is: `dice: [[Other^tbl]]`"
        );
    });

    test("bare dice header without dice: prefix also triggers lookup", () => {
        const md = [
            "| 2d6 | Mood |",
            "| --- | ---- |",
            "| 2-6 | hostile |",
            "| 7-12 | friendly |",
            "^mood",
        ].join("\n");
        const t = extractMarkdownContentTables(md)[0];
        expect(t.type).toBe("lookup");
        expect(t.rollExpr).toBe("2d6");
    });

    test("dice-like header with non-range keys stays a uniform table", () => {
        const md = [
            "| 1d20 | Result |",
            "| ---- | ------ |",
            "| low  | Ambush |",
            "| high | Ruins |",
            "^notlookup",
        ].join("\n");
        const decls = extractMarkdownContentTables(md);
        expect(byName(decls, "notlookup")?.type).toBe("weighted");
    });

    test("pipes inside wikilink aliases and escaped pipes don't split cells", () => {
        const md = [
            "| Place |",
            "| ----- |",
            "| [[Coppertown\\|the town]] |",
            "| a \\| b |",
            "^places",
        ].join("\n");
        const got = items(extractMarkdownContentTables(md)[0]);
        expect(got).toEqual(["[[Coppertown|the town]]", "a | b"]);
    });

    test("bulleted and numbered lists become tables; nesting flattens", () => {
        const md = [
            "1. first",
            "2. second",
            "   - nested",
            "",
            "^steps",
            "",
            "- alpha",
            "- beta",
            "^letters",
        ].join("\n");
        const decls = extractMarkdownContentTables(md);
        expect(items(byName(decls, "steps"))).toEqual([
            "first",
            "second",
            "nested",
        ]);
        expect(items(byName(decls, "letters"))).toEqual(["alpha", "beta"]);
    });

    test("cells keep raw generator syntax for nested rolling", () => {
        const md = [
            "| Loot |",
            "| ---- |",
            "| {2d6} gold and [@Gems] |",
            "^loot",
        ].join("\n");
        expect(items(extractMarkdownContentTables(md)[0])).toEqual([
            "{2d6} gold and [@Gems]",
        ]);
    });
});

// ─── Wikilink helpers ───

describe("wikilinkToPath", () => {
    test("plain, block-ref, heading, alias, and folder forms", () => {
        expect(wikilinkToPath("[[Note]]")).toBe("Note.md");
        expect(wikilinkToPath("[[Note^loot]]")).toBe("Note.md");
        expect(wikilinkToPath("[[Note#Heading]]")).toBe("Note.md");
        expect(wikilinkToPath("[[Note|alias]]")).toBe("Note.md");
        expect(wikilinkToPath("[[Folder/Note^id]]")).toBe("Folder/Note.md");
        expect(wikilinkToPath("[[gen.rdm]]")).toBe("gen.rdm");
    });

    test("non-wikilinks pass through as null", () => {
        expect(wikilinkToPath("common/names.ipt")).toBeNull();
        expect(wikilinkToPath("Note.md")).toBeNull();
        expect(wikilinkToPath("[[]]")).toBeNull();
    });
});

describe("parseDirectWikilinkCall", () => {
    test("wikilink with block id (and optional column) is a direct call", () => {
        expect(parseDirectWikilinkCall("[[Note^loot]]")).toEqual(
            expect.objectContaining({
                fileRef: "[[Note]]",
                tableName: "loot",
                tableCall: "[@loot]",
            })
        );
        expect(parseDirectWikilinkCall("[[Tables^npcs|Trait]]")).toEqual(
            expect.objectContaining({
                fileRef: "[[Tables]]",
                tableName: "npcs.Trait",
            })
        );
        expect(parseDirectWikilinkCall("[[Tables^npcs|xy]]")).toEqual(
            expect.objectContaining({
                fileRef: "[[Tables]]",
                tableName: "npcs.xy",
            })
        );
    });

    test("plain wikilinks and non-wikilinks are not direct calls", () => {
        expect(parseDirectWikilinkCall("[[Note]]")).toBeNull();
        expect(parseDirectWikilinkCall("[@Table]")).toBeNull();
        expect(parseDirectWikilinkCall("x [[Note^id]]")).toBeNull();
    });
});

// ─── Resolver integration ───

const TABLES_NOTE = [
    "# Random tables",
    "",
    "| Tavern |",
    "| ------ |",
    "| The Prancing Pony |",
    "",
    "^taverns",
    "",
    "| dice: 1d20 | Result |",
    "| ---------- | ------ |",
    "| 1-20       | Ambush |",
    "",
    "^encounters",
    "",
    "| Name | Trait |",
    "| ---- | ----- |",
    "| Alia | brave |",
    "",
    "^npcs",
].join("\n");

describe("resolver integration", () => {
    test("parseFileSource merges codeblock and markdown tables; codeblock wins collisions", () => {
        const md = [
            "```randomness",
            "Table: taverns",
            "From The Codeblock",
            "```",
            "",
            "| Tavern |",
            "| ------ |",
            "| From The Markdown |",
            "",
            "^taverns",
            "",
            "| Drink |",
            "| ----- |",
            "| mead |",
            "",
            "^drinks",
        ].join("\n");
        const file = parseFileSource("Note.md", md);
        const names = file.tables.map((t) => t.name);
        expect(names).toContain("taverns");
        expect(names).toContain("drinks");
        const taverns = file.tables.find((t) => t.name === "taverns")!;
        expect(taverns.items[0].rawContent).toBe("From The Codeblock");
    });

    test("Use: [[wikilink]] resolves relative to caller dir", () => {
        const source = inMemorySource({ "Camp/Tables.md": TABLES_NOTE });
        expect(
            resolveUsePath("[[Tables^taverns]]", {
                callerDir: "Camp",
                source,
            })
        ).toBe("Camp/Tables.md");
        expect(
            resolveUsePath("[[Camp/Tables]]", { callerDir: "", source })
        ).toBe("Camp/Tables.md");
    });

    test("codeblock Use: [[Note]] + [@block-id] rolls a markdown table", () => {
        const source = inMemorySource({ "Vault/Tables.md": TABLES_NOTE });
        const gen = "Use:[[Tables]]\n[@taverns]";
        const bundle = resolveBundle("Vault/note.__inline.ipt", gen, {
            callerDir: "Vault",
            source,
        });
        const ev = new Evaluator(bundle.main, bundle.extras, { seed: 1 });
        expect(ev.run()).toBe("The Prancing Pony");
    });

    test("markdown lookup table rolls through the engine", () => {
        const source = inMemorySource({ "Vault/Tables.md": TABLES_NOTE });
        const gen = "Use:[[Tables]]\n[@encounters]";
        const bundle = resolveBundle("Vault/note.__inline.ipt", gen, {
            callerDir: "Vault",
            source,
        });
        const ev = new Evaluator(bundle.main, bundle.extras, { seed: 7 });
        expect(ev.run()).toBe("Ambush"); // 1-20 covers every roll
    });

    test("inline direct call rdm:[[Note^id]] rolls the table", () => {
        const source = inMemorySource({ "Vault/Tables.md": TABLES_NOTE });
        const bundle = buildInlineBundle("[[Tables^taverns]]", {
            notePath: "Vault/note.md",
            noteSource: "Just prose, no codeblocks.",
            source,
        });
        const ev = new Evaluator(bundle.main, bundle.extras, { seed: 3 });
        expect(ev.run()).toBe("The Prancing Pony");
    });

    test("inline direct call with column pick", () => {
        const source = inMemorySource({ "Vault/Tables.md": TABLES_NOTE });
        const bundle = buildInlineBundle("[[Tables^npcs|Trait]]", {
            notePath: "Vault/note.md",
            noteSource: "",
            source,
        });
        const ev = new Evaluator(bundle.main, bundle.extras, { seed: 3 });
        expect(ev.run()).toBe("brave");
    });

    test("direct call keeps in-note codeblock tables in scope", () => {
        // The note defines a table the markdown cell calls into.
        const source = inMemorySource({
            "Vault/Tables.md": [
                "| Loot |",
                "| ---- |",
                "| a gem worth [@Value] gp |",
                "",
                "^loot",
            ].join("\n"),
        });
        const noteSource = [
            "```randomness",
            "Table: Value",
            "50",
            "```",
        ].join("\n");
        const bundle = buildInlineBundle("[[Tables^loot]]", {
            notePath: "Vault/note.md",
            noteSource,
            source,
        });
        const ev = new Evaluator(bundle.main, bundle.extras, { seed: 5 });
        expect(ev.run()).toBe("a gem worth 50 gp");
    });

    test("plain rdm:[[Note]] (no block id) is left untouched", () => {
        const source = inMemorySource({});
        const bundle = buildInlineBundle("[[Just A Link]]", {
            notePath: "Vault/note.md",
            noteSource: "",
            source,
        });
        // The expression stays a wikilink — no Use: was injected.
        const inline = bundle.main.tables[0];
        expect(inline.items[0].rawContent).toBe("[[Just A Link]]");
        expect(bundle.extras).toHaveLength(0);
    });
});

// ─── Self-import & same-note scope (regression: cycle bug) ───
//
// Found live in the RELATIONS-TEST2 vault: a note whose codeblock did
// `Use: [[The Same Note]]` blew up every inline call in the note with
// "Use: cycle detected". Self-imports must be silent no-ops, and a
// note's own markdown tables must be visible to its inline calls.

describe("self-import and same-note scope", () => {
    const NOTE = [
        "| Tavern |",
        "| ------ |",
        "| The Prancing Pony |",
        "",
        "^taverns",
        "",
        "```randomness",
        "Use: [[Self Note]]",
        "Table: Drink",
        "mead",
        "```",
    ].join("\n");

    test("a note whose codeblock Uses itself does not cycle-error", () => {
        const source = inMemorySource({ "Vault/Self Note.md": NOTE });
        const bundle = buildInlineBundle("[@Drink]", {
            notePath: "Vault/Self Note.md",
            noteSource: NOTE,
            source,
        });
        const ev = new Evaluator(bundle.main, bundle.extras, { seed: 1 });
        expect(ev.run()).toBe("mead");
    });

    test("same-note markdown tables are in inline scope without Use:", () => {
        const mdOnly = [
            "| Tavern |",
            "| ------ |",
            "| The Prancing Pony |",
            "",
            "^taverns",
        ].join("\n");
        const bundle = buildInlineBundle("[@taverns]", {
            notePath: "Vault/n.md",
            noteSource: mdOnly,
            source: inMemorySource({}),
        });
        const ev = new Evaluator(bundle.main, bundle.extras, { seed: 2 });
        expect(ev.run()).toBe("The Prancing Pony");
    });

    test("direct wikilink call pointing at the containing note works", () => {
        const source = inMemorySource({ "Vault/Self Note.md": NOTE });
        const bundle = buildInlineBundle("[[Self Note^taverns]]", {
            notePath: "Vault/Self Note.md",
            noteSource: NOTE,
            source,
        });
        const ev = new Evaluator(bundle.main, bundle.extras, { seed: 3 });
        expect(ev.run()).toBe("The Prancing Pony");
    });

    test("a generator file Using itself resolves as a no-op", () => {
        const gen = "Use: self.rdm\nTable: T\nx";
        const source = inMemorySource({ "G/self.rdm": gen });
        const bundle = resolveBundle("G/self.rdm", gen, {
            callerDir: "G",
            source,
        });
        expect(bundle.extras).toHaveLength(0);
        const ev = new Evaluator(bundle.main, [], { seed: 1 });
        expect(ev.run()).toBe("x");
    });

    test("true mutual cycles still error", () => {
        const source = inMemorySource({
            "G/a.rdm": "Use: b.rdm\nTable: A\nx",
            "G/b.rdm": "Use: a.rdm\nTable: B\ny",
        });
        expect(() =>
            resolveBundle("G/a.rdm", "Use: b.rdm\nTable: A\nx", {
                callerDir: "G",
                source,
            })
        ).toThrow(/cycle/i);
    });
});
