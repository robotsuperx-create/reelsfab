import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageFromPasted, storyboardPrompt, themeFor, withCodeVideoCsp } from "../../shared/code-video";
import { CV_KIT_SOURCE } from "../../shared/code-craft/kit-source";
import { GSAP_URL, KIT_FONTS_URL, KIT_PLACEHOLDER, expandKit, usesKit } from "../../shared/code-craft/kit";
import { guessKind } from "../../shared/code-craft/knowledge";
import { compileStoryboard, looksLikeStoryboard, normalizeStoryboard, storyboardFromHtml } from "../../shared/code-craft/storyboard";
import { composeVideo, parseReview, settledTimes } from "./code-director";

const root = join(import.meta.dirname, "..", "..");

describe("motion kit", () => {
  it("ships the same kit as its source file (run `pnpm kit:build` after editing cv-kit.js)", () => {
    expect(CV_KIT_SOURCE).toBe(readFileSync(join(root, "tools/code-video/kit/cv-kit.js"), "utf8"));
    expect(CV_KIT_SOURCE).not.toMatch(/<\/script/i);
  });

  it("inlines the kit where the page asks for it, after GSAP and the fonts", () => {
    const page = `<!doctype html><html><head>${KIT_PLACEHOLDER}</head><body><script>CV.play({scenes:[]})</script></body></html>`;
    const out = expandKit(page);
    expect(out).not.toContain(KIT_PLACEHOLDER);
    expect(out.indexOf(GSAP_URL)).toBeGreaterThan(0);
    expect(out.indexOf(GSAP_URL)).toBeLessThan(out.indexOf("data-cv-kit-version"));
    expect(out).toContain(KIT_FONTS_URL.replace(/&/g, "&"));
    expect(out.indexOf("data-cv-kit-version")).toBeLessThan(out.indexOf("CV.play({scenes"));
  });

  it("adds the kit before the first script that calls CV, and leaves other pages alone", () => {
    const calls = `<!doctype html><html><head><script src="${GSAP_URL}"></script></head><body><div></div><script>const cv = CV.create({});cv.finish()</script></body></html>`;
    const out = expandKit(calls);
    expect(out.split(`src="${GSAP_URL}"`).length).toBe(2); // GSAP already there: not added twice
    expect(out.indexOf("data-cv-kit-version")).toBeLessThan(out.indexOf("const cv = CV.create"));
    const plain = "<!doctype html><html><body><script>gsap.to('#a',{x:1})</script></body></html>";
    expect(usesKit(plain)).toBe(false);
    expect(expandKit(plain)).toBe(plain);
    // The preview gets the same expansion, under the CSP.
    expect(withCodeVideoCsp(calls)).toMatch(/Content-Security-Policy[\s\S]*data-cv-kit-version/);
  });
});

describe("storyboards", () => {
  const raw = {
    theme: "nope",
    scenes: [
      { from: 0, to: 4, items: [{ type: "title", text: "عنوان قصير", emphasis: ["قصير"] }] },
      { from: 4, to: 9, items: [{ type: "stat", value: "42", suffix: "%", label: "نسبة" }, { type: "wobble", text: "x" }] },
      { from: 9, to: 12, items: [{ type: "kinetic", lines: ["سطر", "سطر ثان"] }] },
    ],
    end: { text: "النهاية", cta: "تابع", seconds: 3 },
  };

  it("fills the exact duration back to back, keeps the end card's time, and reports what it changed", () => {
    const { storyboard, issues } = normalizeStoryboard(raw, 15, "neon");
    expect(storyboard.theme).toBe("neon");
    expect(storyboard.scenes[0].from).toBe(0);
    for (let i = 1; i < storyboard.scenes.length; i++) expect(storyboard.scenes[i].from).toBe(storyboard.scenes[i - 1].to);
    expect(storyboard.scenes.at(-1)!.to).toBe(12); // 15 − 3 s of end card
    expect(storyboard.end?.seconds).toBe(3);
    expect(storyboard.scenes[1].items).toEqual([{ type: "stat", value: 42, prefix: "", suffix: "%", decimals: 0, label: "نسبة" }]);
    expect(issues.some(i => i.includes('unknown item type "wobble"'))).toBe(true);
  });

  it("scales scenes that do not add up, and flags crowded, wordy and monotonous scenes", () => {
    const long = { scenes: [0, 1, 2, 3].map(i => ({ from: i * 10, to: i * 10 + 10, items: [{ type: "title", text: "كلمة كلمة كلمة كلمة كلمة كلمة كلمة كلمة كلمة كلمة كلمة كلمة كلمة كلمة" }] })) };
    const { storyboard, issues } = normalizeStoryboard(long, 8);
    expect(storyboard.scenes.at(-1)!.to).toBe(8);
    expect(issues.some(i => i.includes("scaled to fit"))).toBe(true);
    expect(issues.some(i => i.includes("need about"))).toBe(true);
    expect(issues.some(i => i.includes('all lead with "title"'))).toBe(true);
    const crowded = normalizeStoryboard({ scenes: [{ from: 0, to: 10, items: Array.from({ length: 6 }, () => ({ type: "icon", name: "star" })) }] }, 10);
    expect(crowded.storyboard.scenes[0].items).toHaveLength(4);
    expect(crowded.issues.some(i => i.includes("crowded"))).toBe(true);
  });

  it("compiles to a kit page that keeps the storyboard and cannot be broken out of", () => {
    const { storyboard } = normalizeStoryboard({ scenes: [{ from: 0, to: 5, items: [{ type: "title", text: "</script><script>alert(1)</script>" }] }] }, 5);
    const html = compileStoryboard(storyboard, { width: 1080, height: 1920, durationSec: 5 });
    expect(html).toContain(KIT_PLACEHOLDER);
    expect(html.match(/<\/script>/g)).toHaveLength(3); // placeholder + JSON block + player: the title's tag is escaped
    expect(storyboardFromHtml(html)?.scenes[0].items[0]).toMatchObject({ type: "title" });
    expect(html).toContain('dir="ltr"');
  });

  it("accepts a storyboard pasted from any AI (fenced JSON) in place of HTML", () => {
    const text = "```json\n" + JSON.stringify(raw) + "\n```";
    expect(looksLikeStoryboard(text)).toBe(true);
    expect(looksLikeStoryboard("<!doctype html><html></html>")).toBe(false);
    const page = pageFromPasted(text, 1080, 1920, 15, "documentary");
    expect(page.storyboard?.theme).toBe("documentary");
    expect(page.html).toContain('dir="rtl"');
    expect(() => pageFromPasted('{"scenes": [ oops', 1080, 1920, 15)).toThrow(/JSON/);
    expect(pageFromPasted("<html><body>x</body></html>", 1080, 1920, 15).storyboard).toBeNull();
  });

  it("guesses the kind of video and the look, and writes the prompt for free AIs", () => {
    expect(guessKind("تاريخ حرب الخليج", 120)).toBe("documentary");
    expect(guessKind("عرض خاص على منتج جديد في المتجر", 30)).toBe("promo");
    expect(guessKind("نصيحة صباحية", 15)).toBe("reel");
    expect(themeFor("neon", "documentary")).toBe("neon");
    expect(themeFor(null, "reel")).toBe("kinetic");
    const p = storyboardPrompt(1080, 1920, 15, null, "فكرة عن الادخار");
    expect(p).toContain("Return ONLY the JSON object");
    expect(p).toContain("فكرة عن الادخار");
    expect(p).toContain("PACING — reel");
  });
});

describe("director loop", () => {
  const sb = (title: string) => JSON.stringify({ theme: "kinetic", scenes: [{ from: 0, to: 5, note: "hook", items: [{ type: "title", text: title }] }, { from: 5, to: 10, items: [{ type: "stat", value: 3, label: "مرات" }] }] });
  const review = (n: number) => JSON.stringify({ scores: { legibility: n, hierarchy: n, composition: n, story: n, polish: n }, issues: n < 8 ? ["frame 1: title too small"] : [] });

  it("scores legibility double and reads loose answers", () => {
    expect(parseReview(JSON.stringify({ scores: { legibility: 4, hierarchy: 10, composition: 10, story: 10, polish: 10 } })).overall).toBe(8);
    expect(parseReview("not json").overall).toBe(0);
    expect(parseReview("```json\n" + review(9) + "\n```").overall).toBe(9);
  });

  it("revises below the bar, stops when it passes, keeps the chosen theme and the best version", async () => {
    const calls: string[] = [];
    let critic = 0;
    const r = await composeVideo({
      idea: "فكرة",
      durationSec: 10,
      width: 1080,
      height: 1920,
      theme: "documentary",
      themeChosen: true,
      kind: "reel",
      ask: async (system, _prompt, what) => {
        calls.push(what);
        if (system.includes("creative director")) return review(critic++ === 0 ? 6 : 9);
        return sb(calls.filter(c => !c.includes("النقد")).length === 1 ? "أول" : "ثان");
      },
      stills: async (_h, _w, _hh, at) => at.map(() => Buffer.from("jpg")),
      measure: async () => [],
    });
    expect(r.reviews.map(x => x.overall)).toEqual([6, 9]);
    expect(r.best).toBe(1);
    expect(r.storyboard.theme).toBe("documentary");
    expect(r.storyboard.scenes[0].items[0]).toMatchObject({ text: "ثان" });
    expect(calls.filter(c => c.includes("النقد"))).toHaveLength(2);
  });

  it("never passes a version with measured errors, and keeps the best one when revisions get worse", async () => {
    let n = 0;
    const r = await composeVideo({
      idea: "x",
      durationSec: 10,
      width: 1080,
      height: 1920,
      theme: "neon",
      themeChosen: false,
      kind: "explainer",
      rounds: 1,
      ask: async system => (system.includes("creative director") ? review(n++ === 0 ? 9 : 5) : sb("t")),
      stills: async (_h, _w, _hh, at) => at.map(() => Buffer.from("jpg")),
      measure: async () => (n === 0 ? [{ code: "overflow", severity: "error" as const, message: "عناصر تخرج من الإطار" }] : []),
    });
    expect(r.reviews[0].overall).toBe(6); // 9 from the critic, capped by the measured error
    expect(r.reviews[1].overall).toBe(5);
    expect(r.best).toBe(0);
  });

  it("photographs each scene once it has settled, at most 8 frames", () => {
    const { storyboard } = normalizeStoryboard({ scenes: Array.from({ length: 12 }, (_, i) => ({ from: i * 3, to: i * 3 + 3, items: [{ type: "icon", name: "star" }] })), end: { text: "x" } }, 40);
    const at = settledTimes(storyboard, 40);
    expect(at.length).toBeLessThanOrEqual(8);
    expect(at[0]).toBeLessThan(storyboard.scenes[0].to);
    expect(at[0]).toBeGreaterThan(storyboard.scenes[0].to - 0.5);
  });
});

// Needs GSAP and the fonts from the CDN (or a filled CODE_VIDEO_CDN_CACHE). CODE_VIDEO_OFFLINE=1 skips it.
describe.skipIf(process.env.CODE_VIDEO_OFFLINE === "1")("kit pages in the real recorder", () => {
  it("plays a storyboard exactly: right length, nothing off-frame or overlapping, Arabic kept whole", async () => {
    const { inspectCode } = await import("../worker/code-video");
    const { storyboard } = normalizeStoryboard(
      {
        theme: "documentary",
        lang: "ar",
        scenes: [
          { from: 0, to: 3, items: [{ type: "kicker", text: "سؤال" }, { type: "title", text: "من يدفع الثمن؟", emphasis: ["الثمن"] }] },
          { from: 3, to: 6, transition: "flash", items: [{ type: "stat", value: 40, suffix: "%", label: "ارتفاع الأسعار" }] },
          { from: 6, to: 9, transition: "mask", items: [{ type: "list", items: ["الرواتب الثابتة", "المتقاعدون"], numbered: true }] },
        ],
        end: { text: "الخلاصة", cta: "تابع", seconds: 3 },
      },
      12,
    );
    const html = compileStoryboard(storyboard, { width: 540, height: 960, durationSec: 12 });
    const raw = await inspectCode({ html, width: 540, height: 960, durationSec: 12 });
    expect(raw.consoleErrors.filter(e => !/favicon/i.test(e))).toEqual([]);
    expect(raw.blocked).toEqual([]);
    expect(raw.timelineSec).toBeCloseTo(12, 1);
    expect(raw.loops).toBe(false);
    for (const f of raw.findings) {
      expect(f.overflow).toEqual([]);
      expect(f.overlaps).toEqual([]);
      expect(f.splitArabic).toBeLessThan(3);
      expect(f.spacedArabic).toEqual([]);
    }
    expect(raw.findings.some(f => f.visibleTexts > 0)).toBe(true);
    expect(raw.still.length).toBeLessThan(2);
  }, 120_000);
});
