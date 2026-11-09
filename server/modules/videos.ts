import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { assets, channels, episodes, renderJobs } from "../../drizzle/schema";
import { channelUpdateSchema, episodeProblems, episodeScriptSchema, sceneSchema } from "../../shared/episodes";
import { requireDb } from "../db";
import { memberProcedure, teamAdminProcedure } from "../procedures";
import { router } from "../_core/trpc";
import { channelStats, finishEpisodeRender, generateEpisodeScript, listEpisodes, loadEpisode, planVisuals, prepareEpisode } from "../services/episodes";
import { type StockPhoto, type StockVideo, importStockPhoto, importStockVideo, isStockHost, searchStockPhotos, searchStockVideos } from "../services/stock";
import { storageKeyFromUrl } from "../storage";
import { generateImageAsset, imageProviderReady, resolveImageModel } from "../services/ai-images";
import { IMAGE_TIERS, IMAGE_TIER_DEFAULTS, imagePromptFor } from "../../shared/images";
import { enqueueEpisode, runJobNow } from "../worker/jobs";

const bad = (e: unknown) => new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
function assertStockHost(url: string) {
  if (!isStockHost(url)) throw new TRPCError({ code: "BAD_REQUEST", message: "الرابط ليس من Pexels أو Pixabay" });
}

const stockVideoItem = z.object({
  id: z.string().min(1).max(40), source: z.enum(["pexels", "pixabay"]), thumb: z.string().url().max(1024), file: z.string().url().max(1024),
  width: z.number().int().min(1), height: z.number().int().min(1), durationSec: z.number().min(0).max(600), credit: z.string().max(200), sourceUrl: z.string().url().max(1024),
});
const stockPhotoItem = z.object({
  id: z.string().min(1).max(40), source: z.enum(["pexels", "pixabay"]), thumb: z.string().url().max(1024), file: z.string().url().max(1024),
  width: z.number().int().min(1), height: z.number().int().min(1), credit: z.string().max(200), sourceUrl: z.string().url().max(1024),
});

/** One long-running preparation at a time per process (TTS quota + ffmpeg use every core). */
const busy = new Set<string>();
async function exclusive<T>(key: string, fn: () => Promise<T>) {
  if (busy.has(key)) throw new TRPCError({ code: "CONFLICT", message: "عملية أخرى قيد التنفيذ على هذه الحلقة — انتظر انتهاءها" });
  busy.add(key);
  try {
    return await fn();
  } finally {
    busy.delete(key);
  }
}

export const videosRouter = router({
  channels: memberProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db.select().from(channels).orderBy(asc(channels.id));
    const stats = await channelStats();
    return rows.map(c => ({ ...c, stats: stats[c.id] ?? {} }));
  }),

  channel: memberProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const db = await requireDb();
    const [c] = await db.select().from(channels).where(eq(channels.id, input.id));
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "القناة غير موجودة" });
    const music = c.musicAssetId ? (await db.select({ id: assets.id, title: assets.title }).from(assets).where(eq(assets.id, c.musicAssetId)))[0] ?? null : null;
    return { ...c, music, episodes: await listEpisodes(c.id) };
  }),

  updateChannel: teamAdminProcedure.input(z.object({ id: z.number().int(), patch: channelUpdateSchema.partial() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [c] = await db.select({ id: channels.id }).from(channels).where(eq(channels.id, input.id));
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "القناة غير موجودة" });
    await db.update(channels).set({ ...input.patch, updatedAt: new Date() }).where(eq(channels.id, input.id));
    return { ok: true };
  }),

  episodes: memberProcedure.input(z.object({ channelId: z.number().int().optional() }).optional()).query(({ input }) => listEpisodes(input?.channelId)),

  episode: memberProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const { episode, channel } = await loadEpisode(input.id).catch(() => {
      throw new TRPCError({ code: "NOT_FOUND", message: "الحلقة غير موجودة" });
    });
    const db = await requireDb();
    const [job] = await db.select({ status: renderJobs.status, error: renderJobs.error }).from(renderJobs).where(eq(renderJobs.episodeId, input.id));
    const script = episode.script ? episodeScriptSchema.parse(episode.script) : null;
    return {
      ...episode,
      script,
      problems: episodeProblems(script, channel.language),
      job: job ?? null,
      channel: { id: channel.id, name: channel.name, language: channel.language, visualStyle: channel.visualStyle, madeForKids: channel.madeForKids, colors: channel.colors, voice: channel.voice, ttsProvider: channel.ttsProvider },
    };
  }),

  createEpisode: memberProcedure
    .input(z.object({ channelId: z.number().int(), topic: z.string().min(3).max(240) }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [c] = await db.select({ id: channels.id }).from(channels).where(eq(channels.id, input.channelId));
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "القناة غير موجودة" });
      const [row] = await db.insert(episodes).values({ channelId: input.channelId, topic: input.topic.trim(), title: input.topic.trim().slice(0, 200), createdBy: ctx.user.id }).returning({ id: episodes.id });
      return { id: row.id };
    }),

  /** Step 1 — the scene-by-scene script (free LLM tier or local model). */
  generateScript: memberProcedure.input(z.object({ id: z.number().int() })).mutation(({ input, ctx }) =>
    exclusive(`ep:${input.id}`, async () => {
      const db = await requireDb();
      const { episode, channel } = await loadEpisode(input.id).catch(e => { throw bad(e); });
      if (episode.status === "rendering") throw new TRPCError({ code: "BAD_REQUEST", message: "الرندر جارٍ" });
      const script = await generateEpisodeScript(channel, episode.topic, ctx.user.id).catch(e => {
        console.warn(`[episodes] script for #${input.id} failed:`, e instanceof Error ? e.message : e);
        throw bad(e);
      });
      await db.update(episodes).set({ script, title: script.title, status: "planned", error: null, videoUrl: null, thumbnailUrl: null, durationMs: null, updatedAt: new Date() }).where(eq(episodes.id, input.id));
      return { scenes: script.scenes.length, title: script.title };
    }),
  ),

  /** Step 2 — narration per scene (cached) + free stock for every scene without a visual. */
  prepare: memberProcedure.input(z.object({ id: z.number().int() })).mutation(({ input, ctx }) =>
    exclusive(`ep:${input.id}`, async () => {
      return prepareEpisode(input.id, ctx.user.id).catch(e => { throw bad(e); });
    }),
  ),

  /** Re-pick visuals: all scenes (replace the automatic picks) or only the empty ones. */
  planVisuals: memberProcedure
    .input(z.object({ id: z.number().int(), onlyMissing: z.boolean().default(true), source: z.enum(["auto", "stock", "ai"]).default("auto") }))
    .mutation(({ input, ctx }) =>
      exclusive(`ep:${input.id}`, async () => planVisuals(input.id, { onlyMissing: input.onlyMissing, source: input.source, userId: ctx.user.id }).catch(e => { throw bad(e); })),
  ),

  /** Editor edits: narration text, title, keywords, chapter, visual (library asset) per scene; reorder; delete. */
  updateScript: memberProcedure
    .input(z.object({ id: z.number().int(), script: episodeScriptSchema }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const { episode, channel } = await loadEpisode(input.id).catch(e => { throw bad(e); });
      if (episode.status === "rendering") throw new TRPCError({ code: "BAD_REQUEST", message: "الرندر جارٍ — انتظر انتهاءه" });
      for (const s of input.script.scenes) {
        if (s.visual && !storageKeyFromUrl(s.visual.src)) throw new TRPCError({ code: "BAD_REQUEST", message: "لقطة من خارج المكتبة" });
      }
      // Narration edits invalidate that scene's cached duration (re-synthesized on the next prepare/render).
      const old = episode.script ? episodeScriptSchema.parse(episode.script) : null;
      const script = {
        ...input.script,
        scenes: input.script.scenes.map(s => {
          const prev = old?.scenes.find(x => x.id === s.id);
          return prev && prev.narration.trim() !== s.narration.trim() ? { ...s, durationSec: undefined } : s;
        }),
      };
      const problems = episodeProblems(script, channel.language);
      await db
        .update(episodes)
        .set({ script, title: script.title, status: problems.length ? "needs_review" : episode.status === "rendered" ? "script_ready" : episode.status === "planned" ? "planned" : "script_ready", updatedAt: new Date() })
        .where(eq(episodes.id, input.id));
      return { ok: true, problems };
    }),

  setSceneVisual: memberProcedure
    .input(z.object({ id: z.number().int(), sceneId: z.string(), visual: sceneSchema.shape.visual.unwrap().nullable() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const { episode } = await loadEpisode(input.id).catch(e => { throw bad(e); });
      if (!episode.script) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد سكربت" });
      if (input.visual && !storageKeyFromUrl(input.visual.src)) throw new TRPCError({ code: "BAD_REQUEST", message: "لقطة من خارج المكتبة" });
      const script = episodeScriptSchema.parse(episode.script);
      const scene = script.scenes.find(s => s.id === input.sceneId);
      if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "المشهد غير موجود" });
      scene.visual = input.visual ? { ...input.visual, auto: false } : undefined;
      await db.update(episodes).set({ script, updatedAt: new Date() }).where(eq(episodes.id, input.id));
      return { ok: true };
    }),

  /** Step 3 — final render through the queue, started right away. */
  render: memberProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const { episode, channel } = await loadEpisode(input.id).catch(e => { throw bad(e); });
    const script = episode.script ? episodeScriptSchema.parse(episode.script) : null;
    const problems = episodeProblems(script, channel.language);
    if (problems.length) throw new TRPCError({ code: "BAD_REQUEST", message: problems[0] });
    const r = await enqueueEpisode(input.id);
    void runJobNow(r.jobId).catch(e => console.error("[episode render]", e));
    return r;
  }),

  /** Quick 960×540 preview rendered synchronously (minutes for long episodes — kept for short checks). */
  preview: memberProcedure.input(z.object({ id: z.number().int() })).mutation(({ input }) =>
    exclusive(`ep:${input.id}`, async () => finishEpisodeRender(input.id, { preview: true }).catch(e => { throw bad(e); })),
  ),

  markPublished: memberProcedure.input(z.object({ id: z.number().int(), url: z.string().url().max(1024).nullable() })).mutation(async ({ input }) => {
    const db = await requireDb();
    await db.update(episodes).set({ status: input.url ? "published" : "rendered", publishedUrl: input.url, publishedAt: input.url ? new Date() : null, updatedAt: new Date() }).where(eq(episodes.id, input.id));
    return { ok: true };
  }),

  removeEpisode: memberProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const db = await requireDb();
    await db.delete(renderJobs).where(eq(renderJobs.episodeId, input.id));
    await db.delete(episodes).where(eq(episodes.id, input.id));
    return { ok: true };
  }),

  /** Stock search for the scene picker (landscape). */
  stockSearch: memberProcedure
    .input(z.object({ query: z.string().min(1).max(120), kind: z.enum(["video", "photo"]).default("video"), page: z.number().int().min(1).max(20).default(1) }))
    .query(async ({ input }) => {
      try {
        return input.kind === "video"
          ? { kind: "video" as const, ...(await searchStockVideos(input.query, input.page, "landscape")) }
          : { kind: "photo" as const, ...(await searchStockPhotos(input.query, input.page, "landscape")) };
      } catch (e) {
        throw bad(e);
      }
    }),

  stockImport: memberProcedure
    .input(z.object({ query: z.string().max(120), video: stockVideoItem.optional(), photo: stockPhotoItem.optional() }))
    .mutation(async ({ input, ctx }) => {
      const item = input.video ?? input.photo;
      if (!item) throw new TRPCError({ code: "BAD_REQUEST", message: "لا عنصر" });
      assertStockHost(item.file);
      assertStockHost(item.sourceUrl);
      const r = input.video
        ? await importStockVideo(input.video as StockVideo, { characterId: null, query: input.query, userId: ctx.user.id }).catch(e => { throw bad(e); })
        : await importStockPhoto(input.photo as StockPhoto, { query: input.query, userId: ctx.user.id }).catch(e => { throw bad(e); });
      return { id: r.asset.id, url: r.asset.url, kind: input.video ? ("video" as const) : ("image" as const), credit: r.asset.meta?.credit ?? null, durationMs: r.asset.durationMs };
    }),

  /** Whether AI images can be generated (fal key in the vault) and the tier prices, for the picker. */
  imageStatus: memberProcedure.query(async () => {
    const ready = await imageProviderReady();
    const tiers = await Promise.all(IMAGE_TIERS.map(async tier => ({ tier, label: IMAGE_TIER_DEFAULTS[tier].label, ...(await resolveImageModel(tier).then(r => ({ model: r.model, usd: r.usd })).catch(() => ({ model: IMAGE_TIER_DEFAULTS[tier].model, usd: IMAGE_TIER_DEFAULTS[tier].usd }))) })));
    return { ready, tiers };
  }),

  /** One AI picture for a scene (picker): stored in the library, cost charged to the episode. */
  generateSceneImage: memberProcedure
    .input(z.object({ id: z.number().int(), sceneId: z.string(), prompt: z.string().min(3).max(1500), tier: z.enum(IMAGE_TIERS).default("standard"), styled: z.boolean().default(true), fresh: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      const { episode, channel } = await loadEpisode(input.id).catch(e => { throw bad(e); });
      if (!episode.script) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد سكربت" });
      const prompt = input.styled ? imagePromptFor(input.prompt, channel.visualStyle) : input.prompt;
      const r = await generateImageAsset({ prompt, tier: input.tier, aspect: "16:9", title: `${channel.name}: ${input.prompt.slice(0, 80)}`, userId: ctx.user.id, ref: { type: "episode", id: input.id }, fresh: input.fresh }).catch(e => { throw bad(e); });
      if (r.usd > 0) {
        const db = await requireDb();
        await db.update(episodes).set({ costMilliCents: sql`${episodes.costMilliCents} + ${Math.round(r.usd * 100000)}` }).where(eq(episodes.id, input.id));
      }
      return { id: r.asset.id, url: r.asset.url, kind: "image" as const, credit: r.asset.meta?.credit ?? null, usd: r.usd, reused: r.reused, model: r.model };
    }),

  /** Library media usable as scene visuals (landscape-friendly kinds) and music. */
  media: memberProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db.select().from(assets).orderBy(asc(assets.id)).limit(600);
    return rows
      .filter(a => ["broll", "background", "music", "premium_video", "render"].includes(a.kind))
      .map(a => ({ id: a.id, kind: a.kind, title: a.title, url: a.url, durationMs: a.durationMs, width: a.width, height: a.height, credit: a.meta?.credit ?? null }));
  }),
});
