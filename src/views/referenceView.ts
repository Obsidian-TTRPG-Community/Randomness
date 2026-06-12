/**
 * The reference is a real markdown NOTE in the vault, not a custom
 * pane. Why: native rendering and copy behaviour, and — the real
 * win — the examples are LIVE: `randomness` codeblocks roll, inline
 * calls resolve against note scope, `portrait` blocks render. A
 * custom MarkdownRenderer pane half-executed examples (errors where
 * scope was missing) and made copied snippets lose their fences.
 *
 * "Open reference" writes/refreshes the note (guarded by a content
 * version in frontmatter, so user edits are only overwritten when
 * the plugin ships new content) and opens it.
 */

import { Notice, TFile, normalizePath } from "obsidian";
import { REFERENCE_MARKDOWN, REFERENCE_VERSION } from "./referenceContent";
import type RandomnessPlugin from "./main";

export const REFERENCE_PATH = "Randomness Reference.md";

/** Full note content, version-stamped for the refresh check. */
export function referenceFileContent(): string {
    return [
        "---",
        `randomness-reference-version: ${REFERENCE_VERSION}`,
        "---",
        "",
        REFERENCE_MARKDOWN,
    ].join("\n");
}

export async function openReferenceView(
    plugin: RandomnessPlugin
): Promise<void> {
    const path = normalizePath(REFERENCE_PATH);
    const vault = plugin.app.vault;
    const existing = vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
        const current = await vault.read(existing);
        if (
            !current.includes(
                `randomness-reference-version: ${REFERENCE_VERSION}`
            )
        ) {
            await vault.modify(existing, referenceFileContent());
            new Notice("Randomness reference refreshed for this version.");
        }
    } else if (existing) {
        new Notice(
            `Randomness: "${path}" exists but isn't a file — ` +
                "move it aside to open the reference."
        );
        return;
    } else {
        await vault.create(path, referenceFileContent());
    }

    await plugin.app.workspace.openLinkText(path, "", true);
}
