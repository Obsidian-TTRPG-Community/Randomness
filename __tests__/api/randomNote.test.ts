import { createApi } from "../../src/api";
import { TFile } from "obsidian";
import type RandomnessPlugin from "../../src/views/main";

function file(path: string): TFile {
    const f = new TFile();
    f.path = path;
    f.basename = path.split("/").pop()!.replace(/\.md$/, "");
    f.extension = "md";
    return f;
}

function fakePlugin(paths: string[]): RandomnessPlugin {
    return {
        app: {
            vault: { getMarkdownFiles: () => paths.map(file) },
            workspace: { getActiveFile: () => null },
        },
        settings: { generatorRoot: "", portraitPackPath: "" },
        portraits: {
            available: async () => false,
            manifest: async () => ({}),
            loader: () => async () => "",
        },
    } as unknown as RandomnessPlugin;
}

const NOTES = [
    "Encounters/Forest/Wolves.md",
    "Encounters/Forest/Bandits.md",
    "Encounters/Coast/Smugglers.md",
    "NPCs/Snagg.md",
    "Inbox.md",
];

describe("api.randomNote", () => {
    const api = createApi(fakePlugin(NOTES));

    test("no folder samples the whole vault", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 100; i++) seen.add(api.randomNote()!.path);
        expect(seen.size).toBeGreaterThan(2);
        for (const p of seen) expect(NOTES).toContain(p);
    });

    test("folder filter is recursive and slash-tolerant", () => {
        for (let i = 0; i < 30; i++) {
            const n = api.randomNote("/Encounters/")!;
            expect(n.path.startsWith("Encounters/")).toBe(true);
        }
        for (let i = 0; i < 20; i++) {
            expect(api.randomNote("Encounters/Forest")!.path).toMatch(
                /^Encounters\/Forest\//
            );
        }
    });

    test("does not match folder-name prefixes loosely", () => {
        // "Encounters/Fo" is not a folder containing notes
        expect(api.randomNote("Encounters/Fo")).toBeNull();
    });

    test("empty folder returns null", () => {
        expect(api.randomNote("Nowhere")).toBeNull();
    });

    test("seed makes the pick deterministic; link is path-qualified", () => {
        const a = api.randomNote("Encounters", { seed: 7 })!;
        const b = api.randomNote("Encounters", { seed: 7 })!;
        expect(b.path).toBe(a.path);
        expect(a.link).toBe(`[[${a.path.replace(/\.md$/, "")}]]`);
        expect(a.basename).not.toContain("/");
    });
});
