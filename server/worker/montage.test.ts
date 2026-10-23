import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defaultMontageSpec, effectiveTransition, montageProblems, montageSpecSchema, montageTimeline, type MontageSpec } from "../../shared/montage";
import { evaluateQc } from "../../shared/production";
import { normalizePexels, pickPexelsFile } from "../services/stock";
import { buildAss, chunkWords, wordTimings } from "./ass";
import { buildMontageGraph, montageWords, planMontageTotal, renderMontage } from "./montage";

const hasFfmpeg = (() => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

const spec = (over?: Partial<MontageSpec>): MontageSpec =>
  defaultMontageSpec({
    segments: [
      { id: "a", kind: "video", src: "/api/media/broll/a.mp4", in: 1, out: 5, words: [{ word: "hello", start: 1.2, end: 1.6 }, { word: "world", start: 1.7, end: 2.1 }, { word: "late", start: 9, end: 9.5 }] },
      { id: "b", kind: "image", src: "/api/media/character_image/b.jpg", duration: 4, motion: "slow_push" },
      { id: "c", kind: "video", src: "/api/media/broll/c.mp4", in: 0, out: 3, muted: true },
    ],
    ...over,
  });

describe("montage timeline", () => {
  it("subtracts transition overlaps and clamps the transition to half the shortest segment", () => {
    const s = spec({ transition: { type: "fade", duration: 2 } });
    expect(effectiveTransition(s)).toBe(1.5); // shortest segment is 3s
    const t = montageTimeline(s);
    expect(t.durations).toEqual([4, 4, 3]);
    expect(t.starts).toEqual([0, 2.5, 5]);
    expect(t.total).toBe(8);
  });
  it("has no overlap with hard cuts", () => {
    const t = montageTimeline(spec({ transition: { type: "none", duration: 0.5 } }));
    expect(t.starts).toEqual([0, 4, 8]);
    expect(t.total).toBe(11);
  });
  it("validates specs and reports plain problems", () => {
    expect(montageSpecSchema.safeParse(spec()).success).toBe(true);
    expect(montageSpecSchema.safeParse({ ...spec(), segments: [] }).success).toBe(false);
    expect(montageProblems(spec({ segments: [{ id: "x", kind: "video", src: "/api/media/x.mp4", in: 2, out: 2.1 }] }))[0]).toMatch(/أقصر/);
    expect(montageProblems(spec({ voice: { source: "segments" }, segments: [{ id: "i", kind: "image", src: "/api/media/i.jpg", duration: 5, motion: "pan_left" }] }))[0]).toMatch(/غير مكتوم/);
  });
});

describe("montage graph", () => {
  const inputs = { segments: [{ index: 0, hasAudio: true }, { index: 1, hasAudio: false }, { index: 2, hasAudio: true }], total: 12, assFile: "m.ass" };
  it("chains xfade with offsets from the timeline and pads the tail", () => {
    const g = buildMontageGraph(spec({ voice: { source: "segments" } }), inputs);
    expect(g).toContain("[0:v]trim=start=1.00:end=5.00");
    expect(g).toContain("zoompan=");
    expect(g).toContain("[v0][v1]xfade=transition=fade:duration=0.50:offset=3.50[x1]");
    expect(g).toContain("[x1][v2]xfade=transition=fade:duration=0.50:offset=7.00[x2]");
    expect(g).toContain("tpad=stop_mode=clone:stop_duration=2.00,ass=m.ass[v]");
    // clip audio from the first clip, silence for the still and the muted clip, crossfaded like the video
    expect(g).toContain("[0:a]atrim=start=1.00:end=5.00");
    expect(g).toContain("aevalsrc=0:d=4.00");
    expect(g).toContain("acrossfade=d=0.50");
    expect(g).toContain("[nar]loudnorm");
  });
  it("uses concat for hard cuts and TTS narration", () => {
    const g = buildMontageGraph(spec({ transition: { type: "none", duration: 0.5 } }), { ...inputs, voice: { index: 3, durationSec: 9 }, total: 11 });
    expect(g).toContain("[v0][v1][v2]concat=n=3:v=1:a=0[xc]");
    expect(g).not.toContain("xfade");
    expect(g).toContain("[3:a]aformat");
    expect(g).not.toContain("tpad");
  });
  it("ducks the music under the narration and mixes", () => {
    const g = buildMontageGraph(spec({ music: { assetId: 1, src: "/api/media/music/m.mp3", volume: 0.2, duck: true } }), { ...inputs, voice: { index: 3, durationSec: 9 }, music: { index: 4 } });
    expect(g).toContain("[4:a]aformat");
    expect(g).toContain("volume=0.200");
    expect(g).toContain("[nar]asplit=2[narA][narB]");
    expect(g).toContain("[mus0][narB]sidechaincompress");
    expect(g).toContain("[narA][mus]amix=inputs=2");
  });
  it("falls back to silence when there is no audio at all", () => {
    const g = buildMontageGraph(spec({ voice: { source: "none" } }), inputs);
    expect(g).toMatch(/aevalsrc=0:d=12\.00[^\n]*\[a\]/);
  });
  it("plans the output length around narration or the CTA tail", () => {
    expect(planMontageTotal(spec(), 9, true)).toBeCloseTo(12); // 9 + 0.4 + 2.6 > 10 visual
    expect(planMontageTotal(spec(), 5, true)).toBe(10); // visuals are longer
    expect(planMontageTotal(spec({ voice: { source: "segments" } }), null, true)).toBeCloseTo(12.6);
    expect(planMontageTotal(spec({ voice: { source: "segments" } }), null, false)).toBe(10);
  });
  it("places clip transcripts on the final timeline and keeps the trimmed-away words out", () => {
    const w = montageWords(spec({ voice: { source: "segments" } }), "", null);
    expect(w.map(x => x.word)).toEqual(["hello", "world"]);
    expect(w[0].start).toBeCloseTo(0.2);
    expect(w[1].end).toBeCloseTo(1.1);
    expect(montageWords(spec(), "one two three", 6)).toHaveLength(3);
    expect(montageWords(spec({ captions: { style: "none", position: "bottom" } }), "one two", 6)).toHaveLength(0);
  });
});

describe("caption styles", () => {
  const words = wordTimings("Water deeply twice a week. Roots chase moisture downward", 0.25, 6);
  it("groups classic captions by phrase and karaoke by three", () => {
    expect(chunkWords(words, "classic").map(g => g.length)).toEqual([5, 4]);
    expect(chunkWords(words, "karaoke").map(g => g.length)).toEqual([3, 3, 3]);
  });
  it("renders each style with its own ASS look", () => {
    const base = { words, hook: "Hook", cta: "Follow", disclosure: "AI-generated character", durationSec: 14, font: "Montserrat", colors: { primary: "#112233", accent: "#DFFF00", text: "#FFFFFF" } };
    const boxed = buildAss({ ...base, captionStyle: "boxed", captionPosition: "center" });
    expect(boxed).toContain("Style: Cap,Montserrat,80");
    expect(boxed).toMatch(/Style: Cap,[^\n]*,3,18,0,5,60,60,0,1/);
    const classic = buildAss({ ...base, captionStyle: "classic" });
    expect(classic).toContain("Water deeply twice a week.");
    expect(classic).not.toContain("\\c&H00FFDF&");
    const none = buildAss({ ...base, captionStyle: "none" });
    expect(none).not.toContain("Style: Cap,Montserrat,86,&HFFFFFF&,&HFFFFFF&,&H00000000&,&H64000000&,-1,0,0,0,100,100,0,0,1,7,2,2,60,60,430,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 5");
    expect(none.split("\n").filter(l => l.startsWith("Dialogue:") && l.includes(",Cap,"))).toHaveLength(0);
    expect(buildAss(base)).toContain("\\c&H00FFDF&");
  });
});

describe("stock normalization", () => {
  const video = {
    id: 42, width: 1080, height: 1920, url: "https://www.pexels.com/video/42/", image: "https://images.pexels.com/42.jpg", duration: 12,
    user: { name: "Jane Doe", url: "https://www.pexels.com/@jane" },
    video_files: [
      { link: "https://videos.pexels.com/4k.mp4", width: 2160, height: 3840, quality: "uhd", file_type: "video/mp4" },
      { link: "https://videos.pexels.com/hd.mp4", width: 1080, height: 1920, quality: "hd", file_type: "video/mp4" },
      { link: "https://videos.pexels.com/sd.mp4", width: 360, height: 640, quality: "sd", file_type: "video/mp4" },
      { link: "https://videos.pexels.com/land.mp4", width: 1920, height: 1080, quality: "hd", file_type: "video/mp4" },
    ],
  };
  it("prefers the largest portrait file that fits 1080×1920", () => {
    expect(pickPexelsFile(video)?.link).toBe("https://videos.pexels.com/hd.mp4");
    const n = normalizePexels(video)!;
    expect(n.credit).toBe("Video by Jane Doe on Pexels");
    expect(n.durationSec).toBe(12);
    expect(normalizePexels({ ...video, video_files: [] })).toBeNull();
  });
});

describe("qc for montages", () => {
  const base = { width: 1080, height: 1920, hasAudio: true, hasCaptions: true, hasDisclosure: true, fileSize: 3e6, maxSimilarity: 0, script: { hook: "a", body: "b c d e f g h i j k l m n o p q r s t u v w x y z aa bb cc dd ee", cta: "f", track: "economic" } };
  it("accepts longer reels only for the montage kind", () => {
    expect(evaluateQc({ ...base, kind: "montage", durationMs: 32000 }).checks.find(c => c.key === "duration")?.status).toBe("pass");
    expect(evaluateQc({ ...base, durationMs: 32000 }).checks.find(c => c.key === "duration")?.status).toBe("fail");
    expect(evaluateQc({ ...base, kind: "montage", durationMs: 95000 }).checks.find(c => c.key === "duration")?.status).toBe("fail");
  });
});

describe.skipIf(!hasFfmpeg)("montage render (ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "montage-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it("renders clips, a still, a music bed and captions into one reel", async () => {
    process.env.TTS_PROVIDER = "test";
    const clip = join(dir, "clip.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);
    const still = join(dir, "still.png");
    writeFileSync(still, execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x640:rate=1", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], { maxBuffer: 20 * 1024 * 1024 }));
    const music = join(dir, "music.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=110:duration=3", music]);
    const s = defaultMontageSpec({
      segments: [
        { id: "a", kind: "video", src: "/api/media/a.mp4", in: 0.5, out: 4.5 },
        { id: "b", kind: "image", src: "/api/media/b.png", duration: 3, motion: "pan_left" },
        { id: "c", kind: "video", src: "/api/media/c.mp4", in: 0, out: 3, muted: true },
      ],
      transition: { type: "wipeleft", duration: 0.4 },
      music: { assetId: 1, src: "/api/media/m.wav", volume: 0.3, duck: true },
      captions: { style: "boxed", position: "center" },
    });
    const out = await renderMontage({
      spec: s,
      files: [clip, still, clip],
      musicFile: music,
      spokenText: "Water deeply twice a week at sunrise instead of a little every evening",
      hook: "Less water",
      cta: "Follow for more",
      voice: "af_heart",
      speed: 1,
      font: "DejaVu Sans",
      colors: { primary: "#112233", accent: "#DFFF00", text: "#FFFFFF" },
      preview: true,
    });
    expect(out.width).toBe(540);
    expect(out.height).toBe(960);
    expect(out.hasCaptions).toBe(true);
    // 12 words * 0.34s ≈ 4.1s voice → total = max(9.2 visual, 4.1 + 0.4 + 2.6) = 9.2
    expect(out.durationMs).toBeGreaterThan(8800);
    expect(out.durationMs).toBeLessThan(9700);
    expect(out.video.length).toBeGreaterThan(10_000);
    expect(out.thumbnail.length).toBeGreaterThan(500);
  }, 120_000);
});
