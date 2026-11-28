/**
 * The knowledge pack ("skills") the director and the writers read: motion direction, pacing per kind of video,
 * hooks, copy, composition and theme choice — distilled for this recorder and for Arabic. A router picks only the
 * modules a given video needs, so prompts stay short and specific.
 */
import type { KitTheme } from "./kit";

export const VIDEO_KINDS = [
  { id: "reel", label: "ريل سريع", hint: "15–30 ث، خطّاف قوي، إيقاع سريع" },
  { id: "explainer", label: "شرح مبسّط", hint: "فكرة واحدة تُفكَّك خطوة بخطوة" },
  { id: "documentary", label: "وثائقي / سياسة", hint: "أحداث، تواريخ، أرقام، نبرة جادة" },
  { id: "data", label: "قصة أرقام", hint: "إحصاءات ومقارنات ورسوم" },
  { id: "promo", label: "إعلان منتج", hint: "مشكلة ← حل ← فائدة ← دعوة للشراء" },
  { id: "quote", label: "اقتباس / تحفيز", hint: "جملة قوية واحدة أو اثنتان" },
] as const;
export type VideoKind = (typeof VIDEO_KINDS)[number]["id"];
export const VIDEO_KIND_IDS = VIDEO_KINDS.map(k => k.id) as unknown as readonly [VideoKind, ...VideoKind[]];

/** A kind from the idea's words and the length, when the owner did not choose one. */
export function guessKind(idea: string, durationSec: number): VideoKind {
  const s = idea.toLowerCase();
  if (/اقتباس|حكمة|تحفيز|quote|motivat/.test(s)) return "quote";
  if (/منتج|متجر|اشتر|عرض|خصم|سعر|product|buy|shop|offer|sale|promo/.test(s)) return "promo";
  if (/تاريخ|حرب|سياس|دولة|دول|رئيس|انتخاب|نفط|استعمار|ثورة|history|war|politic|election|empire/.test(s)) return "documentary";
  if (/أرقام|إحصاء|نسبة|بالمئة|٪|%|مليار|مليون|ترتيب|مقارنة|statistic|data|percent|billion|ranking/.test(s)) return "data";
  if (durationSec <= 35) return "reel";
  return "explainer";
}

/** Theme that suits a kind when the owner left the look to the agent. */
export function themeForKind(kind: VideoKind): KitTheme {
  return ({ reel: "kinetic", explainer: "infographic", documentary: "documentary", data: "infographic", promo: "kinetic", quote: "documentary" } as const)[kind];
}

/** The music mood each look implies when nothing else chose one (same as the kit's defaults). */
export const THEME_MOOD: Record<KitTheme, "tense" | "upbeat" | "tech" | "calm" | "playful"> = { documentary: "tense", kinetic: "upbeat", neon: "tech", infographic: "calm", storybook: "playful" };

/** Style recipe ids of the room (shared/code-video STYLE_RECIPES) → kit theme of the same look. */
export const STYLE_TO_THEME: Record<string, KitTheme> = { documentary: "documentary", kinetic: "kinetic", neon: "neon", infographic: "infographic", storybook: "storybook" };

const DIRECTION = `MOTION DIRECTION (how a senior motion designer thinks):
- Every scene has ONE job (hook, fact, contrast, reveal, proof, payoff). Write that job in "note" before choosing items.
- The eye needs one hero per scene: the biggest, first-moving element carries the message; the rest supports it.
- AIRY SCREENS: one idea per screen, at most ~12 words visible at once (a kicker + a short title, or a number + a short label). Never stack title + long text + source. When a point needs more words, make TWO short scenes (statement → proof) instead of one crowded one — more scenes, fewer words, more motion.
- Rhythm = variety with intent. Alternate dense and airy scenes; short punchy scenes after a long one; never three scenes in a row led by the same component.
- Transitions carry meaning: "mask"/"slide" = next point in a list or story, "zoom" = going deeper / a reveal, "flash" = shock or a hard number, "fade" = calm change of subject, "cut" = on a beat in fast reels, "iris" = focus on one thing, "stripes" = new chapter (bold, branded), "whip" = fast jump to a contrast, "glitch" = tech / something broken or hidden. Do not use the same transition everywhere.
- Camera: "push" for statements that build tension, "pull" for reveals and conclusions, "drift" for lists and calm passages, "none" when the scene is busy.
- Emphasis: 1–2 words per scene at most — the word a listener would stress. Emphasising everything emphasises nothing.
- Hold the payoff: the most important scene gets the most time; the end must be a composed frame, not a fade to nothing.`;

const FX_SOUND = `EFFECTS, EMOJI AND SOUND (they make it feel alive — use them with intent, not everywhere):
- Scene "fx" at most on 1–3 key scenes: "shake" on a shocking number or claim, "confetti" (or "fxEmoji": "💸" money rain, "🎉"…) only on a payoff or celebration, "sparkles" on something positive/magical, "rings" behind a single hero (icon, stat, emoji), "lightleak" + "dust" + "letterbox" for cinematic, emotional or documentary moments, "glitch" for tech, hacking, fake news, errors.
- Emoji: a glossy 3D emoji is a strong hero for reels, promos, kids and casual topics (one per scene, with a motion that fits: "bounce" for energy, "float" for calm, "pulse" for warning/love, "spin" for money/time, "wiggle" for fun). In serious documentary scenes prefer the line icons.
- Sound is automatic: every transition, slammed line, counting number, list item, pop and end card gets its own effect, timed to the frame. Choose the music mood in "sound": "tense" (politics, economy, investigations, history), "upbeat" (motivation, promos, lifestyle reels), "tech" (AI, crypto, gadgets), "calm" (explainers, education, data), "playful" (kids, food, funny), "epic" (big stakes, wars, empires, sport). Add an "sfx" item only for an extra accent the motion does not already sound (e.g. "impact" on a reveal, "chime" on good news).`;

const COPY_AR = `ON-SCREEN COPY:
- Screen text is not narration: short, concrete, spoken-style lines. A title is at most ~7 words; a text line at most ~18.
- Same language and register as the idea (Arabic stays Arabic; keep one register — MSA or the dialect the owner used — throughout).
- Arabic: never split words into letters, never letter-spacing; numbers may stay Western digits (default) unless the owner asks for Arabic-Indic ("digits":"arab").
- Facts: no invented numbers, percentages, prices, dates or quotes. Use only what the idea gives; otherwise speak qualitatively ("prices keep climbing").
- Each scene adds new information; no repeated sentences between scenes.`;

const HOOKS = `HOOK (first 1.5–2.5 s decide if people stay):
- Open on tension, not a logo or greeting: a sharp question, a bold claim, a surprising number, a contrast ("they earn more, you pay more"), or a direct "stop doing X".
- The hook scene is short (1.8–3 s), uses a big title or kinetic lines, and a "flash", "zoom" or "rise" entrance.
- The hook promises something the end delivers.`;

const COMPONENTS_FIT = `WHICH COMPONENT FOR WHICH IDEA:
- A number → stat (counts up, label says what it means). Several numbers → bars. Two sides → compare. Steps or reasons → list. Dates/history → timeline.
- A punchline or slogan → kinetic (2–4 short lines). A quotation → quote with "by". An abstract concept → icon + title.
- Credits for facts → source (small, bottom). A person speaking → lowerThird.
- kicker + title is the standard opener of a section; do not put a kicker on every scene.`;

const PACING: Record<VideoKind, string> = {
  reel: `PACING — reel: 4–7 scenes per 15 s (1.8–3.5 s each), hook ≤ 2.5 s, end card 2–2.6 s with a CTA (follow / save / comment). Kinetic lines and big titles; few words per scene; progress bar on.`,
  explainer: `PACING — explainer: problem → why it matters → how it works (2–4 steps) → takeaway. Scenes 3–6 s; one concept per scene; use list/compare/icon to make the idea visible; end on the takeaway.`,
  documentary: `PACING — documentary: cold open on the most striking fact, then context (timeline), the turning point, consequences (stat/bars), and a closing line that reframes it. Scenes 3.5–7 s; serious tone; sources on factual scenes.`,
  data: `PACING — data story: one number per scene, built up from small to big; give every number a human comparison in the label; bars for rankings, compare for before/after; end on what the numbers mean.`,
  promo: `PACING — product promo: pain (1 scene) → product as the answer (title + icon) → 2–3 benefits (list or kinetic) → proof (stat or quote) → offer + CTA end card. Energetic transitions, brand accent colour.`,
  quote: `PACING — quote: 1–2 scenes for the quote itself (quote component, generous time), an optional context line, and a quiet end card. Slow camera, fade/zoom transitions only.`,
};

const THEMES_DOC = `THEMES (pick the one that fits unless the owner chose):
- documentary: near-black, red + gold accents, serious — politics, economy, history, investigations.
- kinetic: bold colour fields changing per scene, huge punchy words — social hooks, motivation, promos.
- neon: navy with cyan/magenta glow — tech, AI, crypto, futuristic topics.
- infographic: off-white paper, blue + orange — clear explainers, data, education.
- storybook: warm sky, rounded friendly shapes — kids, stories, gentle topics.`;

/** The modules a director needs for one video. */
/** Pictures, clips and maps: when they lift a video and when they only decorate it. */
function mediaGuide(kind: VideoKind, m: { stock?: boolean; library?: boolean; libraryText?: string }) {
  const pics = m.stock || m.library;
  const lines = [`PICTURES, CLIPS AND MAPS (scene "media" backdrops and "photo" items):
- MAPS whenever a country, a region, a border, a trade route or a "from X to Y" is named: zoom onto the focus country, highlight the others involved, draw the routes, pin the cities/places. Put the scene's text at "place":"top" or "bottom" so the map shows. One map scene can carry a whole geopolitical point.`];
  if (pics) {
    lines.push(`- PHOTOS make abstract topics concrete: a real place, an object, a crowd, nature, an industry (${kind === "data" || kind === "quote" ? "this kind of video lives on typography and data: use 1–2 pictures at most, for the hook or the payoff" : "use them on the scenes that SHOW something — usually 30–60% of scenes, never all"}).
- A picture is a BACKDROP: keep 1–2 short items over it (kicker + title, or a stat). Lists, bars, timelines and comparisons read best without one.
- CLIPS (moving backdrops) are the strongest hook: one in the first scene is often worth it; then at most one every ~15 s, on scenes of 3–8 s.
- Alternate picture scenes with typography/data scenes: picture → stat → picture → kinetic. Vary "motion" (in, out, left, right, up).
- "photo" items (framed card/polaroid/circle) suit people-free objects, products and "before/after" pairs inside an explainer.`);
    if (m.stock) lines.push(`- NAMED THINGS GET THEIR REAL PICTURE: when the script names a real person (a president, a CEO, a player), show a "person" item with the EXACT English Wikipedia title in "wiki" the first time they appear. A named landmark, city, company, product, ship or event gets {"type":"photo","wiki":"<English Wikipedia title>"} — never a stock search, which returns lookalikes. Countries get "flags" (two rivals: "vs": true) or a map.`);
    if (m.stock) lines.push(`- Search words: ENGLISH, 2–5 concrete visual nouns + one mood/light word ("oil tanker ocean sunset", "empty supermarket shelves", "Marrakech medina alley"). No abstract words ("inflation", "success"), no text, no logos, no brand names, no named people.
- Stock pictures are illustrations: never present one as a specific named person or a specific real event (no "this is the president", no "the 2008 crash" photo). For named people use a lowerThird or a quote, not a stranger's face.`);
    if (m.library) lines.push(`- THE OWNER'S LIBRARY (prefer these when they fit — they are the owner's own pictures): use "asset": n.
${m.libraryText?.trim() || "(the library is empty)"}`);
  } else lines.push("- Free photos and clips are OFF for this video: do not use photo items, person portraits or photo/clip backdrops (maps and flags are fine).");
  return lines.join("\n");
}

export function knowledgeFor(kind: VideoKind, opts: { chosenTheme?: KitTheme | null; vertical: boolean; media?: { stock?: boolean; library?: boolean; libraryText?: string } }) {
  return [DIRECTION, HOOKS, PACING[kind], COMPONENTS_FIT, mediaGuide(kind, opts.media ?? {}), FX_SOUND, COPY_AR, opts.chosenTheme ? `THEME: "${opts.chosenTheme}" (chosen by the owner — keep it).` : THEMES_DOC, opts.vertical ? "FORMAT: vertical 9:16 for phones — the kit keeps texts inside the safe area; keep lines short." : "FORMAT: horizontal 16:9 — wider lines are fine, keep the same discipline."].join("\n\n");
}

/** What the critic scores (0–10 each). */
export const CRITIC_RUBRIC = [
  { id: "legibility", label: "وضوح النص", en: "Text is readable on a phone at a glance: size, contrast, nothing cut off, Arabic letters joined, nothing overlapping." },
  { id: "hierarchy", label: "الترتيب البصري", en: "Each frame has one clear hero element; supporting items are visibly secondary; emphasis is on the right 1–2 words." },
  { id: "composition", label: "التكوين", en: "Uses the frame well: balanced, centred in the safe area, not cramped, not a tiny cluster in a big empty frame." },
  { id: "story", label: "القصة والإيقاع", en: "Hook is strong, scenes add information in a logical order, variety between scenes, ends on a composed payoff." },
  { id: "polish", label: "الاحتراف", en: "Looks like a professional motion-design piece, not a template or a slideshow; consistent style; pictures and maps (if any) fit what the scene says and blend with the look instead of looking pasted on; nothing broken." },
] as const;
export type CriticScores = Record<(typeof CRITIC_RUBRIC)[number]["id"], number>;
