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
} from "./settings";
import { buildCodeblockProcessor } from "./codeblockProcessor";
import {
    buildInlineProcessor,
    evaluateInlineExpression,
} from "./inlineProcessor";
import {
    PreviewRegistry,
    transformAllInlineCalls,
} from "./lockingService";
import { registerIptView } from "./iptView";
import { registerBrowserView } from "./browserView";
import {
    ReferenceView,
    VIEW_TYPE_REFERENCE,
    openReferenceView,
} from "./referenceView";
import { TableAutocomplete } from "./tableAutocomplete";
import { createApi, RandomnessAPI } from "../api";
import { VaultIndex } from "../resolver/vaultIndex";
import { PortraitService } from "../portrait/service";
import { buildPortraitProcessor } from "../portrait/codeblock";

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

        // Register the inline rdm: post-processor.
        this.registerMarkdownPostProcessor(buildInlineProcessor(this));

        // Register the custom view for .ipt files.
        registerIptView(this);

        // Register the right-sidebar generator browser pane.
        registerBrowserView(this);

        // Register the reference / help pane. A read-only view
        // listing the IPP3 syntax + the plugin's specific
        // extensions (wiki-links, inline rdm:, codeblock scope).
        // Accessed via a button in the settings tab and via the
        // "Open reference" command.
        this.registerView(
            VIEW_TYPE_REFERENCE,
            (leaf) => new ReferenceView(leaf, this)
        );

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
            if (path.toLowerCase().endsWith(".ipt")) {
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
        const exprsToEvaluate = new Set<string>();
        transformAllInlineCalls(source, (call) => {
            if (call.locked === undefined) {
                exprsToEvaluate.add(call.expr);
            }
            return null; // we're using transformAll just to walk; don't mutate
        });

        // Step 2: evaluate each missing expression. Cached previews
        // win — they're what the user saw on screen, so they're what
        // should be committed (the lock-what-you-see invariant).
        const results = new Map<string, string>();
        const failed: string[] = [];
        for (const expr of exprsToEvaluate) {
            const cached = this.previewRegistry.get({
                sourcePath: notePath,
                expr,
                occurrence: 0,
            });
            if (cached !== undefined) {
                results.set(expr, cached);
                continue;
            }
            try {
                const value = await evaluateInlineExpression(
                    expr,
                    notePath,
                    this
                );
                results.set(expr, value);
            } catch {
                failed.push(expr);
            }
        }

        // Step 3: apply the locks in a single source transform.
        let locked = 0;
        const newSource = transformAllInlineCalls(source, (call) => {
            if (call.locked !== undefined) return null;
            const value = results.get(call.expr);
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
            if (call.locked === undefined) return null;
            unlocked++;
            return { expr: call.expr };
        });
        if (newSource !== source) {
            await this.app.vault.modify(file, newSource);
        }
        new Notice(
            `Randomness: rerolled — unlocked ${unlocked} call${unlocked === 1 ? "" : "s"}`
        );
    }
}
