import esbuild from "esbuild";
await esbuild.build({
    entryPoints: ["docs-tools/docroll.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: "docs-tools/docroll.cjs",
    logLevel: "info",
});
