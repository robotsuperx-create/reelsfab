import { eq, sql } from "drizzle-orm";
import { settings } from "../../drizzle/schema";
import { getSettings, requireDb } from "../db";
import { syncPublishedMetrics } from "../services/analytics-sync";
import { runDailyAutomation } from "../services/batch";
import { syncHiggsfieldClips } from "../services/higgsfield-jobs";
import { publishDueInstagramPosts, publishDueSocialPosts } from "../services/publishing";
import { autoFillSchedule } from "../services/scheduler";
import { drainQueue, enqueueReadyScripts } from "./jobs";

const LEASE_KEY = "autopilot_lease";
const LEASE_SECONDS = 120;
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

export async function autopilotTick(now = new Date()) {
  if (busy) return;
  busy = true;
  try {
    if (!(await acquireLease())) return;
    const s = await getSettings();
    // 1. Daily batch of scripts at the configured UTC hour (idempotent per day).
    if (s.automationEnabled && now.getUTCHours() >= s.automationHourUtc) {
      await step("daily-automation", () => runDailyAutomation("schedule"));
    }
    // 2. Turn ready scripts into reels, a few per tick so publishing never starves.
    await step("enqueue", () => enqueueReadyScripts());
    await step("render", () => drainQueue(3));
    // 3. Keep the calendar full, at most every 30 minutes.
    if (Date.now() - lastScheduleFill > 30 * 60_000) {
      lastScheduleFill = Date.now();
      await step("schedule", () =>
        autoFillSchedule({ startDay: now.toISOString().slice(0, 10), days: 3, tzOffsetMinutes: 0, userId: null }),
      );
    }
    // 4. Publish what is due, pull premium clips and metrics.
    await step("publish-ig", () => publishDueInstagramPosts(3));
    await step("publish-social", () => publishDueSocialPosts(3));
    await step("higgsfield", () => syncHiggsfieldClips());
    if (now.getUTCMinutes() % 30 === 0) await step("metrics", () => syncPublishedMetrics());
  } finally {
    busy = false;
  }
}

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
