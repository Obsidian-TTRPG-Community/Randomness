# Randomness — YouTube Walkthrough Outline

**Target length:** ~22 minutes
**Audience:** newcomers, existing Obsidian users, and Dice Roller migrants (opens accessible, ramps up, migration segment near the end so it's skippable)

Each segment lists: what you *say* (the beat), what's *on screen*, and the exact examples to type live. Every example below is real plugin syntax — you can roll them on camera.

---

## 0. Cold open — the hook (0:00–0:40)

**Beat:** Don't explain. Show. Open a note that already has a sentence with a die in it, click re-roll a few times, then hit the lock. "That number is now written into my note — it survives sync, reload, everything. That's the whole idea of this plugin: randomness you can trust." 

**On screen:** A note reading `The goblin hits you for `dice: 2d6 + 3` damage.` — click 🎲 three times, then 🔒.

**Say:** "By the end of this video you'll go from rolling a single die to building your own random generators. Let's start."

---

## 1. What Randomness is (0:40–2:00)

**Beat:** One-sentence pitch: dice, rollable tables, and full random generators for Obsidian — built for TTRPGs and creative writing, simple enough for anyone. Three layers, and you only go as deep as you want.

**On screen:** Title card with the three layers: **Dice → Roll your notes → Generators.** Mention it works fully offline, no telemetry.

**Say (for migrants):** "If you're coming from the Dice Roller plugin — Randomness absorbed it. Every `dice:` roll still works. Stick around, there's a migration section near the end."

---

## 2. Install & the built-in guide (2:00–3:30)

**Beat:** Install once, then show the single best onboarding trick.

**On screen:**
1. Settings → Community plugins → Browse → "Randomness" → Install → Enable.
2. Settings → Randomness → **Install the guide** — a folder of live, rollable notes, one per feature.
3. Point out **Open reference** (searchable syntax note) and **Add examples** (five starter `.rdm` files) on the same page.

**Say:** "Everything I show you today, you can re-open in that guide and roll yourself."

---

## 3. Dice in a sentence (3:30–6:30)

**Beat:** The core move — dice live inside prose, not in a calculator.

**On screen — build these up one at a time, rolling each:**

```markdown
Basic:        `dice: 2d6 + 3`
Drop lowest:  `dice: 4d6dl1`      (classic stat roll)
Advantage:    `dice: 2d20kh`      (keep highest)
Exploding:    `dice: 4d6!`
Re-rolls:     `dice: 4d6r1`
Success count:`dice: 6d6>=5`
Percentile:   `dice: d%`
Fate/Fudge:   `dice: 4dF`
```

**Beat:** Then the two interactions that make it feel alive: 🎲 re-roll and 🔒 lock. Emphasize the lock — "the result is committed into the note text, not hidden plugin state, so it survives sync and outside edits."

---

## 4. The dice tray (6:30–8:00)

**Beat:** For people who don't want to type syntax.

**On screen:** Open the sidebar dice tray. Show pool buttons, advantage/disadvantage toggle, and saving a formula you use a lot. Optional: turn on the tumbling **dice animations** in settings and roll once for the wow factor.

---

## 5. Turn any note into a rollable table (8:00–11:30)

**Beat:** This is the "oh, I get it" moment for note-takers. You already have tables in your vault — name one and it becomes rollable.

**On screen:**

```markdown
| Tavern            |
| ----------------- |
| The Prancing Pony |
| The Drunken Goblin|

^taverns

Tonight you drink at `rdm:[@taverns]`.
```

Roll it, then lock it — show the result written back as `rdm:[@taverns]⟹The Drunken Goblin`.

**Beat — round out "roll your notes":** briefly show the other sources, no Dataview required:
- multi-column tables with **column picks** and dice-lookup rows,
- a random **line or paragraph** from any note,
- a random **#tagged note**.

---

## 6. The Generator Browser sidebar (11:30–13:30)

**Beat:** Where everything in your vault lives.

**On screen:** Open the browser pane. Show: every generator listed, roll from the pane, copy an inline call, pin a favourite. Then flip through the tabs — **Portraits**, the portrait **Builder**, and the **Dice** tray — so viewers know they exist. Do the one-click **Install portrait pack** and roll a layered character face with a rolled name.

---

## 7. Generator files — the deep end (13:30–18:30)

**Beat:** "Everything so far was inline. When you outgrow that, there's a full engine underneath — the Inspiration Pad Pro format, twenty years of community tables load as-is."

**On screen:**
1. Run the **"Create new generator file"** command — it makes and opens a starter `.rdm` (no fighting hidden file extensions).
2. Build a tiny generator live. Show, in order of "wow":
   - a **weighted table**,
   - a table **calling another table** ("rollers all the way down"),
   - a **variable** reused in the output,
   - a **prompt** (dropdown above the output),
   - one or two of the **21 filters** (e.g. capitalize / pluralize).
3. Show `Use:` importing another file, and autocomplete adding the import for you.

**Say:** "You don't need to memorize this — the reference note is searchable, and the guide walks it step by step."

---

## 8. Dice Roller migration (18:30–20:30) — *skippable card*

**Beat:** Direct address to migrants. Put a skip card up for everyone else.

**On screen:**
- Disable Dice Roller, enable Randomness — your notes don't change.
- `dice:`, `dice+:`, `dice-:`, `dice-mod:` all work with Dice Roller's own semantics; compat turns on automatically when Dice Roller isn't running.
- What's *better*: **locks** instead of fragile result saving; **tag rolls without Dataview**.
- Point to the full migration guide (`docs/migrating-from-dice-roller.md`) for the compatibility table.

---

## 9. Scripting API — teaser (20:30–21:15)

**Beat:** One line for power users. "You can roll tables from Templater or DataviewJS — seeded, prompt-controlled — and generate portraits from code. It's all in API.md." Show one short snippet on screen, don't teach it.

---

## 10. Close & CTA (21:15–22:00)

**Beat:** Recap the three layers in one breath — dice → your notes → generators. 

**CTA:** Install it, click **Install the guide**, and go roll something. Link the community plugin page and the GitHub repo in the description. Ask for a like/subscribe and invite people to share their own `.rdm` generators.

---

## Description-box checklist (fill in before upload)

- Community plugin: https://community.obsidian.md/plugins/randomness
- GitHub: https://github.com/Obsidian-TTRPG-Community/Randomness
- Timestamps (paste the section times above as chapters)
- Migration guide link
- API.md link

## Production notes

- Record at a readable zoom — inline dice spans are small; bump Obsidian font size or zoom the editor.
- Use a **dark and a light** vault theme test beforehand so the roll/lock icons read clearly on your recording.
- Pre-build the demo vault so every example rolls instantly — no typos on camera.
- Keep a "you can re-open all of this in the guide" refrain; it lowers the barrier for beginners watching a deep-dive.
