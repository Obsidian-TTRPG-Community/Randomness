/**
 * Generator file format.
 *
 * Randomness generators are plain-text `.rdm` files — the plugin's
 * native format. `.ipt` files (the format's ancestor) are read
 * identically and remain fully supported, so existing libraries and
 * community content keep working. New content should prefer `.rdm`.
 */

/** Extensions (no dot) recognised as generator files, native first. */
export const GENERATOR_EXTENSIONS = ["rdm", "ipt"] as const;

/** True when a vault path is a generator file (.rdm or .ipt). */
export function isGeneratorPath(path: string): boolean {
    const p = path.toLowerCase();
    return p.endsWith(".rdm") || p.endsWith(".ipt");
}
