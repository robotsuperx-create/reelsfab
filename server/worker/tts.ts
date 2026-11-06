import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { getIntegrationConfig } from "../services/integration-vault";

const run = promisify(execFile);

export type TtsResult = { wavPath: string; durationSec: number };
export type TtsProvider = "kokoro" | "gemini";

const GEMINI_TTS_MODELS = ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** PCM 16-bit little-endian → WAV container (no re-encoding). */
export function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Gemini TTS (free tier covers it): returns 24 kHz mono PCM wrapped as WAV. Retries on 429 with backoff
 * because the free tier is rate-limited per minute — an episode of 30 scenes is synthesized one scene at a time.
 */
export async function geminiSpeech(text: string, voice: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const cfg = await getIntegrationConfig("gemini");
  const key = cfg.apiKey?.trim();
  if (!key) throw new Error("أضف مفتاح Gemini من مركز التكاملات (التعليق الصوتي العربي يستخدم Gemini TTS)");
  const preferred = (cfg.ttsModel?.trim() || "").replace(/[^a-zA-Z0-9.\-_]/g, "");
  const models = [...new Set([preferred, ...GEMINI_TTS_MODELS].filter(Boolean))];
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || "Charon" } } } },
  };
  let last = "";
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
      if (res.status === 429 || res.status === 503) {
        last = `Gemini TTS ${res.status}`;
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        await sleep(Math.max(retryAfter * 1000, 8000 * (attempt + 1)));
        continue;
      }
      if (res.status === 404) {
        last = `Gemini TTS: النموذج ${model} غير متاح`;
        break; // try the next known model id
      }
      if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
      const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
      if (!part?.inlineData?.data) throw new Error("Gemini TTS لم يُرجع صوتًا — جرّب صوتًا آخر أو نصًا أقصر");
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1]) || 24000;
      const pcm = Buffer.from(part.inlineData.data, "base64");
      return /audio\/(wav|x-wav)/.test(part.inlineData.mimeType ?? "") ? pcm : pcmToWav(pcm, rate, 1);
    }
  }
  throw new Error(`${last || "Gemini TTS"}: تجاوزت حد الطلبات المجانية أو النموذج غير متاح — انتظر دقيقة أو غيّر نموذج TTS في مركز التكاملات`);
}

export async function probeDuration(path: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
  return Number.parseFloat(stdout.trim()) || 0;
}

type KokoroLike = { generate: (text: string, o: { voice: string; speed: number }) => Promise<{ save: (p: string) => Promise<void> | void }> };
let kokoro: Promise<KokoroLike> | null = null;

async function loadKokoro() {
  if (!kokoro) {
    kokoro = (async () => {
      const moduleName = "kokoro-js";
      const mod = (await import(/* @vite-ignore */ moduleName)) as {
        KokoroTTS: { from_pretrained: (id: string, o: Record<string, unknown>) => Promise<KokoroLike> };
      };
      return mod.KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
    })().catch(error => {
      kokoro = null;
      throw error;
    });
  }
  return kokoro;
}

/**
 * Free local text-to-speech. TTS_PROVIDER=kokoro (default) runs Kokoro-82M on CPU;
 * TTS_PROVIDER=test produces a tone sized to the text, for CI and smoke tests only.
 */
export async function synthesize(opts: { text: string; voice: string; speed: number; outPath: string; provider?: TtsProvider }): Promise<TtsResult> {
  const provider = process.env.TTS_PROVIDER ?? "kokoro";
  if (provider === "test") {
    const words = opts.text.split(/\s+/).filter(Boolean).length;
    const seconds = Math.max(1, words * 0.34);
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds.toFixed(2)}`, "-ar", "24000", opts.outPath]);
    return { wavPath: opts.outPath, durationSec: await probeDuration(opts.outPath) };
  }
  if (opts.provider === "gemini") {
    const wav = await geminiSpeech(opts.text, opts.voice);
    const speed = Math.max(0.8, Math.min(1.2, opts.speed));
    if (Math.abs(speed - 1) < 0.02) {
      await writeFile(opts.outPath, wav);
    } else {
      const raw = `${opts.outPath}.raw.wav`;
      await writeFile(raw, wav);
      await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", raw, "-filter:a", `atempo=${speed.toFixed(3)}`, opts.outPath]);
      await rm(raw, { force: true });
    }
    return { wavPath: opts.outPath, durationSec: await probeDuration(opts.outPath) };
  }
  const tts = await loadKokoro().catch(error => {
    throw new Error(`Kokoro TTS unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });
  const audio = await tts.generate(opts.text, { voice: opts.voice, speed: Math.max(0.7, Math.min(1.3, opts.speed)) });
  await audio.save(opts.outPath);
  return { wavPath: opts.outPath, durationSec: await probeDuration(opts.outPath) };
}
