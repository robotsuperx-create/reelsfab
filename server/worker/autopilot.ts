import { eq, sql } from "drizzle-orm";
import { settings } from "../../drizzle/schema";
import { getSettings, requireDb } from "../db";
import { syncPublishedMetrics } from "../services/analytics-sync";
import { notifyOwner } from "../services/notify";
import { runDailyAutomation } from "../services/batch";
import { syncHiggsfieldClips } from "../services/higgsfield-jobs";
import { processReceivedClips } from "../services/premium-pipeline";
import { publishDueInstagramPosts, publishDueSocialPosts } from "../services/publishing";
import { autoFillSchedule } from "../services/scheduler";
import { refreshExpiringInstagramTokens } from "../services/social-accounts";
import { drainQueue, enqueueReadyScripts } from "./jobs";

const LEASE_KEY = "autopilot_lease";
const LEASE_SECONDS = 300;
const TICK_MS = 60_000;
const INSTANCE = `${process.env.HOSTNAME ?? "local"}:${process.pid}`;

/** One instance at a time: a lease row in `settings`, refreshed every tick (pooler-safe, unlike advisory locks). */
async function acquireLease() {
  const db = await requireDb();
  const value = { owner: INSTANCE, until: Date.now() + LEASE_SECONDS * 1000 };
  const res = await db.execute(sql`
    insert into settings (key, value) values (${LEASE_KEY}, ${JSON.stringify(value)}::jsonb)
    on conflict (key) do update set value = excluded.value, "updatedAt" = now()
    where (settings.value->>'owner') = ${INSTANCE} or (settings.value->>'until')::bigint < ${Date.now()}
    returning key`);
  return (res as unknown as unknown[]).length > 0;
}

async function step<T>(name: string, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[autopilot] ${name} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

let busy = false;
let lastScheduleFill = 0;
let lastMetrics = 0;
let lastTokenRefresh = 0;

/** One pass of the studio. Every step renews the lease first, so a slow render can never let a second instance in. */
export async function autopilotTick(now = new Date()) {
  if (busy) return;
  busy = true;
  try {
    const guarded = async <T>(name: string, fn: () => Promise<T>) => {
      if (!(await acquireLease())) throw new LeaseLost();
      return step(name, fn);
    };
    const s = await getSettings();
    // 1. Daily script batch at the configured UTC hour (idempotent per day).
    if (s.automationEnabled && now.getUTCHours() >= s.automationHourUtc) {
      await guarded("daily-automation", () => runDailyAutomation("schedule"));
    }
    // 2. Turn ready scripts into reels, one render per guarded step.
    await guarded("enqueue", () => enqueueReadyScripts());
    for (let i = 0; i < 2; i++) {
      const r = await guarded("render", () => drainQueue(1));
      if (!r || r.done + r.failed === 0) break;
    }
    // 3. Keep the calendar full (only platforms with a connected account), at most every 30 minutes.
    if (s.automationEnabled && Date.now() - lastScheduleFill > 30 * 60_000) {
      lastScheduleFill = Date.now();
      await guarded("schedule", () =>
        autoFillSchedule({ startDay: now.toISOString().slice(0, 10), days: 3, userId: null, onlyConnected: true }),
      );
    }
    // 4. Publish what is due and alert on failures.
    const ig = await guarded("publish-ig", () => publishDueInstagramPosts(3));
    const social = await guarded("publish-social", () => publishDueSocialPosts(3));
    const errors = [...(ig?.errors ?? []), ...(social?.errors ?? [])];
    if (errors.length) {
      await step("notify-failed-posts", () =>
        notifyOwner({ title: `فشل نشر ${errors.length} منشور`, content: errors.slice(0, 8).join("\n") }),
      );
    }
    // 5. Premium clips and metrics.
    await guarded("higgsfield", () => syncHiggsfieldClips());
    // Received premium clips: transcribe + derivative scripts (rendered by the queue on the next pass).
    const pc = await guarded("premium-derivatives", () => processReceivedClips());
    if (pc?.errors.length) await step("notify-premium", () => notifyOwner({ title: "تعذّر تجهيز لقطة Premium", content: pc.errors.join("\n") }));
    if (Date.now() - lastTokenRefresh > 12 * 3600_000) {
      lastTokenRefresh = Date.now();
      const r = await guarded("instagram-token-refresh", () => refreshExpiringInstagramTokens());
      if (r?.errors.length) await step("notify-token", () => notifyOwner({ title: "تعذّر تجديد توكن Instagram", content: r.errors.join("\n") }));
    }
    if (Date.now() - lastMetrics > 30 * 60_000) {
      lastMetrics = Date.now();
      await guarded("metrics", () => syncPublishedMetrics());
    }
  } catch (e) {
    if (!(e instanceof LeaseLost)) throw e;
  } finally {
    busy = false;
  }
}

class LeaseLost extends Error {}

export function startAutopilot() {
  if (process.env.AUTOPILOT_ENABLED !== "true") {
    console.log("[autopilot] disabled (set AUTOPILOT_ENABLED=true to run the studio worker)");
    return;
  }
  console.log(`[autopilot] started as ${INSTANCE}`);
  const loop = () => void autopilotTick().catch(e => console.error("[autopilot] tick", e));
  setTimeout(loop, 15_000);
  setInterval(loop, TICK_MS).unref();
}

export async function autopilotStatus() {
  const db = await requireDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, LEASE_KEY));
  return row?.value ?? null;
}
