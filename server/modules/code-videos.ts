import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { codeVideos } from "../../drizzle/schema";
import { codeAgentInputSchema, codeVideoInputSchema } from "../../shared/code-video";
import { requireDb } from "../db";
import { memberProcedure } from "../procedures";
import { router } from "../_core/trpc";
import { enqueueCodeVideo, kickCodeVideoQueue, listCodeVideos } from "../services/code-videos";
import { agentEngines, retryAgentVideo, startAgentVideo } from "../services/code-agent";

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
    if (!/<(html|body|script|style|div|svg|canvas)\b/i.test(input.html)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذا لا يبدو ملف HTML — ألصق الملف كاملًا كما أعطاك الذكاء الاصطناعي" });
    }
    return enqueueCodeVideo(input, ctx.user?.id);
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

  /** Render a written draft (or a pasted edit of it). */
  queueDraft: memberProcedure.input(z.object({ id: z.number().int(), html: z.string().max(2_000_000).optional() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [row] = await db.select({ status: codeVideos.status, plan: codeVideos.plan }).from(codeVideos).where(eq(codeVideos.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "غير موجود" });
    if (row.status === "writing" || row.status === "running") throw new TRPCError({ code: "BAD_REQUEST", message: "انتظر حتى ينتهي العمل الجاري" });
    const single = !(row.plan?.segments?.length && row.plan.segments.length > 1);
    await db.update(codeVideos).set({ ...(single && input.html ? { html: input.html } : {}), status: "queued", progress: 0, error: null, updatedAt: new Date() }).where(eq(codeVideos.id, input.id));
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
