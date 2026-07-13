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

/**
 * Add a folder to Templater's "excluded folders" (ignore_folders_on_creation)
 * so its "trigger on new file creation" never runs files created there. Used
 * before writing a bundle's template files, which contain `<%* … %>` code —
 * otherwise Templater would execute each template the moment it lands (prompting
 * for town/size and overwriting the template). No-op when Templater is absent or
 * the folder is already excluded. Returns true if it added the exclusion.
 */
export async function ensureTemplaterIgnoresFolder(
    plugin: RandomnessPlugin,
    folder: string
): Promise<boolean> {
    try {
        const app = plugin.app as unknown as {
            plugins?: {
                plugins?: Record<
                    string,
                    {
                        settings?: {
                            ignore_folders_on_creation?: { folder: string }[];
                        };
                        save_settings?: () => unknown;
                        saveSettings?: () => unknown;
                    }
                >;
            };
        };
        const tp = app.plugins?.plugins?.["templater-obsidian"];
        const list = tp?.settings?.ignore_folders_on_creation;
        if (!tp || !Array.isArray(list)) return false;
        const norm = normalizePath(folder).replace(/\/+$/, "");
        if (norm === "") return false;
        const already = list.some(
            (e) =>
                e &&
                typeof e.folder === "string" &&
                normalizePath(e.folder).replace(/\/+$/, "") === norm
        );
        if (already) return false;
        list.push({ folder: norm });
        if (typeof tp.save_settings === "function") await tp.save_settings();
        else if (typeof tp.saveSettings === "function") await tp.saveSettings();
        return true;
    } catch {
        return false;
    }
}

export async function installContentBundle(
    plugin: RandomnessPlugin,
    baseUrl: string,
    dests: BundleDestinations
): Promise<number> {
    const base = baseUrl.replace(/\/+$/, "");
    const adapter = plugin.app.vault.adapter;

    // Keep Templater from executing the template files as we write them: with
    // "trigger on new file creation" on, it would run each template's `<%* … %>`
    // the moment it lands, prompting for town/size and overwriting the template.
    // The templates folder should never auto-run — exclude it before writing.
    await ensureTemplaterIgnoresFolder(plugin, dests.templatesDest);

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

// ─────────────────────────────────────────────────────────────────────
// Example deck bundles (persistent-decks design).
// ─────────────────────────────────────────────────────────────────────

/** File extensions written as binary (card art, card backs). */
const BINARY_EXT = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

/**
 * Install a deck bundle into `<Decks folder>/<deck name>/`.
 *
 * Same consent model as the other installers: network is touched only
 * when the user clicks the settings button — example decks are NOT
 * shipped inside the plugin, keeping its install size small. The
 * bundle's index.json carries the deck name and file list; images are
 * fetched as binary, .rdm/deck.json as text. Returns files written.
 */
export async function installDeckBundle(
    plugin: RandomnessPlugin,
    baseUrl: string
): Promise<{ written: number; deckFolder: string }> {
    const base = baseUrl.replace(/\/+$/, "");
    const adapter = plugin.app.vault.adapter;

    const index = JSON.parse(
        (await requestUrl({ url: `${base}/index.json` })).text
    ) as ContentIndex;
    if (!index.name || typeof index.name !== "string") {
        throw new Error("deck bundle index.json is missing a name");
    }
    if (!Array.isArray(index.files) || index.files.length === 0) {
        throw new Error("deck bundle index.json has no files");
    }

    const deckFolder = normalizePath(
        `${plugin.decks.decksFolderPath()}/${index.name}`
    );
    const ensureFolder = async (folder: string): Promise<void> => {
        if (folder === "" || (await adapter.exists(folder))) return;
        const parent = folder.includes("/")
            ? folder.slice(0, folder.lastIndexOf("/"))
            : "";
        await ensureFolder(parent);
        await adapter.mkdir(folder);
    };
    await ensureFolder(deckFolder);

    let written = 0;
    for (const rel of index.files) {
        // Path hygiene: flat or one level deep, never escaping.
        if (rel.includes("..") || rel.startsWith("/")) continue;
        const target = normalizePath(`${deckFolder}/${rel}`);
        const relUrl = rel.split("/").map(encodeURIComponent).join("/");
        const res = await requestUrl({ url: `${base}/${relUrl}` });
        if (BINARY_EXT.test(rel)) {
            await adapter.writeBinary(target, res.arrayBuffer);
        } else {
            await adapter.write(target, res.text);
        }
        written++;
        if (written % 10 === 0) {
            new Notice(
                `${index.name}: ${written}/${index.files.length} files…`,
                2000
            );
        }
    }
    return { written, deckFolder };
}

// ─────────────────────────────────────────────────────────────────────
// Fantasy Hub post-install setup — the "drop-in" finisher.
// ─────────────────────────────────────────────────────────────────────

export interface HubSetupResult {
    /** Vault path of the Start Here note. */
    startHerePath: string;
}

/**
 * The setup note written (and opened) after a Fantasy Hub install.
 * Pure builder — tested directly.
 */
export function fantasyHubStartHere(opts: {
    generatorsDest: string;
    templatesDest: string;
}): string {
    return `---
cssclasses: []
---
# Fantasy Hub — start here

Everything installed:

- **\`${opts.generatorsDest}/generators\`** — the settlement tables
  (five stocked shop types, tavern, inn, temple, castle, guild,
  barracks, market and more). Roll them in codeblocks, inline, the
  browser pane, or from scripts.
- **\`${opts.templatesDest}\`** — standalone templates. Open an empty
  note → *Templater: Insert template* → pick a location (Tavern, Inn,
  Temple…). It asks for the town and size, rolls everything else, and
  renames the note.

## Stamp a whole town with Town Forge

[Town Forge](obsidian://show-plugin?id=town-forge) (1.0.4+) carries
its own copy of the place templates and installs them itself:

1. **Settings → Town Forge → Create place templates** — one click.
2. **Templater → "Trigger Templater on new file creation" → ON.**
   A per-device Templater setting (sync won't carry it) — it's what
   makes the template code run inside the notes Town Forge creates.
   Accept the warning; "Template matching mode" can stay **None**.
3. Generate a town and export — every shop, tavern, temple and
   barracks note arrives with a named, portraited keeper and coherent
   rolled text.

Crests on castles and guilds? Install
[Heraldry Weaver](obsidian://show-plugin?id=heraldry-weaver).

## No Town Forge? No problem

The standalone set needs nothing but Templater. The generators also
work raw — in any note:

\`\`\`randomness
Use: shop.rdm
[@TF-Shop]
\`\`\`

*(This note is rewritten when you re-run the Fantasy Hub install —
keep your own notes elsewhere.)*
`;
}

/**
 * Post-install: write + open the Start Here note. (Town Forge 1.0.4+
 * seeds and configures its own templates — Randomness no longer
 * writes another plugin's settings.)
 */
export async function finishFantasyHubSetup(
    plugin: RandomnessPlugin,
    opts: { generatorsDest: string; templatesDest: string }
): Promise<HubSetupResult> {
    const startHerePath = normalizePath(
        `${opts.generatorsDest}/Fantasy Hub - Start Here.md`
    );
    await plugin.app.vault.adapter.write(
        startHerePath,
        fantasyHubStartHere(opts)
    );
    try {
        await plugin.app.workspace.openLinkText(startHerePath, "", true);
    } catch {
        // headless/test environments have no workspace leafs — fine
    }
    return { startHerePath };
}

/**
 * Read another plugin's setting, preferring the live instance but
 * falling back to its data.json (works when the plugin is disabled —
 * which is exactly when live detection silently fails).
 */
export async function readPluginSetting(
    plugin: RandomnessPlugin,
    pluginId: string,
    key: string
): Promise<unknown> {
    const app = plugin.app as unknown as {
        plugins?: {
            plugins?: Record<string, { settings?: Record<string, unknown> }>;
        };
    };
    const live = app.plugins?.plugins?.[pluginId]?.settings?.[key];
    if (live !== undefined) return live;
    try {
        const dataPath = normalizePath(
            `${plugin.app.vault.configDir}/plugins/${pluginId}/data.json`
        );
        if (await plugin.app.vault.adapter.exists(dataPath)) {
            const data = JSON.parse(
                await plugin.app.vault.adapter.read(dataPath)
            ) as Record<string, unknown>;
            return data[key];
        }
    } catch {
        // unreadable/corrupt data.json — treat as unset
    }
    return undefined;
}
