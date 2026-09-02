/**
 * @jest-environment jsdom
 */

/**
 * Hideable sidebar tabs (issue #14) and the resizable result panel: the
 * roster helper, and the
 * browser view honouring it — hidden tabs get no button, the first
 * visible tab opens by default, settings changes apply live, and a
 * command deep-linking into a hidden tab reveals it for the session.
 */

import {
    BROWSER_TABS,
    visibleBrowserTabs,
    isBrowserTab,
} from "../../src/views/browserTabs";
import { DEFAULT_SETTINGS, RandomnessSettings } from "../../src/views/settings";

describe("visibleBrowserTabs", () => {
    test("nothing hidden → every tab, in display order", () => {
        expect(visibleBrowserTabs([])).toEqual([...BROWSER_TABS]);
        expect(visibleBrowserTabs(undefined)).toEqual([...BROWSER_TABS]);
    });

    test("hidden ids drop out, order preserved", () => {
        expect(visibleBrowserTabs(["portraits", "builder"])).toEqual([
            "generators",
            "decks",
            "dice",
        ]);
        // Order of the hidden list is irrelevant.
        expect(visibleBrowserTabs(["dice", "generators"])).toEqual([
            "decks",
            "portraits",
            "builder",
        ]);
    });

    test("unknown ids are ignored", () => {
        expect(visibleBrowserTabs(["nope", "decks"])).toEqual([
            "generators",
            "portraits",
            "builder",
            "dice",
        ]);
    });

    test("hiding everything falls back to Generators", () => {
        expect(visibleBrowserTabs([...BROWSER_TABS])).toEqual(["generators"]);
    });

    test("isBrowserTab guards the id space", () => {
        expect(isBrowserTab("dice")).toBe(true);
        expect(isBrowserTab("Dice")).toBe(false);
    });

    test("default settings hide nothing", () => {
        expect(DEFAULT_SETTINGS.hiddenBrowserTabs).toEqual([]);
    });
});

// ────────── The view ──────────

function fakePlugin(settings: Partial<RandomnessSettings>) {
    return {
        app: {
            vault: {
                getFiles: () => [],
                async read(): Promise<string> {
                    throw new Error("no files");
                },
                adapter: {
                    async read(): Promise<string> {
                        throw new Error("no files");
                    },
                    async exists(): Promise<boolean> {
                        return false;
                    },
                },
                on: () => ({}),
            },
            workspace: {
                on: () => ({}),
                getLeavesOfType: () => [],
            },
        },
        settings: { ...DEFAULT_SETTINGS, ...settings },
        saveSettings: async () => {},
        registerEvent: () => {},
        portraits: { available: () => false },
        decks: {
            onChange: () => () => {},
            listDecks: async () => [],
            decksFolderPath: () => "Decks",
        },
    };
}

function fakeLeaf(): any {
    const container = document.createElement("div");
    container.appendChild(document.createElement("div"));
    container.appendChild(document.createElement("div"));
    return { containerEl: container };
}

async function buildView(settings: Partial<RandomnessSettings>) {
    const { BrowserView } = await import("../../src/views/browserView");
    const p = fakePlugin(settings);
    const view = new BrowserView(fakeLeaf(), p as any);
    await view.onOpen();
    return { view, p };
}

function tabLabels(view: any): string[] {
    const root = view.containerEl.children[1] as HTMLElement;
    return Array.from(root.querySelectorAll(".randomness-panel-tab")).map(
        (b) => (b as HTMLElement).textContent ?? ""
    );
}

function activeLabel(view: any): string | undefined {
    const root = view.containerEl.children[1] as HTMLElement;
    return (
        root.querySelector(".randomness-panel-tab.is-active") as HTMLElement
    )?.textContent ?? undefined;
}

function tabBar(view: any): HTMLElement {
    const root = view.containerEl.children[1] as HTMLElement;
    return root.querySelector(".randomness-panel-tabs") as HTMLElement;
}

describe("BrowserView with hidden tabs", () => {
    test("all five tabs by default, Generators active", async () => {
        const { view } = await buildView({});
        expect(tabLabels(view)).toEqual([
            "Generators",
            "Decks",
            "Portraits",
            "Builder",
            "Dice",
        ]);
        expect(activeLabel(view)).toBe("Generators");
        expect(tabBar(view).style.display).toBe("");
    });

    test("hidden tabs get no button; first visible tab opens", async () => {
        const { view } = await buildView({
            hiddenBrowserTabs: ["generators", "portraits", "builder"],
        });
        expect(tabLabels(view)).toEqual(["Decks", "Dice"]);
        expect(activeLabel(view)).toBe("Decks");
        // The generators panel (this.root) is hidden, not removed.
        const root = view.containerEl.children[1] as HTMLElement;
        const gen = root.querySelector(".randomness-browser") as HTMLElement;
        expect(gen.style.display).toBe("none");
    });

    test("a single visible tab hides the tab bar entirely", async () => {
        const { view } = await buildView({
            hiddenBrowserTabs: ["decks", "portraits", "builder", "dice"],
        });
        expect(tabLabels(view)).toEqual(["Generators"]);
        expect(tabBar(view).style.display).toBe("none");
    });

    test("hiding every tab still shows Generators", async () => {
        const { view } = await buildView({
            hiddenBrowserTabs: [...BROWSER_TABS],
        });
        expect(tabLabels(view)).toEqual(["Generators"]);
        expect(activeLabel(view)).toBe("Generators");
    });

    test("applyTabVisibility follows a live settings change", async () => {
        const { view, p } = await buildView({});
        view.showTab("dice");
        expect(activeLabel(view)).toBe("Dice");

        // Hide the tab the user is looking at → fall back to the
        // first visible one.
        p.settings.hiddenBrowserTabs = ["dice", "generators"];
        view.applyTabVisibility();
        expect(tabLabels(view)).toEqual(["Decks", "Portraits", "Builder"]);
        expect(activeLabel(view)).toBe("Decks");

        // Hide something else → the active tab is kept.
        view.showTab("builder");
        p.settings.hiddenBrowserTabs = ["dice", "generators", "decks"];
        view.applyTabVisibility();
        expect(tabLabels(view)).toEqual(["Portraits", "Builder"]);
        expect(activeLabel(view)).toBe("Builder");

        // Unhide everything → the full bar is back.
        p.settings.hiddenBrowserTabs = [];
        view.applyTabVisibility();
        expect(tabLabels(view)).toHaveLength(5);
        expect(activeLabel(view)).toBe("Builder");
    });

    test("a command deep-linking into a hidden tab reveals it for the session", async () => {
        const { view, p } = await buildView({ hiddenBrowserTabs: ["dice"] });
        expect(tabLabels(view)).not.toContain("Dice");

        view.showTab("dice");
        expect(tabLabels(view)).toContain("Dice");
        expect(activeLabel(view)).toBe("Dice");
        // The setting itself is untouched.
        expect(p.settings.hiddenBrowserTabs).toEqual(["dice"]);

        // Re-applying the (unchanged) setting keeps the revealed tab…
        view.applyTabVisibility();
        expect(tabLabels(view)).toContain("Dice");
        // …until the user hides it again through settings.
        p.settings.hiddenBrowserTabs = ["dice"];
        view.applyTabVisibility();
        expect(tabLabels(view)).toContain("Dice");
        p.settings.hiddenBrowserTabs = ["builder"];
        view.applyTabVisibility();
        p.settings.hiddenBrowserTabs = ["builder", "dice"];
        view.applyTabVisibility();
        expect(tabLabels(view)).not.toContain("Dice");
    });
});

// ────────── Resizable result panel ──────────

describe("BrowserView result panel grip", () => {
    function parts(view: any) {
        const root = view.containerEl.children[1] as HTMLElement;
        return {
            grip: root.querySelector(
                ".randomness-browser-result-grip"
            ) as HTMLElement,
            area: root.querySelector(".randomness-browser-result") as HTMLElement,
        };
    }
    const pointer = (type: string, y: number) =>
        new MouseEvent(type, { clientY: y, button: 0, bubbles: true });

    test("default: no explicit height, stylesheet cap applies", async () => {
        const { view } = await buildView({});
        const { grip, area } = parts(view);
        expect(grip).toBeTruthy();
        expect(area.classList.contains("is-sized")).toBe(false);
        expect(area.style.height).toBe("");
    });

    test("a saved height is applied on open", async () => {
        const { view } = await buildView({ browserResultHeight: 260 });
        const { area } = parts(view);
        expect(area.classList.contains("is-sized")).toBe(true);
        expect(area.style.height).toBe("260px");
    });

    test("dragging the grip up makes the panel taller and persists once", async () => {
        const { view, p } = await buildView({ browserResultHeight: 200 });
        const { grip, area } = parts(view);
        // jsdom has no layout, so getBoundingClientRect is 0 — the
        // drag is measured from that; the clamp's floor still holds.
        const saves: number[] = [];
        p.saveSettings = async () => {
            saves.push(p.settings.browserResultHeight as number);
        };
        grip.dispatchEvent(pointer("pointerdown", 500));
        grip.dispatchEvent(pointer("pointermove", 400));
        expect(area.style.height).toBe("100px");
        grip.dispatchEvent(pointer("pointermove", 200));
        expect(area.style.height).toBe("300px");
        expect(saves).toEqual([]);
        grip.dispatchEvent(pointer("pointerup", 200));
        expect(saves).toEqual([300]);
        expect(p.settings.browserResultHeight).toBe(300);
        // Moves after release do nothing.
        grip.dispatchEvent(pointer("pointermove", 0));
        expect(area.style.height).toBe("300px");
    });

    test("dragging down clamps at the minimum", async () => {
        const { view } = await buildView({});
        const { grip, area } = parts(view);
        grip.dispatchEvent(pointer("pointerdown", 100));
        grip.dispatchEvent(pointer("pointermove", 900));
        expect(area.style.height).toBe("48px");
        grip.dispatchEvent(pointer("pointerup", 900));
    });

    test("double-click resets to the default and clears the setting", async () => {
        const { view, p } = await buildView({ browserResultHeight: 260 });
        const { grip, area } = parts(view);
        grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        expect(area.classList.contains("is-sized")).toBe(false);
        expect(area.style.height).toBe("");
        expect("browserResultHeight" in p.settings).toBe(false);
    });

    test("the grip survives a re-render of the result", async () => {
        const { view } = await buildView({ browserResultHeight: 120 });
        (view as any).renderResult();
        const { grip, area } = parts(view);
        expect(grip).toBeTruthy();
        expect(area.style.height).toBe("120px");
    });
});
