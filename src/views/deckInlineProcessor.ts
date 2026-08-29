/**
 * Inline `deck:` post-processor — persistent-decks design.
 *
 * A note containing `` `deck:Tarot` `` renders as a small span
 * showing the deck's LAST DRAWN card plus a Draw button. Crucially,
 * rendering NEVER draws: passive re-renders (opening the note,
 * scrolling) must not burn cards. Only the explicit Draw click
 * advances the deck (and persists via DeckService).
 *
 * This is deliberately a separate processor from the `rdm:` inline
 * pipeline: deck spans have no preview/lock lifecycle — their state
 * lives in the deck, not in the note — so routing them through the
 * locking service would only entangle two unrelated state machines.
 */

import { MarkdownPostProcessorContext, Notice, TFile } from "obsidian";
import { makeEditorSafe } from "./editorSafeControls";
import { markdownLite, setSanitisedHtml } from "./sanitiser";
import type { DrawResult, FolderDeck } from "../decks/deckService";
import { applyFacingClass, facingLabel } from "../decks/deckModel";
import { paintCard } from "./decksTab";
import { modifyNoteUndoable } from "./inlineProcessor";
import type RandomnessPlugin from "./main";

export const DECK_INLINE_PREFIX = "deck:";
export const DECK_MOD_PREFIX = "deck-mod:";

/**
 * Highest count a span may ask for. Generous enough for any real
 * hand (a full 52-card deal included); low enough that a typo like
 * `deck:Tarot|2026` cannot ask for thousands of draws.
 */
export const MAX_DEAL = 99;

/**
 * A parsed deck call — `deck:Name`, `deck:Name|5`, `deck:Name|5|200`,
 * or the `deck-mod:` forms of the same (issue #8).
 *
 * `count` is how many cards a Deal draws (default 1). `size` is an
 * optional image width for cards baked into the note as embeds —
 * `![[card.png|200]]` — matching Obsidian's own `|200` sizing.
 * `mod` marks a `deck-mod:` call: dice-mod parity, the span deals
 * once on first render and replaces itself with the result.
 */
export interface DeckCall {
    name: string;
    count: number;
    size?: number;
    mod: boolean;
}

/** Parse the text of a `deck:`/`deck-mod:` code span. Null when it isn't one. */
export function parseDeckCall(text: string): DeckCall | null {
    let rest: string;
    let mod: boolean;
    if (text.startsWith(DECK_MOD_PREFIX)) {
        rest = text.slice(DECK_MOD_PREFIX.length);
        mod = true;
    } else if (text.startsWith(DECK_INLINE_PREFIX)) {
        rest = text.slice(DECK_INLINE_PREFIX.length);
        mod = false;
    } else {
        return null;
    }
    const parts = rest.split("|").map((p) => p.trim());
    const name = parts[0];
    // A bare `deck:` mention in prose is documentation, not a call.
    if (name === "") return null;
    // Params must be plain positive integers: first is the count,
    // second the embed width. Anything else means this isn't a call.
    const nums: number[] = [];
    for (const p of parts.slice(1)) {
        if (!/^\d+$/.test(p)) return null;
        nums.push(parseInt(p, 10));
    }
    if (nums.length > 2) return null;
    const count = nums.length >= 1 ? nums[0] : 1;
    if (count < 1 || count > MAX_DEAL) return null;
    const size = nums.length === 2 ? nums[1] : undefined;
    if (size !== undefined && size < 1) return null;
    return { name, count, ...(size !== undefined ? { size } : {}), mod };
}

/**
 * Old single-name parse, kept for its original contract: the deck
 * name of a plain one-card `deck:` span, null otherwise.
 */
export function parseDeckSpan(text: string): string | null {
    const call = parseDeckCall(text);
    if (!call || call.mod) return null;
    return call.name;
}

/**
 * Parse a ```randomness codeblock whose entire body is one
 * `deck:Name` line (comments allowed). Null when the block is a
 * normal generator — the caller falls through to the engine.
 *
 * `deck:Name|5` deals five cards per click. A `deck-mod:` line is
 * accepted but treated as a plain `deck:` — auto-bake is an inline
 * affair; codeblocks deliberately have no note-rewriting machinery.
 */
export function parseDeckBlock(source: string): DeckCall | null {
    const lines = source
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "" && !l.startsWith("//"));
    if (lines.length !== 1) return null;
    const call = parseDeckCall(lines[0]);
    if (!call) return null;
    return { ...call, mod: false };
}

/**
 * Format a dealt hand as the markdown that gets baked into the note.
 *
 * Per card: an `![[image|size]]` embed when the card has art (a
 * non-upright facing keeps its label as trailing text — CSS rotation
 * does not survive baking), otherwise `**Name (facing)** — text`,
 * the Decks tab's copy-as-text shape.
 *
 * Joined with spaces when every card baked as an image (a hand of
 * card faces in a row); with newlines as soon as any card is text,
 * so meanings don't run into each other mid-sentence.
 */
export function formatDealtHand(
    results: Pick<DrawResult, "card" | "facing" | "text">[],
    size?: number
): string {
    const pieces: string[] = [];
    let allImages = true;
    for (const r of results) {
        if (r.card.imagePath !== undefined) {
            const embed =
                "![[" +
                r.card.imagePath +
                (size !== undefined ? "|" + size : "") +
                "]]";
            const label = facingLabel(r.facing);
            pieces.push(
                label === "" ? embed : embed + " *" + label.trim() + "*"
            );
        } else {
            allImages = false;
            const label = "**" + r.card.name + facingLabel(r.facing) + "**";
            const body =
                r.text !== undefined && r.text.trim() !== ""
                    ? " — " + r.text.trim()
                    : "";
            pieces.push(label + body);
        }
    }
    return pieces.join(allImages ? " " : "\n");
}

/**
 * Replace the Nth occurrence of the codespan `` `raw` `` in a note
 * source with `text` — how a dealt hand drops out of the plugin's
 * syntax and becomes ordinary note text. Unchanged source when the
 * occurrence isn't there (caller detects via referential equality).
 */
export function bakeDeckSpanInSource(
    source: string,
    raw: string,
    occurrence: number,
    text: string
): string {
    const needle = "`" + raw + "`";
    let idx = -1;
    for (let i = 0; i <= occurrence; i++) {
        idx = source.indexOf(needle, idx + 1);
        if (idx === -1) return source;
    }
    return source.slice(0, idx) + text + source.slice(idx + needle.length);
}

/**
 * How many occurrences of `` `raw` `` sit strictly BEFORE the given
 * source line — the base occurrence index for spans inside a block
 * that starts at that line. Counting the raw text (fenced examples
 * included) is deliberate: `bakeDeckSpanInSource` counts the same
 * way, so the two always target the same span.
 */
export function deckSpanOccurrenceBase(
    source: string,
    raw: string,
    lineStart: number
): number {
    const needle = "`" + raw + "`";
    let base = 0;
    const lines = source.split("\n");
    for (let i = 0; i < lineStart && i < lines.length; i++) {
        let at = lines[i].indexOf(needle);
        while (at !== -1) {
            base++;
            at = lines[i].indexOf(needle, at + 1);
        }
    }
    return base;
}

/**
 * Block-sized deck display for a `deck:Name` codeblock: the last
 * drawn card at full card size (image, name, meaning — the Decks
 * tab's card renderer, overlay copy buttons included) plus a Draw
 * button and remaining count. Same rule as the inline span:
 * rendering NEVER draws — only the explicit click does.
 */
export async function renderDeckBlock(
    plugin: RandomnessPlugin,
    container: HTMLElement,
    call: DeckCall
): Promise<void> {
    const deckName = call.name;
    const deck = await plugin.decks.getDeck(deckName);
    const box = activeDocument.createElement("div");
    box.className = "randomness-deck-block";
    makeEditorSafe(box, { selectable: true });
    container.appendChild(box);

    if (!deck) {
        box.classList.add("randomness-error");
        box.textContent = `Unknown deck: ${deckName}`;
        return;
    }

    const cardArea = activeDocument.createElement("div");
    cardArea.className = "randomness-deck-card randomness-deck-block-card";
    if (call.count > 1) cardArea.classList.add("randomness-deck-hand");
    box.appendChild(cardArea);

    const controls = activeDocument.createElement("div");
    controls.className = "randomness-deck-block-controls";
    box.appendChild(controls);
    const drawBtn = activeDocument.createElement("button");
    drawBtn.className = "randomness-deck-button";
    drawBtn.type = "button";
    drawBtn.textContent = call.count > 1 ? `🎴 Deal ${call.count}` : "🎴 Draw";
    drawBtn.title =
        call.count > 1
            ? `Deal ${call.count} cards from ${deck.name}`
            : `Draw from ${deck.name}`;
    drawBtn.setAttribute("aria-label", drawBtn.title);
    controls.appendChild(drawBtn);
    const count = activeDocument.createElement("span");
    count.className = "randomness-deck-count";
    count.title = "Cards remaining / total";
    controls.appendChild(count);

    if (call.count > 1) {
        // Whole-hand copy — the Live Preview path to issue #8's "put
        // the dealt cards in my note": blocks render in the editor
        // but have no note-rewriting machinery, so the hand goes via
        // the clipboard instead.
        const copyBtn = activeDocument.createElement("button");
        copyBtn.className = "randomness-deck-button";
        copyBtn.type = "button";
        copyBtn.textContent = "📋 Copy hand";
        copyBtn.title =
            "Copy the dealt cards as markdown (image embeds / text)";
        copyBtn.setAttribute("aria-label", copyBtn.title);
        controls.appendChild(copyBtn);
        makeEditorSafe(copyBtn);
        copyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            void (async () => {
                const hand = await plugin.decks.lastDrawnMany(
                    deckName,
                    call.count
                );
                if (hand.length === 0) {
                    new Notice("Nothing dealt yet — Deal first.");
                    return;
                }
                await navigator.clipboard.writeText(
                    formatDealtHand(hand, call.size)
                );
                new Notice("Hand copied — paste it into a note.");
            })();
        });
    }

    const paint = async (): Promise<void> => {
        const fresh = await plugin.decks.getDeck(deckName);
        if (!fresh) return;
        count.textContent = `${fresh.state.remaining.length}/${fresh.cards.length}`;
        if (call.count === 1) {
            const last = await plugin.decks.lastDrawn(deckName);
            paintCard(
                plugin,
                cardArea,
                fresh,
                last,
                last === null ? null : "drawn"
            );
            return;
        }
        // Multi-card hand: the last `count` draws, one full-size card
        // each (overlay copy buttons included), oldest first — the
        // order they were dealt.
        const hand = await plugin.decks.lastDrawnMany(deckName, call.count);
        while (cardArea.firstChild) cardArea.removeChild(cardArea.firstChild);
        if (hand.length === 0) {
            // Nothing dealt yet: one card back, same as a fresh deck.
            const sub = activeDocument.createElement("div");
            sub.className = "randomness-deck-card";
            cardArea.appendChild(sub);
            paintCard(plugin, sub, fresh, null, null);
            return;
        }
        for (const r of hand) {
            const sub = activeDocument.createElement("div");
            sub.className = "randomness-deck-card";
            cardArea.appendChild(sub);
            paintCard(plugin, sub, fresh, r, "drawn");
        }
    };

    makeEditorSafe(drawBtn);
    drawBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        void (async () => {
            const dealt = await plugin.decks.drawMany(deckName, call.count);
            if (dealt.length === 0) {
                new Notice(
                    `"${deck.name}" is empty — shuffle to reset (Decks tab).`
                );
            } else if (dealt.length < call.count) {
                new Notice(
                    `"${deck.name}" ran out — dealt the last ${dealt.length}.`
                );
            }
            // The change notification repaints; call anyway so a
            // failed draw still refreshes the count.
            await paint();
        })();
    });

    // Track changes from anywhere (Decks tab, inline spans, commands)
    // while this block is in the document.
    const unsubscribe = plugin.decks.onChange(() => {
        if (!box.isConnected) {
            unsubscribe();
            return;
        }
        void paint();
    });

    await paint();
}

export function buildDeckInlineProcessor(plugin: RandomnessPlugin) {
    return async function process(
        el: HTMLElement,
        ctx: MarkdownPostProcessorContext
    ): Promise<void> {
        const codeNodes = Array.from(el.querySelectorAll("code")).filter(
            (c) => c.closest("pre") === null
        );
        const jobs: {
            code: HTMLElement;
            call: DeckCall;
            raw: string;
            indexInBlock: number;
        }[] = [];
        // Per-raw index within this block, so two identical spans in
        // one paragraph each target their own source occurrence.
        const seen = new Map<string, number>();
        for (const code of codeNodes) {
            const raw = code.textContent ?? "";
            const call = parseDeckCall(raw);
            if (call === null) continue;
            const idx = seen.get(raw) ?? 0;
            seen.set(raw, idx + 1);
            jobs.push({ code, call, raw, indexInBlock: idx });
        }
        if (jobs.length === 0) return;
        await Promise.all(
            jobs.map((j) =>
                renderDeckSpan(
                    plugin,
                    ctx,
                    el,
                    j.code,
                    j.call,
                    j.raw,
                    j.indexInBlock
                )
            )
        );
    };
}

/**
 * The source-level occurrence of this render's span among identical
 * `` `raw` `` codespans in the note: occurrences before the block's
 * first line (via `getSectionInfo`), plus this span's index within
 * the block. Falls back to the block-local index when there is no
 * section info (hover previews, embeds) — the old behaviour, wrong
 * only when the same raw span appears in several blocks of a note
 * rendered without section data.
 */
async function resolveDeckOccurrence(
    plugin: RandomnessPlugin,
    ctx: MarkdownPostProcessorContext,
    el: HTMLElement,
    raw: string,
    indexInBlock: number
): Promise<number> {
    try {
        const info = ctx.getSectionInfo(el);
        if (!info) return indexInBlock;
        const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!(file instanceof TFile)) return indexInBlock;
        const source = await plugin.app.vault.read(file);
        return (
            deckSpanOccurrenceBase(source, raw, info.lineStart) + indexInBlock
        );
    } catch {
        return indexInBlock;
    }
}

/**
 * Bake a dealt hand into the note, replacing this span's codespan.
 * Returns true when the note actually changed — a false means the
 * span couldn't be found in the source (edited underneath us), and
 * the caller must NOT treat the deal as committed to the note.
 */
async function bakeDeckHand(
    plugin: RandomnessPlugin,
    sourcePath: string,
    raw: string,
    occurrence: number,
    text: string
): Promise<boolean> {
    let changed = false;
    await modifyNoteUndoable(plugin, sourcePath, (source) => {
        const next = bakeDeckSpanInSource(source, raw, occurrence, text);
        changed = next !== source;
        return next;
    });
    return changed;
}

/**
 * `deck-mod:` spans currently committing, keyed sourcePath + raw.
 * Reading view renders every span in a paragraph concurrently; the
 * first one to start wins, the rest skip — the bake rewrites the
 * note, so the survivors re-render (occurrences re-computed against
 * the new source) and take their turn. Sequential-by-rerender is
 * what keeps two identical `deck-mod:` spans from racing each other
 * into the same occurrence.
 */
const modBakesInFlight = new Set<string>();

/**
 * The `deck-mod:` path — dice-mod parity for decks (issue #8): the
 * first render deals `count` cards and replaces the codespan with
 * the hand as markdown. This is the one deliberate exception to
 * "rendering never draws": like `dice-mod:`, the span destroys
 * itself in the same act, so the deal happens exactly once. If the
 * note rewrite fails or the span can't be found in the source, the
 * drawn cards are undone — the deck only advances when the note
 * really took the hand.
 */
async function autoBakeDeckMod(
    plugin: RandomnessPlugin,
    ctx: MarkdownPostProcessorContext,
    el: HTMLElement,
    codeEl: HTMLElement,
    call: DeckCall,
    raw: string,
    indexInBlock: number
): Promise<void> {
    const deck = await plugin.decks.getDeck(call.name);
    if (!deck) {
        const span = activeDocument.createElement("span");
        span.className = "randomness-inline randomness-inline-error";
        span.textContent = `[unknown deck: ${call.name}]`;
        codeEl.replaceWith(span);
        return;
    }
    const key = ctx.sourcePath + " " + raw;
    if (modBakesInFlight.has(key)) return;
    modBakesInFlight.add(key);
    try {
        const occurrence = await resolveDeckOccurrence(
            plugin,
            ctx,
            el,
            raw,
            indexInBlock
        );
        const dealt = await plugin.decks.drawMany(call.name, call.count);
        if (dealt.length === 0) {
            const span = activeDocument.createElement("span");
            span.className = "randomness-inline randomness-deck-inline";
            span.textContent = `${deck.name} is empty — shuffle to reset.`;
            codeEl.replaceWith(span);
            return;
        }
        const text = formatDealtHand(dealt, call.size);
        let committed = false;
        try {
            committed = await bakeDeckHand(
                plugin,
                ctx.sourcePath,
                raw,
                occurrence,
                text
            );
        } finally {
            if (!committed) {
                // The note didn't take the hand — put the cards back.
                for (let i = 0; i < dealt.length; i++) {
                    await plugin.decks.undo(call.name);
                }
            }
        }
        if (committed) {
            // The rewrite re-renders this paragraph momentarily;
            // show the dealt names in the meantime so nothing
            // flashes as raw syntax.
            const span = activeDocument.createElement("span");
            span.className = "randomness-inline randomness-deck-inline";
            span.textContent = dealt
                .map((r) => r.card.name + facingLabel(r.facing))
                .join(", ");
            codeEl.replaceWith(span);
        } else if (dealt.length > 0) {
            new Notice(
                `Couldn't find the deck-mod span in ${ctx.sourcePath} — no cards were drawn.`
            );
        }
    } finally {
        modBakesInFlight.delete(key);
    }
}

async function renderDeckSpan(
    plugin: RandomnessPlugin,
    ctx: MarkdownPostProcessorContext,
    el: HTMLElement,
    codeEl: HTMLElement,
    call: DeckCall,
    raw: string,
    indexInBlock: number
): Promise<void> {
    if (call.mod) {
        await autoBakeDeckMod(
            plugin,
            ctx,
            el,
            codeEl,
            call,
            raw,
            indexInBlock
        );
        return;
    }
    const deckName = call.name;
    const deck = await plugin.decks.getDeck(deckName);
    const span = activeDocument.createElement("span");
    span.className = "randomness-inline randomness-deck-inline";
    makeEditorSafe(span, { selectable: true });

    if (!deck) {
        span.classList.add("randomness-inline-error");
        span.textContent = `[unknown deck: ${deckName}]`;
        codeEl.replaceWith(span);
        return;
    }

    const drawBtn = activeDocument.createElement("button");
    drawBtn.className = "randomness-inline-button";
    drawBtn.type = "button";
    drawBtn.textContent = call.count > 1 ? `🎴×${call.count}` : "🎴";
    drawBtn.title =
        call.count > 1
            ? `Deal ${call.count} cards from ${deck.name}`
            : `Draw from ${deck.name}`;
    drawBtn.setAttribute("aria-label", drawBtn.title);
    span.appendChild(drawBtn);

    const body = activeDocument.createElement("span");
    body.className = "randomness-deck-inline-body";
    span.appendChild(body);

    // 📌 — bake the displayed hand into the note as markdown, the
    // same shape `deck-mod:` writes (issue #8). Only shown once
    // something is drawn; `paint` manages its visibility.
    const bakeBtn = activeDocument.createElement("button");
    bakeBtn.className = "randomness-inline-button";
    bakeBtn.type = "button";
    bakeBtn.textContent = "📌";
    bakeBtn.title =
        "Keep as plain text: replace this span with the drawn card" +
        (call.count > 1 ? "s" : "");
    bakeBtn.setAttribute("aria-label", bakeBtn.title);
    bakeBtn.hidden = true;
    span.appendChild(bakeBtn);

    const paint = async (): Promise<void> => {
        const fresh = await plugin.decks.getDeck(deckName);
        if (!fresh) return;
        const hand = await plugin.decks.lastDrawnMany(deckName, call.count);
        paintDeckBody(plugin, body, fresh, hand);
        bakeBtn.hidden = hand.length === 0;
    };

    makeEditorSafe(drawBtn);
    drawBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        void (async () => {
            const dealt = await plugin.decks.drawMany(deckName, call.count);
            if (dealt.length === 0) {
                // Deck exhausted — say so instead of silently doing
                // nothing; resetting is a deliberate act elsewhere.
                body.textContent = `${deck.name} is empty — shuffle to reset.`;
                return;
            }
            if (dealt.length < call.count) {
                new Notice(
                    `"${deck.name}" ran out — dealt the last ${dealt.length}.`
                );
            }
            await paint();
        })();
    });

    makeEditorSafe(bakeBtn);
    bakeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        void (async () => {
            const hand = await plugin.decks.lastDrawnMany(
                deckName,
                call.count
            );
            if (hand.length === 0) return;
            const occurrence = await resolveDeckOccurrence(
                plugin,
                ctx,
                el,
                raw,
                indexInBlock
            );
            const ok = await bakeDeckHand(
                plugin,
                ctx.sourcePath,
                raw,
                occurrence,
                formatDealtHand(hand, call.size)
            );
            if (!ok) {
                new Notice(
                    "Couldn't find this span in the note — nothing changed."
                );
            }
            // The rewrite re-renders the paragraph; no repaint needed.
        })();
    });

    // Re-paint when the deck changes from ANYWHERE (Decks tab,
    // commands, another span of the same deck) — while this span is
    // still in the document. The listener unregisters itself once
    // the span has been detached (note closed / re-rendered).
    const unsubscribe = plugin.decks.onChange(() => {
        if (!span.isConnected) {
            unsubscribe();
            return;
        }
        void paint();
    });

    await paint();
    codeEl.replaceWith(span);
}

/** Paint the span body: the drawn hand + remaining count. */
function paintDeckBody(
    plugin: RandomnessPlugin,
    body: HTMLElement,
    deck: FolderDeck,
    hand: DrawResult[]
): void {
    while (body.firstChild) body.removeChild(body.firstChild);

    if (hand.length === 0) {
        const idle = activeDocument.createElement("span");
        idle.className = "randomness-deck-inline-count";
        idle.textContent = `${deck.name} (${deck.state.remaining.length}/${deck.cards.length})`;
        body.appendChild(idle);
        return;
    }

    hand.forEach((r, i) => {
        // Card image (thumbnail) when the card has one.
        let hasImg = false;
        if (r.card.imagePath !== undefined) {
            const file = plugin.app.vault.getAbstractFileByPath(
                r.card.imagePath
            );
            if (file instanceof TFile) {
                const img = activeDocument.createElement("img");
                img.className = "randomness-deck-inline-img";
                applyFacingClass(img, r.facing);
                img.src = plugin.app.vault.getResourcePath(file);
                img.alt = r.card.name + facingLabel(r.facing);
                img.title = img.alt;
                body.appendChild(img);
                hasImg = true;
            }
        }

        // A lone card keeps its name beside the thumbnail (the
        // original span look); a multi-card hand shows thumbnails
        // only, names in their tooltips, so the line stays a line.
        if (!hasImg || hand.length === 1) {
            if (i > 0 && !hasImg) {
                body.appendChild(activeDocument.createTextNode(", "));
            }
            const nameEl = activeDocument.createElement("span");
            nameEl.className = "randomness-deck-inline-name";
            nameEl.textContent = r.card.name + facingLabel(r.facing);
            if (r.text !== undefined && r.text.trim() !== "") {
                // Card text goes into the tooltip so the span stays
                // compact; the Decks tab shows it in full.
                nameEl.title = stripHtml(r.text);
            }
            body.appendChild(nameEl);
        }
    });

    const count = activeDocument.createElement("span");
    count.className = "randomness-deck-inline-count";
    count.textContent = ` (${deck.state.remaining.length} left)`;
    body.appendChild(count);
}

/** Tooltip-safe plain text from engine HTML output. */
function stripHtml(s: string): string {
    const div = activeDocument.createElement("div");
    setSanitisedHtml(div, markdownLite(s));
    return div.textContent ?? s;
}
