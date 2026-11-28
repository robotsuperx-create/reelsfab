import { describe, expect, it } from "vitest";
import { normalizeStoryboard } from "../../shared/code-craft/storyboard";
import { TEMPLATE_CATEGORIES, VIDEO_TEMPLATES, templateBrief, templateScenario, templateSeconds, templateStoryboard } from "../../shared/code-craft/templates";

describe("video templates", () => {
  it("has ~50 templates with unique ids, in known categories, every category used", () => {
    expect(VIDEO_TEMPLATES.length).toBeGreaterThanOrEqual(50);
    expect(new Set(VIDEO_TEMPLATES.map(t => t.id)).size).toBe(VIDEO_TEMPLATES.length);
    const cats = new Set(TEMPLATE_CATEGORIES.map(c => c.id));
    for (const t of VIDEO_TEMPLATES) expect(cats.has(t.cat), t.id).toBe(true);
    for (const c of cats) expect(VIDEO_TEMPLATES.some(t => t.cat === c), c).toBe(true);
  });

  it("every template is a clean storyboard: nothing dropped, airy screens, readable timing", () => {
    const problems: string[] = [];
    for (const t of VIDEO_TEMPLATES) {
      const sb = templateStoryboard(t);
      const sec = templateSeconds(t);
      expect(sec, t.id).toBeGreaterThanOrEqual(15);
      expect(sec, t.id).toBeLessThanOrEqual(75);
      const { storyboard, issues } = normalizeStoryboard(sb, sec);
      const items = (x: { scenes: { items: unknown[] }[] }) => x.scenes.reduce((a, s) => a + s.items.length, 0);
      if (items(storyboard) !== items(sb)) problems.push(`${t.id}: items dropped`);
      if (storyboard.scenes.length !== sb.scenes.length) problems.push(`${t.id}: scenes dropped`);
      for (const i of issues) problems.push(`${t.id}: ${i}`);
    }
    expect(problems).toEqual([]);
  });

  it("gives a scenario sheet line per scene and a brief that keeps the structure", () => {
    const t = VIDEO_TEMPLATES[0];
    expect(templateScenario(t).split("\n").filter(l => l.startsWith("المشهد")).length).toBe(t.scenes.length);
    const brief = templateBrief(t, "الموضوع: اختبار");
    expect(brief).toContain(t.name);
    expect(brief).toContain("الموضوع: اختبار");
    expect(brief).toContain('"scenes"');
  });
});
