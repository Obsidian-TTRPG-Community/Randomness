# 10 - Portraits

Want a random face for an NPC, plus a matching name? That's what
Portraits does. This chapter is the deep dive the tour in
[[09 - Going Further]] points at.

You can use it three ways:

- a `portrait` code block in a note
- a tiny inline `portrait:` snippet inside a sentence
- the sidebar **Portraits** and **Builder** tabs

## One-time setup

Portraits need an image pack installed first.

1. Open **Settings → Randomness**
2. Find **Install Fantasy Portrait Pack**
3. Click **Install**

If you skip this, the block shows a pointer to settings instead
of a face.

## Fastest start: one portrait block

Put this in a note (indented here so you can see it — type yours
against the left edge):

    ```portrait
    ```

That rolls one portrait at 256 px, with a rolled name for a
caption.

The block has one **⟳ Reroll** button under the grid — it rerolls
every portrait in the block. (It goes grey when the block has a
`seed:` line: a seeded block always shows the same faces, so
there's nothing to reroll.) Hover a portrait for its two corner
icons:

- **lock** (top-right) — rewrite the block to `recipe: {…}`: that
  exact portrait, set in stone, immune to pack updates. On a
  locked block the icon flips to **unlock** (roll again).
- **PNG** (top-left) — save the image next to the note **and
  replace the block with an `![[file.png]]` embed**. The block is
  gone afterwards; undo brings it back.

Want to change one feature — different hair, add a scar — rather
than reroll everything? That's the **Builder** tab in the sidebar:
every part as a dropdown, with a live preview.

## Control how many and how big

Add options inside the block:

    ```portrait
    count: 4
    size: 192
    ```

Don't put comments after a value — everything after the `:` is
the value, so a trailing note becomes part of the seed.

## Reproducible results with seeds

If you want the same faces again later, set a seed:

    ```portrait
    seed: tavern-keeper-01
    ```

With `count:` above 1, each portrait derives its own stable seed
from yours, so the whole group stays repeatable too.

## Use a specific pack

A **pack** is the portrait asset folder Randomness reads from —
the image parts (base face, eyes, hair, and so on) plus a
`manifest.json` that says how to combine them. The installed
default is `fantasy_ink_parts_pack`. If you have more than one,
point at one directly with a vault-relative folder path:

    ```portrait
    pack: my_other_pack
    count: 2
    ```

## Inline portraits in sentences

The barkeep looks like this: `portrait: tavern-keeper 96`.

- `portrait:` — random face at the default 128 px
- `portrait: gandalf` — bare word = seed (stable)
- `portrait: 96` — bare number = size in pixels
- `portrait: gandalf 96` — both
- `portrait: seed=gandalf size=96 pack=other_pack` — key=value form
- `portrait: recipe={…}` — pinned recipe; `recipe=` must be the
  LAST token, so the JSON can contain spaces

Hover for the same lock and PNG icons (PNG replaces the span with
the image embed — handy for statblock infoboxes). A reroll icon
appears too, but only on fully unpinned spans — no seed and no
recipe.

## Portrait parameter reference

### Code block (` ```portrait `)

- `count` (default `1`): portraits to render, `1`–`24`
- `size` (default `256`): tile width in pixels, `64`–`1024`
- `seed` (default none): any text; makes output deterministic
- `pack` (default from settings): vault-relative pack folder path
- `recipe` (default none): JSON recipe; renders exactly that
  portrait, with no roll controls

### Inline (`portrait:`)

- `size` (default `128`): image width in pixels, `32`–`1024`
- `seed`, `pack`: as above
- `recipe` (default none): JSON recipe — must be the last token

Numbers outside a range are clamped, not errors. Unknown keys are
ignored.

## Lock a portrait exactly (recipe)

Locking writes a `recipe` JSON — a snapshot of one final portrait
that reproduces it exactly, even after the pack updates. You
normally never type one; lock from the UI, or copy a ready-made
block or span from the Portraits tab. For the curious, the shape:

```json
{
  "v": 1,
  "seed": "70419rqu6a4mt1o3rck",
  "parts": { "base": 0, "eyes": 12, "hair_front": 9, "scars": -1 },
  "flip": { "hair_front": true },
  "jitter": { "eyes": { "dx": 1, "dy": 2 } },
  "skin": 2,
  "gender": "female",
  "age": "adult"
}
```

- `v`: recipe version (currently `1`)
- `seed`: the seed text the recipe was rolled from
- `parts`: layer choice per category — an index, or `-1` to omit
  that layer
- `flip`: whether a category is mirrored horizontally
- `jitter`: small per-feature pixel nudge (`dx`, `dy`)
- `skin` (optional): skin-tone index from the pack's tone list
- `gender` (optional): `male` or `female`
- `age` (optional): `young`, `adult`, or `old`

## Troubleshooting

- **"Portraits need a pack: set a pack folder in Settings →
  Randomness."** — install a pack in settings first.
- **"Portrait pack not found at …"** — check your `pack:` path
  spelling.
- **"bad recipe JSON: …"** — the `recipe:` text isn't valid JSON.
- **"no portrait matched the constraints in 400 tries"** (API
  scripting) — the gender/race/age filter you asked for may be
  impossible in the current pack; the race token must appear in
  the pack's base filenames.

## Where this goes next

Every option in one place: **Settings → Randomness → Open
reference**. Scripting portraits from Templater and other plugins
— constrained rolls, feeding the rolled face's facts into your
text generators — is in
[API.md](https://github.com/Obsidian-TTRPG-Community/Randomness/blob/main/API.md).

Back: [[09 - Going Further]]

*This chapter grew out of a contribution by immortel32 — thanks!*
