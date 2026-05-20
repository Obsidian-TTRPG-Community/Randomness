/**
 * HTML sanitiser for engine output.
 *
 * Why this exists: the engine emits HTML by design — bold/italic/
 * underline filters emit `<b>` / `<i>` / `<u>`, and `.ipt` corpora
 * often use `<br>`, `<ul>`, `<li>` for structure. We want that to
 * render. But a malicious `.ipt` could include `<script>` or
 * `<iframe>` or an `onerror` attribute on an `<img>` tag, and
 * setting `innerHTML` would execute it.
 *
 * Approach: parse the engine's output with the platform's
 * `DOMParser`, walk the tree, drop any element whose tag isn't in
 * our whitelist, strip ALL attributes (the corpus doesn't use any,
 * so an empty attribute whitelist costs nothing), and serialise
 * back. Text nodes survive untouched.
 *
 * Whitelist derived from real corpus usage:
 *   - Inline: b, i, u, em, strong, br, span
 *   - Block: p, div, ul, ol, li, hr, blockquote
 *   - Heading: h1-h6 (rare in generators but harmless)
 *
 * Everything else is dropped, INCLUDING its content. That's
 * stricter than "unwrap and keep children" — we go with strict
 * because the typical attack vector is `<script>...stuff...</script>`,
 * and we'd rather drop the stuff entirely than risk a parser
 * disagreement letting payload through.
 *
 * Trade-off note: if a generator emits an unrecognised tag (say,
 * `<dl>`), its content is lost. That's the documented contract; we
 * can grow the whitelist if real corpora need it. Better to fail
 * visibly than to silently allow harm.
 */

import { interpolateObsidianLinks } from "./obsidianLinks";

/**
 * Tags allowed in sanitised output. All lowercase; the sanitiser
 * normalises tag names before lookup. Tag names not in this set
 * have their entire subtree dropped.
 */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
    // Inline formatting
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "strike",
    "del",
    "ins",
    "code",
    "kbd",
    "small",
    "sub",
    "sup",
    "mark",
    "br",
    "span",
    // Block structure
    "p",
    "div",
    "ul",
    "ol",
    "li",
    "hr",
    "blockquote",
    "pre",
    // Headings
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    // Tables — sometimes used by generators
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
]);

/**
 * Tags where we drop the element but PRESERVE its text content
 * unwrapped. Used for the root node and any neutral wrappers we
 * don't want to surface but where dropping the text would lose
 * legitimate content.
 *
 * Currently unused — listed for future flexibility. Keep here so
 * the policy is one-stop-shop.
 */
// const UNWRAP_TAGS: ReadonlySet<string> = new Set([]);

/**
 * Sanitise an HTML string into a DocumentFragment that can be
 * appended to any element with `.appendChild`. Caller is expected
 * to attach the fragment to the DOM; returning a fragment (vs a
 * string) avoids a round-trip through innerHTML on the consumer
 * side, which would re-introduce the risk we just removed.
 *
 * If the runtime has no DOMParser (e.g. a non-jsdom Node test
 * environment), the function returns a fragment containing the
 * raw input as a text node — a safe degradation. Production
 * runtime (Obsidian / jsdom) always has it.
 */
export function sanitiseHtmlToFragment(html: string): DocumentFragment {
    const doc = document.implementation.createHTMLDocument("");
    // Use the document's own parser via innerHTML on a detached
    // element. The detachment matters: a freshly-created element
    // not attached to any document won't fire `load` events for
    // `<img>` or `<script>`, even if those tags survive in the
    // parsed tree (which they don't, but defence in depth is
    // free here).
    const sandbox = doc.createElement("template");
    sandbox.innerHTML = html;
    const sourceRoot = (sandbox as HTMLTemplateElement).content;

    const fragment = document.createDocumentFragment();
    for (const child of Array.from(sourceRoot.childNodes)) {
        const cleaned = cleanNode(child);
        if (cleaned !== null) fragment.appendChild(cleaned);
    }
    return fragment;
}

/**
 * Convenience wrapper: sanitise into an existing target element,
 * replacing its current contents. Caller doesn't need to manage
 * the fragment.
 *
 * Treats the input as ENGINE OUTPUT (not arbitrary HTML): newline
 * characters in the input are converted to `<br>` tags before
 * parsing. The engine emits literal `\n` characters from `\n`
 * escapes in source content, and joins multi-rep results with
 * `\n`. Browsers' HTML parsers collapse whitespace (including
 * newlines) into single spaces unless they're inside `<pre>`. So
 * without this translation, all multi-line engine output would
 * render as one flowed paragraph — the bug reported by users
 * pasting multi-roll altar tables and seeing five altars merge
 * into one wall of text.
 */
export function setSanitisedHtml(target: HTMLElement, html: string): void {
    while (target.firstChild) target.removeChild(target.firstChild);
    target.appendChild(sanitiseHtmlToFragment(engineOutputToHtml(html)));
}

/**
 * Like `setSanitisedHtml`, but ALSO interpolates Obsidian wiki-
 * syntax (`![[image.png]]`, `[[note]]`) into actual `<img>` and
 * `<a>` elements after sanitisation.
 *
 * The interpolation happens POST-sanitiser because:
 *
 *   - The sanitiser strips all attributes from every tag. Letting
 *     `<img src=…>` flow through as HTML would lose the `src` and
 *     give a broken image.
 *   - Wiki-syntax (`![[…]]`, `[[…]]`) has no HTML angle brackets,
 *     so it survives sanitisation as plain text. After sanitising,
 *     we walk the fragment, find the patterns in text nodes, and
 *     splice in freshly-constructed elements with attributes set
 *     programmatically from vault-resolved values. The constructed
 *     elements never pass through the sanitiser, so their
 *     attributes are preserved.
 *
 * Caller provides `plugin` (for vault/workspace access) and
 * `sourcePath` (for relative-link resolution and as the `from`
 * argument to `openLinkText`).
 */
export function setSanitisedHtmlWithLinks(
    target: HTMLElement,
    html: string,
    plugin: import("./main").default,
    sourcePath: string
): void {
    while (target.firstChild) target.removeChild(target.firstChild);
    const fragment = sanitiseHtmlToFragment(engineOutputToHtml(html));
    interpolateObsidianLinks(fragment, plugin, sourcePath);
    target.appendChild(fragment);
}

/**
 * Translate raw engine output (which uses literal `\n` characters
 * for line breaks) into HTML-ready output where line breaks
 * survive the browser's whitespace-collapsing HTML parser.
 *
 * The translation is: every `\n` becomes `<br>`. We don't try to
 * be clever about consecutive newlines or paragraph breaks —
 * `<br><br>` works fine in browsers and converts cleanly to
 * a paragraph break in Obsidian's HTML-to-markdown converter on
 * paste. Smarter heuristics (e.g. "two `\n`s = `<p>`") would risk
 * breaking corpora that use single `\n` for paragraph-like
 * spacing.
 *
 * `\r\n` (Windows line endings, occasionally seen in IPP3 corpora
 * authored on Windows) is normalised first so we don't emit
 * `<br>\r<br>` which would round-trip as a literal CR character.
 *
 * Exported because the result-panel copy uses it to put HTML on
 * the clipboard — Obsidian's editor receives that HTML and
 * converts to markdown, so the `<br>`s become real markdown line
 * breaks instead of getting collapsed by the HTML parser before
 * Obsidian sees them.
 */
export function engineOutputToHtml(raw: string): string {
    return raw.replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
}

/**
 * Walk a single node and produce a cleaned clone. Returns null if
 * the node should be dropped entirely (and its children with it).
 *
 * Non-recursive form would be tidier but the trees are tiny (a
 * generator's output is typically a few hundred nodes max), so a
 * direct recursion is fine.
 */
function cleanNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
        // Text content carried through verbatim. Note: textContent
        // here is the *parsed* form, with HTML entities already
        // decoded, which is what we want.
        return document.createTextNode(node.textContent ?? "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        // Comments, CDATA, processing instructions — drop entirely.
        return null;
    }
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
        // Disallowed tag: drop the element AND its content. The
        // typical case is `<script>...</script>`; dropping the
        // content is the safe move.
        return null;
    }
    // Allowed: build a fresh element in OUR document (not the
    // sandbox doc), copy nothing but the children. ALL attributes
    // are dropped — see top-of-file rationale.
    const clean = document.createElement(tag);
    for (const child of Array.from(el.childNodes)) {
        const cleanedChild = cleanNode(child);
        if (cleanedChild !== null) clean.appendChild(cleanedChild);
    }
    return clean;
}
