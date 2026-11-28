import { describe, expect, it } from "vitest";
import { captionChunks, compileOverlay, parseOverlayPlan, zoomAt } from "../../shared/overlay";
import { zoomExpr } from "../worker/code-video";
import { buildOverlayHtml, iconSvg } from "./overlay-director";

const words = "مرحبا بكم اليوم سأخبركم بثلاثة أسرار لزيادة دخلك الشهري. أولا الادخار ثانيا الاستثمار".split(" ").map((w, i) => ({ word: w, start: 0.5 + i * 0.4, end: 0.5 + i * 0.4 + 0.3 }));
const opts = { words, frames: [{ t: 1, subjectBox: [30, 10, 40, 85] as [number, number, number, number], free: ["lower-third"] }], duration: 6, w: 1080, h: 1920 };

describe("overlay plans", () => {
  it("lands each element on the start of its word and holds past its until-word", () => {
    const { plan } = parseOverlayPlan({ items: [{ type: "punch", at: 5, until: 8, text: "3 أسرار", position: "lower" }] });
    const c = compileOverlay(plan, opts);
    expect(c.problems).toEqual([]);
    expect(c.items[0].start).toBeCloseTo(words[5].start + 0.02, 3);
    expect(c.items[0].end).toBeCloseTo(words[8].end + 0.45, 3);
  });

  it("drops a broken element instead of failing the plan, and reports bad word indexes", () => {
    const { plan, dropped } = parseOverlayPlan({ accent: "nope", items: [{ type: "counter", at: 1 }, { type: "punch", at: 99, text: "x" }, { type: "icon", at: 2, icon: "rocket" }] });
    expect(plan.accent).toBe("yellow");
    expect(dropped).toHaveLength(1);
    const c = compileOverlay(plan, opts);
    expect(c.items.map(i => i.type)).toEqual(["icon"]);
    expect(c.problems.join(" ")).toMatch(/word index 99/);
  });

  it("keeps text off the face and off the captions", () => {
    const { plan } = parseOverlayPlan({ captions: { on: true, position: "lower" }, items: [{ type: "punch", at: 1, until: 3, text: "مرحبا", position: "upper" }] });
    const c = compileOverlay(plan, opts);
    const y = c.items[0].y;
    // Face: 10%–35.5% of the height; captions around 72%.
    expect(y - 0.06 > 0.355 || y + 0.06 < 0.1).toBe(true);
    expect(Math.abs(y - c.captions!.y)).toBeGreaterThan(0.1);
  });

  it("caption chunks break at punctuation and never run past the next chunk", () => {
    const ch = captionChunks(words, 4, 6);
    const k = ch.findIndex(c => c.words.some(w => w.w.endsWith(".")));
    expect(ch[k].words[ch[k].words.length - 1].w).toBe("الشهري.");
    expect(ch[k + 1].words[0].w).toBe("أولا");
    for (let i = 0; i + 1 < ch.length; i++) expect(ch[i].e).toBeLessThanOrEqual(ch[i + 1].s + 1e-9);
  });

  it("zoom punch-ins: no overlap, and the ffmpeg expression follows the plan", () => {
    const { plan } = parseOverlayPlan({ items: [{ type: "zoom", at: 1, until: 3, scale: 1.2 }, { type: "zoom", at: 2, until: 4 }, { type: "zoom", at: 9, until: 10, ease: "smooth" }] });
    const c = compileOverlay(plan, opts);
    expect(c.zooms).toHaveLength(2);
    expect(c.problems.join(" ")).toMatch(/overlaps another zoom/);
    expect(zoomAt(c.zooms, c.zooms[0].start + 0.1).scale).toBeCloseTo(1.2);
    expect(zoomAt(c.zooms, 0).scale).toBe(1);
    const e = zoomExpr(c.zooms);
    expect(e.z).toContain("1.200");
    expect(e.z).toContain("in_time");
  });

  it("builds a self-contained page with the icons it needs", () => {
    expect(iconSvg("rocket")).toMatch(/^<path /);
    expect(iconSvg("../../etc/passwd")).toBeNull();
    const { plan } = parseOverlayPlan({ items: [{ type: "icon", at: 2, icon: "rocket", label: "انطلاق" }] });
    const html = buildOverlayHtml(compileOverlay(plan, opts));
    expect(html).toContain('id="plan"');
    expect(html).toContain('"rocket"');
    expect(html).toContain("window.renderAt");
    expect(html).not.toMatch(/<\/script>\s*<\/script>/);
  });
});
