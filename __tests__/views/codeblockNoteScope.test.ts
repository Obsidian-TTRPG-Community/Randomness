/**
 * @jest-environment jsdom
 */

/**
 * A codeblock can see the rest of its own note (issue #5).
 *
 * Reported as "using prompts with inline tables throws an error", but
 * the prompt was innocent. Two separate gaps produced one symptom:
 *
 *   1. A `randomness` codeblock's scope was its own source plus its
 *      `Use:` graph plus the vault index — and nothing else in the
 *      note. An inline `rdm:` call in the same note had always seen
 *      the note's other blocks and its `^block-id` tables. So a block
 *      calling `[@Party]` could not reach a `Table: Party` defined in
 *      the block directly below it.
 *   2. Auto-discovery collects table names by scanning the parsed AST
 *      and skips any name built at roll time, so `[@{$Prompt1}]` had
 *      nothing to look up. That is why the reporter found that moving
 *      tables to the generator root fixed their `[when]…[@Party]`
 *      version but not their `[@{$Prompt1}]` version — a detail that
 *      pinned the diagnosis precisely.
 */

import { buildCodeblockProcessor } from "../../src/views/codeblockProcessor";
import { buildInlineProcessor } from "../../src/views/inlineProcessor";
import { DEFAULT_SETTINGS } from "../../src/views/settings";
import { PreviewRegistry } from "../../src/views/lockingService";

function fakePlugin(
    files: Record<string, string>,
    index?: Record<string, string>
) {
    const map = new Map(Object.entries(files));
    const adapter = {
        async read(p: string) {
            const v = map.get(p);
            if (v === undefined) throw new Error("not found: " + p);
            return v;
        },
        async exists(p: string) {
            return map.has(p);
        },
    };
    const plugin: any = {
        app: {
            vault: {
                adapter,
                getFiles: () => [...map.keys()].map((p) => ({ path: p })),
                getAbstractFileByPath: () => null,
                getMarkdownFiles: () => [],
            },
            metadataCache: { getFileCache: () => null, getCache: () => null },
            workspace: {},
        },
        settings: { ...DEFAULT_SETTINGS },
        previewRegistry: new PreviewRegistry(),
    };
    if (index) {
        plugin.vaultIndex = {
            async prewarm() {},
            resolveTable: (n: string) => {
                const hit = index[n.toLowerCase()];
                return hit ? [hit] : [];
            },
        };
    }
    return plugin;
}

const ctx = (sourcePath: string, text: string): any => ({
    sourcePath,
    docId: "fake",
    addChild() {},
    getSectionInfo: () => ({ lineStart: 0, lineEnd: 3, text }),
});

/** Render one codeblock against a note and return its visible text. */
async function renderBlock(
    plugin: unknown,
    source: string,
    notePath: string,
    noteText: string
): Promise<string> {
    const proc = buildCodeblockProcessor(plugin as never);
    const el = document.createElement("div");
    await proc(source, el, ctx(notePath, noteText));
    return el.textContent ?? "";
}

// ────────── the reported case ──────────

describe("issue #5: a prompt choosing a table defined elsewhere in the note", () => {
    const BLOCK = [
        "Prompt: Party Member {Krish|Quinlan|Party} Party",
        "[@{$prompt1}]",
    ].join("\n");
    const NOTE = [
        "```randomness",
        BLOCK,
        "```",
        "",
        "Some prose in between.",
        "",
        "```randomness",
        "Table: Party",
        "the whole party",
        "",
        "Table: Krish",
        "just Krish",
        "```",
    ].join("\n");

    test("the reporter's block now rolls", async () => {
        const p = fakePlugin({ "note.md": NOTE });
        const out = await renderBlock(p, BLOCK, "note.md", NOTE);
        expect(out).toContain("the whole party");
        expect(out).not.toContain("Unknown table");
    });

    test("their conditional workaround works too", async () => {
        const block =
            "Prompt: Party Member {Krish|Party} Party\n" +
            "[when]{$prompt1}=Party[do][@Party][end]";
        const note = NOTE.replace(BLOCK, block);
        const p = fakePlugin({ "note.md": note });
        const out = await renderBlock(p, block, "note.md", note);
        expect(out).toContain("the whole party");
    });
});

// ────────── note scope, in general ──────────

describe("a codeblock sees the rest of its note", () => {
    test("a table in a later block", async () => {
        const note = [
            "```randomness",
            "[@Greeting]",
            "```",
            "```randomness",
            "Table: Greeting",
            "well met",
            "```",
        ].join("\n");
        const p = fakePlugin({ "note.md": note });
        expect(await renderBlock(p, "[@Greeting]", "note.md", note)).toContain(
            "well met"
        );
    });

    test("a `^block-id` markdown table in the note", async () => {
        const note = [
            "| Tavern |",
            "| ------ |",
            "| The Prancing Pony |",
            "",
            "^taverns",
            "",
            "```randomness",
            "Tonight: [@taverns]",
            "```",
        ].join("\n");
        const p = fakePlugin({ "note.md": note });
        expect(
            await renderBlock(p, "Tonight: [@taverns]", "note.md", note)
        ).toContain("The Prancing Pony");
    });

    test("the block's OWN table wins over a same-named one in the note", async () => {
        // Note scope may only ever add. If it could shadow, editing a
        // block would silently change what a different block rolls.
        const own = "Table: T\nmine\n";
        const note = [
            "```randomness",
            own,
            "```",
            "```randomness",
            "Table: T",
            "theirs",
            "```",
        ].join("\n");
        const p = fakePlugin({ "note.md": note });
        expect(await renderBlock(p, own, "note.md", note)).toContain("mine");
    });

    test("a sibling block's Prompt: does not leak into this one", async () => {
        // Tables are shared; directives are not. A sibling's Prompt:
        // would otherwise add a dropdown to a block that never asked
        // for one.
        const own = "[@T]";
        const note = [
            "```randomness",
            own,
            "```",
            "```randomness",
            "Prompt: Mood {Grim|Cheery} Grim",
            "Table: T",
            "steady",
            "```",
        ].join("\n");
        const p = fakePlugin({ "note.md": note });
        const out = await renderBlock(p, own, "note.md", note);
        expect(out).toContain("steady");
        expect(out).not.toContain("Mood");
    });

    test("no note source available: the block still renders on its own", async () => {
        // getSectionInfo returns null in some render contexts. Note
        // scope is absent there rather than fatal.
        const proc = buildCodeblockProcessor(
            fakePlugin({ "note.md": "" }) as never
        );
        const el = document.createElement("div");
        await proc("Table: T\nsolo", el, {
            sourcePath: "note.md",
            docId: "fake",
            addChild() {},
            getSectionInfo: () => null,
        } as never);
        expect(el.textContent).toContain("solo");
    });

    test("an inline call in the same note still works (unchanged)", async () => {
        const note = [
            "```randomness",
            "Table: Party",
            "the whole party",
            "```",
            "",
            "Roll: `rdm:[@Party]`",
        ].join("\n");
        const p = fakePlugin({ "note.md": note });
        const proc = buildInlineProcessor(p as never);
        document.body.innerHTML = "";
        const wrap = document.createElement("div");
        const code = document.createElement("code");
        code.textContent = "rdm:[@Party]";
        wrap.appendChild(code);
        document.body.appendChild(wrap);
        await proc(wrap, ctx("note.md", note));
        expect(wrap.textContent).toContain("the whole party");
    });
});

// ────────── dynamic names + auto-discovery ──────────

describe("a dynamic table name reaches the generator root", () => {
    const GEN = "Table: Party\nthe whole party\n\nTable: Krish\njust Krish\n";
    const INDEX = {
        party: "Generators/party.rdm",
        krish: "Generators/party.rdm",
    };

    test("a prompt's options are candidate names when the call is dynamic", async () => {
        const p = fakePlugin(
            { "note.md": "x", "Generators/party.rdm": GEN },
            INDEX
        );
        const out = await renderBlock(
            p,
            "Prompt: Party Member {Krish|Party} Party\n[@{$prompt1}]",
            "note.md",
            "x"
        );
        expect(out).toContain("the whole party");
    });

    test("a statically named call still resolves, as it always did", async () => {
        const p = fakePlugin(
            { "note.md": "x", "Generators/party.rdm": GEN },
            INDEX
        );
        const out = await renderBlock(p, "[@Party]", "note.md", "x");
        expect(out).toContain("the whole party");
    });

    test("prompt options are NOT pulled in when nothing is dynamic", async () => {
        // A prompt offering Krish|Party alongside a plain static call
        // must not drag Krish's defining file into scope. Gating on a
        // dynamic reference is what keeps discovery from loading files
        // nobody asked for.
        const loaded: string[] = [];
        const p = fakePlugin(
            { "note.md": "x", "Generators/party.rdm": GEN },
            INDEX
        );
        const inner = p.vaultIndex.resolveTable;
        p.vaultIndex.resolveTable = (n: string) => {
            const hit = inner(n);
            if (hit.length > 0) loaded.push(n.toLowerCase());
            return hit;
        };
        await renderBlock(
            p,
            "Prompt: Who {Krish|Party} Party\nTable: Main\nnothing dynamic here",
            "note.md",
            "x"
        );
        expect(loaded).toEqual([]);
    });
});
