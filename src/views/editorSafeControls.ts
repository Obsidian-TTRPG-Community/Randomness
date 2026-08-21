/**
 * Keeping in-note buttons clickable in Live Preview.
 *
 * Live Preview is a CodeMirror editor with rendered markdown drawn
 * into it. Everything we render into a note — an inline roll's
 * 🎲/🔒/📌, a codeblock's Reroll, a deck's 🎴 — sits inside that
 * editor's contenteditable. So a click on one of our buttons is,
 * as far as the editor is concerned, a click into the document: the
 * caret moves to that position, and Live Preview responds by showing
 * the raw source of whatever the caret landed in. The button still
 * fires, but the user watches their rendered roll turn back into
 * `` `rdm:[@thing]` `` underneath their cursor, every single time.
 *
 * The caret move happens on **mousedown**, not click, and it is the
 * browser's default action on a contenteditable rather than anything
 * the click handler can undo afterwards. Preventing default on the
 * pointer-down events is what stops it; stopping propagation as well
 * keeps CodeMirror's own selection handling from running. Marking the
 * element `contenteditable="false"` tells the browser this island is
 * not a place a caret can go at all — the same trick CodeMirror uses
 * for its own widgets.
 *
 * **Scope: the whole rendered element, not just its buttons.** 1.17.1
 * guarded only the controls, on the theory that leaving the result
 * text clickable kept the expression reachable for editing. Users
 * reported no improvement, and a CodeMirror harness driven in a real
 * browser showed why: people click the element, not the 14-pixel
 * button inside it, and a click on the result text moved the caret
 * exactly as before. The same harness showed the wider guard costs
 * nothing — the keyboard still walks into the span and reveals its
 * source after the same number of presses, and selecting the line
 * still yields the same text, because CodeMirror hands you the source
 * of a replaced range either way.
 *
 * So editing a roll means putting the cursor on it with the keyboard,
 * or clicking just past it — the same way Obsidian's own embeds
 * behave. Clicking it operates it.
 */

/** Pointer events that move a caret before any click handler runs. */
const CARET_EVENTS = ["pointerdown", "mousedown", "touchstart"] as const;

/**
 * Marker attribute for guarded elements.
 *
 * An attribute rather than a class list because it survives
 * `cloneNode`, and a clone is the one case the per-element listeners
 * cannot survive: Obsidian is free to copy post-processed DOM into its
 * own widget, and `cloneNode` carries attributes and inline styles but
 * NOT event listeners. The document-level guard below matches on this,
 * so it keeps working on a clone.
 */
const GUARD_ATTR = "data-randomness-guard";

/**
 * Make an element the editor will not treat as a place to put the
 * cursor. Call it on any control rendered into a note.
 *
 * Returns the element, so it can wrap a construction expression.
 */
export function makeEditorSafe<T extends HTMLElement>(
    el: T,
    opts: { selectable?: boolean } = {}
): T {
    // An island the caret can't enter. CodeMirror marks its own
    // widgets this way; without it the browser will still try to
    // place a cursor inside on a stray drag or a keyboard nav.
    el.contentEditable = "false";
    el.setAttribute(GUARD_ATTR, "");
    // A control is not text, and starting a drag-select on it is never
    // useful. A whole rendered result IS text, though — in Reading
    // view people select and copy it — so `selectable` opts out.
    if (opts.selectable !== true) el.style.userSelect = "none";
    for (const type of CARET_EVENTS) {
        el.addEventListener(
            type,
            (e: Event) => {
                // preventDefault kills the browser's caret placement;
                // stopPropagation keeps CodeMirror's own mousedown
                // handling from re-doing it on the way up.
                e.preventDefault();
                e.stopPropagation();
            },
            // Capture, so this runs before anything the editor has
            // registered on an ancestor in the same phase.
            { capture: true }
        );
    }
    return el;
}

/**
 * The second layer: one set of listeners on the document, matching
 * guarded elements by attribute.
 *
 * Why both. The per-element listeners handle popout windows, which
 * have their own `document` this never sees. The document listeners
 * handle the case the per-element ones cannot — a clone. Neither is
 * redundant, and a browser-driven CodeMirror harness confirmed the
 * split: with the DOM cloned, the element guard fails and this one
 * holds.
 *
 * Registered through `registerDomEvent` so it is torn down with the
 * plugin.
 */
export function installEditorSafeGuard(plugin: {
    registerDomEvent: (
        el: Document,
        type: string,
        cb: (e: Event) => void,
        options?: AddEventListenerOptions
    ) => void;
}): void {
    for (const type of CARET_EVENTS) {
        plugin.registerDomEvent(
            document,
            type,
            (e: Event) => {
                const target = e.target;
                if (!(target instanceof Element)) return;
                if (target.closest(`[${GUARD_ATTR}]`) === null) return;
                e.preventDefault();
                e.stopPropagation();
            },
            // Capture, so this runs before the editor's own handlers
            // wherever they sit in the tree.
            { capture: true }
        );
    }
}
