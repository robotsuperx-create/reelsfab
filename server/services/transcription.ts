import { getIntegrationConfig } from "./integration-vault";

export type Transcription = { text: string; language?: string; duration?: number; segments: { start: number; end: number; text: string }[] };
export type TranscriptionError = { error: string; code: string; details?: string };

const MAX_BYTES = 25 * 1024 * 1024; // OpenAI limit

/** Speech-to-text via OpenAI Whisper directly (no intermediary). */
export async function transcribeAudio(opts: { audioUrl: string; language?: string; prompt?: string }): Promise<Transcription | TranscriptionError> {
  try {
    const key = (await getIntegrationConfig("openai")).apiKey;
    if (!key) return { error: "أضف مفتاح OpenAI من مركز التكاملات للتفريغ الصوتي", code: "SERVICE_ERROR", details: "openai" };
    const src = await fetch(opts.audioUrl);
    if (!src.ok) return { error: "تعذر تنزيل الملف", code: "INVALID_FORMAT", details: `HTTP ${src.status}` };
    const buf = Buffer.from(await src.arrayBuffer());
    if (buf.length > MAX_BYTES) return { error: "الملف أكبر من 25MB", code: "FILE_TOO_LARGE" };
    const type = src.headers.get("content-type") || "video/mp4";
    const ext = type.includes("webm") ? "webm" : type.includes("wav") ? "wav" : type.includes("mpeg") && type.startsWith("audio") ? "mp3" : "mp4";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type }), `clip.${ext}`);
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    if (opts.language) form.append("language", opts.language);
    if (opts.prompt) form.append("prompt", opts.prompt);
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    if (!res.ok) return { error: "فشل التفريغ", code: "TRANSCRIPTION_FAILED", details: `${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}` };
    const data = (await res.json()) as Transcription;
    if (typeof data.text !== "string") return { error: "رد تفريغ غير صالح", code: "SERVICE_ERROR" };
    return { ...data, segments: data.segments ?? [] };
  } catch (e) {
    return { error: "فشل التفريغ الصوتي", code: "SERVICE_ERROR", details: e instanceof Error ? e.message : String(e) };
  }
}
