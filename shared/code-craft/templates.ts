/**
 * Ready-made video templates for the code → video room: fixed structure and style (theme, colours, music, grade,
 * transitions, camera), with a scenario sheet that says what goes in each scene. The owner picks one, writes the
 * scenario, and an AI (the agent, or any free one through the copied prompt) fills it in — keeping the structure.
 * Screens stay airy: one idea per scene, short lines, more scenes rather than crowded ones.
 * Placeholder text is written «like this».
 */
import type { KitTheme } from "./kit";
import type { VideoKind } from "./knowledge";

export type TemplateCategory = { id: string; label: string; icon: string };
export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  { id: "politics", label: "سياسة وجيوسياسة", icon: "🌍" },
  { id: "economy", label: "اقتصاد ومال", icon: "💰" },
  { id: "business", label: "شركات وعلامات", icon: "🏢" },
  { id: "science", label: "علوم", icon: "🔬" },
  { id: "tech", label: "تقنية وذكاء اصطناعي", icon: "🤖" },
  { id: "history", label: "تاريخ", icon: "📜" },
  { id: "geo", label: "دول وسفر", icon: "✈️" },
  { id: "health", label: "صحة ولياقة", icon: "💪" },
  { id: "sports", label: "رياضة", icon: "⚽" },
  { id: "motivation", label: "تحفيز وتطوير ذات", icon: "🔥" },
  { id: "culture", label: "ثقافة وكتب", icon: "📚" },
  { id: "marketing", label: "إعلانات وتسويق", icon: "📣" },
  { id: "education", label: "تعليم وشرح", icon: "🎓" },
];

type Item = Record<string, unknown>;
type SceneSpec = { sec: number; guide: string; items: Item[]; tr?: string; cam?: string; fx?: string[]; fxEmoji?: string; place?: string; media?: Item };
export type VideoTemplate = {
  id: string;
  cat: string;
  name: string;
  /** One line: the look and the feel. */
  style: string;
  kind: VideoKind;
  theme: KitTheme;
  accent?: string;
  mood: "tense" | "upbeat" | "tech" | "calm" | "playful" | "epic";
  grade?: "theme" | "mono" | "warm" | "cool" | "vivid" | "none";
  wide?: boolean;
  /** Uses free photos / clips / Wikipedia pictures (the room switches them on). */
  pictures: boolean;
  scenes: SceneSpec[];
  end?: { kicker?: string; text: string; cta?: string; seconds?: number; fx?: string[] };
};

/* ---------------------------------------------------------------- item helpers */
const kick = (text: string): Item => ({ type: "kicker", text });
const title = (text: string, emphasis: string[] = [], size?: "xl" | "l" | "m"): Item => ({ type: "title", text, emphasis, ...(size ? { size } : {}) });
const line = (text: string, emphasis: string[] = []): Item => ({ type: "text", text, emphasis });
const kin = (lines: string[], emphasis: string[] = []): Item => ({ type: "kinetic", lines, emphasis });
const stat = (value: number, label: string, o: { prefix?: string; suffix?: string; decimals?: number } = {}): Item => ({ type: "stat", value, label, ...o });
const bars = (items: [string, number][], unit = ""): Item => ({ type: "bars", items: items.map(([label, value]) => ({ label, value })), unit });
const list = (items: string[], numbered = true): Item => ({ type: "list", items, numbered });
const tline = (events: [string, string][]): Item => ({ type: "timeline", events: events.map(([date, text]) => ({ date, text })) });
const cmp = (lt: string, li: string[], rt: string, ri: string[]): Item => ({ type: "compare", left: { title: lt, items: li }, right: { title: rt, items: ri } });
const quote = (text: string, by: string): Item => ({ type: "quote", text, by });
const emoji = (char: string, motion = "float", size?: number): Item => ({ type: "emoji", char, motion, ...(size ? { size } : {}) });
const icon = (name: string): Item => ({ type: "icon", name });
const src = (text: string): Item => ({ type: "source", text });
const cta = (text: string): Item => ({ type: "cta", text });
const person = (name: string, role: string, wiki?: string): Item => ({ type: "person", name, role, ...(wiki ? { wiki } : {}) });
const flags = (countries: [string, string][], vs = false): Item => ({ type: "flags", countries: countries.map(([code, label]) => ({ code, label })), ...(vs ? { vs: true } : {}) });
const pic = (query: string, frame = "card", caption?: string): Item => ({ type: "photo", query, frame, ...(caption ? { caption } : {}) });
const photo = (query: string, motion?: string, dim?: number): Item => ({ type: "photo", query, ...(motion ? { motion } : {}), ...(dim !== undefined ? { dim } : {}) });
const clip = (query: string, dim?: number): Item => ({ type: "clip", query, ...(dim !== undefined ? { dim } : {}) });
const map = (spec: Item): Item => ({ type: "map", ...spec });
const s = (sec: number, guide: string, items: Item[], o: Omit<SceneSpec, "sec" | "guide" | "items"> = {}): SceneSpec => ({ sec, guide, items, ...o });

/* ---------------------------------------------------------------- the templates */
export const VIDEO_TEMPLATES: VideoTemplate[] = [
  /* ================= politics ================= */
  {
    id: "pol-crisis-doc", cat: "politics", name: "وثائقي الأزمة", kind: "documentary", theme: "documentary", mood: "tense", pictures: true,
    style: "وثائقي داكن بالأحمر: مفارقة صادمة، خرائط، أرقام قبل/بعد، خط زمني، وخاتمة بسؤال — مثل فيديو إيران وهرمز.",
    scenes: [
      s(4.5, "الخطّاف: المفارقة في 3 أسطر قصيرة", [kin(["«ما بدأت به القصة»", "«وأين وصلت اليوم»", "«المفارقة»"], ["«المفارقة»"])], { tr: "cut", cam: "push", fx: ["letterbox"], media: clip("dark ocean ship aerial") }),
      s(4.5, "متى بدأت؟ تاريخ + خريطة البلد", [kick("«التاريخ»"), title("«بدأت الأزمة»", ["«الأزمة»"])], { tr: "fade", place: "top", media: map({ focus: ["IR"], highlight: ["IL"], routes: [["IL", "IR"]] }) }),
      s(4, "الهدف المعلن في كلمتين", [kin(["الهدف المعلن:", "«كلمتان»"], ["«كلمتان»"])], { tr: "mask", media: photo("city skyline dusk", "in") }),
      s(4, "من قاله؟ الشخصية المعنية", [person("«اسم المسؤول»", "«منصبه»")], { tr: "zoom" }),
      s(4.5, "كيف كان الوضع قبلها", [kick("قبل"), title("«الوضع كان طبيعيًا»", ["«طبيعيًا»"])], { tr: "fade", place: "top", media: map({ highlight: ["IR", "OM"], pins: [{ at: "26.57,56.25", label: "«المكان»" }], labels: false }) }),
      s(4.5, "رقم قبل/بعد", [kick("بعد"), bars([["قبل", 100], ["الآن", 30]]), src("«المصدر»")], { tr: "slide" }),
      s(6, "المحاولات بالتواريخ (3 فقط)", [tline([["«تاريخ 1»", "«محاولة»"], ["«تاريخ 2»", "«محاولة»"], ["«تاريخ 3»", "«نتيجة»"]])], { tr: "rise" }),
      s(4.5, "الرقم الصادم", [stat(25, "«ما يعنيه الرقم»"), src("«المصدر»")], { tr: "flash", fx: ["shake"], media: photo("storm sea night", "left") }),
      s(4.5, "اقتباس يكشف التحوّل", [quote("«جملة قالها المسؤول»", "«الاسم — التاريخ»")], { tr: "fade" }),
      s(4, "رأي الطرف الآخر (للتوازن)", [kick("الطرف الآخر"), title("«حجته في سطر»", [], "m")], { tr: "mask", media: photo("port containers ship", "up", 0.68) }),
      s(4.5, "الخلاصة", [kin(["«بدأت بـ…»", "«وصارت…»", "«حتى الآن»"], ["«حتى الآن»"])], { tr: "fade", fx: ["dust"], media: clip("stormy sea waves", 0.6) }),
    ],
    end: { kicker: "رأيك؟", text: "«سؤال للمشاهد»", cta: "تابع القناة", seconds: 3.5 },
  },
  {
    id: "pol-faceoff", cat: "politics", name: "مواجهة دولتين", kind: "explainer", theme: "neon", mood: "epic", pictures: true,
    style: "نيون حاد بأزرق وبنفسجي: علمان وجهًا لوجه، مقارنة قوة بالأرقام، وحسم في النهاية.",
    scenes: [
      s(4, "العلمان وجهًا لوجه", [flags([["US", "«الدولة 1»"], ["CN", "«الدولة 2»"]], true)], { tr: "glitch", cam: "push" }),
      s(3.5, "السؤال", [kin(["من الأقوى", "«في ماذا؟»"], ["الأقوى"])], { tr: "cut" }),
      s(4.5, "الجولة 1: الاقتصاد", [kick("الجولة 1 — الاقتصاد"), bars([["«الدولة 1»", 27], ["«الدولة 2»", 18]], " ترليون")], { tr: "whip" }),
      s(5, "الجولة 2: الجيش", [kick("الجولة 2 — الجيش"), bars([["«الدولة 1»", 900], ["«الدولة 2»", 300]], " مليار $")], { tr: "whip" }),
      s(4.5, "الجولة 3: السكان", [kick("الجولة 3 — السكان"), bars([["«الدولة 1»", 340], ["«الدولة 2»", 1410]], " مليون")], { tr: "whip" }),
      s(5, "على الخريطة", [title("«ساحة التنافس»", [], "m")], { tr: "zoom", place: "top", media: map({ world: true, pins: [{ at: "US" }, { at: "CN" }], routes: [["US", "CN"]] }) }),
      s(4.5, "نقطة القوة الخفية", [kick("الورقة الخفية"), title("«ما لا يعرفه الناس»", ["«الخفية»"], "m")], { tr: "iris", media: photo("aircraft carrier ocean", "in") }),
      s(4, "الحكم", [kin(["«النتيجة»", "«بفارق…»"], ["«النتيجة»"])], { tr: "flash", fx: ["rings"] }),
    ],
    end: { text: "من تراه الأقوى؟", cta: "اكتب في التعليقات", seconds: 3 },
  },
  {
    id: "pol-leader-profile", cat: "politics", name: "بروفايل زعيم", kind: "documentary", theme: "documentary", accent: "#d4af37", mood: "epic", grade: "warm", pictures: true,
    style: "ذهبي فخم: صورة الشخصية من ويكيبيديا، مسيرة على خط زمني، أرقام وإرث.",
    scenes: [
      s(4, "من هو؟ الصورة والاسم", [person("«الاسم الكامل»", "«المنصب»")], { tr: "fade", cam: "push" }),
      s(4, "جملة تلخّصه", [kin(["«وصف في سطرين»", "«مفارقة حياته»"], [])], { tr: "mask", media: photo("parliament building", "in") }),
      s(5, "البدايات", [kick("البداية"), title("«مكان وسنة الولادة»", [], "m")], { tr: "slide", place: "top", media: map({ focus: ["FR"] }) }),
      s(6, "المحطات الكبرى", [tline([["«سنة»", "«محطة»"], ["«سنة»", "«محطة»"], ["«سنة»", "«الوصول للحكم»"]])], { tr: "rise" }),
      s(4, "رقم يميّزه", [stat(12, "«سنوات في الحكم / أصوات / …»")], { tr: "zoom" }),
      s(4.5, "أشهر ما قاله", [quote("«اقتباس قصير موثّق»", "«الاسم — المناسبة»")], { tr: "fade" }),
      s(4, "ما يقوله منتقدوه", [kick("الوجه الآخر"), title("«أبرز انتقاد»", [], "m")], { tr: "whip" }),
      s(4, "الإرث", [kin(["«ما سيبقى منه»"], [])], { tr: "fade", fx: ["lightleak"] }),
    ],
    end: { text: "«من نروي قصته التالية؟»", cta: "تابع القناة", seconds: 3 },
  },
  {
    id: "pol-influence-map", cat: "politics", name: "خريطة النفوذ", kind: "explainer", theme: "infographic", mood: "tech", pictures: false,
    style: "إنفوغرافيك فاتح ونظيف: خرائط متتالية تكشف التحالفات والطرق، بلا صور.",
    scenes: [
      s(4, "السؤال الجغرافي", [kin(["«لماذا هذه المنطقة»", "«مهمة للجميع؟»"], ["مهمة"])], { tr: "cut" }),
      s(5, "المنطقة على الخريطة", [title("«اسم المنطقة»", [], "m")], { tr: "zoom", place: "top", media: map({ focus: ["SA", "IR"] }) }),
      s(5, "الحلفاء", [kick("الحلفاء"), title("«المعسكر الأول»", [], "m")], { tr: "fade", place: "top", media: map({ focus: ["SA"], highlight: ["AE", "BH", "EG"] }) }),
      s(5, "المعسكر الآخر", [kick("في المقابل"), title("«المعسكر الثاني»", [], "m")], { tr: "fade", place: "top", media: map({ focus: ["IR"], highlight: ["IQ", "SY"] }) }),
      s(5, "طرق التجارة/الطاقة", [kick("الطرق"), title("«ما يمرّ من هنا»", [], "m")], { tr: "mask", place: "top", media: map({ highlight: ["SA", "EG"], routes: [["SA", "CN"], ["SA", "IT"]] }) }),
      s(4, "رقم المصالح", [stat(30, "«نسبة / حجم ما يمر»", { suffix: "%" })], { tr: "zoom" }),
      s(4, "الخلاصة", [kin(["«من يسيطر على…»", "«يسيطر على…»"], [])], { tr: "fade" }),
    ],
    end: { text: "«أي منطقة نشرح بعدها؟»", cta: "تابع", seconds: 3 },
  },
  {
    id: "pol-breaking", cat: "politics", name: "خبر عاجل", kind: "reel", theme: "kinetic", accent: "#ef4444", mood: "tense", pictures: true,
    style: "عاجل سريع: حقول ألوان صاخبة، قطعات على الإيقاع، 3 حقائق ونقطة انتباه — ريل 30 ثانية.",
    scenes: [
      s(3, "عاجل + الحدث في 3 كلمات", [kick("🔴 عاجل"), title("«الحدث في 3 كلمات»", ["«الحدث»"], "xl")], { tr: "glitch", fx: ["shake"] }),
      s(3.5, "أين؟", [title("«المكان»", [], "m")], { tr: "cut", place: "top", media: map({ focus: ["UA"] }) }),
      s(3.5, "الحقيقة 1", [kick("1"), title("«ماذا حدث»", [], "m")], { tr: "cut", media: photo("news breaking city night", "in") }),
      s(3.5, "الحقيقة 2 — رقم", [stat(120, "«ما يعنيه الرقم»")], { tr: "flash" }),
      s(3.5, "الحقيقة 3", [kick("3"), title("«رد الفعل»", [], "m")], { tr: "cut" }),
      s(3.5, "لماذا يهمك؟", [kin(["لماذا يهمك؟", "«الأثر عليك»"], ["يهمك"])], { tr: "whip" }),
      s(3.5, "ماذا بعد؟", [kick("ترقّب"), title("«الخطوة التالية»", [], "m")], { tr: "cut" }),
    ],
    end: { text: "تابع للتحديثات", cta: "تفعيل الجرس 🔔", seconds: 2.5 },
  },
  {
    id: "pol-election", cat: "politics", name: "انتخابات بالأرقام", kind: "data", theme: "infographic", accent: "#2563eb", mood: "upbeat", pictures: true,
    style: "بيانات ملوّنة: مرشحان بالصور، أعمدة النتائج، خريطة، ونسبة المشاركة.",
    scenes: [
      s(3.5, "السؤال", [kin(["«انتخابات البلد»", "بالأرقام"], ["بالأرقام"])], { tr: "cut" }),
      s(4.5, "المرشح الأول", [person("«المرشح 1»", "«الحزب»")], { tr: "slide" }),
      s(4.5, "المرشح الثاني", [person("«المرشح 2»", "«الحزب»")], { tr: "slide" }),
      s(5, "النتيجة", [kick("النتائج"), bars([["«المرشح 1»", 52], ["«المرشح 2»", 46]], "%")], { tr: "zoom" }),
      s(4, "المشاركة", [stat(64, "نسبة المشاركة", { suffix: "%" })], { tr: "mask" }),
      s(5, "أين فاز كل واحد", [title("«المناطق الحاسمة»", [], "m")], { tr: "fade", place: "top", media: map({ focus: ["US"] }) }),
      s(4, "ماذا يعني ذلك", [kin(["«الدرس الأهم»"], [])], { tr: "fade" }),
    ],
    end: { text: "«سؤال للمشاهد»", cta: "تابع", seconds: 3 },
  },

  /* ================= economy ================= */
  {
    id: "eco-currency-crash", cat: "economy", name: "انهيار عملة", kind: "documentary", theme: "documentary", accent: "#22c55e", mood: "tense", grade: "cool", pictures: true,
    style: "أخضر بارد على داكن: رسوم هبوط، أرقام صادمة، صور أسواق ونقود.",
    scenes: [
      s(4, "الخطّاف", [kin(["«العملة»", "خسرت «النسبة» من قيمتها"], ["خسرت"])], { tr: "cut", cam: "push", media: clip("money bills falling", 0.6) }),
      s(4, "أين؟", [flags([["TR", "«البلد»"]])], { tr: "zoom" }),
      s(4.5, "سعر الصرف قبل/بعد", [kick("سعر الدولار"), bars([["«قبل سنتين»", 8], ["«اليوم»", 34]])], { tr: "slide" }),
      s(4, "التضخم", [stat(65, "معدل التضخم", { suffix: "%" })], { tr: "flash", fx: ["shake"] }),
      s(5, "الأسباب (3)", [list(["«سبب 1»", "«سبب 2»", "«سبب 3»"])], { tr: "rise" }),
      s(4, "الأثر على الناس", [kick("في الحياة اليومية"), title("«مثال ملموس»", [], "m")], { tr: "mask", media: photo("supermarket shelves prices", "left") }),
      s(4, "ماذا تفعل الحكومة", [kick("الحل؟"), title("«الإجراء»", [], "m")], { tr: "fade" }),
      s(4, "الدرس", [kin(["«الدرس للمشاهد»"], [])], { tr: "fade" }),
    ],
    end: { text: "«سؤال»", cta: "تابع", seconds: 3 },
  },
  {
    id: "eco-richest", cat: "economy", name: "الأغنى في العالم", kind: "data", theme: "kinetic", accent: "#facc15", mood: "upbeat", pictures: true,
    style: "تصنيف صاخب بالأصفر: عدّ تنازلي من 5 إلى 1 بالصور والأرقام.",
    scenes: [
      s(3.5, "العنوان", [kin(["أغنى 5", "«في العالم / في العرب»"], ["5"])], { tr: "cut", fx: ["confetti"], fxEmoji: "💰" }),
      s(4, "رقم 5", [kick("#5"), person("«الاسم»", "«الثروة»")], { tr: "slide" }),
      s(4, "رقم 4", [kick("#4"), person("«الاسم»", "«الثروة»")], { tr: "slide" }),
      s(4, "رقم 3", [kick("#3"), person("«الاسم»", "«الثروة»")], { tr: "slide" }),
      s(4, "رقم 2", [kick("#2"), person("«الاسم»", "«الثروة»")], { tr: "slide" }),
      s(4.5, "رقم 1", [kick("#1 👑"), person("«الاسم»", "«الثروة»")], { tr: "zoom", fx: ["sparkles"] }),
      s(4.5, "المقارنة", [bars([["#1", 240], ["#2", 200], ["#3", 180]], " مليار $")], { tr: "mask" }),
    ],
    end: { text: "من توقعته الأول؟", cta: "علّق", seconds: 3 },
  },
  {
    id: "eco-business-model", cat: "economy", name: "كيف تربح هذه الشركة؟", kind: "explainer", theme: "infographic", accent: "#0ea5e9", mood: "tech", pictures: true,
    style: "شرح نظيف: صورة الشركة من ويكيبيديا، مصادر الدخل بأعمدة، والسر في النهاية.",
    scenes: [
      s(3.5, "السؤال", [kin(["كيف تربح", "«الشركة»؟"], ["تربح"])], { tr: "cut" }),
      s(4, "الشركة", [pic("company headquarters building", "wide", "«اسم الشركة»")], { tr: "zoom" }),
      s(4, "الإيراد السنوي", [stat(80, "«مليار $ سنويًا»", { prefix: "$" })], { tr: "mask" }),
      s(5, "مصادر الدخل", [bars([["«مصدر 1»", 60], ["«مصدر 2»", 25], ["«مصدر 3»", 15]], "%")], { tr: "slide" }),
      s(4, "المفاجأة", [kick("المفاجأة"), title("«المصدر غير المتوقع»", [], "m")], { tr: "flash" }),
      s(4.5, "السر", [kin(["السر:", "«في جملة»"], ["السر:"])], { tr: "fade" }),
    ],
    end: { text: "«أي شركة نشرح بعدها؟»", cta: "تابع", seconds: 3 },
  },
  {
    id: "eco-two-economies", cat: "economy", name: "اقتصادان وجهًا لوجه", kind: "data", theme: "neon", accent: "#22d3ee", mood: "tech", pictures: false,
    style: "نيون أزرق: علمان، 4 جولات أرقام، ونتيجة — بلا صور.",
    scenes: [
      s(4, "العلمان", [flags([["MA", "«البلد 1»"], ["DZ", "«البلد 2»"]], true)], { tr: "glitch" }),
      s(4.5, "الناتج المحلي", [kick("الناتج المحلي"), bars([["«البلد 1»", 140], ["«البلد 2»", 240]], " مليار $")], { tr: "whip" }),
      s(4.5, "دخل الفرد", [kick("دخل الفرد"), bars([["«البلد 1»", 3800], ["«البلد 2»", 5300]], " $")], { tr: "whip" }),
      s(4.5, "البطالة", [kick("البطالة"), bars([["«البلد 1»", 13], ["«البلد 2»", 11]], "%")], { tr: "whip" }),
      s(4.5, "أقوى قطاع", [cmp("«البلد 1»", ["«قطاع»"], "«البلد 2»", ["«قطاع»"])], { tr: "slide" }),
      s(4, "الحكم", [kin(["«الخلاصة»"], [])], { tr: "flash", fx: ["rings"] }),
    ],
    end: { text: "رأيك؟", cta: "تابع", seconds: 3 },
  },
  {
    id: "eco-inflation-simple", cat: "economy", name: "مفهوم اقتصادي ببساطة", kind: "explainer", theme: "storybook", mood: "playful", pictures: false,
    style: "كرتوني دافئ بالإيموجي: يشرح مفهومًا (التضخم، الفائدة…) بمثال يومي.",
    scenes: [
      s(3.5, "السؤال", [emoji("🤔", "wiggle"), title("«ما هو التضخم؟»", ["«التضخم»"], "l")], { tr: "rise" }),
      s(4, "مثال يومي", [emoji("🍞", "bounce"), title("«الخبز كان بـ 1»", [], "m")], { tr: "slide" }),
      s(4, "اليوم", [emoji("💸", "float"), title("«واليوم بـ 2»", ["«2»"], "m")], { tr: "slide" }),
      s(4.5, "التعريف في سطر", [kin(["«التعريف ببساطة»"], [])], { tr: "zoom" }),
      s(4.5, "لماذا يحدث؟", [list(["«سبب 1»", "«سبب 2»"])], { tr: "mask" }),
      s(4, "نصيحة", [emoji("💡", "pulse"), title("«ماذا تفعل أنت»", [], "m")], { tr: "fade" }),
    ],
    end: { text: "«مفهوم تريد شرحه؟»", cta: "اكتب لنا", seconds: 3 },
  },

  /* ================= business ================= */
  {
    id: "biz-rise", cat: "business", name: "قصة صعود شركة", kind: "documentary", theme: "documentary", accent: "#f97316", mood: "epic", grade: "warm", pictures: true,
    style: "ملحمي دافئ: المؤسس بالصورة، المرآب الأول، خط زمني، وأرقام الإمبراطورية اليوم.",
    scenes: [
      s(4, "الخطّاف", [kin(["بدأت في «مرآب»", "واليوم تساوي «رقم»"], ["«رقم»"])], { tr: "cut", cam: "push", media: clip("city timelapse night", 0.6) }),
      s(4.5, "المؤسس", [person("«اسم المؤسس»", "مؤسس «الشركة»")], { tr: "zoom" }),
      s(4, "الفكرة", [kick("الفكرة"), title("«الفكرة في سطر»", [], "m")], { tr: "mask", media: photo("garage workshop vintage", "in") }),
      s(6, "المحطات", [tline([["«سنة»", "«التأسيس»"], ["«سنة»", "«أول نجاح»"], ["«سنة»", "«القفزة»"]])], { tr: "rise" }),
      s(4, "الأزمة", [kick("كادت تنهار"), title("«ماذا حدث»", [], "m")], { tr: "glitch" }),
      s(4, "اليوم", [stat(3, "«ترليون $ القيمة»", { prefix: "$", suffix: " ترليون" })], { tr: "zoom", fx: ["sparkles"] }),
      s(4, "الدرس", [kin(["«الدرس»"], [])], { tr: "fade", fx: ["lightleak"] }),
    ],
    end: { text: "«أي شركة نروي قصتها؟»", cta: "تابع", seconds: 3 },
  },
  {
    id: "biz-fall", cat: "business", name: "سقوط عملاق", kind: "documentary", theme: "documentary", mood: "tense", grade: "mono", pictures: true,
    style: "أبيض وأسود درامي: من القمة إلى الإفلاس، أرقام الهبوط، والخطأ القاتل.",
    scenes: [
      s(4, "الخطّاف", [kin(["كانت «الأولى عالميًا»", "ثم اختفت"], ["اختفت"])], { tr: "cut", fx: ["letterbox"], media: photo("abandoned store empty", "in") }),
      s(4.5, "القمة", [kick("في القمة"), stat(90, "«حصتها من السوق»", { suffix: "%" })], { tr: "fade" }),
      s(4, "الخطأ القاتل", [kick("الخطأ"), title("«القرار الذي أسقطها»", [], "m")], { tr: "flash", fx: ["shake"] }),
      s(4.5, "المنافس الجديد", [cmp("«الشركة»", ["«ما تمسّكت به»"], "«المنافس»", ["«ما راهن عليه»"])], { tr: "whip" }),
      s(4.5, "الهبوط", [bars([["«سنة القمة»", 100], ["«بعد 5 سنوات»", 8]], "%")], { tr: "slide" }),
      s(4, "النهاية", [kick("«سنة»"), title("«إعلان الإفلاس / البيع»", [], "m")], { tr: "fade" }),
      s(4, "الدرس", [kin(["«الدرس»"], [])], { tr: "fade", fx: ["dust"] }),
    ],
    end: { text: "«شركة تتوقع سقوطها؟»", cta: "علّق", seconds: 3 },
  },
  {
    id: "biz-product", cat: "business", name: "منتج غيّر العالم", kind: "documentary", theme: "neon", accent: "#a855f7", mood: "tech", pictures: true,
    style: "نيون بنفسجي: صورة المنتج، العالم قبله وبعده، الأرقام.",
    scenes: [
      s(4, "الخطّاف", [kin(["منتج واحد", "غيّر «ماذا»"], ["غيّر"])], { tr: "glitch" }),
      s(4, "المنتج", [pic("smartphone product", "wide", "«اسم المنتج»")], { tr: "zoom" }),
      s(4.5, "قبله وبعده", [cmp("قبل", ["«كيف كنا»"], "بعد", ["«كيف صرنا»"])], { tr: "slide" }),
      s(4, "المبيعات", [stat(2, "«مليار وحدة»", { suffix: " مليار" })], { tr: "flash" }),
      s(4.5, "من صنعه", [person("«المخترع / الشركة»", "«الدور»")], { tr: "mask" }),
      s(4, "الأثر", [kin(["«أثره اليوم»"], [])], { tr: "fade" }),
    ],
    end: { text: "«منتج تريد قصته؟»", cta: "تابع", seconds: 3 },
  },
  {
    id: "biz-rivalry", cat: "business", name: "حرب شركتين", kind: "explainer", theme: "kinetic", accent: "#ef4444", mood: "epic", pictures: true,
    style: "مواجهة بالألوان الصارخة: شعاران وجهًا لوجه، جولات مقارنة، والفائز.",
    scenes: [
      s(3.5, "العنوان", [kin(["«الشركة 1»", "ضد", "«الشركة 2»"], ["ضد"])], { tr: "cut", fx: ["shake"] }),
      s(4, "الشركة الأولى", [pic("brand logo store", "card", "«الشركة 1»")], { tr: "slide" }),
      s(4, "الشركة الثانية", [pic("brand logo shop", "card", "«الشركة 2»")], { tr: "slide" }),
      s(4.5, "الإيرادات", [kick("الإيرادات"), bars([["«1»", 380], ["«2»", 300]], " مليار $")], { tr: "whip" }),
      s(4.5, "المستخدمون", [kick("العملاء"), bars([["«1»", 2], ["«2»", 3]], " مليار")], { tr: "whip" }),
      s(4.5, "الحرب الحقيقية", [kick("المعركة الحقيقية"), title("«على ماذا يتنافسان»", [], "m")], { tr: "iris" }),
      s(4, "الفائز", [kin(["الفائز:", "«…»"], ["الفائز:"])], { tr: "flash", fx: ["confetti"] }),
    ],
    end: { text: "فريق من أنت؟", cta: "علّق", seconds: 3 },
  },

  /* ================= science ================= */
  {
    id: "sci-fact", cat: "science", name: "حقيقة علمية مدهشة", kind: "reel", theme: "neon", accent: "#22d3ee", mood: "calm", pictures: true,
    style: "نيون هادئ مع لقطات متحركة: حقيقة واحدة، شرحها في خطوتين، وسؤال.",
    scenes: [
      s(4, "الحقيقة الصادمة", [kin(["هل تعلم أن", "«الحقيقة»؟"], ["«الحقيقة»؟"])], { tr: "fade", media: clip("galaxy stars space", 0.55) }),
      s(4, "الرقم", [stat(300000, "«كم/ثانية — ما يعنيه»")], { tr: "zoom" }),
      s(4.5, "لماذا؟", [kick("لماذا؟"), title("«التفسير في سطر»", [], "m")], { tr: "mask", media: photo("laboratory science", "in") }),
      s(4.5, "مثال يقرّبها", [emoji("🌍", "spin"), title("«مثال من حياتنا»", [], "m")], { tr: "slide" }),
      s(4, "المدهش أكثر", [kin(["والأغرب:", "«حقيقة ثانية»"], ["والأغرب:"])], { tr: "iris", fx: ["sparkles"] }),
    ],
    end: { text: "«سؤال للمشاهد»", cta: "تابع للمزيد", seconds: 3 },
  },
  {
    id: "sci-how-it-works", cat: "science", name: "كيف يعمل…؟", kind: "explainer", theme: "infographic", accent: "#0ea5e9", mood: "tech", pictures: true,
    style: "شرح مصوّر فاتح: الشيء بالصورة، 3 خطوات مرقّمة، والفكرة الأساسية.",
    scenes: [
      s(3.5, "السؤال", [kin(["كيف يعمل", "«الشيء»؟"], ["يعمل"])], { tr: "cut" }),
      s(4, "الشيء", [pic("engine machine closeup", "wide", "«اسم الشيء»")], { tr: "zoom" }),
      s(4, "الخطوة 1", [kick("1"), title("«ما يحدث أولًا»", [], "m")], { tr: "slide" }),
      s(4, "الخطوة 2", [kick("2"), title("«ثم…»", [], "m")], { tr: "slide" }),
      s(4, "الخطوة 3", [kick("3"), title("«وأخيرًا…»", [], "m")], { tr: "slide" }),
      s(4, "رقم مذهل", [stat(1000, "«ما يعنيه»")], { tr: "flash" }),
      s(4, "الخلاصة", [kin(["«الفكرة كلها في سطر»"], [])], { tr: "fade" }),
    ],
    end: { text: "«ماذا نشرح بعده؟»", cta: "اكتب لنا", seconds: 3 },
  },
  {
    id: "sci-space", cat: "science", name: "رحلة في الفضاء", kind: "documentary", theme: "neon", accent: "#818cf8", mood: "epic", grade: "cool", pictures: true,
    style: "سينمائي فضائي: لقطات مجرات، أرقام المسافات، مقارنة الأحجام.",
    scenes: [
      s(4.5, "الخطّاف", [kin(["«الجرم»", "أكبر من «…» بـ «…» مرة"], ["أكبر"])], { tr: "fade", fx: ["dust"], media: clip("galaxy nebula space", 0.5) }),
      s(4, "الصورة", [pic("planet space", "circle", "«الاسم»")], { tr: "zoom" }),
      s(4, "المسافة", [stat(150, "«مليون كم عن الأرض»")], { tr: "mask" }),
      s(4.5, "المقارنة", [bars([["الأرض", 1], ["«الجرم»", 109]], "×")], { tr: "slide" }),
      s(4, "حقيقة غريبة", [kick("الغريب"), title("«الحقيقة»", [], "m")], { tr: "iris", media: photo("stars night sky", "up") }),
      s(4, "التأمل", [kin(["«جملة ختامية تأملية»"], [])], { tr: "fade", fx: ["sparkles"] }),
    ],
    end: { text: "«سؤال»", cta: "تابع", seconds: 3 },
  },
  {
    id: "sci-body", cat: "science", name: "جسم الإنسان", kind: "explainer", theme: "infographic", accent: "#ef4444", mood: "calm", pictures: true,
    style: "طبي نظيف بالأحمر: العضو، أرقام مدهشة، وما يضره وما يفيده.",
    scenes: [
      s(4, "الخطّاف", [emoji("❤️", "pulse"), title("«العضو» ينبض «رقم» مرة يوميًا", ["«رقم»"], "m")], { tr: "zoom" }),
      s(4, "الرقم", [stat(100000, "«ما يعنيه»")], { tr: "mask" }),
      s(4.5, "كيف يعمل", [kick("كيف يعمل"), title("«في سطر»", [], "m")], { tr: "slide", media: photo("human anatomy model", "in") }),
      s(5, "ما يضره / ما يفيده", [cmp("يضره", ["«…»", "«…»"], "يفيده", ["«…»", "«…»"])], { tr: "whip" }),
      s(4, "نصيحة اليوم", [kin(["«نصيحة واحدة»"], [])], { tr: "fade" }),
    ],
    end: { text: "معلومة طبية عامة — استشر طبيبك", cta: "تابع", seconds: 3 },
  },

  /* ================= tech ================= */
  {
    id: "tech-new-ai-tool", cat: "tech", name: "أداة ذكاء اصطناعي جديدة", kind: "reel", theme: "neon", accent: "#a855f7", mood: "tech", pictures: true,
    style: "تقني لامع: اسم الأداة، ماذا تفعل في 3 نقاط، السعر، والحكم.",
    scenes: [
      s(3.5, "الخطّاف", [kin(["أداة جديدة", "«تفعل ماذا»"], ["جديدة"])], { tr: "glitch" }),
      s(4, "الاسم", [kick("«الشركة»"), title("«اسم الأداة»", ["«اسم الأداة»"], "xl")], { tr: "zoom", media: photo("computer code screen dark", "in") }),
      s(4.5, "ماذا تفعل", [list(["«ميزة 1»", "«ميزة 2»", "«ميزة 3»"])], { tr: "slide" }),
      s(4, "مقارنة", [cmp("القديم", ["«…»"], "«الأداة»", ["«…»"])], { tr: "whip" }),
      s(3.5, "السعر", [stat(0, "«مجاني / شهريًا»", { prefix: "$" })], { tr: "flash" }),
      s(4, "الحكم", [kin(["«تستحق؟ نعم/لا»"], [])], { tr: "fade", fx: ["sparkles"] }),
    ],
    end: { text: "احفظ الفيديو", cta: "تابع للمزيد", seconds: 2.5 },
  },
  {
    id: "tech-future", cat: "tech", name: "المستقبل بعد 10 سنوات", kind: "explainer", theme: "neon", accent: "#06b6d4", mood: "epic", grade: "cool", pictures: true,
    style: "مستقبلي سينمائي: لقطات مدن ذكية، توقعات مرقّمة، أرقام السوق.",
    scenes: [
      s(4, "الخطّاف", [kin(["في «2035»", "«شيء سيختفي»"], ["سيختفي"])], { tr: "glitch", media: clip("futuristic city night", 0.55) }),
      s(4.5, "التوقع 1", [kick("1"), title("«التوقع»", [], "m")], { tr: "slide", media: photo("robot technology", "in") }),
      s(4.5, "التوقع 2", [kick("2"), title("«التوقع»", [], "m")], { tr: "slide" }),
      s(4.5, "التوقع 3", [kick("3"), title("«التوقع»", [], "m")], { tr: "slide" }),
      s(4, "حجم السوق", [stat(15, "«ترليون $ بحلول…»", { prefix: "$", suffix: " ترليون" })], { tr: "zoom" }),
      s(4, "ماذا تفعل الآن", [kin(["«نصيحة للمشاهد»"], [])], { tr: "fade" }),
    ],
    end: { text: "أي توقع تصدّقه؟", cta: "علّق", seconds: 3 },
  },
  {
    id: "tech-vs", cat: "tech", name: "مقارنة منتجين", kind: "explainer", theme: "kinetic", accent: "#3b82f6", mood: "upbeat", pictures: true,
    style: "مقارنة سريعة ملوّنة: الصورتان، المواصفات جولة جولة، والأفضل لمن.",
    scenes: [
      s(3.5, "العنوان", [kin(["«المنتج 1»", "أم", "«المنتج 2»؟"], ["أم"])], { tr: "cut" }),
      s(4, "الصورتان", [pic("smartphone", "card", "«1»"), pic("laptop", "card", "«2»")], { tr: "zoom" }),
      s(4, "السعر", [cmp("«1»", ["«السعر»"], "«2»", ["«السعر»"])], { tr: "whip" }),
      s(4, "الأداء", [bars([["«1»", 90], ["«2»", 80]], "")], { tr: "whip" }),
      s(4, "البطارية", [bars([["«1»", 20], ["«2»", 26]], " ساعة")], { tr: "whip" }),
      s(4.5, "لمن كل واحد", [cmp("«1» لـ", ["«نوع المستخدم»"], "«2» لـ", ["«نوع المستخدم»"])], { tr: "slide" }),
    ],
    end: { text: "أيهما تختار؟", cta: "علّق", seconds: 3 },
  },
  {
    id: "tech-tips", cat: "tech", name: "5 حيل تقنية", kind: "reel", theme: "kinetic", accent: "#22c55e", mood: "playful", pictures: false,
    style: "سريع ومرح: حيلة في كل شاشة مع إيموجي، بلا صور — يصلح لأي هاتف أو برنامج.",
    scenes: [
      s(3, "العنوان", [emoji("📱", "bounce"), title("5 حيل في «الهاتف»", ["5"], "l")], { tr: "cut" }),
      s(3.5, "حيلة 1", [kick("1"), title("«الحيلة»", [], "m")], { tr: "slide" }),
      s(3.5, "حيلة 2", [kick("2"), title("«الحيلة»", [], "m")], { tr: "slide" }),
      s(3.5, "حيلة 3", [kick("3"), title("«الحيلة»", [], "m")], { tr: "slide" }),
      s(3.5, "حيلة 4", [kick("4"), title("«الحيلة»", [], "m")], { tr: "slide" }),
      s(4, "حيلة 5 — الأقوى", [kick("5 🔥"), title("«الحيلة الأقوى»", [], "m")], { tr: "zoom", fx: ["sparkles"] }),
    ],
    end: { text: "احفظه لترجع له", cta: "تابع", seconds: 2.5 },
  },

  /* ================= history ================= */
  {
    id: "his-event", cat: "history", name: "حدث غيّر التاريخ", kind: "documentary", theme: "documentary", accent: "#d4a373", mood: "epic", grade: "warm", pictures: true,
    style: "تاريخي دافئ بلون السيبيا: خريطة، صور أرشيفية من ويكيبيديا، تسلسل الأحداث.",
    scenes: [
      s(4.5, "الخطّاف", [kick("«السنة»"), title("«يوم تغيّر فيه كل شيء»", [], "m")], { tr: "fade", fx: ["dust"], media: photo("old historical ruins", "in") }),
      s(4.5, "أين؟", [title("«المكان»", [], "m")], { tr: "zoom", place: "top", media: map({ focus: ["EG"] }) }),
      s(4, "صورة الحدث", [{ type: "photo", wiki: "«عنوان المقالة بالإنجليزية»", frame: "polaroid", caption: "«تعليق»" }], { tr: "mask" }),
      s(6, "التسلسل", [tline([["«تاريخ»", "«بداية»"], ["«تاريخ»", "«ذروة»"], ["«تاريخ»", "«نهاية»"]])], { tr: "rise" }),
      s(4, "الثمن", [stat(1000, "«ما يعنيه»")], { tr: "flash" }),
      s(4.5, "ماذا تغيّر بعده", [kin(["بعده", "«ما تغيّر»"], ["بعده"])], { tr: "fade", fx: ["lightleak"] }),
    ],
    end: { text: "«حدث تريد قصته؟»", cta: "تابع", seconds: 3 },
  },
  {
    id: "his-figure", cat: "history", name: "شخصية تاريخية", kind: "documentary", theme: "documentary", accent: "#c9a227", mood: "epic", grade: "warm", pictures: true,
    style: "بورتريه تاريخي ذهبي: الصورة من ويكيبيديا، المسيرة، المقولة، الإرث.",
    scenes: [
      s(4.5, "من هو", [person("«الاسم»", "«الوصف: قائد، عالم…»")], { tr: "fade", cam: "push" }),
      s(4, "عاش في…", [title("«الزمان والمكان»", [], "m")], { tr: "zoom", place: "top", media: map({ focus: ["ES"], highlight: ["MA"] }) }),
      s(6, "حياته", [tline([["«سنة»", "«محطة»"], ["«سنة»", "«محطة»"], ["«سنة»", "«وفاته»"]])], { tr: "rise" }),
      s(4.5, "أشهر أعماله", [kick("أشهر إنجاز"), title("«الإنجاز»", [], "m")], { tr: "mask", media: photo("ancient manuscript library", "in") }),
      s(4.5, "قال", [quote("«مقولة موثّقة»", "«الاسم»")], { tr: "fade" }),
      s(4, "الإرث", [kin(["«ما بقي منه اليوم»"], [])], { tr: "fade", fx: ["lightleak"] }),
    ],
    end: { text: "«شخصية تريد قصتها؟»", cta: "تابع", seconds: 3 },
  },
  {
    id: "his-empire", cat: "history", name: "صعود وسقوط إمبراطورية", kind: "documentary", theme: "documentary", accent: "#b91c1c", mood: "epic", pictures: true,
    style: "خرائط تتوسّع ثم تنكمش: الصعود، الذروة، أسباب السقوط.",
    scenes: [
      s(4, "الخطّاف", [kin(["حكمت «مساحة»", "ثم «اختفت»"], ["اختفت"])], { tr: "cut", fx: ["letterbox"], media: photo("ancient empire ruins", "in") }),
      s(5, "البداية", [kick("«سنة» — البداية"), title("«المكان الأول»", [], "m")], { tr: "zoom", place: "top", media: map({ focus: ["TR"] }) }),
      s(5, "الذروة", [kick("«سنة» — الذروة"), title("«أوسع حدود»", [], "m")], { tr: "fade", place: "top", media: map({ focus: ["TR"], highlight: ["EG", "SA", "GR", "BG", "SY", "IQ", "DZ"] }) }),
      s(4, "رقم الذروة", [stat(5, "«مليون كم²»", { suffix: " مليون كم²" })], { tr: "mask" }),
      s(5, "أسباب السقوط", [list(["«سبب 1»", "«سبب 2»", "«سبب 3»"])], { tr: "rise" }),
      s(4.5, "النهاية", [kick("«سنة»"), title("«آخر يوم»", [], "m")], { tr: "fade", fx: ["dust"] }),
    ],
    end: { text: "«إمبراطورية نرويها بعدها؟»", cta: "تابع", seconds: 3 },
  },
  {
    id: "his-this-day", cat: "history", name: "في مثل هذا اليوم", kind: "reel", theme: "storybook", accent: "#b45309", mood: "calm", pictures: true,
    style: "تقويم دافئ: التاريخ كبير، 3 أحداث في نفس اليوم عبر القرون، بصور.",
    scenes: [
      s(3.5, "التاريخ", [kick("في مثل هذا اليوم"), title("«اليوم والشهر»", [], "xl")], { tr: "rise", fx: ["sparkles"] }),
      s(4.5, "الحدث 1", [kick("«سنة»"), title("«الحدث»", [], "m")], { tr: "slide", media: photo("vintage old photo city", "left") }),
      s(4.5, "الحدث 2", [kick("«سنة»"), title("«الحدث»", [], "m")], { tr: "slide", media: photo("old map compass", "right") }),
      s(4.5, "الحدث 3", [kick("«سنة»"), title("«الحدث»", [], "m")], { tr: "slide", media: photo("antique clock", "in") }),
      s(4, "الأهم", [kin(["الأهم:", "«لماذا»"], ["الأهم:"])], { tr: "zoom" }),
    ],
    end: { text: "تابع لتعرف ماذا حدث غدًا", cta: "تابع", seconds: 3 },
  },

  /* ================= geo & travel ================= */
  {
    id: "geo-country-minute", cat: "geo", name: "دولة في دقيقة", kind: "explainer", theme: "infographic", accent: "#16a34a", mood: "upbeat", pictures: true,
    style: "بطاقة دولة: العلم، الخريطة، العاصمة بالصورة، 3 أرقام، وحقيقة غريبة.",
    scenes: [
      s(3.5, "العلم", [flags([["JP", "«اسم الدولة»"]])], { tr: "zoom" }),
      s(4.5, "على الخريطة", [title("«أين تقع»", [], "m")], { tr: "fade", place: "top", media: map({ focus: ["JP"] }) }),
      s(4, "العاصمة", [kick("العاصمة"), title("«اسم العاصمة»", [], "l")], { tr: "mask", media: photo("tokyo city skyline", "in") }),
      s(3.5, "السكان", [stat(125, "مليون نسمة")], { tr: "slide" }),
      s(3.5, "المساحة", [stat(378, "ألف كم²")], { tr: "slide" }),
      s(3.5, "العملة واللغة", [cmp("العملة", ["«…»"], "اللغة", ["«…»"])], { tr: "slide" }),
      s(4, "حقيقة غريبة", [emoji("🤯", "wiggle"), title("«الحقيقة»", [], "m")], { tr: "iris" }),
    ],
    end: { text: "أي دولة بعدها؟", cta: "اكتبها في التعليقات", seconds: 3 },
  },
  {
    id: "geo-strange-place", cat: "geo", name: "أغرب مكان", kind: "reel", theme: "documentary", accent: "#14b8a6", mood: "calm", grade: "vivid", pictures: true,
    style: "سفر سينمائي بألوان زاهية: لقطة متحركة للمكان، أين هو، لماذا هو غريب.",
    scenes: [
      s(4.5, "الخطّاف", [kin(["مكان «لا يُصدَّق»", "موجود فعلًا"], ["فعلًا"])], { tr: "fade", media: clip("waterfall aerial nature", 0.5) }),
      s(4.5, "أين", [title("«البلد / المنطقة»", [], "m")], { tr: "zoom", place: "top", media: map({ focus: ["IS"] }) }),
      s(4, "الصورة", [{ type: "photo", wiki: "«اسم المكان بالإنجليزية»", frame: "wide", caption: "«الاسم»" }], { tr: "mask" }),
      s(4.5, "لماذا غريب", [kick("السر"), title("«التفسير»", [], "m")], { tr: "slide", media: photo("volcano landscape", "left") }),
      s(4, "معلومة عملية", [kick("لزيارته"), title("«أفضل وقت / السعر»", [], "m")], { tr: "fade" }),
    ],
    end: { text: "هل تزوره؟", cta: "احفظ الفيديو", seconds: 3 },
  },
  {
    id: "geo-city-guide", cat: "geo", name: "دليل مدينة", kind: "reel", theme: "kinetic", accent: "#f43f5e", mood: "upbeat", pictures: true,
    style: "سفر حيوي: 5 أماكن لا تفوّت بالصور، والميزانية في النهاية.",
    scenes: [
      s(3.5, "العنوان", [kin(["5 أماكن في", "«المدينة»"], ["5"])], { tr: "cut", media: clip("city street walking", 0.55) }),
      s(4, "مكان 1", [kick("1"), title("«المكان»", [], "m")], { tr: "slide", media: photo("old town street", "in") }),
      s(4, "مكان 2", [kick("2"), title("«المكان»", [], "m")], { tr: "slide", media: photo("market bazaar", "left") }),
      s(4, "مكان 3", [kick("3"), title("«المكان»", [], "m")], { tr: "slide", media: photo("beach sunset", "right") }),
      s(4, "مكان 4", [kick("4"), title("«المكان»", [], "m")], { tr: "slide", media: photo("restaurant food", "up") }),
      s(4, "مكان 5", [kick("5"), title("«المكان»", [], "m")], { tr: "slide", media: photo("viewpoint panorama", "in") }),
      s(4, "الميزانية", [stat(80, "«يورو / يوميًا»", { suffix: " €" })], { tr: "zoom" }),
    ],
    end: { text: "احفظه لرحلتك", cta: "تابع", seconds: 2.5 },
  },
  {
    id: "geo-two-cities", cat: "geo", name: "مدينتان: أين تعيش؟", kind: "explainer", theme: "infographic", accent: "#8b5cf6", mood: "upbeat", pictures: true,
    style: "مقارنة معيشة: صورتا المدينتين، الإيجار، الرواتب، الأمان، والحكم.",
    scenes: [
      s(3.5, "السؤال", [kin(["«المدينة 1»", "أم «المدينة 2»؟"], ["أم"])], { tr: "cut" }),
      s(4, "الصورتان", [pic("city skyline day", "card", "«1»"), pic("city skyline night", "card", "«2»")], { tr: "zoom" }),
      s(4.5, "الإيجار", [kick("الإيجار الشهري"), bars([["«1»", 900], ["«2»", 1500]], " €")], { tr: "whip" }),
      s(4.5, "الراتب", [kick("متوسط الراتب"), bars([["«1»", 2000], ["«2»", 3200]], " €")], { tr: "whip" }),
      s(4.5, "الأمان والجو", [cmp("«1»", ["«…»", "«…»"], "«2»", ["«…»", "«…»"])], { tr: "slide" }),
      s(4, "الحكم", [kin(["«لمن تناسب كل مدينة»"], [])], { tr: "fade" }),
    ],
    end: { text: "أين تختار؟", cta: "علّق", seconds: 3 },
  },

  /* ================= health ================= */
  {
    id: "hea-habit", cat: "health", name: "عادة صحية", kind: "reel", theme: "infographic", accent: "#10b981", mood: "calm", pictures: true,
    style: "نظيف ومريح بالأخضر: عادة واحدة، فوائدها، وكيف تبدأ اليوم.",
    scenes: [
      s(4, "الخطّاف", [emoji("🚶", "bounce"), title("«العادة» لمدة «…» يوميًا", [], "m")], { tr: "rise", media: photo("morning walk park", "in") }),
      s(4.5, "ماذا يحدث لجسمك", [list(["«فائدة 1»", "«فائدة 2»", "«فائدة 3»"])], { tr: "slide" }),
      s(4, "الرقم", [stat(30, "«ما يعنيه»", { suffix: "%" })], { tr: "zoom" }),
      s(4.5, "كيف تبدأ", [kick("ابدأ اليوم"), title("«خطوة صغيرة»", [], "m")], { tr: "mask", media: photo("healthy lifestyle", "left") }),
    ],
    end: { text: "معلومة عامة — ليست نصيحة طبية", cta: "تابع", seconds: 3 },
  },
  {
    id: "hea-myth", cat: "health", name: "خرافة أم حقيقة؟", kind: "explainer", theme: "kinetic", accent: "#ef4444", mood: "playful", pictures: false,
    style: "لعبة سريعة: خرافة ❌ وحقيقة ✅ في كل شاشة، ثلاث جولات.",
    scenes: [
      s(3, "العنوان", [kin(["خرافة", "أم حقيقة؟"], ["أم"])], { tr: "cut" }),
      s(4, "الجولة 1", [emoji("❌", "wiggle"), title("«الخرافة الشائعة»", [], "m")], { tr: "whip" }),
      s(4, "الحقيقة 1", [emoji("✅", "pulse"), title("«الحقيقة»", [], "m")], { tr: "flash" }),
      s(4, "الجولة 2", [emoji("❌", "wiggle"), title("«الخرافة»", [], "m")], { tr: "whip" }),
      s(4, "الحقيقة 2", [emoji("✅", "pulse"), title("«الحقيقة»", [], "m")], { tr: "flash" }),
      s(4, "الجولة 3", [emoji("❌", "wiggle"), title("«الخرافة»", [], "m")], { tr: "whip" }),
      s(4, "الحقيقة 3", [emoji("✅", "pulse"), title("«الحقيقة»", [], "m")], { tr: "flash", fx: ["confetti"] }),
    ],
    end: { text: "كم واحدة كنت تصدّق؟", cta: "علّق", seconds: 3 },
  },
  {
    id: "hea-routine", cat: "health", name: "روتين تمارين", kind: "reel", theme: "kinetic", accent: "#f97316", mood: "upbeat", pictures: true,
    style: "رياضي نشيط بالبرتقالي: تمرين في كل شاشة مع المدة، وعدّاد.",
    scenes: [
      s(3.5, "العنوان", [kin(["روتين «10» دقائق", "«للهدف»"], ["«10»"])], { tr: "cut", media: clip("workout fitness training", 0.55) }),
      s(4, "تمرين 1", [kick("«المدة»"), title("«التمرين»", [], "m")], { tr: "slide", media: photo("push ups exercise", "in") }),
      s(4, "تمرين 2", [kick("«المدة»"), title("«التمرين»", [], "m")], { tr: "slide", media: photo("squat exercise", "left") }),
      s(4, "تمرين 3", [kick("«المدة»"), title("«التمرين»", [], "m")], { tr: "slide", media: photo("plank exercise", "right") }),
      s(4, "التكرار", [stat(3, "جولات", { suffix: "×" })], { tr: "zoom" }),
    ],
    end: { text: "جرّبه اليوم وأخبرنا", cta: "احفظه", seconds: 2.5 },
  },

  /* ================= sports ================= */
  {
    id: "spo-player-numbers", cat: "sports", name: "لاعب في أرقام", kind: "data", theme: "neon", accent: "#22c55e", mood: "epic", pictures: true,
    style: "ملحمي رياضي: صورة اللاعب من ويكيبيديا، علم بلده، أرقام تعدّ، ولقب.",
    scenes: [
      s(4, "اللاعب", [person("«اسم اللاعب»", "«النادي / المنتخب»")], { tr: "zoom", media: clip("stadium crowd lights", 0.65) }),
      s(3.5, "البلد", [flags([["AR", "«البلد»"]])], { tr: "slide" }),
      s(3.5, "الأهداف", [stat(800, "هدف")], { tr: "flash" }),
      s(3.5, "الألقاب", [stat(40, "لقبًا")], { tr: "flash" }),
      s(3.5, "الجوائز", [stat(8, "«الجائزة الكبرى»", { suffix: "×" })], { tr: "flash", fx: ["sparkles"] }),
      s(4.5, "أفضل لحظة", [kick("«السنة»"), title("«اللحظة الأشهر»", [], "m")], { tr: "fade" }),
    ],
    end: { text: "الأفضل في التاريخ؟", cta: "علّق", seconds: 3 },
  },
  {
    id: "spo-match", cat: "sports", name: "مباراة لا تُنسى", kind: "documentary", theme: "kinetic", accent: "#facc15", mood: "epic", pictures: true,
    style: "إثارة: العلمان/الناديان، الدقائق الحاسمة على خط زمني، والنتيجة.",
    scenes: [
      s(4, "المواجهة", [flags([["MA", "«الفريق 1»"], ["PT", "«الفريق 2»"]], true)], { tr: "cut", media: clip("football stadium", 0.65) }),
      s(3.5, "البطولة", [kick("«البطولة — السنة»"), title("«الدور»", [], "l")], { tr: "zoom" }),
      s(6, "الدقائق الحاسمة", [tline([["«د»", "«حدث»"], ["«د»", "«حدث»"], ["«د»", "«الهدف»"]])], { tr: "rise" }),
      s(4, "النتيجة", [kin(["«1 – 0»"], ["«1 – 0»"])], { tr: "flash", fx: ["confetti"] }),
      s(4.5, "لماذا لا تُنسى", [kick("لماذا خالدة"), title("«السبب»", [], "m")], { tr: "fade" }),
    ],
    end: { text: "أين كنت يومها؟", cta: "علّق", seconds: 3 },
  },
  {
    id: "spo-vs-players", cat: "sports", name: "لاعب ضد لاعب", kind: "data", theme: "neon", accent: "#f43f5e", mood: "epic", pictures: true,
    style: "مواجهة رقمية: صورتان، جولات إحصاءات بالأعمدة، والحكم.",
    scenes: [
      s(4, "اللاعب 1", [person("«اللاعب 1»", "«الفريق»")], { tr: "slide" }),
      s(4, "اللاعب 2", [person("«اللاعب 2»", "«الفريق»")], { tr: "slide" }),
      s(4, "الأهداف", [kick("الأهداف"), bars([["«1»", 850], ["«2»", 900]])], { tr: "whip" }),
      s(4, "الألقاب", [kick("الألقاب"), bars([["«1»", 45], ["«2»", 35]])], { tr: "whip" }),
      s(4, "الجوائز الفردية", [kick("الجوائز"), bars([["«1»", 8], ["«2»", 5]])], { tr: "whip" }),
      s(4, "الحكم", [kin(["«من الأفضل؟»"], [])], { tr: "flash", fx: ["rings"] }),
    ],
    end: { text: "فريق من أنت؟", cta: "علّق", seconds: 3 },
  },

  /* ================= motivation ================= */
  {
    id: "mot-quote", cat: "motivation", name: "اقتباس ملهم", kind: "quote", theme: "documentary", accent: "#e5e7eb", mood: "calm", grade: "mono", pictures: true,
    style: "أبيض وأسود هادئ: لقطة متحركة، اقتباس كبير، صاحبه، وجملة تأمل.",
    scenes: [
      s(5, "اللقطة والجملة الأولى", [kin(["«بداية الاقتباس»"], [])], { tr: "fade", media: clip("ocean waves slow motion", 0.6) }),
      s(5.5, "الاقتباس كاملًا", [quote("«الاقتباس»", "«صاحبه»")], { tr: "fade", media: photo("mountain fog sunrise", "in", 0.6) }),
      s(4.5, "التأمل", [kin(["«ماذا يعني لك اليوم»"], [])], { tr: "fade", fx: ["dust"] }),
    ],
    end: { text: "شاركه مع من يحتاجه", cta: "تابع", seconds: 3 },
  },
  {
    id: "mot-success-rule", cat: "motivation", name: "قاعدة نجاح", kind: "explainer", theme: "kinetic", accent: "#f59e0b", mood: "epic", pictures: true,
    style: "تحفيزي قوي بالذهبي: القاعدة، رقم يثبتها، مثال شخصية، وتحدٍّ.",
    scenes: [
      s(3.5, "القاعدة", [kin(["قاعدة «الاسم»"], [])], { tr: "cut", media: clip("runner sunrise", 0.6) }),
      s(4.5, "في سطر", [title("«القاعدة في سطر»", [], "m")], { tr: "zoom" }),
      s(4, "الرقم", [stat(1, "«تحسّن يوميًا = 37 ضعفًا في سنة»", { suffix: "%" })], { tr: "flash" }),
      s(4.5, "من طبّقها", [person("«الشخصية»", "«الإنجاز»")], { tr: "mask" }),
      s(4, "التحدي", [kin(["تحدي اليوم:", "«الخطوة»"], ["تحدي"])], { tr: "fade", fx: ["sparkles"] }),
    ],
    end: { text: "ابدأ الآن", cta: "تابع", seconds: 2.5 },
  },
  {
    id: "mot-3-lessons", cat: "motivation", name: "3 دروس", kind: "reel", theme: "storybook", accent: "#ec4899", mood: "upbeat", pictures: false,
    style: "دافئ بالإيموجي: ثلاثة دروس قصيرة، كل درس في شاشة.",
    scenes: [
      s(3.5, "العنوان", [emoji("📝", "bounce"), title("3 دروس «من أين»", ["3"], "l")], { tr: "rise" }),
      s(4, "الدرس 1", [emoji("🌱", "float"), title("«الدرس»", [], "m")], { tr: "slide" }),
      s(4, "الدرس 2", [emoji("⏳", "spin"), title("«الدرس»", [], "m")], { tr: "slide" }),
      s(4, "الدرس 3", [emoji("🔥", "pulse"), title("«الدرس»", [], "m")], { tr: "slide" }),
      s(3.5, "الخلاصة", [kin(["«أهمها»"], [])], { tr: "zoom", fx: ["sparkles"] }),
    ],
    end: { text: "أي درس تحتاجه؟", cta: "علّق", seconds: 3 },
  },
  {
    id: "mot-struggle", cat: "motivation", name: "قصة كفاح", kind: "documentary", theme: "documentary", accent: "#f59e0b", mood: "epic", grade: "warm", pictures: true,
    style: "قصة إنسانية دافئة: من الصفر إلى القمة على خط زمني، ولحظة الانكسار.",
    scenes: [
      s(4.5, "الخطّاف", [kin(["رُفض «عدد» مرة", "ثم «النجاح»"], ["رُفض"])], { tr: "fade", media: clip("rain window lonely", 0.6) }),
      s(4.5, "من هو", [person("«الاسم»", "«من هو اليوم»")], { tr: "zoom" }),
      s(4, "الصفر", [kick("البداية"), title("«كيف كانت حياته»", [], "m")], { tr: "mask", media: photo("poor neighborhood street", "in") }),
      s(4, "الانكسار", [kick("أصعب لحظة"), title("«ماذا حدث»", [], "m")], { tr: "glitch" }),
      s(4.5, "النهوض", [kick("ثم"), title("«القرار الذي غيّر كل شيء»", [], "m")], { tr: "fade", media: photo("sunrise mountain top", "up") }),
      s(4, "اليوم", [stat(100, "«إنجازه بالأرقام»")], { tr: "zoom", fx: ["lightleak"] }),
    ],
    end: { text: "قصتك لم تنتهِ بعد", cta: "تابع", seconds: 3 },
  },

  /* ================= culture ================= */
  {
    id: "cul-fact", cat: "culture", name: "معلومة ثقافية", kind: "reel", theme: "storybook", accent: "#0d9488", mood: "calm", pictures: true,
    style: "ناعم وأنيق: سؤال، صورة، الجواب، ومعلومة إضافية.",
    scenes: [
      s(4, "السؤال", [emoji("❓", "wiggle"), title("«سؤال ثقافي»", [], "m")], { tr: "rise" }),
      s(4.5, "الصورة", [pic("museum art", "polaroid", "«تعليق»")], { tr: "zoom" }),
      s(4.5, "الجواب", [kick("الجواب"), title("«الجواب»", [], "m")], { tr: "mask" }),
      s(4, "وأيضًا", [kin(["وأيضًا:", "«معلومة إضافية»"], ["وأيضًا:"])], { tr: "fade", fx: ["sparkles"] }),
    ],
    end: { text: "هل كنت تعرفها؟", cta: "علّق", seconds: 3 },
  },
  {
    id: "cul-book", cat: "culture", name: "كتاب في دقيقة", kind: "explainer", theme: "storybook", accent: "#92400e", mood: "calm", grade: "warm", pictures: true,
    style: "مكتبة دافئة: غلاف/صورة الكتاب، المؤلف، 3 أفكار، واقتباس.",
    scenes: [
      s(4, "الكتاب", [pic("book reading library", "polaroid", "«عنوان الكتاب»")], { tr: "rise" }),
      s(4, "المؤلف", [person("«المؤلف»", "«من هو»")], { tr: "slide" }),
      s(4, "الفكرة 1", [kick("1"), title("«الفكرة»", [], "m")], { tr: "slide" }),
      s(4, "الفكرة 2", [kick("2"), title("«الفكرة»", [], "m")], { tr: "slide" }),
      s(4, "الفكرة 3", [kick("3"), title("«الفكرة»", [], "m")], { tr: "slide" }),
      s(5, "اقتباس منه", [quote("«اقتباس»", "«المؤلف»")], { tr: "fade" }),
    ],
    end: { text: "أي كتاب بعده؟", cta: "اقترح في التعليقات", seconds: 3 },
  },
  {
    id: "cul-proverb", cat: "culture", name: "مثل وحكايته", kind: "quote", theme: "storybook", accent: "#7c3aed", mood: "playful", pictures: false,
    style: "حكاية كرتونية: المثل، قصته في 3 مشاهد بالإيموجي، ومعناه اليوم.",
    scenes: [
      s(4, "المثل", [kick("مثل يقول"), title("«المثل»", [], "m")], { tr: "rise", fx: ["sparkles"] }),
      s(4, "الحكاية 1", [emoji("🐪", "bounce"), title("«بداية الحكاية»", [], "m")], { tr: "slide" }),
      s(4, "الحكاية 2", [emoji("🏜️", "float"), title("«ما حدث»", [], "m")], { tr: "slide" }),
      s(4, "الحكاية 3", [emoji("💡", "pulse"), title("«النهاية»", [], "m")], { tr: "slide" }),
      s(4, "المعنى", [kin(["المعنى:", "«المعنى اليوم»"], ["المعنى:"])], { tr: "zoom" }),
    ],
    end: { text: "ما مثلكم المفضل؟", cta: "علّق", seconds: 3 },
  },

  /* ================= marketing ================= */
  {
    id: "mkt-product-ad", cat: "marketing", name: "إعلان منتج", kind: "promo", theme: "kinetic", accent: "#ec4899", mood: "upbeat", grade: "vivid", pictures: true,
    style: "إعلان لامع: المشكلة، المنتج بالصورة، 3 مزايا، السعر، وزر الطلب.",
    scenes: [
      s(3.5, "المشكلة", [kin(["«هل تعاني من…؟»"], [])], { tr: "cut" }),
      s(4, "المنتج", [pic("product studio shot", "card", "«اسم المنتج»")], { tr: "zoom", fx: ["sparkles"] }),
      s(4.5, "المزايا", [list(["«ميزة 1»", "«ميزة 2»", "«ميزة 3»"])], { tr: "slide" }),
      s(3.5, "السعر", [stat(199, "«درهم فقط»", { suffix: " درهم" })], { tr: "flash" }),
      s(4, "الطلب", [title("«التوصيل مجاني»", [], "m"), cta("اطلب الآن")], { tr: "zoom", fx: ["confetti"] }),
    ],
    end: { text: "«رقم الطلب / الرابط»", cta: "اطلب الآن", seconds: 3 },
  },
  {
    id: "mkt-sale", cat: "marketing", name: "تخفيضات", kind: "promo", theme: "kinetic", accent: "#ef4444", mood: "upbeat", pictures: false,
    style: "عرض صاخب بالأحمر: نسبة الخصم ضخمة، عدّ تنازلي، وزر.",
    scenes: [
      s(3, "العرض", [kin(["تخفيضات", "«المناسبة»"], ["تخفيضات"])], { tr: "cut", fx: ["confetti"], fxEmoji: "🛍️" }),
      s(3.5, "الخصم", [stat(50, "على كل «الفئة»", { suffix: "%" })], { tr: "flash", fx: ["shake"] }),
      s(4, "أمثلة", [cmp("قبل", ["«السعر»"], "الآن", ["«السعر»"])], { tr: "whip" }),
      s(3.5, "المدة", [kick("ينتهي خلال"), title("«48 ساعة»", ["«48»"], "xl")], { tr: "zoom" }),
      s(3.5, "الطلب", [cta("تسوّق الآن")], { tr: "zoom" }),
    ],
    end: { text: "«الرابط»", cta: "الآن", seconds: 2.5 },
  },
  {
    id: "mkt-before-after", cat: "marketing", name: "قبل وبعد", kind: "promo", theme: "infographic", accent: "#14b8a6", mood: "upbeat", pictures: true,
    style: "تحوّل واضح: صورة قبل، صورة بعد، المدة، والنتيجة بالأرقام.",
    scenes: [
      s(3.5, "الوعد", [kin(["من «…»", "إلى «…»"], [])], { tr: "cut" }),
      s(4, "قبل", [kick("قبل"), pic("messy room", "card")], { tr: "slide" }),
      s(4, "بعد", [kick("بعد"), pic("clean modern room", "card")], { tr: "whip", fx: ["sparkles"] }),
      s(3.5, "في كم؟", [stat(7, "أيام فقط")], { tr: "zoom" }),
      s(4, "كيف", [list(["«خطوة»", "«خطوة»", "«خطوة»"])], { tr: "slide" }),
    ],
    end: { text: "«الخدمة / المنتج»", cta: "اطلب الآن", seconds: 3 },
  },
  {
    id: "mkt-feature", cat: "marketing", name: "ميزة تبيع", kind: "promo", theme: "neon", accent: "#6366f1", mood: "tech", pictures: true,
    style: "عرض تطبيق/خدمة: ميزة واحدة قوية، كيف تعمل في 3 خطوات، والنتيجة.",
    scenes: [
      s(3.5, "الميزة", [kin(["«الميزة»", "في ثوانٍ"], ["ثوانٍ"])], { tr: "glitch" }),
      s(4, "الشاشة", [pic("app interface laptop", "wide", "«اسم الخدمة»")], { tr: "zoom" }),
      s(4, "خطوة 1", [kick("1"), title("«…»", [], "m")], { tr: "slide" }),
      s(4, "خطوة 2", [kick("2"), title("«…»", [], "m")], { tr: "slide" }),
      s(4, "خطوة 3", [kick("3"), title("«…»", [], "m")], { tr: "slide" }),
      s(3.5, "النتيجة", [stat(10, "«ساعات توفّرها أسبوعيًا»", { suffix: "×" })], { tr: "flash" }),
    ],
    end: { text: "جرّبها مجانًا", cta: "«الرابط»", seconds: 3 },
  },

  /* ================= education ================= */
  {
    id: "edu-concept", cat: "education", name: "مفهوم في 60 ثانية", kind: "explainer", theme: "infographic", accent: "#2563eb", mood: "calm", pictures: true,
    style: "درس نظيف: التعريف، مثال، رسم بالأرقام، وخطأ شائع.",
    scenes: [
      s(3.5, "المفهوم", [kick("في 60 ثانية"), title("«المفهوم»", ["«المفهوم»"], "xl")], { tr: "rise" }),
      s(4.5, "التعريف", [title("«التعريف في سطر»", [], "m")], { tr: "slide" }),
      s(4.5, "مثال", [emoji("🧩", "float"), title("«مثال يومي»", [], "m")], { tr: "slide" }),
      s(4.5, "بالأرقام", [bars([["«أ»", 70], ["«ب»", 30]], "%")], { tr: "zoom" }),
      s(4.5, "خطأ شائع", [emoji("⚠️", "wiggle"), title("«الخطأ»", [], "m")], { tr: "whip" }),
      s(4, "الخلاصة", [kin(["«تذكّر هذا»"], [])], { tr: "fade" }),
    ],
    end: { text: "«المفهوم التالي؟»", cta: "تابع", seconds: 3 },
  },
  {
    id: "edu-howto", cat: "education", name: "كيف تفعل… خطوة بخطوة", kind: "explainer", theme: "infographic", accent: "#16a34a", mood: "upbeat", pictures: true,
    style: "دليل عملي: النتيجة أولًا، ثم خطوات مرقّمة كل واحدة في شاشة، ونصيحة.",
    scenes: [
      s(3.5, "النتيجة", [kin(["كيف «تفعل…»", "في «5» خطوات"], ["«5»"])], { tr: "cut", media: photo("desk workspace laptop", "in") }),
      s(3.5, "خطوة 1", [kick("1"), title("«الخطوة»", [], "m")], { tr: "slide" }),
      s(3.5, "خطوة 2", [kick("2"), title("«الخطوة»", [], "m")], { tr: "slide" }),
      s(3.5, "خطوة 3", [kick("3"), title("«الخطوة»", [], "m")], { tr: "slide" }),
      s(3.5, "خطوة 4", [kick("4"), title("«الخطوة»", [], "m")], { tr: "slide" }),
      s(3.5, "خطوة 5", [kick("5"), title("«الخطوة»", [], "m")], { tr: "slide" }),
      s(4, "نصيحة", [emoji("💡", "pulse"), title("«نصيحة ذهبية»", [], "m")], { tr: "zoom" }),
    ],
    end: { text: "احفظ الفيديو", cta: "تابع", seconds: 2.5 },
  },
  {
    id: "edu-quiz", cat: "education", name: "اختبر نفسك", kind: "reel", theme: "kinetic", accent: "#8b5cf6", mood: "playful", pictures: false,
    style: "مسابقة: سؤال، عدّ 3 ثوانٍ، الجواب — ثلاث جولات.",
    scenes: [
      s(3, "العنوان", [kin(["اختبر نفسك", "«الموضوع»"], ["اختبر"])], { tr: "cut" }),
      s(4.5, "سؤال 1", [kick("سؤال 1"), title("«السؤال»", [], "m")], { tr: "slide" }),
      s(3, "جواب 1", [emoji("✅", "pulse"), title("«الجواب»", [], "m")], { tr: "flash" }),
      s(4.5, "سؤال 2", [kick("سؤال 2"), title("«السؤال»", [], "m")], { tr: "slide" }),
      s(3, "جواب 2", [emoji("✅", "pulse"), title("«الجواب»", [], "m")], { tr: "flash" }),
      s(4.5, "سؤال 3", [kick("سؤال 3 — الأصعب"), title("«السؤال»", [], "m")], { tr: "slide" }),
      s(3, "جواب 3", [emoji("🏆", "bounce"), title("«الجواب»", [], "m")], { tr: "flash", fx: ["confetti"] }),
    ],
    end: { text: "كم جوابًا صحيحًا؟", cta: "علّق", seconds: 3 },
  },
];

/* ---------------------------------------------------------------- rhythm */

const LEAD_SKIP = new Set(["kicker", "source", "lowerThird", "sfx"]);
const leadOf = (sc: SceneSpec) => sc.items.find(i => !LEAD_SKIP.has(String(i.type)))?.type as string | undefined;
const EMOJI_FOR: Record<string, string> = { stat: "📈", person: "⭐", bars: "📊" };

/**
 * A series (steps, rounds, rankings) must not look the same three times in a row: every second scene of a run gets
 * another hero — a title becomes kinetic type, an emoji moves behind its title, bars become a face-off, a number or a
 * portrait gets a leading emoji.
 */
function vary(scenes: SceneSpec[]): SceneSpec[] {
  const out = scenes.map(sc => ({ ...sc, items: [...sc.items] }));
  for (let i = 1; i < out.length - 1; i++) {
    const a = leadOf(out[i - 1]), b = leadOf(out[i]), c = leadOf(out[i + 1]);
    if (!b || a !== b || b !== c) continue;
    const items = out[i].items;
    const k = items.findIndex(it => it.type === b);
    const it = items[k];
    if (b === "title") items[k] = kin([String(it.text)], (it.emphasis as string[]) ?? []);
    else if (b === "emoji" && items[k + 1]) [items[k], items[k + 1]] = [items[k + 1], items[k]];
    else if (b === "bars" && Array.isArray(it.items) && it.items.length === 2) {
      const [l, r] = it.items as { label: string; value: number }[];
      const unit = String(it.unit ?? "");
      items[k] = cmp(l.label, [`${l.value.toLocaleString("en-US")}${unit}`], r.label, [`${r.value.toLocaleString("en-US")}${unit}`]);
    } else items.splice(k, 0, emoji(EMOJI_FOR[b] ?? "✨", "pulse", 170));
  }
  return out;
}
for (const t of VIDEO_TEMPLATES) t.scenes = vary(t.scenes);

/* ---------------------------------------------------------------- use */

/** The template as a storyboard (times laid out back to back; the end card takes the last seconds). */
export function templateStoryboard(t: VideoTemplate) {
  let at = 0;
  const scenes = t.scenes.map(sc => {
    const scene = {
      from: +at.toFixed(2),
      to: +(at + sc.sec).toFixed(2),
      transition: sc.tr ?? "fade",
      ...(sc.cam ? { camera: sc.cam } : {}),
      ...(sc.fx ? { fx: sc.fx } : {}),
      ...(sc.fxEmoji ? { fxEmoji: sc.fxEmoji } : {}),
      ...(sc.place ? { place: sc.place } : {}),
      ...(sc.media ? { media: sc.media } : {}),
      note: sc.guide,
      items: sc.items,
    };
    at += sc.sec;
    return scene;
  });
  const endSec = t.end?.seconds ?? 0;
  return {
    title: t.name,
    theme: t.theme,
    ...(t.accent ? { accent: t.accent } : {}),
    lang: "ar",
    progress: true,
    ...(t.grade && t.grade !== "theme" ? { grade: t.grade } : {}),
    sound: { mood: t.mood },
    scenes,
    ...(t.end ? { end: t.end } : {}),
    // Not a storyboard field: the suggested length (scenes + end card).
    seconds: Math.round(at + endSec),
  };
}

export function templateSeconds(t: VideoTemplate) {
  return Math.round(t.scenes.reduce((a, sc) => a + sc.sec, 0) + (t.end?.seconds ?? 0));
}

/** The scenario sheet the owner fills in: one line per scene, saying what goes there. */
export function templateScenario(t: VideoTemplate) {
  const lines = t.scenes.map((sc, i) => `المشهد ${i + 1} (${sc.sec} ث) — ${sc.guide}: `);
  if (t.end) lines.push(`الخاتمة — ${t.end.kicker ? `${t.end.kicker} / ` : ""}جملة أخيرة ودعوة: `);
  return [`الموضوع: `, `المصادر (روابط أو أسماء) لكل رقم: `, ``, ...lines].join("\n");
}

/** What the director / any AI is told: keep this template's structure and style, fill it with the scenario. */
export function templateBrief(t: VideoTemplate, scenario: string) {
  const sb = templateStoryboard(t);
  return `TEMPLATE — "${t.name}" (${t.style})
Keep this template: its theme, colours, music mood, grade, the ORDER and TYPE of scenes, their transitions, media kinds and rhythm. Replace every «placeholder» with the owner's content from the SCENARIO below (real names, numbers, places, ISO country codes, English search words for photos, exact English Wikipedia titles for named people and places). You may add or remove a scene of the same kind when the scenario has more or fewer points, and adjust durations so each scene reads comfortably. Keep screens airy: one idea per scene, at most ~12 words on screen. Never invent facts: if the scenario lacks a number or a name, drop that scene rather than guess. Remove the "seconds" field.
TEMPLATE STORYBOARD:
${JSON.stringify(sb)}

SCENARIO (written by the owner, Arabic):
${scenario.trim() || "(empty — use the topic in the idea)"}`;
}

export function findTemplate(id: string | null | undefined) {
  return VIDEO_TEMPLATES.find(t => t.id === id) ?? null;
}
