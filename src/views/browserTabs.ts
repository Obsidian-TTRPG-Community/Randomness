/**
 * The sidebar's tab roster, shared between the browser view (which
 * renders it) and the settings tab (which lets users hide entries).
 * Lives in its own tiny module so settings.ts can import it without
 * dragging the whole view — MarkdownRenderer, the portrait panel,
 * the dice tray — into its load graph.
 */

/** Sidebar tabs, in display order. */
export const BROWSER_TABS = [
    "generators",
    "decks",
    "portraits",
    "builder",
    "dice",
] as const;
export type BrowserTab = (typeof BROWSER_TABS)[number];

/** Tab id → the label shown on its button (and in settings). */
export const BROWSER_TAB_LABELS: Record<BrowserTab, string> = {
    generators: "Generators",
    decks: "Decks",
    portraits: "Portraits",
    builder: "Builder",
    dice: "Dice",
};

export function isBrowserTab(id: string): id is BrowserTab {
    return (BROWSER_TABS as readonly string[]).includes(id);
}

/**
 * The tabs the sidebar should show, in display order, given the
 * user's hidden list (issue #14). Unknown ids in the list are
 * ignored, so a stale or hand-edited data.json can't break the
 * roster. Hiding everything is not a state we honour: an empty tab
 * bar leaves the view with nothing to click, so the Generators tab
 * comes back on its own.
 */
export function visibleBrowserTabs(
    hidden: readonly string[] | undefined
): BrowserTab[] {
    const hide = new Set(hidden ?? []);
    const shown = BROWSER_TABS.filter((t) => !hide.has(t));
    return shown.length > 0 ? shown : ["generators"];
}
