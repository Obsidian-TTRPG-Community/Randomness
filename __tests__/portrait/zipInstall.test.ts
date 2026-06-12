import { zipSync, strToU8 } from "fflate";
import { installPackFromZipBytes } from "../../src/portrait/service";
import type RandomnessPlugin from "../../src/views/main";

function fakePlugin() {
    const writes: Record<string, number> = {};
    const folders = new Set<string>();
    const plugin = {
        app: {
            vault: {
                adapter: {
                    exists: async (p: string) => folders.has(p),
                    mkdir: async (p: string) => void folders.add(p),
                    writeBinary: async (p: string, b: ArrayBuffer) => {
                        writes[p] = b.byteLength;
                    },
                },
            },
        },
        portraits: { invalidate: () => {} },
    } as unknown as RandomnessPlugin;
    return { plugin, writes, folders };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("portrait pack zip install", () => {
    test("root-layout zip installs, creating folders", async () => {
        const zip = zipSync({
            "manifest.json": strToU8('{"pack":"x"}'),
            "base/base_human_01.png": PNG,
            "hair_back/hair_back_01.png": PNG,
        });
        const { plugin, writes } = fakePlugin();
        const n = await installPackFromZipBytes(plugin, zip, "packs/ink");
        expect(n).toBe(3);
        expect(Object.keys(writes).sort()).toEqual([
            "packs/ink/base/base_human_01.png",
            "packs/ink/hair_back/hair_back_01.png",
            "packs/ink/manifest.json",
        ]);
    });

    test("single-top-folder layout is flattened; backups skipped", async () => {
        const zip = zipSync({
            "fantasy_ink_parts_pack/manifest.json": strToU8("{}"),
            "fantasy_ink_parts_pack/base/base_elf_01.png": PNG,
            "fantasy_ink_parts_pack/_base_backup_2026/base_old.png": PNG,
        });
        const { plugin, writes } = fakePlugin();
        const n = await installPackFromZipBytes(plugin, zip, "p");
        expect(n).toBe(2);
        expect(writes["p/manifest.json"]).toBeDefined();
        expect(writes["p/base/base_elf_01.png"]).toBe(PNG.byteLength);
        expect(
            Object.keys(writes).some((k) => k.includes("_base_backup"))
        ).toBe(false);
    });

    test("zip without a manifest throws", async () => {
        const zip = zipSync({ "readme.txt": strToU8("hi") });
        const { plugin } = fakePlugin();
        await expect(
            installPackFromZipBytes(plugin, zip, "p")
        ).rejects.toThrow(/manifest\.json/);
    });
});
