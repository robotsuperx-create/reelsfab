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
  quality: z.enum(["standard", "cinema"]).optional(),
});
export type CodeVideoInput = z.infer<typeof codeVideoInputSchema>;

export const codeAgentInputSchema = z.object({
  idea: z.string().trim().min(8, "اكتب الفكرة بجملة على الأقل").max(4000),
  size: codeVideoInputSchema.shape.size,
  durationSec: codeVideoInputSchema.shape.durationSec,
  fps: codeVideoInputSchema.shape.fps,
  quality: codeVideoInputSchema.shape.quality,
  engine: z.enum(CODE_AGENT_ENGINES),
  /** Queue the render as soon as the code is written. */
  autoConvert: z.boolean(),
  /** One of STYLE_RECIPES; empty = the agent picks a look that suits the idea. */
  styleId: z.string().max(40).optional(),
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

export const CODE_VIDEO_STATUS_LABELS = { analyzing: "الوكيل يحلّل الفيديو", writing: "الوكيل يكتب", draft: "مكتوب — جاهز للتحويل", queued: "في الطابور", running: "جارٍ التحويل", done: "جاهز", failed: "فشل" } as const;
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

/** Animation written on top of the owner's own video. */
export const TRANSCRIBERS = ["local", "openai"] as const;
export type TranscriberId = (typeof TRANSCRIBERS)[number];
export const TRANSCRIBER_LABELS: Record<TranscriberId, string> = {
  local: "تفريغ على هذا الجهاز — Whisper مجاني",
  openai: "تفريغ OpenAI Whisper — أدق للعربية (مفتاحك)",
};
export const overlayInputSchema = z.object({
  /** A library asset (video) to write on. */
  assetId: z.number().int(),
  instruction: z.string().trim().min(4, "اكتب ماذا تريد فوق الفيديو").max(4000),
  engine: z.enum(CODE_AGENT_ENGINES),
  transcriber: z.enum(TRANSCRIBERS),
  language: z.enum(["ar", "en", "fr", "es", "auto"]),
  fps: z.union([z.literal(30), z.literal(60)]),
  autoConvert: z.boolean(),
});
export type OverlayInput = z.infer<typeof overlayInputSchema>;

/** Output size from the source's shape: vertical → 1080×1920, horizontal → 1920×1080, near-square → 1080×1080. */
export function sizeForSource(width: number, height: number) {
  const r = width / Math.max(1, height);
  if (r < 0.8) return CODE_VIDEO_SIZES[0];
  if (r > 1.25) return CODE_VIDEO_SIZES[1];
  return CODE_VIDEO_SIZES[2];
}

export const RENDER_QUALITIES = ["standard", "cinema"] as const;
export type RenderQuality = (typeof RENDER_QUALITIES)[number];
export const RENDER_QUALITY_LABELS: Record<RenderQuality, string> = { standard: "عادية", cinema: "سينمائية" };
/** Sub-frames blended per output frame in cinema mode (motion blur) and the supersampling factor. */
export const CINEMA_SUBFRAMES = 3;
export const CINEMA_SCALE = 2;

/* ------------------------------------------------------------ quality: style recipes, motion rules, strong prompt */

/** Named looks the owner picks; each is a precise recipe an AI can follow (palette, type, motion, texture). */
export const STYLE_RECIPES = [
  {
    id: "documentary",
    label: "وثائقي داكن",
    recipe: "Near-black background (#0b0d10) with a faint 90px grid; one accent red #ff3b30 plus warm gold #e8c26a, paper white #f2ede3 for text. Alexandria 800–900 for titles, IBM Plex Sans Arabic for body. Motion: measured, power3.out entrances 0.6–0.8 s, numbers count up, thin red rules draw in, soft vignette. Mood: serious investigation.",
  },
  {
    id: "kinetic",
    label: "كلمات متحركة (Kinetic)",
    recipe: "Solid bold background that changes colour per beat (#111 → #ffe14d → #1d4ed8); huge words (160–260px) slam in one word or line at a time with back.out(1.7) and quick 0.25–0.4 s cuts, scale punches on stressed words, hard cuts on beats. Cairo 900. Mood: energetic social reel.",
  },
  {
    id: "neon",
    label: "تقني نيون",
    recipe: "Deep navy #070b1a background with a subtle animated gradient blob; neon cyan #22d3ee and magenta #e879f9 glows (text-shadow 0 0 24px), JetBrains Mono for labels and Space Grotesk / Tajawal for titles, terminal-style typing, scanlines at 3% opacity, elements glide with expo.out. Mood: tech, AI, hacking.",
  },
  {
    id: "infographic",
    label: "إنفوجرافيك نظيف",
    recipe: "Off-white #f7f5f0 background, ink #14161a, one brand colour #2563eb and one alert #f97316. IBM Plex Sans Arabic 600/700. Charts and icons drawn in inline SVG with stroke-dashoffset draw-ons, bars grow from zero, labels fade in after their shape, generous white space, sine.inOut motion. Mood: clear explainer.",
  },
  {
    id: "storybook",
    label: "قصة مرسومة",
    recipe: "Warm gradient sky (#ffd6a5 → #ffadad), rounded flat shapes with 6px dark outlines (#2b2d42), simple SVG characters built from circles and rounded rects with blinking eyes and gentle bobbing (sine.inOut yoyo), Baloo Bhaijaan 2 or Cairo 700, soft drop shadows, page-turn transitions. Mood: friendly, for kids and stories.",
  },
] as const;
export type StyleRecipeId = (typeof STYLE_RECIPES)[number]["id"];

/** What separates a pro motion piece from a demo — given to every writer (our agent and the copied prompt). */
export const MOTION_QUALITY_RULES = [
  "Every element enters and leaves with intent: ease power3.out / expo.out for entrances, power2.in for exits; never linear except for counters and progress bars.",
  "Stagger related items by 0.06–0.12 s; nothing important pops in all at once.",
  "Hold each text on screen long enough to read: at least 0.35 s per word + 0.6 s, before it moves on.",
  "No dead air: something moves at all times (a slow 2–4% push-in on the scene, drifting background shapes, a counter, a pulse), but only one focal motion at a time.",
  "Clear hierarchy per moment: one headline, at most one supporting line, one visual. Max 2–3 colours plus neutrals, from the style recipe only.",
  "Depth: layered backgrounds (gradient + subtle texture or shapes) with parallax drift of 10–40px; soft shadows under cards.",
  "Transitions between scenes: a deliberate wipe, mask reveal, zoom-through or match cut — never a hard swap of everything at once unless the style asks for hard cuts.",
  "Typography: Arabic line-height ≥ 1.5, never letter-spacing on Arabic, never split Arabic words into letters; animate whole words or lines.",
  "Finish strong: the last 1.5 s is a composed end frame (key message or question), not a fade to empty black.",
] as const;

/**
 * The strong request for Gemini, DeepSeek or any AI: a fixed skeleton to fill (size, duration and the timeline
 * guard are already in it), hard rules, the quality rules, and a two-step flow (storyboard first, then code).
 */
export function strongPrompt(width: number, height: number, seconds: number, styleId: StyleRecipeId = "documentary", idea = "[اكتب الفكرة هنا]") {
  const style = STYLE_RECIPES.find(s => s.id === styleId) ?? STYLE_RECIPES[0];
  const vertical = height > width;
  const safe = vertical ? "اترك 180 بكسل فارغة أعلى الشاشة و320 أسفلها (واجهة المنصة)، و60 على كل جانب" : "اترك 60 بكسل على كل حافة";
  return `أنت مصمم موشن جرافيك محترف. اكتب ملف HTML واحداً يُصوَّر فيديو فريماً بفريم بساعة مضبوطة.

المواصفات الثابتة (لا تغيّرها):
- المقاس: ${width}×${height} بكسل بالضبط. المدة: ${seconds} ثانية بالضبط.
- ابدأ من هذا الهيكل واملأ الأماكن المعلَّمة [1] و[2] فقط:

\`\`\`html
<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Alexandria:wght@600;800;900&family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=Cairo:wght@400;700;900&family=JetBrains+Mono:wght@400;700&display=block" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#0b0d10;color:#fff;font-family:"IBM Plex Sans Arabic",sans-serif}
.scene{position:absolute;inset:0;opacity:0}
/* [1] التنسيق هنا */
</style></head><body>
<!-- [2] المشاهد هنا -->
<script>
const DURATION = ${seconds};
const tl = gsap.timeline();
/* [2] كل الحركة على tl بأوقات مطلقة بالثواني، مثال: tl.to('#a', {opacity: 1, y: 0, duration: .6, ease: 'power3.out'}, 2.0) */
tl.set({}, {}, DURATION); // لا تحذف هذا السطر: يضمن أن المدة ${seconds} ثانية بالضبط
</script></body></html>
\`\`\`

قواعد إلزامية (الكود الذي يخالفها يُرفض):
1. خط زمني واحد (tl) لكل الحركة بأوقات مطلقة. لا setInterval ولا Date ولا انتظار نقرة أو تمرير، ولا repeat:-1 على الخط الزمني الرئيسي.
2. لا صور ولا فيديو ولا صوت من روابط خارجية؛ ارسم بـ CSS أو SVG داخل الملف أو إيموجي. المكتبات من cdnjs أو jsdelivr فقط، والخطوط من Google Fonts فقط. لا fetch.
3. العربي: لا تقسّمه حرفاً بحرف، لا letter-spacing عليه، line-height ≥ 1.5؛ حرّك الكلمة أو السطر كاملاً.
4. لا شيء يخرج من الإطار. ${safe}.
5. أحجام الهاتف: النص ≥ ${vertical ? 44 : 36}px، العناوين ≥ ${vertical ? 90 : 72}px.
6. لا يتراكب نصّان أبداً: كل نص يخرج قبل أن يدخل الذي بعده في نفس المكان.
7. لا تخترع أرقاماً أو نسباً أو تواريخ؛ استعمل فقط ما في الفكرة.

الأسلوب (التزم به حرفياً):
${style.recipe}

قواعد الجودة:
${MOTION_QUALITY_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n")}

اعمل على خطوتين:
الخطوة 1: اكتب جدول ستوري بورد فقط بأعمدة: الوقت (من–إلى بالثواني) | ما يظهر | النص الحرفي | الحركة والانتقال. مجموع الأوقات = ${seconds} ثانية. ثم توقف وانتظر موافقتي.
الخطوة 2: بعد موافقتي، حوّل الجدول نفسه إلى الكود داخل الهيكل بالضبط. أرجع الملف كاملاً فقط، بلا شرح.

الفكرة: ${idea}`;
}

/* ------------------------------------------------------------ inspection of pasted code */

export type CodeIssue = { code: string; severity: "error" | "warn"; message: string };
export type CodeInspection = {
  issues: CodeIssue[];
  /** Length of the GSAP timeline(s) / CSS animations the page declares, when it can be read. */
  timelineSec: number | null;
  loops: boolean;
  stills: string[];
  stillTimes: number[];
  /** Ready to paste back into the AI that wrote the code. */
  fixPrompt: string;
};

export const inspectInputSchema = z.object({
  html: codeVideoInputSchema.shape.html,
  size: codeVideoInputSchema.shape.size,
  durationSec: codeVideoInputSchema.shape.durationSec,
});

export const fixInputSchema = inspectInputSchema.extend({ engine: z.enum(CODE_AGENT_ENGINES), styleId: z.string().max(40).optional() });
