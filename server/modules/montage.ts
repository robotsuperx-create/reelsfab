import { TRPCError } from "@trpc/server";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { characters, montages, premiumClips, renderJobs, renders, scripts } from "../../drizzle/schema";
import { spokenText } from "../../shared/domain";
import { montageProblems, montageSpecSchema } from "../../shared/montage";
import { requireDb } from "../db";
import { memberProcedure } from "../procedures";
import { router } from "../_core/trpc";
import { buildDefaultSpec, listMontages, loadMontageContext, montageMedia, renderMontageProject, savePreview } from "../services/montages";
import { importStockVideo, searchStockVideos, type StockVideo } from "../services/stock";
import { storageKeyFromUrl } from "../storage";
import { enqueueMontage, runJobNow } from "../worker/jobs";

const stockItem = z.object({
  id: z.string().min(1).max(40),
  source: z.literal("pexels"),
  thumb: z.string().url().max(1024),
  file: z.string().url().max(1024),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  durationSec: z.number().min(0).max(600),
  credit: z.string().max(200),
  sourceUrl: z.string().url().max(1024),
});

const STOCK_HOSTS = ["pexels.com", "pexels.test"];
function assertStockHost(url: string) {
  const host = new URL(url).hostname;
  if (!STOCK_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "رابط المقطع ليس من Pexels" });
  }
}

/** Every source must be a file in our storage (the renderer downloads by key, never by arbitrary URL). */
function assertSpecSources(spec: z.infer<typeof montageSpecSchema>) {
  for (const s of spec.segments) {
    if (!storageKeyFromUrl(s.src)) throw new TRPCError({ code: "BAD_REQUEST", message: `المقطع "${s.label ?? s.id}" ليس من مكتبة الأصول` });
  }
  if (spec.music.src && !storageKeyFromUrl(spec.music.src)) throw new TRPCError({ code: "BAD_REQUEST", message: "ملف الموسيقى ليس من مكتبة الأصول" });
  const problems = montageProblems(spec);
  if (problems.length) throw new TRPCError({ code: "BAD_REQUEST", message: problems[0] });
}

let previewBusy = false;

export const montageRouter = router({
  list: memberProcedure.query(() => listMontages()),

  /** Scripts the editor can start from (newest first), with whether a montage already exists. */
  candidates: memberProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({
        id: scripts.id,
        characterId: scripts.characterId,
        hook: scripts.hook,
        track: scripts.track,
        status: scripts.status,
        premiumClipId: scripts.premiumClipId,
        createdAt: scripts.createdAt,
      })
      .from(scripts)
      .where(inArray(scripts.status, ["script_ready", "premium_uploaded", "approved", "needs_review", "rejected", "scheduled"]))
      .orderBy(desc(scripts.id))
      .limit(120);
    const existing = await db.select({ scriptId: montages.scriptId }).from(montages);
    const has = new Set(existing.map(e => e.scriptId));
    const chars = await db.select({ id: characters.id, referenceImages: characters.referenceImages }).from(characters);
    const withImages = new Set(chars.filter(c => (c.referenceImages ?? []).some(u => storageKeyFromUrl(u))).map(c => c.id));
    const clips = await db.select({ id: premiumClips.id, status: premiumClips.status, videoUrl: premiumClips.videoUrl }).from(premiumClips);
    const receivedClips = new Set(clips.filter(c => c.status === "received" && storageKeyFromUrl(c.videoUrl)).map(c => c.id));
    return rows.map(r => ({
      ...r,
      hasMontage: has.has(r.id),
      hasClip: !!r.premiumClipId && receivedClips.has(r.premiumClipId),
      // A project needs footage to start from: the received clip or the character's stored portraits.
      canStart: (!!r.premiumClipId && receivedClips.has(r.premiumClipId)) || withImages.has(r.characterId),
    }));
  }),

  get: memberProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const { montage, script, character } = await loadMontageContext(input.id).catch(() => {
      throw new TRPCError({ code: "NOT_FOUND", message: "المونتاج غير موجود" });
    });
    const db = await requireDb();
    const [render] = montage.renderId
      ? await db.select({ id: renders.id, qcStatus: renders.qcStatus, thumbnailUrl: renders.thumbnailUrl, videoUrl: renders.videoUrl, durationMs: renders.durationMs }).from(renders).where(eq(renders.id, montage.renderId))
      : [];
    const [job] = await db
      .select({ id: renderJobs.id, status: renderJobs.status, attempts: renderJobs.attempts, error: renderJobs.error })
      .from(renderJobs)
      .where(eq(renderJobs.montageId, montage.id));
    return {
      ...montage,
      job: job ?? null,
      spec: montageSpecSchema.parse(montage.spec),
      script: { id: script.id, hook: script.hook, cta: script.cta, onScreenText: script.onScreenText, track: script.track, text: spokenText(script), caption: script.caption },
      character: { id: character.id, name: character.name, colors: character.colors, ttsVoice: character.ttsVoice },
      render: render ?? null,
    };
  }),

  create: memberProcedure
    .input(z.object({ scriptId: z.number().int(), title: z.string().max(255).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [script] = await db.select().from(scripts).where(eq(scripts.id, input.scriptId));
      if (!script) throw new TRPCError({ code: "NOT_FOUND", message: "النص غير موجود" });
      const [character] = await db.select().from(characters).where(eq(characters.id, script.characterId));
      if (!character) throw new TRPCError({ code: "NOT_FOUND", message: "الشخصية غير موجودة" });
      const spec = await buildDefaultSpec(script, character).catch(e => {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      });
      const [row] = await db
        .insert(montages)
        .values({
          scriptId: script.id,
          characterId: script.characterId,
          title: (input.title?.trim() || `مونتاج: ${script.hook}`).slice(0, 255),
          spec,
          createdBy: ctx.user.id,
        })
        .returning({ id: montages.id });
      return { id: row.id };
    }),

  update: memberProcedure
    .input(z.object({ id: z.number().int(), title: z.string().min(1).max(255).optional(), spec: montageSpecSchema }))
    .mutation(async ({ input }) => {
      assertSpecSources(input.spec);
      const db = await requireDb();
      const [m] = await db.select({ id: montages.id, status: montages.status }).from(montages).where(eq(montages.id, input.id));
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "المونتاج غير موجود" });
      const [job] = await db.select({ status: renderJobs.status }).from(renderJobs).where(eq(renderJobs.montageId, input.id));
      if (m.status === "rendering" && job?.status === "running") throw new TRPCError({ code: "BAD_REQUEST", message: "الرندر جارٍ — انتظر انتهاءه قبل التعديل" });
      await db
        .update(montages)
        .set({ spec: input.spec, ...(input.title ? { title: input.title } : {}), status: "draft", previewUrl: null, previewKey: null, error: null, updatedAt: new Date() })
        .where(eq(montages.id, input.id));
      return { ok: true, problems: montageProblems(input.spec) };
    }),

  remove: memberProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const db = await requireDb();
    await db.delete(montages).where(eq(montages.id, input.id));
    return { ok: true };
  }),

  /** Quick 540×960 render straight from the saved spec; one at a time (ffmpeg uses every core). */
  preview: memberProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    if (previewBusy) throw new TRPCError({ code: "CONFLICT", message: "معاينة أخرى قيد التنفيذ — انتظر ثوانٍ" });
    previewBusy = true;
    try {
      const { out } = await renderMontageProject(input.id, { preview: true }).catch(e => {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      });
      const put = await savePreview(input.id, out);
      return { url: put.url, durationMs: out.durationMs };
    } finally {
      previewBusy = false;
    }
  }),

  render: memberProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const { montage } = await loadMontageContext(input.id).catch(() => {
      throw new TRPCError({ code: "NOT_FOUND", message: "المونتاج غير موجود" });
    });
    const spec = montageSpecSchema.parse(montage.spec);
    assertSpecSources(spec);
    const r = await enqueueMontage(input.id);
    // A render asked for in the editor should not wait behind the daily batch: run its job straight away.
    void runJobNow(r.jobId).catch(e => console.error("[montage render]", e));
    return r;
  }),

  media: memberProcedure.query(() => montageMedia()),

  stockSearch: memberProcedure
    .input(z.object({ query: z.string().min(1).max(120), page: z.number().int().min(1).max(20).default(1) }))
    .query(async ({ input }) => {
      try {
        return await searchStockVideos(input.query, input.page);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }
    }),

  stockImport: memberProcedure
    .input(z.object({ item: stockItem, query: z.string().max(120), characterId: z.number().int().nullable().optional() }))
    .mutation(async ({ input, ctx }) => {
      assertStockHost(input.item.file);
      assertStockHost(input.item.sourceUrl);
      const r = await importStockVideo(input.item as StockVideo, { characterId: input.characterId ?? null, query: input.query, userId: ctx.user.id }).catch(e => {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      });
      return { id: r.asset.id, url: r.asset.url, title: r.asset.title, durationMs: r.asset.durationMs, width: r.asset.width, height: r.asset.height, credit: r.asset.meta?.credit ?? null, reused: r.reused };
    }),

  /** Live counts for the rail / dashboard. */
  stats: memberProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db.select({ status: montages.status, n: sql<number>`count(*)::int` }).from(montages).groupBy(montages.status);
    return Object.fromEntries(rows.map(r => [r.status, r.n])) as Record<string, number>;
  }),
});
