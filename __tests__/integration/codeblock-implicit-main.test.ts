/** @jest-environment node */
/**
 * End-to-end regression for the "codeblock with Use: but no Table:"
 * scenario. Pre-fix, codeblocks like:
 *
 *     Use: Other.ipt
 *     [@Thing]
 *
 * silently rendered nothing — the parser dropped the orphan item
 * because no `Table:` had been declared, and the evaluator returned
 * "" when there were no tables to roll. This was a major footgun:
 * users could spend a long debugging session before realising they
 * needed `Table: Main` on the line above their call.
 *
 * The parser fix creates an implicit `__main__` table for orphan
 * items, so bare-call codeblocks Just Work.
 */
import { Evaluator } from "../../src/engine/evaluator";
import { inMemorySource, resolveBundle } from "../../src/resolver/fileResolver";

describe("codeblock with Use: but no Table: (implicit main)", () => {
    const otherIpt = `Title: Other

Table: Thing
hello
world
greetings
`;

    test("bare [@Thing] call resolves through Use:", () => {
        const codeblock = "Use: Other.ipt\n[@Thing]\n";
        const b = resolveBundle("__codeblock.ipt", codeblock, {
            source: inMemorySource({ "Other.ipt": otherIpt }),
            callerDir: ""
        });
        const out = new Evaluator(b.main, b.extras, { seed: 1 }).run();
        expect(out.length).toBeGreaterThan(0);
        expect(["hello", "world", "greetings"]).toContain(out);
    });

    test("literal-plus-call composes as expected", () => {
        // Demonstrates that the implicit __main__ table treats the
        // line as a normal item: literal text + interpolated call.
        const codeblock = "Use: Other.ipt\nThe greeting is: [@Thing]\n";
        const b = resolveBundle("__codeblock.ipt", codeblock, {
            source: inMemorySource({ "Other.ipt": otherIpt }),
            callerDir: ""
        });
        const out = new Evaluator(b.main, b.extras, { seed: 1 }).run();
        expect(out).toMatch(/^The greeting is: (hello|world|greetings)$/);
    });

    test("explicit Table: Main still works alongside Use:", () => {
        // Pre-fix workaround. Confirms it still does the right thing
        // after the parser change.
        const codeblock = "Use: Other.ipt\nTable: Main\n[@Thing]\n";
        const b = resolveBundle("__codeblock.ipt", codeblock, {
            source: inMemorySource({ "Other.ipt": otherIpt }),
            callerDir: ""
        });
        const out = new Evaluator(b.main, b.extras, { seed: 1 }).run();
        expect(["hello", "world", "greetings"]).toContain(out);
    });

    test("Use:-only codeblock with no items renders empty (no crash)", () => {
        // No items → no implicit main → evaluator returns "".
        // The Other.ipt extras load fine but there's nothing to roll
        // at the top level. This is a degenerate case that shouldn't
        // throw.
        const codeblock = "Use: Other.ipt\n";
        const b = resolveBundle("__codeblock.ipt", codeblock, {
            source: inMemorySource({ "Other.ipt": otherIpt }),
            callerDir: ""
        });
        const out = new Evaluator(b.main, b.extras, { seed: 1 }).run();
        expect(out).toBe("");
    });
});
