/**
 * The director: idea → storyboard → video page, with a quality loop.
 *
 *   1. The director (Claude) plans the video as a storyboard (scenes, timings, kit components) using the knowledge
 *      pack for this kind of video — no animation code, so nothing to break.
 *   2. The storyboard is normalised (exact timings, limits, reading time); structural problems go back once.
 *   3. It is compiled into a kit page and run like the renderer runs it: measured problems (text out of frame,
 *      overlaps, tiny text, script errors) are collected.
 *   4. A critic looks at the settled frame of every scene and scores it on a rubric (legibility, hierarchy,
 *      composition, story, polish). Below the bar, the director revises with the notes — up to `rounds` times —
 *      and the best-scoring version is kept.
 *
 * Model calls come in as `ask`, so the loop runs the same with the Claude API, Claude Code, or a test double.
 */
import type { CodeIssue } from "../../shared/code-video";
import type { KitTheme } from "../../shared/code-craft/kit";
import { CRITIC_RUBRIC, knowledgeFor, type CriticScores, type VideoKind } from "../../shared/code-craft/knowledge";
import { compileStoryboard, extractJsonObject, normalizeStoryboard, storyboardDoc, type Storyboard } from "../../shared/code-craft/storyboard";
import { captureStills, inspectCode } from "../worker/code-video";
import { issuesFrom } from "./code-issues";

export type Asker = (system: string, prompt: string, what: string, images?: Buffer[]) => Promise<string>;

export type ComposeOptions = {
  idea: string;
  durationSec: number;
  width: number;
  height: number;
  theme: KitTheme;
  /** The owner chose the look: the director must keep it. Otherwise `theme` is only a suggestion. */
  themeChosen: boolean;
  kind: VideoKind;
  accent?: string;
  /** Part of a long video: what this segment covers and the shared style guide. */
  segment?: { index: number; count: number; title: string; brief: string; style: string };
  ask: Asker;
  log?: (line: string) => unknown;
  /** Defaults: the renderer's stills and inspector. Tests pass doubles. */
  stills?: (html: string, width: number, height: number, at: number[]) => Promise<Buffer[]>;
  measure?: (html: string, width: number, height: number, durationSec: number) => Promise<CodeIssue[]>;
  /** Critic-driven revisions after the first version (default 2) and the passing score (default 8). */
  rounds?: number;
  passScore?: number;
};

export type Review = { round: number; overall: number; scores: Partial<CriticScores>; issues: string[]; measured: string[] };
export type ComposeResult = { html: string; storyboard: Storyboard; reviews: Review[]; best: number };

const DIRECTOR_SYSTEM = "You are a senior motion designer and video director for short social videos and YouTube explainers. You plan videos as storyboards for a tested motion kit. You answer with JSON only.";

const CRITIC_SYSTEM = `You are a demanding creative director reviewing frames of a motion-design video before it is published. You judge what you SEE, frame by frame, against a rubric, and you give concrete, actionable notes (name the scene and the element). You answer with JSON only.`;

/** Seconds the storyboard body lasts (the whole video, or the segment). */
function seconds(o: ComposeOptions) {
  return o.durationSec;
}

export function directorPrompt(o: ComposeOptions) {
  const vertical = o.height > o.width;
  const segment = o.segment
    ? `This storyboard is SEGMENT ${o.segment.index + 1} of ${o.segment.count} of one continuous long video (it lasts exactly ${o.durationSec} s on its own).
Segment title: ${o.segment.title}
What happens in this segment: ${o.segment.brief}
Shared style guide for every segment: ${o.segment.style}
${o.segment.index === 0 ? "It opens the video: start with a strong hook." : "It continues the story: no new intro, no channel greeting."}
${o.segment.index === o.segment.count - 1 ? "It closes the video: end with the \"end\" card (final line + call to action)." : "Do NOT add an \"end\" card: the story continues in the next segment."}
`
    : "";
  return `${knowledgeFor(o.kind, { chosenTheme: o.themeChosen ? o.theme : null, vertical })}

${storyboardDoc(o.width, o.height, seconds(o))}

${o.themeChosen ? `Theme: "${o.theme}" (fixed).` : `Suggested theme: "${o.theme}" — keep it unless another theme clearly fits the idea better.`}${o.accent ? ` Brand accent colour: ${o.accent} (put it in "accent").` : ""}
${segment}
THE IDEA (from the owner — every on-screen word in its language):
"""${o.idea}"""

Plan it: decide the job of each scene (write it in "note"), then the items. Return ONLY the storyboard JSON.`;
}

function revisePrompt(o: ComposeOptions, sb: Storyboard, notes: string[]) {
  return `${directorPrompt(o)}

YOUR PREVIOUS STORYBOARD:
${JSON.stringify(sb)}

PROBLEMS FOUND (measured by the recorder and seen by the creative director):
${notes.map(n => `- ${n}`).join("\n")}

Revise it: fix every point, keep what already works, keep the total duration exactly ${seconds(o)} s. Return ONLY the revised storyboard JSON.`;
}

/** Moments to photograph: each scene once everything in it has arrived (just before it leaves), plus the end card. */
export function settledTimes(sb: Storyboard, durationSec: number) {
  const at = sb.scenes.map(s => +(s.to - Math.min(0.35, (s.to - s.from) * 0.15)).toFixed(2));
  if (sb.end) at.push(+(durationSec - 0.4).toFixed(2));
  // At most 8 frames: keep the first, the last and an even spread.
  if (at.length <= 8) return at;
  const pick = Array.from({ length: 8 }, (_, i) => at[Math.round((i * (at.length - 1)) / 7)]);
  return [...new Set(pick)];
}

function sceneSummary(sb: Storyboard, times: number[]) {
  return times
    .map((t, i) => {
      const s = sb.scenes.find(x => t > x.from && t <= x.to);
      if (!s) return `frame ${i + 1} (${t}s): end card — ${sb.end?.text ?? ""}${sb.end?.cta ? ` / CTA: ${sb.end.cta}` : ""}`;
      const what = s.items.map(it => it.type).join(" + ");
      return `frame ${i + 1} (${t}s): scene ${sb.scenes.indexOf(s) + 1}${s.note ? ` [${s.note}]` : ""} — ${what}`;
    })
    .join("\n");
}

export function parseReview(raw: string): { scores: Partial<CriticScores>; issues: string[]; overall: number } {
  let obj: { scores?: Record<string, unknown>; issues?: unknown[] } = {};
  try { obj = extractJsonObject(raw) as typeof obj; } catch { /* unreadable answer: no score */ }
  const scores: Partial<CriticScores> = {};
  for (const r of CRITIC_RUBRIC) {
    const v = Number(obj.scores?.[r.id]);
    if (Number.isFinite(v)) scores[r.id] = Math.max(0, Math.min(10, v));
  }
  const vals = Object.values(scores) as number[];
  // Legibility counts double: an unreadable frame ruins a video whatever its style.
  const overall = vals.length ? +((vals.reduce((a, b) => a + b, 0) + (scores.legibility ?? 0)) / (vals.length + (scores.legibility !== undefined ? 1 : 0))).toFixed(1) : 0;
  const issues = (Array.isArray(obj.issues) ? obj.issues : []).map(x => String(x).trim()).filter(Boolean).slice(0, 8);
  return { scores, issues, overall };
}

const SERIOUS = /too long|crowded|need about|empty scene|no scenes|shorter than|unknown item|too late/;

async function defaultMeasure(html: string, width: number, height: number, durationSec: number) {
  const raw = await inspectCode({ html, width, height, durationSec });
  return issuesFrom(raw, durationSec, width, height);
}
async function defaultStills(html: string, width: number, height: number, at: number[]) {
  return (await captureStills({ html, width, height, at, scale: 0.5 })).stills;
}

async function planOnce(o: ComposeOptions, prompt: string, what: string) {
  const raw = await o.ask(DIRECTOR_SYSTEM, prompt, what);
  let obj: unknown;
  try {
    obj = extractJsonObject(raw);
  } catch {
    // One retry for an answer that was not JSON.
    obj = extractJsonObject(await o.ask(DIRECTOR_SYSTEM, `${prompt}\n\nYour last answer was not valid JSON. Return ONLY the JSON object.`, `${what} (إعادة)`));
  }
  return normalizeStoryboard(obj, seconds(o), o.theme);
}

export async function composeVideo(o: ComposeOptions): Promise<ComposeResult> {
  const log = (line: string) => o.log?.(line);
  const rounds = o.rounds ?? 2;
  const pass = o.passScore ?? 8;
  const measure = o.measure ?? defaultMeasure;
  const stills = o.stills ?? defaultStills;
  const label = o.segment ? `المقطع ${o.segment.index + 1}` : "القصة";

  await log(`› المخرج يكتب ${label}: المشاهد والتوقيت (${o.kind} · ${o.theme})…`);
  let { storyboard, issues } = await planOnce(o, directorPrompt(o), label);
  if (o.themeChosen) storyboard.theme = o.theme;
  const serious = issues.filter(i => SERIOUS.test(i));
  if (serious.length) {
    await log(`› ${serious.length} ملاحظة على البناء (نص طويل/مزدحم/وقت قراءة) — يعيد ترتيبها`);
    const again = await planOnce(o, revisePrompt(o, storyboard, serious), `${label} (ترتيب)`);
    if (again.issues.filter(i => SERIOUS.test(i)).length <= serious.length) ({ storyboard, issues } = again);
    if (o.themeChosen) storyboard.theme = o.theme;
  }

  const reviews: Review[] = [];
  let best: { html: string; storyboard: Storyboard; overall: number } | null = null;
  for (let round = 0; round <= rounds; round++) {
    const html = compileStoryboard(storyboard, { width: o.width, height: o.height, durationSec: o.durationSec });
    await log(`› ${storyboard.scenes.length} مشهد${storyboard.end ? " + خاتمة" : ""} — يجرّبه في المصوّر ويقيس`);
    const measured = (await measure(html, o.width, o.height, o.durationSec).catch(() => [] as CodeIssue[])).filter(i => i.severity === "error" || ["small", "spaced-arabic"].includes(i.code));
    const at = settledTimes(storyboard, o.durationSec);
    let review: Review = { round, overall: 0, scores: {}, issues: [], measured: measured.map(m => m.message) };
    try {
      const frames = await stills(html, o.width, o.height, at);
      const raw = await o.ask(
        CRITIC_SYSTEM,
        `${frames.length} frames of a ${o.width}x${o.height} video (${o.durationSec} s), each taken when its scene has fully appeared:
${sceneSummary(storyboard, at)}

The idea it must deliver: """${o.idea.slice(0, 600)}"""

Score 0–10 on each criterion (10 = could run on a top channel; 7 = fine but forgettable; 5 = amateur):
${CRITIC_RUBRIC.map(r => `- ${r.id}: ${r.en}`).join("\n")}

Return {"scores": {${CRITIC_RUBRIC.map(r => `"${r.id}": n`).join(", ")}}, "issues": ["frame N / scene N: concrete problem and the fix", ...up to 6]}. Be strict: no issue may be vague.`,
        `${label}: النقد البصري${round ? ` ${round + 1}` : ""}`,
        frames,
      );
      const parsed = parseReview(raw);
      review = { ...review, ...parsed };
    } catch (e) {
      review.issues = [];
      await log(`› تعذّر النقد البصري (${e instanceof Error ? e.message.slice(0, 120) : String(e)}) — أعتمد القياس فقط`);
    }
    // Measured errors are facts: a frame with text off-screen or overlapping cannot pass, whatever the critic says.
    if (measured.some(m => m.severity === "error")) review.overall = Math.min(review.overall || 6, 6);
    reviews.push(review);
    const scoreLine = Object.entries(review.scores).map(([k, v]) => `${CRITIC_RUBRIC.find(r => r.id === k)?.label ?? k} ${v}`).join(" · ");
    await log(`${review.overall >= pass ? "✓" : "›"} التقييم ${review.overall || "—"}/10${scoreLine ? ` (${scoreLine})` : ""}${measured.length ? ` · ${measured.length} مشكلة مقاسة` : ""}`);
    if (!best || review.overall > best.overall) best = { html, storyboard, overall: review.overall };
    if (review.overall >= pass || round === rounds) break;
    const notes = [...review.measured, ...review.issues, ...issues.filter(i => SERIOUS.test(i))];
    if (!notes.length) break;
    await log(`› يراجع ${label} بـ ${notes.length} ملاحظة (جولة ${round + 2})…`);
    const next = await planOnce(o, revisePrompt(o, storyboard, notes), `${label} (مراجعة ${round + 1})`);
    storyboard = next.storyboard;
    issues = next.issues;
    if (o.themeChosen) storyboard.theme = o.theme;
  }
  const bestIndex = reviews.reduce((bi, r, i) => (r.overall > reviews[bi].overall ? i : bi), 0);
  if (best && bestIndex !== reviews.length - 1) await log(`› أحتفظ بالنسخة ${bestIndex + 1} (الأعلى تقييمًا: ${best.overall}/10)`);
  return { html: best!.html, storyboard: best!.storyboard, reviews, best: bestIndex };
}
