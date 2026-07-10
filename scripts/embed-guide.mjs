// Regenerate src/views/guideContent.ts from docs/guide/*.md.
//   node scripts/embed-guide.mjs   (or: npm run embed-guide)
// docs/guide/ is the SOURCE OF TRUTH — edit those files, not the TS.
import fs from "fs";
import path from "path";

const dir = "docs/guide";
const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((name) => ({
        name,
        content: fs.readFileSync(path.join(dir, name), "utf8"),
    }));

const body = files
    .map(
        (f) =>
            `    {\n        name: ${JSON.stringify(f.name)},\n` +
            `        content: ${JSON.stringify(f.content)},\n    },`
    )
    .join("\n");

fs.writeFileSync(
    "src/views/guideContent.ts",
    [
        "/**",
        " * GENERATED FILE — do not edit.",
        " * Source: docs/guide/*.md. Regenerate: npm run embed-guide",
        " */",
        "",
        'export const GUIDE_FOLDER = "Randomness Guide";',
        "",
        "export interface GuideFile {",
        "    name: string;",
        "    content: string;",
        "}",
        "",
        "export const GUIDE_FILES: GuideFile[] = [",
        body,
        "];",
        "",
    ].join("\n")
);
console.log(`embedded ${files.length} guide files`);
