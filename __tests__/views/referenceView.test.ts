/**
 * @jest-environment jsdom
 */

/**
 * Tests for the in-app reference view.
 *
 * Two surfaces to cover:
 *
 *   1. The content itself (REFERENCE_MARKDOWN) — defensive
 *      smoke tests so a careless edit doesn't accidentally
 *      delete a whole section or leave the doc empty.
 *
 *   2. The view machinery — opens correctly, reuses an existing
 *      leaf rather than spawning duplicates, renders the
 *      content into the right DOM element.
 */

import { WorkspaceLeaf } from "obsidian";
import { REFERENCE_MARKDOWN } from "../../src/views/referenceContent";
import {
    ReferenceView,
    VIEW_TYPE_REFERENCE,
    openReferenceView,
} from "../../src/views/referenceView";

// ────────── REFERENCE_MARKDOWN smoke tests ──────────

describe("REFERENCE_MARKDOWN content", () => {
    test("is a non-empty string", () => {
        expect(typeof REFERENCE_MARKDOWN).toBe("string");
        expect(REFERENCE_MARKDOWN.length).toBeGreaterThan(1000);
    });

    test("has a top-level heading", () => {
        // The reference is supposed to start with `# Randomness`.
        expect(REFERENCE_MARKDOWN).toMatch(/^# Randomness/);
    });

    test("covers the core syntax categories", () => {
        // The reference exists to teach users the syntax. If we
        // accidentally delete or rename a whole section, this
        // test catches it. Each entry below corresponds to a
        // heading the doc should always have.
        const requiredSections = [
            "File structure",
            "Tables and items",
            "Calling tables",
            "Dice",
            "Variables",
            "Filters",
            "Repetitions",
            "Conditionals",
            "wiki-syntax",
            "Calling from notes",
            "Escaping",
            "autocomplete",
            "Referencing generators by name",
            "Scripting API",
        ];
        for (const section of requiredSections) {
            // Case-insensitive check — section headings can shift
            // case slightly without being broken, but if the
            // KEYWORD disappears we've lost the section.
            expect(REFERENCE_MARKDOWN.toLowerCase()).toContain(
                section.toLowerCase()
            );
        }
    });

    test("mentions the key inline syntax (rdm:)", () => {
        // Inline calls are the most-asked-about feature; the
        // reference must mention them.
        expect(REFERENCE_MARKDOWN).toContain("rdm:");
    });

    test("documents wiki-link rendering (v0.4.0 feature)", () => {
        // The image / link feature has its own dedicated section.
        // Ensure the syntax examples are still there.
        expect(REFERENCE_MARKDOWN).toContain("![[");
        expect(REFERENCE_MARKDOWN).toContain("[[Note");
    });

    test("warns about the inline-scope gotcha", () => {
        // The 'inline calls inherit scope from codeblocks' rule
        // bit the demo author (me). The reference must call it
        // out explicitly so users don't fall into the same trap.
        expect(REFERENCE_MARKDOWN.toLowerCase()).toContain("scope");
    });

    test("does not contain a literal `randomness` codeblock", () => {
        // The reference renders inside Obsidian. If it contains a
        // fenced ```randomness block, the codeblock processor
        // would try to ROLL it inside the reference view — which
        // would be confusing at best and crash at worst.
        // Code examples use ```text instead.
        // Defensive check: scan for fenced randomness blocks.
        const randomnessFenceRe = /\n\s*\`\`\`\s*randomness\b/;
        expect(REFERENCE_MARKDOWN).not.toMatch(randomnessFenceRe);
    });
});

// ────────── ReferenceView wiring ──────────

/**
 * Build a fake plugin with the workspace methods the view uses.
 * Tests inject spies so we can verify which workspace calls fired.
 */
function fakePlugin(opts: {
    existingLeaves?: WorkspaceLeaf[];
    onRevealLeaf?: (leaf: WorkspaceLeaf) => void;
    onGetLeaf?: () => WorkspaceLeaf;
    onSetViewState?: (state: unknown) => void;
} = {}) {
    const revealedLeaves: WorkspaceLeaf[] = [];
    const newLeafCalls: number[] = [];
    const fakeLeaf = (): WorkspaceLeaf => {
        const leaf = new WorkspaceLeaf();
        // Stub setViewState so the view-state update doesn't
        // bomb out in jsdom.
        (leaf as any).setViewState = async (state: unknown) => {
            if (opts.onSetViewState) opts.onSetViewState(state);
        };
        return leaf;
    };
    return {
        app: {
            workspace: {
                getLeavesOfType(_type: string): WorkspaceLeaf[] {
                    return opts.existingLeaves ?? [];
                },
                revealLeaf(leaf: WorkspaceLeaf): void {
                    revealedLeaves.push(leaf);
                    if (opts.onRevealLeaf) opts.onRevealLeaf(leaf);
                },
                getLeaf(_kind: string): WorkspaceLeaf {
                    newLeafCalls.push(newLeafCalls.length);
                    if (opts.onGetLeaf) return opts.onGetLeaf();
                    return fakeLeaf();
                },
            },
        },
        revealedLeaves,
        newLeafCalls,
    };
}

/**
 * Build a workspace-leaf-shaped object the ItemView can mount on.
 * Pattern matches the one used in browserView.test.ts.
 */
function fakeLeaf(): any {
    const container = document.createElement("div");
    const header = document.createElement("div");
    const content = document.createElement("div");
    container.appendChild(header);
    container.appendChild(content);
    return { containerEl: container };
}

describe("ReferenceView", () => {
    test("getViewType / getDisplayText / getIcon return expected values", () => {
        const p = fakePlugin();
        const view = new ReferenceView(fakeLeaf(), p as any);
        expect(view.getViewType()).toBe(VIEW_TYPE_REFERENCE);
        expect(view.getDisplayText()).toBe("Randomness reference");
        expect(view.getIcon()).toBe("book-open");
    });

    test("VIEW_TYPE_REFERENCE is stable (registered name)", () => {
        // The view type string is persisted in Obsidian's
        // workspace state. Renaming it would orphan any saved
        // leaf the user had open.
        expect(VIEW_TYPE_REFERENCE).toBe("randomness-reference-view");
    });

    test("onOpen renders the reference content into the view", async () => {
        const p = fakePlugin();
        const leaf = fakeLeaf();
        const view = new ReferenceView(leaf, p as any);
        // ItemView sets containerEl via its constructor; the
        // fakeLeaf above gives a containerEl with two children.
        (view as any).containerEl = leaf.containerEl;
        await view.onOpen();
        // The content child should now hold the rendered markdown.
        const content = leaf.containerEl.children[1] as HTMLElement;
        // Mock MarkdownRenderer dumps the source as textContent.
        // Verify the reference content reached the DOM.
        expect(content.textContent).toContain("Randomness");
        expect(content.textContent).toContain("Table:");
    });

    test("onOpen wraps content in randomness-reference-content", async () => {
        const p = fakePlugin();
        const leaf = fakeLeaf();
        const view = new ReferenceView(leaf, p as any);
        (view as any).containerEl = leaf.containerEl;
        await view.onOpen();
        const content = leaf.containerEl.children[1] as HTMLElement;
        expect(
            content.querySelector(".randomness-reference-content")
        ).not.toBeNull();
    });
});

describe("openReferenceView", () => {
    test("reuses an existing leaf when one already exists", async () => {
        const existing = new WorkspaceLeaf();
        const p = fakePlugin({ existingLeaves: [existing] });
        await openReferenceView(p as any);
        // The existing leaf was revealed.
        expect(p.revealedLeaves).toContain(existing);
        // No new leaf was created.
        expect(p.newLeafCalls.length).toBe(0);
    });

    test("creates a new leaf when none exists", async () => {
        const setViewStateCalls: unknown[] = [];
        const p = fakePlugin({
            existingLeaves: [],
            onSetViewState: (state) => setViewStateCalls.push(state),
        });
        await openReferenceView(p as any);
        // A new leaf was created.
        expect(p.newLeafCalls.length).toBe(1);
        // setViewState was called with our view type.
        expect(setViewStateCalls.length).toBe(1);
        const state = setViewStateCalls[0] as { type: string; active: boolean };
        expect(state.type).toBe(VIEW_TYPE_REFERENCE);
        expect(state.active).toBe(true);
    });
});
