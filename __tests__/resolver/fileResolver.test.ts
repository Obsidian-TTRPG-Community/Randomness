/**
 * Tests for the file resolver.
 *
 * The resolver is given a FileSource — an in-memory map for these
 * tests. We exercise:
 *   - Path normalisation (backslash → slash, segment collapsing).
 *   - Single-level resolution (current dir / generator root fallback).
 *   - Recursive Use: chains, in declaration order.
 *   - Deduplication of files visited twice via different paths.
 *   - Cycle detection.
 *   - .md dispatch through the markdown extractor.
 *   - Error surfaces (missing target, import-depth cap).
 */

import {
    resolveBundle,
    resolveUsePath,
    normalisePath,
    joinPath,
    dirname,
    inMemorySource,
    ResolveError,
    ImportCycleError,
    parseFileSource,
} from "../../src/resolver/fileResolver";

// ────────── Pure path helpers ──────────

describe("normalisePath", () => {
    test("backslashes become forward slashes", () => {
        expect(normalisePath("a\\b\\c.ipt")).toBe("a/b/c.ipt");
    });

    test("mixed slashes are normalised", () => {
        expect(normalisePath("a\\b/c\\d.ipt")).toBe("a/b/c/d.ipt");
    });

    test("repeated slashes are collapsed", () => {
        expect(normalisePath("a//b///c")).toBe("a/b/c");
    });

    test("whitespace is trimmed", () => {
        expect(normalisePath("  foo/bar.ipt  ")).toBe("foo/bar.ipt");
    });

    test("empty input stays empty", () => {
        expect(normalisePath("")).toBe("");
    });
});

describe("joinPath", () => {
    test("simple relative join", () => {
        expect(joinPath("/gens", "foo.ipt")).toBe("/gens/foo.ipt");
    });

    test("trailing slash on base is ignored", () => {
        expect(joinPath("/gens/", "foo.ipt")).toBe("/gens/foo.ipt");
    });

    test("absolute relative wins over base", () => {
        // If `relative` starts with /, it IS the path.
        expect(joinPath("/gens", "/other/foo.ipt")).toBe("/other/foo.ipt");
    });

    test("backslashes in either part are normalised", () => {
        expect(joinPath("vault\\gens", "sub\\foo.ipt")).toBe("vault/gens/sub/foo.ipt");
    });

    test(".. segments collapse upward", () => {
        expect(joinPath("/a/b/c", "../foo.ipt")).toBe("/a/b/foo.ipt");
    });

    test("multiple .. segments collapse", () => {
        expect(joinPath("/a/b/c", "../../foo.ipt")).toBe("/a/foo.ipt");
    });

    test("`.` segments are skipped", () => {
        expect(joinPath("/a/b", "./foo.ipt")).toBe("/a/b/foo.ipt");
    });

    test(".. past the root is dropped silently", () => {
        // The string-level collapser doesn't fail on `..` past root —
        // the path just runs out. Caller sees "not found" if it matters.
        expect(joinPath("/a", "../../../foo")).toBe("/foo");
    });
});

describe("dirname", () => {
    test("normal absolute path", () => {
        expect(dirname("/a/b/c.ipt")).toBe("/a/b");
    });

    test("root file", () => {
        expect(dirname("/foo.ipt")).toBe("/");
    });

    test("relative path", () => {
        expect(dirname("gens/foo.ipt")).toBe("gens");
    });

    test("no slash → empty", () => {
        expect(dirname("foo.ipt")).toBe("");
    });

    test("backslash input normalised first", () => {
        expect(dirname("a\\b\\c.ipt")).toBe("a/b");
    });
});

// ────────── resolveUsePath ──────────

describe("resolveUsePath", () => {
    test("relative-to-caller wins when it exists", () => {
        const src = inMemorySource({
            "/gens/foo.ipt": "x",
            "/root/foo.ipt": "y", // also present at root; caller-dir should win
        });
        const result = resolveUsePath("foo.ipt", {
            callerDir: "/gens",
            generatorRoot: "/root",
            source: src,
        });
        expect(result).toBe("/gens/foo.ipt");
    });

    test("falls back to generator root when caller-dir doesn't have it", () => {
        const src = inMemorySource({
            "/root/common/x.ipt": "x",
        });
        const result = resolveUsePath("common/x.ipt", {
            callerDir: "/gens",
            generatorRoot: "/root",
            source: src,
        });
        expect(result).toBe("/root/common/x.ipt");
    });

    test("backslash references normalise and resolve", () => {
        // Real-world IPP3 legacy path.
        const src = inMemorySource({
            "/gens/common/srd/Treasure.ipt": "x",
        });
        const result = resolveUsePath("common\\srd\\Treasure.ipt", {
            callerDir: "/gens",
            source: src,
        });
        expect(result).toBe("/gens/common/srd/Treasure.ipt");
    });

    test("missing target returns null", () => {
        const src = inMemorySource({ "/gens/foo.ipt": "x" });
        const result = resolveUsePath("missing.ipt", {
            callerDir: "/gens",
            source: src,
        });
        expect(result).toBeNull();
    });

    test("absolute-rooted ref resolves directly", () => {
        const src = inMemorySource({ "/abs/path.ipt": "x" });
        const result = resolveUsePath("/abs/path.ipt", {
            callerDir: "/gens",
            source: src,
        });
        expect(result).toBe("/abs/path.ipt");
    });

    test("empty ref returns null", () => {
        const src = inMemorySource({ "/gens/foo.ipt": "x" });
        expect(
            resolveUsePath("", { callerDir: "/gens", source: src })
        ).toBeNull();
    });

    test("IPP3 Common-library lookup: ref resolves under <root>/Common/", () => {
        // The canonical IPP3 layout: a generator at
        //   <vault>/IPP3/Common/nbos/Encounters/Orcs.ipt
        // references
        //   Use: nbos/names/orc.ipt
        // The generator root is configured as `IPP3` (the top of the
        // mirror). The legacy reference implicitly assumes Common/ is
        // its lookup root — so we try <root>/Common/<ref> as a
        // candidate before <root>/<ref>.
        const src = inMemorySource({
            "IPP3/Common/nbos/Encounters/Orcs.ipt": "x",
            "IPP3/Common/nbos/Names/Orc.ipt": "target",
        });
        const result = resolveUsePath("nbos/Names/Orc.ipt", {
            callerDir: "IPP3/Common/nbos/Encounters",
            generatorRoot: "IPP3",
            source: src,
        });
        // Caller-dir doesn't have nbos/Names; Common-lookup does.
        expect(result).toBe("IPP3/Common/nbos/Names/Orc.ipt");
    });

    test("Common-library lookup prefers Common/ over bare root when both could match", () => {
        // Two files exist: <root>/foo.ipt AND <root>/Common/foo.ipt.
        // We want Common/ to win because that's the canonical IPP3
        // namespace; the bare-root match is the fallback for vaults
        // that don't use the Common/ layer.
        const src = inMemorySource({
            "/root/foo.ipt": "shallow",
            "/root/Common/foo.ipt": "common-namespace",
        });
        const result = resolveUsePath("foo.ipt", {
            callerDir: "",
            generatorRoot: "/root",
            source: src,
        });
        expect(result).toBe("/root/Common/foo.ipt");
    });

    test("Common-library lookup is skipped silently when no Common/ subfolder exists", () => {
        // For vaults that don't follow the IPP3 layout, the Common/
        // candidate just doesn't exist and we fall through to the
        // bare-root candidate. Verifies we don't break that flow.
        const src = inMemorySource({
            "/Gens/things/a.ipt": "target",
        });
        const result = resolveUsePath("things/a.ipt", {
            callerDir: "",
            generatorRoot: "/Gens",
            source: src,
        });
        expect(result).toBe("/Gens/things/a.ipt");
    });
});

// ────────── parseFileSource (.md vs .ipt dispatch) ──────────

describe("parseFileSource", () => {
    test(".ipt path parses raw source", () => {
        const src = "Table: T\nA\nB";
        const f = parseFileSource("/gens/x.ipt", src);
        expect(f.tables).toHaveLength(1);
        expect(f.tables[0].name).toBe("T");
    });

    test(".md path extracts randomness codeblocks first", () => {
        const md = [
            "# My Notes",
            "",
            "```randomness",
            "Table: T",
            "A",
            "```",
            "",
            "more prose",
        ].join("\n");
        const f = parseFileSource("/gens/x.md", md);
        // Author tables only — every .md also gains hidden __lines:/
        // __blocks: tables since the Dice Roller merge (Phase 4).
        const authored = f.tables.filter((t) => !t.name.startsWith("__"));
        expect(authored).toHaveLength(1);
        expect(authored[0].name).toBe("T");
    });

    test(".md with no codeblocks produces empty file", () => {
        const f = parseFileSource("/gens/x.md", "# Just prose\n\nNo blocks here.");
        expect(f.tables.filter((t) => !t.name.startsWith("__"))).toHaveLength(0);
    });

    test(".MD (uppercase) is also dispatched to extractor", () => {
        const md = "```randomness\nTable: T\nA\n```";
        const f = parseFileSource("/gens/x.MD", md);
        expect(f.tables.filter((t) => !t.name.startsWith("__"))).toHaveLength(1);
    });
});

// ────────── resolveBundle: full recursive resolution ──────────

describe("resolveBundle: linear chain", () => {
    test("file with one Use: produces main + 1 extra", () => {
        const src = inMemorySource({
            "/gens/main.ipt": "Use:helper.ipt\nTable: Main\n[@HelperTable]",
            "/gens/helper.ipt": "Table: HelperTable\nhello",
        });
        const bundle = resolveBundle(
            "/gens/main.ipt",
            src.read("/gens/main.ipt") as string,
            { callerDir: "/gens", source: src }
        );
        expect(bundle.main.tables).toHaveLength(1);
        expect(bundle.extras).toHaveLength(1);
        expect(bundle.extras[0].tables[0].name).toBe("HelperTable");
        expect(bundle.loadedPaths).toEqual(["/gens/main.ipt", "/gens/helper.ipt"]);
    });

    test("Use: chain of three files loads all three in order", () => {
        const src = inMemorySource({
            "/g/a.ipt": "Use:b.ipt\nTable: A",
            "/g/b.ipt": "Use:c.ipt\nTable: B",
            "/g/c.ipt": "Table: C",
        });
        const bundle = resolveBundle(
            "/g/a.ipt",
            src.read("/g/a.ipt") as string,
            { callerDir: "/g", source: src }
        );
        expect(bundle.loadedPaths).toEqual([
            "/g/a.ipt",
            "/g/b.ipt",
            "/g/c.ipt",
        ]);
        expect(bundle.extras.map((e) => e.tables[0].name)).toEqual(["B", "C"]);
    });
});

describe("resolveBundle: diamond and dedupe", () => {
    test("a file used by two parents is loaded once", () => {
        // Diamond: main → A and main → B; both A and B Use: shared.ipt
        const src = inMemorySource({
            "/g/main.ipt": "Use:a.ipt\nUse:b.ipt\nTable: Main",
            "/g/a.ipt": "Use:shared.ipt\nTable: A",
            "/g/b.ipt": "Use:shared.ipt\nTable: B",
            "/g/shared.ipt": "Table: Shared",
        });
        const bundle = resolveBundle(
            "/g/main.ipt",
            src.read("/g/main.ipt") as string,
            { callerDir: "/g", source: src }
        );
        // shared.ipt appears once even though A and B both reference it.
        const shareds = bundle.extras.filter((f) =>
            f.tables.some((t) => t.name === "Shared")
        );
        expect(shareds).toHaveLength(1);
        // Total extras: a, shared, b — shared came in via A first.
        expect(bundle.loadedPaths).toEqual([
            "/g/main.ipt",
            "/g/a.ipt",
            "/g/shared.ipt",
            "/g/b.ipt",
        ]);
    });
});

describe("resolveBundle: cycles", () => {
    test("direct cycle throws ImportCycleError", () => {
        const src = inMemorySource({
            "/g/a.ipt": "Use:b.ipt\nTable: A",
            "/g/b.ipt": "Use:a.ipt\nTable: B",
        });
        try {
            resolveBundle(
                "/g/a.ipt",
                src.read("/g/a.ipt") as string,
                { callerDir: "/g", source: src }
            );
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ImportCycleError);
            const ce = err as ImportCycleError;
            // Chain contains both files in order.
            expect(ce.chain).toContain("/g/a.ipt");
            expect(ce.chain).toContain("/g/b.ipt");
        }
    });

    test("self-import is a silent no-op (changed in the Dice Roller merge)", () => {
        // Previously a self-Use threw ImportCycleError. Once notes hold
        // rollable tables it becomes easy to write `Use: [[This Note]]`
        // inside the note itself, and the file's own tables are already
        // loaded — so a self-import now resolves to nothing instead of
        // erroring. True multi-file cycles still throw (tests below).
        const src = inMemorySource({
            "/g/a.ipt": "Use:a.ipt\nTable: A",
        });
        const bundle = resolveBundle(
            "/g/a.ipt",
            src.read("/g/a.ipt") as string,
            { callerDir: "/g", source: src }
        );
        expect(bundle.extras).toHaveLength(0);
        expect(bundle.loadedPaths).toEqual(["/g/a.ipt"]);
    });

    test("three-step cycle is caught", () => {
        const src = inMemorySource({
            "/g/a.ipt": "Use:b.ipt\nTable: A",
            "/g/b.ipt": "Use:c.ipt\nTable: B",
            "/g/c.ipt": "Use:a.ipt\nTable: C",
        });
        expect(() =>
            resolveBundle(
                "/g/a.ipt",
                src.read("/g/a.ipt") as string,
                { callerDir: "/g", source: src }
            )
        ).toThrow(ImportCycleError);
    });
});

describe("resolveBundle: error cases", () => {
    test("missing Use: target throws ResolveError", () => {
        const src = inMemorySource({
            "/g/a.ipt": "Use:does-not-exist.ipt\nTable: A",
        });
        try {
            resolveBundle(
                "/g/a.ipt",
                src.read("/g/a.ipt") as string,
                { callerDir: "/g", source: src }
            );
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ResolveError);
            expect((err as ResolveError).message).toMatch(/not found/);
            expect((err as ResolveError).path).toBe("does-not-exist.ipt");
        }
    });

    test("import depth limit is honoured", () => {
        // Chain a → b → c → d, with maxImportDepth=2 → fails on the
        // third hop because depth includes the entry visit.
        const src = inMemorySource({
            "/g/a.ipt": "Use:b.ipt\nTable: A",
            "/g/b.ipt": "Use:c.ipt\nTable: B",
            "/g/c.ipt": "Use:d.ipt\nTable: C",
            "/g/d.ipt": "Table: D",
        });
        expect(() =>
            resolveBundle(
                "/g/a.ipt",
                src.read("/g/a.ipt") as string,
                { callerDir: "/g", source: src, maxImportDepth: 2 }
            )
        ).toThrow(ResolveError);
    });
});

describe("resolveBundle: mixed .md and .ipt", () => {
    test("a .ipt can Use: a .md and the codeblocks come through", () => {
        const src = inMemorySource({
            "/g/main.ipt": "Use:helper.md\nTable: Main\n[@Helper]",
            "/g/helper.md":
                "# Helper notes\n\n```randomness\nTable: Helper\nfrom-md\n```\n",
        });
        const bundle = resolveBundle(
            "/g/main.ipt",
            src.read("/g/main.ipt") as string,
            { callerDir: "/g", source: src }
        );
        expect(bundle.extras).toHaveLength(1);
        expect(bundle.extras[0].tables.map((t) => t.name)).toContain("Helper");
    });

    test("a .md file as the main entry point also works", () => {
        const src = inMemorySource({
            "/g/notes.md":
                "# Generator\n\n```randomness\nTable: T\nfrom-md\n```",
        });
        const bundle = resolveBundle(
            "/g/notes.md",
            src.read("/g/notes.md") as string,
            { callerDir: "/g", source: src }
        );
        const authored = bundle.main.tables.filter(
            (t) => !t.name.startsWith("__")
        );
        expect(authored).toHaveLength(1);
        expect(authored[0].name).toBe("T");
    });
});

describe("resolveBundle: end-to-end with engine", () => {
    test("resolved bundle plugs into the Evaluator and runs", async () => {
        // Make sure the resolver's output is directly usable by the
        // engine — this is the contract that matters for the UI layer.
        const { Evaluator } = await import("../../src/engine/evaluator");
        const src = inMemorySource({
            "/g/main.ipt": "Use:names.ipt\nTable: Main\n[@Names]",
            "/g/names.ipt": "Table: Names\nAlice\nBob\nCarol",
        });
        const bundle = resolveBundle(
            "/g/main.ipt",
            src.read("/g/main.ipt") as string,
            { callerDir: "/g", source: src }
        );
        const e = new Evaluator(bundle.main, bundle.extras, { seed: 1 });
        const result = e.run();
        expect(["Alice", "Bob", "Carol"]).toContain(result);
    });
});
