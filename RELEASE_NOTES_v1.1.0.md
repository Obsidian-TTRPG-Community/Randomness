# Randomness v1.1.0

**The portraits release.** Randomness can now roll layered character
portraits — seeded faces with engine-rolled names — everywhere it rolls
text, plus a one-click content pipeline that turns an empty vault into
a working town generator.

## Highlights

- **Portraits** (optional, off until installed): `portrait` codeblocks,
  inline `portrait:` spans for infoboxes, a roller and a part-by-part
  builder as tabs in the generator browser. Lock any face into a
  drift-proof recipe, export PNGs, or copy ready-to-paste snippets.
  Gender-aware art selection, race/gender-appropriate names, age and
  skin-tone axes. Install with one click from settings (~60 MB art
  pack, downloaded on demand — the plugin stays small).
- **Fantasy Hub**: a town's worth of generators (five stocked shop
  types, tavern, inn, temple, castle, guild, barracks, market and
  more) plus standalone Templater templates that build whole keyed
  location notes — portrait NPC infoboxes included, one person
  coherent across each note. Installs from settings; templates land
  in your Templater folder.
- **Reference 2.0**: the in-app reference is now a real vault note
  with LIVE examples — codeblocks that roll in place, an inline-scope
  demo, live portraits.
- **Scripting API 1.2.0**: `api.portraits.*` (constrained rolls,
  render, savePng, snippets) and `api.randomNote(folder)` for rolling
  random notes from folders. See API.md.
- **Engine**: prompts now also seed label-named variables
  (`{$keeperName}`) for position-independent fact passing; manifest
  `meta.genderLean` weighting; pack installs from release `.zip`
  assets.

## Upgrade notes

- Everything new is additive; existing generators, codeblocks and
  inline calls behave exactly as before.
- Portrait features stay invisible until a pack is installed
  (Settings → Randomness → Install Fantasy Portrait Pack).
- API consumers: `api.version` is now `1.2.0` (additive minor).
