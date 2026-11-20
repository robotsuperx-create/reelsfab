import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { codeVideoPrompt, withCodeVideoCsp } from "../../shared/code-video";
import { isAllowedRequest, renderCodeVideo } from "./code-video";

const run = promisify(execFile);

/** RGB of one pixel of frame `n` (0-based). */
async function pixel(file: string, n: number, x: number, y: number) {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),format=rgb24,crop=1:1:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: "buffer" } as never);
  const b = stdout as unknown as Buffer;
  return [b[0], b[1], b[2]];
}

// Left half: a CSS keyframe animation red → blue over 2 s. Right half: a requestAnimationFrame loop that paints
// green proportional to performance.now() / 2000. A late setTimeout (1 s) adds a white bar.
const HTML = `<!doctype html><html><head><style>
html,body{margin:0;width:360px;height:640px;overflow:hidden;background:#000}
#css{position:absolute;left:0;top:0;width:180px;height:640px;animation:c 2s linear forwards}
@keyframes c{from{background:rgb(255,0,0)}to{background:rgb(0,0,255)}}
#raf{position:absolute;left:180px;top:0;width:180px;height:640px}
#late{position:absolute;left:0;top:600px;width:360px;height:40px;background:#fff;display:none}
</style></head><body><div id="css"></div><div id="raf"></div><div id="late"></div><script>
const el=document.getElementById('raf');
function tick(t){const g=Math.min(255,Math.round(255*performance.now()/2000));el.style.background='rgb(0,'+g+',0)';requestAnimationFrame(tick)}
requestAnimationFrame(tick);
setTimeout(()=>{document.getElementById('late').style.display='block'},1000);
</script></body></html>`;

describe("code → video", () => {
  it("puts the CSP first in <head> for the preview, whatever the file looks like", () => {
    expect(withCodeVideoCsp("<!doctype html><html><head><title>x</title></head></html>")).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"[^>]*><title>/);
    expect(withCodeVideoCsp("<!DOCTYPE html><body>hi</body>")).toMatch(/^<!DOCTYPE html><head><meta http-equiv="Content-Security-Policy"/);
    expect(withCodeVideoCsp("<div>hi</div>")).toMatch(/^<head><meta http-equiv="Content-Security-Policy"[^>]*><\/head><div>/);
    expect(codeVideoPrompt(1080, 1920, 15)).toContain("مقاس 1080x1920، مدة الأنيميشن 15 ثانية");
  });

  it("lets the page reach only public CDNs and Google Fonts", () => {
    expect(isAllowedRequest("https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js")).toBe(true);
    expect(isAllowedRequest("https://fonts.gstatic.com/s/cairo/v28/x.woff2")).toBe(true);
    expect(isAllowedRequest("data:image/png;base64,AAAA")).toBe(true);
    expect(isAllowedRequest("http://localhost:3100/api/trpc/integrations.list")).toBe(false);
    expect(isAllowedRequest("http://127.0.0.1:3100/")).toBe(false);
    expect(isAllowedRequest("https://evil.example/steal")).toBe(false);
    expect(isAllowedRequest("http://cdn.jsdelivr.net/x.js")).toBe(false);
  });

  it("steps CSS animations, rAF, performance.now and timers on a virtual clock and encodes an exact-length MP4", async () => {
    const progress: number[] = [];
    const r = await renderCodeVideo({ html: HTML, width: 360, height: 640, durationSec: 2, fps: 30, onProgress: p => progress.push(p) });
    expect(r.frames).toBe(60);
    expect(progress.at(-1)).toBe(1);
    const dir = await mkdtemp(join(tmpdir(), "cv-test-"));
    try {
      const file = join(dir, "v.mp4");
      await writeFile(file, r.video);
      const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames,width,height,pix_fmt", "-of", "csv=p=0", file]);
      expect(stdout.trim()).toBe("360,640,yuv420p,60");
      const [r0, , b0] = await pixel(file, 0, 90, 300);
      const [r1, , b1] = await pixel(file, 59, 90, 300);
      expect(r0).toBeGreaterThan(200); // red at t=0
      expect(b0).toBeLessThan(60);
      expect(b1).toBeGreaterThan(200); // ~blue at t≈1.97 s
      expect(r1).toBeLessThan(40);
      const g15 = (await pixel(file, 15, 270, 300))[1]; // t = 0.5 s → ~64
      const g45 = (await pixel(file, 45, 270, 300))[1]; // t = 1.5 s → ~191
      expect(Math.abs(g15 - 64)).toBeLessThan(14);
      expect(Math.abs(g45 - 191)).toBeLessThan(14);
      expect((await pixel(file, 20, 180, 620))[0]).toBeLessThan(60); // timer not fired yet at 0.67 s
      expect((await pixel(file, 40, 180, 620))[0]).toBeGreaterThan(200); // fired at 1 s
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("blocks requests outside the allow-list (the studio itself, other hosts)", async () => {
    const html = `<!doctype html><html><head></head><body style="margin:0;background:#123"><script>
      fetch('http://127.0.0.1:3100/api/health').catch(()=>{});
      const i=new Image(); i.src='https://evil.example/pixel.png';
    </script></body></html>`;
    const r = await renderCodeVideo({ html, width: 320, height: 320, durationSec: 1, fps: 30 });
    expect(r.frames).toBe(30);
    // The CSP stops both before they leave the page; nothing reached the network.
    expect(r.blocked.every(u => !u.startsWith("https://cdnjs"))).toBe(true);
    expect(r.consoleErrors.join("\n")).toMatch(/Content Security Policy|blocked/i);
  }, 60_000);
});

describe("stills for the agent's review", () => {
  it("photographs the requested moments on the virtual clock", async () => {
    const { captureStills } = await import("./code-video");
    const html = `<!doctype html><html><head><style>html,body{margin:0;width:200px;height:200px}#b{width:200px;height:200px;animation:c 2s linear forwards}@keyframes c{from{background:#f00}to{background:#00f}}</style></head><body><div id="b"></div></body></html>`;
    const r = await captureStills({ html, width: 200, height: 200, at: [0.1, 1.9], scale: 0.5 });
    expect(r.stills).toHaveLength(2);
    expect(r.stills[0].length).toBeGreaterThan(200);
    expect(r.stills[0].equals(r.stills[1])).toBe(false);
  }, 60_000);
});
