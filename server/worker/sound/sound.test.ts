import { describe, expect, it } from "vitest";
import { SR, peak } from "./dsp";
import { MOODS, music } from "./music";
import { SFX_NAMES, makeSfx } from "./sfx";
import { cleanCues, designSoundtrack, moodOf } from "./soundtrack";

const finite = (a: Float32Array) => a.every(Number.isFinite);
const rms = (a: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

describe("sound effects", () => {
  it("every effect is audible, finite, bounded and identical for the same seed", () => {
    for (const name of SFX_NAMES) {
      const a = makeSfx(name, 42, 0.5, 1.2);
      const b = makeSfx(name, 42, 0.5, 1.2);
      expect(finite(a.buf.l) && finite(a.buf.r), name).toBe(true);
      expect(peak(a.buf), name).toBeGreaterThan(0.05);
      expect(peak(a.buf), name).toBeLessThan(2);
      expect(Buffer.from(a.buf.l.buffer).equals(Buffer.from(b.buf.l.buffer)), name).toBe(true);
      expect(a.lead).toBeGreaterThanOrEqual(0);
    }
    // A riser ends on its cue; a hit starts on it.
    expect(makeSfx("riser", 1).lead).toBeCloseTo(1.4);
    expect(makeSfx("hit", 1).lead).toBe(0);
  });
});

describe("music", () => {
  it("renders every mood, fades in and out with the video", () => {
    for (const mood of MOODS) {
      const m = music(mood, { totalSec: 8, seed: 3 });
      expect(m.l.length).toBe(8 * SR);
      expect(finite(m.l), mood).toBe(true);
      expect(rms(m.l, 3 * SR, 5 * SR), mood).toBeGreaterThan(0.01);
      expect(Math.abs(m.l[0]), mood).toBeLessThan(0.01);
      expect(Math.abs(m.l[m.l.length - 1]), mood).toBeLessThan(0.01);
    }
  });

  it("is one continuous track when a long video is rendered segment by segment", () => {
    const whole = music("upbeat", { totalSec: 24, seed: 9 });
    const part = music("upbeat", { totalSec: 24, offsetSec: 12, durationSec: 12, seed: 9 });
    // Away from the very first samples, the window matches the same moments of the whole track.
    const from = Math.round(0.5 * SR), to = Math.round(6 * SR);
    let diff = 0;
    for (let i = from; i < to; i++) diff += (whole.l[12 * SR + i] - part.l[i]) ** 2;
    const err = Math.sqrt(diff / (to - from));
    expect(err).toBeLessThan(rms(whole.l, 12 * SR + from, 12 * SR + to) * 0.25);
  });
});

describe("soundtrack", () => {
  it("keeps only known cues inside the video, and merges flams", () => {
    const cues = cleanCues([{ t: 1, name: "pop" }, { t: 1.02, name: "pop", gain: 0.3 }, { t: 2, name: "boing" }, { t: 99, name: "hit" }, { t: -1, name: "hit" }, null, { t: 3, name: "count", dur: 1.5 }], 10);
    expect(cues.map(c => `${c.name}@${c.t}`)).toEqual(["pop@1", "count@3"]);
    expect(moodOf("epic")).toBe("epic");
    expect(moodOf("disco", "tense")).toBe("tense");
  });

  it("mixes cues over the bed into a bounded 48 kHz stereo WAV, the same every time", async () => {
    const opts = { durationSec: 4, cues: cleanCues([{ t: 0.5, name: "whoosh" }, { t: 1, name: "impact" }, { t: 2, name: "count", dur: 1 }, { t: 3.2, name: "chime" }], 4), mood: "tense" as const, seed: 5 };
    const a = await designSoundtrack(opts);
    const b = await designSoundtrack(opts);
    expect(a.wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(a.wav.readUInt32LE(24)).toBe(48000);
    expect(a.wav.readUInt16LE(22)).toBe(2);
    expect((a.wav.length - 44) / 4).toBe(4 * SR);
    expect(a.wav.equals(b.wav)).toBe(true);
    let max = 0;
    for (let i = 44; i < a.wav.length; i += 2) max = Math.max(max, Math.abs(a.wav.readInt16LE(i)));
    expect(max / 32767).toBeLessThan(0.9);
    expect(max / 32767).toBeGreaterThan(0.2);
    const silent = await designSoundtrack({ durationSec: 1, cues: [], mood: null });
    let any = 0;
    for (let i = 44; i < silent.wav.length; i += 2) any = Math.max(any, Math.abs(silent.wav.readInt16LE(i)));
    expect(any).toBe(0);
  });
});
