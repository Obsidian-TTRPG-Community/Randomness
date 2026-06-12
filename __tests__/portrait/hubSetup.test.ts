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
    test("start-here note covers both sets and the Templater toggle", () => {
        const md = fantasyHubStartHere({ ...DESTS, townForge: "configured" });
        expect(md).toContain("townforge-templates");
        expect(md).toContain("z_Templates/Fantasy Hub");
        expect(md).toContain("Trigger Templater on new file creation");
        expect(md).toContain("✅ Done automatically");
    });

    test("configures a live Town Forge and saves", async () => {
        const saved: unknown[] = [];
        const tf = {
            settings: { templateFolder: "Templates/TownForge" },
            saveSettings: async () => void saved.push(1),
        };
        const { plugin, writes, opened } = fakePlugin({
            livePlugins: { "town-forge": tf },
        });
        const r = await finishFantasyHubSetup(plugin, DESTS);
        expect(r.townForge).toBe("configured");
        expect(tf.settings.templateFolder).toBe(
            "Generators/fantasy-hub/townforge-templates"
        );
        expect(saved).toHaveLength(1);
        expect(writes[r.startHerePath]).toContain("start here");
        expect(opened).toEqual([r.startHerePath]);
    });

    test("configures a disabled Town Forge via its data.json", async () => {
        const { plugin, files } = fakePlugin({
            files: {
                ".obsidian/plugins/town-forge/data.json": JSON.stringify({
                    templateFolder: "z_Templates\\\\old",
                    other: 1,
                }),
            },
        });
        const r = await finishFantasyHubSetup(plugin, DESTS);
        expect(r.townForge).toBe("configured-disabled");
        const data = JSON.parse(
            files[".obsidian/plugins/town-forge/data.json"]
        );
        expect(data.templateFolder).toBe(
            "Generators/fantasy-hub/townforge-templates"
        );
        expect(data.other).toBe(1);
    });

    test("no Town Forge: still writes + opens the note", async () => {
        const { plugin, writes } = fakePlugin({});
        const r = await finishFantasyHubSetup(plugin, DESTS);
        expect(r.townForge).toBe("not-installed");
        expect(writes[r.startHerePath]).toContain("Install [Town Forge]");
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
        expect(
            await readPluginSetting(p2, "missing-plugin", "x")
        ).toBeUndefined();
    });
});
