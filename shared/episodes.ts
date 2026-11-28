/**
 * Long-form pillar ("الفيديو الكامل"): channels and episodes. An episode script is a list of scenes —
 * narration + on-screen title + search keywords + chapter — that the server narrates (Kokoro / Gemini TTS),
 * illustrates (free stock, reviewed by a human) and renders with ffmpeg at 1920×1080.
 */
import { z } from "zod";

export const EPISODE_LANGUAGES = ["ar", "en"] as const;
export type EpisodeLanguage = (typeof EPISODE_LANGUAGES)[number];

export const VISUAL_STYLES = ["stock", "stills", "maps", "illustration"] as const;
export const VISUAL_STYLE_LABELS: Record<(typeof VISUAL_STYLES)[number], string> = {
  stock: "لقطات فيديو",
  stills: "صور ثابتة بحركة",
  maps: "خرائط وأرشيف",
  illustration: "رسوم توضيحية",
};

/**
 * How an episode's scenes are shown: real footage only (stock / library / AI pictures), the motion kit for every
 * scene, or a mix where the director animates the scenes that gain from it (a map for a place, a moving number for
 * a figure, rivals face to face…) and keeps footage for the rest. The voice, subtitles and chapters stay the same.
 */
export const VISUAL_MODES = ["footage", "animation", "mixed"] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];
export const VISUAL_MODE_LABELS: Record<VisualMode, string> = {
  footage: "لقطات حقيقية فقط",
  animation: "أنيميشن لكل المشاهد",
  mixed: "مزيج — المخرج يختار لكل مشهد",
};
export const VISUAL_MODE_HINTS: Record<VisualMode, string> = {
  footage: "فيديوهات وصور مجانية أو من مكتبتك لكل مشهد",
  animation: "كل مشهد يتحرك: خرائط، أرقام، أعلام، صور الأشخاص، عناوين — فوق صور مجانية",
  mixed: "خريطة عند ذكر بلد، رقم متحرك عند ذكر رقم، وجه لوجه عند المقارنة، ولقطة حقيقية في الباقي",
};
/** Looks of the motion kit (same ids as the code room). */
export const MOTION_THEMES = ["documentary", "kinetic", "neon", "infographic", "storybook"] as const;
export type MotionTheme = (typeof MOTION_THEMES)[number];
export const MOTION_THEME_LABELS: Record<MotionTheme, string> = {
  documentary: "وثائقي داكن",
  kinetic: "حركي جريء",
  neon: "تقني نيون",
  infographic: "إنفوغرافيك فاتح",
  storybook: "قصصي دافئ",
};
/** Room kept clear at the bottom of an animated scene for the burned-in subtitles (px at 1080p). */
export const MOTION_SUBTITLE_RESERVE = 150;

export const TTS_PROVIDERS = ["kokoro", "gemini", "speech", "none"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];
export const TTS_PROVIDER_LABELS: Record<TtsProvider, string> = {
  kokoro: "Kokoro — محلي مجاني (إنجليزي فقط)",
  speech: "OpenAI TTS أو خادم صوت متوافق (صوتك المستنسخ)",
  gemini: "Gemini TTS — الخطة المجانية",
  none: "بلا صوت — النص كاملًا على الشاشة (مجاني)",
};

/**
 * Silent episodes: each scene stays on screen long enough to read its text (Arabic ≈ 2.2 words/s, Latin ≈ 2.8),
 * with a short pause to breathe. Used instead of a narration length when the channel has no voice.
 */
export function readingSeconds(text: string) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const rate = /[\u0600-\u06FF]/.test(text) ? 2.2 : 2.8;
  return Math.max(3.5, Math.min(90, words / rate + 0.8));
}

/** OpenAI built-in voices (gpt-4o-mini-tts); a self-hosted clone server uses whatever voice names it registers. */
export const OPENAI_VOICES = [
  { id: "onyx", label: "Onyx — ذكر، عميق وثائقي" },
  { id: "ash", label: "Ash — ذكر، واضح" },
  { id: "echo", label: "Echo — ذكر، هادئ" },
  { id: "alloy", label: "Alloy — محايد" },
  { id: "sage", label: "Sage — أنثى، هادئة" },
  { id: "nova", label: "Nova — أنثى، دافئة" },
  { id: "shimmer", label: "Shimmer — أنثى، مشرقة" },
  { id: "coral", label: "Coral — أنثى، حيوية" },
  { id: "fable", label: "Fable — راوٍ" },
] as const;

/** Gemini prebuilt voices usable for Arabic narration (free tier). */
export const GEMINI_VOICES = [
  { id: "Kore", label: "Kore — أنثى، هادئة واثقة" },
  { id: "Charon", label: "Charon — ذكر، عميق وثائقي" },
  { id: "Puck", label: "Puck — ذكر، حيوي" },
  { id: "Fenrir", label: "Fenrir — ذكر، قوي" },
  { id: "Aoede", label: "Aoede — أنثى، دافئة" },
  { id: "Leda", label: "Leda — أنثى، شابة" },
  { id: "Orus", label: "Orus — ذكر، رسمي" },
  { id: "Zephyr", label: "Zephyr — أنثى، مشرقة" },
] as const;

export const EPISODE_STATUSES = ["planned", "script_ready", "needs_review", "rendering", "rendered", "failed", "published"] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];
export const EPISODE_STATUS_LABELS: Record<EpisodeStatus, string> = {
  planned: "مخطط",
  script_ready: "السكربت جاهز",
  needs_review: "يحتاج مراجعة",
  rendering: "جارٍ الرندر",
  rendered: "مُصدَّر",
  failed: "فشل",
  published: "منشور",
};

export const MAX_SCENES = 60;
export const MAX_EPISODE_MINUTES = 25;
/** Pause between narrated scenes (seconds). */
export const SCENE_GAP = 0.35;
export const EPISODE_INTRO_SECONDS = 3;
export const EPISODE_OUTRO_SECONDS = 5;

const sceneVisual = z.object({
  kind: z.enum(["video", "image"]),
  /** App media URL (/api/media/<key>) — always a library asset, never a remote URL. */
  src: z.string().min(1).max(1024),
  assetId: z.number().int().optional(),
  credit: z.string().max(200).optional(),
  /** Trim start for clips (seconds). */
  in: z.number().min(0).max(3600).optional(),
  motion: z.enum(["slow_push", "slow_pull", "pan_left", "step_zoom"]).optional(),
  /** Picked by the auto planner (true) or chosen by the editor (false). */
  auto: z.boolean().optional(),
  /** A clip drawn by the motion kit from the scene's `anim` beats. */
  anim: z.boolean().optional(),
});

/**
 * The director's animation for one scene: 1–3 beats (motion-kit storyboard scenes, timed relative to the scene and
 * scaled to its narration), the hash of the clip currently drawn from them, and the footage it replaced.
 */
const sceneAnim = z.object({
  beats: z.array(z.record(z.string(), z.unknown())).min(1).max(4),
  hash: z.string().max(16).optional(),
  prev: sceneVisual.optional(),
  error: z.string().max(300).optional(),
});

export const sceneSchema = z.object({
  id: z.string().min(1).max(40),
  narration: z.string().min(1).max(2000),
  title: z.string().max(120).optional(),
  keywords: z.array(z.string().max(60)).max(8),
  /** English description of one picture for the scene (AI image generation). */
  imagePrompt: z.string().max(600).optional(),
  chapter: z.string().max(80).optional(),
  visual: sceneVisual.optional(),
  /** Narration length once synthesized (seconds). */
  durationSec: z.number().min(0).max(600).optional(),
  /** Storage key of the cached narration clip and the text/voice hash it was made from. */
  narrationKey: z.string().max(512).optional(),
  narrationHash: z.string().max(16).optional(),
  anim: sceneAnim.optional(),
  /** The director (mixed mode) or the owner kept this scene on real footage: not planned again unless asked. */
  footage: z.boolean().optional(),
});

export const episodeScriptSchema = z.object({
  title: z.string().min(1).max(160),
  hook: z.string().max(400),
  scenes: z.array(sceneSchema).min(1).max(MAX_SCENES),
  outro: z.string().max(400),
  description: z.string().max(4000),
  tags: z.array(z.string().max(40)).max(20),
  /** This episode's look (else the channel's default) and the motion kit's theme for animated scenes. */
  visualMode: z.enum(VISUAL_MODES).optional(),
  motionTheme: z.enum(MOTION_THEMES).optional(),
});

export type Scene = z.infer<typeof sceneSchema>;
export type SceneVisual = z.infer<typeof sceneVisual>;
export type SceneAnim = z.infer<typeof sceneAnim>;
export type EpisodeScript = z.infer<typeof episodeScriptSchema>;

export const episodeTemplateSchema = z.object({
  minutes: z.number().min(2).max(MAX_EPISODE_MINUTES),
  /** Section names in order; the LLM fills them with scenes and marks chapters. */
  structure: z.array(z.string().max(60)).min(2).max(8),
  hookSeconds: z.number().min(5).max(40),
  cta: z.string().max(200),
  /** Channel defaults for new episodes: footage / animation / mixed, and the motion look. */
  visualMode: z.enum(VISUAL_MODES).optional(),
  motionTheme: z.enum(MOTION_THEMES).optional(),
});
export type EpisodeTemplate = z.infer<typeof episodeTemplateSchema>;

export const channelUpdateSchema = z.object({
  name: z.string().min(1).max(120),
  niche: z.string().min(1).max(200),
  description: z.string().max(2000),
  language: z.enum(EPISODE_LANGUAGES),
  ttsProvider: z.enum(TTS_PROVIDERS),
  voice: z.string().min(1).max(60),
  ttsSpeed: z.number().int().min(70).max(130),
  visualStyle: z.enum(VISUAL_STYLES),
  episodeTemplate: episodeTemplateSchema,
  guidelines: z.string().max(4000),
  topicsBank: z.array(z.string().max(160)).max(60),
  colors: z.object({ primary: z.string(), accent: z.string(), text: z.string() }),
  musicAssetId: z.number().int().nullable(),
  madeForKids: z.boolean(),
  isActive: z.boolean(),
});
export type ChannelUpdate = z.infer<typeof channelUpdateSchema>;

/** Start time of each scene on the final timeline (intro card first), total length and chapter marks. */
export function episodeTimeline(scenes: { durationSec?: number; chapter?: string; title?: string }[], opts?: { intro?: number; outro?: number; gap?: number }) {
  const intro = opts?.intro ?? EPISODE_INTRO_SECONDS;
  const outro = opts?.outro ?? EPISODE_OUTRO_SECONDS;
  const gap = opts?.gap ?? SCENE_GAP;
  const starts: number[] = [];
  const durations: number[] = [];
  let t = intro;
  for (const s of scenes) {
    const d = Math.max(1, (s.durationSec ?? 0) + gap);
    starts.push(t);
    durations.push(d);
    t += d;
  }
  const chapters: { time: number; name: string }[] = [];
  scenes.forEach((s, i) => {
    const name = s.chapter?.trim();
    if (name && (chapters.length === 0 || chapters[chapters.length - 1].name !== name)) chapters.push({ time: starts[i], name });
  });
  return { starts, durations, intro, outro, total: t + outro, chapters };
}

export function timestamp(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** YouTube chapter list: "00:00 Intro" first and every chapter at least 10 seconds long, as YouTube requires. */
export function chaptersText(scenes: { durationSec?: number; chapter?: string }[], introLabel: string) {
  const tl = episodeTimeline(scenes);
  const lines = [`00:00 ${introLabel}`];
  let last = 0;
  for (const c of tl.chapters) {
    if (c.time - last < 10) continue;
    lines.push(`${timestamp(c.time)} ${c.name}`);
    last = c.time;
  }
  return lines.join("\n");
}

export function newSceneId() {
  return `sc${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** Problems that stop a render, in plain language. */
export function episodeProblems(script: EpisodeScript | null, language: EpisodeLanguage) {
  const out: string[] = [];
  if (!script) return ["لا يوجد سكربت بعد — ولّد السكربت أولًا"];
  if (!script.scenes.length) out.push("السكربت بلا مشاهد");
  // An animated scene is drawn at export time if its clip is not there yet.
  const missing = script.scenes.filter(s => !s.visual && !s.anim).length;
  if (missing) out.push(`${missing} مشهد بلا لقطة — اختر اللقطات أو شغّل الاختيار التلقائي`);
  const tl = episodeTimeline(script.scenes);
  if (tl.total > MAX_EPISODE_MINUTES * 60) out.push(`المدة ${Math.round(tl.total / 60)} دقيقة تتجاوز الحد ${MAX_EPISODE_MINUTES}`);
  if (language === "ar" && script.scenes.some(s => !/[؀-ۿ]/.test(s.narration))) out.push("بعض المشاهد ليست بالعربية رغم أن القناة عربية");
  return out;
}

/** The look that applies to an episode: its own choice, else the channel's default, else footage. */
export function visualModeOf(script: Pick<EpisodeScript, "visualMode"> | null | undefined, template: Pick<EpisodeTemplate, "visualMode"> | null | undefined): VisualMode {
  return script?.visualMode ?? template?.visualMode ?? "footage";
}
