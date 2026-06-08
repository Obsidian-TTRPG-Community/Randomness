import { parseGeneratorFile, ParseError } from "../../src/engine/fileParser";
import * as fs from "fs";
import * as path from "path";

describe("fileParser: basic structure", () => {
    test("empty file produces empty GeneratorFile", () => {
        const f = parseGeneratorFile("");
        expect(f.tables).toHaveLength(0);
        expect(f.uses).toHaveLength(0);
    });

    test("single weighted table with no weights", () => {
        const src = `Table: Humanoid
Goblin
Kobold
Orc
Gnoll`;
        const f = parseGeneratorFile(src);
        expect(f.tables).toHaveLength(1);
        const t = f.tables[0];
        expect(t.name).toBe("Humanoid");
        expect(t.type).toBe("weighted");
        expect(t.items).toHaveLength(4);
        expect(t.items[0].rawContent).toBe("Goblin");
        expect(t.items[0].weight).toBeUndefined();
    });

    test("weighted table with explicit weights", () => {
        const src = `Table: Humanoid
2:Goblin
4:Kobold
10:Orc
Gnoll`;
        const f = parseGeneratorFile(src);
        const t = f.tables[0];
        expect(t.items[0].weight).toBe(2);
        expect(t.items[0].rawContent).toBe("Goblin");
        expect(t.items[1].weight).toBe(4);
        expect(t.items[2].weight).toBe(10);
        expect(t.items[3].weight).toBeUndefined();
    });

    test("lookup table with ranges", () => {
        const src = `Table: Humanoid
Type: Lookup
Roll: 1d10
1-2:Goblin
3-5:Kobold
6-9:Orc
10:Gnoll`;
        const f = parseGeneratorFile(src);
        const t = f.tables[0];
        expect(t.type).toBe("lookup");
        expect(t.rollExpr).toBe("1d10");
        expect(t.items[0].lookupRange).toEqual([1, 2]);
        expect(t.items[3].lookupRange).toEqual([10, 10]);
    });

    test("dictionary table with keys", () => {
        const src = `Table: hitdice
Type: Dictionary
Default: hd6
fighter: hd10
mage: hd4
cleric: hd8
thief: hd6`;
        const f = parseGeneratorFile(src);
        const t = f.tables[0];
        expect(t.type).toBe("dictionary");
        expect(t.defaultValue).toBe("hd6");
        expect(t.items[0].dictKey).toBe("fighter");
        // The single space between `:` and the value is purely
        // cosmetic — IPP3 strips it before treating the rest as
        // the item's content. Previously this was retained as
        // " hd10" (leading space), polluting all dict / lookup /
        // weighted item output.
        expect(t.items[0].rawContent).toBe("hd10");
    });
});

describe("fileParser: commands", () => {
    test("Use commands captured in order", () => {
        const src = `Use: foo.ipt
Use: bar/baz.ipt
Table: Main
item`;
        const f = parseGeneratorFile(src);
        expect(f.uses).toEqual(["foo.ipt", "bar/baz.ipt"]);
    });

    test("Header and Footer captured", () => {
        const src = `Header: My header
Footer: My footer
Table: Main
item`;
        const f = parseGeneratorFile(src);
        expect(f.header).toBe("My header");
        expect(f.footer).toBe("My footer");
    });

    test("MaxReps must be integer", () => {
        expect(() => parseGeneratorFile("MaxReps: abc")).toThrow(ParseError);
    });

    test("Formatting accepts html or text only", () => {
        expect(parseGeneratorFile("Formatting: html").formatting).toBe("html");
        expect(parseGeneratorFile("Formatting: text").formatting).toBe("text");
        expect(() => parseGeneratorFile("Formatting: rtf")).toThrow(ParseError);
    });

    test("Title captured", () => {
        const f = parseGeneratorFile("Title: My Title\nTable: T\nitem");
        expect(f.title).toBe("My Title");
    });

    test("Top-level Set assignment", () => {
        const f = parseGeneratorFile("Set: foo=bar\nTable: T\nitem");
        expect(f.topLevelSets).toHaveLength(1);
        expect(f.topLevelSets[0].name).toBe("foo");
        expect(f.topLevelSets[0].valueSource).toBe("bar");
        expect(f.topLevelSets[0].kind).toBe("set");
    });

    test("Define is a constant", () => {
        const f = parseGeneratorFile("Define: foo={3d6}\nTable: T\nitem");
        expect(f.topLevelSets[0].kind).toBe("define");
        expect(f.topLevelSets[0].valueSource).toBe("{3d6}");
    });

    test("Set inside a table goes to inTableSets", () => {
        const src = `Table: T
Set: x=1
item with {x}`;
        const f = parseGeneratorFile(src);
        expect(f.topLevelSets).toHaveLength(0);
        expect(f.tables[0].inTableSets).toHaveLength(1);
        expect(f.tables[0].inTableSets[0].name).toBe("x");
    });

    test("Prompt with pick list", () => {
        const f = parseGeneratorFile(
            "Prompt: Class {Fighter|Thief|Mage|Cleric} Fighter\nTable: T\nitem"
        );
        expect(f.prompts).toHaveLength(1);
        expect(f.prompts[0].label).toBe("Class");
        expect(f.prompts[0].options).toEqual(["Fighter", "Thief", "Mage", "Cleric"]);
        expect(f.prompts[0].defaultValue).toBe("Fighter");
    });

    test("Prompt with free-text (empty braces)", () => {
        const f = parseGeneratorFile("Prompt: Name {} Thorgrum\nTable: T\nitem");
        expect(f.prompts[0].options).toEqual([]);
        expect(f.prompts[0].defaultValue).toBe("Thorgrum");
    });

    test("Shuffle inside a table", () => {
        const src = `Table: T
Shuffle: skills
item`;
        const f = parseGeneratorFile(src);
        expect(f.tables[0].shuffleTargets).toEqual(["skills"]);
    });

    test("Default inside a table", () => {
        const src = `Table: T
Type: Lookup
Roll: 1d12
Default: Orc
1-2:Goblin`;
        const f = parseGeneratorFile(src);
        expect(f.tables[0].defaultValue).toBe("Orc");
    });
});

describe("fileParser: comments and continuations", () => {
    test("# starts a line comment", () => {
        const src = `# This is a comment
Table: T
# also a comment
item`;
        const f = parseGeneratorFile(src);
        expect(f.tables[0].items).toHaveLength(1);
    });

    test("; and // also work as line comments", () => {
        const src = `; semicolon comment
// slash comment
Table: T
item`;
        const f = parseGeneratorFile(src);
        expect(f.tables[0].items).toHaveLength(1);
    });

    test("inline // at end of an item line strips the comment", () => {
        // IPP3 spec: `//` to end of line is a comment, including
        // inline on item lines. Trailing whitespace before the
        // `//` is also stripped, so authors can write
        // `   item content   //  comment` cleanly.
        const src = `Table: T
the result // this comment must not appear in output`;
        const f = parseGeneratorFile(src);
        expect(f.tables[0].items).toHaveLength(1);
        expect(f.tables[0].items[0].rawContent).toBe("the result");
    });

    test("inline // does NOT strip when inside a `[...]` bracket", () => {
        // Filter arguments and certain inline syntaxes may use
        // `/` characters; stripping mid-bracket would corrupt the
        // call. We only strip `//` at top level (outside any
        // unclosed `[`).
        const src = `Table: T
[A // not a comment] tail`;
        const f = parseGeneratorFile(src);
        // The leading `[A // not a comment]` survives; only the
        // trailing top-level `// tail` would be stripped if it
        // existed. Here there's no top-level `//`, so the whole
        // line is kept verbatim.
        expect(f.tables[0].items[0].rawContent).toBe(
            "[A // not a comment] tail"
        );
    });

    test("& at end of line continues to next", () => {
        const src = `Table: T
this line continues &
to the next`;
        const f = parseGeneratorFile(src);
        expect(f.tables[0].items).toHaveLength(1);
        expect(f.tables[0].items[0].rawContent).toBe("this line continues to the next");
    });

    test("CRLF line endings normalised", () => {
        const src = "Table: T\r\nitem1\r\nitem2\r\n";
        const f = parseGeneratorFile(src);
        expect(f.tables[0].items).toHaveLength(2);
    });
});

describe("fileParser: multiple tables", () => {
    test("multiple tables separated by Table: commands", () => {
        const src = `Table: A
a-item
Table: B
b-item1
b-item2`;
        const f = parseGeneratorFile(src);
        expect(f.tables).toHaveLength(2);
        expect(f.tables[0].name).toBe("A");
        expect(f.tables[1].items).toHaveLength(2);
    });

    test("EndTable closes a table", () => {
        const src = `Table: A
item
EndTable:
Set: x=top`;
        const f = parseGeneratorFile(src);
        expect(f.tables).toHaveLength(1);
        expect(f.topLevelSets).toHaveLength(1);
    });

    test("first table is main", () => {
        const src = `Table: Main
[@Sub]
Table: Sub
sub-content`;
        const f = parseGeneratorFile(src);
        expect(f.tables[0].name).toBe("Main");
    });
});

describe("fileParser: corpus regression", () => {
    const corpusDir = path.resolve(__dirname, "../../corpus");

    test("Orc Clan Name parses", () => {
        const src = fs.readFileSync(path.join(corpusDir, "Orc Clan Name.ipt"), "utf8");
        const f = parseGeneratorFile(src);
        expect(f.uses).toEqual(["nbos\\names\\orc.ipt"]);
        expect(f.tables).toHaveLength(1);
        expect(f.tables[0].name).toBe("RandomOrcClan");
        expect(f.tables[0].items[0].rawContent).toBe("[@OrcClan]");
    });

    test("Common Place names parses", () => {
        const src = fs.readFileSync(path.join(corpusDir, "Common Place names.ipt"), "utf8");
        const f = parseGeneratorFile(src);
        // Multiple tables: Prime, Common Place Names, Num, table1-4, Colors, Colors2
        expect(f.tables.length).toBeGreaterThanOrEqual(7);
        expect(f.tables[0].name).toBe("Prime");
    });

    test("Spell Book parses with Define and HTML", () => {
        const src = fs.readFileSync(path.join(corpusDir, "Spell Book.ipt"), "utf8");
        const f = parseGeneratorFile(src);
        expect(f.uses).toEqual(["srd\\MageSpells.ipt"]);
        expect(f.header).toContain("Random Wizard Spellbook");
        expect(f.topLevelSets.length).toBeGreaterThanOrEqual(4);
        const numLoSpells = f.topLevelSets.find(s => s.name === "NumLoSpells");
        expect(numLoSpells?.kind).toBe("define");
        expect(numLoSpells?.valueSource).toBe("{1d7+5}");
        expect(f.tables[0].name).toBe("Spellbook");
        expect(f.tables[0].rollExpr).toBe("1d102");
    });

    test("Picked Pockets parses with weighted entries and inline picks", () => {
        const src = fs.readFileSync(path.join(corpusDir, "Picked Pockets.ipt"), "utf8");
        const f = parseGeneratorFile(src);
        expect(f.header).toBeDefined();
        const pickPocket = f.tables.find(t => t.name === "PickPocket");
        expect(pickPocket).toBeDefined();
        expect(pickPocket?.items[0].weight).toBe(22);
    });

    test("Random Treasure CR1-CR30 parses with prompts and conditionals", () => {
        const src = fs.readFileSync(
            path.join(corpusDir, "Random Treasure CR1-CR30.ipt"),
            "utf8"
        );
        const f = parseGeneratorFile(src);
        expect(f.prompts).toHaveLength(1);
        expect(f.prompts[0].label).toBe("Choose a CR (1-30)");
        expect(f.prompts[0].options).toContain("Random");
        expect(f.prompts[0].options).toContain("30");
        expect(f.uses).toEqual(["common/srd/SRDTreasure.ipt"]);
        const proxy = f.tables.find(t => t.name === "TreasureProxy");
        expect(proxy).toBeDefined();
        // Contains [when]...[do]...[end] in raw content
        expect(proxy?.items[0].rawContent).toContain("[when]");
        expect(proxy?.items[0].rawContent).toContain("[end]");
    });

    // ── Implicit __main__ table for orphan items ─────────────────
    //
    // Codeblocks in notes often have just a `Use:` directive plus
    // one or two bare `[@Table]` calls — no explicit `Table:` of
    // their own. Pre-fix, the parser silently dropped those items
    // and the evaluator returned an empty string. These tests pin
    // the new behaviour: orphan items become an implicit `__main__`
    // table that becomes the file's main entry.

    describe("implicit __main__ table for orphan items", () => {
        test("bare item after Use: becomes implicit main", () => {
            const f = parseGeneratorFile("Use: Other.ipt\n[@Thing]\n");
            expect(f.uses).toEqual(["Other.ipt"]);
            expect(f.tables).toHaveLength(1);
            expect(f.tables[0].name).toBe("__main__");
            expect(f.tables[0].items).toHaveLength(1);
            expect(f.tables[0].items[0].rawContent).toBe("[@Thing]");
        });

        test("multiple orphan items collect into one implicit main", () => {
            const src = "Use: X.ipt\nLine one\nLine two\nLine three\n";
            const f = parseGeneratorFile(src);
            expect(f.tables).toHaveLength(1);
            expect(f.tables[0].name).toBe("__main__");
            expect(f.tables[0].items.map(i => i.rawContent)).toEqual([
                "Line one",
                "Line two",
                "Line three"
            ]);
        });

        test("orphan items before explicit Table: still get implicit main", () => {
            const src = `Use: X.ipt
[@Thing]
Table: Other
foo
bar
`;
            const f = parseGeneratorFile(src);
            expect(f.tables).toHaveLength(2);
            // __main__ is first — evaluator picks tables[0]
            expect(f.tables[0].name).toBe("__main__");
            expect(f.tables[0].items[0].rawContent).toBe("[@Thing]");
            // Explicit table preserved
            expect(f.tables[1].name).toBe("Other");
            expect(f.tables[1].items).toHaveLength(2);
        });

        test("file starting with explicit Table: behaves unchanged", () => {
            // Regression guard: pre-fix behaviour for files that
            // declare their main table explicitly. No __main__
            // should be synthesised in this case.
            const src = `Table: Foo
one
two

Table: Bar
three
`;
            const f = parseGeneratorFile(src);
            expect(f.tables).toHaveLength(2);
            expect(f.tables[0].name).toBe("Foo");
            expect(f.tables[1].name).toBe("Bar");
            expect(f.tables.some(t => t.name === "__main__")).toBe(false);
        });

        test("Use:-only file (no items) has no implicit main", () => {
            const f = parseGeneratorFile("Use: X.ipt\n");
            expect(f.tables).toHaveLength(0);
            expect(f.uses).toEqual(["X.ipt"]);
        });
    });
});
