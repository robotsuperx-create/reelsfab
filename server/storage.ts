import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { ENV } from "./_core/env";

/**
 * Supabase Storage adapter.
 * Files are private by default and are served through signed URLs or the
 * authenticated same-origin /api/media proxy.
 */
function getSupabaseConfig() {
  const url = ENV.supabaseUrl.replace(/\/+$/, "");
  const key = ENV.supabaseServiceRoleKey;
  if (!url || !key) {
    throw new Error("Supabase Storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return { url, key, bucket: ENV.supabaseStorageBucket };
}

function normalizeKey(relKey: string): string {
  const key = relKey.replace(/^\/+/, "");
  if (!key || key.includes("..") || key.includes("\\")) throw new Error("Invalid storage key");
  return key;
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

function objectPath(bucket: string, key: string) {
  return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function headers(key: string, contentType?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const { url, key: serviceKey, bucket } = getSupabaseConfig();
  const key = appendHashSuffix(normalizeKey(relKey));
  const response = await fetch(`${url}/storage/v1/object/${objectPath(bucket, key)}`, {
    method: "POST",
    headers: { ...headers(serviceKey, contentType), "x-upsert": "false", "cache-control": "3600" },
    body: typeof data === "string" ? data : Buffer.from(data),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Supabase Storage upload failed (${response.status}): ${message.slice(0, 300)}`);
  }
  return { key, url: `/api/media/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/api/media/${key}` };
}

export async function storageGetSignedUrl(relKey: string, expiresIn = 3600): Promise<string> {
  const { url, key: serviceKey, bucket } = getSupabaseConfig();
  const key = normalizeKey(relKey);
  const response = await fetch(`${url}/storage/v1/object/sign/${objectPath(bucket, key)}`, {
    method: "POST",
    headers: { ...headers(serviceKey), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Supabase Storage signed URL failed (${response.status}): ${message.slice(0, 300)}`);
  }
  const body = (await response.json()) as { signedURL?: string; signedUrl?: string };
  const signed = body.signedURL ?? body.signedUrl;
  if (!signed) throw new Error("Supabase Storage returned an empty signed URL");
  return signed.startsWith("http") ? signed : `${url}/storage/v1${signed.startsWith("/") ? signed : `/${signed}`}`;
}

/** Keys of files kept on this machine's disk instead of Supabase Storage. */
export const LOCAL_MEDIA_PREFIX = "local/";

/**
 * Heavy media (stock clips and stills, AI pictures, narration) stays on the local disk when the app runs on the
 * owner's computer: no slow uploads, no 1 GB free-tier storage limit. MEDIA_STORAGE=local|supabase overrides;
 * by default local outside production.
 */
export function localMediaEnabled() {
  const mode = (process.env.MEDIA_STORAGE ?? "").trim().toLowerCase();
  if (mode) return mode === "local";
  return process.env.NODE_ENV !== "production";
}

export function localMediaDir() {
  return resolve(process.env.MEDIA_DIR || join(process.cwd(), "output", "media"));
}

/** Absolute path of a local media key, refusing anything that would leave the media folder. */
export function localMediaPath(key: string) {
  const k = normalizeKey(key);
  if (!k.startsWith(LOCAL_MEDIA_PREFIX)) throw new Error("not a local media key");
  const root = localMediaDir();
  const path = resolve(root, ...k.slice(LOCAL_MEDIA_PREFIX.length).split("/"));
  if (!path.startsWith(root + sep)) throw new Error("Invalid storage key");
  return path;
}

/** Like storagePut, but for heavy media: local disk when enabled, Supabase Storage otherwise. */
export async function mediaPut(relKey: string, data: Buffer | Uint8Array, contentType = "application/octet-stream"): Promise<{ key: string; url: string }> {
  if (!localMediaEnabled()) return storagePut(relKey, data, contentType);
  const key = `${LOCAL_MEDIA_PREFIX}${appendHashSuffix(normalizeKey(relKey))}`;
  const path = localMediaPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(data));
  return { key, url: `/api/media/${key}` };
}

/** Downloads an object through a short-lived signed URL (used by the render worker); local media is read from disk. */
export async function storageDownload(relKey: string): Promise<Buffer> {
  if (relKey.startsWith(LOCAL_MEDIA_PREFIX)) return readFile(localMediaPath(relKey));
  const signed = await storageGetSignedUrl(relKey, 300);
  const response = await fetch(signed);
  if (!response.ok) throw new Error(`Storage download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

/** Maps an app media URL (/api/media/<key>) back to its storage key. */
export function storageKeyFromUrl(url: string | null | undefined) {
  if (!url) return null;
  const m = url.match(/^\/api\/media\/(.+)$/);
  return m ? m[1] : null;
}
