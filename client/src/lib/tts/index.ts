import { useSyncExternalStore } from "react";

export type TtsStatus = { state: "idle" | "loading" | "ready" | "error"; progress: number; error?: string };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: { audio: Float32Array; sampleRate: number }) => void; reject: (e: Error) => void }>();
let status: TtsStatus = { state: "idle", progress: 0 };
const listeners = new Set<() => void>();

function setStatus(next: Partial<TtsStatus>) {
  status = { ...status, ...next };
  listeners.forEach(l => l());
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
  setStatus({ state: "loading", progress: 0, error: undefined });
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as {
      id?: number;
      type: string;
      audio?: Float32Array;
      sampleRate?: number;
      error?: string;
      progress?: number;
    };
    if (m.type === "progress") {
      setStatus({ state: "loading", progress: Math.max(status.progress, m.progress ?? 0) });
      return;
    }
    if (m.type === "ready") {
      setStatus({ state: "ready", progress: 100 });
      return;
    }
    if (m.type === "load_error") {
      setStatus({ state: "error", error: m.error });
      return;
    }
    if (m.id === undefined) return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === "error") p.reject(new Error(m.error ?? "TTS failed"));
    else p.resolve({ audio: m.audio ?? new Float32Array(0), sampleRate: m.sampleRate ?? 24000 });
  };
  worker.onerror = e => {
    setStatus({ state: "error", error: e.message });
  };
  return worker;
}

function call(type: "load" | "speak", payload: Record<string, unknown> = {}) {
  const w = getWorker();
  const id = ++seq;
  return new Promise<{ audio: Float32Array; sampleRate: number }>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, ...payload });
  });
}

export function preloadTts() {
  return call("load");
}

/** Synthesizes English speech with a Kokoro voice. speed: 1 = normal. */
export function speak(text: string, voice: string, speed = 1) {
  return call("speak", { text, voice, speed });
}

export function useTtsStatus() {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
  );
}
