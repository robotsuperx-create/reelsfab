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
  it("asks for structured output through a forced tool call and returns its input as JSON", async () => {
    const seen: Seen[] = [];
    mockAnthropic([() => json({ content: [{ type: "tool_use", id: "t1", name: "emit_result", input: { title: "حلقة", scenes: [{ narration: "مرحبا" }] } }], usage: { input_tokens: 10, output_tokens: 20 } })], seen);
    const r = await invokeProvider({ provider: "anthropic", model: CLAUDE_DEFAULT_MODEL, prompt: "Write", jsonSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] }, maxTokens: 20_000 });
    expect(JSON.parse(r.text)).toEqual({ title: "حلقة", scenes: [{ narration: "مرحبا" }] });
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    const body = seen[0].body;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(20_000);
    expect(body.tool_choice).toEqual({ type: "tool", name: "emit_result" });
    expect(body.tools[0].input_schema).toEqual({ type: "object", properties: { title: { type: "string" } }, required: ["title"] });
    expect(body.messages[0].content[0].text).toBe("Write"); // no "return JSON" boilerplate when the tool carries the schema
    expect(seen[0].headers["x-api-key"]).toBe("anthropic-key");
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
