/**
 * Generator browser — right-sidebar view.
 *
 * Lists every `.ipt` file under the configured Generator root (or the
 * whole vault if no root is configured), grouped by file, with a Roll
 * button per table. Clicking a result copies it to clipboard so the
 * user can paste it into a note.
 *
 * Discovery model: scan vault for `.ipt` files, run the file parser
 * cheaply to enumerate `Table:` declarations. Cached in memory and
 * refreshed manually via a Reload button — the user can re-scan
 * after adding new files. (Auto-refresh on file changes would be
 * polish for a follow-up.)
 *
 * Rolling: reuse the same async pipeline as the codeblock processor
 * (prefetch Use: graph → sync resolve → Evaluator). Roll a specific
 * table by name using `runByName`. Result is rendered through the
 * sanitiser, then made copyable.
 */

import {
    ItemView,
    WorkspaceLeaf,
    TFile,
    TFolder,
    Notice,
} from "obsidian";
import { parseGeneratorFile } from "../engine/fileParser";
import { Evaluator } from "../engine/evaluator";
import { resolveBundle } from "../resolver/fileResolver";
import { prefetchUseGraph } from "../resolver/asyncPrefetcher";
import { vaultFileSource } from "./vaultFileSource";
import {
    setSanitisedHtmlWithLinks,
    engineOutputToHtml,
} from "./sanitiser";
import {
    buildFolderTree,
    filterTree,
    collectAllPaths,
    FolderNode,
    GenFileInfo,
} from "./browserTree";
import {
    isPinned,
    togglePin,
    resolvePins,
    FAVOURITES_PATH,
    FAVOURITES_NAME,
} from "./pinnedTables";
import type RandomnessPlugin from "./main";

export const VIEW_TYPE_BROWSER = "randomness-browser-view";

/** A generator file we've discovered and successfully parsed. */
interface DiscoveredGenerator {
    path: string;
    /** File-author's `Title:` directive, falling back to basename. */
    title: string;
    /** Tables in declaration order; the first is the "main" entry point. */
    tables: { name: string; isMain: boolean }[];
}

/**
 * Result of trying to discover a generator file. We keep failures
 * in the list (rather than dropping them silently) so the user knows
 * why a file isn't showing up to roll.
 */
type DiscoveryResult =
    | { ok: true; gen: DiscoveredGenerator }
    | { ok: false; path: string; error: string };

export class BrowserView extends ItemView {
    private plugin: RandomnessPlugin;
    private root: HTMLElement | null = null;
    /** Cached discovery results. Refreshed on Reload button click or
     * when the view first opens. */
    private discoveries: DiscoveryResult[] = [];
    /** Filter text from the search box. Plain substring match against
     * filename and table names. */
    private filter = "";
    /** Most recent roll, displayed at the bottom with a Copy button. */
    private lastRoll: {
        table: string;
        result: string;
        /**
         * Path of the generator file the roll came from. Used as
         * the `sourcePath` argument when interpolating wiki-syntax
         * in the result panel — so `![[image.png]]` resolves
         * relative to the generator file, not the active note.
         */
        sourcePath: string;
    } | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: RandomnessPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_BROWSER;
    }
    getDisplayText(): string {
        return "Randomness generators";
    }
    getIcon(): string {
        return "dice";
    }

    async onOpen(): Promise<void> {
        // Obsidian gives ItemView a containerEl with a header child
        // and a content child; we write to the content child.
        const target = this.containerEl.children[1] as HTMLElement;
        clearElement(target);
        const wrap = document.createElement("div");
        wrap.className = "randomness-browser";
        target.appendChild(wrap);
        this.root = wrap;

        // Run initial discovery in the background; the UI shows a
        // "scanning..." placeholder until it completes.
        await this.refresh();
    }

    async onClose(): Promise<void> {
        // Nothing explicit; Obsidian cleans up the DOM.
    }

    /**
     * Re-scan the vault for .ipt files and re-render the list.
     * Called on first open and from the Reload button.
     */
    private async refresh(): Promise<void> {
        if (!this.root) return;
        this.renderLoading();
        this.discoveries = await discoverGenerators(this.plugin);
        this.render();
    }

    private renderLoading(): void {
        if (!this.root) return;
        clearElement(this.root);
        const wrap = el(this.root, "div", "randomness-browser-loading");
        wrap.textContent = "Scanning vault for generators…";
    }

    /** Full re-render. Called whenever state changes. */
    private render(): void {
        if (!this.root) return;
        clearElement(this.root);

        // Header: title + Collapse all + Reload.
        const header = el(this.root, "div", "randomness-browser-header");
        const h = document.createElement("h3");
        h.textContent = "Generators";
        header.appendChild(h);

        // Header buttons cluster on the right.
        const headerActions = el(header, "div", "randomness-browser-header-actions");

        const collapseAllBtn = el(
            headerActions,
            "button",
            "randomness-browser-collapse-all"
        );
        collapseAllBtn.textContent = "Collapse all";
        collapseAllBtn.title = "Close every expanded folder and file";
        collapseAllBtn.addEventListener("click", () =>
            void this.collapseAll()
        );

        const reloadBtn = el(
            headerActions,
            "button",
            "randomness-browser-reload"
        );
        reloadBtn.textContent = "Reload";
        reloadBtn.title = "Re-scan the vault for .ipt files";
        reloadBtn.addEventListener("click", () => void this.refresh());

        // Search filter.
        const filterBox = document.createElement("input") as HTMLInputElement;
        filterBox.type = "text";
        filterBox.className = "randomness-browser-filter";
        filterBox.placeholder = "Filter…";
        filterBox.value = this.filter;
        // Use 'input' here (not 'change' as we do for prompts) — the
        // filter is read-only against in-memory state, no async cost,
        // so per-keystroke refresh is fine and gives instant feedback.
        filterBox.addEventListener("input", () => {
            this.filter = filterBox.value;
            this.renderList();
        });
        this.root.appendChild(filterBox);

        // List container — separated so we can rerender just the list
        // on filter changes without rebuilding header/footer.
        const list = el(this.root, "div", "randomness-browser-list");
        list.dataset.role = "list";

        // Last-roll display at the bottom.
        const resultArea = el(this.root, "div", "randomness-browser-result");
        resultArea.dataset.role = "result";

        this.renderList();
        this.renderResult();
    }

    /**
     * Build and render the folder tree.
     *
     * Tree-rendering policy:
     *   - Folder/file expansion comes from `settings.browserExpandedPaths`.
     *   - When a filter is active, we layer on a *transient* expansion
     *     set covering every node in the filtered tree, so matches are
     *     always visible without the user having to click in. The
     *     persistent set is unchanged — clearing the filter restores
     *     whatever the user had expanded.
     */
    private renderList(): void {
        if (!this.root) return;
        const list = this.root.querySelector(
            '[data-role="list"]'
        ) as HTMLElement | null;
        if (!list) return;
        clearElement(list);

        const settings = this.plugin.settings;
        const rootDesc = settings.generatorRoot
            ? `under "${settings.generatorRoot}"`
            : "across the vault";

        // Empty discovery state.
        if (this.discoveries.length === 0) {
            const empty = el(list, "div", "randomness-browser-empty");
            empty.textContent = `No .ipt files found ${rootDesc}.`;
            return;
        }

        // Convert discoveries to GenFileInfo for the tree builder.
        // Failed discoveries become "error" file entries — they stay
        // visible so the user knows why they're not rollable.
        const fileInfos: GenFileInfo[] = this.discoveries.map((d) =>
            d.ok
                ? {
                      path: d.gen.path,
                      title: d.gen.title,
                      tables: d.gen.tables,
                  }
                : {
                      path: d.path,
                      title: d.path.split("/").pop() ?? d.path,
                      tables: [],
                      error: d.error,
                  }
        );

        const fullTree = buildFolderTree(
            fileInfos,
            settings.generatorRoot ?? ""
        );

        // If filter is non-empty, build a filtered tree AND auto-expand
        // everything inside it so matches are visible.
        const filterActive = this.filter.trim() !== "";
        const tree = filterActive ? filterTree(fullTree, this.filter) : fullTree;
        const transientExpansion = filterActive
            ? new Set(collectAllPaths(tree))
            : new Set<string>();

        // Empty state under filter.
        if (
            filterActive &&
            tree.folders.length === 0 &&
            tree.files.length === 0
        ) {
            const empty = el(list, "div", "randomness-browser-empty");
            empty.textContent = `No matches for "${this.filter}".`;
            return;
        }

        // Render the root's contents directly (don't draw a chevron
        // for the root itself — its presence is implicit).
        const persistent = new Set(this.plugin.settings.browserExpandedPaths);

        // Render the Favourites section at the top, above all real
        // folders. The section only appears when there's at least
        // one resolvable pin (a pin whose file + table still
        // exist). The same filter applies to favourites as to the
        // rest of the tree — a pinned table whose name doesn't
        // match the filter is hidden, and if all are hidden the
        // section collapses out of view entirely.
        const allPins = resolvePins(
            this.plugin.settings.pinnedTables,
            fileInfos
        );
        const filterNeedle = this.filter.trim().toLowerCase();
        const visiblePins = filterActive
            ? allPins.filter((p) =>
                  this.pinMatchesFilter(p, filterNeedle)
              )
            : allPins;
        if (visiblePins.length > 0) {
            this.renderFavourites(
                list,
                visiblePins,
                persistent,
                transientExpansion
            );
        }

        for (const sub of tree.folders) {
            this.renderFolder(list, sub, persistent, transientExpansion);
        }
        for (const file of tree.files) {
            this.renderFile(list, file, persistent, transientExpansion);
        }
    }

    /**
     * Does a single pinned (file, table) pair match the current
     * filter? Matches against the table name, the file title, or
     * the file path — same trio of fields the regular tree
     * filter checks. Kept in sync with `fileMatches` in
     * browserTree.ts.
     */
    private pinMatchesFilter(
        pin: { file: GenFileInfo; tableName: string },
        needle: string
    ): boolean {
        if (needle === "") return true;
        if (pin.tableName.toLowerCase().includes(needle)) return true;
        if (pin.file.title.toLowerCase().includes(needle)) return true;
        if (pin.file.path.toLowerCase().includes(needle)) return true;
        return false;
    }

    /**
     * Render the Favourites section. Visually mimics a folder
     * (chevron + name + count badge) so it slots cleanly into the
     * tree at the top. Uses the FAVOURITES_PATH sentinel in
     * expansion state — that string can't collide with real vault
     * paths.
     *
     * When filtering is active, the section auto-expands like
     * regular folders do, so the user can see their matching pins
     * without an extra click.
     */
    private renderFavourites(
        parent: HTMLElement,
        pins: { file: GenFileInfo; tableName: string }[],
        persistent: Set<string>,
        transient: Set<string>
    ): void {
        const filterActive = this.filter.trim() !== "";
        const expanded =
            persistent.has(FAVOURITES_PATH) ||
            transient.has(FAVOURITES_PATH) ||
            filterActive;

        const wrap = el(
            parent,
            "div",
            "randomness-browser-folder randomness-browser-favourites"
        );
        const header = el(wrap, "div", "randomness-browser-folder-header");
        header.title = "Pinned generators";
        header.addEventListener("click", () =>
            void this.toggleExpansion(FAVOURITES_PATH)
        );

        const chevron = el(header, "span", "randomness-browser-chevron");
        chevron.textContent = expanded ? "▾" : "▸";

        const name = el(header, "span", "randomness-browser-folder-name");
        // Pin emoji as the section visual marker — distinct from
        // the `★` used to indicate a file's main table, so the
        // two don't read as the same affordance.
        name.textContent = "📌 " + FAVOURITES_NAME;

        const count = el(header, "span", "randomness-browser-folder-count");
        count.textContent = String(pins.length);

        if (expanded) {
            const inner = el(
                wrap,
                "div",
                "randomness-browser-folder-children"
            );
            for (const pin of pins) {
                this.renderTableRow(
                    inner,
                    pin.file,
                    pin.tableName,
                    /* isPinnedSection */ true
                );
            }
        }
    }

    /**
     * Render one folder row (with chevron + name), and if expanded,
     * render its children. Recursive.
     *
     * `persistent` is the user's saved expansion set.
     * `transient` is added on top when filtering is active.
     */
    private renderFolder(
        parent: HTMLElement,
        folder: FolderNode,
        persistent: Set<string>,
        transient: Set<string>
    ): void {
        const expanded = persistent.has(folder.path) || transient.has(folder.path);
        const wrap = el(parent, "div", "randomness-browser-folder");

        const header = el(wrap, "div", "randomness-browser-folder-header");
        // Whole header is clickable for ergonomics — bigger hit target
        // than the chevron alone.
        header.title = folder.path;
        header.addEventListener("click", () =>
            void this.toggleExpansion(folder.path)
        );

        const chevron = el(header, "span", "randomness-browser-chevron");
        chevron.textContent = expanded ? "▾" : "▸";

        const name = el(header, "span", "randomness-browser-folder-name");
        name.textContent = folder.name;

        // Show a count badge of files contained recursively, so the
        // user knows how much they're opening up.
        const fileCount = countFiles(folder);
        if (fileCount > 0) {
            const count = el(header, "span", "randomness-browser-folder-count");
            count.textContent = String(fileCount);
        }

        if (expanded) {
            const inner = el(wrap, "div", "randomness-browser-folder-children");
            for (const sub of folder.folders) {
                this.renderFolder(inner, sub, persistent, transient);
            }
            for (const file of folder.files) {
                this.renderFile(inner, file, persistent, transient);
            }
        }
    }

    /**
     * Render one file row (with chevron + title). When expanded, lists
     * the file's tables with per-table Roll buttons.
     */
    private renderFile(
        parent: HTMLElement,
        file: GenFileInfo,
        persistent: Set<string>,
        transient: Set<string>
    ): void {
        const expanded = persistent.has(file.path) || transient.has(file.path);
        const wrap = el(parent, "div", "randomness-browser-file");

        const header = el(wrap, "div", "randomness-browser-file-header");
        header.title = file.path;
        header.addEventListener("click", () =>
            void this.toggleExpansion(file.path)
        );

        const chevron = el(header, "span", "randomness-browser-chevron");
        chevron.textContent = expanded ? "▾" : "▸";

        const title = el(header, "span", "randomness-browser-file-title");
        title.textContent = file.title;

        // Failed file: render the error in place of tables.
        if (file.error !== undefined) {
            const err = el(wrap, "div", "randomness-browser-entry-error");
            err.textContent = `Error: ${file.error}`;
            return;
        }

        // Show a count of tables when collapsed, to give a hint of
        // what's inside before the user expands.
        if (file.tables.length > 0) {
            const count = el(header, "span", "randomness-browser-file-count");
            count.textContent = String(file.tables.length);
        }

        if (expanded) {
            if (file.tables.length === 0) {
                const note = el(
                    wrap,
                    "div",
                    "randomness-browser-entry-note"
                );
                note.textContent = "(no tables)";
                return;
            }
            const tableList = el(wrap, "div", "randomness-browser-tables");
            for (const t of file.tables) {
                this.renderTableRow(tableList, file, t.name, false);
            }
        }
    }

    /**
     * Render a single table row — Roll, Copy-inline, Pin buttons,
     * plus the table name. Shared between the regular file expansion
     * (renderFile) and the Favourites section (renderFavourites).
     *
     * `isPinnedSection` is true when this row is being rendered as
     * part of the Favourites list. We add a small file-path subtitle
     * underneath the table name there, so when a user pins
     * similarly-named tables from different files they can still
     * tell them apart at a glance.
     */
    private renderTableRow(
        parent: HTMLElement,
        file: GenFileInfo,
        tableName: string,
        isPinnedSection: boolean
    ): void {
        const row = el(parent, "div", "randomness-browser-table-row");
        const tableInfo = file.tables.find((t) => t.name === tableName);
        const isMain = tableInfo?.isMain ?? false;

        // Roll button — evaluates the table and shows the
        // result in the bottom panel.
        const rollBtn = document.createElement("button");
        rollBtn.className = "randomness-browser-roll-btn";
        rollBtn.textContent = "Roll";
        rollBtn.title = `Roll ${file.title} → ${tableName}`;
        rollBtn.addEventListener("click", (e) => {
            // Stop the click from also toggling the file's
            // expansion via the header handler's bubble.
            e.stopPropagation();
            void this.roll(file, tableName);
        });
        row.appendChild(rollBtn);

        // Copy-inline button — puts the inline `rdm:[@T]`
        // syntax on the clipboard so the user can paste a
        // live-rolling reference into their note. Also shows
        // the Use: line they'll need in a codeblock if their
        // note doesn't already import this file.
        const copyBtn = document.createElement("button");
        copyBtn.className = "randomness-browser-copy-inline-btn";
        copyBtn.textContent = "📋";
        copyBtn.title =
            `Copy inline rdm: syntax for ${tableName} ` +
            `(also tells you the Use: line to add to your note)`;
        copyBtn.setAttribute(
            "aria-label",
            `Copy inline syntax for ${tableName}`
        );
        copyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void this.copyInline(file, tableName);
        });
        row.appendChild(copyBtn);

        // Pin toggle. Filled 📌 = pinned, outlined 📍 = not.
        // We use distinct emoji rather than swapping CSS classes
        // because Obsidian's theme variations make text-styled
        // toggles hard to read consistently across light/dark and
        // popular community themes.
        const pinned = isPinned(
            this.plugin.settings.pinnedTables,
            file.path,
            tableName
        );
        const pinBtn = document.createElement("button");
        pinBtn.className =
            "randomness-browser-pin-btn" +
            (pinned ? " randomness-browser-pin-btn-active" : "");
        pinBtn.textContent = pinned ? "📌" : "📍";
        pinBtn.title = pinned
            ? `Unpin ${tableName} from Favourites`
            : `Pin ${tableName} to Favourites`;
        pinBtn.setAttribute(
            "aria-label",
            pinned
                ? `Unpin ${tableName}`
                : `Pin ${tableName} to Favourites`
        );
        pinBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void this.togglePinned(file.path, tableName);
        });
        row.appendChild(pinBtn);

        // Table name label. In the pinned section we stack the
        // file title underneath so origin is always clear; in the
        // regular tree the parent file's header already conveys
        // that context.
        const labelWrap = el(
            row,
            "span",
            "randomness-browser-table-label"
        );
        const nameSpan = el(
            labelWrap,
            "span",
            "randomness-browser-table-name"
        );
        nameSpan.textContent = isMain ? `★ ${tableName}` : tableName;
        if (isMain) {
            nameSpan.title =
                "Main table (rolled by default in codeblocks)";
        }
        if (isPinnedSection) {
            const sub = el(
                labelWrap,
                "span",
                "randomness-browser-table-source"
            );
            sub.textContent = file.title;
            sub.title = file.path;
        }
    }

    /**
     * Toggle the pinned state of a (file, table) pair. Persists
     * immediately so the next reload reflects the change, then
     * re-renders so the star icons + Favourites section update.
     */
    private async togglePinned(
        filePath: string,
        tableName: string
    ): Promise<void> {
        this.plugin.settings.pinnedTables = togglePin(
            this.plugin.settings.pinnedTables,
            filePath,
            tableName
        );
        await this.plugin.saveSettings();
        this.renderList();
    }

    /**
     * Toggle a single path's expanded state. Persists the change
     * immediately so the next session sees it.
     */
    private async toggleExpansion(path: string): Promise<void> {
        const set = new Set(this.plugin.settings.browserExpandedPaths);
        if (set.has(path)) set.delete(path);
        else set.add(path);
        this.plugin.settings.browserExpandedPaths = Array.from(set);
        await this.plugin.saveSettings();
        this.renderList();
    }

    /**
     * Collapse-all action. Clears the persistent expansion set but
     * leaves the filter alone — collapse-all + filter together is the
     * fastest way to find a specific generator in a deep tree.
     */
    private async collapseAll(): Promise<void> {
        this.plugin.settings.browserExpandedPaths = [];
        await this.plugin.saveSettings();
        this.renderList();
    }

    /**
     * Render the last-roll panel at the bottom of the view. Empty
     * placeholder when no roll has happened yet.
     */
    private renderResult(): void {
        if (!this.root) return;
        const area = this.root.querySelector(
            '[data-role="result"]'
        ) as HTMLElement | null;
        if (!area) return;
        clearElement(area);

        if (this.lastRoll === null) {
            const hint = el(area, "div", "randomness-browser-result-hint");
            hint.textContent = "Click Roll on any table to generate a result.";
            return;
        }

        const head = el(area, "div", "randomness-browser-result-head");
        const label = el(head, "span", "randomness-browser-result-label");
        label.textContent = `Last roll — ${this.lastRoll.table}`;
        const copyBtn = document.createElement("button");
        copyBtn.className = "randomness-browser-copy-btn";
        copyBtn.textContent = "Copy";
        copyBtn.title = "Copy this result to the clipboard";
        copyBtn.addEventListener("click", () =>
            void this.copyResult(this.lastRoll!.result)
        );
        head.appendChild(copyBtn);

        const body = el(area, "div", "randomness-browser-result-body");
        // Sanitiser handles <b>/<i>/<ul>/etc. from filter output.
        // Link-aware variant so `![[image.png]]` etc. render as
        // actual images / links, resolved against the generator
        // file's path so relative links work the way they would in
        // the generator's own context.
        setSanitisedHtmlWithLinks(
            body,
            this.lastRoll.result,
            this.plugin,
            this.lastRoll.sourcePath
        );
        // Also make clicking the body itself copy — common UX expectation
        // for "click to copy" panels.
        body.style.cursor = "pointer";
        body.title = "Click to copy";
        body.addEventListener("click", () =>
            void this.copyResult(this.lastRoll!.result)
        );
    }

    /**
     * Roll a specific table in a specific generator. Uses the same
     * async pipeline as the codeblock processor.
     */
    private async roll(
        gen: { path: string; title: string },
        tableName: string
    ): Promise<void> {
        try {
            const result = await rollTable(this.plugin, gen.path, tableName);
            this.lastRoll = {
                table: `${gen.title} / ${tableName}`,
                result,
                sourcePath: gen.path,
            };
            this.renderResult();
        } catch (err) {
            new Notice(
                `Randomness: roll failed — ${
                    err instanceof Error ? err.message : String(err)
                }`
            );
        }
    }

    /**
     * Copy the last roll's result to the clipboard, preserving
     * formatting where the paste target supports it.
     *
     * We write both `text/html` and `text/plain` simultaneously:
     * Obsidian's markdown editor receives the HTML and converts to
     * markdown on paste (so `<b>` becomes `**`, `<li>` becomes `-`,
     * etc.), while plain-text targets get the stripped text. See
     * writeRichClipboard for the dual-format details and fallback.
     *
     * The HTML format goes through `engineOutputToHtml` so that
     * `\n` in the engine output becomes `<br>` — without that,
     * Obsidian's HTML parser collapses newlines into spaces during
     * paste conversion and a multi-rep table (e.g. five altars
     * joined with `\n`) ends up as one wall of text. The
     * `text/plain` format keeps real `\n` characters because plain
     * targets need them.
     *
     * The HTML input here is already sanitised — it came from the
     * roll result that we displayed via setSanitisedHtml. Putting
     * it back on the clipboard introduces no new XSS surface.
     */
    private async copyResult(html: string): Promise<void> {
        const richHtml = engineOutputToHtml(html);
        const plain = htmlToPlainText(html);
        try {
            await writeRichClipboard(richHtml, plain);
            new Notice("Result copied with formatting");
        } catch (err) {
            new Notice(
                `Randomness: clipboard write failed — ${
                    err instanceof Error ? err.message : String(err)
                }`
            );
        }
    }

    /**
     * Copy a roll reference to the clipboard, choosing between
     * inline-only and a self-contained codeblock+inline snippet
     * based on whether the active note already imports the source
     * generator.
     *
     * Decision logic:
     *   - Read the active note's source.
     *   - If we find a `randomness` codeblock with a `Use:` line
     *     pointing at this file → copy just `` `rdm:[@T]` `` (the
     *     terse inline form). User wanted to chain another inline
     *     call into a note that's already wired up.
     *   - Otherwise → copy a self-contained snippet (codeblock with
     *     `Use:`, blank line, inline call). One paste, no setup.
     *
     * Edge cases that all fall through to the safe codeblock form:
     *   - No active note (user clicked Copy without a focused note).
     *   - Note source unreadable for any reason.
     *   - Active note is the same file as the source of the click
     *     (unusual but possible — user is editing the generator
     *     itself).
     *
     * The Notice tells the user which form they got and why, so
     * they're not surprised by paste contents that differ from
     * what they expected.
     */
    private async copyInline(
        file: GenFileInfo,
        tableName: string
    ): Promise<void> {
        // Inspect the active note to decide which form to copy.
        const activeNoteSource = await this.readActiveNoteSource();
        const noteAlreadyImports =
            activeNoteSource !== null &&
            noteImportsFile(activeNoteSource, file.path);

        const textToCopy = noteAlreadyImports
            ? buildInlineSyntax(tableName)
            : buildSelfContainedSnippet(file.path, tableName);

        try {
            await navigator.clipboard.writeText(textToCopy);
        } catch (err) {
            new Notice(
                `Randomness: clipboard write failed — ${
                    err instanceof Error ? err.message : String(err)
                }`
            );
            return;
        }

        // Tell the user which form they got. The two forms have
        // different paste workflows (inline = drop anywhere;
        // codeblock+inline = codeblock goes at top, inline goes
        // where you want), so surfacing the choice matters.
        if (noteAlreadyImports) {
            new Notice(
                `Copied inline ${buildInlineSyntax(tableName)}\n\n` +
                    `(Your active note already imports this generator.)`,
                5000
            );
        } else {
            new Notice(
                `Copied codeblock + inline call for ${tableName}.\n\n` +
                    `Paste at the top of your note. The codeblock ` +
                    `imports the generator; the inline call rolls.`,
                7000
            );
        }
    }

    /**
     * Read the currently active note's markdown source, or return
     * null if no note is focused / the read fails / the workspace
     * API isn't available (defensive — test mocks may not implement
     * the full Workspace surface). Used by the Copy button to
     * decide between inline and codeblock forms.
     *
     * Kept separate from copyInline so tests can stub it.
     */
    private async readActiveNoteSource(): Promise<string | null> {
        const workspace = this.plugin.app.workspace;
        // Defensive: workspace.getActiveFile may not exist on
        // minimal fake plugins (some tests build a plugin with only
        // the vault APIs). Treat missing API as "no active note".
        if (typeof workspace?.getActiveFile !== "function") return null;
        const file = workspace.getActiveFile();
        if (!file) return null;
        // Only markdown notes have a sensible "active source" for
        // this purpose. Other file types (PDFs, images) don't.
        if (file.extension !== "md") return null;
        try {
            return await this.plugin.app.vault.read(file);
        } catch {
            return null;
        }
    }
}

/**
 * Build the inline-call string for a given table.
 *
 * Format: `` `rdm:[@TableName]` `` — the leading + trailing backticks
 * are part of what gets pasted, because that's the markdown
 * code-span that the inline post-processor matches against.
 *
 * No escaping is done: IPP3 table names are simple identifiers (no
 * backticks, no newlines), and the inline parser tolerates spaces
 * inside `[@...]`. If a table name happens to contain weird
 * characters, the resulting inline call may not parse — but the
 * generator file wouldn't have parsed cleanly in the first place,
 * so we'd already have flagged that during discovery.
 *
 * Exported for tests.
 */
export function buildInlineSyntax(tableName: string): string {
    return "`rdm:[@" + tableName + "]`";
}

/**
 * Build a self-contained snippet for pasting into a note that
 * doesn't yet import the generator: a `randomness` codeblock
 * declaring the `Use:`, a blank line, then the inline call.
 *
 * Format:
 *
 *     ```randomness
 *     Use: <vault-relative path to the .ipt file>
 *     ```
 *
 *     `rdm:[@TableName]`
 *
 * Pasting this once into a note gets both the import (which lives
 * in the codeblock at whatever position the user pastes) and the
 * inline call (which rolls live in Reading view). The user can
 * move the inline call elsewhere in the note afterwards; the
 * codeblock just needs to exist somewhere in the same note.
 *
 * Exported for tests.
 */
export function buildSelfContainedSnippet(
    filePath: string,
    tableName: string
): string {
    return (
        "```randomness\n" +
        "Use: " +
        filePath +
        "\n```\n\n" +
        buildInlineSyntax(tableName)
    );
}

/**
 * Scan a note's markdown source for a `randomness` codeblock that
 * already imports the given file path. Returns true if found.
 *
 * Matching is case-insensitive and normalised on path separators —
 * consistent with how the resolver actually finds files on disk.
 * The point of this scan is to predict whether the inline form
 * will Just Work in the destination note: if the note's resolver
 * scope already includes a path that resolves to the target file,
 * pasting `rdm:[@T]` is enough; otherwise the user needs a Use:
 * codeblock too.
 *
 * We don't do a deep parse — this is a regex-style scan that
 * approximates the prefetcher's extractUseLines pass. False
 * positives (matching a Use: in a non-randomness codeblock) just
 * mean we'd give the inline form when the codeblock form would
 * have been safer; the user pastes, finds out, adds the missing
 * Use:. False negatives (missing an existing Use: that's there)
 * just mean we'd give the codeblock form when the inline alone
 * would have sufficed; the result is a redundant Use: line in
 * the note. Both failure modes are recoverable nuisances, not
 * broken state.
 *
 * Exported for tests.
 */
export function noteImportsFile(
    noteSource: string,
    filePath: string
): boolean {
    if (noteSource === "" || filePath === "") return false;
    const target = filePath.toLowerCase().replace(/\\/g, "/");
    // Scan all fenced ```randomness blocks for Use: lines.
    const fenceRe = /```randomness\b([\s\S]*?)```/gi;
    let m: RegExpExecArray | null;
    while ((m = fenceRe.exec(noteSource)) !== null) {
        const body = m[1];
        // Inside each block, find Use: lines. IPP3 allows whitespace
        // before the directive and the value can use \ or / separators.
        const useRe = /^[ \t]*Use[ \t]*:[ \t]*(.+?)[ \t]*$/gim;
        let u: RegExpExecArray | null;
        while ((u = useRe.exec(body)) !== null) {
            const candidate = u[1].toLowerCase().replace(/\\/g, "/");
            if (candidate === target) return true;
            // Also accept a basename match — handles the case where the
            // user's Use: is relative (e.g. "Orc.ipt") and the file's
            // full path is "IPP3/Common/nbos/Names/Orc.ipt". This is
            // approximate (could match the wrong file with the same
            // name), but if a basename collision occurs, the worst
            // case is a redundant Use: — see the function comment.
            if (target.endsWith("/" + candidate)) return true;
        }
    }
    return false;
}

// ────────────────────────────────────────────────────────────────────
// Discovery
// ────────────────────────────────────────────────────────────────────

/**
 * Walk the vault for `.ipt` files (filtered to the generator root if
 * configured) and parse each one to enumerate its tables. Returns
 * one entry per file. Files that fail to parse appear in the list
 * as failure entries so the user can see what's wrong.
 *
 * Exported for tests.
 */
export async function discoverGenerators(
    plugin: RandomnessPlugin
): Promise<DiscoveryResult[]> {
    const { vault } = plugin.app;
    const root = plugin.settings.generatorRoot ?? "";

    // Collect candidate file paths. We use vault.getFiles() which
    // returns every TFile in the vault, then filter by extension and
    // optional root prefix. For very large vaults a more targeted
    // walk could be faster, but this is simple and correct.
    const all = vault.getFiles();
    const candidates = all.filter((f) => {
        if (!f.path.toLowerCase().endsWith(".ipt")) return false;
        if (root === "") return true;
        // Match either the root itself or anything beneath it.
        return f.path === root || f.path.startsWith(root + "/");
    });

    // Sort by path for stable display ordering (otherwise vault
    // iteration order can vary).
    candidates.sort((a, b) => a.path.localeCompare(b.path));

    const results: DiscoveryResult[] = [];
    for (const file of candidates) {
        results.push(await discoverOne(plugin, file));
    }
    return results;
}

async function discoverOne(
    plugin: RandomnessPlugin,
    file: TFile
): Promise<DiscoveryResult> {
    let source: string;
    try {
        source = await plugin.app.vault.read(file);
    } catch (err) {
        return {
            ok: false,
            path: file.path,
            error: `read failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    try {
        const parsed = parseGeneratorFile(source);
        const title =
            parsed.title?.trim() ||
            file.basename ||
            file.path;
        const tables = parsed.tables.map((t, i) => ({
            name: t.name,
            isMain: i === 0,
        }));
        return {
            ok: true,
            gen: { path: file.path, title, tables },
        };
    } catch (err) {
        return {
            ok: false,
            path: file.path,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

// ────────────────────────────────────────────────────────────────────
// Rolling
// ────────────────────────────────────────────────────────────────────

/**
 * Run a specific table in a generator file. Composes prefetch +
 * resolve + evaluator, then calls `runByName` for the specific table.
 *
 * Exported for tests.
 */
export async function rollTable(
    plugin: RandomnessPlugin,
    filePath: string,
    tableName: string
): Promise<string> {
    const { vault } = plugin.app;
    const settings = plugin.settings;

    const source = await vault.adapter.read(filePath);
    const asyncSource = vaultFileSource(vault);
    const prefetch = await prefetchUseGraph({
        entryPath: filePath,
        entrySource: source,
        generatorRoot: settings.generatorRoot || undefined,
        source: asyncSource,
    });
    const bundle = resolveBundle(filePath, source, {
        callerDir: dirOf(filePath),
        generatorRoot: settings.generatorRoot || undefined,
        source: prefetch.source,
    });
    const evaluator = new Evaluator(bundle.main, bundle.extras, {});
    return evaluator.runByName(tableName);
}

// ────────────────────────────────────────────────────────────────────
// Registration helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Register the browser view type and add a command/ribbon icon to
 * open it. Called from main.ts onload.
 */
export function registerBrowserView(plugin: RandomnessPlugin): void {
    plugin.registerView(
        VIEW_TYPE_BROWSER,
        (leaf: WorkspaceLeaf) => new BrowserView(leaf, plugin)
    );

    // Ribbon icon for quick access.
    plugin.addRibbonIcon("dice", "Open Randomness generator browser", () => {
        void activateBrowserView(plugin);
    });

    // Command palette entry, for users who prefer keyboard.
    plugin.addCommand({
        id: "open-generator-browser",
        name: "Open generator browser",
        callback: () => void activateBrowserView(plugin),
    });
}

/**
 * Open the browser view in the right sidebar, or focus it if it's
 * already open. Pattern matches the official sample plugin docs.
 */
async function activateBrowserView(plugin: RandomnessPlugin): Promise<void> {
    const { workspace } = plugin.app;
    // If an instance exists, reveal it rather than spawning a new one.
    const existing = workspace.getLeavesOfType(VIEW_TYPE_BROWSER);
    if (existing.length > 0) {
        workspace.revealLeaf(existing[0]);
        return;
    }
    // Else create one in the right sidebar.
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) {
        new Notice("Randomness: couldn't open the generator browser");
        return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_BROWSER, active: true });
    workspace.revealLeaf(leaf);
}

// ────────────────────────────────────────────────────────────────────
// Local DOM helpers
// ────────────────────────────────────────────────────────────────────

function clearElement(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function el(
    parent: HTMLElement,
    tag: string,
    className?: string
): HTMLElement {
    const e = document.createElement(tag);
    if (className) e.className = className;
    parent.appendChild(e);
    return e;
}

function dirOf(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const i = norm.lastIndexOf("/");
    if (i === -1) return "";
    if (i === 0) return "/";
    return norm.slice(0, i);
}

/**
 * Recursively count all files reachable through a folder. Used by
 * the renderer to show a count badge on collapsed folders so users
 * know how dense the tree is before they open it.
 */
function countFiles(folder: FolderNode): number {
    let n = folder.files.length;
    for (const sub of folder.folders) n += countFiles(sub);
    return n;
}

/**
 * Strip HTML tags from a sanitised string, producing plain text for
 * clipboard paste. Uses the DOM as the parser so entity decoding
 * happens correctly (e.g. `&amp;` becomes `&`).
 *
 * Exported for tests.
 */
export function htmlToPlainText(html: string): string {
    const tmp = document.createElement("div");
    // Safe: input has already been through the sanitiser in the
    // calling code path. Even if not, innerHTML inside a detached
    // div doesn't execute scripts.
    tmp.innerHTML = html;
    return tmp.textContent ?? "";
}

/**
 * Write to the clipboard in both rich (text/html) and plain
 * (text/plain) formats, so that rich-text paste targets like
 * Obsidian's markdown editor (which converts pasted HTML to
 * markdown) receive formatted content, while plain-text targets
 * still get readable text.
 *
 * Why both: Obsidian's editor accepts text/html on paste and
 * converts to markdown automatically — so `<b>X</b>` becomes
 * `**X**`, `<li>` becomes `-`, etc. That conversion is what
 * preserves formatting from a roll across the clipboard
 * boundary. But not every paste target does that conversion;
 * terminals, input fields, and so on want plain text. The
 * Clipboard API's multi-format write lets each target pick.
 *
 * Falls back to writeText(plain) if the multi-format API isn't
 * available — older Electron versions and some testing
 * environments (jsdom) don't ship `clipboard.write` or
 * `ClipboardItem`. Tests stub one or the other to exercise both
 * paths.
 *
 * Exported for tests.
 */
export async function writeRichClipboard(
    html: string,
    plain: string
): Promise<void> {
    // Feature-detect the rich-write path. `ClipboardItem` is the
    // capability that gates dual-format writes; navigator.clipboard
    // is present without it in some environments.
    const supportsRich =
        typeof navigator !== "undefined" &&
        navigator.clipboard !== undefined &&
        typeof (navigator.clipboard as { write?: unknown }).write ===
            "function" &&
        typeof (globalThis as { ClipboardItem?: unknown }).ClipboardItem ===
            "function";

    if (supportsRich) {
        try {
            const Ctor = (globalThis as {
                ClipboardItem: new (items: Record<string, Blob>) => unknown;
            }).ClipboardItem;
            const item = new Ctor({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([plain], { type: "text/plain" }),
            });
            await (
                navigator.clipboard as {
                    write: (items: unknown[]) => Promise<void>;
                }
            ).write([item]);
            return;
        } catch {
            // Fall through to writeText fallback. Some platforms
            // advertise `write` but reject HTML payloads at runtime;
            // we'd rather paste plain than not paste at all.
        }
    }

    // Fallback: plain text only. Better than nothing.
    await navigator.clipboard.writeText(plain);
}

// Suppress unused warnings — TFolder is imported for potential
// future per-folder grouping but not used in this minimum version.
void TFolder;
