/**
 * Tests for the filter pipeline.
 *
 * Each filter is exercised individually with a hand-built FilterCall and a
 * minimal FilterContext. The 21 filters covered (per STATUS):
 *
 *   String case:    upper, lower, proper
 *   Trim:           trim, ltrim, rtrim
 *   Slice:          left, right, substr, at
 *   Search/replace: replace
 *   List ops:       sort, implode
 *   Per-item:       each, eachchar
 *   Format:         bold, italic, underline
 *   Misc:           reverse, length, plusminus (+-)
 *
 * Anything else passes through unchanged (tested at the end).
 */

import { applyFilters, FilterContext } from "../../src/engine/filters";
import { FilterCall } from "../../src/engine/ast";
import { Value } from "../../src/engine/expressions";
import { RNG } from "../../src/engine/rng";

// ─── Test helpers ───

function makeCtx(opts: {
    vars?: Record<string, Value>;
    tables?: Record<string, (params: string[]) => string>;
    formatting?: "html" | "text";
    seed?: number;
} = {}): FilterContext {
    const vars = new Map<string, Value>(Object.entries(opts.vars ?? {}));
    return {
        getVar: (name) => vars.get(name) ?? "",
        setVar: (name, value) => {
            vars.set(name, value);
        },
        evalEmbeddedCall: () => "",
        rng: new RNG(opts.seed ?? 1),
        formatting: opts.formatting ?? "html",
        evalTable: (name, params) => {
            const fn = (opts.tables ?? {})[name];
            return fn ? fn(params) : "";
        },
    };
}

/** Build a single-filter chain. */
function f(name: string, args: string = ""): FilterCall[] {
    return [{ name, args }];
}

// ─── Case filters ───

describe("filters: case", () => {
    test("upper", () => {
        expect(applyFilters("hello world", f("upper"), makeCtx())).toBe(
            "HELLO WORLD"
        );
    });

    test("lower", () => {
        expect(applyFilters("HELLO World", f("lower"), makeCtx())).toBe(
            "hello world"
        );
    });

    test("proper capitalises each word", () => {
        expect(applyFilters("hello world of foo", f("proper"), makeCtx())).toBe(
            "Hello World Of Foo"
        );
    });

    test("proper does not lowercase existing caps", () => {
        // The implementation uses \b\w → c.toUpperCase(); it doesn't lowercase
        // the rest. Documenting actual behaviour:
        expect(applyFilters("hELLo wORLD", f("proper"), makeCtx())).toBe(
            "HELLo WORLD"
        );
    });
});

// ─── Trim filters ───

describe("filters: trim", () => {
    test("trim strips both ends", () => {
        expect(applyFilters("  hi  ", f("trim"), makeCtx())).toBe("hi");
    });

    test("ltrim strips only left", () => {
        expect(applyFilters("  hi  ", f("ltrim"), makeCtx())).toBe("hi  ");
    });

    test("rtrim strips only right", () => {
        expect(applyFilters("  hi  ", f("rtrim"), makeCtx())).toBe("  hi");
    });

    test("trim of all-whitespace produces empty string", () => {
        expect(applyFilters("    ", f("trim"), makeCtx())).toBe("");
    });
});

// ─── Slice filters ───

describe("filters: left", () => {
    test("left N takes first N chars", () => {
        expect(applyFilters("abcdef", f("left", "3"), makeCtx())).toBe("abc");
    });

    test("left with no arg defaults to 1", () => {
        expect(applyFilters("abcdef", f("left"), makeCtx())).toBe("a");
    });

    test("left larger than length returns whole string", () => {
        expect(applyFilters("abc", f("left", "10"), makeCtx())).toBe("abc");
    });

    test("left with interpolated arg from var", () => {
        const ctx = makeCtx({ vars: { n: 4 } });
        // Filter args support {var} interpolation via renderArgs
        expect(applyFilters("abcdef", f("left", "{n}"), ctx)).toBe("abcd");
    });
});

describe("filters: right", () => {
    test("right N takes last N chars", () => {
        expect(applyFilters("abcdef", f("right", "2"), makeCtx())).toBe("ef");
    });

    test("right with no arg defaults to 1", () => {
        expect(applyFilters("abcdef", f("right"), makeCtx())).toBe("f");
    });
});

describe("filters: substr", () => {
    test("substr with start and length (1-indexed)", () => {
        // 'abcdef', start=2, length=3 → 'bcd'
        expect(applyFilters("abcdef", f("substr", "2 3"), makeCtx())).toBe(
            "bcd"
        );
    });

    test("substr with only start returns 1 character", () => {
        // IPP3 behaviour confirmed against corpus (AddCommas pattern).
        expect(applyFilters("abcdef", f("substr", "3"), makeCtx())).toBe("c");
    });

    test("substr with explicit length 0 returns rest from start", () => {
        // Documented in source: length=0 means "rest of string"
        expect(applyFilters("abcdef", f("substr", "2 0"), makeCtx())).toBe(
            "bcdef"
        );
    });

    test("substr with interpolated length", () => {
        // The classic Substr 2 {$NewLength} pattern from the corpus.
        const ctx = makeCtx({ vars: { NewLength: 3 } });
        expect(applyFilters("abcdef", f("substr", "2 {NewLength}"), ctx)).toBe(
            "bcd"
        );
    });
});

describe("filters: at", () => {
    test("at returns 1-indexed position when found", () => {
        // 'foobar', look for 'bar' → position 4
        expect(applyFilters("foobar", f("at", "bar"), makeCtx())).toBe("4");
    });

    test("at returns 0 when not found", () => {
        expect(applyFilters("foobar", f("at", "zzz"), makeCtx())).toBe("0");
    });

    test("at trims the haystack before searching", () => {
        // asString(value).trim() before indexOf
        expect(applyFilters("  hello  ", f("at", "hello"), makeCtx())).toBe(
            "1"
        );
    });
});

// ─── Search/replace ───

describe("filters: replace", () => {
    test("replace /find/repl/", () => {
        expect(
            applyFilters("foo bar foo", f("replace", "/foo/baz/"), makeCtx())
        ).toBe("baz bar baz");
    });

    test("replace with empty replacement (deletion)", () => {
        expect(
            applyFilters("hello world", f("replace", "/world/"), makeCtx())
        ).toBe("hello ");
    });

    test("replace handles escaped slashes in find", () => {
        // Format: /a\/b/c/ — finds 'a/b', replaces with 'c'
        expect(
            applyFilters("x a/b y", f("replace", "/a\\/b/c/"), makeCtx())
        ).toBe("x c y");
    });

    test("replace with no leading / returns input unchanged", () => {
        // parseReplaceArgs returns empty find/repl, .split('').join('') is a no-op
        // …actually splitting on '' produces individual chars and joining is a no-op.
        expect(applyFilters("hello", f("replace", "broken"), makeCtx())).toBe(
            "hello"
        );
    });
});

// ─── List operations ───

describe("filters: sort", () => {
    test("sort on string array", () => {
        // Sort only operates on arrays (multi-result inputs).
        // applyFilters coalesces back to string by joining with "".
        // Build a manual array input by chaining a no-op? Simpler: we know
        // applyFilters can take string[] directly.
        const result = applyFilters(
            ["pear", "apple", "banana"],
            f("sort"),
            makeCtx()
        );
        expect(result).toBe("applebananapear");
    });

    test("sort on string (non-array) is a no-op", () => {
        expect(applyFilters("zyx", f("sort"), makeCtx())).toBe("zyx");
    });
});

describe("filters: implode", () => {
    test("implode default separator is ', '", () => {
        expect(
            applyFilters(["a", "b", "c"], f("implode"), makeCtx())
        ).toBe("a, b, c");
    });

    test("implode with custom separator", () => {
        expect(
            applyFilters(["a", "b", "c"], f("implode", " - "), makeCtx())
        ).toBe("a - b - c");
    });

    test("implode on a single string wraps it in array of one", () => {
        // Source: arr = Array.isArray(value) ? value : [value]
        expect(applyFilters("solo", f("implode", "|"), makeCtx())).toBe(
            "solo"
        );
    });

    test("implode separator supports variable interpolation", () => {
        const ctx = makeCtx({ vars: { sep: " / " } });
        expect(
            applyFilters(["x", "y", "z"], f("implode", "{sep}"), ctx)
        ).toBe("x / y / z");
    });
});

// ─── Per-item table calls ───

describe("filters: each", () => {
    test("each passes every list item through a named table", () => {
        const ctx = makeCtx({
            tables: {
                Wrap: (params) => `[${params[0]}]`,
            },
        });
        // Each result becomes its own item; applyFilters joins arrays with "".
        expect(
            applyFilters(["a", "b", "c"], f("each", "Wrap"), ctx)
        ).toBe("[a][b][c]");
    });

    test("each on a single string treats it as one item", () => {
        const ctx = makeCtx({
            tables: { Wrap: (p) => `<${p[0]}>` },
        });
        expect(applyFilters("solo", f("each", "Wrap"), ctx)).toBe("<solo>");
    });
});

describe("filters: eachchar", () => {
    test("eachchar passes every character through a named table", () => {
        const ctx = makeCtx({
            tables: {
                Upper: (params) => params[0].toUpperCase(),
            },
        });
        expect(applyFilters("abc", f("eachchar", "Upper"), ctx)).toBe("ABC");
    });

    test("eachchar with empty string returns empty", () => {
        const ctx = makeCtx({ tables: { Anything: () => "X" } });
        expect(applyFilters("", f("eachchar", "Anything"), ctx)).toBe("");
    });
});

// ─── Format filters ───

describe("filters: bold/italic/underline (html mode)", () => {
    test("bold wraps in <b>", () => {
        expect(
            applyFilters("hi", f("bold"), makeCtx({ formatting: "html" }))
        ).toBe("<b>hi</b>");
    });

    test("italic wraps in <i>", () => {
        expect(
            applyFilters("hi", f("italic"), makeCtx({ formatting: "html" }))
        ).toBe("<i>hi</i>");
    });

    test("underline wraps in <u>", () => {
        expect(
            applyFilters("hi", f("underline"), makeCtx({ formatting: "html" }))
        ).toBe("<u>hi</u>");
    });
});

describe("filters: bold/italic/underline (text mode)", () => {
    test("bold uppercases", () => {
        expect(
            applyFilters("hi", f("bold"), makeCtx({ formatting: "text" }))
        ).toBe("HI");
    });

    test("italic wraps in *", () => {
        expect(
            applyFilters("hi", f("italic"), makeCtx({ formatting: "text" }))
        ).toBe("*hi*");
    });

    test("underline wraps in quotes", () => {
        expect(
            applyFilters("hi", f("underline"), makeCtx({ formatting: "text" }))
        ).toBe('"hi"');
    });
});

// ─── Misc ───

describe("filters: reverse", () => {
    test("reverses a string", () => {
        expect(applyFilters("abcdef", f("reverse"), makeCtx())).toBe("fedcba");
    });

    test("reverse of empty is empty", () => {
        expect(applyFilters("", f("reverse"), makeCtx())).toBe("");
    });
});

describe("filters: length", () => {
    test("length returns string length", () => {
        // Source: asString(v).trim().length
        expect(applyFilters("hello", f("length"), makeCtx())).toBe("5");
    });

    test("length trims first", () => {
        expect(applyFilters("  hi  ", f("length"), makeCtx())).toBe("2");
    });
});

describe("filters: plusminus / +-", () => {
    test("plusminus prefixes + on non-negative", () => {
        expect(applyFilters("5", f("plusminus"), makeCtx())).toBe("+5");
    });

    test("plusminus leaves negative alone", () => {
        expect(applyFilters("-3", f("plusminus"), makeCtx())).toBe("-3");
    });

    test("plusminus on zero gives +0", () => {
        expect(applyFilters("0", f("plusminus"), makeCtx())).toBe("+0");
    });

    test("+- alias works the same way", () => {
        expect(applyFilters("7", f("+-"), makeCtx())).toBe("+7");
    });

    test("plusminus on non-numeric passes through", () => {
        expect(applyFilters("foo", f("plusminus"), makeCtx())).toBe("foo");
    });
});

// ─── Chain behaviour ───

describe("filters: chains", () => {
    test("chains are applied left-to-right", () => {
        // trim then upper
        expect(
            applyFilters("  hello  ", [
                { name: "trim", args: "" },
                { name: "upper", args: "" },
            ], makeCtx())
        ).toBe("HELLO");
    });

    test("each + sort + implode on a list", () => {
        // First each wraps, then sort orders the wrapped items, then implode joins.
        const ctx = makeCtx({
            tables: { Tag: (p) => `<${p[0]}>` },
        });
        const result = applyFilters(
            ["pear", "apple", "banana"],
            [
                { name: "each", args: "Tag" },
                { name: "sort", args: "" },
                { name: "implode", args: " " },
            ],
            ctx
        );
        expect(result).toBe("<apple> <banana> <pear>");
    });
});

// ─── Unknown filter ───

describe("filters: unknown filter", () => {
    test("unknown filter passes value through unchanged", () => {
        expect(
            applyFilters("hello", f("doesnotexist"), makeCtx())
        ).toBe("hello");
    });
});
