import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { postMetrics, posts, socialAccounts } from "../../drizzle/schema";
import { requireDb } from "../db";
import { decryptSecret } from "./social-accounts";
import { youtubeAccessToken } from "./social-publishers";

export async function syncPublishedMetrics(limit = 20) {
  const db = await requireDb();
  // Newest first, last 30 days: older posts barely move and would otherwise starve recent ones forever.
  const since = new Date(Date.now() - 30 * 86400000);
  const rows = await db
    .select({ post: posts })
    .from(posts)
    .where(and(eq(posts.status, "published"), isNotNull(posts.externalId), gte(posts.publishedAt, since)))
    .orderBy(desc(posts.publishedAt))
    .limit(limit);
  const accounts = await db.select().from(socialAccounts);
  let synced = 0; const errors: string[] = [];
  for (const row of rows) {
    try {
      const account = accounts.find(a => a.platform === row.post.platform && a.characterId === row.post.characterId && a.status === "connected");
      if (!account?.encryptedAccessToken) continue;
      const token = row.post.platform === "youtube" ? await youtubeAccessToken(account) : decryptSecret(account.encryptedAccessToken); let stats: any = {};
      if (row.post.platform === "instagram") {
        const r = await fetch(`https://graph.instagram.com/v26.0/${encodeURIComponent(row.post.externalId!)}?fields=like_count,comments_count,shares,saved,plays,video_view_count`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await r.json(); if (!r.ok) throw new Error(`Instagram insights ${r.status}`); stats = body;
      } else if (row.post.platform === "youtube") {
        const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(row.post.externalId!)}`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await r.json(); if (!r.ok) throw new Error(`YouTube statistics ${r.status}`); stats = body.items?.[0]?.statistics ?? {};
      } else {
        const r = await fetch("https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ filters: { video_ids: [row.post.externalId!] } }) });
        const body = await r.json(); if (!r.ok) throw new Error(`TikTok insights ${r.status}`); stats = body.data?.videos?.[0] ?? {};
      }
      const n = (v: unknown) => Math.max(0, Number(v ?? 0) || 0);
      await db.insert(postMetrics).values({ postId: row.post.id, views: n(stats.plays ?? stats.view_count ?? stats.viewCount), avgWatchMs: 0, completionPermille: 0, likes: n(stats.like_count ?? stats.likeCount), comments: n(stats.comments_count ?? stats.comment_count ?? stats.commentCount), shares: n(stats.shares ?? stats.share_count ?? stats.shareCount), saves: n(stats.saved), follows: 0 });
      synced++;
    } catch (error) { errors.push(`post-${row.post.id}: ${error instanceof Error ? error.message : "metrics failed"}`); }
  }
  return { checked: rows.length, synced, errors };
}
