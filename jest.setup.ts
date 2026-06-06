/**
 * Jest setup — polyfill Obsidian runtime globals.
 *
 * Obsidian exposes `activeDocument` and `activeWindow` as globals that
 * track the currently-focused window when popouts are open. The
 * lint rule `obsidianmd/use-active-document` requires plugin code to
 * use these instead of bare `document` / `window` so popout windows
 * work correctly.
 *
 * The Obsidian runtime defines these globals; jsdom doesn't. Tests
 * that exercise view code touch `activeDocument` and would throw
 * `ReferenceError: activeDocument is not defined` without this
 * polyfill. Under jsdom there's no popout, so aliasing each to its
 * regular counterpart is the same behaviour Obsidian gives when
 * everything's in the main window.
 *
 * Runs once before any test module loads. Must be in `setupFiles`
 * (not `setupFilesAfterEach`) so it's visible during module init,
 * which is when most view modules first evaluate.
 */

if (typeof globalThis !== "undefined") {
    const g = globalThis as unknown as {
        document?: Document;
        window?: Window;
        activeDocument?: Document;
        activeWindow?: Window;
    };
    if (g.document !== undefined && g.activeDocument === undefined) {
        g.activeDocument = g.document;
    }
    if (g.window !== undefined && g.activeWindow === undefined) {
        g.activeWindow = g.window;
    }
}
