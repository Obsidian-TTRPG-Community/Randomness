/**
 * Engine-side persistent-deck tests: the `Deck:` / `Flip:` directives,
 * host-backed deck picks for `Deck: persistent` tables, `{$facing}`
 * branching, and the `[!deck:Name]` folder-deck call.
 */

import { parseGeneratorFile, ParseError } from "../../src/engine/fileParser";
import {
    Evaluator,
    FolderDeckHost,
    TableDeckHost,
} from "../../src/engine/evaluator";

describe("Deck: / Flip: directives", () => {
    test("Deck: persistent sets the flag", () => {
        const f = parseGeneratorFile(
            "Table: Cards\nDeck: persistent\nAce\nKing\n"
        );
        expect(f.tables[0].deckPersistent).toBe(true);
    });

    test("Deck: session is explicit default", () => {
        const f = parseGeneratorFile("Table: Cards\nDeck: session\nAce\n");
        expect(f.tables[0].deckPersistent).toBe(false);
    });

    test("Deck: with junk throws a ParseError", () => {
        expect(() =>
            parseGeneratorFile("Table: Cards\nDeck: forever\nAce\n")
        ).toThrow(ParseError);
    });

    test("Flip: accepts 50 and 50%", () => {
        expect(
            parseGeneratorFile("Table: T\nFlip: 50%\nx\n").tables[0].flipChance
        ).toBe(50);
        expect(
            parseGeneratorFile("Table: T\nFlip: 25\nx\n").tables[0].flipChance
        ).toBe(25);
    });

    test("Flip: out of range throws", () => {
        expect(() =>
            parseGeneratorFile("Table: T\nFlip: 150%\nx\n")
        ).toThrow(ParseError);
    });

    test("directives outside a table throw", () => {
        expect(() => parseGeneratorFile("Deck: persistent\n")).toThrow(
            ParseError
        );
        expect(() => parseGeneratorFile("Flip: 50%\n")).toThrow(ParseError);
    });
});

describe("persistent table decks draw through the host", () => {
    const source = [
        "Table: Main",
        "[!Cards]",
        "",
        "Table: Cards",
        "Deck: persistent",
        "Ace",
        "King",
        "Queen",
    ].join("\n");

    function hostDrawing(sequence: number[]): TableDeckHost & {
        draws: string[];
        resets: string[];
    } {
        let i = 0;
        const rec = {
            draws: [] as string[],
            resets: [] as string[],
            draw(tableName: string, weights: number[]): number | null {
                rec.draws.push(tableName);
                expect(weights).toEqual([1, 1, 1]);
                return i < sequence.length ? sequence[i++] : null;
            },
            reset(tableName: string): void {
                rec.resets.push(tableName);
            },
        };
        return rec;
    }

    test("host indices decide the cards; exhausted host ends draws", () => {
        const file = parseGeneratorFile(source);
        const host = hostDrawing([2]);
        const out = new Evaluator(file, [], { deckHost: host }).run();
        expect(out).toBe("Queen");
        expect(host.draws).toEqual(["Cards"]);
    });

    test("without a host, persistent tables fall back to per-run decks", () => {
        const file = parseGeneratorFile(source);
        // No host passed: must not throw, draws like a normal deck pick.
        const out = new Evaluator(file, [], { seed: 42 }).run();
        expect(["Ace", "King", "Queen"]).toContain(out);
    });

    test("Shuffle: on a persistent table resets through the host", () => {
        const shuffling = [
            "Table: Main",
            "Shuffle: Cards",
            "[!Cards]",
            "",
            "Table: Cards",
            "Deck: persistent",
            "Ace",
            "King",
            "Queen",
        ].join("\n");
        const file = parseGeneratorFile(shuffling);
        const host = hostDrawing([0]);
        new Evaluator(file, [], { deckHost: host }).run();
        expect(host.resets).toEqual(["Cards"]);
    });
});

describe("Flip: sets {$facing} per deck pick", () => {
    const source = [
        "Table: Main",
        "[!Cards]",
        "",
        "Table: Cards",
        "Flip: 100%",
        "The Tower — [when]{$facing}=reversed[do]upheaval averted[else]sudden upheaval[end]",
    ].join("\n");

    test("100% flip always reads reversed", () => {
        const file = parseGeneratorFile(source);
        const out = new Evaluator(file, [], { seed: 7 }).run();
        expect(out).toBe("The Tower — upheaval averted");
    });

    test("0%-equivalent (no Flip:) leaves facing to presetVars", () => {
        const noFlip = source.replace("Flip: 100%\n", "");
        const file = parseGeneratorFile(noFlip);
        const out = new Evaluator(file, [], {
            seed: 7,
            presetVars: { facing: "reversed" },
        }).run();
        expect(out).toBe("The Tower — upheaval averted");
    });
});

describe("[!deck:Name] folder-deck calls", () => {
    function fakeFolderHost(): FolderDeckHost & {
        drawCount: number;
        resets: string[];
    } {
        const cards = ["The Tower", "The Moon"];
        const rec = {
            drawCount: 0,
            resets: [] as string[],
            exists: (name: string) => name === "Tarot",
            draw(name: string): string | null {
                if (name !== "Tarot") return null;
                return rec.drawCount < cards.length
                    ? cards[rec.drawCount++]
                    : null;
            },
            reset(name: string): void {
                rec.resets.push(name);
            },
        };
        return rec;
    }

    test("draws through the host", () => {
        const file = parseGeneratorFile("Table: Main\n[!deck:Tarot]\n");
        const host = fakeFolderHost();
        const out = new Evaluator(file, [], { folderDeckHost: host }).run();
        expect(out).toBe("The Tower");
        expect(host.drawCount).toBe(1);
    });

    test("multi-draw respects reps and stops at exhaustion", () => {
        const file = parseGeneratorFile(
            "Table: Main\n[!5 deck:Tarot >> implode]\n"
        );
        const host = fakeFolderHost();
        const out = new Evaluator(file, [], { folderDeckHost: host }).run();
        expect(out).toBe("The Tower, The Moon");
    });

    test("unknown deck name throws a clear error", () => {
        const file = parseGeneratorFile("Table: Main\n[!deck:Nope]\n");
        expect(() =>
            new Evaluator(file, [], { folderDeckHost: fakeFolderHost() }).run()
        ).toThrow(/Unknown deck: Nope/);
    });

    test("no host at all throws a context error", () => {
        const file = parseGeneratorFile("Table: Main\n[!deck:Tarot]\n");
        expect(() => new Evaluator(file, [], {}).run()).toThrow(
            /aren't available in this context/
        );
    });

    test("Shuffle: deck:Name resets the folder deck", () => {
        const file = parseGeneratorFile(
            "Table: Main\nShuffle: deck:Tarot\n[!deck:Tarot]\n"
        );
        const host = fakeFolderHost();
        new Evaluator(file, [], { folderDeckHost: host }).run();
        expect(host.resets).toEqual(["Tarot"]);
    });

    test("deck: names never collide with tables of the same name", () => {
        // A table literally named "Tarot" must not shadow deck:Tarot.
        const file = parseGeneratorFile(
            "Table: Main\n[!deck:Tarot] vs [!Tarot]\n\nTable: Tarot\ntable-result\n"
        );
        const host = fakeFolderHost();
        const out = new Evaluator(file, [], {
            folderDeckHost: host,
            seed: 1,
        }).run();
        expect(out).toBe("The Tower vs table-result");
    });
});
