/**
 * "افحص الكود" and "أصلحه لي": pasted code from Gemini, DeepSeek or any AI is run exactly as the renderer will run it,
 * measured, and turned into (a) a list of concrete problems with numbers and (b) a ready message to paste back into
 * that AI. "أصلحه لي" hands the same findings to Claude (API or Claude Code) and checks the result again.
 */
import { MOTION_QUALITY_RULES, STYLE_RECIPES, codeVideoSize, type CodeInspection } from "../../shared/code-video";
import { inspectCode } from "../worker/code-video";
import { ask, extractHtml, rules, testRender } from "./code-agent";
import { fixPromptFrom, issuesFrom } from "./code-issues";
import type { CodeAgentEngine } from "../../shared/code-video";

export { fixPromptFrom, issuesFrom };

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
