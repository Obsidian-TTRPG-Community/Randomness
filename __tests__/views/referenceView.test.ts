/**
 * The reference is a generated vault note: openReferenceView writes
 * "Randomness Reference.md" (version-stamped frontmatter), refreshes
 * it when the embedded content version changes, leaves it alone when
 * current, and opens it.
 */
import {
    openReferenceView,
    referenceFileContent,
    REFERENCE_PATH,
} from "../../src/views/referenceView";
import {
    REFERENCE_MARKDOWN,
    REFERENCE_VERSION,
} from "../../src/views/referenceContent";
import { TFile } from "obsidian";
import type RandomnessPlugin from "../../src/views/main";

function fakePlugin(existingContent: string | null) {
    const calls = {
        created: [] as [string, string][],
        modified: [] as [string, string][],
        opened: [] as string[],
    };
    let file: TFile | null = null;
    if (existingContent !== null) {
        file = new TFile();
        file.path = REFERENCE_PATH;
    }
    const plugin = {
        app: {
            vault: {
                getAbstractFileByPath: (p: string) =>
                    p === REFERENCE_PATH ? file : null,
                read: async () => existingContent ?? "",
                create: async (p: string, c: string) => {
                    calls.created.push([p, c]);
                },
                modify: async (f: TFile, c: string) => {
                    calls.modified.push([f.path, c]);
                },
            },
            workspace: {
                openLinkText: async (link: string) => {
                    calls.opened.push(link);
                },
            },
        },
    } as unknown as RandomnessPlugin;
    return { plugin, calls };
}

describe("reference note", () => {
    test("content embeds the markdown + version stamp", () => {
        const c = referenceFileContent();
        expect(c).toContain(
            `randomness-reference-version: ${REFERENCE_VERSION}`
        );
        expect(c).toContain(REFERENCE_MARKDOWN.slice(0, 40));
    });

    test("creates the note when missing, then opens it", async () => {
        const { plugin, calls } = fakePlugin(null);
        await openReferenceView(plugin);
        expect(calls.created).toHaveLength(1);
        expect(calls.created[0][0]).toBe(REFERENCE_PATH);
        expect(calls.modified).toHaveLength(0);
        expect(calls.opened).toEqual([REFERENCE_PATH]);
    });

    test("refreshes when the version stamp is stale", async () => {
        const { plugin, calls } = fakePlugin(
            "---\nrandomness-reference-version: old\n---\nold body"
        );
        await openReferenceView(plugin);
        expect(calls.modified).toHaveLength(1);
        expect(calls.modified[0][1]).toContain(REFERENCE_VERSION);
        expect(calls.created).toHaveLength(0);
        expect(calls.opened).toEqual([REFERENCE_PATH]);
    });

    test("leaves a current note untouched", async () => {
        const { plugin, calls } = fakePlugin(referenceFileContent());
        await openReferenceView(plugin);
        expect(calls.created).toHaveLength(0);
        expect(calls.modified).toHaveLength(0);
        expect(calls.opened).toEqual([REFERENCE_PATH]);
    });
});

describe("reference content sanity", () => {
    test("no escaped fences or stray template-literal escapes", () => {
        expect(REFERENCE_MARKDOWN).not.toMatch(/\\`\\`\\`/);
        expect(REFERENCE_MARKDOWN).not.toContain("\\${");
    });

    test("every fence opens and closes (3- and 4-backtick aware)", () => {
        const lines = REFERENCE_MARKDOWN.split("\n");
        const stack: string[] = [];
        for (const l of lines) {
            const m = /^(`{3,4})/.exec(l);
            if (!m) continue;
            const f = m[1];
            if (stack.length > 0 && stack[stack.length - 1] === f) {
                stack.pop();
            } else if (
                stack.length > 0 &&
                stack[stack.length - 1].length === 4 &&
                f.length === 3
            ) {
                // 3-fence inside a 4-fence example: literal content
                continue;
            } else {
                stack.push(f);
            }
        }
        expect(stack).toEqual([]);
    });

    test("live examples are present", () => {
        expect(REFERENCE_MARKDOWN).toContain("```randomness");
        expect(REFERENCE_MARKDOWN).toContain("```portrait");
        expect(REFERENCE_MARKDOWN).toContain("`rdm:[@Creature]`");
        expect(REFERENCE_MARKDOWN).toContain("`portrait: reference-demo 96`");
    });
});
