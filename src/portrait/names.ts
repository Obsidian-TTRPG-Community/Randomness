/**
 * Name rolls for portraits — gender/race-appropriate names generated
 * through the real Randomness engine (parseFileSource + Evaluator), so
 * the tables use ordinary .ipt syntax and can later be overridden by a
 * user generator file (planned: a settings field pointing at a vault
 * .ipt that defines the same table names).
 *
 * Race comes from the rolled base layer's filename (base_<race>_NN),
 * gender from the recipe's gender axis. The evaluator is seeded from
 * the portrait seed, so a given portrait always gets the same name —
 * names are part of the portrait's identity, not a separate roll.
 */

import { parseFileSource } from "../resolver/fileResolver";
import { Evaluator } from "../engine/evaluator";
import type { GeneratorFile } from "../engine/ast";
import { normalizeManifest, PortraitRecipe, RawManifest } from "./pack";

/** Races with built-in tables; must match base_<race>_NN filenames. */
export const NAME_RACES = [
    "human", "elf", "halfelf", "halforc", "gnome", "goblin",
] as const;

/**
 * Built-in name tables, ordinary IPP3 syntax. First/Last per race and
 * gender; half-elves draw from both parent cultures via table calls.
 */
export const PORTRAIT_NAME_TABLES = `\
// Built-in portrait name tables (used by the portrait module).
Formatting: text

Table: First_human_male
Aldric
Bran
Cedric
Doran
Edmund
Garrett
Hale
Jorah
Kellan
Marcus
Osric
Perrin
Rowan
Tomas
Wendell

Table: First_human_female
Adela
Brenna
Catrin
Elspeth
Gwen
Isolde
Jenna
Lyra
Maren
Nessa
Petra
Rhoswen
Sable
Tamsin
Verity

Table: Last_human
Ashdown
Blackwood
Carver
Dunmore
Fairweather
Hartley
Ironwood
Kingsley
Marsh
Northgate
Pemberton
Strand
Thatcher
Whitmore

Table: First_elf_male
Aelar
Caelum
Erevan
Faelar
Galinndan
Ivellios
Laucian
Mindartis
Quarion
Soveliss
Thamior
Variel

Table: First_elf_female
Adrie
Caelynn
Drusilia
Enna
Felosial
Ielenia
Lia
Mialee
Naivara
Quelenna
Sariel
Thia

Table: Last_elf
Amakiir
Galanodel
Holimion
Liadon
Meliamne
Nailo
Siannodel
Silverfrond
Starbreeze
Wyndrel

Table: First_halfelf_male
[@First_elf_male]
[@First_human_male]

Table: First_halfelf_female
[@First_elf_female]
[@First_human_female]

Table: Last_halfelf
[@Last_elf]
[@Last_human]

Table: First_halforc_male
Brug
Dench
Feng
Gell
Holg
Krusk
Mhurren
Ront
Shump
Thokk
Urzul
Varg

Table: First_halforc_female
Baggi
Emen
Engong
Kansif
Myev
Neega
Ovak
Shautha
Sutha
Vola
Volen
Yevelda

Table: Last_halforc
Bonecrusher
Doomhammer
Elkrunner
Fireforge
Ironhide
Skullsplitter
Stonefist
Thunderborn
Wolfjaw

Table: First_gnome_male
Alston
Boddynock
Dimble
Eldon
Fonkin
Gimble
Glim
Namfoodle
Orryn
Roondar
Seebo
Zook

Table: First_gnome_female
Bimpnottin
Caramip
Duvamil
Ellywick
Loopmottin
Mardnab
Nissa
Oda
Roywyn
Shamil
Waywocket
Zanna

Table: Last_gnome
Beren
Daergel
Folkor
Garrick
Nackle
Murnig
Ningel
Raulnor
Scheppen
Timbers
Turen

Table: First_goblin_male
Brik
Dreg
Fitz
Grizzle
Krett
Lurtz
Mosk
Nark
Reeko
Skiv
Vex
Zagger

Table: First_goblin_female
Brakka
Drix
Frieka
Grenna
Kessa
Mizzle
Neeka
Ratchi
Skeeva
Tizzy
Vrenna
Zilla

Table: Last_goblin
Bentnail
Cinderspit
Fleabite
Mudfoot
Quickfingers
Rustknife
Sharptooth
Snagglefang
Squinteye
Wormtongue
`;

let cachedTables: GeneratorFile | null = null;

function nameTables(): GeneratorFile {
    if (!cachedTables) {
        cachedTables = parseFileSource(
            "__builtin__/portrait-names.ipt",
            PORTRAIT_NAME_TABLES
        );
    }
    return cachedTables;
}

/** FNV-1a, mirrors the engine's seeding conventions. */
function fnv(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/**
 * Extract the race token from the rolled base layer's filename
 * (base_<race>_NN). Null when the pack doesn't encode races.
 */
export function raceOf(
    recipe: PortraitRecipe,
    manifestRaw: RawManifest
): string | null {
    const man = normalizeManifest(manifestRaw);
    const idx = recipe.parts?.base;
    if (idx === undefined || idx < 0) return null;
    const file = man.layers.base?.[idx];
    if (file === undefined) return null;
    const m = /(?:^|\/)base_([a-z]+)_\d+\./i.exec(file);
    return m ? m[1].toLowerCase() : null;
}

/**
 * Deterministic, race/gender-appropriate name for a portrait. Unknown
 * races fall back to human tables; missing gender rolls as male/female
 * 50/50 off the seed (matches the engine's gender hash convention).
 */
export function nameFor(
    recipe: PortraitRecipe,
    manifestRaw: RawManifest
): string {
    const raceRaw = raceOf(recipe, manifestRaw) ?? "human";
    const race = (NAME_RACES as readonly string[]).includes(raceRaw)
        ? raceRaw
        : "human";
    const gender = recipe.gender === "female" ? "female" : "male";
    const main = parseFileSource(
        "__builtin__/portrait-name-main.ipt",
        `Formatting: text\nTable: __PortraitName\n[@First_${race}_${gender}] [@Last_${race}]`
    );
    const evaluator = new Evaluator(main, [nameTables()], {
        seed: fnv((recipe.seed ?? "") + ":name"),
    });
    return evaluator.run().trim();
}
