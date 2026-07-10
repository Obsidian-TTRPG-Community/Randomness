/**
 * Graphical dice — Dice Roller merge, Phase 6.
 *
 * A dependency-free CSS-3D dice overlay. Dice Roller rendered rolls
 * with a three.js + cannon-es physics scene (~750 KB of dependencies)
 * in which the physics decided the result. We deliberately do the
 * opposite: the ENGINE rolls (deterministic, seed-friendly, one
 * source of truth) and this overlay only *animates* those values —
 * a tumbling 3D cube for d6s, spinning polyhedron chips with a
 * slot-machine number cycle for everything else, settling on the
 * rolled face.
 *
 * Why not port the three.js renderer: Obsidian plugins are single-file
 * CJS bundles, so esbuild cannot lazy-load a separate chunk — the full
 * port would permanently ~5× the plugin bundle and ship WebGL physics
 * we can't regression-test. The seam is here if we ever want it: this
 * module owns "show these dice values"; a photoreal backend can
 * replace the CSS one without touching any caller.
 *
 * Exposed pieces:
 *   - parsePureDiceFormula: recognise formulas that are plain sums of
 *     dice terms and constants (the only thing Dice Roller could
 *     render graphically either — "only the basic D20 set").
 *   - rollPureDiceFormula: roll such a formula through the engine's
 *     dice core, returning per-die values + the total.
 *   - showDiceOverlay: play the animation for a set of die values.
 */

import { RNG } from "../engine/rng";
import {
    parseDiceModifiers,
    rollModifiedDice,
    DiceModifiers,
    FaceSpec,
} from "../engine/dice";

// ────────────────────────────────────────────────────────────────────
// Pure-dice formula parsing & rolling (exported for tests)
// ────────────────────────────────────────────────────────────────────

export interface PureDiceTerm {
    sign: 1 | -1;
    /** Dice term parts, or a flat constant when `sides` is null. */
    count: number;
    sides: number | null;
    mods: DiceModifiers | null;
}

/**
 * Parse a formula that is nothing but `±NdX[mods] ± constant …`.
 * Returns null for anything else (tables, parens, division, special
 * dice) — callers fall back to a non-graphical roll.
 */
export function parsePureDiceFormula(raw: string): PureDiceTerm[] | null {
    const s = raw.replace(/\s+/g, "");
    if (s === "") return null;
    const terms: PureDiceTerm[] = [];
    let pos = 0;
    let sign: 1 | -1 = 1;
    while (pos < s.length) {
        if (terms.length > 0 || pos > 0) {
            const op = s[pos];
            if (op === "+") sign = 1;
            else if (op === "-") sign = -1;
            else return null;
            pos++;
        }
        const m = s.slice(pos).match(/^(\d*)[dD](\d+)/);
        if (m) {
            const count = m[1] === "" ? 1 : parseInt(m[1], 10);
            const sides = parseInt(m[2], 10);
            if (![4, 6, 8, 10, 12, 20, 100].includes(sides)) return null;
            if (count < 1 || count > 20) return null; // sane overlay cap
            pos += m[0].length;
            const { mods, pos: after } = parseDiceModifiers(s, pos);
            pos = after;
            terms.push({ sign, count, sides, mods });
        } else {
            const c = s.slice(pos).match(/^(\d+)/);
            if (!c) return null;
            pos += c[0].length;
            terms.push({
                sign,
                count: parseInt(c[1], 10),
                sides: null,
                mods: null,
            });
        }
    }
    // At least one actual die, and a cap on total dice for the overlay.
    const diceCount = terms
        .filter((t) => t.sides !== null)
        .reduce((n, t) => n + t.count, 0);
    if (diceCount === 0 || diceCount > 20) return null;
    return terms;
}

export interface OverlayDie {
    sides: number;
    value: number;
    /** False when dropped by keep/drop modifiers — rendered dimmed. */
    kept: boolean;
}

export interface PureDiceRoll {
    dice: OverlayDie[];
    total: number;
}

/** Roll a parsed pure-dice formula through the engine's dice core. */
export function rollPureDiceFormula(
    terms: PureDiceTerm[],
    rng: RNG = new RNG()
): PureDiceRoll {
    const dice: OverlayDie[] = [];
    let total = 0;
    for (const term of terms) {
        if (term.sides === null) {
            total += term.sign * term.count;
            continue;
        }
        const faces: FaceSpec = { kind: "sides", sides: term.sides };
        const outcome = rollModifiedDice(term.count, faces, term.mods, rng);
        total += term.sign * outcome.total;
        for (const d of outcome.dice) {
            dice.push({ sides: term.sides, value: d.value, kept: d.kept });
        }
    }
    return { dice, total };
}

// ────────────────────────────────────────────────────────────────────
// The overlay
// ────────────────────────────────────────────────────────────────────

/** How long dice tumble before settling. */
const TUMBLE_MS = 1100;
/** How long the settled dice stay on screen after settling. */
const LINGER_MS = 3200;

/**
 * Play the dice animation. Resolves when the dice have settled (the
 * overlay lingers a little longer, and dismisses early on click).
 * Never throws — a failure just resolves immediately so callers can
 * treat the animation as pure decoration.
 */
export function showDiceOverlay(
    dice: OverlayDie[],
    total: number | null = null
): Promise<void> {
    return new Promise((resolve) => {
        try {
            const doc = activeDocument;
            // Singleton: a fresh roll replaces any overlay still on
            // screen instead of stacking on top of it.
            for (const stale of Array.from(
                doc.querySelectorAll(".randomness-dice3d-layer")
            )) {
                stale.remove();
            }
            const layer = doc.createElement("div");
            layer.className = "randomness-dice3d-layer";
            const dismiss = () => {
                layer.remove();
            };
            layer.addEventListener("click", dismiss);
            doc.body.appendChild(layer);

            // The dimmed backdrop sits only behind the dice: a rounded
            // "dice table" card sized to its contents, not a whole-
            // screen scrim.
            const table = doc.createElement("div");
            table.className = "randomness-dice3d-table";
            layer.appendChild(table);

            const shown = dice.slice(0, 20);
            shown.forEach((die, i) => {
                table.appendChild(buildDie(doc, die, i * 70));
            });
            const maxDelay = Math.max(0, (shown.length - 1) * 70);

            // The total is known up front (the engine already rolled),
            // so reserve its space immediately — invisible until the
            // dice settle — and the card never resizes mid-animation.
            let totalEl: HTMLElement | null = null;
            if (total !== null && dice.length > 1) {
                totalEl = doc.createElement("div");
                totalEl.className = "randomness-dice3d-total is-pending";
                totalEl.textContent = `= ${total}`;
                table.appendChild(totalEl);
            }

            window.setTimeout(() => {
                // Settle: stop the number cycling, show final values.
                for (const el of Array.from(
                    layer.querySelectorAll<HTMLElement>(
                        "[data-final-value]"
                    )
                )) {
                    el.classList.add("is-settled");
                    const face = el.querySelector<HTMLElement>(
                        ".randomness-dice3d-value"
                    );
                    if (face) {
                        face.textContent =
                            el.getAttribute("data-final-value") ?? "";
                    }
                    const cycler = el.getAttribute("data-cycler");
                    if (cycler) window.clearInterval(Number(cycler));
                }
                totalEl?.classList.remove("is-pending");
                resolve();
                window.setTimeout(dismiss, LINGER_MS);
            }, TUMBLE_MS + maxDelay);
        } catch {
            // Decoration only — never block the roll on animation woes.
            resolve();
        }
    });
}

/** Build one animated die element. */
function buildDie(
    doc: Document,
    die: OverlayDie,
    delayMs = 0
): HTMLElement {
    const wrap = doc.createElement("div");
    wrap.className = `randomness-dice3d-die randomness-dice3d-d${die.sides}`;
    wrap.style.animationDelay = `${delayMs}ms`;
    if (!die.kept) wrap.classList.add("is-dropped");
    wrap.setAttribute("data-final-value", String(die.value));
    // Which die is which: a small type label under every die.
    const label = doc.createElement("div");
    label.className = "randomness-dice3d-die-label";
    label.textContent = `d${die.sides}`;

    if (die.sides === 6) {
        // A real CSS cube: six faces, tumble, land with the rolled
        // face forward. Face 1 is "front"; the settle rotation turns
        // the rolled face to the viewer.
        const cube = doc.createElement("div");
        cube.className = "randomness-dice3d-cube";
        const faces: Record<number, string> = {
            1: "front",
            2: "right",
            3: "top",
            4: "bottom",
            5: "left",
            6: "back",
        };
        for (let f = 1; f <= 6; f++) {
            const face = doc.createElement("div");
            face.className = `randomness-dice3d-face randomness-dice3d-face-${faces[f]}`;
            face.textContent = String(f);
            if (f === die.value) face.classList.add("is-target");
            cube.appendChild(face);
        }
        cube.classList.add(`randomness-dice3d-land-${die.value}`);
        cube.style.animationDelay = `${delayMs}ms`;
        wrap.appendChild(cube);
        // The cube shows its own pips; the settle handler needs a
        // value node to fill for the generic path, so add a hidden one.
        const value = doc.createElement("span");
        value.className = "randomness-dice3d-value randomness-dice3d-hidden";
        wrap.appendChild(value);
    } else {
        // Polyhedron chip: shaped by clip-path, number cycles during
        // the tumble (slot-machine), settles on the rolled value.
        const chip = doc.createElement("div");
        chip.className = "randomness-dice3d-chip";
        const value = doc.createElement("span");
        value.className = "randomness-dice3d-value";
        value.textContent = String(
            1 + Math.floor(Math.random() * die.sides)
        );
        chip.appendChild(value);
        chip.style.animationDelay = `${delayMs}ms`;
        wrap.appendChild(chip);
        const cycler = window.setInterval(() => {
            value.textContent = String(
                1 + Math.floor(Math.random() * die.sides)
            );
        }, 75);
        wrap.setAttribute("data-cycler", String(cycler));
    }
    wrap.appendChild(label);
    return wrap;
}
