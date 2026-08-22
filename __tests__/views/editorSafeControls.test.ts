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
 * symptom needs a real editor: they prove the pointer-down events are
 * defaulted-and-stopped and the element is marked non-editable, not
 * that a note stops flickering.
 *
 * That gap bit once. 1.17.1 guarded only the CONTROLS, these tests
 * passed, and users reported no change — because they click the
 * element, not the button inside it. The scope of the guard is the
 * thing to get right here, so it is asserted explicitly below.
 */

import {
    makeEditorSafe,
    installEditorSafeGuard,
    NO_SELECT_CLASS,
} from "../../src/views/editorSafeControls";
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
        expect(btn.classList.contains(NO_SELECT_CLASS)).toBe(true);
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

    test("the RESULT text is guarded too — clicking it must not move the caret", () => {
        // This test used to assert the OPPOSITE, on the theory that
        // leaving the result clickable kept the expression reachable
        // for editing. That theory was wrong, and users said so: they
        // click the element, not the small button inside it, so the
        // caret moved and Live Preview unrendered the roll exactly as
        // before.
        //
        // A CodeMirror harness driven in a real browser settled it —
        // guarding the whole span costs nothing. The keyboard still
        // walks into the span and reveals its source after the same
        // number of presses, and selecting the line still yields the
        // same text either way, because CodeMirror hands you the
        // source of a replaced range regardless.
        const span = render();
        const result = span.querySelector(
            ".randomness-inline-result"
        ) as HTMLElement;
        expect(result).not.toBeNull();
        // The guard sits on the span, so a click anywhere inside it —
        // including on the result — is caught on the way down.
        expect(span.contentEditable).toBe("false");
        expect(fire(result, "mousedown").defaultPrevented).toBe(true);
        expect(fire(result, "pointerdown").defaultPrevented).toBe(true);
    });

    test("the result text stays selectable, so it can still be copied", () => {
        // Reading view has no caret to protect and people copy rolled
        // results out of it. `user-select: none` on the span would
        // take that away for no benefit.
        const span = render();
        expect(span.classList.contains(NO_SELECT_CLASS)).toBe(false);
    });
});

describe("the document-level guard (survives a DOM clone)", () => {
    /** Register the guard on this jsdom document, capturing teardown. */
    function install(): () => void {
        const off: Array<() => void> = [];
        installEditorSafeGuard({
            registerDomEvent: (el, type, cb, options) => {
                el.addEventListener(type, cb, options);
                off.push(() => el.removeEventListener(type, cb, options));
            },
        });
        return () => off.forEach((f) => f());
    }

    test("a CLONE of a guarded element is still protected", () => {
        // cloneNode carries attributes but not listeners, so the
        // per-element guard is gone on a clone. Obsidian is free to
        // copy post-processed DOM into its own widget, and a browser
        // harness confirmed this is the case the element guard cannot
        // cover. The marker is an attribute precisely so this one can.
        const teardown = install();
        try {
            const root = editorLike();
            const original = makeEditorSafe(document.createElement("span"), {
                selectable: true,
            });
            const clone = original.cloneNode(true) as HTMLElement;
            root.appendChild(clone);

            // The clone kept the marker...
            expect(clone.hasAttribute("data-randomness-guard")).toBe(true);
            // ...and the document guard acts on it.
            expect(fire(clone, "mousedown").defaultPrevented).toBe(true);
        } finally {
            teardown();
        }
    });

    test("it acts on a descendant of a guarded element, not just the element", () => {
        const teardown = install();
        try {
            const root = editorLike();
            const span = makeEditorSafe(document.createElement("span"), {
                selectable: true,
            });
            const inner = document.createElement("span");
            span.appendChild(inner);
            root.appendChild(span.cloneNode(true) as HTMLElement);
            const clonedInner = root.querySelector("span span") as HTMLElement;
            expect(fire(clonedInner, "mousedown").defaultPrevented).toBe(true);
        } finally {
            teardown();
        }
    });

    test("it leaves everything else alone", () => {
        const teardown = install();
        try {
            const root = editorLike();
            const plain = document.createElement("span");
            root.appendChild(plain);
            expect(fire(plain, "mousedown").defaultPrevented).toBe(false);
        } finally {
            teardown();
        }
    });
});
