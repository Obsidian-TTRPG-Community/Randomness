/**
 * Tests for the async prefetcher.
 *
 * The prefetcher walks Use: chains async, fetches files, populates an
 * in-memory FileSource. The synchronous resolver then runs against
 * that. Tests prove:
 *   - Linear chains are fully fetched.
 *   - Diamonds dedupe.
 *   - Cycles don't loop forever (the loaded-set short-circuits).
 *   - Missing files are recorded, not thrown.
 *   - Depth cap is honoured.
 *   - The output composes with the synchronous resolver to produce a
 *     working Evaluator bundle (the contract that matters in practice).
 */

import {
    prefetchUseGraph,
    inMemoryAsyncSource,
} from "../../src/resolver/asyncPrefetcher";
import { resolveBundle } from "../../src/resolver/fileResolver";
import { Evaluator } from "../../src/engine/evaluator";

describe("prefetcher: extraUses (direct wikilink rolls)", () => {
    test("extra Use refs are walked from the entry, snapshot entry stays pristine", async () => {
        // Live bug: `dice: [[1E Inns^city1]]` from a note in a
        // subfolder — the Use: line is injected at bundle-build time,
        // so prefetch must be told about the target explicitly.
        const src = inMemoryAsyncSource({
            "Dice Roller/1E Inns.md":
                "| dice:1d4 | Meal |\n| - | - |\n| **1-4** | Stew |\n\n^city1",
        });
        const noteSource = "# Inn Generator\n\nNo codeblocks here.";
        const result = await prefetchUseGraph({
            entryPath: "Dice Roller/1E Inn Generator.md",
            entrySource: noteSource,
            source: src,
            extraUses: ["[[1E Inns]]"],
        });
        expect(result.missing).toEqual([]);
        expect(result.source.exists("Dice Roller/1E Inns.md")).toBe(true);
        // The stored entry is byte-identical to the real note — the
        // extra Use: line is walk-only.
        expect(result.source.read("Dice Roller/1E Inn Generator.md")).toBe(
            noteSource
        );
    });

    test("extra Use target's own Use: graph is walked too", async () => {
        const src = inMemoryAsyncSource({
            "notes/Target.md":
                "```randomness\nUse:helper.ipt\nTable: T\n[@Helper]\n```\n\n^x",
            "notes/helper.ipt": "Table: Helper\nx",
        });
        const result = await prefetchUseGraph({
            entryPath: "notes/Note.md",
            entrySource: "",
            source: src,
            extraUses: ["[[Target]]"],
        });
        expect(result.source.exists("notes/Target.md")).toBe(true);
        expect(result.source.exists("notes/helper.ipt")).toBe(true);
    });
});

describe("prefetcher: simple chains", () => {
    test("entry file with no Use: produces a source containing only it", async () => {
        const src = inMemoryAsyncSource({});
        const result = await prefetchUseGraph({
            entryPath: "/g/main.ipt",
            entrySource: "Table: Main\nA",
            source: src,
        });
        expect(result.loadedPaths).toEqual(["/g/main.ipt"]);
        expect(result.missing).toEqual([]);
        expect(result.source.exists("/g/main.ipt")).toBe(true);
    });

    test("single Use: is followed and content cached", async () => {
        const src = inMemoryAsyncSource({
            "/g/helper.ipt": "Table: Helper\nx",
        });
        const result = await prefetchUseGraph({
            entryPath: "/g/main.ipt",
            entrySource: "Use:helper.ipt\nTable: Main\n[@Helper]",
            source: src,
        });
        expect(result.loadedPaths).toEqual(["/g/main.ipt", "/g/helper.ipt"]);
        expect(result.source.read("/g/helper.ipt")).toBe("Table: Helper\nx");
    });

    test("transitive chain a→b→c loads all three", async () => {
        const src = inMemoryAsyncSource({
            "/g/b.ipt": "Use:c.ipt\nTable: B",
            "/g/c.ipt": "Table: C",
        });
        const result = await prefetchUseGraph({
            entryPath: "/g/a.ipt",
            entrySource: "Use:b.ipt\nTable: A",
            source: src,
        });
        expect(result.loadedPaths).toEqual([
            "/g/a.ipt",
            "/g/b.ipt",
            "/g/c.ipt",
        ]);
    });
});

describe("prefetcher: dedupe & cycles", () => {
    test("diamond: shared file fetched once", async () => {
        const src = inMemoryAsyncSource({
            "/g/a.ipt": "Use:shared.ipt\nTable: A",
            "/g/b.ipt": "Use:shared.ipt\nTable: B",
            "/g/shared.ipt": "Table: Shared",
        });
        const result = await prefetchUseGraph({
            entryPath: "/g/main.ipt",
            entrySource: "Use:a.ipt\nUse:b.ipt\nTable: Main",
            source: src,
        });
        // shared.ipt should appear exactly once.
        const sharedCount = result.loadedPaths.filter(
            (p) => p === "/g/shared.ipt"
        ).length;
        expect(sharedCount).toBe(1);
    });

    test("direct cycle a→b→a doesn't loop forever", async () => {
        const src = inMemoryAsyncSource({
            "/g/a.ipt": "Use:b.ipt",
            "/g/b.ipt": "Use:a.ipt",
        });
        const result = await prefetchUseGraph({
            entryPath: "/g/a.ipt",
            entrySource: "Use:b.ipt",
            source: src,
        });
        // Both files loaded, no infinite recursion.
        expect(new Set(result.loadedPaths)).toEqual(
            new Set(["/g/a.ipt", "/g/b.ipt"])
        );
    });

    test("self-cycle is harmless", async () => {
        const src = inMemoryAsyncSource({});
        const result = await prefetchUseGraph({
            entryPath: "/g/a.ipt",
            entrySource: "Use:a.ipt\nTable: A",
            source: src,
        });
        // a.ipt is the entry; the Use: target resolves to itself but is
        // already loaded → short-circuits.
        expect(result.loadedPaths).toEqual(["/g/a.ipt"]);
    });
});

describe("prefetcher: missing files", () => {
    test("missing Use: target is recorded, not thrown", async () => {
        const src = inMemoryAsyncSource({});
        const result = await prefetchUseGraph({
            entryPath: "/g/main.ipt",
            entrySource: "Use:missing.ipt\nTable: Main",
            source: src,
        });
        expect(result.missing).toContain("missing.ipt");
        expect(result.loadedPaths).toEqual(["/g/main.ipt"]);
    });

    test("missing nested file doesn't stop the rest", async () => {
        // Main → ok.ipt (resolves), missing.ipt (doesn't), other.ipt (resolves).
        const src = inMemoryAsyncSource({
            "/g/ok.ipt": "Table: Ok",
            "/g/other.ipt": "Table: Other",
        });
        const result = await prefetchUseGraph({
            entryPath: "/g/main.ipt",
            entrySource:
                "Use:ok.ipt\nUse:missing.ipt\nUse:other.ipt\nTable: Main",
            source: src,
        });
        expect(result.loadedPaths).toEqual([
            "/g/main.ipt",
            "/g/ok.ipt",
            "/g/other.ipt",
        ]);
        expect(result.missing).toContain("missing.ipt");
    });
});

describe("prefetcher: generatorRoot fallback", () => {
    test("Use: not in caller-dir falls back to generator root", async () => {
        const src = inMemoryAsyncSource({
            "/v/gens/common/x.ipt": "Table: Common",
        });
        const result = await prefetchUseGraph({
            entryPath: "/v/notes/main.ipt",
            entrySource: "Use:common/x.ipt\nTable: Main",
            generatorRoot: "/v/gens",
            source: src,
        });
        expect(result.loadedPaths).toContain("/v/gens/common/x.ipt");
    });
});

describe("prefetcher: depth cap", () => {
    test("chain shorter than the cap is fully walked", async () => {
        const src = inMemoryAsyncSource({
            "/g/b.ipt": "Use:c.ipt",
            "/g/c.ipt": "Table: C",
        });
        const result = await prefetchUseGraph({
            entryPath: "/g/a.ipt",
            entrySource: "Use:b.ipt",
            source: src,
            maxImportDepth: 5,
        });
        expect(result.loadedPaths).toEqual([
            "/g/a.ipt",
            "/g/b.ipt",
            "/g/c.ipt",
        ]);
    });

    test("walk stops at the cap (caller will see resolver error on the truncated graph)", async () => {
        // depth=2 means the entry walks (depth 0), b is fetched and walked (depth 1),
        // c is fetched and walked (depth 2) but its Use: list won't be expanded.
        // So d.ipt should NOT be fetched.
        const src = inMemoryAsyncSource({
            "/g/b.ipt": "Use:c.ipt",
            "/g/c.ipt": "Use:d.ipt",
            "/g/d.ipt": "Table: D",
        });
        const result = await prefetchUseGraph({
            entryPath: "/g/a.ipt",
            entrySource: "Use:b.ipt",
            source: src,
            maxImportDepth: 2,
        });
        expect(result.loadedPaths).not.toContain("/g/d.ipt");
    });
});

describe("prefetcher: markdown source handling", () => {
    test("Use: lines inside .md randomness codeblocks are picked up", async () => {
        // The shallow scanner doesn't care about codeblock boundaries —
        // it just matches Use: at line start. This is intentional and
        // documented.
        const note = [
            "# Notes",
            "",
            "```randomness",
            "Use:helper.ipt",
            "Table: T",
            "x",
            "```",
        ].join("\n");
        const src = inMemoryAsyncSource({
            "/v/helper.ipt": "Table: Helper",
        });
        const result = await prefetchUseGraph({
            entryPath: "/v/note.md",
            entrySource: note,
            source: src,
        });
        expect(result.loadedPaths).toContain("/v/helper.ipt");
    });
});

describe("prefetcher: end-to-end with synchronous resolver + engine", () => {
    test("prefetched source feeds resolveBundle → Evaluator successfully", async () => {
        const src = inMemoryAsyncSource({
            "/g/names.ipt": "Table: Names\nAlice\nBob\nCarol",
        });
        const prefetch = await prefetchUseGraph({
            entryPath: "/g/main.ipt",
            entrySource: "Use:names.ipt\nTable: Main\n[@Names]",
            source: src,
        });
        // Plug into the synchronous resolver.
        const bundle = resolveBundle(
            "/g/main.ipt",
            prefetch.source.read("/g/main.ipt") as string,
            { callerDir: "/g", source: prefetch.source }
        );
        const e = new Evaluator(bundle.main, bundle.extras, { seed: 1 });
        expect(["Alice", "Bob", "Carol"]).toContain(e.run());
    });

    test("IPP3 Common-library lookup works in the async prefetcher too", async () => {
        // Mirror of the sync test in fileResolver.test.ts. Reference
        // resolves via <root>/Common/<ref>.
        const src = inMemoryAsyncSource({
            "IPP3/Common/nbos/Encounters/Orcs.ipt": "Use:nbos/Names/Orc.ipt",
            "IPP3/Common/nbos/Names/Orc.ipt": "Table: T\nGrokk",
        });
        const result = await prefetchUseGraph({
            entryPath: "IPP3/Common/nbos/Encounters/Orcs.ipt",
            entrySource: "Use:nbos/Names/Orc.ipt",
            generatorRoot: "IPP3",
            source: src,
        });
        expect(result.missing).toEqual([]);
        expect(result.loadedPaths).toContain(
            "IPP3/Common/nbos/Names/Orc.ipt"
        );
    });
});
