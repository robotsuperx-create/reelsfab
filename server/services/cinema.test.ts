import { describe, expect, it } from "vitest";
import { cinemaScriptSchema, compileCinema, estimateTiming, findWord, wordKey } from "../../shared/cinema";
import { CINEMA_BRIEF, scriptProblems } from "./cinema/director";

const example = () => {
  const raw = CINEMA_BRIEF.slice(CINEMA_BRIEF.indexOf("EXAMPLE"));
  return cinemaScriptSchema.parse(JSON.parse(raw.slice(raw.indexOf("{"))));
};

describe("cinema scripts", () => {
  it("finds cue words with or without diacritics and prefixes", () => {
    const words = "ومنذ ذلك اليوم، قرّرَ العالمُ معاقبةَ إيران.".split(" ");
    expect(findWord(words, "العالم")).toBe(4);
    expect(findWord(words, "معاقبةَ")).toBe(5);
    expect(findWord(words, "إيران")).toBe(6);
    expect(findWord(words, "واشنطن")).toBe(-1);
    expect(wordKey("مُحاصَرة.")).toBe("محاصره");
  });

  it("the brief's own example is a valid script with every cue in its line", () => {
    const s = example();
    expect(s.lines).toHaveLength(6);
    expect(scriptProblems(s, 30).filter(p => /not a word/.test(p))).toEqual([]);
  });

  it("times shots back to back and texts on the words, from the voice", () => {
    const s = example();
    const plan = compileCinema(s, s.lines.map(l => estimateTiming(l.say)));
    expect(plan.w).toBe(1080);
    expect(plan.shots[0].start).toBe(0);
    for (let i = 1; i < plan.shots.length; i++) expect(plan.shots[i].start).toBe(plan.shots[i - 1].end);
    expect(plan.shots.at(-1)!.end).toBe(plan.duration);
    // The portrait starts on "سقطَ", after the globe dive, and shatters later on "عرشٌ".
    const photo = plan.shots.find(x => x.type === "photo" && x.shatterAt != null)!;
    expect(photo.start as number).toBeGreaterThan(1);
    expect(photo.shatterAt as number).toBeGreaterThan(photo.start as number);
    // Pictures and countries are left for the server to resolve.
    expect(plan.needs.some(n => n.wiki === "Mohammad Reza Pahlavi" && n.cutout)).toBe(true);
    expect(plan.needs.some(n => n.country === "IR")).toBe(true);
    // Stamps land on their words in order; the counter counts to 40.
    const stamps = plan.texts.filter(x => x.style === "stamp").map(x => x.at as number);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    expect(plan.texts.find(x => x.style === "counter" && x.to === 40)).toBeTruthy();
    expect(plan.cues.some(c => c.name === "impact")).toBe(true);
  });

  it("flags scripts that are too short or monotonous", () => {
    const s = cinemaScriptSchema.parse({ title: "x", lines: [{ say: "جملة قصيرة جدا", shots: [{ type: "dark" }], texts: [{ text: "قصيرة", at: "غير موجودة" }] }] });
    const p = scriptProblems(s, 30);
    expect(p.some(x => /needs about/.test(x))).toBe(true);
    expect(p.some(x => /not a word/.test(x))).toBe(true);
  });
});
