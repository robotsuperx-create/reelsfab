/**
 * Storyboards: what the director writes before any code — scenes on a timeline, each with a few kit components.
 * The kit plays a storyboard directly (CV.play), so a storyboard IS a finished video: no animation code to get wrong.
 * Any AI can write one (it is short JSON), and the room accepts it pasted in place of HTML.
 */
import { KIT_ICONS, KIT_PLACEHOLDER, KIT_THEMES, type KitTheme } from "./kit";

export const SB_ITEM_TYPES = ["kicker", "title", "text", "kinetic", "stat", "bars", "list", "timeline", "compare", "quote", "icon", "divider", "source", "lowerThird", "cta"] as const;
export type SbItemType = (typeof SB_ITEM_TYPES)[number];
export const SB_TRANSITIONS = ["rise", "fade", "mask", "zoom", "slide", "flash", "cut"] as const;
export const SB_CAMERAS = ["push", "pull", "drift", "none"] as const;

export type SbItem = { type: SbItemType; at?: number } & Record<string, unknown>;
export type SbScene = { from: number; to: number; transition?: (typeof SB_TRANSITIONS)[number]; camera?: (typeof SB_CAMERAS)[number]; bg?: string; note?: string; items: SbItem[] };
export type Storyboard = {
  title?: string;
  theme: KitTheme;
  accent?: string;
  accent2?: string;
  lang?: string;
  progress?: boolean;
  scenes: SbScene[];
  end?: { text?: string; cta?: string; kicker?: string; emphasis?: string[]; seconds?: number };
};

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
    case "source": case "lowerThird": case "icon": case "divider": return 0;
    default: return s("text");
  }
}

function cleanItem(raw: unknown, issues: string[], where: string): SbItem | null {
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
    case "divider": return base;
  }
  return null;
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
      end = { text, cta, kicker: str(e.kicker, LIMITS.kicker) || undefined, emphasis: Array.isArray(e.emphasis) ? e.emphasis.map(x => str(x, 40)).filter(Boolean).slice(0, 2) : undefined, seconds: r2(endSec) };
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
    const items = (Array.isArray(s.items) ? s.items : []).map(it => cleanItem(it, issues, where)).filter((x): x is SbItem => Boolean(x));
    const main = items.filter(i => i.type !== "source" && i.type !== "lowerThird");
    if (main.length > MAX_ITEMS) issues.push(`${where}: ${main.length} items is crowded — keep at most ${MAX_ITEMS} (one idea per scene)`);
    const kept = [...main.slice(0, MAX_ITEMS), ...items.filter(i => i.type === "source" || i.type === "lowerThird")];
    if (!kept.length) issues.push(`${where}: empty scene`);
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
      items: kept,
    };
  });
  // Monotony: the same main component three scenes in a row reads like slides.
  const lead = scenes.map(s => s.items.find(i => i.type !== "kicker" && i.type !== "source" && i.type !== "lowerThird")?.type ?? "");
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
  };
  return { storyboard, issues };
}

/* ------------------------------------------------------------ compile */

/** A storyboard as a self-contained page for the recorder (the kit is inlined at render time). */
export function compileStoryboard(sb: Storyboard, opts: { width: number; height: number; durationSec: number }) {
  const lang = sb.lang ?? (/[؀-ۿ]/.test(JSON.stringify(sb.scenes)) ? "ar" : "en");
  const dir = /^(ar|fa|ur|he)$/.test(lang) ? "rtl" : "ltr";
  const json = JSON.stringify({ ...sb, lang }).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const title = (sb.title ?? "").replace(/[<>&]/g, "");
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${title}</title>
${KIT_PLACEHOLDER}
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
  try { return JSON.parse(m[1]) as Storyboard; } catch { return null; }
}

/* ------------------------------------------------------------ the format, for writers */

/** The storyboard format — given to our director and copied into any other AI. */
export function storyboardDoc(width: number, height: number, seconds: number) {
  const vertical = height > width;
  return `OUTPUT FORMAT — a storyboard JSON that a tested motion kit plays as the finished ${width}x${height} video (${seconds} s). No HTML, no code.
{
  "title": "short title",
  "theme": "documentary" | "kinetic" | "neon" | "infographic" | "storybook",
  "accent": "#hex (optional brand colour)",
  "lang": "ar" | "en" | "fr" | ...,
  "progress": true | false,            // thin progress bar on top (good for reels)
  "scenes": [
    { "from": 0, "to": 3.2, "transition": "rise|fade|mask|zoom|slide|flash|cut", "camera": "push|pull|drift|none", "note": "why this scene exists",
      "items": [ ...1 to 4 items, stacked and centred... ] }
  ],
  "end": { "kicker": "...", "text": "final line", "cta": "short call to action", "seconds": 2.6 }   // optional closing card (takes the last seconds)
}
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
- {"type":"cta","text":"short button-like call"} · {"type":"divider"} · {"type":"source","text":"source credit"} · {"type":"lowerThird","name":"...","role":"..."}
TIMING RULES:
- Scenes are back to back from 0 to ${seconds} s (or to the end card's start). No gaps, no overlaps.
- Reading time: a scene needs about 0.28 s per visible word + 0.7 s. If it does not fit, cut words — never cram.
- ${vertical ? "Vertical reel" : "Horizontal"}: one idea per scene, at most 4 items, the main item is the hero.
Return ONLY the JSON object.`;
}
