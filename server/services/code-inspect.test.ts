import { describe, expect, it } from "vitest";
import { strongPrompt, STYLE_RECIPES } from "../../shared/code-video";
import { fixPromptFrom, issuesFrom } from "./code-inspect";
import type { RawInspection } from "../worker/code-video";

const clean = (over: Partial<RawInspection> = {}): RawInspection => ({
  consoleErrors: [],
  blocked: [],
  timelineSec: 15,
  loops: false,
  stills: [],
  stillTimes: [1.5, 4.5, 7.5, 10.5, 13.5],
  findings: [1.5, 4.5, 7.5, 10.5, 13.5].map(t => ({ t, overflow: [], overlaps: [], small: [], splitArabic: 0, spacedArabic: [], visibleTexts: 2 })),
  still: [],
  ...over,
});

describe("issuesFrom", () => {
  it("reports nothing for a clean run", () => {
    expect(issuesFrom(clean(), 15, 1080, 1920)).toEqual([]);
    expect(fixPromptFrom([], 1080, 1920, 15)).toBe("");
  });

  it("measures a timeline that is too short or too long, with the numbers", () => {
    const short = issuesFrom(clean({ timelineSec: 8 }), 15, 1080, 1920);
    expect(short[0]).toMatchObject({ code: "short", severity: "error" });
    expect(short[0].message).toContain("8.0");
    expect(short[0].message).toContain("7.0");
    expect(issuesFrom(clean({ timelineSec: 18 }), 15, 1080, 1920)[0].code).toBe("long");
    // a held end frame of up to 2.5 s is intentional
    expect(issuesFrom(clean({ timelineSec: 13 }), 15, 1080, 1920)).toEqual([]);
  });

  it("turns CSP console messages into blocked URLs and collapses failed loads", () => {
    const issues = issuesFrom(
      clean({
        consoleErrors: [
          "Loading the image 'https://example.com/x.png' violates the following Content Security Policy directive: img-src data:",
          "Failed to load resource: net::ERR_NAME_NOT_RESOLVED",
          "Failed to load resource: net::ERR_NAME_NOT_RESOLVED",
          "boom is not defined",
          "boom is not defined",
        ],
      }),
      15,
      1080,
      1920,
    );
    expect(issues.filter(i => i.code === "script")).toHaveLength(1);
    expect(issues.find(i => i.code === "blocked")?.message).toContain("https://example.com/x.png");
    expect(issues.some(i => i.code === "load")).toBe(false); // already explained by the blocked URL
  });

  it("flags Arabic split into letters only when there are several pieces, errors before warnings", () => {
    const f = clean().findings.map(x => ({ ...x, splitArabic: 5, small: [".s حجمه 20px"] }));
    const issues = issuesFrom(clean({ findings: f, loops: true }), 15, 1080, 1920);
    expect(issues.map(i => i.code)).toEqual(["split-arabic", "loop", "small"]);
    const one = clean().findings.map(x => ({ ...x, splitArabic: 2 }));
    expect(issuesFrom(clean({ findings: one }), 15, 1080, 1920)).toEqual([]);
  });

  it("builds a paste-back message that repeats the exact duration guard", () => {
    const msg = fixPromptFrom(issuesFrom(clean({ timelineSec: 5 }), 30, 1920, 1080), 1920, 1080, 30);
    expect(msg).toContain("1920×1080");
    expect(msg).toContain("tl.set({}, {}, 30)");
    expect(msg).toMatch(/^جرّبت ملفك/);
  });
});

describe("strongPrompt", () => {
  it("fills size, duration and style into the skeleton", () => {
    const p = strongPrompt(1080, 1920, 45, "neon", "قصة الذكاء الاصطناعي");
    expect(p).toContain("1080×1920");
    expect(p).toContain("const DURATION = 45;");
    expect(p).toContain("tl.set({}, {}, DURATION)");
    expect(p).toContain(STYLE_RECIPES.find(s => s.id === "neon")!.recipe);
    expect(p).toContain("الفكرة: قصة الذكاء الاصطناعي");
    expect(p).toContain("الخطوة 1");
  });
  it("uses phone-safe areas only for vertical video", () => {
    expect(strongPrompt(1080, 1920, 15)).toContain("320 أسفلها");
    expect(strongPrompt(1920, 1080, 15)).not.toContain("320 أسفلها");
  });
});
