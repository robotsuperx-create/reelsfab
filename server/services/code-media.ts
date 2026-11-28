/**
 * Pictures for code videos: the director asks for a photo, a clip or a map by description; this turns each request
 * into a stored file before the page is recorded.
 *
 *   - "query" → Pexels / Pixabay (free, whichever key the Integrations vault has), only when the owner switched free
 *     photos on; the file is imported into the library (with its credit) so it is downloaded once.
 *   - "asset" → a picture or clip of the owner's library.
 *   - maps → geometry computed here (code-maps.ts) and carried inside the page.
 * A request that cannot be met is dropped (the scene keeps its typography) and reported in `notes`.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { assets } from "../../drizzle/schema";
import { compileStoryboard, extractJsonObject, looksLikeStoryboard, mediaSlots, normalizeStoryboard, storyboardFromHtml, type MediaSlot, type SbMediaRef, type Storyboard } from "../../shared/code-craft/storyboard";
import { STYLE_TO_THEME } from "../../shared/code-craft/knowledge";
import { requireDb } from "../db";
import { mediaPut, storageDownload, storageKeyFromUrl } from "../storage";
import { mapGeometry, type MapGeo } from "./code-maps";
import { importStockPhoto, importStockVideo, searchStockPhotos, searchStockVideos, stockProviders, type StockPhoto, type StockVideo } from "./stock";

export type MediaChoice = { stock: boolean; library: boolean };
export type PrepareOptions = MediaChoice & {
  width: number;
  height: number;
  userId?: number | null;
  /** Pictures already used elsewhere in the same video (long videos: one set across segments). */
  used?: Set<string>;
};
export type Prepared = { storyboard: Storyboard; geo: Record<string, MapGeo>; notes: string[]; credits: string[] };

const LIGHT_THEMES = new Set(["infographic", "storybook"]);
const IMAGE_KINDS = ["background", "character_image", "thumbnail", "other"] as const;

function run(cmd: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = execFile(cmd, args, { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd}: ${String(stderr).slice(0, 300) || err.message}`));
      resolve(stdout as Buffer);
    });
    if (input) { p.stdin?.on("error", () => undefined); p.stdin?.end(input); }
  });
}

/** A still of a clip at `at` seconds (JPEG), for the preview and as the clip's fallback. */
async function posterOf(videoKey: string, at: number): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "cv-poster-"));
  try {
    const file = join(dir, "clip.mp4");
    await writeFile(file, await storageDownload(videoKey));
    return await run("ffmpeg", ["-v", "error", "-ss", at.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", "-f", "image2", "pipe:1"]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

type AssetRow = typeof assets.$inferSelect;
const keyOf = (a: Pick<AssetRow, "url" | "storageKey">) => a.storageKey || storageKeyFromUrl(a.url) || "";
const isImage = (a: AssetRow) => /^image\//.test(a.mimeType ?? "") || (IMAGE_KINDS as readonly string[]).includes(a.kind) && !/^video\//.test(a.mimeType ?? "");
const isVideo = (a: AssetRow) => /^video\//.test(a.mimeType ?? "") || a.kind === "broll";
const isLogo = (a: AssetRow) => (a.tags ?? []).some(t => /^(logo|شعار)$/i.test(t)) || /\b(logo)\b|شعار/i.test(a.title ?? "");

/** The poster still of a clip asset, made once and remembered in the asset's meta. */
async function clipPoster(a: AssetRow, start: number): Promise<string | undefined> {
  const meta = (a.meta ?? {}) as Record<string, unknown>;
  if (typeof meta.poster === "string" && start < 0.5) return meta.poster;
  try {
    const jpg = await posterOf(keyOf(a), start);
    const put = await mediaPut(`stills/poster-${a.id}.jpg`, jpg, "image/jpeg");
    if (start < 0.5) {
      const db = await requireDb();
      await db.update(assets).set({ meta: { ...meta, poster: put.key } }).where(eq(assets.id, a.id));
    }
    return put.key;
  } catch {
    return undefined;
  }
}

async function libraryAsset(id: number) {
  const db = await requireDb();
  const [a] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return a ?? null;
}

/** Recent pictures and clips of the library, listed for the director (and the owner's logo, if tagged). */
export async function libraryForDirector(limit = 40) {
  const db = await requireDb();
  const rows = await db.select().from(assets).where(inArray(assets.kind, [...IMAGE_KINDS, "broll"])).orderBy(desc(assets.id)).limit(200);
  const own = rows.filter(a => !(a.tags ?? []).includes("stock"));
  const pick = [...own, ...rows.filter(a => (a.tags ?? []).includes("stock"))].slice(0, limit);
  const lines = pick.map(a => {
    const tags = (a.tags ?? []).filter(t => t !== "stock").slice(0, 4).join(", ");
    const kind = isLogo(a) ? "LOGO" : isVideo(a) ? `clip ${a.durationMs ? `${Math.round(a.durationMs / 1000)}s` : ""}`.trim() : "photo";
    return `  #${a.id} ${kind}: "${(a.title ?? "").slice(0, 60)}"${tags ? ` [${tags}]` : ""}${a.width && a.height ? ` ${a.width}x${a.height}` : ""}`;
  });
  const logo = rows.find(a => isLogo(a) && isImage(a));
  return { text: lines.join("\n"), logoKey: logo ? keyOf(logo) : null, count: pick.length };
}

const WIKI_UA = "ReellllLocaL-studio/1.0 (code-video; local)";
/**
 * The lead picture of a Wikipedia article (a person's portrait, a landmark, a company logo…), stored once in the
 * library with its credit. Tries the English article, then a search for the closest one.
 */
export async function importWikiImage(title: string, userId: number | null) {
  const db = await requireDb();
  const id = title.trim().replace(/\s+/g, "_");
  const [existing] = await db.select().from(assets).where(sql`${assets.meta}->>'source' = 'wikipedia' and ${assets.meta}->>'sourceId' = ${id}`).limit(1);
  if (existing) return { asset: existing, credit: (existing.meta as { credit?: string } | null)?.credit ?? `Wikipedia: ${title}` };
  const get = async (url: string) => {
    const r = await fetch(url, { headers: { "user-agent": WIKI_UA, accept: "application/json" } });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  };
  type Summary = { title?: string; thumbnail?: { source: string; width: number; height: number }; originalimage?: { source: string; width: number; height: number }; content_urls?: { desktop?: { page?: string } } };
  let page = (await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(id)}?redirect=true`)) as Summary | null;
  if (!page?.thumbnail) {
    const found = (await get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(title)}`)) as { query?: { search?: { title: string }[] } } | null;
    const best = found?.query?.search?.[0]?.title;
    if (best) page = (await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(best.replace(/\s+/g, "_"))}?redirect=true`)) as Summary | null;
  }
  const thumb = page?.thumbnail?.source;
  if (!thumb) return null;
  // A sharp version: the thumbnail service at 1000 px (or the original when it is smaller).
  const orig = page?.originalimage;
  const src = orig && orig.width <= 1200 && !/\.svg$/i.test(orig.source) ? orig.source : thumb.replace(/\/(\d+)px-/, "/1000px-");
  const r = await fetch(src, { headers: { "user-agent": WIKI_UA } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > 20 * 1024 * 1024) return null;
  const type = r.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
  const hash = createHash("sha1").update(id).digest("hex").slice(0, 10);
  const put = await mediaPut(`stills/wiki-${hash}.${type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"}`, buf, type);
  const credit = `Wikipedia / Wikimedia Commons: ${page?.title ?? title}`;
  const [row] = await db
    .insert(assets)
    .values({
      kind: "other",
      characterId: null,
      title: `ويكيبيديا: ${page?.title ?? title}`.slice(0, 255),
      url: put.url,
      storageKey: put.key,
      mimeType: type,
      sizeBytes: buf.length,
      width: orig?.width ?? null,
      height: orig?.height ?? null,
      tags: ["stock", "wikipedia", (page?.title ?? title).slice(0, 60)],
      meta: { source: "wikipedia", sourceId: id, sourceUrl: page?.content_urls?.desktop?.page, credit, query: title },
      createdBy: userId,
    })
    .returning();
  return { asset: row, credit };
}

/** Stock providers configured in the vault (for the room's switch). */
export async function stockStatus() {
  try {
    return { sources: (await stockProviders()).map(p => p.source) };
  } catch {
    return { sources: [] as string[] };
  }
}

const geoId = (spec: unknown, w: number, h: number, place: string | undefined, lang: string, dark: boolean) =>
  "g" + createHash("sha1").update(JSON.stringify([spec, w, h, place ?? "", lang, dark])).digest("hex").slice(0, 10);

/** Resolves every picture, clip and map of a storyboard. Never throws for a missing picture: it drops it. */
export async function prepareStoryboard(input: Storyboard, o: PrepareOptions): Promise<Prepared> {
  const sb = structuredClone(input) as Storyboard;
  const notes: string[] = [];
  const credits: string[] = [];
  const used = o.used ?? new Set<string>();
  const orientation = o.height > o.width ? "portrait" : "landscape";
  const drop: MediaSlot[] = [];
  let stockError: string | null = null;
  for (const slot of mediaSlots(sb)) {
    const ref = slot.ref;
    // Template placeholders («…») are not real names or search words.
    if (ref.wiki?.includes("«")) delete ref.wiki;
    if (ref.query?.includes("«")) delete ref.query;
    try {
      if (ref.key) {
        used.add(ref.ref ?? ref.key);
        if (ref.credit) credits.push(ref.credit);
        continue;
      }
      if (ref.asset) {
        const a = await libraryAsset(ref.asset);
        const fits = a && (slot.kind === "clip" ? isVideo(a) : isImage(a));
        if (!a || !fits || !keyOf(a)) { notes.push(`الأصل #${ref.asset} غير موجود أو ليس ${slot.kind === "clip" ? "فيديو" : "صورة"} — حُذف`); drop.push(slot); continue; }
        ref.key = keyOf(a);
        if (slot.kind === "clip") {
          ref.dur = Math.max(1, (a.durationMs ?? 10_000) / 1000);
          ref.start = 0;
          ref.poster = await clipPoster(a, 0);
        }
        const credit = (a.meta as { credit?: string } | null)?.credit;
        if (credit) { ref.credit = credit; credits.push(credit); }
        continue;
      }
      if (ref.wiki && slot.kind === "photo") {
        if (!o.stock) { drop.push(slot); continue; }
        const w = await importWikiImage(ref.wiki, o.userId ?? null);
        if (w) {
          ref.key = keyOf(w.asset);
          ref.credit = w.credit;
          credits.push(w.credit);
          continue;
        }
        notes.push(`لا صورة في ويكيبيديا لـ «${ref.wiki}»${ref.query ? " — بحث في الصور المجانية بدلًا منها" : ""}`);
        if (!ref.query) { drop.push(slot); continue; }
      }
      if (!ref.query) { drop.push(slot); continue; }
      if (!o.stock) { drop.push(slot); continue; }
      if (stockError) { drop.push(slot); continue; }
      if (slot.kind === "clip") {
        const found = await searchStockVideos(ref.query, 1, orientation);
        const pool = found.items.filter(v => v.durationSec >= 3 && !used.has(`${v.source}:${v.id}`));
        const v: StockVideo | undefined = pool[(ref.pick ?? 0) % Math.max(1, pool.length)];
        if (!v) { notes.push(`لا مقطع مجاني لـ «${ref.query}» — صار المشهد بلا مقطع`); drop.push(slot); continue; }
        const { asset } = await importStockVideo(v, { characterId: null, query: ref.query, userId: o.userId ?? null });
        const start = v.durationSec > 8 ? Math.min(2, v.durationSec * 0.1) : 0;
        Object.assign(ref, { key: keyOf(asset), dur: +(v.durationSec - start).toFixed(2), start: +start.toFixed(2), credit: v.credit, ref: `${v.source}:${v.id}` } satisfies SbMediaRef);
        ref.poster = await clipPoster(asset, start);
        used.add(`${v.source}:${v.id}`);
        credits.push(v.credit);
      } else {
        const found = await searchStockPhotos(ref.query, 1, orientation);
        const pool = found.items.filter(p => !used.has(`${p.source}:${p.id}`));
        const p: StockPhoto | undefined = pool[(ref.pick ?? 0) % Math.max(1, pool.length)];
        if (!p) { notes.push(`لا صورة مجانية لـ «${ref.query}» — صار المشهد بلا صورة`); drop.push(slot); continue; }
        const { asset } = await importStockPhoto(p, { query: ref.query, userId: o.userId ?? null });
        Object.assign(ref, { key: keyOf(asset), credit: p.credit, ref: `${p.source}:${p.id}` } satisfies SbMediaRef);
        used.add(`${p.source}:${p.id}`);
        credits.push(p.credit);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A missing key or a quota stops further searches for this video (each would fail the same way).
      if (ref.query && !ref.key) { stockError = msg; notes.push(`الصور المجانية: ${msg}`); }
      else notes.push(msg);
      drop.push(slot);
    }
  }
  // Drop what could not be met (scenes keep their typography).
  for (const slot of drop) {
    const scene = sb.scenes[slot.scene];
    if (slot.item === null) delete scene.media;
    else (scene.items[slot.item] as { __drop?: boolean }).__drop = true;
  }
  for (const s of sb.scenes) s.items = s.items.filter(it => !(it as { __drop?: boolean }).__drop);
  if (!o.stock && drop.some(d => d.ref.query && !d.ref.key)) notes.push("الصور المجانية مطفأة — المشاهد التي طلبت صورًا صارت بلا صور");

  // Brand: the logo asked for, or the library's logo when the owner lets the director use the library.
  if (sb.brand?.asset && !sb.brand.logo) {
    const a = await libraryAsset(sb.brand.asset).catch(() => null);
    if (a && isImage(a)) sb.brand.logo = keyOf(a);
    else delete sb.brand;
  }
  if (o.library && !sb.brand?.logo) {
    const lib = await libraryForDirector(5).catch(() => null);
    if (lib?.logoKey) sb.brand = { ...(sb.brand ?? {}), logo: lib.logoKey };
  }

  // Maps.
  const geo: Record<string, MapGeo> = {};
  const lang = sb.lang ?? (/[؀-ۿ]/.test(JSON.stringify(sb.scenes)) ? "ar" : "en");
  const dark = !LIGHT_THEMES.has(sb.theme);
  for (const s of sb.scenes) {
    if (s.media?.type !== "map") continue;
    const { geoId: _old, ...spec } = s.media;
    const id = geoId(spec, o.width, o.height, s.place, lang, dark);
    try {
      const g = mapGeometry(spec, { width: o.width, height: o.height, lang, place: s.place, dark });
      if (g) { geo[id] = g; s.media = { ...spec, geoId: id }; }
      else { delete s.media; notes.push("خريطة بلا دول معروفة — حُذفت"); }
    } catch (e) {
      delete s.media;
      notes.push(`تعذّر رسم الخريطة: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { storyboard: sb, geo, notes, credits: [...new Set(credits)] };
}

/** Every stored picture a page shows (backdrops, photo cards, clip posters, the logo). */
export function mediaKeys(sb: Storyboard) {
  const keys = new Set<string>();
  for (const s of mediaSlots(sb)) {
    if (s.kind === "clip") { if (s.ref.poster) keys.add(s.ref.poster); }
    else if (s.ref.key) keys.add(s.ref.key);
  }
  if (sb.brand?.logo) keys.add(sb.brand.logo);
  return [...keys];
}

const previewCache = new Map<string, string>();
/** Small inlined copies of the pictures for the in-browser preview (the sandboxed frame cannot fetch them). */
export async function previewMedia(sb: Storyboard, maxWidth = 720): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of mediaKeys(sb)) {
    const hit = previewCache.get(key);
    if (hit) { out[key] = hit; continue; }
    try {
      const buf = await storageDownload(key);
      const png = /\.png$/i.test(key);
      const small = await run("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", `scale='min(${maxWidth},iw)':-2`, ...(png ? ["-f", "image2", "-c:v", "png"] : ["-q:v", "4", "-f", "image2", "-c:v", "mjpeg"]), "pipe:1"], buf).catch(() => buf);
      const uri = `data:${png ? "image/png" : "image/jpeg"};base64,${small.toString("base64")}`;
      if (previewCache.size > 80) previewCache.delete(previewCache.keys().next().value as string);
      previewCache.set(key, uri);
      out[key] = uri;
    } catch {
      /* missing file: the preview shows the scene without it */
    }
  }
  return out;
}

/** Thumbnails for the room's picture strip: app URLs of each slot's picture. */
export function slotThumbs(sb: Storyboard) {
  return mediaSlots(sb).map(s => ({
    scene: s.scene,
    item: s.item,
    kind: s.kind,
    query: s.ref.query ?? null,
    asset: s.ref.asset ?? null,
    credit: s.ref.credit ?? null,
    url: s.kind === "clip" ? (s.ref.poster ? `/api/media/${s.ref.poster}` : null) : s.ref.key ? `/api/media/${s.ref.key}` : null,
  }));
}

/** Picks another picture for one slot: the next search result, new search words, a library asset, or none. */
export function swapSlot(sb: Storyboard, at: { scene: number; item: number | null }, change: { query?: string; asset?: number; remove?: boolean }) {
  const next = structuredClone(sb) as Storyboard;
  const scene = next.scenes[at.scene];
  if (!scene) throw new Error("المشهد غير موجود");
  const target = (at.item === null ? scene.media : scene.items[at.item]) as (SbMediaRef & { type?: string }) | undefined;
  if (!target || (at.item === null ? !scene.media || scene.media.type === "map" : target.type !== "photo")) throw new Error("لا صورة في هذا المكان");
  if (change.remove) {
    if (at.item === null) delete scene.media;
    else scene.items.splice(at.item, 1);
    return next;
  }
  const clear = (t: SbMediaRef) => { delete t.key; delete t.poster; delete t.start; delete t.dur; delete t.credit; };
  if (change.asset) { clear(target); delete target.query; delete target.ref; delete target.pick; target.asset = change.asset; }
  else if (change.query?.trim()) { clear(target); delete target.asset; delete target.ref; delete target.pick; target.query = change.query.trim().slice(0, 80); }
  else {
    if (!target.query) throw new Error("هذه الصورة من مكتبتك — اختر غيرها من المكتبة أو اكتب كلمات بحث");
    clear(target);
    // The rejected one stays "used" through its ref, so the next search result comes up.
    target.pick = (target.pick ?? 0) + 1;
    delete target.ref;
  }
  return next;
}

export type PastedPage = { html: string; storyboard: Storyboard | null; issues: string[]; notes: string[]; credits: string[]; json: boolean };

/** What was pasted (storyboard JSON, a compiled storyboard page, or any HTML) as the page to record. */
export function storyboardOf(text: string, durationSec: number, styleId?: string | null): { storyboard: Storyboard | null; issues: string[]; json: boolean } {
  if (looksLikeStoryboard(text)) {
    let raw: unknown;
    try { raw = extractJsonObject(text); } catch (e) { throw new Error(`القصة (JSON) غير صالحة: ${e instanceof Error ? e.message : String(e)}`); }
    const { storyboard, issues } = normalizeStoryboard(raw, durationSec, styleId ? STYLE_TO_THEME[styleId as keyof typeof STYLE_TO_THEME] : undefined);
    return { storyboard, issues, json: true };
  }
  const sb = storyboardFromHtml(text);
  if (!sb) return { storyboard: null, issues: [], json: false };
  const { storyboard, issues } = normalizeStoryboard(sb, durationSec, sb.theme);
  return { storyboard, issues, json: false };
}

/** Pasted text → the page to record, with its pictures fetched and its maps drawn. HTML pages pass through. */
export async function pastedPage(text: string, o: { width: number; height: number; durationSec: number; styleId?: string | null; stock?: boolean; library?: boolean; userId?: number | null; inline?: boolean }): Promise<PastedPage & { preview?: string }> {
  const { storyboard, issues, json } = storyboardOf(text, o.durationSec, o.styleId);
  if (!storyboard) return { html: text, storyboard: null, issues, notes: [], credits: [], json };
  return compilePrepared(storyboard, { ...o, issues, json });
}

export async function compilePrepared(sb: Storyboard, o: { width: number; height: number; durationSec: number; stock?: boolean; library?: boolean; userId?: number | null; inline?: boolean; issues?: string[]; json?: boolean }) {
  const ready = await prepareStoryboard(sb, { stock: o.stock === true, library: o.library === true, width: o.width, height: o.height, userId: o.userId });
  const size = { width: o.width, height: o.height, durationSec: o.durationSec };
  const html = compileStoryboard(ready.storyboard, { ...size, geo: ready.geo });
  const preview = o.inline ? compileStoryboard(ready.storyboard, { ...size, geo: ready.geo, media: await previewMedia(ready.storyboard) }) : undefined;
  return { html, preview, storyboard: ready.storyboard, issues: o.issues ?? [], notes: ready.notes, credits: ready.credits, json: o.json ?? false };
}
