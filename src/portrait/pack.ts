/* =============================================================================
 * pack.ts — manifest-driven seeded layer compositor
 *
 * Composes a single SVG by picking one variant per category from a layered
 * asset pack and stacking them in z-order. Environment-agnostic: pass in an
 * async `loadFile(relPath)` so the same code works in Obsidian (vault reads),
 * Node (fs), or a browser (fetch). No dependencies.
 *
 * Accepts two manifest dialects (see normalizeManifest):
 *   A) { viewBox, layers, suggestedOrder, ... }
 *   B) { canvas:{viewBox}, assets, layerOrder, ... }
 *
 * Coherence groups keep related categories consistent:
 *   - "prefix" mode: match by the first filename token (e.g. base/ears → race).
 *   - "style"  mode: match by the middle style token, with the first category
 *     as primary; secondary categories that have no matching style are omitted
 *     (e.g. hair_front/hair_back → braid↔braid; shaved_topknot front → no back).
 * ========================================================================== */

export type CoherenceGroup =
  | string[]
  | { categories: string[]; by?: "prefix" | "style" | "color"; lock?: string };

export interface PackManifest {
  viewBox: string;
  layers: Record<string, string[]>;
  suggestedOrder?: string[];
  coherenceGroups?: CoherenceGroup[];
  optional?: Record<string, number>;
  exclude?: string[];
  suppression?: Record<string, Record<string, string[]>>;
  colors?: Record<string, { values: string[]; notEqualTo?: string[] }>;
  weights?: Record<string, number>;
  meta?: PackMeta;
  name?: string;
}

/** Free-form-ish pack metadata. All fields optional; packs vary. */
export interface PackMeta {
  skin?: { layers?: string[]; tones?: RGB[]; names?: string[] };
  age?: { young?: number; old?: number };
  genderLean?: {
    files?: Record<string, string>;
    multipliers?: { same?: number; opposite?: number; strongOpposite?: number };
  };
  incompatible?: string[][];
  license?: { name?: string; url?: string };
  [key: string]: unknown;
}

/** Raw manifest as parsed from manifest.json — either dialect. */
export interface RawManifest {
  viewBox?: string;
  canvas?: { viewBox?: string; width?: number; height?: number };
  layers?: Record<string, string[]>;
  assets?: Record<string, string[]>;
  suggestedOrder?: string[];
  layerOrder?: string[];
  coherenceGroups?: Array<
    string[] | { categories: string[]; by?: string; lock?: string }
  >;
  optional?: Record<string, number>;
  exclude?: string[];
  suppression?: Record<string, Record<string, string[]>>;
  colors?: Record<string, { values: string[]; notEqualTo?: string[] }>;
  weights?: Record<string, number>;
  meta?: PackMeta;
  name?: string;
  pack?: string;
}

export type LoadFile = (relPath: string) => Promise<string>;

export interface ComposeConfig {
  coherenceGroups?: CoherenceGroup[];
  optional?: Record<string, number>;
  exclude?: string[];
  suppression?: Record<string, Record<string, string[]>>;
  colors?: Record<string, { values: string[]; notEqualTo?: string[] }>;
  weights?: Record<string, number>;
}

export interface Composed {
  svg: string;
  seed: string;
  parts: Record<string, string>;
  colors: Record<string, string>;
  order: string[];                       // rendered categories, back → front
  skipped: Record<string, string>;       // category → why it was not rendered
  images: string[];                      // raster layer data URIs in z-order (empty for vector packs)
  recipe: PortraitRecipe;                // serializable, persistable part choices (NEW)
}

const DEFAULT_OPTIONAL: Record<string, number> = {
  facial_hair: 0.6, scars: 0.5, accessories: 0.6, overlays: 0.7, headwear: 0.25,
};
const DEFAULT_COHERENCE: CoherenceGroup[] = [
  ["base", "ears"],                                              // prefix: race
  { categories: ["hair_front", "hair_back"], by: "style" },      // style: hair matches
];
const DEFAULT_EXCLUDE = ["poster"];

/* ---- accept either manifest dialect ---- */
export function normalizeManifest(raw: RawManifest): PackManifest {
  return {
    viewBox:
      raw.viewBox ??
      raw.canvas?.viewBox ??
      (raw.canvas?.width && raw.canvas?.height
        ? `0 0 ${raw.canvas.width} ${raw.canvas.height}`
        : "0 0 512 512"),
    layers: raw.layers ?? raw.assets ?? {},
    suggestedOrder: raw.suggestedOrder ?? raw.layerOrder,
    coherenceGroups: raw.coherenceGroups as CoherenceGroup[] | undefined,
    optional: raw.optional,
    exclude: raw.exclude,
    suppression: raw.suppression,
    colors: raw.colors,
    weights: raw.weights,
    meta: raw.meta,
    name: raw.name ?? raw.pack,
  };
}

/* ---- seeded RNG ---- */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
class RNG {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  private next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(): number { return this.next(); }
  pick<T>(a: T[]): T { return a[Math.floor(this.next() * a.length)]; }
}
function randomSeed(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* basename, extension-stripped, category-prefix-stripped: the heart of token matching.
 * Manifest assets are sub-folder PATHS like "hair_front/hair_front_01.png". The OLD code tested
 * startsWith(cat+"_") on the FULL path (begins "hair_front/" with a slash) so nothing stripped,
 * and it only removed .svg, never .png. So basename FIRST, then strip ANY image extension, then
 * the "cat_" prefix.  tokenBody("hair_front","hair_front/hair_front_braid_01.png") -> "braid_01" */
function tokenBody(cat: string, file: string): string {
  const cut = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));  // basename: drop any folder
  let s = cut >= 0 ? file.slice(cut + 1) : file;
  s = s.replace(/\.(png|jpe?g|webp|svg)$/i, "");          // drop any image extension
  if (s.startsWith(cat + "_")) s = s.slice(cat.length + 1);
  return s;
}
/* race/family token: first token after the prefix. keyword("base","base/base_human_01.png") -> "human" */
function keyword(cat: string, file: string): string {
  return tokenBody(cat, file).split(/[_.]/)[0];
}
/* style token: prefix + trailing index stripped. Index-only names yield the index, so
 * hair_front_03 and hair_back_03 share style "03". Named styles work too:
 * styleToken("hair_front","hair_front/hair_front_braid_01.png") -> "braid". Falls back to body. */
function styleToken(cat: string, file: string): string {
  const s = tokenBody(cat, file);
  const t = s.replace(/_\d+$/, "");
  return t.length ? t : s;
}

/* per-layer isolation so stacked layers never clash on ids or classes */
function isolate(svg: string, token: string): string {
  svg = svg
    .replace(/id="([^"]+)"/g, (_m: string, id: string) => `id="${token}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_m: string, id: string) => `url(#${token}-${id})`)
    .replace(/(xlink:href|href)="#([^"]+)"/g, (_m: string, a: string, id: string) => `${a}="#${token}-${id}"`);
  svg = svg.replace(/<style>([\s\S]*?)<\/style>/g, (_m: string, css: string) =>
    `<style>${css.replace(/\.([A-Za-z_][\w-]*)/g, `.${token}-$1`)}</style>`);
  svg = svg.replace(/class="([^"]*)"/g, (_m: string, cls: string) =>
    `class="${cls.split(/\s+/).filter(Boolean).map((c: string) => `${token}-${c}`).join(" ")}"`);
  return svg;
}
function innerOf(svg: string): string {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
}
/* weighted pick (default weight 1); consumes exactly one rng draw, like rng.pick */
function weightedPick(rng: RNG, files: string[], weights?: Record<string, number>): string {
  if (!weights) return rng.pick(files);
  const ws = files.map((f) => Math.max(0, weights[f] ?? 1));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return rng.pick(files);
  let r = rng.float() * total;
  for (let i = 0; i < files.length; i++) { r -= ws[i]; if (r <= 0) return files[i]; }
  return files[files.length - 1];
}

/* ============================ PortraitRecipe ================================
 * A serializable, persistable snapshot of the part choices for a portrait,
 * decoupled from the RNG that produced them. Persist `recipe` on the NPC note
 * (resolved indices, not just the seed) so a portrait survives pack/engine
 * version drift and is hand-editable. resolveRecipe() turns it back into draw
 * ops with no RNG. flip/jitter are NEW variety, drawn AFTER all selection so the
 * part selection stays byte-identical to the pre-recipe engine for any seed. */
export interface PortraitRecipe {
  v: 1;
  seed: string;                                       // origin seed (provenance/debug)
  parts: Record<string, number>;                      // category -> index into layers[cat]; -1 = omit
  flip: Record<string, boolean>;                       // category -> horizontal mirror
  jitter: Record<string, { dx: number; dy: number }>;  // per-feature nudge (px)
  skin?: number;                                       // index into manifest skin tones; undefined/-1 = no recolour
  gender?: "male" | "female";                          // seeded; gates male-only layers (facial_hair)
  age?: Age;                                           // seeded; old => age_marks overlay + silver hair, young => no facial hair
}
export interface LayerOp { cat: string; file: string; dx: number; dy: number; flipX: boolean; }

/* ---- skin-tone recolour (engine-side) ----------------------------------------
 * Skin tone is a single recipe number; the compositor recolours the skin-bearing
 * raster layers (base/ears/noses) at render time. recolorSkinPixels is PURE and
 * unit-tested; the canvas wrapper runs in Obsidian/Electron and no-ops in Node. */
export type RGB = [number, number, number];
const DEFAULT_SKIN_TONES: RGB[] = [
  [252,228,206],[245,205,165],[212,168,121],[188,138,96],[150,104,70],[101,68,49],
];
const DEFAULT_SKIN_LAYERS = ["base", "ears", "noses"];
function skinConfig(manifest: PackManifest): { tones: RGB[]; layers: string[] } {
  const s = manifest.meta?.skin ?? {};
  const tones: RGB[] = Array.isArray(s.tones) && s.tones.length ? s.tones : DEFAULT_SKIN_TONES;
  const layers: string[] = Array.isArray(s.layers) && s.layers.length ? s.layers : DEFAULT_SKIN_LAYERS;
  return { tones, layers };
}
/* Skin SECTION mask + tone ramp. Skin = warm pixels (R>=G>=B) with bounded saturation, above the
 * ink floor — this excludes grey/white sclera, dark lashes/ink, and (because mouths/brows are not
 * skin layers) lips/brow-hair. A FIXED source-skin lum window [SKIN_LO,SKIN_HI] is shared by every
 * layer so equal luminance maps to the same tone across base/nose/eyes (per-image normalisation
 * made the nose read lighter than the base). Ramp: shadow -> tone@0.55 -> highlight. Keeps alpha. */
const SKIN_LO = 120, SKIN_HI = 288;
export function recolorSkinPixels(d: Uint8ClampedArray, tone: RGB, inkFloor = 72): void {
  const span = SKIN_HI - SKIN_LO;
  const [tr, tg, tb] = tone;
  const sh: RGB = [tr * 0.70, tg * 0.70, tb * 0.70];
  const hi: RGB = [tr + (255 - tr) * 0.28, tg + (255 - tg) * 0.28, tb + (255 - tb) * 0.28];
  const ramp = (a: number, b: number, c: number, x: number) =>
    x < 0.55 ? a + (b - a) * (x / 0.55) : b + (c - b) * ((x - 0.55) / 0.45);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 16) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum <= inkFloor) continue;
    if (!(r >= g - 4 && g >= b - 4)) continue;          // warm ramp only
    const rb = r - b; if (rb < 16 || rb > 170) continue; // exclude grey sclera / out-of-gamut
    const x = Math.min(1, Math.max(0, (lum - SKIN_LO) / span));
    d[i]     = ramp(sh[0], tr, hi[0], x);
    d[i + 1] = ramp(sh[1], tg, hi[1], x);
    d[i + 2] = ramp(sh[2], tb, hi[2], x);
  }
}
/** Browser globals needed for canvas recolour; null under Node (tests). */
interface CanvasGlobals {
  OffscreenCanvas: { new (w: number, h: number): OffscreenCanvas };
  createImageBitmap: (b: Blob) => Promise<ImageBitmap>;
  fetch: (u: string) => Promise<Response>;
  btoa: (s: string) => string;
}
function canvasGlobals(): CanvasGlobals | null {
  const w =
    typeof activeWindow !== "undefined"
      ? activeWindow
      : typeof window !== "undefined"
        ? window
        : null;
  const g = w as unknown as Partial<CanvasGlobals> | null;
  if (!g || !g.OffscreenCanvas || !g.createImageBitmap || !g.fetch) return null;
  return g as CanvasGlobals;
}
/* recolour a PNG data URI via canvas; returns input unchanged where OffscreenCanvas is absent (Node). */
async function recolorPngDataUri(href: string, tone: RGB): Promise<string> {
  const G = canvasGlobals();
  if (!G) return href;
  try {
    const blob = await (await G.fetch(href)).blob();
    const bmp = await G.createImageBitmap(blob);
    const cv = new G.OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext("2d"); if (!ctx) return href; ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    recolorSkinPixels(img.data, tone);
    ctx.putImageData(img, 0, 0);
    const buf = await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer();
    const u8 = new Uint8Array(buf); let bin = "";
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return `data:image/png;base64,${G.btoa(bin)}`;
  } catch { return href; }
}

/* ---- facial hair: gender gate + colour-match to hair ----------------------- */
const FACIAL_LAYER = "facial_hair";
/* representative hair colour = median of opaque mid-tone pixels (skip ink + highlights). */
function sampleHairColor(d: Uint8ClampedArray): RGB | null {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 35 || lum > 240) continue;
    rs.push(r); gs.push(g); bs.push(b);
  }
  if (!rs.length) return null;
  const med = (a: number[]) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}
/* greyscale facial hair -> hair-colour cel ramp (shadow -> colour@0.5 -> highlight).
 * inkFloor: pixels at/below this luminance are left untouched (keeps dark outlines dark when
 * re-tinting already-coloured layers, e.g. greying hair for old age). 0 = legacy behaviour. */
export function recolorGreyToColor(d: Uint8ClampedArray, color: RGB, inkFloor = 0): void {
  const [cr, cg, cb] = color;
  const sh: RGB = [cr * 0.55, cg * 0.55, cb * 0.55];
  const hi: RGB = [cr + (255 - cr) * 0.35, cg + (255 - cg) * 0.35, cb + (255 - cb) * 0.35];
  const ramp = (a: number, b: number, c: number, x: number) => x < 0.5 ? a + (b - a) * (x / 0.5) : b + (c - b) * ((x - 0.5) / 0.5);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 16) continue;
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum <= inkFloor) continue;
    const x = lum / 255;
    d[i] = ramp(sh[0], cr, hi[0], x); d[i + 1] = ramp(sh[1], cg, hi[1], x); d[i + 2] = ramp(sh[2], cb, hi[2], x);
  }
}
async function sampleColorFromDataUri(href: string): Promise<RGB | null> {
  const G = canvasGlobals();
  if (!G) return null;
  try {
    const bmp = await G.createImageBitmap(await (await G.fetch(href)).blob());
    const cv = new G.OffscreenCanvas(bmp.width, bmp.height); const ctx = cv.getContext("2d"); if (!ctx) return null; ctx.drawImage(bmp, 0, 0);
    return sampleHairColor(ctx.getImageData(0, 0, bmp.width, bmp.height).data);
  } catch { return null; }
}
async function recolorGreyDataUri(href: string, color: RGB, inkFloor = 0): Promise<string> {
  const G = canvasGlobals();
  if (!G) return href;
  try {
    const bmp = await G.createImageBitmap(await (await G.fetch(href)).blob());
    const cv = new G.OffscreenCanvas(bmp.width, bmp.height); const ctx = cv.getContext("2d"); if (!ctx) return href; ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height); recolorGreyToColor(img.data, color, inkFloor); ctx.putImageData(img, 0, 0);
    const buf = await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer();
    const u8 = new Uint8Array(buf); let bin = ""; for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return `data:image/png;base64,${G.btoa(bin)}`;
  } catch { return href; }
}
/* seed-derived gender on an INDEPENDENT hash (does not disturb the selection rng stream). */
function genderFor(seed: string): "male" | "female" { return (hashStr(seed + ":g") & 1) ? "male" : "female"; }

/* ---- age axis: seed-derived tier on its own INDEPENDENT hash ----------------
 * 20% young / 60% adult / 20% old. OLD gets the age_marks wrinkle overlay (an additive layer —
 * the base is never touched) + hair/brows/beard re-tinted silver at render. YOUNG never rolls
 * facial hair. Selection draws shift only for seeds whose tier gates a category (same trade as
 * the gender gate); persisted recipes are immune. */
export type Age = "young" | "adult" | "old";
const AGE_LAYER = "age_marks";
const MID_LAYER = "midage_marks";   // subtle 30-40 lines: ADULT tier only, optional prob from manifest
const PIMPLE_LAYER = "pimples";     // acne: YOUNG tier only, optional prob from manifest
const AGE_HAIR_LAYERS = ["hair_back", "hair_front", "brows"];  // greyed when old (facial hair goes silver via fhColor)
const OLD_HAIR: RGB = [214, 214, 220];                         // silver
const AGE_INK_FLOOR = 45;                                      // greying keeps dark outlines dark
/* weights are TUNABLE from manifest meta.age ({ young, old } fractions, adult = remainder) so the
 * mix can be rebalanced without an engine rebuild. Defaults 20% young / 70% adult / 10% old. */
export function ageFor(seed: string, w?: { young?: number; old?: number }): Age {
  const cl = (x: unknown, dflt: number) => { const n = Number(x); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : dflt; };
  const young = cl(w?.young, 0.2), old = Math.min(cl(w?.old, 0.1), 1 - young);
  const h = hashStr(seed + ":a") % 1000;
  if (h < young * 1000) return "young";
  if (h >= 1000 - old * 1000) return "old";
  return "adult";
}

const FLIPPABLE: string[] = ["hair_front", "brows"];     // genuinely asymmetric layers
const FEATURE_CATS: string[] = ["eyes", "noses", "mouths", "brows"];
const JITTER_X: Record<string, number> = { eyes: 2, noses: 1, mouths: 1, brows: 2 };  // px; strict subset of
const JITTER_Y: Record<string, number> = { eyes: 2, noses: 1, mouths: 1, brows: 2 };  // test_placement tol (6)
function jrand(rng: RNG, budget: number): number { return budget ? Math.round((rng.float() * 2 - 1) * budget) : 0; }

/* SVG transform for a layer's flip + jitter (empty when both are no-ops). */
function layerTransform(cat: string, vbW: number, flip: Record<string, boolean>,
                        jitter: Record<string, { dx: number; dy: number }>): string {
  const j = jitter[cat] ?? { dx: 0, dy: 0 };
  const ts: string[] = [];
  if (j.dx || j.dy) ts.push(`translate(${j.dx} ${j.dy})`);
  if (flip[cat]) ts.push(`translate(${vbW} 0) scale(-1 1)`);   // mirror about the canvas centre
  return ts.length ? ` transform="${ts.join(" ")}"` : "";
}

/* recipe -> ordered draw ops. PURE (no RNG). For the plugin to re-render a persisted recipe. */
export function resolveRecipe(recipe: PortraitRecipe, manifestRaw: RawManifest, cfg: ComposeConfig = {}): LayerOp[] {
  const manifest = normalizeManifest(manifestRaw);
  const layers = manifest.layers;
  const exclude = new Set(cfg.exclude ?? manifest.exclude ?? DEFAULT_EXCLUDE);
  const order = (manifest.suggestedOrder ?? Object.keys(layers))
    .filter((e) => !e.includes("/") && layers[e] && !exclude.has(e));
  for (const c of Object.keys(layers)) if (!exclude.has(c) && !order.includes(c)) order.push(c);
  const ops: LayerOp[] = [];
  for (const cat of order) {
    const idx = recipe.parts[cat];
    if (idx == null || idx < 0) continue;
    const file = layers[cat]?.[idx];
    if (file == null) continue;
    const j = recipe.jitter[cat] ?? { dx: 0, dy: 0 };
    ops.push({ cat, file, dx: j.dx, dy: j.dy, flipX: !!recipe.flip[cat] });
  }
  return ops;
}

/**
 * Compose one portrait from a pack.
 * @param manifestRaw  parsed manifest.json (either dialect)
 * @param loadFile     async reader: returns SVG **text** for .svg parts, or base64
 *                     (bare or a data: URI) for raster parts (.png/.jpg/.webp)
 * @param seed         any string; same seed ⇒ same portrait. Omit for random.
 * @param cfg          optional overrides for coherence / optional / exclude
 */
export async function composePack(
  manifestRaw: RawManifest, loadFile: LoadFile, seed?: string, cfg: ComposeConfig = {},
): Promise<Composed> {
  const manifest = normalizeManifest(manifestRaw);
  const usedSeed = seed ?? randomSeed();
  const rng = new RNG(hashStr(usedSeed));
  const layers = manifest.layers;
  const exclude = new Set(cfg.exclude ?? manifest.exclude ?? DEFAULT_EXCLUDE);
  const optional = { ...DEFAULT_OPTIONAL, ...(manifest.optional ?? {}), ...(cfg.optional ?? {}) };
  const groups = cfg.coherenceGroups ?? manifest.coherenceGroups ?? DEFAULT_COHERENCE;
  const weights = cfg.weights ?? manifest.weights;

  /* Gender-lean weighting (meta.genderLean): art tagged "masc"/"fem"
   * (suffix "!" = strong) is down-weighted when it contradicts the
   * rolled gender and up-weighted when it matches, so a female roll
   * stops drawing male-pattern balding and a male roll stops drawing
   * off-shoulder gowns. gender is a pure hash of the seed (no RNG
   * draw), so computing it up here is stream-safe. Every lean-aware
   * pick consumes exactly one draw (weightedPick mirrors rng.pick),
   * so packs WITHOUT tags keep byte-identical selection. Packs that
   * ADD tags re-roll seeded (non-recipe) portraits — locked recipes
   * are unaffected. Multipliers tunable via meta.genderLean.multipliers. */
  const gender = genderFor(usedSeed);
  const leanCfg = manifest.meta?.genderLean ?? {};
  const leanFiles = leanCfg.files ?? {};
  const hasLean = Object.keys(leanFiles).length > 0;
  const LEAN_SAME = leanCfg.multipliers?.same ?? 1.6;
  const LEAN_OPP = leanCfg.multipliers?.opposite ?? 0.12;
  const LEAN_OPP_STRONG = leanCfg.multipliers?.strongOpposite ?? 0;
  const leanMult = (file: string): number => {
    let tag = leanFiles[file];
    if (tag === undefined) {
      // forgiving key forms: basename and stem (no extension)
      const base = file.includes("/") ? file.slice(file.lastIndexOf("/") + 1) : file;
      tag = leanFiles[base] ?? leanFiles[base.replace(/\.(png|jpe?g|webp|svg)$/i, "")];
    }
    if (!tag) return 1;
    const strong = tag.endsWith("!");
    const t = strong ? tag.slice(0, -1) : tag;
    const same = (t === "masc" && gender === "male") || (t === "fem" && gender === "female");
    if (same) return LEAN_SAME;
    return strong ? LEAN_OPP_STRONG : LEAN_OPP;
  };
  /* merged manifest weights x gender lean; undefined when nothing to do
   * (weightedPick then falls back to plain rng.pick — zero drift). */
  const effWeights = (files: string[]): Record<string, number> | undefined => {
    if (!hasLean) return weights;
    const out: Record<string, number> = {};
    for (const f of files) out[f] = Math.max(0, weights?.[f] ?? 1) * leanMult(f);
    return out;
  };

  const chosen: Record<string, string> = {};
  const skip = new Set<string>();
  const skipReason: Record<string, string> = {};

  for (const g of groups) {
    const obj: { categories?: string[]; by?: "prefix" | "style" | "color"; lock?: string } =
      Array.isArray(g) ? { categories: g } : g;
    // resolve match mode: explicit `by`, else infer from `lock` (race→prefix, family/style→style, colour→palette)
    let by: "prefix" | "style" | "color" = obj.by ?? "prefix";
    if (!obj.by && obj.lock) {
      const lk = String(obj.lock).toLowerCase();
      by = /family|style/.test(lk) ? "style" : /colou?r/.test(lk) ? "color" : "prefix";
    }
    const cats: string[] = (obj.categories ?? []).filter((c: string) => layers[c] && !exclude.has(c));
    if (cats.length < 2) continue;
    if (by === "color") continue;   // colour coherence is the palette's job (tone-* classes), not filename matching

    if (by === "style") {
      const primary = cats[0];
      const styles = [...new Set(layers[primary].map((f) => styleToken(primary, f)))];
      if (!styles.length) continue;
      let style: string;
      if (hasLean) {
        // style weight = summed lean-adjusted weight of its variants
        const sw: Record<string, number> = {};
        for (const st of styles) {
          sw[st] = layers[primary]
            .filter((f) => styleToken(primary, f) === st)
            .reduce((a, f) => a + Math.max(0, weights?.[f] ?? 1) * leanMult(f), 0);
        }
        style = weightedPick(rng, styles, sw);
      } else {
        style = rng.pick(styles);
      }
      const variants = layers[primary].filter((f) => styleToken(primary, f) === style);
      chosen[primary] = weightedPick(rng, variants, effWeights(variants));
      for (const c of cats.slice(1)) {
        const matches = layers[c].filter((f) => styleToken(c, f) === style);
        if (matches.length) chosen[c] = weightedPick(rng, matches, effWeights(matches));
        else { skip.add(c); skipReason[c] = "coherence: no matching style"; }
      }
    } else {
      const kwSets = cats.map((c) => new Set(layers[c].map((f) => keyword(c, f))));
      const common = [...kwSets[0]].filter((k) => kwSets.every((set) => set.has(k)));
      if (!common.length) continue;
      const kw = rng.pick(common);
      for (const c of cats) {
        const matches = layers[c].filter((f) => keyword(c, f) === kw);
        if (matches.length) chosen[c] = rng.pick(matches);
        else { skip.add(c); skipReason[c] = `coherence: no ${c} for "${kw}"`; }   // omit rather than mismatch
      }
    }
  }

  // base picked FIRST so suppression triggers (headwear) can avoid incompatible pairs
  // (e.g. long elf/goblin ears vs hats whose baked hair occupies the ear zone)
  if (layers["base"]?.length && !chosen["base"] && !skip.has("base")) {
    chosen["base"] = weightedPick(rng, layers["base"], effWeights(layers["base"]));
  }
  const incompatPairs: string[][] = manifest.meta?.incompatible ?? [];
  const conflicts = (a: string, b: string) =>
    incompatPairs.some((p) => (p[0] === a && p[1] === b) || (p[1] === a && p[0] === b));

  // suppression pre-pass: a chosen headwear (or any declared trigger) hides conflicting layers
  const suppression = cfg.suppression ?? manifest.suppression ?? {};
  for (const trig of Object.keys(suppression)) {
    if (!layers[trig] || exclude.has(trig)) continue;
    const prob = optional[trig] ?? 0.25;
    if (rng.float() > prob) { skip.add(trig); skipReason[trig] = "not worn this roll"; continue; }
    const taken = Object.values(chosen);
    const cands = layers[trig].filter((f) => !taken.some((c) => conflicts(f, c)));
    if (!cands.length) { skip.add(trig); skipReason[trig] = "no variant compatible with picks (meta.incompatible)"; continue; }
    const file = chosen[trig] ?? weightedPick(rng, cands, effWeights(cands));
    chosen[trig] = file;
    const rules = suppression[trig] || {};
    const sup = rules[styleToken(trig, file)] ?? rules["*"] ?? [];
    for (const c of sup) { skip.add(c); skipReason[c] = `suppressed by ${trig}: ${file}`; }
  }

  const order = (manifest.suggestedOrder ?? Object.keys(layers))
    .filter((e) => !e.includes("/") && layers[e] && !exclude.has(e));
  for (const c of Object.keys(layers)) {
    if (!exclude.has(c) && !order.includes(c)) order.push(c);
  }

  const age = ageFor(usedSeed, manifest.meta?.age);
  const picks: { cat: string; file: string }[] = [];
  for (const cat of order) {
    if (skip.has(cat)) continue;
    if (cat === FACIAL_LAYER && (gender !== "male" || age === "young")) {
      skipReason[cat] = gender !== "male" ? "no facial hair (female)" : "no facial hair (young)"; continue;
    }
    if (cat === AGE_LAYER && age !== "old") { skipReason[cat] = "no age marks (not old)"; continue; }
    if (cat === MID_LAYER && age !== "adult") { skipReason[cat] = "no midage marks (not adult)"; continue; }
    if (cat === PIMPLE_LAYER && age !== "young") { skipReason[cat] = "no pimples (not young)"; continue; }
    let file = chosen[cat];
    if (!file) {
      if (cat in optional && rng.float() > optional[cat]) { skipReason[cat] = "optional: not rolled"; continue; }
      const taken = Object.values(chosen);
      const pool = layers[cat].filter((f) => !taken.some((c) => conflicts(f, c)));
      const fromPool = pool.length ? pool : layers[cat];
      file = weightedPick(rng, fromPool, effWeights(fromPool));
    }
    chosen[cat] = file;
    picks.push({ cat, file });
  }

  // dynamic colour: pick one value per palette (seeded), applied via tone-<name> classes
  const palettes = (cfg.colors ?? manifest.colors ?? {}) as Record<string, { values: string[] }>;
  const pickedColors: Record<string, string> = {};
  for (const name of Object.keys(palettes)) {
    const vals = palettes[name]?.values ?? [];
    if (vals.length) pickedColors[name] = rng.pick(vals);
  }
  const colorNames = Object.keys(pickedColors);
  const tokenFor = (p: { cat: string; file: string }) => "L" + hashStr(p.cat + "/" + p.file).toString(36);

  // flip + jitter: NEW rng draws, AFTER all selection + colour -> selection above is unchanged.
  const flip: Record<string, boolean> = {};
  for (const cat of FLIPPABLE) flip[cat] = rng.float() < 0.5;
  const jitter: Record<string, { dx: number; dy: number }> = {};
  for (const cat of FEATURE_CATS) jitter[cat] = { dx: jrand(rng, JITTER_X[cat] ?? 0), dy: jrand(rng, JITTER_Y[cat] ?? 0) };

  // skin tone: a FINAL seeded draw -> does not shift any selection/flip/jitter draw above
  const { tones: skinTones, layers: skinLayers } = skinConfig(manifest);
  const skinIdx = skinTones.length ? Math.floor(rng.float() * skinTones.length) : -1;

  // facial-hair colour = sampled from the rolled hair (so beard matches hair); silver when old.
  // When NO hair layer rendered (suppressed by headwear, e.g. helmets) fall back to mid-brown so
  // the beard never renders raw grey.
  let fhColor: RGB | null = null;
  if (picks.some((p) => p.cat === FACIAL_LAYER)) {
    if (age === "old") fhColor = OLD_HAIR;
    else {
      const hp = picks.find((p) => p.cat === "hair_back") ?? picks.find((p) => p.cat === "hair_front");
      if (hp) { const rel = hp.file.includes("/") ? hp.file : `${hp.cat}/${hp.file}`;
        try { const raw = await loadFile(rel); fhColor = await sampleColorFromDataUri(`data:image/png;base64,${raw.replace(/^data:[^,]*,/, "")}`); } catch { /* sampling best-effort */ } }
      if (!fhColor) fhColor = [96, 60, 34];
    }
  }
  const vb = manifest.viewBox.split(/\s+/).map(Number);
  const vbW = vb[2] || 512, vbH = vb[3] || 512;
  const RASTER = /\.(png|jpe?g|webp)$/i;
  const layerOut = await Promise.all(picks.map(async (p) => {
    // asset entries may be bare ("base_human_01.png") or already path-prefixed
    // ("base/base_human_01.png"); only prepend the category for bare names
    const rel = p.file.includes("/") ? p.file : `${p.cat}/${p.file}`;
    const raw = await loadFile(rel);
    if (RASTER.test(p.file)) {
      // raster part: full-canvas image; alignment lives in the art (authored at canvas size)
      const mime = /\.png$/i.test(p.file) ? "image/png" : /\.webp$/i.test(p.file) ? "image/webp" : "image/jpeg";
      const b64 = raw.replace(/^data:[^,]*,/, "");   // accept bare base64 or a full data: URI
      let href = `data:${mime};base64,${b64}`;
      if (skinIdx >= 0 && skinLayers.includes(p.cat)) href = await recolorPngDataUri(href, skinTones[skinIdx]);
      else if (p.cat === FACIAL_LAYER && fhColor) href = await recolorGreyDataUri(href, fhColor);
      if (age === "old" && AGE_HAIR_LAYERS.includes(p.cat)) href = await recolorGreyDataUri(href, OLD_HAIR, AGE_INK_FLOOR);
      return {
        svg: `<g data-layer="${p.cat}"${layerTransform(p.cat, vbW, flip, jitter)}><image x="0" y="0" width="${vbW}" height="${vbH}" preserveAspectRatio="none" href="${href}" xlink:href="${href}"/></g>`,
        href,
      };
    }
    return { svg: `<g data-layer="${p.cat}"${layerTransform(p.cat, vbW, flip, jitter)}>${isolate(innerOf(raw), tokenFor(p))}</g>`, href: null as string | null };
  }));
  const groupsSvg = layerOut.map((l) => l.svg);
  const images = layerOut.map((l) => l.href).filter((h): h is string => !!h);   // raster layers, z-order

  // colour overrides emitted LAST so they win over each layer's own tone-* fallback fill
  const colorStyle = colorNames.length
    ? `<style>${picks.map((p) => { const t = tokenFor(p);
        return colorNames.map((n) => `.${t}-tone-${n}{fill:${pickedColors[n]}}`).join(""); }).join("")}</style>`
    : "";

  const parts: Record<string, string> = {};
  for (const pk of picks) parts[pk.cat] = pk.file;   // only layers actually rendered

  const partsIdx: Record<string, number> = {};
  for (const cat of order) partsIdx[cat] = -1;
  for (const pk of picks) partsIdx[pk.cat] = layers[pk.cat].indexOf(pk.file);
  const recipe: PortraitRecipe = { v: 1, seed: usedSeed, parts: partsIdx, flip, jitter, skin: skinIdx, gender, age };

  const m = manifest.meta;
  const metaComment = m?.license?.name ? `<!-- ${manifest.name ?? "pack"} | ${m.license.name} -->` : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${manifest.viewBox}">${metaComment}${groupsSvg.join("")}${colorStyle}</svg>`;
  return { svg, seed: usedSeed, parts, colors: pickedColors, order: picks.map((p) => p.cat), skipped: skipReason, images, recipe };
}

/* Render a portrait directly from a persisted PortraitRecipe — NO RNG, drift-proof. Use when a
 * note stores a resolved recipe: composeFromRecipe(note.recipe, manifest, loadFile). Mirrors the
 * composePack emit so output is identical for a recipe produced by the same seed. */
export async function composeFromRecipe(
  recipe: PortraitRecipe, manifestRaw: RawManifest, loadFile: LoadFile, cfg: ComposeConfig = {},
): Promise<Composed> {
  const manifest = normalizeManifest(manifestRaw);
  const ops = resolveRecipe(recipe, manifestRaw, cfg);
  const { tones: skinTones, layers: skinLayers } = skinConfig(manifest);
  const skinIdx = recipe.skin ?? -1;
  const age: Age = recipe.age ?? "adult";   // recipes saved before the age axis render unchanged
  let fhColor: RGB | null = null;
  if (ops.some((o) => o.cat === FACIAL_LAYER)) {
    if (age === "old") fhColor = OLD_HAIR;
    else {
      const hp = ops.find((o) => o.cat === "hair_back") ?? ops.find((o) => o.cat === "hair_front");
      if (hp) { const rel = hp.file.includes("/") ? hp.file : `${hp.cat}/${hp.file}`;
        try { const raw = await loadFile(rel); fhColor = await sampleColorFromDataUri(`data:image/png;base64,${raw.replace(/^data:[^,]*,/, "")}`); } catch { /* sampling best-effort */ } }
      if (!fhColor) fhColor = [96, 60, 34];   // hair suppressed (headwear): beard never raw grey
    }
  }
  const vb = manifest.viewBox.split(/\s+/).map(Number);
  const vbW = vb[2] || 512, vbH = vb[3] || 512;
  const RASTER = /\.(png|jpe?g|webp)$/i;
  const tf = (op: LayerOp): string => {
    const ts: string[] = [];
    if (op.dx || op.dy) ts.push(`translate(${op.dx} ${op.dy})`);
    if (op.flipX) ts.push(`translate(${vbW} 0) scale(-1 1)`);
    return ts.length ? ` transform="${ts.join(" ")}"` : "";
  };
  const layerOut = await Promise.all(ops.map(async (op) => {
    const rel = op.file.includes("/") ? op.file : `${op.cat}/${op.file}`;
    const raw = await loadFile(rel);
    if (RASTER.test(op.file)) {
      const mime = /\.png$/i.test(op.file) ? "image/png" : /\.webp$/i.test(op.file) ? "image/webp" : "image/jpeg";
      const b64 = raw.replace(/^data:[^,]*,/, "");
      let href = `data:${mime};base64,${b64}`;
      if (skinIdx >= 0 && skinIdx < skinTones.length && skinLayers.includes(op.cat)) href = await recolorPngDataUri(href, skinTones[skinIdx]);
      else if (op.cat === FACIAL_LAYER && fhColor) href = await recolorGreyDataUri(href, fhColor);
      if (age === "old" && AGE_HAIR_LAYERS.includes(op.cat)) href = await recolorGreyDataUri(href, OLD_HAIR, AGE_INK_FLOOR);
      return { svg: `<g data-layer="${op.cat}"${tf(op)}><image x="0" y="0" width="${vbW}" height="${vbH}" preserveAspectRatio="none" href="${href}" xlink:href="${href}"/></g>`, href };
    }
    const token = "L" + hashStr(op.cat + "/" + op.file).toString(36);
    return { svg: `<g data-layer="${op.cat}"${tf(op)}>${isolate(innerOf(raw), token)}</g>`, href: null as string | null };
  }));
  const groupsSvg = layerOut.map((l) => l.svg);
  const images = layerOut.map((l) => l.href).filter((h): h is string => !!h);
  const parts: Record<string, string> = {};
  for (const op of ops) parts[op.cat] = op.file;
  const m = manifest.meta;
  const metaComment = m?.license?.name ? `<!-- ${manifest.name ?? "pack"} | ${m.license.name} -->` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${manifest.viewBox}">${metaComment}${groupsSvg.join("")}</svg>`;
  return { svg, seed: recipe.seed, parts, colors: {}, order: ops.map((o) => o.cat), skipped: {}, images, recipe };
}
