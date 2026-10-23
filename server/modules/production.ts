import { probeBufferDurationMs } from "../worker/media";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  assets,
  characters,
  costEntries,
  premiumClips,
  renders,
  scripts,
  type TranscriptWord,
} from "../../drizzle/schema";
import { milliCentsFromUsd } from "../../shared/domain";
import { buildHiggsfieldPrompt, evaluateQc } from "../../shared/production";
import { router } from "../_core/trpc";
import { transcribeAudio } from "../services/transcription";
import { getSettings, requireDb } from "../db";
import { memberProcedure } from "../procedures";
import { visualConsistencyCheck } from "../services/ai";
import { storageGetSignedUrl, storageKeyFromUrl, storagePut } from "../storage";
import { createRenderRecord } from "../services/render-records";
import { createDerivativesForClip, wordsFromSegments } from "../services/premium-pipeline";
import { monthSpentUsd } from "../services/batch";
import { cancelHiggsfield, getHiggsfieldStatus, higgsfieldConfigured, submitHiggsfield } from "../services/higgsfield";

async function absoluteUrl(url: string | null | undefined) {
  const key = storageKeyFromUrl(url);
  if (key) return storageGetSignedUrl(key);
  if (url && /^https?:\/\//.test(url)) return url;
  return null;
}

export const premiumRouter = router({
  list: memberProcedure
    .input(z.object({ status: z.array(z.enum(["requested", "generating", "received", "failed"])).optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select({ clip: premiumClips, script: scripts, character: characters })
        .from(premiumClips)
        .innerJoin(scripts, eq(scripts.id, premiumClips.scriptId))
        .innerJoin(characters, eq(characters.id, premiumClips.characterId))
        .where(input?.status?.length ? inArray(premiumClips.status, input.status) : undefined)
        .orderBy(desc(premiumClips.id))
        .limit(300);
      return rows.map(r => ({ ...r, fullPrompt: buildHiggsfieldPrompt(r.character, r.script) }));
    }),
  submitToHiggsfield: memberProcedure.input(z.object({ id: z.number(), model: z.string().max(180).optional() })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const [row] = await db.select({ clip: premiumClips, script: scripts, character: characters }).from(premiumClips).innerJoin(scripts, eq(scripts.id, premiumClips.scriptId)).innerJoin(characters, eq(characters.id, premiumClips.characterId)).where(eq(premiumClips.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "اللقطة غير موجودة" });
    if (!(await higgsfieldConfigured())) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "اربط Higgsfield من مركز التكاملات أولًا (apiKey و apiSecret)." });
    // Paid call: never resubmit a clip that is already generating or delivered, and respect the monthly budget.
    if (row.clip.status === "generating" || row.clip.status === "received") {
      throw new TRPCError({ code: "CONFLICT", message: "هذه اللقطة قيد التوليد أو مستلمة بالفعل" });
    }
    {
      const s = await getSettings();
      const attemptUsd = s.higgsfieldCreditsPerAttempt * s.higgsfieldUsdPerCredit;
      if ((await monthSpentUsd()) + attemptUsd > s.monthlyBudgetUsd) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `تجاوز ميزانية الشهر (${s.monthlyBudgetUsd}$). ارفع الميزانية من الإعدادات أو انتظر الشهر القادم.` });
      }
    }
    const result = await submitHiggsfield({ model: input.model || row.clip.model, prompt: buildHiggsfieldPrompt(row.character, row.script), duration: 15, aspectRatio: "9:16", idempotencyKey: `premium-clip-${input.id}-attempt-${row.clip.attempts + 1}` });
    const settings = await getSettings();
    const credits = settings.higgsfieldCreditsPerAttempt;
    const usd = credits * settings.higgsfieldUsdPerCredit;
    await db.update(premiumClips).set({ status: "generating", model: input.model || row.clip.model || "kling-video/v3.0/std/text-to-video", providerRequestId: result.request_id, providerStatusUrl: result.status_url ?? null, providerCancelUrl: result.cancel_url ?? null, providerError: null, submittedAt: new Date(), attempts: sql`${premiumClips.attempts} + 1`, creditsSpent: sql`${premiumClips.creditsSpent} + ${credits}`, costCents: sql`${premiumClips.costCents} + ${Math.round(usd * 100)}` }).where(eq(premiumClips.id, input.id));
    await db.insert(costEntries).values({ category: "higgsfield", amountMilliCents: milliCentsFromUsd(usd), credits, description: `Higgsfield API: محاولة تلقائية للّقطة #${input.id}`, refType: "premium_clip", refId: input.id, createdBy: ctx.user.id });
    return { status: result.status, requestId: result.request_id };
  }),
  syncFromHiggsfield: memberProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [clip] = await db.select().from(premiumClips).where(eq(premiumClips.id, input.id));
    if (!clip?.providerStatusUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "لم يتم إرسال هذه اللقطة إلى Higgsfield بعد" });
    const result = await getHiggsfieldStatus(clip.providerStatusUrl);
    if (result.status === "completed" && result.video?.url) {
      const video = await fetch(result.video.url);
      if (!video.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "تعذر تنزيل فيديو Higgsfield" });
      const buf = Buffer.from(await video.arrayBuffer());
      const stored = await storagePut(`premium/${clip.characterId}/clip-${clip.id}.mp4`, buf, "video/mp4");
      const durationMs = await probeBufferDurationMs(buf, 15000);
      await db.update(premiumClips).set({ status: "received", videoUrl: stored.url, durationMs, providerError: null, completedAt: new Date() }).where(eq(premiumClips.id, clip.id));
      await db.update(scripts).set({ status: "premium_uploaded" }).where(eq(scripts.id, clip.scriptId));
      return { status: "received", videoUrl: stored.url };
    }
    if (["failed", "cancelled", "nsfw"].includes(result.status)) await db.update(premiumClips).set({ status: "failed", providerError: JSON.stringify(result.error ?? result.status).slice(0, 1000) }).where(eq(premiumClips.id, clip.id));
    return { status: result.status, videoUrl: null };
  }),
  cancelHiggsfield: memberProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [clip] = await db.select().from(premiumClips).where(eq(premiumClips.id, input.id));
    if (!clip?.providerCancelUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد طلب Higgsfield قابل للإلغاء" });
    await cancelHiggsfield(clip.providerCancelUrl);
    await db.update(premiumClips).set({ status: "failed", providerError: "تم الإلغاء من لوحة الإنتاج" }).where(eq(premiumClips.id, input.id));
    return { ok: true };
  }),
  update: memberProcedure
    .input(
      z.object({
        id: z.number(),
        data: z
          .object({
            status: z.enum(["requested", "generating", "received", "failed"]),
            model: z.string().max(120),
            notes: z.string().nullable(),
          })
          .partial(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.update(premiumClips).set(input.data).where(eq(premiumClips.id, input.id));
      return { ok: true };
    }),
  logAttempt: memberProcedure
    .input(z.object({ id: z.number(), attempts: z.number().int().min(1).max(20), creditsPerAttempt: z.number().int().min(0).max(5000) }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const s = await getSettings();
      const credits = input.attempts * input.creditsPerAttempt;
      const usd = credits * s.higgsfieldUsdPerCredit;
      await db
        .update(premiumClips)
        .set({
          attempts: sql`${premiumClips.attempts} + ${input.attempts}`,
          creditsSpent: sql`${premiumClips.creditsSpent} + ${credits}`,
          costCents: sql`${premiumClips.costCents} + ${Math.round(usd * 100)}`,
          status: "generating",
        })
        .where(eq(premiumClips.id, input.id));
      await db.insert(costEntries).values({
        category: "higgsfield",
        amountMilliCents: milliCentsFromUsd(usd),
        credits,
        description: `Higgsfield: ${input.attempts} محاولة × ${input.creditsPerAttempt} رصيد (لقطة #${input.id})`,
        refType: "premium_clip",
        refId: input.id,
        createdBy: ctx.user.id,
      });
      return { credits, usd };
    }),
  attachVideo: memberProcedure
    .input(
      z.object({
        id: z.number(),
        assetId: z.number(),
        videoUrl: z.string(),
        durationMs: z.number().int(),
        audioUrl: z.string().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [clip] = await db.select().from(premiumClips).where(eq(premiumClips.id, input.id));
      if (!clip) throw new TRPCError({ code: "NOT_FOUND", message: "اللقطة غير موجودة" });
      let transcript: string | null = null;
      let words: TranscriptWord[] | null = null;
      let transcribeError: string | null = null;
      if (input.audioUrl) {
        const abs = await absoluteUrl(input.audioUrl);
        if (abs) {
          const r = await transcribeAudio({ audioUrl: abs, language: "en" });
          if ("error" in r) transcribeError = `${r.error}${r.details ? `: ${r.details}` : ""}`;
          else {
            transcript = r.text.trim();
            words = wordsFromSegments(r.segments ?? []);
          }
        }
      }
      await db
        .update(premiumClips)
        .set({
          status: "received",
          videoAssetId: input.assetId,
          videoUrl: input.videoUrl,
          durationMs: input.durationMs,
          transcript,
          transcriptWords: words,
        })
        .where(eq(premiumClips.id, input.id));
      await db.update(scripts).set({ status: "premium_uploaded" }).where(eq(scripts.id, clip.scriptId));
      await db.update(assets).set({ characterId: clip.characterId }).where(eq(assets.id, input.assetId));
      return { transcript, words: words?.length ?? 0, transcribeError };
    }),
  setTranscript: memberProcedure
    .input(z.object({ id: z.number(), transcript: z.string().min(1), durationMs: z.number().int().optional() }))
    .mutation(async ({ input }) => {
      // Manual transcript fallback: spread words evenly over the clip.
      const db = await requireDb();
      const [clip] = await db.select().from(premiumClips).where(eq(premiumClips.id, input.id));
      if (!clip) throw new TRPCError({ code: "NOT_FOUND", message: "اللقطة غير موجودة" });
      const dur = (input.durationMs ?? clip.durationMs ?? 8000) / 1000;
      const words = wordsFromSegments([{ start: 0.2, end: Math.max(0.5, dur - 0.3), text: input.transcript }]);
      await db.update(premiumClips).set({ transcript: input.transcript, transcriptWords: words }).where(eq(premiumClips.id, input.id));
      return { words: words.length };
    }),
  generateDerivatives: memberProcedure
    .input(z.object({ id: z.number(), count: z.number().int().min(1).max(8) }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await createDerivativesForClip(input.id, input.count, ctx.user.id);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "تعذر توليد النسخ المشتقة" });
      }
    }),
});

const renderInput = z.object({
  scriptId: z.number(),
  kind: z.enum(["economic", "derivative", "premium"]),
  variantLabel: z.string().max(120).nullable().optional(),
  videoUrl: z.string(),
  storageKey: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  durationMs: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  hasAudio: z.boolean(),
  hasCaptions: z.boolean(),
  hasDisclosure: z.boolean(),
  fileSize: z.number().int(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const rendersRouter = router({
  /** Items ready for the browser render engine. */
  queue: memberProcedure.query(async () => {
    const db = await requireDb();
    const rendered = await db.select({ scriptId: renders.scriptId }).from(renders);
    const done = new Set(rendered.map(r => r.scriptId));
    const economic = await db
      .select()
      .from(scripts)
      .where(and(eq(scripts.track, "economic"), inArray(scripts.status, ["script_ready", "needs_review"])))
      .orderBy(desc(scripts.id))
      .limit(500);
    const derived = await db
      .select({ script: scripts, clip: premiumClips })
      .from(scripts)
      .innerJoin(premiumClips, eq(premiumClips.id, scripts.premiumClipId))
      .where(
        and(
          inArray(scripts.track, ["derivative", "premium"]),
          inArray(scripts.status, ["script_ready", "premium_uploaded", "needs_review"]),
          isNotNull(premiumClips.videoUrl),
        ),
      )
      .orderBy(desc(scripts.id))
      .limit(500);
    return {
      economic: economic.filter(s => !done.has(s.id)),
      video: derived.filter(r => !done.has(r.script.id)),
    };
  }),
  clipForScript: memberProcedure.input(z.object({ scriptId: z.number() })).query(async ({ input }) => {
    const db = await requireDb();
    const [s] = await db.select().from(scripts).where(eq(scripts.id, input.scriptId));
    if (!s?.premiumClipId) return null;
    const [clip] = await db.select().from(premiumClips).where(eq(premiumClips.id, s.premiumClipId));
    return clip ?? null;
  }),
  create: memberProcedure.input(renderInput).mutation(async ({ input, ctx }) => {
    try {
      return await createRenderRecord(input, ctx.user.id);
    } catch (e) {
      if (e instanceof Error && e.message === "Script not found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "النص غير موجود" });
      }
      throw e;
    }
  }),
  list: memberProcedure
    .input(
      z
        .object({
          qcStatus: z.array(z.enum(["pending", "approved", "needs_review", "rejected"])).optional(),
          characterId: z.number().optional(),
          limit: z.number().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const conds = [];
      if (input?.qcStatus?.length) conds.push(inArray(renders.qcStatus, input.qcStatus));
      if (input?.characterId) conds.push(eq(renders.characterId, input.characterId));
      return db
        .select({ render: renders, script: scripts })
        .from(renders)
        .innerJoin(scripts, eq(scripts.id, renders.scriptId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(renders.id))
        .limit(input?.limit ?? 200);
    }),
  review: memberProcedure
    .input(z.object({ id: z.number(), qcStatus: z.enum(["approved", "needs_review", "rejected"]), notes: z.string().nullable().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [r] = await db.select().from(renders).where(eq(renders.id, input.id));
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "الرندر غير موجود" });
      await db
        .update(renders)
        .set({ qcStatus: input.qcStatus, reviewNotes: input.notes ?? null, reviewedBy: ctx.user.id })
        .where(eq(renders.id, input.id));
      await db.update(scripts).set({ status: input.qcStatus }).where(eq(scripts.id, r.scriptId));
      return { ok: true };
    }),
  visualCheck: memberProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const [r] = await db.select().from(renders).where(eq(renders.id, input.id));
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "الرندر غير موجود" });
    if (!r.thumbnailUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد صورة مصغرة لهذا الرندر" });
    const [c] = await db.select().from(characters).where(eq(characters.id, r.characterId));
    const settings = await getSettings();
    const frameUrl = await absoluteUrl(r.thumbnailUrl);
    const refUrl = await absoluteUrl(c.referenceImages?.[0] ?? null);
    if (!frameUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "تعذر الوصول للصورة المصغرة" });
    const result = await visualConsistencyCheck({
      frameUrl,
      referenceUrl: refUrl,
      character: c,
      model: settings.reviewModel,
      userId: ctx.user.id,
      renderId: r.id,
    });
    const visualQc = { ...result, checkedAt: new Date().toISOString() };
    await db.update(renders).set({ visualQc }).where(eq(renders.id, r.id));
    return visualQc;
  }),
  remove: memberProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [r] = await db.select().from(renders).where(eq(renders.id, input.id));
    if (!r) return { ok: true };
    await db.delete(renders).where(eq(renders.id, input.id));
    const [s] = await db.select().from(scripts).where(eq(scripts.id, r.scriptId));
    if (s && !["scheduled", "published"].includes(s.status)) {
      await db
        .update(scripts)
        .set({ status: s.track === "economic" || s.track === "derivative" ? "script_ready" : "premium_uploaded" })
        .where(eq(scripts.id, s.id));
    }
    return { ok: true };
  }),
});
