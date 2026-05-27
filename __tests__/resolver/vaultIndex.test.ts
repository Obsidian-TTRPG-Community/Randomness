/** @jest-environment node */
/**
 * Tests for the vault index (bare-filename + table-name lookup) and
 * its integration as resolveUsePath's step-5 fallback.
 */
import { VaultIndex, IndexVault } from "../../src/resolver/vaultIndex";
import { resolveUsePath, inMemorySource } from "../../src/resolver/fileResolver";

function makeVault(files: Record<string, string>): IndexVault {
    return {
        getFiles: () => Object.keys(files).map((path) => ({ path })),
        read: async (path: string) => {
            if (!(path in files)) throw new Error("not found: " + path);
            return files[path];
        },
    };
}

describe("VaultIndex: basename lookup", () => {
    test("finds a unique basename anywhere in the vault", async () => {
        const files = {
            "deep/nested/AdventureHooks.ipt": "Table: Hooks\na\nb",
        };
        const idx = new VaultIndex(makeVault(files), () => "");
        await idx.prewarm();
        expect(idx.resolveBasename("AdventureHooks.ipt", "")).toBe(
            "deep/nested/AdventureHooks.ipt"
        );
    });

    test("is case-insensitive on the basename", async () => {
        const files = { "X/Thing.ipt": "Table: T\na" };
        const idx = new VaultIndex(makeVault(files), () => "");
        await idx.prewarm();
        expect(idx.resolveBasename("thing.ipt", "")).toBe("X/Thing.ipt");
    });

    test("returns null for an unknown basename", async () => {
        const idx = new VaultIndex(makeVault({}), () => "");
        await idx.prewarm();
        expect(idx.resolveBasename("nope.ipt", "")).toBeNull();
    });
});

describe("VaultIndex: collisions (the two-AdventureHooks case)", () => {
    const files = {
        "AdventureHooks.ipt": "Table: Hooks\na",
        "nbos/AdventureHooks.ipt": "Table: Hooks\nb",
    };

    test("prefers a match in/under the caller's folder", async () => {
        const idx = new VaultIndex(makeVault(files), () => "");
        await idx.prewarm();
        // Caller is in nbos/ → should get nbos/AdventureHooks.ipt.
        expect(
            idx.resolveBasename("AdventureHooks.ipt", "nbos")
        ).toBe("nbos/AdventureHooks.ipt");
    });

    test("falls back to first-by-path with a one-time warning", async () => {
        const warn = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        const idx = new VaultIndex(makeVault(files), () => "");
        await idx.prewarm();
        // No caller folder relationship → first sorted path.
        const r = idx.resolveBasename("AdventureHooks.ipt", "");
        expect(r).toBe("AdventureHooks.ipt"); // sorts before nbos/
        expect(warn).toHaveBeenCalledTimes(1);
        // Second lookup of the same name does NOT warn again.
        idx.resolveBasename("AdventureHooks.ipt", "");
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe("VaultIndex: table lookup", () => {
    test("maps a table name to its defining file", async () => {
        const files = {
            "shops/shop.ipt": "Table: FantasyShop\na\nb",
            "other.ipt": "Table: Something\nx",
        };
        const idx = new VaultIndex(makeVault(files), () => "");
        await idx.prewarm();
        expect(idx.resolveTable("FantasyShop")).toEqual([
            "shops/shop.ipt",
        ]);
    });

    test("returns all files for an ambiguous table name, sorted", async () => {
        const files = {
            "b.ipt": "Table: Loot\nx",
            "a.ipt": "Table: Loot\ny",
        };
        const idx = new VaultIndex(makeVault(files), () => "");
        await idx.prewarm();
        expect(idx.resolveTable("Loot")).toEqual(["a.ipt", "b.ipt"]);
    });

    test("a file with a parse error is still indexed by basename", async () => {
        const files = {
            // Deliberately broken content (unbalanced bracket).
            "broken.ipt": "Table: T\n[@unclosed",
        };
        const idx = new VaultIndex(makeVault(files), () => "");
        await idx.prewarm();
        // Basename still resolves even though table parse may fail.
        expect(idx.resolveBasename("broken.ipt", "")).toBe("broken.ipt");
    });
});

describe("VaultIndex: scope", () => {
    test("only indexes files under the generator root when set", async () => {
        const files = {
            "IPP3/Generators/a.ipt": "Table: InScope\nx",
            "Elsewhere/b.ipt": "Table: OutOfScope\ny",
        };
        const idx = new VaultIndex(
            makeVault(files),
            () => "IPP3/Generators"
        );
        await idx.prewarm();
        expect(idx.resolveBasename("a.ipt", "")).toBe(
            "IPP3/Generators/a.ipt"
        );
        // Out-of-root file is not indexed.
        expect(idx.resolveBasename("b.ipt", "")).toBeNull();
        expect(idx.resolveTable("OutOfScope")).toEqual([]);
    });
});

describe("VaultIndex: invalidation", () => {
    test("rebuilds after invalidate picks up new files", async () => {
        const files: Record<string, string> = {
            "a.ipt": "Table: A\nx",
        };
        const idx = new VaultIndex(makeVault(files), () => "");
        await idx.prewarm();
        expect(idx.resolveBasename("b.ipt", "")).toBeNull();
        // Add a file, invalidate, re-prewarm.
        files["b.ipt"] = "Table: B\ny";
        idx.invalidate();
        await idx.prewarm();
        expect(idx.resolveBasename("b.ipt", "")).toBe("b.ipt");
    });
});

describe("resolveUsePath: step-5 bare-filename fallback", () => {
    test("uses basenameResolver only after positional steps fail", () => {
        const files = {
            "deep/AdventureHooks.ipt": "Table: Hooks\na",
        };
        const source = inMemorySource(files);
        // Bare ref, caller elsewhere, no generator root: steps 1-4 fail.
        const resolved = resolveUsePath("AdventureHooks.ipt", {
            source,
            callerDir: "somewhere/else",
            basenameResolver: (name) =>
                name === "AdventureHooks.ipt"
                    ? "deep/AdventureHooks.ipt"
                    : null,
        });
        expect(resolved).toBe("deep/AdventureHooks.ipt");
    });

    test("positional resolution still wins over the index", () => {
        const files = {
            "caller/AdventureHooks.ipt": "Table: Hooks\nlocal",
            "deep/AdventureHooks.ipt": "Table: Hooks\nfar",
        };
        const source = inMemorySource(files);
        const resolved = resolveUsePath("AdventureHooks.ipt", {
            source,
            callerDir: "caller",
            // Index would point elsewhere, but step 1 (sibling) wins.
            basenameResolver: () => "deep/AdventureHooks.ipt",
        });
        expect(resolved).toBe("caller/AdventureHooks.ipt");
    });

    test("does not fire for refs containing a slash", () => {
        const source = inMemorySource({ "x/y.ipt": "Table: T\na" });
        let called = false;
        const resolved = resolveUsePath("sub/y.ipt", {
            source,
            callerDir: "",
            basenameResolver: () => {
                called = true;
                return "x/y.ipt";
            },
        });
        // "sub/y.ipt" has a slash → index fallback must not be consulted.
        expect(called).toBe(false);
        expect(resolved).toBeNull();
    });

    test("verifies the index result actually exists in source", () => {
        const source = inMemorySource({ "real.ipt": "Table: T\na" });
        const resolved = resolveUsePath("ghost.ipt", {
            source,
            callerDir: "",
            // Index lies — points at a nonexistent file.
            basenameResolver: () => "nonexistent.ipt",
        });
        expect(resolved).toBeNull();
    });
});
