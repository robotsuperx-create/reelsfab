/**
 * Cinema reels: a narrated script (one voice line per sentence) where every line says which SHOT carries it (a 3D
 * globe that dives to a country, a real photo of the person that cracks and shatters, a map assembled from gold
 * fragments, a launch, a waving flag…) and which WORDS hit the screen, each tied to the word of the narration it
 * lands on. The compiler turns word cues into exact times from the voice's word timings.
 */
import { z } from "zod";

export const CINEMA_FORMATS = ["9:16", "16:9"] as const;
export type CinemaFormat = (typeof CINEMA_FORMATS)[number];
export const CINEMA_SIZE: Record<CinemaFormat, { w: number; h: number }> = { "9:16": { w: 1080, h: 1920 }, "16:9": { w: 1920, h: 1080 } };
export const CINEMA_SHOTS = ["globe", "photo", "assemble", "launch", "flag", "dark", "newspaper", "document", "timeline"] as const;
export const CINEMA_TEXT_STYLES = ["slam", "show", "kicker", "counter", "stamp", "caption"] as const;
export const CINEMA_MUSIC = ["epic", "tense", "calm", "upbeat", "tech", "playful"] as const;
/** Free neural voices (Microsoft Edge) — documentary male first. */
export const CINEMA_VOICES = [
  { id: "ar-SA-HamedNeural", label: "حامد — فصحى، رجل، وثائقي" },
  { id: "ar-EG-ShakirNeural", label: "شاكر — رجل، دافئ" },
  { id: "ar-MA-JamalNeural", label: "جمال — مغربي، رجل" },
  { id: "ar-SA-ZariyahNeural", label: "زارية — فصحى، امرأة" },
  { id: "ar-AE-FatimaNeural", label: "فاطمة — امرأة" },
  { id: "en-US-AndrewNeural", label: "Andrew — English, male" },
  { id: "en-GB-RyanNeural", label: "Ryan — English (UK), male" },
] as const;

const word = z.string().trim().max(60).optional();
const shotSchema = z.object({
  type: z.enum(CINEMA_SHOTS),
  at: word,
  transition: z.enum(["flash", "fade", "cut"]).optional(),
  // globe
  country: z.string().trim().max(60).optional(),
  dive: z.boolean().optional(),
  arcsFrom: z.array(z.string().trim().max(60)).max(10).optional(),
  arcsAt: word,
  pulseAt: word,
  satellite: z.boolean().optional(),
  highlight: z.array(z.object({ country: z.string().trim().max(60), color: z.enum(["red", "gold", "blue", "green"]).default("red") })).max(6).optional(),
  // photo
  wiki: z.string().trim().max(120).optional(),
  query: z.string().trim().max(80).optional(),
  cutout: z.boolean().optional(),
  tint: z.enum(["sepia", "bw", "gold", "red", "cold", "none"]).optional(),
  motion: z.enum(["in", "out", "left", "right"]).optional(),
  cracksAt: word,
  shatterAt: word,
  focusY: z.number().min(0).max(1).optional(),
  // assemble
  fillAt: word,
  // newspaper / document
  masthead: z.string().trim().max(40).optional(),
  headline: z.string().trim().max(90).optional(),
  sub: z.string().trim().max(120).optional(),
  date: z.string().trim().max(40).optional(),
  highlightAt: word,
  title: z.string().trim().max(40).optional(),
  lines: z.array(z.string().trim().max(60)).max(7).optional(),
  stamp: z.string().trim().max(24).optional(),
  stampAt: word,
  redact: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  redactAt: word,
  // timeline
  events: z.array(z.object({ date: z.string().trim().max(24), label: z.string().trim().max(40), at: word })).max(6).optional(),
});
const textSchema = z.object({
  text: z.string().trim().max(80).default(""),
  style: z.enum(CINEMA_TEXT_STYLES).default("show"),
  at: word,
  until: word,
  color: z.enum(["white", "gold", "red"]).optional(),
  pos: z.enum(["top", "upper", "center", "lower", "bottom"]).optional(),
  size: z.enum(["xl", "l", "m", "s", "xs"]).optional(),
  from: z.number().optional(),
  to: z.number().optional(),
  prefix: z.string().max(6).optional(),
  suffix: z.string().max(12).optional(),
  strikeAt: word,
  flash: z.boolean().optional(),
});
export const cinemaScriptSchema = z.object({
  title: z.string().trim().min(1).max(160),
  format: z.enum(CINEMA_FORMATS).default("9:16"),
  lang: z.enum(["ar", "en"]).default("ar"),
  voice: z.string().max(60).optional(),
  music: z.enum(CINEMA_MUSIC).default("epic"),
  grade: z.enum(["warm", "cold"]).default("warm"),
  lines: z.array(z.object({
    say: z.string().trim().min(1).max(400),
    pause: z.number().min(0).max(2).optional(),
    shots: z.array(shotSchema).max(3).default([]),
    texts: z.array(textSchema).max(6).default([]),
  })).min(1).max(40),
  hold: z.number().min(0).max(4).default(1.3),
});
export type CinemaScript = z.infer<typeof cinemaScriptSchema>;
export type CinemaShot = z.infer<typeof shotSchema>;
export type CinemaText = z.infer<typeof textSchema>;

/** Word timings of one spoken line, relative to the line's own audio. */
export type LineTiming = { words: { w: string; s: number; d: number }[]; seconds: number };

/** Arabic/Latin word key: no diacritics, tatweel, punctuation; alef/ya/ta-marbuta forms folded. */
export function wordKey(v: string) {
  return v
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Index of the first word of `cue` in the line (whole or prefix match, optional leading "و/ف/ب/ل/ال"). */
export function findWord(words: string[], cue: string | undefined, from = 0) {
  if (!cue) return -1;
  const first = wordKey(cue.split(/\s+/)[0] ?? "");
  if (!first) return -1;
  const keys = words.map(wordKey);
  const strip = (k: string) => k.replace(/^(و|ف|ب|ل|ك)?(ال)?/, "");
  for (const pass of [(k: string) => k === first, (k: string) => strip(k) === strip(first), (k: string) => k.startsWith(first) || first.startsWith(k) && k.length >= 3])
    for (let i = from; i < keys.length; i++) if (keys[i] && pass(keys[i])) return i;
  return -1;
}

export type CompiledPlan = {
  w: number; h: number; duration: number; lang: string; grade: string;
  lineStarts: number[];
  shots: Record<string, unknown>[];
  texts: Record<string, unknown>[];
  cues: { t: number; name: string; gain?: number; dur?: number }[];
  /** Shots whose pictures/countries the server must resolve (index into shots). */
  needs: { shot: number; wiki?: string; query?: string; cutout?: boolean; country?: string; arcsFrom?: string[]; highlight?: { country: string; color: string }[] }[];
};

/**
 * Times every shot and text from the voice: lines follow each other with a short pause; a cue word resolves to the
 * moment that word starts. Pictures and countries stay as references for the server to resolve.
 */
export function compileCinema(script: CinemaScript, timings: LineTiming[], opts?: { lead?: number; gap?: number }): CompiledPlan {
  const { w, h } = CINEMA_SIZE[script.format];
  const lead = opts?.lead ?? 0.35, gap = opts?.gap ?? 0.3;
  const lineStarts: number[] = [];
  const lineEnds: number[] = [];
  let t = lead;
  script.lines.forEach((line, i) => {
    if (i > 0) t += line.pause ?? gap;
    lineStarts.push(t);
    const tm = timings[i];
    const last = tm.words[tm.words.length - 1];
    const spoken = last ? last.s + last.d : tm.seconds;
    lineEnds.push(t + spoken);
    t += spoken;
  });
  const duration = +(t + script.hold).toFixed(2);
  const at = (i: number, cue: string | undefined, fallback: number) => {
    const words = timings[i].words.map(x => x.w);
    const k = findWord(words, cue);
    return k >= 0 ? +(lineStarts[i] + timings[i].words[k].s).toFixed(3) : fallback;
  };
  const endOf = (i: number, cue: string | undefined) => {
    if (cue === "end") return duration - 0.25;
    const words = timings[i].words.map(x => x.w);
    const k = findWord(words, cue);
    return k >= 0 ? +(lineStarts[i] + timings[i].words[k].s + timings[i].words[k].d).toFixed(3) : null;
  };
  const shots: Record<string, unknown>[] = [];
  const texts: Record<string, unknown>[] = [];
  const cues: CompiledPlan["cues"] = [];
  const needs: CompiledPlan["needs"] = [];
  script.lines.forEach((line, i) => {
    const ls = lineStarts[i];
    line.shots.forEach((s, k) => {
      const start = k === 0 && !s.at ? (i === 0 ? 0 : ls - 0.15) : at(i, s.at, ls);
      const shot: Record<string, unknown> = { type: s.type, start, transition: s.transition ?? (s.type === "photo" || s.type === "flag" ? "flash" : "fade") };
      if (s.dive) shot.dive = true;
      if (s.satellite) shot.satellite = true;
      if (s.arcsAt || s.arcsFrom?.length) shot.arcsAt = at(i, s.arcsAt, ls + 0.3);
      if (s.pulseAt) shot.pulseAt = at(i, s.pulseAt, ls + 1);
      if (s.cracksAt) shot.cracksAt = at(i, s.cracksAt, ls + 0.5);
      if (s.shatterAt) shot.shatterAt = at(i, s.shatterAt, ls + 1);
      if (s.fillAt) shot.fillAt = at(i, s.fillAt, lineEnds[i] - 0.6);
      if (s.tint) shot.tint = s.tint;
      for (const k of ["masthead", "headline", "sub", "date", "title", "lines", "stamp", "redact"] as const) if (s[k] !== undefined) shot[k] = s[k];
      if (s.highlightAt) shot.highlightAt = at(i, s.highlightAt, start + 1.2);
      if (s.stampAt) shot.stampAt = at(i, s.stampAt, start + 1.5);
      if (s.redactAt) shot.redactAt = at(i, s.redactAt, start + 1.8);
      if (s.events?.length) {
        // Events may cue words of this line or of the next ones (a timeline often spans two lines).
        let t0 = start;
        shot.events = s.events.map((ev, n) => {
          let tt = -1;
          for (let j = i; j < Math.min(script.lines.length, i + 3) && tt < 0; j++) {
            const k = findWord(timings[j].words.map(x => x.w), ev.at);
            if (k >= 0) tt = lineStarts[j] + timings[j].words[k].s;
          }
          t0 = tt >= 0 ? Math.max(tt, t0) : t0 + (n === 0 ? 0.6 : 1.1);
          return { date: ev.date, label: ev.label, at: +t0.toFixed(3) };
        });
      }
      if (s.motion) shot.motion = s.motion;
      if (s.focusY != null) shot.focusY = s.focusY;
      if (s.type === "photo" || s.type === "globe" || s.type === "assemble" || s.type === "flag" || (s.type === "newspaper" && (s.wiki || s.query))) {
        shot.need = { wiki: s.wiki, query: s.query, cutout: s.type === "photo" ? s.cutout !== false : false, country: s.country, arcsFrom: s.arcsFrom, highlight: s.highlight };
      }
      shots.push(shot);
      cues.push({ t: start, name: shot.transition === "flash" ? "whoosh" : "whoosh-soft", gain: 0.8 });
      if (s.type === "globe" && s.dive) cues.push({ t: start, name: "swell", gain: 0.7, dur: 3.2 });
      if (shot.arcsAt != null) cues.push({ t: shot.arcsAt as number, name: "riser", gain: 0.55, dur: 2 });
      if (shot.pulseAt != null) cues.push({ t: shot.pulseAt as number, name: "impact", gain: 0.9 });
      if (shot.cracksAt != null) cues.push({ t: shot.cracksAt as number, name: "impact", gain: 0.8 });
      if (shot.shatterAt != null) cues.push({ t: shot.shatterAt as number, name: "glitch", gain: 0.8 }, { t: (shot.shatterAt as number) + 0.02, name: "impact", gain: 1.2 });
      if (shot.fillAt != null) cues.push({ t: (shot.fillAt as number) - 1.6, name: "swell", gain: 0.6, dur: 1.6 }, { t: shot.fillAt as number, name: "shimmer", gain: 0.8 });
      if (s.type === "launch") cues.push({ t: start + 0.2, name: "riser", gain: 0.8, dur: 2.2 });
      if (s.type === "newspaper") cues.push({ t: start + 0.85, name: "impact", gain: 0.9 });
      if (shot.highlightAt != null) cues.push({ t: shot.highlightAt as number, name: "whoosh-soft", gain: 0.5 });
      if (shot.stampAt != null) cues.push({ t: (shot.stampAt as number) + 0.12, name: "impact", gain: 1.2 });
      if (shot.redactAt != null) cues.push({ t: shot.redactAt as number, name: "glitch", gain: 0.5 });
      for (const ev of (shot.events as { at: number }[] | undefined) ?? []) cues.push({ t: ev.at, name: "pop", gain: 0.7 });
    });
    line.texts.forEach(x => {
      const start = at(i, x.at, ls + 0.05);
      const nextStart = i + 1 < lineStarts.length ? lineStarts[i + 1] - 0.15 : duration - 0.25;
      const until = x.until ? endOf(i, x.until) ?? nextStart : nextStart;
      const text: Record<string, unknown> = { text: x.text, style: x.style, at: start, until: Math.max(start + 0.6, until) };
      for (const k of ["color", "pos", "size", "from", "to", "prefix", "suffix", "flash"] as const) if (x[k] !== undefined) text[k] = x[k];
      if (x.style === "counter" && text.to === undefined) text.to = Number(x.text.replace(/[^\d.]/g, "")) || 0;
      if (x.strikeAt) text.strikeAt = at(i, x.strikeAt, start + 1);
      texts.push(text);
      if (x.style === "slam") cues.push({ t: start, name: x.flash ? "impact" : "hit", gain: x.flash ? 1.3 : 0.9 });
      if (x.style === "stamp") cues.push({ t: start + 0.1, name: "impact", gain: 1.1 });
      if (x.style === "counter") cues.push({ t: start, name: "count", gain: 0.6, dur: 0.9 });
      if (x.strikeAt) cues.push({ t: text.strikeAt as number, name: "hit", gain: 0.7 });
      if (x.flash) cues.push({ t: start + 0.01, name: "shimmer", gain: 0.9 });
    });
  });
  // Shots run back to back: each until the next one starts.
  shots.sort((a, b) => (a.start as number) - (b.start as number));
  if (shots.length) shots[0].start = 0;
  shots.forEach((s, k) => { s.end = k + 1 < shots.length ? shots[k + 1].start : duration; });
  if (!shots.length) shots.push({ type: "dark", start: 0, end: duration });
  shots.forEach((s, k) => {
    if (s.need) needs.push({ shot: k, ...(s.need as object) });
    delete s.need;
  });
  return { w, h, duration, lang: script.lang, grade: script.grade, lineStarts, shots, texts, cues: cues.filter(c => c.t >= 0 && c.t < duration).sort((a, b) => a.t - b.t), needs };
}

/** Estimated word timings (no voice engine): Arabic ≈ 2.4 words/s, Latin ≈ 2.9. Each word by its letters. */
export function estimateTiming(say: string): LineTiming {
  const words = say.split(/\s+/).filter(Boolean);
  const perLetter = /[؀-ۿ]/.test(say) ? 0.085 : 0.07;
  let t = 0.1;
  const out = words.map(w => {
    const d = Math.max(0.18, wordKey(w).length * perLetter + 0.06);
    const r = { w, s: +t.toFixed(3), d: +d.toFixed(3) };
    t += d + (/[.،,؛…!?؟]$/.test(w) ? 0.28 : 0.04);
    return r;
  });
  return { words: out, seconds: +(t + 0.3).toFixed(2) };
}
