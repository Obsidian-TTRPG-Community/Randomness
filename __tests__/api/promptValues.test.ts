/** @jest-environment node */
/** Prove promptValues override flows: a Prompt: labelled "town" can
 *  be overridden by promptValues:{town:"X"} and read as {$prompt1}. */
import { Evaluator } from "../../src/engine/evaluator";
import { inMemorySource, resolveBundle } from "../../src/resolver/fileResolver";

function roll(body: string, promptValues: Record<string,string>): string {
    const files = { "g.ipt": body };
    const b = resolveBundle("g.ipt", body, { source: inMemorySource(files), callerDir: "" });
    return new Evaluator(b.main, b.extras, { promptValues }).runByName("Main");
}

test("promptValues override by label, read by position", () => {
    const body = [
        "Prompt: town {} DefaultTown",
        "Prompt: shopName {} DefaultShop",
        "Table: Main",
        "{$prompt2} sits on a street in {$prompt1}.",
    ].join("\n");
    const out = roll(body, { town: "Riverbend", shopName: "The Anvil" });
    expect(out).toBe("The Anvil sits on a street in Riverbend.");
});

test("falls back to default when no override given", () => {
    const body = [
        "Prompt: town {} DefaultTown",
        "Table: Main",
        "Located in {$prompt1}.",
    ].join("\n");
    expect(roll(body, {})).toBe("Located in DefaultTown.");
});

test("can copy a prompt into a named var for clearer reference", () => {
    const body = [
        "Prompt: town {} DefaultTown",
        "Table: Main",
        "Set: townName={$prompt1}",
        "Welcome to {$townName}.",
    ].join("\n");
    expect(roll(body, { town: "Goldhaven" })).toBe("Welcome to Goldhaven.");
});
