/**
 * Decks tab — persistent-decks design: the management UI for folder
 * decks (`<Generator Root>/Decks/<Name>/`).
 *
 * Per deck: name, cards remaining / total, the last drawn card
 * (image + text, facing-aware), draw / peek / draw-&-bury / undo /
 * shuffle controls, a flip-percentage setting, and the draw history.
 *
 * All state changes go through DeckService — this module never
 * touches deck.json itself — and the whole tab re-paints off the
 * service's change notifications, so draws made from inline spans
 * or commands show up here immediately.
 */

import { Notice, TFile } from "obsidian";
import type { DrawResult, FolderDeck } from "../decks/deckService";
import { markdownLite, setSanitisedHtmlWithLinks } from "./sanitiser";
import { overlayIconButton } from "../portrait/ui";
import type RandomnessPlugin from "./main";

export function renderDecksTab(
    plugin: RandomnessPlugin,
    container: HTMLElement
): void {
    const repaint = (): void => {
        void paintAll(plugin, container);
    };
    const unsubscribe = plugin.decks.onChange(() => {
        if (!container.isConnected) {
            unsubscribe();
            return;
        }
        repaint();
    });
    repaint();
}

async function paintAll(
    plugin: RandomnessPlugin,
    container: HTMLElement
): Promise<void> {
    const decks = await plugin.decks.listDecks();

    // Anchor the scroll position: the whole tab repaints on every
    // deck action, and emptying the container collapses the content
    // height, which clamps the scrolling ancestor's scrollTop to 0 —
    // the "every button press jumps back to the top" bug. Capture
    // before clearing, restore after painting (and once more on the
    // next frame, for card images that lay out late).
    const scroller = findScroller(container);
    const scrollTop = scroller?.scrollTop ?? 0;

    // The list call is async; the tab may have been detached or
    // re-painted meanwhile. Last writer wins is fine for a sidebar.
    while (container.firstChild) container.removeChild(container.firstChild);

    const header = el(container, "div", "randomness-browser-header");
    const h = activeDocument.createElement("h3");
    h.textContent = "Decks";
    header.appendChild(h);

    if (decks.length === 0) {
        const empty = el(container, "div", "randomness-browser-empty");
        const folder = plugin.decks.decksFolderPath();
        empty.textContent =
            `No decks found. Create a folder under "${folder}/" — ` +
            `each folder is a deck: drop in one image per card and/or ` +
            `a .rdm file (Type: Dictionary) with card text. ` +
            `A "_back" image becomes the card back.`;
        return;
    }

    // Collapse all / expand all — with several decks the tab gets
    // long; collapsed decks shrink to their title row. Per-deck
    // state persists in settings (collapsedDecks) so it survives
    // reloads.
    const actions = el(header, "div", "randomness-browser-header-actions");
    const allCollapsed = decks.every((d) =>
        plugin.settings.collapsedDecks.includes(d.name)
    );
    const toggleAll = activeDocument.createElement("button");
    toggleAll.className = "randomness-browser-collapse-all";
    toggleAll.textContent = allCollapsed ? "Expand all" : "Collapse all";
    toggleAll.addEventListener("click", () => {
        plugin.settings.collapsedDecks = allCollapsed
            ? []
            : decks.map((d) => d.name).sort();
        void plugin.saveSettings().then(() => paintAll(plugin, container));
    });
    actions.appendChild(toggleAll);

    for (const deck of decks) {
        await paintDeck(plugin, container, deck);
    }

    if (scroller !== null) {
        scroller.scrollTop = scrollTop;
        activeWindow.requestAnimationFrame(() => {
            scroller.scrollTop = scrollTop;
        });
    }
}

/**
 * Nearest ancestor that actually scrolls this element (including the
 * element itself). Heuristic: the first node whose content overflows
 * its box. In the sidebar that's Obsidian's view content element.
 */
function findScroller(fromEl: HTMLElement): HTMLElement | null {
    let node: HTMLElement | null = fromEl;
    while (node !== null) {
        if (node.scrollHeight > node.clientHeight + 1) return node;
        node = node.parentElement;
    }
    return null;
}

async function paintDeck(
    plugin: RandomnessPlugin,
    container: HTMLElement,
    deck: FolderDeck
): Promise<void> {
    const collapsed = plugin.settings.collapsedDecks.includes(deck.name);
    const box = el(container, "div", "randomness-deck");
    if (collapsed) box.classList.add("is-collapsed");

    // ── Title row (click to collapse/expand) ────────────────────────
    const titleRow = el(box, "div", "randomness-deck-title");
    titleRow.title = collapsed
        ? "Click to expand this deck"
        : "Click to collapse this deck";
    const chevron = el(titleRow, "span", "randomness-deck-chevron");
    chevron.textContent = collapsed ? "▸" : "▾";
    const name = el(titleRow, "span", "randomness-deck-name");
    name.textContent = deck.name;
    const count = el(titleRow, "span", "randomness-deck-count");
    count.textContent = `${deck.state.remaining.length}/${deck.cards.length}`;
    count.title = "Cards remaining / total";
    titleRow.addEventListener("click", () => {
        const set = new Set(plugin.settings.collapsedDecks);
        if (set.has(deck.name)) set.delete(deck.name);
        else set.add(deck.name);
        plugin.settings.collapsedDecks = [...set].sort();
        void plugin.saveSettings().then(() => paintAll(plugin, container));
    });

    // Collapsed: just the title row — name and remaining count.
    if (collapsed) return;

    // ── Card display: last drawn ────────────────────────────────────
    const cardArea = el(box, "div", "randomness-deck-card");
    const last = await plugin.decks.lastDrawn(deck.name);
    paintCard(plugin, cardArea, deck, last, last === null ? null : "drawn");

    // ── Controls ────────────────────────────────────────────────────
    const controls = el(box, "div", "randomness-deck-controls");
    const button = (
        label: string,
        title: string,
        onClick: () => Promise<void>
    ): HTMLButtonElement => {
        const b = activeDocument.createElement("button");
        b.className = "randomness-deck-button";
        b.type = "button";
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", (e) => {
            e.preventDefault();
            void onClick();
        });
        controls.appendChild(b);
        return b;
    };

    button("Draw", "Draw the top card", async () => {
        const r = await plugin.decks.draw(deck.name);
        if (r === null) {
            new Notice(`"${deck.name}" is empty — shuffle to reset.`);
        }
        // Repaint arrives via the service's change notification.
    });
    button("Peek", "Look at the next card without drawing it", async () => {
        const peeked = await plugin.decks.peek(deck.name, 1);
        if (peeked.length === 0) {
            new Notice(`"${deck.name}" is empty.`);
            return;
        }
        paintCard(plugin, cardArea, deck, peeked[0], "peek");
    });
    button(
        "Draw & bury",
        "Reveal the top card, then slide it back in at a random spot",
        async () => {
            const r = await plugin.decks.drawAndReplace(deck.name);
            if (r === null) {
                new Notice(`"${deck.name}" is empty.`);
                return;
            }
            paintCard(plugin, cardArea, deck, r, "buried");
        }
    );
    button("Undo", "Put the last drawn card back on top", async () => {
        const r = await plugin.decks.undo(deck.name);
        if (r === null) new Notice(`Nothing to undo in "${deck.name}".`);
    });
    button("Shuffle", "Reset: every card back in, history cleared", async () => {
        await plugin.decks.shuffle(deck.name);
        new Notice(`Shuffled "${deck.name}".`);
    });

    // ── Flip setting ────────────────────────────────────────────────
    const flipRow = el(box, "div", "randomness-deck-flip");
    const flipLabel = activeDocument.createElement("label");
    flipLabel.textContent = "Reversed chance % ";
    flipLabel.title =
        "Tarot-style orientation: percent chance a draw comes up " +
        "reversed. 0 disables. Card text can branch on {$facing}.";
    const flipInput = activeDocument.createElement("input");
    flipInput.type = "number";
    flipInput.min = "0";
    flipInput.max = "100";
    flipInput.value = String(deck.settings.flip);
    flipInput.className = "randomness-deck-flip-input";
    flipInput.addEventListener("change", () => {
        const v = Math.max(0, Math.min(100, Number(flipInput.value) || 0));
        void plugin.decks.updateSettings(deck.name, { flip: v });
    });
    flipLabel.appendChild(flipInput);
    flipRow.appendChild(flipLabel);

    // ── History ─────────────────────────────────────────────────────
    if (deck.state.drawn.length > 0) {
        const details = activeDocument.createElement("details");
        details.className = "randomness-deck-history";
        const summary = activeDocument.createElement("summary");
        summary.textContent = `History (${deck.state.drawn.length})`;
        details.appendChild(summary);
        const list = activeDocument.createElement("ol");
        for (const rec of deck.state.drawn) {
            const li = activeDocument.createElement("li");
            const card = deck.cards[rec.index];
            li.textContent =
                (card?.name ?? `#${rec.index}`) +
                (rec.facing === "reversed" ? " (reversed)" : "");
            list.appendChild(li);
        }
        details.appendChild(list);
        box.appendChild(details);
    }
}

/**
 * Paint a card into the display area. `mode` labels where the card
 * came from (drawn / peek / buried) so peeks are visibly not draws;
 * null mode = empty state ("card back" placeholder). Exported for
 * the `deck:` codeblock display, which shows the same card at block
 * size.
 */
export function paintCard(
    plugin: RandomnessPlugin,
    area: HTMLElement,
    deck: FolderDeck,
    result: DrawResult | null,
    mode: "drawn" | "peek" | "buried" | null
): void {
    while (area.firstChild) area.removeChild(area.firstChild);

    if (result === null || mode === null) {
        // Empty state: the deck's card back (or the built-in default).
        const backEl = el(area, "div", "randomness-deck-back");
        const backFile =
            deck.backImagePath !== undefined
                ? plugin.app.vault.getAbstractFileByPath(deck.backImagePath)
                : null;
        if (backFile instanceof TFile) {
            const img = activeDocument.createElement("img");
            img.className = "randomness-deck-card-img";
            img.src = plugin.app.vault.getResourcePath(backFile);
            img.alt = `${deck.name} card back`;
            backEl.appendChild(img);
        } else {
            // Built-in default back: pure CSS card shape.
            const ph = el(backEl, "div", "randomness-deck-back-default");
            ph.textContent = "🂠";
        }
        const hint = el(area, "div", "randomness-deck-card-hint");
        hint.textContent = "No card drawn yet.";
        return;
    }

    if (mode !== "drawn") {
        const badge = el(area, "div", "randomness-deck-card-badge");
        badge.textContent = mode === "peek" ? "Peek — not drawn" : "Buried back into the deck";
    }

    const { card, facing, text } = result;

    // ── Overlay actions — same affordance as portrait tiles: icon
    // buttons fade in when hovering the card. ──────────────────────
    if (card.imagePath !== undefined) {
        const imagePath = card.imagePath;
        overlayIconButton(
            area,
            "image",
            "Copy this card as an ![[image]] embed",
            "top-left",
            () => {
                void navigator.clipboard.writeText(`![[${imagePath}]]`);
                new Notice("Card image embed copied.");
            }
        );
    }
    overlayIconButton(
        area,
        "copy",
        "Copy as a ```randomness deck block (big card + Draw button)",
        "top-right",
        () => {
            void navigator.clipboard.writeText(
                "```randomness\ndeck:" + deck.name + "\n```"
            );
            new Notice("Deck block copied — paste it into a note.");
        }
    );
    overlayIconButton(
        area,
        "file-text",
        "Copy the card as text (name + meaning)",
        "bottom-left",
        () => {
            const label =
                card.name + (facing === "reversed" ? " (reversed)" : "");
            const body =
                text !== undefined && text.trim() !== ""
                    ? ` — ${text.trim()}`
                    : "";
            void navigator.clipboard.writeText(`**${label}**${body}`);
            new Notice("Card copied as text.");
        },
        true
    );
    overlayIconButton(
        area,
        "code",
        "Copy an inline `deck:" + deck.name + "` span (compact 🎴 in a line)",
        "bottom-right",
        () => {
            void navigator.clipboard.writeText("`deck:" + deck.name + "`");
            new Notice("Inline deck span copied.");
        },
        true
    );

    if (card.imagePath !== undefined) {
        const file = plugin.app.vault.getAbstractFileByPath(card.imagePath);
        if (file instanceof TFile) {
            const img = activeDocument.createElement("img");
            img.className = "randomness-deck-card-img";
            if (facing === "reversed") img.classList.add("is-reversed");
            img.src = plugin.app.vault.getResourcePath(file);
            img.alt = card.name;
            area.appendChild(img);
        }
    }
    const title = el(area, "div", "randomness-deck-card-name");
    title.textContent =
        card.name + (facing === "reversed" ? " (reversed)" : "");
    if (text !== undefined && text.trim() !== "") {
        const textEl = el(area, "div", "randomness-deck-card-text");
        setSanitisedHtmlWithLinks(
            textEl,
            markdownLite(text),
            plugin,
            deck.rdmPath ?? deck.folderPath
        );
    }
}

function el(
    parent: HTMLElement,
    tag: string,
    className: string
): HTMLElement {
    const e = activeDocument.createElement(tag);
    e.className = className;
    parent.appendChild(e);
    return e;
}
