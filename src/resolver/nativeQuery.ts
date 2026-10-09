import { TableItem } from "../engine/ast";
import {
    BLOCKS_PREFIX,
    DirectTagCall,
    noteBaseName,
    parseDirectTagCall,
    renderPropTemplate,
} from "./mdContent";

export function parseQueryTableSource(source: string): DirectTagCall {
    const query = parseDirectTagCall(source);
    if (!query) throw new Error("Expected a native tag, folder, or property query.");
    const filters = source.split(/\|prop:/i)[0];
    if (/\{\$[^}]*\}/.test(filters)) {
        throw new Error("QueryTable filters cannot contain RDM variable interpolation.");
    }
    return query;
}

export function nativeQueryItems(
    query: DirectTagCall,
    files: string[],
    frontmatter?: (path: string) => Record<string, unknown> | undefined,
    blockTableName: (path: string) => string = (path) =>
        BLOCKS_PREFIX + noteBaseName(path).toLowerCase()
): TableItem[] {
    if (query.mode === "prop" && !frontmatter) {
        throw new Error(`Property rolls (${query.label}) need the vault's metadata cache, which isn't available in this context.`);
    }
    return files.map((path) => {
        let rawContent: string;
        if (query.mode === "prop") {
            if (query.template === undefined || frontmatter === undefined) {
                throw new Error("Property query is missing its template or metadata provider.");
            }
            rawContent = renderPropTemplate(query.template, path, frontmatter(path));
        } else if (query.mode === "link" || query.mode === "linkpath") {
            const target = path.replace(/\.md$/i, "");
            rawContent = query.mode === "linkpath"
                ? `[[${target}]]`
                : `[[${target}|${noteBaseName(path)}]]`;
        } else {
            rawContent = `[@${blockTableName(path)}]`;
        }
        return { weight: 1, rawContent };
    });
}
