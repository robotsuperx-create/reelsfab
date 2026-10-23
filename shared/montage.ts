/**
 * Montage spec: a declarative edit (segments, transition, narration, captions, music) that the server
 * renders with ffmpeg. Shared by the editor UI, the API validation and the render worker, so a saved
 * project is exactly what gets rendered — the same idea as Editly's JSON edit spec, built on our pipeline.
 */
import { z } from "zod";

export const MONTAGE_MOTIONS = ["slow_push", "slow_pull", "pan_left", "step_zoom"] as const;
export const MONTAGE_TRANSITIONS = ["none", "fade", "fadeblack", "wipeleft", "wiperight", "slideup", "slidedown", "circleopen", "smoothleft", "dissolve"] as const;
export const CAPTION_STYLES = ["karaoke", "classic", "boxed", "none"] as const;
export const CAPTION_POSITIONS = ["bottom", "center"] as const;
export const VOICE_SOURCES = ["tts", "segments", "none"] as const;

export const MAX_MONTAGE_SECONDS = 90;
export const MAX_SEGMENTS = 24;
export const MIN_SEGMENT_SECONDS = 0.5;
export const CTA_TAIL_SECONDS = 2.6;

const word = z.object({ word: z.string().max(80), start: z.number().min(0), end: z.number().min(0) });

const videoSegment = z.object({
  id: z.string().min(1).max(40),
  kind: z.literal("video"),
  /** App media URL (/api/media/<key>) of the source clip. */
  src: z.string().min(1).max(1024),
  assetId: z.number().int().optional(),
  label: z.string().max(120).optional(),
  credit: z.string().max(200).optional(),
  in: z.number().min(0).max(3600),
  out: z.number().min(0).max(3600),
  muted: z.boolean().optional(),
  /** Word timings of the clip's own speech, relative to the source clip (premium clips carry their transcript). */
  words: z.array(word).max(400).optional(),
});

const imageSegment = z.object({
  id: z.string().min(1).max(40),
  kind: z.literal("image"),
  src: z.string().min(1).max(1024),
  assetId: z.number().int().optional(),
  label: z.string().max(120).optional(),
  credit: z.string().max(200).optional(),
  duration: z.number().min(MIN_SEGMENT_SECONDS).max(60),
  motion: z.enum(MONTAGE_MOTIONS),
});

export const montageSegmentSchema = z.discriminatedUnion("kind", [videoSegment, imageSegment]);

export const montageSpecSchema = z.object({
  version: z.literal(1),
  fps: z.literal(30),
  segments: z.array(montageSegmentSchema).min(1).max(MAX_SEGMENTS),
  transition: z.object({ type: z.enum(MONTAGE_TRANSITIONS), duration: z.number().min(0.1).max(2) }),
  voice: z.object({ source: z.enum(VOICE_SOURCES) }),
  captions: z.object({ style: z.enum(CAPTION_STYLES), position: z.enum(CAPTION_POSITIONS) }),
  music: z.object({
    assetId: z.number().int().nullable(),
    src: z.string().max(1024).nullable(),
    /** 0..1 linear gain applied before ducking. */
    volume: z.number().min(0).max(1),
    duck: z.boolean(),
  }),
  hook: z.object({ show: z.boolean() }),
  cta: z.object({ show: z.boolean() }),
});

export type MontageSpec = z.infer<typeof montageSpecSchema>;
export type MontageSegment = z.infer<typeof montageSegmentSchema>;
export type VideoSegment = z.infer<typeof videoSegment>;
export type ImageSegment = z.infer<typeof imageSegment>;

export const TRANSITION_LABELS: Record<(typeof MONTAGE_TRANSITIONS)[number], string> = {
  none: "قطع مباشر",
  fade: "تلاشٍ",
  fadeblack: "تلاشٍ إلى الأسود",
  wipeleft: "مسح يسار",
  wiperight: "مسح يمين",
  slideup: "انزلاق لأعلى",
  slidedown: "انزلاق لأسفل",
  circleopen: "دائرة تنفتح",
  smoothleft: "انسياب يسار",
  dissolve: "ذوبان",
};
export const CAPTION_STYLE_LABELS: Record<(typeof CAPTION_STYLES)[number], string> = {
  karaoke: "كلمة بكلمة (كاريوكي)",
  classic: "كلاسيكي",
  boxed: "صندوق ملوّن",
  none: "بدون ترجمة",
};
export const MOTION_LABELS: Record<(typeof MONTAGE_MOTIONS)[number], string> = {
  slow_push: "تقريب بطيء",
  slow_pull: "إبعاد بطيء",
  pan_left: "تحريك جانبي",
  step_zoom: "تقريب متدرّج",
};
export const VOICE_SOURCE_LABELS: Record<(typeof VOICE_SOURCES)[number], string> = {
  tts: "تعليق صوتي من النص (Kokoro)",
  segments: "صوت المقاطع نفسها",
  none: "بدون صوت كلام",
};

export function segmentDuration(seg: MontageSegment) {
  return seg.kind === "image" ? seg.duration : Math.max(MIN_SEGMENT_SECONDS, seg.out - seg.in);
}

/** Effective transition overlap: never longer than half the shortest segment. */
export function effectiveTransition(spec: MontageSpec) {
  if (spec.transition.type === "none" || spec.segments.length < 2) return 0;
  const shortest = Math.min(...spec.segments.map(segmentDuration));
  return Math.max(0, Math.min(spec.transition.duration, shortest / 2));
}

/** Start time of each segment on the final timeline and the visual total (overlaps subtracted). */
export function montageTimeline(spec: MontageSpec) {
  const t = effectiveTransition(spec);
  const durations = spec.segments.map(segmentDuration);
  const starts: number[] = [];
  let cursor = 0;
  durations.forEach((d, i) => {
    starts.push(i === 0 ? 0 : cursor - t);
    cursor = (i === 0 ? 0 : cursor - t) + d;
  });
  return { starts, durations, transition: t, total: Math.max(0, cursor) };
}

export function newSegmentId() {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function defaultMontageSpec(partial?: Partial<MontageSpec>): MontageSpec {
  return {
    version: 1,
    fps: 30,
    segments: [],
    transition: { type: "fade", duration: 0.5 },
    voice: { source: "tts" },
    captions: { style: "karaoke", position: "bottom" },
    music: { assetId: null, src: null, volume: 0.18, duck: true },
    hook: { show: true },
    cta: { show: true },
    ...partial,
  };
}

/** Plain-language problems with a spec before it goes to ffmpeg (the editor shows these live). */
export function montageProblems(spec: MontageSpec): string[] {
  const out: string[] = [];
  if (!spec.segments.length) out.push("أضف مقطعًا واحدًا على الأقل");
  for (const s of spec.segments) {
    if (s.kind === "video" && s.out - s.in < MIN_SEGMENT_SECONDS) out.push(`المقطع "${s.label ?? s.id}" أقصر من نصف ثانية`);
  }
  const { total } = montageTimeline(spec);
  if (total > MAX_MONTAGE_SECONDS) out.push(`المدة الكلية ${total.toFixed(1)}s تتجاوز الحد ${MAX_MONTAGE_SECONDS}s`);
  if (spec.voice.source === "segments" && !spec.segments.some(s => s.kind === "video" && !s.muted)) out.push("اخترت صوت المقاطع لكن لا يوجد مقطع فيديو غير مكتوم");
  return out;
}
