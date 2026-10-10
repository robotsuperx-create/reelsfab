import { registerAacEncoder } from "@mediabunny/aac-encoder";
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Input,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import { uploadBlob } from "../api";
import { drawFrame, ensureFonts, makeFrameCache, type BgSource } from "./draw";
import type { PreparedReel } from "./prepare";

let aacReady: Promise<void> | null = null;
async function ensureEncoders(width: number, height: number) {
  const okVideo = await canEncodeVideo("avc", { width, height, bitrate: 6_000_000 });
  if (!okVideo) {
    throw new Error("المتصفح لا يدعم ترميز H.264 — استخدم Google Chrome أو Microsoft Edge على الكمبيوتر");
  }
  if (!aacReady) {
    aacReady = (async () => {
      if (!(await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48000 }))) registerAacEncoder();
    })();
  }
  await aacReady;
}

export type ExportResult = {
  blob: Blob;
  thumbnail: Blob;
  meta: { durationMs: number; width: number; height: number; hasAudio: boolean; fileSize: number };
};

export async function exportReel(prepared: PreparedReel, onProgress?: (p: number) => void): Promise<ExportResult> {
  const { spec } = prepared;
  await ensureEncoders(spec.width, spec.height);
  await ensureFonts(spec.look.font);
  const canvas = new OffscreenCanvas(spec.width, spec.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D غير متاح");
  const cache = makeFrameCache(spec);

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: 6_000_000, keyFrameInterval: 2 });
  const audioSource = new AudioBufferSource({ codec: "aac", bitrate: 160_000 });
  output.addVideoTrack(videoSource, { frameRate: spec.fps });
  output.addAudioTrack(audioSource);
  await output.start();
  await audioSource.add(prepared.audio);
  audioSource.close();

  const frames = Math.round(spec.duration * spec.fps);
  const thumbFrame = Math.min(frames - 1, Math.round(1.3 * spec.fps));
  let thumbnail: Blob | null = null;

  let iterator: AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null> | null = null;
  let sourceInput: Input | null = null;
  if (spec.bg.kind === "video" && prepared.videoBlob) {
    sourceInput = new Input({ source: new BlobSource(prepared.videoBlob), formats: ALL_FORMATS });
    const track = await sourceInput.getPrimaryVideoTrack();
    if (!track) throw new Error("ملف Premium لا يحتوي مسار فيديو");
    const sink = new CanvasSink(track, { width: spec.width, height: spec.height, fit: "cover", poolSize: 3 });
    const vd = spec.bg.videoDuration;
    const stamps = Array.from({ length: frames }, (_, i) => Math.min(i / spec.fps, Math.max(0, vd - 0.05)));
    iterator = sink.canvasesAtTimestamps(stamps);
  }

  let lastVideo: BgSource | null = null;
  for (let i = 0; i < frames; i++) {
    const t = i / spec.fps;
    let video: BgSource | null = null;
    if (iterator) {
      const r = await iterator.next();
      if (r.value) {
        video = { source: r.value.canvas, w: r.value.canvas.width, h: r.value.canvas.height };
        lastVideo = video;
      } else video = lastVideo;
    }
    drawFrame(ctx, spec, t, cache, prepared.images, video);
    await videoSource.add(t, 1 / spec.fps);
    if (i === thumbFrame) thumbnail = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    if (i % 6 === 0) onProgress?.(i / frames);
  }
  videoSource.close();
  await output.finalize();
  onProgress?.(1);
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("فشل إنهاء ملف MP4");
  const blob = new Blob([buffer], { type: "video/mp4" });
  if (!thumbnail) thumbnail = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });

  // Read back the encoded file so QC uses real measurements, not intentions.
  const check = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const durationSec = await check.computeDuration();
  const vt = await check.getPrimaryVideoTrack();
  const at = await check.getPrimaryAudioTrack();
  return {
    blob,
    thumbnail,
    meta: {
      durationMs: Math.round(durationSec * 1000),
      width: vt?.displayWidth ?? 0,
      height: vt?.displayHeight ?? 0,
      hasAudio: Boolean(at),
      fileSize: blob.size,
    },
  };
}

export type RenderCreatePayload = {
  scriptId: number;
  kind: "economic" | "derivative" | "premium";
  variantLabel: string | null;
  videoUrl: string;
  storageKey: string;
  thumbnailUrl: string;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasCaptions: boolean;
  hasDisclosure: boolean;
  fileSize: number;
  settings: Record<string, unknown>;
};

/** Uploads the MP4 + thumbnail and returns the payload for `renders.create`. */
export async function uploadRender(prepared: PreparedReel, result: ExportResult, slug: string): Promise<RenderCreatePayload> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${slug}-${prepared.scriptId}-${prepared.kind}-${stamp}`;
  const video = await uploadBlob(result.blob, {
    kind: "render",
    filename: `${base}.mp4`,
    characterId: prepared.characterId,
    title: `${slug} #${prepared.scriptId} ${prepared.variantLabel ?? prepared.kind}`,
    durationMs: result.meta.durationMs,
    width: result.meta.width,
    height: result.meta.height,
  });
  const thumb = await uploadBlob(result.thumbnail, {
    kind: "thumbnail",
    filename: `${base}.jpg`,
    characterId: prepared.characterId,
  });
  return {
    scriptId: prepared.scriptId,
    kind: prepared.kind,
    variantLabel: prepared.variantLabel,
    videoUrl: video.url,
    storageKey: video.key,
    thumbnailUrl: thumb.url,
    durationMs: result.meta.durationMs,
    width: result.meta.width,
    height: result.meta.height,
    hasAudio: result.meta.hasAudio,
    hasCaptions: prepared.spec.words.length > 0,
    hasDisclosure: Boolean(prepared.spec.disclosure),
    fileSize: result.meta.fileSize,
    settings: prepared.settingsUsed,
  };
}
