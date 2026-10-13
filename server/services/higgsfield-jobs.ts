import { and, eq, isNotNull } from "drizzle-orm";
import { premiumClips, scripts } from "../../drizzle/schema";
import { requireDb } from "../db";
import { storagePut } from "../storage";
import { getHiggsfieldStatus } from "./higgsfield";

export async function syncHiggsfieldClips(limit = 5) {
  const db = await requireDb();
  const rows = await db.select().from(premiumClips).where(and(eq(premiumClips.status, "generating"), isNotNull(premiumClips.providerStatusUrl))).limit(limit);
  let completed = 0;
  let failed = 0;
  for (const clip of rows) {
    try {
      const result = await getHiggsfieldStatus(clip.providerStatusUrl!);
      if (result.status === "completed" && result.video?.url) {
        const video = await fetch(result.video.url);
        if (!video.ok) throw new Error(`video download ${video.status}`);
        const stored = await storagePut(`premium/${clip.characterId}/clip-${clip.id}.mp4`, Buffer.from(await video.arrayBuffer()), "video/mp4");
        await db.update(premiumClips).set({ status: "received", videoUrl: stored.url, durationMs: 15000, providerError: null, completedAt: new Date() }).where(eq(premiumClips.id, clip.id));
        await db.update(scripts).set({ status: "premium_uploaded" }).where(eq(scripts.id, clip.scriptId));
        completed++;
      } else if (["failed", "cancelled", "nsfw"].includes(result.status)) {
        await db.update(premiumClips).set({ status: "failed", providerError: JSON.stringify(result.error ?? result.status).slice(0, 1000) }).where(eq(premiumClips.id, clip.id));
        failed++;
      }
    } catch (error) {
      await db.update(premiumClips).set({ providerError: error instanceof Error ? error.message.slice(0, 1000) : "Higgsfield sync failed" }).where(eq(premiumClips.id, clip.id));
      failed++;
    }
  }
  return { checked: rows.length, completed, failed };
}
