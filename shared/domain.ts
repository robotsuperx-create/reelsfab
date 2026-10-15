// Shared domain constants used by both server and client.

export const TEMPLATES = [
  {
    key: "direct_tip",
    label: "نصيحة مباشرة",
    description: "Hook قوي ثم نصيحة واحدة قابلة للتطبيق ونتيجة واضحة.",
    motion: "slow_push",
  },
  {
    key: "common_mistake",
    label: "خطأ شائع",
    description: "يبدأ بالخطأ الذي يرتكبه الجميع ثم التصحيح.",
    motion: "pan_left",
  },
  {
    key: "comparison",
    label: "مقارنة",
    description: "هذا مقابل ذاك — خياران ونتيجة الاختيار الصحيح.",
    motion: "split_zoom",
  },
  {
    key: "three_points",
    label: "قائمة 3 نقاط",
    description: "ثلاث نقاط سريعة تظهر على الشاشة بالتتابع.",
    motion: "step_zoom",
  },
  {
    key: "story_wisdom",
    label: "قصة / حكمة",
    description: "لحظة قصصية قصيرة تنتهي بحكمة الشخصية وعبارتها المميزة.",
    motion: "slow_pull",
  },
] as const;
export type TemplateKey = (typeof TEMPLATES)[number]["key"];
export const TEMPLATE_KEYS = TEMPLATES.map(t => t.key) as [TemplateKey, ...TemplateKey[]];

export const HOOK_TYPES = [
  { key: "question", label: "سؤال" },
  { key: "mistake", label: "خطأ" },
  { key: "contrarian", label: "عكس السائد" },
  { key: "number", label: "رقم/قائمة" },
  { key: "story", label: "قصة" },
  { key: "secret", label: "سر/كشف" },
] as const;
export const HOOK_TYPE_KEYS = HOOK_TYPES.map(h => h.key) as [string, ...string[]];

export const STATUS_LABELS: Record<string, string> = {
  idea: "فكرة",
  script_ready: "نص جاهز",
  prompt_ready: "برومبت Premium جاهز",
  premium_uploaded: "فيديو Premium مرفوع",
  rendered: "تم الرندر",
  approved: "معتمد",
  needs_review: "يحتاج مراجعة",
  rejected: "مرفوض",
  scheduled: "مجدول",
  published: "منشور",
};

export const TRACK_LABELS: Record<string, string> = {
  economic: "اقتصادي",
  premium: "Premium",
  derivative: "مشتق من Premium",
};

export const QC_LABELS: Record<string, string> = {
  pending: "بانتظار الفحص",
  approved: "معتمد",
  needs_review: "يحتاج مراجعة",
  rejected: "مرفوض",
};

export const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram Reels",
  youtube: "YouTube Shorts",
};

export const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart — أنثى أمريكية دافئة" },
  { id: "af_bella", label: "Bella — أنثى أمريكية مشرقة" },
  { id: "af_sarah", label: "Sarah — أنثى أمريكية واثقة" },
  { id: "af_nicole", label: "Nicole — أنثى أمريكية هامسة" },
  { id: "af_kore", label: "Kore — أنثى أمريكية منخفضة" },
  { id: "af_sky", label: "Sky — أنثى أمريكية لعوبة" },
  { id: "af_nova", label: "Nova — أنثى أمريكية" },
  { id: "af_river", label: "River — أنثى أمريكية" },
  { id: "af_jessica", label: "Jessica — أنثى أمريكية" },
  { id: "af_aoede", label: "Aoede — أنثى أمريكية" },
  { id: "af_alloy", label: "Alloy — أنثى أمريكية" },
  { id: "am_michael", label: "Michael — ذكر أمريكي دافئ" },
  { id: "am_fenrir", label: "Fenrir — ذكر أمريكي خشن" },
  { id: "am_onyx", label: "Onyx — ذكر أمريكي عميق" },
  { id: "am_eric", label: "Eric — ذكر أمريكي هادئ" },
  { id: "am_adam", label: "Adam — ذكر أمريكي" },
  { id: "am_liam", label: "Liam — ذكر أمريكي شاب" },
  { id: "am_echo", label: "Echo — ذكر أمريكي" },
  { id: "am_puck", label: "Puck — ذكر أمريكي مرح" },
  { id: "bm_george", label: "George — ذكر بريطاني مصقول" },
  { id: "bm_lewis", label: "Lewis — ذكر بريطاني" },
  { id: "bm_daniel", label: "Daniel — ذكر بريطاني" },
  { id: "bm_fable", label: "Fable — ذكر بريطاني ناعم" },
  { id: "bf_emma", label: "Emma — أنثى بريطانية" },
  { id: "bf_isabella", label: "Isabella — أنثى بريطانية" },
  { id: "bf_alice", label: "Alice — أنثى بريطانية" },
  { id: "bf_lily", label: "Lily — أنثى بريطانية" },
] as const;

export const CAPTION_FONTS = ["Montserrat", "Playfair Display", "Fredoka", "Anton"] as const;

export const AI_DISCLOSURE = "AI-generated character";

/** Word-count window for a 15-second reel (≈2.3–2.8 words/second). */
export const WORDS_MIN = 25;
export const WORDS_MAX = 45;
export const WORDS_TARGET_MIN = 30;
export const WORDS_TARGET_MAX = 40;
export const REEL_SECONDS = 15;

export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text
    .replace(/[—–-]/g, " ")
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => /[A-Za-z0-9\u0600-\u06FF]/.test(w)).length;
}

export function spokenText(s: { hook?: string | null; body?: string | null; payoff?: string | null; cta?: string | null }) {
  return [s.hook, s.body, s.payoff, s.cta].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export type ComplianceRule = { key: string; label: string; severity: "block" | "warn"; pattern: RegExp };

/**
 * Claims policy from the Character Bible: no invented income figures or health results,
 * no investment advice, no imitation/gambling promotion, no job promises.
 */
export const COMPLIANCE_RULES: ComplianceRule[] = [
  {
    key: "income_figure",
    label: "رقم دخل/أرباح",
    severity: "block",
    pattern:
      /(\$\s?\d[\d,.]*\s?(k|m|million|thousand)?\s*(\/|per|a|an|every)?\s*(day|week|month|year|mo|yr)?)|(\b\d[\d,.]*\s?(k|m)?\s*(dollars|usd)\b)|(\b(made|make|earn|earned|making|earning)\s+\$?\d)/i,
  },
  {
    key: "guaranteed_money",
    label: "وعد بربح مضمون",
    severity: "block",
    pattern: /\b(guaranteed?|risk[- ]free|get rich|passive income overnight|quit your job|easy money|financial freedom in)\b/i,
  },
  {
    key: "investment_advice",
    label: "توصية استثمار",
    severity: "block",
    pattern: /\b(buy (this|these)? ?(stock|shares|crypto|coin)|you should invest in|best stock|price will (go|rise)|to the moon)\b/i,
  },
  {
    key: "medical_claim",
    label: "ادعاء صحي/علاجي",
    severity: "block",
    pattern:
      /\b(cures?|heals?|treats?|reverses?|prevents?)\s+(cancer|diabetes|disease|arthritis|depression|anxiety|alzheimer'?s?|heart disease|illness)\b|\b(lose|lost|drop)\s+\d+\s*(lbs?|pounds|kg|kilos)\b|\bin \d+ days?\b.*\b(weight|fat|pounds)\b/i,
  },
  {
    key: "therapy_claim",
    label: "تقديم كعلاج نفسي",
    severity: "warn",
    pattern: /\b(therapy|therapist|diagnos(e|is)|clinical|prescription)\b/i,
  },
  {
    key: "job_promise",
    label: "وعد توظيف",
    severity: "block",
    pattern: /\b(we('| a)re hiring|get (you )?(signed|hired)|guaranteed (job|contract|modeling)|i('| wi)ll sign you)\b/i,
  },
  {
    key: "gambling",
    label: "مقامرة/تقليد",
    severity: "block",
    pattern: /\b(casino|betting|bet on|gambl\w*|slots|replica|knock-?off|counterfeit)\b/i,
  },
  {
    key: "smoking",
    label: "تدخين",
    severity: "warn",
    pattern: /\b(cigar(ette)?s?|smok(e|ing)|vape)\b/i,
  },
  {
    key: "absolute_claim",
    label: "مبالغة مطلقة",
    severity: "warn",
    pattern: /\b(100% (works|proven)|always works|never fails|doctors hate|scientists hate)\b/i,
  },
];

export function checkCompliance(text: string): { rule: string; severity: "block" | "warn"; match: string }[] {
  const flags: { rule: string; severity: "block" | "warn"; match: string }[] = [];
  for (const r of COMPLIANCE_RULES) {
    const m = text.match(r.pattern);
    if (m) flags.push({ rule: r.key, severity: r.severity, match: m[0].slice(0, 80) });
  }
  return flags;
}

export function ruleLabel(key: string) {
  return COMPLIANCE_RULES.find(r => r.key === key)?.label ?? key;
}

/** Token-set Jaccard similarity in [0,1]. */
export function similarity(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2),
    );
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(w => {
    if (B.has(w)) inter++;
  });
  return inter / (A.size + B.size - inter);
}

export type AppSettings = {
  dailyTarget: number;
  premiumSharePercent: number;
  derivativesPerPremium: number;
  monthlyBudgetUsd: number;
  higgsfieldUsdPerCredit: number;
  higgsfieldCreditsPerAttempt: number;
  higgsfieldAttemptsPerClip: number;
  higgsfieldPlanUsd: number;
  higgsfieldDefaultModel: string;
  scriptModel: string;
  reviewModel: string;
  automationEnabled: boolean;
  automationHourUtc: number;
  postingSlots: string[];
  /** IANA time zone the posting slots are expressed in (the audience's local time). */
  postingTimezone: string;
  platforms: string[];
  accounts: Record<string, Record<string, string>>;
  musicVolume: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  dailyTarget: 30,
  premiumSharePercent: 30,
  derivativesPerPremium: 3,
  monthlyBudgetUsd: 300,
  // Higgsfield blog (Sep 2026): Seedance 2.5 8s 1080p = 72 credits ≈ $3.60 → $0.05/credit.
  higgsfieldUsdPerCredit: 0.05,
  higgsfieldCreditsPerAttempt: 72,
  // Same source: 3–5 attempts per usable clip.
  higgsfieldAttemptsPerClip: 3,
  higgsfieldPlanUsd: 49,
  higgsfieldDefaultModel: "Seedance 2.5 · 8s · 1080p",
  scriptModel: "claude-sonnet-4-6",
  reviewModel: "claude-haiku-4-5",
  automationEnabled: false,
  automationHourUtc: 5,
  postingSlots: ["09:00", "13:00", "18:00", "21:00"],
  postingTimezone: "America/New_York",
  platforms: ["tiktok", "instagram", "youtube"],
  accounts: {},
  musicVolume: 18,
};

/** Rough public list prices (USD per 1M tokens) used only for internal cost estimates. */
export const LLM_PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-opus-4-6": { in: 15, out: 75 },
  "claude-opus-4-7": { in: 15, out: 75 },
  "gemini-3-flash-preview": { in: 0.5, out: 3 },
  "gemini-3.8-flash": { in: 0, out: 0 },
  "gemini-3.1-pro-preview": { in: 2, out: 12 },
  "gpt-5": { in: 1.25, out: 10 },
  "gpt-5.5": { in: 2.5, out: 15 },
  "gpt-5-mini": { in: 0.25, out: 2 },
  "gpt-5-nano": { in: 0.05, out: 0.4 },
};

export const LLM_MODELS = Object.keys(LLM_PRICE_PER_MTOK);

export function usdFromMilliCents(mc: number) {
  return mc / 100000;
}
export function milliCentsFromUsd(usd: number) {
  return Math.round(usd * 100000);
}

export function formatUsd(usd: number) {
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Offset of `timeZone` at `date`, in Date.getTimezoneOffset() semantics (minutes to ADD to local time to get UTC;
 * New York in winter = 300). Falls back to 0 for an unknown zone.
 */
export function tzOffsetMinutes(timeZone: string, date: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(date);
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((date.getTime() - asUtc) / 60000);
  } catch {
    return 0;
  }
}
