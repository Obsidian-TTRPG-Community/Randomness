import { parseGeneratorFile } from "../../src/engine/fileParser";
import { Evaluator } from "../../src/engine/evaluator";
import * as fs from "fs";
import * as path from "path";

const corpusDir = path.resolve(__dirname, "../../corpus");

function loadFile(name: string) {
    return fs.readFileSync(path.join(corpusDir, name), "utf8");
}

describe("corpus regression: simple weighted tables", () => {
    test("Common Place names produces non-empty output across many seeds", () => {
        const file = parseGeneratorFile(loadFile("Common Place names.ipt"));
        // Run 50 times with different seeds, all should produce something
        for (let seed = 1; seed <= 50; seed++) {
            const e = new Evaluator(file, [], { seed });
            const out = e.run();
            expect(out.length).toBeGreaterThan(0);
            // Place names shouldn't contain unprocessed bracket syntax
            expect(out).not.toMatch(/\[@/);
            expect(out).not.toMatch(/\{[0-9]+d[0-9]+\}/);
        }
    });

    test("Common Place names — specific table runByName", () => {
        const file = parseGeneratorFile(loadFile("Common Place names.ipt"));
        const e = new Evaluator(file, [], { seed: 42 });
        // The Colors table is simple — should produce one of the listed colors
        const result = e.runByName("Colors");
        expect(["Green", "Black", "Red", "Purple", "Grey", "Blue"]).toContain(result);
    });

    test("Common Place names — lookup table Num gives prefix or empty", () => {
        const file = parseGeneratorFile(loadFile("Common Place names.ipt"));
        // The Num table: 1-75 empty, 76-86 "Two-", 87-95 "Three-", 96-100 "Four-"
        const validResults = ["", "Two-", "Three-", "Four-"];
        for (let seed = 1; seed <= 30; seed++) {
            const e = new Evaluator(file, [], { seed });
            const r = e.runByName("Num");
            expect(validResults).toContain(r);
        }
    });
});

describe("corpus regression: deck picks and HTML output", () => {
    test("Spell Book throws meaningfully when Use'd SRD file is missing", () => {
        const file = parseGeneratorFile(loadFile("Spell Book.ipt"));
        // Spell Book Use:s an SRD file we don't have. The main table
        // deck-picks from a missing table; we want an informative
        // error that names what's missing, not a silent empty
        // result. Previously this returned "" silently — which made
        // it impossible to tell a working-but-empty generator apart
        // from one missing dependencies.
        const e = new Evaluator(file, [], { seed: 7 });
        expect(() => e.run()).toThrow(/Unknown table/);
    });
});

describe("corpus regression: inline picks and escape sequences", () => {
    test("Picked Pockets throws meaningfully when Use'd dependencies missing", () => {
        // Picked Pockets references tables (PickPocketItems etc.)
        // that live in Use:d files we don't have in the corpus.
        // Under the new contract, missing tables throw a named
        // error rather than rendering empty silently.
        const file = parseGeneratorFile(loadFile("Picked Pockets.ipt"));
        const e = new Evaluator(file, [], { seed: 1 });
        expect(() => e.run()).toThrow(/Unknown table/);
    });

    test("\\z produces an empty string in inline picks", () => {
        // Synthetic test: an inline pick where one option is \z
        // (the real Picked Pockets file has this pattern, but our corpus is truncated)
        const file = parseGeneratorFile(
            "Table: T\n[|\\z|word|another]"
        );
        const results = new Set<string>();
        for (let seed = 1; seed <= 50; seed++) {
            const e = new Evaluator(file, [], { seed });
            results.add(e.run());
        }
        expect(results.has("")).toBe(true);
        expect(results.has("word")).toBe(true);
        expect(results.has("another")).toBe(true);
    });
});

describe("corpus regression: Use: resolution missing files", () => {
    test("Orc Clan Name throws meaningfully when Use'd file missing", () => {
        const file = parseGeneratorFile(loadFile("Orc Clan Name.ipt"));
        // Without the Use'd file, [@OrcClan] is unresolvable. We
        // throw an Unknown-table error rather than rendering empty —
        // the empty-render path was silently masking real bugs where
        // users had forgotten a Use: line.
        const e = new Evaluator(file, [], { seed: 1 });
        expect(() => e.run()).toThrow(/Unknown table.*OrcClan/);
    });
});

describe("corpus regression: prompts, conditionals, math, and recursion", () => {
    test("Random Treasure throws meaningfully when SRDTreasure dependencies missing", () => {
        const file = parseGeneratorFile(loadFile("Random Treasure CR1-CR30.ipt"));
        // Without the SRDTreasure.ipt Use'd file, the CR{N}Coins/
        // Goods/Items tables aren't resolvable. The new contract
        // throws an informative error; previously this silently
        // produced partial output that looked complete but was
        // missing every treasure detail.
        const e = new Evaluator(file, [], { seed: 1 });
        expect(() => e.run()).toThrow(/Unknown table/);
    });

    test("Random Treasure with explicit CR also surfaces missing dependencies", () => {
        const file = parseGeneratorFile(loadFile("Random Treasure CR1-CR30.ipt"));
        const e = new Evaluator(file, [], {
            seed: 1,
            promptValues: { "Choose a CR (1-30)": "5" }
        });
        // The wrapping structure (header "CR 5 Treasure") is built
        // before any [@CR5Coins] call is attempted, so we still see
        // partial output building up — but the unresolved table is
        // what trips the error, so the run() call throws.
        expect(() => e.run()).toThrow(/Unknown table.*CR5Coins/);
    });

    test("AddCommas formats small numbers correctly", () => {
        const file = parseGeneratorFile(loadFile("Random Treasure CR1-CR30.ipt"));
        const e = new Evaluator(file, [], { seed: 1 });
        // Use the evaluator to call AddCommas via embedded subtable
        // AddCommas("123") should produce "123"
        const out = e.evalRawText("[@AddCommas with 123]");
        expect(out).toBe("123");
    });

    test("AddCommas formats 4-digit numbers with comma", () => {
        const file = parseGeneratorFile(loadFile("Random Treasure CR1-CR30.ipt"));
        const e = new Evaluator(file, [], { seed: 1 });
        const out = e.evalRawText("[@AddCommas with 1234]");
        expect(out).toBe("1,234");
    });

    test("AddCommas formats 7-digit numbers with two commas", () => {
        const file = parseGeneratorFile(loadFile("Random Treasure CR1-CR30.ipt"));
        const e = new Evaluator(file, [], { seed: 1 });
        const out = e.evalRawText("[@AddCommas with 1234567]");
        expect(out).toBe("1,234,567");
    });
});

describe("evaluator: smoke tests for common patterns", () => {
    test("simple weighted table with single item", () => {
        const file = parseGeneratorFile("Table: T\nHello");
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("Hello");
    });

    test("lookup table picks correct range", () => {
        const file = parseGeneratorFile(
            "Table: T\nType: Lookup\nRoll: 1d10\n1-5:low\n6-10:high"
        );
        // Run many times — should only ever be "low" or "high"
        for (let seed = 1; seed <= 20; seed++) {
            const e = new Evaluator(file, [], { seed });
            const r = e.run();
            expect(["low", "high"]).toContain(r);
        }
    });

    test("dice expression substitutes value", () => {
        const file = parseGeneratorFile("Table: T\nyou rolled {1d6}");
        for (let seed = 1; seed <= 10; seed++) {
            const e = new Evaluator(file, [], { seed });
            const r = e.run();
            expect(r).toMatch(/^you rolled [1-6]$/);
        }
    });

    test("variable assignment and reference", () => {
        const file = parseGeneratorFile(
            "Set: hp={3d6+2}\nTable: T\nHP: {hp}"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        const r = e.run();
        expect(r).toMatch(/^HP: \d+$/);
        const hpVal = parseInt(r.replace("HP: ", ""), 10);
        expect(hpVal).toBeGreaterThanOrEqual(5);
        expect(hpVal).toBeLessThanOrEqual(20);
    });

    test("Define is re-evaluated each use", () => {
        // A Define with dice should produce potentially different values each reference
        const file = parseGeneratorFile(
            "Define: roll={1d100}\nTable: T\n{roll} {roll} {roll}"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        const r = e.run();
        const parts = r.split(" ");
        expect(parts).toHaveLength(3);
        // Very unlikely to be all the same if Define re-evaluates
        // (we can't assert "not all same" deterministically though)
        for (const p of parts) {
            const n = parseInt(p, 10);
            expect(n).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(100);
        }
    });

    test("Set is evaluated once at assignment", () => {
        const file = parseGeneratorFile(
            "Set: roll={1d100}\nTable: T\n{roll} {roll} {roll}"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        const r = e.run();
        const parts = r.split(" ");
        // All three should be identical since Set is evaluated once
        expect(parts[0]).toBe(parts[1]);
        expect(parts[1]).toBe(parts[2]);
    });

    test("sub-table call by name", () => {
        const file = parseGeneratorFile(
            "Table: Main\n[@Sub]\nTable: Sub\nresult"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("result");
    });

    test("sub-table call with repetitions", () => {
        const file = parseGeneratorFile(
            "Table: Main\n[@3 Sub]\nTable: Sub\nx"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("xxx");
    });

    test("inline pick gives one of the options", () => {
        const file = parseGeneratorFile("Table: T\n[|red|blue|green]");
        for (let seed = 1; seed <= 20; seed++) {
            const e = new Evaluator(file, [], { seed });
            expect(["red", "blue", "green"]).toContain(e.run());
        }
    });

    test("conditional when/do/end true branch", () => {
        const file = parseGeneratorFile(
            "Set: x=foo\nTable: T\n[when]{x}=foo[do]matched[end]"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("matched");
    });

    test("conditional when/do/else/end false branch", () => {
        const file = parseGeneratorFile(
            "Set: x=bar\nTable: T\n[when]{x}=foo[do]matched[else]not matched[end]"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("not matched");
    });

    test("conditional when not", () => {
        const file = parseGeneratorFile(
            "Set: x=bar\nTable: T\n[when not]{x}=foo[do]not foo[end]"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("not foo");
    });

    test("filter: upper", () => {
        const file = parseGeneratorFile("Table: Main\n[@Sub >> upper]\nTable: Sub\nhello");
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("HELLO");
    });

    test("filter: implode", () => {
        const file = parseGeneratorFile(
            "Table: Main\n[@3 Sub >> implode]\nTable: Sub\nx"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("x, x, x");
    });

    test("filter: sort with implode", () => {
        const file = parseGeneratorFile(
            "Table: Main\n[!3 Sub >> sort >> implode]\nTable: Sub\nzebra\napple\nmango"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        const r = e.run();
        expect(r).toBe("apple, mango, zebra");
    });

    test("escapes: newline, tab, space, z", () => {
        const file = parseGeneratorFile("Table: T\nfoo\\nbar\\tbaz\\_qux\\zend");
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("foo\nbar\tbaz quxend");
    });

    test("escape \\a chooses 'a' before consonant", () => {
        const file = parseGeneratorFile("Table: T\n\\a tiger");
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("a tiger");
    });

    test("escape \\a chooses 'an' before vowel", () => {
        const file = parseGeneratorFile("Table: T\n\\a orc");
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("an orc");
    });

    /*
     * IPP3 docs explicitly promise `\a` handles common English
     * exceptions to the simple vowel rule: "honest merchant" gets
     * "an", "university" gets "a". The previous implementation did
     * a bare vowel check and silently emitted "a honest" — the
     * kind of typo a user spots the first time their generated
     * treasure description says "a honest merchant". Coverage
     * below pins the most common cases authors hit in TTRPG
     * generators.
     */
    test.each([
        // Silent-H words → "an"
        ["\\a honest merchant", "an honest merchant"],
        ["\\a hour from now", "an hour from now"],
        ["\\a honor guard", "an honor guard"],
        ["\\a heir to the throne", "an heir to the throne"],
        // U-as-/juː/ words → "a"
        ["\\a university", "a university"],
        ["\\a unicorn", "a unicorn"],
        ["\\a use of force", "a use of force"],
        ["\\a one-time event", "a one-time event"],
        // Vowel-letter-named acronyms → "an"
        ["\\a MBA", "an MBA"],
        ["\\a NPC encounter", "an NPC encounter"],
        ["\\a RPG session", "an RPG session"],
        // Consonant-letter-named acronym → "a"
        ["\\a DCC dungeon", "a DCC dungeon"],
    ])("escape \\a exceptions: '%s' → '%s'", (src, expected) => {
        const file = parseGeneratorFile("Table: T\n" + src);
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe(expected);
    });

    test("parameter passing via 'with'", () => {
        const file = parseGeneratorFile(
            "Table: Main\n[@Sub with hello]\nTable: Sub\nyou said: {$1}"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("you said: hello");
    });

    test("expression: floor function", () => {
        const file = parseGeneratorFile("Table: T\n{floor(3.7)}");
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("3");
    });

    test("expression: if function", () => {
        const file = parseGeneratorFile("Table: T\n{if(1=1, yes, no)}");
        // 'yes' and 'no' here are identifiers (variable references); they'll
        // resolve to empty string. Use quoted strings instead.
        const file2 = parseGeneratorFile("Table: T\n{if(1=1, 'yes', 'no')}");
        const e = new Evaluator(file2, [], { seed: 1 });
        expect(e.run()).toBe("yes");
    });

    test("variable assignment in expression", () => {
        const file = parseGeneratorFile("Table: T\n{x=42} and x is {x}");
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("42 and x is 42");
    });

    test("quiet assignment", () => {
        const file = parseGeneratorFile("Table: T\n{x==42}x is {x}");
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("x is 42");
    });
});

describe("evaluator: integer parsing of dice modifiers", () => {
    test("1d20+5 produces values in [6, 25]", () => {
        const file = parseGeneratorFile("Table: T\n{1d20+5}");
        for (let seed = 1; seed <= 30; seed++) {
            const e = new Evaluator(file, [], { seed });
            const n = parseInt(e.run(), 10);
            expect(n).toBeGreaterThanOrEqual(6);
            expect(n).toBeLessThanOrEqual(25);
        }
    });
});

/*
 * IPP3 convention: the literal text inside `[...]` is trimmed
 * before filters apply. Authors write `[ this is bold >> Bold]`
 * with cosmetic whitespace between the `[` and content for
 * readability; that whitespace isn't meant to land in the output
 * (e.g. `<b> this is bold </b>`).
 *
 * Originally the literal-bracket evaluator preserved that
 * whitespace, which corrupted nearly every filter's output. The
 * `Right` filter was particularly affected — taking from the
 * trailing-space side returned a space character instead of the
 * intended last character.
 */
describe("evaluator: literal-bracket trim contract", () => {
    test.each([
        // [source, expected, description]
        ["[ this is bold >> Bold]", "<b>this is bold</b>"],
        ["[ this is italic >> Italic]", "<i>this is italic</i>"],
        ["[ this is underlined >> Underline]", "<u>this is underlined</u>"],
        ["[THIS IS LOWER CASE >> Lower]", "this is lower case"],
        ["[This is upper case >> Upper]", "THIS IS UPPER CASE"],
        ["[abcdefghij >> Left]", "a"],
        ["[abcdefghij >> Right]", "j"],
        ["[abcdefghij >> Right 5]", "fghij"],
        ["[abcdefghijklmnop >> Substr 5 0]", "efghijklmnop"],
        ["[the town of brekville >> Proper]", "The Town Of Brekville"],
        ["[abcde >> reverse]", "edcba"],
    ])("trims literal-bracket content before filter: %s → %s",
        (src, expected) => {
            const file = parseGeneratorFile("Table: T\n" + src);
            const e = new Evaluator(file, [], { seed: 1 });
            expect(e.run()).toBe(expected);
        }
    );

    test("surrounding text outside the bracket is untouched", () => {
        // Trim applies inside `[...]`, not to siblings. Authors
        // who write `hello [content] world` get the spaces back.
        const file = parseGeneratorFile(
            "Table: T\nhello [ inner >> upper] world"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("hello INNER world");
    });

    test("sub-table call content is untouched (only literal_bracket trims)", () => {
        const file = parseGeneratorFile(
            "Table: T\nbefore [@Sub] after\n\nTable: Sub\nx"
        );
        const e = new Evaluator(file, [], { seed: 1 });
        // Single space between "before" and "x" — sub-table call
        // doesn't inject extra trimming on its result.
        expect(e.run()).toBe("before x after");
    });

    test("replace filter with multi-word find and replace strings", () => {
        // From IPP3 docs verbatim. Verifies the replace filter
        // accepts spaces inside both /find/ and /replace/ tokens.
        const file = parseGeneratorFile([
            "Set:a=you see orcs attacking",
            "Table: T",
            "[{a} >> replace /orcs/ancient red dragons/]",
        ].join("\n"));
        const e = new Evaluator(file, [], { seed: 1 });
        expect(e.run()).toBe("you see ancient red dragons attacking");
    });
});
