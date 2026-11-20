import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderOverlay } from "../worker/code-video";
import { detectScenes, frameTimes, grabFrames, mapForPrompt, probeVideo, sceneIndex, sentencesFrom } from "./video-understanding";

const run = promisify(execFile);
let dir = "";
let clip = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "vu-"));
  clip = join(dir, "clip.mp4");
  // 1 s red then 1 s blue (a hard cut at 1 s), 360x640, with a 440 Hz tone.
  await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=360x640:d=1:r=30", "-f", "lavfi", "-i", "color=c=blue:s=360x640:d=1:r=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

async function pixel(file: string, n: number, x: number, y: number) {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),format=rgb24,crop=1:1:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "pipe:1"], { encoding: "buffer" } as never);
  const b = stdout as unknown as Buffer;
  return [b[0], b[1], b[2]];
}

describe("video understanding", () => {
  it("probes, finds the cut, picks frames and groups speech into sentences", async () => {
    const info = await probeVideo(clip);
    expect(info.width).toBe(360);
    expect(info.hasAudio).toBe(true);
    expect(info.duration).toBeGreaterThan(1.9);
    const cuts = await detectScenes(clip);
    expect(cuts).toHaveLength(1);
    expect(Math.abs(cuts[0] - 1)).toBeLessThan(0.1);
    expect(sceneIndex(0.5, cuts)).toBe(0);
    expect(sceneIndex(1.5, cuts)).toBe(1);
    const times = frameTimes(info.duration, cuts);
    expect(times.length).toBeGreaterThan(1);
    const frames = await grabFrames(clip, times.slice(0, 2), 120);
    expect(frames[0].subarray(0, 2).toString("hex")).toBe("ffd8"); // JPEG
    const s = sentencesFrom([{ word: "مرحبا", start: 0, end: 0.4 }, { word: "بكم.", start: 0.45, end: 0.8 }, { word: "اليوم", start: 2, end: 2.3 }]);
    expect(s.map(x => x.text)).toEqual(["مرحبا بكم.", "اليوم"]);
    const text = mapForPrompt({ ...info, words: [{ word: "مرحبا", start: 0, end: 0.4 }], sentences: s, scenes: [{ index: 0, start: 0, end: 1, summary: "red" }], frames: [{ t: 0.5, scene: 0, what: "red card", free: ["top"] }], transcriber: "local" });
    expect(text).toContain("WORDS (JSON");
    expect(text).toContain('["مرحبا",0,0.4]');
  }, 60_000);

  it("lays a transparent animation over the video and keeps its sound", async () => {
    const html = `<!doctype html><html><head><style>html,body{margin:0;width:360px;height:640px;background:transparent}#b{position:absolute;left:0;top:0;width:100px;height:100px;background:#fff}</style></head><body><div id="b"></div></body></html>`;
    const r = await renderOverlay({ html, videoPath: clip, width: 360, height: 640, durationSec: 2, fps: 30 });
    const out = join(dir, "out.mp4");
    await writeFile(out, r.video);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", out]);
    expect(stdout).toContain("video,360,640");
    expect(stdout).toContain("audio");
    expect((await pixel(out, 10, 50, 50))).toEqual(expect.arrayContaining([expect.any(Number)]));
    const [wr, wg, wb] = await pixel(out, 10, 50, 50); // under the white box
    expect(Math.min(wr, wg, wb)).toBeGreaterThan(220);
    const [r1, , b1] = await pixel(out, 10, 300, 500); // red video shows through
    expect(r1).toBeGreaterThan(200);
    expect(b1).toBeLessThan(60);
    const [r2, , b2] = await pixel(out, 50, 300, 500); // after the cut: blue
    expect(b2).toBeGreaterThan(200);
    expect(r2).toBeLessThan(60);
  }, 120_000);
});
