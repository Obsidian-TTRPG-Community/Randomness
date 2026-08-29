import * as fs from "fs";
import * as path from "path";
import { parseGeneratorFile } from "../../src/engine/fileParser";
import { Evaluator } from "../../src/engine/evaluator";

const SRC = fs.readFileSync(
    path.join(
        __dirname,
        "../../community-generators/dnd-srd52-spells/Spellbook.rdm"
    ),
    "utf-8"
);

const ENTRY_TABLES = [
    "Spellbook",
    "Lowspellbook",
    "Highspellbook",
    "Clericscroll",
    "LowClericscroll",
    "HighClericscroll",
    "Bardscroll",
    "LowBardscroll",
    "HighBardscroll",
    "Druidscroll",
    "LowDruidscroll",
    "HighDruidscroll",
];

// Guards the hosted community contribution (issue #7) against
// parse-breaking edits.
describe("community Spellbook.rdm", () => {
    test("parses and rolls every entry table", () => {
        const file = parseGeneratorFile(SRC);
        for (const t of ENTRY_TABLES) {
            for (let i = 0; i < 50; i++) {
                const out = new Evaluator(file, [], {}).evalRawText(`[@${t}]`);
                expect(out.trim()).not.toBe("");
                expect(out).not.toMatch(/error|Unknown/i);
                expect(out).toMatch(/^[1-9BCD]/);
            }
        }
    });

    test("multi-pick + sort + implode works on Spellbook", () => {
        const file = parseGeneratorFile(SRC);
        const out = new Evaluator(file, [], {}).evalRawText(
            "[!8 Spellbook >> sort >> implode \\n]"
        );
        const lines = out.split("\n").filter((l) => l.trim() !== "");
        expect(lines.length).toBe(8);
        const sorted = [...lines].sort((a, b) => a.localeCompare(b));
        expect(lines).toEqual(sorted);
    });
});
