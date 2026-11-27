/**
 * Tiny DSP toolkit for the sound designer: everything is synthesised (no samples, no licences), seeded (the same
 * video always gets the same sound) and pure TypeScript (no native dependencies).
 */
export const SR = 48000;

export type Stereo = { l: Float32Array; r: Float32Array };

export function stereo(seconds: number): Stereo {
  const n = Math.max(1, Math.ceil(seconds * SR));
  return { l: new Float32Array(n), r: new Float32Array(n) };
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** RBJ biquad; coefficients can be re-tuned while running (for sweeps). */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private type: "lp" | "hp" | "bp", freq: number, private q = 0.707) {
    this.set(freq, q);
  }
  set(freq: number, q = this.q) {
    const f = Math.min(Math.max(freq, 20), SR * 0.45);
    const w = (2 * Math.PI * f) / SR;
    const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number;
    if (this.type === "lp") { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
    else if (this.type === "hp") { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
    else { b0 = alpha; b1 = 0; b2 = -alpha; }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * cos) / a0; this.a2 = (1 - alpha) / a0;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Freeverb-style stereo reverb (4 combs + 2 allpasses per side). Returns only the wet signal, added in place. */
export function reverb(buf: Stereo, wet = 0.2, room = 0.82, damp = 0.35) {
  const combs = [1116, 1188, 1277, 1356];
  const aps = [556, 441];
  const side = (input: Float32Array, spread: number) => {
    const out = new Float32Array(input.length);
    for (const d of combs) {
      const len = d + spread;
      const line = new Float32Array(len);
      let idx = 0, store = 0;
      for (let i = 0; i < input.length; i++) {
        const y = line[idx];
        store = y * (1 - damp) + store * damp;
        line[idx] = input[i] * 0.015 + store * room;
        out[i] += y;
        if (++idx >= len) idx = 0;
      }
    }
    for (const d of aps) {
      const len = d + spread;
      const line = new Float32Array(len);
      let idx = 0;
      for (let i = 0; i < out.length; i++) {
        const b = line[idx];
        line[idx] = out[i] + b * 0.5;
        out[i] = b - out[i];
        if (++idx >= len) idx = 0;
      }
    }
    return out;
  };
  const l = side(buf.l, 0);
  const r = side(buf.r, 23);
  for (let i = 0; i < buf.l.length; i++) {
    buf.l[i] += l[i] * wet;
    buf.r[i] += r[i] * wet;
  }
}

/** Adds `src` into `dst` at `atSec` with gain and equal-power pan (−1 left … 1 right). */
export function mixInto(dst: Stereo, src: Stereo, atSec: number, gain = 1, pan = 0) {
  const start = Math.round(atSec * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  for (let i = 0; i < src.l.length; i++) {
    const j = start + i;
    if (j < 0) continue;
    if (j >= dst.l.length) break;
    dst.l[j] += src.l[i] * gl;
    dst.r[j] += src.r[i] * gr;
  }
}

/** Karplus–Strong plucked string: warm plucks, harps, pizzicato. */
export function pluck(freq: number, seconds: number, r: () => number, opts: { bright?: number; decay?: number } = {}) {
  const n = Math.ceil(seconds * SR);
  const out = new Float32Array(n);
  const period = Math.max(2, Math.round(SR / freq));
  const line = new Float32Array(period);
  const bright = opts.bright ?? 0.5;
  for (let i = 0; i < period; i++) line[i] = (r() * 2 - 1) * (0.5 + bright * 0.5);
  const decay = opts.decay ?? 0.996;
  let idx = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[idx];
    const next = (cur + prev) * 0.5 * decay;
    prev = cur;
    line[idx] = next;
    out[i] = cur;
    if (++idx >= period) idx = 0;
  }
  return out;
}

/** Simple FM bell (carrier, modulator ratio, index decaying with the note). */
export function fmBell(freq: number, seconds: number, opts: { ratio?: number; index?: number; decay?: number } = {}) {
  const n = Math.ceil(seconds * SR);
  const out = new Float32Array(n);
  const ratio = opts.ratio ?? 3.5, index = opts.index ?? 2.4, decay = opts.decay ?? 3.2;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * decay);
    const mod = Math.sin(2 * Math.PI * freq * ratio * t) * index * Math.exp(-t * decay * 1.6);
    out[i] = Math.sin(2 * Math.PI * freq * t + mod) * env * Math.min(1, t * 400);
  }
  return out;
}

export function mono(sig: Float32Array): Stereo {
  return { l: sig, r: sig.slice() };
}

/** Soft limiter: transparent below ~-3 dBFS, rounds peaks off above. */
export function limit(buf: Stereo, ceiling = 0.97) {
  for (const ch of [buf.l, buf.r]) {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i] / ceiling;
      ch[i] = (Math.abs(x) < 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((Math.abs(x) - 0.7) / 0.3))) * ceiling;
    }
  }
}

export function peak(buf: Stereo) {
  let p = 0;
  for (const ch of [buf.l, buf.r]) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > p) p = a; }
  return p;
}

/** 16-bit PCM WAV. */
export function toWav(buf: Stereo) {
  const n = buf.l.length;
  const out = Buffer.alloc(44 + n * 4);
  out.write("RIFF", 0); out.writeUInt32LE(36 + n * 4, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf.l[i] * 32767))), 44 + i * 4);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf.r[i] * 32767))), 46 + i * 4);
  }
  return out;
}
