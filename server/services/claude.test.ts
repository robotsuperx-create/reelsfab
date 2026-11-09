process.env.AI_RETRY_FAST = "1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_DEFAULT_MODEL, CLAUDE_REVIEW_MODEL } from "../../shared/domain";

vi.mock("./integration-vault", () => ({ getIntegrationConfig: async () => ({ apiKey: "anthropic-key" }) }));
const { invokeProvider } = await import("./ai-providers");
const { currentClaudeModel } = await import("../db");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type Seen = { body: any; headers: Record<string, string> };
function mockAnthropic(responses: (() => Response)[], seen: Seen[]) {
  let i = 0;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    seen.push({ body: JSON.parse(String(init?.body)), headers: (init?.headers ?? {}) as Record<string, string> });
    return responses[Math.min(i++, responses.length - 1)]();
  }) as unknown as typeof fetch;
}
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

describe("Claude provider", () => {
  it("asks for structured output via output_config.format (never a forced tool call) and returns the JSON text", async () => {
    const seen: Seen[] = [];
    mockAnthropic([() => json({ content: [{ type: "thinking", thinking: "…" }, { type: "text", text: '{"title":"حلقة","scenes":[{"narration":"مرحبا"}]}' }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 20 } })], seen);
    const schema = { type: "object", properties: { title: { type: "string", maxLength: 160 }, score: { type: "integer", minimum: 0, maximum: 100 }, scenes: { type: "array", minItems: 3, items: { type: "object", properties: { narration: { type: "string" } } } } }, required: ["title"] };
    const r = await invokeProvider({ provider: "anthropic", model: CLAUDE_DEFAULT_MODEL, prompt: "Write", jsonSchema: schema, maxTokens: 20_000 });
    expect(JSON.parse(r.text)).toEqual({ title: "حلقة", scenes: [{ narration: "مرحبا" }] });
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    const body = seen[0].body;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(20_000);
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.effort).toBe("medium"); // Sonnet 5.5 defaults to "high": JSON jobs do not need it
    expect(body.output_config.format.schema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: {
        title: { type: "string", description: "(maxLength: 160)" },
        score: { type: "integer", description: "(minimum: 0, maximum: 100)" },
        scenes: { type: "array", description: "(minItems: 3)", items: { type: "object", additionalProperties: false, properties: { narration: { type: "string" } } } },
      },
    });
    expect(body.messages[0].content[0].text).toBe("Write"); // no "return JSON" boilerplate when the format carries the schema
    expect(seen[0].headers["x-api-key"]).toBe("anthropic-key");
  });

  it("falls back to the schema in the prompt when the format is refused, and reports truncation", async () => {
    const seen: Seen[] = [];
    mockAnthropic([
      () => json({ type: "error", error: { type: "invalid_request_error", message: "output_config.format: not supported for this model" } }, 400),
      () => json({ content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn", usage: {} }),
    ], seen);
    const r = await invokeProvider({ provider: "anthropic", model: "claude-some-old-model", prompt: "Q", jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } } });
    expect(JSON.parse(r.text)).toEqual({ ok: true });
    expect(seen).toHaveLength(2);
    expect(seen[1].body.output_config).toBeUndefined();
    expect(seen[1].body.messages[0].content[0].text).toMatch(/JSON/);
    expect(seen[0].body.max_tokens).toBe(8000); // floor so thinking never starves a short JSON answer
    mockAnthropic([() => json({ content: [{ type: "text", text: '{"ti' }], stop_reason: "max_tokens", usage: {} })], []);
    await expect(invokeProvider({ provider: "anthropic", model: CLAUDE_DEFAULT_MODEL, prompt: "Q", jsonSchema: { type: "object", properties: {} } })).rejects.toThrow(/انقطع رد Claude/);
  });

  it("backs off on 529/429 and succeeds, but does not retry a 400", async () => {
    const seen: Seen[] = [];
    mockAnthropic([
      () => new Response("overloaded", { status: 529, headers: { "retry-after": "0" } }),
      () => new Response("rate", { status: 429, headers: { "retry-after": "0" } }),
      () => json({ content: [{ type: "text", text: "ok" }], usage: {} }),
    ], seen);
    const r = await invokeProvider({ provider: "anthropic", model: CLAUDE_DEFAULT_MODEL, prompt: "hi" });
    expect(r.text).toBe("ok");
    expect(seen).toHaveLength(3);
    const seen2: Seen[] = [];
    mockAnthropic([() => json({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, 400)], seen2);
    await expect(invokeProvider({ provider: "anthropic", model: CLAUDE_DEFAULT_MODEL, prompt: "hi" })).rejects.toThrow(/Anthropic 400/);
    expect(seen2).toHaveLength(1);
  });
});

describe("currentClaudeModel", () => {
  it("moves Gemini/Ollama choices and retired Claude IDs to the current generation, keeps explicit current ones", () => {
    expect(currentClaudeModel("gemini-3.8-flash", CLAUDE_DEFAULT_MODEL)).toBe("claude-sonnet-5-5");
    expect(currentClaudeModel("ollama:qwen2.5:7b", CLAUDE_DEFAULT_MODEL)).toBe("claude-sonnet-5-5");
    expect(currentClaudeModel("", CLAUDE_REVIEW_MODEL)).toBe("claude-haiku-5-5");
    expect(currentClaudeModel("claude-sonnet-4-6", CLAUDE_DEFAULT_MODEL)).toBe("claude-sonnet-5-5");
    expect(currentClaudeModel("anthropic:claude-haiku-4-5", CLAUDE_REVIEW_MODEL)).toBe("claude-haiku-5-5");
    expect(currentClaudeModel("claude-opus-5-5", CLAUDE_DEFAULT_MODEL)).toBe("claude-opus-5-5");
    expect(currentClaudeModel("gpt-5-mini", CLAUDE_DEFAULT_MODEL)).toBe("gpt-5-mini");
  });
});
