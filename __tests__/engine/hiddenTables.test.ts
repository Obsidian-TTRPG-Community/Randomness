/**
 * `Hidden:` — keeping helper tables out of the generator browser.
 *
 * Requested in issue #6: a generator whose entry table calls two
 * helpers listed all three in the browser, so the useful one was
 * buried among its own plumbing.
 *
 * The flag is presentation only. Everything here that asserts a
 * hidden table STILL ROLLS is load-bearing: hiding a table must never
 * change what a generator produces, or "tidy the list" becomes "break
 * my generator".
 */

import { parseGeneratorFile } from "../../src/engine/fileParser";
import { Evaluator } from "../../src/engine/evaluator";

const roll = (src: string, table?: string): string => {
    const file = parseGeneratorFile(src);
    const e = new Evaluator(file, [], { seed: 1 });
    return table ? e.runByName(table) : e.run();
};

describe("Hidden: parsing", () => {
    test("a bare Hidden: means hidden", () => {
        const f = parseGeneratorFile("Table: T\nHidden:\nx");
        expect(f.tables[0].hidden).toBe(true);
    });

    test.each(["yes", "true", "1", "on", "YES", "True"])(
        "Hidden: %s is hidden",
        (v) => {
            expect(
                parseGeneratorFile(`Table: T\nHidden: ${v}\nx`).tables[0].hidden
            ).toBe(true);
        }
    );

    test.each(["no", "false", "0", "off", "No"])(
        "Hidden: %s is not hidden",
        (v) => {
            expect(
                parseGeneratorFile(`Table: T\nHidden: ${v}\nx`).tables[0].hidden
            ).toBe(false);
        }
    );

    test("a table with no Hidden: line is undefined, not false", () => {
        // Undefined vs false matters nowhere today, but the browser
        // filters on `=== true`, so an accidental default of false
        // would be indistinguishable — keep the three states honest.
        expect(parseGeneratorFile("Table: T\nx").tables[0].hidden).toBeUndefined();
    });

    test("only the marked table is hidden", () => {
        const f = parseGeneratorFile(
            "Table: Main\n[@Helper]\n\nTable: Helper\nHidden:\nx"
        );
        expect(f.tables.map((t) => t.hidden)).toEqual([undefined, true]);
    });

    test("a nonsense value is a parse error, not a silent guess", () => {
        expect(() => parseGeneratorFile("Table: T\nHidden: maybe\nx")).toThrow(
            /expected yes or no/i
        );
    });

    test("Hidden: outside a table is a parse error", () => {
        expect(() => parseGeneratorFile("Hidden:\nTable: T\nx")).toThrow(
            /outside a Table/i
        );
    });

    test("it does not swallow the line after it", () => {
        // Directive lines terminate at end-of-line; if `Hidden:` were
        // missing from the continuation guard, an item could be eaten.
        const f = parseGeneratorFile("Table: T\nHidden:\nfirst item");
        expect(f.tables[0].items).toHaveLength(1);
        expect(f.tables[0].items[0].rawContent).toBe("first item");
    });
});

describe("Hidden: changes nothing about rolling", () => {
    test("a hidden table still rolls when called", () => {
        expect(
            roll("Table: Main\nYou find [@Helper].\n\nTable: Helper\nHidden:\ngold")
        ).toBe("You find gold.");
    });

    test("a hidden table still rolls by name", () => {
        expect(
            roll("Table: Main\nx\n\nTable: Helper\nHidden:\ngold", "Helper")
        ).toBe("gold");
    });

    test("hiding the FIRST table does not change which one is main", () => {
        // The engine rolls the first table declared, hidden or not.
        // The browser's ★ follows the same rule.
        expect(roll("Table: Main\nHidden:\nmine\n\nTable: Other\ntheirs")).toBe(
            "mine"
        );
    });

    test("a hidden lookup table keeps its Roll: and Default:", () => {
        const src = [
            "Table: Main",
            "[@L]",
            "",
            "Table: L",
            "Hidden:",
            "Type: Lookup",
            "Roll: 1d1",
            "Default: nothing",
            "1: something",
        ].join("\n");
        expect(roll(src)).toBe("something");
    });

    test("Hidden: sits anywhere among the other table directives", () => {
        const src = [
            "Table: Main",
            "[@D]",
            "",
            "Table: D",
            "Type: Dictionary",
            "Hidden: yes",
            "key: value",
        ].join("\n");
        const f = parseGeneratorFile(src);
        expect(f.tables[1].hidden).toBe(true);
        expect(f.tables[1].type).toBe("dictionary");
    });
});
