# Randomness v0.7.0

Full implementation and documentation of the public **JavaScript API**,
plus an expanded **PF2e settlement generator library**.

## Highlights

### JS API (surface version 1.0.0) — fully implemented and documented
Every method of the public API is implemented, covered by 64 dedicated
tests, and documented in **`API.md`**. Other plugins and Templater
scripts can roll generators via `app.plugins.plugins["randomness"].api`.

- **`rollUnscoped(name, opts?)`** — roll a generator found anywhere in
  the vault, ignoring note scope. The method to use for note generation
  and automation (e.g. a Templater template building a note from a
  shared generator library, where there's no note scope wired up).
- **Scoped `roll(name, opts?)`** for rolling in a note's context.
- **`promptValues`** — override a generator's prompts by label, so a
  caller can feed in context (town, names, types, …).
- **`seed`** — deterministic, reproducible rolls.
- **`filePath`** — disambiguate when two files define the same table.
- **Ambiguity warning** — `rollUnscoped` now logs a clear console
  warning (naming the colliding files) when a table name is defined in
  more than one file, instead of silently picking one.
- **`tablesWithSources()`** — list tables with their source files; the
  go-to diagnostic for "why did I get the wrong generator?"
- **`onRoll(cb)`** — subscribe to every roll attempt.
- **"Rebuild generator index"** command to rescan the library.

### PF2e settlement generator library
A drop-in generator set (`pf2e-settlement-generators.zip`) covering a
whole town, all `TF-` namespaced and driveable from the API with
`town` / `shopType` / `shopName` prompts:

- **Shops:** general, weapon, armor, alchemy, magic (`TF-Shop` random,
  or per-type). `TF-ShopPick` (emits `subtype|name`) and
  `TF-ShopByType` for coherent name↔type note generation.
- **Locations:** inn, tavern, stable, market, temple, castle, manor,
  wizard's tower, undertaker, barracks, dock, mill, farm.
- **Guilds:** six categories (craft, religious, military, criminal,
  arcane, civic), each spanning a good→murky→dark slant.
  `TF-GuildPick` / `TF-GuildByType` mirror the shop pattern.
- **Standalone names** for note titles: `TF-CastleName`, `TF-InnName`,
  `TF-BarracksName`, `TF-ThievesGuildName`, … one per type.
- **Umbrella pickers:** `TF-Location` (anything) / `TF-Place` (non-shop).

## Install (plugin)

**Manual:** download `main.js`, `manifest.json`, and `styles.css` (or
`randomness-0.7.0.zip`) into `<vault>/.obsidian/plugins/randomness/`,
then enable in Settings → Community plugins.

**BRAT:** add the repo; BRAT picks up the release assets.

## Install (generators, optional)

Unzip `pf2e-settlement-generators.zip` into your vault (e.g. under your
generator root), then run **Rebuild generator index**.

## Assets

- `main.js`, `manifest.json`, `styles.css` — plugin install files
  (also bundled as `randomness-0.7.0.zip`)
- `pf2e-settlement-generators.zip` — the generator library
- `API.md`, `CHANGELOG.md` — documentation

## Tests

939 passing across 35 suites, including 64 dedicated API tests.

## Thanks

🙏 [@pjjelly17](https://github.com/pjjelly17) — whose PR #1 proposed the
public JS API that this release builds on and documents.
