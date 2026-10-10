import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { characters, insights, PLATFORMS, postMetrics, posts, renders, scripts } from "../../drizzle/schema";
import { router } from "../_core/trpc";
import { getSettings, requireDb } from "../db";
import { memberProcedure } from "../procedures";
import { performanceInsights } from "../services/ai";

function slotDate(day: string, slot: string, tzOffsetMinutes: number) {
  // day "YYYY-MM-DD", slot "HH:MM" in the team's local time; tzOffsetMinutes = Date.getTimezoneOffset() of the browser.
  const [h, m] = slot.split(":").map(Number);
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCHours(h, m, 0, 0);
  return new Date(d.getTime() + tzOffsetMinutes * 60000);
}

export const postsRouter = router({
  list: memberProcedure
    .input(z.object({ from: z.date(), to: z.date() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      return db
        .select({ post: posts, render: renders, script: scripts })
        .from(posts)
        .innerJoin(renders, eq(renders.id, posts.renderId))
        .innerJoin(scripts, eq(scripts.id, posts.scriptId))
        .where(and(gte(posts.scheduledAt, input.from), lt(posts.scheduledAt, input.to)))
        .orderBy(asc(posts.scheduledAt));
    }),
  unscheduled: memberProcedure.query(async () => {
    const db = await requireDb();
    const scheduled = await db.select({ renderId: posts.renderId }).from(posts);
    const used = new Set(scheduled.map(p => p.renderId));
    const rows = await db
      .select({ render: renders, script: scripts })
      .from(renders)
      .innerJoin(scripts, eq(scripts.id, renders.scriptId))
      .where(eq(renders.qcStatus, "approved"))
      .orderBy(desc(renders.id))
      .limit(500);
    return rows.filter(r => !used.has(r.render.id));
  }),
  schedule: memberProcedure
    .input(
      z.object({
        renderId: z.number(),
        platforms: z.array(z.enum(PLATFORMS)).min(1),
        scheduledAt: z.date(),
        caption: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [r] = await db
        .select({ render: renders, script: scripts })
        .from(renders)
        .innerJoin(scripts, eq(scripts.id, renders.scriptId))
        .where(eq(renders.id, input.renderId));
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "الرندر غير موجود" });
      if (r.render.qcStatus !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن جدولة ريل غير معتمد" });
      const s = await getSettings();
      const [c] = await db.select().from(characters).where(eq(characters.id, r.render.characterId));
      const caption = input.caption ?? [r.script.caption, r.script.hashtags].filter(Boolean).join("\n\n");
      for (const p of input.platforms) {
        await db.insert(posts).values({
          renderId: r.render.id,
          scriptId: r.script.id,
          characterId: r.render.characterId,
          platform: p,
          accountHandle: s.accounts?.[c?.slug ?? ""]?.[p] ?? null,
          caption,
          scheduledAt: input.scheduledAt,
          createdBy: ctx.user.id,
        });
      }
      await db.update(scripts).set({ status: "scheduled" }).where(eq(scripts.id, r.script.id));
      return { ok: true };
    }),
  /** Fill posting slots for the next N days with approved, unscheduled renders (per character, round-robin). */
  autoSchedule: memberProcedure
    .input(z.object({ startDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.number().int().min(1).max(14), tzOffsetMinutes: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const s = await getSettings();
      const scheduled = await db.select({ renderId: posts.renderId, characterId: posts.characterId, scheduledAt: posts.scheduledAt }).from(posts);
      const used = new Set(scheduled.map(p => p.renderId));
      const taken = new Set(scheduled.map(p => `${p.characterId}|${p.scheduledAt.toISOString()}`));
      const approved = await db
        .select({ render: renders, script: scripts })
        .from(renders)
        .innerJoin(scripts, eq(scripts.id, renders.scriptId))
        .where(eq(renders.qcStatus, "approved"))
        .orderBy(asc(renders.id));
      const queue = new Map<number, typeof approved>();
      for (const row of approved) {
        if (used.has(row.render.id)) continue;
        const list = queue.get(row.render.characterId) ?? [];
        list.push(row);
        queue.set(row.render.characterId, list);
      }
      const chars = await db.select().from(characters);
      const slugById = new Map(chars.map(c => [c.id, c.slug]));
      const slots = [...s.postingSlots].sort();
      let created = 0;
      const base = new Date(`${input.startDay}T00:00:00.000Z`);
      for (let d = 0; d < input.days; d++) {
        const day = new Date(base.getTime() + d * 86400000).toISOString().slice(0, 10);
        for (const slot of slots) {
          const when = slotDate(day, slot, input.tzOffsetMinutes);
          if (when.getTime() < Date.now()) continue;
          for (const [characterId, list] of Array.from(queue.entries())) {
            if (!list.length) continue;
            const key = `${characterId}|${when.toISOString()}`;
            if (taken.has(key)) continue;
            const row = list.shift()!;
            const caption = [row.script.caption, row.script.hashtags].filter(Boolean).join("\n\n");
            for (const p of s.platforms as (typeof PLATFORMS)[number][]) {
              await db.insert(posts).values({
                renderId: row.render.id,
                scriptId: row.script.id,
                characterId,
                platform: p,
                accountHandle: s.accounts?.[slugById.get(characterId) ?? ""]?.[p] ?? null,
                caption,
                scheduledAt: when,
                createdBy: ctx.user.id,
              });
            }
            taken.add(key);
            await db.update(scripts).set({ status: "scheduled" }).where(eq(scripts.id, row.script.id));
            created++;
          }
        }
      }
      return { scheduledReels: created };
    }),
  update: memberProcedure
    .input(
      z.object({
        id: z.number(),
        data: z
          .object({
            status: z.enum(["queued", "published", "failed", "skipped"]),
            postUrl: z.string().max(1024).nullable(),
            caption: z.string().nullable(),
            scheduledAt: z.date(),
            accountHandle: z.string().max(160).nullable(),
          })
          .partial(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const patch: Record<string, unknown> = { ...input.data };
      if (input.data.status === "published") patch.publishedAt = new Date();
      await db.update(posts).set(patch).where(eq(posts.id, input.id));
      const [p] = await db.select().from(posts).where(eq(posts.id, input.id));
      if (p && input.data.status === "published") {
        await db.update(scripts).set({ status: "published" }).where(eq(scripts.id, p.scriptId));
      }
      return p;
    }),
  remove: memberProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [p] = await db.select().from(posts).where(eq(posts.id, input.id));
    await db.delete(posts).where(eq(posts.id, input.id));
    if (p) {
      const rest = await db.select({ id: posts.id }).from(posts).where(eq(posts.scriptId, p.scriptId));
      if (!rest.length) await db.update(scripts).set({ status: "approved" }).where(eq(scripts.id, p.scriptId));
    }
    return { ok: true };
  }),
});

const metricInput = z.object({
  views: z.number().int().min(0),
  avgWatchMs: z.number().int().min(0),
  completionPermille: z.number().int().min(0).max(1000),
  likes: z.number().int().min(0),
  comments: z.number().int().min(0),
  shares: z.number().int().min(0),
  saves: z.number().int().min(0),
  follows: z.number().int().min(0),
});

async function loadPerformance(days: number) {
  const db = await requireDb();
  const since = new Date(Date.now() - days * 86400000);
  const rows = await db
    .select({ post: posts, script: scripts, character: characters })
    .from(posts)
    .innerJoin(scripts, eq(scripts.id, posts.scriptId))
    .innerJoin(characters, eq(characters.id, posts.characterId))
    .where(and(eq(posts.status, "published"), gte(posts.scheduledAt, since)));
  const ids = rows.map(r => r.post.id);
  const metrics = ids.length
    ? await db.select().from(postMetrics).where(inArray(postMetrics.postId, ids)).orderBy(desc(postMetrics.capturedAt))
    : [];
  const latest = new Map<number, (typeof metrics)[number]>();
  for (const m of metrics) if (!latest.has(m.postId)) latest.set(m.postId, m);
  return rows.map(r => ({ ...r, metric: latest.get(r.post.id) ?? null }));
}

type Agg = { key: string; label: string; posts: number; views: number; completion: number; avgWatchMs: number; saves: number; shares: number; follows: number; likes: number };

function aggregate(rows: Awaited<ReturnType<typeof loadPerformance>>, keyFn: (r: (typeof rows)[number]) => [string, string]) {
  const map = new Map<string, Agg & { _c: number }>();
  for (const r of rows) {
    if (!r.metric) continue;
    const [key, label] = keyFn(r);
    const a = map.get(key) ?? { key, label, posts: 0, views: 0, completion: 0, avgWatchMs: 0, saves: 0, shares: 0, follows: 0, likes: 0, _c: 0 };
    a.posts++;
    a.views += r.metric.views;
    a.completion += r.metric.completionPermille;
    a.avgWatchMs += r.metric.avgWatchMs;
    a.saves += r.metric.saves;
    a.shares += r.metric.shares;
    a.follows += r.metric.follows;
    a.likes += r.metric.likes;
    a._c++;
    map.set(key, a);
  }
  return Array.from(map.values())
    .map(({ _c, ...a }) => ({ ...a, completion: _c ? Math.round(a.completion / _c) : 0, avgWatchMs: _c ? Math.round(a.avgWatchMs / _c) : 0 }))
    .sort((a, b) => b.views / Math.max(1, b.posts) - a.views / Math.max(1, a.posts));
}

export const analyticsRouter = router({
  publishedPosts: memberProcedure.input(z.object({ days: z.number().int().min(1).max(365).default(30) })).query(async ({ input }) => {
    const rows = await loadPerformance(input.days);
    return rows.sort((a, b) => b.post.scheduledAt.getTime() - a.post.scheduledAt.getTime());
  }),
  saveMetrics: memberProcedure.input(z.object({ postId: z.number(), metrics: metricInput })).mutation(async ({ input }) => {
    const db = await requireDb();
    await db.insert(postMetrics).values({ postId: input.postId, ...input.metrics });
    return { ok: true };
  }),
  importRows: memberProcedure
    .input(z.object({ rows: z.array(metricInput.extend({ postId: z.number().optional(), postUrl: z.string().optional() })).max(2000) }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const all = await db.select({ id: posts.id, postUrl: posts.postUrl }).from(posts);
      const byUrl = new Map(all.filter(p => p.postUrl).map(p => [p.postUrl!.trim(), p.id]));
      const valid = new Set(all.map(p => p.id));
      let imported = 0;
      const unmatched: string[] = [];
      for (const row of input.rows) {
        const { postId, postUrl, ...m } = row;
        const id = postId && valid.has(postId) ? postId : postUrl ? byUrl.get(postUrl.trim()) : undefined;
        if (!id) {
          unmatched.push(String(postId ?? postUrl ?? "?"));
          continue;
        }
        await db.insert(postMetrics).values({ postId: id, ...m });
        imported++;
      }
      return { imported, unmatched: unmatched.slice(0, 50) };
    }),
  summary: memberProcedure.input(z.object({ days: z.number().int().min(1).max(365).default(30) })).query(async ({ input }) => {
    const rows = await loadPerformance(input.days);
    const withMetrics = rows.filter(r => r.metric);
    const totals = withMetrics.reduce(
      (t, r) => ({
        views: t.views + r.metric!.views,
        saves: t.saves + r.metric!.saves,
        shares: t.shares + r.metric!.shares,
        follows: t.follows + r.metric!.follows,
        completion: t.completion + r.metric!.completionPermille,
        avgWatchMs: t.avgWatchMs + r.metric!.avgWatchMs,
      }),
      { views: 0, saves: 0, shares: 0, follows: 0, completion: 0, avgWatchMs: 0 },
    );
    const n = withMetrics.length || 1;
    const top = [...withMetrics].sort((a, b) => b.metric!.views - a.metric!.views);
    const shape = (r: (typeof withMetrics)[number]) => ({
      postId: r.post.id,
      platform: r.post.platform,
      character: r.character.name,
      hook: r.script.hook,
      templateKey: r.script.templateKey,
      hookType: r.script.hookType,
      track: r.script.track,
      views: r.metric!.views,
      completion: r.metric!.completionPermille,
      saves: r.metric!.saves,
      shares: r.metric!.shares,
    });
    return {
      publishedPosts: rows.length,
      measuredPosts: withMetrics.length,
      totals: { ...totals, completion: Math.round(totals.completion / n), avgWatchMs: Math.round(totals.avgWatchMs / n) },
      byCharacter: aggregate(rows, r => [String(r.character.id), r.character.name]),
      byTemplate: aggregate(rows, r => [r.script.templateKey, r.script.templateKey]),
      byHookType: aggregate(rows, r => [r.script.hookType ?? "-", r.script.hookType ?? "-"]),
      byTrack: aggregate(rows, r => [r.script.track, r.script.track]),
      byPlatform: aggregate(rows, r => [r.post.platform, r.post.platform]),
      topPosts: top.slice(0, 10).map(shape),
      bottomPosts: top.slice(-5).reverse().map(shape),
    };
  }),
  generateInsights: memberProcedure.input(z.object({ days: z.number().int().min(1).max(365).default(14) })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const rows = await loadPerformance(input.days);
    const measured = rows.filter(r => r.metric);
    if (measured.length < 3) throw new TRPCError({ code: "BAD_REQUEST", message: "نحتاج أرقام 3 منشورات على الأقل لتوليد تحليل مفيد" });
    const pack = {
      periodDays: input.days,
      byCharacter: aggregate(rows, r => [String(r.character.id), r.character.name]),
      byTemplate: aggregate(rows, r => [r.script.templateKey, r.script.templateKey]),
      byHookType: aggregate(rows, r => [r.script.hookType ?? "-", r.script.hookType ?? "-"]),
      byTrack: aggregate(rows, r => [r.script.track, r.script.track]),
      posts: measured.slice(0, 120).map(r => ({
        character: r.character.name,
        hook: r.script.hook,
        template: r.script.templateKey,
        hookType: r.script.hookType,
        track: r.script.track,
        platform: r.post.platform,
        views: r.metric!.views,
        completionPct: r.metric!.completionPermille / 10,
        avgWatchSec: r.metric!.avgWatchMs / 1000,
        saves: r.metric!.saves,
        shares: r.metric!.shares,
        follows: r.metric!.follows,
      })),
    };
    const s = await getSettings();
    const md = await performanceInsights({ dataJson: JSON.stringify(pack), model: s.scriptModel, userId: ctx.user.id });
    await db.insert(insights).values({ content: md, periodDays: input.days, createdBy: ctx.user.id });
    return { markdown: md };
  }),
  insights: memberProcedure.query(async () => {
    const db = await requireDb();
    return db.select().from(insights).orderBy(desc(insights.id)).limit(10);
  }),
  postCountByDay: memberProcedure.query(async () => {
    const db = await requireDb();
    return db
      .select({ day: sql<string>`DATE(${posts.scheduledAt})`, status: posts.status, n: sql<number>`count(*)` })
      .from(posts)
      .where(gte(posts.scheduledAt, new Date(Date.now() - 30 * 86400000)))
      .groupBy(sql`DATE(${posts.scheduledAt})`, posts.status);
  }),
});
