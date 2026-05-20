/**
 * Tests for the inline-scope resolver.
 *
 * The scope module composes mdExtractor + fileResolver to produce a
 * runnable bundle for `rdm:expr` calls. Tests prove:
 *   1. Plain expressions work (no in-note codeblocks needed).
 *   2. In-note codeblocks become visible to the inline call.
 *   3. Use: directives inside in-note codeblocks resolve via the
 *      generator root / note directory.
 *   4. The visibleTableNames query reflects the same scope.
 *
 * Most assertions are end-to-end through the Evaluator — the bundle's
 * value is what it does when handed to the engine.
 */

import { buildInlineBundle, visibleTableNames } from "../../src/resolver/scope";
import { inMemorySource } from "../../src/resolver/fileResolver";
import { Evaluator } from "../../src/engine/evaluator";

/** Run a synthetic bundle and return the rendered output. */
function runInline(
    expr: string,
    opts: {
        notePath: string;
        noteSource: string;
        files?: Record<string, string>;
        generatorRoot?: string;
        seed?: number;
    }
): string {
    const source = inMemorySource(opts.files ?? {});
    const bundle = buildInlineBundle(expr, {
        notePath: opts.notePath,
        noteSource: opts.noteSource,
        source,
        generatorRoot: opts.generatorRoot,
    });
    const e = new Evaluator(bundle.main, bundle.extras, {
        seed: opts.seed ?? 1,
    });
    return e.run();
}

// ────────── Plain expressions ──────────

describe("scope: plain expressions (no codeblocks)", () => {
    test("literal text", () => {
        const out = runInline("hello", {
            notePath: "/v/note.md",
            noteSource: "# A note with no codeblocks",
        });
        expect(out).toBe("hello");
    });

    test("arithmetic expression", () => {
        const out = runInline("{2 + 3}", {
            notePath: "/v/note.md",
            noteSource: "",
        });
        expect(out).toBe("5");
    });

    test("seeded dice roll is deterministic", () => {
        // 1d1 always rolls 1, so this is independent of the actual RNG.
        const out = runInline("{1d1}", {
            notePath: "/v/note.md",
            noteSource: "",
            seed: 42,
        });
        expect(out).toBe("1");
    });
});

// ────────── In-note codeblocks ──────────

describe("scope: in-note codeblocks", () => {
    test("table defined in same-note codeblock is callable", () => {
        const note = [
            "# My session",
            "",
            "```randomness",
            "Table: Settlement",
            "Riverbend",
            "Stonewatch",
            "Greenhollow",
            "```",
            "",
            "Some prose.",
        ].join("\n");
        const out = runInline("[@Settlement]", {
            notePath: "/v/session.md",
            noteSource: note,
            seed: 1,
        });
        expect(["Riverbend", "Stonewatch", "Greenhollow"]).toContain(out);
    });

    test("multiple codeblocks in the same note share a namespace", () => {
        const note = [
            "```randomness",
            "Table: Names",
            "Alice",
            "Bob",
            "```",
            "",
            "```randomness",
            "Table: Greeting",
            "Hello [@Names]!",
            "```",
        ].join("\n");
        const out = runInline("[@Greeting]", {
            notePath: "/v/note.md",
            noteSource: note,
            seed: 1,
        });
        expect(out === "Hello Alice!" || out === "Hello Bob!").toBe(true);
    });

    test("in-note table doesn't leak across notes — missing table throws", () => {
        // A different note's content is irrelevant — what matters is
        // the noteSource passed in. We test by deliberately passing a
        // note without the table.
        //
        // Under the new contract, missing tables throw an Unknown-
        // table error. The inline processor catches this and renders
        // an error span; the codeblock processor renders an error
        // block. Throwing rather than returning empty is what
        // surfaced the real-world bug where users pasted a `rdm:`
        // call into a note without the corresponding Use: line and
        // saw blank, silent output with no clue what went wrong.
        expect(() =>
            runInline("[@Settlement]", {
                notePath: "/v/other.md",
                noteSource: "# Other note, no codeblocks",
                seed: 1,
            })
        ).toThrow(/Unknown table.*Settlement/);
    });
});

// ────────── In-note Use: resolution ──────────

describe("scope: Use: from in-note codeblocks", () => {
    test("in-note codeblock Uses an external .ipt file", () => {
        const note = [
            "```randomness",
            "Use:names.ipt",
            "Table: Greeting",
            "Hello [@Names]!",
            "```",
        ].join("\n");
        const out = runInline("[@Greeting]", {
            notePath: "/v/note.md",
            noteSource: note,
            files: {
                "/v/names.ipt": "Table: Names\nAlice\nBob",
            },
            seed: 1,
        });
        expect(["Hello Alice!", "Hello Bob!"]).toContain(out);
    });

    test("in-note Use: falls back to generator root", () => {
        const note = [
            "```randomness",
            "Use:common/names.ipt",
            "Table: Greeting",
            "Hi [@Names]!",
            "```",
        ].join("\n");
        const out = runInline("[@Greeting]", {
            notePath: "/v/notes/session.md",
            noteSource: note,
            generatorRoot: "/v/generators",
            files: {
                "/v/generators/common/names.ipt": "Table: Names\nDawn",
            },
        });
        expect(out).toBe("Hi Dawn!");
    });

    test("missing Use: target propagates the resolver error", () => {
        const note = [
            "```randomness",
            "Use:missing.ipt",
            "Table: T",
            "x",
            "```",
        ].join("\n");
        expect(() =>
            runInline("[@T]", {
                notePath: "/v/note.md",
                noteSource: note,
            })
        ).toThrow(/not found/);
    });
});

// ────────── visibleTableNames ──────────

describe("scope: visibleTableNames", () => {
    test("lists tables from in-note codeblocks", () => {
        const note = [
            "```randomness",
            "Table: A",
            "x",
            "Table: B",
            "y",
            "```",
        ].join("\n");
        const names = visibleTableNames({
            notePath: "/v/note.md",
            noteSource: note,
            source: inMemorySource({}),
        });
        expect(names).toEqual(["A", "B"]);
    });

    test("includes tables pulled in via Use:", () => {
        const note = [
            "```randomness",
            "Use:other.ipt",
            "Table: Local",
            "x",
            "```",
        ].join("\n");
        const names = visibleTableNames({
            notePath: "/v/note.md",
            noteSource: note,
            source: inMemorySource({
                "/v/other.ipt": "Table: Remote\nx",
            }),
        });
        // The synthetic __inline table is excluded.
        expect(names).toEqual(["Local", "Remote"]);
    });

    test("returns empty for a note with no codeblocks and no Use:", () => {
        const names = visibleTableNames({
            notePath: "/v/note.md",
            noteSource: "# Plain prose",
            source: inMemorySource({}),
        });
        expect(names).toEqual([]);
    });

    test("results are sorted alphabetically", () => {
        const note = [
            "```randomness",
            "Table: Zebra",
            "z",
            "Table: Alpha",
            "a",
            "Table: Mango",
            "m",
            "```",
        ].join("\n");
        const names = visibleTableNames({
            notePath: "/v/note.md",
            noteSource: note,
            source: inMemorySource({}),
        });
        expect(names).toEqual(["Alpha", "Mango", "Zebra"]);
    });
});
