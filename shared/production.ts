import {
  AI_DISCLOSURE,
  checkCompliance,
  countWords,
  REEL_SECONDS,
  ruleLabel,
  spokenText,
  WORDS_MAX,
  WORDS_MIN,
} from "./domain";

type CharacterLike = {
  name: string;
  loraKeyword?: string | null;
  appearancePrompt?: string | null;
  externalVoiceId?: string | null;
};
type ScriptLike = {
  hook?: string | null;
  body?: string | null;
  payoff?: string | null;
  cta?: string | null;
  higgsfieldPrompt?: string | null;
};

/** Full copy-ready Higgsfield prompt: identity lock + scene + dialogue + format. */
export function buildHiggsfieldPrompt(c: CharacterLike, s: ScriptLike) {
  const identity = [c.loraKeyword, c.appearancePrompt].filter(Boolean).join(", ");
  const scene = s.higgsfieldPrompt?.trim() || "Talking directly to camera in their signature setting, subtle natural gestures.";
  const line = spokenText(s);
  return [
    `${identity}.`,
    scene,
    `The character speaks to camera with natural lip-sync: "${line}"`,
    "Vertical 9:16, 1080p, smartphone UGC look, natural light, consistent face and outfit, no on-screen text, no logos.",
  ].join("\n");
}

export type QcInput = {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasCaptions: boolean;
  hasDisclosure: boolean;
  fileSize: number;
  script: ScriptLike & { onScreenText?: string | null; caption?: string | null; track?: string };
  maxSimilarity: number;
};

export type QcCheckOut = { key: string; label: string; status: "pass" | "warn" | "fail"; detail?: string };

export function evaluateQc(input: QcInput) {
  const checks: QcCheckOut[] = [];
  const sec = input.durationMs / 1000;
  const videoBased = input.script.track === "derivative" || input.script.track === "premium";
  // Higgsfield clips are often 8–10s; video-based reels are clip + CTA card (max 15s).
  const minOk = videoBased ? 8 : 13;
  checks.push({
    key: "duration",
    label: videoBased ? "المدة 8–15.5 ثانية (فيديو Premium)" : "المدة 13–15.5 ثانية",
    status: sec >= minOk && sec <= 15.6 ? "pass" : sec >= 5 && sec <= 20 ? "warn" : "fail",
    detail: `${sec.toFixed(2)}s`,
  });
  const vertical = input.height > input.width;
  const exact = input.width === 1080 && input.height === 1920;
  checks.push({
    key: "format",
    label: "مقاس عمودي 1080×1920",
    status: exact ? "pass" : vertical && Math.abs(input.width / input.height - 9 / 16) < 0.02 ? "warn" : "fail",
    detail: `${input.width}×${input.height}`,
  });
  checks.push({
    key: "audio",
    label: "مسار صوتي موجود",
    status: input.hasAudio ? "pass" : "fail",
  });
  checks.push({
    key: "captions",
    label: "ترجمة على الشاشة",
    status: input.hasCaptions ? "pass" : "warn",
  });
  checks.push({
    key: "disclosure",
    label: `وسم "${AI_DISCLOSURE}"`,
    status: input.hasDisclosure ? "pass" : "fail",
  });
  const isDerivative = input.script.track === "derivative" || input.script.track === "premium";
  const words = countWords(spokenText(input.script));
  checks.push({
    key: "words",
    label: `عدد الكلمات ${WORDS_MIN}–${WORDS_MAX}`,
    status: isDerivative ? "pass" : words >= WORDS_MIN && words <= WORDS_MAX ? "pass" : words >= 20 && words <= 50 ? "warn" : "fail",
    detail: isDerivative ? "صوت الفيديو الأصلي" : `${words} كلمة`,
  });
  const allText = [spokenText(input.script), input.script.onScreenText, input.script.caption].filter(Boolean).join(" ");
  const flags = checkCompliance(allText);
  const blocking = flags.filter(f => f.severity === "block");
  checks.push({
    key: "claims",
    label: "سياسة الادعاءات (دخل/صحة/استثمار)",
    status: blocking.length ? "fail" : flags.length ? "warn" : "pass",
    detail: flags.length ? flags.map(f => `${ruleLabel(f.rule)}: "${f.match}"`).join(" · ") : undefined,
  });
  checks.push({
    key: "duplicate",
    label: "عدم التكرار مع نصوص سابقة",
    status: input.maxSimilarity >= 0.75 ? "fail" : input.maxSimilarity >= 0.55 ? "warn" : "pass",
    detail: `${Math.round(input.maxSimilarity * 100)}% تشابه`,
  });
  checks.push({
    key: "filesize",
    label: "حجم الملف مناسب للرفع",
    status: input.fileSize > 0 && input.fileSize < 60 * 1024 * 1024 ? "pass" : "warn",
    detail: `${(input.fileSize / 1024 / 1024).toFixed(1)} MB`,
  });
  const fails = checks.filter(c => c.status === "fail").length;
  const warns = checks.filter(c => c.status === "warn").length;
  const score = Math.max(0, 100 - fails * 25 - warns * 8);
  const verdict: "approved" | "needs_review" | "rejected" = fails ? "rejected" : warns ? "needs_review" : "approved";
  return { checks, verdict, score };
}

export const REEL_MS = REEL_SECONDS * 1000;
