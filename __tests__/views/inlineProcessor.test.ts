/**
 * @jest-environment jsdom
 */

/**
 * Tests for the inline rdm: post-processor.
 *
 * What we exercise:
 *   - <code>rdm:expr</code> becomes a randomness-inline span.
 *   - Locked calls show their stored result without evaluation.
 *   - Unfilled calls evaluate and cache the result.
 *   - Subsequent renders use the cache.
 *   - Non-rdm: code spans are left alone.
 *   - Errors render as an inline-error span.
 *
 * We mostly test through buildInlineProcessor's returned function.
 * For the DOM rendering primitives (replaceCodeElement,
 * renderInlineError) we exercise them directly too — they're the
 * smallest testable seam.
 */

import {
    buildInlineProcessor,
    replaceCodeElement,
    renderInlineError,
} from "../../src/views/inlineProcessor";
import {
    DEFAULT_SETTINGS,
    RandomnessSettings,
} from "../../src/views/settings";
import { PreviewRegistry } from "../../src/views/lockingService";

// ────────── Fake plugin / context helpers (mirroring views.test.ts) ──────────

function makeFakeAdapter(files: Record<string, string> = {}) {
    const map = new Map(Object.entries(files));
    return {
        map,
        async read(path: string): Promise<string> {
            const v = map.get(path);
            if (v === undefined) throw new Error(`not found: ${path}`);
            return v;
        },
        async exists(path: string): Promise<boolean> {
            return map.has(path);
        },
    };
}

/** A minimal TFile stand-in. The real `TFile instanceof TFile` check
 * in inlineProcessor.modifyNote relies on the obsidian mock's TFile
 * class being instanceable; we new-up that exported class. */
import { TFile } from "obsidian";

function fakePlugin(opts: {
    files?: Record<string, string>;
    settings?: Partial<RandomnessSettings>;
} = {}) {
    const adapter = makeFakeAdapter(opts.files ?? {});
    // Track vault writes so tests can assert when the write path fires.
    const writeLog: Array<{ path: string; before: string; after: string }> = [];
    const tfileFor = (path: string): InstanceType<typeof TFile> | null => {
        if (!adapter.map.has(path)) return null;
        const f = new TFile();
        // Real TFile has .path, which our mock doesn't set in its
        // constructor — assign it so getAbstractFileByPath's caller
        // can read it back when iterating.
        (f as unknown as { path: string }).path = path;
        return f;
    };
    return {
        app: {
            vault: {
                adapter,
                getAbstractFileByPath: (path: string) => tfileFor(path),
                async read(file: { path: string }): Promise<string> {
                    return adapter.read(file.path);
                },
                async modify(file: { path: string }, data: string): Promise<void> {
                    const before = adapter.map.get(file.path) ?? "";
                    adapter.map.set(file.path, data);
                    writeLog.push({ path: file.path, before, after: data });
                },
                async process(
                    file: { path: string },
                    fn: (data: string) => string
                ): Promise<string> {
                    const before = adapter.map.get(file.path) ?? "";
                    const after = fn(before);
                    if (after !== before) {
                        adapter.map.set(file.path, after);
                        writeLog.push({ path: file.path, before, after });
                    }
                    return after;
                },
            },
            workspace: {},
        },
        settings: { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) } as RandomnessSettings,
        previewRegistry: new PreviewRegistry(),
        writeLog,
    };
}

function fakeCtx(sourcePath: string): any {
    return {
        sourcePath,
        docId: "fake",
        addChild(_c: unknown) {},
        getSectionInfo() {
            return { lineStart: 0, lineEnd: 0, text: "" };
        },
    };
}

/** Build a container with one inline code span. */
function containerWithCode(text: string): HTMLElement {
    const root = document.body;
    // Clear the body so prior tests' code elements don't leak into
    // countPriorOccurrences (which scans the whole document).
    while (root.firstChild) root.removeChild(root.firstChild);
    const wrap = document.createElement("div");
    const code = document.createElement("code");
    code.textContent = text;
    wrap.appendChild(code);
    root.appendChild(wrap);
    return wrap;
}

/**
 * Find the lock or reroll button by aria-label rather than position.
 * Used by the click-handler tests; immune to layout changes (the
 * controls ordering has shifted twice now — left vs right, then
 * reroll-first-vs-lock-first — and the tests should keep working
 * across future tweaks).
 */
function getButton(
    el: ParentNode,
    which: "lock" | "reroll" | "unlock"
): HTMLButtonElement | null {
    const label =
        which === "lock"
            ? "Lock this preview"
            : which === "unlock"
              ? "Unlock (rolls a fresh preview)"
              : "Re-roll";
    return el.querySelector(
        `button[aria-label="${label}"]`
    ) as HTMLButtonElement | null;
}

// ────────── replaceCodeElement ──────────

describe("replaceCodeElement: rendering", () => {
    test("unfilled preview shows result and a lock button", () => {
        const wrap = containerWithCode("rdm:[@X]");
        const codeEl = wrap.querySelector("code")!;
        replaceCodeElement(codeEl, {
            result: "Alice",
            isLocked: false,
            expr: "[@X]",
            onLock: () => {},
            onReroll: () => {},
        });
        // <code> gone, replaced with our span.
        expect(wrap.querySelector("code")).toBeNull();
        const span = wrap.querySelector(".randomness-inline");
        expect(span).not.toBeNull();
        expect(span?.classList.contains("randomness-inline-preview")).toBe(
            true
        );
        expect(span?.classList.contains("randomness-inline-locked")).toBe(
            false
        );
        // Result is visible.
        expect(span?.querySelector(".randomness-inline-result")?.textContent).toBe(
            "Alice"
        );
        // Lock + reroll buttons present.
        const buttons = span!.querySelectorAll("button");
        expect(buttons.length).toBe(2);
    });

    test("locked state has locked class and only a reroll button", () => {
        const wrap = containerWithCode("rdm:[@X]⟹Bob");
        const codeEl = wrap.querySelector("code")!;
        replaceCodeElement(codeEl, {
            result: "Bob",
            isLocked: true,
            expr: "[@X]",
            onLock: () => {},
            onReroll: () => {},
        });
        const span = wrap.querySelector(".randomness-inline")!;
        expect(span.classList.contains("randomness-inline-locked")).toBe(true);
        // Only the reroll button, since lock is hidden for locked content.
        const buttons = span.querySelectorAll("button");
        expect(buttons.length).toBe(1);
    });

    test("lock button fires onLock when clicked, not onReroll", () => {
        const wrap = containerWithCode("rdm:[@X]");
        const codeEl = wrap.querySelector("code")!;
        let lockedFired = 0;
        let rerollFired = 0;
        replaceCodeElement(codeEl, {
            result: "Alice",
            isLocked: false,
            expr: "[@X]",
            onLock: () => {
                lockedFired++;
            },
            onReroll: () => {
                rerollFired++;
            },
        });
        getButton(wrap, "lock")!.click();
        expect(lockedFired).toBe(1);
        expect(rerollFired).toBe(0);
        getButton(wrap, "reroll")!.click();
        expect(lockedFired).toBe(1);
        expect(rerollFired).toBe(1);
    });

    test("hover title on result shows the expression", () => {
        const wrap = containerWithCode("rdm:[@X]");
        const codeEl = wrap.querySelector("code")!;
        replaceCodeElement(codeEl, {
            result: "Alice",
            isLocked: false,
            expr: "[@Tribes with elven]",
            onLock: () => {},
            onReroll: () => {},
        });
        const result = wrap.querySelector(".randomness-inline-result");
        expect((result as HTMLElement).title).toBe("[@Tribes with elven]");
    });

    test("controls render BEFORE the result (left of it in document order)", () => {
        // Layout invariant: result lengths vary on reroll, so controls
        // must be anchored on the side that doesn't grow/shrink. We
        // put them on the left.
        const wrap = containerWithCode("rdm:[@X]");
        const codeEl = wrap.querySelector("code")!;
        replaceCodeElement(codeEl, {
            result: "Bob",
            isLocked: false,
            expr: "[@X]",
            onLock: () => {},
            onReroll: () => {},
        });
        const span = wrap.querySelector(".randomness-inline")!;
        const children = Array.from(span.children);
        const controlsIdx = children.findIndex((c) =>
            c.classList.contains("randomness-inline-controls")
        );
        const resultIdx = children.findIndex((c) =>
            c.classList.contains("randomness-inline-result")
        );
        expect(controlsIdx).toBeGreaterThanOrEqual(0);
        expect(resultIdx).toBeGreaterThanOrEqual(0);
        expect(controlsIdx).toBeLessThan(resultIdx);
    });

    test("reroll button is the first child of controls in both unfilled and locked states", () => {
        // The "don't chase the mouse" guarantee: when an unfilled
        // call's user clicks 🔒, the row flips to locked and the 🔒
        // button disappears. We want 🎲 to stay in the same x-position
        // so the user can keep rerolling without re-aiming. Putting
        // 🎲 first in the controls container ensures this — removing
        // 🔒 from the end doesn't shift 🎲.
        // Unfilled: both buttons present
        const wrap1 = containerWithCode("rdm:[@X]");
        const codeEl1 = wrap1.querySelector("code")!;
        replaceCodeElement(codeEl1, {
            result: "Bob",
            isLocked: false,
            expr: "[@X]",
            onLock: () => {},
            onReroll: () => {},
        });
        const controls1 = wrap1.querySelector(".randomness-inline-controls")!;
        expect((controls1.firstElementChild as HTMLElement).getAttribute("aria-label")).toBe(
            "Re-roll"
        );

        // Locked: only Reroll present — still first child (and only child).
        const wrap2 = containerWithCode("rdm:[@X]⟹Bob");
        const codeEl2 = wrap2.querySelector("code")!;
        replaceCodeElement(codeEl2, {
            result: "Bob",
            isLocked: true,
            expr: "[@X]",
            onLock: () => {},
            onReroll: () => {},
        });
        const controls2 = wrap2.querySelector(".randomness-inline-controls")!;
        // Locked spans wear the unlock icon, in the same first slot.
        expect((controls2.firstElementChild as HTMLElement).getAttribute("aria-label")).toBe(
            "Unlock (rolls a fresh preview)"
        );
    });
});

// ────────── renderInlineError ──────────

describe("renderInlineError", () => {
    test("renders an error span in place of the code element", () => {
        const wrap = containerWithCode("rdm:[@Broken]");
        const codeEl = wrap.querySelector("code")!;
        renderInlineError(codeEl, new Error("oh no"));
        expect(wrap.querySelector("code")).toBeNull();
        const err = wrap.querySelector(".randomness-inline-error");
        expect(err).not.toBeNull();
        expect(err?.textContent).toContain("oh no");
    });

    test("handles non-Error values", () => {
        const wrap = containerWithCode("rdm:[@X]");
        const codeEl = wrap.querySelector("code")!;
        renderInlineError(codeEl, "string error");
        expect(wrap.querySelector(".randomness-inline-error")?.textContent).toContain(
            "string error"
        );
    });
});

// ────────── buildInlineProcessor: full pipeline ──────────

describe("buildInlineProcessor: pipeline", () => {
    test("ignores non-rdm: code spans", async () => {
        const p = fakePlugin();
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithCode("just a normal code span");
        await proc(wrap, fakeCtx("note.md"));
        // Code element should still be there, untouched.
        expect(wrap.querySelector("code")?.textContent).toBe(
            "just a normal code span"
        );
        expect(wrap.querySelector(".randomness-inline")).toBeNull();
    });

    test("locked rdm: displays the stored result without evaluation", async () => {
        const p = fakePlugin();
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithCode("rdm:[@Anything]⟹PrecomputedResult");
        await proc(wrap, fakeCtx("note.md"));
        const span = wrap.querySelector(".randomness-inline-locked");
        expect(span).not.toBeNull();
        expect(span?.querySelector(".randomness-inline-result")?.textContent).toBe(
            "PrecomputedResult"
        );
        // Preview registry should NOT have been touched — locked calls
        // bypass the registry entirely.
        expect(p.previewRegistry.size()).toBe(0);
    });

    test("unfilled rdm: evaluates and caches the result", async () => {
        // Use a same-note codeblock as the table source so we don't
        // need to write a separate Use:'d file.
        const noteSource = [
            "```randomness",
            "Table: T",
            "OnlyOne",
            "```",
            "",
            "Body with `rdm:[@T]`.",
        ].join("\n");
        const p = fakePlugin({
            files: { "note.md": noteSource },
        });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithCode("rdm:[@T]");
        await proc(wrap, fakeCtx("note.md"));
        const span = wrap.querySelector(".randomness-inline-preview");
        expect(span).not.toBeNull();
        expect(span?.querySelector(".randomness-inline-result")?.textContent).toBe(
            "OnlyOne"
        );
        // Result should be in the registry.
        expect(
            p.previewRegistry.get({
                sourcePath: "note.md",
                expr: "[@T]",
                occurrence: 0,
            })
        ).toBe("OnlyOne");
    });

    test("re-rendering a previously-evaluated unfilled call uses the cache", async () => {
        const noteSource = [
            "```randomness",
            "Table: T",
            "Result-{1d100}",
            "```",
            "",
            "`rdm:[@T]`",
        ].join("\n");
        const p = fakePlugin({
            files: { "note.md": noteSource },
        });
        const proc = buildInlineProcessor(p as any);

        // First render — evaluates fresh.
        const wrap1 = containerWithCode("rdm:[@T]");
        await proc(wrap1, fakeCtx("note.md"));
        const firstResult = wrap1.querySelector(
            ".randomness-inline-result"
        )?.textContent;
        expect(firstResult).toMatch(/^Result-/);

        // Second render — same registry, must yield the SAME result
        // even though the underlying table involves a dice roll that
        // would otherwise differ.
        const wrap2 = containerWithCode("rdm:[@T]");
        await proc(wrap2, fakeCtx("note.md"));
        const secondResult = wrap2.querySelector(
            ".randomness-inline-result"
        )?.textContent;
        expect(secondResult).toBe(firstResult);
    });

    test("evaluation error renders an inline error span", async () => {
        const p = fakePlugin({
            files: { "note.md": "" },
        });
        const proc = buildInlineProcessor(p as any);
        // Reference a Use: target that doesn't exist — this propagates
        // a ResolveError through the prefetcher's resolveBundle pass.
        // We simulate it by embedding the Use: in the note source.
        const noteSource = [
            "```randomness",
            "Use:missing-file.ipt",
            "Table: T",
            "x",
            "```",
            "",
            "`rdm:[@T]`",
        ].join("\n");
        p.app.vault.adapter = makeFakeAdapter({ "note.md": noteSource });
        const wrap = containerWithCode("rdm:[@T]");
        await proc(wrap, fakeCtx("note.md"));
        expect(wrap.querySelector(".randomness-inline-error")).not.toBeNull();
    });

    test("inline call to unknown table in a note with no codeblocks renders an error span", async () => {
        // The exact scenario from a user-reported bug: paste
        // `rdm:[@OrcHuntingParty]` into a fresh note that has no
        // `randomness` codeblocks defining or importing the table.
        // The note's scope is empty, so the table can't be resolved.
        //
        // Previously this produced an inline call with all the
        // standard controls (dice/lock icons) but NO result text —
        // the engine returned empty silently for unknown tables. The
        // user saw a half-rendered widget and had no clue what to
        // fix. Now the engine throws, the inline processor catches,
        // and the user sees a labelled error span with the missing
        // table name.
        const p = fakePlugin({
            files: { "note.md": "Just a heading\n\n`rdm:[@OrcHuntingParty]`" },
        });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithCode("rdm:[@OrcHuntingParty]");
        await proc(wrap, fakeCtx("note.md"));
        const errSpan = wrap.querySelector(".randomness-inline-error");
        expect(errSpan).not.toBeNull();
        // Error message should name the missing table so the user
        // knows what to import via Use:.
        expect(errSpan?.textContent).toMatch(/OrcHuntingParty/);
    });

    test("multiple rdm: calls in one render are all processed", async () => {
        const noteSource = [
            "```randomness",
            "Table: T",
            "Result",
            "```",
            "",
            "First `rdm:[@T]` and second `rdm:[@T]`.",
        ].join("\n");
        const p = fakePlugin({
            files: { "note.md": noteSource },
        });
        const proc = buildInlineProcessor(p as any);
        // Build a container with two code spans.
        const root = document.body;
        while (root.firstChild) root.removeChild(root.firstChild);
        const wrap = document.createElement("div");
        for (let i = 0; i < 2; i++) {
            const code = document.createElement("code");
            code.textContent = "rdm:[@T]";
            wrap.appendChild(code);
        }
        root.appendChild(wrap);

        await proc(wrap, fakeCtx("note.md"));
        const spans = wrap.querySelectorAll(".randomness-inline");
        expect(spans.length).toBe(2);
    });
});

// ────────── Click-handler regression tests ──────────

/**
 * Regression suite for the click handlers. These exercise the two
 * bugs reported in real-vault testing:
 *
 *   1. Clicking 🎲 on an unfilled preview did nothing visible —
 *      because the only behaviour was to clear the registry and
 *      then no-op on vault.process, so Obsidian never re-rendered.
 *   2. Clicking 🔒 sometimes wrote the wrong value — because the
 *      result captured at render time was used, even if the user
 *      had since rerolled to a different value.
 *
 * Each fixed behaviour gets a test below. Add to this suite when
 * fixing any future click-handler issue.
 */
describe("inline processor click handlers", () => {
    // A small generator with deterministic output via a seed-stable
    // expression — `[@T]` always returns the only entry "Alpha", so
    // rerolls keep returning "Alpha". For the rerolling-changes-output
    // test we use a generator with multiple entries and seed via
    // randomness — see below.
    const oneEntrySource = [
        "```randomness",
        "Table: T",
        "Alpha",
        "```",
        "",
        "Body with `rdm:[@T]`.",
    ].join("\n");

    test("reroll on unfilled preview updates the cached value (no vault write)", async () => {
        const p = fakePlugin({ files: { "note.md": oneEntrySource } });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithCode("rdm:[@T]");
        await proc(wrap, fakeCtx("note.md"));

        // Pre-condition: span rendered, registry populated, no writes yet.
        const key = { sourcePath: "note.md", expr: "[@T]", occurrence: 0 };
        expect(p.previewRegistry.get(key)).toBe("Alpha");
        expect(p.writeLog.length).toBe(0);

        // Click the reroll button.
        getButton(wrap, "reroll")!.click();
        // Click handler is async; let microtasks settle.
        await new Promise((r) => setTimeout(r, 30));

        // The registry must still have a value (re-populated by the
        // fresh evaluation, not just cleared).
        expect(p.previewRegistry.get(key)).toBeDefined();
        // No vault write should have happened — the source text was
        // already in the right state for an unfilled call.
        expect(p.writeLog.length).toBe(0);
        // The DOM should still show a result (any non-empty text in
        // the result span).
        const resultText = wrap.querySelector(
            ".randomness-inline-result"
        )?.textContent;
        expect(resultText?.length ?? 0).toBeGreaterThan(0);
    });

    test("reroll on unfilled updates the visible result text", async () => {
        // Use a generator with several entries so different rolls give
        // different values. Pick deterministically by varying entries —
        // we count distinct outputs across many rerolls; even one
        // change proves the in-place update path works.
        const manyEntries = [
            "```randomness",
            "Table: T",
            "Alpha",
            "Beta",
            "Gamma",
            "Delta",
            "Epsilon",
            "Zeta",
            "Eta",
            "Theta",
            "```",
            "",
            "Body with `rdm:[@T]`.",
        ].join("\n");
        const p = fakePlugin({ files: { "note.md": manyEntries } });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithCode("rdm:[@T]");
        await proc(wrap, fakeCtx("note.md"));

        const resultEl = wrap.querySelector(
            ".randomness-inline-result"
        ) as HTMLElement;
        const seen = new Set<string>([resultEl.textContent ?? ""]);

        const rerollBtn = getButton(wrap, "reroll")!;
        // Reroll several times; with 8 entries we should see ≥2 distinct
        // values in 20 attempts with overwhelming probability.
        for (let i = 0; i < 20; i++) {
            rerollBtn.click();
            await new Promise((r) => setTimeout(r, 5));
            seen.add(resultEl.textContent ?? "");
        }
        // At least 2 distinct values means the result is actually
        // updating, not stuck on the first preview.
        expect(seen.size).toBeGreaterThan(1);
    });

    test("lock click writes the current registry value, not a stale render-time capture", async () => {
        // The scenario: render the span (registry gets "Alpha"), then
        // the user rerolls (registry gets some other value), then they
        // click Lock. Lock must commit the NEW value, not the stale
        // "Alpha" captured at first render.
        const manyEntries = [
            "```randomness",
            "Table: T",
            "Alpha",
            "Beta",
            "Gamma",
            "Delta",
            "```",
            "",
            "Body with `rdm:[@T]`.",
        ].join("\n");
        const p = fakePlugin({ files: { "note.md": manyEntries } });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithCode("rdm:[@T]");
        await proc(wrap, fakeCtx("note.md"));

        // Reroll enough times that the registry value is very unlikely
        // to still be the original.
        const rerollBtn = getButton(wrap, "reroll")!;
        for (let i = 0; i < 8; i++) {
            rerollBtn.click();
            await new Promise((r) => setTimeout(r, 5));
        }

        const currentlyShown = wrap.querySelector(
            ".randomness-inline-result"
        )?.textContent;
        expect(currentlyShown).toBeTruthy();

        // Now click Lock.
        getButton(wrap, "lock")!.click();
        await new Promise((r) => setTimeout(r, 30));

        // The vault write must contain whatever value the user was
        // looking at when they clicked — i.e. `rdm:[@T]⟹<currentlyShown>`.
        expect(p.writeLog.length).toBe(1);
        const after = p.writeLog[0].after;
        expect(after).toContain(`rdm:[@T]⟹${currentlyShown}`);
    });

    test("reroll on locked call writes vault.process to strip the lock", async () => {
        const noteSource = [
            "```randomness",
            "Table: T",
            "Alpha",
            "```",
            "",
            "Locked: `rdm:[@T]⟹Bob`.",
        ].join("\n");
        const p = fakePlugin({ files: { "note.md": noteSource } });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithCode("rdm:[@T]⟹Bob");
        await proc(wrap, fakeCtx("note.md"));

        // For a locked call there's no Lock button — only Reroll.
        const buttons = wrap.querySelectorAll("button");
        expect(buttons.length).toBe(1);
        getButton(wrap, "unlock")!.click();
        await new Promise((r) => setTimeout(r, 30));

        // Exactly one write, removing the ⟹Bob suffix.
        expect(p.writeLog.length).toBe(1);
        expect(p.writeLog[0].after).toContain("`rdm:[@T]`");
        expect(p.writeLog[0].after).not.toContain("⟹Bob");
    });

    test("evaluation error during reroll renders an inline error span", async () => {
        // Start with a working file, render the span, then make the
        // resolver fail by changing the note source to reference a
        // missing Use:. Reroll triggers a fresh evaluation which
        // throws; the span should swap to an error indicator.
        const p = fakePlugin({
            files: {
                "note.md": [
                    "```randomness",
                    "Table: T",
                    "Alpha",
                    "```",
                    "",
                    "`rdm:[@T]`",
                ].join("\n"),
            },
        });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithCode("rdm:[@T]");
        await proc(wrap, fakeCtx("note.md"));
        // Original render is fine.
        expect(wrap.querySelector(".randomness-inline-error")).toBeNull();

        // Break the file so the next evaluation fails.
        p.app.vault.adapter.map.set(
            "note.md",
            "```randomness\nUse:does-not-exist.ipt\n```\n\n`rdm:[@T]`"
        );

        getButton(wrap, "reroll")!.click();
        await new Promise((r) => setTimeout(r, 30));

        // Error span took the place of the preview span.
        expect(wrap.querySelector(".randomness-inline-error")).not.toBeNull();
    });

    test("inline result renders HTML tags as tags, not literal text (bold filter case)", async () => {
        // The user reported `<b>result</b>` showing as literal text
        // instead of bolding. Engine output contains real HTML when
        // generators use >> bold / >> italic / etc. Without
        // sanitiser routing, the inline processor used textContent
        // which displays the angle brackets as characters.
        const noteSource = [
            "```randomness",
            "Table: T",
            "[@Inner >> bold]",
            "",
            "Table: Inner",
            "value",
            "```",
            "",
            "`rdm:[@T]`",
        ].join("\n");
        const p = fakePlugin({ files: { "note.md": noteSource } });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithCode("rdm:[@T]");
        await proc(wrap, fakeCtx("note.md"));

        const resultEl = wrap.querySelector(
            ".randomness-inline-result"
        ) as HTMLElement;
        // Result span should contain a real <b> element child,
        // not the literal characters "<b>" anywhere.
        expect(resultEl.querySelector("b")).not.toBeNull();
        expect(resultEl.querySelector("b")?.textContent).toBe("value");
        // The textContent flattens to "value" (with no angle brackets).
        expect(resultEl.textContent).toBe("value");
    });

    test("inline reroll preserves HTML rendering across rerolls", async () => {
        // Same invariant for the in-place reroll path: when the user
        // clicks 🎲, the freshly evaluated result must also be
        // sanitised, not dumped via textContent.
        const noteSource = [
            "```randomness",
            "Table: T",
            "[@Inner >> bold]",
            "",
            "Table: Inner",
            "alpha",
            "beta",
            "gamma",
            "```",
            "",
            "`rdm:[@T]`",
        ].join("\n");
        const p = fakePlugin({ files: { "note.md": noteSource } });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithCode("rdm:[@T]");
        await proc(wrap, fakeCtx("note.md"));

        getButton(wrap, "reroll")!.click();
        await new Promise((r) => setTimeout(r, 30));

        const resultEl = wrap.querySelector(
            ".randomness-inline-result"
        ) as HTMLElement;
        // After reroll, the <b> element is still present (sanitiser
        // ran on the fresh result too).
        expect(resultEl.querySelector("b")).not.toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────
// Regression: multiple identical inline calls
//
// Three identical `rdm:[@T]` calls in the same note. The screenshot
// bug: clicking Lock on the BOTTOM call would commit the source
// change at the TOP call's position, because lockCall used
// `findFirstUnfilledOccurrence` which always returned 0 regardless
// of which button was clicked. The fix tracks source-level
// occurrence per rendered call and targets that specific position.
// ────────────────────────────────────────────────────────────────────

/**
 * Build a single block containing N inline `rdm:` code spans, all
 * with the same expression text. This shape matches the demo
 * note's "three identical calls" example that surfaced the bug.
 */
function containerWithMultipleCodes(texts: string[]): HTMLElement {
    const root = document.body;
    while (root.firstChild) root.removeChild(root.firstChild);
    const wrap = document.createElement("div");
    for (const text of texts) {
        const code = document.createElement("code");
        code.textContent = text;
        wrap.appendChild(code);
        // Add a space between calls so they're separate text-flow
        // siblings, like in a real list item.
        wrap.appendChild(document.createTextNode(" "));
    }
    root.appendChild(wrap);
    return wrap;
}

/**
 * fakeCtx() returns getSectionInfo with lineStart=0 / lineEnd=0,
 * which restricts source-position matching to line 0 only. For
 * tests that need to match calls spread across multiple lines, we
 * need a section info covering the whole note.
 */
function fakeCtxFullSection(sourcePath: string, lineCount = 100): any {
    return {
        sourcePath,
        docId: "fake",
        addChild(_c: unknown) {},
        getSectionInfo() {
            return { lineStart: 0, lineEnd: lineCount, text: "" };
        },
    };
}

describe("inlineProcessor: multiple identical calls", () => {
    test("three identical calls each get a distinct preview cache entry", async () => {
        // Bug summary: previously countPriorOccurrences would return 0
        // for every call (because earlier code elements were replaced
        // by spans before being counted), collapsing all three to one
        // preview cache slot. Now each gets its own occurrence-keyed
        // slot.
        const noteSource = [
            "```randomness",
            "Table: T",
            "Alpha",
            "Beta",
            "Gamma",
            "```",
            "",
            "`rdm:[@T]` `rdm:[@T]` `rdm:[@T]`",
        ].join("\n");
        const p = fakePlugin({ files: { "note.md": noteSource } });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithMultipleCodes([
            "rdm:[@T]",
            "rdm:[@T]",
            "rdm:[@T]",
        ]);
        await proc(wrap, fakeCtxFullSection("note.md"));

        // The registry should have three distinct entries — one per
        // occurrence — even though the expression is identical.
        expect(p.previewRegistry.size()).toBe(3);
    });

    test("clicking Lock on the BOTTOM call locks the bottom in source", async () => {
        // The smoking-gun bug regression: user has three identical
        // unfilled calls; clicks the bottom one's Lock; expects the
        // BOTTOM to be locked. Previously the TOP was locked instead.
        const noteSource = [
            "```randomness",
            "Table: T",
            "OnlyValue",
            "```",
            "",
            "`rdm:[@T]` `rdm:[@T]` `rdm:[@T]`",
        ].join("\n");
        const p = fakePlugin({ files: { "note.md": noteSource } });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithMultipleCodes([
            "rdm:[@T]",
            "rdm:[@T]",
            "rdm:[@T]",
        ]);
        await proc(wrap, fakeCtxFullSection("note.md"));

        // Click the LAST (bottom-most) inline span's Lock button.
        const spans = wrap.querySelectorAll(".randomness-inline");
        expect(spans.length).toBe(3);
        const lastSpan = spans[2] as HTMLElement;
        const lockBtn = Array.from(lastSpan.querySelectorAll("button")).find(
            (b) => b.title.toLowerCase().includes("lock")
        ) as HTMLButtonElement;
        expect(lockBtn).toBeTruthy();
        lockBtn.click();
        await new Promise((r) => setTimeout(r, 30));

        // Exactly one write. The source should now contain THREE
        // calls, with only the LAST one locked:
        //   `rdm:[@T]` `rdm:[@T]` `rdm:[@T]⟹OnlyValue`
        expect(p.writeLog.length).toBe(1);
        const after = p.writeLog[0].after;
        // Pattern: two unfilled calls followed by one locked call.
        // The exact value depends on whatever the table produced at
        // occurrence 2 — but the SHAPE is what we're pinning here.
        const match = after.match(
            /`rdm:\[@T\]` `rdm:\[@T\]` `rdm:\[@T\]⟹[^`]+`/
        );
        expect(match).not.toBeNull();
        // And the first two calls must NOT be locked.
        expect(after).not.toMatch(/`rdm:\[@T\]⟹[^`]+` `rdm:\[@T\]`/);
    });

    test("clicking Lock on the MIDDLE call locks only the middle", async () => {
        // Same shape, different target — middle position.
        const noteSource = [
            "```randomness",
            "Table: T",
            "OnlyValue",
            "```",
            "",
            "`rdm:[@T]` `rdm:[@T]` `rdm:[@T]`",
        ].join("\n");
        const p = fakePlugin({ files: { "note.md": noteSource } });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithMultipleCodes([
            "rdm:[@T]",
            "rdm:[@T]",
            "rdm:[@T]",
        ]);
        await proc(wrap, fakeCtxFullSection("note.md"));

        const spans = wrap.querySelectorAll(".randomness-inline");
        const middleSpan = spans[1] as HTMLElement;
        const lockBtn = Array.from(middleSpan.querySelectorAll("button")).find(
            (b) => b.title.toLowerCase().includes("lock")
        ) as HTMLButtonElement;
        lockBtn.click();
        await new Promise((r) => setTimeout(r, 30));

        expect(p.writeLog.length).toBe(1);
        const after = p.writeLog[0].after;
        // Middle locked, first and last unfilled.
        expect(after).toMatch(
            /`rdm:\[@T\]` `rdm:\[@T\]⟹[^`]+` `rdm:\[@T\]`/
        );
    });

    test("clicking Reroll-unlock on the BOTTOM locked call unlocks the bottom", async () => {
        // Same bug shape but on the unlock path: previously
        // findFirstLockedOccurrence always returned 0, so the FIRST
        // locked call would be unlocked regardless of which Reroll
        // button was clicked.
        const noteSource = [
            "```randomness",
            "Table: T",
            "Alpha",
            "```",
            "",
            "`rdm:[@T]⟹A` `rdm:[@T]⟹B` `rdm:[@T]⟹C`",
        ].join("\n");
        const p = fakePlugin({ files: { "note.md": noteSource } });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithMultipleCodes([
            "rdm:[@T]⟹A",
            "rdm:[@T]⟹B",
            "rdm:[@T]⟹C",
        ]);
        await proc(wrap, fakeCtxFullSection("note.md"));

        // Click reroll on the LAST (locked C) span.
        const spans = wrap.querySelectorAll(".randomness-inline");
        const lastSpan = spans[2] as HTMLElement;
        const rerollBtn = Array.from(lastSpan.querySelectorAll("button")).find(
            (b) => b.title.toLowerCase().includes("unlock")
        ) as HTMLButtonElement;
        rerollBtn.click();
        await new Promise((r) => setTimeout(r, 30));

        // The bottom C should be unlocked (back to `rdm:[@T]`).
        // A and B remain locked.
        expect(p.writeLog.length).toBe(1);
        const after = p.writeLog[0].after;
        expect(after).toMatch(
            /`rdm:\[@T\]⟹A` `rdm:\[@T\]⟹B` `rdm:\[@T\]`/
        );
    });

    test("preview values for distinct occurrences are stored separately", async () => {
        // The registry should not collapse identical-expression calls
        // into a single slot. We verify the contract by inspecting
        // sizes.
        const noteSource = [
            "```randomness",
            "Table: T",
            "Alpha",
            "Beta",
            "Gamma",
            "Delta",
            "```",
            "",
            "`rdm:[@T]` `rdm:[@T]`",
        ].join("\n");
        const p = fakePlugin({ files: { "note.md": noteSource } });
        const proc = buildInlineProcessor(p as any);
        const wrap = containerWithMultipleCodes([
            "rdm:[@T]",
            "rdm:[@T]",
        ]);
        await proc(wrap, fakeCtxFullSection("note.md"));

        // Two distinct cache entries — one per occurrence.
        expect(p.previewRegistry.size()).toBe(2);
    });
});
