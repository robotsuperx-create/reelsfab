import { and, asc, eq, lte } from "drizzle-orm";
import { posts, renders, scripts, socialAccounts } from "../../drizzle/schema";
import { requireDb } from "../db";
import { decryptSecret } from "./social-accounts";
import { InstagramClient } from "./instagram/client";
import { storageGetSignedUrl } from "../storage";

/** Publishes a small bounded batch so a scheduler run cannot monopolize the worker. */
export async function publishDueInstagramPosts(limit = 3) {
  const db = await requireDb();
  const due = await db
    .select({ post: posts, render: renders })
    .from(posts)
    .innerJoin(renders, eq(renders.id, posts.renderId))
    .where(and(eq(posts.platform, "instagram"), eq(posts.status, "queued"), lte(posts.scheduledAt, new Date()), eq(renders.qcStatus, "approved")))
    .orderBy(asc(posts.scheduledAt))
    .limit(limit);
  if (!due.length) return { attempted: 0, published: 0, failed: 0, errors: [] as string[] };

  const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.platform, "instagram"));
  let published = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of due) {
    const account = accounts.find(candidate =>
      candidate.characterId === row.post.characterId &&
      candidate.status === "connected" &&
      (!row.post.accountHandle || candidate.handle === row.post.accountHandle),
    );
    if (!account?.encryptedAccessToken || !account.platformUserId) {
      failed++;
      errors.push(`post-${row.post.id}: Instagram account is not connected`);
      await db.update(posts).set({ status: "failed" }).where(eq(posts.id, row.post.id));
      continue;
    }

    try {
      const videoUrl = row.render.storageKey ? await storageGetSignedUrl(row.render.storageKey) : row.render.videoUrl;
      const result = await new InstagramClient({
        igUserId: account.platformUserId,
        accessToken: decryptSecret(account.encryptedAccessToken),
      }).publishReel({ videoUrl, caption: row.post.caption ?? "" });
      await db.update(posts).set({ status: "published", externalId: result.id, publishedAt: new Date() }).where(eq(posts.id, row.post.id));
      await db.update(scripts).set({ status: "published" }).where(eq(scripts.id, row.post.scriptId));
      published++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : "Instagram publish failed";
      errors.push(`post-${row.post.id}: ${message}`);
      await db.update(posts).set({ status: "failed" }).where(eq(posts.id, row.post.id));
    }
  }
  return { attempted: due.length, published, failed, errors };
}
