import { TRPCError } from "@trpc/server";
import { desc, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import { assets, codeVideos } from "../../drizzle/schema";
import { codeAgentInputSchema, codeVideoInputSchema, codeVideoSize, fixInputSchema, inspectInputSchema, mediaPreviewSchema, overlayInputSchema, swapMediaSchema } from "../../shared/code-video";
import { compilePrepared, libraryForDirector, pastedPage, slotThumbs, stockStatus, storyboardOf, swapSlot } from "../services/code-media";
import { requireDb } from "../db";
import { memberProcedure } from "../procedures";
import { router } from "../_core/trpc";
import { enqueueCodeVideo, kickCodeVideoQueue, listCodeVideos } from "../services/code-videos";
import { agentEngines, retryAgentVideo, startAgentVideo, startOverlayVideo } from "../services/code-agent";
import { fixPasted, inspectPasted } from "../services/code-inspect";

type MediaFlags = { stock?: boolean; library?: boolean; styleId?: string | null; userId?: number | null };

/** A pasted storyboard JSON (or a compiled storyboard page) becomes its kit page with its pictures and maps; HTML passes through. */
async function pasted(text: string, size: string, durationSec: number, flags: MediaFlags = {}) {
  const { width, height } = codeVideoSize(size);
  return (await pageFromPastedOrThrow(text, width, height, durationSec, flags)).html;
}

async function pageFromPastedOrThrow(text: string, width: number, height: number, durationSec: number, flags: MediaFlags = {}, inline = false) {
  try {
    return await pastedPage(text, { width, height, durationSec, ...flags, inline });
  } catch (e) {
    throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
  }
}

/** What the room shows after a preview or a swap: the page to keep, the preview with inlined pictures, the picture strip. */
function previewResult(r: Awaited<ReturnType<typeof pageFromPastedOrThrow>>) {
  return {
    html: r.json && r.storyboard ? JSON.stringify(r.storyboard, null, 2) : r.html,
    preview: r.preview ?? r.html,
    slots: r.storyboard ? slotThumbs(r.storyboard) : [],
    notes: r.notes,
    issues: r.issues,
    credits: r.credits,
  };
}

export const codeVideosRouter = router({
  list: memberProcedure.query(() => listCodeVideos()),

  /** The full row, with the HTML, to reopen it in the editor. */
  get: memberProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const db = await requireDb();
    const [row] = await db.select().from(codeVideos).where(eq(codeVideos.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "الفيديو غير موجود" });
    return row;
  }),

  /** Queues the conversion and starts the queue at once. */
  convert: memberProcedure.input(codeVideoInputSchema).mutation(async ({ input, ctx }) => {
    const html = await pasted(input.html, input.size, input.durationSec, { stock: input.stock, library: input.library, userId: ctx.user?.id });
    if (!/<(html|body|script|style|div|svg|canvas)\b/i.test(html)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذا لا يبدو ملف HTML ولا قصة JSON — ألصقه كاملًا كما أعطاك الذكاء الاصطناعي" });
    }
    return enqueueCodeVideo({ ...input, html }, ctx.user?.id);
  }),

  /** Runs pasted code like the renderer and reports measured problems + a message to paste back into the AI. */
  inspect: memberProcedure.input(inspectInputSchema).mutation(async ({ input, ctx }) => {
    const html = await pasted(input.html, input.size, input.durationSec, { stock: input.stock, library: input.library, userId: ctx.user?.id });
    try {
      return await inspectPasted({ ...input, html });
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `تعذر تشغيل الكود: ${e instanceof Error ? e.message : String(e)}` });
    }
  }),

  /** Claude fixes pasted code from the measured problems; the result is inspected again. */
  fix: memberProcedure.input(fixInputSchema).mutation(async ({ input, ctx }) => {
    const engines = await agentEngines();
    if (input.engine === "api" && !engines.api) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد مفتاح Claude في مركز التكاملات — أو اختر Claude Code على هذا الجهاز" });
    if (input.engine === "claude-code" && !engines.claudeCode) throw new TRPCError({ code: "BAD_REQUEST", message: "لم أجد Claude Code على هذا الجهاز" });
    const html = await pasted(input.html, input.size, input.durationSec, { stock: input.stock, library: input.library, styleId: input.styleId, userId: ctx.user?.id });
    try {
      return await fixPasted({ ...input, html }, ctx.user?.id);
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
    }
  }),

  /** Which writers are available: the vault's Claude API key and/or Claude Code on this computer. */
  engines: memberProcedure.query(() => agentEngines()),

  /** The agent writes the animation (one file, or a plan of segments for long videos); optionally renders right after. */
  agentWrite: memberProcedure.input(codeAgentInputSchema).mutation(async ({ input, ctx }) => {
    const engines = await agentEngines();
    if (input.engine === "api" && !engines.api) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد مفتاح Claude في مركز التكاملات — أضفه أو اختر Claude Code على هذا الجهاز" });
    if (input.engine === "claude-code" && !engines.claudeCode) throw new TRPCError({ code: "BAD_REQUEST", message: "لم أجد Claude Code على هذا الجهاز — ثبّته (npm i -g @anthropic-ai/claude-code) وسجّل الدخول، أو اختر Claude API" });
    return startAgentVideo(input, ctx.user?.id);
  }),

  /** Preview of a storyboard with its pictures fetched and inlined, and its maps drawn. */
  preview: memberProcedure.input(mediaPreviewSchema).mutation(async ({ input, ctx }) => {
    const { width, height } = codeVideoSize(input.size);
    return previewResult(await pageFromPastedOrThrow(input.html, width, height, input.durationSec, { stock: input.stock, library: input.library, styleId: input.styleId, userId: ctx.user?.id }, true));
  }),

  /** Another picture for one slot (next result, new search words, a library asset) or none. */
  swapMedia: memberProcedure.input(swapMediaSchema).mutation(async ({ input, ctx }) => {
    const { width, height } = codeVideoSize(input.size);
    try {
      const { storyboard, json } = storyboardOf(input.html, input.durationSec, input.styleId);
      if (!storyboard) throw new Error("التبديل يعمل على القصص (JSON أو صفحة قصة)، لا على ملف HTML مكتوب يدويًا");
      const next = swapSlot(storyboard, input.slot, { query: input.query, asset: input.asset, remove: input.remove });
      const r = await compilePrepared(next, { width, height, durationSec: input.durationSec, stock: input.stock ?? true, library: input.library, userId: ctx.user?.id, inline: true, json });
      return previewResult(r);
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
    }
  }),

  /** Which free-photo providers have a key (Pexels / Pixabay), for the room's switch. */
  stockStatus: memberProcedure.query(() => stockStatus()),

  /** The owner's pictures and clips the director may use (newest first), for the picker. */
  libraryMedia: memberProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({ id: assets.id, title: assets.title, url: assets.url, kind: assets.kind, mimeType: assets.mimeType, tags: assets.tags, durationMs: assets.durationMs })
      .from(assets)
      .where(inArray(assets.kind, ["background", "character_image", "thumbnail", "other", "broll"]))
      .orderBy(desc(assets.id))
      .limit(120);
    const lib = await libraryForDirector(1).catch(() => null);
    return { items: rows.map(r => ({ ...r, video: /^video\//.test(r.mimeType ?? "") || r.kind === "broll", stock: (r.tags ?? []).includes("stock") })), hasLogo: Boolean(lib?.logoKey) };
  }),

  /** The owner's music tracks (asset library), to use instead of generated music. */
  musicTracks: memberProcedure.query(async () => {
    const db = await requireDb();
    return db.select({ id: assets.id, title: assets.title, durationMs: assets.durationMs }).from(assets).where(eq(assets.kind, "music")).orderBy(desc(assets.id)).limit(200);
  }),

  /** Videos in the library the agent can write on (newest first). */
  sourceVideos: memberProcedure.query(async () => {
    const db = await requireDb();
    return db
      .select({ id: assets.id, title: assets.title, url: assets.url, kind: assets.kind, durationMs: assets.durationMs, width: assets.width, height: assets.height, createdAt: assets.createdAt })
      .from(assets)
      .where(like(assets.mimeType, "video/%"))
      .orderBy(desc(assets.id))
      .limit(200);
  }),

  /** The agent watches the owner's video (speech, scenes, frames) and writes animation on top of it. */
  overlayStart: memberProcedure.input(overlayInputSchema).mutation(async ({ input, ctx }) => {
    const engines = await agentEngines();
    if (input.engine === "api" && !engines.api) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد مفتاح Claude في مركز التكاملات — أو اختر Claude Code على هذا الجهاز" });
    if (input.engine === "claude-code" && !engines.claudeCode) throw new TRPCError({ code: "BAD_REQUEST", message: "لم أجد Claude Code على هذا الجهاز" });
    try {
      return await startOverlayVideo(input, ctx.user?.id);
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
    }
  }),

  /** Render a written draft (or a pasted edit of it). */
  queueDraft: memberProcedure.input(z.object({ id: z.number().int(), html: z.string().max(2_000_000).optional() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [row] = await db.select({ status: codeVideos.status, plan: codeVideos.plan, width: codeVideos.width, height: codeVideos.height, durationSec: codeVideos.durationSec, analysis: codeVideos.analysis }).from(codeVideos).where(eq(codeVideos.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "غير موجود" });
    if (row.status === "writing" || row.status === "running") throw new TRPCError({ code: "BAD_REQUEST", message: "انتظر حتى ينتهي العمل الجاري" });
    const single = !(row.plan?.segments?.length && row.plan.segments.length > 1);
    const opts = (row.analysis ?? {}) as { stock?: boolean; library?: boolean };
    const html = single && input.html ? (await pageFromPastedOrThrow(input.html, row.width, row.height, row.durationSec, { stock: opts.stock, library: opts.library })).html : null;
    await db.update(codeVideos).set({ ...(html ? { html } : {}), status: "queued", progress: 0, error: null, updatedAt: new Date() }).where(eq(codeVideos.id, input.id));
    void kickCodeVideoQueue();
    return { ok: true };
  }),

  retry: memberProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [row] = await db.select({ html: codeVideos.html, plan: codeVideos.plan, idea: codeVideos.idea }).from(codeVideos).where(eq(codeVideos.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "غير موجود" });
    const segs = row.plan?.segments ?? [];
    const written = segs.length > 1 ? segs.every(s => s.html) : Boolean(row.html);
    if (!written && row.idea) {
      await retryAgentVideo(input.id, true);
      return { ok: true };
    }
    await db.update(codeVideos).set({ status: "queued", progress: 0, error: null, updatedAt: new Date() }).where(eq(codeVideos.id, input.id));
    void kickCodeVideoQueue();
    return { ok: true };
  }),

  /** Removes the entry; the MP4 stays in the asset library (it may already be used in a montage). */
  remove: memberProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [row] = await db.select({ status: codeVideos.status }).from(codeVideos).where(eq(codeVideos.id, input.id));
    if (row?.status === "running" || row?.status === "writing") throw new TRPCError({ code: "BAD_REQUEST", message: "انتظر حتى ينتهي التحويل" });
    await db.delete(codeVideos).where(eq(codeVideos.id, input.id));
    return { ok: true };
  }),
});
