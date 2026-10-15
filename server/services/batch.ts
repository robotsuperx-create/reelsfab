import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  automationRuns,
  batches,
  characters,
  costEntries,
  premiumClips,
  scripts,
  type Character,
  type InsertScript,
} from "../../drizzle/schema";
import { checkCompliance, countWords, similarity, spokenText, usdFromMilliCents } from "../../shared/domain";
import { notifyOwner } from "./notify";
import { ensureSeed, getSettings, requireDb } from "../db";
import { generateScriptsForCharacter } from "./ai";

export type BatchPlanItem = { characterId: number; count: number; premium: number };

/** Largest-remainder allocation of `total` across weights. */
export function allocate(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map(w => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}

/**
 * Budget guard: how many premium clips today's share of the remaining monthly budget can pay for.
 * Pure so it can be tested; the remaining budget is spread evenly over the remaining days of the month.
 */
export function premiumAllowance(o: { requested: number; budgetUsd: number; spentUsd: number; perClipUsd: number; now?: Date }) {
  if (o.perClipUsd <= 0) return o.requested;
  const now = o.now ?? new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysLeft = Math.max(1, daysInMonth - now.getUTCDate() + 1);
  const dailyUsd = Math.max(0, o.budgetUsd - o.spentUsd) / daysLeft;
  return Math.min(o.requested, Math.floor(dailyUsd / o.perClipUsd));
}

async function monthSpentUsd() {
  const db = await requireDb();
  const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [row] = await db
    .select({ mc: sql<number>`coalesce(sum(${costEntries.amountMilliCents}),0)` })
    .from(costEntries)
    .where(gte(costEntries.createdAt, start));
  return usdFromMilliCents(Number(row?.mc ?? 0));
}

export async function buildDailyPlan(opts?: { target?: number; premiumSharePercent?: number }) {
  const db = await requireDb();
  const s = await getSettings();
  const target = opts?.target ?? s.dailyTarget;
  const share = opts?.premiumSharePercent ?? s.premiumSharePercent;
  const roster = (await db.select().from(characters).where(eq(characters.isActive, true))).filter(
    c => c.dailyQuota > 0,
  );
  if (!roster.length) return { items: [] as BatchPlanItem[], target, premiumTotal: 0 };
  const counts = allocate(
    target,
    roster.map(c => c.dailyQuota),
  );
  const requestedPremium = Math.round((target * share) / 100);
  const perClipUsd = s.higgsfieldCreditsPerAttempt * s.higgsfieldAttemptsPerClip * s.higgsfieldUsdPerCredit;
  const premiumTotal = premiumAllowance({
    requested: requestedPremium,
    budgetUsd: s.monthlyBudgetUsd,
    spentUsd: await monthSpentUsd(),
    perClipUsd,
  });
  // Premium needs an on-camera character with an identity reference; Shelly-type entries waiting for a design file are skipped.
  const premiumWeights = roster.map((c, i) => (c.needsDesignFile ? 0 : counts[i]));
  const premium = allocate(premiumTotal, premiumWeights.some(w => w > 0) ? premiumWeights : counts);
  const items = roster
    .map((c, i) => ({ characterId: c.id, count: counts[i], premium: Math.min(premium[i], counts[i]) }))
    .filter(i => i.count > 0);
  return { items, target, premiumTotal: items.reduce((a, b) => a + b.premium, 0) };
}

async function recentHooks(characterId: number) {
  const db = await requireDb();
  const rows = await db
    .select({ hook: scripts.hook, body: scripts.body, id: scripts.id, payoff: scripts.payoff, cta: scripts.cta })
    .from(scripts)
    .where(eq(scripts.characterId, characterId))
    .orderBy(desc(scripts.id))
    .limit(200);
  return rows;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const results: R[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const my = idx++;
      results[my] = await fn(items[my]);
    }
  });
  await Promise.all(workers);
  return results;
}

type BatchOptions = {
  name: string;
  items: BatchPlanItem[];
  templateKeys?: string[];
  topicHints?: string;
  source: "manual" | "automation";
  userId?: number;
};

/** Creates the batch row and processes it in the background (LLM calls can take minutes). */
export async function startBatch(opts: BatchOptions) {
  const db = await requireDb();
  await ensureSeed();
  const [ins] = await db.insert(batches).values({
    name: opts.name,
    source: opts.source,
    plan: { items: opts.items, templateKeys: opts.templateKeys, topicHints: opts.topicHints },
    status: "running",
    createdBy: opts.userId,
  }).returning({ id: batches.id });
  const batchId = ins.id;
  const done = processBatch(batchId, opts).catch(async e => {
    console.error("[batch] crashed", e);
    await db
      .update(batches)
      .set({ status: "failed", error: e instanceof Error ? e.message : String(e) })
      .where(eq(batches.id, batchId));
    return { batchId, total: 0, premiumTotal: 0, errors: [String(e)] };
  });
  return { batchId, done };
}

async function processBatch(batchId: number, opts: BatchOptions) {
  const db = await requireDb();
  const s = await getSettings();
  const roster = await db
    .select()
    .from(characters)
    .where(inArray(characters.id, opts.items.map(i => i.characterId).concat([-1])));
  const byId = new Map<number, Character>(roster.map(c => [c.id, c]));
  let total = 0;
  let premiumTotal = 0;
  const errors: string[] = [];

  await mapLimit(opts.items, 3, async item => {
    const character = byId.get(item.characterId);
    if (!character || item.count <= 0) return;
    try {
      const history = await recentHooks(character.id);
      // Generate in chunks of 8 to keep each LLM response compact and reliable.
      let remaining = item.count;
      let premiumLeft = item.premium;
      while (remaining > 0) {
        const chunk = Math.min(8, remaining);
        const chunkPremium = Math.min(premiumLeft, chunk);
        const generated = await generateScriptsForCharacter({
          character,
          count: chunk,
          premiumCount: chunkPremium,
          templateKeys: opts.templateKeys,
          topicHints: opts.topicHints,
          avoidHooks: history.map(h => h.hook),
          model: s.scriptModel,
          userId: opts.userId,
          batchId,
        });
        for (let k = 0; k < generated.length; k++) {
          const g = generated[k];
          const isPremium = k < chunkPremium;
          const text = spokenText(g);
          let best = 0;
          let bestId: number | null = null;
          for (const h of history) {
            const sim = similarity(text, spokenText(h));
            if (sim > best) {
              best = sim;
              bestId = h.id;
            }
          }
          const values: InsertScript = {
            characterId: character.id,
            batchId,
            status: isPremium ? "prompt_ready" : "script_ready",
            track: isPremium ? "premium" : "economic",
            templateKey: g.templateKey,
            hookType: g.hookType,
            topic: g.topic.slice(0, 255),
            hook: g.hook,
            body: g.body,
            payoff: g.payoff,
            cta: g.cta,
            onScreenText: g.onScreenText.slice(0, 255),
            caption: g.caption,
            hashtags: g.hashtags.slice(0, 500),
            higgsfieldPrompt: isPremium ? g.higgsfieldPrompt : null,
            wordCount: countWords(text),
            complianceFlags: checkCompliance([text, g.onScreenText, g.caption].join(" ")),
            duplicateOf: best >= 0.55 ? bestId : null,
            similarity: Math.round(best * 100),
            createdBy: opts.userId,
          };
          const [r] = await db.insert(scripts).values(values).returning({ id: scripts.id });
          const scriptId = r.id;
          history.unshift({ id: scriptId, hook: g.hook, body: g.body, payoff: g.payoff, cta: g.cta });
          if (isPremium) {
            const [pc] = await db.insert(premiumClips).values({
              scriptId,
              characterId: character.id,
              status: "requested",
              model: s.higgsfieldDefaultModel,
            }).returning({ id: premiumClips.id });
            await db
              .update(scripts)
              .set({ premiumClipId: pc.id })
              .where(eq(scripts.id, scriptId));
            premiumTotal++;
          }
          total++;
        }
        remaining -= chunk;
        premiumLeft -= chunkPremium;
        await db
          .update(batches)
          .set({ totalScripts: total, premiumScripts: premiumTotal })
          .where(eq(batches.id, batchId));
        if (!generated.length) break;
      }
    } catch (e) {
      console.error("[batch] character failed", character.name, e);
      errors.push(`${character.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  await db
    .update(batches)
    .set({
      status: total === 0 && errors.length ? "failed" : "done",
      totalScripts: total,
      premiumScripts: premiumTotal,
      error: errors.length ? errors.join("\n").slice(0, 4000) : null,
    })
    .where(eq(batches.id, batchId));
  return { batchId, total, premiumTotal, errors };
}

function todayKeyUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** Idempotent per UTC day for scheduled runs. */
export async function runDailyAutomation(trigger: "manual" | "schedule", userId?: number) {
  const db = await requireDb();
  await ensureSeed();
  if (trigger === "schedule") {
    const startOfDay = new Date(`${todayKeyUtc()}T00:00:00.000Z`);
    const already = await db
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(and(eq(automationRuns.trigger, "schedule"), gte(automationRuns.startedAt, startOfDay)))
      .limit(1);
    if (already.length) return { skipped: true as const, reason: "already ran today" };
  }
  const [run] = await db.insert(automationRuns).values({ trigger, status: "running" }).returning({ id: automationRuns.id });
  const runId = run.id;
  const plan = await buildDailyPlan();
  const started = await startBatch({
    name: `دفعة ${todayKeyUtc()}${trigger === "schedule" ? " (تلقائية)" : ""}`,
    items: plan.items,
    source: "automation",
    userId,
  });
  await db.update(automationRuns).set({ batchId: started.batchId }).where(eq(automationRuns.id, runId));
  void finishAutomation(runId, started.done);
  return { skipped: false as const, runId, batchId: started.batchId, planned: plan.items.reduce((a, b) => a + b.count, 0) };
}

async function finishAutomation(
  runId: number,
  done: Promise<{ batchId: number; total: number; premiumTotal: number; errors: string[] }>,
) {
  const db = await requireDb();
  try {
    const result = await done;
    await db
      .update(automationRuns)
      .set({
        status: "done",
        batchId: result.batchId,
        summary: { total: result.total, premium: result.premiumTotal, errors: result.errors },
        finishedAt: new Date(),
      })
      .where(eq(automationRuns.id, runId));
    try {
      await notifyOwner({
        title: `دفعة اليوم جاهزة: ${result.total} نص`,
        content: `تم توليد ${result.total} نصًا (${result.premiumTotal} Premium لـ Higgsfield و${result.total - result.premiumTotal} اقتصادي).\nالخطوة التالية: افتح "الرندر الجماعي" لإنتاج الريلات الاقتصادية، و"مركز Higgsfield" لنسخ البرومبتات.${result.errors.length ? `\nأخطاء: ${result.errors.join(" | ")}` : ""}`,
      });
    } catch (e) {
      console.warn("[automation] notify failed", e);
    }
  } catch (e) {
    await db
      .update(automationRuns)
      .set({ status: "failed", error: e instanceof Error ? e.message : String(e), finishedAt: new Date() })
      .where(eq(automationRuns.id, runId));
  }
}
