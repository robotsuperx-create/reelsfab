/**
 * Storyboards: what the director writes before any code — scenes on a timeline, each with a few kit components.
 * The kit plays a storyboard directly (CV.play), so a storyboard IS a finished video: no animation code to get wrong.
 * Any AI can write one (it is short JSON), and the room accepts it pasted in place of HTML.
 */
import { KIT_ICONS, KIT_PLACEHOLDER, KIT_THEMES, type KitTheme } from "./kit";

export const SB_ITEM_TYPES = ["kicker", "title", "text", "kinetic", "stat", "bars", "list", "timeline", "compare", "quote", "icon", "emoji", "photo", "divider", "source", "lowerThird", "cta", "sfx"] as const;
export type SbItemType = (typeof SB_ITEM_TYPES)[number];
export const SB_TRANSITIONS = ["rise", "fade", "mask", "zoom", "slide", "flash", "cut", "iris", "stripes", "whip", "glitch"] as const;
export const SB_FX = ["confetti", "sparkles", "shake", "rings", "lightleak", "letterbox", "dust", "glitch"] as const;
export const SB_EMOJI_MOTIONS = ["float", "bounce", "spin", "pulse", "wiggle"] as const;
export const SB_MOODS = ["tense", "upbeat", "tech", "calm", "playful", "epic"] as const;
export const SB_SFX = ["whoosh", "whoosh-soft", "zoom", "impact", "hit", "pop", "tick", "blip", "ding", "chime", "riser", "swell", "shimmer", "sparkle", "glitch"] as const;
export const SB_CAMERAS = ["push", "pull", "drift", "none"] as const;
export const SB_PLACES = ["center", "top", "bottom", "start", "end", "top-start", "top-end", "bottom-start", "bottom-end"] as const;
/** Scene backdrops: a free photo or a moving clip (Pexels/Pixabay, or the owner's library), or an animated map. */
export const SB_MEDIA_TYPES = ["photo", "clip", "map"] as const;
export const SB_MEDIA_MOTIONS = ["in", "out", "left", "right", "up", "down"] as const;
/** One colour grade for every picture of the video, so photos look like part of it, not pasted on. */
export const SB_GRADES = ["theme", "mono", "warm", "cool", "vivid", "none"] as const;
export const SB_PHOTO_FRAMES = ["card", "polaroid", "circle", "wide"] as const;

/** Where a picture comes from: a search (resolved by the studio), an asset of the owner's library, or a stored file. */
export type SbMediaRef = {
  query?: string;
  asset?: number;
  /** Storage key once resolved (the studio fills it — keep it unless you want another picture). */
  key?: string;
  /** Clips: a still of the first frame (preview and fallback), where the clip starts and how long it lasts. */
  poster?: string;
  start?: number;
  dur?: number;
  credit?: string;
  /** Provider and id of the chosen result (so "another one" can skip it), and how many times it was swapped. */
  ref?: string;
  pick?: number;
};
export type SbMap = {
  focus: string[];
  highlight?: string[];
  routes?: [string, string][];
  pins?: { at: string; label?: string }[];
  world?: boolean;
  labels?: boolean;
  sahara?: "merged" | "separate";
};
export type SbMedia =
  | ({ type: "photo" | "clip"; motion?: (typeof SB_MEDIA_MOTIONS)[number]; dim?: number; position?: "top" | "center" | "bottom" } & SbMediaRef)
  | ({ type: "map"; geoId?: string } & SbMap);

export type SbItem = { type: SbItemType; at?: number } & Record<string, unknown>;
export type SbScene = { from: number; to: number; transition?: (typeof SB_TRANSITIONS)[number]; camera?: (typeof SB_CAMERAS)[number]; bg?: string; note?: string; fx?: (typeof SB_FX)[number][]; fxEmoji?: string; place?: (typeof SB_PLACES)[number]; media?: SbMedia; items: SbItem[] };
export type SbSound = { mood?: (typeof SB_MOODS)[number]; sfx?: boolean; music?: boolean };
export type Storyboard = {
  title?: string;
  theme: KitTheme;
  accent?: string;
  accent2?: string;
  lang?: string;
  progress?: boolean;
  scenes: SbScene[];
  end?: { text?: string; cta?: string; kicker?: string; emphasis?: string[]; seconds?: number; fx?: (typeof SB_FX)[number][]; fxEmoji?: string };
  sound?: SbSound;
  grade?: (typeof SB_GRADES)[number];
  /** The owner's logo (library): shown on the end card, and small in a corner when `watermark` is on. */
  brand?: { logo?: string; asset?: number; watermark?: boolean };
};

/** One emoji (a grapheme of at most a few code points), or "". */
function emojiChar(v: unknown) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || /[A-Za-z0-9\u0600-\u06FF]/.test(s)) return "";
  return Array.from(s).slice(0, 8).join("");
}
function fxList(v: unknown) {
  return [...new Set((Array.isArray(v) ? v : typeof v === "string" ? [v] : []).map(String).filter(x => (SB_FX as readonly string[]).includes(x)))].slice(0, 2) as (typeof SB_FX)[number][];
}

/* ------------------------------------------------------------ reading what an AI wrote */

/** The JSON object inside an answer (with or without ```json fences). */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no JSON object found");
  return JSON.parse(body.slice(a, b + 1));
}

/** Pasted text is a storyboard (JSON with scenes) rather than an HTML page. */
export function looksLikeStoryboard(text: string) {
  const t = text.trim().replace(/^```(?:json)?/i, "").trim();
  return t.startsWith("{") && /"scenes"\s*:/.test(t);
}

/* ------------------------------------------------------------ normalisation */

const MAX_ITEMS = 4;
const LIMITS = { title: 70, text: 150, kicker: 40, line: 32, listItem: 64, label: 42, quote: 170, cta: 34, source: 90 };
const isHex = (v: unknown) => typeof v === "string" && /^#[\da-f]{6}$/i.test(v.trim());
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d);
const r2 = (x: number) => Math.round(x * 100) / 100;
const wordsOf = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Visible words an item puts on screen (for the reading-time check). */
export function itemWords(it: SbItem): number {
  const o = it as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? wordsOf(o[k] as string) : 0);
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []);
  switch (it.type) {
    case "kinetic": return arr("lines").reduce<number>((a, l) => a + wordsOf(String(l)), 0);
    case "list": return arr("items").reduce<number>((a, l) => a + wordsOf(String(l)), 0);
    case "bars": return arr("items").reduce<number>((a, l) => a + wordsOf(String((l as { label?: string }).label ?? "")) + 1, 0);
    case "timeline": return arr("events").reduce<number>((a, e) => a + wordsOf(String((e as { text?: string }).text ?? "")) + 1, 0);
    case "compare": {
      const side = (k: string) => { const x = (o[k] ?? {}) as { title?: string; items?: unknown[] }; return wordsOf(String(x.title ?? "")) + (x.items ?? []).reduce<number>((a, l) => a + wordsOf(String(l)), 0); };
      return side("left") + side("right");
    }
    case "stat": return 2 + s("label");
    case "quote": return s("text") + s("by");
    case "photo": return s("caption");
    case "source": case "lowerThird": case "icon": case "divider": case "emoji": case "sfx": return 0;
    default: return s("text");
  }
}

function cleanItem(raw: unknown, issues: string[], where: string): SbItem | null {
  const item = cleanItemBody(raw, issues, where);
  if (item && raw && typeof raw === "object" && (raw as { sfx?: unknown }).sfx === false && item.type !== "sfx") (item as Record<string, unknown>).sfx = false;
  return item;
}

function cleanItemBody(raw: unknown, issues: string[], where: string): SbItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = String(o.type ?? "") as SbItemType;
  if (!(SB_ITEM_TYPES as readonly string[]).includes(type)) {
    issues.push(`${where}: unknown item type "${String(o.type)}" was dropped (use one of ${SB_ITEM_TYPES.join(", ")})`);
    return null;
  }
  const at = o.at === undefined || o.at === null ? undefined : Math.max(0, n(o.at, 0));
  const emphasis = Array.isArray(o.emphasis) ? o.emphasis.map(x => str(x, 40)).filter(Boolean).slice(0, 3) : undefined;
  const cut = (k: keyof typeof LIMITS, v: unknown) => {
    const s = str(v, 1000);
    if (s.length > LIMITS[k]) issues.push(`${where}: ${type} text too long (${s.length} chars, max ${LIMITS[k]}) — shorten it: "${s.slice(0, 40)}…"`);
    return s.slice(0, LIMITS[k]);
  };
  const base = { type, ...(at !== undefined ? { at: r2(at) } : {}) };
  switch (type) {
    case "title": case "text": case "kicker": case "cta": case "source": {
      const text = cut(type === "title" ? "title" : type === "kicker" ? "kicker" : type === "cta" ? "cta" : type === "source" ? "source" : "text", o.text);
      if (!text) return null;
      return { ...base, text, ...(emphasis?.length ? { emphasis } : {}), ...(type === "title" && ["xl", "l", "m", "s"].includes(String(o.size)) ? { size: String(o.size) } : {}), ...(type === "title" && o.underline ? { underline: true } : {}) };
    }
    case "kinetic": {
      const lines = (Array.isArray(o.lines) ? o.lines : typeof o.text === "string" ? [o.text] : []).map(l => cut("line", l)).filter(Boolean).slice(0, 4);
      if (!lines.length) return null;
      return { ...base, lines, ...(emphasis?.length ? { emphasis } : {}) };
    }
    case "stat": {
      const value = n(o.value, NaN);
      if (!Number.isFinite(value)) { issues.push(`${where}: stat without a numeric "value" was dropped`); return null; }
      return { ...base, value, ...(o.from !== undefined ? { from: n(o.from, 0) } : {}), prefix: str(o.prefix, 6), suffix: str(o.suffix, 12), decimals: Math.max(0, Math.min(2, Math.round(n(o.decimals, 0)))), label: cut("label", o.label), ...(o.digits === "arab" ? { digits: "arab" } : {}), ...(emphasis?.length ? { emphasis } : {}) };
    }
    case "bars": {
      const items = (Array.isArray(o.items) ? o.items : []).map(x => ({ label: cut("label", (x as { label?: unknown })?.label), value: n((x as { value?: unknown })?.value, NaN) })).filter(x => x.label && Number.isFinite(x.value)).slice(0, 5);
      if (!items.length) return null;
      return { ...base, items, unit: str(o.unit, 8), decimals: Math.max(0, Math.min(2, Math.round(n(o.decimals, 0)))) };
    }
    case "list": {
      const items = (Array.isArray(o.items) ? o.items : []).map(x => cut("listItem", x)).filter(Boolean).slice(0, 5);
      if (!items.length) return null;
      return { ...base, items, ...(o.numbered ? { numbered: true } : {}), ...(typeof o.icon === "string" && (KIT_ICONS as readonly string[]).includes(o.icon) ? { icon: o.icon } : {}) };
    }
    case "timeline": {
      const events = (Array.isArray(o.events) ? o.events : []).map(x => ({ date: str((x as { date?: unknown })?.date, 16), text: cut("label", (x as { text?: unknown })?.text) })).filter(x => x.date && x.text).slice(0, 5);
      if (!events.length) return null;
      return { ...base, events };
    }
    case "compare": {
      const side = (v: unknown) => { const x = (v ?? {}) as { title?: unknown; items?: unknown }; return { title: cut("label", x.title), items: (Array.isArray(x.items) ? x.items : []).map(i => cut("label", i)).filter(Boolean).slice(0, 3) }; };
      const left = side(o.left), right = side(o.right);
      if (!left.title || !right.title) return null;
      return { ...base, left, right, ...(typeof o.vs === "string" ? { vs: str(o.vs, 6) } : {}) };
    }
    case "quote": {
      const text = cut("quote", o.text);
      if (!text) return null;
      return { ...base, text, by: str(o.by, 60), ...(emphasis?.length ? { emphasis } : {}) };
    }
    case "icon": {
      const name = String(o.name ?? "");
      return { ...base, name: (KIT_ICONS as readonly string[]).includes(name) ? name : "spark" };
    }
    case "lowerThird": {
      const name = str(o.name, 40);
      if (!name) return null;
      return { ...base, name, role: str(o.role, 60), ...(o.dur !== undefined ? { dur: Math.max(1, n(o.dur, 3)) } : {}) };
    }
    case "emoji": {
      const char = emojiChar(o.char ?? o.text);
      if (!char) { issues.push(`${where}: emoji item needs one emoji in "char"`); return null; }
      return { ...base, char, ...((SB_EMOJI_MOTIONS as readonly string[]).includes(String(o.motion)) ? { motion: String(o.motion) } : {}), ...(o.size !== undefined ? { size: Math.max(120, Math.min(420, n(o.size, 240))) } : {}) };
    }
    case "sfx": {
      const name = String(o.name ?? "");
      if (!(SB_SFX as readonly string[]).includes(name)) { issues.push(`${where}: unknown sound "${name}" (use one of ${SB_SFX.join(", ")})`); return null; }
      return { ...base, name, gain: Math.max(0.1, Math.min(1.2, n(o.gain, 1))) };
    }
    case "photo": {
      const ref = mediaRef(o);
      if (!ref) { issues.push(`${where}: photo item needs a "query" (English search words) or an "asset" from the owner's library`); return null; }
      return { ...base, ...ref, ...((SB_PHOTO_FRAMES as readonly string[]).includes(String(o.frame)) ? { frame: String(o.frame) } : {}), ...(["s", "m", "l"].includes(String(o.size)) ? { size: String(o.size) } : {}), ...(str(o.caption, 60) ? { caption: str(o.caption, 60) } : {}) };
    }
    case "divider": return base;
  }
  return null;
}

const KEY_RE = /^[\w\-./]{3,300}$/;
/** A picture reference as written: search words, a library asset, and (once resolved) the stored file. */
function mediaRef(o: Record<string, unknown>): SbMediaRef | null {
  const query = str(o.query, 80).replace(/[^\p{L}\p{N} '&,-]/gu, "").trim();
  const asset = Number.isInteger(o.asset) && (o.asset as number) > 0 ? (o.asset as number) : undefined;
  const key = typeof o.key === "string" && KEY_RE.test(o.key) && !o.key.includes("..") ? o.key : undefined;
  if (!query && !asset && !key) return null;
  const out: SbMediaRef = {};
  if (query) out.query = query;
  if (asset) out.asset = asset;
  if (key) out.key = key;
  if (key && typeof o.poster === "string" && KEY_RE.test(o.poster) && !o.poster.includes("..")) out.poster = o.poster;
  if (key && o.start !== undefined) out.start = r2(Math.max(0, n(o.start, 0)));
  if (key && o.dur !== undefined) out.dur = r2(Math.max(0.5, n(o.dur, 10)));
  if (key && str(o.credit, 120)) out.credit = str(o.credit, 120);
  if (typeof o.ref === "string" && /^[a-z]+:[\w-]{1,40}$/.test(o.ref)) out.ref = o.ref;
  if (Number.isInteger(o.pick) && (o.pick as number) > 0) out.pick = Math.min(50, o.pick as number);
  return out;
}

const codes = (v: unknown, max: number) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).map(x => str(x, 40)).filter(Boolean).slice(0, max);

/** A scene backdrop: photo / clip (a picture reference + how it moves) or a map (countries by ISO code or name). */
function cleanMedia(raw: unknown, issues: string[], where: string): SbMedia | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const type = String(o.type ?? (o.focus || o.routes ? "map" : "photo"));
  if (type === "map") {
    const focus = codes(o.focus, 6);
    const highlight = codes(o.highlight, 12);
    const routes = (Array.isArray(o.routes) ? o.routes : []).map(r => (Array.isArray(r) ? r : [(r as { from?: unknown })?.from, (r as { to?: unknown })?.to]).map(x => str(x, 40))).filter(r => r[0] && r[1]).slice(0, 6) as [string, string][];
    const pins = (Array.isArray(o.pins) ? o.pins : []).map(p => (typeof p === "string" ? { at: str(p, 40) } : { at: str((p as { at?: unknown })?.at, 40), ...(str((p as { label?: unknown })?.label, 40) ? { label: str((p as { label?: unknown }).label, 40) } : {}) })).filter(p => p.at).slice(0, 6);
    const world = o.world === true;
    if (!focus.length && !routes.length && !pins.length && !world) { issues.push(`${where}: map needs "focus" (ISO country codes like "MA") or "routes"/"pins", or "world": true`); return undefined; }
    return { type: "map", focus, ...(highlight.length ? { highlight } : {}), ...(routes.length ? { routes } : {}), ...(pins.length ? { pins } : {}), ...(world ? { world } : {}), ...(o.labels === false ? { labels: false } : {}), ...(o.sahara === "separate" ? { sahara: "separate" as const } : {}) };
  }
  if (type !== "photo" && type !== "clip") { issues.push(`${where}: unknown media type "${type}" (use photo, clip or map)`); return undefined; }
  const ref = mediaRef(o);
  if (!ref) { issues.push(`${where}: ${type} backdrop needs a "query" (English search words) or an "asset"`); return undefined; }
  return {
    type,
    ...ref,
    ...((SB_MEDIA_MOTIONS as readonly string[]).includes(String(o.motion)) ? { motion: o.motion as (typeof SB_MEDIA_MOTIONS)[number] } : {}),
    ...(o.dim !== undefined ? { dim: r2(Math.max(0, Math.min(0.85, n(o.dim, 0.45)))) } : {}),
    ...(["top", "center", "bottom"].includes(String(o.position)) ? { position: o.position as "top" | "center" | "bottom" } : {}),
  };
}

export type StoryboardCheck = { storyboard: Storyboard; issues: string[] };

/**
 * Makes a storyboard playable and honest: known theme, scenes back to back from 0 to the end (the end card, if any,
 * takes the last seconds), at most 4 items per scene, texts within limits. `issues` lists what had to change and what
 * is still weak (too many words for the time on screen, monotony) — the director gets them back for a revision.
 */
export function normalizeStoryboard(raw: unknown, durationSec: number, fallbackTheme: KitTheme = "documentary"): StoryboardCheck {
  const issues: string[] = [];
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const theme = (KIT_THEMES as readonly string[]).includes(String(o.theme)) ? (o.theme as KitTheme) : fallbackTheme;
  const D = Math.max(1, durationSec);
  let endSec = 0;
  let end: Storyboard["end"];
  if (o.end && typeof o.end === "object") {
    const e = o.end as Record<string, unknown>;
    const text = str(e.text, LIMITS.title);
    const cta = str(e.cta, LIMITS.cta);
    if (text || cta) {
      endSec = Math.max(1.6, Math.min(4, n(e.seconds, 2.6), D * 0.3));
      end = { text, cta, kicker: str(e.kicker, LIMITS.kicker) || undefined, emphasis: Array.isArray(e.emphasis) ? e.emphasis.map(x => str(x, 40)).filter(Boolean).slice(0, 2) : undefined, seconds: r2(endSec), ...(fxList(e.fx).length ? { fx: fxList(e.fx) } : {}), ...(emojiChar(e.fxEmoji) ? { fxEmoji: emojiChar(e.fxEmoji) } : {}) };
    }
  }
  const bodyEnd = D - endSec;
  const rawScenes = (Array.isArray(o.scenes) ? o.scenes : []).filter(s => s && typeof s === "object") as Record<string, unknown>[];
  if (!rawScenes.length) issues.push("the storyboard has no scenes");
  const sorted = rawScenes.map((s, i) => ({ s, i, from: n(s.from, NaN) })).sort((a, b) => (Number.isFinite(a.from) && Number.isFinite(b.from) ? a.from - b.from : a.i - b.i));
  // Lengths as written, scaled to fill exactly [0, bodyEnd].
  const lens = sorted.map(({ s, from }, k) => {
    const to = n(s.to, NaN);
    const next = sorted[k + 1]?.from;
    const len = Number.isFinite(to) && Number.isFinite(from) ? to - from : Number.isFinite(next) && Number.isFinite(from) ? (next as number) - from : NaN;
    return Number.isFinite(len) && len > 0 ? len : bodyEnd / Math.max(1, sorted.length);
  });
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  if (Math.abs(total - bodyEnd) > 0.6) issues.push(`scene lengths added up to ${r2(total)} s but the body must last ${r2(bodyEnd)} s — they were scaled to fit`);
  let t = 0;
  const scenes: SbScene[] = sorted.map(({ s }, k) => {
    const from = r2(t);
    t = k === sorted.length - 1 ? bodyEnd : t + (lens[k] * bodyEnd) / total;
    const to = r2(t);
    const where = `scene ${k + 1} (${from}–${to} s)`;
    const media = cleanMedia(s.media ?? s.backdrop, issues, where);
    const items = (Array.isArray(s.items) ? s.items : []).map(it => cleanItem(it, issues, where)).filter((x): x is SbItem => Boolean(x));
    if (items.filter(i => i.type === "photo").length > 2) issues.push(`${where}: more than 2 photo cards in one scene — keep one hero picture`);
    const main = items.filter(i => i.type !== "source" && i.type !== "lowerThird" && i.type !== "sfx");
    if (main.length > MAX_ITEMS) issues.push(`${where}: ${main.length} items is crowded — keep at most ${MAX_ITEMS} (one idea per scene)`);
    const kept = [...main.slice(0, MAX_ITEMS), ...items.filter(i => i.type === "source" || i.type === "lowerThird" || i.type === "sfx")];
    if (!kept.length && !media) issues.push(`${where}: empty scene`);
    if (media?.type === "clip" && to - from > 10) issues.push(`${where}: a clip backdrop longer than 10 s gets dull — split the scene or use a photo`);
    const words = kept.reduce((a, it) => a + itemWords(it), 0);
    const need = r2(words * 0.28 + 0.7);
    if (words && to - from < need) issues.push(`${where}: ${words} words need about ${need} s to read but the scene lasts ${r2(to - from)} s — cut words or give it more time`);
    if (to - from < 1.1) issues.push(`${where}: shorter than 1.1 s — merge it with a neighbour`);
    for (const it of kept) if (it.at !== undefined && it.at > to - from - 0.4) issues.push(`${where}: item "${it.type}" starts at ${it.at} s, too late for a ${r2(to - from)} s scene`);
    return {
      from,
      to,
      transition: (SB_TRANSITIONS as readonly string[]).includes(String(s.transition)) ? (s.transition as SbScene["transition"]) : undefined,
      camera: (SB_CAMERAS as readonly string[]).includes(String(s.camera)) ? (s.camera as SbScene["camera"]) : undefined,
      bg: isHex(s.bg) ? String(s.bg) : undefined,
      note: str(s.note, 200) || undefined,
      ...(fxList(s.fx).length ? { fx: fxList(s.fx) } : {}),
      ...(emojiChar(s.fxEmoji) ? { fxEmoji: emojiChar(s.fxEmoji) } : {}),
      ...((SB_PLACES as readonly string[]).includes(String(s.place)) ? { place: s.place as SbScene["place"] } : {}),
      ...(media ? { media } : {}),
      items: kept,
    };
  });
  // Monotony: the same main component three scenes in a row reads like slides.
  const lead = scenes.map(s => s.items.find(i => i.type !== "kicker" && i.type !== "source" && i.type !== "lowerThird" && i.type !== "sfx")?.type ?? "");
  const fxCount = scenes.filter(s => s.fx?.length).length;
  if (scenes.length >= 3 && fxCount > Math.ceil(scenes.length / 2)) issues.push(`${fxCount} of ${scenes.length} scenes have effects — keep effects for the 1–3 moments that deserve them, or they stop meaning anything`);
  const snd = (o.sound && typeof o.sound === "object" ? o.sound : {}) as Record<string, unknown>;
  const sound: SbSound | undefined = Object.keys(snd).length
    ? { ...((SB_MOODS as readonly string[]).includes(String(snd.mood)) ? { mood: snd.mood as SbSound["mood"] } : {}), ...(snd.sfx === false ? { sfx: false } : {}), ...(snd.music === false ? { music: false } : {}) }
    : undefined;
  for (let i = 2; i < lead.length; i++) if (lead[i] && lead[i] === lead[i - 1] && lead[i] === lead[i - 2]) { issues.push(`scenes ${i - 1}–${i + 1} all lead with "${lead[i]}" — vary the visual (stat, kinetic, list, compare, quote, icon…)`); break; }
  const storyboard: Storyboard = {
    title: str(o.title, 120) || undefined,
    theme,
    accent: isHex(o.accent) ? String(o.accent) : undefined,
    accent2: isHex(o.accent2) ? String(o.accent2) : undefined,
    lang: typeof o.lang === "string" && /^[a-z]{2}$/i.test(o.lang) ? o.lang.toLowerCase() : undefined,
    progress: o.progress === true ? true : undefined,
    scenes,
    end,
    ...(sound && Object.keys(sound).length ? { sound } : {}),
    ...((SB_GRADES as readonly string[]).includes(String(o.grade)) && o.grade !== "theme" ? { grade: o.grade as Storyboard["grade"] } : {}),
    ...(brandOf(o.brand) ? { brand: brandOf(o.brand) } : {}),
  };
  const pictures = scenes.filter(s => s.media && s.media.type !== "map").length + scenes.reduce((a, s) => a + s.items.filter(i => i.type === "photo").length, 0);
  if (scenes.length >= 4 && pictures > Math.ceil(scenes.length * 0.75)) issues.push(`${pictures} pictures in ${scenes.length} scenes — keep pictures for the scenes they explain; typography and data scenes carry the rest`);
  return { storyboard, issues };
}

function brandOf(v: unknown): Storyboard["brand"] | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const logo = typeof o.logo === "string" && KEY_RE.test(o.logo) && !o.logo.includes("..") ? o.logo : undefined;
  const asset = Number.isInteger(o.asset) && (o.asset as number) > 0 ? (o.asset as number) : undefined;
  if (!logo && !asset) return undefined;
  return { ...(logo ? { logo } : {}), ...(asset ? { asset } : {}), ...(o.watermark === true ? { watermark: true } : {}) };
}

/** Every picture slot of a storyboard (scene backdrops and photo cards), in order. */
export type MediaSlot = { scene: number; item: number | null; kind: "photo" | "clip"; ref: SbMediaRef };
export function mediaSlots(sb: Storyboard): MediaSlot[] {
  const out: MediaSlot[] = [];
  sb.scenes.forEach((s, i) => {
    if (s.media && s.media.type !== "map") out.push({ scene: i, item: null, kind: s.media.type, ref: s.media });
    s.items.forEach((it, j) => { if (it.type === "photo") out.push({ scene: i, item: j, kind: "photo", ref: it as unknown as SbMediaRef }); });
  });
  return out;
}

/* ------------------------------------------------------------ compile */

/** A storyboard as a self-contained page for the recorder (the kit is inlined at render time). */
/**
 * `geo`: map geometry per scene (computed by the studio), carried inside the page. `media`: pictures inlined for the
 * in-browser preview (the recorder fetches them itself).
 */
export function compileStoryboard(sb: Storyboard, opts: { width: number; height: number; durationSec: number; geo?: Record<string, unknown>; media?: Record<string, string> }) {
  const lang = sb.lang ?? (/[؀-ۿ]/.test(JSON.stringify(sb.scenes)) ? "ar" : "en");
  const dir = /^(ar|fa|ur|he)$/.test(lang) ? "rtl" : "ltr";
  const safe = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const json = safe({ ...sb, lang, ...(opts.geo && Object.keys(opts.geo).length ? { __geo: opts.geo } : {}) });
  const table = opts.media && Object.keys(opts.media).length ? `<script>window.__cvMedia=${safe(opts.media)};</script>\n` : "";
  const title = (sb.title ?? "").replace(/[<>&]/g, "");
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${title}</title>
${table}${KIT_PLACEHOLDER}
</head>
<body>
<script type="application/json" id="cv-storyboard">${json}</script>
<script>CV.play(JSON.parse(document.getElementById("cv-storyboard").textContent), { width: ${opts.width}, height: ${opts.height}, duration: ${opts.durationSec} });</script>
</body>
</html>`;
}

/** The storyboard inside a compiled page, if it is one. */
export function storyboardFromHtml(html: string): Storyboard | null {
  const m = /<script type="application\/json" id="cv-storyboard">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    const sb = JSON.parse(m[1]) as Storyboard & { __geo?: unknown };
    delete sb.__geo;
    return sb;
  } catch { return null; }
}

/* ------------------------------------------------------------ the format, for writers */

/** The storyboard format — given to our director and copied into any other AI. */
export function storyboardDoc(width: number, height: number, seconds: number, media: { stock?: boolean; library?: boolean } = { stock: true }) {
  const vertical = height > width;
  const pics = media.stock || media.library;
  const src = media.stock ? `"query":"oil refinery at night"` : `"asset":12`;
  const backdrop = `SCENE BACKDROP (optional, "media" on a scene — fills the frame behind the items${pics ? ", graded to the video's look, with a slow camera move" : ""}):
${pics ? `- {"type":"photo",${src},"motion":"in|out|left|right|up|down"}   ${media.stock ? "a free photo (Pexels/Pixabay) — query in ENGLISH, 2–5 concrete visual words" : "a picture from the owner's library (by its number)"}${media.library && media.stock ? `, or "asset": n for a picture of the owner's library` : ""}
- {"type":"clip",${media.stock ? `"query":"city traffic timelapse"` : `"asset":7`}}   a short video clip as a moving backdrop (at most one every ~15 s, scenes ≤ 8 s)
` : ""}- {"type":"map","focus":["MA"],"highlight":["DZ","TN"],"routes":[["MA","ES"]],"pins":[{"at":"EG","label":"..."}]}   an animated map: zooms onto the focus countries (ISO codes), fills the highlighted ones, draws routes and pins. {"type":"map","world":true} for the whole world.
${pics ? `  Optional: "dim": 0–0.85 (how much the picture is darkened under text, default ≈0.45).
  Pictures are illustrations, never evidence: do not use a stock photo as a named real person or a specific real event.
"grade" (top level, optional): "theme|mono|warm|cool|vivid|none" — one colour treatment for every picture (default: the theme's).` : "  Photos and clips are switched off for this video: no photo items, no photo/clip backdrops."}`;
  return `OUTPUT FORMAT — a storyboard JSON that a tested motion kit plays as the finished ${width}x${height} video (${seconds} s). No HTML, no code.
{
  "title": "short title",
  "theme": "documentary" | "kinetic" | "neon" | "infographic" | "storybook",
  "accent": "#hex (optional brand colour)",
  "lang": "ar" | "en" | "fr" | ...,
  "progress": true | false,            // thin progress bar on top (good for reels)
  "scenes": [
    { "from": 0, "to": 3.2, "transition": "rise|fade|mask|zoom|slide|flash|cut|iris|stripes|whip|glitch", "camera": "push|pull|drift|none", "note": "why this scene exists",
      "items": [ ...1 to 4 items, stacked and centred... ] }
  ],
  "end": { "kicker": "...", "text": "final line", "cta": "short call to action", "seconds": 2.6, "fx": ["confetti"] },   // optional closing card (takes the last seconds)
  "sound": { "mood": "tense|upbeat|tech|calm|playful|epic" }   // music bed that suits the topic; sound effects follow the motion automatically
}
SCENE EXTRAS (optional, on a scene): "fx": up to 2 of ["confetti","sparkles","shake","rings","lightleak","letterbox","dust","glitch"], "fxEmoji": "💸" (confetti made of that emoji),
  "place": "center|top|bottom" (where the scene's text sits — put it at "top" or "bottom" over a map or a busy picture).
${backdrop}
ITEMS (every item may have "at": seconds from the scene start; omit it and items follow one another):
- {"type":"kicker","text":"small label above a title"}                  max 40 chars
- {"type":"title","text":"...","emphasis":["word or phrase"],"size":"xl|l|m"}   max 70 chars, emphasis = 1–2 key words that get the accent
- {"type":"text","text":"supporting line","emphasis":[]}                 max 150 chars
- {"type":"kinetic","lines":["short","punchy","lines"],"emphasis":[]}    2–4 lines of ≤ 32 chars, they slam in one by one
- {"type":"stat","value":42,"prefix":"$","suffix":"%","decimals":0,"label":"what the number means"}   counts up
- {"type":"bars","items":[{"label":"...","value":60}],"unit":"%"}       2–5 bars
- {"type":"list","items":["step one","step two"],"numbered":true}       2–5 short items
- {"type":"timeline","events":[{"date":"1971","text":"what happened"}]}   2–5 events
- {"type":"compare","left":{"title":"...","items":["..."]},"right":{"title":"...","items":["..."]}}
- {"type":"quote","text":"...","by":"who said it"}
- {"type":"icon","name":"${KIT_ICONS.join("|")}"}
- {"type":"emoji","char":"🔥","motion":"float|bounce|spin|pulse|wiggle","size":240}   a glossy 3D emoji that pops in and keeps moving${pics ? `\n- {"type":"photo",${media.stock ? `"query":"vintage oil barrels"` : `"asset":12`},"frame":"card|polaroid|circle|wide","size":"s|m|l","caption":"short caption"}   a framed picture inside the scene` : ""}
- {"type":"sfx","name":"impact|hit|ding|chime|riser|whoosh|pop|sparkle|…","at":1.2}   an extra sound at a precise moment (most sounds are automatic)
- {"type":"cta","text":"short button-like call"} · {"type":"divider"} · {"type":"source","text":"source credit"} · {"type":"lowerThird","name":"...","role":"..."}
TIMING RULES:
- Scenes are back to back from 0 to ${seconds} s (or to the end card's start). No gaps, no overlaps.
- Reading time: a scene needs about 0.28 s per visible word + 0.7 s. If it does not fit, cut words — never cram.
- ${vertical ? "Vertical reel" : "Horizontal"}: one idea per scene, at most 4 items, the main item is the hero.
Return ONLY the JSON object.`;
}
