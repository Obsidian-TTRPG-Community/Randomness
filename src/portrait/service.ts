/**
 * Portrait pack service.
 *
 * Owns pack discovery, manifest loading, and vault file access for the
 * portrait compositor (src/portrait/pack.ts). The compositor itself is
 * pure; this service is the only place portrait code touches the vault.
 *
 * Gating: portrait features (the ```portrait codeblock, future pane and
 * API) activate only when a valid pack folder — containing a
 * manifest.json — exists at settings.portraitPackPath. No pack, no
 * portrait UI: the processor renders a pointer to settings instead.
 * This keeps the feature invisible for users who haven't installed a
 * pack (see docs/randomness-integration.md in the npc-forge repo).
 */

import { normalizePath, requestUrl, arrayBufferToBase64, Notice } from "obsidian";
import { unzipSync } from "fflate";
import type RandomnessPlugin from "../views/main";
import { normalizeManifest, LoadFile } from "./pack";

/** Raw manifest type — the engine's normalizeManifest handles shape. */
type RawManifest = Record<string, unknown>;

/**
 * Official portrait pack release asset. The settings "Install Fantasy
 * Portrait Pack" button uses this; a `portraitPackUrl` value in
 * data.json (no UI) overrides it for self-hosted packs.
 */
export const OFFICIAL_PACK_URL =
    "https://github.com/Obsidian-TTRPG-Community/Randomness/releases/" +
    "download/portrait-pack-v1.0.0/fantasy-ink-parts-pack-v1.0.0.zip";

export class PortraitService {
    /**
     * Caches live for the plugin lifetime, invalidated when the pack
     * path setting changes or the user hits Re-check in settings.
     * The file cache holds base64 layer images; a full pack is a few
     * hundred small PNGs, the same working set the npc-forge harness
     * cached without trouble. Revisit if packs grow much larger.
     */
    private manifestCache = new Map<string, RawManifest>();
    private fileCache = new Map<string, string>();

    constructor(private plugin: RandomnessPlugin) {}

    /** Configured pack folder (vault-relative). Empty = unconfigured. */
    packPath(): string {
        return this.plugin.settings.portraitPackPath.trim();
    }

    invalidate(): void {
        this.manifestCache.clear();
        this.fileCache.clear();
    }

    /** True when a manifest.json exists at the given (or configured) pack path. */
    async available(pack?: string): Promise<boolean> {
        const p = (pack ?? this.packPath()).trim();
        if (p === "") return false;
        return this.plugin.app.vault.adapter.exists(
            normalizePath(`${p}/manifest.json`)
        );
    }

    /** Load + cache the raw manifest for a pack folder. Throws if unreadable. */
    async manifest(pack?: string): Promise<RawManifest> {
        const p = normalizePath((pack ?? this.packPath()).trim());
        const hit = this.manifestCache.get(p);
        if (hit !== undefined) return hit;
        const text = await this.plugin.app.vault.adapter.read(
            normalizePath(`${p}/manifest.json`)
        );
        const raw = JSON.parse(text) as RawManifest;
        this.manifestCache.set(p, raw);
        return raw;
    }

    /**
     * LoadFile implementation for the compositor: vault-relative reads
     * inside the pack folder; binary images come back base64-encoded
     * (what composePack expects for raster layers).
     */
    loader(pack?: string): LoadFile {
        const p = normalizePath((pack ?? this.packPath()).trim());
        return async (rel: string): Promise<string> => {
            const path = normalizePath(`${p}/${rel}`);
            const hit = this.fileCache.get(path);
            if (hit !== undefined) return hit;
            const adapter = this.plugin.app.vault.adapter;
            let out: string;
            if (/\.(png|jpe?g|webp)$/i.test(rel)) {
                out = arrayBufferToBase64(await adapter.readBinary(path));
            } else {
                out = await adapter.read(path);
            }
            this.fileCache.set(path, out);
            return out;
        };
    }
}

/**
 * Download a pack from a base URL into a vault folder. The URL must
 * serve manifest.json at its root (e.g. an unpacked GitHub release or
 * raw repo folder); every asset listed in the manifest is fetched
 * relative to it. Used by the "Install portrait pack" settings button.
 *
 * Writes via the adapter (binary) after ensuring folders exist.
 * Progress is surfaced through Notices since a pack is a few hundred
 * files. Returns the number of files written (including the manifest).
 */
export async function installPackFromUrl(
    plugin: RandomnessPlugin,
    baseUrl: string,
    destFolder: string
): Promise<number> {
    // Release-asset zips (the recommended distribution: one ~100MB
    // file on a GitHub release) take the unzip path; bare URLs are
    // treated as a hosted folder serving manifest.json + assets.
    if (/\.zip(\?|$)/i.test(baseUrl)) {
        const res = await requestUrl({ url: baseUrl });
        const n = await installPackFromZipBytes(
            plugin,
            new Uint8Array(res.arrayBuffer),
            destFolder
        );
        plugin.portraits.invalidate();
        return n;
    }
    const base = baseUrl.replace(/\/+$/, "");
    const dest = normalizePath(destFolder);
    const adapter = plugin.app.vault.adapter;

    const manifestRes = await requestUrl({ url: `${base}/manifest.json` });
    const rawText = manifestRes.text;
    const raw = JSON.parse(rawText) as RawManifest;
    const norm = normalizeManifest(raw);

    const ensureFolder = async (folder: string): Promise<void> => {
        if (!(await adapter.exists(folder))) {
            await adapter.mkdir(folder);
        }
    };
    await ensureFolder(dest);
    await adapter.write(normalizePath(`${dest}/manifest.json`), rawText);

    // Collect relative asset paths from the manifest (category-prefixed
    // when the filename isn't already a path).
    const rels: string[] = [];
    for (const [cat, files] of Object.entries(norm.layers)) {
        for (const f of files) {
            rels.push(f.includes("/") ? f : `${cat}/${f}`);
        }
    }

    let written = 1;
    for (const rel of rels) {
        const target = normalizePath(`${dest}/${rel}`);
        const folder = target.slice(0, target.lastIndexOf("/"));
        if (folder !== dest) await ensureFolder(folder);
        const res = await requestUrl({ url: `${base}/${rel}` });
        await adapter.writeBinary(target, res.arrayBuffer);
        written++;
        if (written % 25 === 0) {
            new Notice(`Portrait pack: ${written}/${rels.length + 1} files…`, 2000);
        }
    }
    plugin.portraits.invalidate();
    return written;
}

/**
 * Unpack a pack zip into the vault. Exported separately so tests can
 * exercise it with in-memory zip bytes (no network). The zip may have
 * everything at its root or under a single top-level folder (the
 * GitHub-typical layout) — the folder prefix is stripped so the
 * manifest always lands at <dest>/manifest.json. Backup folders
 * (entries whose path contains a "_"-prefixed segment) are skipped.
 */
export async function installPackFromZipBytes(
    plugin: RandomnessPlugin,
    bytes: Uint8Array,
    destFolder: string
): Promise<number> {
    const dest = normalizePath(destFolder);
    const adapter = plugin.app.vault.adapter;
    const entries = unzipSync(bytes);
    const paths = Object.keys(entries).filter(
        (p) => !p.endsWith("/") && entries[p].length > 0
    );

    // Locate manifest.json; derive the prefix to strip.
    const manifestEntry = paths
        .filter((p) => p.split("/").pop() === "manifest.json")
        .sort((a, b) => a.length - b.length)[0];
    if (!manifestEntry) {
        throw new Error("zip contains no manifest.json — not a portrait pack");
    }
    const prefix = manifestEntry.slice(0, manifestEntry.length - "manifest.json".length);

    const ensureFolder = async (folder: string): Promise<void> => {
        if (folder === "" || folder === dest.slice(0, -1)) return;
        if (await adapter.exists(folder)) return;
        const parent = folder.includes("/")
            ? folder.slice(0, folder.lastIndexOf("/"))
            : "";
        if (parent !== "") await ensureFolder(parent);
        await adapter.mkdir(folder);
    };
    await ensureFolder(dest);

    let written = 0;
    for (const p of paths) {
        if (!p.startsWith(prefix)) continue;
        const rel = p.slice(prefix.length);
        if (rel === "" || rel.includes("..")) continue;
        // skip backup/scratch folders (_base_backup_…, etc.)
        if (rel.split("/").some((seg) => seg.startsWith("_"))) continue;
        const target = normalizePath(`${dest}/${rel}`);
        const folder = target.slice(0, target.lastIndexOf("/"));
        await ensureFolder(folder);
        const data = entries[p];
        await adapter.writeBinary(
            target,
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
        );
        written++;
        if (written % 50 === 0) {
            new Notice(`Portrait pack: ${written}/${paths.length} files…`, 2000);
        }
    }
    return written;
}
