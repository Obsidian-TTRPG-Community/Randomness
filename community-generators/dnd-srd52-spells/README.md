# D&D spellbooks & scrolls (SRD 5.2)

Random spellbooks and spell scrolls for D&D 5th Edition, using **SRD
5.2 content only**. Contributed by **Brinx-git**
([issue #7](https://github.com/Obsidian-TTRPG-Community/Randomness/issues/7)).

One file, `Spellbook.rdm`, with weighted entry tables for four
classes. Each result carries its level prefix (`3 - Fireball`,
`C5 - Flame Strike`) so a rolled book reads at a glance.

| Table | What it rolls |
| --- | --- |
| `Spellbook` | Wizard spell, full level spread (1–9, weighted low) |
| `Lowspellbook` | Wizard spell, levels 1–5 |
| `Highspellbook` | Wizard spell, levels 5–9 |
| `Clericscroll` / `LowClericscroll` / `HighClericscroll` | Cleric, same three spreads |
| `Bardscroll` / `LowBardscroll` / `HighBardscroll` | Bard |
| `Druidscroll` / `LowDruidscroll` / `HighDruidscroll` | Druid |

## Use

Drop `Spellbook.rdm` anywhere in your vault. The direct wikilink
form names the file explicitly (keep the `.rdm` extension in the
link):

```text
`rdm:[[Spellbook.rdm^spellbook]]`       one wizard spell (a scroll)
`rdm:8[[Spellbook.rdm^spellbook]]`      8-spell spellbook, comma-separated
`rdm:[[Spellbook.rdm^HighDruidscroll]]` one high-level druid scroll
```

A `[[…^…]]` roll has to be the whole expression, so it can't take
filters. For an **alphabetized** book, call the table by name (found
via auto-discovery) and use the built-in `sort` filter:

```text
`rdm:[@8 Spellbook >> sort >> implode \n]`   8 spells, alphabetized, one per line
`rdm:[@5 Lowspellbook >> sort >> implode]`   5-spell starter book on one line
`rdm:[!8 First >> sort >> implode \n]`       8 DIFFERENT level-1 spells
```

`[@N …]` can repeat a spell across picks; `[!N table]` deals
without duplicates, but only within a single level table.

Sample 5-spell spellbook:

```text
1 - Find Familiar
2 - Misty Step
3 - Counterspell
3 - Fireball
5 - Telekinesis
```

> **Note on table names:** the level tables have generic names
> (`First`, `Second`, `Cleric3`, …) that auto-discovery shares
> vault-wide. If another generator in your vault also defines a
> table with one of these names, rename the tables in your copy of
> the file (there is no per-file qualification for table names).

## Author & license

- **Author:** Brinx-git
- **License:** contribution released **CC0**; spell names are SRD 5.2
  material used under **CC-BY-4.0** — see [ATTRIBUTION.md](ATTRIBUTION.md).
