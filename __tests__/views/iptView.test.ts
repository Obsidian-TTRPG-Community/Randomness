/**
 * @jest-environment jsdom
 */

/**
 * Tests for IptView — the custom file view for `.ipt` files.
 *
 * The view's responsibilities:
 *   - On open, render a placeholder.
 *   - On setViewData, render the engine output.
 *   - Provide a Reroll action that re-evaluates.
 *   - Render prompt controls when the generator has Prompt: declarations.
 *   - Render an error block if evaluation fails.
 *   - "Open as Markdown" switches the leaf to the markdown view type.
 *
 * We bypass `registerIptView` (which only wires Obsidian-side
 * registrations) and instantiate `IptView` directly with fake
 * dependencies. That's enough surface to verify the render logic
 * without trying to recreate Obsidian's view-lifecycle in tests.
 */

import { IptView, VIEW_TYPE_IPT } from "../../src/views/iptView";
import {
    DEFAULT_SETTINGS,
    RandomnessSettings,
} from "../../src/views/settings";
import { PreviewRegistry } from "../../src/views/lockingService";
import { WorkspaceLeaf } from "obsidian";

// ────────── Fake helpers ──────────

function makeFakeAdapter(files: Record<string, string> = {}) {
    const map = new Map(Object.entries(files));
    return {
        async read(path: string): Promise<string> {
            const v = map.get(path);
            if (v === undefined) throw new Error(`not found: ${path}`);
            return v;
        },
        async exists(path: string): Promise<boolean> {
            return map.has(path);
        },
    };
}

function fakePlugin(opts: {
    files?: Record<string, string>;
    settings?: Partial<RandomnessSettings>;
} = {}) {
    return {
        app: {
            vault: { adapter: makeFakeAdapter(opts.files ?? {}) },
            workspace: {},
        },
        settings: { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) } as RandomnessSettings,
        previewRegistry: new PreviewRegistry(),
    };
}

/** Build a leaf stub that records setViewState calls. */
function fakeLeaf() {
    const stateCalls: Array<{ type: string; state?: unknown }> = [];
    const leaf = new WorkspaceLeaf();
    leaf.setViewState = async (state: { type: string; state?: unknown }) => {
        stateCalls.push(state);
    };
    return { leaf, stateCalls };
}

/** Fake TFile for IptView.file. */
function fakeFile(path: string) {
    const basename = path
        .replace(/^.*\//, "")
        .replace(/\.[^.]+$/, "");
    return { path, basename, name: path.replace(/^.*\//, "") };
}

/**
 * Drive a view through one render. Calling setViewData triggers an
 * async render() chain that resolves in microtasks; we wait a tick.
 */
async function flushRender(): Promise<void> {
    // Two ticks: one to start render(), one for the async evaluate().
    await new Promise((r) => setTimeout(r, 30));
}

// ────────── Type identity ──────────

describe("IptView: identity", () => {
    test("VIEW_TYPE_IPT is the stable view type id", () => {
        // Hard-code-tested because the string is part of the API surface —
        // changing it would break user vaults that have .ipt files open.
        expect(VIEW_TYPE_IPT).toBe("randomness-ipt-view");
    });

    test("getViewType returns the view-type constant", () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        expect(view.getViewType()).toBe(VIEW_TYPE_IPT);
    });

    test("getDisplayText falls back to 'Generator' when no file is set", () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        // No file assigned yet.
        expect(view.getDisplayText()).toBe("Generator");
    });

    test("getDisplayText uses the file's basename when present", () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        (view as unknown as { file: unknown }).file = fakeFile("Generators/Names.ipt");
        expect(view.getDisplayText()).toBe("Names");
    });
});

// ────────── Render ──────────

describe("IptView: render", () => {
    test("setViewData triggers a render and the output appears", async () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        await view.onOpen();
        (view as unknown as { file: unknown }).file = fakeFile("g.ipt");

        view.setViewData("Table: T\nhello world", true);
        await flushRender();

        const root = view.containerEl.children[1] as HTMLElement;
        const output = root.querySelector(".randomness-output");
        expect(output).not.toBeNull();
        expect(output?.textContent).toContain("hello world");
    });

    test("error in source produces an error block, not an exception", async () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        await view.onOpen();
        (view as unknown as { file: unknown }).file = fakeFile("g.ipt");

        // Use: a missing file → resolver throws.
        view.setViewData("Use:missing.ipt\nTable: T\nx", true);
        await flushRender();

        const root = view.containerEl.children[1] as HTMLElement;
        const err = root.querySelector(".randomness-error");
        expect(err).not.toBeNull();
        expect(err?.textContent).toMatch(/not found/);
    });

    test("getViewData returns the source unchanged (view is read-only)", () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        view.setViewData("Table: T\nA", true);
        expect(view.getViewData()).toBe("Table: T\nA");
    });

    test("clear empties data and the render target", async () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        await view.onOpen();
        (view as unknown as { file: unknown }).file = fakeFile("g.ipt");
        view.setViewData("Table: T\nhello", true);
        await flushRender();

        view.clear();
        expect(view.getViewData()).toBe("");
        const root = view.containerEl.children[1] as HTMLElement;
        // The wrap div is still attached, but emptied.
        const wrap = root.querySelector(".randomness-ipt-view");
        expect(wrap).not.toBeNull();
        expect(wrap?.children.length).toBe(0);
    });
});

// ────────── Prompts ──────────

describe("IptView: prompts", () => {
    test("renders prompt controls above the output for files with Prompt: declarations", async () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        await view.onOpen();
        (view as unknown as { file: unknown }).file = fakeFile("g.ipt");

        const src = [
            "Prompt: Tier {Easy|Hard}Easy",
            "Table: T",
            "Tier is {$prompt1}",
        ].join("\n");
        view.setViewData(src, true);
        await flushRender();

        const root = view.containerEl.children[1] as HTMLElement;
        const select = root.querySelector("select") as HTMLSelectElement;
        expect(select).not.toBeNull();
        expect(select.value).toBe("Easy");
        expect(root.textContent).toContain("Tier is Easy");
    });

    test("changing a prompt re-renders with the new value", async () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        await view.onOpen();
        (view as unknown as { file: unknown }).file = fakeFile("g.ipt");

        view.setViewData(
            ["Prompt: Tier {Easy|Hard}Easy", "Table: T", "Tier is {$prompt1}"].join(
                "\n"
            ),
            true
        );
        await flushRender();

        const root = view.containerEl.children[1] as HTMLElement;
        const select = root.querySelector("select") as HTMLSelectElement;
        select.value = "Hard";
        select.dispatchEvent(new Event("change"));
        await flushRender();

        expect(root.textContent).toContain("Tier is Hard");
    });

    test("opening a different file resets prompt values", async () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        await view.onOpen();
        (view as unknown as { file: unknown }).file = fakeFile("g.ipt");

        // First file: user picks Hard.
        view.setViewData(
            ["Prompt: Tier {Easy|Hard}Easy", "Table: T", "Tier is {$prompt1}"].join(
                "\n"
            ),
            true
        );
        await flushRender();
        const root = view.containerEl.children[1] as HTMLElement;
        const select1 = root.querySelector("select") as HTMLSelectElement;
        select1.value = "Hard";
        select1.dispatchEvent(new Event("change"));
        await flushRender();
        expect(root.textContent).toContain("Hard");

        // Switch to a different file (clear=true) — new file declares
        // the same prompt but the user's "Hard" selection should reset
        // to the new file's default.
        view.setViewData(
            [
                "Prompt: Tier {Easy|Hard}Easy",
                "Table: T",
                "Difficulty: {$prompt1}",
            ].join("\n"),
            true
        );
        await flushRender();
        const select2 = root.querySelector("select") as HTMLSelectElement;
        expect(select2.value).toBe("Easy");
        expect(root.textContent).toContain("Difficulty: Easy");
    });
});

// ────────── Sanitisation ──────────

describe("IptView: output sanitisation", () => {
    test("script tag in output is stripped", async () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        await view.onOpen();
        (view as unknown as { file: unknown }).file = fakeFile("g.ipt");

        // Hand-craft a generator that emits a <script>. The engine
        // doesn't try to sanitise its own output; the view-side
        // sanitiser is what catches this.
        view.setViewData(
            "Table: T\nsafe<script>alert(1)</script>also-safe",
            true
        );
        await flushRender();

        const root = view.containerEl.children[1] as HTMLElement;
        const output = root.querySelector(".randomness-output");
        expect(output?.innerHTML).not.toContain("script");
        expect(output?.innerHTML).not.toContain("alert");
        expect(output?.textContent).toContain("safe");
        expect(output?.textContent).toContain("also-safe");
    });

    test("allowed formatting tags survive", async () => {
        const { leaf } = fakeLeaf();
        const p = fakePlugin();
        const view = new IptView(leaf, p as never);
        await view.onOpen();
        (view as unknown as { file: unknown }).file = fakeFile("g.ipt");

        view.setViewData("Table: T\n<b>bold</b>", true);
        await flushRender();

        const root = view.containerEl.children[1] as HTMLElement;
        const output = root.querySelector(".randomness-output");
        expect(output?.innerHTML).toContain("<b>bold</b>");
    });
});
