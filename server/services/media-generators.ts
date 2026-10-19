import { getIntegrationConfig } from "./integration-vault";
import { storagePut } from "../storage";

export async function generateElevenLabsSpeech(input: { text: string; voiceId: string; modelId?: string }) {
  const config = await getIntegrationConfig("elevenlabs");
  const key = config.apiKey || config.apiToken;
  if (!key) throw new Error("ElevenLabs apiKey is not configured");
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`, { method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" }, body: JSON.stringify({ text: input.text, model_id: input.modelId ?? "eleven_multilingual_v2", output_format: "mp3_44100_128", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) });
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const stored = await storagePut(`voice/elevenlabs/${input.voiceId}.mp3`, Buffer.from(await response.arrayBuffer()), "audio/mpeg");
  return stored;
}

export async function generateImage(input: { provider: "openai" | "gemini"; prompt: string; size?: string }) {
  if (input.provider === "openai") {
    const config = await getIntegrationConfig("openai"); const key = config.apiKey;
    if (!key) throw new Error("OpenAI apiKey is not configured");
    const response = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-image-1", prompt: input.prompt.slice(0, 4000), size: input.size ?? "1024x1536", quality: "medium", output_format: "png" }) });
    const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`OpenAI Images ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
    const item = body?.data?.[0]; if (item?.b64_json) return storagePut("images/generated.png", Buffer.from(item.b64_json, "base64"), "image/png");
    if (item?.url) { const file = await fetch(item.url); return storagePut("images/generated.png", Buffer.from(await file.arrayBuffer()), "image/png"); }
    throw new Error("OpenAI returned no image");
  }
  const config = await getIntegrationConfig("gemini"); const key = config.apiKey;
  if (!key) throw new Error("Gemini apiKey is not configured");
  const model = config.imageModel || "gemini-2.5-flash-image";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: input.prompt }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }) });
  const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`Gemini Image ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const part = body?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data); if (!part) throw new Error("Gemini returned no image");
  return storagePut("images/generated.png", Buffer.from(part.inlineData.data, "base64"), part.inlineData.mimeType ?? "image/png");
}
