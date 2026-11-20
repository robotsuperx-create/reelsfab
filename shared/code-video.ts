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
export const CODE_VIDEO_MAX_SECONDS = 120;
export const CODE_VIDEO_MAX_HTML = 2_000_000;

export const codeVideoInputSchema = z.object({
  title: z.string().trim().max(160).optional(),
  html: z.string().min(20, "ألصق ملف HTML كاملًا").max(CODE_VIDEO_MAX_HTML, "الملف أكبر من 2MB"),
  size: z.enum(CODE_VIDEO_SIZES.map(s => s.id) as [CodeVideoSizeId, ...CodeVideoSizeId[]]),
  durationSec: z.number().int().min(1).max(CODE_VIDEO_MAX_SECONDS),
  fps: z.union([z.literal(30), z.literal(60)]),
});
export type CodeVideoInput = z.infer<typeof codeVideoInputSchema>;

export function codeVideoSize(id: string) {
  return CODE_VIDEO_SIZES.find(s => s.id === id) ?? CODE_VIDEO_SIZES[0];
}

export const CODE_VIDEO_STATUS_LABELS = { queued: "في الطابور", running: "جارٍ التحويل", done: "جاهز", failed: "فشل" } as const;
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
