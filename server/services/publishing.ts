import { and, asc, eq, lte } from "drizzle-orm";
import { posts, renders, scripts, socialAccounts } from "../../drizzle/schema";
import { requireDb } from "../db";
import { decryptSecret } from "./social-accounts";
import { InstagramClient } from "./instagram/client";
import { storageGetSignedUrl } from "../storage";
import { publishTikTok, publishYouTube } from "./social-publishers";

/** Platform-independent AI/ad disclosure. Tags come from DISCLOSURE_TAGS (default "#AIgenerated #ad"). */
export function disclosureTags() {
  return (process.env.DISCLOSURE_TAGS ?? "#AIgenerated #ad").trim();
}

export function withDisclosure(caption: string | null | undefined, maxLength?: number) {
  const tags = disclosureTags();
  const base = (caption ?? "").trim();
  if (!tags) return base;
  const missing = tags.split(/\s+/).filter(t => !base.toLowerCase().includes(t.toLowerCase()));
  if (!missing.length) return base;
  const suffix = ` ${missing.join(" ")}`;
  if (maxLength && base.length + suffix.length > maxLength) return `${base.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()}${suffix}`;
  return base ? `${base}\n\n${missing.join(" ")}` : missing.join(" ");
}

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
      }).publishReel({ videoUrl, caption: withDisclosure(row.post.caption, 2200) });
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

export async function publishDueSocialPosts(limit = 3) {
  const db = await requireDb();
  const due = await db.select({ post: posts, render: renders }).from(posts).innerJoin(renders, eq(renders.id, posts.renderId)).where(and(eq(posts.status, "queued"), lte(posts.scheduledAt, new Date()), eq(renders.qcStatus, "approved"))).orderBy(asc(posts.scheduledAt)).limit(limit);
  if (!due.length) return { attempted: 0, published: 0, failed: 0, errors: [] as string[] };
  const accounts = await db.select().from(socialAccounts);
  let published = 0; let failed = 0; const errors: string[] = [];
  for (const row of due) {
    if (row.post.platform === "instagram") continue;
    const account = accounts.find(a => a.platform === row.post.platform && a.characterId === row.post.characterId && a.status === "connected" && (!row.post.accountHandle || a.handle === row.post.accountHandle));
    if (!account) { failed++; errors.push(`post-${row.post.id}: ${row.post.platform} account is not connected`); await db.update(posts).set({ status: "failed" }).where(eq(posts.id, row.post.id)); continue; }
    try {
      const title = withDisclosure((row.post.caption ?? "AI Reel").split("\n")[0], 100);
      const result = row.post.platform === "tiktok"
        ? await publishTikTok({ account, storageKey: row.render.storageKey, videoUrl: row.render.videoUrl, title })
        : await publishYouTube({ account, storageKey: row.render.storageKey, videoUrl: row.render.videoUrl, title, description: withDisclosure(row.post.caption, 5000) });
      await db.update(posts).set({ status: "published", externalId: result.id, postUrl: result.url ?? null, publishedAt: new Date() }).where(eq(posts.id, row.post.id));
      await db.update(scripts).set({ status: "published" }).where(eq(scripts.id, row.post.scriptId)); published++;
    } catch (error) { failed++; const message = error instanceof Error ? error.message : `${row.post.platform} publish failed`; errors.push(`post-${row.post.id}: ${message}`); await db.update(posts).set({ status: "failed" }).where(eq(posts.id, row.post.id)); }
  }
  return { attempted: due.length, published, failed, errors };
}
