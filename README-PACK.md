# Randomness 1.0.18 release pack

Bug fix release. Codeblocks that import another generator via
`Use:` and call a table from it directly (without declaring an
explicit `Table: Main`) now render correctly instead of silently
producing empty output.

## What was broken

The most common shape of a codeblock that uses an external
generator:

    ```randomness
    Use: SomeGenerator.ipt
    [@MainEntry]
    ```

…rendered nothing at all. No error, no warning, just empty. The
parser was dropping the `[@MainEntry]` line as an "orphan item"
(no preceding `Table:` declaration), so the evaluator saw zero
tables to roll and returned `""` silently.

Authoring around this required users to know to add `Table: Main`
on the line above their call — a hidden requirement that wasn't
in any documentation and that users had no way to discover from
the empty output.

## What's fixed

The parser now synthesises an implicit `__main__` table to hold
orphan items. The above codeblock now parses identically to:

    ```randomness
    Use: SomeGenerator.ipt
    Table: __main__
    [@MainEntry]
    ```

…which is what the user obviously meant. The evaluator picks
`__main__` as the file's main entry (it's `tables[0]`) and rolls
it normally.

Files that declare their main table explicitly are unaffected.
The change is purely additive: previously-broken codeblocks now
work, previously-working files keep working.

## What's in the pack (8 files)

- `src/engine/fileParser.ts` — the parser fix
- `__tests__/engine/fileParser.test.ts` — 5 new parser tests
- `__tests__/integration/codeblock-implicit-main.test.ts` — 4 new
  integration tests exercising the codeblock scenario end-to-end
- `manifest.json`, `package.json` — version → 1.0.18
- `versions.json` — adds 1.0.18 entry
- `CHANGELOG.md` — 1.0.18 entry at top
- `main.js` — production build

## Verified

- **984 / 984 tests green** (was 975 in 1.0.17; +9 new tests)
- **Production build clean**

## Release sequence

    # 1. Extract the pack into your repo root, overwriting matching
    #    files.

    # 2. Verify
    npm test          # should print: Tests: 984 passed, 984 total
    npm run build     # clean

    # 3. Commit, push
    git add .
    git commit -m "Release 1.0.18: implicit __main__ table for orphan codeblock items"
    git push origin main

    # 4. Tag
    git tag 1.0.18
    git push origin 1.0.18
