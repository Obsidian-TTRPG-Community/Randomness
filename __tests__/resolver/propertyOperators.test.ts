import { Evaluator } from "../../src/engine/evaluator";
import { translateDiceExpression } from "../../src/compat/diceCompat";
import { inMemorySource } from "../../src/resolver/fileResolver";
import { matchesTagRollFilter, parseDirectTagCall } from "../../src/resolver/mdContent";
import { buildInlineBundle } from "../../src/resolver/scope";

function matches(segment: string, metadata: Record<string, unknown>): boolean {
    const query = parseDirectTagCall(`*|${segment}|link`);
    if (!query) throw new Error(`Fixture did not parse: ${segment}`);
    return matchesTagRollFilter(new Set(), metadata, query.filter);
}

describe("numeric property comparisons", () => {
    test.each([
        [">", 3, false], [">", 4, true], [">", 2, false],
        [">=", 3, true], [">=", 2, false],
        ["<", 3, false], ["<", 2, true], ["<", 4, false],
        ["<=", 3, true], ["<=", 4, false],
    ])("cr%s3 with %s matches %s", (operator, value, expected) => {
        expect(matches(`cr${operator}3`, { cr: value })).toBe(expected);
        expect(matches(` CR ${operator} 3 `, { cr: String(value) })).toBe(expected);
    });

    test("compare numbers, not lexicographic strings", () => {
        expect(matches("cr>2", { cr: "10" })).toBe(true);
        expect(matches("cr<-0.5", { cr: "-1.25" })).toBe(true);
        expect(matches("cr>=1e2", { cr: 100 })).toBe(true);
        expect(matches("cr<=.5", { cr: 0.5 })).toBe(true);
    });

    test.each([null, undefined, "", " ", "3 goblins", "0x10", true, {}, NaN, Infinity])(
        "exclude nonnumeric property %j", (value) => {
            expect(matches("cr>=0", { cr: value })).toBe(false);
        }
    );

    test("missing values fail; any numeric list item or threshold can match", () => {
        expect(matches("cr>0", {})).toBe(false);
        expect(matches("cr>3", { cr: ["unknown", "4"] })).toBe(true);
        expect(matches("cr>3,10", { cr: 4 })).toBe(true);
        expect(matches("cr>3|cr<5", { cr: 4 })).toBe(true);
        expect(matches("cr>3|cr<5", { cr: 6 })).toBe(false);
    });

    test.each(["cr>", "cr>=nope", "cr<=Infinity", "cr>3,nope", "folder>3", "types has", "folder has x"])(
        "invalid operator input reports an error: %s", (segment) => {
            expect(() => parseDirectTagCall(`*|${segment}|link`)).toThrow();
        }
    );
});

describe("list membership", () => {
    test("case-insensitive whole-item match, not substrings or scalar text", () => {
        expect(matches("types has undead", { Types: ["Fey", "Undead"] })).toBe(true);
        expect(matches("types HAS undead", { types: ["undead warrior"] })).toBe(false);
        expect(matches("types HAS undead", { types: ["Undead"] })).toBe(true);
        expect(matches("types has undead", { types: "undead" })).toBe(false);
        expect(matches("types has undead", { types: [] })).toBe(false);
        expect(matches("types has undead", {})).toBe(false);
    });

    test("OR values, numbers, wikilink names and aliases retain equality forms", () => {
        expect(matches("types has undead,fey", { types: ["fey"] })).toBe(true);
        expect(matches("levels has 3", { levels: [3] })).toBe(true);
        expect(matches("worlds has Eldara", { worlds: ["[[Worlds/Eldara|The Realm]]"] })).toBe(true);
        expect(matches("worlds has The Realm", { worlds: ["[[Worlds/Eldara|The Realm]]"] })).toBe(true);
        expect(matches("types has *", { types: ["fey"] })).toBe(false);
        expect(matches("types has *", { types: ["*"] })).toBe(true);
        expect(matches("types has a=b", { types: ["a=b"] })).toBe(true);
    });

    test("existing equality and existence remain unchanged", () => {
        expect(matches("types=undead", { types: "undead" })).toBe(true);
        expect(matches("types=*", { types: ["fey"] })).toBe(true);
        expect(matches("title=has undead", { title: "has undead" })).toBe(true);
        expect(parseDirectTagCall("*|challenge-rating>=3|link")?.filter.props)
            .toEqual([{ key: "challenge-rating", values: ["3"], operator: ">=" }]);
    });
});

describe("operator queries through inline rolls", () => {
    const metadata: Record<string, Record<string, unknown>> = {
        "A.md": { cr: 2, types: ["undead"] },
        "B.md": { cr: 4, types: ["undead"] },
        "C.md": { cr: 6, types: ["fey"] },
    };
    const files = (filter: Parameters<typeof matchesTagRollFilter>[2]) =>
        Object.keys(metadata).filter((path) =>
            matchesTagRollFilter(new Set(["monster"]), metadata[path], filter, path)
        );

    test("same matches under rdm and dice compatibility", () => {
        const source = "#monster|cr>3|cr<=5|types has undead|prop:{{name}} CR {{cr}}";
        const query = parseDirectTagCall(source);
        expect(query?.label).toBe("#monster|cr>3|cr<=5|types has undead");
        expect(translateDiceExpression(source).expr).toBe(source);
        const inline = buildInlineBundle(source, {
            notePath: "Note.md", noteSource: "", source: inMemorySource({}),
            tagFiles: files, tagFrontmatter: (path) => metadata[path],
        });
        expect(new Evaluator(inline.main, inline.extras).run()).toBe("B CR 4");
    });

    test("prop template content is not parsed as a filter", () => {
        const query = parseDirectTagCall("#monster|prop:{{name}} has undead > 3");
        expect(query?.filter.props).toEqual([]);
        expect(query?.template).toBe("{{name}} has undead > 3");
    });
});
