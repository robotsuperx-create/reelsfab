/**
 * Frame-exact recorder for cinema plans: serves the runtime, the libraries (from node_modules, nothing from the
 * network) and the plan's own files, seeks the page to every frame and pipes the frames to ffmpeg.
 */
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { launchBrowser } from "../../worker/code-video";

const ROOT = process.cwd();
const RUNTIME = resolve(ROOT, "tools", "cinema", "runtime");
const NM = resolve(ROOT, "node_modules");
/** Library files the page may load, by public name. */
export const CINEMA_LIBS: Record<string, string> = {
  "three.module.min.js": "three/build/three.module.min.js",
  "postprocessing.js": "postprocessing/build/index.js",
  "topojson-client.min.js": "topojson-client/dist/topojson-client.min.js",
  "countries-50m.json": "world-atlas/countries-50m.json",
};
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function libPath(name: string) {
  if (CINEMA_LIBS[name]) return join(NM, CINEMA_LIBS[name]);
  if (name.startsWith("fonts/")) {
    const f = name.slice(6);
    if (!/^[a-z0-9-]+\.woff2$/.test(f)) return null;
    const pkg = f.startsWith("cairo-") ? "@fontsource/cairo" : f.startsWith("reem-kufi-") ? "@fontsource/reem-kufi" : null;
    return pkg ? join(NM, pkg, "files", f) : null;
  }
  if (name.startsWith("flags/")) {
    const f = name.slice(6);
    return /^[a-z]{2}(-[a-z]+)?\.svg$/.test(f) ? join(NM, "flag-icons", "flags", "4x3", f) : null;
  }
  return null;
}

/** Serves one job folder (plan.json + a/…) with the runtime and libraries on a local port. */
export async function serveCinema(dir: string): Promise<{ url: string; server: Server }> {
  const base = resolve(dir);
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      if (p === "/") p = "/index.html";
      let file: string | null = null;
      if (p === "/index.html" || p === "/cinema.js") file = join(RUNTIME, p.slice(1));
      else if (p.startsWith("/lib/")) file = libPath(p.slice(5));
      else if (p === "/plan.json" || p.startsWith("/a/")) {
        const f = normalize(join(base, p));
        file = f.startsWith(base) ? f : null;
      }
      if (!file) throw new Error("404");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  return { url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`, server };
}

export type RecordOptions = { dir: string; width: number; height: number; fps?: number; stills?: number[]; out?: string; onProgress?: (done: number, total: number) => void };

/** Records the plan in `dir` to `out` (silent H.264), or writes stills/t<sec>.jpg when `stills` is given. */
export async function recordCinema(o: RecordOptions): Promise<{ frames: number; errors: string[]; duration: number }> {
  const { url, server } = await serveCinema(o.dir);
  const browser = await launchBrowser(["--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=" + (process.platform === "win32" ? "d3d11" : "swiftshader")]);
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
    page.on("pageerror", e => errors.push(String(e.message ?? e).slice(0, 300)));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    await page.goto(url, { waitUntil: "load", timeout: 120_000 });
    await page.waitForFunction(() => (window as unknown as { READY?: boolean }).READY === true, null, { timeout: 180_000 }).catch(() => undefined);
    const ready = await page.evaluate(() => (window as unknown as { READY?: boolean }).READY === true);
    if (!ready) throw new Error(`الصفحة لم تجهز: ${errors.slice(0, 3).join(" | ") || "بلا خطأ ظاهر"}`);
    const duration = await page.evaluate(() => (window as unknown as { DURATION: number }).DURATION);
    const shot = () => page.screenshot({ type: "jpeg", quality: 94 });
    const seek = (t: number) => page.evaluate(t => (window as unknown as { renderAt: (t: number) => boolean }).renderAt(t), t);
    if (o.stills?.length) {
      await mkdir(join(o.dir, "stills"), { recursive: true });
      for (const t of o.stills) {
        await seek(t);
        await writeFile(join(o.dir, "stills", `t${t}.jpg`), await shot());
      }
      return { frames: o.stills.length, errors, duration };
    }
    const fps = o.fps ?? 30;
    const frames = Math.round(duration * fps);
    const out = o.out ?? join(o.dir, "silent.mp4");
    const ff = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(fps), "-movflags", "+faststart", out], { stdio: ["pipe", "ignore", "pipe"] });
    let ffErr = "";
    ff.stderr.on("data", d => { ffErr += d; });
    const closed = new Promise<void>((res, rej) => ff.on("close", c => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}: ${ffErr.slice(0, 300)}`)))));
    ff.stdin.on("error", () => undefined);
    for (let i = 0; i < frames; i++) {
      await seek(i / fps);
      const buf = await shot();
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
      if (i % 15 === 0) o.onProgress?.(i, frames);
    }
    ff.stdin.end();
    await closed;
    o.onProgress?.(frames, frames);
    return { frames, errors, duration };
  } finally {
    await browser.close().catch(() => undefined);
    server.close();
  }
}
