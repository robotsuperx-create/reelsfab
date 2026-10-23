import { and, eq, inArray, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import { characters, montages, premiumClips, renderJobs, renders, scripts } from "../../drizzle/schema";
import { AI_DISCLOSURE, spokenText, TEMPLATES } from "../../shared/domain";
import { requireDb } from "../db";
import { notifyOwner } from "../services/notify";
import { finishMontageRender } from "../services/montages";
import { createRenderRecord } from "../services/render-records";
import { storageDownload, storageKeyFromUrl, storagePut } from "../storage";
import { renderFromVideo, renderReel, type RenderResult } from "./renderer";

const WORKER_ID = `${process.env.HOSTNAME ?? "local"}:${process.pid}`;
const STALE_LOCK_MINUTES = 20;

/**
 * Queues every renderable script that has neither a render nor a job:
 * economic scripts (still image + voice), derivative scripts and premium originals whose clip has arrived.
 */
export async function enqueueReadyScripts(limit = 60) {
  const db = await requireDb();
  const rows = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(
      and(
        or(
          and(eq(scripts.track, "economic"), eq(scripts.status, "script_ready")),
          and(eq(scripts.track, "derivative"), eq(scripts.status, "script_ready"), isNotNull(scripts.premiumClipId)),
          and(eq(scripts.track, "premium"), eq(scripts.status, "premium_uploaded"), isNotNull(scripts.premiumClipId)),
        ),
        notExists(db.select({ x: renderJobs.id }).from(renderJobs).where(and(eq(renderJobs.scriptId, scripts.id), isNull(renderJobs.montageId)))),
        notExists(db.select({ x: renders.id }).from(renders).where(eq(renders.scriptId, scripts.id))),
      ),
    )
    .orderBy(scripts.id)
    .limit(limit);
  if (!rows.length) return 0;
  await db
    .insert(renderJobs)
    .values(rows.map(r => ({ scriptId: r.id })))
    .onConflictDoNothing();
  return rows.length;
}

/** Atomically takes the next due job. Safe with several workers (SKIP LOCKED). */
export async function claimJob() {
  const db = await requireDb();
  // Jobs abandoned by a crashed worker become claimable again.
  await db
    .update(renderJobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null })
    .where(and(eq(renderJobs.status, "running"), sql`${renderJobs.lockedAt} < now() - make_interval(mins => ${STALE_LOCK_MINUTES})`));
  const res = await db.execute(sql`
    update render_jobs set status='running', "lockedAt"=now(), "lockedBy"=${WORKER_ID},
      attempts=attempts+1, "updatedAt"=now()
    where id = (
      select id from render_jobs
      where status='queued' and "runAfter" <= now()
      order by id for update skip locked limit 1
    ) returning id, "scriptId", "montageId", attempts, "maxAttempts"`);
  const row = (res as unknown as { id: number; scriptId: number; montageId: number | null; attempts: number; maxAttempts: number }[])[0];
  return row ?? null;
}

/** Claims one specific queued job (used to run a user-requested render ahead of the batch queue). */
export async function claimJobById(id: number) {
  const db = await requireDb();
  const res = await db.execute(sql`
    update render_jobs set status='running', "lockedAt"=now(), "lockedBy"=${WORKER_ID},
      attempts=attempts+1, "updatedAt"=now()
    where id=${id} and status='queued'
    returning id, "scriptId", "montageId", attempts, "maxAttempts"`);
  const row = (res as unknown as { id: number; scriptId: number; montageId: number | null; attempts: number; maxAttempts: number }[])[0];
  return row ?? null;
}

/** Runs a queued job right now (no-op when a worker already holds it). */
export async function runJobNow(id: number) {
  const job = await claimJobById(id);
  return job ? processJob(job) : null;
}

/** Queues a final render of a montage project (one live job per montage) and marks it rendering. */
export async function enqueueMontage(montageId: number) {
  const db = await requireDb();
  const [m] = await db.select().from(montages).where(eq(montages.id, montageId));
  if (!m) throw new Error("Montage not found");
  const [live] = await db
    .select({ id: renderJobs.id, status: renderJobs.status })
    .from(renderJobs)
    .where(eq(renderJobs.montageId, montageId));
  if (live && (live.status === "queued" || live.status === "running")) return { jobId: live.id, already: true as const };
  if (live) await db.delete(renderJobs).where(eq(renderJobs.id, live.id));
  const [job] = await db.insert(renderJobs).values({ scriptId: m.scriptId, montageId }).returning({ id: renderJobs.id });
  await db.update(montages).set({ status: "rendering", error: null, updatedAt: new Date() }).where(eq(montages.id, montageId));
  return { jobId: job.id, already: false as const };
}

async function processMontageJob(job: { id: number; montageId: number; attempts: number; maxAttempts: number }) {
  const db = await requireDb();
  try {
    const [m] = await db.select().from(montages).where(eq(montages.id, job.montageId));
    if (!m) throw new Error("Montage not found");
    const r = await finishMontageRender(job.montageId, m.createdBy);
    await db.update(renderJobs).set({ status: "done", renderId: r.renderId, error: null, lockedAt: null, lockedBy: null }).where(eq(renderJobs.id, job.id));
    return { ok: true as const, renderId: r.renderId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const permanent = /اختصر النص|مصدر غير صالح|Montage not found|Script not found|Character not found|لا يوجد نص|بعد نهاية الفيديو/.test(msg);
    const final = permanent || job.attempts >= job.maxAttempts;
    await db
      .update(renderJobs)
      .set({ status: final ? "failed" : "queued", error: msg.slice(0, 1000), runAfter: new Date(Date.now() + 2 ** job.attempts * 60_000), lockedAt: null, lockedBy: null })
      .where(eq(renderJobs.id, job.id));
    await db
      .update(montages)
      .set({ status: final ? "failed" : "rendering", error: msg.slice(0, 1000), updatedAt: new Date() })
      .where(eq(montages.id, job.montageId));
    if (final) await notifyOwner({ title: `فشل رندر المونتاج #${job.montageId}`, content: msg.slice(0, 500) }).catch(() => false);
    return { ok: false as const, error: msg };
  }
}

async function loadReferenceImage(refs: string[] | null) {
  for (const ref of refs ?? []) {
    const key = storageKeyFromUrl(ref);
    try {
      if (key) return { buf: await storageDownload(key), ext: (ref.split(".").pop() ?? "png").toLowerCase() };
    } catch {
      /* try the next reference */
    }
  }
  throw new Error("لا توجد صورة مرجعية صالحة للشخصية — ارفع صورة من صفحة الشخصيات");
}

export async function processJob(job: { id: number; scriptId: number; montageId?: number | null; attempts: number; maxAttempts: number }) {
  if (job.montageId) return processMontageJob({ ...job, montageId: job.montageId });
  const db = await requireDb();
  try {
    const [script] = await db.select().from(scripts).where(eq(scripts.id, job.scriptId));
    if (!script) throw new Error("Script not found");
    // Idempotency: a crash after the render was stored must not produce a second render on retry.
    const [existing] = await db.select({ id: renders.id }).from(renders).where(eq(renders.scriptId, script.id)).limit(1);
    const renderable = script.track === "premium" ? script.status === "premium_uploaded" : script.status === "script_ready";
    if (existing || !renderable) {
      await db
        .update(renderJobs)
        .set({ status: "done", renderId: existing?.id ?? null, error: existing ? null : `skipped: script is ${script.status}`, lockedAt: null, lockedBy: null })
        .where(eq(renderJobs.id, job.id));
      return { ok: true as const, renderId: existing?.id ?? null };
    }
    const [ch] = await db.select().from(characters).where(eq(characters.id, script.characterId));
    if (!ch) throw new Error("Character not found");
    const colors = ch.colors ?? { primary: "#0A0A0A", accent: "#DFFF00", text: "#FFFFFF" };
    const motion = TEMPLATES.find(t => t.key === script.templateKey)?.motion ?? "slow_push";
    let out: RenderResult;
    let hasCaptions = true;
    if (script.track === "economic") {
      const img = await loadReferenceImage(ch.referenceImages);
      out = await renderReel({
        image: img.buf,
        imageExt: img.ext,
        spokenText: spokenText(script),
        hook: script.onScreenText ?? script.hook,
        cta: script.cta,
        voice: ch.ttsVoice,
        speed: (Number(ch.ttsSpeed) || 100) / 100,
        font: ch.captionFont,
        colors,
        motion,
      });
    } else {
      const [clip] = script.premiumClipId ? await db.select().from(premiumClips).where(eq(premiumClips.id, script.premiumClipId)) : [];
      const key = storageKeyFromUrl(clip?.videoUrl);
      if (!clip || !key) throw new Error("فيديو Premium غير موجود لهذا النص");
      const words = clip.transcriptWords ?? [];
      hasCaptions = words.length > 0;
      out = await renderFromVideo({
        video: await storageDownload(key),
        words,
        hook: script.onScreenText ?? script.hook,
        cta: script.cta,
        font: ch.captionFont,
        colors,
      });
    }
    const base = `renders/${script.characterId}/s${script.id}`;
    const video = await storagePut(`${base}.mp4`, out.video, "video/mp4");
    const thumb = await storagePut(`${base}.jpg`, out.thumbnail, "image/jpeg");
    const rec = await createRenderRecord(
      {
        scriptId: script.id,
        kind: script.track === "economic" ? "economic" : script.track === "premium" ? "premium" : "derivative",
        videoUrl: video.url,
        storageKey: video.key,
        thumbnailUrl: thumb.url,
        durationMs: out.durationMs,
        width: out.width,
        height: out.height,
        hasAudio: out.hasAudio,
        hasCaptions,
        hasDisclosure: true,
        fileSize: out.fileSize,
        settings: { engine: "server-ffmpeg", disclosure: AI_DISCLOSURE, motion: script.track === "economic" ? motion : "source-video" },
      },
      null,
    );
    await db.update(renderJobs).set({ status: "done", renderId: rec.id, error: null, lockedAt: null, lockedBy: null }).where(eq(renderJobs.id, job.id));
    return { ok: true as const, renderId: rec.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Retrying cannot fix a missing reference image or an over-long script; fail fast so the owner is told now.
    const permanent = /اختصر النص|لا توجد صورة مرجعية|فيديو Premium|Script not found|Character not found/.test(msg);
    const final = permanent || job.attempts >= job.maxAttempts;
    const backoffMin = 2 ** job.attempts; // 2, 4, 8 minutes
    await db
      .update(renderJobs)
      .set({
        status: final ? "failed" : "queued",
        error: msg.slice(0, 1000),
        runAfter: new Date(Date.now() + backoffMin * 60_000),
        lockedAt: null,
        lockedBy: null,
      })
      .where(eq(renderJobs.id, job.id));
    if (final) {
      await notifyOwner({ title: `فشل رندر النص #${job.scriptId}`, content: msg.slice(0, 500) }).catch(() => false);
    }
    return { ok: false as const, error: msg };
  }
}

/** Renders up to `max` queued jobs sequentially (ffmpeg already uses all cores). */
export async function drainQueue(max = 5) {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < max; i++) {
    const job = await claimJob();
    if (!job) break;
    const r = await processJob(job);
    if (r.ok) done++;
    else failed++;
  }
  return { done, failed };
}

export async function queueStats() {
  const db = await requireDb();
  const rows = await db
    .select({ status: renderJobs.status, n: sql<number>`count(*)::int` })
    .from(renderJobs)
    .where(inArray(renderJobs.status, ["queued", "running", "failed", "done"]))
    .groupBy(renderJobs.status);
  return Object.fromEntries(rows.map(r => [r.status, r.n])) as Record<string, number>;
}
