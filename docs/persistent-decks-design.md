# Persistent Decks — Design

Status: **implemented** (2026-07-14) — see CHANGELOG "Persistent decks".
Owner: Josh / Randomness plugin.

Implementation map: `src/decks/deckModel.ts` (pure state/pairing logic),
`src/decks/deckService.ts` (vault IO, hosts, persistence),
`src/views/decksTab.ts` (Decks tab), `src/views/deckInlineProcessor.ts`
(`deck:` spans), evaluator/parser hooks in `src/engine/`, example-deck
bundles in `content/decks/` with download buttons in settings.
Tests: `__tests__/decks/deckModel.test.ts`,
`__tests__/engine/persistentDecks.test.ts`.

## Problem

Deck picks (`[!Table]`) currently mirror IPP3 exactly: deck state lives on the
`Evaluator`, a fresh Evaluator is constructed per invocation (codeblock render,
inline call, API roll, browser view), and `run()` clears deck state between
top-level reps. IPP3 never persisted deck state to disk — it was a batch tool
("click Generate, whole run executes"), and `Shuffle:` exists precisely because
state does not carry over between runs.

Consequence: "draw one card now, another card tomorrow, no repeats until I
reset" is impossible today. Every single-card draw starts from a fresh, full
deck.

## Goals

- Decks whose drawn/remaining state survives across invocations and Obsidian
  restarts.
- Explicit reset ("shuffle") under user control — never implicit on draw.
- First-class tarot support (card images, upright/reversed) without
  hardcoding tarot.
- A Decks tab in the browser view to manage active decks.
- Zero behavior change for existing IPP3-authored generators: persistence is
  opt-in.

## Deck sources

### 1. Folder decks (new)

Convention: `<Generator Root>/Decks/<Deck Name>/` — each folder is one deck,
deck name = folder name.

A deck folder may contain:

- **Card images** — one image file per card (`png/jpg/jpeg/webp/gif`).
  Filename (sans extension) becomes the card name. Dropping 78 images into a
  folder is a complete, usable tarot deck with no text authoring.
- **A `.rdm` file** — textual deck. Recommended form is a
  `Type: Dictionary` table where each key is a card name and the value is the
  card text/meaning.
- **Both** — images and `.rdm` entries pair by **filename ↔ dictionary key**
  match. Matching is slug-insensitive: lowercase both sides, treat `-`/`_` as
  spaces, collapse whitespace (`the-tower.png` ↔ `The Tower`). A draw renders
  the image plus the text. Images with no matching entry are image-only
  cards; entries with no matching image are text-only cards.

### 2. In-generator persistent decks

A new table directive marks an ordinary table's deck state as persistent:

```
Table: EncounterDeck
Deck: persistent
1: Goblin ambush
1: Merchant caravan
...
```

Default (directive absent) keeps today's per-run semantics.

## State storage

**Folder decks** store state *with the deck*: `Decks/<Name>/deck.json`,
written via `vault.adapter`, debounced. The deck folder is self-contained —
copy the folder, and its settings and state travel with it (and sync across
devices with the vault).

```json
{
  "settings": { "flip": 50, "back": "_back.png" },
  "state": {
    "total": 78,
    "remaining": [0, 2, 5, ...],
    "drawn": [{ "index": 3, "facing": "reversed", "ts": 1770000000 }, ...],
    "removed": []
  }
}
```

**In-generator decks** (`Deck: persistent` tables) have no folder of their
own, so they live in a single `deck-state.json` in the plugin folder, keyed
`<generator path>::<table name>`, same state shape.
- `drawn` is ordered → gives history and undo for free.
- `removed` reserved for remove-from-game (v2).
- Stale keys (deleted decks/tables) pruned on load.
- If the card list changed since state was saved (count/name mismatch),
  invalidate and reshuffle that deck with a Notice.

## Operations

| Operation | Behavior | Where |
|---|---|---|
| Draw | Remove top card (weighted random among remaining), show it, append to `drawn` | Decks tab, `[!Deck]`, command |
| Shuffle (reset) | All cards back to `remaining`, clear `drawn` | Decks tab, command palette, `Shuffle:` directive |
| Peek | Show next card(s) without removing | Decks tab |
| Draw & replace | Show a card, leave deck state untouched | Decks tab |
| Return / undo | Pop last entry off `drawn`, back into `remaining` | Decks tab |
| Deal N | N draws at once (`[!N Deck]` already parses) | Decks tab count input, syntax |
| History | Ordered list of drawn cards | Decks tab |
| Remove from game | Card skips reshuffle (`removed`) | v2 |

## Orientation (tarot, but generic)

New directive: `Flip: 50%` (any percentage). Each draw from a flip-enabled
deck sets `$facing` to `upright` or `reversed`; item content can branch with
existing expression syntax:

```
The Tower — [when {$facing} = reversed: disaster narrowly averted…|else: sudden upheaval…]
```

Folder decks get a per-deck toggle in the Decks tab (default on for decks
named/tagged tarot? No — default off, one click to enable). Reversed image
cards render rotated 180°.

Spreads (three-card, Celtic Cross) need no engine support: they are ordinary
generators that deck-pick N cards into labeled positions.

## Decks tab (browser view)

New tab alongside the existing browser views. Per deck:

- Name, source (folder / generator), cards remaining / total, last drawn.
- Buttons: Draw, Peek, Shuffle, Draw & replace, Undo, History.
- Card display: image (if any) + rendered text, facing indicator.

## Interaction rule (important)

Persistent draws advance **only on explicit interaction** — Decks tab
buttons, commands, or a rendered Draw button in notes. Passive codeblock
re-render (note reopened, scrolled into view — see the
`stableCodeblockSeeds` concern, settings.ts:63) must never consume a card.
Codeblock/inline references to a persistent deck render the *last drawn*
card plus a Draw button rather than drawing on render.

## Evaluator changes

- `pickDeckItem` consults a plugin-level persistent store (injected via
  `EvaluatorOptions`) when the table/deck is persistent; falls back to the
  existing per-run `deckState` otherwise.
- Per-rep `deckState.clear()` (evaluator.ts:211) skips persistent decks.
- `shuffleTable()` on a persistent deck resets the persistent entry.

## Resolved decisions (2026-07-14)

- **Syntax: `deck:` prefix.** Folder decks are referenced as
  `[!deck:Tarot]`, never bare `[!Tarot]`. Rationale: folder decks would
  otherwise share the table namespace (current generator + `Use:` +
  vault-indexed tables) and a deck named like an existing table would be
  ambiguous. The prefix also signals the different semantics — persistent,
  interaction-gated draws — and lets autocomplete scope suggestions.
- **State lives with the deck.** Folder decks: `Decks/<Name>/deck.json`
  (settings + state, self-contained, syncs with vault). In-generator decks:
  plugin-folder `deck-state.json`.
- **Card back: `_back.png` reserved filename.** Any file named `_back.*` in
  a deck folder is excluded from the card list and used as the card back in
  the Decks tab and face-down peeks. When absent, render a built-in default
  back (plugin-supplied SVG/CSS placeholder).

## Later decisions

- **Inline shorthand: yes.** `deck:Tarot` in a note renders the last drawn
  card + a 🎴 Draw button (own post-processor, separate from the rdm:
  preview/lock pipeline — deck state lives in the deck, not the note).
- **Example decks (2026-07-14).** Settings buttons download example decks
  on demand — never bundled with the plugin, keeping install size small.
  Bundles live in `content/decks/` on GitHub: `playing-cards` (54 text
  cards) and `tarot-rws` (78 cards, Waite's public-domain 1911 meanings,
  `deck.json` presets flip 50%). Bundle images are fetched as binary when
  listed in `index.json`, so card art can be added to the repo later
  without code changes.

## Follow-ups

- Card art for the tarot bundle (public-domain RWS scans, e.g. Wikimedia
  Commons) added to `content/decks/tarot-rws/`.
- Remove-from-game operation (state's `removed` array is already there).
- Guide/reference embedded docs for `deck:` syntax.
