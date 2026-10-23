import { asc, eq } from "drizzle-orm";
import { characters, PLATFORMS, posts, renders, scripts, socialAccounts } from "../../drizzle/schema";
import { tzOffsetMinutes } from "../../shared/domain";
import { getSettings, requireDb } from "../db";

/** day "YYYY-MM-DD", slot "HH:MM" in local time; tzOffsetMinutes = Date.getTimezoneOffset() semantics. */
export function slotDate(day: string, slot: string, tzOffsetMinutes: number) {
  const [h, m] = slot.split(":").map(Number);
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCHours(h, m, 0, 0);
  return new Date(d.getTime() + tzOffsetMinutes * 60000);
}

/** Fills posting slots with approved, unscheduled renders (round-robin per character). */
export async function autoFillSchedule(opts: {
  startDay: string;
  days: number;
  /** Fixed offset (browser semantics). When omitted, settings.postingTimezone is used per day (DST-aware). */
  tzOffsetMinutes?: number;
  userId: number | null;
  /** Only schedule platforms that have a connected account for the character (used by the autopilot). */
  onlyConnected?: boolean;
}) {
  const db = await requireDb();
  const s = await getSettings();
  const scheduled = await db
    .select({ renderId: posts.renderId, scriptId: posts.scriptId, characterId: posts.characterId, scheduledAt: posts.scheduledAt })
    .from(posts);
  const used = new Set(scheduled.map(p => p.renderId));
  // A script is posted once even when it has several renders (automatic reel + montage version).
  const usedScripts = new Set(scheduled.map(p => p.scriptId));
  const taken = new Set(scheduled.map(p => `${p.characterId}|${p.scheduledAt.toISOString()}`));
  const approved = await db
    .select({ render: renders, script: scripts })
    .from(renders)
    .innerJoin(scripts, eq(scripts.id, renders.scriptId))
    .where(eq(renders.qcStatus, "approved"))
    .orderBy(asc(renders.id));
  const queue = new Map<number, typeof approved>();
  for (const row of approved) {
    if (used.has(row.render.id) || usedScripts.has(row.script.id)) continue;
    usedScripts.add(row.script.id);
    const list = queue.get(row.render.characterId) ?? [];
    list.push(row);
    queue.set(row.render.characterId, list);
  }
  const chars = await db.select().from(characters);
  const slugById = new Map(chars.map(c => [c.id, c.slug]));
  const slots = [...s.postingSlots].sort();
  const connected = new Set(
    (await db.select().from(socialAccounts))
      .filter(a => a.status === "connected")
      .map(a => `${a.characterId}|${a.platform}`),
  );
  const platformsFor = (characterId: number) =>
    (s.platforms as (typeof PLATFORMS)[number][]).filter(p => !opts.onlyConnected || connected.has(`${characterId}|${p}`));
  let created = 0;
  const base = new Date(`${opts.startDay}T00:00:00.000Z`);
  for (let d = 0; d < opts.days; d++) {
    const day = new Date(base.getTime() + d * 86400000).toISOString().slice(0, 10);
    for (const slot of slots) {
      const offset = opts.tzOffsetMinutes ?? tzOffsetMinutes(s.postingTimezone || "UTC", new Date(`${day}T12:00:00Z`));
      const when = slotDate(day, slot, offset);
      if (when.getTime() < Date.now()) continue;
      for (const [characterId, list] of Array.from(queue.entries())) {
        if (!list.length) continue;
        const targets = platformsFor(characterId);
        if (!targets.length) continue;
        const key = `${characterId}|${when.toISOString()}`;
        if (taken.has(key)) continue;
        const row = list.shift()!;
        const caption = [row.script.caption, row.script.hashtags].filter(Boolean).join("\n\n");
        for (const p of targets) {
          await db.insert(posts).values({
            renderId: row.render.id,
            scriptId: row.script.id,
            characterId,
            platform: p,
            accountHandle: s.accounts?.[slugById.get(characterId) ?? ""]?.[p] ?? null,
            caption,
            scheduledAt: when,
            createdBy: opts.userId,
          });
        }
        taken.add(key);
        await db.update(scripts).set({ status: "scheduled" }).where(eq(scripts.id, row.script.id));
        created++;
      }
    }
  }
  return { scheduledReels: created };
}
