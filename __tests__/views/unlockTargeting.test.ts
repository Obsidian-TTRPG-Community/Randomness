/**
 * @jest-environment jsdom
 */

/**
 * Regression tests for unlock targeting on duplicated expressions
 * (the 1E Inn Generator sheet): a locked span must pair with ITS
 * source occurrence — including under Live Preview's partial
 * renders, where the container holds a single span and
 * getSectionInfo returns null.
 */
import { buildInlineProcessor } from "../../src/views/inlineProcessor";
import { DEFAULT_SETTINGS, RandomnessSettings } from "../../src/views/settings";
import { PreviewRegistry } from "../../src/views/lockingService";
import { TFile } from "obsidian";

function makeFakeAdapter(files: Record<string, string> = {}) {
    const map = new Map(Object.entries(files));
    return {
        map,
        async read(p: string) { const v = map.get(p); if (v === undefined) throw new Error("nf"); return v; },
        async exists(p: string) { return map.has(p); },
    };
}
function fakePlugin(files: Record<string, string>) {
    const adapter = makeFakeAdapter(files);
    return {
        app: {
            vault: {
                adapter,
                getAbstractFileByPath: (path: string) => {
                    if (!adapter.map.has(path)) return null;
                    const f = new TFile();
                    (f as any).path = path;
                    return f;
                },
                async read(file: any) { return adapter.read(file.path); },
                async modify(file: any, data: string) { adapter.map.set(file.path, data); },
                async process(file: any, fn: (d: string) => string) {
                    const before = adapter.map.get(file.path) ?? "";
                    const after = fn(before);
                    if (after !== before) adapter.map.set(file.path, after);
                    return after;
                },
            },
            workspace: {},
            metadataCache: { getFirstLinkpathDest: () => null },
        },
        settings: { ...DEFAULT_SETTINGS, diceRollerCompatChoice: true } as RandomnessSettings,
        previewRegistry: new PreviewRegistry(),
        vaultIndex: null,
    };
}
function container(codes: string[]): HTMLElement {
    document.body.innerHTML = "";
    const root = document.createElement("div");
    for (const c of codes) {
        const code = document.createElement("code");
        code.textContent = c;
        root.appendChild(code);
    }
    document.body.appendChild(root);
    return root;
}

// Inn-sheet shape: many identical unfilled spans; ONE locked at a
// later occurrence. The table renders as one section; the locked
// span is occurrence 3 (0-indexed) among same-key calls.
const NOTE = [
    "| a | b |",
    "| - | - |",
    "| `rdm:[@T]` | `rdm:[@T]` |",
    "| `rdm:[@T]` | `rdm:[@T]⟹Locked Pick` |",
    "",
    "```randomness",
    "Table: T",
    "OnlyValue",
    "```",
].join("\n");

async function run(ctx: any) {
    const p = fakePlugin({ "note.md": NOTE });
    const proc = buildInlineProcessor(p as any);
    const wrap = container([
        "rdm:[@T]", "rdm:[@T]", "rdm:[@T]", "rdm:[@T]⟹Locked Pick",
    ]);
    await proc(wrap, ctx);
    const unlockBtn = wrap.querySelector<HTMLButtonElement>(
        'button[aria-label="Unlock (rolls a fresh preview)"]'
    );
    expect(unlockBtn).not.toBeNull();
    unlockBtn!.click();
    await new Promise((r) => setTimeout(r, 30));
    return (p.app.vault.adapter as any).map.get("note.md") as string;
}

test("unlock works: Reading view (section covers table)", async () => {
    const after = await run({
        sourcePath: "note.md", docId: "x", addChild() {},
        getSectionInfo: () => ({ lineStart: 0, lineEnd: 3, text: "" }),
    });
    expect(after).not.toContain("⟹Locked Pick");
});

test("unlock works: Live Preview PARTIAL render (only the locked span's row)", async () => {
    // Live Preview processes each row/widget separately: the
    // container holds ONLY the locked span, and getSectionInfo is
    // null. Pairing must still find the right source occurrence.
    const p = fakePlugin({ "note.md": NOTE });
    const proc = buildInlineProcessor(p as any);
    const wrap = container(["rdm:[@T]⟹Locked Pick"]);
    const ctx: any = {
        sourcePath: "note.md", docId: "x", addChild() {},
        getSectionInfo: () => null,
    };
    await proc(wrap, ctx);
    const unlockBtn = wrap.querySelector<HTMLButtonElement>(
        'button[aria-label="Unlock (rolls a fresh preview)"]'
    );
    expect(unlockBtn).not.toBeNull();
    unlockBtn!.click();
    await new Promise((r) => setTimeout(r, 30));
    const after = (p.app.vault.adapter as any).map.get("note.md") as string;
    expect(after).not.toContain("⟹Locked Pick");
    // And no collateral damage to the unfilled twins.
    expect(after.match(/`rdm:\[@T\]`/g)!.length).toBeGreaterThanOrEqual(3);
});

test("unlock works: Live Preview (getSectionInfo null)", async () => {
    const after = await run({
        sourcePath: "note.md", docId: "x", addChild() {},
        getSectionInfo: () => null,
    });
    expect(after).not.toContain("⟹Locked Pick");
});
