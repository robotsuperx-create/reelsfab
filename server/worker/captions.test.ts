import { describe, expect, it } from "vitest";
import { captionChunks, chunkWords, wordTimings } from "./ass";
import { buildEpisodeAss } from "./episode-render";

const text = (groups: { word: string }[][]) => groups.map(g => g.map(w => w.word).join(" "));
const words = (s: string) => s.split(/\s+/).filter(Boolean).map(word => ({ word }));

describe("caption chunks", () => {
  it("never leaves a one-word tail like «لها.» and never crosses a sentence end", () => {
    const out = text(chunkWords(words("الغلاف الجوي يشتت الضوء الأزرق أكثر من غيره لها. ثم تبدأ القصة"), "classic"));
    expect(out).toEqual(["الغلاف الجوي يشتت الضوء الأزرق", "أكثر من غيره لها.", "ثم تبدأ القصة"]);
    expect(out.every(c => c.split(" ").length >= 2)).toBe(true);
  });

  it("treats the Arabic question mark as a sentence end and cuts after a comma near the middle", () => {
    const s = "هل السماء زرقاء فعلًا؟ ليس تمامًا فالسماء تبدو زرقاء، لأن عيوننا أكثر حساسية للأزرق من البنفسجي";
    const out = text(captionChunks(words(s), 6));
    expect(out[0]).toBe("هل السماء زرقاء فعلًا؟");
    expect(out[1]).toBe("ليس تمامًا فالسماء تبدو زرقاء،");
    expect(out.every(c => c.split(" ").length <= 6 && c.split(" ").length >= 2)).toBe(true);
    expect(out.join(" ")).toBe(s);
  });

  it("keeps every word, in order, for silent reading chunks and merges short sentences", () => {
    const s = "نعم. الضوء الأبيض خليط من ألوان كثيرة، وكل لون موجة بطول مختلف، والأزرق موجته قصيرة جدًا فيتشتت في كل اتجاه حين يصطدم بجزيئات الهواء الصغيرة. وهكذا تمتلئ السماء بالأزرق.";
    const out = captionChunks(words(s), 16, { mergeShort: true });
    expect(text(out).join(" ")).toBe(s);
    expect(out.every(g => g.length <= 16)).toBe(true);
    expect(text(out)[0].startsWith("نعم. الضوء")).toBe(true); // a one-word sentence never stands alone
  });

  it("weights Arabic punctuation as a pause in the timing", () => {
    const t = wordTimings("قصير، قصير", 0, 4);
    expect(t[0].end - t[0].start).toBeGreaterThan(t[1].end - t[1].start);
  });
});

describe("Arabic direction and silent reading captions", () => {
  const base = {
    language: "ar" as const,
    scenes: [{ start: 3, duration: 20 }],
    chapters: [],
    intro: { title: "لماذا السماء زرقاء؟", channel: "علوم", seconds: 3 },
    outro: { text: "اشترك", seconds: 5 },
    total: 28,
    font: "IBM Plex Sans Arabic",
    colors: { primary: "#1B2A41", accent: "#DFFF00", text: "#F1F0EA" },
    disclosure: "النص مكتوب بمساعدة الذكاء الاصطناعي",
  };
  const narration = "الضوء الأبيض خليط من ألوان كثيرة، وكل لون موجة بطول مختلف. والأزرق موجته قصيرة فيتشتت في كل اتجاه، لذلك نراه في كل مكان من السماء.";

  it("lets libass detect the paragraph direction on every style (punctuation lands on the left in Arabic)", () => {
    const ass = buildEpisodeAss({ ...base, words: wordTimings(narration, 3, 20) });
    const styles = ass.split("\n").filter(l => l.startsWith("Style:"));
    expect(styles.length).toBeGreaterThan(5);
    expect(styles.every(l => l.endsWith(",-1"))).toBe(true);
  });

  it("shows whole sentences over a soft band when the episode has no voice, and every word appears", () => {
    const ass = buildEpisodeAss({ ...base, words: wordTimings(narration, 3, 20), reading: true });
    const caps = ass.split("\n").filter(l => l.includes(",Cap,")).map(l => l.split(",,0,0,0,,")[1]);
    expect(caps).toEqual(["الضوء الأبيض خليط من ألوان كثيرة، وكل لون موجة بطول مختلف.", "والأزرق موجته قصيرة فيتشتت في كل اتجاه، لذلك نراه في كل مكان من السماء."]);
    expect(ass).toMatch(/Style: Cap,[^\n]*,52,[^\n]*,2,240,240,62,-1/);
    expect(ass).toMatch(/,Band,,0,0,0,,\{\\pos\(0,780\)[^\n]*\\p1\}m 0 0 l 1920 0/);
  });
});
