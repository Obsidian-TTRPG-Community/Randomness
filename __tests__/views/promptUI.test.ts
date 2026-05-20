/**
 * @jest-environment jsdom
 */

/**
 * Tests for promptUI.
 *
 * Two layers:
 *   1. renderPromptControls (DOM-only) — produces the right kind of
 *      control for each prompt and dispatches change events with the
 *      complete new values map.
 *   2. initialPromptValues — seeds the values record from declared
 *      defaults.
 *
 * Codeblock-processor integration (prompts triggering re-render) is
 * covered by views.test.ts in a separate test added to that suite.
 */

import {
    renderPromptControls,
    initialPromptValues,
} from "../../src/views/promptUI";
import type { PromptDecl } from "../../src/engine/ast";

function makeContainer(): HTMLElement {
    const root = document.body;
    while (root.firstChild) root.removeChild(root.firstChild);
    const wrap = document.createElement("div");
    root.appendChild(wrap);
    return wrap;
}

describe("initialPromptValues", () => {
    test("empty list yields empty map", () => {
        expect(initialPromptValues([])).toEqual({});
    });

    test("single prompt seeded with default", () => {
        const p: PromptDecl[] = [
            { label: "Tier", options: ["Easy", "Hard"], defaultValue: "Easy" },
        ];
        expect(initialPromptValues(p)).toEqual({ Tier: "Easy" });
    });

    test("multiple prompts each get their default", () => {
        const p: PromptDecl[] = [
            { label: "A", options: [], defaultValue: "x" },
            { label: "B", options: ["1", "2"], defaultValue: "2" },
        ];
        expect(initialPromptValues(p)).toEqual({ A: "x", B: "2" });
    });
});

describe("renderPromptControls: empty case", () => {
    test("no prompts renders an empty wrapper", () => {
        const c = makeContainer();
        const w = renderPromptControls(c, {
            prompts: [],
            values: {},
            onChange: () => {},
        });
        expect(w.children.length).toBe(0);
        expect(c.querySelector(".randomness-prompts")).not.toBeNull();
    });
});

describe("renderPromptControls: free-text prompts", () => {
    test("renders an input for a no-options prompt", () => {
        const c = makeContainer();
        const prompts: PromptDecl[] = [
            { label: "Name", options: [], defaultValue: "Default" },
        ];
        renderPromptControls(c, {
            prompts,
            values: { Name: "Default" },
            onChange: () => {},
        });
        const input = c.querySelector("input.randomness-prompt-input") as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.value).toBe("Default");
    });

    test("input change event fires onChange with full values map", () => {
        const c = makeContainer();
        const prompts: PromptDecl[] = [
            { label: "Name", options: [], defaultValue: "" },
        ];
        let received: Record<string, string> | null = null;
        renderPromptControls(c, {
            prompts,
            values: { Name: "" },
            onChange: (v) => {
                received = v;
            },
        });
        const input = c.querySelector("input") as HTMLInputElement;
        input.value = "Alice";
        input.dispatchEvent(new Event("change"));
        expect(received).toEqual({ Name: "Alice" });
    });

    test("input does NOT fire on every keystroke", () => {
        const c = makeContainer();
        const prompts: PromptDecl[] = [
            { label: "Name", options: [], defaultValue: "" },
        ];
        let calls = 0;
        renderPromptControls(c, {
            prompts,
            values: { Name: "" },
            onChange: () => {
                calls++;
            },
        });
        const input = c.querySelector("input") as HTMLInputElement;
        // Simulate typing — "input" events, not "change".
        input.value = "a";
        input.dispatchEvent(new Event("input"));
        input.value = "ab";
        input.dispatchEvent(new Event("input"));
        expect(calls).toBe(0);
        // Now the "change" event (e.g. blur).
        input.dispatchEvent(new Event("change"));
        expect(calls).toBe(1);
    });
});

describe("renderPromptControls: dropdown prompts", () => {
    test("renders a select for an options prompt", () => {
        const c = makeContainer();
        const prompts: PromptDecl[] = [
            {
                label: "Tier",
                options: ["Easy", "Normal", "Hard"],
                defaultValue: "Normal",
            },
        ];
        renderPromptControls(c, {
            prompts,
            values: { Tier: "Normal" },
            onChange: () => {},
        });
        const select = c.querySelector("select.randomness-prompt-select") as HTMLSelectElement;
        expect(select).not.toBeNull();
        expect(select.options.length).toBe(3);
        expect(select.value).toBe("Normal");
    });

    test("select change event fires onChange with new value", () => {
        const c = makeContainer();
        const prompts: PromptDecl[] = [
            {
                label: "Tier",
                options: ["Easy", "Hard"],
                defaultValue: "Easy",
            },
        ];
        let received: Record<string, string> | null = null;
        renderPromptControls(c, {
            prompts,
            values: { Tier: "Easy" },
            onChange: (v) => {
                received = v;
            },
        });
        const select = c.querySelector("select") as HTMLSelectElement;
        select.value = "Hard";
        select.dispatchEvent(new Event("change"));
        expect(received).toEqual({ Tier: "Hard" });
    });

    test("preselects the matching option", () => {
        const c = makeContainer();
        const prompts: PromptDecl[] = [
            {
                label: "T",
                options: ["a", "b", "c"],
                defaultValue: "a",
            },
        ];
        renderPromptControls(c, {
            prompts,
            // Caller overrides the default
            values: { T: "c" },
            onChange: () => {},
        });
        const select = c.querySelector("select") as HTMLSelectElement;
        expect(select.value).toBe("c");
    });
});

describe("renderPromptControls: multiple prompts", () => {
    test("changes to one prompt include other prompts' values in onChange", () => {
        const c = makeContainer();
        const prompts: PromptDecl[] = [
            { label: "A", options: [], defaultValue: "alpha" },
            { label: "B", options: [], defaultValue: "beta" },
        ];
        let lastValues: Record<string, string> = {};
        renderPromptControls(c, {
            prompts,
            values: { A: "alpha", B: "beta" },
            onChange: (v) => {
                lastValues = v;
            },
        });
        const inputs = c.querySelectorAll("input");
        // Change A — onChange should include B's unchanged value.
        (inputs[0] as HTMLInputElement).value = "newA";
        inputs[0].dispatchEvent(new Event("change"));
        expect(lastValues).toEqual({ A: "newA", B: "beta" });
        // Change B — onChange should reflect both changes.
        (inputs[1] as HTMLInputElement).value = "newB";
        inputs[1].dispatchEvent(new Event("change"));
        expect(lastValues).toEqual({ A: "newA", B: "newB" });
    });
});

describe("renderPromptControls: labels", () => {
    test("each row has the prompt's label visible", () => {
        const c = makeContainer();
        const prompts: PromptDecl[] = [
            { label: "Character name", options: [], defaultValue: "" },
            { label: "Tier", options: ["Easy", "Hard"], defaultValue: "Easy" },
        ];
        renderPromptControls(c, { prompts, values: {}, onChange: () => {} });
        const labels = c.querySelectorAll(".randomness-prompt-label");
        expect(labels.length).toBe(2);
        expect(labels[0].textContent).toBe("Character name");
        expect(labels[1].textContent).toBe("Tier");
    });
});
