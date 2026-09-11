# Quarter-turn decks in Randomness (1.21.0)

Some card decks put a reading on every edge of a square card — Story
Engine, oracle tiles, map tiles. Draw a card, and whichever edge ends
up on top is the result. Randomness can now do that turn for you: a
deck can be flagged to turn its cards *half* (upright or reversed,
tarot-style) or *quarter* (any of four ways), with a chance of being
turned at all. No need to make four copies of every image.

## 1. Build the deck folder

One image per card, in `Decks/<Name>/` under your Generator root
(or `Decks/<Name>/` at the vault root if you haven't set one). Add a
`.rdm` file with the same name as the folder if you want text for
each card.

```text
Decks/
  Story Cards/
    _back.png            (optional card back)
    Threshold.png
    Bargain.png
    Storm.png
    Story Cards.rdm
```

## 2. Write the card text (optional)

Each card is a dictionary entry keyed by its image name. `{$facing}`
tells you which way the card landed — `upright`, `right` (90°
clockwise, so the card's left edge is on top), `reversed` or `left` —
and `{$turn}` is the same thing as a number, 0–3 quarter turns
clockwise. The neat way to give each edge its own reading is a small
dictionary per card, looked up by facing:

```text
Table: Story Cards
Type: dictionary
Turn: quarter

Threshold: [#{$facing} threshold]
Bargain: [#{$facing} bargain]
Storm: [when]{$facing}=upright[do]It breaks tomorrow[else]It broke last night[end]

Table: threshold
Type: dictionary
Hidden:
upright: A door that was always here
right: A door only one person can see
reversed: A door that has just closed
left: A door that leads somewhere it shouldn't

Table: bargain
Type: dictionary
Hidden:
upright: A fair trade
right: A trade with a hidden cost
reversed: A trade already broken
left: A trade nobody remembers making
```

(`Hidden:` just keeps the helper tables out of the browser list.
A plain `[when]…[else]…[end]` is fine when two readings are enough,
as on Storm — but don't nest one inside another; use a lookup
table like the ones above instead.)

`Turn: quarter` means every draw is turned to a random one of the
four orientations. `Turn: quarter 50%` turns only half of them (the
rest stay upright). `Turn: half` is the old tarot behaviour, the same
as `Flip: 50%`, which still works.

## 3. Draw

Any of these draws from the same persistent deck — the image rotates
to match the orientation, and the name gets a `(right)`,
`(reversed)` or `(left)` suffix:

```text
`deck:Story Cards`          inline — compact 🎴 with the last card
[!deck:Story Cards]         from inside any generator table
```

````text
```randomness
deck:Story Cards
```
````

Or open the sidebar **Decks** tab and press **Draw**. The tab also
holds the two orientation controls, which override whatever the
`.rdm` said for this vault (saved in the deck's `deck.json`):

- **Turns** — `half (reversed)` or `quarter (4 ways)`.
- **Turn chance %** — how often a draw is turned at all. 0 switches
  orientation off.

So a deck of plain images with no `.rdm` at all works too: set Turns
to quarter and chance to 100 in the tab and you're rolling tiles.

## Map tiles

The same setup handles random dungeon or hex tiles: one image per
tile, `Turn: quarter`, and each draw hands you a tile in a random
rotation. Use **Draw & bury** in the Decks tab if you want tiles to
be reusable rather than consumed, or **Shuffle** to reset the deck.

## Notes

- Existing tarot decks and `deck.json` files need no changes — a deck
  with no `Turn` setting behaves as `half`.
- Rotation is done to the image, so it looks right on square cards.
  A portrait card turned a quarter will poke out of its box a little.
- `{$facing}` and `{$turn}` also work for in-generator decks
  (`Deck: persistent` tables) that carry a `Turn:` line.
