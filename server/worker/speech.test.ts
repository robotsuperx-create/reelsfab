process.env.AI_RETRY_FAST = "1";
import { describe, expect, it, vi } from "vitest";

const vault: Record<string, Record<string, string>> = {
  speech: {},
  openai: { apiKey: "openai-key" },
};
vi.mock("../services/integration-vault", () => ({ getIntegrationConfig: async (p: string) => vault[p] ?? {} }));
const { openAiCompatibleSpeech } = await import("./tts");

type Call = { url: string; body: any; headers: Record<string, string> };
function fakeFetch(statuses: number[], calls: Call[]) {
  let i = 0;
  return (async (url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ url, body: JSON.parse(String(init?.body)), headers });
    const status = statuses[Math.min(i++, statuses.length - 1)];
    if (status !== 200) return new Response("busy", { status, headers: { "retry-after": "0" } });
    return new Response(new Uint8Array(Buffer.alloc(4096, 1)), { status: 200, headers: { "content-type": "audio/wav" } });
  }) as unknown as typeof fetch;
}

describe("openAiCompatibleSpeech", () => {
  it("talks to OpenAI with the OpenAI key when the speech provider has none, and retries a 429", async () => {
    vault.speech = { instructions: "نبرة وثائقية هادئة" };
    const calls: Call[] = [];
    const r = await openAiCompatibleSpeech("نص الحلقة", "onyx", fakeFetch([429, 200], calls));
    expect(r.openai).toBe(true);
    expect(r.audio.length).toBe(4096);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.openai.com/v1/audio/speech");
    expect(calls[0].headers.Authorization).toBe("Bearer openai-key");
    expect(calls[0].body).toMatchObject({ model: "gpt-4o-mini-tts", input: "نص الحلقة", voice: "onyx", response_format: "wav", instructions: "نبرة وثائقية هادئة" });
  });

  it("sends a self-hosted clone server its own model, voice and extra fields, without OpenAI-only instructions", async () => {
    vault.speech = { baseUrl: "http://127.0.0.1:8000/v1/", model: "audio8-tts", format: "wav", instructions: "ignored", extraJson: '{"language":"ar","ref_audio":"https://x/ref.wav"}' };
    const calls: Call[] = [];
    const r = await openAiCompatibleSpeech("مرحبا", "my-voice", fakeFetch([200], calls));
    expect(r.openai).toBe(false);
    expect(calls[0].url).toBe("http://127.0.0.1:8000/v1/audio/speech");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].body).toEqual({ model: "audio8-tts", input: "مرحبا", voice: "my-voice", response_format: "wav", language: "ar", ref_audio: "https://x/ref.wav" });
  });

  it("refuses OpenAI without any key and rejects broken extraJson", async () => {
    vault.openai = {};
    vault.speech = {};
    await expect(openAiCompatibleSpeech("x", "onyx", fakeFetch([200], []))).rejects.toThrow(/مفتاح OpenAI/);
    vault.speech = { baseUrl: "http://127.0.0.1:8000/v1", extraJson: "{oops" };
    await expect(openAiCompatibleSpeech("x", "v", fakeFetch([200], []))).rejects.toThrow(/extraJson/);
    vault.openai = { apiKey: "openai-key" };
  });

  it("gives up after repeated server errors with a readable message", async () => {
    vault.speech = { baseUrl: "http://127.0.0.1:8000/v1" };
    await expect(openAiCompatibleSpeech("x", "v", fakeFetch([503, 503, 503, 503], []))).rejects.toThrow(/مشغول/);
  });
});
