# Randomness 1.0.16 release pack

Warning-cleanup release. Addresses all warnings flagged by the
Obsidian community plugin automated review of 1.0.15. No errors
in that review — listing is not at risk; this is the follow-up
cleanup release.

## What's in here

### Source changes — Category A (47 sites)
- `src/views/browserView.ts`, `codeblockProcessor.ts`,
  `inlineProcessor.ts`, `iptView.ts`, `obsidianLinks.ts`,
  `promptUI.ts`, `referenceView.ts`, `sanitiser.ts`,
  `tableAutocomplete.ts` — `document` → `activeDocument` for
  popout-window compatibility
- `src/api/index.ts`, `src/views/browserView.ts` —
  `globalThis` → `window` for browser-API feature detection

### Source changes — Category D (filters.ts refactor)
- `src/engine/filters.ts` — `require()` → static `import` (the
  "circular dep" the lazy require was working around no longer
  exists). Knocks out the require warning AND ~15 unsafe-any
  cascades it caused.

### Source changes — Category B & F (cleanup)
- `src/engine/evaluator.ts` — removed unused `FilterCall`,
  `FilterValue` imports
- `src/views/inlineProcessor.ts` — removed unused `PreviewRegistry`
  import; converted `querySelector` cast to generic parameter
- `src/views/browserView.ts` — converted three unnecessary
  type assertions to generic parameters
- `src/resolver/vaultIndex.ts` — removed unused `folderOf` helper
- `src/views/tableAutocomplete.ts` — removed unused `lineCount`
  local

### Source changes — Category E (settings.ts)
- `src/views/settings.ts` — `catch (e: any)` → `catch (e: unknown)`
  with a small `errorMessage` helper

### Source changes — Category G (promise handling)
- `src/views/inlineProcessor.ts` — async event handlers replaced
  with sync handlers + `void` on the async call
- `src/views/obsidianLinks.ts` — `openLinkText` result voided
- `src/views/main.ts` — `onunload` no longer `async` (body has
  no async work; matches base-class signature)

### Source changes — Category C (escapes)
- `src/engine/contentParser.ts` — `\/` → `/` in regex
- `src/engine/fileParser.ts` — `\&` → `&` in regex
- `src/views/referenceContent.ts` — removed unnecessary `\|` in
  markdown table (inside backtick spans, which GFM treats opaquely)

### Tests
- `jest.setup.ts` — polyfills `activeDocument` / `activeWindow`
  for jsdom-based view tests. Wired via `setupFiles` in
  `jest.config.js`.
- `__mocks__/obsidian.ts` — comment note about where the polyfill
  lives (kept the mock itself unchanged)

### Metadata + build
- `manifest.json`, `package.json` — bumped to 1.0.16
- `versions.json` — adds 1.0.16 entry (minAppVersion still 1.7.2)
- `CHANGELOG.md` — 1.0.16 section at top
- `main.js` — production build of all the above

## Verified

- **975 / 975 tests green** — no behaviour regressions
- **Production build clean** — `npm run build` succeeds without errors
- **All 8 warning-flag patterns absent from source** (verified
  via per-category grep sweep)

## Release sequence

    # 1. Drop the pack contents into the repo, overwriting existing files
    # (note: this includes jest.config.js and a new jest.setup.ts at the repo root)

    # 2. Verify locally
    npm test          # should be 975 / 975
    npm run build     # clean

    # 3. Commit, push
    git add .
    git commit -m "Release 1.0.16: warning cleanup — activeDocument, type tightening, dead-code removal"
    git push origin main

    # 4. Tag (triggers workflow)
    git tag 1.0.16
    git push origin 1.0.16
