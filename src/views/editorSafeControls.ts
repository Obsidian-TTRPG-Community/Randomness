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
 * Deliberately NOT applied to the result text of an inline roll. That
 * would make the expression unreachable: clicking the text is how you
 * put the cursor in it to edit or delete the call. Only the controls
 * are sealed off, so the buttons behave like buttons and the text
 * behaves like text.
 */

/** Pointer events that move a caret before any click handler runs. */
const CARET_EVENTS = ["pointerdown", "mousedown", "touchstart"] as const;

/**
 * Make an element the editor will not treat as a place to put the
 * cursor. Call it on any control rendered into a note.
 *
 * Returns the element, so it can wrap a construction expression.
 */
export function makeEditorSafe<T extends HTMLElement>(el: T): T {
    // An island the caret can't enter. CodeMirror marks its own
    // widgets this way; without it the browser will still try to
    // place a cursor inside on a stray drag or a keyboard nav.
    el.contentEditable = "false";
    // Belt and braces for themes that re-enable selection: a control
    // is not text, and starting a drag-select on it is never useful.
    el.style.userSelect = "none";
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
