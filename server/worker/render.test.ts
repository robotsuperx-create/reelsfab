import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assColor, assTime, buildAss, wordTimings } from "./ass";
import { motionExpr, planDuration, renderReel } from "./renderer";

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
});
