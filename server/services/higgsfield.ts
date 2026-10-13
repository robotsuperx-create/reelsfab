import { getIntegrationConfig } from "./integration-vault";

const BASE = "https://api.higgsfield.ai";

type SubmitResponse = { status: string; request_id: string; status_url?: string; cancel_url?: string };
export type HiggsfieldStatus = { status: string; request_id?: string; video?: { url?: string }; error?: unknown };

function authHeader(config: Record<string, string>) {
  const credentials = config.credentials || (config.apiKey && config.apiSecret ? `${config.apiKey}:${config.apiSecret}` : config.apiKey);
  if (!credentials) throw new Error("Higgsfield يحتاج apiKey و apiSecret أو credentials بصيغة key:secret");
  return { Authorization: `Key ${credentials}` };
}

function endpoint(model?: string) {
  const id = model?.trim() || "kling-video/v3.0/std/text-to-video";
  return id.startsWith("http") ? id : `${BASE}/${id.replace(/^\/+/, "")}`;
}

export async function submitHiggsfield(input: { model?: string | null; prompt: string; duration?: number; aspectRatio?: "9:16" | "16:9" | "1:1"; sound?: "on" | "off"; idempotencyKey: string }) {
  const config = await getIntegrationConfig("higgsfield");
  const response = await fetch(endpoint(input.model ?? undefined), {
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
