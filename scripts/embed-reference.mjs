// Regenerate src/views/referenceContent.ts from docs/reference.md.
//   node scripts/embed-reference.mjs   (or: npm run embed-reference)
// docs/reference.md is the SOURCE OF TRUTH — edit it, not the TS file.
import fs from "fs";

const md = fs.readFileSync("docs/reference.md", "utf8");
let h = 0x811c9dc5;
for (let i = 0; i < md.length; i++) {
    h ^= md.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
}
const version = (h >>> 0).toString(36);

fs.writeFileSync(
    "src/views/referenceContent.ts",
    [
        "/**",
        " * GENERATED FILE — do not edit.",
        " * Source: docs/reference.md. Regenerate: npm run embed-reference",
        " */",
        "",
        `export const REFERENCE_VERSION = ${JSON.stringify(version)};`,
        "",
        `export const REFERENCE_MARKDOWN: string = ${JSON.stringify(md)};`,
        "",
    ].join("\n")
);
console.log(`embedded docs/reference.md (version ${version})`);
