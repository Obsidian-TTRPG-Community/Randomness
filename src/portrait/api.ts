/**
 * Portrait surface of the public API — built for templates.
 *
 * Reached via `app.plugins.plugins["randomness"].api.portraits`.
 * Typical Templater usage:
 *
 *   const rnd = app.plugins.plugins["randomness"].api;
 *   if (await rnd.portraits.available()) {
 *       const p = await rnd.portraits.roll({ gender: "female", race: "elf" });
 *       tR += rnd.portraits.inlineSnippet(p.recipe, 140) + "\n";
 *       tR += `**${p.name}** (${p.race}, ${p.age})\n`;
 *       // or a permanent image file:
 *       // const path = await rnd.portraits.savePng(p);
 *       // tR += `![[${path.split("/").pop()}]]\n`;
 *   }
 *
 * Constrained rolls (gender/race/age) REROLL until the constraint is
 * met rather than editing a recipe in place — gendered gating (facial
 * hair etc.) happens at roll time, so honest rolls require it. Gender
 * and age are pre-filtered on the seed hash (cheap); race needs a
 * real compose per try.
 */

import { Notice } from "obsidian";
import type RandomnessPlugin from "../views/main";
import {
    composePack,
    composeFromRecipe,
    normalizeManifest,
    ageFor,
    Age,
    Composed,
    PortraitRecipe,
} from "./pack";
import { nameFor, raceOf } from "./names";
import { saveComposedPng } from "./png";
import { portraitBlockSnippet, portraitInlineSnippet } from "./ui";

export interface PortraitRollOptions {
    /** Pack folder; defaults to the settings pack. */
    pack?: string;
    /** Exact seed — deterministic; constraints are ignored. */
    seed?: string;
    /** Constraint: reroll until the portrait matches. */
    gender?: "male" | "female";
    /** Constraint: race token as encoded in base filenames (e.g. "elf"). */
    race?: string;
    /** Constraint: young / adult / old. */
    age?: Age;
    /** Safety cap on constraint rerolls (default 400). */
    maxTries?: number;
}

export interface PortraitResult {
    /** Serializable recipe — persist this (frontmatter, snippets). */
    recipe: PortraitRecipe;
    /** Rendered SVG markup (layers embedded as data URIs). */
    svg: string;
    seed: string;
    /** Engine-rolled, race/gender-appropriate display name. */
    name: string;
    /** Race token from the base layer, or null for raceless packs. */
    race: string | null;
    gender: "male" | "female";
    age: Age;
}

export interface PortraitAPI {
    /** True when a pack (manifest.json) is installed at the path. */
    available(pack?: string): Promise<boolean>;
    /** Roll a portrait, optionally constrained. Throws if no pack. */
    roll(opts?: PortraitRollOptions): Promise<PortraitResult>;
    /** Re-render an exact recipe (drift-proof). */
    render(
        recipe: PortraitRecipe,
        opts?: { pack?: string }
    ): Promise<PortraitResult>;
    /**
     * Rasterise to PNG in the vault; returns the vault path.
     * Accepts a PortraitResult (uses its svg) or a bare recipe
     * (renders first). Folder defaults to "Portraits".
     */
    savePng(
        portrait: PortraitResult | PortraitRecipe,
        opts?: { pack?: string; folder?: string }
    ): Promise<string>;
    /** The deterministic name for a recipe. */
    name(recipe: PortraitRecipe, pack?: string): Promise<string>;
    /** Ready-to-paste ```portrait codeblock pinned to this recipe. */
    blockSnippet(recipe: PortraitRecipe): string;
    /** Ready-to-paste inline span pinned to this recipe. */
    inlineSnippet(recipe: PortraitRecipe, size?: number): string;
}

/**
 * Seed → gender, mirroring the engine's hash exactly (FNV-1a of
 * seed+":g", low bit). Replicated here for cheap constraint
 * pre-filtering; a consistency test guards against drift.
 */
export function genderForSeed(seed: string): "male" | "female" {
    let h = 0x811c9dc5;
    const s = seed + ":g";
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) & 1 ? "male" : "female";
}

/** Random seed in the engine's own format. */
function freshSeed(): string {
    return (
        Math.random().toString(36).slice(2) + Date.now().toString(36)
    );
}

export function createPortraitApi(plugin: RandomnessPlugin): PortraitAPI {
    const toResult = (
        composed: Composed,
        manifestRaw: unknown
    ): PortraitResult => {
        const recipe = composed.recipe;
        let name = composed.seed;
        try {
            name = nameFor(recipe, manifestRaw);
        } catch {
            // never let names break the API
        }
        return {
            recipe,
            svg: composed.svg,
            seed: composed.seed,
            name,
            race: raceOf(recipe, manifestRaw),
            gender: recipe.gender === "female" ? "female" : "male",
            age: (recipe.age ?? "adult") as Age,
        };
    };

    const requirePack = async (pack?: string): Promise<unknown> => {
        if (!(await plugin.portraits.available(pack))) {
            throw new Error(
                "Randomness: no portrait pack installed (Settings → Randomness)."
            );
        }
        return plugin.portraits.manifest(pack);
    };

    return {
        available: (pack?: string) => plugin.portraits.available(pack),

        async roll(opts: PortraitRollOptions = {}): Promise<PortraitResult> {
            const manifestRaw = await requirePack(opts.pack);
            const load = plugin.portraits.loader(opts.pack);
            const man = normalizeManifest(manifestRaw);
            const ageWeights = (
                man.meta as { age?: { young?: number; old?: number } } | undefined
            )?.age;

            if (opts.seed !== undefined) {
                return toResult(
                    await composePack(manifestRaw, load, opts.seed),
                    manifestRaw
                );
            }

            const maxTries = Math.max(1, opts.maxTries ?? 400);
            const race = opts.race?.toLowerCase();
            for (let i = 0; i < maxTries; i++) {
                const seed = freshSeed();
                // Cheap pre-filters: gender + age are pure functions
                // of the seed — skip without composing.
                if (opts.gender && genderForSeed(seed) !== opts.gender) {
                    continue;
                }
                if (opts.age && ageFor(seed, ageWeights) !== opts.age) {
                    continue;
                }
                const composed = await composePack(manifestRaw, load, seed);
                if (race) {
                    const r = raceOf(composed.recipe, manifestRaw);
                    if (r !== race) continue;
                }
                return toResult(composed, manifestRaw);
            }
            throw new Error(
                `Randomness: no portrait matched the constraints in ${maxTries} tries ` +
                    `(race "${opts.race ?? "-"}" must exist in the pack's base filenames).`
            );
        },

        async render(
            recipe: PortraitRecipe,
            opts: { pack?: string } = {}
        ): Promise<PortraitResult> {
            const manifestRaw = await requirePack(opts.pack);
            const load = plugin.portraits.loader(opts.pack);
            return toResult(
                await composeFromRecipe(recipe, manifestRaw, load),
                manifestRaw
            );
        },

        async savePng(
            portrait: PortraitResult | PortraitRecipe,
            opts: { pack?: string; folder?: string } = {}
        ): Promise<string> {
            let composedLike: { svg: string; seed: string };
            if ("svg" in portrait && "seed" in portrait) {
                composedLike = portrait as PortraitResult;
            } else {
                const rendered = await this.render(
                    portrait as PortraitRecipe,
                    { pack: opts.pack }
                );
                composedLike = rendered;
            }
            const path = await saveComposedPng(
                plugin,
                composedLike as Composed,
                opts.folder ?? "Portraits"
            );
            new Notice(`Portrait saved: ${path}`);
            return path;
        },

        async name(recipe: PortraitRecipe, pack?: string): Promise<string> {
            const manifestRaw = await requirePack(pack);
            return nameFor(recipe, manifestRaw);
        },

        blockSnippet: (recipe: PortraitRecipe) =>
            portraitBlockSnippet(JSON.stringify(recipe)),

        inlineSnippet: (recipe: PortraitRecipe, size?: number) =>
            portraitInlineSnippet(JSON.stringify(recipe), size),
    };
}
