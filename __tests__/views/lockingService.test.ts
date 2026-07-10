/**
 * Tests for the locking service.
 *
 * Two surfaces:
 *   1. Pure text transforms (parseInlineCall, applyLockToSource,
 *      applyUnlockToSource, transformAllInlineCalls). These need
 *      sharp tests — they mutate the user's note text, and getting
 *      them wrong silently is the failure mode that hurts most.
 *   2. PreviewRegistry — in-memory store with per-note scoping.
 *
 * Node environment is fine here; no DOM.
 */

import {
    parseInlineCall,
    serialiseInlineCall,
    applyLockToSource,
    applyUnlockToSource,
    transformAllInlineCalls,
    findAllInlineCallPositions,
    PreviewRegistry,
    LOCK_SEPARATOR,
    INLINE_PREFIX,
} from "../../src/views/lockingService";

// ────────── parseInlineCall ──────────

describe("parseInlineCall", () => {
    test("unfilled call (no separator)", () => {
        expect(parseInlineCall("rdm:[@Names]")).toEqual({
            expr: "[@Names]",
        });
    });

    test("locked call with simple result", () => {
        expect(parseInlineCall("rdm:[@Names]⟹Alice")).toEqual({
            expr: "[@Names]",
            locked: "Alice",
        });
    });

    test("locked call with empty result is still locked", () => {
        // Empty result is meaningful — it's "the table returned nothing".
        expect(parseInlineCall("rdm:[@T]⟹")).toEqual({
            expr: "[@T]",
            locked: "",
        });
    });

    test("locked call with result containing spaces", () => {
        expect(parseInlineCall("rdm:[@T]⟹Hello World")).toEqual({
            expr: "[@T]",
            locked: "Hello World",
        });
    });

    test("non-rdm: text returns null", () => {
        expect(parseInlineCall("just regular text")).toBeNull();
    });

    test("rdm: prefix but in middle of string is not a match", () => {
        // parseInlineCall expects the input to start with rdm:
        expect(parseInlineCall("foo rdm:bar")).toBeNull();
    });

    test("a bare prefix is a literal mention, not a call", () => {
        // Changed in the Dice Roller merge: `` `rdm:` `` or `` `dice:` ``
        // in prose (headings, docs) used to parse as an empty call and
        // render as an error/empty span. An empty expression now
        // returns null so the code span stays literal.
        expect(parseInlineCall("rdm:")).toBeNull();
    });

    test("separator appearing in expression is parsed as a lock", () => {
        // The first separator wins; everything after is the result.
        // This is the standard "split on first delimiter" semantics.
        // If a user wants ⟹ in their expression, they can't — same as
        // the codeblock language: design constraint, not a bug.
        expect(parseInlineCall("rdm:foo⟹bar⟹baz")).toEqual({
            expr: "foo",
            locked: "bar⟹baz",
        });
    });
});

// ────────── serialiseInlineCall ──────────

describe("serialiseInlineCall", () => {
    test("unfilled round-trip", () => {
        const original = "rdm:[@Names]";
        expect(serialiseInlineCall(parseInlineCall(original)!)).toBe(original);
    });

    test("locked round-trip", () => {
        const original = "rdm:[@Names]⟹Alice";
        expect(serialiseInlineCall(parseInlineCall(original)!)).toBe(original);
    });

    test("locked-with-empty round-trip preserves the separator", () => {
        // rdm:foo⟹ (locked but empty result) must NOT lose the
        // separator — that would silently convert "locked-to-empty"
        // into "unfilled", which is a different state.
        const original = "rdm:foo⟹";
        expect(serialiseInlineCall(parseInlineCall(original)!)).toBe(original);
    });
});

// ────────── applyLockToSource ──────────

describe("applyLockToSource", () => {
    test("locks a single inline call", () => {
        const src = "Some text `rdm:[@Names]` more text.";
        const out = applyLockToSource(src, "[@Names]", 0, "Alice");
        expect(out).toBe("Some text `rdm:[@Names]⟹Alice` more text.");
    });

    test("locks the Nth occurrence and leaves others alone", () => {
        const src =
            "First `rdm:[@X]` and second `rdm:[@X]` and third `rdm:[@X]`.";
        const out = applyLockToSource(src, "[@X]", 1, "MIDDLE");
        expect(out).toBe(
            "First `rdm:[@X]` and second `rdm:[@X]⟹MIDDLE` and third `rdm:[@X]`."
        );
    });

    test("locks only one occurrence; the rest stay unfilled", () => {
        // After a lock, the locked one is recognised as locked and not
        // counted as an unfilled occurrence again. We don't re-test
        // numbering after re-lock here — applyLockToSource counts ALL
        // occurrences of the expr, locked or not, so the indices are
        // stable. See the next test.
        const src = "`rdm:[@X]` and `rdm:[@X]`";
        const first = applyLockToSource(src, "[@X]", 0, "A");
        expect(first).toBe("`rdm:[@X]⟹A` and `rdm:[@X]`");
        const second = applyLockToSource(first, "[@X]", 1, "B");
        expect(second).toBe("`rdm:[@X]⟹A` and `rdm:[@X]⟹B`");
    });

    test("re-locks an already-locked call (overwriting the result)", () => {
        // Useful when the user rerolls without unlocking first — same
        // expr, same occurrence, new result.
        const src = "`rdm:[@X]⟹old`";
        const out = applyLockToSource(src, "[@X]", 0, "new");
        expect(out).toBe("`rdm:[@X]⟹new`");
    });

    test("non-matching expression leaves source unchanged", () => {
        const src = "`rdm:[@Names]` says hello.";
        const out = applyLockToSource(src, "[@Different]", 0, "x");
        expect(out).toBe(src);
    });

    test("out-of-range occurrence leaves source unchanged", () => {
        const src = "`rdm:[@X]`";
        const out = applyLockToSource(src, "[@X]", 5, "x");
        expect(out).toBe(src);
    });

    test("text outside backticks containing rdm: is NOT touched", () => {
        // The "rdm:" prefix on its own (not wrapped in backticks)
        // shouldn't be picked up — we're only looking at code spans.
        const src = "Just talking about rdm:[@X] in prose.";
        const out = applyLockToSource(src, "[@X]", 0, "x");
        expect(out).toBe(src);
    });

    test("does not mistake non-rdm: code spans for inline calls", () => {
        const src = "`some code` and `rdm:[@X]` and `more code`.";
        const out = applyLockToSource(src, "[@X]", 0, "Alice");
        expect(out).toBe(
            "`some code` and `rdm:[@X]⟹Alice` and `more code`."
        );
    });
});

// ────────── applyUnlockToSource ──────────

describe("applyUnlockToSource", () => {
    test("strips the lock suffix from a locked call", () => {
        const src = "`rdm:[@Names]⟹Alice` Hi.";
        const out = applyUnlockToSource(src, "[@Names]", 0);
        expect(out).toBe("`rdm:[@Names]` Hi.");
    });

    test("unlocking an unfilled call is a no-op (still unfilled)", () => {
        const src = "`rdm:[@Names]`";
        const out = applyUnlockToSource(src, "[@Names]", 0);
        expect(out).toBe(src);
    });

    test("unlocks the Nth occurrence only", () => {
        const src =
            "`rdm:[@X]⟹A` and `rdm:[@X]⟹B` and `rdm:[@X]⟹C`.";
        const out = applyUnlockToSource(src, "[@X]", 1);
        expect(out).toBe(
            "`rdm:[@X]⟹A` and `rdm:[@X]` and `rdm:[@X]⟹C`."
        );
    });
});

// ────────── transformAllInlineCalls ──────────

describe("transformAllInlineCalls", () => {
    test("can lock all unfilled calls", () => {
        const src = "`rdm:[@A]` and `rdm:[@B]`.";
        const out = transformAllInlineCalls(src, (call) => {
            if (call.locked !== undefined) return null;
            return { ...call, locked: "X" };
        });
        expect(out).toBe("`rdm:[@A]⟹X` and `rdm:[@B]⟹X`.");
    });

    test("can unlock all locked calls", () => {
        const src = "`rdm:[@A]⟹old` and `rdm:[@B]⟹older`.";
        const out = transformAllInlineCalls(src, (call) => ({
            expr: call.expr, // drop the locked field
        }));
        expect(out).toBe("`rdm:[@A]` and `rdm:[@B]`.");
    });

    test("returning null leaves calls untouched", () => {
        const src = "`rdm:[@A]` and `rdm:[@B]`.";
        const out = transformAllInlineCalls(src, () => null);
        expect(out).toBe(src);
    });

    test("ignores non-rdm: code spans", () => {
        const src = "`code` and `rdm:[@X]` and `more`.";
        let touched = 0;
        const out = transformAllInlineCalls(src, (call) => {
            touched++;
            return { ...call, locked: "x" };
        });
        expect(touched).toBe(1);
        expect(out).toBe("`code` and `rdm:[@X]⟹x` and `more`.");
    });
});

// ────────── PreviewRegistry ──────────

describe("PreviewRegistry", () => {
    test("set + get round-trip", () => {
        const r = new PreviewRegistry();
        r.set({ sourcePath: "n.md", expr: "[@X]", occurrence: 0 }, "Alice");
        expect(
            r.get({ sourcePath: "n.md", expr: "[@X]", occurrence: 0 })
        ).toBe("Alice");
    });

    test("get returns undefined when not set", () => {
        const r = new PreviewRegistry();
        expect(
            r.get({ sourcePath: "n.md", expr: "[@X]", occurrence: 0 })
        ).toBeUndefined();
    });

    test("different occurrences of same expr are independent", () => {
        const r = new PreviewRegistry();
        r.set({ sourcePath: "n.md", expr: "[@X]", occurrence: 0 }, "A");
        r.set({ sourcePath: "n.md", expr: "[@X]", occurrence: 1 }, "B");
        expect(
            r.get({ sourcePath: "n.md", expr: "[@X]", occurrence: 0 })
        ).toBe("A");
        expect(
            r.get({ sourcePath: "n.md", expr: "[@X]", occurrence: 1 })
        ).toBe("B");
    });

    test("same key on different notes is independent", () => {
        const r = new PreviewRegistry();
        r.set({ sourcePath: "a.md", expr: "[@X]", occurrence: 0 }, "A");
        r.set({ sourcePath: "b.md", expr: "[@X]", occurrence: 0 }, "B");
        expect(
            r.get({ sourcePath: "a.md", expr: "[@X]", occurrence: 0 })
        ).toBe("A");
        expect(
            r.get({ sourcePath: "b.md", expr: "[@X]", occurrence: 0 })
        ).toBe("B");
    });

    test("delete removes one entry", () => {
        const r = new PreviewRegistry();
        r.set({ sourcePath: "n.md", expr: "[@X]", occurrence: 0 }, "A");
        r.delete({ sourcePath: "n.md", expr: "[@X]", occurrence: 0 });
        expect(
            r.get({ sourcePath: "n.md", expr: "[@X]", occurrence: 0 })
        ).toBeUndefined();
    });

    test("clearNote removes only that note's entries", () => {
        const r = new PreviewRegistry();
        r.set({ sourcePath: "a.md", expr: "[@X]", occurrence: 0 }, "A1");
        r.set({ sourcePath: "a.md", expr: "[@Y]", occurrence: 0 }, "A2");
        r.set({ sourcePath: "b.md", expr: "[@X]", occurrence: 0 }, "B1");
        r.clearNote("a.md");
        expect(r.size()).toBe(1);
        expect(
            r.get({ sourcePath: "b.md", expr: "[@X]", occurrence: 0 })
        ).toBe("B1");
    });

    test("clear drops everything", () => {
        const r = new PreviewRegistry();
        r.set({ sourcePath: "a.md", expr: "[@X]", occurrence: 0 }, "A");
        r.set({ sourcePath: "b.md", expr: "[@X]", occurrence: 0 }, "B");
        r.clear();
        expect(r.size()).toBe(0);
    });

    test("paths with shared prefix don't accidentally clear each other", () => {
        // "a.md" and "a.md.backup" share a string prefix but are
        // different notes. clearNote on the shorter one shouldn't wipe
        // the longer.
        const r = new PreviewRegistry();
        r.set({ sourcePath: "a.md", expr: "[@X]", occurrence: 0 }, "A");
        r.set(
            { sourcePath: "a.md.backup", expr: "[@X]", occurrence: 0 },
            "Backup"
        );
        r.clearNote("a.md");
        expect(r.size()).toBe(1);
        expect(
            r.get({ sourcePath: "a.md.backup", expr: "[@X]", occurrence: 0 })
        ).toBe("Backup");
    });
});

// ────────── Constants ──────────

describe("constants", () => {
    test("LOCK_SEPARATOR is the long-double-arrow character", () => {
        expect(LOCK_SEPARATOR).toBe("\u27F9");
    });

    test("INLINE_PREFIX is rdm:", () => {
        expect(INLINE_PREFIX).toBe("rdm:");
    });

    test("INLINE_PREFIX does not start with '=' (Dataview collision)", () => {
        // Dataview claims any code span whose content starts with `=`
        // as an inline DQL query (e.g. `= date(today)`). The earlier
        // `=rdm:` prefix triggered Dataview's parser, which then
        // rendered a PARSING FAILED error block alongside our render.
        // Keep this invariant — anything starting with `=` is Dataview's.
        expect(INLINE_PREFIX.startsWith("=")).toBe(false);
    });
});

// ────────── findAllInlineCallPositions ──────────

/**
 * The post-processor uses this to align rendered DOM elements with
 * source positions. It's the foundation of "click Lock on the
 * bottom call, lock the bottom in source" — without correct
 * occurrence indexing this whole feature breaks.
 */
describe("findAllInlineCallPositions", () => {
    test("returns one entry per inline call in source order", () => {
        const src = "first `rdm:[@A]` second `rdm:[@B]` third `rdm:[@C]`";
        const positions = findAllInlineCallPositions(src);
        expect(positions).toHaveLength(3);
        expect(positions.map((p) => p.call.expr)).toEqual([
            "[@A]",
            "[@B]",
            "[@C]",
        ]);
    });

    test("assigns per-expression occurrence index", () => {
        // Three calls with the same expr → occurrences 0, 1, 2.
        // The mixed `rdm:[@B]` in the middle doesn't disturb the
        // counter for `[@A]`.
        const src =
            "`rdm:[@A]` `rdm:[@B]` `rdm:[@A]` `rdm:[@A]` `rdm:[@B]`";
        const positions = findAllInlineCallPositions(src);
        // Map (expr, occurrence) pairs in source order.
        const pairs = positions.map(
            (p) => [p.call.expr, p.occurrence] as const
        );
        expect(pairs).toEqual([
            ["[@A]", 0],
            ["[@B]", 0],
            ["[@A]", 1],
            ["[@A]", 2],
            ["[@B]", 1],
        ]);
    });

    test("records line numbers across multi-line source", () => {
        // First call on line 0, second on line 2, third on line 4.
        const src = [
            "`rdm:[@A]` first",     // line 0
            "",                       // line 1
            "second `rdm:[@A]`",   // line 2
            "",                       // line 3
            "`rdm:[@A]` third",     // line 4
        ].join("\n");
        const positions = findAllInlineCallPositions(src);
        expect(positions.map((p) => p.line)).toEqual([0, 2, 4]);
    });

    test("locked calls preserve their locked value in the parsed entry", () => {
        const src = "Filled: `rdm:[@T]⟹Bob` Unfilled: `rdm:[@T]`";
        const positions = findAllInlineCallPositions(src);
        expect(positions).toHaveLength(2);
        expect(positions[0].call.locked).toBe("Bob");
        expect(positions[1].call.locked).toBeUndefined();
        // Both contribute to the per-expression occurrence count.
        expect(positions[0].occurrence).toBe(0);
        expect(positions[1].occurrence).toBe(1);
    });

    test("ignores non-rdm code spans", () => {
        const src =
            "Some `not rdm` and `rdm:[@A]` and `also not rdm`";
        const positions = findAllInlineCallPositions(src);
        expect(positions).toHaveLength(1);
        expect(positions[0].call.expr).toBe("[@A]");
    });

    test("empty source yields empty list", () => {
        expect(findAllInlineCallPositions("")).toEqual([]);
    });

    test("source with no inline calls yields empty list", () => {
        expect(
            findAllInlineCallPositions("just plain text, no calls")
        ).toEqual([]);
    });

    test("sourceOffset points at the opening backtick", () => {
        const src = "abc `rdm:[@A]` def";
        const positions = findAllInlineCallPositions(src);
        expect(src[positions[0].sourceOffset]).toBe("`");
    });
});
