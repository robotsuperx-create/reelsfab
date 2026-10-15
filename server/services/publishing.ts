import { and, asc, eq, lte, ne } from "drizzle-orm";
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

/** Atomically moves a due post from "queued" to "publishing" so two runners can never publish it twice. */
async function claimPost(id: number) {
  const db = await requireDb();
  const rows = await db
    .update(posts)
    .set({ status: "publishing" })
    .where(and(eq(posts.id, id), eq(posts.status, "queued")))
    .returning({ id: posts.id });
  return rows.length > 0;
}

async function finishPost(id: number, scriptId: number, result: { id: string; url?: string | null }) {
  const db = await requireDb();
  await db
    .update(posts)
    .set({ status: "published", externalId: result.id, postUrl: result.url ?? null, publishedAt: new Date() })
    .where(eq(posts.id, id));
  await db.update(scripts).set({ status: "published" }).where(eq(scripts.id, scriptId));
}

async function failPost(id: number) {
  const db = await requireDb();
  await db.update(posts).set({ status: "failed" }).where(eq(posts.id, id));
}

function dueQuery(platform: "instagram" | "other", limit: number) {
  return requireDb().then(db =>
    db
      .select({ post: posts, render: renders })
      .from(posts)
      .innerJoin(renders, eq(renders.id, posts.renderId))
      .where(
        and(
          platform === "instagram" ? eq(posts.platform, "instagram") : ne(posts.platform, "instagram"),
          eq(posts.status, "queued"),
          lte(posts.scheduledAt, new Date()),
          eq(renders.qcStatus, "approved"),
        ),
      )
      .orderBy(asc(posts.scheduledAt))
      .limit(limit),
  );
}

type PublishSummary = { attempted: number; published: number; failed: number; errors: string[] };

/** Publishes a small bounded batch of due Instagram posts. */
export async function publishDueInstagramPosts(limit = 3): Promise<PublishSummary> {
  const db = await requireDb();
  const due = await dueQuery("instagram", limit);
  const out: PublishSummary = { attempted: 0, published: 0, failed: 0, errors: [] };
  if (!due.length) return out;
  const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.platform, "instagram"));
  for (const row of due) {
    if (!(await claimPost(row.post.id))) continue;
    out.attempted++;
    const account = accounts.find(
      a => a.characterId === row.post.characterId && a.status === "connected" && (!row.post.accountHandle || a.handle === row.post.accountHandle),
    );
    try {
      if (!account?.encryptedAccessToken || !account.platformUserId) throw new Error("Instagram account is not connected");
      const videoUrl = row.render.storageKey ? await storageGetSignedUrl(row.render.storageKey) : row.render.videoUrl;
      const result = await new InstagramClient({
        igUserId: account.platformUserId,
        accessToken: decryptSecret(account.encryptedAccessToken),
      }).publishReel({ videoUrl, caption: withDisclosure(row.post.caption, 2200) });
      await finishPost(row.post.id, row.post.scriptId, { id: result.id });
      out.published++;
    } catch (error) {
      out.failed++;
      out.errors.push(`post-${row.post.id} (instagram): ${error instanceof Error ? error.message : "publish failed"}`);
      await failPost(row.post.id);
    }
  }
  return out;
}

/** Publishes a small bounded batch of due TikTok / YouTube posts. */
export async function publishDueSocialPosts(limit = 3): Promise<PublishSummary> {
  const db = await requireDb();
  const due = await dueQuery("other", limit);
  const out: PublishSummary = { attempted: 0, published: 0, failed: 0, errors: [] };
  if (!due.length) return out;
  const accounts = await db.select().from(socialAccounts);
  for (const row of due) {
    if (!(await claimPost(row.post.id))) continue;
    out.attempted++;
    const account = accounts.find(
      a =>
        a.platform === row.post.platform &&
        a.characterId === row.post.characterId &&
        a.status === "connected" &&
        (!row.post.accountHandle || a.handle === row.post.accountHandle),
    );
    try {
      if (!account) throw new Error(`${row.post.platform} account is not connected`);
      const result =
        row.post.platform === "tiktok"
          ? await publishTikTok({
              account,
              storageKey: row.render.storageKey,
              videoUrl: row.render.videoUrl,
              title: withDisclosure((row.post.caption ?? "AI Reel").split("\n")[0], 100),
            })
          : await publishYouTube({
              account,
              storageKey: row.render.storageKey,
              videoUrl: row.render.videoUrl,
              title: withDisclosure((row.post.caption ?? "AI Reel").split("\n")[0], 100),
              description: withDisclosure(row.post.caption, 5000),
            });
      await finishPost(row.post.id, row.post.scriptId, result);
      out.published++;
    } catch (error) {
      out.failed++;
      out.errors.push(`post-${row.post.id} (${row.post.platform}): ${error instanceof Error ? error.message : "publish failed"}`);
      await failPost(row.post.id);
    }
  }
  return out;
}
