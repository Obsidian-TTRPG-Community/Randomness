/**
 * Convert engine output (sanitiser-flavoured HTML) into markdown
 * text suitable for writing to the clipboard as `text/plain`.
 *
 * Why this exists: the result-panel Copy button used to put a
 * `text/html` flavour on the clipboard via `ClipboardItem` and let
 * Obsidian's editor do the HTML→markdown conversion on paste. That
 * works on desktop, where Electron hands the HTML flavour back to
 * the paste handler as a string. On Android it does not: the
 * WebView returns the `text/html` flavour as a *file*
 * (`DataTransferItem.kind === "file"`), Obsidian's paste handler
 * sees a file before it sees any text, and saves it into the
 * attachment folder as `tempNNNN.html` — inserting a link to the
 * attachment instead of the content. Reported by Scaradeus, July
 * 2026, Android tablet, sidebar generator + Copy.
 *
 * Fix: do the conversion ourselves and write plain text only. We're
 * pasting into a markdown editor, so producing markdown directly is
 * both more honest and platform-independent — there is no `text/html`
 * flavour left for any platform to mishandle.
 *
 * Scope: the tag vocabulary here mirrors ALLOWED_TAGS in
 * `sanitiser.ts`. Anything the sanitiser would strip is also
 * stripped here (content preserved where the tag is merely unknown,
 * matching what a reader would expect from a copy button). Tags with
 * no markdown equivalent (`<u>`, `<sub>`, `<mark>`, …) are emitted as
 * literal HTML, which Obsidian renders inline.
 */

/**
 * Inline tags with a symmetric markdown delimiter.
 */
const INLINE_DELIMITERS: Readonly<Record<string, string>> = {
    b: "**",
    strong: "**",
    i: "*",
    em: "*",
    s: "~~",
    strike: "~~",
    del: "~~",
    code: "`",
};

/**
 * Inline tags markdown has no syntax for. Obsidian renders raw
 * inline HTML in reading view, so passing the tag through is a
 * better round-trip than dropping the formatting.
 */
const PASSTHROUGH_TAGS: ReadonlySet<string> = new Set([
    "u",
    "ins",
    "kbd",
    "small",
    "sub",
    "sup",
    "mark",
]);

interface Ctx {
    /** How many lists deep we are; drives list indentation. */
    listDepth: number;
}

/**
 * Convert engine output to markdown.
 *
 * Input is raw engine output: HTML tags plus literal `\n`
 * characters (the engine joins multi-rep results with `\n` and
 * expands `\n` escapes from source content). Unlike the display
 * path we do NOT pre-translate `\n` to `<br>` — in markdown a real
 * newline is already a line break, so the literal characters carry
 * through untouched and `<br>` becomes a newline in the other
 * direction.
 *
 * Degrades to the input string unchanged if the runtime has no
 * DOMParser (non-jsdom Node test environments).
 */
export function htmlToMarkdown(raw: string): string {
    if (typeof DOMParser === "undefined") return raw;
    const normalised = raw.replace(/\r\n?/g, "\n");
    const doc = new DOMParser().parseFromString(
        `<!doctype html><body>${normalised}</body>`,
        "text/html"
    );
    const out = renderChildren(doc.body, { listDepth: 0 });
    return tidy(out);
}

/**
 * Collapse the block-boundary padding that the renderers emit
 * liberally, and trim the ends.
 *
 * Block handlers wrap their output in `\n\n` on both sides so they
 * never run into a neighbour. Two adjacent blocks therefore produce
 * four newlines. Collapsing runs of three or more to exactly two is
 * lossless in rendered markdown — Obsidian treats any run of blank
 * lines as a single paragraph break.
 */
function tidy(s: string): string {
    return s
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function renderChildren(node: Node, ctx: Ctx): string {
    let out = "";
    for (const child of Array.from(node.childNodes)) {
        out += renderNode(child, ctx);
    }
    return out;
}

function renderNode(node: Node, ctx: Ctx): string {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        // Comments, CDATA, processing instructions — drop.
        return "";
    }
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    const delim = INLINE_DELIMITERS[tag];
    if (delim !== undefined) {
        const inner = renderChildren(el, ctx);
        // Empty or whitespace-only emphasis produces `****`, which
        // markdown renders as literal asterisks. Drop the wrapper.
        if (inner.trim() === "") return inner;
        // Delimiters must hug non-whitespace or the emphasis doesn't
        // fire (CommonMark). Push any leading/trailing spaces outside.
        const lead = /^\s*/.exec(inner)?.[0] ?? "";
        const trail = /\s*$/.exec(inner)?.[0] ?? "";
        const core = inner.slice(lead.length, inner.length - trail.length);
        return `${lead}${delim}${core}${delim}${trail}`;
    }

    if (PASSTHROUGH_TAGS.has(tag)) {
        return `<${tag}>${renderChildren(el, ctx)}</${tag}>`;
    }

    switch (tag) {
        case "br":
            return "\n";

        case "span":
            // No semantics of its own — the sanitiser strips its
            // attributes, so it's a pure wrapper.
            return renderChildren(el, ctx);

        case "p":
        case "div":
            return block(renderChildren(el, ctx));

        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6": {
            const level = Number(tag[1]);
            const inner = collapseToOneLine(renderChildren(el, ctx));
            if (inner === "") return "";
            return block(`${"#".repeat(level)} ${inner}`);
        }

        case "hr":
            return block("---");

        case "ul":
        case "ol":
            return renderList(el, tag === "ol", ctx);

        case "li":
            // A stray `<li>` outside any list. Treat it as a bullet
            // rather than losing the content.
            return block(`- ${collapseToOneLine(renderChildren(el, ctx))}`);

        case "blockquote": {
            const inner = tidy(renderChildren(el, ctx));
            if (inner === "") return "";
            const quoted = inner
                .split("\n")
                .map((line) => (line === "" ? ">" : `> ${line}`))
                .join("\n");
            return block(quoted);
        }

        case "pre": {
            // Content of a code block is literal — read textContent
            // rather than recursing, so a nested `<code>` doesn't
            // sprinkle backticks inside the fence.
            const body = (el.textContent ?? "").replace(/\n+$/, "");
            if (body.trim() === "") return "";
            // Use a fence longer than any backtick run in the body so
            // a rolled result containing ``` can't break out.
            const longest = Math.max(
                0,
                ...Array.from(body.matchAll(/`+/g)).map((m) => m[0].length)
            );
            const fence = "`".repeat(Math.max(3, longest + 1));
            return block(`${fence}\n${body}\n${fence}`);
        }

        case "table":
            return renderTable(el, ctx);

        // Table internals reached without a `<table>` ancestor, and
        // any tag the sanitiser would have dropped. Keep the text,
        // lose the structure.
        default:
            return renderChildren(el, ctx);
    }
}

/** Pad a block-level construct so it can't run into its neighbours. */
function block(body: string): string {
    const trimmed = body.trim();
    if (trimmed === "") return "";
    return `\n\n${trimmed}\n\n`;
}

/**
 * Squash any internal line breaks. Used where markdown syntax is
 * strictly single-line — headings, table cells, list markers.
 */
function collapseToOneLine(s: string): string {
    return s.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * Render `<ul>` / `<ol>`.
 *
 * Nested lists come back from `renderChildren` already indented for
 * their own depth, so continuation lines that already start with
 * whitespace are left alone; only genuine wrapped text gets aligned
 * under the marker.
 */
function renderList(el: Element, ordered: boolean, ctx: Ctx): string {
    const items = Array.from(el.children).filter(
        (c) => c.tagName.toLowerCase() === "li"
    );
    if (items.length === 0) return "";
    const indent = "    ".repeat(ctx.listDepth);
    const lines: string[] = [];

    items.forEach((li, i) => {
        const marker = ordered ? `${i + 1}. ` : "- ";
        // Blank lines inside an item are collapsed. Block children
        // (including a nested list) pad themselves with `\n\n`, which
        // inside a list would either split the item off from its
        // marker or make the list loose. Markdown renders a tight
        // list the same way, so collapsing loses nothing.
        const body = renderChildren(li, {
            ...ctx,
            listDepth: ctx.listDepth + 1,
        })
            .replace(/^\n+|\n+$/g, "")
            .replace(/\n{2,}/g, "\n");
        if (body.trim() === "") {
            lines.push(indent + marker.trimEnd());
            return;
        }
        const parts = body.split("\n");
        lines.push(indent + marker + parts[0].trimStart());
        const pad = " ".repeat(marker.length);
        for (const line of parts.slice(1)) {
            if (line.trim() === "") {
                lines.push("");
            } else if (/^\s/.test(line)) {
                // Already-indented output from a nested list.
                lines.push(indent + line);
            } else {
                lines.push(indent + pad + line);
            }
        }
    });

    return `\n\n${lines.join("\n")}\n\n`;
}

/**
 * Render `<table>` as a markdown pipe table.
 *
 * Markdown tables require a header row, so the first row becomes the
 * header whether or not the source used `<thead>`. Ragged rows are
 * padded to the widest row — a short row would otherwise silently
 * shift cells in some renderers.
 */
function renderTable(el: Element, ctx: Ctx): string {
    const rows: string[][] = [];
    for (const tr of Array.from(el.querySelectorAll("tr"))) {
        const cells = Array.from(tr.children).filter((c) =>
            /^t[dh]$/.test(c.tagName.toLowerCase())
        );
        rows.push(
            cells.map((c) =>
                collapseToOneLine(renderChildren(c, ctx)).replace(
                    /\|/g,
                    "\\|"
                )
            )
        );
    }
    if (rows.length === 0) return "";

    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]): string[] => {
        const copy = r.slice();
        while (copy.length < width) copy.push("");
        return copy;
    };
    const line = (cells: string[]): string => `| ${cells.join(" | ")} |`;

    const out = [
        line(pad(rows[0])),
        line(new Array(width).fill("---")),
        ...rows.slice(1).map((r) => line(pad(r))),
    ];
    return `\n\n${out.join("\n")}\n\n`;
}
