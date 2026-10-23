/**
 * Free stock footage for B-roll (Pexels — free for commercial use, API key from the Integrations vault).
 * Pexels asks API users to link back to Pexels and credit the videographer; the credit is kept in the
 * asset's meta and the editor shows the "Videos provided by Pexels" link.
 */
import { and, eq, sql } from "drizzle-orm";
import { assets } from "../../drizzle/schema";
import { requireDb } from "../db";
import { storagePut } from "../storage";
import { getIntegrationConfig } from "./integration-vault";

export type StockVideo = {
  id: string;
  source: "pexels";
  thumb: string;
  /** Direct link of the chosen portrait file (≤1080 wide keeps downloads small). */
  file: string;
  width: number;
  height: number;
  durationSec: number;
  credit: string;
  sourceUrl: string;
};

type PexelsVideo = {
  id: number;
  width: number;
  height: number;
  url: string;
  image: string;
  duration: number;
  user?: { name?: string; url?: string };
  video_files?: { link: string; width?: number | null; height?: number | null; quality?: string; file_type?: string }[];
};

const cache = new Map<string, { at: number; items: StockVideo[]; total: number }>();
const CACHE_MS = 10 * 60_000;

async function pexelsKey() {
  const cfg = await getIntegrationConfig("pexels");
  const key = cfg.apiKey?.trim();
  if (!key) throw new Error("أضف مفتاح Pexels من مركز التكاملات أولًا (مجاني من pexels.com/api)");
  return key;
}

/** Picks the portrait rendition closest to 1080 wide without exceeding it; falls back to the smallest file. */
export function pickPexelsFile(v: PexelsVideo) {
  const files = (v.video_files ?? []).filter(f => f.link && /mp4/i.test(f.file_type ?? "mp4"));
  const portrait = files.filter(f => (f.height ?? 0) > (f.width ?? 0));
  const pool = portrait.length ? portrait : files;
  const fit = pool.filter(f => (f.width ?? 0) <= 1080 && (f.height ?? 0) <= 1920).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return fit[0] ?? pool.sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0] ?? null;
}

export function normalizePexels(v: PexelsVideo): StockVideo | null {
  const file = pickPexelsFile(v);
  if (!file) return null;
  const name = v.user?.name?.trim() || "Pexels";
  return {
    id: String(v.id),
    source: "pexels",
    thumb: v.image,
    file: file.link,
    width: file.width ?? v.width,
    height: file.height ?? v.height,
    durationSec: Number(v.duration) || 0,
    credit: `Video by ${name} on Pexels`,
    sourceUrl: v.url,
  };
}

export async function searchStockVideos(query: string, page = 1) {
  const q = query.trim();
  if (!q) return { items: [] as StockVideo[], total: 0 };
  const cacheKey = `${q.toLowerCase()}|${page}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return { items: hit.items, total: hit.total };
  const key = await pexelsKey();
  const url = new URL("https://api.pexels.com/v1/videos/search");
  url.searchParams.set("query", q);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("size", "medium");
  url.searchParams.set("per_page", "24");
  url.searchParams.set("page", String(Math.max(1, page)));
  const r = await fetch(url, { headers: { Authorization: key } });
  if (r.status === 429) throw new Error("Pexels: تجاوزت حد الطلبات (200 في الساعة) — انتظر قليلًا");
  if (!r.ok) throw new Error(`Pexels رفض الطلب (${r.status})`);
  const data = (await r.json()) as { videos?: PexelsVideo[]; total_results?: number };
  const items = (data.videos ?? []).map(normalizePexels).filter((x): x is StockVideo => !!x && x.durationSec >= 2 && x.durationSec <= 60);
  const total = Number(data.total_results) || items.length;
  cache.set(cacheKey, { at: Date.now(), items, total });
  return { items, total };
}

const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;

/** Downloads a stock clip into storage as a "broll" asset (deduplicated by source id). */
export async function importStockVideo(item: StockVideo, opts: { characterId: number | null; query: string; userId: number | null }) {
  const db = await requireDb();
  const [existing] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.kind, "broll"), sql`${assets.meta}->>'source' = ${item.source}`, sql`${assets.meta}->>'sourceId' = ${item.id}`))
    .limit(1);
  if (existing) return { asset: existing, reused: true as const };
  const r = await fetch(item.file);
  if (!r.ok) throw new Error(`تعذر تنزيل المقطع من ${item.source} (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > MAX_DOWNLOAD_BYTES) throw new Error("حجم المقطع غير مناسب (فارغ أو أكبر من 60MB)");
  const put = await storagePut(`broll/${item.source}-${item.id}.mp4`, buf, "video/mp4");
  const [row] = await db
    .insert(assets)
    .values({
      kind: "broll",
      characterId: opts.characterId,
      title: `${item.source}: ${opts.query}`.slice(0, 255),
      url: put.url,
      storageKey: put.key,
      mimeType: "video/mp4",
      sizeBytes: buf.length,
      durationMs: Math.round(item.durationSec * 1000),
      width: item.width,
      height: item.height,
      tags: ["stock", item.source, opts.query.slice(0, 60)],
      meta: { source: item.source, sourceId: item.id, sourceUrl: item.sourceUrl, credit: item.credit, query: opts.query },
      createdBy: opts.userId,
    })
    .returning();
  return { asset: row, reused: false as const };
}
