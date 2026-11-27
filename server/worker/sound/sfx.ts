/**
 * Synthesised sound effects for motion graphics. Each one returns a stereo buffer and its `lead`: how many seconds
 * of it play BEFORE the cue time (a riser ends on the cue, a whoosh peaks on it, a hit starts on it).
 */
import { Biquad, SR, fmBell, mono, pluck, reverb, rng, stereo, type Stereo } from "./dsp";

export const SFX_NAMES = ["whoosh", "whoosh-soft", "zoom", "impact", "hit", "pop", "tick", "blip", "ding", "chime", "riser", "swell", "shimmer", "sparkle", "count", "glitch"] as const;
export type SfxName = (typeof SFX_NAMES)[number];

export type Sfx = { buf: Stereo; lead: number };

const TAU = Math.PI * 2;

function noiseSweep(seconds: number, r: () => number, f0: number, f1: number, q: number, env: (p: number) => number, panFrom = 0.6, panTo = -0.6): Stereo {
  const out = stereo(seconds);
  const n = out.l.length;
  const bp = new Biquad("bp", f0, q);
  const lp = new Biquad("lp", 9000);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    if (i % 64 === 0) bp.set(f0 * Math.pow(f1 / f0, p), q);
    const v = lp.run(bp.run(r() * 2 - 1)) * env(p);
    const pan = panFrom + (panTo - panFrom) * p;
    out.l[i] = v * Math.cos(((pan + 1) * Math.PI) / 4) * 1.4;
    out.r[i] = v * Math.sin(((pan + 1) * Math.PI) / 4) * 1.4;
  }
  return out;
}

/** Rise to a peak at `at` (0..1 of the sound), then fall. */
const hump = (at: number, rise = 2, fall = 2.4) => (p: number) => (p < at ? Math.pow(p / at, rise) : Math.pow(Math.max(0, 1 - (p - at) / (1 - at)), fall));

function sineSweep(seconds: number, f0: number, f1: number, decay: number, attack = 0.002): Float32Array {
  const n = Math.ceil(seconds * SR);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t * 28);
    ph += (TAU * f) / SR;
    out[i] = Math.sin(ph) * Math.exp(-t * decay) * Math.min(1, t / attack);
  }
  return out;
}

function noiseBurst(seconds: number, r: () => number, freq: number, decay: number, type: "lp" | "hp" | "bp" = "lp"): Float32Array {
  const n = Math.ceil(seconds * SR);
  const out = new Float32Array(n);
  const f = new Biquad(type, freq, type === "bp" ? 1.2 : 0.707);
  for (let i = 0; i < n; i++) out[i] = f.run(r() * 2 - 1) * Math.exp((-i / SR) * decay);
  return out;
}

function add(dst: Float32Array, src: Float32Array, gain = 1, offset = 0) {
  for (let i = 0; i < src.length && i + offset < dst.length; i++) dst[i + offset] += src[i] * gain;
  return dst;
}

/** One effect. `v` (0..1) varies pitch slightly between repeats so a list of pops is not robotic. */
export function makeSfx(name: SfxName, seed: number, v = 0, dur = 1): Sfx {
  const r = rng(seed);
  switch (name) {
    case "whoosh": {
      const b = noiseSweep(0.75, r, 260 + v * 60, 3200, 0.9, hump(0.42));
      reverb(b, 0.35);
      return { buf: b, lead: 0.32 };
    }
    case "whoosh-soft": {
      const b = noiseSweep(0.6, r, 200, 1400, 0.7, hump(0.45, 2.2, 2.8), 0.3, -0.3);
      for (let i = 0; i < b.l.length; i++) { b.l[i] *= 0.6; b.r[i] *= 0.6; }
      return { buf: b, lead: 0.27 };
    }
    case "zoom": {
      const b = noiseSweep(0.65, r, 180, 2400, 1.1, hump(0.55, 2.5, 2), 0, 0);
      const tone = sineSweep(0.65, 140, 520, 1.2, 0.25);
      for (let i = 0; i < b.l.length; i++) { const p = i / b.l.length; const e = hump(0.55, 2.5, 2)(p) * 0.18; b.l[i] += tone[i] * e; b.r[i] += tone[i] * e; }
      reverb(b, 0.3);
      return { buf: b, lead: 0.36 };
    }
    case "impact": {
      const n = Math.ceil(1.8 * SR);
      const sig = new Float32Array(n);
      add(sig, sineSweep(1.8, 120, 38, 2.4, 0.001), 0.95);
      add(sig, noiseBurst(0.35, r, 1600, 18), 0.55);
      add(sig, noiseBurst(0.03, r, 5000, 120, "hp"), 0.35);
      const b = mono(sig);
      reverb(b, 0.55, 0.86);
      return { buf: b, lead: 0 };
    }
    case "hit": {
      const n = Math.ceil(0.6 * SR);
      const sig = new Float32Array(n);
      add(sig, sineSweep(0.6, 190, 62, 7, 0.001), 0.9);
      add(sig, noiseBurst(0.12, r, 2000 + v * 400, 40, "bp"), 0.6);
      const b = mono(sig);
      reverb(b, 0.25);
      return { buf: b, lead: 0 };
    }
    case "pop": {
      const f = 520 + v * 160;
      const n = Math.ceil(0.22 * SR);
      const sig = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        ph += (TAU * (f * 0.55 + f * 0.45 * Math.exp(-t * 60))) / SR;
        sig[i] = Math.sin(ph) * Math.exp(-t * 32) * Math.min(1, t * 2000);
      }
      add(sig, noiseBurst(0.012, r, 4000, 300, "hp"), 0.25);
      const b = mono(sig);
      reverb(b, 0.15);
      return { buf: b, lead: 0.002 };
    }
    case "tick": {
      const n = Math.ceil(0.07 * SR);
      const sig = new Float32Array(n);
      for (let i = 0; i < n; i++) { const t = i / SR; sig[i] = (Math.sin(TAU * 2300 * t) * 0.7 + Math.sin(TAU * 3900 * t) * 0.3) * Math.exp(-t * 110); }
      return { buf: mono(sig), lead: 0 };
    }
    case "blip": {
      const n = Math.ceil(0.18 * SR);
      const sig = new Float32Array(n);
      const f = 880 * Math.pow(2, Math.round(v * 5) / 12);
      for (let i = 0; i < n; i++) { const t = i / SR; sig[i] = Math.sin(TAU * f * t) * Math.exp(-t * 26) * Math.min(1, t * 1500); }
      const b = mono(sig);
      reverb(b, 0.25);
      return { buf: b, lead: 0 };
    }
    case "ding": {
      const sig = fmBell(1318.5, 2, { ratio: 1.4, index: 1.6, decay: 2.6 });
      add(sig, fmBell(2637, 1.2, { ratio: 3.5, index: 0.8, decay: 4 }), 0.25);
      const b = mono(sig);
      reverb(b, 0.45, 0.85);
      return { buf: b, lead: 0 };
    }
    case "chime": {
      const n = Math.ceil(2.6 * SR);
      const l = new Float32Array(n), rr = new Float32Array(n);
      [1046.5, 1318.5, 1568, 2093].forEach((f, k) => {
        const note = fmBell(f, 2.2, { ratio: 1.4, index: 1.4, decay: 2.4 });
        const off = Math.round(k * 0.075 * SR);
        add(l, note, 0.5 - k * 0.08 + 0.1, off);
        add(rr, note, 0.3 + k * 0.08, off);
      });
      const b = { l, r: rr };
      reverb(b, 0.5, 0.86);
      return { buf: b, lead: 0 };
    }
    case "riser": {
      const len = 1.4;
      const b = noiseSweep(len, r, 400, 6000, 0.8, p => Math.pow(p, 2.2), -0.2, 0.2);
      const n = b.l.length;
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const p = i / n;
        ph += (TAU * (180 * Math.pow(5, p))) / SR;
        const saw = ((ph / TAU) % 1) * 2 - 1;
        const e = Math.pow(p, 2.6) * 0.12;
        b.l[i] += saw * e; b.r[i] += saw * e;
      }
      reverb(b, 0.3);
      return { buf: b, lead: len };
    }
    case "swell": {
      const len = 0.9;
      const b = noiseSweep(len, r, 300, 2600, 0.6, p => Math.pow(p, 3), 0, 0);
      reverb(b, 0.4, 0.85);
      return { buf: b, lead: len };
    }
    case "shimmer":
    case "sparkle": {
      const count = name === "sparkle" ? 18 : 9;
      const total = name === "sparkle" ? 1.7 : 1.3;
      const n = Math.ceil(total * SR);
      const l = new Float32Array(n), rr = new Float32Array(n);
      for (let k = 0; k < count; k++) {
        const f = 2200 + r() * 4200;
        const note = fmBell(f, 0.5, { ratio: 2.01, index: 0.4, decay: 9 });
        const off = Math.round(r() * (name === "sparkle" ? 0.9 : 0.45) * SR);
        const pan = r();
        add(l, note, 0.22 * (1 - pan) + 0.05, off);
        add(rr, note, 0.22 * pan + 0.05, off);
      }
      const b = { l, r: rr };
      reverb(b, 0.55, 0.86);
      return { buf: b, lead: 0.02 };
    }
    case "count": {
      // Rolling ticks while a number counts up, rising in pitch, slowing at the end.
      const len = Math.max(0.3, Math.min(4, dur));
      const n = Math.ceil((len + 0.1) * SR);
      const sig = new Float32Array(n);
      let t = 0;
      while (t < len) {
        const p = t / len;
        const f = 1200 + 1100 * p;
        const tick = new Float32Array(Math.ceil(0.03 * SR));
        for (let i = 0; i < tick.length; i++) { const s = i / SR; tick[i] = Math.sin(TAU * f * s) * Math.exp(-s * 160); }
        add(sig, tick, 0.32, Math.round(t * SR));
        t += 0.045 + Math.pow(p, 3) * 0.12; // power2.out counters slow down: so do the ticks
      }
      return { buf: mono(sig), lead: 0 };
    }
    case "glitch": {
      const n = Math.ceil(0.38 * SR);
      const l = new Float32Array(n), rr = new Float32Array(n);
      let i = 0;
      while (i < n) {
        const seg = Math.round((0.01 + r() * 0.04) * SR);
        const mode = r();
        const f = 200 + r() * 1800;
        for (let k = 0; k < seg && i < n; k++, i++) {
          const t = k / SR;
          const v2 = mode < 0.4 ? (Math.sin(TAU * f * t) > 0 ? 0.5 : -0.5) : mode < 0.8 ? Math.round((r() * 2 - 1) * 4) / 4 : 0;
          l[i] = v2 * 0.55; rr[i] = (mode < 0.6 ? v2 : -v2) * 0.55;
        }
      }
      return { buf: { l, r: rr }, lead: 0 };
    }
  }
}

export { pluck };
