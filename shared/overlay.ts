/**
 * Overlay plans: motion graphics laid over the owner's own video (a client's talking clip, an interview…).
 * The director never writes code: it writes a short JSON plan — which idea gets a punch line, which number counts
 * up, where an icon pops, when the camera punches in — tied to the INDEX of the spoken word it lands on. The
 * compiler turns those indexes into exact times from the aligned transcript, keeps every element off faces and off
 * each other, and a tested runtime draws it frame by frame.
 */
import { z } from "zod";

export const OVERLAY_BANDS = ["top", "upper", "center", "lower", "bottom"] as const;
export type OverlayBand = (typeof OVERLAY_BANDS)[number];
export const OVERLAY_ACCENTS = { yellow: "#FFD21F", gold: "#E9B949", red: "#FF3B30", green: "#22C55E", blue: "#3B82F6", orange: "#FF7A1A", pink: "#FF3D8B", white: "#FFFFFF" } as const;
export type OverlayAccent = keyof typeof OVERLAY_ACCENTS;
export const OVERLAY_PUNCH_STYLES = ["slam", "show", "highlight", "kicker", "stamp", "typewriter"] as const;
export const OVERLAY_CAPTION_STYLES = ["pop", "box", "karaoke", "clean", "reveal"] as const;
/** Colour looks applied to the owner's video (and the cutaways) before anything is laid on top. */
export const OVERLAY_LOOKS = ["natural", "warm", "cinematic", "cold", "vivid", "bw", "none"] as const;
export type OverlayLook = (typeof OVERLAY_LOOKS)[number];
export const OVERLAY_MUSIC = ["none", "calm", "epic", "tense", "upbeat", "tech", "playful"] as const;
/** Icons the director may pick (all exist in lucide). Kept short on purpose: concrete, readable at a glance. */
export const OVERLAY_ICONS = [
  "trending-up", "trending-down", "chart-no-axes-column-increasing", "dollar-sign", "banknote", "wallet", "piggy-bank", "coins", "credit-card", "percent",
  "clock", "timer", "hourglass", "calendar", "alarm-clock", "rocket", "target", "lightbulb", "brain", "sparkles", "zap", "flame", "star", "heart",
  "thumbs-up", "thumbs-down", "check", "circle-check", "x", "circle-x", "triangle-alert", "shield-check", "lock", "lock-open", "key", "eye",
  "search", "users", "user", "handshake", "briefcase", "building-2", "house", "globe", "map-pin", "plane", "car", "smartphone", "laptop",
  "camera", "video", "mic", "music", "book-open", "graduation-cap", "gift", "shopping-cart", "package", "truck", "store", "tag", "award",
  "trophy", "crown", "gem", "scale", "ban", "megaphone", "message-circle", "mail", "bell", "bot", "code", "cloud", "sun", "moon", "leaf",
  "droplet", "arrow-up-right", "arrow-down-right", "repeat", "infinity", "puzzle", "settings", "wrench", "battery-low", "battery-full",
  "activity", "heart-pulse", "dumbbell", "coffee", "utensils", "smile", "frown", "hand", "compass", "factory", "landmark", "newspaper",
  "film", "flag", "swords", "skull", "list-checks", "file-text", "calculator", "receipt", "hand-coins", "badge-percent", "gauge", "medal",
] as const;

const color = z.enum(["accent", "white", "red", "yellow", "green", "blue"]).catch("accent").default("accent");
const band = z.enum(OVERLAY_BANDS).catch("upper").default("upper");
const side = z.enum(["left", "center", "right"]).catch("center").default("center");
const txt = (n: number) => z.string().trim().max(n);
/** at/until: index of a word in the transcript (it lands when that word is SAID); t/end: seconds when there is no speech. */
const when = {
  at: z.number().int().min(0).optional(),
  until: z.number().int().min(0).optional(),
  t: z.number().min(0).optional(),
  end: z.number().min(0).optional(),
};
export const overlayItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("punch"), ...when, text: txt(70), style: z.enum(OVERLAY_PUNCH_STYLES).catch("slam").default("slam"), color, emphasis: txt(40).optional(), position: band, size: z.enum(["xl", "l", "m", "s"]).catch("l").default("l"), strikeAt: z.number().int().min(0).optional() }),
  z.object({ type: z.literal("counter"), ...when, from: z.number().default(0), to: z.number(), decimals: z.number().int().min(0).max(2).default(0), prefix: txt(6).default(""), suffix: txt(12).default(""), label: txt(50).optional(), color, position: band }),
  z.object({ type: z.literal("icon"), ...when, icon: txt(40), label: txt(40).optional(), color, position: band, side }),
  // A fully animated emoji (Google Noto, drawn frame by frame): the face laughs, the heart beats, the heart breaks.
  z.object({ type: z.literal("emoji"), ...when, emoji: txt(60), label: txt(40).optional(), size: z.enum(["m", "l", "xl"]).catch("l").default("l"), position: band, side }),
  z.object({ type: z.literal("list"), ...when, title: txt(50).optional(), items: z.array(z.object({ text: txt(50), at: z.number().int().min(0).optional(), t: z.number().min(0).optional() })).min(1).max(6), position: band }),
  z.object({ type: z.literal("lower3"), ...when, name: txt(40), role: txt(60).optional() }),
  z.object({ type: z.literal("chapter"), ...when, num: txt(4).optional(), title: txt(50) }),
  z.object({ type: z.literal("photo"), ...when, wiki: txt(120).optional(), query: txt(80).optional(), caption: txt(50).optional(), position: band, side }),
  z.object({ type: z.literal("zoom"), ...when, scale: z.number().min(1.04).max(1.35).catch(1.15).default(1.15), x: z.number().min(0).max(100).catch(50).default(50), y: z.number().min(0).max(100).catch(35).default(35), ease: z.enum(["cut", "smooth"]).catch("cut").default("cut") }),
  z.object({ type: z.literal("flash"), ...when }),
  // Full-frame b-roll that replaces the speaker for a moment (her voice continues under it).
  z.object({ type: z.literal("cutaway"), ...when, query: txt(80), transition: z.enum(["cut", "dissolve"]).catch("dissolve").default("dissolve") }),
  // The screen cracks from a point (a break, a betrayal, "destroys").
  z.object({ type: z.literal("crack"), ...when, x: z.number().min(0).max(100).catch(50).default(50), y: z.number().min(0).max(100).catch(45).default(45) }),
  // A warm light leak washing over the frame (love, memory, hope).
  z.object({ type: z.literal("glow"), ...when, color: z.enum(["warm", "gold", "red", "cold", "pink"]).catch("warm").default("warm") }),
  z.object({ type: z.literal("particles"), ...when, kind: z.enum(["hearts", "bokeh", "sparks", "dust", "snow"]).catch("bokeh").default("bokeh") }),
  // The closing card: the message in elegant type over a soft dark gradient.
  z.object({ type: z.literal("quote"), ...when, text: txt(140), emphasis: txt(40).optional(), author: txt(40).optional() }),
]);
export type OverlayItem = z.infer<typeof overlayItemSchema>;
export const overlayPlanSchema = z.object({
  accent: z.enum(Object.keys(OVERLAY_ACCENTS) as [OverlayAccent, ...OverlayAccent[]]).catch("yellow").default("yellow"),
  captions: z.object({
    on: z.boolean().default(true),
    style: z.enum(OVERLAY_CAPTION_STYLES).catch("pop").default("pop"),
    position: z.enum(["center", "lower", "bottom"]).catch("lower").default("lower"),
    words: z.number().int().min(1).max(7).catch(3).default(3),
  }).default({ on: true, style: "pop", position: "lower", words: 3 }),
  sfx: z.boolean().default(false),
  grade: z.object({ look: z.enum(OVERLAY_LOOKS).catch("natural").default("natural"), enhance: z.boolean().catch(true).default(true) }).default({ look: "natural", enhance: true }),
  music: z.object({ mood: z.enum(OVERLAY_MUSIC).catch("none").default("none"), volume: z.number().min(0).max(1).catch(0.5).default(0.5) }).default({ mood: "none", volume: 0.5 }),
  progress: z.boolean().default(false),
  items: z.array(z.unknown()).max(80).default([]),
});
export type OverlayPlan = Omit<z.infer<typeof overlayPlanSchema>, "items"> & { items: OverlayItem[] };

/** Parses leniently: a broken item is dropped (and reported) instead of failing the whole plan. */
export function parseOverlayPlan(raw: unknown): { plan: OverlayPlan; dropped: string[] } {
  const base = overlayPlanSchema.parse(raw ?? {});
  const items: OverlayItem[] = [];
  const dropped: string[] = [];
  base.items.forEach((it, i) => {
    const r = overlayItemSchema.safeParse(it);
    if (r.success) items.push(r.data);
    else dropped.push(`item ${i} (${(it as { type?: string })?.type ?? "?"}): ${r.error.issues.slice(0, 2).map(x => `${x.path.join(".")} ${x.message}`).join("; ")}`);
  });
  return { plan: { ...base, items }, dropped };
}

export type OWord = { word: string; start: number; end: number };
export type OFrame = { t: number; subjectBox?: [number, number, number, number]; free?: string[] };
export type OverlayZoom = { start: number; end: number; scale: number; x: number; y: number; ease: "cut" | "smooth" };
export type OverlayCue = { t: number; name: "whoosh" | "whoosh-soft" | "impact" | "hit" | "pop" | "tick" | "ding" | "count" | "glitch" | "zoom" | "riser" | "swell" | "shimmer" | "chime" | "sparkle"; gain?: number; dur?: number };
export type OverlayCutaway = { start: number; end: number; query: string; transition: "cut" | "dissolve"; key?: string | null };
export type CompiledItem = Record<string, unknown> & { type: OverlayItem["type"]; start: number; end: number; y: number };
export type CompiledOverlay = {
  w: number;
  h: number;
  duration: number;
  rtl: boolean;
  accent: string;
  progress: boolean;
  captions: null | { style: string; y: number; chunks: { s: number; e: number; words: { w: string; s: number; e: number }[] }[] };
  items: CompiledItem[];
  zooms: OverlayZoom[];
  cutaways: OverlayCutaway[];
  cues: OverlayCue[];
  grade: { look: OverlayLook; enhance: boolean };
  music: { mood: string; volume: number };
  problems: string[];
};

/** Vertical centres of the bands (fraction of the height), for tall and wide frames. */
export function bandY(b: OverlayBand, vert: boolean) {
  return (vert ? { top: 0.15, upper: 0.27, center: 0.45, lower: 0.6, bottom: 0.8 } : { top: 0.13, upper: 0.26, center: 0.46, lower: 0.64, bottom: 0.8 })[b];
}
/** How tall each element is, as a fraction of the height (for collision checks). */
function itemHalfHeight(it: OverlayItem, vert: boolean) {
  const k = vert ? 1 : 1.6;
  switch (it.type) {
    case "punch": return ({ xl: 0.075, l: 0.06, m: 0.045, s: 0.035 } as const)[it.size] * k;
    case "counter": return 0.075 * k;
    case "icon": return 0.065 * k;
    case "emoji": return ({ m: 0.06, l: 0.08, xl: 0.11 } as const)[it.size] * k;
    case "list": return (0.04 + it.items.length * 0.032) * k;
    case "photo": return 0.17 * k;
    case "lower3": return 0.045 * k;
    case "chapter": return 0.09 * k;
    case "quote": return 0.16 * k;
    default: return 0;
  }
}
const PUNCT = /[.!?؟،,;:…]$/;
export const isRtlText = (s: string) => /[֐-ࣿ]/.test(s);

/** Caption chunks from the words: a few words at a time, broken at pauses and punctuation. */
export function captionChunks(words: OWord[], max: number, duration: number) {
  const chunks: { s: number; e: number; words: { w: string; s: number; e: number }[] }[] = [];
  let cur: OWord[] = [];
  const flush = () => { if (cur.length) chunks.push({ s: cur[0].start, e: cur[cur.length - 1].end, words: cur.map(w => ({ w: w.word.trim(), s: w.start, e: w.end })) }); cur = []; };
  words.forEach((w, i) => {
    if (!w.word.trim()) return;
    const prev = words[i - 1];
    if (cur.length && (cur.length >= max || (prev && w.start - prev.end > 0.45))) flush();
    cur.push(w);
    if (PUNCT.test(w.word.trim())) flush();
  });
  flush();
  // Each chunk stays until the next one starts (short gaps) or 0.5 s after its last word.
  chunks.forEach((c, i) => { const next = chunks[i + 1]; c.e = Math.min(duration, next ? Math.min(next.s, c.e + 0.5) : c.e + 0.5); });
  return chunks;
}

/**
 * Plan + transcript → exact timeline. Word indexes become seconds (an element lands AT the start of its word and
 * holds until 0.45 s after the end of its `until` word), bands are moved off faces and off each other.
 */
export function compileOverlay(plan: OverlayPlan, o: { words: OWord[]; frames: OFrame[]; duration: number; w: number; h: number }): CompiledOverlay {
  const { words, duration } = o;
  const vert = o.h > o.w;
  const problems: string[] = [];
  const wordAt = (i: number | undefined, what: string) => {
    if (i == null) return undefined;
    const w = words[i];
    if (!w) { problems.push(`${what}: word index ${i} does not exist (0–${words.length - 1})`); return undefined; }
    return w;
  };
  const timeOf = (it: { at?: number; t?: number }, what: string) => {
    const w = wordAt(it.at, what);
    if (w) return w.start;
    if (it.t != null) return it.t;
    return undefined;
  };
  const capOn = plan.captions.on && words.length > 0;
  const capY = vert ? { center: 0.5, lower: 0.72, bottom: 0.8 }[plan.captions.position] : { center: 0.55, lower: 0.8, bottom: 0.86 }[plan.captions.position];
  const items: CompiledItem[] = [];
  const zooms: OverlayZoom[] = [];
  const cutaways: OverlayCutaway[] = [];
  const cues: OverlayCue[] = [];
  const placed: { start: number; end: number; top: number; bottom: number }[] = [];
  const faces = o.frames.filter(f => f.subjectBox).map(f => ({ t: f.t, top: f.subjectBox![1] / 100, bottom: (f.subjectBox![1] + f.subjectBox![3] * 0.3) / 100, free: f.free ?? [] }));
  const sfx = (c: OverlayCue) => { if (plan.sfx) cues.push(c); };
  // Faces seen while the element is up; with no frame in that window, the nearest one.
  const facesFor = (start: number, end: number) => {
    const near = faces.filter(f => f.t >= start - 1 && f.t <= end + 1);
    if (near.length || !faces.length) return near;
    const mid = (start + end) / 2;
    return [faces.reduce((a, b) => (Math.abs(b.t - mid) < Math.abs(a.t - mid) ? b : a))];
  };

  plan.items.forEach((it, idx) => {
    const what = `item ${idx} (${it.type})`;
    const start0 = timeOf(it, what);
    if (start0 == null) { problems.push(`${what}: needs "at" (word index)${words.length ? "" : ' or "t" (seconds)'}`); return; }
    const start = Math.min(Math.max(0, start0 + 0.02), Math.max(0, duration - 0.3));
    const untilW = wordAt(it.until, `${what} until`);
    let end = untilW ? untilW.end + 0.45 : it.end ?? start + (it.type === "flash" ? 0.3 : it.type === "zoom" ? 2.5 : 2.6);
    if (it.type !== "flash" && end - start < (it.type === "zoom" ? 0.8 : 1.2)) end = start + (it.type === "zoom" ? 0.8 : 1.2);
    if (end - start > 14 && it.type !== "zoom") { problems.push(`${what}: stays ${(end - start).toFixed(1)} s — too long, end it sooner`); end = start + 14; }
    end = Math.min(end, duration);
    if (it.type === "zoom") {
      if (zooms.some(z => start < z.end + 0.6 && end > z.start - 0.6)) { problems.push(`${what}: overlaps another zoom`); return; }
      zooms.push({ start, end, scale: it.scale, x: it.x / 100, y: it.y / 100, ease: it.ease });
      if (it.ease === "cut") sfx({ t: start, name: "whoosh-soft", gain: 0.35 });
      return;
    }
    if (it.type === "flash") { items.push({ ...it, start, end: Math.min(duration, start + 0.3), y: 0.5 }); sfx({ t: start, name: "glitch", gain: 0.4 }); return; }
    if (it.type === "cutaway") {
      if (end - start > 6) { problems.push(`${what}: a cutaway longer than 6 s loses the speaker — keep it 1–4 s`); end = start + 6; }
      if (cutaways.some(c => start < c.end + 0.3 && end > c.start - 0.3)) { problems.push(`${what}: overlaps another cutaway`); return; }
      cutaways.push({ start, end, query: it.query, transition: it.transition });
      sfx({ t: start, name: "whoosh-soft", gain: 0.3 });
      return;
    }
    if (it.type === "crack") { items.push({ ...it, start, end, y: it.y / 100, x: it.x / 100 }); sfx({ t: start, name: "impact", gain: 0.55 }); sfx({ t: start, name: "glitch", gain: 0.3 }); return; }
    if (it.type === "glow" || it.type === "particles") { items.push({ ...it, start, end, y: 0.5 }); if (it.type === "glow") sfx({ t: start, name: "swell", gain: 0.3 }); else if (it.kind === "sparks" || it.kind === "hearts") sfx({ t: start, name: "sparkle", gain: 0.3 }); return; }
    if (it.type === "lower3") {
      const y = vert ? 0.62 : 0.7;
      items.push({ ...it, start, end, y });
      placed.push({ start, end, top: y - 0.05, bottom: y + 0.05 });
      sfx({ t: start, name: "whoosh", gain: 0.45 });
      return;
    }
    // Pick a band: the one asked for if it is clear of faces, captions and other elements, else the nearest clear one.
    const want: OverlayBand = it.type === "chapter" ? "center" : it.type === "quote" ? "lower" : (it as { position?: OverlayBand }).position ?? "upper";
    const hh = itemHalfHeight(it, vert);
    const order = [...OVERLAY_BANDS].sort((a, b) => Math.abs(OVERLAY_BANDS.indexOf(a) - OVERLAY_BANDS.indexOf(want)) - Math.abs(OVERLAY_BANDS.indexOf(b) - OVERLAY_BANDS.indexOf(want)));
    const clashes = (b: OverlayBand) => {
      const y = bandY(b, vert), top = y - hh, bottom = y + hh;
      if (top < 0.06 || bottom > 0.94) return 3;
      if (capOn && it.type !== "chapter" && it.type !== "quote" && top < capY + 0.05 && bottom > capY - 0.05) return 2;
      if (placed.some(p => start < p.end && end > p.start && top < p.bottom && bottom > p.top)) return 2;
      if (it.type !== "chapter" && it.type !== "quote" && facesFor(start, end).some(f => top < f.bottom && bottom > f.top)) return 1;
      return 0;
    };
    let pick = order.find(b => clashes(b) === 0) ?? order.find(b => clashes(b) <= 1) ?? want;
    if (it.type === "chapter") pick = "center";
    if (it.type === "quote" && pick !== "center" && pick !== "lower" && pick !== "upper") pick = "lower";
    const y = bandY(pick, vert);
    placed.push({ start, end, top: y - hh, bottom: y + hh });
    const base = { ...it, start, end, y } as CompiledItem;
    if (it.type === "punch") {
      const strike = wordAt(it.strikeAt, `${what} strikeAt`);
      base.strike = strike ? Math.max(start + 0.3, strike.start) : null;
      base.rtl = isRtlText(it.text);
      sfx({ t: start, name: it.style === "slam" ? "impact" : it.style === "stamp" ? "hit" : it.style === "typewriter" ? "tick" : "whoosh-soft", gain: it.style === "slam" ? 0.45 : 0.4 });
      if (base.strike != null) sfx({ t: base.strike as number, name: "hit", gain: 0.4 });
    }
    if (it.type === "counter") sfx({ t: start, name: "count", gain: 0.35, dur: Math.min(1.4, end - start - 0.3) });
    if (it.type === "icon" || it.type === "emoji") sfx({ t: start, name: "pop", gain: 0.45 });
    if (it.type === "chapter") sfx({ t: start, name: "whoosh", gain: 0.45 });
    if (it.type === "quote") { sfx({ t: start, name: "chime", gain: 0.35 }); base.rtl = isRtlText(it.text); }
    if (it.type === "photo") sfx({ t: start, name: "whoosh", gain: 0.4 });
    if (it.type === "list") {
      const times = it.items.map((x, k) => {
        const w = wordAt(x.at, `${what} item ${k}`);
        return Math.min(end - 0.3, Math.max(start + k * 0.35, w ? w.start : x.t ?? start + k * 0.6));
      });
      base.times = times;
      times.forEach(t => sfx({ t, name: "pop", gain: 0.35 }));
    }
    items.push(base);
  });
  const main = items.filter(i => !["flash", "crack", "glow", "particles"].includes(i.type));
  if (main.length && duration > 0) {
    const perMin = (main.length / duration) * 60;
    if (perMin > 34) problems.push(`too busy: ${main.length} elements in ${duration.toFixed(0)} s — keep only the strongest moments (about one every 4–8 s)`);
  }
  // Never more than two elements at once (captions not counted).
  const DECOR = new Set(["flash", "crack", "glow", "particles"]);
  for (const a of items) {
    if (DECOR.has(a.type)) continue;
    const over = items.filter(b => b !== a && !DECOR.has(b.type) && b.start < a.end && b.end > a.start);
    if (over.length >= 2) { problems.push(`at ${a.start.toFixed(1)} s ${over.length + 1} elements are on screen together — max 2`); break; }
  }
  const allText = words.map(w => w.word).join(" ") + plan.items.map(i => ("text" in i ? i.text : "") ?? "").join(" ");
  return {
    w: o.w,
    h: o.h,
    duration,
    rtl: isRtlText(allText),
    accent: OVERLAY_ACCENTS[plan.accent],
    progress: plan.progress,
    captions: capOn ? { style: plan.captions.style, y: capY, chunks: captionChunks(words, plan.captions.words, duration) } : null,
    items: items.sort((a, b) => a.start - b.start),
    zooms: zooms.sort((a, b) => a.start - b.start),
    cutaways: cutaways.sort((a, b) => a.start - b.start),
    grade: plan.grade,
    music: plan.music,
    cues: cues.sort((a, b) => a.t - b.t),
    problems,
  };
}

/** The zoom factor at time t (what ffmpeg applies to the video under the overlay). */
export function zoomAt(zooms: OverlayZoom[], t: number) {
  for (const z of zooms) {
    if (t < z.start || t >= z.end) continue;
    if (z.ease === "cut") return { scale: z.scale, x: z.x, y: z.y };
    const k = Math.min(1, (t - z.start) / 0.5, (z.end - t) / 0.5);
    const e = k * k * (3 - 2 * k);
    return { scale: 1 + (z.scale - 1) * e, x: z.x, y: z.y };
  }
  return { scale: 1, x: 0.5, y: 0.5 };
}
