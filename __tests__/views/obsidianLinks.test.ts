/**
 * @jest-environment jsdom
 */

/**
 * Tests for the Obsidian wiki-link interpolation helper.
 *
 * Three surfaces to exercise:
 *
 *   1. Pure parsing — `parseWikiLinkBody`, `pathExtension`,
 *      `isImageEmbed`. No DOM, no plugin.
 *   2. Fragment-level interpolation — given a sanitised fragment
 *      with wiki-syntax in text nodes, the helper splices in the
 *      right `<img>` / `<a>` / unresolved-span at the right
 *      positions.
 *   3. Click behaviour — `[[note]]` links call
 *      `workspace.openLinkText` when clicked, with the
 *      modifier-key convention for new-pane.
 */

import {
    parseWikiLinkBody,
    pathExtension,
    isImageEmbed,
    interpolateObsidianLinks,
    IMAGE_EXTENSIONS,
} from "../../src/views/obsidianLinks";
import { TFile } from "obsidian";

// ────────── parseWikiLinkBody ──────────

describe("parseWikiLinkBody", () => {
    test("plain linkpath", () => {
        expect(parseWikiLinkBody("image.png", true)).toEqual({
            isEmbed: true,
            linkpath: "image.png",
        });
        expect(parseWikiLinkBody("Note", false)).toEqual({
            isEmbed: false,
            linkpath: "Note",
        });
    });

    test("with heading", () => {
        expect(parseWikiLinkBody("Note#Section", false)).toEqual({
            isEmbed: false,
            linkpath: "Note",
            heading: "Section",
        });
    });

    test("with display text", () => {
        expect(parseWikiLinkBody("Note|Display", false)).toEqual({
            isEmbed: false,
            linkpath: "Note",
            display: "Display",
        });
    });

    test("with heading and display", () => {
        // Obsidian's order: path#heading|display
        expect(parseWikiLinkBody("Note#Section|Display", false)).toEqual({
            isEmbed: false,
            linkpath: "Note",
            heading: "Section",
            display: "Display",
        });
    });

    test("embed with width-style display (numeric)", () => {
        const parsed = parseWikiLinkBody("image.png|200", true);
        expect(parsed).toEqual({
            isEmbed: true,
            linkpath: "image.png",
            display: "200",
        });
    });

    test("embed with alt-text display (non-numeric)", () => {
        const parsed = parseWikiLinkBody("image.png|cool image", true);
        expect(parsed).toEqual({
            isEmbed: true,
            linkpath: "image.png",
            display: "cool image",
        });
    });

    test("empty body rejected", () => {
        expect(parseWikiLinkBody("", false)).toBeNull();
    });

    test("body that is only `|display` is rejected (no linkpath)", () => {
        expect(parseWikiLinkBody("|justDisplay", false)).toBeNull();
    });

    test("paths with slashes preserved", () => {
        expect(parseWikiLinkBody("folder/sub/image.png", true)).toEqual({
            isEmbed: true,
            linkpath: "folder/sub/image.png",
        });
    });
});

// ────────── pathExtension ──────────

describe("pathExtension", () => {
    test("typical extensions", () => {
        expect(pathExtension("foo.png")).toBe("png");
        expect(pathExtension("a/b/c.JPG")).toBe("jpg");
        expect(pathExtension("path/with/dots.in.it.svg")).toBe("svg");
    });

    test("no extension yields empty string", () => {
        expect(pathExtension("just-a-name")).toBe("");
        expect(pathExtension("folder/name")).toBe("");
    });

    test("dotfile yields empty (not a file extension)", () => {
        // ".env" is conventionally not "has extension env".
        expect(pathExtension(".env")).toBe("");
    });
});

// ────────── isImageEmbed ──────────

describe("isImageEmbed", () => {
    test("recognises every IMAGE_EXTENSIONS entry", () => {
        for (const ext of IMAGE_EXTENSIONS) {
            expect(
                isImageEmbed({ isEmbed: true, linkpath: "x." + ext })
            ).toBe(true);
        }
    });

    test("case-insensitive", () => {
        expect(
            isImageEmbed({ isEmbed: true, linkpath: "X.PNG" })
        ).toBe(true);
    });

    test("non-image extensions: false", () => {
        expect(
            isImageEmbed({ isEmbed: true, linkpath: "audio.mp3" })
        ).toBe(false);
        expect(
            isImageEmbed({ isEmbed: true, linkpath: "doc.pdf" })
        ).toBe(false);
    });

    test("no extension: false (would be a note embed)", () => {
        expect(
            isImageEmbed({ isEmbed: true, linkpath: "Some Note" })
        ).toBe(false);
    });

    test("plain link (non-embed) always false", () => {
        expect(
            isImageEmbed({ isEmbed: false, linkpath: "x.png" })
        ).toBe(false);
    });
});

// ────────── interpolateObsidianLinks (DOM-level) ──────────

/**
 * Build a fake plugin shape with a mock metadataCache. Tests
 * configure which linkpaths resolve to which TFiles.
 */
function fakePlugin(opts: {
    resolved?: Record<string, string>; // linkpath → TFile path
    openLinkSpy?: jest.Mock;
} = {}) {
    const resolvedMap = new Map<string, InstanceType<typeof TFile>>();
    for (const [linkpath, tfilePath] of Object.entries(opts.resolved ?? {})) {
        const f = new TFile();
        (f as unknown as { path: string }).path = tfilePath;
        resolvedMap.set(linkpath, f);
    }
    return {
        app: {
            vault: {
                getResourcePath(file: { path: string }): string {
                    return "app://vault/" + file.path;
                },
            },
            metadataCache: {
                getFirstLinkpathDest(linkpath: string, _src: string) {
                    return resolvedMap.get(linkpath) ?? null;
                },
            },
            workspace: {
                openLinkText:
                    opts.openLinkSpy ??
                    (() => {
                        /* default no-op */
                    }),
            },
        },
    };
}

/** Wrap a text string in a fresh container for the test. */
function containerWithText(text: string): HTMLElement {
    const container = document.createElement("div");
    container.textContent = text;
    return container;
}

describe("interpolateObsidianLinks: images", () => {
    test("![[image.png]] becomes <img> with resolved src", () => {
        const p = fakePlugin({
            resolved: { "image.png": "Attachments/image.png" },
        });
        const container = containerWithText("Before ![[image.png]] after");
        interpolateObsidianLinks(container, p as any, "note.md");

        const img = container.querySelector("img");
        expect(img).not.toBeNull();
        expect(img!.src).toContain("Attachments/image.png");
        // Surrounding text preserved.
        expect(container.textContent).toContain("Before");
        expect(container.textContent).toContain("after");
    });

    test("![[image.png|200]] sets width", () => {
        const p = fakePlugin({
            resolved: { "image.png": "image.png" },
        });
        const container = containerWithText("![[image.png|200]]");
        interpolateObsidianLinks(container, p as any, "note.md");

        const img = container.querySelector("img") as HTMLImageElement;
        expect(img.width).toBe(200);
        // Non-numeric display would have gone to alt; numeric to width.
        expect(img.alt).toBe(""); // not set to "200"
    });

    test("![[image.png|cool description]] sets alt", () => {
        const p = fakePlugin({
            resolved: { "image.png": "image.png" },
        });
        const container = containerWithText("![[image.png|cool description]]");
        interpolateObsidianLinks(container, p as any, "note.md");

        const img = container.querySelector("img") as HTMLImageElement;
        expect(img.alt).toBe("cool description");
        // width remains zero/default since the display wasn't numeric.
        expect(img.width).toBe(0);
    });

    test("default alt is the linkpath", () => {
        const p = fakePlugin({
            resolved: { "image.png": "image.png" },
        });
        const container = containerWithText("![[image.png]]");
        interpolateObsidianLinks(container, p as any, "note.md");

        const img = container.querySelector("img") as HTMLImageElement;
        expect(img.alt).toBe("image.png");
    });

    test("unresolved image renders as a fallback span", () => {
        const p = fakePlugin({}); // nothing resolves
        const container = containerWithText("![[missing.png]]");
        interpolateObsidianLinks(container, p as any, "note.md");

        expect(container.querySelector("img")).toBeNull();
        const span = container.querySelector(".randomness-unresolved-link");
        expect(span).not.toBeNull();
        expect(span!.textContent).toBe("![[missing.png]]");
    });

    test("non-image embed (![[Note]]) falls back to link", () => {
        // `![[Some Note]]` in Obsidian would embed the note's
        // contents. We don't support note embeds; it falls back
        // to a plain link.
        const p = fakePlugin({
            resolved: { "Some Note": "Some Note.md" },
        });
        const container = containerWithText("![[Some Note]]");
        interpolateObsidianLinks(container, p as any, "note.md");

        // No <img> — the .md isn't an image extension.
        expect(container.querySelector("img")).toBeNull();
        // But a link was created.
        const a = container.querySelector("a");
        expect(a).not.toBeNull();
    });
});

describe("interpolateObsidianLinks: links", () => {
    test("[[Note]] becomes <a> with the link text", () => {
        const p = fakePlugin({
            resolved: { Note: "Note.md" },
        });
        const container = containerWithText("See [[Note]] for details.");
        interpolateObsidianLinks(container, p as any, "current.md");

        const a = container.querySelector("a") as HTMLAnchorElement;
        expect(a).not.toBeNull();
        expect(a.textContent).toBe("Note");
        // data-href carries the link target, matching Obsidian convention.
        expect(a.getAttribute("data-href")).toBe("Note");
        expect(a.classList.contains("internal-link")).toBe(true);
        expect(a.classList.contains("is-unresolved")).toBe(false);
    });

    test("[[Note|Display]] uses the display text", () => {
        const p = fakePlugin({ resolved: { Note: "Note.md" } });
        const container = containerWithText("[[Note|click here]]");
        interpolateObsidianLinks(container, p as any, "current.md");

        const a = container.querySelector("a") as HTMLAnchorElement;
        expect(a.textContent).toBe("click here");
        // data-href still carries the resolved target, not the display.
        expect(a.getAttribute("data-href")).toBe("Note");
    });

    test("[[Note#Heading]] preserves heading in target", () => {
        const p = fakePlugin({ resolved: { Note: "Note.md" } });
        const container = containerWithText("[[Note#Section]]");
        interpolateObsidianLinks(container, p as any, "current.md");

        const a = container.querySelector("a") as HTMLAnchorElement;
        expect(a.getAttribute("data-href")).toBe("Note#Section");
        expect(a.textContent).toBe("Note#Section");
    });

    test("unresolved link gets the is-unresolved CSS class", () => {
        const p = fakePlugin({}); // nothing resolves
        const container = containerWithText("[[Missing]]");
        interpolateObsidianLinks(container, p as any, "current.md");

        const a = container.querySelector("a") as HTMLAnchorElement;
        expect(a).not.toBeNull();
        expect(a.classList.contains("is-unresolved")).toBe(true);
    });

    test("click on link calls openLinkText with sourcePath", () => {
        const spy = jest.fn();
        const p = fakePlugin({
            resolved: { Note: "Note.md" },
            openLinkSpy: spy,
        });
        const container = containerWithText("[[Note]]");
        interpolateObsidianLinks(container, p as any, "current.md");

        const a = container.querySelector("a") as HTMLAnchorElement;
        a.click();
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(
            "Note",
            "current.md",
            false /* newLeaf */
        );
    });

    test("Ctrl+click opens in a new leaf", () => {
        const spy = jest.fn();
        const p = fakePlugin({
            resolved: { Note: "Note.md" },
            openLinkSpy: spy,
        });
        const container = containerWithText("[[Note]]");
        interpolateObsidianLinks(container, p as any, "current.md");

        const a = container.querySelector("a") as HTMLAnchorElement;
        const event = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
        });
        a.dispatchEvent(event);
        expect(spy).toHaveBeenCalledWith(
            "Note",
            "current.md",
            true /* newLeaf */
        );
    });
});

describe("interpolateObsidianLinks: multiple patterns", () => {
    test("multiple wiki-syntax patterns in one text node all replaced", () => {
        const p = fakePlugin({
            resolved: {
                "a.png": "a.png",
                "b.png": "b.png",
                "Note": "Note.md",
            },
        });
        const container = containerWithText(
            "Pic 1: ![[a.png]] Pic 2: ![[b.png]] Link: [[Note]] done"
        );
        interpolateObsidianLinks(container, p as any, "note.md");

        expect(container.querySelectorAll("img").length).toBe(2);
        expect(container.querySelectorAll("a").length).toBe(1);
        // Text fragments preserved.
        expect(container.textContent).toContain("Pic 1:");
        expect(container.textContent).toContain("Pic 2:");
        expect(container.textContent).toContain("done");
    });

    test("text outside wiki-syntax is unchanged", () => {
        const p = fakePlugin({
            resolved: { "image.png": "image.png" },
        });
        const container = containerWithText(
            "Some preamble. ![[image.png]] More text."
        );
        interpolateObsidianLinks(container, p as any, "note.md");

        // The text nodes around the image carry the original strings.
        expect(container.textContent).toContain("Some preamble.");
        expect(container.textContent).toContain("More text.");
    });
});

describe("interpolateObsidianLinks: edge cases", () => {
    test("text with no wiki-syntax is left untouched", () => {
        const p = fakePlugin({});
        const container = containerWithText("Just plain text.");
        const originalHTML = container.innerHTML;
        interpolateObsidianLinks(container, p as any, "note.md");
        expect(container.innerHTML).toBe(originalHTML);
    });

    test("text inside <code> is NOT interpolated", () => {
        // A generator might emit `<code>![[example.png]]</code>` as
        // a literal example. Don't rewrite it.
        const p = fakePlugin({
            resolved: { "example.png": "example.png" },
        });
        const container = document.createElement("div");
        const code = document.createElement("code");
        code.textContent = "![[example.png]]";
        container.appendChild(code);
        interpolateObsidianLinks(container, p as any, "note.md");

        expect(container.querySelector("img")).toBeNull();
        expect(code.textContent).toBe("![[example.png]]");
    });

    test("text inside <pre> is NOT interpolated", () => {
        const p = fakePlugin({
            resolved: { "example.png": "example.png" },
        });
        const container = document.createElement("div");
        const pre = document.createElement("pre");
        pre.textContent = "![[example.png]]";
        container.appendChild(pre);
        interpolateObsidianLinks(container, p as any, "note.md");

        expect(container.querySelector("img")).toBeNull();
    });

    test("interpolation works inside formatting tags (<b>, <em>)", () => {
        // The engine's bold/italic filters wrap output in <b>/<em>.
        // Wiki-syntax inside those tags should still interpolate —
        // a generator might want bold-text-with-image.
        const p = fakePlugin({
            resolved: { "x.png": "x.png" },
        });
        const container = document.createElement("div");
        const b = document.createElement("b");
        b.textContent = "Bold: ![[x.png]]";
        container.appendChild(b);
        interpolateObsidianLinks(container, p as any, "note.md");

        // The image lives inside the <b> now.
        expect(b.querySelector("img")).not.toBeNull();
    });

    test("missing metadataCache method falls back gracefully (no crash)", () => {
        // Defensive: in test environments that don't fully mock
        // Obsidian, the cache might be missing. Should yield
        // unresolved fallback rather than throwing.
        const p = {
            app: {
                vault: { getResourcePath: () => "" },
                workspace: { openLinkText: () => {} },
                // metadataCache absent intentionally
            },
        };
        const container = containerWithText("[[Note]]");
        expect(() =>
            interpolateObsidianLinks(container, p as any, "note.md")
        ).not.toThrow();
        // Should produce an unresolved link.
        const a = container.querySelector("a") as HTMLAnchorElement;
        expect(a).not.toBeNull();
        expect(a.classList.contains("is-unresolved")).toBe(true);
    });

    test("malformed `[[]]` left as literal text", () => {
        const p = fakePlugin({});
        const container = containerWithText("garbage: [[]] still there");
        interpolateObsidianLinks(container, p as any, "note.md");
        expect(container.querySelector("a")).toBeNull();
        expect(container.textContent).toContain("[[]]");
    });

    test("two adjacent embeds (no separating text)", () => {
        const p = fakePlugin({
            resolved: { "a.png": "a.png", "b.png": "b.png" },
        });
        const container = containerWithText("![[a.png]]![[b.png]]");
        interpolateObsidianLinks(container, p as any, "note.md");
        expect(container.querySelectorAll("img").length).toBe(2);
    });
});
