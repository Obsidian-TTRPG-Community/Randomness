import {
    fantasyHubStartHere,
    finishFantasyHubSetup,
    readPluginSetting,
} from "../../src/contentInstaller";
import type RandomnessPlugin from "../../src/views/main";

function fakePlugin(opts: {
    livePlugins?: Record<string, unknown>;
    files?: Record<string, string>;
}) {
    const files = { ...(opts.files ?? {}) };
    const writes: Record<string, string> = {};
    const opened: string[] = [];
    const plugin = {
        app: {
            vault: {
                configDir: ".obsidian",
                adapter: {
                    exists: async (p: string) => p in files,
                    read: async (p: string) => files[p],
                    write: async (p: string, c: string) => {
                        files[p] = c;
                        writes[p] = c;
                    },
                    mkdir: async () => {},
                },
            },
            workspace: { openLinkText: async (l: string) => void opened.push(l) },
            plugins: { plugins: opts.livePlugins ?? {} },
        },
    } as unknown as RandomnessPlugin;
    return { plugin, writes, opened, files };
}

const DESTS = {
    generatorsDest: "Generators/fantasy-hub",
    templatesDest: "z_Templates/Fantasy Hub",
};

describe("fantasy hub setup", () => {
    test("start-here covers both sets, TF's own seeding, the Templater toggle", () => {
        const md = fantasyHubStartHere(DESTS);
        expect(md).toContain("Create place templates");
        expect(md).toContain("z_Templates/Fantasy Hub");
        expect(md).toContain("Trigger Templater on new file creation");
        expect(md).not.toContain("townforge-templates");
    });

    test("writes + opens the note; never touches other plugins", async () => {
        const { plugin, writes, opened, files } = fakePlugin({
            files: {
                ".obsidian/plugins/town-forge/data.json":
                    '{"templateFolder":"Untouched"}',
            },
        });
        const r = await finishFantasyHubSetup(plugin, DESTS);
        expect(writes[r.startHerePath]).toContain("start here");
        expect(opened).toEqual([r.startHerePath]);
        expect(files[".obsidian/plugins/town-forge/data.json"]).toBe(
            '{"templateFolder":"Untouched"}'
        );
    });

    test("readPluginSetting prefers live, falls back to data.json", async () => {
        const { plugin } = fakePlugin({
            livePlugins: {
                "templater-obsidian": { settings: { templates_folder: "Live" } },
            },
            files: {
                ".obsidian/plugins/templater-obsidian/data.json":
                    '{"templates_folder":"FromDisk"}',
            },
        });
        expect(
            await readPluginSetting(plugin, "templater-obsidian", "templates_folder")
        ).toBe("Live");

        const { plugin: p2 } = fakePlugin({
            files: {
                ".obsidian/plugins/templater-obsidian/data.json":
                    '{"templates_folder":"FromDisk"}',
            },
        });
        expect(
            await readPluginSetting(p2, "templater-obsidian", "templates_folder")
        ).toBe("FromDisk");
        expect(await readPluginSetting(p2, "missing-plugin", "x")).toBeUndefined();
    });
});
