import { describe, expect, it } from "vitest";
import { SCENE_GAP, episodeProblems, episodeScriptSchema, visualModeOf, type Scene } from "../../shared/episodes";
import { compileStoryboard } from "../../shared/code-craft/storyboard";
import { beatsStoryboard, clipSeconds, motionCurrent, motionHash, motionPrompt, parsePlan, toFootage, type MotionLook } from "./episode-motion";

const look: MotionLook = { theme: "documentary", accent: "#DFFF00", lang: "ar" };
const scene = (over: Partial<Scene> = {}): Scene => ({ id: "sc1", narration: "أغلقت إيران مضيق هرمز فارتفع سعر النفط إلى مئة وعشرين دولارًا", keywords: ["oil tanker"], durationSec: 9.65, ...over });

describe("episode motion", () => {
  it("times a clip to the narration plus the pause between scenes", () => {
    expect(clipSeconds({ durationSec: 9.65 })).toBe(Number((9.65 + SCENE_GAP).toFixed(2)));
    expect(clipSeconds({})).toBe(1);
  });

  it("turns beats with seconds into one storyboard of exactly the scene's length, without end card or music", () => {
    const { storyboard } = beatsStoryboard(
      [
        { sec: 4, media: { type: "map", focus: ["IR"], pins: [{ at: "26.57,56.25", label: "هرمز" }] }, items: [{ type: "title", text: "مضيق هرمز" }] },
        { sec: 4, items: [{ type: "stat", value: 120, prefix: "$", label: "سعر البرميل" }] },
      ],
      10,
      look,
    );
    expect(storyboard.scenes).toHaveLength(2);
    expect(storyboard.scenes[0].from).toBe(0);
    expect(storyboard.scenes[1].to).toBe(10);
    expect(storyboard.scenes[0].to).toBeCloseTo(5, 1);
    expect(storyboard.end).toBeUndefined();
    expect(storyboard.progress).toBeUndefined();
    expect(storyboard.sound).toEqual({ sfx: true, music: false });
    expect(storyboard.theme).toBe("documentary");
  });

  it("rescales stored beats when the narration changes length", () => {
    const first = beatsStoryboard([{ sec: 3, items: [{ type: "title", text: "أ" }] }, { sec: 3, items: [{ type: "title", text: "ب" }] }], 6, look).storyboard.scenes;
    const again = beatsStoryboard(first as unknown as Record<string, unknown>[], 9, look).storyboard.scenes;
    expect(again[1].to).toBe(9);
    expect(again[0].to).toBeCloseTo(4.5, 1);
  });

  it("knows when a drawn clip is out of date", () => {
    const beats = [{ from: 0, to: 10, items: [{ type: "title", text: "هرمز" }] }];
    const s = scene({ durationSec: 10 - SCENE_GAP, anim: { beats, hash: motionHash(beats, 10, look) }, visual: { kind: "video", src: "/api/media/x.mp4", anim: true } });
    expect(motionCurrent(s, look)).toBe(true);
    expect(motionCurrent({ ...s, durationSec: 12 }, look)).toBe(false);
    expect(motionCurrent(s, { ...look, theme: "neon" })).toBe(false);
    expect(motionCurrent({ ...s, visual: { kind: "video", src: "/api/media/stock.mp4" } }, look)).toBe(false);
  });

  it("reads the director's plan: known scenes only, footage when there are no beats", () => {
    const raw = `Here: {"scenes":[{"i":0,"use":"animation","beats":[{"sec":5,"items":[{"type":"title","text":"x"}]}]},{"i":1,"use":"footage"},{"i":2,"use":"animation","beats":[]},{"i":9,"use":"animation","beats":[{"sec":2}]},{"i":0,"use":"footage"}]}`;
    const plan = parsePlan(raw, new Set([0, 1, 2]));
    expect(plan.map(p => [p.i, p.use])).toEqual([[0, "animation"], [1, "footage"], [2, "footage"]]);
    expect(plan[0].beats).toHaveLength(1);
  });

  it("briefs the director with the narration, the seconds and the mixed-mode rules", () => {
    const p = motionPrompt({ title: "حرب هرمز", niche: "سياسة", mode: "mixed", look, scenes: [{ i: 3, scene: scene(), seconds: 10 }] });
    expect(p).toContain("[3] 10.0 s");
    expect(p).toContain("مضيق هرمز");
    expect(p).toContain("MODE: MIXED");
    expect(p).toContain('"use":"footage"');
    expect(p).toContain("subtitles");
    const forced = motionPrompt({ title: "t", niche: "n", mode: "mixed", look, scenes: [{ i: 0, scene: scene(), seconds: 10 }], force: true });
    expect(forced).toContain("animate every one");
    expect(forced).not.toContain("MODE: MIXED");
  });

  it("puts footage back where an animated scene was", () => {
    const prev = { kind: "video" as const, src: "/api/media/stock.mp4", auto: true };
    const s = scene({ anim: { beats: [{ from: 0, to: 5, items: [] }], prev }, visual: { kind: "video", src: "/api/media/anim.mp4", anim: true } });
    toFootage(s);
    expect(s.visual).toEqual(prev);
    expect(s.anim).toBeUndefined();
    expect(s.footage).toBe(true);
  });

  it("lets an animated scene through the export check before its clip is drawn", () => {
    const script = episodeScriptSchema.parse({ title: "t", hook: "", outro: "", description: "", tags: [], scenes: [scene({ anim: { beats: [{ from: 0, to: 5, items: [{ type: "title", text: "هرمز" }] }] } }), scene({ id: "sc2" })] });
    expect(episodeProblems(script, "ar")).toEqual(["1 مشهد بلا لقطة — اختر اللقطات أو شغّل الاختيار التلقائي"]);
  });

  it("chooses the episode's look, else the channel default, else footage", () => {
    expect(visualModeOf({ visualMode: "mixed" }, { visualMode: "animation" })).toBe("mixed");
    expect(visualModeOf({}, { visualMode: "animation" })).toBe("animation");
    expect(visualModeOf(null, {})).toBe("footage");
  });

  it("keeps the subtitle band clear in the compiled page", () => {
    const { storyboard } = beatsStoryboard([{ sec: 4, items: [{ type: "title", text: "هرمز" }] }], 4, look);
    expect(compileStoryboard(storyboard, { width: 1920, height: 1080, durationSec: 4, reserve: 150 })).toContain("reserve: 150");
    expect(compileStoryboard(storyboard, { width: 1920, height: 1080, durationSec: 4 })).not.toContain("reserve");
  });
});
