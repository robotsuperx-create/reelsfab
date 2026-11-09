/**
 * Free stock footage and stills for B-roll and episodes — Pexels or Pixabay (both free for commercial use, keys in
 * the Integrations vault). Pexels paused new API keys on 2026-09-30, so Pixabay works as an equal provider: whichever
 * key exists is used, Pexels first, and the other one takes over when a provider hits its rate limit or fails.
 * Credits (photographer + source) are kept in the asset's meta; the editors show where the media comes from.
 */
import { and, eq, sql } from "drizzle-orm";
import { assets } from "../../drizzle/schema";
import { requireDb } from "../db";
import { storagePut } from "../storage";
import { getIntegrationConfig } from "./integration-vault";

export type StockOrientation = "portrait" | "landscape";
export type StockSource = "pexels" | "pixabay";
export const STOCK_SOURCES: StockSource[] = ["pexels", "pixabay"];
/** Hosts a stock file may be downloaded from (checked again before import). */
export const STOCK_HOSTS = ["pexels.com", "pexels.test", "pixabay.com", "pixabay.test"];

export type StockVideo = {
  id: string;
  source: StockSource;
  thumb: string;
  /** Direct link of the chosen file (≤1080 wide portrait / ≤1920 wide landscape keeps downloads small). */
  file: string;
  width: number;
  height: number;
  durationSec: number;
  credit: string;
  sourceUrl: string;
};

export type StockPhoto = {
  id: string;
  source: StockSource;
  thumb: string;
  file: string;
  width: number;
  height: number;
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

/** Configured stock providers in order of preference (Pexels first when both keys exist). */
export async function stockProviders(): Promise<{ source: StockSource; key: string }[]> {
  const out: { source: StockSource; key: string }[] = [];
  for (const source of STOCK_SOURCES) {
    const key = (await getIntegrationConfig(source)).apiKey?.trim();
    if (key) out.push({ source, key });
  }
  if (!out.length) throw new Error("أضف مفتاح Pixabay (مجاني من pixabay.com/api/docs) أو Pexels من مركز التكاملات أولًا");
  return out;
}

class StockQuotaError extends Error {}

/** Runs a search on the first provider and falls back to the next one on a rate limit or a server error. */
async function withProviders<T>(run: (p: { source: StockSource; key: string }) => Promise<T>): Promise<T> {
  const providers = await stockProviders();
  let last: unknown;
  for (const p of providers) {
    try {
      return await run(p);
    } catch (e) {
      last = e;
      if (!(e instanceof StockQuotaError)) throw e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function stockFetch(source: StockSource, url: URL, headers?: Record<string, string>) {
  const r = await fetch(url, headers ? { headers } : undefined);
  const name = source === "pexels" ? "Pexels" : "Pixabay";
  if (r.status === 429) throw new StockQuotaError(`${name}: تجاوزت حد الطلبات (${source === "pexels" ? "200 في الساعة" : "100 في الدقيقة"}) — انتظر قليلًا`);
  if (r.status >= 500) throw new StockQuotaError(`${name} لا يستجيب الآن (${r.status})`);
  if (!r.ok) {
    const text = (await r.text()).slice(0, 160);
    if (r.status === 400 && /key/i.test(text)) throw new Error(`مفتاح ${name} مرفوض — تحقق منه في مركز التكاملات`);
    throw new Error(`${name} رفض الطلب (${r.status})`);
  }
  return r.json();
}

/** Pixabay requires responses to be cached for 24 hours; Pexels results are kept 10 minutes. */
const cacheMs = (source: StockSource) => (source === "pixabay" ? 24 * 3_600_000 : CACHE_MS);
const MAX_CACHE = 600;
function remember<V>(map: Map<string, V>, key: string, value: V) {
  if (map.size >= MAX_CACHE) map.delete(map.keys().next().value as string);
  map.set(key, value);
}

/** Picks the rendition closest to the target size without exceeding it; falls back to the smallest file. */
export function pickPexelsFile(v: PexelsVideo, orientation: StockOrientation = "portrait") {
  const files = (v.video_files ?? []).filter(f => f.link && /mp4/i.test(f.file_type ?? "mp4"));
  const wanted = files.filter(f => (orientation === "portrait" ? (f.height ?? 0) > (f.width ?? 0) : (f.width ?? 0) >= (f.height ?? 0)));
  const pool = wanted.length ? wanted : files;
  const maxW = orientation === "portrait" ? 1080 : 1920;
  const maxH = orientation === "portrait" ? 1920 : 1080;
  const fit = pool.filter(f => (f.width ?? 0) <= maxW && (f.height ?? 0) <= maxH).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return fit[0] ?? pool.sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0] ?? null;
}

export function normalizePexels(v: PexelsVideo, orientation: StockOrientation = "portrait"): StockVideo | null {
  const file = pickPexelsFile(v, orientation);
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

export async function searchStockVideos(query: string, page = 1, orientation: StockOrientation = "portrait") {
  const q = query.trim().slice(0, 100);
  if (!q) return { items: [] as StockVideo[], total: 0, source: null as StockSource | null };
  return withProviders(async ({ source, key }) => {
    const cacheKey = `v|${source}|${orientation}|${q.toLowerCase()}|${page}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < cacheMs(source)) return { items: hit.items, total: hit.total, source };
    let items: StockVideo[];
    let total: number;
    if (source === "pexels") {
      const url = new URL("https://api.pexels.com/v1/videos/search");
      url.searchParams.set("query", q);
      url.searchParams.set("orientation", orientation);
      url.searchParams.set("size", "medium");
      url.searchParams.set("per_page", "24");
      url.searchParams.set("page", String(Math.max(1, page)));
      const data = (await stockFetch(source, url, { Authorization: key })) as { videos?: PexelsVideo[]; total_results?: number };
      items = (data.videos ?? []).map(v => normalizePexels(v, orientation)).filter((x): x is StockVideo => !!x);
      total = Number(data.total_results) || items.length;
    } else {
      const url = new URL("https://pixabay.com/api/videos/");
      url.searchParams.set("key", key);
      url.searchParams.set("q", q);
      url.searchParams.set("safesearch", "true");
      url.searchParams.set("per_page", "24");
      url.searchParams.set("page", String(Math.max(1, page)));
      const data = (await stockFetch(source, url)) as { hits?: PixabayVideo[]; totalHits?: number };
      // Pixabay has no orientation filter for video: matching clips first, the rest are center-cropped by the renderer.
      const all = (data.hits ?? []).map(normalizePixabayVideo).filter((x): x is StockVideo => !!x);
      const fits = (x: StockVideo) => (orientation === "portrait" ? x.height > x.width : x.width >= x.height);
      items = [...all.filter(fits), ...all.filter(x => !fits(x))];
      total = Number(data.totalHits) || items.length;
    }
    items = items.filter(x => x.durationSec >= 2 && x.durationSec <= 60);
    remember(cache, cacheKey, { at: Date.now(), items, total });
    return { items, total, source };
  });
}

type PixabayVariant = { url?: string; width?: number; height?: number; size?: number; thumbnail?: string };
type PixabayVideo = { id: number; pageURL: string; duration: number; user?: string; tags?: string; videos?: Partial<Record<"large" | "medium" | "small" | "tiny", PixabayVariant>> };

/** Largest Pixabay rendition within 1920×1080 (landscape) / 1080×1920 (portrait); the 4K "large" one is skipped. */
export function normalizePixabayVideo(v: PixabayVideo): StockVideo | null {
  const variants = Object.values(v.videos ?? {}).filter((f): f is Required<Pick<PixabayVariant, "url" | "width" | "height">> & PixabayVariant => !!f?.url && !!f.width && !!f.height);
  if (!variants.length) return null;
  const portrait = variants[0].height > variants[0].width;
  const maxW = portrait ? 1080 : 1920;
  const maxH = portrait ? 1920 : 1080;
  const fit = variants.filter(f => f.width <= maxW && f.height <= maxH).sort((a, b) => b.width - a.width);
  const file = fit[0] ?? [...variants].sort((a, b) => a.width - b.width)[0];
  const thumb = variants.find(f => f.thumbnail)?.thumbnail ?? "";
  return {
    id: String(v.id),
    source: "pixabay",
    thumb,
    file: file.url,
    width: file.width,
    height: file.height,
    durationSec: Number(v.duration) || 0,
    credit: `Video by ${v.user?.trim() || "Pixabay"} on Pixabay`,
    sourceUrl: v.pageURL,
  };
}

type PixabayPhoto = { id: number; pageURL: string; user?: string; webformatURL?: string; largeImageURL?: string; fullHDURL?: string; imageWidth: number; imageHeight: number };

/** Pixabay stills: the 1920px "fullHD" link when the key has full access, else the 1280px "large" one. */
export function normalizePixabayPhoto(p: PixabayPhoto): StockPhoto | null {
  const file = p.fullHDURL || p.largeImageURL;
  if (!file) return null;
  const longest = p.fullHDURL ? 1920 : 1280;
  const landscape = p.imageWidth >= p.imageHeight;
  const scale = Math.min(1, longest / Math.max(p.imageWidth, p.imageHeight, 1));
  return {
    id: String(p.id),
    source: "pixabay",
    thumb: p.webformatURL || file,
    file,
    width: Math.round(p.imageWidth * scale) || (landscape ? longest : Math.round(longest * 0.5625)),
    height: Math.round(p.imageHeight * scale) || (landscape ? Math.round(longest * 0.5625) : longest),
    credit: `Photo by ${p.user?.trim() || "Pixabay"} on Pixabay`,
    sourceUrl: p.pageURL,
  };
}

const photoCache = new Map<string, { at: number; items: StockPhoto[]; total: number }>();

type PexelsPhoto = { id: number; width: number; height: number; url: string; photographer?: string; src?: Record<string, string> };

export function normalizePexelsPhoto(p: PexelsPhoto, orientation: StockOrientation = "landscape"): StockPhoto | null {
  const file = p.src?.large2x || p.src?.large || p.src?.original;
  if (!file) return null;
  return {
    id: String(p.id),
    source: "pexels",
    thumb: p.src?.medium || p.src?.small || file,
    file,
    width: orientation === "landscape" ? 1880 : 1080,
    height: Math.round((orientation === "landscape" ? 1880 : 1080) * (p.height / Math.max(1, p.width))),
    credit: `Photo by ${p.photographer?.trim() || "Pexels"} on Pexels`,
    sourceUrl: p.url,
  };
}

/** Free stills (Ken Burns material) from Pexels or Pixabay photos. */
export async function searchStockPhotos(query: string, page = 1, orientation: StockOrientation = "landscape") {
  const q = query.trim().slice(0, 100);
  if (!q) return { items: [] as StockPhoto[], total: 0, source: null as StockSource | null };
  return withProviders(async ({ source, key }) => {
    const cacheKey = `p|${source}|${orientation}|${q.toLowerCase()}|${page}`;
    const hit = photoCache.get(cacheKey);
    if (hit && Date.now() - hit.at < cacheMs(source)) return { items: hit.items, total: hit.total, source };
    let items: StockPhoto[];
    let total: number;
    if (source === "pexels") {
      const url = new URL("https://api.pexels.com/v1/search");
      url.searchParams.set("query", q);
      url.searchParams.set("orientation", orientation);
      url.searchParams.set("per_page", "24");
      url.searchParams.set("page", String(Math.max(1, page)));
      const data = (await stockFetch(source, url, { Authorization: key })) as { photos?: PexelsPhoto[]; total_results?: number };
      items = (data.photos ?? []).map(p => normalizePexelsPhoto(p, orientation)).filter((x): x is StockPhoto => !!x);
      total = Number(data.total_results) || items.length;
    } else {
      const url = new URL("https://pixabay.com/api/");
      url.searchParams.set("key", key);
      url.searchParams.set("q", q);
      url.searchParams.set("image_type", "photo");
      url.searchParams.set("orientation", orientation === "landscape" ? "horizontal" : "vertical");
      url.searchParams.set("safesearch", "true");
      url.searchParams.set("min_width", orientation === "landscape" ? "1280" : "720");
      url.searchParams.set("per_page", "24");
      url.searchParams.set("page", String(Math.max(1, page)));
      const data = (await stockFetch(source, url)) as { hits?: PixabayPhoto[]; totalHits?: number };
      items = (data.hits ?? []).map(normalizePixabayPhoto).filter((x): x is StockPhoto => !!x);
      total = Number(data.totalHits) || items.length;
    }
    remember(photoCache, cacheKey, { at: Date.now(), items, total });
    return { items, total, source };
  });
}

/** True when a stock file URL is on a known provider host (imports never fetch arbitrary URLs). */
export function isStockHost(url: string) {
  try {
    const host = new URL(url).hostname;
    return STOCK_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;

/** Downloads a stock photo into storage as a "background" asset (deduplicated by source id). */
export async function importStockPhoto(item: StockPhoto, opts: { query: string; userId: number | null }) {
  const db = await requireDb();
  const [existing] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.kind, "background"), sql`${assets.meta}->>'source' = ${item.source}`, sql`${assets.meta}->>'sourceId' = ${`photo-${item.id}`}`))
    .limit(1);
  if (existing) return { asset: existing, reused: true as const };
  const r = await fetch(item.file);
  if (!r.ok) throw new Error(`تعذر تنزيل الصورة من ${item.source} (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > 25 * 1024 * 1024) throw new Error("حجم الصورة غير مناسب");
  const type = r.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const put = await storagePut(`stills/${item.source}-${item.id}.${type.includes("png") ? "png" : "jpg"}`, buf, type);
  const [row] = await db
    .insert(assets)
    .values({
      kind: "background",
      characterId: null,
      title: `${item.source}: ${opts.query}`.slice(0, 255),
      url: put.url,
      storageKey: put.key,
      mimeType: type,
      sizeBytes: buf.length,
      width: item.width,
      height: item.height,
      tags: ["stock", item.source, opts.query.slice(0, 60)],
      meta: { source: item.source, sourceId: `photo-${item.id}`, sourceUrl: item.sourceUrl, credit: item.credit, query: opts.query },
      createdBy: opts.userId,
    })
    .returning();
  return { asset: row, reused: false as const };
}

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
