/**
 * Public JavaScript API for Randomness.
 *
 * Exposed at `app.plugins.plugins["randomness"].api` so other
 * plugins, Templater scripts, and DataviewJS can roll tables
 * programmatically without reaching into engine internals or
 * scraping rendered markdown.
 *
 * Design credit: the surface shape (roll / rollExpression /
 * tables / tablesWithSources / onRoll) follows the design
 * proposed by @pjjelly17 in PR #1. This implementation is built
 * directly into core so it composes with the bake-to-static
 * feature, and wires `seed` + `promptValues` through properly
 * (they're real EvaluatorOptions fields, not no-ops).
 *
 * Stability contract: this is a PUBLIC surface. Breaking changes
 * to it bump API_VERSION. Consumers can check `api.version` and
 * branch on it. Adding methods/fields is a minor bump; changing
 * or removing them is a major bump.
 *
 * The API is a thin orchestration layer — no new evaluation
 * logic lives here. It wraps evaluateInlineExpression (rolling),
 * the prefetch+scope+collect pipeline (table discovery in a
 * note's scope), and discoverGenerators (vault-wide discovery).
 */

import { evaluateInlineExpression } from "../views/inlineProcessor";
import { prefetchUseGraph } from "../resolver/asyncPrefetcher";
import { buildInlineBundle } from "../resolver/scope";
import { resolveBundle } from "../resolver/fileResolver";
import { vaultFileSource } from "../views/vaultFileSource";
import { discoverGenerators } from "../views/browserView";
import { collectTablesFromBundle } from "../views/tableAutocomplete";
import { Evaluator } from "../engine/evaluator";
import { dirname } from "../resolver/fileResolver";
import type RandomnessPlugin from "../views/main";

/**
 * Semantic version of the API surface, independent of the plugin
 * version. Bump on any change to the public contract below.
 */
export const API_VERSION = "1.0.0" as const;

/** Options accepted by roll / rollExpression. */
export interface RollOptions {
    /**
     * Note path used to resolve the roll's scope (which `Use:`
     * imports and same-note codeblock tables are visible). When
     * omitted, falls back to the active note, then to "" (no
     * scope — only globally-resolvable tables).
     */
    callerNotePath?: string;
    /**
     * Seed for a deterministic roll. Same seed + same expression
     * + same scope → same result. Wired through to the engine's
     * seedable RNG. Omit for normal (random) behaviour.
     */
    seed?: number;
    /**
     * Override values for prompts in the generator, keyed by
     * prompt label. Prompts without an override use their
     * declared default.
     */
    promptValues?: Record<string, string>;
    /**
     * For dictionary tables (`Type: Dictionary`), the key to look up.
     * Dictionary tables aren't rolled randomly — each entry is named,
     * and a key selects one. With `dictKey` set, `roll(name, ...)`
     * resolves to that entry's value (equivalent to evaluating the
     * IPP3 expression `[#<dictKey> <name>]` directly). Ignored for
     * non-dictionary tables. Without it, calling `roll()` on a
     * dictionary returns an empty result.
     */
    dictKey?: string;
}

/** Result of a single roll attempt (success or failure). */
export interface RollResult {
    /**
     * Rendered output. On failure, an error-marker string
     * (`[ROLL ERROR: ...]`) so consumers that splice this into
     * text see something visible rather than undefined.
     */
    result: string;
    /** Table name as requested (or the raw expression for rollExpression). */
    table: string;
    /** Full expression evaluated (e.g. "[@TableName]"). */
    expression: string;
    /** Note path the roll was scoped to, if any. */
    source?: string;
    /** Set only when this attempt threw; the error message. */
    error?: string;
    /** ISO 8601 timestamp of the attempt. */
    timestamp: string;
    /** Unique ID for this roll, for dedup/history. */
    rollId: string;
}

/** A table plus where it lives, for tablesWithSources. */
export interface TableSource {
    /** Table name. */
    name: string;
    /** Source label (file title, or "(this note)" for in-note tables). */
    source: string;
    /** Vault path of the defining file, "" for in-note tables. */
    filePath: string;
    /** True if reachable from the caller note's current scope. */
    inScope: boolean;
}

/** Listener for the onRoll event stream. */
export type RollEventListener = (result: RollResult) => void;

/** Options for rollUnscoped — superset of RollOptions. */
export interface UnscopedRollOptions {
    /** Seed for a deterministic roll (wired to the engine RNG). */
    seed?: number;
    /** Prompt overrides keyed by prompt label. */
    promptValues?: Record<string, string>;
    /**
     * Disambiguate when multiple files define the same table name:
     * only consider the file at this exact vault path. When
     * omitted, the first file (sorted by path) defining the table
     * wins.
     */
    filePath?: string;
    /**
     * For dictionary tables (`Type: Dictionary`), the key to look up.
     * See `RollOptions.dictKey`. Resolves to the entry equivalent to
     * the IPP3 expression `[#<dictKey> <name>]`.
     */
    dictKey?: string;
}

/** The public API surface. */
export interface RandomnessAPI {
    /** Semantic version of this API surface. */
    readonly version: string;

    /** Roll a named table (wraps it as `[@TableName]`). */
    roll(tableName: string, opts?: RollOptions): Promise<RollResult>;

    /**
     * Roll a named table found ANYWHERE in the vault, ignoring
     * note scope. Searches every `.ipt` file (under the generator
     * root if one is configured) for a table with this name,
     * loads that file plus its `Use:` graph, and rolls it.
     *
     * Use this for scripting/automation where you want to roll a
     * generator without first wiring up a note's `Use:` scope —
     * e.g. a template that generates a note from a shared
     * generator library. If two files define the same table name,
     * the first discovered (sorted by path) wins; pass
     * `opts.filePath` to disambiguate.
     */
    rollUnscoped(
        tableName: string,
        opts?: UnscopedRollOptions
    ): Promise<RollResult>;

    /** Roll an arbitrary expression, e.g. "[@Names] of [@Origin]". */
    rollExpression(
        rawExpr: string,
        opts?: RollOptions
    ): Promise<RollResult>;

    /** List table names visible from a note's scope, deduped + sorted. */
    tables(callerNotePath?: string): Promise<string[]>;

    /**
     * List tables with their sources. In-scope tables first
     * (reachable from the caller note), then out-of-scope tables
     * discovered elsewhere in the vault.
     */
    tablesWithSources(callerNotePath?: string): Promise<TableSource[]>;

    /**
     * Subscribe to every roll attempt (success AND failure).
     * Returns an unsubscribe function.
     */
    onRoll(callback: RollEventListener): () => void;
}

/**
 * Internal marker for passing the originally-requested table name
 * through rollExpression (so the RollResult's `table` field
 * reflects "Names" rather than the wrapped "[@Names]").
 */
const REQUESTED_TABLE = Symbol("requestedTable");
type InternalRollOptions = RollOptions & {
    [REQUESTED_TABLE]?: string;
};

/**
 * Resolve the note path a roll should be scoped to. Priority:
 * explicit option → active note → "" (no scope).
 */
function resolveCallerNotePath(
    plugin: RandomnessPlugin,
    opts?: RollOptions
): string {
    if (opts?.callerNotePath) return opts.callerNotePath;
    const active = plugin.app.workspace.getActiveFile();
    return active?.path ?? "";
}

/** Generate a roll ID. Uses crypto.randomUUID when available. */
function makeRollId(): string {
    const c = window.crypto;
    if (c && typeof c.randomUUID === "function") {
        return c.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID (very
    // old runtimes). Not cryptographically strong, but rollId only
    // needs to be unique-enough for dedup, not unguessable.
    return (
        "rdm-" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 10)
    );
}

/**
 * Construct the public API object for a plugin instance. Called
 * once in the plugin's onload and stored on `plugin.api`.
 */
export function createApi(plugin: RandomnessPlugin): RandomnessAPI {
    // Listener set for onRoll. Lives for the API's lifetime; the
    // plugin drops the whole API on unload, so listeners go with
    // it. Each listener call is isolated — a throwing listener is
    // logged, not allowed to break the emit loop or the roll.
    const listeners = new Set<RollEventListener>();

    const emitRoll = (result: RollResult): void => {
        for (const listener of listeners) {
            try {
                listener(result);
            } catch (error: unknown) {
                console.error("randomness: roll listener threw", error);
            }
        }
    };

    const buildFailureResult = (
        expression: string,
        table: string,
        error: unknown,
        sourcePath: string
    ): RollResult => {
        const message =
            error instanceof Error ? error.message : String(error);
        return {
            result: `[ROLL ERROR: ${message}]`,
            table,
            expression,
            source: sourcePath,
            error: message,
            timestamp: new Date().toISOString(),
            rollId: makeRollId(),
        };
    };

    const rollExpression = async (
        rawExpr: string,
        opts?: RollOptions
    ): Promise<RollResult> => {
        const notePath = resolveCallerNotePath(plugin, opts);
        // The table field reflects the originally-requested name
        // when called via roll(), else the raw expression.
        const table =
            (opts as InternalRollOptions | undefined)?.[
                REQUESTED_TABLE
            ] ?? rawExpr;
        try {
            const resultText = await evaluateInlineExpression(
                rawExpr,
                notePath,
                plugin,
                { seed: opts?.seed, promptValues: opts?.promptValues }
            );
            const result: RollResult = {
                result: resultText,
                table,
                expression: rawExpr,
                source: notePath,
                timestamp: new Date().toISOString(),
                rollId: makeRollId(),
            };
            emitRoll(result);
            return result;
        } catch (error: unknown) {
            // Emit the failure event so subscribers see the full
            // stream, then re-throw so the caller's await rejects.
            // Consumers who prefer non-throwing can catch and read
            // the rejected error, or subscribe via onRoll.
            const failure = buildFailureResult(
                rawExpr,
                table,
                error,
                notePath
            );
            emitRoll(failure);
            throw error;
        }
    };

    const roll = async (
        tableName: string,
        opts?: RollOptions
    ): Promise<RollResult> => {
        // Wrap the bare table name as an expression and tag the
        // original name so the result reflects it. For dictionary
        // tables, a `dictKey` opt selects the entry by name —
        // equivalent to writing `[#"<key>" <Table>]` directly. We
        // emit the quoted form so keys with spaces or punctuation
        // are passed verbatim (the unquoted [#key Table] form
        // whitespace-splits and can't represent multi-word keys).
        // Without dictKey, dictionary tables resolve to empty
        // (they aren't rolled randomly).
        const expr = opts?.dictKey
            ? `[#"${opts.dictKey.replace(/"/g, '\\"')}" ${tableName}]`
            : `[@${tableName}]`;
        const internalOpts: InternalRollOptions = {
            ...opts,
            [REQUESTED_TABLE]: tableName,
        };
        return rollExpression(expr, internalOpts);
    };

    const rollUnscoped = async (
        tableName: string,
        opts?: UnscopedRollOptions
    ): Promise<RollResult> => {
        // For dictionary tables, a `dictKey` opt picks the entry by
        // name (equivalent to the IPP3 `[#"<key>" <Table>]` form).
        // The recorded expression uses the quoted form because that's
        // the syntax that handles arbitrary keys correctly. Without
        // dictKey, dictionary tables roll to empty.
        const expr = opts?.dictKey
            ? `[#"${opts.dictKey.replace(/"/g, '\\"')}" ${tableName}]`
            : `[@${tableName}]`;
        try {
            // 1. Find which .ipt file defines this table. Prefer the
            //    vault index (cached) when available; fall back to a
            //    fresh discoverGenerators scan otherwise. The caller
            //    can pin a specific file with opts.filePath.
            let targetPath: string | null = null;
            if (opts?.filePath) {
                targetPath = opts.filePath;
            } else if (plugin.vaultIndex) {
                await plugin.vaultIndex.prewarm();
                const matches =
                    plugin.vaultIndex.resolveTable(tableName);
                if (matches.length > 0) targetPath = matches[0];
                // Warn (once-ish) when a table name is ambiguous across
                // files. Silently picking the first match by path is how
                // a caller ends up rolling some other generator's table
                // (or hitting its parse error) without knowing why. The
                // chosen file is matches[0]; surface the rest so the
                // caller can disambiguate with opts.filePath.
                if (matches.length > 1) {
                    console.warn(
                        `randomness: rollUnscoped("${tableName}") is ` +
                            `ambiguous — ${matches.length} files define ` +
                            `this table (${matches.join(", ")}). Using ` +
                            `"${matches[0]}". Pass { filePath: "..." } ` +
                            `to choose a specific one.`
                    );
                }
            }
            // Fallback: scan if the index didn't resolve it (e.g. index
            // unavailable in a test harness, or a just-added file the
            // index hasn't picked up).
            if (targetPath === null) {
                const discovered = await discoverGenerators(plugin);
                for (const result of discovered) {
                    if (!result.ok) continue;
                    const { gen } = result;
                    const hasTable = gen.tables.some(
                        (t) =>
                            t.name.toLowerCase() ===
                            tableName.toLowerCase()
                    );
                    if (hasTable) {
                        targetPath = gen.path;
                        break;
                    }
                }
            }
            if (targetPath === null) {
                throw new Error(`Unknown table: ${tableName}`);
            }

            // 2. Read the defining file and prefetch its Use: graph
            //    so master/imported files load. Then resolve the
            //    bundle through the real file resolver, which (unlike
            //    the inline-scope path) parses .ipt top-level Table:
            //    definitions correctly. Both prefetch and resolve get
            //    the index's basename fallback so bare-filename Use:
            //    references resolve.
            const basenameResolver = plugin.vaultIndex
                ? (name: string, callerDir: string) =>
                      plugin.vaultIndex.resolveBasename(name, callerDir)
                : undefined;
            const { vault } = plugin.app;
            const mainSource = await vault.adapter.read(targetPath);
            const asyncSource = vaultFileSource(vault);
            const prefetch = await prefetchUseGraph({
                entryPath: targetPath,
                entrySource: mainSource,
                generatorRoot:
                    plugin.settings.generatorRoot || undefined,
                source: asyncSource,
                basenameResolver,
            });
            const bundle = resolveBundle(targetPath, mainSource, {
                callerDir: dirname(targetPath),
                generatorRoot:
                    plugin.settings.generatorRoot || undefined,
                source: prefetch.source,
                basenameResolver,
            });

            // 3. Roll the table by name. For a dictionary lookup
            //    (opts.dictKey), call runByKey directly — this passes
            //    the user's key literally to the evaluator's dict
            //    lookup, so keys with spaces, hyphens, or other
            //    non-identifier characters work without needing to
            //    round-trip through expression syntax that would
            //    whitespace-split them.
            const evaluator = new Evaluator(
                bundle.main,
                bundle.extras,
                {
                    seed: opts?.seed,
                    promptValues: opts?.promptValues,
                }
            );
            const resultText = opts?.dictKey
                ? evaluator.runByKey(tableName, opts.dictKey)
                : evaluator.runByName(tableName);

            const result: RollResult = {
                result: resultText,
                table: tableName,
                expression: expr,
                source: targetPath,
                timestamp: new Date().toISOString(),
                rollId: makeRollId(),
            };
            emitRoll(result);
            return result;
        } catch (error: unknown) {
            const failure = buildFailureResult(
                expr,
                tableName,
                error,
                opts?.filePath ?? ""
            );
            emitRoll(failure);
            throw error;
        }
    };

    const tablesWithSources = async (
        callerNotePath?: string
    ): Promise<TableSource[]> => {
        const notePath =
            callerNotePath ??
            plugin.app.workspace.getActiveFile()?.path ??
            "";

        // ── In-scope tables (reachable from the caller note) ──
        let inScope: TableSource[] = [];
        if (notePath) {
            try {
                const { vault } = plugin.app;
                let noteSource = "";
                try {
                    noteSource = await vault.adapter.read(notePath);
                } catch {
                    // Note unreadable (e.g. freshly created, not yet
                    // persisted). No in-scope tables; fall through.
                }
                const asyncSource = vaultFileSource(vault);
                const prefetch = await prefetchUseGraph({
                    entryPath: notePath,
                    entrySource: noteSource,
                    generatorRoot:
                        plugin.settings.generatorRoot || undefined,
                    source: asyncSource,
                });
                const bundle = buildInlineBundle("__api__", {
                    notePath,
                    noteSource,
                    source: prefetch.source,
                    generatorRoot:
                        plugin.settings.generatorRoot || undefined,
                });
                inScope = collectTablesFromBundle(
                    bundle.extras,
                    bundle.loadedPaths
                ).map((t) => ({
                    name: t.name,
                    source: t.source,
                    filePath: t.filePath,
                    inScope: true,
                }));
            } catch (error: unknown) {
                // In-scope resolution failed — isolate it so the
                // out-of-scope list still returns. Consumers get a
                // partial-but-useful answer rather than nothing.
                console.warn(
                    "randomness: in-scope table resolution failed",
                    error
                );
            }
        }

        // ── Out-of-scope tables (rest of the vault) ──
        const inScopeKeys = new Set(
            inScope.map((t) => t.name.toLowerCase())
        );
        const outOfScope: TableSource[] = [];
        try {
            const discovered = await discoverGenerators(plugin);
            for (const result of discovered) {
                if (!result.ok) continue;
                const { gen } = result;
                for (let i = 0; i < gen.tables.length; i++) {
                    const t = gen.tables[i];
                    const key = t.name.toLowerCase();
                    if (inScopeKeys.has(key)) continue;
                    outOfScope.push({
                        name: t.name,
                        source: gen.title,
                        filePath: gen.path,
                        inScope: false,
                    });
                }
            }
        } catch (error: unknown) {
            // Vault scan failed — isolate it; return whatever
            // in-scope tables we found.
            console.warn(
                "randomness: vault table discovery failed",
                error
            );
        }

        return [...inScope, ...outOfScope];
    };

    const tables = async (
        callerNotePath?: string
    ): Promise<string[]> => {
        const withSources = await tablesWithSources(callerNotePath);
        // Dedup by lowercased name (in-scope already deduped vs
        // out-of-scope, but two out-of-scope files can share a
        // name), then sort for stable output.
        const seen = new Set<string>();
        const names: string[] = [];
        for (const t of withSources) {
            const key = t.name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            names.push(t.name);
        }
        names.sort((a, b) => a.localeCompare(b));
        return names;
    };

    const onRoll = (callback: RollEventListener): (() => void) => {
        listeners.add(callback);
        return () => {
            listeners.delete(callback);
        };
    };

    return {
        version: API_VERSION,
        roll,
        rollUnscoped,
        rollExpression,
        tables,
        tablesWithSources,
        onRoll,
    };
}
