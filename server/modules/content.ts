import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { batches, characters, premiumClips, scripts, SCRIPT_STATUSES } from "../../drizzle/schema";
import { checkCompliance, countWords, similarity, spokenText, TEMPLATE_KEYS } from "../../shared/domain";
import { router } from "../_core/trpc";
import { getSettings, requireDb } from "../db";
import { memberProcedure } from "../procedures";
import { rewriteHooks } from "../services/ai";
import { buildDailyPlan, startBatch } from "../services/batch";

const colorsSchema = z.object({ primary: z.string(), accent: z.string(), text: z.string() });

export const charactersRouter = router({
  list: memberProcedure.query(async () => {
    const db = await requireDb();
    return db.select().from(characters).orderBy(characters.sortOrder, characters.id);
  }),
  get: memberProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = await requireDb();
    const [c] = await db.select().from(characters).where(eq(characters.id, input.id));
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "الشخصية غير موجودة" });
    return c;
  }),
  update: memberProcedure
    .input(
      z.object({
        id: z.number(),
        data: z
          .object({
            name: z.string().min(1).max(120),
            nameAr: z.string().max(120).nullable(),
            age: z.string().max(120).nullable(),
            origin: z.string().max(160).nullable(),
            niche: z.string().max(240).nullable(),
            appearancePrompt: z.string().nullable(),
            wardrobe: z.string().nullable(),
            voiceDescription: z.string().nullable(),
            style: z.string().max(240).nullable(),
            catchphrase: z.string().max(240).nullable(),
            contentTemplates: z.array(z.string()),
            product: z.string().nullable(),
            rules: z.string().nullable(),
            loraKeyword: z.string().max(80).nullable(),
            ttsVoice: z.string().max(40),
            ttsSpeed: z.number().int().min(60).max(150),
            externalVoiceId: z.string().max(160).nullable(),
            colors: colorsSchema,
            captionFont: z.string().max(60),
            referenceImages: z.array(z.string()),
            needsDesignFile: z.boolean(),
            dailyQuota: z.number().int().min(0).max(50),
            isActive: z.boolean(),
          })
          .partial(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.update(characters).set(input.data).where(eq(characters.id, input.id));
      const [c] = await db.select().from(characters).where(eq(characters.id, input.id));
      return c;
    }),
});

const scriptPatch = z
  .object({
    topic: z.string().max(255).nullable(),
    templateKey: z.enum(TEMPLATE_KEYS),
    hookType: z.string().max(40).nullable(),
    hook: z.string().min(1),
    body: z.string().min(1),
    payoff: z.string().nullable(),
    cta: z.string().nullable(),
    onScreenText: z.string().max(255).nullable(),
    caption: z.string().nullable(),
    hashtags: z.string().max(500).nullable(),
    higgsfieldPrompt: z.string().nullable(),
    notes: z.string().nullable(),
    status: z.enum(SCRIPT_STATUSES),
    track: z.enum(["economic", "premium", "derivative"]),
  })
  .partial();

async function recomputeChecks(id: number) {
  const db = await requireDb();
  const [s] = await db.select().from(scripts).where(eq(scripts.id, id));
  if (!s) return;
  const text = spokenText(s);
  const others = await db
    .select({ id: scripts.id, hook: scripts.hook, body: scripts.body, payoff: scripts.payoff, cta: scripts.cta })
    .from(scripts)
    .where(and(eq(scripts.characterId, s.characterId), sql`${scripts.id} <> ${id}`))
    .orderBy(desc(scripts.id))
    .limit(300);
  let best = 0;
  let bestId: number | null = null;
  for (const o of others) {
    if (o.id === s.parentScriptId) continue;
    const sim = similarity(text, spokenText(o));
    if (sim > best) {
      best = sim;
      bestId = o.id;
    }
  }
  await db
    .update(scripts)
    .set({
      wordCount: countWords(text),
      complianceFlags: checkCompliance([text, s.onScreenText, s.caption].filter(Boolean).join(" ")),
      similarity: Math.round(best * 100),
      duplicateOf: best >= 0.55 ? bestId : null,
    })
    .where(eq(scripts.id, id));
}

export const scriptsRouter = router({
  list: memberProcedure
    .input(
      z
        .object({
          characterId: z.number().optional(),
          status: z.array(z.enum(SCRIPT_STATUSES)).optional(),
          track: z.enum(["economic", "premium", "derivative"]).optional(),
          batchId: z.number().optional(),
          search: z.string().optional(),
          limit: z.number().min(1).max(1000).default(300),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const conds = [];
      if (input?.characterId) conds.push(eq(scripts.characterId, input.characterId));
      if (input?.status?.length) conds.push(inArray(scripts.status, input.status));
      if (input?.track) conds.push(eq(scripts.track, input.track));
      if (input?.batchId) conds.push(eq(scripts.batchId, input.batchId));
      if (input?.search) {
        const q = `%${input.search}%`;
        conds.push(or(like(scripts.hook, q), like(scripts.body, q), like(scripts.topic, q))!);
      }
      return db
        .select()
        .from(scripts)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(scripts.id))
        .limit(input?.limit ?? 300);
    }),
  get: memberProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = await requireDb();
    const [s] = await db.select().from(scripts).where(eq(scripts.id, input.id));
    if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "النص غير موجود" });
    return s;
  }),
  create: memberProcedure
    .input(scriptPatch.extend({ characterId: z.number(), hook: z.string().min(1), body: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const track = input.track ?? "economic";
      const [r] = await db.insert(scripts).values({
        ...input,
        track,
        status: input.status ?? (track === "premium" ? "prompt_ready" : "script_ready"),
        templateKey: input.templateKey ?? "direct_tip",
        createdBy: ctx.user.id,
      });
      const id = Number((r as { insertId: number }).insertId);
      if (track === "premium") {
        const s = await getSettings();
        const [pc] = await db
          .insert(premiumClips)
          .values({ scriptId: id, characterId: input.characterId, model: s.higgsfieldDefaultModel });
        await db
          .update(scripts)
          .set({ premiumClipId: Number((pc as { insertId: number }).insertId) })
          .where(eq(scripts.id, id));
      }
      await recomputeChecks(id);
      return { id };
    }),
  update: memberProcedure.input(z.object({ id: z.number(), data: scriptPatch })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [before] = await db.select().from(scripts).where(eq(scripts.id, input.id));
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "النص غير موجود" });
    await db.update(scripts).set(input.data).where(eq(scripts.id, input.id));
    if (input.data.track === "premium" && !before.premiumClipId) {
      const s = await getSettings();
      const [pc] = await db
        .insert(premiumClips)
        .values({ scriptId: before.id, characterId: before.characterId, model: s.higgsfieldDefaultModel });
      await db
        .update(scripts)
        .set({ premiumClipId: Number((pc as { insertId: number }).insertId), status: "prompt_ready" })
        .where(eq(scripts.id, before.id));
    }
    await recomputeChecks(input.id);
    const [s] = await db.select().from(scripts).where(eq(scripts.id, input.id));
    return s;
  }),
  bulkStatus: memberProcedure
    .input(z.object({ ids: z.array(z.number()).min(1), status: z.enum(SCRIPT_STATUSES) }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.update(scripts).set({ status: input.status }).where(inArray(scripts.id, input.ids));
      return { updated: input.ids.length };
    }),
  remove: memberProcedure.input(z.object({ ids: z.array(z.number()).min(1) })).mutation(async ({ input }) => {
    const db = await requireDb();
    await db.delete(scripts).where(inArray(scripts.id, input.ids));
    return { removed: input.ids.length };
  }),
  rewriteHooks: memberProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const [s] = await db.select().from(scripts).where(eq(scripts.id, input.id));
    if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "النص غير موجود" });
    const [c] = await db.select().from(characters).where(eq(characters.id, s.characterId));
    const settings = await getSettings();
    return rewriteHooks({
      character: c,
      hook: s.hook,
      body: s.body,
      model: settings.scriptModel,
      userId: ctx.user.id,
      scriptId: s.id,
    });
  }),
  stats: memberProcedure.query(async () => {
    const db = await requireDb();
    return db
      .select({ status: scripts.status, track: scripts.track, n: sql<number>`count(*)` })
      .from(scripts)
      .groupBy(scripts.status, scripts.track);
  }),
});

const planItem = z.object({ characterId: z.number(), count: z.number().int().min(0).max(40), premium: z.number().int().min(0).max(40) });

export const batchesRouter = router({
  previewPlan: memberProcedure
    .input(z.object({ target: z.number().int().min(1).max(300).optional(), premiumSharePercent: z.number().min(0).max(100).optional() }).optional())
    .query(async ({ input }) => buildDailyPlan(input ?? undefined)),
  start: memberProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        items: z.array(planItem).min(1),
        templateKeys: z.array(z.enum(TEMPLATE_KEYS)).optional(),
        topicHints: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const items = input.items
        .filter(i => i.count > 0)
        .map(i => ({ ...i, premium: Math.min(i.premium, i.count) }));
      if (!items.length) throw new TRPCError({ code: "BAD_REQUEST", message: "حدد عدد نصوص لشخصية واحدة على الأقل" });
      const { batchId } = await startBatch({ ...input, items, source: "manual", userId: ctx.user.id });
      return { batchId };
    }),
  list: memberProcedure.query(async () => {
    const db = await requireDb();
    return db.select().from(batches).orderBy(desc(batches.id)).limit(50);
  }),
  get: memberProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = await requireDb();
    const [b] = await db.select().from(batches).where(eq(batches.id, input.id));
    if (!b) throw new TRPCError({ code: "NOT_FOUND", message: "الدفعة غير موجودة" });
    return b;
  }),
});
