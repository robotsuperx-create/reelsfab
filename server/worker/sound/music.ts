/**
 * Procedural background music by mood. A score (note events) is planned for the whole video, then only the requested
 * window is rendered — so the segments of a long video, rendered one by one, join into one continuous track.
 * Everything is synthesised: Karplus–Strong plucks, FM bells/marimba, detuned-saw pads, sine/saw bass, drums.
 */
import { Biquad, SR, fmBell, hashString, midiHz, pluck, reverb, rng, stereo, type Stereo } from "./dsp";

export const MOODS = ["tense", "upbeat", "tech", "calm", "playful", "epic"] as const;
export type Mood = (typeof MOODS)[number];
export const MOOD_LABELS: Record<Mood, string> = { tense: "توتر وثائقي", upbeat: "حماسي", tech: "تقني", calm: "هادئ", playful: "مرح", epic: "ملحمي" };

type Inst = "pad" | "bass" | "pluck" | "bell" | "kick" | "snare" | "clap" | "hat" | "ohat" | "shaker" | "tom" | "drone" | "brass";
export type NoteEvent = { t: number; dur: number; inst: Inst; midi: number; vel: number; pan?: number };

type Style = {
  bpm: number;
  root: number;
  scale: number[];
  /** Chord roots as scale degrees (0-based), one per bar, looping. */
  prog: number[];
  seventh?: boolean;
  layers: (ctx: BarCtx) => void;
};
type BarCtx = { bar: number; t0: number; beat: number; chord: number[]; scaleNotes: (oct: number) => number[]; push: (e: NoteEvent) => void; r: () => number; section: "intro" | "A" | "B"; last: boolean };

const MOOD_TRIM_DB: Record<Mood, number> = { tense: 3, upbeat: 1.3, tech: 4.1, calm: 5.1, playful: 4.9, epic: 2.1 } as never;
for (const k of Object.keys(MOOD_TRIM_DB) as Mood[]) MOOD_TRIM_DB[k] = Math.pow(10, MOOD_TRIM_DB[k] / 20);

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

const STYLES: Record<Mood, Style> = {
  tense: {
    bpm: 84, root: 38, scale: MINOR, prog: [0, 5, 3, 4],
    layers: ({ t0, beat, chord, push, r, section, scaleNotes, bar }) => {
      push({ t: t0, dur: beat * 4, inst: "drone", midi: chord[0] - 12, vel: 0.55 });
      push({ t: t0, dur: beat * 4, inst: "pad", midi: chord[0] + 12, vel: 0.32 });
      push({ t: t0, dur: beat * 4, inst: "pad", midi: chord[1] + 12, vel: 0.26 });
      if (section === "intro") return;
      for (let b = 0; b < 4; b++) {
        push({ t: t0 + b * beat, dur: 0.3, inst: "kick", midi: 0, vel: 0.5 });
        push({ t: t0 + b * beat + beat * 0.28, dur: 0.3, inst: "kick", midi: 0, vel: 0.28 });
      }
      const notes = scaleNotes(5);
      for (let s = 0; s < 8; s++) if (r() < (section === "A" ? 0.45 : 0.25)) push({ t: t0 + s * beat * 0.5, dur: beat * 1.5, inst: "pluck", midi: notes[Math.floor(r() * 5)], vel: 0.42, pan: r() * 1.2 - 0.6 });
      if (bar % 4 === 0) push({ t: t0, dur: 2, inst: "tom", midi: chord[0], vel: 0.7 });
    },
  },
  upbeat: {
    bpm: 116, root: 48, scale: MAJOR, prog: [0, 4, 5, 3],
    layers: ({ t0, beat, chord, push, section }) => {
      push({ t: t0, dur: beat * 4, inst: "pad", midi: chord[0] + 12, vel: 0.22 });
      push({ t: t0, dur: beat * 4, inst: "pad", midi: chord[2] + 12, vel: 0.18 });
      if (section === "intro") {
        for (let s = 0; s < 8; s++) push({ t: t0 + s * beat * 0.5, dur: beat * 0.5, inst: "pluck", midi: chord[s % 3] + 24, vel: 0.35 });
        return;
      }
      for (let b = 0; b < 4; b++) {
        push({ t: t0 + b * beat, dur: 0.3, inst: "kick", midi: 0, vel: 0.85 });
        push({ t: t0 + b * beat + beat / 2, dur: 0.05, inst: "hat", midi: 0, vel: 0.45 });
        if (b % 2 === 1) push({ t: t0 + b * beat, dur: 0.2, inst: "clap", midi: 0, vel: 0.6 });
      }
      for (let s = 0; s < 8; s++) push({ t: t0 + s * beat * 0.5, dur: beat * 0.45, inst: "bass", midi: chord[0] - 12 + (s % 4 === 3 ? 7 : 0), vel: 0.6 });
      const arp = [0, 1, 2, 1, 2, 0, 2, 1];
      if (section === "A") for (let s = 0; s < 16; s++) push({ t: t0 + s * beat * 0.25, dur: beat * 0.3, inst: "pluck", midi: chord[arp[s % 8]] + 24, vel: 0.3, pan: s % 2 ? 0.35 : -0.35 });
      else for (let s = 0; s < 4; s++) push({ t: t0 + s * beat, dur: beat, inst: "bell", midi: chord[s % 3] + 24, vel: 0.3 });
    },
  },
  tech: {
    bpm: 104, root: 45, scale: MINOR, prog: [0, 5, 2, 6],
    layers: ({ t0, beat, chord, push, section }) => {
      push({ t: t0, dur: beat * 4, inst: "pad", midi: chord[0] + 12, vel: 0.2 });
      push({ t: t0, dur: beat * 4, inst: "pad", midi: chord[2] + 12, vel: 0.16 });
      const arp = [0, 2, 1, 2, 0, 2, 1, 2];
      for (let s = 0; s < 16; s++) push({ t: t0 + s * beat * 0.25, dur: beat * 0.25, inst: "pluck", midi: chord[arp[s % 8]] + 24 + (s % 8 === 7 ? 12 : 0), vel: section === "intro" ? 0.22 : 0.3, pan: Math.sin(s) * 0.5 });
      if (section === "intro") return;
      for (let b = 0; b < 4; b++) {
        if (b % 2 === 0) push({ t: t0 + b * beat, dur: 0.3, inst: "kick", midi: 0, vel: 0.8 });
        else push({ t: t0 + b * beat, dur: 0.25, inst: "snare", midi: 0, vel: 0.5 });
        for (let h = 0; h < 4; h++) push({ t: t0 + b * beat + (h * beat) / 4, dur: 0.04, inst: "hat", midi: 0, vel: h % 2 ? 0.18 : 0.3 });
      }
      for (let s = 0; s < 8; s++) push({ t: t0 + s * beat * 0.5 + beat * 0.25, dur: beat * 0.22, inst: "bass", midi: chord[0] - 12, vel: 0.55 });
    },
  },
  calm: {
    bpm: 88, root: 53, scale: MAJOR, prog: [0, 5, 3, 4], seventh: true,
    layers: ({ t0, beat, chord, push, section, r }) => {
      chord.forEach((m, k) => push({ t: t0, dur: beat * 4, inst: "pad", midi: m, vel: 0.17 - k * 0.02 }));
      const order = [0, 2, 1, 3, 2, 1, 3, 2];
      for (let s = 0; s < 8; s++) push({ t: t0 + s * beat * 0.5, dur: beat, inst: "bell", midi: chord[order[s] % chord.length] + 12, vel: (s === 0 ? 0.42 : 0.3) * (section === "intro" ? 0.7 : 1), pan: r() * 0.8 - 0.4 });
      if (section === "intro") return;
      push({ t: t0, dur: 0.3, inst: "kick", midi: 0, vel: 0.45 });
      push({ t: t0 + beat * 2.5, dur: 0.3, inst: "kick", midi: 0, vel: 0.3 });
      for (let s = 0; s < 8; s++) push({ t: t0 + s * beat * 0.5, dur: 0.06, inst: "shaker", midi: 0, vel: s % 2 ? 0.28 : 0.16 });
      push({ t: t0, dur: beat * 2, inst: "bass", midi: chord[0] - 12, vel: 0.45 });
      push({ t: t0 + beat * 2, dur: beat * 2, inst: "bass", midi: chord[0] - 12 + 7, vel: 0.38 });
    },
  },
  playful: {
    bpm: 112, root: 55, scale: MAJOR, prog: [0, 3, 4, 0],
    layers: ({ t0, beat, chord, push, section, scaleNotes, r }) => {
      for (let b = 0; b < 4; b++) push({ t: t0 + b * beat, dur: beat * 0.4, inst: "pluck", midi: (b % 2 ? chord[1] : chord[0]) - 12, vel: 0.5 });
      if (section === "intro") return;
      for (let b = 0; b < 4; b++) {
        push({ t: t0 + b * beat, dur: 0.25, inst: "kick", midi: 0, vel: b % 2 ? 0.35 : 0.6 });
        push({ t: t0 + b * beat + beat / 2, dur: 0.05, inst: "hat", midi: 0, vel: 0.3 });
        if (b % 2 === 1) push({ t: t0 + b * beat, dur: 0.2, inst: "clap", midi: 0, vel: 0.45 });
      }
      const mel = scaleNotes(6);
      for (let s = 0; s < 8; s++) if (r() < 0.7) push({ t: t0 + s * beat * 0.5, dur: beat * 0.5, inst: "bell", midi: mel[Math.floor(r() * 6)], vel: 0.34, pan: r() - 0.5 });
    },
  },
  epic: {
    bpm: 72, root: 36, scale: MINOR, prog: [0, 5, 2, 6],
    layers: ({ t0, beat, chord, push, section, bar }) => {
      chord.forEach((m, k) => push({ t: t0, dur: beat * 4, inst: "pad", midi: m + 12, vel: 0.26 - k * 0.03 }));
      push({ t: t0, dur: beat * 4, inst: "drone", midi: chord[0] - 12, vel: 0.5 });
      if (section === "intro") return;
      push({ t: t0, dur: beat * 4, inst: "brass", midi: chord[0] + 12, vel: 0.3 });
      push({ t: t0, dur: 2.5, inst: "tom", midi: chord[0], vel: 0.8 });
      push({ t: t0 + beat * 2, dur: 2, inst: "tom", midi: chord[0], vel: 0.55 });
      if (bar % 2 === 1) for (let s = 0; s < 4; s++) push({ t: t0 + beat * 3 + s * beat * 0.25, dur: 1, inst: "tom", midi: chord[0] + 5, vel: 0.28 + s * 0.08 });
    },
  },
};

/** The whole video's score. */
export function score(mood: Mood, totalSec: number, seed: number): NoteEvent[] {
  const st = STYLES[mood];
  const beat = 60 / st.bpm;
  const barLen = beat * 4;
  const bars = Math.ceil(totalSec / barLen) + 1;
  const r = rng(seed ^ hashString(mood));
  const events: NoteEvent[] = [];
  const degree = (d: number, oct = 0) => {
    const n = st.scale.length;
    return st.root + st.scale[((d % n) + n) % n] + 12 * (Math.floor(d / n) + oct);
  };
  for (let bar = 0; bar < bars; bar++) {
    const deg = st.prog[bar % st.prog.length];
    const chord = [degree(deg), degree(deg + 2), degree(deg + 4), ...(st.seventh ? [degree(deg + 6)] : [])];
    const section = bar === 0 ? "intro" : Math.floor((bar - 1) / 8) % 2 === 0 ? "A" : "B";
    st.layers({
      bar, t0: bar * barLen, beat, chord, r, section, last: bar === bars - 1,
      scaleNotes: oct => st.scale.map(s => st.root + s + 12 * (oct - Math.floor(st.root / 12) + 1)).map(m => m - 12),
      push: e => events.push(e),
    });
  }
  return events.filter(e => e.t < totalSec + 0.5);
}

const TAU = Math.PI * 2;

function renderNote(e: NoteEvent, out: Stereo, at: number, r: () => number) {
  const f = midiHz(e.midi);
  const start = Math.round(at * SR);
  const put = (i: number, l: number, rr: number) => {
    const j = start + i;
    if (j >= 0 && j < out.l.length) { out.l[j] += l; out.r[j] += rr; }
  };
  const pan = e.pan ?? 0;
  const pl = Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2, pr = Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  const v = e.vel;
  switch (e.inst) {
    case "pad": case "brass": {
      const atk = e.inst === "pad" ? 0.6 : 0.25, rel = 0.9;
      const n = Math.ceil((e.dur + rel) * SR);
      const lp = new Biquad("lp", e.inst === "pad" ? 1100 : 900, 0.8), lp2 = new Biquad("lp", e.inst === "pad" ? 1100 : 900, 0.8);
      let p1 = r(), p2 = r(), p3 = r();
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const env = Math.min(1, t / atk) * (t > e.dur ? Math.max(0, 1 - (t - e.dur) / rel) : 1);
        if (i % 128 === 0) { const c = (e.inst === "pad" ? 900 : 600) + 500 * Math.sin(TAU * 0.13 * (at + t)) + (e.inst === "brass" ? 1400 * Math.min(1, t / 0.4) : 0); lp.set(c); lp2.set(c); }
        p1 += (f * 1.003) / SR; p2 += (f * 0.997) / SR; p3 += (f * 0.5) / SR;
        const a = (p1 % 1) * 2 - 1, b = (p2 % 1) * 2 - 1, s = Math.sin(TAU * p3);
        put(i, lp.run(a * 0.5 + s * 0.3) * env * v * 0.55, lp2.run(b * 0.5 + s * 0.3) * env * v * 0.55);
      }
      return;
    }
    case "drone": {
      const n = Math.ceil((e.dur + 1) * SR);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const env = Math.min(1, t / 0.8) * (t > e.dur ? Math.max(0, 1 - (t - e.dur)) : 1) * (0.8 + 0.2 * Math.sin(TAU * 0.25 * (at + t)));
        const x = (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * f * 1.5 * t)) * env * v * 0.5;
        put(i, x, x);
      }
      return;
    }
    case "bass": {
      const n = Math.ceil((e.dur + 0.1) * SR);
      const lp = new Biquad("lp", 420, 0.9);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const env = Math.min(1, t / 0.005) * (0.55 + 0.45 * Math.exp(-t * 8)) * (t > e.dur ? Math.max(0, 1 - (t - e.dur) / 0.1) : 1);
        ph += f / SR;
        const x = lp.run(Math.sin(TAU * ph) * 0.8 + ((ph % 1) * 2 - 1) * 0.3) * env * v * 0.7;
        put(i, x, x);
      }
      return;
    }
    case "pluck": {
      const sig = pluck(f, e.dur + 0.9, r, { bright: 0.45, decay: 0.995 });
      for (let i = 0; i < sig.length; i++) put(i, sig[i] * v * pl * 0.6, sig[i] * v * pr * 0.6);
      return;
    }
    case "bell": {
      const sig = fmBell(f, Math.min(2.2, e.dur + 1.2), { ratio: 4, index: 1.1, decay: 5 });
      for (let i = 0; i < sig.length; i++) put(i, sig[i] * v * pl * 0.5, sig[i] * v * pr * 0.5);
      return;
    }
    case "kick": {
      const n = Math.ceil(0.4 * SR);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        ph += (TAU * (48 + 110 * Math.exp(-t * 40))) / SR;
        const x = Math.sin(ph) * Math.exp(-t * 9) * Math.min(1, t * 3000) * v * 0.9;
        put(i, x, x);
      }
      return;
    }
    case "snare": case "clap": {
      const n = Math.ceil(0.3 * SR);
      const bp = new Biquad("bp", e.inst === "snare" ? 1900 : 1300, 1.1);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const env = e.inst === "clap" ? [0, 0.011, 0.022].reduce((a, o) => a + (t >= o ? Math.exp(-(t - o) * 55) : 0), 0) * 0.6 : Math.exp(-t * 20);
        const body = e.inst === "snare" ? Math.sin(TAU * 190 * t) * Math.exp(-t * 35) * 0.5 : 0;
        const x = (bp.run(r() * 2 - 1) * env + body) * v * 0.7;
        put(i, x, x);
      }
      return;
    }
    case "hat": case "ohat": case "shaker": {
      const n = Math.ceil((e.inst === "ohat" ? 0.3 : 0.08) * SR);
      const hp = new Biquad(e.inst === "shaker" ? "bp" : "hp", e.inst === "shaker" ? 6500 : 7500, e.inst === "shaker" ? 1.4 : 0.7);
      const dec = e.inst === "ohat" ? 12 : e.inst === "shaker" ? 55 : 85;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const x = hp.run(r() * 2 - 1) * Math.exp(-t * dec) * v * 0.45;
        put(i, x * (1 - pan * 0.3) + x * 0.15, x * (1 + pan * 0.3) - x * 0.15);
      }
      return;
    }
    case "tom": {
      const n = Math.ceil(e.dur * SR);
      let ph = 0;
      const lp = new Biquad("lp", 380);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        ph += (TAU * (midiHz(e.midi - 12) * (1 + 0.6 * Math.exp(-t * 18)))) / SR;
        const x = (Math.sin(ph) * Math.exp(-t * 3.2) + lp.run(r() * 2 - 1) * Math.exp(-t * 14) * 0.5) * v * 0.8;
        put(i, x, x);
      }
      return;
    }
  }
}

/**
 * The music for [offsetSec, offsetSec + durationSec] of a video lasting totalSec: fades in at the start of the video,
 * out at its end. Notes that started before the window are rendered too, so joins are seamless.
 */
export function music(mood: Mood, opts: { totalSec: number; offsetSec?: number; durationSec?: number; seed?: number }): Stereo {
  const off = opts.offsetSec ?? 0;
  const dur = opts.durationSec ?? opts.totalSec - off;
  const seed = opts.seed ?? 1;
  const pre = 3;
  const buf = stereo(dur + pre);
  const events = score(mood, opts.totalSec, seed);
  for (const e of events) {
    if (e.t > off + dur || e.t + e.dur + 2.5 < off - pre) continue;
    renderNote(e, buf, e.t - (off - pre), rng(Math.round(e.t * 1000) ^ seed ^ Math.round(e.midi * 97)));
  }
  reverb(buf, mood === "epic" || mood === "tense" ? 0.5 : 0.32, 0.84);
  // Same bed loudness whatever the mood (measured: about −19 LUFS once the mixer's music gain is applied).
  const trim = MOOD_TRIM_DB[mood];
  const out = stereo(dur);
  const skip = Math.round(pre * SR);
  for (let i = 0; i < out.l.length; i++) {
    const tAbs = off + i / SR;
    const fade = Math.min(1, tAbs / 0.6) * Math.min(1, Math.max(0, (opts.totalSec - tAbs) / 1.6));
    out.l[i] = buf.l[i + skip] * fade * trim;
    out.r[i] = buf.r[i + skip] * fade * trim;
  }
  return out;
}
