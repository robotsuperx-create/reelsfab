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
 * Claude Messages API. When a JSON schema is requested the answer comes through a forced tool call, so the
 * output is parsed JSON by construction (no fences, no prose) and long scripts never break mid-string.
 */
async function callAnthropic(r: ProviderRequest): Promise<ProviderResult> {
  const config = await getIntegrationConfig("anthropic");
  const key = config.apiKey;
  if (!key) throw new Error("أضف مفتاح Claude من مركز التكاملات");
  const headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(config.workspaceId ? { "anthropic-workspace-id": config.workspaceId } : {}) };
  const useTool = Boolean(r.jsonSchema && typeof r.jsonSchema === "object");
  const body: Record<string, unknown> = {
    model: r.model,
    max_tokens: r.maxTokens ?? 1200,
    system: r.system,
    messages: [{ role: "user", content: [...(r.images ?? []).map(anthropicImage), { type: "text", text: useTool ? r.prompt : `${r.prompt}${jsonInstruction(r.jsonSchema)}` }] }],
  };
  if (useTool) {
    body.tools = [{ name: "emit_result", description: "Return the finished result exactly in the requested structure.", input_schema: anthropicInputSchema(r.jsonSchema!) }];
    body.tool_choice = { type: "tool", name: "emit_result" };
  }
  // Long outputs (episode scripts) take minutes; the budget scales with the requested tokens.
  const timeoutMs = Math.max(r.timeoutMs ?? 45_000, Math.min(600_000, ((r.maxTokens ?? 1200) / 40) * 1000));
  let last: Error | null = null;
  for (let attempt = 0; attempt < ANTHROPIC_ATTEMPTS; attempt++) {
    const res = await request("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
    if (res.ok) {
      const data = await res.json();
      const blocks: any[] = Array.isArray(data.content) ? data.content : [];
      const tool = blocks.find(x => x?.type === "tool_use" && x.input && typeof x.input === "object");
      const wrapped = useTool && r.jsonSchema!.type !== "object";
      const text = tool ? JSON.stringify(wrapped ? tool.input.result : tool.input) : blocks.map(x => x?.text ?? "").join("");
      if (useTool && !tool && !text.trim()) throw new Error("Claude لم يُرجع النتيجة المطلوبة (لا tool_use)");
      return { provider: r.provider, model: r.model, text, usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens } };
    }
    const detail = (await res.text()).slice(0, 300);
    last = new Error(`Anthropic ${res.status}: ${detail}`);
    if (!ANTHROPIC_RETRY_STATUS.has(res.status) || attempt === ANTHROPIC_ATTEMPTS - 1) break;
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    await sleep(Math.min(60_000, Math.max(retryAfter * 1000, 2_000 * 2 ** attempt)));
  }
  throw last ?? new Error("Anthropic request failed");
}

/** Claude's tool schemas must be plain JSON Schema objects of type object. */
function anthropicInputSchema(schema: Record<string, unknown>) {
  const s = { ...schema } as Record<string, unknown>;
  if (s.type !== "object") return { type: "object", properties: { result: s }, required: ["result"] };
  delete s.$schema;
  return s;
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
