# Randomness 1.0.15 release pack

Compliance release. Fixes every error flagged by the Obsidian
community plugin automated review of 1.0.14. The plugin was
delisted pending a passing review; tagging this should restore
listing.

## What's in here

### Source changes
- `src/engine/filters.ts` — eslint-disable comment now has
  justification text (`-- intentional lazy require to break
  circular dep with contentParser`)
- `src/views/browserView.ts` — `revealLeaf` awaited;
  `htmlToPlainText` uses DOMParser instead of innerHTML;
  `.style.cursor = "pointer"` replaced with
  `.addClass("randomness-clickable")`
- `src/views/referenceView.ts` — `revealLeaf` awaited in both
  the existing-leaf path and the new-leaf path
- `src/views/sanitiser.ts` — `sanitiseHtmlToFragment` uses
  DOMParser instead of `template.innerHTML`
- `src/views/settings.ts` — removed `console.error` +
  no-console eslint-disable from `seedExampleGenerators`;
  first failure message now surfaces in the Notice itself

### Metadata
- `manifest.json` — version → 1.0.15, minAppVersion → 1.7.2
  (required for the new async `revealLeaf` signature)
- `package.json` — version → 1.0.15
- `versions.json` — adds 1.0.15 entry pointing at 1.7.2
- `CHANGELOG.md` — 1.0.15 section at top
- `styles.css` — adds `.randomness-clickable` utility class
- `main.js` — production build

## What this fixes from the review

| Reviewer error | Status |
| --- | --- |
| `filters.ts:41` undescribed directive comment | ✅ added justification |
| `settings.ts:464` undescribed directive comment | ✅ removed entirely |
| `browserView.ts:708` direct style assignment | ✅ CSS class |
| `browserView.ts:1134, 1144` newer API than minAppVersion | ✅ bumped minAppVersion to 1.7.2 |
| `referenceView.ts:108, 119` newer API than minAppVersion | ✅ same |
| `browserView.ts:1197` unsafe innerHTML | ✅ DOMParser |
| `sanitiser.ts:117` unsafe innerHTML | ✅ DOMParser |
| `settings.ts:464` disabling no-console | ✅ removed |

## Verified

- **975 / 975 tests green** (no regressions from any of the fixes)
- **Build clean**
- **All 8 reviewer-flagged error patterns are absent from the
  source** (verified via grep)

## Warnings deferred

The same review flagged ~80 warnings. They don't block listing
and are scheduled for a 1.0.16 cleanup release. Most are
mechanical (`document` → `activeDocument`, `globalThis` →
`window`/`activeWindow`, unsafe-any in filters.ts).

## Release sequence

    # 1. Drop the pack contents into the repo, overwriting existing files
    npm test          # should be 975 / 975
    npm run build     # clean

    # 2. Commit, push
    git add .
    git commit -m "Release 1.0.15: review compliance — address all errors from 1.0.14 review"
    git push origin main

    # 3. Tag (triggers workflow)
    git tag 1.0.15
    git push origin 1.0.15

After the workflow ships the release, the listing should
re-process. If you need to manually re-trigger a review,
that's done through the obsidian-releases repo (the same
process as the initial submission).

## Note on minAppVersion bump

Bumping from 1.4.0 to 1.7.2 narrows the supported Obsidian
versions. This is necessary — `revealLeaf` became async in
1.7.2, and the lint rule was right to flag that we were
using a signature newer than our declared compat. Users on
Obsidian < 1.7.2 will see the plugin as incompatible in their
community-plugin list; that's accurate.
