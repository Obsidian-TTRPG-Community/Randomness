# Dice Roller retirement kit

Ready-to-use materials for winding down the
`Obsidian-TTRPG-Community/dice-roller` repository once the merged
Randomness release ships. Three artifacts: a README banner, final
release notes, and an in-app deprecation Notice patch.

## Checklist

1. Ship the Randomness release containing the merge (see
   `RELEASE_NOTES_v1.3.0.md`).
2. In the dice-roller repo: add the README banner (below), cut the
   final release with the notes (below), optionally ship the tiny
   deprecation-Notice patch (below) as that release.
3. Wait a release cycle for feedback, then archive the repo
   (Settings → Archive this repository). Archived repos stay
   installable for existing users; the README banner does the
   redirecting.
4. Update the community plugin listing description to point at
   Randomness. (The listing itself can stay — removing it strands
   existing installs.)

---

## 1. README banner (paste at the very top of dice-roller's README)

```markdown
> [!IMPORTANT]
> **Dice Roller has moved into [Randomness](https://github.com/Obsidian-TTRPG-Community/Randomness).**
> Everything this plugin did — inline rolls, all modifiers, table/section/tag
> rolls, the dice view, graphical dice — now lives in Randomness, with the
> same `dice:` syntax plus durable result-locking, random generators, and
> more. Your notes work unchanged: disable Dice Roller, enable Randomness,
> done. See the [migration guide](https://github.com/Obsidian-TTRPG-Community/Randomness/blob/main/docs/migrating-from-dice-roller.md).
> This repository is retired and no longer receives updates.
```

## 2. Final release notes (dice-roller's last release)

```markdown
# Dice Roller has a new home

This is the final release of Dice Roller. The plugin has been merged
into **[Randomness](https://github.com/Obsidian-TTRPG-Community/Randomness)**,
which we also maintain — one plugin, one engine, actively developed.

**Your notes don't change.** Randomness reads the same `dice:` syntax
(plus `dice+:`, `dice-:`, `dice-mod:`): all dice modifiers and special
dice, table rolls via `[[Note^block-id]]`, section/line rolls, tag
rolls (no Dataview required any more), saved formulas, a dice tray,
and graphical rolls. On top of that you get result **locks** (rolls
committed into the note itself — they survive sync), random
generators, and a scripting API.

**To switch:** disable Dice Roller, install/enable Randomness. It
detects the handover and takes over `dice:` spans automatically.
Migration guide:
https://github.com/Obsidian-TTRPG-Community/Randomness/blob/main/docs/migrating-from-dice-roller.md

This release adds a one-time notice pointing at the new home and
changes nothing else. The repository will be archived after a
transition period; existing installs keep working indefinitely.

Thanks to Jeremy Valentine for building Dice Roller, and to everyone
who used and contributed to it. 🎲
```

## 3. Deprecation Notice patch (optional final release content)

Add to dice-roller's `main.ts` `onload()` — a once-per-install notice,
soft enough not to nag:

```ts
// Final release: point users at the merged plugin, once.
const NOTICE_KEY = "dice-roller-retirement-notice-shown";
this.app.workspace.onLayoutReady(async () => {
    const data = (await this.loadData()) ?? {};
    if (data[NOTICE_KEY]) return;
    data[NOTICE_KEY] = true;
    await this.saveData(data);
    new Notice(
        "Dice Roller has moved into the Randomness plugin — same dice: " +
            "syntax, actively maintained. This plugin keeps working but " +
            "no longer receives updates. See the repo README to migrate.",
        15000
    );
});
```

## Timing note

Keep the `dice:` compatibility layer in Randomness permanently — it
is the migration story. There is no deadline by which users must
switch; archived Dice Roller keeps functioning, it just stops
improving.
