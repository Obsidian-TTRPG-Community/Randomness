/**
 * @jest-environment jsdom
 */

/**
 * Tests for the inline `rdm:[@` table-name autocomplete.
 *
 * Three surfaces:
 *
 *   1. Pure trigger detection — `matchTrigger` recognises the
 *      cursor-is-inside-a-`rdm:` shape and refuses everything
 *      else. Doesn't touch the DOM or the plugin.
 *
 *   2. Bundle-to-suggestions conversion — `collectTablesFromBundle`
 *      walks a bundle's extras and produces the suggestion list,
 *      including the "(this note)" source label and the
 *      first-table-is-main flag.
 *
 *   3. Full integration via TableAutocomplete — onTrigger picks
 *      up the right context, getSuggestions filters by query,
 *      selectSuggestion inserts the chosen name into the
 *      editor.
 */

import {
    TableAutocomplete,
    collectTablesFromBundle,
    matchTrigger,
    TableSuggestion,
} from "../../src/views/tableAutocomplete";
import { TFile } from "obsidian";
// MockEditor lives in __mocks__/obsidian.ts. The npm `obsidian`
// types don't know about it, so we import via the relative
// mock path. This works because jest aliases "obsidian" to the
// mock at test time.
import { MockEditor } from "../../__mocks__/obsidian";

// ────────── matchTrigger (pure) ──────────

describe("matchTrigger", () => {
    test("matches `rdm:[@` with empty query", () => {
        // The simplest case — user has just opened the bracket.
        const m = matchTrigger("some prose `rdm:[@");
        expect(m).toEqual({ triggerChar: "@", query: "" });
    });

    test("matches `rdm:[@partial`", () => {
        const m = matchTrigger("look at this: `rdm:[@first");
        expect(m).toEqual({ triggerChar: "@", query: "first" });
    });

    test("matches `rdm:[#` lookup-pick", () => {
        const m = matchTrigger("`rdm:[#3 ");
        expect(m).toEqual({ triggerChar: "#", query: "3 " });
    });

    test("matches `rdm:[!` deck pick", () => {
        const m = matchTrigger("`rdm:[!nameDeck");
        expect(m).toEqual({ triggerChar: "!", query: "nameDeck" });
    });

    test("does NOT match plain `rdm:[@` without backtick", () => {
        // Prose mentioning the syntax shouldn't trigger the popup.
        // Without an opening backtick we're not inside a code span.
        expect(matchTrigger("write rdm:[@names")).toBeNull();
    });

    test("does NOT match if the bracket is already closed", () => {
        // If there's a `]` between the `[` and the cursor, we're
        // past the trigger — autocomplete is done.
        expect(matchTrigger("`rdm:[@names]")).toBeNull();
    });

    test("does NOT match if the code span has closed", () => {
        // The `\`` closer means we're back in prose, not still
        // inside the inline call.
        expect(matchTrigger("`rdm:[@names`")).toBeNull();
    });

    test("does NOT match for plain `[@` outside a rdm: span", () => {
        expect(matchTrigger("`@something`")).toBeNull();
        expect(matchTrigger("`[@plain]`")).toBeNull();
    });

    test("anchors to the end of input", () => {
        // The regex is end-anchored. A `rdm:[@` followed by more
        // text shouldn't match (we already passed the trigger).
        // This is the same as the closed-bracket case above but
        // worth pinning explicitly — the regex shape changes
        // could break this.
        expect(matchTrigger("`rdm:[@names] and more text")).toBeNull();
    });
});

// ────────── collectTablesFromBundle (pure) ──────────

describe("collectTablesFromBundle", () => {
    test("emits one suggestion per table", () => {
        const extras = [
            {
                title: "(unused — first extra is the in-note virtual file)",
                tables: [
                    { name: "Greeting", isMain: true, inScope: true, filePath: "" },
                    { name: "Farewell", isMain: false, inScope: true, filePath: "" },
                ],
            },
        ];
        const out = collectTablesFromBundle(extras);
        expect(out).toHaveLength(2);
        expect(out[0].name).toBe("Greeting");
        expect(out[0].isMain).toBe(true);
        expect(out[1].name).toBe("Farewell");
        expect(out[1].isMain).toBe(false);
    });

    test("labels the first file as (this note)", () => {
        // buildInlineBundle puts the synthetic in-note virtual
        // file first in `extras`. We label it specially so users
        // see at a glance which tables come from their own
        // codeblocks vs imported files.
        const extras = [
            { title: "anything", tables: [{ name: "InNote" }] },
            {
                title: "Names",
                tables: [
                    { name: "FirstName" },
                    { name: "LastName" },
                ],
            },
        ];
        const out = collectTablesFromBundle(extras);
        expect(out[0].source).toBe("(this note)");
        expect(out[1].source).toBe("Names");
        expect(out[2].source).toBe("Names");
    });

    test("flags the first table in each file as main", () => {
        const extras = [
            {
                title: "",
                tables: [
                    { name: "A" },
                    { name: "B" },
                    { name: "C" },
                ],
            },
            {
                title: "Other",
                tables: [
                    { name: "X" },
                    { name: "Y" },
                ],
            },
        ];
        const out = collectTablesFromBundle(extras);
        expect(out.map((t) => [t.name, t.isMain])).toEqual([
            ["A", true],
            ["B", false],
            ["C", false],
            ["X", true],
            ["Y", false],
        ]);
    });

    test("deduplicates by lowercased name — first occurrence wins", () => {
        // Engine's behaviour: first-declared table wins when
        // multiple files have the same name. Autocomplete must
        // not lie about this — duplicate entries would suggest
        // tables that can't actually be rolled.
        const extras = [
            {
                title: "First",
                tables: [{ name: "Common" }],
            },
            {
                title: "Second",
                tables: [{ name: "Common" }, { name: "Unique" }],
            },
        ];
        const out = collectTablesFromBundle(extras);
        expect(out.map((t) => t.name)).toEqual(["Common", "Unique"]);
        // The surviving "Common" comes from the first file.
        const common = out.find((t) => t.name === "Common")!;
        expect(common.source).toBe("(this note)");
    });

    test("deduplication is case-insensitive", () => {
        // Some IPP3 corpora are casually capitalised. The
        // Evaluator normalises by lowercasing, so we should too.
        const extras = [
            { title: "A", tables: [{ name: "MyTable" }] },
            { title: "B", tables: [{ name: "mytable" }] },
        ];
        const out = collectTablesFromBundle(extras);
        expect(out).toHaveLength(1);
    });

    test("empty extras yields empty list", () => {
        expect(collectTablesFromBundle([])).toEqual([]);
    });
});

// ────────── TableAutocomplete (integration) ──────────

/**
 * Build a fake plugin with the vault + workspace methods the
 * autocomplete uses. The async vault read returns a configured
 * map of path→source.
 */
function fakePlugin(files: Record<string, string> = {}) {
    const map = new Map(Object.entries(files));
    return {
        app: {
            vault: {
                async read(file: { path: string }): Promise<string> {
                    const v = map.get(file.path);
                    if (v === undefined)
                        throw new Error(`not found: ${file.path}`);
                    return v;
                },
                getFiles(): { path: string }[] {
                    return Array.from(map.keys()).map((p) => ({
                        path: p,
                    }));
                },
                adapter: {
                    async read(path: string): Promise<string> {
                        const v = map.get(path);
                        if (v === undefined)
                            throw new Error(`not found: ${path}`);
                        return v;
                    },
                    async exists(path: string): Promise<boolean> {
                        return map.has(path);
                    },
                },
            },
            workspace: {},
            metadataCache: {},
        },
        settings: {
            generatorRoot: "",
            defaultFormatting: "html",
            stableCodeblockSeeds: false,
            browserExpandedPaths: [],
            pinnedTables: [],
        },
    };
}

/** Build a TFile-shaped object. */
function makeFile(path: string): TFile {
    const f = new TFile();
    (f as unknown as { path: string }).path = path;
    return f;
}

describe("TableAutocomplete.onTrigger", () => {
    function makeAutocomplete() {
        const p = fakePlugin();
        return new TableAutocomplete(p.app as any, p as any);
    }

    test("fires when cursor sits inside `rdm:[@`", () => {
        const ac = makeAutocomplete();
        const ed = new MockEditor(["prose `rdm:[@partial"], {
            line: 0,
            ch: 20, // end of line
        });
        const result = ac.onTrigger({ line: 0, ch: 20 }, ed as any, null);
        expect(result).not.toBeNull();
        expect(result!.query).toBe("partial");
    });

    test("returns null when cursor isn't inside a rdm: span", () => {
        const ac = makeAutocomplete();
        const ed = new MockEditor(["just some prose"], {
            line: 0,
            ch: 15,
        });
        const result = ac.onTrigger({ line: 0, ch: 15 }, ed as any, null);
        expect(result).toBeNull();
    });

    test("start position is right after the trigger char", () => {
        // "`rdm:[@x" — the @ is at column 6, the `x` (start of
        // query) is at column 7. The cursor is at column 8.
        const ac = makeAutocomplete();
        const ed = new MockEditor(["`rdm:[@x"], { line: 0, ch: 8 });
        const result = ac.onTrigger({ line: 0, ch: 8 }, ed as any, null);
        expect(result).not.toBeNull();
        expect(result!.start).toEqual({ line: 0, ch: 7 });
        expect(result!.end).toEqual({ line: 0, ch: 8 });
        expect(result!.query).toBe("x");
    });
});

describe("TableAutocomplete.getSuggestions", () => {
    test("returns tables from a note's codeblock + its Use:'d files", async () => {
        const p = fakePlugin({
            "names.ipt": [
                "Title: Names",
                "Table: FirstName",
                "Alice",
                "Bob",
                "",
                "Table: LastName",
                "Smith",
                "Jones",
            ].join("\n"),
            "note.md": [
                "# my note",
                "",
                "```randomness",
                "Use: names.ipt",
                "Table: greeting",
                "Hi",
                "Hello",
                "```",
                "",
                "Inline: `rdm:[@`",
            ].join("\n"),
        });
        const ac = new TableAutocomplete(p.app as any, p as any);
        const ctx = {
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 0 },
            query: "",
            editor: {} as any,
            file: makeFile("note.md"),
        };
        const suggestions = await ac.getSuggestions(ctx);
        const names = suggestions.map((s) => s.name);
        // Both the in-note `greeting` table and the imported
        // `FirstName`/`LastName` should appear.
        expect(names).toContain("greeting");
        expect(names).toContain("FirstName");
        expect(names).toContain("LastName");
    });

    test("filters by query (case-insensitive substring)", async () => {
        const p = fakePlugin({
            "names.ipt": [
                "Title: Names",
                "Table: FirstName",
                "Alice",
                "",
                "Table: LastName",
                "Smith",
            ].join("\n"),
            "note.md": [
                "```randomness",
                "Use: names.ipt",
                "```",
                "",
                "`rdm:[@`",
            ].join("\n"),
        });
        const ac = new TableAutocomplete(p.app as any, p as any);
        const ctx = {
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 0 },
            query: "last", // matches LastName
            editor: {} as any,
            file: makeFile("note.md"),
        };
        const suggestions = await ac.getSuggestions(ctx);
        const names = suggestions.map((s) => s.name);
        expect(names).toContain("LastName");
        expect(names).not.toContain("FirstName");
    });

    test("substring match — `name` finds FirstName AND LastName", async () => {
        const p = fakePlugin({
            "names.ipt": [
                "Title: Names",
                "Table: FirstName",
                "Alice",
                "",
                "Table: LastName",
                "Smith",
                "",
                "Table: Town",
                "Coppertown",
            ].join("\n"),
            "note.md": [
                "```randomness",
                "Use: names.ipt",
                "```",
            ].join("\n"),
        });
        const ac = new TableAutocomplete(p.app as any, p as any);
        const ctx = {
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 0 },
            query: "name",
            editor: {} as any,
            file: makeFile("note.md"),
        };
        const suggestions = await ac.getSuggestions(ctx);
        const names = suggestions.map((s) => s.name);
        expect(names).toContain("FirstName");
        expect(names).toContain("LastName");
        expect(names).not.toContain("Town");
    });

    test("returns empty when there's no scope (no codeblocks)", async () => {
        const p = fakePlugin({
            "note.md": "just prose with no randomness blocks",
        });
        const ac = new TableAutocomplete(p.app as any, p as any);
        const ctx = {
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 0 },
            query: "",
            editor: {} as any,
            file: makeFile("note.md"),
        };
        const suggestions = await ac.getSuggestions(ctx);
        expect(suggestions).toEqual([]);
    });

    test("caches results between calls on the same note", async () => {
        const map: Record<string, string> = {
            "n.ipt": "Title: N\nTable: T\nx",
            "note.md": "```randomness\nUse: n.ipt\n```",
        };
        const p = fakePlugin(map);
        // Spy on adapter.read to count vault reads.
        let readCount = 0;
        const originalRead = p.app.vault.adapter.read.bind(
            p.app.vault.adapter
        );
        p.app.vault.adapter.read = async (path: string) => {
            readCount++;
            return originalRead(path);
        };
        const ac = new TableAutocomplete(p.app as any, p as any);
        const ctx = {
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 0 },
            query: "",
            editor: {} as any,
            file: makeFile("note.md"),
        };
        await ac.getSuggestions(ctx);
        const afterFirst = readCount;
        await ac.getSuggestions(ctx);
        // Second call should not have hit the file source again.
        // (vault.read on the note is via plugin.app.vault.read,
        // not adapter.read — so we're counting Use: reads only.
        // The cache should prevent re-reading n.ipt.)
        expect(readCount).toBe(afterFirst);
    });

    test("clearCache invalidates the per-note cache", async () => {
        // After clearCache, the next call should rebuild.
        const p = fakePlugin({
            "n.ipt": "Title: N\nTable: T\nx",
            "note.md": "```randomness\nUse: n.ipt\n```",
        });
        let readCount = 0;
        const originalRead = p.app.vault.adapter.read.bind(
            p.app.vault.adapter
        );
        p.app.vault.adapter.read = async (path: string) => {
            readCount++;
            return originalRead(path);
        };
        const ac = new TableAutocomplete(p.app as any, p as any);
        const ctx = {
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 0 },
            query: "",
            editor: {} as any,
            file: makeFile("note.md"),
        };
        await ac.getSuggestions(ctx);
        const afterFirst = readCount;
        ac.clearCache();
        await ac.getSuggestions(ctx);
        // After clearing, we expect to have re-read at least once.
        expect(readCount).toBeGreaterThan(afterFirst);
    });
});

describe("TableAutocomplete.selectSuggestion", () => {
    function setupAcWithContext(
        lineContent: string,
        cursorCh: number,
        triggerStart: number
    ) {
        const p = fakePlugin();
        const ac = new TableAutocomplete(p.app as any, p as any);
        const editor = new MockEditor([lineContent], { line: 0, ch: cursorCh });
        // Inject the trigger context the way EditorSuggest would
        // normally populate it from onTrigger.
        (ac as any).context = {
            start: { line: 0, ch: triggerStart },
            end: { line: 0, ch: cursorCh },
            query: lineContent.substring(triggerStart, cursorCh),
            editor,
            file: makeFile("note.md"),
        };
        return { ac, editor };
    }

    test("inserts the chosen table name and appends `]`", () => {
        // Setup: line is "`rdm:[@", cursor at end (col 7).
        // Trigger started at col 7 (right after `@`).
        const { ac, editor } = setupAcWithContext("`rdm:[@", 7, 7);
        ac.selectSuggestion(
            { name: "Greeting", source: "(this note)", isMain: true, inScope: true, filePath: "" },
            new KeyboardEvent("keydown")
        );
        // Result: "`rdm:[@Greeting]"
        expect(editor.getValue()).toBe("`rdm:[@Greeting]");
    });

    test("does NOT double-close when `]` already follows the trigger range", () => {
        // Realistic scenario: user types `\`rdm:[@`, popup
        // appears with query "", user picks a table. We end up
        // with `\`rdm:[@TableName]`. If they then go back and
        // re-trigger autocomplete on the table-name portion
        // (cursor placed between `@` and `T`, select-all the
        // word, the trigger fires again with start=7, end=
        // wherever-cursor-is) — the `]` is already there. We
        // must not add another.
        //
        // Setup: line is "`rdm:[@TableName]"; user has the
        // entire "TableName" selected to replace. Triggered with
        // start=7, end=16 (right before the `]`).
        const line = "`rdm:[@TableName]";
        const { ac, editor } = setupAcWithContext(line, 16, 7);
        ac.selectSuggestion(
            { name: "Newish", source: "(this note)", isMain: false, inScope: true, filePath: "" },
            new KeyboardEvent("keydown")
        );
        // Expected: "`rdm:[@Newish]" — replaced "TableName" with
        // "Newish", existing `]` preserved, NO second `]` added.
        expect(editor.getValue()).toBe("`rdm:[@Newish]");
        // Single `]` overall.
        const closers = editor.getValue().match(/\]/g)?.length ?? 0;
        expect(closers).toBe(1);
    });

    test("cursor lands right after the inserted name + bracket", () => {
        const { ac, editor } = setupAcWithContext("`rdm:[@", 7, 7);
        ac.selectSuggestion(
            { name: "Hello", source: "(this note)", isMain: false, inScope: true, filePath: "" },
            new KeyboardEvent("keydown")
        );
        // "Hello]" is 6 chars; trigger started at col 7; so
        // cursor should now be at col 13.
        expect(editor.getCursor()).toEqual({ line: 0, ch: 13 });
    });
});

// ────────── Out-of-scope (v0.4.3) ──────────

/**
 * The out-of-scope behaviour: when a `.ipt` file exists in the
 * vault but isn't imported by the current note's codeblocks,
 * its tables should still appear in the autocomplete (after
 * the in-scope ones), styled as muted/secondary, and selecting
 * one should surface a Notice explaining how to import the file.
 */
describe("TableAutocomplete: out-of-scope tables", () => {
    test("vault-wide tables appear AFTER in-scope tables", async () => {
        const p = fakePlugin({
            "names.ipt": [
                "Title: Names",
                "Table: FirstName",
                "Alice",
            ].join("\n"),
            "monsters.ipt": [
                "Title: Monsters",
                "Table: Goblin",
                "weak",
            ].join("\n"),
            // Note only imports names.ipt; monsters.ipt is in the
            // vault but not in scope.
            "note.md": [
                "```randomness",
                "Use: names.ipt",
                "```",
            ].join("\n"),
        });
        const ac = new TableAutocomplete(p.app as any, p as any);
        const ctx = {
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 0 },
            query: "",
            editor: {} as any,
            file: makeFile("note.md"),
        };
        const suggestions = await ac.getSuggestions(ctx);
        // FirstName is in-scope; Goblin is out-of-scope. Both
        // should appear, in that order.
        const names = suggestions.map((s) => s.name);
        const inScopeIdx = names.indexOf("FirstName");
        const outOfScopeIdx = names.indexOf("Goblin");
        expect(inScopeIdx).toBeGreaterThanOrEqual(0);
        expect(outOfScopeIdx).toBeGreaterThanOrEqual(0);
        expect(inScopeIdx).toBeLessThan(outOfScopeIdx);
        // Tagged appropriately.
        expect(suggestions[inScopeIdx].inScope).toBe(true);
        expect(suggestions[outOfScopeIdx].inScope).toBe(false);
    });

    test("out-of-scope suggestions carry the source file path", async () => {
        const p = fakePlugin({
            "Folder/monsters.ipt": [
                "Title: Monsters",
                "Table: Goblin",
                "weak",
            ].join("\n"),
            "note.md": "plain note, no codeblocks",
        });
        const ac = new TableAutocomplete(p.app as any, p as any);
        const ctx = {
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 0 },
            query: "",
            editor: {} as any,
            file: makeFile("note.md"),
        };
        const suggestions = await ac.getSuggestions(ctx);
        const goblin = suggestions.find((s) => s.name === "Goblin");
        expect(goblin).toBeDefined();
        expect(goblin!.inScope).toBe(false);
        // The filePath is what `Use:` would need to reference.
        expect(goblin!.filePath).toBe("Folder/monsters.ipt");
    });

    test("a table that's in-scope is NOT duplicated in out-of-scope", async () => {
        // FirstName exists in names.ipt and the note imports it.
        // The autocomplete should show it ONCE (as in-scope),
        // not also again as out-of-scope.
        const p = fakePlugin({
            "names.ipt": [
                "Title: Names",
                "Table: FirstName",
                "Alice",
            ].join("\n"),
            "note.md": [
                "```randomness",
                "Use: names.ipt",
                "```",
            ].join("\n"),
        });
        const ac = new TableAutocomplete(p.app as any, p as any);
        const ctx = {
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 0 },
            query: "",
            editor: {} as any,
            file: makeFile("note.md"),
        };
        const suggestions = await ac.getSuggestions(ctx);
        const firstNameEntries = suggestions.filter(
            (s) => s.name === "FirstName"
        );
        expect(firstNameEntries).toHaveLength(1);
        expect(firstNameEntries[0].inScope).toBe(true);
    });

    test("filter applies to both lists", async () => {
        // Query "gob" should match Goblin (out-of-scope) and
        // nothing in-scope. The single out-of-scope match should
        // be the only result.
        const p = fakePlugin({
            "names.ipt": [
                "Title: Names",
                "Table: FirstName",
                "Alice",
            ].join("\n"),
            "monsters.ipt": [
                "Title: Monsters",
                "Table: Goblin",
                "weak",
                "",
                "Table: GoblinChief",
                "tough",
            ].join("\n"),
            "note.md": [
                "```randomness",
                "Use: names.ipt",
                "```",
            ].join("\n"),
        });
        const ac = new TableAutocomplete(p.app as any, p as any);
        const ctx = {
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 0 },
            query: "gob",
            editor: {} as any,
            file: makeFile("note.md"),
        };
        const suggestions = await ac.getSuggestions(ctx);
        const names = suggestions.map((s) => s.name);
        expect(names).toContain("Goblin");
        expect(names).toContain("GoblinChief");
        expect(names).not.toContain("FirstName");
    });

    test("selectSuggestion on out-of-scope creates a codeblock with Use: when none exists", () => {
        // The empty-note case. After the pick, the editor should
        // contain a new `\`\`\`randomness Use: ...` codeblock at
        // the top, plus the inline call still in place where the
        // user typed it.
        const p = fakePlugin();
        const ac = new TableAutocomplete(p.app as any, p as any);
        const editor = new MockEditor(["`rdm:[@"], {
            line: 0,
            ch: 7,
        });
        (ac as any).context = {
            start: { line: 0, ch: 7 },
            end: { line: 0, ch: 7 },
            query: "",
            editor,
            file: makeFile("note.md"),
        };
        ac.selectSuggestion(
            {
                name: "Goblin",
                source: "Monsters",
                isMain: true,
                inScope: false,
                filePath: "Folder/monsters.ipt",
            },
            new KeyboardEvent("keydown")
        );
        const value = editor.getValue();
        // Inline call inserted.
        expect(value).toContain("`rdm:[@Goblin]");
        // Codeblock created with the Use: line.
        expect(value).toContain("```randomness");
        expect(value).toContain("Use: Folder/monsters.ipt");
        // Codeblock appears BEFORE the inline call.
        expect(value.indexOf("```randomness")).toBeLessThan(
            value.indexOf("`rdm:[@Goblin]")
        );
    });

    test("selectSuggestion on out-of-scope adds Use: to an existing codeblock", () => {
        // Note already has a randomness codeblock that doesn't
        // import the chosen file. The pick should append `Use:`
        // into that codeblock — not create a new one.
        const p = fakePlugin();
        const ac = new TableAutocomplete(p.app as any, p as any);
        const lines = [
            "```randomness",
            "Use: names.ipt",
            "[@FirstName]",
            "```",
            "",
            "`rdm:[@",
        ];
        const editor = new MockEditor(lines, { line: 5, ch: 7 });
        (ac as any).context = {
            start: { line: 5, ch: 7 },
            end: { line: 5, ch: 7 },
            query: "",
            editor,
            file: makeFile("note.md"),
        };
        ac.selectSuggestion(
            {
                name: "Goblin",
                source: "Monsters",
                isMain: true,
                inScope: false,
                filePath: "monsters.ipt",
            },
            new KeyboardEvent("keydown")
        );
        const value = editor.getValue();
        // Both Use: lines are present.
        expect(value).toContain("Use: names.ipt");
        expect(value).toContain("Use: monsters.ipt");
        // Only ONE codeblock fence pair — we didn't create a
        // second codeblock when one already existed.
        const fenceCount = (value.match(/```/g) ?? []).length;
        expect(fenceCount).toBe(2);
        // Inline call still there.
        expect(value).toContain("`rdm:[@Goblin]");
    });

    test("selectSuggestion on out-of-scope is a no-op if Use: is already present", () => {
        // Edge case: somehow the table is tagged out-of-scope
        // (perhaps a stale cache) but the codeblock actually
        // already imports the file. The auto-add must not
        // duplicate the Use: line.
        const p = fakePlugin();
        const ac = new TableAutocomplete(p.app as any, p as any);
        const lines = [
            "```randomness",
            "Use: monsters.ipt",
            "```",
            "",
            "`rdm:[@",
        ];
        const editor = new MockEditor(lines, { line: 4, ch: 7 });
        (ac as any).context = {
            start: { line: 4, ch: 7 },
            end: { line: 4, ch: 7 },
            query: "",
            editor,
            file: makeFile("note.md"),
        };
        ac.selectSuggestion(
            {
                name: "Goblin",
                source: "Monsters",
                isMain: true,
                inScope: false,
                filePath: "monsters.ipt",
            },
            new KeyboardEvent("keydown")
        );
        const value = editor.getValue();
        // Only one Use: monsters.ipt line.
        const useCount = (value.match(/Use: monsters\.ipt/g) ?? [])
            .length;
        expect(useCount).toBe(1);
    });

    test("selectSuggestion on in-scope does NOT modify the codeblock", () => {
        const p = fakePlugin();
        const ac = new TableAutocomplete(p.app as any, p as any);
        const lines = [
            "```randomness",
            "Use: names.ipt",
            "```",
            "",
            "`rdm:[@",
        ];
        const editor = new MockEditor(lines, { line: 4, ch: 7 });
        const initial = editor.getValue();
        (ac as any).context = {
            start: { line: 4, ch: 7 },
            end: { line: 4, ch: 7 },
            query: "",
            editor,
            file: makeFile("note.md"),
        };
        ac.selectSuggestion(
            {
                name: "FirstName",
                source: "Names",
                isMain: true,
                inScope: true,
                filePath: "names.ipt",
            },
            new KeyboardEvent("keydown")
        );
        const value = editor.getValue();
        // No new Use: lines.
        const useCount = (value.match(/^Use:/gm) ?? []).length;
        expect(useCount).toBe(1);
        // Codeblock count unchanged.
        const initialFences = (initial.match(/```/g) ?? []).length;
        const finalFences = (value.match(/```/g) ?? []).length;
        expect(finalFences).toBe(initialFences);
    });

    test("inserts Use: after existing Use: lines, not at the top of the codeblock", () => {
        const p = fakePlugin();
        const ac = new TableAutocomplete(p.app as any, p as any);
        const lines = [
            "```randomness",
            "Use: a.ipt",
            "Use: b.ipt",
            "[@something]",
            "```",
            "",
            "`rdm:[@",
        ];
        const editor = new MockEditor(lines, { line: 6, ch: 7 });
        (ac as any).context = {
            start: { line: 6, ch: 7 },
            end: { line: 6, ch: 7 },
            query: "",
            editor,
            file: makeFile("note.md"),
        };
        ac.selectSuggestion(
            {
                name: "X",
                source: "C",
                isMain: false,
                inScope: false,
                filePath: "c.ipt",
            },
            new KeyboardEvent("keydown")
        );
        const value = editor.getValue();
        // Check the codeblock contents ordering.
        const aPos = value.indexOf("Use: a.ipt");
        const bPos = value.indexOf("Use: b.ipt");
        const cPos = value.indexOf("Use: c.ipt");
        const exprPos = value.indexOf("[@something]");
        expect(aPos).toBeLessThan(bPos);
        expect(bPos).toBeLessThan(cPos);
        expect(cPos).toBeLessThan(exprPos);
    });
});

// ────────── Helper functions (v0.4.4) ──────────

import {
    findFirstRandomnessCodeblock,
    findFrontmatterEnd,
} from "../../src/views/tableAutocomplete";

describe("findFirstRandomnessCodeblock", () => {
    test("returns null when no randomness codeblock exists", () => {
        const ed = new MockEditor([
            "# Note",
            "Just prose, no codeblocks.",
        ]);
        expect(findFirstRandomnessCodeblock(ed as any)).toBeNull();
    });

    test("returns null for ```other codeblocks", () => {
        // Codeblocks of OTHER languages (python, js, etc) must
        // not be confused for randomness blocks.
        const ed = new MockEditor([
            "```python",
            "print('hi')",
            "```",
        ]);
        expect(findFirstRandomnessCodeblock(ed as any)).toBeNull();
    });

    test("finds a simple codeblock", () => {
        const ed = new MockEditor([
            "Some prose",
            "```randomness",
            "Use: foo.ipt",
            "[@bar]",
            "```",
            "More prose",
        ]);
        const block = findFirstRandomnessCodeblock(ed as any);
        expect(block).not.toBeNull();
        expect(block!.openLine).toBe(1);
        expect(block!.contentStart).toBe(2);
        expect(block!.contentEnd).toBe(4); // line index of closing fence
    });

    test("finds the FIRST codeblock when multiple exist", () => {
        const ed = new MockEditor([
            "```randomness",
            "Use: a.ipt",
            "```",
            "",
            "```randomness",
            "Use: b.ipt",
            "```",
        ]);
        const block = findFirstRandomnessCodeblock(ed as any);
        expect(block).not.toBeNull();
        expect(block!.openLine).toBe(0);
    });

    test("tolerates trailing whitespace on the fence", () => {
        const ed = new MockEditor([
            "```randomness   ",
            "[@x]",
            "```",
        ]);
        expect(findFirstRandomnessCodeblock(ed as any)).not.toBeNull();
    });
});

describe("findFrontmatterEnd", () => {
    test("returns -1 when no frontmatter", () => {
        const ed = new MockEditor(["# Title", "body"]);
        expect(findFrontmatterEnd(ed as any)).toBe(-1);
    });

    test("finds the closing --- of a valid frontmatter", () => {
        const ed = new MockEditor([
            "---",
            "tag: foo",
            "date: 2024-01-01",
            "---",
            "# Body",
        ]);
        expect(findFrontmatterEnd(ed as any)).toBe(3);
    });

    test("returns -1 when first line is not ---", () => {
        const ed = new MockEditor([
            "# Note",
            "---",
            "this isn't frontmatter",
            "---",
        ]);
        expect(findFrontmatterEnd(ed as any)).toBe(-1);
    });

    test("returns -1 for unterminated frontmatter", () => {
        const ed = new MockEditor([
            "---",
            "tag: foo",
            "# Body without closing fence",
        ]);
        expect(findFrontmatterEnd(ed as any)).toBe(-1);
    });
});
