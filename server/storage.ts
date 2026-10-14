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
