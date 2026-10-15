import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assColor, assTime, buildAss, wordTimings } from "./ass";
import { motionExpr, planDuration, renderFromVideo, renderReel } from "./renderer";

const hasFfmpeg = (() => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

describe("ass builder", () => {
  it("converts colours to ASS BGR order", () => {
    expect(assColor("#DFFF00")).toBe("&H00FFDF&");
    expect(assColor("nonsense", "#FF0000")).toBe("&H0000FF&");
  });
  it("formats timestamps", () => {
    expect(assTime(3661.5)).toBe("1:01:01.50");
    expect(assTime(0.999)).toBe("0:00:01.00".replace("1.00", "0.99").replace("0:00:0", "0:00:0"));
  });
  it("spreads words across the voice window in order", () => {
    const w = wordTimings("Stop doing this. Do that instead", 0.25, 6);
    expect(w).toHaveLength(6);
    expect(w[0].start).toBeCloseTo(0.25);
    expect(w[5].end).toBeCloseTo(6.25);
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBeCloseTo(w[i - 1].end);
  });
  it("includes disclosure badge, hook and CTA card", () => {
    const ass = buildAss({
      words: wordTimings("one two three four five", 0.25, 5),
      hook: "Stop wasting money",
      cta: "Follow for more",
      disclosure: "AI-generated character",
      durationSec: 14,
      font: "Montserrat",
      colors: { primary: "#112233", accent: "#DFFF00", text: "#FFFFFF" },
    });
    expect(ass).toContain("AI-generated character");
    expect(ass).toContain("STOP WASTING MONEY");
    expect(ass).toContain("Follow for more");
  });
});

describe("planning", () => {
  it("keeps reels within 13.2–15.4 seconds", () => {
    expect(planDuration(5)).toBe(13.2);
    expect(planDuration(14)).toBe(15.4);
  });
  it("defines every template motion", () => {
    for (const m of ["slow_push", "slow_pull", "pan_left", "split_zoom", "step_zoom"]) {
      expect(motionExpr(m, 400).z.length).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!hasFfmpeg)("server render (ffmpeg)", () => {
  it("produces a valid 1080x1920 reel with audio", async () => {
    process.env.TTS_PROVIDER = "test";
    const png = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1024x1024:rate=1", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], { maxBuffer: 20 * 1024 * 1024 });
    const out = await renderReel({
      image: png,
      imageExt: "png",
      spokenText: "Stop making this common mistake with your savings every single month. Do this simple thing instead and watch the difference. Follow for more.",
      hook: "Stop making this mistake",
      cta: "Follow for more tips",
      voice: "af_heart",
      speed: 1,
      font: "DejaVu Sans",
      colors: { primary: "#102030", accent: "#DFFF00", text: "#FFFFFF" },
      motion: "slow_push",
    });
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
    expect(out.durationMs).toBeGreaterThan(13000);
    expect(out.durationMs).toBeLessThan(15600);
    expect(out.fileSize).toBeGreaterThan(50_000);
    expect(out.thumbnail.length).toBeGreaterThan(1000);
  }, 120_000);

  const probe = (buf: Buffer) => {
    const file = `/tmp/reel-probe-${Date.now()}.mp4`;
    execFileSync("bash", ["-c", `cat > ${file}`], { input: buf });
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", file]).toString();
    return out;
  };
  const makeClip = (withAudio: boolean, seconds: number) =>
    execFileSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", `testsrc2=size=720x1280:rate=30:duration=${seconds}`,
      ...(withAudio ? ["-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`] : []),
      "-c:v", "libx264", "-preset", "ultrafast", ...(withAudio ? ["-c:a", "aac", "-shortest"] : []),
      "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "-",
    ], { maxBuffer: 50 * 1024 * 1024 });

  it("renders a premium/derivative reel from source video (captions + CTA tail)", async () => {
    const out = await renderFromVideo({
      video: makeClip(true, 8),
      words: [{ word: "Water", start: 0.2, end: 0.6 }, { word: "deeply", start: 0.6, end: 1.1 }, { word: "today", start: 1.1, end: 1.6 }],
      hook: "Watch this before you water",
      cta: "Follow for garden notes",
      font: "DejaVu Sans",
      colors: { primary: "#2F4F2A", accent: "#F2C14E", text: "#FFFFFF" },
    });
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
    expect(out.durationMs).toBeGreaterThan(10_300);
    expect(out.durationMs).toBeLessThan(10_900);
    const streams = probe(out.video);
    expect(streams).toContain("1080,1920");
    expect(streams).toContain("audio");
  }, 120_000);

  it("caps long clips at 12.8s + CTA and survives a clip without audio", async () => {
    const out = await renderFromVideo({ video: makeClip(false, 16), words: [], hook: null, cta: "Follow", font: "DejaVu Sans", colors: { primary: "#000000", accent: "#DFFF00", text: "#FFFFFF" } });
    expect(out.durationMs).toBeGreaterThan(15_000);
    expect(out.durationMs).toBeLessThan(15_600);
    expect(probe(out.video)).toContain("audio");
  }, 120_000);
});
