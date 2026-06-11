/**
 * PNG export shared by the portrait codeblock and the roller pane:
 * rasterise a composed portrait's SVG via an offscreen <img> + canvas,
 * then write it into the vault with a deduped filename.
 *
 * Electron-only by nature (DOM canvas); never reached in Node tests.
 */

import { normalizePath } from "obsidian";
import type RandomnessPlugin from "../views/main";
import { Composed } from "./pack";

/** Stable, filesystem-safe stem for a portrait file. */
export function pngBaseName(composed: Composed): string {
    const seed = (composed.seed || "locked").replace(/[^\w.-]+/g, "_");
    return `portrait-${seed}`;
}

/** Rasterise the composed SVG at its native viewBox size. */
export async function composedToPngBuffer(
    composed: Composed
): Promise<ArrayBuffer> {
    const vb = /viewBox="([^"]+)"/.exec(composed.svg);
    const dims = vb ? vb[1].split(/\s+/).map(Number) : [0, 0, 1024, 1024];
    const w = dims[2] || 1024;
    const h = dims[3] || 1024;
    const img = new Image();
    const loaded = new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("svg rasterise failed"));
    });
    img.src =
        "data:image/svg+xml;charset=utf-8," + encodeURIComponent(composed.svg);
    await loaded;
    const canvas = activeDocument.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const cx = canvas.getContext("2d");
    if (!cx) throw new Error("no canvas context");
    cx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(
            (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
            "image/png"
        )
    );
    return blob.arrayBuffer();
}

/**
 * Save a composed portrait as PNG into `folder` (vault-relative; ""
 * = vault root). Creates the folder if missing, dedupes the filename,
 * returns the vault path written.
 */
export async function saveComposedPng(
    plugin: RandomnessPlugin,
    composed: Composed,
    folder: string
): Promise<string> {
    const buf = await composedToPngBuffer(composed);
    const adapter = plugin.app.vault.adapter;
    const dir = folder.trim().replace(/^\/+|\/+$/g, "");
    if (dir !== "" && !(await adapter.exists(normalizePath(dir)))) {
        await adapter.mkdir(normalizePath(dir));
    }
    const stem = pngBaseName(composed);
    const at = (n: number): string =>
        normalizePath(
            (dir === "" ? "" : dir + "/") + stem + (n === 0 ? "" : `-${n}`) + ".png"
        );
    let n = 0;
    while (await adapter.exists(at(n))) n++;
    const path = at(n);
    await plugin.app.vault.createBinary(path, buf);
    return path;
}
