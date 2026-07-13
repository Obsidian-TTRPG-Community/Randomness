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

import { MarkdownPostProcessorContext, TFile } from "obsidian";
import { markdownLite, setSanitisedHtml } from "./sanitiser";
import type { DrawResult, FolderDeck } from "../decks/deckService";
import type RandomnessPlugin from "./main";

export const DECK_INLINE_PREFIX = "deck:";

/** Parse the text of a `deck:` code span. Null when it isn't one. */
export function parseDeckSpan(text: string): string | null {
    if (!text.startsWith(DECK_INLINE_PREFIX)) return null;
    const name = text.slice(DECK_INLINE_PREFIX.length).trim();
    // A bare `deck:` mention in prose is documentation, not a call.
    return name === "" ? null : name;
}

export function buildDeckInlineProcessor(plugin: RandomnessPlugin) {
    return async function process(
        el: HTMLElement,
        _ctx: MarkdownPostProcessorContext
    ): Promise<void> {
        const codeNodes = Array.from(el.querySelectorAll("code")).filter(
            (c) => c.closest("pre") === null
        );
        const jobs: { code: HTMLElement; deckName: string }[] = [];
        for (const code of codeNodes) {
            const name = parseDeckSpan(code.textContent ?? "");
            if (name !== null) jobs.push({ code, deckName: name });
        }
        if (jobs.length === 0) return;
        await Promise.all(
            jobs.map((j) => renderDeckSpan(plugin, j.code, j.deckName))
        );
    };
}

async function renderDeckSpan(
    plugin: RandomnessPlugin,
    codeEl: HTMLElement,
    deckName: string
): Promise<void> {
    const deck = await plugin.decks.getDeck(deckName);
    const span = activeDocument.createElement("span");
    span.className = "randomness-inline randomness-deck-inline";

    if (!deck) {
        span.classList.add("randomness-inline-error");
        span.textContent = `[unknown deck: ${deckName}]`;
        codeEl.replaceWith(span);
        return;
    }

    const drawBtn = activeDocument.createElement("button");
    drawBtn.className = "randomness-inline-button";
    drawBtn.type = "button";
    drawBtn.textContent = "🎴";
    drawBtn.title = `Draw from ${deck.name}`;
    drawBtn.setAttribute("aria-label", drawBtn.title);
    span.appendChild(drawBtn);

    const body = activeDocument.createElement("span");
    body.className = "randomness-deck-inline-body";
    span.appendChild(body);

    const paint = async (): Promise<void> => {
        const fresh = await plugin.decks.getDeck(deckName);
        if (!fresh) return;
        const last = await plugin.decks.lastDrawn(deckName);
        paintDeckBody(plugin, body, fresh, last);
    };

    drawBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        void (async () => {
            const result = await plugin.decks.draw(deckName);
            if (result === null) {
                // Deck exhausted — say so instead of silently doing
                // nothing; resetting is a deliberate act elsewhere.
                body.textContent = `${deck.name} is empty — shuffle to reset.`;
                return;
            }
            await paint();
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

/** Paint the span body: last drawn card + remaining count. */
function paintDeckBody(
    plugin: RandomnessPlugin,
    body: HTMLElement,
    deck: FolderDeck,
    last: DrawResult | null
): void {
    while (body.firstChild) body.removeChild(body.firstChild);

    if (last === null) {
        const idle = activeDocument.createElement("span");
        idle.className = "randomness-deck-inline-count";
        idle.textContent = `${deck.name} (${deck.state.remaining.length}/${deck.cards.length})`;
        body.appendChild(idle);
        return;
    }

    // Card image (thumbnail) when the card has one.
    if (last.card.imagePath !== undefined) {
        const file = plugin.app.vault.getAbstractFileByPath(
            last.card.imagePath
        );
        if (file instanceof TFile) {
            const img = activeDocument.createElement("img");
            img.className = "randomness-deck-inline-img";
            if (last.facing === "reversed") {
                img.classList.add("is-reversed");
            }
            img.src = plugin.app.vault.getResourcePath(file);
            img.alt = last.card.name;
            body.appendChild(img);
        }
    }

    const nameEl = activeDocument.createElement("span");
    nameEl.className = "randomness-deck-inline-name";
    nameEl.textContent =
        last.card.name + (last.facing === "reversed" ? " (reversed)" : "");
    if (last.text !== undefined && last.text.trim() !== "") {
        // Card text goes into the tooltip so the span stays compact;
        // the Decks tab shows it in full.
        nameEl.title = stripHtml(last.text);
    }
    body.appendChild(nameEl);

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
