/**
 * "Code → video" queue. The code_videos table is the queue: one render at a time in this process (a headless
 * browser plus x264 is heavy), resumed at startup. Each finished MP4 goes to media storage (Supabase Storage, or the
 * local media folder on the owner's computer) and into the asset library, so the montage room can use it.
 */
import { desc, eq, sql } from "drizzle-orm";
import { assets, codeVideos } from "../../drizzle/schema";
import { codeVideoSize, type CodeVideoInput } from "../../shared/code-video";
import { getDb, requireDb } from "../db";
import { mediaPut } from "../storage";
import { renderCodeVideo } from "../worker/code-video";

let draining: Promise<void> | null = null;

export async function enqueueCodeVideo(input: CodeVideoInput, userId?: number | null) {
  const db = await requireDb();
  const size = codeVideoSize(input.size);
  const title = input.title?.trim() || guessTitle(input.html) || `كود ← فيديو ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const [row] = await db
    .insert(codeVideos)
    .values({ title: title.slice(0, 160), html: input.html, width: size.width, height: size.height, durationSec: input.durationSec, fps: input.fps, createdBy: userId ?? null })
    .returning({ id: codeVideos.id });
  kickCodeVideoQueue();
  return row;
}

/** The <title> of the pasted file, if any. */
export function guessTitle(html: string) {
  const m = /<title[^>]*>([^<]{1,160})<\/title>/i.exec(html);
  return m?.[1].replace(/\s+/g, " ").trim() || null;
}

export function kickCodeVideoQueue() {
  if (draining) return draining;
  draining = drain()
    .catch(e => console.error("[code-video] queue", e))
    .finally(() => {
      draining = null;
    });
  return draining;
}

/** Called once at startup: a render that was running when the server stopped goes back to the queue. */
export async function resumeCodeVideoQueue() {
  const db = await getDb();
  if (!db) return;
  await db.update(codeVideos).set({ status: "queued", progress: 0, updatedAt: new Date() }).where(eq(codeVideos.status, "running"));
  const [next] = await db.select({ id: codeVideos.id }).from(codeVideos).where(eq(codeVideos.status, "queued")).limit(1);
  if (next) void kickCodeVideoQueue();
}

async function claimNext() {
  const db = await requireDb();
  const rows = (await db.execute(sql`update code_videos set status = 'running', progress = 0, error = null, "updatedAt" = now()
    where id = (select id from code_videos where status = 'queued' order by id limit 1 for update skip locked)
    returning id`)) as unknown as { id: number }[];
  return rows[0]?.id ?? null;
}

async function drain() {
  for (;;) {
    const id = await claimNext();
    if (!id) return;
    await processCodeVideo(id);
  }
}

export async function processCodeVideo(id: number) {
  const db = await requireDb();
  const [job] = await db.select().from(codeVideos).where(eq(codeVideos.id, id));
  if (!job) return;
  let lastSaved = 0;
  try {
    const r = await renderCodeVideo({
      html: job.html,
      width: job.width,
      height: job.height,
      durationSec: job.durationSec,
      fps: job.fps,
      onProgress: p => {
        const pct = Math.min(95, Math.round(p * 95));
        if (pct - lastSaved >= 3) {
          lastSaved = pct;
          void db.update(codeVideos).set({ progress: pct, updatedAt: new Date() }).where(eq(codeVideos.id, id)).catch(() => undefined);
        }
      },
    });
    const video = await mediaPut(`code-videos/code-video-${id}.mp4`, r.video, "video/mp4");
    const poster = await mediaPut(`code-videos/code-video-${id}.jpg`, r.poster, "image/jpeg");
    const [asset] = await db
      .insert(assets)
      .values({
        kind: "broll",
        title: `كود ← فيديو: ${job.title}`.slice(0, 255),
        url: video.url,
        storageKey: video.key,
        mimeType: "video/mp4",
        sizeBytes: r.video.length,
        durationMs: Math.round((r.frames / job.fps) * 1000),
        width: job.width,
        height: job.height,
        tags: ["code-video", `${job.width}x${job.height}`],
        meta: { source: "code", sourceId: String(id), credit: "أنيميشن بالكود" },
        createdBy: job.createdBy,
      })
      .returning({ id: assets.id });
    const note = r.blocked.length ? `طُلبت روابط خارج المسموح ومُنعت: ${r.blocked.slice(0, 3).join(" · ")}` : null;
    await db
      .update(codeVideos)
      .set({ status: "done", progress: 100, videoUrl: video.url, storageKey: video.key, posterUrl: poster.url, assetId: asset.id, sizeBytes: r.video.length, error: note, updatedAt: new Date() })
      .where(eq(codeVideos.id, id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[code-video] #${id} failed:`, msg);
    await db.update(codeVideos).set({ status: "failed", error: msg.slice(0, 1000), updatedAt: new Date() }).where(eq(codeVideos.id, id));
  }
}

export async function listCodeVideos(limit = 60) {
  const db = await requireDb();
  return db
    .select({
      id: codeVideos.id,
      title: codeVideos.title,
      width: codeVideos.width,
      height: codeVideos.height,
      durationSec: codeVideos.durationSec,
      fps: codeVideos.fps,
      status: codeVideos.status,
      progress: codeVideos.progress,
      videoUrl: codeVideos.videoUrl,
      posterUrl: codeVideos.posterUrl,
      assetId: codeVideos.assetId,
      sizeBytes: codeVideos.sizeBytes,
      error: codeVideos.error,
      createdAt: codeVideos.createdAt,
    })
    .from(codeVideos)
    .orderBy(desc(codeVideos.id))
    .limit(limit);
}
