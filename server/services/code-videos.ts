/**
 * "Code → video" queue. The code_videos table is the queue: one render at a time in this process (a headless
 * browser plus x264 is heavy), resumed at startup. Each finished MP4 goes to media storage (Supabase Storage, or the
 * local media folder on the owner's computer) and into the asset library, so the montage room can use it.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { desc, eq, sql } from "drizzle-orm";
import { assets, codeVideos } from "../../drizzle/schema";
import { codeVideoSize, type CodeVideoInput, type RenderQuality } from "../../shared/code-video";
import { getDb, requireDb } from "../db";
import { mediaPut } from "../storage";
import { renderCodeVideo, renderOverlay, type CodeVideoRender } from "../worker/code-video";
import { storageDownload } from "../storage";

async function sourceFile(key: string) {
  const dir = await mkdtemp(join(tmpdir(), "overlay-src-"));
  const path = join(dir, "source.mp4");
  await writeFile(path, await storageDownload(key));
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => undefined) };
}

const run = promisify(execFile);

let draining: Promise<void> | null = null;

export async function enqueueCodeVideo(input: CodeVideoInput, userId?: number | null) {
  const db = await requireDb();
  const size = codeVideoSize(input.size);
  const title = input.title?.trim() || guessTitle(input.html) || `كود ← فيديو ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const [row] = await db
    .insert(codeVideos)
    .values({ title: title.slice(0, 160), html: input.html, width: size.width, height: size.height, durationSec: input.durationSec, fps: input.fps, quality: input.quality ?? "standard", createdBy: userId ?? null })
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
    const report = (p: number) => {
      const pct = Math.min(95, Math.round(p * 95));
      if (pct - lastSaved >= 1) {
        lastSaved = pct;
        void db.update(codeVideos).set({ progress: pct, updatedAt: new Date() }).where(eq(codeVideos.id, id)).catch(() => undefined);
      }
    };
    const segments = job.plan?.segments?.filter(s => s.html) ?? [];
    const quality: RenderQuality = job.quality === "cinema" ? "cinema" : "standard";
    const overlayOn = job.sourceKey ? await sourceFile(job.sourceKey) : null;
    const duration = Number((job.analysis as { map?: { duration?: number } } | null)?.map?.duration) || job.durationSec;
    const r = overlayOn
      ? await renderOverlay({ html: job.html, videoPath: overlayOn.path, width: job.width, height: job.height, durationSec: duration, fps: job.fps, onProgress: report }).finally(() => overlayOn.cleanup())
      : segments.length > 1
      ? await renderSegments(segments.map(s => ({ html: s.html!, seconds: s.seconds })), job.width, job.height, job.fps, report, quality)
      : await renderCodeVideo({ html: job.html, width: job.width, height: job.height, durationSec: job.durationSec, fps: job.fps, quality, onProgress: report });
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

/** Long videos: each segment rendered on its own, then joined without re-encoding (same size, fps and codec). */
export async function renderSegments(parts: { html: string; seconds: number }[], width: number, height: number, fps: number, onProgress: (p: number) => void, quality: RenderQuality = "standard"): Promise<CodeVideoRender> {
  const dir = await mkdtemp(join(tmpdir(), "code-video-join-"));
  try {
    const total = parts.reduce((a, p) => a + p.seconds, 0);
    let done = 0;
    let poster: Buffer | null = null;
    let frames = 0;
    const blocked: string[] = [];
    const consoleErrors: string[] = [];
    const files: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const r = await renderCodeVideo({ html: part.html, width, height, durationSec: part.seconds, fps, quality, onProgress: p => onProgress((done + p * part.seconds) / total) });
      const file = join(dir, `part${String(i).padStart(3, "0")}.mp4`);
      await writeFile(file, r.video);
      files.push(file);
      poster ??= r.poster;
      frames += r.frames;
      blocked.push(...r.blocked);
      consoleErrors.push(...r.consoleErrors);
      done += part.seconds;
    }
    const list = join(dir, "list.txt");
    await writeFile(list, files.map(f => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
    const out = join(dir, "joined.mp4");
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out], { maxBuffer: 8 * 1024 * 1024 });
    return { video: await readFile(out), poster: poster!, frames, blocked: blocked.slice(0, 20), consoleErrors: consoleErrors.slice(0, 20) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
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
      quality: codeVideos.quality,
      status: codeVideos.status,
      progress: codeVideos.progress,
      videoUrl: codeVideos.videoUrl,
      posterUrl: codeVideos.posterUrl,
      assetId: codeVideos.assetId,
      sizeBytes: codeVideos.sizeBytes,
      error: codeVideos.error,
      engine: codeVideos.engine,
      sourceKey: codeVideos.sourceKey,
      agentLog: codeVideos.agentLog,
      segments: sql<number>`coalesce(jsonb_array_length(${codeVideos.plan}->'segments'), 0)`,
      createdAt: codeVideos.createdAt,
    })
    .from(codeVideos)
    .orderBy(desc(codeVideos.id))
    .limit(limit);
}
