/**
 * Montage projects: default edits from a script, source resolution for the renderer, preview and
 * final renders, and the rule that a finished montage supersedes the script's automatic render.
 */
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assets, characters, montages, posts, premiumClips, renders, scripts, type Character, type Montage, type Script } from "../../drizzle/schema";
import { spokenText } from "../../shared/domain";
import { defaultMontageSpec, MONTAGE_MOTIONS, montageSpecSchema, newSegmentId, type MontageSpec } from "../../shared/montage";
import { requireDb } from "../db";
import { storageDownload, storageKeyFromUrl, storagePut } from "../storage";
import { describeSpec, renderMontage, type MontageRenderResult } from "../worker/montage";
import { createRenderRecord } from "./render-records";

const CLIP_MAX_SECONDS = 12.8;

/** Starting edit for a script: its premium clip (with transcript) or the character's stills with narration. */
export async function buildDefaultSpec(script: Script, character: Character): Promise<MontageSpec> {
  const db = await requireDb();
  const [clip] = script.premiumClipId ? await db.select().from(premiumClips).where(eq(premiumClips.id, script.premiumClipId)) : [];
  if (clip?.videoUrl && storageKeyFromUrl(clip.videoUrl)) {
    const dur = (clip.durationMs ?? 0) / 1000;
    return defaultMontageSpec({
      segments: [
        {
          id: newSegmentId(),
          kind: "video",
          src: clip.videoUrl,
          label: "لقطة Premium",
          in: 0,
          out: Number((dur > 0 ? Math.min(CLIP_MAX_SECONDS, dur) : CLIP_MAX_SECONDS).toFixed(2)),
          words: clip.transcriptWords ?? [],
        },
      ],
      voice: { source: "segments" },
      transition: { type: "fade", duration: 0.4 },
    });
  }
  const refs = (character.referenceImages ?? []).filter(u => storageKeyFromUrl(u)).slice(0, 4);
  if (!refs.length) throw new Error("لا توجد صور مرجعية للشخصية — ارفع صورة من صفحة الشخصيات أولًا");
  return defaultMontageSpec({
    segments: refs.map((src, i) => ({
      id: newSegmentId(),
      kind: "image",
      src,
      label: `صورة ${i + 1}`,
      duration: refs.length === 1 ? 15 : Number((15.5 / refs.length + 0.5).toFixed(1)),
      motion: MONTAGE_MOTIONS[i % MONTAGE_MOTIONS.length],
    })),
    voice: { source: "tts" },
  });
}

export async function loadMontageContext(montageId: number) {
  const db = await requireDb();
  const [m] = await db.select().from(montages).where(eq(montages.id, montageId));
  if (!m) throw new Error("Montage not found");
  const [script] = await db.select().from(scripts).where(eq(scripts.id, m.scriptId));
  if (!script) throw new Error("Script not found");
  const [character] = await db.select().from(characters).where(eq(characters.id, m.characterId));
  if (!character) throw new Error("Character not found");
  return { montage: m, script, character };
}

/** Downloads every source once into `dir`; returns one local path per segment plus the music file. */
export async function resolveSources(spec: MontageSpec, dir: string) {
  const cache = new Map<string, string>();
  let n = 0;
  const fetchKey = async (url: string, fallbackExt: string) => {
    const key = storageKeyFromUrl(url);
    if (!key) throw new Error(`مصدر غير صالح: ${url.slice(0, 80)} — استخدم ملفات المكتبة فقط`);
    const hit = cache.get(key);
    if (hit) return hit;
    const ext = (key.split(".").pop() ?? fallbackExt).toLowerCase().replace(/[^a-z0-9]/g, "") || fallbackExt;
    const path = join(dir, `src${n++}.${ext}`);
    await writeFile(path, await storageDownload(key));
    cache.set(key, path);
    return path;
  };
  const files: string[] = [];
  for (const seg of spec.segments) files.push(await fetchKey(seg.src, seg.kind === "video" ? "mp4" : "jpg"));
  const musicFile = spec.music.src && spec.music.volume > 0 ? await fetchKey(spec.music.src, "mp3") : null;
  return { files, musicFile };
}

/** Renders a montage (preview at 540×960 or final 1080×1920). */
export async function renderMontageProject(montageId: number, opts: { preview: boolean }) {
  const { montage, script, character } = await loadMontageContext(montageId);
  const spec = montageSpecSchema.parse(montage.spec);
  const dir = await mkdtemp(join(tmpdir(), "montage-src-"));
  try {
    const { files, musicFile } = await resolveSources(spec, dir);
    const out = await renderMontage({
      spec,
      files,
      musicFile,
      spokenText: spokenText(script),
      hook: script.onScreenText ?? script.hook,
      cta: script.cta,
      voice: character.ttsVoice,
      speed: (Number(character.ttsSpeed) || 100) / 100,
      font: character.captionFont,
      colors: character.colors ?? { primary: "#0A0A0A", accent: "#DFFF00", text: "#FFFFFF" },
      preview: opts.preview,
    });
    return { out, spec, script, character, montage };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function savePreview(montageId: number, out: MontageRenderResult) {
  const db = await requireDb();
  const put = await storagePut(`montage/${montageId}/preview.mp4`, out.video, "video/mp4");
  await db
    .update(montages)
    .set({ previewUrl: put.url, previewKey: put.key, updatedAt: new Date(), error: null })
    .where(eq(montages.id, montageId));
  return put;
}

/**
 * The montage is the reel now: older renders of the script that were never posted are marked rejected so the
 * scheduler cannot publish both versions.
 */
export async function supersedeOlderRenders(scriptId: number, keepRenderId: number) {
  const db = await requireDb();
  const posted = (await db.select({ renderId: posts.renderId }).from(posts).where(eq(posts.scriptId, scriptId))).map(p => p.renderId);
  const old = await db
    .select({ id: renders.id })
    .from(renders)
    .where(and(eq(renders.scriptId, scriptId), sql`${renders.id} <> ${keepRenderId}`, posted.length ? notInArray(renders.id, posted) : sql`true`));
  if (!old.length) return 0;
  await db
    .update(renders)
    .set({ qcStatus: "rejected", reviewNotes: `استُبدل بنسخة المونتاج (render #${keepRenderId})` })
    .where(inArray(renders.id, old.map(o => o.id)));
  return old.length;
}

/** Final render → storage → render record (QC) → montage row updated. Used by the queue worker. */
export async function finishMontageRender(montageId: number, createdBy: number | null) {
  const db = await requireDb();
  const { out, spec, script, montage } = await renderMontageProject(montageId, { preview: false });
  const base = `renders/${script.characterId}/s${script.id}-m${montageId}`;
  const video = await storagePut(`${base}.mp4`, out.video, "video/mp4");
  const thumb = await storagePut(`${base}.jpg`, out.thumbnail, "image/jpeg");
  const rec = await createRenderRecord(
    {
      scriptId: script.id,
      kind: "montage",
      variantLabel: montage.title.slice(0, 120),
      videoUrl: video.url,
      storageKey: video.key,
      thumbnailUrl: thumb.url,
      durationMs: out.durationMs,
      width: out.width,
      height: out.height,
      hasAudio: out.hasAudio,
      hasCaptions: out.hasCaptions,
      hasDisclosure: true,
      fileSize: out.fileSize,
      settings: { ...describeSpec(spec), montageId },
    },
    createdBy,
  );
  const superseded = await supersedeOlderRenders(script.id, rec.id);
  await db
    .update(montages)
    .set({ status: "rendered", renderId: rec.id, error: null, updatedAt: new Date() })
    .where(eq(montages.id, montageId));
  return { renderId: rec.id, qc: rec.qc, superseded };
}

export async function listMontages(limit = 60) {
  const db = await requireDb();
  return db
    .select({
      id: montages.id,
      title: montages.title,
      status: montages.status,
      scriptId: montages.scriptId,
      characterId: montages.characterId,
      previewUrl: montages.previewUrl,
      renderId: montages.renderId,
      error: montages.error,
      updatedAt: montages.updatedAt,
      segments: sql<number>`jsonb_array_length(${montages.spec}->'segments')`,
      hook: scripts.hook,
      thumbnailUrl: renders.thumbnailUrl,
      qcStatus: renders.qcStatus,
    })
    .from(montages)
    .leftJoin(scripts, eq(scripts.id, montages.scriptId))
    .leftJoin(renders, eq(renders.id, montages.renderId))
    .orderBy(desc(montages.updatedAt))
    .limit(limit);
}

/** Library media the editor can place on the timeline (clips, stills, music) with their provenance. */
export async function montageMedia() {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(assets)
    .where(inArray(assets.kind, ["broll", "premium_video", "render", "background", "character_image", "music"]))
    .orderBy(desc(assets.id))
    .limit(400);
  return rows.map(a => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    url: a.url,
    characterId: a.characterId,
    durationMs: a.durationMs,
    width: a.width,
    height: a.height,
    credit: a.meta?.credit ?? null,
    sourceUrl: a.meta?.sourceUrl ?? null,
  }));
}

export type MontageRow = Montage;
