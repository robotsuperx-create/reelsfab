import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type TtsResult = { wavPath: string; durationSec: number };

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
export async function synthesize(opts: { text: string; voice: string; speed: number; outPath: string }): Promise<TtsResult> {
  const provider = process.env.TTS_PROVIDER ?? "kokoro";
  if (provider === "test") {
    const words = opts.text.split(/\s+/).filter(Boolean).length;
    const seconds = Math.max(1, words * 0.34);
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds.toFixed(2)}`, "-ar", "24000", opts.outPath]);
    return { wavPath: opts.outPath, durationSec: await probeDuration(opts.outPath) };
  }
  const tts = await loadKokoro().catch(error => {
    throw new Error(`Kokoro TTS unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });
  const audio = await tts.generate(opts.text, { voice: opts.voice, speed: Math.max(0.7, Math.min(1.3, opts.speed)) });
  await audio.save(opts.outPath);
  return { wavPath: opts.outPath, durationSec: await probeDuration(opts.outPath) };
}
