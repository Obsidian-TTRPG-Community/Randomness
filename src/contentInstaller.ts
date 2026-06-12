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

// ─────────────────────────────────────────────────────────────────────
// Fantasy Hub post-install setup — the "drop-in" finisher.
// ─────────────────────────────────────────────────────────────────────

export interface HubSetupResult {
    /** "configured" | "configured-disabled" | "not-installed" | "failed" */
    townForge: string;
    /** Vault path of the Start Here note. */
    startHerePath: string;
}

interface TownForgeLike {
    settings?: { templateFolder?: string };
    saveSettings?: () => Promise<void>;
    saveData?: (data: unknown) => Promise<void>;
}

/**
 * The setup note written (and opened) after a Fantasy Hub install.
 * Pure builder — tested directly.
 */
export function fantasyHubStartHere(opts: {
    generatorsDest: string;
    templatesDest: string;
    townForge: string;
}): string {
    const tfFolder = `${opts.generatorsDest}/townforge-templates`;
    const tfLine =
        opts.townForge === "configured"
            ? `✅ Done automatically — Town Forge's template folder now points at \`${tfFolder}\`.`
            : opts.townForge === "configured-disabled"
              ? `✅ Pre-configured — Town Forge is installed but disabled; its template folder will point at \`${tfFolder}\` when you enable it.`
              : `Install [Town Forge](obsidian://show-plugin?id=town-forge), then set **Town Forge → Template folder** to \`${tfFolder}\` (forward slashes!) — or just re-run the Fantasy Hub install and it's configured for you.`;
    return `---
cssclasses: []
---
# Fantasy Hub — start here

Everything installed. Two template sets shipped:

- **\`${opts.templatesDest}\`** — standalone templates. Open an empty
  note → *Templater: Insert template* → pick a location (Tavern, Inn,
  Temple…). It asks for the town and size, rolls everything else, and
  renames the note.
- **\`${tfFolder}\`** — the Town Forge set,
  for stamping a whole town of keyed location notes in one go.

## Stamp a whole town with Town Forge

1. ${tfLine}
2. **Templater → "Trigger Templater on new file creation" → ON.**
   This one's a per-device Templater setting (it can't be set for
   you, and sync won't carry it) — it's what makes the template code
   run inside the notes Town Forge creates. Accept the warning;
   "Template matching mode" can stay **None**.
3. Generate a town in Town Forge and export — every shop, tavern,
   temple and barracks note arrives with a named, portraited keeper
   and coherent rolled text.

(Town Forge 1.0.4+ also carries this template set itself — its
settings have a **Create place templates** button that writes them
into whatever folder it's pointed at. Same templates either way.)

Crests on castles and guilds? Install
[Heraldry Weaver](obsidian://show-plugin?id=heraldry-weaver).

## No Town Forge? No problem

The standalone set needs nothing but Templater. The generators also
work raw — in any note:

\`\`\`randomness
Use: shop.rdm
[@FantasyShop]
\`\`\`

*(This note is rewritten when you re-run the Fantasy Hub install —
keep your own notes elsewhere.)*
`;
}

/**
 * Post-install: point Town Forge at the shipped template set (live
 * plugin, or its data.json when installed-but-disabled), write the
 * Start Here note, open it. Returns what happened for the Notice.
 */
export async function finishFantasyHubSetup(
    plugin: RandomnessPlugin,
    opts: { generatorsDest: string; templatesDest: string }
): Promise<HubSetupResult> {
    const app = plugin.app as unknown as {
        plugins?: { plugins?: Record<string, TownForgeLike> };
        vault: typeof plugin.app.vault;
        workspace: typeof plugin.app.workspace;
    };
    const tfFolder = `${opts.generatorsDest}/townforge-templates`;
    let townForge = "not-installed";

    try {
        const tf = app.plugins?.plugins?.["town-forge"];
        if (tf?.settings) {
            tf.settings.templateFolder = tfFolder;
            if (tf.saveSettings) await tf.saveSettings();
            else if (tf.saveData) await tf.saveData(tf.settings);
            townForge = "configured";
        } else {
            // Installed but disabled: configure its data.json so the
            // setting is right the moment it's enabled.
            const dataPath = normalizePath(
                `${plugin.app.vault.configDir}/plugins/town-forge/data.json`
            );
            if (await plugin.app.vault.adapter.exists(dataPath)) {
                const data = JSON.parse(
                    await plugin.app.vault.adapter.read(dataPath)
                ) as Record<string, unknown>;
                data.templateFolder = tfFolder;
                await plugin.app.vault.adapter.write(
                    dataPath,
                    JSON.stringify(data, null, 2)
                );
                townForge = "configured-disabled";
            }
        }
    } catch {
        townForge = "failed";
    }

    const startHerePath = normalizePath(
        `${opts.generatorsDest}/Fantasy Hub - Start Here.md`
    );
    const content = fantasyHubStartHere({ ...opts, townForge });
    await plugin.app.vault.adapter.write(startHerePath, content);
    try {
        await plugin.app.workspace.openLinkText(startHerePath, "", true);
    } catch {
        // headless/test environments have no workspace leafs — fine
    }
    return { townForge, startHerePath };
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
