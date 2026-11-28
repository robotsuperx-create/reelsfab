// Frame-exact recorder for the reel page: serves this folder, seeks the page to each frame, pipes JPEGs to ffmpeg.
// node render.mjs stills 1,4.5,9     → stills/t1.jpg …
// node render.mjs video 30 out.mp4   → silent video at 30 fps
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const dir = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(pathToFileURL("C:/Users/HP/Projects/reelsfab/node_modules/playwright-core/index.mjs").href);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".mjs": "text/javascript" };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const body = await readFile(join(dir, p === "/" ? "index.html" : p));
    res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const args = ["--hide-scrollbars", "--mute-audio", "--force-color-profile=srgb", "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=d3d11"];
let browser;
for (const o of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
  try { browser = await chromium.launch({ headless: true, args, ...o }); break; } catch (e) { console.error("launch failed", o, String(e).slice(0, 120)); }
}
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => window.READY === true, null, { timeout: 120000 }).catch(() => {});
if (errors.length) console.error("PAGE ERRORS:\n" + errors.join("\n"));
const duration = await page.evaluate(() => window.DURATION);
const shot = () => page.screenshot({ type: "jpeg", quality: 94 });
const mode = process.argv[2] ?? "stills";

if (mode === "stills") {
  await mkdir(join(dir, "stills"), { recursive: true });
  const times = (process.argv[3] ?? "1,5,9,13,18.5,21,23.5,26,29").split(",").map(Number);
  for (const t of times) {
    // Walk up to t so per-frame state (none here, but cheap) stays consistent.
    await page.evaluate(t => window.renderAt(t), t);
    await writeFile(join(dir, "stills", `t${t}.jpg`), await shot());
  }
  console.log("stills", times.join(","));
} else {
  const fps = Number(process.argv[3] ?? 30);
  const out = join(dir, process.argv[4] ?? "silent.mp4");
  const frames = Math.round(duration * fps);
  const ff = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(fps), "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate(t => window.renderAt(t), i / fps);
    const buf = await shot();
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
    if (i % 60 === 0) console.log(`frame ${i}/${frames} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on("close", r));
  console.log("video", out, frames, "frames", ((Date.now() - t0) / 1000).toFixed(0) + "s");
}
if (errors.length) console.error("PAGE ERRORS:\n" + errors.slice(0, 10).join("\n"));
await browser.close();
server.close();
