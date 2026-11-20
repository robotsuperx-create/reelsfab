/**
 * "Code → video" room: an HTML animation written by any AI is rendered frame by frame in headless Chromium
 * (virtual clock) and encoded to MP4. The page runs isolated: a strict Content-Security-Policy that only lets it
 * load libraries from public CDNs and Google Fonts, no access to the studio's origin, cookies or keys.
 */
import { z } from "zod";

export const CODE_VIDEO_SIZES = [
  { id: "1080x1920", width: 1080, height: 1920, label: "1080×1920 — عمودي (ريل)" },
  { id: "1920x1080", width: 1920, height: 1080, label: "1920×1080 — أفقي (يوتيوب)" },
  { id: "1080x1080", width: 1080, height: 1080, label: "1080×1080 — مربع" },
] as const;
export type CodeVideoSizeId = (typeof CODE_VIDEO_SIZES)[number]["id"];

export const CODE_VIDEO_FPS = [30, 60] as const;
/** Up to 40 minutes. Anything longer than one segment is written by the agent as a series of segments. */
export const CODE_VIDEO_MAX_SECONDS = 2400;
/** One HTML file covers at most this much; longer videos are planned as segments and joined. */
export const CODE_VIDEO_SEGMENT_MAX = 60;
export const CODE_VIDEO_SINGLE_MAX = 90;

export const CODE_VIDEO_DURATIONS = [15, 30, 60, 180, 300, 600, 900, 1800, 2400] as const;

/** "15 ث" · "3 د" · "1 د 30 ث". */
export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (!m) return `${s} ث`;
  return s ? `${m} د ${s} ث` : `${m} د`;
}

/** Who writes the animation: the Claude API key in the vault, or Claude Code installed on this computer (the owner's subscription, no key). */
export const CODE_AGENT_ENGINES = ["api", "claude-code"] as const;
export type CodeAgentEngine = (typeof CODE_AGENT_ENGINES)[number];
export const CODE_AGENT_ENGINE_LABELS: Record<CodeAgentEngine, string> = {
  api: "Claude API — مفتاح الخزنة (مدفوع بالاستعمال)",
  "claude-code": "Claude Code على هذا الجهاز — اشتراكك، بلا مفتاح",
};

export type CodeVideoSegment = { title: string; seconds: number; brief: string; html?: string };
export type CodeVideoPlan = { style: string; segments: CodeVideoSegment[] };
export const CODE_VIDEO_MAX_HTML = 2_000_000;

export const codeVideoInputSchema = z.object({
  title: z.string().trim().max(160).optional(),
  html: z.string().min(20, "ألصق ملف HTML كاملًا").max(CODE_VIDEO_MAX_HTML, "الملف أكبر من 2MB"),
  size: z.enum(CODE_VIDEO_SIZES.map(s => s.id) as [CodeVideoSizeId, ...CodeVideoSizeId[]]),
  durationSec: z.number().int().min(1).max(CODE_VIDEO_MAX_SECONDS),
  fps: z.union([z.literal(30), z.literal(60)]),
});
export type CodeVideoInput = z.infer<typeof codeVideoInputSchema>;

export const codeAgentInputSchema = z.object({
  idea: z.string().trim().min(8, "اكتب الفكرة بجملة على الأقل").max(4000),
  size: codeVideoInputSchema.shape.size,
  durationSec: codeVideoInputSchema.shape.durationSec,
  fps: codeVideoInputSchema.shape.fps,
  engine: z.enum(CODE_AGENT_ENGINES),
  /** Queue the render as soon as the code is written. */
  autoConvert: z.boolean(),
});
export type CodeAgentInput = z.infer<typeof codeAgentInputSchema>;

/** Segments a long video is cut into (30–60 s each, same total). */
export function segmentCount(durationSec: number) {
  return durationSec <= CODE_VIDEO_SINGLE_MAX ? 1 : Math.ceil(durationSec / CODE_VIDEO_SEGMENT_MAX);
}

/** Rough Claude API cost of writing a video (Sonnet list price, ~9k tokens out and ~3k in per HTML file). */
export function estimateAgentUsd(durationSec: number) {
  const n = segmentCount(durationSec);
  const perFile = (3000 * 2 + 9000 * 10) / 1_000_000;
  return n * perFile * 1.3 + (n > 1 ? 0.05 : 0);
}

export function codeVideoSize(id: string) {
  return CODE_VIDEO_SIZES.find(s => s.id === id) ?? CODE_VIDEO_SIZES[0];
}

export const CODE_VIDEO_STATUS_LABELS = { writing: "الوكيل يكتب", draft: "مكتوب — جاهز للتحويل", queued: "في الطابور", running: "جارٍ التحويل", done: "جاهز", failed: "فشل" } as const;
export type CodeVideoStatus = keyof typeof CODE_VIDEO_STATUS_LABELS;

/** Hosts the animation may load from (libraries and fonts). Everything else is blocked. */
export const CODE_VIDEO_ALLOWED_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"] as const;

const LIBS = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com";
/** One policy for the preview iframe (meta tag) and the server render (response header). */
export const CODE_VIDEO_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' blob: ${LIBS}`,
  `style-src 'unsafe-inline' https://fonts.googleapis.com ${LIBS}`,
  `font-src data: https://fonts.gstatic.com ${LIBS}`,
  `img-src data: blob: ${LIBS}`,
  "media-src data: blob:",
  `connect-src data: blob: ${LIBS}`,
  "worker-src blob:",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * Puts the CSP meta tag first in <head> (before any script of the pasted file can run), keeping the rest as is.
 * Used for the in-browser preview; the server also sends the same policy as a real header.
 */
export function withCodeVideoCsp(html: string) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CODE_VIDEO_CSP}">`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length);
  const doctype = /<!doctype[^>]*>/i.exec(html);
  if (doctype) return html.slice(0, doctype.index + doctype[0].length) + `<head>${meta}</head>` + html.slice(doctype.index + doctype[0].length);
  return `<head>${meta}</head>${html}`;
}

/** The request the owner copies into DeepSeek, Claude or any other AI. */
export function codeVideoPrompt(width: number, height: number, seconds: number, idea = "[اكتب الفكرة هنا]") {
  return `اكتب ملف HTML واحد مستقل، مقاس ${width}x${height}، مدة الأنيميشن ${seconds} ثانية،
يبدأ تلقائياً بدون تفاعل، بدون صوت، المكتبات فقط من cdnjs أو jsdelivr
(مثل GSAP)، الخطوط من Google Fonts، والخلفية تغطي الشاشة كاملة.
اجعل body بالمقاس نفسه تماماً (width: ${width}px; height: ${height}px; margin: 0; overflow: hidden).
الفكرة: ${idea}`;
}
