/**
 * Measured problems of an animation (pure): raw renderer measurements → issues in Arabic with numbers, and the message
 * to paste back into the AI that wrote it. Used by «افحص الكود», «أصلحه لي» and the director's checks.
 */
import type { CodeIssue } from "../../shared/code-video";
import type { RawInspection } from "../worker/code-video";

const IGNORE_CONSOLE = /favicon|DevTools|third-party cookie/i;

/** Pure: raw measurements → issues (Arabic, with numbers), most serious first. */
export function issuesFrom(raw: RawInspection, durationSec: number, width: number, height: number): CodeIssue[] {
  const out: CodeIssue[] = [];
  const blocked = [...raw.blocked];
  const errors: string[] = [];
  let failedLoads = 0;
  for (const e of raw.consoleErrors) {
    if (IGNORE_CONSOLE.test(e)) continue;
    const csp = /Loading the \w+ '([^']+)' violates|Refused to \w+ [^']*'([^']+)'/.exec(e);
    if (csp) blocked.push(csp[1] ?? csp[2]);
    else if (/^Failed to load resource/i.test(e)) failedLoads++;
    else if (!errors.includes(e)) errors.push(e);
  }
  for (const e of errors.slice(0, 4)) out.push({ code: "script", severity: "error", message: `خطأ في السكربت: ${e}` });
  if (failedLoads && !blocked.length) out.push({ code: "load", severity: "warn", message: `تعذر تحميل ${failedLoads} ملف (مكتبة أو خط) — تأكد من الروابط وأن الجهاز متصل بالإنترنت` });
  for (const u of [...new Set(blocked)].slice(0, 4)) {
    out.push({ code: "blocked", severity: "error", message: `طلب رابطًا غير مسموح وسيُمنع أثناء التصوير: ${u} — ارسمه بـ CSS/SVG أو استعمل cdnjs/jsdelivr/Google Fonts فقط` });
  }
  if (raw.loops) out.push({ code: "loop", severity: "warn", message: "فيه حركة تتكرر بلا نهاية (repeat:-1 أو infinite) — مقبول للخلفية فقط، أما الخط الزمني الرئيسي فيجب أن ينتهي" });
  if (raw.timelineSec === null) {
    out.push({ code: "no-timeline", severity: "warn", message: "لم أجد خطًا زمنيًا (GSAP أو CSS animations) — إن كانت الحركة بـ setInterval أو تعتمد على الوقت الحقيقي فقد تخرج مختلفة في الفيديو" });
  } else if (raw.timelineSec < durationSec - 2.5) {
    out.push({ code: "short", severity: "error", message: `الحركة تنتهي عند ${raw.timelineSec.toFixed(1)} ث والفيديو ${durationSec} ث — آخر ${(durationSec - raw.timelineSec).toFixed(1)} ث ستكون صورة ثابتة` });
  } else if (raw.timelineSec > durationSec + 0.5) {
    out.push({ code: "long", severity: "error", message: `الحركة مدتها ${raw.timelineSec.toFixed(1)} ث والفيديو ${durationSec} ث — سيُقطع ما بعد الثانية ${durationSec}` });
  }

  const at = (list: { t: number; items: string[] }[]) => list.filter(x => x.items.length);
  const overflow = at(raw.findings.map(f => ({ t: f.t, items: f.overflow })));
  if (overflow.length) out.push({ code: "overflow", severity: "error", message: `عناصر تخرج من الإطار ${width}×${height}: ${overflow.slice(0, 3).map(x => `عند ${x.t}ث ${x.items.slice(0, 2).join("، ")}`).join(" | ")}` });
  const overlaps = at(raw.findings.map(f => ({ t: f.t, items: f.overlaps })));
  if (overlaps.length) out.push({ code: "overlap", severity: "error", message: `نصوص فوق بعضها: ${overlaps.slice(0, 3).map(x => `عند ${x.t}ث ${x.items[0]}`).join(" | ")}` });
  const min = height > width ? 34 : 28;
  const small = at(raw.findings.map(f => ({ t: f.t, items: f.small })));
  if (small.length) out.push({ code: "small", severity: "warn", message: `نص صغير على الهاتف (أقل من ${min}px): ${[...new Set(small.flatMap(x => x.items))].slice(0, 4).join("، ")}` });
  const split = Math.max(0, ...raw.findings.map(f => f.splitArabic));
  if (split >= 3) out.push({ code: "split-arabic", severity: "error", message: `الكلمات العربية مقسّمة حرفًا حرفًا (${split} قطعة) — الحروف تنفصل ولا تتصل؛ حرّك الكلمة كاملة` });
  const spaced = [...new Set(raw.findings.flatMap(f => f.spacedArabic))];
  if (spaced.length) out.push({ code: "spaced-arabic", severity: "warn", message: `letter-spacing على نص عربي يكسر اتصال الحروف: ${spaced.slice(0, 3).join("، ")}` });
  const empty = raw.findings.filter(f => f.visibleTexts === 0 && f.t > 1 && f.t < durationSec - 1).map(f => f.t);
  if (empty.length >= 2) out.push({ code: "empty", severity: "warn", message: `لا يظهر أي نص عند ${empty.slice(0, 4).join("، ")} ث — تأكد أنه مقصود` });
  if (raw.still.length >= 2) out.push({ code: "dead-air", severity: "warn", message: `لا شيء يتحرك بين لقطات متتالية عند ${raw.still.slice(0, 4).join("، ")} ث — أضف حركة خفيفة (تقريب بطيء، خلفية تنجرف)` });
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

/** The message the owner pastes back into Gemini/DeepSeek. */
export function fixPromptFrom(issues: CodeIssue[], width: number, height: number, durationSec: number) {
  if (!issues.length) return "";
  return `جرّبت ملفك في مُصوِّر الفيديو (${width}×${height}، ${durationSec} ثانية) ووجدت هذه المشاكل:
${issues.map((x, i) => `${i + 1}. ${x.message}`).join("\n")}

أصلح كل نقطة دون تغيير الفكرة أو النصوص أو ترتيب المشاهد:
- كل الحركة على خط زمني GSAP واحد بأوقات مطلقة، وينتهي بـ tl.set({}, {}, ${durationSec}) لتكون المدة ${durationSec} ثانية بالضبط.
- لا شيء يخرج من الإطار، ولا نصّان في مكان واحد في نفس اللحظة (أخرِج القديم قبل دخول الجديد).
- العربي كلمات كاملة بلا letter-spacing و line-height ≥ 1.5.
أرجع الملف كاملاً فقط، بلا شرح.`;
}
