/**
 * Plugin entry point.
 *
 * Responsibilities:
 *   - Load settings from data.json (or defaults if first launch).
 *   - Register the `randomness` codeblock processor.
 *   - Register the inline `rdm:` post-processor.
 *   - Register the settings tab.
 *   - Register the "Lock all in note" / "Reroll all in note" commands.
 *   - Own the PreviewRegistry shared across inline processors.
 */

import { Plugin, Notice, TFile } from "obsidian";
import {
    RandomnessSettings,
    DEFAULT_SETTINGS,
    RandomnessSettingsTab,
    isDiceRollerPluginEnabled,
} from "./settings";
import { buildCodeblockProcessor } from "./codeblockProcessor";
import {
    buildInlineProcessor,
    evaluateInlineExpression,
} from "./inlineProcessor";
import {
    PreviewRegistry,
    transformAllInlineCalls,
    callKey,
    evalSourceOf,
    INLINE_PREFIX,
    InlineCall,
} from "./lockingService";
import { registerIptView } from "./iptView";
import { registerBrowserView } from "./browserView";
import { openReferenceView } from "./referenceView";
import { isGeneratorPath } from "../generatorFormat";
import { TableAutocomplete } from "./tableAutocomplete";
import { createApi, RandomnessAPI } from "../api";
import { VaultIndex } from "../resolver/vaultIndex";
import { PortraitService } from "../portrait/service";
import { buildPortraitProcessor } from "../portrait/codeblock";
import { buildPortraitInlineProcessor } from "../portrait/inline";

export default class RandomnessPlugin extends Plugin {
    settings: RandomnessSettings = DEFAULT_SETTINGS;
    /**
     * Shared preview registry. Lives for the plugin's lifetime;
     * cleared per-note when a note's source changes underneath us.
     */
    previewRegistry: PreviewRegistry = new PreviewRegistry();
    /**
     * Table-name autocomplete for inline `rdm:[@`/`[#`/`[!` calls.
     * Exposed on the plugin so settings changes can invalidate its
     * cache without having to chase the suggester reference.
     */
    tableAutocomplete: TableAutocomplete | null = null;
    /**
     * Public JS API for other plugins, Templater scripts, and
     * DataviewJS. Reachable from outside via:
     *   app.plugins.plugins["randomness"].api
     * Built once in onload. See src/api/index.ts for the surface.
     */
    api!: RandomnessAPI;
    /**
     * Vault index: maps bare filenames and table names to paths, so
     * generators can be referenced without full paths. Built on load,
     * kept fresh via vault events, rebuildable via command. See
     * src/resolver/vaultIndex.ts. Exposed for the API + autocomplete.
     */
    vaultIndex!: VaultIndex;
    /**
     * Portrait pack service: pack discovery, manifest + layer loading
     * for the ```portrait codeblock. The feature self-gates on a pack
     * being installed (see src/portrait/service.ts).
     */
    portraits!: PortraitService;

    async onload(): Promise<void> {
        await this.loadSettings();

        // Register the codeblock processor for ```randomness blocks.
        this.registerMarkdownCodeBlockProcessor(
            "randomness",
            buildCodeblockProcessor(this)
        );

        // Portrait compositor. Registered unconditionally; the
        // processor itself renders a settings pointer when no pack is
        // installed (gate at render time, so installing a pack doesn't
        // require a plugin reload).
        this.portraits = new PortraitService(this);
        this.registerMarkdownCodeBlockProcessor(
            "portrait",
            buildPortraitProcessor(this)
        );
        this.registerMarkdownPostProcessor(
            buildPortraitInlineProcessor(this)
        );

        // Register the inline rdm: post-processor.
        this.registerMarkdownPostProcessor(buildInlineProcessor(this));

        // Register the custom view for .ipt files.
        registerIptView(this);

        // Register the right-sidebar generator browser pane.
        registerBrowserView(this);

        // Register the inline rdm:[@/#/! table-name autocomplete.
        // Fires when the user is mid-keystroke inside a `rdm:`
        // inline code span and offers an Obsidian-native picker
        // of tables visible from the current note's scope.
        this.tableAutocomplete = new TableAutocomplete(this.app, this);
        this.registerEditorSuggest(this.tableAutocomplete);

        // Build the vault index (bare-filename + table-name → path).
        // Reads files lazily via the vault adapter; scoped to the
        // generator root if one is set, else the whole vault. Kept
        // fresh by invalidating on vault structure changes below.
        this.vaultIndex = new VaultIndex(
            {
                getFiles: () =>
                    this.app.vault
                        .getFiles()
                        .map((f) => ({ path: f.path })),
                read: (path: string) => {
                    const af =
                        this.app.vault.getAbstractFileByPath(path);
                    if (af instanceof TFile) {
                        return this.app.vault.cachedRead(af);
                    }
                    return Promise.reject(
                        new Error(`not a file: ${path}`)
                    );
                },
            },
            () => this.settings.generatorRoot || ""
        );
        // Invalidate on any structural change to an .ipt file. The
        // rescan is deferred to the next lookup (cheap invalidate now,
        // rebuild lazily). modify fires on content edits — relevant
        // because a file's *table names* can change, affecting the
        // table-name map.
        const maybeInvalidate = (path: string): void => {
            if (isGeneratorPath(path)) {
                this.vaultIndex.invalidate();
            }
        };
        this.registerEvent(
            this.app.vault.on("create", (f) => maybeInvalidate(f.path))
        );
        this.registerEvent(
            this.app.vault.on("delete", (f) => maybeInvalidate(f.path))
        );
        this.registerEvent(
            this.app.vault.on("rename", (f, oldPath) => {
                maybeInvalidate(f.path);
                maybeInvalidate(oldPath);
            })
        );
        this.registerEvent(
            this.app.vault.on("modify", (f) => maybeInvalidate(f.path))
        );

        // Build the public API. Attached as `plugin.api`; reachable
        // from other plugins, Templater scripts, and DataviewJS via
        // app.plugins.plugins["randomness"].api. See src/api/index.ts.
        this.api = createApi(this);

        this.addSettingTab(new RandomnessSettingsTab(this.app, this));

        // ─── Commands ───
        this.addCommand({
            id: "lock-all-in-note",
            name: "Lock all unfilled rdm: in current note",
            callback: () => this.lockAllInActiveNote(),
        });

        this.addCommand({
            id: "reroll-all-in-note",
            name: "Reroll all rdm: in current note",
            callback: () => this.rerollAllInActiveNote(),
        });

        this.addCommand({
            id: "open-reference",
            name: "Open reference",
            callback: () => void openReferenceView(this),
        });

        // A .rdm file is just a text file, but Obsidian's own "new
        // file" UI can't create one — and manual renames trip over
        // Windows' hidden extensions. One command sidesteps all of it.
        this.addCommand({
            id: "create-generator-file",
            name: "Create new generator file",
            callback: () => void this.createGeneratorFile(),
        });

        this.addCommand({
            id: "rebuild-generator-index",
            name: "Rebuild generator index",
            callback: () => {
                void (async () => {
                    this.vaultIndex.invalidate();
                    await this.vaultIndex.prewarm();
                    new Notice("Randomness: generator index rebuilt.");
                })();
            },
        });
    }

    onunload(): void {
        this.previewRegistry.clear();
    }

    async loadSettings(): Promise<void> {
        const stored = (await this.loadData()) as Partial<RandomnessSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
        // Smart default for Dice Roller compatibility: when the user
        // has never touched the toggle, follow the environment — ON
        // when the standalone Dice Roller plugin isn't enabled (its
        // notes should Just Work here), OFF while it is (one plugin
        // at a time owns the dice: spans). An explicit saved choice
        // always wins.
        if (stored?.diceRollerCompat === undefined) {
            this.settings.diceRollerCompat = !isDiceRollerPluginEnabled(
                this.app
            );
        }
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    // ────────────────────────────────────────────────────────────────
    // Command handlers
    // ────────────────────────────────────────────────────────────────

    /**
     * Lock every unfilled rdm: call in the active note. For each
     * call, use a cached preview if available; otherwise evaluate the
     * expression on the fly. The whole pass is then a single atomic
     * vault.modify write.
     *
     * Edge cases:
     *   - If evaluation throws (e.g. resolver error), that one call is
     *     skipped — the rest still get locked. The notice mentions how
     *     many failed.
     *   - Identical-expression occurrences all evaluate to the same
     *     value because the underlying call shape is identical. If
     *     that's not what the user wants — they wanted independent
     *     rolls — they should scroll the note first to populate
     *     distinct previews, then this command commits whatever's
     *     visible. Documented trade-off.
     */
    private async lockAllInActiveNote(): Promise<void> {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
            new Notice("Randomness: no active note");
            return;
        }
        if (!(file instanceof TFile)) return;

        const source = await this.app.vault.read(file);
        const notePath = file.path;

        // Step 1: collect every unique unfilled expression. We
        // evaluate each one ONCE, then apply that result to every
        // occurrence in the transform pass below.
        const toEvaluate = new Map<string, InlineCall>();
        transformAllInlineCalls(source, (call) => {
            // Dice Roller compat spans only participate when the
            // setting is on — otherwise they belong to the other
            // plugin and we must not lock them.
            if (
                (call.prefix ?? INLINE_PREFIX) !== INLINE_PREFIX &&
                !this.settings.diceRollerCompat
            ) {
                return null;
            }
            if (call.locked === undefined) {
                toEvaluate.set(callKey(call), call);
            }
            return null; // we're using transformAll just to walk; don't mutate
        });

        // Step 2: evaluate each missing expression. Cached previews
        // win — they're what the user saw on screen, so they're what
        // should be committed (the lock-what-you-see invariant).
        const results = new Map<string, string>();
        const failed: string[] = [];
        for (const [key, call] of toEvaluate) {
            const cached = this.previewRegistry.get({
                sourcePath: notePath,
                expr: key,
                occurrence: 0,
            });
            if (cached !== undefined) {
                results.set(key, cached);
                continue;
            }
            try {
                const value = await evaluateInlineExpression(
                    evalSourceOf(call, this.settings.diceFormulas),
                    notePath,
                    this
                );
                results.set(key, value);
            } catch {
                failed.push(key);
            }
        }

        // Step 3: apply the locks in a single source transform.
        let locked = 0;
        const newSource = transformAllInlineCalls(source, (call) => {
            if (call.locked !== undefined) return null;
            const value = results.get(callKey(call));
            if (value === undefined) return null;
            locked++;
            return { ...call, locked: value };
        });
        if (newSource !== source) {
            await this.app.vault.modify(file, newSource);
        }
        new Notice(
            `Randomness: locked ${locked} call${locked === 1 ? "" : "s"}` +
                (failed.length > 0
                    ? ` (${failed.length} failed to evaluate)`
                    : "")
        );
    }

    /**
     * Create a starter .rdm file (in the Generator root when set,
     * else the vault root) with a unique name, and open it.
     */
    private async createGeneratorFile(): Promise<void> {
        const { vault, workspace } = this.app;
        const root = this.settings.generatorRoot?.trim() ?? "";
        if (root !== "") {
            try {
                if (!(await vault.adapter.exists(root))) {
                    await vault.createFolder(root);
                }
            } catch {
                // Best effort; creation below will surface real errors.
            }
        }
        const dir = root === "" ? "" : root + "/";
        let path = `${dir}New Generator.rdm`;
        for (let n = 2; vault.getAbstractFileByPath(path) !== null; n++) {
            path = `${dir}New Generator ${n}.rdm`;
        }
        const starter = [
            "// This is a Randomness generator file — plain text.",
            "// Lines starting with // are comments.",
            "// The FIRST table is what rolls when the file is rolled.",
            "",
            "Table: Main",
            "Replace these lines with your own results.",
            "Each line is one possible outcome.",
            "This one rolls dice: you find {2d6} coins.",
            "This one calls another table: the [@Mood] innkeeper waves.",
            "",
            "Table: Mood",
            "cheerful",
            "grumpy",
            "half-asleep",
            "",
            "// Roll it from any note with `rdm:[@Main]`",
            "",
        ].join("\n");
        try {
            const file = await vault.create(path, starter);
            await workspace.getLeaf(true).openFile(file);
            new Notice(`Randomness: created ${path}`);
        } catch (e) {
            new Notice(
                "Randomness: couldn't create the generator file — " +
                    (e instanceof Error ? e.message : String(e))
            );
        }
    }

    private async rerollAllInActiveNote(): Promise<void> {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
            new Notice("Randomness: no active note");
            return;
        }
        if (!(file instanceof TFile)) return;

        this.previewRegistry.clearNote(file.path);

        const source = await this.app.vault.read(file);
        let unlocked = 0;
        const newSource = transformAllInlineCalls(source, (call) => {
            // Same compat gate as lock-all: leave `dice:` spans alone
            // unless the compatibility setting is on.
            if (
                (call.prefix ?? INLINE_PREFIX) !== INLINE_PREFIX &&
                !this.settings.diceRollerCompat
            ) {
                return null;
            }
            if (call.locked === undefined) return null;
            unlocked++;
            return { expr: call.expr, prefix: call.prefix };
        });
        if (newSource !== source) {
            await this.app.vault.modify(file, newSource);
        }
        new Notice(
            `Randomness: rerolled — unlocked ${unlocked} call${unlocked === 1 ? "" : "s"}`
        );
    }
}
