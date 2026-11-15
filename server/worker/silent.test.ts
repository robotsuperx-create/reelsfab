import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readingSeconds } from "../../shared/episodes";
import { synthesize } from "./tts";

describe("silent episodes (no voice)", () => {
  it("keeps each scene on screen long enough to read it", () => {
    expect(readingSeconds("كلمة")).toBe(3.5); // never shorter than 3.5 s
    const ar = Array(22).fill("كلمة").join(" ");
    expect(readingSeconds(ar)).toBeCloseTo(22 / 2.2 + 0.8, 5);
    const en = Array(28).fill("word").join(" ");
    expect(readingSeconds(en)).toBeCloseTo(28 / 2.8 + 0.8, 5);
    expect(readingSeconds(Array(400).fill("w").join(" "))).toBe(90);
  });

  it("writes silence of that length with no cost, whatever TTS_PROVIDER says", async () => {
    const dir = await mkdtemp(join(tmpdir(), "silent-"));
    try {
      const text = "لماذا تبدو السماء زرقاء في النهار وحمراء عند الغروب؟ الجواب في طريقة تشتت الضوء";
      const r = await synthesize({ text, voice: "none", speed: 1, outPath: join(dir, "a.wav"), provider: "none" });
      expect(r.costMilliCents).toBe(0);
      expect(Math.abs(r.durationSec - readingSeconds(text))).toBeLessThan(0.1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
