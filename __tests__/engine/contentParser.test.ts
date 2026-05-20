import { parseContent, ContentParseError } from "../../src/engine/contentParser";

describe("contentParser: plain text", () => {
    test("empty content", () => {
        expect(parseContent("")).toEqual([]);
    });

    test("plain text", () => {
        expect(parseContent("hello world")).toEqual([
            { type: "text", value: "hello world" }
        ]);
    });

    test("multiple text fragments coalesce", () => {
        // Contiguous text characters should produce a single TextNode
        const nodes = parseContent("a b c");
        const textNodes = nodes.filter(n => n.type === "text");
        expect(textNodes).toHaveLength(1);
    });
});

describe("contentParser: escapes", () => {
    test("newline escape", () => {
        const nodes = parseContent("a\\nb");
        expect(nodes).toEqual([
            { type: "text", value: "a" },
            { type: "escape", kind: "n" },
            { type: "text", value: "b" }
        ]);
    });

    test("tab escape", () => {
        expect(parseContent("\\t")).toEqual([{ type: "escape", kind: "t" }]);
    });

    test("space escape (\\_)", () => {
        expect(parseContent("\\_")).toEqual([{ type: "escape", kind: "_" }]);
    });

    test("z escape (empty)", () => {
        expect(parseContent("\\z")).toEqual([{ type: "escape", kind: "z" }]);
    });

    test("a escape (a/an)", () => {
        expect(parseContent("\\a tiger")).toEqual([
            { type: "escape", kind: "a" },
            { type: "text", value: " tiger" }
        ]);
    });

    test("literal escape (backslash + brace)", () => {
        const nodes = parseContent("\\{3d6}");
        expect(nodes[0]).toEqual({ type: "escape", kind: "literal", literal: "{" });
    });

    test("backslash followed by bracket is literal", () => {
        expect(parseContent("\\[")).toEqual([
            { type: "escape", kind: "literal", literal: "[" }
        ]);
    });
});

describe("contentParser: braces (expressions / dice / variables)", () => {
    test("variable", () => {
        expect(parseContent("{name}")).toEqual([
            { type: "variable", name: "name" }
        ]);
    });

    test("legacy variable with $", () => {
        expect(parseContent("{$name}")).toEqual([
            { type: "variable", name: "name" }
        ]);
    });

    test("numeric parameter $1", () => {
        expect(parseContent("{$1}")).toEqual([
            { type: "variable", name: "1" }
        ]);
    });

    test("simple dice roll", () => {
        expect(parseContent("{3d6}")).toEqual([
            { type: "dice", source: "3d6" }
        ]);
    });

    test("dice with modifier", () => {
        expect(parseContent("{1d8+2}")).toEqual([
            { type: "dice", source: "1d8+2" }
        ]);
    });

    test("expression with math", () => {
        const nodes = parseContent("{1+2+3}");
        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toEqual({ type: "expression", source: "1+2+3" });
    });

    test("expression with function call", () => {
        expect(parseContent("{round(1d20/6)}")).toEqual([
            { type: "expression", source: "round(1d20/6)" }
        ]);
    });

    test("legacy {!expr} strips the bang", () => {
        // {!math} should become an expression with source "math"
        const nodes = parseContent("{!1+2}");
        expect(nodes[0]).toEqual({ type: "expression", source: "1+2" });
    });

    test("expression with inline variable assignment", () => {
        const nodes = parseContent("{myvar=1+2+3}");
        expect(nodes[0]).toEqual({ type: "expression", source: "myvar=1+2+3" });
    });

    test("nested braces in expression preserved", () => {
        const nodes = parseContent("{a + {b}}");
        // The outer brace consumes everything balanced; inner stays in source
        expect(nodes[0]).toEqual({ type: "expression", source: "a + {b}" });
    });

    test("unclosed brace throws", () => {
        expect(() => parseContent("{unclosed")).toThrow(ContentParseError);
    });
});

describe("contentParser: sub-table roll [@…]", () => {
    test("simple call", () => {
        const nodes = parseContent("[@Race]");
        expect(nodes).toEqual([{
            type: "subtable_roll",
            tableSource: "Race",
            withParams: [],
            filters: [],
            repsSource: undefined,
            assignVar: undefined,
            assignQuiet: false
        }]);
    });

    test("call with numeric reps", () => {
        const nodes = parseContent("[@5 Skills]");
        expect(nodes[0]).toMatchObject({
            type: "subtable_roll",
            repsSource: "5",
            tableSource: "Skills"
        });
    });

    test("call with dice reps", () => {
        const nodes = parseContent("[@{1d6} Weapons]");
        expect(nodes[0]).toMatchObject({
            type: "subtable_roll",
            repsSource: "{1d6}",
            tableSource: "Weapons"
        });
    });

    test("call with var reps", () => {
        const nodes = parseContent("[@{$NumLoSpells} SpellsMageLevel1]");
        expect(nodes[0]).toMatchObject({
            type: "subtable_roll",
            repsSource: "{$NumLoSpells}",
            tableSource: "SpellsMageLevel1"
        });
    });

    test("call with table-name as expression", () => {
        const nodes = parseContent("[@{$CoinsTable}]");
        // No reps because no whitespace between {…} and end
        expect(nodes[0]).toMatchObject({
            type: "subtable_roll",
            repsSource: undefined,
            tableSource: "{$CoinsTable}"
        });
    });

    test("call with with-clause params", () => {
        const nodes = parseContent("[@html_red with [@name]]");
        expect(nodes[0]).toMatchObject({
            type: "subtable_roll",
            tableSource: "html_red",
            withParams: ["[@name]"]
        });
    });

    test("call with multiple with-clause params", () => {
        const nodes = parseContent("[@multicolor with red, green, blue]");
        expect(nodes[0]).toMatchObject({
            tableSource: "multicolor",
            withParams: ["red", "green", "blue"]
        });
    });

    test("call with assignment", () => {
        const nodes = parseContent("[@name=pcname]");
        expect(nodes[0]).toMatchObject({
            type: "subtable_roll",
            tableSource: "pcname",
            assignVar: "name",
            assignQuiet: false
        });
    });

    test("call with quiet assignment", () => {
        const nodes = parseContent("[@name==pcname]");
        expect(nodes[0]).toMatchObject({
            assignVar: "name",
            assignQuiet: true
        });
    });

    test("call with filter", () => {
        const nodes = parseContent("[@Town >> Upper]");
        expect(nodes[0]).toMatchObject({
            tableSource: "Town",
            filters: [{ name: "upper", args: "" }]
        });
    });

    test("call with filter chain", () => {
        const nodes = parseContent("[@3 Spells >> Proper >> Sort]");
        expect(nodes[0]).toMatchObject({
            repsSource: "3",
            tableSource: "Spells",
            filters: [
                { name: "proper", args: "" },
                { name: "sort", args: "" }
            ]
        });
    });

    test("call with filter argument", () => {
        const nodes = parseContent("[@x >> Substr 5 3]");
        expect(nodes[0]).toMatchObject({
            filters: [{ name: "substr", args: "5 3" }]
        });
    });
});

describe("contentParser: sub-table pick [#…]", () => {
    test("pick with index", () => {
        const nodes = parseContent("[#5 NextTable]");
        expect(nodes[0]).toMatchObject({
            type: "subtable_pick",
            indexSource: "5",
            tableSource: "NextTable"
        });
    });

    test("pick with variable index", () => {
        const nodes = parseContent("[#{class} hitdice]");
        expect(nodes[0]).toMatchObject({
            type: "subtable_pick",
            indexSource: "{class}",
            tableSource: "hitdice"
        });
    });

    test("pick without index (uses current row)", () => {
        const nodes = parseContent("[#NextTable]");
        expect(nodes[0]).toMatchObject({
            type: "subtable_pick",
            indexSource: undefined,
            tableSource: "NextTable"
        });
    });
});

describe("contentParser: deck pick [!…]", () => {
    test("simple deck pick", () => {
        const nodes = parseContent("[!skills]");
        expect(nodes[0]).toMatchObject({
            type: "deck_pick",
            tableSource: "skills"
        });
    });

    test("deck pick with reps", () => {
        const nodes = parseContent("[!5 skills]");
        expect(nodes[0]).toMatchObject({
            type: "deck_pick",
            repsSource: "5",
            tableSource: "skills"
        });
    });

    test("deck pick with var reps", () => {
        const nodes = parseContent("[!{$NumLoSpells} SpellsMageLevel1 >> sort >> implode]");
        expect(nodes[0]).toMatchObject({
            type: "deck_pick",
            repsSource: "{$NumLoSpells}",
            tableSource: "SpellsMageLevel1",
            filters: [
                { name: "sort", args: "" },
                { name: "implode", args: "" }
            ]
        });
    });
});

describe("contentParser: inline table [|a|b|c]", () => {
    test("simple inline", () => {
        const nodes = parseContent("[|male|female]");
        expect(nodes[0]).toEqual({
            type: "inline_table",
            options: ["male", "female"],
            filters: []
        });
    });

    test("multiple options", () => {
        const nodes = parseContent("[|fighter|cleric|mage|thief]");
        expect((nodes[0] as any).options).toHaveLength(4);
    });

    test("inline with nested calls (pipe in nested doesn't split)", () => {
        const nodes = parseContent("[|[@a]|[@b]]");
        expect((nodes[0] as any).options).toEqual(["[@a]", "[@b]"]);
    });

    test("inline with filters", () => {
        const nodes = parseContent("[|a|b|c >> Upper]");
        expect(nodes[0]).toMatchObject({
            type: "inline_table",
            filters: [{ name: "upper", args: "" }]
        });
        expect((nodes[0] as any).options.map((s: string) => s.trim())).toEqual(["a", "b", "c"]);
    });
});

describe("contentParser: literal brackets and filters", () => {
    test("literal text with filter", () => {
        const nodes = parseContent("[hello >> upper]");
        expect(nodes[0]).toMatchObject({
            type: "literal_bracket",
            text: "hello ",
            filters: [{ name: "upper", args: "" }]
        });
    });
});

describe("contentParser: conditionals", () => {
    test("simple when/do/end", () => {
        const nodes = parseContent("[when]a=b[do]then[end]");
        expect(nodes[0]).toMatchObject({
            type: "conditional",
            negated: false,
            conditionSource: "a=b",
            thenSource: "then"
        });
        expect((nodes[0] as any).elseSource).toBeUndefined();
    });

    test("when/do/else/end", () => {
        const nodes = parseContent("[when]a=b[do]then[else]otherwise[end]");
        expect(nodes[0]).toMatchObject({
            negated: false,
            conditionSource: "a=b",
            thenSource: "then",
            elseSource: "otherwise"
        });
    });

    test("when not", () => {
        const nodes = parseContent("[when not]{$myvar}[do][myvar==orc][end]");
        expect(nodes[0]).toMatchObject({
            type: "conditional",
            negated: true
        });
    });

    test("conditional with nested calls in branches", () => {
        const nodes = parseContent(
            "[when]{$race}=dwarf[do][@dwarfprofessions][else][@otherprofessions][end]"
        );
        expect(nodes[0]).toMatchObject({
            type: "conditional",
            thenSource: "[@dwarfprofessions]",
            elseSource: "[@otherprofessions]"
        });
    });
});

describe("contentParser: mixed content", () => {
    test("text + variable + text", () => {
        const nodes = parseContent("A man named {name}, hp {1d6}");
        expect(nodes).toHaveLength(4);
        expect(nodes[0]).toEqual({ type: "text", value: "A man named " });
        expect(nodes[1]).toEqual({ type: "variable", name: "name" });
        expect(nodes[2]).toEqual({ type: "text", value: ", hp " });
        expect(nodes[3]).toEqual({ type: "dice", source: "1d6" });
    });

    test("inline pick with escape", () => {
        const nodes = parseContent("\\a [|fighter|mage]");
        expect(nodes[0]).toEqual({ type: "escape", kind: "a" });
        expect(nodes[2]).toMatchObject({ type: "inline_table" });
    });

    test("complex real-world line", () => {
        const src = "[@5 Spells >> sort >> implode]";
        const nodes = parseContent(src);
        expect(nodes[0]).toMatchObject({
            type: "subtable_roll",
            repsSource: "5",
            tableSource: "Spells",
            filters: [
                { name: "sort", args: "" },
                { name: "implode", args: "" }
            ]
        });
    });
});

// ────────── Obsidian wiki-syntax pass-through ──────────

/**
 * `[[…]]` and `![[…]]` are Obsidian's wiki-link syntax. The engine
 * must pass them through as literal text so the post-sanitiser
 * link-interpolator can find them in the rendered output and
 * rewrite them into `<img>` / `<a>` elements.
 *
 * Before the fix: `[[image.png]]` was parsed as outer-bracket
 * containing inner-bracket `[image.png]`, both treated as literal
 * brackets — outputting `image.png` and losing the wiki syntax.
 * Now: the `[[` opener is recognised at the top-level scanner
 * and emitted as literal text.
 */
describe("contentParser: wiki-syntax pass-through", () => {
    test("`[[note]]` passes through as literal text", () => {
        // The doubled opening brackets become literal `[[`; bare
        // `]` characters outside any bracket scope are already
        // plain text in IPP3, so the closing `]]` survives too.
        const nodes = parseContent("[[note]]");
        // Should produce text nodes (potentially split) that
        // concatenate to the original.
        const rendered = nodes
            .filter((n) => n.type === "text")
            .map((n) => (n as { value: string }).value)
            .join("");
        expect(rendered).toBe("[[note]]");
        // Critically: NO bracket nodes — the parser didn't enter
        // parseBracket for the outer `[`.
        const bracketNodes = nodes.filter(
            (n) => n.type === "literal_bracket"
        );
        expect(bracketNodes).toHaveLength(0);
    });

    test("`![[image.png]]` passes through as literal text", () => {
        const nodes = parseContent("![[image.png]]");
        const rendered = nodes
            .filter((n) => n.type === "text")
            .map((n) => (n as { value: string }).value)
            .join("");
        expect(rendered).toBe("![[image.png]]");
    });

    test("wiki-syntax surrounded by text preserves the text", () => {
        const nodes = parseContent("Before ![[x.png]] after");
        // Concatenated text should match input.
        const rendered = nodes
            .filter((n) => n.type === "text")
            .map((n) => (n as { value: string }).value)
            .join("");
        expect(rendered).toBe("Before ![[x.png]] after");
    });

    test("{var} inside `[[…]]` still gets evaluated as an expression", () => {
        // The pass-through preserves the brackets, but the inner
        // content continues through the normal parse loop — so
        // `{name}` inside a wiki link is still a real expression
        // node. This means authors can write `![[{filename}.png]]`
        // to build a dynamic embed.
        const nodes = parseContent("[[{name}]]");
        // Expect: text "[[", then expression/variable node for
        // {name}, then text "]]".
        const types = nodes.map((n) => n.type);
        expect(types).toContain("variable");
        // Surrounding text should reconstruct the brackets.
        const textPieces = nodes
            .filter((n) => n.type === "text")
            .map((n) => (n as { value: string }).value)
            .join("|");
        expect(textPieces).toContain("[[");
        expect(textPieces).toContain("]]");
    });

    test("ordinary `[table]` syntax still parses as a bracket call", () => {
        // Sanity: only the DOUBLED `[[` triggers pass-through. A
        // single `[table]` is still a bracket call.
        const nodes = parseContent("[mytable]");
        expect(nodes).toHaveLength(1);
        expect(nodes[0].type).toBe("literal_bracket");
    });

    test("adjacent wiki embeds parse independently", () => {
        const nodes = parseContent("[[a]][[b]]");
        const rendered = nodes
            .filter((n) => n.type === "text")
            .map((n) => (n as { value: string }).value)
            .join("");
        expect(rendered).toBe("[[a]][[b]]");
        // No bracket nodes — both embeds passed through.
        expect(
            nodes.filter((n) => n.type === "literal_bracket")
        ).toHaveLength(0);
    });
});
