/**
 * Tests for the markdown codeblock extractor.
 *
 * The extractor's job is to find ```randomness ... ``` blocks in a .md
 * file and return their content concatenated as a virtual .ipt source.
 * It does NOT parse the IPP3 content — that's the file parser's job.
 *
 * Tests cover the fence-matching logic; corpus-style content is left
 * for the integration tests further down the stack.
 */

import {
    extractRandomnessCodeblocks,
    findBlocks,
} from "../../src/resolver/mdExtractor";

describe("mdExtractor: basic extraction", () => {
    test("empty input produces empty string", () => {
        expect(extractRandomnessCodeblocks("")).toBe("");
    });

    test("plain markdown with no codeblocks produces empty string", () => {
        const md = "# Hello\n\nJust some prose, nothing fenced.\n";
        expect(extractRandomnessCodeblocks(md)).toBe("");
    });

    test("single codeblock is extracted verbatim", () => {
        const md = [
            "# Notes",
            "",
            "```randomness",
            "Table: Names",
            "Alice",
            "Bob",
            "```",
            "",
            "After.",
        ].join("\n");
        expect(extractRandomnessCodeblocks(md)).toBe("Table: Names\nAlice\nBob");
    });

    test("codeblock without trailing newline still closes", () => {
        // The whole file ends mid-block; we still extract up to EOF.
        const md = "```randomness\nTable: X\n1\n2";
        // No closing fence → content runs to EOF.
        expect(extractRandomnessCodeblocks(md)).toBe("Table: X\n1\n2");
    });
});

describe("mdExtractor: fence variants", () => {
    test("tilde fences work the same way", () => {
        const md = "~~~randomness\nTable: T\nA\n~~~";
        expect(extractRandomnessCodeblocks(md)).toBe("Table: T\nA");
    });

    test("more-than-3 backticks works (CommonMark)", () => {
        const md = "````randomness\nTable: T\nA\n````";
        expect(extractRandomnessCodeblocks(md)).toBe("Table: T\nA");
    });

    test("inner triple-backticks don't close a quadruple-backtick fence", () => {
        const md = [
            "````randomness",
            "Table: T",
            "```",         // inner — should be content, not a close
            "A",
            "````",
        ].join("\n");
        expect(extractRandomnessCodeblocks(md)).toBe("Table: T\n```\nA");
    });

    test("language tag is case-insensitive", () => {
        const md = "```Randomness\nTable: T\nA\n```";
        expect(extractRandomnessCodeblocks(md)).toBe("Table: T\nA");
    });

    test("labels after colon are stripped from output but recorded", () => {
        const md = "```randomness:main\nTable: T\nA\n```";
        expect(extractRandomnessCodeblocks(md)).toBe("Table: T\nA");
        const blocks = findBlocks(md);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].label).toBe("main");
    });

    test("indented opening fence (up to 3 spaces) still matches", () => {
        const md = "   ```randomness\nA\n   ```";
        expect(extractRandomnessCodeblocks(md)).toBe("A");
    });

    test("4-space-indented fence is NOT a codeblock (it's a literal indent block)", () => {
        const md = "    ```randomness\nA\n    ```";
        // Per CommonMark, 4+ spaces is an indented codeblock — not a fence.
        expect(extractRandomnessCodeblocks(md)).toBe("");
    });

    test("non-randomness language tags are ignored", () => {
        const md = [
            "```python",
            "print('hi')",
            "```",
            "",
            "```js",
            "console.log()",
            "```",
        ].join("\n");
        expect(extractRandomnessCodeblocks(md)).toBe("");
    });
});

describe("mdExtractor: multiple blocks", () => {
    test("two codeblocks are concatenated with blank line", () => {
        const md = [
            "```randomness",
            "Table: A",
            "x",
            "```",
            "",
            "Some prose.",
            "",
            "```randomness",
            "Table: B",
            "y",
            "```",
        ].join("\n");
        const out = extractRandomnessCodeblocks(md);
        expect(out).toBe("Table: A\nx\n\nTable: B\ny");
    });

    test("findBlocks returns all blocks with line ranges", () => {
        const md = [
            "intro",
            "```randomness",   // line 1
            "A",
            "```",             // line 3
            "middle",          // line 4
            "```randomness:b", // line 5
            "B",
            "```",             // line 7
        ].join("\n");
        const blocks = findBlocks(md);
        expect(blocks).toHaveLength(2);
        expect(blocks[0].openLine).toBe(1);
        expect(blocks[0].closeLine).toBe(3);
        expect(blocks[0].label).toBeUndefined();
        expect(blocks[1].openLine).toBe(5);
        expect(blocks[1].closeLine).toBe(7);
        expect(blocks[1].label).toBe("b");
    });

    test("randomness block mixed with other languages — only randomness is extracted", () => {
        const md = [
            "```ts",
            "const x = 1;",
            "```",
            "",
            "```randomness",
            "Table: T",
            "ok",
            "```",
            "",
            "```python",
            "print('hi')",
            "```",
        ].join("\n");
        expect(extractRandomnessCodeblocks(md)).toBe("Table: T\nok");
    });
});

describe("mdExtractor: CRLF / line ending handling", () => {
    test("CRLF line endings are accepted", () => {
        const md = "```randomness\r\nTable: T\r\nA\r\n```\r\n";
        expect(extractRandomnessCodeblocks(md)).toBe("Table: T\nA");
    });

    test("mixed CRLF and LF still works", () => {
        const md = "```randomness\nTable: T\r\nA\n```";
        expect(extractRandomnessCodeblocks(md)).toBe("Table: T\nA");
    });
});

describe("mdExtractor: edge cases", () => {
    test("empty codeblock", () => {
        const md = "```randomness\n```";
        expect(extractRandomnessCodeblocks(md)).toBe("");
    });

    test("codeblock containing only blank lines", () => {
        const md = "```randomness\n\n\n```";
        expect(extractRandomnessCodeblocks(md)).toBe("\n");
    });

    test("opening fence with trailing whitespace is fine", () => {
        const md = "```randomness   \nA\n```";
        expect(extractRandomnessCodeblocks(md)).toBe("A");
    });

    test("closing fence with trailing whitespace is fine", () => {
        const md = "```randomness\nA\n```   ";
        expect(extractRandomnessCodeblocks(md)).toBe("A");
    });

    test("closing fence must have no info string", () => {
        // Per CommonMark — a closing fence with text after it isn't a close.
        const md = "```randomness\nA\n``` notclose\n```";
        // First `\`\`\` notclose` is content; second standalone ``` closes.
        expect(extractRandomnessCodeblocks(md)).toBe("A\n``` notclose");
    });
});
