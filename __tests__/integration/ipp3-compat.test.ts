/** @jest-environment node */
/**
 * Regression tests for the IPP3 compatibility fixes in 1.0.13.
 * Each test pins a specific bug or limitation that was uncovered
 * by trying to load real community generators (Dungeon_Room_Description
 * and Ultimate_Powers_Character_Generator). Keep these green to
 * preserve real-world community-generator compatibility.
 */
import { Evaluator } from "../../src/engine/evaluator";
import { inMemorySource, resolveBundle } from "../../src/resolver/fileResolver";

function runMain(src: string, opts: any = {}): string {
    const b = resolveBundle("t.ipt", src, {
        source: inMemorySource({ "t.ipt": src }),
        callerDir: "",
    });
    return new Evaluator(b.main, b.extras, opts).run();
}

function runByName(src: string, name: string, opts: any = {}): string {
    const b = resolveBundle("t.ipt", src, {
        source: inMemorySource({ "t.ipt": src }),
        callerDir: "",
    });
    return new Evaluator(b.main, b.extras, opts).runByName(name);
}

describe("IPP3 compatibility (1.0.13)", () => {
    test("variables are case-insensitive", () => {
        // {$Prompt1} (capital) must reach the value stored as prompt1.
        const src = `Prompt: First {A|B} A

Table: T
Set: X={$Prompt1}
{$X}-{$PROMPT1}-{$prompt1}
`;
        expect(runByName(src, "T")).toBe("A-A-A");
    });

    test("Set variable reads as case-insensitive too", () => {
        const src = `Table: T
Set: MyVar=hello
{$myvar}-{$MyVar}-{$MYVAR}
`;
        expect(runByName(src, "T")).toBe("hello-hello-hello");
    });

    test("lookup table without explicit Roll: infers d% from max range", () => {
        // PhysicalForm-style table with no Roll: directive.
        const src = `Table: T
Type: Lookup
1-50:Alpha
51-100:Beta
`;
        // Multiple seeds — must always return one of the items, never empty.
        for (let s = 1; s <= 5; s++) {
            const out = runByName(src, "T", { seed: s });
            expect(out === "Alpha" || out === "Beta").toBe(true);
        }
    });

    test("bracket-wrapped conditional [[when]…[end]] in a Set value", () => {
        // Ultimate Powers idiom.
        const src = `Prompt: P {Random|42} Random

Table: T
Set: X=[[when]{$Prompt1}=Random[do]{1d100}[else]{$Prompt1}[end]]
{$X}
`;
        // Default prompt is "Random" → rolls d100, must be a number 1-100.
        const out = runByName(src, "T", { seed: 1 });
        const n = parseInt(out, 10);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(100);
    });

    test("[[wiki link]] still passes through unchanged", () => {
        // Critical: the disambiguation must NOT break Obsidian wiki-links.
        const src = `Table: T
See [[some note]] for details.
`;
        expect(runByName(src, "T")).toContain("[[some note]]");
    });

    test("[[wiki link with {var}.png]] still passes through", () => {
        // `{var}` interpolation alone doesn't disqualify a wiki-link.
        const src = `Table: T
Set: filename=goblin
![[{filename}.png]]
`;
        expect(runByName(src, "T")).toBe("![[goblin.png]]");
    });

    test("ampersand line continuation does NOT cross directive boundaries", () => {
        // Set: lines terminate at EOL even if they end with `&` — the
        // following content lines are separate items, not part of the
        // Set's value. (The `&` here is wrong IPP3 syntax that the
        // Ultimate Powers author used, but the file's body content
        // must still emit.)
        const src = `Table: T
Set: X=quiet-value-with-stray&
visible-body-content
`;
        // The body content must reach the output; the Set's value
        // shouldn't suck it in.
        expect(runByName(src, "T")).toContain("visible-body-content");
    });

    test("ampersand line continuation works for item lines", () => {
        // Continuation IS still valid for items — must continue to work.
        const src = `Table: T
line one &
still line one
`;
        expect(runByName(src, "T")).toBe("line one still line one");
    });

    test("variable arithmetic adds numerically, not as strings", () => {
        // Set: A=5 stores the string "5". `{{$A}+{$B}}` must produce 8,
        // not "53".
        const src = `Table: T
Set: A=5
Set: B=3
{{$A}+{$B}}
`;
        expect(runByName(src, "T")).toBe("8");
    });

    test("variable arithmetic with multiple operands", () => {
        const src = `Table: T
Set: A=26
Set: B=16
Set: C=16
Set: D=16
{{$A}+{$B}+{$C}+{$D}}
`;
        expect(runByName(src, "T")).toBe("74");
    });

    test("string literals in expressions still concatenate", () => {
        // Explicit IPP3 string literals must keep concat semantics.
        // (This is the long-standing behaviour preserved by fixing the
        // numeric-string promotion at variable-read time rather than
        // in addValues.)
        // 'hello' + 'world' should be 'helloworld'.
        const src = `Table: T
{'hello'+'world'}
`;
        expect(runByName(src, "T")).toBe("helloworld");
    });

    test("marker text does not re-parse infinitely", () => {
        // Regression for the recursion crash that happened when a
        // marker-form literal_bracket (text starts with [) reached
        // the evaluator. Strict marker detection means [do] etc.
        // emit as literal text, not re-parse forever.
        // (Synthetic: a stray [do] inside a Set's value.)
        const src = `Table: T
Set: X=before [do] after
{$X}
`;
        // No specific output required — just that it doesn't crash.
        expect(() => runByName(src, "T")).not.toThrow();
    });
});
