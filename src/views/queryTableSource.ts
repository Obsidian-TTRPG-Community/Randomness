import { EvaluationTableSource } from "../engine/evaluator";
import { ResolvedBundle } from "../resolver/fileResolver";
import { createQueryTableSource } from "../resolver/queryTables";
import type RandomnessPlugin from "./main";
import { makeLinkAwareBasenameResolver, makeTagFilesLookup, makeTagFrontmatterLookup, vaultFileSource } from "./vaultFileSource";

export function createVaultTableSource(
    plugin: RandomnessPlugin,
    bundle: ResolvedBundle,
    seed?: number
): EvaluationTableSource {
    return createQueryTableSource(bundle, {
        source: vaultFileSource(plugin.app.vault),
        files: makeTagFilesLookup(plugin, { strict: true }),
        frontmatter: makeTagFrontmatterLookup(plugin, { strict: true }),
        seed,
        generatorRoot: plugin.settings.generatorRoot || undefined,
        basenameResolver: makeLinkAwareBasenameResolver(plugin),
        resolveTableName: plugin.vaultIndex ? async (name) => {
            await plugin.vaultIndex.prewarm();
            return plugin.vaultIndex.resolveTable(name);
        } : undefined,
    });
}
