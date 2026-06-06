# Randomness 1.0.14 release pack (combined)

This pack combines all the work since 1.0.12 into a single 1.0.14
release — there's no separate 1.0.13 tag. Two large bodies of work:

1. **IPP3 compatibility fixes** (originally staged as 1.0.13) — six
   engine fixes uncovered by trying to load real community
   generators, plus two UX fixes around error display.
2. **Quality-of-life additions** (originally staged as 1.0.14) — the
   Create folder + Add examples settings buttons, five bundled
   example generators, and a thorough reference-guide rewrite.

Both ship together as 1.0.14.

## What's in the pack

### Source files (10)

- `src/engine/evaluator.ts` — case-insensitive vars, auto-roll for
  lookups w/o `Roll:`, strict marker detection (no infinite
  recursion), numeric-string coercion at variable read
- `src/engine/contentParser.ts` — `[[…]]` disambiguation
  (wiki-link vs IPP3 wrapped expression) via marker lookahead
- `src/engine/fileParser.ts` — `&` line continuation only applies
  to item lines, not directive lines
- `src/engine/expressions.ts` — (touched in earlier exploration;
  the actual fix for variable arithmetic ended up in evaluator.ts)
- `src/resolver/fileResolver.ts` — friendlier missing-`Use:` error
  with hint about community packs
- `src/views/settings.ts` — Create folder + Add examples buttons;
  community-generators section (carried from 1.0.12)
- `src/views/referenceContent.ts` — red-error fix, corrected
  syntax in existing examples, new sections (Lookup tables,
  Dictionary tables, Prompts, Variable arithmetic, Getting
  started), many more worked examples
- `src/api/index.ts` — dictKey via runByKey (from 1.0.12, included
  for completeness)
- `src/examples.ts` — NEW: 5 bundled example generators + README
  as string constants

### Tests (2 new files, 18 new tests total)

- `__tests__/integration/ipp3-compat.test.ts` — 12 regression
  tests pinning each IPP3 compatibility fix
- `__tests__/integration/bundled-examples.test.ts` — 6 tests
  verifying each shipped example produces output

### Metadata and build

- `manifest.json`, `package.json` — bumped to 1.0.14
- `versions.json` — adds 1.0.14 entry (no 1.0.13 entry, since
  that version was never tagged)
- `CHANGELOG.md` — single combined 1.0.14 section at the top
- `API.md`, `styles.css` — current versions (`styles.css` has the
  red-on-red error fix from 1.0.13)
- `main.js` — production build of all the above

## Verified

- **975 / 975 tests green** across 39 suites
- **Build clean**
- **Ultimate Powers** community generator renders complete NPCs
  (~1900 chars, math-correct stat sums, fully varied across seeds)
- **Dungeon Room Description** renders varied output (500-700
  chars across multiple seeds)
- **All 5 bundled examples** produce non-empty output across
  multiple seeds

## Release sequence

    # 1. Drop the pack contents into the repo, overwriting existing files
    cd <your-repo>
    # … copy or unzip the pack contents here …

    # 2. Verify locally
    npm install           # if package.json or lockfile differs (usually safe to skip)
    npm test              # should print: Tests: 975 passed, 975 total
    npm run build         # should produce main.js without errors

    # 3. Commit, push
    git add .
    git commit -m "Release 1.0.14: IPP3 compatibility, example generators, settings folder helpers, reference rewrite"
    git push origin main

    # 4. Tag (triggers the release workflow)
    git tag 1.0.14
    git push origin 1.0.14

Watch the Actions tab. Workflow should run for 2-3 minutes (the
`--verify-tag` + `--target` fixes from earlier should prevent the
placeholder-draft issue). On green, the release lands at
`/releases/tag/1.0.14` with `main.js`, `manifest.json`, `styles.css`
attached as loose files.

## Real-world testing

Before tagging, drop the bundled `main.js`, `manifest.json`, and
`styles.css` into a vault's plugin folder and reload Obsidian.
Try:

- Open the Randomness settings, set Generator root to a folder
  that doesn't exist yet, click **Create folder**, then click
  **Add examples**.
- Open one of the resulting example files in a vault note and
  roll the main table — should produce output immediately.
- Open the in-app reference (Command palette → "Open reference")
  and check that there's no red error box anywhere; the
  Getting started section should appear at the top.
- If you have the Ultimate Powers or Dungeon Room community
  files, drop them in your vault and confirm they render.

## One-off GitHub setup

After release, if you haven't already:

- Create a `community-generator` label in the repo (used by the
  Share-your-own submission form).
- Consider seeding `community-generators/` in the repo with one
  example contribution so first-time browsers see what a good
  submission looks like.
