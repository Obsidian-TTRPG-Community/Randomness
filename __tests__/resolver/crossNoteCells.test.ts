/**
 * Tables that roll on tables in OTHER notes.
 *
 * Dice Roller rendered every result through MarkdownRenderer, so a
 * `dice:` span sitting in a table cell came alive as a nested roller
 * and table-refers-to-table worked for free. We don't revive spans in
 * results (recursion + lock targeting), so the span is translated at
 * extraction time instead — and the note it names has to be pulled
 * into scope by both resolution seams.
 *
 * What these pin:
 *   1. The nested roll works end to end, across notes.
 *   2. It calls the table in the note it NAMED — a same-named table in
 *      the calling note does not get to answer.
 *   3. Two notes rolling on each other resolve; that's a sheet, not an
 *      import cycle.
 *   4. Repetitions, column picks and `|sep:` glue survive the rewrite.
 *   5. The async prefetcher walks the same refs as the sync resolver
 *      (the seam that broke cross-note rolls in Phase 2 — a full
 *      inMemorySource hides it, so it needs its own test).
 *   6. A note that isn't there fails legibly, and doesn't take the
 *      rest of the sheet down with it.
 */

import {
    prefetchUseGraph,
    inMemoryAsyncSource,
} from "../../src/resolver/asyncPrefetcher";
import { inMemorySource } from "../../src/resolver/fileResolver";
import {
    humaniseQualifiedTables,
    qualifiedTableName,
} from "../../src/resolver/mdContent";
import { buildInlineBundle } from "../../src/resolver/scope";
import { Evaluator } from "../../src/engine/evaluator";

const MONSTERS = [
    "| Monster | Mood |",
    "| ------- | ---- |",
    "| Goblin  | wary |",
    "",
    "^mon",
].join("\n");

/** Encounters, whose one row rolls on a table in Monsters. */
const ENCOUNTERS = [
    "| Encounter |",
    "| --------- |",
    "| You meet `dice: [[Monsters#^mon|Monster]]` |",
    "",
    "^enc",
].join("\n");

function roll(
    expr: string,
    files: Record<string, string>,
    seed = 1,
    noteSource = ""
): string {
    const bundle = buildInlineBundle(expr, {
        notePath: "Vault/NPC.md",
        noteSource,
        source: inMemorySource(files),
    });
    return new Evaluator(bundle.main, bundle.extras, { seed }).run();
}

describe("a cell that rolls on another note's table", () => {
    test("rolls, instead of printing itself", () => {
        expect(
            roll("[[Encounters^enc]]", {
                "Vault/Encounters.md": ENCOUNTERS,
                "Vault/Monsters.md": MONSTERS,
            })
        ).toBe("You meet Goblin");
    });

    test("works under the rdm: prefix too", () => {
        const enc = [
            "| Encounter |",
            "| --------- |",
            "| You meet `rdm:[[Monsters^mon|Monster]]` |",
            "",
            "^enc",
        ].join("\n");
        expect(
            roll("[[Encounters^enc]]", {
                "Vault/Encounters.md": enc,
                "Vault/Monsters.md": MONSTERS,
            })
        ).toBe("You meet Goblin");
    });

    test("reaches the note it named, not a same-named table nearby", () => {
        // Encounters has its OWN ^mon. The cell said Monsters, so
        // Monsters is what answers — this is the whole reason the
        // rewrite emits a qualified name.
        const enc = [
            "| Encounter |",
            "| --------- |",
            "| You meet `dice: [[Monsters#^mon|Monster]]` |",
            "",
            "^enc",
            "",
            "| Monster |",
            "| ------- |",
            "| Kobold  |",
            "",
            "^mon",
        ].join("\n");
        for (let seed = 1; seed <= 20; seed++) {
            expect(
                roll(
                    "[[Encounters^enc]]",
                    {
                        "Vault/Encounters.md": enc,
                        "Vault/Monsters.md": MONSTERS,
                    },
                    seed
                )
            ).toBe("You meet Goblin");
        }
    });

    test("a local table of the same name still answers its own note", () => {
        // The qualified alias is additive: the plain name keeps working
        // for the note that owns it.
        expect(
            roll("[[Monsters^mon|Monster]]", { "Vault/Monsters.md": MONSTERS })
        ).toBe("Goblin");
    });

    test("two notes rolling on each other resolve, not throw", () => {
        const a = [
            "| A |",
            "| - |",
            "| a then `dice: [[B#^b]]` |",
            "",
            "^a",
            "",
            "| Leaf |",
            "| ---- |",
            "| leaf |",
            "",
            "^leaf",
        ].join("\n");
        const b = [
            "| B |",
            "| - |",
            "| b then `dice: [[A#^leaf]]` |",
            "",
            "^b",
        ].join("\n");
        expect(
            roll("[[A^a]]", { "Vault/A.md": a, "Vault/B.md": b })
        ).toBe("a then b then leaf");
    });

    test("repetitions, column picks and |sep: survive the rewrite", () => {
        // A list item, not a table row — an unescaped pipe would end a
        // table cell long before the parser saw it. `\_` is the glue
        // escape for a space: the engine trims the implode argument,
        // so a bare trailing space in `|sep:` would not survive.
        const enc = [
            "- Three moods: `dice: 3[[Monsters#^mon|Mood]]|sep:\\_&\\_`",
            "",
            "^enc",
        ].join("\n");
        expect(
            roll("[[Encounters^enc]]", {
                "Vault/Encounters.md": enc,
                "Vault/Monsters.md": MONSTERS,
            })
        ).toBe("Three moods: wary & wary & wary");
    });

    test("a missing note fails legibly and names what to fix", () => {
        let message = "";
        try {
            roll("[[Encounters^enc]]", { "Vault/Encounters.md": ENCOUNTERS });
        } catch (err) {
            message = humaniseQualifiedTables(
                err instanceof Error ? err.message : String(err)
            );
        }
        expect(message).toBe("Unknown table: mon.Monster (in [[monsters]])");
    });

    test("one broken reference doesn't take the other rows down", () => {
        const enc = [
            "| Encounter |",
            "| --------- |",
            "| Fine: `dice: [[Monsters#^mon|Monster]]` |",
            "| Broken: `dice: [[Nowhere#^gone]]` |",
            "",
            "^enc",
        ].join("\n");
        const files = {
            "Vault/Encounters.md": enc,
            "Vault/Monsters.md": MONSTERS,
        };
        // Seeds that land on row 1 still roll: the missing note is
        // skipped at import time rather than aborting the bundle.
        const good = [];
        for (let seed = 1; seed <= 40; seed++) {
            try {
                good.push(roll("[[Encounters^enc]]", files, seed));
            } catch {
                /* row 2 — expected */
            }
        }
        expect(good.length).toBeGreaterThan(0);
        expect(new Set(good)).toEqual(new Set(["Fine: Goblin"]));
    });
});

describe("qualified names", () => {
    test("are lowercased on the note, verbatim on the table", () => {
        expect(qualifiedTableName("Monsters", "mon.Mood")).toBe(
            "__note:monsters^mon.Mood"
        );
    });

    test("humanise back into something a user can act on", () => {
        expect(
            humaniseQualifiedTables("Unknown table: __note:monsters^mon")
        ).toBe("Unknown table: mon (in [[monsters]])");
        // Note names have spaces in them far more often than not, so
        // the note half of the name must not stop at the first one.
        expect(
            humaniseQualifiedTables(
                "Unknown table: __note:no such note^nope"
            )
        ).toBe("Unknown table: nope (in [[no such note]])");
        // Untouched when there's nothing qualified in the message.
        expect(humaniseQualifiedTables("Unknown table: mon")).toBe(
            "Unknown table: mon"
        );
    });
});

describe("the prefetch seam", () => {
    test("walks the notes a cell names, not just Use: lines", async () => {
        // The sync resolver imports these (softUses); if the prefetch
        // doesn't fetch them, the snapshot is missing the file and the
        // sync pass reports a table it can't reach. Live-only failure —
        // hence this test.
        const src = inMemoryAsyncSource({
            "Vault/Encounters.md": ENCOUNTERS,
            "Vault/Monsters.md": MONSTERS,
        });
        const result = await prefetchUseGraph({
            entryPath: "Vault/NPC.md",
            entrySource: "",
            source: src,
            extraUses: ["[[Encounters]]"],
        });
        expect(result.source.exists("Vault/Monsters.md")).toBe(true);
        expect(result.missing).toEqual([]);
    });

    test("and keeps walking through a chain of them", async () => {
        const src = inMemoryAsyncSource({
            "Vault/One.md": "| T |\n| - |\n| `dice: [[Two#^t]]` |\n\n^t",
            "Vault/Two.md": "| T |\n| - |\n| `dice: [[Three#^t]]` |\n\n^t",
            "Vault/Three.md": "| T |\n| - |\n| end |\n\n^t",
        });
        const result = await prefetchUseGraph({
            entryPath: "Vault/NPC.md",
            entrySource: "",
            source: src,
            extraUses: ["[[One]]"],
        });
        expect(result.source.exists("Vault/Three.md")).toBe(true);
    });
});
