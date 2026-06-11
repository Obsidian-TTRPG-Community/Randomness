/**
 * Inline portrait spans: `portrait: …` inside any rendered markdown
 * (including callouts — the ITS-infobox use case) becomes a single
 * portrait image with size control and hover controls:
 *
 *   - reroll (bottom-left): new random face — shown only on unpinned
 *     spans (no seed, no recipe); purely visual until you lock.
 *   - lock / unlock (top-right): lock rewrites the span in the note to
 *     `portrait: … recipe={…}` (drift-proof, set in stone); unlock
 *     strips the recipe and rolls fresh.
 *   - PNG (top-left): saves the image next to the note and REPLACES
 *     the span with `![[file.png]]`.
 *
 * Syntax (tokens after the colon, whitespace/comma separated):
 *   `portrait:`                       random portrait, default size
 *   `portrait: gandalf`               bare word = seed (stable)
 *   `portrait: gandalf 160`           bare number = size in px
 *   `portrait: seed=gandalf size=96 pack=other_pack`
 *   `portrait: recipe={…}`            pinned recipe — recipe= must be
 *                                     the LAST token (consumes the rest
 *                                     of the span, JSON may contain
 *                                     spaces)
 *
 * Note rewrites locate the span by its exact original text (first
 * occurrence). Two byte-identical unpinned spans in one note are
 * indistinguishable — the first gets the rewrite; rendering is
 * per-span random either way. Documented trade-off, same spirit as
 * the rdm: lock-what-you-see rules.
 */

import { MarkdownPostProcessorContext, Notice, TFile } from "obsidian";
import type RandomnessPlugin from "../views/main";
import { composePack, composeFromRecipe, Composed, PortraitRecipe } from "./pack";
import { saveComposedPng } from "./png";
import { overlayIconButton } from "./ui";

export interface InlinePortraitParams {
    pack: string;
    seed?: string;
    size: number;
    recipe?: string;
}

export const INLINE_DEFAULT_SIZE = 128;

/**
 * Parse the text of a `portrait: …` code span. Returns null when the
 * span isn't a portrait call. Pure — tested directly.
 */
export function parseInlinePortrait(
    text: string,
    defaultPack: string
): InlinePortraitParams | null {
    const m = /^portrait:\s*([\s\S]*)$/.exec(text.trim());
    if (!m) return null;
    const p: InlinePortraitParams = {
        pack: defaultPack,
        size: INLINE_DEFAULT_SIZE,
    };
    let rest = m[1].trim();

    // recipe= consumes everything after it (JSON can contain spaces).
    const r = /(?:^|[\s,])recipe=([\s\S]+)$/.exec(rest);
    if (r) {
        p.recipe = r[1].trim();
        rest = rest.slice(0, r.index).trim();
    }

    for (const tok of rest.split(/[\s,]+/)) {
        if (tok === "") continue;
        const eq = tok.indexOf("=");
        if (eq > 0) {
            const key = tok.slice(0, eq).toLowerCase();
            const val = tok.slice(eq + 1);
            if (key === "seed" && val !== "") p.seed = val;
            else if (key === "pack" && val !== "")
                p.pack = val.replace(/^\/+|\/+$/g, "");
            else if (key === "size") {
                const n = parseInt(val, 10);
                if (!isNaN(n)) p.size = Math.max(32, Math.min(1024, n));
            }
        } else if (/^\d+$/.test(tok)) {
            p.size = Math.max(32, Math.min(1024, parseInt(tok, 10)));
        } else {
            p.seed = tok;
        }
    }
    return p;
}

/** Non-default params as span tokens (pack/size only). Pure helper. */
function carriedTokens(
    params: InlinePortraitParams,
    defaultPack: string
): string {
    const toks: string[] = [];
    if (params.pack !== defaultPack) toks.push(`pack=${params.pack}`);
    if (params.size !== INLINE_DEFAULT_SIZE) toks.push(`size=${params.size}`);
    return toks.length ? " " + toks.join(" ") : "";
}

/** Locked form of a span: keep pack/size, drop seed, append recipe. */
export function lockedInlineText(
    original: string,
    defaultPack: string,
    recipeJson: string
): string {
    const params = parseInlinePortrait(original, defaultPack);
    const carried = params ? carriedTokens(params, defaultPack) : "";
    return `portrait:${carried} recipe=${recipeJson}`;
}

/** Unlocked form: keep pack/size, drop recipe and seed (fresh rolls). */
export function unlockedInlineText(
    original: string,
    defaultPack: string
): string {
    const params = parseInlinePortrait(original, defaultPack);
    const carried = params ? carriedTokens(params, defaultPack) : "";
    return `portrait:${carried}`;
}

/** Post-processor: replace `portrait: …` code spans with portraits. */
export function buildPortraitInlineProcessor(plugin: RandomnessPlugin) {
    return function process(
        el: HTMLElement,
        ctx: MarkdownPostProcessorContext
    ): void {
        const codeNodes = Array.from(el.querySelectorAll("code"));
        for (const code of codeNodes) {
            const original = code.textContent ?? "";
            const params = parseInlinePortrait(
                original,
                plugin.settings.portraitPackPath
            );
            if (!params) continue;

            const span = activeDocument.createElement("span");
            span.className = "randomness-portrait-inline";
            span.style.width = `${params.size}px`;
            span.textContent = "…";
            code.replaceWith(span);

            void renderInlineSpan(plugin, ctx, span, original, params);
        }
    };
}

/**
 * Replace the first occurrence of the original span (with backticks)
 * in the note. `replacement` is raw note text (caller adds backticks
 * for span forms, or passes an embed for the PNG case).
 */
async function rewriteSpanInNote(
    plugin: RandomnessPlugin,
    sourcePath: string,
    original: string,
    replacement: string
): Promise<boolean> {
    const af = plugin.app.vault.getAbstractFileByPath(sourcePath);
    if (!(af instanceof TFile)) {
        new Notice("Portrait: couldn't locate this note.");
        return false;
    }
    const needle = "`" + original + "`";
    let found = false;
    await plugin.app.vault.process(af, (data) => {
        const i = data.indexOf(needle);
        if (i === -1) return data;
        found = true;
        return data.slice(0, i) + replacement + data.slice(i + needle.length);
    });
    if (!found) {
        new Notice("Portrait: span not found — note changed, action skipped.");
    }
    return found;
}

async function renderInlineSpan(
    plugin: RandomnessPlugin,
    ctx: MarkdownPostProcessorContext,
    span: HTMLElement,
    original: string,
    params: InlinePortraitParams
): Promise<void> {
    try {
        if (!(await plugin.portraits.available(params.pack))) {
            span.textContent = "⚠ portrait pack not found";
            span.classList.add("randomness-portrait-hint");
            return;
        }
        const manifest = await plugin.portraits.manifest(params.pack);
        const load = plugin.portraits.loader(params.pack);
        const pinned = params.recipe !== undefined;

        // `current` tracks the latest roll so lock/PNG act on exactly
        // what's on screen, including after rerolls.
        let current: Composed;

        const compose = async (): Promise<Composed> =>
            pinned
                ? composeFromRecipe(
                      JSON.parse(params.recipe as string) as PortraitRecipe,
                      manifest,
                      load
                  )
                : composePack(manifest, load, params.seed);

        const draw = (composed: Composed): void => {
            while (span.firstChild) span.removeChild(span.firstChild);
            if (composed.svg.startsWith("<svg")) {
                span.innerHTML = composed.svg;
            }
            span.setAttribute("aria-label", `portrait ${composed.seed}`);

            // PNG, top-left: save next to the note, replace the span
            // with the embed.
            overlayIconButton(
                span,
                "image-down",
                "Save as PNG next to the note and replace this span with the image embed",
                "top-left",
                () => {
                    void (async () => {
                        try {
                            const dir = dirOf(ctx.sourcePath);
                            const path = await saveComposedPng(
                                plugin,
                                current,
                                dir
                            );
                            const name = path.split("/").pop() ?? path;
                            const ok = await rewriteSpanInNote(
                                plugin,
                                ctx.sourcePath,
                                original,
                                `![[${name}]]`
                            );
                            new Notice(
                                ok
                                    ? `Portrait saved + embedded: ${name}`
                                    : `Portrait saved: ${path}`
                            );
                        } catch (err) {
                            new Notice(
                                "Portrait: PNG export failed — " +
                                    (err instanceof Error
                                        ? err.message
                                        : String(err))
                            );
                        }
                    })();
                },
                true
            );

            // Lock / unlock, top-right.
            overlayIconButton(
                span,
                pinned ? "unlock" : "lock",
                pinned
                    ? "Unlock: remove the stored recipe and roll fresh"
                    : "Lock: rewrite this span with the exact recipe (set in stone)",
                "top-right",
                () => {
                    const replacement = pinned
                        ? unlockedInlineText(
                              original,
                              plugin.settings.portraitPackPath
                          )
                        : lockedInlineText(
                              original,
                              plugin.settings.portraitPackPath,
                              JSON.stringify(current.recipe)
                          );
                    void rewriteSpanInNote(
                        plugin,
                        ctx.sourcePath,
                        original,
                        "`" + replacement + "`"
                    ).then((ok) => {
                        if (ok) {
                            new Notice(
                                pinned
                                    ? "Portrait unlocked."
                                    : "Portrait locked."
                            );
                        }
                    });
                },
                true
            );

            // Reroll, bottom-left — only for fully unpinned spans
            // (a seeded span is stable by definition).
            if (!pinned && params.seed === undefined) {
                overlayIconButton(
                    span,
                    "refresh-cw",
                    "Roll a new face (visual only — lock to keep it)",
                    "bottom-left",
                    () => {
                        void (async () => {
                            current = await compose();
                            draw(current);
                        })();
                    },
                    true
                );
            }
        };

        current = await compose();
        draw(current);
    } catch (err) {
        span.textContent =
            "⚠ portrait failed: " +
            (err instanceof Error ? err.message : String(err));
        span.classList.add("randomness-portrait-hint");
    }
}

function dirOf(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const i = norm.lastIndexOf("/");
    if (i === -1) return "";
    if (i === 0) return "/";
    return norm.slice(0, i);
}
