/**
 * The soundtrack of a code video: the cues the motion kit logged (a whoosh on each transition, a hit on each slammed
 * line, ticks while a number counts, a chime on the end card…) over a music bed that suits the topic — generated for
 * the mood, or one of the owner's own tracks — with the music dipping under the big hits. No voice.
 */
import { execFile } from "node:child_process";
import { SR, limit, mixInto, stereo, toWav, type Stereo } from "./dsp";
import { music, MOODS, type Mood } from "./music";
import { makeSfx, SFX_NAMES, type SfxName } from "./sfx";

export type Cue = { t: number; name: SfxName; gain?: number; dur?: number; v?: number };

/** What a kit page reports (window.__cvSound). */
export type PageSound = { mood?: string; sfx?: boolean; music?: boolean; cues?: unknown[] };

export const SOUND_MODES = ["auto", "music", "off"] as const;
export type SoundMode = (typeof SOUND_MODES)[number];

/** Levels: calibrated so a typical reel lands around −16 LUFS (the studio's standard) with peaks under −1 dBFS. */
const MUSIC_GAIN = 0.47;
const SFX_GAIN = 0.7;
const DUCKERS: Partial<Record<SfxName, number>> = { impact: 0.5, hit: 0.72, chime: 0.75, ding: 0.8, riser: 0.8, glitch: 0.7, whoosh: 0.86, zoom: 0.84 };

export function cleanCues(raw: unknown[] | undefined, durationSec: number): Cue[] {
  const out: Cue[] = [];
  for (const c of raw ?? []) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const name = String(o.name) as SfxName;
    const t = Number(o.t);
    if (!(SFX_NAMES as readonly string[]).includes(name) || !Number.isFinite(t) || t < 0 || t > durationSec) continue;
    out.push({ t, name, gain: Math.max(0, Math.min(1.5, Number(o.gain ?? 1) || 0)), dur: Number(o.dur) || undefined, v: Number(o.v) || 0 });
    if (out.length >= 400) break;
  }
  // Two identical sounds closer than 60 ms read as one flam: keep the louder.
  out.sort((a, b) => a.t - b.t);
  return out.filter((c, i) => !out.some((d, j) => j !== i && d.name === c.name && Math.abs(d.t - c.t) < 0.06 && ((d.gain ?? 1) > (c.gain ?? 1) || ((d.gain ?? 1) === (c.gain ?? 1) && j < i))));
}

export function moodOf(v: unknown, fallback: Mood = "calm"): Mood {
  return (MOODS as readonly string[]).includes(String(v)) ? (v as Mood) : fallback;
}

/** Decodes an audio file to 48 kHz stereo floats for [offset, offset + dur], looping it when it is shorter. */
function decodeFile(path: string, offsetSec: number, durationSec: number): Promise<Stereo> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-v", "error", "-stream_loop", "-1", "-ss", offsetSec.toFixed(3), "-i", path, "-t", durationSec.toFixed(3), "-f", "f32le", "-ac", "2", "-ar", String(SR), "pipe:1"],
      { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        const b = stdout as Buffer;
        const f = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
        const out = stereo(durationSec);
        for (let i = 0; i < out.l.length && i * 2 + 1 < f.length; i++) { out.l[i] = f[i * 2]; out.r[i] = f[i * 2 + 1]; }
        resolve(out);
      },
    );
  });
}

export type SoundtrackOptions = {
  durationSec: number;
  cues: Cue[];
  /** null = no music. */
  mood: Mood | null;
  /** The owner's own track instead of generated music (played at a bed level, looped, faded). */
  musicFile?: string | null;
  /** For a segment of a longer video: where it starts, and the whole length (music stays continuous). */
  offsetSec?: number;
  totalSec?: number;
  seed?: number;
};

export async function designSoundtrack(o: SoundtrackOptions): Promise<{ wav: Buffer; peak: number }> {
  const D = Math.max(0.1, o.durationSec);
  const off = o.offsetSec ?? 0;
  const total = Math.max(D + off, o.totalSec ?? D + off);
  const seed = o.seed ?? 1;
  const mix = stereo(D);
  if (o.mood || o.musicFile) {
    let bed: Stereo;
    if (o.musicFile) {
      bed = await decodeFile(o.musicFile, off, D);
      // A real track is mastered loud: bring it to bed level and fade with the video.
      for (let i = 0; i < bed.l.length; i++) {
        const tAbs = off + i / SR;
        const f = 0.3 * Math.min(1, tAbs / 0.8) * Math.min(1, Math.max(0, (total - tAbs) / 1.8));
        bed.l[i] *= f; bed.r[i] *= f;
      }
    } else bed = music(o.mood!, { totalSec: total, offsetSec: off, durationSec: D, seed });
    // Ducking: the bed dips under big hits so they land.
    const duck = new Float32Array(Math.ceil(D * 100) + 1).fill(1);
    for (const c of o.cues) {
      const depth = DUCKERS[c.name];
      if (!depth) continue;
      for (let k = 0; k < duck.length; k++) {
        const dt = k / 100 - c.t;
        if (dt < -0.08 || dt > 0.7) continue;
        const shape = dt < 0 ? 1 + dt / 0.08 : Math.max(0, 1 - dt / 0.7);
        duck[k] = Math.min(duck[k], 1 - (1 - depth) * shape);
      }
    }
    for (let i = 0; i < mix.l.length; i++) {
      const k = (i / SR) * 100;
      const a = duck[Math.floor(k)] ?? 1, b = duck[Math.ceil(k)] ?? a;
      const g = MUSIC_GAIN * (a + (b - a) * (k - Math.floor(k)));
      mix.l[i] += bed.l[i] * g;
      mix.r[i] += bed.r[i] * g;
    }
  }
  const cache = new Map<string, ReturnType<typeof makeSfx>>();
  o.cues.forEach((c, i) => {
    const v = Math.round((c.v ?? 0) * 8) / 8;
    const key = `${c.name}|${v}|${c.name === "count" ? (c.dur ?? 1).toFixed(1) : ""}|${c.name === "whoosh" || c.name === "pop" ? i % 3 : 0}`;
    let s = cache.get(key);
    if (!s) { s = makeSfx(c.name, seed * 1009 + key.length * 131 + (i % 3) * 17 + Math.round(v * 8), v, c.dur ?? 1); cache.set(key, s); }
    mixInto(mix, s.buf, c.t - s.lead, (c.gain ?? 1) * SFX_GAIN, 0);
  });
  let p = 0;
  for (const ch of [mix.l, mix.r]) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]));
  if (p > 1.6) { const g = 1.6 / p; for (const ch of [mix.l, mix.r]) for (let i = 0; i < ch.length; i++) ch[i] *= g; }
  limit(mix, 0.89);
  return { wav: toWav(mix), peak: p };
}
