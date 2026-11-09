import { getIntegrationConfig } from "../integration-vault";

export type ProviderName = "openai" | "anthropic" | "gemini" | "ollama";
export type ProviderRequest = { provider: ProviderName; model: string; system?: string; prompt: string; /** image URLs or data: URLs for vision checks */ images?: string[]; jsonSchema?: Record<string, unknown>; maxTokens?: number; timeoutMs?: number };
export type ProviderResult = { provider: ProviderName; model: string; text: string; usage?: { inputTokens?: number; outputTokens?: number } };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, process.env.AI_RETRY_FAST ? 1 : ms));
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
  const key = config.apiKey;
  if (!key) throw new Error("أضف مفتاح OpenAI من مركز التكاملات");
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

/** Anthropic retries on these: rate limit, overloaded, transient server errors. */
const ANTHROPIC_RETRY_STATUS = new Set([408, 409, 429, 500, 502, 503, 529]);
const ANTHROPIC_ATTEMPTS = 4;

/**
 * Claude Messages API. When a JSON schema is requested the answer comes back through structured outputs
 * (`output_config.format`, json_schema), so it is valid JSON of that shape by construction. Sonnet/Opus 5.5 reject
 * forced tool calls (`tool_choice` "tool"/"any"), which is why tools are not used for this. If a model or account
 * refuses the format, the call is repeated once with the schema written into the prompt instead.
 */
async function callAnthropic(r: ProviderRequest): Promise<ProviderResult> {
  const config = await getIntegrationConfig("anthropic");
  const key = config.apiKey;
  if (!key) throw new Error("أضف مفتاح Claude من مركز التكاملات");
  const headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(config.workspaceId ? { "anthropic-workspace-id": config.workspaceId } : {}) };
  const structured = Boolean(r.jsonSchema && typeof r.jsonSchema === "object");
  // Newer models may think before answering and thinking counts against max_tokens: keep a floor so short JSON
  // answers are never cut off (only the tokens actually used are billed).
  const maxTokens = Math.max(r.maxTokens ?? 1200, 4000);
  const timeoutMs = Math.max(r.timeoutMs ?? 45_000, Math.min(600_000, ((r.maxTokens ?? 1200) / 40) * 1000));
  const build = (useFormat: boolean) => ({
    model: r.model,
    max_tokens: maxTokens,
    system: r.system,
    messages: [{ role: "user", content: [...(r.images ?? []).map(anthropicImage), { type: "text", text: useFormat ? r.prompt : `${r.prompt}${jsonInstruction(r.jsonSchema)}` }] }],
    ...(useFormat ? { output_config: { format: { type: "json_schema", schema: anthropicJsonSchema(r.jsonSchema!) } } } : {}),
  });
  let useFormat = structured;
  let last: Error | null = null;
  for (let attempt = 0; attempt < ANTHROPIC_ATTEMPTS; attempt++) {
    const res = await request("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(build(useFormat)) }, timeoutMs);
    if (res.ok) {
      const data = await res.json();
      const blocks: any[] = Array.isArray(data.content) ? data.content : [];
      const text = blocks.filter(x => x?.type === "text").map(x => x.text ?? "").join("");
      if (data.stop_reason === "refusal") throw new Error("Claude رفض هذا الطلب (refusal) — أعد صياغة الموضوع");
      if (data.stop_reason === "max_tokens" && structured) throw new Error("انقطع رد Claude قبل اكتماله (max_tokens) — قصّر المدة أو أعد المحاولة");
      let out = text;
      if (useFormat && r.jsonSchema!.type !== "object") {
        try { out = JSON.stringify((JSON.parse(text) as { result?: unknown }).result); } catch { /* left for the caller's parser */ }
      }
      return { provider: r.provider, model: r.model, text: out, usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens } };
    }
    const detail = (await res.text()).slice(0, 400);
    last = new Error(`Anthropic ${res.status}: ${detail}`);
    if (res.status === 400 && useFormat && /output_config|json_schema|schema|format/i.test(detail)) {
      // The format itself was refused (model/account/schema feature): fall back to the schema in the prompt.
      console.warn(`[anthropic] structured output refused for ${r.model}, retrying with the schema in the prompt: ${detail.slice(0, 200)}`);
      useFormat = false;
      continue;
    }
    if (!ANTHROPIC_RETRY_STATUS.has(res.status) || attempt === ANTHROPIC_ATTEMPTS - 1) break;
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    await sleep(Math.min(60_000, Math.max(retryAfter * 1000, 2_000 * 2 ** attempt)));
  }
  throw last ?? new Error("Anthropic request failed");
}

/** JSON Schema keywords Claude's structured outputs do not accept; they are moved into the field description. */
const UNSUPPORTED_SCHEMA_KEYS = ["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "maxItems", "uniqueItems", "minProperties", "maxProperties", "format", "$schema", "default"];

/** Makes a schema acceptable to structured outputs: object root, additionalProperties:false everywhere, no unsupported limits. */
export function anthropicJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const root = schema.type === "object" ? schema : { type: "object", properties: { result: schema }, required: ["result"] };
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const notes: string[] = [];
    for (const [k, v] of Object.entries(src)) {
      if (UNSUPPORTED_SCHEMA_KEYS.includes(k)) {
        if (k !== "$schema" && k !== "default") notes.push(`${k}: ${JSON.stringify(v)}`);
        continue;
      }
      if (k === "minItems" && typeof v === "number" && v > 1) {
        notes.push(`minItems: ${v}`);
        continue;
      }
      out[k] = k === "properties" && v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, walk(pv)])) : walk(v);
    }
    if (out.type === "object" || out.properties) {
      out.properties ??= {};
      out.additionalProperties = false;
    }
    if (notes.length) out.description = [typeof out.description === "string" ? out.description : "", `(${notes.join(", ")})`].filter(Boolean).join(" ");
    return out;
  };
  return walk(root) as Record<string, unknown>;
}

async function callGemini(r: ProviderRequest): Promise<ProviderResult> {
  if (r.images?.length) throw new Error("الفحص البصري يحتاج Claude أو OpenAI؛ غيّر نموذج المراجعة في الإعدادات");
  const config = await getIntegrationConfig("gemini");
  const key = config.apiKey;
  if (!key) throw new Error("أضف مفتاح Gemini من مركز التكاملات");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(r.model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: r.system ? { parts: [{ text: r.system }] } : undefined, contents: [{ role: "user", parts: [{ text: `${r.prompt}${jsonInstruction(r.jsonSchema)}` }] }], generationConfig: { maxOutputTokens: r.maxTokens ?? 1200, responseMimeType: r.jsonSchema ? "application/json" : "text/plain" } }) }, r.timeoutMs ?? 45000);
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json(); return { provider: r.provider, model: r.model, text: data.candidates?.[0]?.content?.parts?.map((x: any) => x.text ?? "").join("") ?? "", usage: { inputTokens: data.usageMetadata?.promptTokenCount, outputTokens: data.usageMetadata?.candidatesTokenCount } };
}

/** Local, free models through Ollama (http://127.0.0.1:11434 by default); JSON mode when a schema is requested. */
async function callOllama(r: ProviderRequest): Promise<ProviderResult> {
  if (r.images?.length) throw new Error("الفحص البصري يحتاج Claude أو OpenAI؛ Ollama هنا للنصوص فقط");
  const config = await getIntegrationConfig("ollama");
  const base = (config.baseUrl?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const model = r.model && r.model !== "default" ? r.model : config.model?.trim();
  if (!model) throw new Error("حدّد اسم نموذج Ollama في مركز التكاملات (مثال: qwen2.5:7b)");
  const messages = [...(r.system ? [{ role: "system", content: r.system }] : []), { role: "user", content: `${r.prompt}${jsonInstruction(r.jsonSchema)}` }];
  const res = await request(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, ...(r.jsonSchema ? { format: "json" } : {}), options: { num_predict: r.maxTokens ?? 1200, temperature: 0.7 } }),
  }, r.timeoutMs ?? 300_000);
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { provider: r.provider, model, text: data?.message?.content ?? "", usage: { inputTokens: data?.prompt_eval_count, outputTokens: data?.eval_count } };
}

export async function invokeProvider(r: ProviderRequest): Promise<ProviderResult> {
  if (r.provider === "anthropic") return callAnthropic(r); // has its own backoff; a second blind retry would double a minutes-long request
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (r.provider === "openai") return await callOpenAI(r);
      if (r.provider === "gemini") return await callGemini(r);
      if (r.provider === "ollama") return await callOllama(r);
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
  if (provider === "openai") return Boolean((await getIntegrationConfig("openai")).apiKey);
  if (provider === "anthropic") return Boolean((await getIntegrationConfig("anthropic")).apiKey);
  if (provider === "gemini") return Boolean((await getIntegrationConfig("gemini")).apiKey);
  if (provider === "ollama") return Boolean((await getIntegrationConfig("ollama")).model);
  return false;
}
