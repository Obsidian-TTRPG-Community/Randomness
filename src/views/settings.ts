/**
 * Plugin settings.
 *
 * Kept small on purpose: the engine and resolver are configurable
 * through their own options objects, and the plugin layer just maps
 * settings into those. Adding a setting means adding a field here, a
 * default, a UI control, and a wiring point in the consumer.
 *
 * The shape is plain data — no methods, no derived state — so it
 * survives loadData / saveData round-trips cleanly.
 */

import {
    App,
    Notice,
    PluginSettingTab,
    Setting,
    TFile,
    normalizePath,
} from "obsidian";
import type RandomnessPlugin from "./main";
import { EXAMPLE_FILES, EXAMPLES_README } from "../examples";

/**
 * Extract a readable message from a caught value. `catch` clauses
 * give us `unknown`; we want to surface a string in Notices without
 * sprinkling `(e as any).message` everywhere. Falls back to
 * `String(e)` for non-Error throws.
 */
function errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    if (typeof e === "string") return e;
    return String(e);
}

export interface RandomnessSettings {
    /**
     * Vault-relative folder where shared generators live. `Use:` paths
     * that don't resolve against the current note's directory fall back
     * to here.
     *
     * Default empty — when empty, only relative-to-caller resolution
     * is attempted. Users with a shared `Generators/` folder will set
     * this once.
     */
    generatorRoot: string;
    /**
     * Default formatting mode for generators that don't specify one.
     * "html" lets bold/italic/underline filters emit HTML tags.
     * "text" makes them use plain-text approximations.
     * Per-file `Formatting:` directives override this.
     */
    defaultFormatting: "html" | "text";
    /**
     * Whether to use a stable seed (derived from codeblock position +
     * source hash) when rendering codeblocks. Off by default — each
     * render is independent. On is useful when you want a codeblock to
     * stay consistent across re-renders of the same note.
     *
     * The "Lock" action (next session) is a stronger guarantee; this
     * setting is for the in-between feel of "this codeblock shouldn't
     * shuffle every time I scroll past it".
     */
    stableCodeblockSeeds: boolean;
    /**
     * Paths (folders and files) the user has expanded in the generator
     * browser pane. Persisted so the tree remembers its shape across
     * Obsidian reloads — start collapsed, expand what you use, the
     * choice survives.
     *
     * Plain array (not Set) so it round-trips cleanly through
     * loadData/saveData JSON. We treat it as a set in memory by
     * checking includes() / filter().
     */
    browserExpandedPaths: string[];
    /**
     * Tables the user has pinned as favourites. Each entry is a
     * stable identifier of the form `{filePath}::{tableName}` —
     * `::` chosen because vault paths can't contain it (`:` is
     * forbidden on Windows paths, but more importantly the double
     * colon is conspicuous enough that nobody would name a table
     * "x::y" by accident).
     *
     * Pinned tables appear in a "Favourites" section at the top of
     * the browser tree above all real folders. Order is insertion
     * order (oldest pinned at top) for stable mental model — users
     * pin things to find them later, and shuffling on every pin
     * would be disorienting.
     *
     * Array (not Set) for clean JSON round-tripping, same pattern
     * as `browserExpandedPaths`.
     */
    pinnedTables: string[];
    /**
     * Vault-relative folder holding a portrait pack (manifest.json +
     * layer images). Portrait features gate on a valid pack existing
     * here. Default points at the standard pack folder name so an
     * installed pack lights up with zero configuration.
     */
    portraitPackPath: string;
    /**
     * Base URL the "Install portrait pack" button downloads from; it
     * must serve manifest.json at its root (e.g. a raw GitHub folder
     * or unpacked release). Empty hides the install button — packs can
     * always be installed by copying the folder into the vault.
     */
    portraitPackUrl: string;
}

export const DEFAULT_SETTINGS: RandomnessSettings = {
    generatorRoot: "",
    defaultFormatting: "html",
    stableCodeblockSeeds: false,
    browserExpandedPaths: [],
    pinnedTables: [],
    portraitPackPath: "fantasy_ink_parts_pack",
    portraitPackUrl: "",
};

/**
 * Settings tab UI. The tab is registered by main.ts via
 * `addSettingTab`. When the user opens Settings → Randomness, Obsidian
 * calls `display()` to populate `containerEl`.
 *
 * Each setting writes through to plugin.settings and persists via
 * plugin.saveSettings(). No debouncing — the saveData backend already
 * coalesces writes, and these are settings the user changes rarely.
 */
export class RandomnessSettingsTab extends PluginSettingTab {
    plugin: RandomnessPlugin;

    constructor(app: App, plugin: RandomnessPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        // Clear with standard DOM methods so jsdom tests pass; Obsidian
        // augments HTMLElement with .empty(), but we don't need it.
        while (containerEl.firstChild) {
            containerEl.removeChild(containerEl.firstChild);
        }

        // Help & reference section, at the top so it's the first
        // thing users see when they open settings. The reference
        // covers all the table-authoring syntax — without
        // discoverability here, new users have to know about the
        // command palette entry to find it.
        new Setting(containerEl)
            .setName("Help & reference")
            .setDesc(
                "Open the in-app reference covering table syntax, " +
                    "filters, dice, conditionals, wiki-link rendering, " +
                    "and the codeblock/inline scoping rules."
            )
            .addButton((btn) =>
                btn
                    .setButtonText("Open reference")
                    .setCta()
                    .onClick(() => {
                        // Lazy import to avoid pulling the view module
                        // into the settings module's load graph — the
                        // view drags in MarkdownRenderer and the full
                        // reference text constant, which we don't need
                        // until the user actually clicks the button.
                        void import("./referenceView").then(
                            ({ openReferenceView }) =>
                                openReferenceView(this.plugin)
                        );
                    })
            );

        new Setting(containerEl)
            .setName("Generator root")
            .setDesc(
                "Vault-relative folder to search when a Use: path doesn't " +
                    "resolve against the note's own folder. Leave blank to " +
                    "only resolve relative to the calling note."
            )
            .addText((text) =>
                text
                    .setPlaceholder("Generators")
                    .setValue(this.plugin.settings.generatorRoot)
                    .onChange(async (value) => {
                        // Route the user's typed path through Obsidian's
                        // normalizePath — handles Unicode quirks, trims
                        // whitespace, normalises separators. Standard
                        // recommendation from the plugin review process.
                        // Empty input stays empty (means "no fallback").
                        const trimmed = value.trim();
                        this.plugin.settings.generatorRoot =
                            trimmed === "" ? "" : normalizePath(trimmed);
                        await this.plugin.saveSettings();
                        // Refresh the panel so the create-folder /
                        // seed-examples buttons recompute their state
                        // based on whether the new path exists.
                        this.display();
                    })
            );

        // ─── Folder setup helpers ──────────────────────────────────
        //
        // Two convenience actions that make first-time setup easier:
        //   - Create the Generator root folder if it doesn't exist yet
        //   - Seed it with example generators that demonstrate features
        //
        // Both depend on the Generator root setting above. If it's
        // empty we show a disabled state with a hint; if the folder
        // already exists we say so and offer just the seed-examples
        // action.

        const rootPath = this.plugin.settings.generatorRoot;
        const vault = this.plugin.app.vault;
        const folderExists =
            rootPath !== "" &&
            vault.getAbstractFileByPath(rootPath) !== null;

        if (rootPath === "") {
            // No path configured — show a helpful note instead of a
            // dead button. This avoids the "what happens if I click
            // this?" ambiguity.
            new Setting(containerEl)
                .setName("Create folder & add examples")
                .setDesc(
                    "Type a path in Generator root above first, then " +
                        "buttons appear here to create the folder and " +
                        "seed it with example generators."
                );
        } else if (!folderExists) {
            new Setting(containerEl)
                .setName("Create folder")
                .setDesc(
                    `The folder "${rootPath}" doesn't exist yet. Click ` +
                        "to create it in your vault."
                )
                .addButton((btn) =>
                    btn
                        .setButtonText("Create folder")
                        .setCta()
                        .onClick(async () => {
                            try {
                                await vault.createFolder(rootPath);
                                new Notice(
                                    `Created folder: ${rootPath}`
                                );
                                this.display(); // refresh — folder exists now
                            } catch (e: unknown) {
                                new Notice(
                                    `Couldn't create folder: ${errorMessage(e)}`
                                );
                            }
                        })
                );
        } else {
            // Folder exists — offer to seed examples. We don't auto-
            // detect whether examples are already present and skip;
            // overwriting is fine if the user clicks twice, and
            // detecting "do these files already match the bundled
            // versions" is more complexity than it's worth.
            new Setting(containerEl)
                .setName("Add example generators")
                .setDesc(
                    "Write " +
                        EXAMPLE_FILES.length +
                        " example .ipt files and a README into " +
                        `"${rootPath}". Each example demonstrates a ` +
                        "feature (basics, sub-tables, prompts, lookup " +
                        "tables, dictionaries) with heavy comments. " +
                        "Safe to click multiple times — existing files " +
                        "with the same names will be overwritten."
                )
                .addButton((btn) =>
                    btn
                        .setButtonText("Add examples")
                        .onClick(async () => {
                            await this.seedExampleGenerators(rootPath);
                        })
                );
        }


        // ─── Starter content ───────────────────────────────────
        //
        // One simple flow, in order: portraits first (a single click
        // — official pack URL is built in; data.json's portraitPackUrl
        // silently overrides it for self-hosted packs), then the
        // Fantasy Hub generators + templates which use them.

        const packPath =
            this.plugin.settings.portraitPackPath || "fantasy_ink_parts_pack";

        const packSetting = new Setting(containerEl)
            .setName("Install Fantasy Portrait Pack")
            .setDesc("Checking…");
        void (async () => {
            if (!this.plugin.portraits) return;
            let installed = false;
            let detail = "";
            try {
                installed = await this.plugin.portraits.available();
                if (installed) {
                    const raw = await this.plugin.portraits.manifest();
                    const assets = (raw.assets ?? raw.layers ?? {}) as Record<
                        string,
                        unknown[]
                    >;
                    const total = Object.values(assets).reduce(
                        (a, v) => a + (Array.isArray(v) ? v.length : 0),
                        0
                    );
                    detail = `${Object.keys(assets).length} categories, ${total} parts`;
                }
            } catch {
                installed = false;
            }
            packSetting.setDesc(
                installed
                    ? `Installed ✓ (${detail}, in "${packPath}") — portrait ` +
                          "codeblocks, inline portraits, the roller and the " +
                          "builder are active."
                    : "Rollable character portraits: seeded faces with names, " +
                          "used by codeblocks, inline spans, the roller pane " +
                          "and templates. One click — downloads the art " +
                          `(~7 MB) into "${packPath}" and switches the ` +
                          "portrait features on."
            );
            packSetting.addButton((btn) =>
                btn
                    .setButtonText(installed ? "Reinstall" : "Install")
                    .setCta()
                    .onClick(async () => {
                        btn.setDisabled(true);
                        btn.setButtonText("Installing…");
                        try {
                            const { installPackFromUrl, OFFICIAL_PACK_URL } =
                                await import("../portrait/service");
                            const url =
                                this.plugin.settings.portraitPackUrl ||
                                OFFICIAL_PACK_URL;
                            this.plugin.settings.portraitPackPath = packPath;
                            await this.plugin.saveSettings();
                            const n = await installPackFromUrl(
                                this.plugin,
                                url,
                                packPath
                            );
                            new Notice(
                                `Portrait pack installed: ${n} files. ` +
                                    "Portraits are now active.",
                                8000
                            );
                            this.display();
                        } catch (e: unknown) {
                            new Notice(
                                "Pack install failed: " + errorMessage(e),
                                8000
                            );
                            btn.setDisabled(false);
                            btn.setButtonText(installed ? "Reinstall" : "Install");
                        }
                    })
            );
        })();

        const FANTASY_HUB_URL =
            "https://raw.githubusercontent.com/Obsidian-TTRPG-Community/" +
            "Randomness/main/community-generators/fantasy-hub";

        const hubSetting = new Setting(containerEl)
            .setName("Install Fantasy Hub content")
            .setDesc("Checking…");
        hubSetting
            .addExtraButton((b) =>
                b
                    .setIcon("castle")
                    .setTooltip("Get Town Forge (community plugins)")
                    .onClick(() => {
                        window.open("obsidian://show-plugin?id=town-forge");
                    })
            )
            .addExtraButton((b) =>
                b
                    .setIcon("shield")
                    .setTooltip("Get Heraldry Weaver (community plugins)")
                    .onClick(() => {
                        window.open(
                            "obsidian://show-plugin?id=heraldry-weaver"
                        );
                    })
            );
        void (async () => {
            if (!this.plugin.portraits) return;
            const packReady = await this.plugin.portraits
                .available()
                .catch(() => false);

            // Templates belong in the user's Templater folder when one
            // is configured; generators go under the generator root.
            const templaterFolder = (
                this.plugin.app as unknown as {
                    plugins?: {
                        plugins?: Record<
                            string,
                            { settings?: { templates_folder?: string } }
                        >;
                    };
                }
            ).plugins?.plugins?.["templater-obsidian"]?.settings
                ?.templates_folder;
            const root = this.plugin.settings.generatorRoot || "Generators";
            const generatorsDest = `${root}/fantasy-hub`;
            const templatesDest = templaterFolder
                ? `${templaterFolder}/Fantasy Hub`
                : `${generatorsDest}/templates`;

            hubSetting.setDesc(
                (packReady
                    ? ""
                    : "Install the Fantasy Portrait Pack above first. ") +
                    "A town's worth of generators (five stocked shop types, " +
                    "tavern, inn, temple, castle, guild and more) plus " +
                    "one-click Templater templates that build whole " +
                    `location notes with portrait NPCs. Generators install ` +
                    `to "${generatorsDest}", templates to "${templatesDest}". ` +
                    "Works great with Town Forge (stamp whole towns) and " +
                    "Heraldry Weaver (crests) — the buttons here open them " +
                    "in Community plugins."
            );
            hubSetting.addButton((btn) =>
                btn
                    .setButtonText("Install")
                    .setCta()
                    .setDisabled(!packReady)
                    .onClick(async () => {
                        btn.setDisabled(true);
                        btn.setButtonText("Installing…");
                        try {
                            const { installContentBundle } = await import(
                                "../contentInstaller"
                            );
                            const n = await installContentBundle(
                                this.plugin,
                                FANTASY_HUB_URL,
                                { generatorsDest, templatesDest }
                            );
                            new Notice(
                                `Fantasy Hub installed: ${n} files. ` +
                                    `Templates are in "${templatesDest}".`,
                                10000
                            );
                            this.display();
                        } catch (e: unknown) {
                            new Notice(
                                "Fantasy Hub install failed: " +
                                    errorMessage(e),
                                8000
                            );
                            btn.setDisabled(false);
                            btn.setButtonText("Install");
                        }
                    })
            );
        })();


        // ─── Community generators ──────────────────────────────
        //
        // Two paths into the same GitHub folder:
        //   - Browse takes the user to the live community-
        //     generators/ tree on GitHub, where each contribution
        //     sits in its own folder with a README and the .ipt
        //     files. Users download the files they want and drop
        //     them into their vault.
        //   - Submit opens a pre-filled GitHub issue with a
        //     template asking for the generator file content,
        //     attribution, and a short description. A maintainer
        //     reviews the issue and adds the contribution to the
        //     repo. Issues are easier than PRs for casual
        //     contributors who don't know git.
        //
        // We deliberately don't try to download or install
        // contributions inside the plugin — that introduces a
        // trust boundary (writing arbitrary files to user vaults)
        // and a maintenance burden (categorisation, search,
        // updates, conflict resolution) that aren't justified
        // until the community-generators/ folder has substantial
        // content. If/when it does, build the in-plugin browser
        // then; for now, GitHub's own tree view is fine.

        const COMMUNITY_BROWSE_URL =
            "https://github.com/Obsidian-TTRPG-Community/Randomness/" +
            "tree/main/community-generators";


        new Setting(containerEl)
            .setName("Browse community generators")
            .setDesc(
                "Open the community-generators folder on GitHub. " +
                    "Each contribution sits in its own subfolder with a " +
                    "README, sample output, and the .ipt files you'd drop " +
                    "into your vault."
            )
            .addButton((btn) =>
                btn
                    .setButtonText("Open on GitHub")
                    .setCta()
                    .onClick(() => {
                        window.open(COMMUNITY_BROWSE_URL, "_blank");
                    })
            );

        // Pre-filled issue URL. The body is a checklist + paste-zone
        // template; GitHub fills the textarea with it on open. We
        // hard-wrap roughly at 70 cols inside the body so the
        // rendered issue isn't a single long line on narrow
        // screens.
        const SUBMIT_BODY = [
            "## What is this generator?",
            "",
            "<!-- One or two sentences: what it's for, what system " +
                "(if any), what it produces. -->",
            "",
            "## File(s)",
            "",
            "<!-- Paste the contents of your .ipt file(s) below," +
                " each in its own code block. If you have several" +
                " files that work together, paste them all and " +
                "explain how they relate. -->",
            "",
            "````",
            "Paste your .ipt content here",
            "````",
            "",
            "## Attribution",
            "",
            "- Author / handle: ",
            "- License: ",
            "  <!-- e.g. CC0, CC-BY, MIT — pick something that " +
                "allows others to use and adapt it. If your content " +
                "draws on someone else's IP, name the source and " +
                "their license. -->",
            "- Sources / credits: ",
            "  <!-- If you built on top of another generator or " +
                "drew tables from a published source, credit them " +
                "here. -->",
            "",
            "## Anything maintainers should know",
            "",
            "<!-- Special syntax used, dependencies on other files," +
                " known limitations, version of Randomness you " +
                "developed against, etc. -->",
            "",
            "---",
            "",
            "<!-- By submitting, you confirm you have the right to " +
                "share this content under the license you named. -->",
        ].join("\n");

        const submitUrl = (() => {
            const base =
                "https://github.com/Obsidian-TTRPG-Community/" +
                "Randomness/issues/new";
            const params = new URLSearchParams({
                labels: "community-generator",
                title: "[Community generator] ",
                body: SUBMIT_BODY,
            });
            return `${base}?${params.toString()}`;
        })();

        new Setting(containerEl)
            .setName("Share your own generators")
            .setDesc(
                "Opens a pre-filled GitHub issue. Paste your .ipt " +
                    "content, add attribution, and submit — a maintainer " +
                    "reviews and adds it to the community folder. " +
                    "Requires a free GitHub account. If you'd rather open " +
                    "a pull request directly, see the contributing notes " +
                    "linked from the browse page above."
            )
            .addButton((btn) =>
                btn
                    .setButtonText("Open submission form")
                    .onClick(() => {
                        window.open(submitUrl, "_blank");
                    })
            );

        // ─── Behaviour ──────────────────────────────────────────

        new Setting(containerEl)
            .setName("Default formatting")
            .setDesc(
                "How bold/italic/underline filters render when a generator " +
                    "doesn't specify a Formatting: directive."
            )
            .addDropdown((dd) =>
                dd
                    .addOption("html", "HTML (rich)")
                    .addOption("text", "Plain text")
                    .setValue(this.plugin.settings.defaultFormatting)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultFormatting =
                            value === "text" ? "text" : "html";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Stable codeblock seeds")
            .setDesc(
                "When on, codeblocks render the same result across reloads " +
                    "until you reroll. When off, every render is independent. " +
                    "The Lock action (when available) is the stronger choice " +
                    "for preserving a specific result."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.stableCodeblockSeeds)
                    .onChange(async (value) => {
                        this.plugin.settings.stableCodeblockSeeds = value;
                        await this.plugin.saveSettings();
                    })
            );
    }

    /**
     * Write the bundled example .ipt files plus a README into the
     * given folder. Called from the "Add examples" button.
     *
     * Uses vault.create when the file doesn't exist, vault.modify
     * when it does — these are the two write paths Obsidian's API
     * gives us. Showing a Notice for each outcome would be too
     * chatty (6 files); we show one summary Notice at the end.
     */
    private async seedExampleGenerators(folder: string): Promise<void> {
        const vault = this.plugin.app.vault;
        let created = 0;
        let updated = 0;
        const errors: string[] = [];

        const writeOne = async (filename: string, content: string) => {
            const path = `${folder}/${filename}`;
            try {
                const existing = vault.getAbstractFileByPath(path);
                if (existing instanceof TFile) {
                    // Overwrite via modify. `instanceof TFile`
                    // narrows the type correctly without an `any`
                    // cast, and works against both the real
                    // Obsidian runtime and the test mock (both
                    // export TFile as a class).
                    await vault.modify(existing, content);
                    updated++;
                } else if (existing) {
                    // Path exists but isn't a file (folder collision)
                    errors.push(`${filename} (path is not a file)`);
                } else {
                    await vault.create(path, content);
                    created++;
                }
            } catch (e: unknown) {
                errors.push(`${filename} (${errorMessage(e)})`);
            }
        };

        for (const f of EXAMPLE_FILES) {
            await writeOne(f.filename, f.content);
        }
        await writeOne("README.md", EXAMPLES_README);

        const summary: string[] = [];
        if (created > 0) summary.push(`${created} created`);
        if (updated > 0) summary.push(`${updated} updated`);
        if (errors.length > 0) {
            summary.push(`${errors.length} failed`);
        }
        let summaryText = summary.length > 0
            ? `Examples: ${summary.join(", ")}.`
            : "Nothing happened.";
        // If anything failed, surface the first error in the Notice
        // itself rather than logging to console — gives the user
        // something actionable without breaking the lint policy
        // around console use.
        if (errors.length > 0) {
            summaryText += ` First error: ${errors[0]}`;
        }

        new Notice(summaryText, errors.length > 0 ? 8000 : 4000);
    }
}

/**
 * Compute a stable seed for a given codeblock source + position.
 * Used when `stableCodeblockSeeds` is on. The hash function is FNV-1a
 * because it's tiny and good enough for variance — not for security.
 *
 * `position` here is the codeblock's lineStart from the post-processor
 * context; combining with the source ensures that two identical
 * codeblocks at different positions get different seeds.
 */
export function stableSeedFor(source: string, position: number): number {
    // FNV-1a 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < source.length; i++) {
        h ^= source.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    h ^= position;
    h = Math.imul(h, 0x01000193);
    // Force positive 32-bit integer
    return h >>> 0;
}
