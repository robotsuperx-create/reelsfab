/**
 * Animated scenes for long episodes ("الفيديوهات الكاملة"): the same director and motion kit as the code room,
 * timed to each scene's narration.
 *
 *   1. Plan — the director reads the narrated scenes in batches and, per scene, either keeps footage or writes 1–3
 *      "beats" (motion-kit storyboard scenes): a map when a place is named, a moving number for a figure, rivals
 *      face to face, the person's portrait, a date line… In "animation" mode every scene gets beats.
 *   2. Draw — each animated scene is recorded by the kit at 1920×1080 for exactly its narration (+ the gap), its
 *      pictures fetched like in the code room (free photos/clips, Wikipedia portraits, maps), the bottom kept clear
 *      for the subtitles. The clip becomes the scene's visual, so the episode renderer joins it like any footage.
 *
 * A changed narration changes the scene's length and so the clip's hash: it is redrawn before the next export.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { episodes, type Channel } from "../../drizzle/schema";
import { MOTION_SUBTITLE_RESERVE, MOTION_THEMES, SCENE_GAP, episodeScriptSchema, visualModeOf, type EpisodeScript, type MotionTheme, type Scene, type VisualMode } from "../../shared/episodes";
import { guessKind, knowledgeFor, themeForKind } from "../../shared/code-craft/knowledge";
import { CV_KIT_VERSION } from "../../shared/code-craft/kit";
import { compileStoryboard, extractJsonObject, normalizeStoryboard, storyboardDoc, type SbScene, type Storyboard } from "../../shared/code-craft/storyboard";
import type { CodeAgentEngine } from "../../shared/code-video";
import { requireDb } from "../db";
import { mediaPut } from "../storage";
import { renderCodeVideo } from "../worker/code-video";
import { agentEngines, ask } from "./code-agent";
import { SERIOUS } from "./code-director";
import { prepareStoryboard } from "./code-media";
import { loadEpisode, planVisuals, prepareNarration } from "./episodes";

export const MOTION_W = 1920;
export const MOTION_H = 1080;
/** Scenes per director call: enough context for variety, small enough for one reliable answer. */
const BATCH = 8;

/* ------------------------------------------------------------ job state (one per episode, in memory) */

export type MotionJob = { running: boolean; stage: "planning" | "drawing" | "done" | "failed"; done: number; total: number; log: string[]; error?: string; engine?: CodeAgentEngine; at: number; animated?: number; footage?: number };
const jobs = new Map<number, MotionJob>();

export function motionJob(episodeId: number): MotionJob | null {
  return jobs.get(episodeId) ?? null;
}
export function motionRunning(episodeId: number) {
  return jobs.get(episodeId)?.running === true;
}
function note(job: MotionJob, line: string) {
  job.log.push(line);
  if (job.log.length > 40) job.log.splice(0, job.log.length - 40);
  job.at = Date.now();
}

/* ------------------------------------------------------------ pure helpers (tested) */

/** Length the scene's clip must last on the episode timeline. */
export function clipSeconds(scene: Pick<Scene, "durationSec">) {
  return Math.max(1, Number(((scene.durationSec ?? 0) + SCENE_GAP).toFixed(2)));
}

export type MotionLook = { theme: MotionTheme; accent?: string; lang: "ar" | "en" };

/** Beats (with "sec" shares or from/to) as a one-scene-long storyboard of exactly `seconds`. */
export function beatsStoryboard(beats: Record<string, unknown>[], seconds: number, look: MotionLook) {
  let t = 0;
  const share = seconds / Math.max(1, beats.length);
  const scenes = beats.slice(0, 3).map(b => {
    const from = Number(b.from);
    const to = Number(b.to);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) return b;
    const sec = Number(b.sec);
    const len = Number.isFinite(sec) && sec > 0.5 ? sec : share;
    const out = { ...b, from: t, to: t + len };
    t += len;
    return out;
  });
  const check = normalizeStoryboard({ theme: look.theme, accent: look.accent, lang: look.lang, scenes }, seconds, look.theme);
  // Narrated scene: no end card, no progress bar, no own music — the episode has its voice and music bed.
  check.storyboard.end = undefined;
  check.storyboard.progress = undefined;
  check.storyboard.sound = { sfx: true, music: false };
  return check;
}

/** Fingerprint of a drawn clip: what it shows, how long, in which look, with which kit. */
export function motionHash(beats: unknown[], seconds: number, look: MotionLook) {
  return createHash("sha1").update(`${CV_KIT_VERSION}|${look.theme}|${look.accent ?? ""}|${look.lang}|${seconds.toFixed(2)}|${JSON.stringify(beats)}`).digest("hex").slice(0, 12);
}

/** A clip is current when it was drawn from these beats, for this length and look. */
export function motionCurrent(scene: Scene, look: MotionLook) {
  return Boolean(scene.anim && scene.visual?.anim && scene.anim.hash === motionHash(scene.anim.beats, clipSeconds(scene), look));
}

export function lookFor(script: EpisodeScript, channel: Pick<Channel, "language" | "colors" | "episodeTemplate" | "niche">, topic = ""): MotionLook {
  const kind = guessKind(`${topic} ${channel.niche}`, 600);
  const theme = script.motionTheme ?? channel.episodeTemplate.motionTheme ?? themeForKind(kind);
  const accent = /^#[0-9a-f]{6}$/i.test(channel.colors?.accent ?? "") ? channel.colors.accent : undefined;
  return { theme: (MOTION_THEMES as readonly string[]).includes(theme) ? theme : "documentary", accent, lang: channel.language };
}

const MIXED_RULES = `MODE: MIXED — you decide per scene. Animate a scene when the kit shows it better than any real footage:
- a country, city, border, route or strait → a map (focus / highlight / routes / pins);
- a number, percentage, amount of money, a ranking → a stat or bars (one number per beat);
- two sides, rivals, before/after → flags with "vs", or compare;
- a named person → "person" with the exact English Wikipedia title in "wiki";
- dates in sequence → timeline; a strong sentence somebody said → quote; reasons/steps → list.
Keep "footage" for atmosphere, everyday life, crowds, nature, places with no data to show.
Aim for about 40–60 % animated scenes; the first scene (the hook) is animated; never more than 3 footage scenes in a row.`;

const ALL_RULES = `MODE: ANIMATION — every scene is animated. Give scenes without data or a named thing a picture backdrop ("media" photo or clip, English query) with one short kinetic line or title over it, so the episode keeps real images while everything moves.`;

/** The director's brief for one batch of narrated scenes. */
export function motionPrompt(o: { title: string; niche: string; mode: Exclude<VisualMode, "footage">; look: MotionLook; scenes: { i: number; scene: Scene; seconds: number }[]; previous?: string; force?: boolean }) {
  const lang = o.look.lang === "ar" ? "Arabic" : "English";
  const list = o.scenes
    .map(({ i, scene, seconds }) => `[${i}] ${seconds.toFixed(1)} s${scene.chapter ? ` · chapter: ${scene.chapter}` : ""}${scene.title ? ` · caption: ${scene.title}` : ""}${scene.keywords.length ? ` · footage words: ${scene.keywords.join(", ")}` : ""}
narration: """${scene.narration.replace(/"""/g, "\"")}"""`)
    .join("\n\n");
  return `${knowledgeFor("documentary", { chosenTheme: o.look.theme, vertical: false, media: { stock: true } })}

${storyboardDoc(MOTION_W, MOTION_H, 12, { stock: true })}

THIS JOB IS DIFFERENT FROM A SHORT VIDEO — read carefully:
You animate scenes of a NARRATED long YouTube episode: "${o.title}" (channel: ${o.niche}). A voice reads each scene's narration; subtitles of that narration are burned along the bottom of the frame (the kit keeps the bottom clear). So:
- The screen never repeats the narration. Show the ONE thing the ear needs to see: the number, the place on a map, the two rivals, the date, the person's face and name, a 2–4 word key phrase. At most 10 words on screen per beat.
- Each animated scene is 1–3 "beats" (storyboard scenes WITHOUT from/to; give "sec" = its seconds instead). The beats of a scene add up to that scene's seconds. One beat under 7 s; two beats when the narration makes two points; three only for long scenes. Order the beats like the narration (what is said first shows first).
- No "end" card, no "progress" bar, no "sound" (the episode has its own music). Effects ("fx") for at most one or two key moments of the whole episode.
- A map beat puts its words at the top ("place": "top") with at most a kicker and a short title, so the pins and the place stay visible.
- Theme "${o.look.theme}" for every scene. Vary the layouts from one scene to the next.
- Every on-screen word in ${lang}; search words and Wikipedia titles in English.
${o.force ? ALL_RULES.replace("MODE: ANIMATION — every scene is animated.", "The owner asked to animate these scenes: animate every one.") : o.mode === "mixed" ? MIXED_RULES : ALL_RULES}
${o.previous ? `\nTHE SCENES JUST BEFORE THESE used: ${o.previous} — continue without repeating them.\n` : ""}
THE SCENES:
${list}

Return ONLY JSON: {"scenes":[{"i":<scene number>,"use":"animation","beats":[{"sec":4.5,"transition":"fade","media":{...},"items":[...]}]}${o.mode === "mixed" && !o.force ? `, {"i":<n>,"use":"footage"}` : ""}]} — one entry for every scene above.`;
}

type PlanAnswer = { i: number; use: "animation" | "footage"; beats?: Record<string, unknown>[] };

/** The director's answer, cleaned: known scene numbers only, beats only for animated scenes. */
export function parsePlan(raw: string, allowed: Set<number>): PlanAnswer[] {
  const obj = extractJsonObject(raw) as { scenes?: unknown };
  const list = Array.isArray(obj?.scenes) ? obj.scenes : Array.isArray(obj) ? (obj as unknown[]) : [];
  const out: PlanAnswer[] = [];
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const i = Number(r.i ?? r.scene ?? r.index);
    if (!Number.isInteger(i) || !allowed.has(i) || out.some(p => p.i === i)) continue;
    const beats = (Array.isArray(r.beats) ? r.beats : []).filter(b => b && typeof b === "object").slice(0, 3) as Record<string, unknown>[];
    if (r.use === "footage" || !beats.length) out.push({ i, use: "footage" });
    else out.push({ i, use: "animation", beats });
  }
  return out;
}

/** What one scene looked like (for the next batch's "don't repeat"). */
function leadOf(beats: SbScene[]) {
  return beats.map(b => b.media?.type === "map" ? "map" : b.items.find(i => !["kicker", "source", "lowerThird", "sfx"].includes(i.type))?.type ?? b.media?.type ?? "?").join("+");
}

/* ------------------------------------------------------------ planning */

async function pickEngine(preferred?: CodeAgentEngine): Promise<CodeAgentEngine> {
  const e = await agentEngines();
  if (preferred === "claude-code" && e.claudeCode) return "claude-code";
  if (preferred === "api" && e.api) return "api";
  if (e.claudeCode) return "claude-code";
  if (e.api) return "api";
  throw new Error("لا يوجد عقل للمخرج: سجّل الدخول في Claude Code على هذا الجهاز، أو أضف مفتاح Claude من مركز التكاملات");
}

async function saveScript(episodeId: number, script: EpisodeScript) {
  const db = await requireDb();
  await db.update(episodes).set({ script, updatedAt: new Date() }).where(eq(episodes.id, episodeId));
}

/** Puts footage back on a scene that was animated (the picture it had before, if any). */
export function toFootage(scene: Scene) {
  if (scene.visual?.anim) scene.visual = scene.anim?.prev;
  delete scene.anim;
  scene.footage = true;
}

/**
 * Plans (and draws) the animated scenes of an episode in the background. `sceneIds`: only these scenes, animated
 * whatever the mode (the owner pressed "animate this scene"). Progress: motionJob(episodeId).
 */
export function startEpisodeMotion(episodeId: number, opts: { mode?: VisualMode; theme?: MotionTheme; sceneIds?: string[]; replan?: boolean; engine?: CodeAgentEngine; userId?: number | null }) {
  if (motionRunning(episodeId)) throw new Error("المخرج يعمل على هذه الحلقة الآن — انتظر انتهاءه");
  const job: MotionJob = { running: true, stage: "planning", done: 0, total: 0, log: [], at: Date.now() };
  jobs.set(episodeId, job);
  void runMotion(episodeId, job, opts)
    .then(() => { job.stage = "done"; })
    .catch(e => {
      job.stage = "failed";
      job.error = e instanceof Error ? e.message : String(e);
      note(job, `✗ ${job.error.slice(0, 200)}`);
      console.warn(`[episode-motion] #${episodeId}:`, job.error);
    })
    .finally(() => { job.running = false; job.at = Date.now(); });
  return job;
}

async function runMotion(episodeId: number, job: MotionJob, opts: { mode?: VisualMode; theme?: MotionTheme; sceneIds?: string[]; replan?: boolean; engine?: CodeAgentEngine; userId?: number | null }) {
  let { episode, channel } = await loadEpisode(episodeId);
  if (episode.status === "rendering") throw new Error("الرندر جارٍ — انتظر انتهاءه");
  if (!episode.script) throw new Error("لا يوجد سكربت بعد — ولّد السكربت أولًا");
  let script = episodeScriptSchema.parse(episode.script);
  // A new look re-opens the scenes kept on footage under the old one.
  if (opts.mode && opts.mode !== visualModeOf(script, channel.episodeTemplate)) for (const s of script.scenes) delete s.footage;
  if (opts.mode) script.visualMode = opts.mode;
  if (opts.theme) script.motionTheme = opts.theme;
  const mode = visualModeOf(script, channel.episodeTemplate);
  const only = opts.sceneIds?.length ? new Set(opts.sceneIds) : null;

  if (mode === "footage" && !only) {
    let n = 0;
    for (const s of script.scenes) {
      if (s.anim) { toFootage(s); n++; }
      delete s.footage;
    }
    await saveScript(episodeId, script);
    note(job, n ? `✓ رجعت ${n} مشهد إلى اللقطات الحقيقية` : "✓ الحلقة على اللقطات الحقيقية");
    return;
  }

  // The beats are timed to the voice: narration first.
  if (script.scenes.some(s => !s.durationSec)) {
    note(job, "› يجهّز الصوت أولًا (التوقيت يتبع التعليق)…");
    await saveScript(episodeId, script);
    await prepareNarration(episodeId);
    ({ episode, channel } = await loadEpisode(episodeId));
    const fresh = episodeScriptSchema.parse(episode.script);
    fresh.visualMode = script.visualMode;
    fresh.motionTheme = script.motionTheme;
    script = fresh;
  }
  const look = lookFor(script, channel, episode.topic);
  const targets = script.scenes.map((scene, i) => ({ i, scene })).filter(({ scene }) => (only ? only.has(scene.id) : opts.replan || (!scene.anim && !scene.footage)));
  job.total = targets.length;
  const engine = targets.length ? await pickEngine(opts.engine) : null;
  if (engine) {
    job.engine = engine;
    note(job, `› المخرج (${engine === "claude-code" ? "Claude Code — اشتراكك" : "Claude API"}) يقرأ ${targets.length} مشهد · ${mode === "mixed" && !only ? "مزيج" : "أنيميشن"} · ${look.theme}`);
  }

  const plannedMode: Exclude<VisualMode, "footage"> = mode === "footage" ? "animation" : mode;
  for (let b = 0; b < targets.length; b += BATCH) {
    const batch = targets.slice(b, b + BATCH);
    const before = script.scenes.slice(Math.max(0, batch[0].i - 3), batch[0].i).filter(s => s.anim).map(s => leadOf(s.anim!.beats as unknown as SbScene[])).join(", ");
    const items = batch.map(({ i, scene }) => ({ i, scene, seconds: clipSeconds(scene) }));
    const prompt = motionPrompt({ title: script.title, niche: channel.niche, mode: plannedMode, look, scenes: items, previous: before || undefined, force: Boolean(only) });
    const ref = { id: episodeId, userId: opts.userId ?? episode.createdBy, refType: "episode" as const, what: `المشاهد ${batch[0].i + 1}–${batch[batch.length - 1].i + 1}` };
    note(job, `› يخطط المشاهد ${batch[0].i + 1}–${batch[batch.length - 1].i + 1}…`);
    const system = "You are a senior motion designer directing the animated scenes of a narrated documentary episode. You plan with a tested motion kit and answer with JSON only.";
    let raw = await ask(engine!, system, prompt, ref);
    let plan: PlanAnswer[];
    try {
      plan = parsePlan(raw, new Set(batch.map(x => x.i)));
    } catch {
      raw = await ask(engine!, system, `${prompt}\n\nYour last answer was not valid JSON. Return ONLY the JSON object.`, { ...ref, what: `${ref.what} (إعادة)` });
      plan = parsePlan(raw, new Set(batch.map(x => x.i)));
    }
    // Structural problems (crowded screens, too many words for the time) go back once for the whole batch.
    const problems: string[] = [];
    for (const p of plan) {
      if (p.use !== "animation" || !p.beats) continue;
      const { issues } = beatsStoryboard(p.beats, clipSeconds(script.scenes[p.i]), look);
      for (const issue of issues.filter(x => SERIOUS.test(x))) problems.push(`scene [${p.i}]: ${issue}`);
    }
    if (problems.length) {
      note(job, `› ${problems.length} ملاحظة (ازدحام/وقت قراءة) — يعيد ترتيبها`);
      const again = await ask(engine!, system, `${prompt}\n\nYOUR PREVIOUS ANSWER:\n${JSON.stringify({ scenes: plan })}\n\nPROBLEMS:\n${problems.slice(0, 12).map(x => `- ${x}`).join("\n")}\n\nFix every point and return the whole JSON again.`, { ...ref, what: `${ref.what} (ترتيب)` }).catch(() => "");
      try {
        const next = again ? parsePlan(again, new Set(batch.map(x => x.i))) : [];
        if (next.length >= plan.length * 0.8) plan = next;
      } catch { /* keep the first plan */ }
    }
    for (const { i } of batch) {
      const scene = script.scenes[i];
      const p = plan.find(x => x.i === i);
      if (p?.use === "animation" && p.beats) {
        const { storyboard } = beatsStoryboard(p.beats, clipSeconds(scene), look);
        if (!storyboard.scenes.length || storyboard.scenes.every(s => !s.items.length && !s.media)) continue;
        const prev = scene.visual?.anim ? scene.anim?.prev : scene.visual;
        scene.anim = { beats: storyboard.scenes as unknown as Record<string, unknown>[], ...(prev ? { prev } : {}) };
        delete scene.footage;
        if (scene.visual?.anim) scene.visual = prev; // the old clip no longer matches; drawn again below
      } else if (p?.use === "footage" && !only) {
        toFootage(scene);
      }
      job.done++;
    }
    await saveScript(episodeId, script);
  }
  await saveScript(episodeId, script);
  const animated = script.scenes.filter(s => s.anim).length;
  job.animated = animated;
  job.footage = script.scenes.length - animated;
  note(job, `✓ الخطة: ${animated} مشهد متحرك · ${script.scenes.length - animated} لقطة حقيقية`);

  await drawMotionClips(episodeId, { job, userId: opts.userId ?? episode.createdBy, only });
  // Footage scenes still without a picture (and any scene the kit could not draw) get free footage.
  const after = episodeScriptSchema.parse((await loadEpisode(episodeId)).episode.script);
  const empty = after.scenes.filter(s => !s.visual).length;
  if (empty) {
    note(job, `› يختار لقطات مجانية لـ ${empty} مشهد بلا صورة…`);
    const r = await planVisuals(episodeId, { onlyMissing: true, userId: opts.userId ?? episode.createdBy }).catch(e => { note(job, `› اللقطات: ${e instanceof Error ? e.message.slice(0, 120) : e}`); return null; });
    if (r) note(job, `✓ ${r.picked} لقطة${r.missing ? ` · ${r.missing} بلا لقطة` : ""}`);
  }
}

/* ------------------------------------------------------------ drawing */

/** Records one animated scene with the kit and stores the clip; returns the visual for the scene. */
async function drawScene(episodeId: number, scene: Scene, look: MotionLook, used: Set<string>, userId: number | null) {
  const seconds = clipSeconds(scene);
  const { storyboard } = beatsStoryboard(scene.anim!.beats, seconds, look);
  const ready = await prepareStoryboard(storyboard as Storyboard, { stock: true, library: false, width: MOTION_W, height: MOTION_H, userId, used });
  const beats = ready.storyboard.scenes as unknown as Record<string, unknown>[];
  const html = compileStoryboard(ready.storyboard, { width: MOTION_W, height: MOTION_H, durationSec: seconds, geo: ready.geo, reserve: MOTION_SUBTITLE_RESERVE });
  const r = await renderCodeVideo({ html, width: MOTION_W, height: MOTION_H, durationSec: seconds, fps: 30, sound: { mode: "off" } });
  const hash = motionHash(beats, seconds, look);
  const put = await mediaPut(`episodes/${episodeId}/motion/${scene.id}-${hash}.mp4`, r.video, "video/mp4");
  const credit = [...new Set(ready.credits)].join(" · ").slice(0, 200) || undefined;
  return { beats, hash, visual: { kind: "video" as const, src: put.url, in: 0, auto: true, anim: true, ...(credit ? { credit } : {}) }, notes: ready.notes };
}

/**
 * Draws every animated scene whose clip is missing or out of date (narration re-timed, beats changed). Used by the
 * background job and before each export.
 */
export async function drawMotionClips(episodeId: number, opts?: { job?: MotionJob; userId?: number | null; only?: Set<string> | null; onProgress?: (done: number, total: number) => void }) {
  const { episode, channel } = await loadEpisode(episodeId);
  if (!episode.script) return { drawn: 0, failed: 0 };
  const script = episodeScriptSchema.parse(episode.script);
  const look = lookFor(script, channel, episode.topic);
  const todo = script.scenes.filter(s => s.anim && (!opts?.only || opts.only.has(s.id)) && !motionCurrent(s, look));
  if (!todo.length) return { drawn: 0, failed: 0 };
  const job = opts?.job;
  if (job) {
    job.stage = "drawing";
    job.done = 0;
    job.total = todo.length;
    note(job, `› يرسم ${todo.length} مشهد متحرك (1920×1080، على طول التعليق)…`);
  }
  // No picture twice in one episode: what the drawn scenes already use.
  const used = new Set<string>();
  for (const s of script.scenes) for (const b of s.anim?.beats ?? []) {
    const refs = [(b as { media?: unknown }).media, ...((b as { items?: unknown[] }).items ?? [])] as { key?: string; ref?: string }[];
    for (const r of refs) if (r && (r.ref || r.key)) used.add((r.ref ?? r.key)!);
  }
  let drawn = 0;
  let failed = 0;
  for (const scene of todo) {
    try {
      const r = await drawScene(episodeId, scene, look, used, opts?.userId ?? episode.createdBy);
      scene.anim = { ...scene.anim!, beats: r.beats, hash: r.hash, error: undefined };
      if (scene.visual && !scene.visual.anim && !scene.anim.prev) scene.anim.prev = scene.visual;
      scene.visual = r.visual;
      drawn++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      scene.anim = { ...scene.anim!, error: msg.slice(0, 300) };
      failed++;
      if (job) note(job, `› تعذّر رسم مشهد ${script.scenes.indexOf(scene) + 1}: ${msg.slice(0, 120)}`);
    }
    if (job) job.done++;
    opts?.onProgress?.(drawn + failed, todo.length);
    // Saved after every clip: a long episode keeps what is done if something stops half-way.
    const fresh = episodeScriptSchema.parse((await loadEpisode(episodeId)).episode.script);
    const at = fresh.scenes.findIndex(s => s.id === scene.id);
    if (at >= 0) {
      fresh.scenes[at] = { ...fresh.scenes[at], anim: scene.anim, visual: scene.visual };
      await saveScript(episodeId, fresh);
    }
  }
  if (job) note(job, `✓ رُسم ${drawn} مشهد${failed ? ` · ${failed} تعذّر (يبقى على لقطته)` : ""}`);
  return { drawn, failed };
}
