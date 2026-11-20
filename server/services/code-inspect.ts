/**
 * "افحص الكود" and "أصلحه لي": pasted code from Gemini, DeepSeek or any AI is run exactly as the renderer will run it,
 * measured, and turned into (a) a list of concrete problems with numbers and (b) a ready message to paste back into
 * that AI. "أصلحه لي" hands the same findings to Claude (API or Claude Code) and checks the result again.
 */
import { MOTION_QUALITY_RULES, STYLE_RECIPES, codeVideoSize, type CodeInspection, type CodeIssue } from "../../shared/code-video";
import { inspectCode, type RawInspection } from "../worker/code-video";
import { ask, extractHtml, rules, testRender } from "./code-agent";
import type { CodeAgentEngine } from "../../shared/code-video";

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

export async function inspectPasted(input: { html: string; size: string; durationSec: number }): Promise<CodeInspection> {
  const { width, height } = codeVideoSize(input.size);
  const raw = await inspectCode({ html: input.html, width, height, durationSec: input.durationSec });
  const issues = issuesFrom(raw, input.durationSec, width, height);
  return {
    issues,
    timelineSec: raw.timelineSec,
    loops: raw.loops,
    stills: raw.stills.map(b => `data:image/jpeg;base64,${b.toString("base64")}`),
    stillTimes: raw.stillTimes,
    fixPrompt: fixPromptFrom(issues, width, height, input.durationSec),
  };
}

/** Claude fixes the pasted code using the measured problems, then the result is inspected again. */
export async function fixPasted(input: { html: string; size: string; durationSec: number; engine: CodeAgentEngine; styleId?: string }, userId?: number | null) {
  const { width, height } = codeVideoSize(input.size);
  const before = issuesFrom(await inspectCode({ html: input.html, width, height, durationSec: input.durationSec }), input.durationSec, width, height);
  const style = STYLE_RECIPES.find(s => s.id === input.styleId);
  const prompt = `Another AI wrote this animation for a ${input.durationSec}-second video (${width}x${height}). Keep its idea, its on-screen texts and its scene order, and fix it into a pro-quality piece.
Measured problems when it was run in the recorder:
${before.length ? before.map(x => `- [${x.code}] ${x.message}`).join("\n") : "- none measured; still polish motion, hierarchy and timing"}
${style ? `Apply this look: ${style.recipe}\n` : ""}Quality bar:
${MOTION_QUALITY_RULES.map(r => `- ${r}`).join("\n")}
Return the corrected complete file.

${input.html}`;
  const ref = { id: 0, userId, what: "إصلاح كود ملصوق" };
  let html = extractHtml(await ask(input.engine, rules(width, height, input.styleId), prompt, ref));
  const errors = await testRender(html, width, height);
  if (errors.length) {
    const retry = `${prompt}\n\nYour corrected file still failed the test render:\n- ${errors.slice(0, 6).join("\n- ")}\nReturn the corrected complete file.\n\n${html}`;
    html = extractHtml(await ask(input.engine, rules(width, height, input.styleId), retry, { ...ref, what: "إصلاح كود ملصوق (ثانية)" }));
  }
  let after = await inspectPasted({ html, size: input.size, durationSec: input.durationSec });
  const left = after.issues.filter(x => x.severity === "error");
  if (left.length) {
    // One more round on what is still measurably wrong; kept only if it is better.
    const again = `Your corrected file still has these measured problems:\n${left.map(x => `- [${x.code}] ${x.message}`).join("\n")}\nFix only these, change nothing else. Return the complete file.\n\n${html}`;
    const html2 = extractHtml(await ask(input.engine, rules(width, height, input.styleId), again, { ...ref, what: "إصلاح كود ملصوق (تشطيب)" }));
    const after2 = await inspectPasted({ html: html2, size: input.size, durationSec: input.durationSec });
    if (after2.issues.filter(x => x.severity === "error").length < left.length) {
      html = html2;
      after = after2;
    }
  }
  return { html, before, after };
}
