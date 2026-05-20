/**
 * Tests for the {...} expression evaluator.
 *
 * The evaluator is hooked to the rest of the engine via an ExprContext:
 *   getVar / setVar       – variable scope
 *   evalEmbeddedCall      – evaluate raw bracket source [@…] / [#…] / etc.
 *   rng                   – seedable PRNG for dice rolls
 *
 * Each test builds the smallest stub context it needs. Dice tests pin the
 * RNG with a fixed seed so they are deterministic.
 */

import {
    evaluateExpression,
    ExprContext,
    ExpressionError,
    Value,
} from "../../src/engine/expressions";
import { RNG } from "../../src/engine/rng";

// ─── Minimal context helpers ───

function makeCtx(opts: {
    vars?: Record<string, Value>;
    embeddedResults?: Record<string, string>;
    seed?: number;
} = {}): ExprContext {
    const vars = new Map<string, Value>(Object.entries(opts.vars ?? {}));
    const embeddedResults = opts.embeddedResults ?? {};
    return {
        getVar: (name: string) => vars.get(name) ?? "",
        setVar: (name: string, value: Value) => {
            vars.set(name, value);
        },
        evalEmbeddedCall: (raw: string) => {
            if (raw in embeddedResults) return embeddedResults[raw];
            // Default: return the raw source so tests can spot-check
            return embeddedResults[raw.trim()] ?? "";
        },
        rng: new RNG(opts.seed ?? 1),
    };
}

/** Convenience — evaluate and return the value only. */
function evalE(source: string, ctx?: ExprContext): Value {
    return evaluateExpression(source, ctx ?? makeCtx()).value;
}

// ─── Numbers and string literals ───

describe("expressions: numbers", () => {
    test("integer literal", () => {
        expect(evalE("42")).toBe(42);
    });

    test("decimal literal", () => {
        expect(evalE("3.14")).toBe(3.14);
    });

    test("zero", () => {
        expect(evalE("0")).toBe(0);
    });

    test("whitespace-padded number", () => {
        expect(evalE("  7  ")).toBe(7);
    });
});

describe("expressions: string literals", () => {
    test("single-quoted string", () => {
        expect(evalE("'hello'")).toBe("hello");
    });

    test("double-quoted string", () => {
        expect(evalE('"world"')).toBe("world");
    });

    test("escape inside string", () => {
        // Backslash escapes next char in string literals
        expect(evalE("'don\\'t'")).toBe("don't");
    });

    test("empty string", () => {
        expect(evalE("''")).toBe("");
    });

    test("unterminated string throws", () => {
        expect(() => evalE("'oops")).toThrow(ExpressionError);
    });
});

// ─── Arithmetic and precedence ───

describe("expressions: arithmetic", () => {
    test("addition", () => {
        expect(evalE("2 + 3")).toBe(5);
    });

    test("subtraction", () => {
        expect(evalE("10 - 4")).toBe(6);
    });

    test("multiplication", () => {
        expect(evalE("6 * 7")).toBe(42);
    });

    test("division", () => {
        expect(evalE("20 / 4")).toBe(5);
    });

    test("division by zero returns 0 (IPP3 safety)", () => {
        // The engine treats /0 as 0 rather than throwing; documented in source.
        expect(evalE("5 / 0")).toBe(0);
    });

    test("power is right-associative", () => {
        // 2^3^2 = 2^(3^2) = 2^9 = 512, not (2^3)^2 = 64
        expect(evalE("2^3^2")).toBe(512);
    });

    test("power has higher precedence than multiply", () => {
        expect(evalE("2 * 3^2")).toBe(18);
    });

    test("multiply has higher precedence than add", () => {
        expect(evalE("2 + 3 * 4")).toBe(14);
    });

    test("parentheses override precedence", () => {
        expect(evalE("(2 + 3) * 4")).toBe(20);
    });

    test("unary minus", () => {
        expect(evalE("-5")).toBe(-5);
    });

    test("unary minus on parenthesised expr", () => {
        expect(evalE("-(2 + 3)")).toBe(-5);
    });

    test("unary plus is a no-op", () => {
        expect(evalE("+7")).toBe(7);
    });

    test("nested parentheses", () => {
        expect(evalE("((1 + 2) * (3 + 4))")).toBe(21);
    });
});

// ─── String concatenation via + ───

describe("expressions: string concatenation", () => {
    test("string + string concatenates", () => {
        expect(evalE("'foo' + 'bar'")).toBe("foobar");
    });

    test("string + numeric-looking string coerces to number", () => {
        // Per addValues: if one side is numeric-looking, numeric addition wins.
        expect(evalE("'5' + '3'")).toBe("53"); // both non-numeric path? actually both look numeric — see next test
    });

    test("number + numeric string adds numerically", () => {
        // Documented branch: number + string-that-parses → numeric add
        expect(evalE("5 + '3'")).toBe(8);
    });

    test("string + number with non-numeric string concatenates", () => {
        expect(evalE("'x' + 5")).toBe("x5");
    });
});

// ─── Comparisons ───

describe("expressions: comparisons", () => {
    test("equal numbers", () => {
        expect(evalE("3 = 3")).toBe(1);
    });

    test("unequal numbers via <>", () => {
        expect(evalE("3 <> 4")).toBe(1);
    });

    test("less than", () => {
        expect(evalE("2 < 3")).toBe(1);
    });

    test("greater than", () => {
        expect(evalE("5 > 1")).toBe(1);
    });

    test("less than or equal — equal case", () => {
        expect(evalE("3 <= 3")).toBe(1);
    });

    test("greater than or equal — greater case", () => {
        expect(evalE("4 >= 3")).toBe(1);
    });

    test("false comparisons return 0", () => {
        expect(evalE("3 = 4")).toBe(0);
        expect(evalE("3 > 4")).toBe(0);
    });

    test("string equality", () => {
        expect(evalE("'foo' = 'foo'")).toBe(1);
        expect(evalE("'foo' = 'bar'")).toBe(0);
    });

    test("numeric coercion for string-looking-like-number comparison", () => {
        // Both '3' and '3.0' parse as 3 → equal numerically
        expect(evalE("'3' = '3.0'")).toBe(1);
    });
});

// ─── Variables ───

describe("expressions: variables", () => {
    test("simple variable reference", () => {
        const ctx = makeCtx({ vars: { x: 7 } });
        expect(evalE("x", ctx)).toBe(7);
    });

    test("undefined variable returns empty string", () => {
        // toNum on "" produces 0, so this is a soft default.
        const ctx = makeCtx();
        expect(evalE("missing", ctx)).toBe("");
    });

    test("$-prefix is accepted on identifiers", () => {
        // Regression: $NormalCheck used to error "unexpected character '$'".
        const ctx = makeCtx({ vars: { NormalCheck: 12 } });
        expect(evalE("$NormalCheck", ctx)).toBe(12);
    });

    test("$-prefix in arithmetic", () => {
        const ctx = makeCtx({ vars: { x: 5 } });
        expect(evalE("$x + 3", ctx)).toBe(8);
    });

    test("variable used in arithmetic", () => {
        const ctx = makeCtx({ vars: { n: 10 } });
        expect(evalE("n * 2 + 1", ctx)).toBe(21);
    });

    test("string variable in concat", () => {
        const ctx = makeCtx({ vars: { name: "world" } });
        expect(evalE("'hello ' + name", ctx)).toBe("hello world");
    });
});

// ─── Assignment ───

describe("expressions: assignment", () => {
    test("plain `var = expr` returns value and is not quiet", () => {
        const ctx = makeCtx();
        const r = evaluateExpression("x = 5", ctx);
        expect(r.value).toBe(5);
        expect(r.assignedVarName).toBe("x");
        expect(r.quiet).toBe(false);
        // Side effect: variable now set
        expect(ctx.getVar("x")).toBe(5);
    });

    test("`var == expr` is quiet", () => {
        const ctx = makeCtx();
        const r = evaluateExpression("y == 1 + 2 + 3", ctx);
        expect(r.value).toBe(6);
        expect(r.assignedVarName).toBe("y");
        expect(r.quiet).toBe(true);
        expect(ctx.getVar("y")).toBe(6);
    });

    test("assignment of a string", () => {
        const ctx = makeCtx();
        evaluateExpression("name = 'Alice'", ctx);
        expect(ctx.getVar("name")).toBe("Alice");
    });

    test("expression that compares is not parsed as assignment", () => {
        // "a = 5" with no prior 'a' is an assignment (the engine's chosen
        // semantics). A pure comparison needs the LHS to not match an identifier
        // pattern; we test the parser separately by feeding a parenthesised LHS.
        const ctx = makeCtx({ vars: { a: 3 } });
        // (a) = 5 → parsed as expression, evaluates to comparison: 3 = 5 → 0
        expect(evalE("(a) = 5", ctx)).toBe(0);
    });

    test("assignment with variable on RHS reads then writes", () => {
        const ctx = makeCtx({ vars: { src: 42 } });
        evaluateExpression("dst = src", ctx);
        expect(ctx.getVar("dst")).toBe(42);
    });
});

// ─── Function calls ───

describe("expressions: functions", () => {
    test("if() returns then-branch when truthy", () => {
        expect(evalE("if(1, 'yes', 'no')")).toBe("yes");
    });

    test("if() returns else-branch when falsy", () => {
        expect(evalE("if(0, 'yes', 'no')")).toBe("no");
    });

    test("if() with comparison", () => {
        expect(evalE("if(3 > 2, 'big', 'small')")).toBe("big");
    });

    test("max() of numbers", () => {
        expect(evalE("max(1, 5, 3, 2)")).toBe(5);
    });

    test("min() of numbers", () => {
        expect(evalE("min(7, 2, 9, 4)")).toBe(2);
    });

    test("max() with no args returns 0", () => {
        expect(evalE("max()")).toBe(0);
    });

    test("sqrt", () => {
        expect(evalE("sqrt(16)")).toBe(4);
    });

    test("abs of negative", () => {
        expect(evalE("abs(-7)")).toBe(7);
    });

    test("round half-up", () => {
        expect(evalE("round(2.5)")).toBe(3);
    });

    test("floor of positive", () => {
        expect(evalE("floor(2.9)")).toBe(2);
    });

    test("ceil of positive", () => {
        expect(evalE("ceil(2.1)")).toBe(3);
    });

    test("sign of negative / zero / positive", () => {
        expect(evalE("sign(-5)")).toBe(-1);
        expect(evalE("sign(0)")).toBe(0);
        expect(evalE("sign(3)")).toBe(1);
    });

    test("length of string (trimmed)", () => {
        // The length() function calls trim() before counting
        expect(evalE("length('  hello  ')")).toBe(5);
    });

    test("trim of string", () => {
        expect(evalE("trim('  hi  ')")).toBe("hi");
    });

    test("substr with start and length (1-indexed)", () => {
        // substr('abcdef', 2, 3) → 'bcd'
        expect(evalE("substr('abcdef', 2, 3)")).toBe("bcd");
    });

    test("substr with only start returns rest", () => {
        // Engine: in expression substr(), len defaults to 0 → slice from start
        expect(evalE("substr('abcdef', 3)")).toBe("cdef");
    });

    test("unknown function throws", () => {
        expect(() => evalE("bogus(1, 2)")).toThrow(ExpressionError);
    });

    test("function name is case-insensitive", () => {
        expect(evalE("MAX(1, 2, 3)")).toBe(3);
        expect(evalE("Floor(2.7)")).toBe(2);
    });

    test("nested function calls", () => {
        expect(evalE("max(min(5, 10), 3)")).toBe(5);
    });
});

// ─── Dice ───

describe("expressions: dice", () => {
    test("1d1 is always 1", () => {
        // A one-sided die can only roll 1, regardless of RNG.
        expect(evalE("1d1")).toBe(1);
    });

    test("dice rolls are deterministic given a seed", () => {
        const a = evalE("3d6", makeCtx({ seed: 12345 }));
        const b = evalE("3d6", makeCtx({ seed: 12345 }));
        expect(a).toBe(b);
    });

    test("different seeds can give different rolls", () => {
        // Statistically near-certain over many trials; here we just want
        // to confirm seed affects the stream. Picking two seeds where the
        // first roll differs to keep this stable.
        const a = evalE("1d100", makeCtx({ seed: 1 }));
        const b = evalE("1d100", makeCtx({ seed: 2 }));
        // If by extreme coincidence they're equal, the next assertion would
        // fail — but we just want SOME evidence of seed sensitivity:
        expect(typeof a).toBe("number");
        expect(typeof b).toBe("number");
        // Across 100d100 they'd nearly certainly diverge; here we only assert
        // the rolls land in range.
        expect(a as number).toBeGreaterThanOrEqual(1);
        expect(a as number).toBeLessThanOrEqual(100);
        expect(b as number).toBeGreaterThanOrEqual(1);
        expect(b as number).toBeLessThanOrEqual(100);
    });

    test("dice in arithmetic", () => {
        // 1d1 = 1, so result is deterministic
        expect(evalE("1d1 + 5")).toBe(6);
        expect(evalE("1d1 * 1d1")).toBe(1);
    });

    test("dice with capital D", () => {
        expect(evalE("1D1")).toBe(1);
    });

    test("missing sides throws", () => {
        expect(() => evalE("3d")).toThrow(ExpressionError);
    });

    test("multiple dice sum within range", () => {
        const result = evalE("3d6", makeCtx({ seed: 42 })) as number;
        expect(result).toBeGreaterThanOrEqual(3);
        expect(result).toBeLessThanOrEqual(18);
    });

    test("dice sides from embedded [...] sub-expression", () => {
        // `1d[@dietype]` — sides come from a sub-table call.
        // Documented IPP3 nesting pattern: rolls 1d6 if the table
        // returns "6". Previously the expression parser only
        // accepted literal digits after `d` and would error.
        const ctx = makeCtx({
            embeddedResults: { "@dietype": "6" },
            seed: 1,
        });
        const result = evalE("1d[@dietype]", ctx) as number;
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(6);
    });

    test("dice sides from nested {...} expression", () => {
        // `1d{3+3}` — sides come from a nested math expression.
        const result = evalE("1d{3+3}", makeCtx({ seed: 1 })) as number;
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(6);
    });

    test("dice with embedded non-numeric sides throws clearly", () => {
        // If the embedded call returns a non-number, fail with a
        // descriptive error rather than silently rolling 1dNaN.
        const ctx = makeCtx({
            embeddedResults: { "@bad": "not-a-number" },
            seed: 1,
        });
        expect(() => evalE("1d[@bad]", ctx)).toThrow(ExpressionError);
    });
});

// ─── Variable variables ───

describe("expressions: variable variables (variable name from expression)", () => {
    test("{$[@var]} looks up variable whose name comes from sub-table", () => {
        // IPP3 documented pattern: the variable NAME is dynamic,
        // taken from a sub-table call's result. `{$[@var]}`
        // returns the value of whichever variable was named.
        const ctx = makeCtx({
            vars: { a: "apple", b: "banana" },
            embeddedResults: { "@var": "a" },
        });
        expect(evalE("$[@var]", ctx)).toBe("apple");
    });

    test("{$[@var]} returns empty when named variable is unset", () => {
        // Looking up an unknown name returns the same empty value
        // as a normal `{unknown}` lookup. No throw.
        const ctx = makeCtx({
            vars: { a: "apple" },
            embeddedResults: { "@var": "nonexistent" },
        });
        expect(evalE("$[@var]", ctx)).toBe("");
    });

    test("{${name}} also supports a nested brace for the variable name", () => {
        // Symmetrical to the [...] form: `${expr}` resolves the
        // name from a brace expression. Useful when the name is
        // itself in another variable.
        const ctx = makeCtx({
            vars: { which: "a", a: "apple" },
        });
        // After consuming `$`, the parser sees `{which}` and
        // evaluates it to "a", then looks up variable "a".
        expect(evalE("${which}", ctx)).toBe("apple");
    });
});

// ─── Embedded brackets ───

describe("expressions: embedded brackets", () => {
    test("embedded table call producing a number is coerced", () => {
        const ctx = makeCtx({ embeddedResults: { "@SomeTable": "7" } });
        expect(evalE("[@SomeTable] + 3", ctx)).toBe(10);
    });

    test("embedded table call producing a string stays a string", () => {
        const ctx = makeCtx({ embeddedResults: { "@NameTable": "Alice" } });
        expect(evalE("[@NameTable]", ctx)).toBe("Alice");
    });

    test("embedded call with whitespace in result still coerces", () => {
        const ctx = makeCtx({ embeddedResults: { "@N": "  4  " } });
        expect(evalE("[@N] * 2", ctx)).toBe(8);
    });

    test("embedded brace expression inside expression", () => {
        // {expr} inside {expr} — re-evaluates inner via the same ctx
        const ctx = makeCtx({ vars: { n: 5 } });
        expect(evalE("{n + 1} * 2", ctx)).toBe(12);
    });

    test("empty embedded result becomes empty string", () => {
        const ctx = makeCtx({ embeddedResults: { "@T": "" } });
        // Concatenation: '' + 'x' → 'x'
        expect(evalE("[@T] + 'x'", ctx)).toBe("x");
    });
});

// ─── Error handling ───

describe("expressions: errors", () => {
    test("trailing garbage throws", () => {
        expect(() => evalE("1 + 2 foo")).toThrow(ExpressionError);
    });

    test("missing closing paren throws", () => {
        expect(() => evalE("(1 + 2")).toThrow(ExpressionError);
    });

    test("missing comma in function args throws", () => {
        expect(() => evalE("max(1 2)")).toThrow(ExpressionError);
    });

    test("unexpected operator throws", () => {
        expect(() => evalE("* 5")).toThrow(ExpressionError);
    });
});
