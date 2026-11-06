import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { chaptersText, episodeProblems, episodeScriptSchema, episodeTimeline, timestamp, type EpisodeScript } from "../../shared/episodes";
import { normalizePexelsPhoto, pickPexelsFile } from "../services/stock";
import { wordTimings } from "./ass";
import { buildEpisodeAss, buildEpisodeAudioGraph, renderEpisode, sceneArgs } from "./episode-render";

vi.mock("../services/integration-vault", () => ({ getIntegrationConfig: async () => ({ apiKey: "test-key" }) }));
const { geminiSpeech, pcmToWav } = await import("./tts");

const hasFfmpeg = (() => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

const scenes = [
  { id: "a", narration: "لماذا سقطت الإمبراطورية بهذه السرعة؟ سؤال يبدو بسيطًا.", title: "البدايات", keywords: ["ottoman", "map"], chapter: "خطاف", durationSec: 6 },
  { id: "b", narration: "في البداية كانت الدولة قوية ومتماسكة.", keywords: ["empire"], chapter: "السياق", durationSec: 4.5 },
  { id: "c", narration: "ثم جاءت الحرب وتغير كل شيء.", title: "الحرب", keywords: ["war"], chapter: "السياق", durationSec: 5 },
];

describe("episode timeline", () => {
  it("places scenes after the intro with the gap and marks chapters once", () => {
    const tl = episodeTimeline(scenes);
    expect(tl.starts).toEqual([3, 9.35, 14.2]);
    expect(tl.total).toBeCloseTo(3 + 6.35 + 4.85 + 5.35 + 5);
    expect(tl.chapters).toEqual([{ time: 3, name: "خطاف" }, { time: 9.35, name: "السياق" }]);
  });
  it("writes YouTube chapters starting at 00:00 and keeps every chapter at least 10 seconds long", () => {
    expect(chaptersText(scenes, "المقدمة")).toBe("00:00 المقدمة");
    const long = [{ ...scenes[0], durationSec: 12 }, { ...scenes[1], durationSec: 30 }, { ...scenes[2], chapter: "الذروة", durationSec: 20 }];
    expect(chaptersText(long, "المقدمة")).toBe("00:00 المقدمة\n00:15 السياق\n00:45 الذروة");
    expect(timestamp(3725)).toBe("1:02:05");
  });
  it("reports missing visuals and language mismatches", () => {
    const script: EpisodeScript = { title: "t", hook: "h", scenes: scenes.map(s => ({ ...s })), outro: "o", description: "d", tags: [] };
    expect(episodeProblems(script, "ar")[0]).toMatch(/بلا لقطة/);
    expect(episodeProblems(null, "ar")[0]).toMatch(/لا يوجد سكربت/);
    const withVisuals = { ...script, scenes: script.scenes.map(s => ({ ...s, visual: { kind: "video" as const, src: "/api/media/broll/x.mp4" } })) };
    expect(episodeProblems(withVisuals, "ar")).toEqual([]);
    expect(episodeProblems({ ...withVisuals, scenes: [{ ...withVisuals.scenes[0], narration: "English only" }] }, "ar")[0]).toMatch(/ليست بالعربية/);
    expect(episodeScriptSchema.safeParse(withVisuals).success).toBe(true);
  });
});

describe("episode graphics (ASS 16:9)", () => {
  const base = {
    scenes: [{ start: 3, duration: 6.35, title: "البدايات" }, { start: 9.35, duration: 4.85 }, { start: 14.2, duration: 5.35, title: "الحرب" }],
    chapters: [{ time: 3, name: "خطاف" }, { time: 9.35, name: "السياق" }],
    intro: { title: "لماذا سقطت الإمبراطورية؟", channel: "وثائقيات التاريخ", seconds: 3 },
    outro: { text: "اشترك", seconds: 5 },
    total: 24.55,
    font: "IBM Plex Sans Arabic",
    colors: { primary: "#1B2A41", accent: "#DFFF00", text: "#F1F0EA" },
    disclosure: "تعليق صوتي مولَّد بالذكاء الاصطناعي",
  };
  it("uses phrase captions without inline colour tags for Arabic and right-side lower thirds", () => {
    const words = wordTimings("لماذا سقطت الإمبراطورية بهذه السرعة", 3.05, 6);
    const ass = buildEpisodeAss({ ...base, language: "ar", words });
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).not.toContain("\\c&H00FFDF&");
    expect(ass).toMatch(/Style: Title,[^\n]*,3,90,90,170,1/);
    expect(ass).toMatch(/Style: Badge,[^\n]*,7,40,40,32,1/);
    expect(ass).toMatch(/Style: Chapter,[^\n]*,9,90,90,90,1/);
    expect(ass.split("\n").filter(l => l.includes(",Cap,")).length).toBeGreaterThan(0);
    expect(ass).toContain(",Intro,,0,0,0,,{\\fad(200,300)}لماذا سقطت الإمبراطورية؟");
    expect(ass).toContain(",Chapter,,0,0,0,,{\\fad(200,250)}السياق");
    expect(ass).toContain(",Outro,,0,0,0,,{\\fad(250,0)}اشترك");
    expect(ass).toContain(",Title,,0,0,0,,{\\fad(200,250)}الحرب");
  });
  it("lights the active word for English and keeps captions out of the outro", () => {
    const words = wordTimings("Why did the empire fall so fast", 3.05, 6);
    const ass = buildEpisodeAss({ ...base, language: "en", words: [...words, { word: "late", start: 21, end: 22 }] });
    expect(ass).toContain("\\c&H00FFDF&");
    expect(ass).toMatch(/Style: Title,[^\n]*,1,90,90,170,1/);
    const capStarts = ass.split("\n").filter(l => l.includes(",Cap,")).map(l => l.split(",")[1]);
    expect(capStarts.every(t => t < "0:00:19.55")).toBe(true);
  });
});

describe("scene clips and audio graph", () => {
  it("trims and pads clips, Ken-Burns stills, halves everything in preview", () => {
    const v = sceneArgs({ kind: "video", file: "/x/clip.mp4", in: 2.5 }, 6.35, "/x/out.mp4");
    expect(v.join(" ")).toContain("-ss 2.50 -i /x/clip.mp4");
    expect(v.join(" ")).toContain("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080");
    expect(v.join(" ")).toContain("tpad=stop_mode=clone:stop_duration=6.35");
    expect(v.slice(-3)).toEqual(["-t", "6.35", "/x/out.mp4"]);
    const i = sceneArgs({ kind: "image", file: "/x/still.jpg", motion: "pan_left" }, 4, "/x/o.mp4", true);
    expect(i.join(" ")).toContain("zoompan=");
    expect(i.join(" ")).toContain("s=960x540");
    expect(i.join(" ")).toContain("d=120");
  });
  it("delays narration by the intro and ducks the music", () => {
    const g = buildEpisodeAudioGraph({ narrationIndex: 1, musicIndex: 2, introSec: 3, total: 60, musicVolume: 0.16, duck: true });
    expect(g).toContain("adelay=3000|3000");
    expect(g).toContain("[mus0][narB]sidechaincompress");
    expect(g).toContain("afade=t=out:st=58.00:d=2");
    expect(buildEpisodeAudioGraph({ narrationIndex: 1, musicIndex: null, introSec: 3, total: 60, musicVolume: 0, duck: true })).toContain("[nar]loudnorm");
  });
});

describe("free TTS and stock helpers", () => {
  it("wraps PCM into a valid WAV header", () => {
    const wav = pcmToWav(Buffer.alloc(48000), 24000, 1);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(48000);
    expect(wav.length).toBe(48044);
  });
  it("retries Gemini TTS on 429, falls back to the next model id on 404 and returns WAV", async () => {
    const calls: string[] = [];
    const pcm = Buffer.alloc(2400).toString("base64");
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-key");
      if (calls.length === 1) return new Response("", { status: 404 });
      if (calls.length === 2) return new Response("", { status: 429, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm } }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const wav = await geminiSpeech("مرحبا بكم", "Charon", fetchImpl);
    expect(calls[0]).toContain("gemini-3.1-flash-tts-preview");
    expect(calls[1]).toContain("gemini-2.5-flash-preview-tts");
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.length).toBe(2400 + 44);
  }, 30_000);
  it("prefers landscape renditions for episodes and normalizes photos", () => {
    const video = { id: 1, width: 1920, height: 1080, url: "https://www.pexels.com/video/1/", image: "https://images.pexels.com/1.jpg", duration: 10, video_files: [
      { link: "https://videos.pexels.com/p.mp4", width: 1080, height: 1920, file_type: "video/mp4" },
      { link: "https://videos.pexels.com/l.mp4", width: 1920, height: 1080, file_type: "video/mp4" },
      { link: "https://videos.pexels.com/4k.mp4", width: 3840, height: 2160, file_type: "video/mp4" },
    ] };
    expect(pickPexelsFile(video, "landscape")?.link).toBe("https://videos.pexels.com/l.mp4");
    expect(pickPexelsFile(video, "portrait")?.link).toBe("https://videos.pexels.com/p.mp4");
    const photo = normalizePexelsPhoto({ id: 9, width: 4000, height: 2250, url: "https://www.pexels.com/photo/9/", photographer: "Jane", src: { large2x: "https://images.pexels.com/photos/9/large2x.jpg" } });
    expect(photo?.credit).toBe("Photo by Jane on Pexels");
    expect(photo?.file).toContain("large2x");
  });
});

describe.skipIf(!hasFfmpeg)("episode render (ffmpeg, 960×540 preview)", () => {
  const dir = mkdtempSync(join(tmpdir(), "episode-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it("joins intro, scenes and outro with narration, captions and chapters", async () => {
    const clip = join(dir, "clip.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", clip]);
    const still = join(dir, "still.jpg");
    writeFileSync(still, execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=1", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], { maxBuffer: 8 * 1024 * 1024 }));
    const wavA = join(dir, "a.wav");
    const wavB = join(dir, "b.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=4", "-ar", "24000", wavA]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=2.5", "-ar", "24000", wavB]);
    const music = join(dir, "music.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=110:duration=3", music]);
    const out = await renderEpisode({
      language: "ar",
      title: "لماذا سقطت الإمبراطورية؟",
      channelName: "وثائقيات التاريخ",
      outroText: "اشترك ليصلك وثائقي جديد",
      scenes: [
        { id: "a", narration: "لماذا سقطت الإمبراطورية بهذه السرعة؟", title: "البدايات", keywords: [], chapter: "خطاف", durationSec: 4, source: { kind: "video", file: clip, in: 0.5 }, wav: wavA },
        { id: "b", narration: "ثم جاءت الحرب وتغير كل شيء.", keywords: [], chapter: "السياق", durationSec: 2.5, source: { kind: "image", file: still, motion: "pan_left" }, wav: wavB },
      ],
      sceneWords: [wordTimings("لماذا سقطت الإمبراطورية بهذه السرعة؟", 0.05, 4), wordTimings("ثم جاءت الحرب وتغير كل شيء.", 0.05, 2.5)],
      musicFile: music,
      musicVolume: 0.2,
      font: "IBM Plex Sans Arabic",
      colors: { primary: "#1B2A41", accent: "#DFFF00", text: "#F1F0EA" },
      disclosure: "تعليق صوتي مولَّد بالذكاء الاصطناعي",
      preview: true,
    });
    expect(out.width).toBe(960);
    expect(out.height).toBe(540);
    // 3 intro + (4 + .35) + (2.5 + .35) + 5 outro = 15.2
    expect(out.durationMs).toBeGreaterThan(14800);
    expect(out.durationMs).toBeLessThan(15700);
    expect(out.chapters.map(c => c.name)).toEqual(["خطاف", "السياق"]);
    expect(out.video.length).toBeGreaterThan(20_000);
    expect(out.thumbnail.length).toBeGreaterThan(1000);
    writeFileSync(join(dir, "out.mp4"), out.video);
    process.env.EPISODE_TEST_OUT = join(dir, "out.mp4");
  }, 180_000);
});
