/**
 * Starter-content installer: fetch a content bundle (index.json with a
 * file list, all text) from a base URL into a vault folder, preserving
 * relative paths. Used by the "Install Fantasy Hub content" settings
 * button; deliberately generic so future bundles reuse it.
 *
 * Trust note: this writes plain text files (.ipt generators, .md
 * templates) into a folder the user chose, only when the user clicks
 * install — the same consent model as the example-seeding button and
 * the portrait pack installer.
 */

import { Notice, normalizePath, requestUrl } from "obsidian";
import type RandomnessPlugin from "./views/main";

interface ContentIndex {
    name?: string;
    files: string[];
}

export interface BundleDestinations {
    /** Where generator files (and bundle docs) land. */
    generatorsDest: string;
    /** Where files under templates/ land (e.g. the Templater folder). */
    templatesDest: string;
}

export async function installContentBundle(
    plugin: RandomnessPlugin,
    baseUrl: string,
    dests: BundleDestinations
): Promise<number> {
    const base = baseUrl.replace(/\/+$/, "");
    const adapter = plugin.app.vault.adapter;

    const index = JSON.parse(
        (await requestUrl({ url: `${base}/index.json` })).text
    ) as ContentIndex;
    if (!Array.isArray(index.files) || index.files.length === 0) {
        throw new Error("bundle index.json has no files");
    }

    const ensureFolder = async (folder: string): Promise<void> => {
        if (folder === "" || (await adapter.exists(folder))) return;
        const parent = folder.includes("/")
            ? folder.slice(0, folder.lastIndexOf("/"))
            : "";
        await ensureFolder(parent);
        await adapter.mkdir(folder);
    };

    let written = 0;
    for (const rel of index.files) {
        // Path hygiene: stay inside the destinations, no escapes.
        if (rel.includes("..") || rel.startsWith("/")) continue;
        const target = rel.startsWith("templates/")
            ? normalizePath(
                  `${dests.templatesDest}/${rel.slice("templates/".length)}`
              )
            : normalizePath(`${dests.generatorsDest}/${rel}`);
        await ensureFolder(target.slice(0, target.lastIndexOf("/")));
        // Encode each path segment — bundle filenames may contain
        // spaces ("Thief Guild.md") and raw URLs must be %-escaped.
        const relUrl = rel.split("/").map(encodeURIComponent).join("/");
        const res = await requestUrl({ url: `${base}/${relUrl}` });
        await adapter.write(target, res.text);
        written++;
        if (written % 10 === 0) {
            new Notice(
                `${index.name ?? "Content"}: ${written}/${index.files.length} files…`,
                2000
            );
        }
    }
    return written;
}
