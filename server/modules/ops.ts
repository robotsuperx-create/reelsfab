import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  assets,
  automationRuns,
  batches,
  characters,
  costEntries,
  posts,
  premiumClips,
  renders,
  scripts,
  users,
} from "../../drizzle/schema";
import { milliCentsFromUsd, usdFromMilliCents } from "../../shared/domain";
import { createHeartbeatJob, listHeartbeatJobs, updateHeartbeatJob } from "../_core/heartbeat";
import { router } from "../_core/trpc";
import { protectedProcedure } from "../_core/trpc";
import { getSettings, requireDb, saveSettings } from "../db";
import { memberProcedure, teamAdminProcedure } from "../procedures";
import { runDailyAutomation } from "../services/batch";

export const teamRouter = router({
  list: teamAdminProcedure.query(async () => {
    const db = await requireDb();
    return db.select().from(users).orderBy(desc(users.lastSignedIn));
  }),
  setRole: teamAdminProcedure
    .input(z.object({ userId: z.number(), role: z.enum(["user", "member", "admin"]) }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      if (input.userId === ctx.user.id && input.role !== "admin") {
        const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.role, "admin"))) as { n: number }[];
        if (Number(n) <= 1) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إزالة آخر مدير" });
      }
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
      return { ok: true };
    }),
  access: protectedProcedure.query(({ ctx }) => ({ role: ctx.user.role, approved: ctx.user.role !== "user" })),
});

const ASSET_KINDS = ["character_image", "background", "music", "premium_video", "render", "thumbnail", "voice", "other"] as const;

export const assetsRouter = router({
  list: memberProcedure
    .input(z.object({ kinds: z.array(z.enum(ASSET_KINDS)).optional(), characterId: z.number().nullable().optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conds = [];
      if (input?.kinds?.length) conds.push(inArray(assets.kind, input.kinds));
      if (input?.characterId) conds.push(eq(assets.characterId, input.characterId));
      return db
        .select()
        .from(assets)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(assets.id))
        .limit(500);
    }),
  update: memberProcedure
    .input(z.object({ id: z.number(), title: z.string().max(255).optional(), characterId: z.number().nullable().optional(), kind: z.enum(ASSET_KINDS).optional() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const { id, ...rest } = input;
      await db.update(assets).set(rest).where(eq(assets.id, id));
      return { ok: true };
    }),
  remove: memberProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = await requireDb();
    await db.delete(assets).where(eq(assets.id, input.id));
    return { ok: true };
  }),
});

function monthRange(month: string) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export const costsRouter = router({
  summary: memberProcedure.input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) })).query(async ({ input }) => {
    const db = await requireDb();
    const { start, end } = monthRange(input.month);
    const byCat = await db
      .select({
        category: costEntries.category,
        mc: sql<number>`coalesce(sum(${costEntries.amountMilliCents}),0)`,
        credits: sql<number>`coalesce(sum(${costEntries.credits}),0)`,
        n: sql<number>`count(*)`,
      })
      .from(costEntries)
      .where(and(gte(costEntries.createdAt, start), lt(costEntries.createdAt, end)))
      .groupBy(costEntries.category);
    const [{ rendersN }] = (await db
      .select({ rendersN: sql<number>`count(*)` })
      .from(renders)
      .where(and(gte(renders.createdAt, start), lt(renders.createdAt, end)))) as { rendersN: number }[];
    const [{ approvedN }] = (await db
      .select({ approvedN: sql<number>`count(*)` })
      .from(renders)
      .where(and(gte(renders.createdAt, start), lt(renders.createdAt, end), eq(renders.qcStatus, "approved")))) as { approvedN: number }[];
    const byKind = await db
      .select({ kind: renders.kind, n: sql<number>`count(*)` })
      .from(renders)
      .where(and(gte(renders.createdAt, start), lt(renders.createdAt, end)))
      .groupBy(renders.kind);
    const s = await getSettings();
    const categories = byCat.map(c => ({ category: c.category, usd: usdFromMilliCents(Number(c.mc)), credits: Number(c.credits), entries: Number(c.n) }));
    const total = categories.reduce((a, c) => a + c.usd, 0);
    return {
      month: input.month,
      categories,
      totalUsd: total,
      budgetUsd: s.monthlyBudgetUsd,
      renders: Number(rendersN),
      approvedRenders: Number(approvedN),
      rendersByKind: byKind.map(k => ({ kind: k.kind, n: Number(k.n) })),
      costPerApprovedReel: Number(approvedN) ? total / Number(approvedN) : null,
    };
  }),
  list: memberProcedure.input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) })).query(async ({ input }) => {
    const db = await requireDb();
    const { start, end } = monthRange(input.month);
    const rows = await db
      .select()
      .from(costEntries)
      .where(and(gte(costEntries.createdAt, start), lt(costEntries.createdAt, end)))
      .orderBy(desc(costEntries.id))
      .limit(500);
    return rows.map(r => ({ ...r, usd: usdFromMilliCents(r.amountMilliCents) }));
  }),
  add: memberProcedure
    .input(
      z.object({
        category: z.enum(["llm", "higgsfield", "voice", "subscription", "storage", "other"]),
        usd: z.number().min(0).max(100000),
        credits: z.number().int().min(0).default(0),
        description: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      await db.insert(costEntries).values({
        category: input.category,
        amountMilliCents: milliCentsFromUsd(input.usd),
        credits: input.credits,
        description: input.description,
        createdBy: ctx.user.id,
      });
      return { ok: true };
    }),
  remove: memberProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = await requireDb();
    await db.delete(costEntries).where(eq(costEntries.id, input.id));
    return { ok: true };
  }),
});

const settingsPatch = z
  .object({
    dailyTarget: z.number().int().min(1).max(300),
    premiumSharePercent: z.number().int().min(0).max(100),
    derivativesPerPremium: z.number().int().min(0).max(8),
    monthlyBudgetUsd: z.number().min(0).max(100000),
    higgsfieldUsdPerCredit: z.number().min(0).max(10),
    higgsfieldCreditsPerAttempt: z.number().int().min(0).max(5000),
    higgsfieldAttemptsPerClip: z.number().min(1).max(20),
    higgsfieldPlanUsd: z.number().min(0).max(10000),
    higgsfieldDefaultModel: z.string().max(120),
    scriptModel: z.string().max(80),
    reviewModel: z.string().max(80),
    postingSlots: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(12),
    platforms: z.array(z.enum(["tiktok", "instagram", "youtube"])),
    accounts: z.record(z.string(), z.record(z.string(), z.string())),
    musicVolume: z.number().int().min(0).max(100),
  })
  .partial();

export const settingsRouter = router({
  get: memberProcedure.query(() => getSettings()),
  update: teamAdminProcedure.input(settingsPatch).mutation(({ input }) => saveSettings(input)),
});

const CRON_PATH = "/api/scheduled/daily-batch";

export const automationRouter = router({
  status: memberProcedure.query(async () => {
    const s = await getSettings();
    let job: { nextExecutionAt?: string | null; lastExecutedAt?: string | null; isEnable?: boolean } | null = null;
    let jobError: string | null = null;
    if (s.automationTaskUid) {
      try {
        const list = await listHeartbeatJobs("", { pageSize: 50 });
        job = list.jobs.find(j => j.taskUid === s.automationTaskUid) ?? null;
      } catch (e) {
        jobError = e instanceof Error ? e.message : String(e);
      }
    }
    return { enabled: s.automationEnabled, hourUtc: s.automationHourUtc, taskUid: s.automationTaskUid, job, jobError };
  }),
  runNow: memberProcedure.mutation(async ({ ctx }) => runDailyAutomation("manual", ctx.user.id)),
  runs: memberProcedure.query(async () => {
    const db = await requireDb();
    return db.select().from(automationRuns).orderBy(desc(automationRuns.id)).limit(30);
  }),
  enable: teamAdminProcedure.input(z.object({ hourUtc: z.number().int().min(0).max(23) })).mutation(async ({ input }) => {
    const s = await getSettings();
    const cron = `0 0 ${input.hourUtc} * * *`;
    let taskUid = s.automationTaskUid;
    let nextExecutionAt: string | null | undefined = null;
    if (taskUid) {
      try {
        const r = await updateHeartbeatJob(taskUid, { cron, enable: true, path: CRON_PATH }, "");
        nextExecutionAt = r.nextExecutionAt;
      } catch {
        taskUid = null;
      }
    }
    if (!taskUid) {
      const r = await createHeartbeatJob(
        { name: "reels-daily-batch", cron, path: CRON_PATH, method: "POST", payload: {}, description: "AI Reels Factory: توليد دفعة النصوص اليومية" },
        "",
      );
      taskUid = r.taskUid;
      nextExecutionAt = r.nextExecutionAt;
    }
    await saveSettings({ automationEnabled: true, automationHourUtc: input.hourUtc, automationTaskUid: taskUid });
    return { taskUid, nextExecutionAt };
  }),
  disable: teamAdminProcedure.mutation(async () => {
    const s = await getSettings();
    if (s.automationTaskUid) {
      try {
        await updateHeartbeatJob(s.automationTaskUid, { enable: false }, "");
      } catch (e) {
        console.warn("[automation] pause failed", e);
      }
    }
    await saveSettings({ automationEnabled: false });
    return { ok: true };
  }),
});

export const dashboardRouter = router({
  overview: memberProcedure.input(z.object({ tzOffsetMinutes: z.number().int() })).query(async ({ input }) => {
    const db = await requireDb();
    const s = await getSettings();
    const now = new Date();
    const local = new Date(now.getTime() - input.tzOffsetMinutes * 60000);
    const dayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + input.tzOffsetMinutes * 60000);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const monthStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1));

    const pipeline = await db
      .select({ status: scripts.status, track: scripts.track, n: sql<number>`count(*)` })
      .from(scripts)
      .groupBy(scripts.status, scripts.track);
    const rendersToday = await db
      .select({ qc: renders.qcStatus, kind: renders.kind, n: sql<number>`count(*)` })
      .from(renders)
      .where(and(gte(renders.createdAt, dayStart), lt(renders.createdAt, dayEnd)))
      .groupBy(renders.qcStatus, renders.kind);
    const postsToday = await db
      .select({ status: posts.status, n: sql<number>`count(distinct ${posts.renderId})` })
      .from(posts)
      .where(and(gte(posts.scheduledAt, dayStart), lt(posts.scheduledAt, dayEnd)))
      .groupBy(posts.status);
    const premium = await db
      .select({ status: premiumClips.status, n: sql<number>`count(*)` })
      .from(premiumClips)
      .groupBy(premiumClips.status);
    const [{ mc }] = (await db
      .select({ mc: sql<number>`coalesce(sum(${costEntries.amountMilliCents}),0)` })
      .from(costEntries)
      .where(gte(costEntries.createdAt, monthStart))) as { mc: number }[];
    const recentBatches = await db.select().from(batches).orderBy(desc(batches.id)).limit(4);
    const roster = await db.select({ id: characters.id, name: characters.name, isActive: characters.isActive, refs: characters.referenceImages, needsDesignFile: characters.needsDesignFile }).from(characters);
    const scriptsToday = await db
      .select({ n: sql<number>`count(*)` })
      .from(scripts)
      .where(and(gte(scripts.createdAt, dayStart), lt(scripts.createdAt, dayEnd)));
    return {
      dailyTarget: s.dailyTarget,
      premiumSharePercent: s.premiumSharePercent,
      monthlyBudgetUsd: s.monthlyBudgetUsd,
      monthCostUsd: usdFromMilliCents(Number(mc)),
      pipeline: pipeline.map(p => ({ ...p, n: Number(p.n) })),
      rendersToday: rendersToday.map(p => ({ ...p, n: Number(p.n) })),
      postsToday: postsToday.map(p => ({ ...p, n: Number(p.n) })),
      premium: premium.map(p => ({ ...p, n: Number(p.n) })),
      scriptsToday: Number(scriptsToday[0]?.n ?? 0),
      recentBatches,
      characters: roster.map(r => ({ id: r.id, name: r.name, isActive: r.isActive, hasImage: (r.refs ?? []).length > 0, needsDesignFile: r.needsDesignFile })),
      automationEnabled: s.automationEnabled,
    };
  }),
});
