import { getIntegrationConfig } from "../integration-vault";

export type ProviderName = "openai" | "anthropic" | "gemini";
export type ProviderRequest = { provider: ProviderName; model: string; system?: string; prompt: string; /** image URLs or data: URLs for vision checks */ images?: string[]; jsonSchema?: Record<string, unknown>; maxTokens?: number; timeoutMs?: number };
export type ProviderResult = { provider: ProviderName; model: string; text: string; usage?: { inputTokens?: number; outputTokens?: number } };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("AI provider timeout")), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
};
const jsonInstruction = (schema?: Record<string, unknown>) => schema ? `\nReturn ONLY valid JSON matching this schema:\n${JSON.stringify(schema)}` : "";
const request = async (url: string, init: RequestInit, timeoutMs: number) => withTimeout(fetch(url, init), timeoutMs);
const textFromOpenAI = (data: any) => data?.output_text ?? data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "";

async function callOpenAI(r: ProviderRequest): Promise<ProviderResult> {
  const config = await getIntegrationConfig("openai");
  const key = config.apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  const body: any = { model: r.model, input: [{ role: "user", content: [{ type: "input_text", text: `${r.system ? `SYSTEM:\n${r.system}\n\n` : ""}${r.prompt}${jsonInstruction(r.jsonSchema)}` }, ...(r.images ?? []).map(u => ({ type: "input_image", image_url: u }))] }], max_output_tokens: r.maxTokens ?? 1200 };
  const res = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }, r.timeoutMs ?? 45000);
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json(); return { provider: r.provider, model: r.model, text: textFromOpenAI(data), usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens } };
}

function anthropicImage(url: string) {
  const m = url.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  return m
    ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }
    : { type: "image", source: { type: "url", url } };
}

async function callAnthropic(r: ProviderRequest): Promise<ProviderResult> {
  const config = await getIntegrationConfig("anthropic");
  const key = config.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  const res = await request("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", ...((config.workspaceId || process.env.ANTHROPIC_WORKSPACE_ID) ? { "anthropic-workspace-id": config.workspaceId || process.env.ANTHROPIC_WORKSPACE_ID! } : {}) }, body: JSON.stringify({ model: r.model, max_tokens: r.maxTokens ?? 1200, system: r.system, messages: [{ role: "user", content: [...(r.images ?? []).map(anthropicImage), { type: "text", text: `${r.prompt}${jsonInstruction(r.jsonSchema)}` }] }] }) }, r.timeoutMs ?? 45000);
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json(); return { provider: r.provider, model: r.model, text: data.content?.map((x: any) => x.text ?? "").join("") ?? "", usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens } };
}

async function callGemini(r: ProviderRequest): Promise<ProviderResult> {
  const config = await getIntegrationConfig("gemini");
  const key = config.apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(r.model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: r.system ? { parts: [{ text: r.system }] } : undefined, contents: [{ role: "user", parts: [{ text: `${r.prompt}${jsonInstruction(r.jsonSchema)}` }] }], generationConfig: { maxOutputTokens: r.maxTokens ?? 1200, responseMimeType: r.jsonSchema ? "application/json" : "text/plain" } }) }, r.timeoutMs ?? 45000);
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json(); return { provider: r.provider, model: r.model, text: data.candidates?.[0]?.content?.parts?.map((x: any) => x.text ?? "").join("") ?? "", usage: { inputTokens: data.usageMetadata?.promptTokenCount, outputTokens: data.usageMetadata?.candidatesTokenCount } };
}

export async function invokeProvider(r: ProviderRequest): Promise<ProviderResult> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (r.provider === "openai") return await callOpenAI(r);
      if (r.provider === "anthropic") return await callAnthropic(r);
      if (r.provider === "gemini") return await callGemini(r);
      throw new Error(`Unknown AI provider: ${r.provider}`);
    } catch (e) { last = e; if (attempt === 0) await sleep(350); }
  }
  throw last instanceof Error ? last : new Error("AI provider request failed");
}

export function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned) as T; } catch { throw new Error("AI provider returned invalid JSON"); }
}

export async function providerConfigured(provider: ProviderName) {
  if (provider === "openai") return Boolean((await getIntegrationConfig("openai")).apiKey || process.env.OPENAI_API_KEY);
  if (provider === "anthropic") return Boolean((await getIntegrationConfig("anthropic")).apiKey || process.env.ANTHROPIC_API_KEY);
  if (provider === "gemini") return Boolean((await getIntegrationConfig("gemini")).apiKey || process.env.GEMINI_API_KEY);
  return false;
}
