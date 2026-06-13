/** @jest-environment node */
/**
 * Integration tests for the location generators beyond the five
 * shops. This file grows as new place types are added (inn, stable,
 * then market, temple, castle, barracks, dock, mill, farm).
 *
 * Each place reuses people.rdm (and prices.rdm where money is
 * involved), takes the town/shopType/shopName prompt trio so Town
 * Forge can drive it like a shop, and renders a GM-usable block with
 * a hook. Tests assert the structural skeleton holds across seeds and
 * that the town + passed name thread through.
 */
import * as fs from "fs";
import * as path from "path";
import { Evaluator } from "../../src/engine/evaluator";
import { inMemorySource, resolveBundle } from "../../src/resolver/fileResolver";

const SHOPS = path.resolve(__dirname, "../../community-generators/fantasy-hub/generators");

function loadAll(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fs.readdirSync(SHOPS)) {
        if (f.endsWith(".rdm")) {
            out[f] = fs.readFileSync(path.join(SHOPS, f), "utf8");
        }
    }
    return out;
}

function roll(
    file: string,
    table: string,
    seed: number,
    pv: Record<string, string> = {}
): string {
    const files = loadAll();
    const bundle = resolveBundle(file, files[file], {
        source: inMemorySource(files),
        callerDir: "",
    });
    return new Evaluator(bundle.main, bundle.extras, {
        seed,
        promptValues: pv,
    }).runByName(table);
}

describe("place: inn", () => {
    test("renders host, priced board, common room, patron, hook", () => {
        for (let s = 1; s <= 6; s++) {
            const out = roll("place-inn.rdm", "TF-Inn", s, {
                town: "Lythwen",
                shopType: "inn",
                shopName: "",
            });
            expect(out).toContain("Lythwen");
            expect(out).toContain("Host:");
            expect(out).toContain("common room:");
            expect(out).toContain("A patron:");
            expect(out).toContain("Hanging in the air:");
            expect(out).toMatch(/\d+ (gp|sp|cp)/);
        }
    });

    test("uses a passed inn name", () => {
        const out = roll("place-inn.rdm", "TF-Inn", 1, {
            town: "Dewbridge",
            shopType: "inn",
            shopName: "The Salty Anchor",
        });
        expect(out).toContain("The Salty Anchor");
        expect(out).toContain("Dewbridge");
    });
});

describe("place: market", () => {
    test("renders character, multiple stalls, square life, shopper, hook", () => {
        for (let s = 1; s <= 8; s++) {
            const out = roll("place-market.rdm", "TF-Market", s, {
                town: "Lythwen",
                shopType: "market",
                shopName: "",
            });
            expect(out).toContain("Lythwen");
            expect(out).toContain("Stalls today:");
            expect(out).toContain("The square:");
            expect(out).toContain("A shopper:");
            expect(out).toContain("Worth noting:");
            // At least 3 stalls (each line starts "- **").
            const stalls = (out.match(/- \*\*/g) ?? []).length;
            expect(stalls).toBeGreaterThanOrEqual(3);
        }
    });

    test("uses a passed market name", () => {
        const out = roll("place-market.rdm", "TF-Market", 1, {
            town: "Dewbridge",
            shopType: "market",
            shopName: "The Saltgate Bazaar",
        });
        expect(out).toContain("The Saltgate Bazaar");
    });
});

describe("place: temple", () => {
    test("renders deity, clergy, services, worshipper, hook", () => {
        for (let s = 1; s <= 6; s++) {
            const out = roll("place-temple.rdm", "TF-Temple", s, {
                town: "Frostkey",
                shopType: "temple",
                shopName: "",
            });
            expect(out).toContain("Frostkey");
            expect(out).toContain("Dedicated to");
            expect(out).toContain("High priest:");
            expect(out).toContain("Services offered:");
            expect(out).toContain("At prayer:");
            expect(out).toContain("Stirring beneath the incense:");
        }
    });

    test("the title always names the dedicated deity", () => {
        for (let s = 1; s <= 20; s++) {
            const out = roll("place-temple.rdm", "TF-Temple", s, {
                town: "X",
                shopType: "temple",
                shopName: "",
            });
            const ded = out.match(/Dedicated to (\w+)/);
            const title = out.split("\n")[0];
            expect(ded).toBeTruthy();
            // The first line (title) must contain the dedicated deity.
            expect(title).toContain(ded![1]);
        }
    });

    test("uses a passed temple name", () => {
        const out = roll("place-temple.rdm", "TF-Temple", 1, {
            town: "X",
            shopType: "temple",
            shopName: "The Grand Basilica",
        });
        expect(out).toContain("The Grand Basilica");
    });
});

describe("place: castle", () => {
    test("renders ruler, garrison, features, court, situation", () => {
        for (let s = 1; s <= 6; s++) {
            const out = roll("place-castle.rdm", "TF-Castle", s, {
                town: "Frostkey",
                shopType: "castle",
                shopName: "",
            });
            expect(out).toContain("Frostkey");
            expect(out).toContain("Ruler:");
            expect(out).toContain("Garrison:");
            expect(out).toContain("Power behind the throne:");
            expect(out).toContain("Right now:");
        }
    });

    test("a castle has NO prices (institutional, not commercial)", () => {
        for (let s = 1; s <= 6; s++) {
            const out = roll("place-castle.rdm", "TF-Castle", s, {
                town: "X",
                shopType: "castle",
                shopName: "",
            });
            expect(out).not.toMatch(/\d+ (gp|sp|cp)/);
        }
    });

    test("uses a passed castle name", () => {
        const out = roll("place-castle.rdm", "TF-Castle", 1, {
            town: "X",
            shopType: "castle",
            shopName: "Dragonwatch Keep",
        });
        expect(out).toContain("Dragonwatch Keep");
    });
});

describe("place: working sites (barracks, dock, mill, farm)", () => {
    const cases: Array<[string, string, string]> = [
        ["place-barracks.rdm", "TF-Barracks", "barracks"],
        ["place-dock.rdm", "TF-Dock", "docks"],
        ["place-mill.rdm", "TF-Mill", "mill"],
        ["place-farm.rdm", "TF-Farm", "farmland"],
    ];
    for (const [file, table, label] of cases) {
        test(`${table} renders overseer, work, and a hook`, () => {
            for (let s = 1; s <= 5; s++) {
                const out = roll(file, table, s, {
                    town: "Frostkey",
                    shopType: label,
                    shopName: "",
                });
                expect(out).toContain("Frostkey");
                expect(out).toContain(label);
                // Each working site ends with a hook line.
                expect(out).toMatch(
                    /Trouble brewing:|Worth watching:|Worth noting:/
                );
                // No priced stock — these are working sites, not shops.
                expect(out).not.toMatch(/\d+ (gp|sp|cp)/);
            }
        });
    }

    test("working sites accept a passed name", () => {
        const out = roll("place-mill.rdm", "TF-Mill", 1, {
            town: "X",
            shopType: "mill",
            shopName: "The Old Stone Mill",
        });
        expect(out).toContain("The Old Stone Mill");
    });
});

describe("place: umbrella picker (location.rdm)", () => {
    test("TF-Location resolves any type and propagates the town", () => {
        const kinds = new Set<string>();
        for (let s = 1; s <= 40; s++) {
            const out = roll("location.rdm", "TF-Location", s, {
                town: "Frostkey",
                shopType: "location",
                shopName: "",
            });
            expect(out).toContain("Frostkey");
            const m = out.match(/\*\(([^)]+)\)\*/);
            if (m) kinds.add(m[1].split(" ")[0]);
        }
        // Across 40 seeds we should see a good spread of types
        // (there are 13 distinct labels; expect at least 8).
        expect(kinds.size).toBeGreaterThanOrEqual(8);
    });

    test("TF-Place excludes shops", () => {
        // Roll many; none should be a shop type label.
        const shopLabels = [
            "general goods",
            "weapons",
            "armor",
            "alchemy",
            "magic",
        ];
        for (let s = 1; s <= 30; s++) {
            const out = roll("location.rdm", "TF-Place", s, {
                town: "X",
                shopType: "location",
                shopName: "",
            });
            for (const sl of shopLabels) {
                expect(out).not.toContain(`(${sl}`);
            }
        }
    });
});

describe("place: guild", () => {
    const categories: Array<[string, string]> = [
        ["TF-GuildCraft", "craft"],
        ["TF-GuildReligious", "religious"],
        ["TF-GuildMilitary", "military"],
        ["TF-GuildCriminal", "criminal"],
        ["TF-GuildArcane", "arcane"],
        ["TF-GuildCivic", "civic"],
    ];

    for (const [table, label] of categories) {
        test(`${table} renders a coherent ${label} guild`, () => {
            for (let s = 1; s <= 4; s++) {
                const out = roll("place-guild.rdm", table, s, {
                    town: "Frostkey",
                    shopType: "guild",
                    shopName: "",
                    slant: "any",
                });
                expect(out).toContain("Frostkey");
                expect(out).toContain(`${label} guild`);
                expect(out).toContain("Membership:");
                expect(out).toContain("What they offer:");
                expect(out).toContain("Beneath the surface:");
                // No empty trade in the title.
                expect(out).not.toMatch(/Guild of \*\*/);
            }
        });
    }

    test("TF-Guild rolls across all categories", () => {
        const cats = new Set<string>();
        for (let s = 1; s <= 40; s++) {
            const out = roll("place-guild.rdm", "TF-Guild", s, {
                town: "X",
                shopType: "guild",
                shopName: "",
                slant: "any",
            });
            const m = out.match(/\*\((\w+) guild in/);
            expect(m).toBeTruthy();
            cats.add(m![1]);
        }
        expect(cats.size).toBeGreaterThanOrEqual(4);
    });

    test("slant=good biases away from dark standing", () => {
        for (let s = 1; s <= 20; s++) {
            const out = roll("place-guild.rdm", "TF-Guild", s, {
                town: "X",
                shopType: "guild",
                shopName: "",
                slant: "good",
            });
            expect(out).not.toContain("rotten at the top");
            expect(out).not.toContain("predatory outfit");
        }
    });

    test("slant=dark biases toward dark standing", () => {
        let darkSeen = 0;
        for (let s = 1; s <= 12; s++) {
            const out = roll("place-guild.rdm", "TF-Guild", s, {
                town: "X",
                shopType: "guild",
                shopName: "",
                slant: "dark",
            });
            // Dark guilds use the encouraged-dues / protection services.
            if (out.includes('"for your safety"')) darkSeen++;
        }
        expect(darkSeen).toBeGreaterThan(0);
    });

    test("uses a passed guild name", () => {
        const out = roll("place-guild.rdm", "TF-GuildCraft", 1, {
            town: "X",
            shopType: "guild",
            shopName: "The Ironhand Fellowship",
            slant: "any",
        });
        expect(out).toContain("The Ironhand Fellowship");
    });
});

describe("place: tavern", () => {
    test("renders keeper, specialty, drinks, entertainment, hook", () => {
        for (let s = 1; s <= 5; s++) {
            const out = roll("place-tavern.rdm", "TF-Tavern", s, {
                town: "Frostkey",
                shopType: "tavern",
                shopName: "",
            });
            expect(out).toContain("Frostkey");
            expect(out).toContain("Behind the bar:");
            expect(out).toContain("House specialty:");
            expect(out).toContain("The entertainment:");
            expect(out).toContain("Trouble at the bar:");
            expect(out).toMatch(/\d+ (gp|sp|cp)/);
        }
    });
    test("uses a passed tavern name", () => {
        const out = roll("place-tavern.rdm", "TF-Tavern", 1, {
            town: "X", shopType: "tavern", shopName: "The Rusty Tankard",
        });
        expect(out).toContain("The Rusty Tankard");
    });
});

describe("place: wizard's tower", () => {
    test("renders mage, study, household, signs, hook", () => {
        for (let s = 1; s <= 5; s++) {
            const out = roll("place-tower.rdm", "TF-Tower", s, {
                town: "Frostkey",
                shopType: "tower",
                shopName: "",
            });
            expect(out).toContain("Frostkey");
            expect(out).toContain("Resident:");
            expect(out).toContain("Tradition & study:");
            expect(out).toContain("Signs of the work:");
            expect(out).toContain("Something is off:");
            expect(out).not.toMatch(/\d+ (gp|sp|cp)/); // no prices
        }
    });
    test("household line is not doubled", () => {
        // Regression: the household used to print twice.
        const out = roll("place-tower.rdm", "TF-Tower", 6, {
            town: "X", shopType: "tower", shopName: "",
        });
        const line = out.split("\n").find((l) => l.startsWith("**The household:**"))!;
        // The descriptive text should not appear twice on the line.
        const body = line.replace("**The household:**", "").trim();
        const half = body.slice(0, Math.floor(body.length / 2)).trim();
        if (half.length > 10) {
            expect(body).not.toBe(half + half);
        }
    });
});

describe("place: undertaker", () => {
    test("renders undertaker, services, grounds, care, hook", () => {
        for (let s = 1; s <= 5; s++) {
            const out = roll("place-undertaker.rdm", "TF-Undertaker", s, {
                town: "Frostkey",
                shopType: "undertaker",
                shopName: "",
            });
            expect(out).toContain("Frostkey");
            expect(out).toContain("The undertaker:");
            expect(out).toContain("The grounds:");
            expect(out).toContain("Presently in their care:");
            expect(out).toContain("Something unquiet:");
            expect(out).toMatch(/\d+ (gp|sp|cp)|freely given/);
        }
    });
    test("uses a passed undertaker name", () => {
        const out = roll("place-undertaker.rdm", "TF-Undertaker", 1, {
            town: "X", shopType: "undertaker", shopName: "The Last Repose",
        });
        expect(out).toContain("The Last Repose");
    });
});

describe("place: noble's manor", () => {
    test("renders head, household, family member, talk, hook", () => {
        for (let s = 1; s <= 5; s++) {
            const out = roll("place-manor.rdm", "TF-Manor", s, {
                town: "Frostkey",
                shopType: "manor",
                shopName: "",
            });
            expect(out).toContain("Frostkey");
            expect(out).toContain("Head of the house:");
            expect(out).toContain("Also in residence:");
            expect(out).toContain("The talk of the house:");
            expect(out).toContain("Behind closed doors:");
            expect(out).not.toMatch(/\d+ (gp|sp|cp)/); // no prices
        }
    });
    test("uses a passed manor name", () => {
        const out = roll("place-manor.rdm", "TF-Manor", 1, {
            town: "X", shopType: "manor", shopName: "Blackwood Hall",
        });
        expect(out).toContain("Blackwood Hall");
    });
});

describe("place: standalone name aliases (TF-*Name)", () => {
    // For naming notes after a roll, every location exposes a
    // collision-proof TF-*Name table that yields a clean single-line
    // name with no markup, no empty fragments, no leftover syntax.
    const nameTables: Array<[string, string]> = [
        ["place-barracks.rdm", "TF-BarracksName"],
        ["place-castle.rdm", "TF-CastleName"],
        ["place-dock.rdm", "TF-DockName"],
        ["place-farm.rdm", "TF-FarmName"],
        ["place-inn.rdm", "TF-InnName"],
        ["place-market.rdm", "TF-MarketName"],
        ["place-mill.rdm", "TF-MillName"],
        ["place-stable.rdm", "TF-StableName"],
        ["place-tavern.rdm", "TF-TavernName"],
        ["place-tower.rdm", "TF-TowerName"],
        ["place-undertaker.rdm", "TF-UndertakerName"],
        ["place-guild.rdm", "TF-GuildName"],
        ["place-manor.rdm", "TF-ManorName"],
        ["place-temple.rdm", "TF-TempleName"],
    ];

    for (const [file, table] of nameTables) {
        test(`${table} yields a clean name`, () => {
            for (let s = 1; s <= 5; s++) {
                const out = roll(file, table, s, {});
                expect(out.trim().length).toBeGreaterThan(2);
                expect(out).not.toContain("**");
                expect(out).not.toContain("[@");
                expect(out).not.toContain("\n");
                // No dangling "of " / "House " with a *missing* value
                // (trailing space after the word = empty substitution).
                expect(out).not.toMatch(/\bof $/);
                expect(out).not.toMatch(/\bHouse $/);
            }
        });
    }
});

describe("place: guild names (standalone + criminal street-names)", () => {
    test("criminal guilds use cant/street-names, not 'Guild of Thieves'", () => {
        let streetNamed = 0;
        for (let s = 1; s <= 20; s++) {
            const out = roll("place-guild.rdm", "TF-GuildCriminal", s, {
                town: "X", shopType: "guild", shopName: "", slant: "dark",
            });
            const title = out.split("\n")[0];
            // Most criminal names should NOT be the plain "Guild of X".
            if (!/Guild of|the .+ Guild/.test(title)) streetNamed++;
        }
        expect(streetNamed).toBeGreaterThan(10);
    });

    test("TF-ThievesGuildName yields a clean criminal name", () => {
        for (let s = 1; s <= 20; s++) {
            const out = roll("place-guild.rdm", "TF-ThievesGuildName", s, {});
            expect(out.trim().length).toBeGreaterThan(2);
            expect(out).not.toContain("[@");
            expect(out).not.toContain("\n");
            // No double article like "Worshipful the Shadows".
            expect(out).not.toMatch(/\b\w+ the /);
        }
    });

    test("per-category standalone names are clean", () => {
        const tables = [
            "TF-GuildNameCraft",
            "TF-GuildNameReligious",
            "TF-GuildNameMilitary",
            "TF-GuildNameCriminal",
            "TF-GuildNameArcane",
            "TF-GuildNameCivic",
        ];
        for (const t of tables) {
            for (let s = 1; s <= 3; s++) {
                const out = roll("place-guild.rdm", t, s, {});
                expect(out.trim().length).toBeGreaterThan(2);
                expect(out).not.toContain("[@");
                expect(out).not.toMatch(/of\s*$/);
            }
        }
    });
});

describe("place: stable", () => {
    test("renders stablemaster, priced stock, stalls, customer, hook", () => {
        for (let s = 1; s <= 6; s++) {
            const out = roll("place-stable.rdm", "TF-Stable", s, {
                town: "Lythwen",
                shopType: "stable",
                shopName: "",
            });
            expect(out).toContain("Lythwen");
            expect(out).toContain("Stablemaster:");
            expect(out).toContain("In the stalls:");
            expect(out).toContain("A customer:");
            expect(out).toContain("Worth noting:");
            expect(out).toMatch(/\d+ (gp|sp|cp)/);
        }
    });

    test("uses a passed stable name", () => {
        const out = roll("place-stable.rdm", "TF-Stable", 1, {
            town: "Dewbridge",
            shopType: "stable",
            shopName: "The Iron Horseshoe",
        });
        expect(out).toContain("The Iron Horseshoe");
    });
});
