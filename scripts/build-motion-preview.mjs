import { readFile, writeFile, mkdir } from "node:fs/promises";
import { build as buildApp } from "vite";
import { build as buildBridge } from "esbuild";

const fixtures = JSON.parse(await readFile("verification/music-art-fixtures.json", "utf8"));
const tracks = await Promise.all(fixtures.slice(0, 6).map(async (fixture, index) => ({
  id: "yt:preview-" + index,
  title: fixture.title,
  artist: fixture.artist,
  duration: fixture.duration || 240,
  artworkUrl: "data:image/jpeg;base64," + (await readFile(fixture.image)).toString("base64"),
  source: "youtube",
  tags: [],
  saved: true,
})));
const app = await buildApp({
  envFile: false,
  base: "./",
  build: {
    write: false,
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const output = (Array.isArray(app) ? app : [app]).flatMap(result => result.output);
const entry = output.find(file => file.type === "chunk" && file.isEntry);
const css = output.find(file => file.fileName.endsWith(".css"));
if (!entry || !css) throw Error("No se encontró el bundle del preview.");
const bridge = await buildBridge({
  entryPoints: ["scripts/motion-preview-bridge.ts"],
  bundle: true, platform: "browser", format: "iife", minify: true, write: false,
});
const script = value => value.replace(/<\/script/gi, "<\\/script");
const entryCode = script(entry.code);
const visualizerCss = await readFile("scripts/aura-preview.css", "utf8");
const html = `<!doctype html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><title>MURMUR · Preview de animaciones</title>
<style>${css.source}
${visualizerCss}
.preview-notice{background:#16111f;color:#eee6ff;text-align:center;font:600 12px system-ui;padding:9px 16px;letter-spacing:.02em}
</style></head><body>
<div class="preview-notice">MURMUR · Vista previa interactiva · Audio simulado</div>
<div id="root"></div>
<script>window.previewTracks=${script(JSON.stringify(tracks))};${script(bridge.outputFiles[0].text)}</script>
<script type="module">
await window.previewReady;
${entryCode}
</script></body></html>`;
await mkdir("preview", { recursive: true });
await writeFile("preview/MURMUR-animaciones.html", html);
console.log("Preview: preview/MURMUR-animaciones.html");
