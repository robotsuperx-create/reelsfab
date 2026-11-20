/**
 * The "code → video" agent: turns an idea into the HTML animation(s) the room renders.
 * Two engines, chosen per video:
 *   - "api": the Claude API key in the integrations vault (pay per use, cost logged);
 *   - "claude-code": the Claude Code CLI installed on this computer, signed in with the owner's subscription —
 *     no key; it runs with no tools at all (it can only answer), from a temp folder, without the studio's secrets.
 * Short videos (≤ 90 s) are one file. Longer ones (up to 40 min) get a plan — one style guide and 30–60 s segments —
 * then one file per segment, all rendered and joined. Every file is test-rendered for a second; errors go back
 * to the agent once to be fixed.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { codeVideos } from "../../drizzle/schema";
import { CLAUDE_DEFAULT_MODEL } from "../../shared/domain";
import { CODE_VIDEO_SEGMENT_MAX, CODE_VIDEO_SINGLE_MAX, codeVideoSize, formatDuration, type CodeAgentEngine, type CodeAgentInput, type CodeVideoPlan } from "../../shared/code-video";
import { getDb, getSettings, requireDb } from "../db";
import { captureStills, renderCodeVideo } from "../worker/code-video";
import { callText } from "./ai";
import { providerConfigured } from "./ai-providers";
import { kickCodeVideoQueue } from "./code-videos";

const GSAP = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js";

/* ------------------------------------------------------------ engines */

let cliCheck: { at: number; ok: boolean; version?: string } | null = null;

function claudeCommand() {
  return process.env.CLAUDE_CODE_PATH?.trim() || "claude";
}

/** Environment for the CLI: no API keys (it must use the subscription login) and none of the studio's secrets. */
function cliEnv() {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^ANTHROPIC_|KEY|SECRET|TOKEN|PASSWORD|DATABASE|SUPABASE|_DB_|COOKIE|SESSION/i.test(k)) continue;
    env[k] = v;
  }
  return env;
}

function runCli(args: string[], input: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const win = process.platform === "win32";
    // On Windows the CLI is a .cmd shim, which Node only starts through the shell; arguments are pre-quoted.
    const child = spawn(win ? `"${claudeCommand()}"` : claudeCommand(), win ? args.map(a => (a === "" ? '""' : /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args, {
      cwd: tmpdir(),
      env: cliEnv(),
      shell: win,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input, "utf8");
  });
}

export async function claudeCodeAvailable() {
  if (cliCheck && Date.now() - cliCheck.at < 5 * 60_000) return cliCheck;
  try {
    const r = await runCli(["--version"], "", 20_000);
    const version = /([\d.]+)\s*\(Claude Code\)/.exec(r.stdout)?.[1];
    cliCheck = { at: Date.now(), ok: r.code === 0 && Boolean(version), version };
  } catch {
    cliCheck = { at: Date.now(), ok: false };
  }
  return cliCheck;
}

export async function agentEngines() {
  const [api, cli] = await Promise.all([providerConfigured("anthropic").catch(() => false), claudeCodeAvailable()]);
  return { api: Boolean(api), claudeCode: cli.ok, claudeCodeVersion: cli.version ?? null };
}

/** One answer from the Claude Code CLI: no tools, our system prompt only, nothing saved. */
async function askClaudeCode(system: string, prompt: string, images: Buffer[] = []) {
  const dir = await mkdtemp(join(tmpdir(), "code-agent-"));
  try {
    const sysFile = join(dir, "system.txt");
    await writeFile(sysFile, system, "utf8");
    const model = process.env.CODE_AGENT_CLI_MODEL?.trim() || "sonnet";
    // Text jobs get no tools at all; a visual review may only Read the stills written into this temp folder.
    const files: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const f = join(dir, `frame${i + 1}.jpg`);
      await writeFile(f, images[i]);
      files.push(f);
    }
    const toolArgs = files.length ? ["--tools", "Read", "--allowedTools", "Read", "--add-dir", dir, "--max-turns", String(files.length + 2)] : ["--tools", "", "--max-turns", "1"];
    const fullPrompt = files.length ? `${prompt}\n\nThe frames are these image files (open each with the Read tool):\n${files.join("\n")}` : prompt;
    const r = await runCli(["-p", "--output-format", "json", "--model", model, ...toolArgs, "--system-prompt-file", sysFile, "--no-session-persistence", "--strict-mcp-config"], fullPrompt, 15 * 60_000);
    let data: { result?: string; is_error?: boolean; subtype?: string } | null = null;
    try { data = JSON.parse(r.stdout.trim().split("\n").filter(Boolean).pop() ?? ""); } catch { /* not JSON */ }
    if (!data) throw new Error(`Claude Code لم يُرجع ردًا مفهومًا: ${(r.stderr || r.stdout).slice(0, 300)}`);
    if (data.is_error || !data.result) {
      const why = `${data.result ?? data.subtype ?? ""} ${r.stderr}`.trim();
      if (/login|auth|credential|sign in/i.test(why)) throw new Error("Claude Code على هذا الجهاز غير مسجّل الدخول — افتح الطرفية واكتب claude ثم سجّل الدخول باشتراكك");
      if (/limit|usage|quota/i.test(why)) throw new Error(`بلغ اشتراكك حدّ الاستعمال الآن: ${why.slice(0, 200)}`);
      throw new Error(`Claude Code: ${why.slice(0, 300) || "فشل"}`);
    }
    return data.result;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function ask(engine: CodeAgentEngine, system: string, prompt: string, ref: { id: number; userId?: number | null; what: string }, images: Buffer[] = []) {
  if (engine === "claude-code") return askClaudeCode(system, prompt, images);
  const settings = await getSettings().catch(() => null);
  const model = (settings as { episodeModel?: string } | null)?.episodeModel || CLAUDE_DEFAULT_MODEL;
  return callText({ model, system, prompt, images: images.length ? images.map(b => `data:image/jpeg;base64,${b.toString("base64")}`) : undefined, maxTokens: 20000, description: `كود ← فيديو #${ref.id}: ${ref.what}`, refType: "code_video", refId: ref.id, userId: ref.userId ?? undefined });
}

/* ------------------------------------------------------------ prompts */

function rules(width: number, height: number) {
  const vertical = height > width;
  return `You write ONE self-contained HTML file that plays an animation recorded into a video, frame by frame, by a headless browser.
Hard rules:
- Canvas exactly ${width}x${height}: html, body { width:${width}px; height:${height}px; margin:0; overflow:hidden }. Background covers everything.
- It starts by itself on load: no clicks, no hover, no audio, no video files, no fetch/XHR, no external images.
- Draw everything with HTML/CSS, inline SVG, canvas or emoji.
- Libraries only from cdnjs.cloudflare.com or cdn.jsdelivr.net. Prefer GSAP: <script src="${GSAP}"></script> and ONE gsap.timeline() for the whole piece. Fonts only from Google Fonts (Arabic: Alexandria, Cairo, IBM Plex Sans Arabic, Tajawal; Latin: Inter, Space Grotesk, JetBrains Mono).
- Timing must come from GSAP/CSS animations/requestAnimationFrame/setTimeout — the recorder controls the clock. Never rely on real time passing between page load and the first frame.
- Text in the language of the idea; Arabic pages use <html dir="rtl" lang="ar">, Arabic display type line-height ≥ 1.45.
- Readable on a phone: body text ≥ ${vertical ? 40 : 34}px, titles ≥ ${vertical ? 80 : 64}px.${vertical ? " Keep key content out of the top 180px and bottom 320px (platform UI)." : ""}
- Facts: NO specific numbers, percentages, prices, dates or quotes unless they appear in the idea or the brief — use qualitative words instead ("prices keep climbing"). If numbers are given, use them exactly.
- Layout: use the whole frame — compose each moment centred in the safe area, never a small cluster at the top. No element may overlap another at any moment (when one text replaces another, fade the old one out first). Keep ≥ 32px between text blocks and ≥ 60px from the edges.
- Visual quality: a deliberate palette (2–3 colours + neutrals), real hierarchy, smooth eased motion, no clutter, no lorem ipsum.
Output ONLY the HTML document, starting with <!doctype html> and ending with </html>. No explanations, no markdown fences.`;
}

function extractHtml(text: string) {
  const fenced = /```(?:html)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/<!doctype html|<html[\s>]/i);
  const end = body.toLowerCase().lastIndexOf("</html>");
  if (start < 0) throw new Error("الوكيل لم يُرجع ملف HTML");
  return end > start ? body.slice(start, end + 7) : body.slice(start);
}

function extractJson<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("الوكيل لم يُرجع خطة صالحة");
  return JSON.parse(body.slice(a, b + 1)) as T;
}

/** Plans a long video: one style guide and segments of 30–60 s whose lengths add up to the total. */
function planPrompt(idea: string, durationSec: number, width: number, height: number) {
  const n = Math.ceil(durationSec / CODE_VIDEO_SEGMENT_MAX);
  return `Plan an animated explainer video of exactly ${durationSec} seconds (${formatDuration(durationSec)}), ${width}x${height}, made of ${n} consecutive segments.
Idea (from the owner): """${idea}"""
Return ONLY JSON: {"style": "...", "segments": [{"title": "...", "seconds": 45, "brief": "..."}]}
- "style": a precise visual style guide every segment must follow — palette as hex values, fonts, background treatment, motion language, recurring motifs, how titles and numbers look. Same language as the idea for any on-screen words.
- exactly ${n} segments; each "seconds" between 30 and 60; the sum must be exactly ${durationSec}.
- each "brief": what appears on screen second by second in that segment (texts to show, shapes, transitions), 60–140 words, so a separate writer can build it without seeing the others. The first segment opens with a strong hook title; the last closes the story.
- a clear narrative arc across segments; no repetition between segments.`;
}

function segmentPrompt(idea: string, plan: CodeVideoPlan, i: number) {
  const seg = plan.segments[i];
  return `Write segment ${i + 1} of ${plan.segments.length} of one continuous video. This file must last exactly ${seg.seconds} seconds.
Overall idea: """${idea}"""
STYLE GUIDE (follow exactly, it is shared by every segment): ${plan.style}
Segment title: ${seg.title}
What happens in this segment: ${seg.brief}
${i > 0 ? "It continues from the previous segment: start on the same background, no new intro card." : "This is the opening: grab attention in the first 2 seconds."}
${i < plan.segments.length - 1 ? "End on a frame that leads into the next segment (no outro card, no fade to black)." : "This is the ending: close the story with a strong final frame."}`;
}

/* ------------------------------------------------------------ job */

let running = false;
const queue: number[] = [];

async function log(id: number, line: string) {
  const db = await requireDb();
  const stamp = new Date().toISOString().slice(11, 19);
  await db
    .update(codeVideos)
    .set({ agentLog: sql`coalesce(${codeVideos.agentLog}, '[]'::jsonb) || ${JSON.stringify([`${stamp} ${line}`])}::jsonb`, updatedAt: new Date() })
    .where(eq(codeVideos.id, id));
}

/** A one-second test render: script errors and requests that were blocked go back to the agent. */
async function testRender(html: string, width: number, height: number) {
  try {
    const r = await renderCodeVideo({ html, width: Math.round(width / 2), height: Math.round(height / 2), durationSec: 1, fps: 30 });
    const errors = r.consoleErrors.filter(e => !/favicon/i.test(e));
    return [...errors, ...r.blocked.map(u => `blocked request (not allowed): ${u}`)];
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
}

const REVIEW_SYSTEM = `You are a strict motion-design reviewer for short social videos. You look at still frames of an HTML animation and report only real, visible defects. Answer with JSON only: {"ok": true|false, "issues": ["..."]}.`;

/** Looks at four moments of the animation and lists visible defects (overlaps, cut-off text, empty frames…). */
async function visualReview(engine: CodeAgentEngine, html: string, w: number, h: number, seconds: number, ref: { id: number; userId?: number | null; what: string }) {
  const at = [0.12, 0.38, 0.65, 0.93].map(f => Math.max(0.3, +(seconds * f).toFixed(2)));
  const { stills } = await captureStills({ html, width: w, height: h, at, scale: 0.5 });
  const prompt = `These are ${stills.length} frames (at ${at.map(t => `${t}s`).join(", ")}) of a ${w}x${h} animated video, in order.
Check each frame for: text overlapping other text or shapes; text cut off by the frame edge; letters of Arabic words disconnected or reversed; text too small to read on a phone or too low contrast; a frame mostly empty or all content crowded into one small area; anything that looks broken.
Return {"ok": true, "issues": []} if it is publishable, otherwise ok=false and up to 6 short, concrete issues naming the frame and the element.`;
  const raw = await ask(engine, REVIEW_SYSTEM, prompt, { ...ref, what: `${ref.what} (مراجعة بصرية)` }, stills);
  try {
    const r = extractJson<{ ok?: boolean; issues?: string[] }>(raw);
    const issues = (r.issues ?? []).map(String).filter(Boolean).slice(0, 6);
    return r.ok === false && issues.length ? issues : [];
  } catch {
    return [];
  }
}

async function writeChecked(engine: CodeAgentEngine, system: string, prompt: string, w: number, h: number, seconds: number, ref: { id: number; userId?: number | null; what: string }) {
  let html = extractHtml(await ask(engine, system, prompt, ref));
  const problems = await testRender(html, w, h);
  if (problems.length) {
    await log(ref.id, `› ${ref.what}: ${problems.length} خطأ في التجربة — يصلحه الوكيل`);
    const fix = `${prompt}\n\nYour previous file had these problems when test-rendered:\n- ${problems.slice(0, 8).join("\n- ")}\n\nHere it is. Return the corrected complete file.\n\n${html}`;
    html = extractHtml(await ask(engine, system, fix, { ...ref, what: `${ref.what} (إصلاح)` }));
  }
  // The agent looks at its own frames once and fixes what it sees.
  const issues = await visualReview(engine, html, w, h, seconds, ref).catch(() => [] as string[]);
  if (issues.length) {
    await log(ref.id, `› ${ref.what}: المراجعة البصرية وجدت ${issues.length} عيبًا — يصلحها`);
    const fix = `${prompt}\n\nA reviewer looked at frames of your file and found:\n- ${issues.join("\n- ")}\n\nFix every point without changing the timing or the overall idea. Here is your file; return the corrected complete file.\n\n${html}`;
    const fixed = extractHtml(await ask(engine, system, fix, { ...ref, what: `${ref.what} (تحسين)` }));
    if (!(await testRender(fixed, w, h)).length) html = fixed;
  } else {
    await log(ref.id, `› ${ref.what}: المراجعة البصرية ✓`);
  }
  return html;
}

export async function startAgentVideo(input: CodeAgentInput, userId?: number | null) {
  const db = await requireDb();
  const size = codeVideoSize(input.size);
  const title = input.idea.replace(/\s+/g, " ").trim().slice(0, 80);
  const [row] = await db
    .insert(codeVideos)
    .values({ title, html: "", width: size.width, height: size.height, durationSec: input.durationSec, fps: input.fps, status: "writing", idea: input.idea, engine: input.engine, agentLog: [], createdBy: userId ?? null })
    .returning({ id: codeVideos.id });
  queue.push(row.id);
  void drainAgent(input.autoConvert);
  return row;
}

async function drainAgent(autoConvert: boolean) {
  if (running) return;
  running = true;
  try {
    for (let id = queue.shift(); id; id = queue.shift()) await writeVideo(id, autoConvert);
  } finally {
    running = false;
  }
}

async function writeVideo(id: number, autoConvert: boolean) {
  const db = await requireDb();
  const [job] = await db.select().from(codeVideos).where(eq(codeVideos.id, id));
  if (!job?.idea || !job.engine) return;
  const engine = job.engine as CodeAgentEngine;
  const system = rules(job.width, job.height);
  const ref = { id, userId: job.createdBy, what: "" };
  try {
    await log(id, `$ agent --engine ${engine} --duration ${job.durationSec}s --size ${job.width}x${job.height}`);
    if (job.durationSec <= CODE_VIDEO_SINGLE_MAX) {
      await log(id, "› يكتب الأنيميشن…");
      const prompt = `Make an animation of exactly ${job.durationSec} seconds.\nIdea (from the owner): """${job.idea}"""`;
      const html = await writeChecked(engine, system, prompt, job.width, job.height, job.durationSec, { ...ref, what: "الأنيميشن" });
      await db.update(codeVideos).set({ html, title: guessTitleFrom(html) ?? job.title, status: autoConvert ? "queued" : "draft", updatedAt: new Date() }).where(eq(codeVideos.id, id));
      await log(id, autoConvert ? "✓ مكتوب ومجرَّب — دخل طابور التحويل" : "✓ مكتوب ومجرَّب — افتحه وراجعه ثم حوّله");
    } else {
      let plan = job.plan?.segments?.length ? job.plan : null; // a retry keeps the plan and the segments already written
      if (!plan) {
        await log(id, "› يخطّط المقاطع ودليل الأسلوب…");
        const raw = extractJson<CodeVideoPlan>(await ask(engine, "You are a senior motion designer and documentary editor. Answer with JSON only.", planPrompt(job.idea, job.durationSec, job.width, job.height), { ...ref, what: "خطة المقاطع" }));
        plan = normalizePlan(raw, job.durationSec);
        await db.update(codeVideos).set({ plan, updatedAt: new Date() }).where(eq(codeVideos.id, id));
        await log(id, `✓ الخطة: ${plan.segments.length} مقطع`);
      }
      for (let i = 0; i < plan.segments.length; i++) {
        if (plan.segments[i].html) continue;
        await log(id, `› يكتب المقطع ${i + 1}/${plan.segments.length}: ${plan.segments[i].title}`);
        plan.segments[i].html = await writeChecked(engine, system, segmentPrompt(job.idea, plan, i), job.width, job.height, plan.segments[i].seconds, { ...ref, what: `المقطع ${i + 1}` });
        await db.update(codeVideos).set({ plan, html: plan.segments[0].html ?? "", updatedAt: new Date() }).where(eq(codeVideos.id, id));
      }
      await db.update(codeVideos).set({ status: autoConvert ? "queued" : "draft", updatedAt: new Date() }).where(eq(codeVideos.id, id));
      await log(id, autoConvert ? "✓ كل المقاطع مكتوبة — دخلت طابور التحويل" : "✓ كل المقاطع مكتوبة — اضغط تحويل");
    }
    if (autoConvert) void kickCodeVideoQueue();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log(id, `✗ ${msg}`).catch(() => undefined);
    await db.update(codeVideos).set({ status: "failed", error: msg.slice(0, 1000), updatedAt: new Date() }).where(eq(codeVideos.id, id));
  }
}

function guessTitleFrom(html: string) {
  return /<title[^>]*>([^<]{1,160})<\/title>/i.exec(html)?.[1].trim() || null;
}

/** Keeps the agent's plan honest: 30–60 s per segment, exact total. */
export function normalizePlan(raw: CodeVideoPlan, total: number): CodeVideoPlan {
  const style = String(raw?.style ?? "").slice(0, 4000) || "Dark background, one accent colour, clean bold typography, smooth eased motion.";
  const given = Array.isArray(raw?.segments) ? raw.segments.filter(s => s && (s.brief || s.title)) : [];
  const n = Math.max(1, Math.ceil(total / CODE_VIDEO_SEGMENT_MAX));
  const base = Math.floor(total / n);
  let rest = total - base * n;
  const segments = Array.from({ length: n }, (_, i) => {
    const g = given[i] ?? given[given.length - 1] ?? { title: `الجزء ${i + 1}`, brief: "" };
    const seconds = base + (rest-- > 0 ? 1 : 0);
    return { title: String(g.title ?? `الجزء ${i + 1}`).slice(0, 120), seconds, brief: String(g.brief ?? "").slice(0, 2000) || `Part ${i + 1} of the story.` };
  });
  return { style, segments };
}

/** Called at startup: writing jobs cut off by a restart are marked so they can be retried. */
export async function failInterruptedAgentJobs() {
  const db = await getDb();
  if (!db) return;
  await db.update(codeVideos).set({ status: "failed", error: "توقّف الخادم أثناء الكتابة — أعد المحاولة", updatedAt: new Date() }).where(eq(codeVideos.status, "writing"));
}

/** Retry a failed agent job (keeps segments already written). */
export async function retryAgentVideo(id: number, autoConvert: boolean) {
  const db = await requireDb();
  await db.update(codeVideos).set({ status: "writing", error: null, updatedAt: new Date() }).where(eq(codeVideos.id, id));
  queue.push(id);
  void drainAgent(autoConvert);
}
