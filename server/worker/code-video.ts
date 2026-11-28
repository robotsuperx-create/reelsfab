/**
 * Renders a self-contained HTML animation to MP4, frame by frame, with a virtual clock:
 * Date, performance.now, timers, requestAnimationFrame, CSS/Web animations and media elements all follow the frame
 * counter instead of the wall clock, so a slow machine still produces a smooth video of the exact duration.
 *
 * Isolation: a separate headless Chromium with a clean environment (no studio env vars), a throwaway origin
 * (https://code-video.local), a strict Content-Security-Policy header and a network allow-list (public CDNs and
 * Google Fonts only). The page never sees the studio's origin, cookies, database or keys.
 */
import { execFile as execFileCb, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Route } from "playwright-core";
import { expandKit } from "../../shared/code-craft/kit";
import { CINEMA_SCALE, CINEMA_SUBFRAMES, CODE_VIDEO_ALLOWED_HOSTS, CODE_VIDEO_CSP, type RenderQuality } from "../../shared/code-video";
import { cleanCues, designSoundtrack, moodOf, type PageSound, type SoundMode } from "./sound/soundtrack";
import type { Mood } from "./sound/music";
import { MediaRoutes } from "./media-routes";

export const RENDER_ORIGIN = "https://code-video.local/";

/** Injected before any script of the page (main world). Exposes window.__cv { advance(ms), sync(), now() }. */
export const VIRTUAL_TIME_SCRIPT = `(() => {
  if (window.__cv) return;
  let now = 0;
  const epoch = Date.now();
  const RealDate = Date;
  function VDate(...a) {
    if (!(this instanceof VDate)) return new RealDate(epoch + now).toString();
    return a.length ? new RealDate(...a) : new RealDate(epoch + now);
  }
  VDate.prototype = RealDate.prototype;
  VDate.now = () => epoch + now;
  VDate.parse = RealDate.parse;
  VDate.UTC = RealDate.UTC;
  window.Date = VDate;
  Object.defineProperty(performance, "now", { value: () => now, configurable: true });
  if (document.timeline) { try { Object.defineProperty(document.timeline, "currentTime", { get: () => now, configurable: true }); } catch (e) {} }

  const timers = new Map();
  let timerId = 1;
  const call = (fn, args) => { try { typeof fn === "function" ? fn(...args) : (0, eval)(String(fn)); } catch (e) { console.error(e); } };
  window.setTimeout = (fn, ms, ...args) => { const id = timerId++; timers.set(id, { fn, args, at: now + Math.max(0, Number(ms) || 0), every: 0 }); return id; };
  window.setInterval = (fn, ms, ...args) => { const id = timerId++; const every = Math.max(1, Number(ms) || 0); timers.set(id, { fn, args, at: now + every, every }); return id; };
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };

  let frames = new Map();
  let frameId = 1;
  window.requestAnimationFrame = cb => { const id = frameId++; frames.set(id, cb); return id; };
  window.cancelAnimationFrame = id => { frames.delete(id); };

  const born = new WeakMap();
  function sync() {
    for (const a of document.getAnimations()) {
      if (!born.has(a)) born.set(a, now);
      try { a.pause(); a.currentTime = now - born.get(a); } catch (e) {}
    }
    for (const m of document.querySelectorAll("video, audio")) {
      try { m.muted = true; m.pause(); const d = m.duration; m.currentTime = d && isFinite(d) && m.loop ? (now / 1000) % d : now / 1000; } catch (e) {}
    }
  }
  function advance(dt) {
    const target = now + dt;
    for (let guard = 0; guard < 100000; guard++) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) break;
      const [id, t] = next;
      now = Math.max(now, t.at);
      if (t.every) t.at += t.every; else timers.delete(id);
      call(t.fn, t.args);
    }
    now = target;
    const due = [...frames.values()];
    frames = new Map();
    for (const cb of due) call(cb, [now]);
    sync();
  }
  window.__cv = { advance, sync, now: () => now };
})();`;

/** Chromium for the renderer: CODE_VIDEO_CHROMIUM, Playwright's own download, then installed Chrome / Edge. */
export async function launchBrowser(extraArgs: string[] = []) {
  const { chromium } = await import("playwright-core");
  // Clean environment: the page process must not inherit the studio's secrets.
  const keep = ["PATH", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES", "ProgramFiles", "PROGRAMFILES(X86)", "ProgramFiles(x86)", "LANG", "FONTCONFIG_PATH", "XDG_RUNTIME_DIR"];
  const env: Record<string, string> = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k]!;
  const base = { headless: true, env, args: ["--hide-scrollbars", "--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--force-color-profile=srgb", ...extraArgs] };
  const attempts: (() => Promise<import("playwright-core").Browser>)[] = [];
  if (process.env.CODE_VIDEO_CHROMIUM) attempts.push(() => chromium.launch({ ...base, executablePath: process.env.CODE_VIDEO_CHROMIUM }));
  attempts.push(() => chromium.launch(base));
  for (const exe of downloadedChromiums()) attempts.push(() => chromium.launch({ ...base, executablePath: exe }));
  attempts.push(() => chromium.launch({ ...base, channel: "chrome" }));
  attempts.push(() => chromium.launch({ ...base, channel: "msedge" }));
  let last: unknown;
  for (const attempt of attempts) {
    try { return await attempt(); } catch (e) { last = e; }
  }
  throw new Error(`لم أجد متصفح Chromium أو Chrome أو Edge على هذا الجهاز لتحويل الكود (${last instanceof Error ? last.message.split("\n")[0] : String(last)})`);
}

/** Any Chromium a Playwright install already downloaded (another version than ours still works for screenshots). */
function downloadedChromiums() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "ms-playwright"), join(homedir(), ".cache", "ms-playwright"), join(homedir(), "Library", "Caches", "ms-playwright")].filter(Boolean) as string[];
  const out: string[] = [];
  for (const root of roots) {
    let dirs: string[] = [];
    try { dirs = readdirSync(root).filter(d => /^chromium(_headless_shell)?-\d+$/.test(d)).sort().reverse(); } catch { continue; }
    for (const d of dirs) {
      for (const rel of ["chrome-win/chrome.exe", "chrome-win64/chrome.exe", "chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const exe = join(root, d, rel);
        if (existsSync(exe)) out.push(exe);
      }
    }
  }
  return out;
}

export function isAllowedRequest(url: string) {
  if (url === RENDER_ORIGIN) return true;
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (CODE_VIDEO_ALLOWED_HOSTS as readonly string[]).includes(u.hostname);
  } catch {
    return false;
  }
}

export type CodeVideoRender = { video: Buffer; poster: Buffer; frames: number; blocked: string[]; consoleErrors: string[]; audio?: { cues: number; mood: Mood | null }; pageSound?: PageSound | null };

/**
 * Sound for a render: "auto" = the kit's cues (sound effects on every movement) + a music bed; "music" = only the bed;
 * "off" = silent. The mood comes from the option, else from the page (storyboard), else "calm".
 */
export type RenderSound = { mode?: SoundMode; mood?: Mood | null; musicFile?: string | null; offsetSec?: number; totalSec?: number; seed?: number };

/**
 * Libraries and fonts from the allowed CDNs are kept on disk after the first download: every render opens a fresh
 * browser, so without this each one re-downloads GSAP and the fonts (slow, and a render fails if the network blinks).
 * CODE_VIDEO_CDN_CACHE=off disables it; any other value is the folder to use.
 */
export function cdnCacheDir() {
  const v = process.env.CODE_VIDEO_CDN_CACHE?.trim();
  if (v === "off" || v === "0") return null;
  return v || join(homedir(), ".reellllocal", "cdn-cache");
}

async function fromCdn(route: Route, url: string) {
  const dir = cdnCacheDir();
  if (!dir) return route.continue();
  const key = createHash("sha1").update(url).digest("hex");
  const bodyFile = join(dir, `${key}.bin`);
  const metaFile = join(dir, `${key}.json`);
  try {
    const [body, meta] = await Promise.all([readFile(bodyFile), readFile(metaFile, "utf8")]);
    const { contentType } = JSON.parse(meta) as { contentType?: string };
    return route.fulfill({ status: 200, body, contentType: contentType || "application/octet-stream", headers: { "access-control-allow-origin": "*", "cache-control": "max-age=31536000" } });
  } catch {
    /* not cached yet */
  }
  try {
    const res = await route.fetch({ timeout: 30_000 });
    const body = await res.body();
    if (res.ok() && body.length) {
      await mkdir(dir, { recursive: true });
      await writeFile(bodyFile, body);
      await writeFile(metaFile, JSON.stringify({ url, contentType: res.headers()["content-type"] ?? "" }));
    }
    return route.fulfill({ response: res, body });
  } catch {
    return route.abort("failed").catch(() => undefined);
  }
}

/** The page (with the motion kit inlined when it asks for it) on the throwaway origin; only allowed hosts get through. */
async function routeIsolated(context: BrowserContext, html: string, blocked: string[], size?: { width: number; height: number }) {
  const body = expandKit(html);
  // Stored pictures and clip frames the page shows (served from the studio's storage, nothing else).
  const media = new MediaRoutes(size?.width ?? 1080, size?.height ?? 1920);
  context.on("close", () => void media.dispose());
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (url === RENDER_ORIGIN) {
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "content-security-policy": CODE_VIDEO_CSP, "cache-control": "no-store" }, body });
    }
    if (media.handles(url)) return media.fulfill(route, url);
    if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    if (isAllowedRequest(url)) return fromCdn(route, url);
    if (blocked.length < 20) blocked.push(url.slice(0, 200));
    return route.abort("blockedbyclient");
  });
}

/** Moves the virtual clock, then waits for the pictures the page just asked for (clip frames, photos) to decode. */
function advanceSettled(page: import("playwright-core").Page, dt: number) {
  return page.evaluate(async d => {
    const w = window as unknown as { __cv: { advance: (x: number) => void }; __cvSettle?: () => Promise<unknown> | null };
    w.__cv.advance(d);
    const p = w.__cvSettle?.();
    if (p) await p;
  }, dt);
}

/**
 * Opens the HTML at width×height, steps the virtual clock 1000/fps ms per frame, screenshots every frame and pipes
 * the JPEGs to ffmpeg (H.264, yuv420p, veryfast). `onProgress` gets 0..1.
 */
export async function renderCodeVideo(opts: { html: string; width: number; height: number; durationSec: number; fps: number; quality?: RenderQuality; sound?: RenderSound; onProgress?: (p: number) => void }): Promise<CodeVideoRender> {
  const { width, height, fps } = opts;
  // Cinema: every frame is drawn at 2× and scaled down (clean edges and thin lines), and is the blend of several
  // moments inside the frame's interval (real motion blur), encoded slower at higher quality.
  const cinema = opts.quality === "cinema";
  const sub = cinema ? CINEMA_SUBFRAMES : 1;
  const dpr = cinema ? CINEMA_SCALE : 1;
  const frames = Math.max(1, Math.round(opts.durationSec * fps));
  const browser = await launchBrowser();
  const dir = await mkdtemp(join(tmpdir(), "code-video-"));
  const outFile = join(dir, "out.mp4");
  const blocked: string[] = [];
  const consoleErrors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: "block", reducedMotion: "no-preference" });
    await routeIsolated(context, opts.html, blocked, { width, height });
    await context.addInitScript({ content: VIRTUAL_TIME_SCRIPT });
    const page = await context.newPage();
    page.on("console", m => { if (m.type() === "error" && consoleErrors.length < 20) consoleErrors.push(m.text().slice(0, 300)); });
    page.on("pageerror", e => { if (consoleErrors.length < 20) consoleErrors.push(String(e.message).slice(0, 300)); });
    await page.goto(RENDER_ORIGIN, { waitUntil: "load", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready).catch(() => undefined);
    const ok = await page.evaluate(() => Boolean((window as unknown as { __cv?: unknown }).__cv));
    if (!ok) throw new Error("تعذر تجهيز الساعة الافتراضية في الصفحة");
    // The kit logged its sound cues while it built the timeline (before the first frame).
    const pageSound = (await page.evaluate(() => (window as unknown as { __cvSound?: unknown }).__cvSound ?? null).catch(() => null)) as PageSound | null;

    const encode = cinema
      ? ["-vf", `tmix=frames=${sub},fps=${fps},scale=${width}:${height}:flags=lanczos`, "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-tune", "animation", "-profile:v", "high"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"];
    const ff = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps * sub), "-c:v", "mjpeg", "-i", "-", ...encode, "-pix_fmt", "yuv420p", "-r", String(fps), "-movflags", "+faststart", outFile], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    ff.stderr.on("data", d => { err += d; });
    const done = new Promise<void>((resolve, reject) => {
      ff.on("error", reject);
      ff.on("close", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(0, 400)}`))));
    });
    ff.stdin.on("error", () => undefined);
    const write = (buf: Buffer) => new Promise<void>((resolve, reject) => ff.stdin.write(buf, e => (e ? reject(e) : resolve())));

    let poster: Buffer | null = null;
    const posterFrame = Math.min(frames - 1, Math.round(fps * Math.min(1.5, opts.durationSec / 2)));
    const step = 1000 / fps;
    const subStep = step / sub;
    for (let i = 0; i < frames; i++) {
      for (let k = 0; k < sub; k++) {
        // Frame 0 is painted half a (sub)frame in, as a browser paints after its first animation frame: GSAP and
        // similar tickers only apply a tween's starting state (gsap.from) once their clock has moved past one tick.
        await advanceSettled(page, i === 0 && k === 0 ? subStep / 2 : subStep);
        const shot = await page.screenshot({ type: "jpeg", quality: cinema ? 95 : 92, animations: "allow", caret: "hide", scale: cinema ? "device" : "css" });
        if (i === posterFrame && k === sub - 1) poster = shot;
        await write(shot);
      }
      if (i % 5 === 0 || i === frames - 1) opts.onProgress?.((i + 1) / frames);
    }
    ff.stdin.end();
    await done;
    await browser.close().catch(() => undefined);
    const audio = await addSoundtrack(outFile, dir, opts.durationSec, pageSound, opts.sound);
    const video = await readFile(audio ? join(dir, "with-sound.mp4") : outFile);
    if (video.length < 1000) throw new Error("ffmpeg لم يُخرج فيديو");
    return { video, poster: poster!, frames, blocked, consoleErrors, audio: audio ?? undefined, pageSound };
  } finally {
    await browser.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Builds the soundtrack (cues + music bed) and muxes it into `videoFile` → dir/with-sound.mp4. Null when silent. */
export async function addSoundtrack(videoFile: string, dir: string, durationSec: number, page: PageSound | null, opt?: RenderSound) {
  const mode = opt?.mode ?? "off";
  if (mode === "off") return null;
  const cues = mode === "auto" && page?.sfx !== false ? cleanCues(page?.cues, durationSec) : [];
  const mood: Mood | null = page?.music === false && !opt?.musicFile ? null : opt?.mood ?? moodOf(page?.mood, "calm");
  if (!cues.length && !mood && !opt?.musicFile) return null;
  const { wav } = await designSoundtrack({ durationSec, cues, mood, musicFile: opt?.musicFile, offsetSec: opt?.offsetSec, totalSec: opt?.totalSec, seed: opt?.seed });
  const wavFile = join(dir, "sound.wav");
  await writeFile(wavFile, wav);
  await new Promise<void>((resolve, reject) => {
    execFileCb("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", videoFile, "-i", wavFile, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", durationSec.toFixed(3), "-movflags", "+faststart", join(dir, "with-sound.mp4")], { maxBuffer: 8 * 1024 * 1024 }, e => (e ? reject(e) : resolve()));
  });
  return { cues: cues.length, mood };
}

/**
 * Stills at given seconds (for the agent's visual review): same isolation and virtual clock, the clock is walked
 * in 50 ms steps (GSAP treats bigger jumps as lag) and only the requested moments are photographed.
 */
export async function captureStills(opts: { html: string; width: number; height: number; at: number[]; scale?: number }): Promise<{ stills: Buffer[]; consoleErrors: string[]; blocked: string[] }> {
  const { width, height } = opts;
  const browser = await launchBrowser();
  const blocked: string[] = [];
  const consoleErrors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: opts.scale ?? 0.5, serviceWorkers: "block" });
    await routeIsolated(context, opts.html, blocked, { width, height });
    await context.addInitScript({ content: VIRTUAL_TIME_SCRIPT });
    const page = await context.newPage();
    page.on("pageerror", e => { if (consoleErrors.length < 20) consoleErrors.push(String(e.message).slice(0, 300)); });
    await page.goto(RENDER_ORIGIN, { waitUntil: "load", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready).catch(() => undefined);
    const stills: Buffer[] = [];
    let t = 0;
    for (const target of [...opts.at].sort((a, b) => a - b)) {
      const ms = Math.max(16, target * 1000);
      while (t < ms) {
        const dt = Math.min(50, ms - t);
        await advanceSettled(page, dt);
        t += dt;
      }
      stills.push(await page.screenshot({ type: "jpeg", quality: 80, scale: "device" }));
    }
    return { stills, consoleErrors, blocked };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** An isolated page (same CSP, allow-list and virtual clock as the renderer), ready at t = 0. */
async function openIsolatedPage(browser: import("playwright-core").Browser, html: string, width: number, height: number, scale = 1) {
  const blocked: string[] = [];
  const consoleErrors: string[] = [];
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, serviceWorkers: "block" });
  await routeIsolated(context, html, blocked, { width, height });
  await context.addInitScript({ content: VIRTUAL_TIME_SCRIPT });
  const page = await context.newPage();
  page.on("console", m => { if (m.type() === "error" && consoleErrors.length < 20) consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", e => { if (consoleErrors.length < 20) consoleErrors.push(String(e.message).slice(0, 300)); });
  await page.goto(RENDER_ORIGIN, { waitUntil: "load", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready).catch(() => undefined);
  if (!(await page.evaluate(() => Boolean((window as unknown as { __cv?: unknown }).__cv)))) throw new Error("تعذر تجهيز الساعة الافتراضية في الصفحة");
  const advance = (dt: number) => advanceSettled(page, dt);
  return { page, blocked, consoleErrors, advance };
}

/**
 * Animation on top of the owner's video: the HTML is rendered with a transparent background (PNG per frame) and
 * laid over the video, cropped/scaled to width×height, with the video's own sound kept.
 */
export async function renderOverlay(opts: { html: string; videoPath: string; width: number; height: number; durationSec: number; fps: number; onProgress?: (p: number) => void }): Promise<CodeVideoRender> {
  const { width, height, fps } = opts;
  const frames = Math.max(1, Math.round(opts.durationSec * fps));
  const browser = await launchBrowser();
  const dir = await mkdtemp(join(tmpdir(), "code-overlay-"));
  const outFile = join(dir, "out.mp4");
  try {
    const { page, blocked, consoleErrors, advance } = await openIsolatedPage(browser, opts.html, width, height);
    const filter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[base];[1:v]format=rgba[ov];[base][ov]overlay=0:0:format=auto,format=yuv420p[v]`;
    const ff = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", opts.videoPath, "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-", "-filter_complex", filter, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-c:a", "aac", "-b:a", "160k", "-r", String(fps), "-t", opts.durationSec.toFixed(3), "-movflags", "+faststart", outFile], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    ff.stderr.on("data", d => { err += d; });
    const done = new Promise<void>((resolve, reject) => {
      ff.on("error", reject);
      ff.on("close", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(0, 400)}`))));
    });
    ff.stdin.on("error", () => undefined);
    const write = (buf: Buffer) => new Promise<void>((resolve, reject) => ff.stdin.write(buf, e => (e ? reject(e) : resolve())));
    const step = 1000 / fps;
    for (let i = 0; i < frames; i++) {
      await advance(i === 0 ? step / 2 : step);
      await write(await page.screenshot({ type: "png", omitBackground: true, animations: "allow", caret: "hide", scale: "css" }));
      if (i % 5 === 0 || i === frames - 1) opts.onProgress?.((i + 1) / frames);
    }
    ff.stdin.end();
    await done;
    const video = await readFile(outFile);
    const posterAt = Math.min(opts.durationSec / 2, 1.5).toFixed(2);
    const poster = await new Promise<Buffer>((resolve, reject) => {
      execFileCb("ffmpeg", ["-v", "error", "-ss", posterAt, "-i", outFile, "-frames:v", "1", "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(out as Buffer)));
    });
    return { video, poster, frames, blocked, consoleErrors };
  } finally {
    await browser.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Transparent stills of the overlay at given seconds, laid on the matching video frames (for the agent's review). */
export async function overlayStills(opts: { html: string; videoPath: string; width: number; height: number; at: number[] }) {
  const browser = await launchBrowser();
  const dir = await mkdtemp(join(tmpdir(), "overlay-stills-"));
  try {
    const { page, consoleErrors, blocked, advance } = await openIsolatedPage(browser, opts.html, opts.width, opts.height, 0.5);
    const stills: Buffer[] = [];
    let t = 0;
    for (const target of [...opts.at].sort((a, b) => a - b)) {
      const ms = Math.max(16, target * 1000);
      while (t < ms) {
        const dt = Math.min(50, ms - t);
        await advance(dt);
        t += dt;
      }
      const png = join(dir, `o${stills.length}.png`);
      await page.screenshot({ type: "png", omitBackground: true, scale: "device", path: png });
      const w = Math.round(opts.width / 2), h = Math.round(opts.height / 2);
      const jpg = await new Promise<Buffer>((resolve, reject) => {
        execFileCb("ffmpeg", ["-v", "error", "-ss", target.toFixed(2), "-i", opts.videoPath, "-i", png, "-filter_complex", `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[b];[b][1:v]overlay=0:0`, "-frames:v", "1", "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(out as Buffer)));
      });
      stills.push(jpg);
    }
    return { stills, consoleErrors, blocked };
  } finally {
    await browser.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}


/** Runs inside the page (kept as plain JS text so bundler helpers never leak into it). */
const INSPECT_FRAME = `function (W, H, minPx) {
        const AR = /[؀-ۿ]/;
        const visible = (el) => {
          const s = getComputedStyle(el);
          if (s.display === "none" || s.visibility === "hidden") return false;
          let op = 1;
          for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
          return op > 0.15;
        };
        const label = (el) => (el.id ? \`#\${el.id}\` : el.className && typeof el.className === "string" ? \`.\${el.className.trim().split(/\\s+/)[0]}\` : el.tagName.toLowerCase()) + ((el.textContent ?? "").trim() ? \` «\${(el.textContent ?? "").trim().slice(0, 24)}»\` : "");
        const texts = [];
        const overflow = [];
        const small = [];
        const spaced = [];
        let split = 0;
        for (const el of Array.from(document.body.querySelectorAll("*"))) {
          if (!visible(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          const own = Array.from(el.childNodes).filter(c => c.nodeType === 3).map(c => c.textContent ?? "").join("").trim();
          const out = Math.max(-r.left, -r.top, r.right - W, r.bottom - H);
          if (own && out > 8) overflow.push(\`\${label(el)} يخرج \${Math.round(out)}px\`);
          if (own) {
            texts.push({ el, r });
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < minPx) small.push(\`\${label(el)} حجمه \${Math.round(fs)}px\`);
            if (AR.test(own)) {
              if (own.replace(/\\s/g, "").length <= 2 && el.parentElement && el.parentElement.children.length > 3) split++;
              const ls = getComputedStyle(el).letterSpacing;
              if (ls !== "normal" && parseFloat(ls) !== 0) spaced.push(label(el));
            }
          }
        }
        const overlaps = [];
        for (let i = 0; i < texts.length; i++) {
          for (let j = i + 1; j < texts.length; j++) {
            const a = texts[i], b = texts[j];
            if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
            if ((a.el.textContent ?? "").trim() === (b.el.textContent ?? "").trim()) continue;
            const x = Math.max(0, Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left));
            const y = Math.max(0, Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top));
            if (x * y > 0.25 * Math.min(a.r.width * a.r.height, b.r.width * b.r.height)) overlaps.push(\`\${label(a.el)} ↔ \${label(b.el)}\`);
          }
        }
        return { overflow: overflow.slice(0, 4), overlaps: overlaps.slice(0, 4), small: small.slice(0, 4), splitArabic: split, spacedArabic: spaced.slice(0, 3), visibleTexts: texts.length };
      }`;

export type RawInspection = {
  consoleErrors: string[];
  blocked: string[];
  timelineSec: number | null;
  loops: boolean;
  stills: Buffer[];
  stillTimes: number[];
  /** Per sampled moment: elements out of the frame, overlapping texts, small text, split Arabic, letter-spaced Arabic. */
  findings: { t: number; overflow: string[]; overlaps: string[]; small: string[]; splitArabic: number; spacedArabic: string[]; visibleTexts: number }[];
  /** Moments (s) where two consecutive samples look identical: nothing moved. */
  still: number[];
};

/**
 * Runs pasted code the way the renderer will and measures what usually goes wrong with AI-written animations:
 * script errors, blocked requests, the real timeline length, loops, elements outside the frame, overlapping text,
 * text too small for a phone, Arabic split into letters or letter-spaced, and stretches where nothing moves.
 */
export async function inspectCode(opts: { html: string; width: number; height: number; durationSec: number }): Promise<RawInspection> {
  const { width, height } = opts;
  const browser = await launchBrowser();
  try {
    const { page, blocked, consoleErrors, advance } = await openIsolatedPage(browser, opts.html, width, height, 0.4);
    const timing = await page.evaluate(() => {
      const w = window as unknown as { gsap?: { globalTimeline: { getChildren: (a: boolean, b: boolean, c: boolean) => { endTime: () => number; totalDuration: () => number; repeat?: () => number }[] } } };
      let end = 0;
      let loops = false;
      let seen = false;
      if (w.gsap) {
        for (const c of w.gsap.globalTimeline.getChildren(false, true, true)) {
          seen = true;
          if ((c.repeat?.() ?? 0) < 0 || c.totalDuration() > 1e6) loops = true;
          else end = Math.max(end, c.endTime());
        }
      }
      for (const a of document.getAnimations()) {
        const t = a.effect?.getComputedTiming();
        if (!t) continue;
        seen = true;
        if (t.iterations === Infinity) loops = true;
        else end = Math.max(end, Number(t.endTime ?? 0) / 1000);
      }
      return { end: seen ? end : null, loops };
    });
    const n = Math.min(10, Math.max(4, Math.round(opts.durationSec / 3)));
    const times = Array.from({ length: n }, (_, i) => +((opts.durationSec * (i + 0.5)) / n).toFixed(2));
    const stills: Buffer[] = [];
    const findings: RawInspection["findings"] = [];
    let t = 0;
    for (const target of times) {
      const ms = target * 1000;
      while (t < ms) {
        const dt = Math.min(50, ms - t);
        await advance(dt);
        t += dt;
      }
      const f = (await page.evaluate(`(${INSPECT_FRAME})(${width}, ${height}, ${height > width ? 34 : 28})`)) as Omit<RawInspection["findings"][number], "t">;
      findings.push({ t: target, ...f });
      stills.push(await page.screenshot({ type: "jpeg", quality: 70, scale: "device" }));
    }
    const still: number[] = [];
    for (let i = 1; i < stills.length; i++) if (stills[i].equals(stills[i - 1])) still.push(times[i]);
    return { consoleErrors, blocked, timelineSec: timing.end, loops: timing.loops, stills, stillTimes: times, findings, still };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
