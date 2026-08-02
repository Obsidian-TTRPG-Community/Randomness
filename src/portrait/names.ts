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
Alaric
Bertram
Bran
Cassian
Cedric
Corwin
Denholm
Doran
Edmund
Edwin
Everard
Fenton
Garrett
Gideon
Godwin
Hale
Halvard
Hugh
Ivor
Jasper
Jorah
Kellan
Konrad
Lambert
Leofric
Marcus
Merrick
Nathaniel
Odric
Osric
Oswin
Perrin
Quentin
Radulf
Reynard
Roderick
Rowan
Selwyn
Stephan
Terrick
Tomas
Ulric
Vance
Warin
Wendell
Wilhelm
Yorick

Table: First_human_female
Adela
Alys
Anwen
Beatrix
Bess
Brenna
Bryony
Catrin
Cecily
Clemence
Edith
Eleanor
Elspeth
Freya
Gisela
Gwen
Helewise
Ida
Imogen
Isolde
Jenna
Josselyn
Katryn
Linnet
Lyra
Mabel
Margery
Maren
Merewen
Morwenna
Nessa
Odile
Perrine
Petra
Rhoswen
Rosalind
Rowena
Sable
Sibylla
Solvei
Tamsin
Thea
Ursel
Verity
Wilona
Winifred
Ysolde
Zenna

Table: Last_human
Aldermere
Ashdown
Barlow
Bellweather
Blackwood
Brambleton
Bridger
Calloway
Carver
Chandler
Crowmoor
Danforth
Dunmore
Eastlake
Fairweather
Fenwick
Fletcher
Greaves
Hallowell
Harrowgate
Hartley
Havenhurst
Hollowbrook
Ironwood
Kingsley
Larkin
Ledger
Mallory
Marchbank
Marsh
Millbrook
Northgate
Oakhart
Pemberton
Ravensworth
Redmayne
Ridley
Sedgewick
Sharrow
Stoneford
Strand
Tallow
Thatcher
Underhill
Vellacott
Wainwright
Westbrook
Whitmore

Table: First_elf_male
Adran
Aelar
Aramil
Arannis
Aust
Beiro
Berrian
Caelum
Carric
Dayereth
Efferil
Eldrin
Enialis
Erdan
Erevan
Faelar
Fivin
Galinndan
Hadarai
Heian
Himo
Immeral
Ivellios
Lamlis
Laucian
Lucan
Mindartis
Myash
Naal
Paelias
Peren
Quarion
Riardon
Rolen
Silvyr
Soveliss
Thamior
Theren
Uthemar
Vanuath
Variel
Yaeldrin

Table: First_elf_female
Adrie
Althaea
Anastrianna
Andraste
Antinua
Arara
Baelith
Bethrynna
Birel
Caelynn
Chaedi
Dara
Drusilia
Elama
Enna
Faral
Felosial
Halimath
Hatae
Ielenia
Ilanis
Irann
Jarsali
Keyleth
Leshanna
Lia
Lynnia
Meriele
Mialee
Mysaria
Naivara
Ohtar
Quelenna
Rennyn
Sariel
Shanairra
Silaqui
Theirastra
Thia
Valanthe
Xanaphia
Yalandra

Table: Last_elf
Aeloren
Amakiir
Ariessus
Ashvale
Caphaxath
Cithreth
Dawnhorn
Duskwalker
Erenaeth
Eveningfall
Galanodel
Gwaeron
Holimion
Ilphelkiir
Iydril
Kevanor
Leafrunner
Liadon
Meliamne
Moonwhisper
Morningdew
Nailathan
Nailo
Oakenheel
Riversong
Selwynn
Shadowmere
Siannodel
Silverbough
Silverfrond
Snowmantle
Starbreeze
Sunbright
Thistlemoor
Windriver
Wyndrel
Xiloscient

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
Bogrum
Brug
Dench
Dorn
Drogan
Feng
Gell
Ghesh
Gorm
Grakk
Grull
Hakk
Harl
Holg
Imsh
Karash
Keth
Krusk
Lorg
Mhurren
Morg
Narg
Orsik
Ront
Rugg
Shump
Skarn
Tharg
Thokk
Thruk
Ugorr
Urzul
Varg
Vorg
Yark
Zurn

Table: First_halforc_female
Arha
Baggi
Bruga
Drenna
Ekka
Emen
Engong
Grisha
Gruna
Hesk
Ilga
Kagra
Kansif
Korga
Lurga
Mogda
Murzol
Myev
Nagra
Neega
Ogda
Ovak
Rakka
Shautha
Shel
Sura
Sutha
Thurga
Ulga
Urga
Vola
Volen
Vorka
Yenna
Yevelda
Zorka

Table: Last_halforc
Axebiter
Bloodtusk
Boarhide
Bonecrusher
Bonegnash
Chainbreaker
Cragfist
Dawnbreaker
Doomhammer
Earthshaker
Elkrunner
Embertusk
Fireforge
Grimjaw
Hammerfall
Ironhide
Ironmaw
Nightsnarl
Oxhorn
Rockjaw
Scarmaw
Skullsplitter
Skyhowl
Stonefist
Stormhowl
Thunderborn
Tuskbreaker
Warcry
Wintertooth
Wolfjaw
Wyrmbane
Yellowfang

Table: First_gnome_male
Alston
Bilbron
Boddynock
Brocc
Burgell
Cockaby
Crampernap
Dabbledob
Delebean
Dimble
Eldon
Erky
Fablen
Fonkin
Frouse
Gerbo
Gimble
Gimlen
Glim
Igden
Jabar
Jebeddo
Kellen
Namfoodle
Orryn
Ozzek
Pallabar
Quippy
Roondar
Seebo
Sindri
Umpen
Warryn
Wrenn
Zaffrab
Zook

Table: First_gnome_female
Adabra
Bimpnottin
Bimpy
Breena
Caramip
Carlin
Cumpen
Donella
Duvamil
Ellyjoybell
Ellywick
Fenna
Ginny
Lilli
Loopmottin
Lorilla
Mardnab
Meena
Nissa
Nyx
Oda
Orla
Pynchen
Quilla
Roywyn
Ruby
Shamil
Sindra
Tervaround
Tippy
Ulla
Vondra
Waywocket
Winnie
Zanna
Zeeka

Table: Last_gnome
Beren
Boondiggle
Cobblebright
Coppervane
Dabblewick
Daergel
Fiddlewhistle
Folkor
Garrick
Gearloose
Glitterspark
Hobbleknock
Jinklemop
Kettlewhirr
Lampwick
Murnig
Nackle
Nimblecog
Ningel
Pockettinker
Quillspring
Ratchetwind
Raulnor
Scheppen
Sprocketwhistle
Thimblewick
Timbers
Tinkerbolt
Turen
Whirlygig
Widdlespark
Zigglebottom

Table: First_goblin_male
Bogrot
Brik
Chikk
Dreg
Dunk
Fikk
Fitz
Gnash
Grib
Grizzle
Hexx
Jib
Kravz
Krett
Legg
Lurtz
Mosk
Murk
Nark
Nizzik
Ogrek
Pikk
Quaz
Reeko
Rikk
Scrag
Skiv
Snik
Sprock
Threk
Ubb
Vex
Vrikk
Yubb
Zagger
Zibb

Table: First_goblin_female
Bizzik
Brakka
Chatta
Dribbla
Drix
Ekki
Fenzi
Frieka
Grenna
Grix
Hakka
Ixxa
Jinka
Kessa
Kribba
Lissik
Mekka
Mizzle
Nagga
Neeka
Oosha
Pikka
Quizza
Ratchi
Rikka
Skeeva
Snitch
Tikka
Tizzy
Ulli
Vazza
Vrenna
Wixx
Yezza
Zikka
Zilla

Table: Last_goblin
Ashcrawl
Bentnail
Boltcutter
Cinderspit
Cracklespit
Ditchrat
Emberbite
Fleabite
Grimescrape
Gutterborn
Knifeknuckle
Lampsmash
Mudfoot
Mudgrin
Nailbiter
Pigsnout
Pocketsnatch
Quickfingers
Ragnose
Rustknife
Scabtongue
Sharptooth
Slyfinger
Snagglefang
Sootpaw
Sourbelly
Splintershin
Squinteye
Thornscratch
Wartclaw
Wormtongue
Yellowgum
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
