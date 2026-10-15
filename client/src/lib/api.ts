import { getSupabaseClient } from "./supabase";

/** Same auth headers the tRPC client sends: Supabase access token when signed in (cookie auth otherwise). */
export async function authHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = getSupabaseClient();
    const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
    if (data.session?.access_token) return { Authorization: `Bearer ${data.session.access_token}` };
  } catch {
    // no session
  }
  return {};
}

export type UploadKind =
  | "character_image"
  | "background"
  | "music"
  | "premium_video"
  | "render"
  | "thumbnail"
  | "voice"
  | "other";

export type UploadResult = { id: number; url: string; key: string; size: number };

export async function uploadBlob(
  blob: Blob,
  opts: {
    kind: UploadKind;
    filename: string;
    characterId?: number | null;
    title?: string;
    durationMs?: number;
    width?: number;
    height?: number;
  },
): Promise<UploadResult> {
  const params = new URLSearchParams({ kind: opts.kind, filename: opts.filename });
  if (opts.characterId) params.set("characterId", String(opts.characterId));
  if (opts.title) params.set("title", opts.title);
  if (opts.durationMs) params.set("durationMs", String(Math.round(opts.durationMs)));
  if (opts.width) params.set("width", String(opts.width));
  if (opts.height) params.set("height", String(opts.height));
  const res = await fetch(`/api/upload?${params.toString()}`, {
    method: "POST",
    body: blob,
    credentials: "include",
    headers: { "Content-Type": blob.type || "application/octet-stream", ...(await authHeaders()) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`فشل الرفع (${res.status}) ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as UploadResult;
}

/** Returns a same-origin URL for stored media (safe for canvas/WebCodecs). */
export function proxied(url: string | null | undefined) {
  if (!url) return "";
  return url;
}

export async function fetchBlob(url: string) {
  const res = await fetch(proxied(url), { credentials: "include" });
  if (!res.ok) throw new Error(`تعذر تحميل الملف (${res.status})`);
  return res.blob();
}

export function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = proxied(url);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function tzOffset() {
  return new Date().getTimezoneOffset();
}

export function localDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
}

export function saveTextFile(text: string, filename: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob(["\ufeff" + text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
