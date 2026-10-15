import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { characters, renderJobs, renders, scripts } from "../../drizzle/schema";
import { AI_DISCLOSURE, spokenText, TEMPLATES } from "../../shared/domain";
import { requireDb } from "../db";
import { notifyOwner } from "../services/notify";
import { createRenderRecord } from "../services/render-records";
import { storageDownload, storageKeyFromUrl, storagePut } from "../storage";
import { renderReel } from "./renderer";

const WORKER_ID = `${process.env.HOSTNAME ?? "local"}:${process.pid}`;
const STALE_LOCK_MINUTES = 20;

/** Queues every economic script that is ready and has neither a render nor a job. */
export async function enqueueReadyScripts(limit = 60) {
  const db = await requireDb();
  const rows = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(
      and(
        eq(scripts.status, "script_ready"),
        eq(scripts.track, "economic"),
        notExists(db.select({ x: renderJobs.id }).from(renderJobs).where(eq(renderJobs.scriptId, scripts.id))),
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
    ) returning id, "scriptId", attempts, "maxAttempts"`);
  const row = (res as unknown as { id: number; scriptId: number; attempts: number; maxAttempts: number }[])[0];
  return row ?? null;
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

export async function processJob(job: { id: number; scriptId: number; attempts: number; maxAttempts: number }) {
  const db = await requireDb();
  try {
    const [script] = await db.select().from(scripts).where(eq(scripts.id, job.scriptId));
    if (!script) throw new Error("Script not found");
    // Idempotency: a crash after the render was stored must not produce a second render on retry.
    const [existing] = await db.select({ id: renders.id }).from(renders).where(eq(renders.scriptId, script.id)).limit(1);
    if (existing || script.status !== "script_ready") {
      await db
        .update(renderJobs)
        .set({ status: "done", renderId: existing?.id ?? null, error: existing ? null : `skipped: script is ${script.status}`, lockedAt: null, lockedBy: null })
        .where(eq(renderJobs.id, job.id));
      return { ok: true as const, renderId: existing?.id ?? null };
    }
    const [ch] = await db.select().from(characters).where(eq(characters.id, script.characterId));
    if (!ch) throw new Error("Character not found");
    const img = await loadReferenceImage(ch.referenceImages);
    const motion = TEMPLATES.find(t => t.key === script.templateKey)?.motion ?? "slow_push";
    const out = await renderReel({
      image: img.buf,
      imageExt: img.ext,
      spokenText: spokenText(script),
      hook: script.onScreenText ?? script.hook,
      cta: script.cta,
      voice: ch.ttsVoice,
      speed: (Number(ch.ttsSpeed) || 100) / 100,
      font: ch.captionFont,
      colors: ch.colors ?? { primary: "#0A0A0A", accent: "#DFFF00", text: "#FFFFFF" },
      motion,
    });
    const base = `renders/${script.characterId}/s${script.id}`;
    const video = await storagePut(`${base}.mp4`, out.video, "video/mp4");
    const thumb = await storagePut(`${base}.jpg`, out.thumbnail, "image/jpeg");
    const rec = await createRenderRecord(
      {
        scriptId: script.id,
        kind: "economic",
        videoUrl: video.url,
        storageKey: video.key,
        thumbnailUrl: thumb.url,
        durationMs: out.durationMs,
        width: out.width,
        height: out.height,
        hasAudio: out.hasAudio,
        hasCaptions: true,
        hasDisclosure: true,
        fileSize: out.fileSize,
        settings: { engine: "server-ffmpeg", disclosure: AI_DISCLOSURE, motion },
      },
      null,
    );
    await db.update(renderJobs).set({ status: "done", renderId: rec.id, error: null, lockedAt: null, lockedBy: null }).where(eq(renderJobs.id, job.id));
    return { ok: true as const, renderId: rec.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Retrying cannot fix a missing reference image or an over-long script; fail fast so the owner is told now.
    const permanent = /اختصر النص|لا توجد صورة مرجعية|Script not found|Character not found/.test(msg);
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
