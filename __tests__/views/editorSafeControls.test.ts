/**
 * @jest-environment jsdom
 */

/**
 * Live Preview: clicking our buttons must press the button and
 * nothing else.
 *
 * The reported symptom was that every click on an inline roll's
 * controls kicked the note back to showing raw source. The cause is
 * that Live Preview is a CodeMirror editor: a mousedown inside it
 * places the caret, and Live Preview then reveals the source of
 * whatever the caret landed in. The click handler runs too late to
 * stop that — the caret has already moved.
 *
 * These tests pin the guard rather than the symptom, because the
 * symptom needs a real editor. What they can prove: the pointer-down
 * events are defaulted-and-stopped, the element is marked
 * non-editable, and — the part most easily lost in a refactor — the
 * RESULT TEXT is deliberately left unguarded so a user can still
 * click into the expression to edit it.
 */

import { makeEditorSafe } from "../../src/views/editorSafeControls";
import { replaceCodeElement } from "../../src/views/inlineProcessor";

/** Dispatch a cancelable, bubbling event and report both outcomes. */
function fire(
    el: Element,
    type: string
): { defaultPrevented: boolean; reachedAncestor: boolean } {
    let reachedAncestor = false;
    const ancestor = el.closest("[data-editor-root]");
    const onAncestor = () => {
        reachedAncestor = true;
    };
    ancestor?.addEventListener(type, onAncestor);
    const e = new Event(type, { bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    ancestor?.removeEventListener(type, onAncestor);
    return { defaultPrevented: e.defaultPrevented, reachedAncestor };
}

/** A stand-in for the CodeMirror contenteditable our spans live in. */
function editorLike(): HTMLElement {
    document.body.innerHTML = "";
    const root = document.createElement("div");
    root.setAttribute("data-editor-root", "");
    root.contentEditable = "true";
    document.body.appendChild(root);
    return root;
}

describe("makeEditorSafe", () => {
    test.each(["pointerdown", "mousedown", "touchstart"])(
        "%s is prevented and never reaches the editor",
        (type) => {
            const root = editorLike();
            const btn = document.createElement("button");
            root.appendChild(btn);
            makeEditorSafe(btn);

            const { defaultPrevented, reachedAncestor } = fire(btn, type);
            // preventDefault stops the browser placing a caret.
            expect(defaultPrevented).toBe(true);
            // stopPropagation stops CodeMirror doing it itself.
            expect(reachedAncestor).toBe(false);
        }
    );

    test("click still gets through — the button must still work", () => {
        const root = editorLike();
        const btn = document.createElement("button");
        root.appendChild(btn);
        makeEditorSafe(btn);

        let clicked = false;
        btn.addEventListener("click", () => {
            clicked = true;
        });
        btn.dispatchEvent(new Event("click", { bubbles: true }));
        expect(clicked).toBe(true);
    });

    test("marks the element as somewhere the caret cannot go", () => {
        const btn = makeEditorSafe(document.createElement("button"));
        expect(btn.contentEditable).toBe("false");
        expect(btn.style.userSelect).toBe("none");
    });

    test("returns the element, so it can wrap a construction", () => {
        const el = document.createElement("span");
        expect(makeEditorSafe(el)).toBe(el);
    });
});

describe("inline span: what is guarded and what is not", () => {
    function render(): HTMLElement {
        const root = editorLike();
        const code = document.createElement("code");
        code.textContent = "rdm:[@T]";
        root.appendChild(code);
        return replaceCodeElement(code, {
            result: "a goblin",
            isLocked: false,
            expr: "[@T]",
            onLock: () => {},
            onBake: () => {},
            onReroll: () => {},
        });
    }

    test("the controls are sealed off from the editor", () => {
        const span = render();
        const controls = span.querySelector(
            ".randomness-inline-controls"
        ) as HTMLElement;
        expect(controls).not.toBeNull();
        expect(controls.contentEditable).toBe("false");
        expect(fire(controls, "mousedown").defaultPrevented).toBe(true);
    });

    test("every control button is inside the guarded container", () => {
        const span = render();
        const controls = span.querySelector(".randomness-inline-controls");
        const buttons = span.querySelectorAll("button");
        expect(buttons.length).toBe(3);
        buttons.forEach((b) => expect(controls?.contains(b)).toBe(true));
    });

    test("the RESULT text is deliberately left clickable", () => {
        // Guarding the result too would seal the expression away
        // entirely: clicking the text is how you get a cursor into
        // the call to edit or delete it. If a future change starts
        // guarding the whole span, this fails and should be argued
        // with rather than deleted.
        const span = render();
        const result = span.querySelector(
            ".randomness-inline-result"
        ) as HTMLElement;
        expect(result).not.toBeNull();
        expect(result.contentEditable).not.toBe("false");
        expect(fire(result, "mousedown").defaultPrevented).toBe(false);
    });
});
