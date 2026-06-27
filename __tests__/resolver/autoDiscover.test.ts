/** @jest-environment node */
/**
 * Tests for table-name auto-discovery.
 *
 * Auto-discovery lets a codeblock/inline call reference a table by name
 * (`[@TavernName]`) without an explicit `Use:`, by consulting the vault
 * index (table name → file). These tests use small in-memory fixtures
 * standing in for the index and the vault.
 */
import { discoverReferencedTables } from "../../src/resolver/autoDiscover";
import { parseFileSource } from "../../src/resolver/fileResolver";
import { inMemoryAsyncSource } from "../../src/resolver/asyncPrefetcher";
import { Evaluator } from "../../src/engine/evaluator";

const TAVERN = `Table: TavernName
The [@Adjective] [@Noun]

Table: Adjective
Crooked
Silver

Table: Noun
Goblin
Drake
`;

const TOWNS = `Table: Town
Stonewatch
Riverbend
`;

// A file whose main table references a table that lives elsewhere
// (Town, in TOWNS) — used for the transitive-discovery test.
const QUESTS = `Table: Quest
Trouble in [@Town]
`;

/** Build a name→path index map from a set of files. */
function buildIndex(files: Record<string, string>): Map<string, string> {
    const idx = new Map<string, string>();
    for (const [path, source] of Object.entries(files)) {
        const parsed = parseFileSource(path, source);
        for (const t of parsed.tables) {
            // First writer wins, mirroring the real index's stable order.
            if (!idx.has(t.name.toLowerCase())) {
                idx.set(t.name.toLowerCase(), path);
            }
        }
    }
    return idx;
}

function resolverFor(files: Record<string, string>) {
    const idx = buildIndex(files);
    return (name: string): string[] => {
        const p = idx.get(name.toLowerCase());
        return p ? [p] : [];
    };
}

describe("auto-discovery", () => {
    test("discovers a table defined in another file", async () => {
        const files = { "gen/02-tavern.rdm": TAVERN };
        const main = parseFileSource("note.__codeblock.ipt", "[@TavernName]");

        const discovered = await discoverReferencedTables({
            main,
            extras: [],
            resolveTableName: resolverFor(files),
            source: inMemoryAsyncSource(files),
        });

        // Should have pulled in TavernName (and its helper tables).
        const names = discovered
            .flatMap((f) => f.tables.map((t) => t.name.toLowerCase()));
        expect(names).toContain("tavernname");
        expect(names).toContain("adjective");
        expect(names).toContain("noun");

        // And the evaluator can now produce output from the bare call.
        const ev = new Evaluator(main, discovered, { seed: 1 });
        const out = ev.run();
        expect(out.length).toBeGreaterThan(0);
        expect(out.startsWith("The ")).toBe(true);
    });

    test("never overrides a table already defined locally", async () => {
        // main defines its OWN TavernName; discovery must not replace it.
        const files = { "gen/02-tavern.rdm": TAVERN };
        const main = parseFileSource(
            "note.__codeblock.ipt",
            "Table: TavernName\nThe Local Tavern\n"
        );

        const discovered = await discoverReferencedTables({
            main,
            extras: [],
            resolveTableName: resolverFor(files),
            source: inMemoryAsyncSource(files),
        });

        // Nothing referenced that isn't already defined → no discovery.
        expect(discovered).toHaveLength(0);
        const ev = new Evaluator(main, discovered, { seed: 1 });
        expect(ev.run()).toBe("The Local Tavern");
    });

    test("discovers transitively across files", async () => {
        const files = {
            "gen/quests.rdm": QUESTS,
            "gen/towns.rdm": TOWNS,
        };
        const main = parseFileSource("note.__codeblock.ipt", "[@Quest]");

        const discovered = await discoverReferencedTables({
            main,
            extras: [],
            resolveTableName: resolverFor(files),
            source: inMemoryAsyncSource(files),
        });

        const names = discovered
            .flatMap((f) => f.tables.map((t) => t.name.toLowerCase()));
        expect(names).toContain("quest");
        expect(names).toContain("town"); // pulled in via Quest's reference

        const ev = new Evaluator(main, discovered, { seed: 1 });
        const out = ev.run();
        expect(out.startsWith("Trouble in ")).toBe(true);
        expect(out.length).toBeGreaterThan("Trouble in ".length);
    });

    test("ignores dynamic references and unknown tables", async () => {
        const files = { "gen/02-tavern.rdm": TAVERN };

        // Dynamic name — can't be resolved ahead of evaluation.
        const dynamic = parseFileSource(
            "note.__codeblock.ipt",
            "[@{$whatever}]"
        );
        await expect(
            discoverReferencedTables({
                main: dynamic,
                extras: [],
                resolveTableName: resolverFor(files),
                source: inMemoryAsyncSource(files),
            })
        ).resolves.toHaveLength(0);

        // Known syntax, but the index doesn't have the table.
        const unknown = parseFileSource(
            "note.__codeblock.ipt",
            "[@NoSuchTable]"
        );
        await expect(
            discoverReferencedTables({
                main: unknown,
                extras: [],
                resolveTableName: resolverFor(files),
                source: inMemoryAsyncSource(files),
            })
        ).resolves.toHaveLength(0);
    });
});
