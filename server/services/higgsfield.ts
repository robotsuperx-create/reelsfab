import { getIntegrationConfig } from "./integration-vault";

const BASE = "https://api.higgsfield.ai";

type SubmitResponse = { status: string; request_id: string; status_url?: string; cancel_url?: string };
export type HiggsfieldStatus = { status: string; request_id?: string; video?: { url?: string }; error?: unknown };

/** True when Higgsfield credentials are saved in the Integrations page. */
export async function higgsfieldConfigured() {
  const c = await getIntegrationConfig("higgsfield");
  return Boolean(c.credentials || (c.apiKey && c.apiSecret) || c.apiKey);
}

function authHeader(config: Record<string, string>) {
  const credentials = config.credentials || (config.apiKey && config.apiSecret ? `${config.apiKey}:${config.apiSecret}` : config.apiKey);
  if (!credentials) throw new Error("Higgsfield يحتاج apiKey و apiSecret أو credentials بصيغة key:secret");
  return { Authorization: `Key ${credentials}` };
}

export const DEFAULT_HIGGSFIELD_MODEL = "kling-video/v3.0/std/text-to-video";

/** Model ids look like "vendor/model/variant"; anything else (e.g. a display label) falls back to the default. */
export function higgsfieldEndpoint(model?: string | null) {
  const id = model?.trim() ?? "";
  if (/^https:\/\/api\.higgsfield\.ai\//.test(id)) return id;
  const clean = id.replace(/^\/+/, "");
  return `${BASE}/${/^[\w.-]+(\/[\w.-]+)+$/.test(clean) ? clean : DEFAULT_HIGGSFIELD_MODEL}`;
}

export async function submitHiggsfield(input: { model?: string | null; prompt: string; duration?: number; aspectRatio?: "9:16" | "16:9" | "1:1"; sound?: "on" | "off"; idempotencyKey: string }) {
  const config = await getIntegrationConfig("higgsfield");
  const response = await fetch(higgsfieldEndpoint(input.model), {
    method: "POST",
    headers: { ...authHeader(config), "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({ prompt: input.prompt.slice(0, 2500), duration: Math.min(15, Math.max(3, input.duration ?? 15)), aspect_ratio: input.aspectRatio ?? "9:16", sound: input.sound ?? "on" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Higgsfield ${response.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body as SubmitResponse;
}

export async function getHiggsfieldStatus(statusUrl: string): Promise<HiggsfieldStatus> {
  const config = await getIntegrationConfig("higgsfield");
  const response = await fetch(statusUrl, { headers: authHeader(config) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Higgsfield status ${response.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body as HiggsfieldStatus;
}

export async function cancelHiggsfield(cancelUrl: string) {
  const config = await getIntegrationConfig("higgsfield");
  const response = await fetch(cancelUrl, { method: "POST", headers: authHeader(config) });
  if (!response.ok) throw new Error(`Higgsfield cancel ${response.status}`);
  return true;
}
