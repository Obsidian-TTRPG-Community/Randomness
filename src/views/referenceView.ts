/**
 * Reference view.
 *
 * An in-app help/reference pane. Opened either from a button in
 * the settings tab or via the "Open reference" command. Renders
 * the REFERENCE_MARKDOWN constant through Obsidian's own
 * MarkdownRenderer so it looks native and gets the user's theme,
 * code-block styling, and link handling for free.
 *
 * Design choices:
 *
 *   - ItemView (not TextFileView) — it's a read-only pane, not a
 *     file backed by the vault.
 *   - Markdown lives in a TS constant, not a file in the vault.
 *     Bundles into main.js; can't be accidentally edited; one
 *     source of truth.
 *   - Single-instance pattern: opening the reference twice
 *     reveals the existing leaf rather than creating a duplicate.
 */

import { ItemView, WorkspaceLeaf, MarkdownRenderer } from "obsidian";
import { REFERENCE_MARKDOWN } from "./referenceContent";
import type RandomnessPlugin from "./main";

export const VIEW_TYPE_REFERENCE = "randomness-reference-view";

export class ReferenceView extends ItemView {
    private plugin: RandomnessPlugin;

    constructor(leaf: WorkspaceLeaf, plugin: RandomnessPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_REFERENCE;
    }

    getDisplayText(): string {
        return "Randomness reference";
    }

    /**
     * Obsidian uses this for the tab icon. "book-open" is a
     * common Lucide icon, semantically right for a reference
     * pane.
     */
    getIcon(): string {
        return "book-open";
    }

    async onOpen(): Promise<void> {
        // Obsidian gives every ItemView a `containerEl` with two
        // children: a header (we leave alone) and a content area
        // (children[1]). Match the pattern used by browserView.
        const content = this.containerEl.children[1] as HTMLElement;
        // Clear with native DOM methods so tests pass under jsdom
        // (Obsidian augments HTMLElement with .empty() / .addClass()
        // / .createDiv(), but those don't exist in plain browsers).
        while (content.firstChild) content.removeChild(content.firstChild);
        content.classList.add("randomness-reference-view");
        // Cap the content width on wide displays so the
        // line-length stays readable. Padding gives the markdown
        // some breathing room from the pane edges.
        const inner = document.createElement("div");
        inner.className = "randomness-reference-content";
        content.appendChild(inner);
        // MarkdownRenderer.render is async — it loads code-block
        // syntax highlighting and resolves wiki-links. We await
        // so onOpen completes only after the render is in place.
        await MarkdownRenderer.render(
            this.plugin.app,
            REFERENCE_MARKDOWN,
            inner,
            // sourcePath used to resolve relative links in the
            // rendered markdown. We have no source file, so use
            // empty string — the reference doesn't contain any
            // relative links anyway.
            "",
            this
        );
    }

    async onClose(): Promise<void> {
        // ItemView's default close behaviour empties the
        // containerEl. Nothing extra needed.
    }
}

/**
 * Open the reference view, reusing an existing leaf if one is
 * already showing it. Called from the settings tab button and
 * from the "Open reference" command.
 *
 * Strategy: look for an existing leaf with our view type; if
 * found, reveal it. Otherwise, open a new leaf to the right of
 * the active editor (or in the main editor pane if no editor
 * is active). The reference is most useful side-by-side with
 * a note being edited, so the right-side default is deliberate.
 */
export async function openReferenceView(
    plugin: RandomnessPlugin
): Promise<void> {
    const { workspace } = plugin.app;
    // Reuse an existing leaf if any.
    const existing = workspace.getLeavesOfType(VIEW_TYPE_REFERENCE);
    if (existing.length > 0) {
        workspace.revealLeaf(existing[0]);
        return;
    }
    // Open a new leaf. `getLeaf("split")` opens in a vertical
    // split next to the active editor — gives the side-by-side
    // layout that's most useful for a reference.
    const leaf = workspace.getLeaf("split");
    await leaf.setViewState({
        type: VIEW_TYPE_REFERENCE,
        active: true,
    });
    workspace.revealLeaf(leaf);
}
