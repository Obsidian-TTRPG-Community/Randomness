// Stub for Obsidian API in tests. Only stubs the methods/classes our
// code touches — small enough that TypeScript is happy, behaviour
// stays predictable, and we don't accidentally lean on real Obsidian
// quirks that wouldn't survive the bundler.
//
// Note: Obsidian's `activeDocument` / `activeWindow` globals are
// polyfilled in `jest.setup.ts` (runs before any test module loads),
// not here — view code touches them at module init, which is before
// the obsidian mock evaluates.

export class Plugin {
    app: App;
    manifest: PluginManifest;
    constructor(app: App, manifest: PluginManifest) {
        this.app = app;
        this.manifest = manifest;
    }
    async loadData(): Promise<unknown> {
        return null;
    }
    async saveData(_data: unknown): Promise<void> {}
    async onload(): Promise<void> {}
    async onunload(): Promise<void> {}
    addSettingTab(_tab: PluginSettingTab): void {}
    registerMarkdownCodeBlockProcessor(
        _language: string,
        _handler: (
            source: string,
            el: HTMLElement,
            ctx: MarkdownPostProcessorContext
        ) => void | Promise<void>
    ): void {}
    registerMarkdownPostProcessor(
        _handler: (
            el: HTMLElement,
            ctx: MarkdownPostProcessorContext
        ) => void | Promise<void>
    ): void {}
    registerView(
        _type: string,
        _creator: (leaf: WorkspaceLeaf) => ItemView
    ): void {}
    registerExtensions(_extensions: string[], _viewType: string): void {}
    addCommand(_command: Command): void {}
    addRibbonIcon(
        _icon: string,
        _title: string,
        _cb: (evt: MouseEvent) => void
    ): HTMLElement {
        return document.createElement("div");
    }
    registerEditorSuggest(_suggest: unknown): void {}
}

/**
 * Editor-related types. Minimum surface our code consumes. The
 * real Obsidian Editor wraps CodeMirror 6; the mock just stores a
 * couple of lines and a cursor for tests that need to exercise
 * the autocomplete entry/select flow.
 */
export interface EditorPosition {
    line: number;
    ch: number;
}

/**
 * Editor — abstract in the real Obsidian types. We re-declare
 * the abstract surface; tests should use MockEditor for
 * concrete instantiation.
 */
export abstract class Editor {
    abstract getLine(line: number): string;
    abstract getCursor(): EditorPosition;
    abstract setCursor(pos: EditorPosition): void;
    abstract replaceRange(
        replacement: string,
        from: EditorPosition,
        to: EditorPosition
    ): void;
    abstract lineCount(): number;
}

/**
 * Minimal concrete Editor stub for tests. Stores an array of
 * lines and a cursor position; supports line read, cursor get/
 * set, and single-line replaceRange — enough for the
 * autocomplete's selectSuggestion / onTrigger flows.
 */
export class MockEditor extends Editor {
    private lines: string[];
    private cursor: EditorPosition;
    constructor(lines: string[], cursor: EditorPosition = { line: 0, ch: 0 }) {
        super();
        this.lines = lines.slice();
        this.cursor = { ...cursor };
    }
    getLine(line: number): string {
        return this.lines[line] ?? "";
    }
    getCursor(): EditorPosition {
        return { ...this.cursor };
    }
    setCursor(pos: EditorPosition): void {
        this.cursor = { ...pos };
    }
    replaceRange(
        replacement: string,
        from: EditorPosition,
        to: EditorPosition
    ): void {
        // Support both single-line edits (the inline-insert path)
        // AND multi-line insertions (the auto-add-codeblock path).
        // The strategy is generic: join lines into one string,
        // slice out the [from..to] range by character offset,
        // splice in the replacement, then split back.
        const before = this.lines
            .slice(0, from.line)
            .concat(this.lines[from.line]?.substring(0, from.ch) ?? "")
            .join("\n");
        const afterStart = this.lines[to.line]?.substring(to.ch) ?? "";
        const afterRest = this.lines.slice(to.line + 1);
        const after = [afterStart, ...afterRest].join("\n");
        const merged = before + replacement + after;
        this.lines = merged.split("\n");
    }
    /** Test helper to read the whole document. */
    getValue(): string {
        return this.lines.join("\n");
    }
    /** Number of lines in the document. */
    lineCount(): number {
        return this.lines.length;
    }
}

/**
 * EditorSuggest skeleton. Tests subclass it directly via the
 * real TableAutocomplete class; this provides the constructor
 * + the fields that get inherited (context, limit, app, scope).
 */
export interface EditorSuggestTriggerInfo {
    start: EditorPosition;
    end: EditorPosition;
    query: string;
}

export interface EditorSuggestContext extends EditorSuggestTriggerInfo {
    editor: Editor;
    file: TFile;
}

export abstract class EditorSuggest<T> {
    app: App;
    limit: number = 100;
    context: EditorSuggestContext | null = null;
    constructor(app: App) {
        this.app = app;
    }
    abstract onTrigger(
        cursor: EditorPosition,
        editor: Editor,
        file: TFile | null
    ): EditorSuggestTriggerInfo | null;
    abstract getSuggestions(
        context: EditorSuggestContext
    ): T[] | Promise<T[]>;
    /** No-op in the mock — tests don't exercise the popover. */
    open(): void {}
    close(): void {}
}

export interface App {
    vault: Vault;
    workspace: Workspace;
    metadataCache: MetadataCache;
}

export interface PluginManifest {
    id: string;
    name: string;
    version: string;
}

export interface Command {
    id: string;
    name: string;
    callback?: () => void;
}

export class Vault {
    adapter: DataAdapter = new DataAdapter();
    getAbstractFileByPath(_path: string): TFile | null {
        return null;
    }
    getFiles(): TFile[] {
        return [];
    }
    async read(_file: TFile): Promise<string> {
        return "";
    }
    async process(
        _file: TFile,
        _fn: (data: string) => string
    ): Promise<string> {
        return "";
    }
    async modify(_file: TFile, _data: string): Promise<void> {}
    getResourcePath(file: TFile): string {
        // Mock returns a stable, fake URL. Tests can assert this
        // exact format. Real Obsidian returns app://... URLs.
        return "app://vault/" + (file.path ?? "unknown");
    }
}

/**
 * Metadata cache mock — only the bits our code uses. Real
 * Obsidian's cache is far more elaborate.
 */
export class MetadataCache {
    /**
     * Resolve a wiki link path to a TFile. Mock implementation:
     * tests configure a path→TFile map and the mock looks up there.
     * Returns null on miss (matching real-Obsidian behaviour for
     * unresolved links).
     */
    resolvedLinks: Map<string, TFile> = new Map();
    getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
        return this.resolvedLinks.get(linkpath) ?? null;
    }
}

export class DataAdapter {
    async read(_path: string): Promise<string> {
        return "";
    }
    async exists(_path: string): Promise<boolean> {
        return false;
    }
    async write(_path: string, _data: string): Promise<void> {}
}

export class Workspace {
    getActiveFile(): TFile | null {
        return null;
    }
    getLeavesOfType(_type: string): WorkspaceLeaf[] {
        return [];
    }
    getRightLeaf(_split: boolean): WorkspaceLeaf | null {
        return new WorkspaceLeaf();
    }
    getLeaf(_split: boolean): WorkspaceLeaf {
        return new WorkspaceLeaf();
    }
    revealLeaf(_leaf: WorkspaceLeaf): void {}
    /**
     * Mock for opening a link. Records calls so tests can verify
     * the user's click hit the right path.
     */
    openLinkText(
        _linkText: string,
        _sourcePath: string,
        _newLeaf?: boolean
    ): void {}
}

export class WorkspaceLeaf {
    view: ItemView | null = null;
    async setViewState(_state: { type: string; state?: unknown }): Promise<void> {}
    async openFile(_file: TFile): Promise<void> {}
    getViewState(): { type: string; state?: unknown } {
        return { type: "" };
    }
}

export class ItemView {
    leaf: WorkspaceLeaf;
    containerEl: HTMLElement;
    constructor(leaf: WorkspaceLeaf) {
        this.leaf = leaf;
        this.containerEl =
            typeof document !== "undefined"
                ? document.createElement("div")
                : ({} as HTMLElement);
        // Obsidian's ItemView container has two child divs: header + content.
        // We mimic that minimal structure so consumers can write to
        // containerEl.children[1].
        if (typeof document !== "undefined") {
            const header = document.createElement("div");
            const content = document.createElement("div");
            this.containerEl.appendChild(header);
            this.containerEl.appendChild(content);
        }
    }
    getViewType(): string {
        return "";
    }
    getDisplayText(): string {
        return "";
    }
    async onOpen(): Promise<void> {}
    async onClose(): Promise<void> {}
    addAction(
        _icon: string,
        _title: string,
        _onClick: () => void
    ): HTMLElement {
        return document.createElement("button");
    }
}

export class TextFileView extends ItemView {
    data: string = "";
    file: TFile | null = null;
    getViewData(): string {
        return this.data;
    }
    setViewData(_data: string, _clear: boolean): void {}
    clear(): void {
        this.data = "";
    }
    requestSave(): void {}
}

export class TFile {
    path: string = "";
    name: string = "";
    basename: string = "";
    extension: string = "";
    parent: TFolder | null = null;
}

export class TFolder {
    path: string = "";
    name: string = "";
}

export class Notice {
    constructor(_message: string, _timeout?: number) {}
}

export interface MarkdownPostProcessorContext {
    sourcePath: string;
    docId?: string;
    addChild(child: MarkdownRenderChild): void;
    getSectionInfo(el: HTMLElement): { lineStart: number; lineEnd: number } | null;
}

export class MarkdownRenderChild {
    containerEl: HTMLElement;
    constructor(containerEl: HTMLElement) {
        this.containerEl = containerEl;
    }
    load(): void {}
    unload(): void {}
    onload(): void {}
    onunload(): void {}
}

/**
 * Mock MarkdownRenderer. The real one parses markdown and
 * appends a rich DOM tree; the mock just dumps the source as
 * plain text into the element so tests can assert on
 * containment of expected fragments. Tests that need real
 * rendering should use jsdom + the real renderer, but for our
 * purposes "did the content reach the element" is sufficient.
 */
export class MarkdownRenderer {
    static async render(
        _app: App,
        markdown: string,
        el: HTMLElement,
        _sourcePath: string,
        _component: unknown
    ): Promise<void> {
        // Wrap in a div with a known class so tests can find it.
        const wrap = document.createElement("div");
        wrap.className = "mock-rendered-markdown";
        wrap.textContent = markdown;
        el.appendChild(wrap);
    }
    static async renderMarkdown(
        markdown: string,
        el: HTMLElement,
        sourcePath: string,
        component: unknown
    ): Promise<void> {
        return MarkdownRenderer.render(
            {} as App,
            markdown,
            el,
            sourcePath,
            component
        );
    }
}

export class PluginSettingTab {
    app: App;
    plugin: Plugin;
    containerEl: HTMLElement;
    constructor(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
        this.containerEl =
            typeof document !== "undefined"
                ? document.createElement("div")
                : ({} as HTMLElement);
    }
    display(): void {}
    hide(): void {}
}

export class Setting {
    settingEl: HTMLElement;
    constructor(containerEl: HTMLElement) {
        this.settingEl =
            typeof document !== "undefined"
                ? document.createElement("div")
                : ({} as HTMLElement);
        if (containerEl && typeof containerEl.appendChild === "function") {
            containerEl.appendChild(this.settingEl);
        }
    }
    setName(_name: string): this {
        return this;
    }
    setDesc(_desc: string): this {
        return this;
    }
    addText(cb: (text: TextComponent) => void): this {
        cb(new TextComponent());
        return this;
    }
    addToggle(cb: (toggle: ToggleComponent) => void): this {
        cb(new ToggleComponent());
        return this;
    }
    addDropdown(cb: (dropdown: DropdownComponent) => void): this {
        cb(new DropdownComponent());
        return this;
    }
    addButton(cb: (button: ButtonComponent) => void): this {
        cb(new ButtonComponent());
        return this;
    }
}

/**
 * Minimal ButtonComponent mock. Stores the click handler so tests
 * can invoke it directly.
 */
export class ButtonComponent {
    buttonEl: HTMLButtonElement;
    private clickHandler: (() => void) | null = null;
    constructor() {
        this.buttonEl =
            typeof document !== "undefined"
                ? document.createElement("button")
                : ({} as HTMLButtonElement);
    }
    setButtonText(text: string): this {
        if (this.buttonEl.textContent !== undefined) {
            this.buttonEl.textContent = text;
        }
        return this;
    }
    setCta(): this {
        return this;
    }
    onClick(handler: () => void): this {
        this.clickHandler = handler;
        if (typeof this.buttonEl.addEventListener === "function") {
            this.buttonEl.addEventListener("click", handler);
        }
        return this;
    }
    /** Test helper — fire the stored click handler synchronously. */
    click(): void {
        if (this.clickHandler) this.clickHandler();
    }
}

export class TextComponent {
    setValue(_value: string): this {
        return this;
    }
    setPlaceholder(_placeholder: string): this {
        return this;
    }
    onChange(_cb: (value: string) => void): this {
        return this;
    }
}

export class ToggleComponent {
    setValue(_value: boolean): this {
        return this;
    }
    onChange(_cb: (value: boolean) => void): this {
        return this;
    }
}

export class DropdownComponent {
    addOption(_value: string, _display: string): this {
        return this;
    }
    setValue(_value: string): this {
        return this;
    }
    onChange(_cb: (value: string) => void): this {
        return this;
    }
}

/**
 * Mock normalizePath — Obsidian's real one normalises Unicode and
 * various path edge cases. For tests we approximate: strip leading
 * slashes, collapse repeated slashes, trim whitespace. That's enough
 * to verify our wiring uses it; the real one only matters in
 * production.
 */
export function normalizePath(path: string): string {
    return path
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/")
        .replace(/\/+$/, "");
}

// ─── Portrait-module additions ───
// Minimal stand-ins so modules importing these names load under jest.
export function arrayBufferToBase64(buf: ArrayBuffer): string {
    return Buffer.from(buf).toString("base64");
}
export interface RequestUrlResponse {
    text: string;
    json: unknown;
    arrayBuffer: ArrayBuffer;
}
export async function requestUrl(_opts: {
    url: string;
}): Promise<RequestUrlResponse> {
    throw new Error("requestUrl is not available in tests — stub it per-test");
}
