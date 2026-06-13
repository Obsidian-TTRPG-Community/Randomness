/** Tiny shared DOM helpers for the portrait modules. */

import { setIcon } from "obsidian";

export function clearElement(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Mount a composed portrait's SVG markup into a container without
 * `innerHTML` (Obsidian review forbids it). The SVG is our own output
 * from the compositor — parsed via DOMParser and the root <svg>
 * element imported into the live document, so no HTML string ever
 * touches the DOM directly.
 */
export function mountSvg(container: HTMLElement, svg: string): void {
    clearElement(container);
    if (!svg.startsWith("<svg")) return;
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    if (root && root.nodeName.toLowerCase() === "svg") {
        container.appendChild(activeDocument.importNode(root, true));
    }
}

/** Set an element's pixel width via setCssStyles (no direct .style). */
export function setWidthPx(el: HTMLElement, px: number): void {
    el.setCssStyles({ width: `${px}px` });
}

export function makeChildDiv(
    parent: HTMLElement,
    className?: string
): HTMLDivElement {
    const div = activeDocument.createElement("div");
    if (className) div.className = className;
    parent.appendChild(div);
    return div;
}

/**
 * Icon button overlaid on portrait art. `corner` places it; the art
 * container is position:relative (styles.css).
 */
export function overlayIconButton(
    parent: HTMLElement,
    icon: string,
    title: string,
    corner: "top-left" | "top-right" | "bottom-left" | "bottom-right",
    onClick: () => void,
    small = false
): HTMLButtonElement {
    const btn = activeDocument.createElement("button");
    btn.className =
        "randomness-portrait-iconbtn randomness-portrait-iconbtn-" + corner +
        (small ? " randomness-portrait-iconbtn-small" : "");
    setIcon(btn, icon);
    btn.title = title;
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
    });
    parent.appendChild(btn);
    return btn;
}

/** Snippet builders for "copy as…" actions (pure; tested). */
export function portraitBlockSnippet(recipeJson: string): string {
    return "```portrait\nrecipe: " + recipeJson + "\n```";
}

export function portraitInlineSnippet(
    recipeJson: string,
    size?: number
): string {
    const sz = size !== undefined ? `size=${size} ` : "";
    return "`portrait: " + sz + "recipe=" + recipeJson + "`";
}
