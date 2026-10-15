import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { characters, premiumClips, scripts, type TranscriptWord } from "../../drizzle/schema";
import { spokenText } from "../../shared/domain";
import { getSettings, requireDb } from "../db";
import { storageGetSignedUrl, storageKeyFromUrl } from "../storage";
import { generateDerivativeVariants } from "./ai";
import { transcribeAudio } from "./transcription";

/** Splits Whisper segments into per-word timings (proportional to word length inside each segment). */
export function wordsFromSegments(segments: { start: number; end: number; text: string }[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const seg of segments) {
    const words = seg.text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const total = words.reduce((a, w) => a + w.length + 1, 0);
    let t = seg.start;
    const span = Math.max(0.05, seg.end - seg.start);
    for (const w of words) {
      const d = (span * (w.length + 1)) / total;
      out.push({ word: w, start: Number(t.toFixed(3)), end: Number((t + d).toFixed(3)) });
      t += d;
    }
  }
  return out;
}

/** Creates `count` derivative scripts (new hook / CTA / caption, same footage) from a received premium clip. */
export async function createDerivativesForClip(clipId: number, count: number, userId: number | null) {
  const db = await requireDb();
  const [clip] = await db.select().from(premiumClips).where(eq(premiumClips.id, clipId));
  if (!clip) throw new Error("اللقطة غير موجودة");
  if (!clip.videoUrl) throw new Error("ارفع فيديو Higgsfield أولًا");
  const [script] = await db.select().from(scripts).where(eq(scripts.id, clip.scriptId));
  const [character] = await db.select().from(characters).where(eq(characters.id, clip.characterId));
  const settings = await getSettings();
  const variants = await generateDerivativeVariants({
    character,
    transcript: clip.transcript || spokenText(script),
    originalHook: script.hook,
    count,
    model: settings.scriptModel,
    userId: userId ?? undefined,
    clipId: clip.id,
  });
  const ids: number[] = [];
  for (const v of variants) {
    const [r] = await db
      .insert(scripts)
      .values({
        characterId: clip.characterId,
        batchId: script.batchId,
        status: "script_ready",
        track: "derivative",
        templateKey: script.templateKey,
        hookType: v.hookType,
        topic: `${script.topic ?? ""} · ${v.variantLabel}`.slice(0, 255),
        hook: v.hook,
        body: clip.transcript || script.body,
        payoff: null,
        cta: v.cta,
        onScreenText: v.onScreenText.slice(0, 255),
        caption: v.caption,
        hashtags: v.hashtags.slice(0, 500),
        parentScriptId: script.id,
        premiumClipId: clip.id,
        notes: v.variantLabel,
        createdBy: userId,
      })
      .returning({ id: scripts.id });
    ids.push(r.id);
  }
  await db
    .update(premiumClips)
    .set({ derivativesCreated: sql`${premiumClips.derivativesCreated} + ${ids.length}` })
    .where(eq(premiumClips.id, clip.id));
  return { created: ids.length, ids };
}

/**
 * Autopilot step for received premium clips: transcribe once (word timings for captions),
 * then create the configured number of derivative scripts once. Both steps are idempotent.
 */
export async function processReceivedClips(limit = 3) {
  const db = await requireDb();
  const settings = await getSettings();
  const rows = await db
    .select()
    .from(premiumClips)
    .where(and(eq(premiumClips.status, "received"), isNotNull(premiumClips.videoUrl), eq(premiumClips.derivativesCreated, 0)))
    .limit(limit);
  let transcribed = 0;
  let derived = 0;
  const errors: string[] = [];
  for (const clip of rows) {
    try {
      if (!clip.transcript) {
        const key = storageKeyFromUrl(clip.videoUrl);
        const url = key ? await storageGetSignedUrl(key) : clip.videoUrl!;
        const r = await transcribeAudio({ audioUrl: url, language: "en" });
        if (!("error" in r)) {
          await db
            .update(premiumClips)
            .set({ transcript: r.text.trim(), transcriptWords: wordsFromSegments(r.segments ?? []) })
            .where(and(eq(premiumClips.id, clip.id), isNull(premiumClips.transcript)));
          transcribed++;
        }
      }
      if (settings.derivativesPerPremium > 0) {
        const d = await createDerivativesForClip(clip.id, settings.derivativesPerPremium, null);
        derived += d.created;
      }
    } catch (e) {
      errors.push(`clip-${clip.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { checked: rows.length, transcribed, derived, errors };
}
