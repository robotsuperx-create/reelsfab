/**
 * Renders a self-contained HTML animation to MP4, frame by frame, with a virtual clock:
 * Date, performance.now, timers, requestAnimationFrame, CSS/Web animations and media elements all follow the frame
 * counter instead of the wall clock, so a slow machine still produces a smooth video of the exact duration.
 *
 * Isolation: a separate headless Chromium with a clean environment (no studio env vars), a throwaway origin
 * (https://code-video.local), a strict Content-Security-Policy header and a network allow-list (public CDNs and
 * Google Fonts only). The page never sees the studio's origin, cookies, database or keys.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CODE_VIDEO_ALLOWED_HOSTS, CODE_VIDEO_CSP } from "../../shared/code-video";

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
async function launchBrowser() {
  const { chromium } = await import("playwright-core");
  // Clean environment: the page process must not inherit the studio's secrets.
  const keep = ["PATH", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES", "ProgramFiles", "PROGRAMFILES(X86)", "ProgramFiles(x86)", "LANG", "FONTCONFIG_PATH", "XDG_RUNTIME_DIR"];
  const env: Record<string, string> = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k]!;
  const base = { headless: true, env, args: ["--hide-scrollbars", "--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--force-color-profile=srgb"] };
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

export type CodeVideoRender = { video: Buffer; poster: Buffer; frames: number; blocked: string[]; consoleErrors: string[] };

/**
 * Opens the HTML at width×height, steps the virtual clock 1000/fps ms per frame, screenshots every frame and pipes
 * the JPEGs to ffmpeg (H.264, yuv420p, veryfast). `onProgress` gets 0..1.
 */
export async function renderCodeVideo(opts: { html: string; width: number; height: number; durationSec: number; fps: number; onProgress?: (p: number) => void }): Promise<CodeVideoRender> {
  const { width, height, fps } = opts;
  const frames = Math.max(1, Math.round(opts.durationSec * fps));
  const browser = await launchBrowser();
  const dir = await mkdtemp(join(tmpdir(), "code-video-"));
  const outFile = join(dir, "out.mp4");
  const blocked: string[] = [];
  const consoleErrors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: "block", reducedMotion: "no-preference" });
    await context.route("**/*", async route => {
      const url = route.request().url();
      if (url === RENDER_ORIGIN) {
        return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "content-security-policy": CODE_VIDEO_CSP, "cache-control": "no-store" }, body: opts.html });
      }
      if (isAllowedRequest(url)) return route.continue();
      if (blocked.length < 20) blocked.push(url.slice(0, 200));
      return route.abort("blockedbyclient");
    });
    await context.addInitScript({ content: VIRTUAL_TIME_SCRIPT });
    const page = await context.newPage();
    page.on("console", m => { if (m.type() === "error" && consoleErrors.length < 20) consoleErrors.push(m.text().slice(0, 300)); });
    page.on("pageerror", e => { if (consoleErrors.length < 20) consoleErrors.push(String(e.message).slice(0, 300)); });
    await page.goto(RENDER_ORIGIN, { waitUntil: "load", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready).catch(() => undefined);
    const ok = await page.evaluate(() => Boolean((window as unknown as { __cv?: unknown }).__cv));
    if (!ok) throw new Error("تعذر تجهيز الساعة الافتراضية في الصفحة");

    const ff = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(fps), "-movflags", "+faststart", outFile], { stdio: ["pipe", "ignore", "pipe"] });
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
    for (let i = 0; i < frames; i++) {
      // Frame 0 is painted half a frame in, as a browser paints after its first animation frame: GSAP and similar
      // tickers only apply a tween's starting state (gsap.from) once their clock has moved past one tick.
      await page.evaluate(dt => (window as unknown as { __cv: { advance: (d: number) => void } }).__cv.advance(dt), i === 0 ? step / 2 : step);
      const shot = await page.screenshot({ type: "jpeg", quality: 92, animations: "allow", caret: "hide", scale: "css" });
      if (i === posterFrame) poster = shot;
      await write(shot);
      if (i % 5 === 0 || i === frames - 1) opts.onProgress?.((i + 1) / frames);
    }
    ff.stdin.end();
    await done;
    const video = await readFile(outFile);
    if (video.length < 1000) throw new Error("ffmpeg لم يُخرج فيديو");
    return { video, poster: poster!, frames, blocked, consoleErrors };
  } finally {
    await browser.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
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
    await context.route("**/*", async route => {
      const url = route.request().url();
      if (url === RENDER_ORIGIN) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "content-security-policy": CODE_VIDEO_CSP }, body: opts.html });
      if (isAllowedRequest(url)) return route.continue();
      if (blocked.length < 20) blocked.push(url.slice(0, 200));
      return route.abort("blockedbyclient");
    });
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
        await page.evaluate(d => (window as unknown as { __cv: { advance: (x: number) => void } }).__cv.advance(d), dt);
        t += dt;
      }
      stills.push(await page.screenshot({ type: "jpeg", quality: 80, scale: "device" }));
    }
    return { stills, consoleErrors, blocked };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
