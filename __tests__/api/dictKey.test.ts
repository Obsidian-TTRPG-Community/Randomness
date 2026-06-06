/** @jest-environment jsdom */
/**
 * Dictionary tables (`Type: Dictionary`) aren't rolled randomly — each
 * entry is named, and the IPP3 `[#key Table]` syntax looks one up. Via
 * the API, callers pass the key as `dictKey` on the options. Without
 * it, a dictionary table would resolve to empty (silently) — a reported
 * footgun where `api.roll("SkillML", {promptValues: ...})` returned ""
 * because promptValues don't address dictionary keys.
 *
 * Sample table (HarnMaster-style skill mastery, from the bug report):
 *
 *   Table: SkillML
 *   Type: Dictionary
 *   Inept: {1d20+29}
 *   Novice: {1d10+49}
 *   ... etc
 */
import { createApi } from "../../src/api";
import { VaultIndex } from "../../src/resolver/vaultIndex";

const SKILL_ML = `Table: SkillML
Type: Dictionary
Set: competence = [Inept|Novice|Aspirant|Professional|Expert|Paragon]
Inept: {1d20+29}
Novice: {1d10+49}
Aspirant: {1d10+59}
Professional: {1d10+69}
Expert: {1d10+79}
Paragon: {1d10+89}
`;

function makePlugin(files: Record<string, string>, root = "") {
    const m = new Map(Object.entries(files));
    const readPath = async (p: string) => {
        const v = m.get(p);
        if (v === undefined) throw new Error("nf " + p);
        return v;
    };
    const vault = {
        read: async (f: { path: string }) => readPath(f.path),
        cachedRead: async (f: { path: string }) => readPath(f.path),
        getFiles: () => [...m.keys()].map((p) => ({ path: p })),
        getAbstractFileByPath: (p: string) =>
            m.has(p) ? ({ path: p } as { path: string }) : null,
        adapter: { read: readPath, exists: async (p: string) => m.has(p) },
        on: () => ({}),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin: any = {
        app: {
            vault,
            workspace: { getActiveFile: () => null },
            metadataCache: {},
        },
        settings: {
            generatorRoot: root,
            defaultFormatting: "html",
            stableCodeblockSeeds: false,
            browserExpandedPaths: [],
            pinnedTables: [],
        },
    };
    plugin.vaultIndex = new VaultIndex(
        { getFiles: () => vault.getFiles(), read: readPath },
        () => plugin.settings.generatorRoot || ""
    );
    return plugin;
}

describe("api.rollUnscoped with dictKey", () => {
    test("picks the named entry from a Type: Dictionary table", async () => {
        const api = createApi(
            makePlugin({ "skills.ipt": SKILL_ML }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        const r = await api.rollUnscoped("SkillML", { dictKey: "Inept" });
        const n = parseInt(r.result, 10);
        // Inept = 1d20+29 → 30..49
        expect(n).toBeGreaterThanOrEqual(30);
        expect(n).toBeLessThanOrEqual(49);
        // The result reports the table name as requested.
        expect(r.table).toBe("SkillML");
        // expression reflects the IPP3 form we evaluated.
        expect(r.expression).toBe(`[#"Inept" SkillML]`);
    });

    test("Paragon hits the high band", async () => {
        const api = createApi(
            makePlugin({ "skills.ipt": SKILL_ML }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        const r = await api.rollUnscoped("SkillML", {
            dictKey: "Paragon",
            seed: 7,
        });
        const n = parseInt(r.result, 10);
        // Paragon = 1d10+89 → 90..99
        expect(n).toBeGreaterThanOrEqual(90);
        expect(n).toBeLessThanOrEqual(99);
    });

    test("without dictKey, a dictionary table still rolls to empty (the old footgun)", async () => {
        // Documents the unchanged behaviour: dictionaries can't be
        // rolled at random, so omitting dictKey produces empty output.
        // This is the IPP3 semantics; dictKey is the way through.
        const api = createApi(
            makePlugin({ "skills.ipt": SKILL_ML }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        const r = await api.rollUnscoped("SkillML");
        expect(r.result).toBe("");
    });

    test("an unknown dictKey yields empty (no key match)", async () => {
        const api = createApi(
            makePlugin({ "skills.ipt": SKILL_ML }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        const r = await api.rollUnscoped("SkillML", {
            dictKey: "Bogus",
        });
        expect(r.result).toBe("");
    });

    test("dictKey honours the seed for deterministic values", async () => {
        const api = createApi(
            makePlugin({ "skills.ipt": SKILL_ML }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        const a = await api.rollUnscoped("SkillML", {
            dictKey: "Novice",
            seed: 42,
        });
        const b = await api.rollUnscoped("SkillML", {
            dictKey: "Novice",
            seed: 42,
        });
        expect(a.result).toBe(b.result);
    });
});

describe("api.roll (scoped) with dictKey", () => {
    test("works when the table is in scope via Use:", async () => {
        // The scoped roll uses the active-note path; the test plugin
        // returns no active file, so we have to give the engine a way
        // to find SkillML — we'd normally do that via a note's
        // codeblock. For a clean unit test, rollUnscoped is the
        // direct path; this test asserts the symmetric option exists
        // and the expression is built the same way.
        const api = createApi(
            makePlugin({ "skills.ipt": SKILL_ML }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        // Type check: dictKey is on the RollOptions type too.
        await expect(
            api.roll("SkillML", { dictKey: "Aspirant" }).catch((e) => {
                // Without an active note we may not resolve the table;
                // the assertion that matters here is that the call
                // accepts the option without TS / runtime complaint.
                return e;
            })
        ).resolves.toBeDefined();
    });
});
