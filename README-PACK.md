# Randomness 1.0.12 release pack

Drop this folder structure into your repo root (merges with existing).

## What's in here

### dictKey-with-spaces fix (engine + API + tests)
- src/engine/ast.ts — adds literalKey field to SubtablePickNode
- src/engine/contentParser.ts — parses [#"quoted key" Table]
- src/engine/evaluator.ts — adds runByKey for direct dict lookup
- src/api/index.ts — dictKey uses runByKey + quoted IPP3 form
- __tests__/api/dictKey.test.ts — assertion updated for new form
- __tests__/api/dictKeySpaces.test.ts — NEW: 12 tests for the fix

### Community generators feature
- src/views/settings.ts — adds Browse + Submit buttons to settings
- community-generators/README.md — folder layout + how to install + how to contribute
- .github/ISSUE_TEMPLATE/community-generator.md — matches what the Submit button pre-fills

### Docs
- API.md — adds the "Storing results in frontmatter" recipe (covers claudermilk's dataviewjs feedback loop)
- CHANGELOG.md — 1.0.12 entry

### Metadata
- manifest.json, package.json — bumped to 1.0.12
- versions.json — adds 1.0.12 entry

## Release sequence

    # 1. Drop the pack contents into the repo
    # 2. Verify locally
    npm test                  # should be 957 / 957
    npm run build

    # 3. Commit, push
    git add .
    git commit -m "Release 1.0.12: dict keys with spaces, community submissions, docs"
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
