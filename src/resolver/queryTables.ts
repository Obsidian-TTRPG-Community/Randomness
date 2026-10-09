import { GeneratorFile, TableDecl, tableRegistry } from "../engine/ast";
import { EvaluationTableSource, LoadedTables } from "../engine/evaluator";
import { RNG } from "../engine/rng";
import { AsyncFileSource, prefetchUseGraph } from "./asyncPrefetcher";
import { dirname, ResolvedBundle, resolveBundle } from "./fileResolver";
import { extractNoteBlocks, sampleTagFiles, TAG_FILE_CAP, TagRollFilter } from "./mdContent";
import { nativeQueryItems, parseQueryTableSource } from "./nativeQuery";

export interface QueryTableOptions {
    source: AsyncFileSource;
    files: (filter: TagRollFilter) => string[];
    frontmatter: (path: string) => Record<string, unknown> | undefined;
    seed?: number;
    generatorRoot?: string;
    basenameResolver?: (basename: string, callerDir: string) => string | null;
    resolveTableName?: (name: string) => string[] | Promise<string[]>;
}

/** Query rows and note reads belong to one evaluation, never the vault index. */
export function createQueryTableSource(input: ResolvedBundle, opts: QueryTableOptions): EvaluationTableSource {
    const initialNames = [...tableRegistry([input.main, ...input.extras]).keys()];
    const names = new Set(initialNames);
    const loadedPaths = new Set(input.loadedPaths);
    const reads = new Map<string, Promise<string | null>>();
    const candidates = new Map<string, string[]>();
    const blocks = new Map<string, string>();
    const blockPaths = new Map<string, string>();
    let rng: RNG | undefined;
    let queryCount = 0;
    let discoveredCount = 0;
    const source: AsyncFileSource = {
        exists: (path) => opts.source.exists(path),
        read: (path) => {
            let pending = reads.get(path);
            if (!pending) {
                pending = opts.source.read(path);
                reads.set(path, pending);
            }
            return pending;
        },
    };

    async function loadBundle(path: string, content: string): Promise<ResolvedBundle> {
        const prefetch = await prefetchUseGraph({
            entryPath: path, entrySource: content, source,
            generatorRoot: opts.generatorRoot, basenameResolver: opts.basenameResolver,
        });
        const bundle = resolveBundle(path, content, {
            callerDir: dirname(path), source: prefetch.source,
            generatorRoot: opts.generatorRoot, basenameResolver: opts.basenameResolver,
        });
        for (const loaded of bundle.loadedPaths) loadedPaths.add(loaded);
        for (const file of [bundle.main, ...bundle.extras]) {
            for (const table of file.tables) names.add(table.name.toLowerCase());
        }
        return bundle;
    }

    function blockName(path: string): string {
        const cached = blocks.get(path);
        if (cached) return cached;
        let suffix = blocks.size;
        let name = `__queryblock:${suffix}`;
        while (names.has(name)) name = `__queryblock:${++suffix}`;
        names.add(name);
        blocks.set(path, name);
        blockPaths.set(name, path);
        return name;
    }

    async function loadQuery(table: TableDecl): Promise<LoadedTables> {
        const declaration = table.query;
        if (!declaration) throw new Error(`Table '${table.name}' is not a query.`);
        if (++queryCount > 64) throw new Error("QueryTable loading exceeded the 64-query limit.");
        try {
            const query = parseQueryTableSource(declaration.source);
            const key = JSON.stringify({ filter: query.filter, block: query.mode === "block" });
            let paths = candidates.get(key);
            if (!paths) {
                const matches = opts.files(query.filter);
                paths = query.mode === "block"
                    ? sampleTagFiles(matches, TAG_FILE_CAP, rng ??= new RNG(opts.seed))
                    : matches;
                candidates.set(key, paths);
            }
            const { query: unresolved, ...ordinary } = table;
            return {
                table: { ...ordinary, items: nativeQueryItems(query, paths, opts.frontmatter, blockName) },
                files: [],
            };
        } catch (error: unknown) {
            throw new Error(
                `QueryTable '${table.name}' (${declaration.path ?? "generator"}, line ${declaration.line}): ` +
                (error instanceof Error ? error.message : String(error))
            );
        }
    }

    return {
        async load(name, query) {
            if (query) return loadQuery(query);
            const path = blockPaths.get(name.toLowerCase());
            if (path) {
                const content = await source.read(path);
                if (content === null) throw new Error(`Could not read query candidate '${path}'.`);
                const bundle = await loadBundle(path, content);
                const helper: GeneratorFile = {
                    uses: [], topLevelSets: [], prompts: [],
                    tables: [{
                        name, hidden: true, type: "weighted", shuffleTargets: [], inTableSets: [],
                        items: extractNoteBlocks(content).map((rawContent) => ({ weight: 1, rawContent })),
                    }],
                };
                return { files: [helper, bundle.main, ...bundle.extras] };
            }
            const paths = await opts.resolveTableName?.(name.toLowerCase());
            const target = paths?.[0];
            if (!target || loadedPaths.has(target)) return undefined;
            if (++discoveredCount > 64) throw new Error("Table discovery exceeded the 64-file limit.");
            const content = await source.read(target);
            if (content === null) throw new Error(`Could not read table '${name}' from '${target}'.`);
            const bundle = await loadBundle(target, content);
            // Auto-discovery contributes tables, not the defining file's global assignments.
            return {
                files: [{
                    uses: [], topLevelSets: [], prompts: [],
                    tables: [bundle.main, ...bundle.extras].flatMap((file) => file.tables)
                        .filter((table) => !blockPaths.has(table.name.toLowerCase())),
                }],
            };
        },
        clear() {
            reads.clear();
            candidates.clear();
            blocks.clear();
            blockPaths.clear();
            names.clear();
            for (const name of initialNames) names.add(name);
            loadedPaths.clear();
            for (const path of input.loadedPaths) loadedPaths.add(path);
            rng = undefined;
            queryCount = discoveredCount = 0;
        },
    };
}
