/**
 * Inline portrait spans: `portrait: …` inside any rendered markdown
 * (including callouts — the ITS-infobox use case) becomes a single
 * portrait image with size control.
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
 * No controls are rendered inline — it's an image, sized to sit in an
 * infobox. Pin with seed= (stable across pack growth only if parts
 * don't shift) or recipe= (fully drift-proof).
 */

import { MarkdownPostProcessorContext } from "obsidian";
import type RandomnessPlugin from "../views/main";
import { composePack, composeFromRecipe, PortraitRecipe } from "./pack";

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

/** Post-processor: replace `portrait: …` code spans with portraits. */
export function buildPortraitInlineProcessor(plugin: RandomnessPlugin) {
    return function process(
        el: HTMLElement,
        _ctx: MarkdownPostProcessorContext
    ): void {
        const codeNodes = Array.from(el.querySelectorAll("code"));
        for (const code of codeNodes) {
            const params = parseInlinePortrait(
                code.textContent ?? "",
                plugin.settings.portraitPackPath
            );
            if (!params) continue;

            const span = activeDocument.createElement("span");
            span.className = "randomness-portrait-inline";
            span.style.width = `${params.size}px`;
            span.textContent = "…";
            code.replaceWith(span);

            void (async () => {
                try {
                    if (!(await plugin.portraits.available(params.pack))) {
                        span.textContent = "⚠ portrait pack not found";
                        span.classList.add("randomness-portrait-hint");
                        return;
                    }
                    const manifest = await plugin.portraits.manifest(
                        params.pack
                    );
                    const load = plugin.portraits.loader(params.pack);
                    const composed = params.recipe
                        ? await composeFromRecipe(
                              JSON.parse(params.recipe) as PortraitRecipe,
                              manifest,
                              load
                          )
                        : await composePack(manifest, load, params.seed);
                    span.textContent = "";
                    if (composed.svg.startsWith("<svg")) {
                        span.innerHTML = composed.svg;
                    }
                    span.setAttribute(
                        "aria-label",
                        `portrait ${composed.seed}`
                    );
                } catch (err) {
                    span.textContent =
                        "⚠ portrait failed: " +
                        (err instanceof Error ? err.message : String(err));
                    span.classList.add("randomness-portrait-hint");
                }
            })();
        }
    };
}
