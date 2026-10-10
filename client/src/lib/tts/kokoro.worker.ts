/// <reference lib="webworker" />
// Kokoro-82M text-to-speech running fully in the browser (free). Loaded from CDN on first use.
const KOKORO_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

type KokoroInstance = {
  generate: (
    text: string,
    opts: { voice: string; speed?: number },
  ) => Promise<{ audio: Float32Array; sampling_rate: number }>;
};

let ttsPromise: Promise<KokoroInstance> | null = null;

function load(): Promise<KokoroInstance> {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const mod = (await import(/* @vite-ignore */ KOKORO_URL)) as {
        KokoroTTS: { from_pretrained: (id: string, opts: Record<string, unknown>) => Promise<KokoroInstance> };
      };
      return mod.KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
          if (p.status === "progress" && typeof p.progress === "number") {
            postMessage({ type: "progress", progress: p.progress, file: p.file });
          }
        },
      });
    })();
    ttsPromise.then(
      () => postMessage({ type: "ready" }),
      e => {
        ttsPromise = null;
        postMessage({ type: "load_error", error: String(e) });
      },
    );
  }
  return ttsPromise;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { id: number; type: "load" | "speak"; text?: string; voice?: string; speed?: number };
  try {
    const tts = await load();
    if (msg.type === "load") {
      postMessage({ id: msg.id, type: "result", audio: new Float32Array(0), sampleRate: 24000 });
      return;
    }
    const out = await tts.generate(msg.text ?? "", { voice: msg.voice ?? "af_heart", speed: msg.speed ?? 1 });
    const audio = out.audio;
    postMessage({ id: msg.id, type: "result", audio, sampleRate: out.sampling_rate }, [audio.buffer]);
  } catch (err) {
    postMessage({ id: msg.id, type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
