# Fantasy Hub — shops, places & NPCs

A complete town's worth of content for **Randomness**, and the showcase
for what the engine can do: 33 generator files (`.rdm`) (five fully-stocked shop
types with PF2e price lists, plus barracks, castle, dock, farm, inn,
manor, market, mill, stable, tavern, temple, thieves' guild, mage tower
and undertaker) and 15 one-click **Templater templates** that build a
whole keyed location note — rolled name, proprietor, prices, stock,
hooks — with a portrait infobox and named NPC faces when a portrait
pack is installed.

## Install

Settings → Randomness → **Install Fantasy Hub content** (downloads this
folder into your vault), or copy the `generators/` and `templates/`
folders in manually. Put `generators/` somewhere your **Generator root**
can see (or set the root to it).

## Use

- **Templates** (requires the Templater plugin): point Templater at the
  installed `templates/` folder (or copy them into your own), create an
  empty note, insert e.g. *Tavern* — it asks for the town name and
  size, rolls everything else, and renames the note. No other plugin
  needed.
- **Codeblocks / inline, no Templater:**
  ````
  ```randomness
  Use: shop.rdm
  [@FantasyShop]
  ```
  ````
- **API:** `await api.rollUnscoped("TF-Tavern", { promptValues: { town: "Havenash" } })`

## Using with Town Forge

Two template sets ship in this bundle — same locations, different
drivers:

- **`templates/`** — standalone: trigger one in an empty note, it asks
  for the town and size and rolls everything else. No other plugin
  needed (besides Templater).
- **`townforge-templates/`** — for [Town Forge](obsidian://show-plugin?id=town-forge):
  these use `{{name}}` / `{{town}}` / `{{subtype}}` / `{{size}}`
  placeholders and never prompt, so Town Forge can stamp a whole town
  of keyed location notes in one go. Two settings make this work:
  1. **Town Forge → Template folder** → the installed
     `townforge-templates` folder (forward slashes, e.g.
     `Generators/fantasy-hub/townforge-templates`).
  2. **Templater → "Trigger Templater on new file creation"** → ON —
     Town Forge creates the notes; this is what makes Templater run
     the template code inside them. (Fresh Templater installs have it
     off.)

Don't point Town Forge at `templates/` — those prompt interactively
and roll their own names, which fights Town Forge's own naming.

## One person across the whole note

Every place generator accepts optional prompts (`keeperName`,
`keeperRace`, `keeperGender`, `keeperAge`, `keeperDesc`; shops also
`custName`/`custRace`/`custDesc`) — the templates roll one portrait NPC
and pass their facts in, so the infobox face, the proprietor line, and
the quotes all describe the same person. Rolled without those prompts,
every generator rolls its own people exactly as before.

## Optional extras

- **Portrait pack** (Settings → Randomness): NPC faces, infoboxes, and
  the "faces" sections in templates. Without it, templates emit text
  only.
- **ITS theme**: styles the `[!infobox]` callouts; they degrade to
  plain callouts otherwise.
- **Heraldry Weaver**: renders the crest in Castle / Thieves' Guild.

## Attribution

See `generators/ATTRIBUTION.md`. Item lists are drawn from the PF2e
SRD; see that file for license details.
