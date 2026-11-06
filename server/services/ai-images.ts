/**
 * AI images via fal.ai (vault provider "fal": apiKey, standardModel, draftModel, premiumModel, usdPerImage).
 * Every generated picture becomes a library asset (kind "background") with its prompt, model and price in meta,
 * and its cost is logged — so a scene, a thumbnail or a character reference all reuse the same path.
 */
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { assets, costEntries } from "../../drizzle/schema";
import { IMAGE_MODEL_USD, IMAGE_TIER_DEFAULTS, falImageBody, type ImageAspect, type ImageTier } from "../../shared/images";
import { milliCentsFromUsd } from "../../shared/domain";
import { requireDb } from "../db";
import { storagePut } from "../storage";
import { getIntegrationConfig } from "./integration-vault";

const FAL_RUN = "https://fal.run";
const sleep = (ms: number) => new Promise(r => setTimeout(r, process.env.AI_RETRY_FAST ? 1 : ms));
/** fal endpoint ids look like "owner/model[/sub/path]" — never a URL, never "..". */
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){1,5}$/i;

export async function imageProviderReady() {
  const cfg = await getIntegrationConfig("fal");
  return Boolean(cfg.apiKey?.trim());
}

export async function resolveImageModel(tier: ImageTier) {
  const cfg = await getIntegrationConfig("fal");
  const configured = (tier === "draft" ? cfg.draftModel : tier === "premium" ? cfg.premiumModel : cfg.standardModel)?.trim();
  const model = configured || IMAGE_TIER_DEFAULTS[tier].model;
  if (!MODEL_ID.test(model) || model.includes("..")) throw new Error(`معرّف نموذج الصور غير صالح: ${model}`);
  const usd = IMAGE_MODEL_USD[model] ?? (Number(cfg.usdPerImage) > 0 ? Number(cfg.usdPerImage) : IMAGE_TIER_DEFAULTS[tier].usd);
  return { model, usd, key: cfg.apiKey?.trim() ?? "" };
}

type FalImage = { url?: string; content_type?: string; width?: number; height?: number };

/** Calls fal synchronously (fal.run) with retries on 429/5xx and returns the first image's bytes. */
export async function falGenerate(model: string, key: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch) {
  if (!key) throw new Error("أضف مفتاح fal.ai من مركز التكاملات (مزوّد «صور الذكاء الاصطناعي»)");
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetchImpl(`${FAL_RUN}/${model}`, { method: "POST", headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) {
      last = `fal ${res.status}: ${(await res.text()).slice(0, 200)}`;
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      await sleep(Math.max(retryAfter * 1000, 3000 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    if (res.status === 402 || (!res.ok && /balance|credit|billing|exhausted/i.test(text))) throw new Error("رصيد fal.ai غير كافٍ — اشحن الرصيد من fal.ai/dashboard/billing");
    if (res.status === 401 || res.status === 403) throw new Error("مفتاح fal.ai مرفوض — تحقق منه في مركز التكاملات");
    if (!res.ok) throw new Error(`fal ${res.status}: ${text.slice(0, 300)}`);
    let data: { images?: FalImage[]; image?: FalImage; has_nsfw_concepts?: boolean[] };
    try { data = JSON.parse(text); } catch { throw new Error("fal أرجع ردًا غير صالح"); }
    if (data.has_nsfw_concepts?.[0]) throw new Error("رفض فلتر الأمان الصورة — أعد صياغة الوصف");
    const image = data.images?.[0] ?? data.image;
    if (!image?.url) throw new Error("fal لم يُرجع صورة");
    let buf: Buffer;
    let type = image.content_type || "image/jpeg";
    const dataUri = /^data:([^;]+);base64,(.+)$/.exec(image.url);
    if (dataUri) {
      type = dataUri[1];
      buf = Buffer.from(dataUri[2], "base64");
    } else {
      const host = new URL(image.url).hostname;
      if (!/(^|\.)fal\.(media|run|ai)$|(^|\.)fal\.test$/.test(host)) throw new Error(`رابط صورة غير متوقع من fal: ${host}`);
      const file = await fetchImpl(image.url);
      if (!file.ok) throw new Error(`تعذر تنزيل الصورة المولدة (${file.status})`);
      buf = Buffer.from(await file.arrayBuffer());
      type = file.headers.get("content-type")?.split(";")[0] || type;
    }
    if (!buf.length || buf.length > 30 * 1024 * 1024) throw new Error("حجم الصورة المولدة غير مناسب");
    return { buf, type, width: image.width ?? null, height: image.height ?? null };
  }
  throw new Error(`${last || "fal"} — الخدمة مشغولة، أعد المحاولة بعد قليل`);
}

/**
 * Generates one image and stores it as a library asset. The same prompt+model+aspect is reused instead of paid twice.
 * Cost goes to the cost log ("image") and, when given, to an episode.
 */
export async function generateImageAsset(opts: {
  prompt: string;
  tier?: ImageTier;
  aspect?: ImageAspect;
  title?: string;
  userId?: number | null;
  ref?: { type: string; id: number };
  /** Skip the "same prompt already generated" reuse (a deliberate new variation). */
  fresh?: boolean;
  fetchImpl?: typeof fetch;
}) {
  const tier = opts.tier ?? "standard";
  const aspect = opts.aspect ?? "16:9";
  const prompt = opts.prompt.trim().slice(0, 3000);
  if (prompt.length < 3) throw new Error("اكتب وصفًا للصورة");
  const { model, usd, key } = await resolveImageModel(tier);
  const db = await requireDb();
  const sourceId = createHash("sha1").update(`${model}|${aspect}|${prompt}${opts.fresh ? `|${Date.now()}|${Math.random()}` : ""}`).digest("hex").slice(0, 16);
  const [existing] = opts.fresh ? [] : await db
    .select()
    .from(assets)
    .where(and(eq(assets.kind, "background"), sql`${assets.meta}->>'source' = 'fal'`, sql`${assets.meta}->>'sourceId' = ${sourceId}`))
    .limit(1);
  if (existing) return { asset: existing, reused: true as const, usd: 0, model };
  const out = await falGenerate(model, key, falImageBody(model, prompt, aspect), opts.fetchImpl);
  const ext = out.type.includes("png") ? "png" : out.type.includes("webp") ? "webp" : "jpg";
  const put = await storagePut(`ai-images/${sourceId}.${ext}`, out.buf, out.type);
  const [row] = await db
    .insert(assets)
    .values({
      kind: "background",
      characterId: null,
      title: (opts.title || `AI: ${prompt}`).slice(0, 255),
      url: put.url,
      storageKey: put.key,
      mimeType: out.type,
      sizeBytes: out.buf.length,
      width: out.width,
      height: out.height,
      tags: ["ai", "fal", tier],
      meta: { source: "fal", sourceId, model, prompt: prompt.slice(0, 1000), costUsd: usd, credit: `AI image (${model.split("/").slice(-2).join("/")})` },
      createdBy: opts.userId ?? null,
    })
    .returning();
  await db
    .insert(costEntries)
    .values({ category: "image", amountMilliCents: milliCentsFromUsd(usd), description: `صورة AI (${tier}) — ${prompt.slice(0, 120)}`, model, refType: opts.ref?.type, refId: opts.ref?.id, createdBy: opts.userId ?? undefined })
    .catch(e => console.warn("[cost] image", e));
  return { asset: row, reused: false as const, usd, model };
}
