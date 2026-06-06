# Randomness 1.0.12 release pack

Drop this folder structure into your repo root (merges with existing).

## What's in here

Updated source:
- src/engine/ast.ts — adds literalKey field
- src/engine/contentParser.ts — parses [#"quoted key" Table]
- src/engine/evaluator.ts — adds runByKey for direct dict lookup
- src/api/index.ts — dictKey now uses runByKey + quoted form

Updated tests:
- __tests__/api/dictKey.test.ts — assertion updated for new quoted form
- __tests__/api/dictKeySpaces.test.ts — NEW: 12 tests for spaces/hyphens/quotes

Updated metadata:
- manifest.json, package.json — 1.0.12
- versions.json — adds 1.0.12 entry
- CHANGELOG.md — adds 1.0.12 section
- API.md — documents spaces support + quoted-key syntax

## Release sequence

    # 1. Drop the pack contents into your repo
    # 2. Verify locally
    npm test                  # should be 957 / 957
    npm run build

    # 3. Commit, push
    git add .
    git commit -m "Release 1.0.12: spaces in dictionary keys + quoted IPP3 syntax"
    git push origin main

    # 4. Tag (triggers workflow)
    git tag 1.0.12
    git push origin 1.0.12

If you need to re-release:
    git tag -d 1.0.12
    git push --delete origin 1.0.12
    # fix, commit, push
    git tag 1.0.12
    git push origin 1.0.12
