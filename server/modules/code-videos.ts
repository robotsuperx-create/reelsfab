import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { codeVideos } from "../../drizzle/schema";
import { codeVideoInputSchema } from "../../shared/code-video";
import { requireDb } from "../db";
import { memberProcedure } from "../procedures";
import { router } from "../_core/trpc";
import { enqueueCodeVideo, kickCodeVideoQueue, listCodeVideos } from "../services/code-videos";

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

  retry: memberProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const db = await requireDb();
    await db.update(codeVideos).set({ status: "queued", progress: 0, error: null, updatedAt: new Date() }).where(eq(codeVideos.id, input.id));
    void kickCodeVideoQueue();
    return { ok: true };
  }),

  /** Removes the entry; the MP4 stays in the asset library (it may already be used in a montage). */
  remove: memberProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [row] = await db.select({ status: codeVideos.status }).from(codeVideos).where(eq(codeVideos.id, input.id));
    if (row?.status === "running") throw new TRPCError({ code: "BAD_REQUEST", message: "انتظر حتى ينتهي التحويل" });
    await db.delete(codeVideos).where(eq(codeVideos.id, input.id));
    return { ok: true };
  }),
});
