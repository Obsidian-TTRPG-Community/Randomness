/**
 * Tree construction for the generator browser pane.
 *
 * Takes a flat list of discovered generator files (each with a
 * vault-relative path) and groups them into a folder hierarchy
 * matching the vault's actual folder structure.
 *
 * Kept as a pure function with no DOM or settings access so the
 * shape is easy to reason about and test in isolation. The
 * BrowserView consumes the tree and decides what to render based
 * on which paths the user has expanded.
 */

/** A discovered .ipt file with its parsed tables. */
export interface GenFileInfo {
    /** Vault-relative path, e.g. "Generators/names.ipt". */
    path: string;
    /** Display title — from `Title:` directive or filename. */
    title: string;
    /** Tables in declaration order; first is the entry point. */
    tables: { name: string; isMain: boolean }[];
    /** If the file couldn't be parsed, the error message. */
    error?: string;
}

/** A folder node in the rendered tree. */
export interface FolderNode {
    kind: "folder";
    /** Vault-relative path to this folder. "" for the root. */
    path: string;
    /** Just the folder's own name (last segment of path). For the
     * root this is whatever the caller sets — typically "" or the
     * generator-root name. */
    name: string;
    /** Subfolders, sorted by name. */
    folders: FolderNode[];
    /** Files in this folder, sorted by display title. */
    files: GenFileInfo[];
}

/**
 * Build the folder tree from a flat list of discovered files.
 *
 * Algorithm:
 *   1. For each file, walk its path segments creating folder nodes
 *      as needed (a Map keyed by folder path keeps lookups O(1)).
 *   2. Drop the file into the leaf folder.
 *   3. Sort folders and files at every level for stable display.
 *
 * The returned root is always a single FolderNode. If `rootPath` is
 * non-empty (e.g. "Generators"), only that subtree is returned, with
 * the file paths still being full vault paths. If empty, the root
 * encompasses every file passed in.
 *
 * Files with a path that doesn't sit under `rootPath` are dropped
 * (defensive — the caller usually pre-filters, but it's safer to
 * also enforce here).
 */
export function buildFolderTree(
    files: GenFileInfo[],
    rootPath: string = ""
): FolderNode {
    const normalisedRoot = rootPath.replace(/\/$/, "");
    const root: FolderNode = {
        kind: "folder",
        path: normalisedRoot,
        name: normalisedRoot === "" ? "" : lastSegment(normalisedRoot),
        folders: [],
        files: [],
    };
    // Index folders by their full vault-relative path so the same
    // folder isn't created twice while walking different files'
    // paths. The root is keyed by its own path (possibly "").
    const folderIndex = new Map<string, FolderNode>();
    folderIndex.set(normalisedRoot, root);

    for (const f of files) {
        // Verify the file actually belongs under the root.
        if (normalisedRoot !== "") {
            if (
                f.path !== normalisedRoot &&
                !f.path.startsWith(normalisedRoot + "/")
            ) {
                continue;
            }
        }

        // Path relative to root, so we can split into folder segments
        // that don't include the root's own segments.
        const relativeToRoot =
            normalisedRoot === ""
                ? f.path
                : f.path.slice(normalisedRoot.length + 1);

        // Split into directory parts + filename. e.g.
        //   "Names/people/first.ipt" → dirParts=["Names","people"], file="first.ipt"
        const segs = relativeToRoot.split("/");
        const fileName = segs.pop()!; // we know there's at least the filename
        const dirParts = segs;

        // Walk dirParts, creating intermediate folders as needed.
        let current = root;
        let runningPath = normalisedRoot;
        for (const seg of dirParts) {
            runningPath =
                runningPath === "" ? seg : runningPath + "/" + seg;
            let next = folderIndex.get(runningPath);
            if (!next) {
                next = {
                    kind: "folder",
                    path: runningPath,
                    name: seg,
                    folders: [],
                    files: [],
                };
                folderIndex.set(runningPath, next);
                current.folders.push(next);
            }
            current = next;
        }

        // Reference fileName so noUnusedLocals stays quiet — the
        // actual placement uses f.path, but fileName makes the loop
        // self-documenting.
        void fileName;
        current.files.push(f);
    }

    sortTree(root);
    return root;
}

/**
 * Recursive in-place sort: folders alphabetically by name, files by
 * display title (case-insensitive). Stable order makes the tree
 * predictable across reloads and easier to find things in.
 */
function sortTree(node: FolderNode): void {
    node.folders.sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
    node.files.sort((a, b) =>
        a.title.toLowerCase().localeCompare(b.title.toLowerCase())
    );
    for (const child of node.folders) sortTree(child);
}

function lastSegment(path: string): string {
    const i = path.lastIndexOf("/");
    return i === -1 ? path : path.slice(i + 1);
}

/**
 * Filter the tree by a search needle. Returns a NEW tree containing
 * only branches that have at least one matching file (matches by
 * title, path, or any table name) or matching subfolder.
 *
 * Used when the user types in the filter box: the rendered tree
 * shrinks to just what's relevant, and we auto-expand ancestors of
 * matches via `collectMatchingPaths` below.
 *
 * Returns the original tree unchanged if `needle` is empty.
 */
export function filterTree(
    tree: FolderNode,
    needle: string
): FolderNode {
    const n = needle.trim().toLowerCase();
    if (n === "") return tree;
    return filterFolder(tree, n) ?? emptyClone(tree);
}

function filterFolder(folder: FolderNode, needle: string): FolderNode | null {
    const keptFiles = folder.files.filter((f) => fileMatches(f, needle));
    const keptFolders: FolderNode[] = [];
    for (const sub of folder.folders) {
        const filtered = filterFolder(sub, needle);
        if (filtered !== null) keptFolders.push(filtered);
    }
    // Also include the whole folder if its own name matches — useful
    // when you type a folder name and want to see what's in it.
    const selfMatches = folder.name.toLowerCase().includes(needle);
    if (selfMatches) {
        return {
            kind: "folder",
            path: folder.path,
            name: folder.name,
            folders: folder.folders.map((f) => f), // shallow-copy: show all
            files: folder.files.slice(),
        };
    }
    if (keptFiles.length === 0 && keptFolders.length === 0) return null;
    return {
        kind: "folder",
        path: folder.path,
        name: folder.name,
        folders: keptFolders,
        files: keptFiles,
    };
}

function fileMatches(f: GenFileInfo, needle: string): boolean {
    if (f.title.toLowerCase().includes(needle)) return true;
    if (f.path.toLowerCase().includes(needle)) return true;
    return f.tables.some((t) => t.name.toLowerCase().includes(needle));
}

function emptyClone(tree: FolderNode): FolderNode {
    return {
        kind: "folder",
        path: tree.path,
        name: tree.name,
        folders: [],
        files: [],
    };
}

/**
 * Collect every folder and file path inside a tree. Used when the
 * user is filtering: we expand all ancestors of matches so the
 * results are visible without the user needing to click into them.
 *
 * Doesn't include the root's own path (since the root is always
 * "visible"; we don't draw a chevron for it).
 */
export function collectAllPaths(tree: FolderNode): string[] {
    const out: string[] = [];
    const visit = (node: FolderNode, isRoot: boolean): void => {
        if (!isRoot) out.push(node.path);
        for (const f of node.files) out.push(f.path);
        for (const sub of node.folders) visit(sub, false);
    };
    visit(tree, true);
    return out;
}
