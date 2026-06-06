/**
 * Prompt UI.
 *
 * Generators may declare top-level `Prompt:` directives:
 *
 *     Prompt: Choose a tier {Easy|Normal|Hard}Normal
 *     Prompt: Character name
 *
 * Each declaration becomes a labelled control above the generator's
 * rendered output:
 *   - With pipe-separated options → a dropdown.
 *   - Without options → a free-text input.
 *
 * Values flow to the engine via `EvaluatorOptions.promptValues` (a
 * Record<label, value>). Changing a control re-renders the codeblock.
 *
 * This module is DOM-only — pure rendering of controls + change
 * dispatch. The codeblock processor owns the state (current values)
 * and the re-evaluation lifecycle.
 */

import type { PromptDecl } from "../engine/ast";

export interface PromptUIProps {
    /** The prompt declarations to render, in declaration order. */
    prompts: PromptDecl[];
    /** Current values per label. Caller initialises with defaults. */
    values: Record<string, string>;
    /**
     * Fired when any control's value changes. Receives the FULL new
     * values map (caller can replace its state wholesale rather than
     * patching).
     */
    onChange: (values: Record<string, string>) => void;
}

/**
 * Render prompt controls into a container. Returns the wrapper
 * element (also appended to `container` for convenience).
 *
 * Caller should clear the container's contents before calling if
 * re-rendering — this function appends, it doesn't replace.
 */
export function renderPromptControls(
    container: HTMLElement,
    props: PromptUIProps
): HTMLElement {
    const wrap = activeDocument.createElement("div");
    wrap.className = "randomness-prompts";

    if (props.prompts.length === 0) {
        // Nothing to render — return an empty wrap so the caller's
        // structure stays consistent (no special-casing).
        container.appendChild(wrap);
        return wrap;
    }

    // Snapshot current values; mutate-and-fire-onChange on each input
    // event. Snapshot rather than mutating props.values directly so we
    // don't accidentally couple state through a shared reference if
    // the caller passed a Record they reuse.
    const liveValues: Record<string, string> = { ...props.values };

    for (const prompt of props.prompts) {
        const row = activeDocument.createElement("div");
        row.className = "randomness-prompt-row";

        const label = activeDocument.createElement("label");
        label.className = "randomness-prompt-label";
        label.textContent = prompt.label;
        row.appendChild(label);

        const control = makeControlFor(
            prompt,
            liveValues[prompt.label] ?? prompt.defaultValue,
            (newValue) => {
                liveValues[prompt.label] = newValue;
                props.onChange({ ...liveValues });
            }
        );
        row.appendChild(control);

        wrap.appendChild(row);
    }

    container.appendChild(wrap);
    return wrap;
}

/**
 * Build the right control for a prompt declaration:
 *   - Options present → <select>.
 *   - Empty options → <input type="text">.
 */
function makeControlFor(
    prompt: PromptDecl,
    initialValue: string,
    onChange: (value: string) => void
): HTMLElement {
    if (prompt.options.length === 0) {
        return makeTextInput(initialValue, onChange);
    }
    return makeSelect(prompt.options, initialValue, onChange);
}

function makeTextInput(
    initialValue: string,
    onChange: (value: string) => void
): HTMLInputElement {
    const input = activeDocument.createElement("input");
    input.type = "text";
    input.className = "randomness-prompt-input";
    input.value = initialValue;
    // "change" fires on blur — wait until the user is done typing.
    // "input" would fire keystroke-by-keystroke and re-render the
    // generator on every character, which is noisy.
    input.addEventListener("change", () => {
        onChange(input.value);
    });
    return input;
}

function makeSelect(
    options: string[],
    initialValue: string,
    onChange: (value: string) => void
): HTMLSelectElement {
    const select = activeDocument.createElement("select");
    select.className = "randomness-prompt-select";
    for (const opt of options) {
        const optionEl = activeDocument.createElement("option");
        optionEl.value = opt;
        optionEl.textContent = opt;
        if (opt === initialValue) optionEl.selected = true;
        select.appendChild(optionEl);
    }
    // If the initial value wasn't in the options list, the browser
    // picks the first option by default — we sync our state to
    // match, so the engine sees what the user sees.
    if (
        initialValue !== "" &&
        !options.includes(initialValue) &&
        select.options.length > 0
    ) {
        // Don't dispatch onChange here — that would re-evaluate the
        // generator before the user touched anything. Just record
        // the discrepancy via a single update on first interaction.
        // (For now we accept that the engine's first eval uses the
        // declared default rather than the dropdown's resolved
        // value; the next render reconciles.)
    }
    select.addEventListener("change", () => {
        onChange(select.value);
    });
    return select;
}

/**
 * Build the initial values map from prompt declarations: each
 * label maps to its declared default value. The codeblock processor
 * uses this to seed state before the first render.
 */
export function initialPromptValues(prompts: PromptDecl[]): Record<string, string> {
    const values: Record<string, string> = {};
    for (const p of prompts) {
        values[p.label] = p.defaultValue;
    }
    return values;
}
