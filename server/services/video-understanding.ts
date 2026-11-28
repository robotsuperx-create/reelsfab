/**
 * Understands an owner's video before the agent writes animation on top of it — the way an editor would:
 *   1. probe (length, size, fps, audio);
 *   2. speech → words with timings: Whisper on this computer (free, transformers.js, whisper-small timestamped)
 *      or OpenAI Whisper (the vault's key; better Arabic);
 *   3. scene cuts (ffmpeg scene score) and a frame every ~1–3 s;
 *   4. the agent looks at the frames (what is on screen, where the subject is, which areas are free for text);
 *   5. one "video map": second by second — what is said, which scene, what is seen, where text may go.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getIntegrationConfig } from "./integration-vault";

const run = promisify(execFile);

export type Word = { word: string; start: number; end: number };
export type FrameNote = { t: number; scene: number; what: string; subject?: string; subjectBox?: [number, number, number, number]; free: string[]; textOnScreen?: string; colors?: string };
export type VideoMap = {
  /** Word timings were put back on the voiced audio (local Whisper runs ahead of the speech). */
  aligned?: boolean;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  language?: string;
  words: Word[];
  sentences: { start: number; end: number; text: string }[];
  scenes: { index: number; start: number; end: number; summary: string }[];
  frames: FrameNote[];
  transcriber: "local" | "openai" | "none";
};

export type Transcriber = "local" | "openai";

export async function probeVideo(path: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", path]);
  const j = JSON.parse(stdout) as { streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string }[]; format: { duration?: string } };
  const v = j.streams.find(s => s.codec_type === "video");
  if (!v) throw new Error("الملف لا يحتوي فيديو");
  const [n, d] = (v.r_frame_rate ?? "30/1").split("/").map(Number);
  return { duration: Number(j.format.duration) || 0, width: v.width ?? 1080, height: v.height ?? 1920, fps: d ? Math.round((n / d) * 100) / 100 : 30, hasAudio: j.streams.some(s => s.codec_type === "audio") };
}

/** 16 kHz mono float samples, as Whisper wants them. */
async function pcm16k(path: string) {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 } as never);
  const buf = stdout as unknown as Buffer;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

type AsrPipe = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;
let asr: Promise<AsrPipe> | null = null;

/** Whisper on this computer (downloaded once to the transformers cache, ~250 MB). */
function localAsr() {
  if (!asr) {
    asr = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      if (process.env.WHISPER_CACHE_DIR) env.cacheDir = process.env.WHISPER_CACHE_DIR;
      const model = process.env.WHISPER_LOCAL_MODEL?.trim() || "onnx-community/whisper-small_timestamped";
      return (await pipeline("automatic-speech-recognition", model, { dtype: "q8", device: "cpu" } as never)) as unknown as AsrPipe;
    })().catch(e => {
      asr = null;
      throw e;
    });
  }
  return asr;
}

export async function transcribeLocal(path: string, language?: string): Promise<Word[]> {
  const audio = await pcm16k(path);
  if (!audio.length) return [];
  const pipe = await localAsr();
  const out = await pipe(audio, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5, ...(language ? { language, task: "transcribe" } : {}) });
  return (out.chunks ?? [])
    .map(c => ({ word: c.text.trim(), start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 0.3 }))
    .filter(w => w.word);
}

/**
 * Where the voice actually is: the non-silent stretches of the soundtrack (ffmpeg silencedetect). Used to put the
 * local Whisper words back on the voice — its word timestamps run ahead of the speech, sometimes by most of a second.
 */
export async function voicedIntervals(path: string, opts?: { noiseDb?: number; minSilence?: number }): Promise<{ start: number; end: number }[]> {
  const r = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", path, "-vn", "-af", `silencedetect=noise=${opts?.noiseDb ?? -32}dB:d=${opts?.minSilence ?? 0.12}`, "-f", "null", "-"], { maxBuffer: 16 * 1024 * 1024 }).catch(e => ({ stdout: "", stderr: String((e as { stderr?: string }).stderr ?? "") }));
  const text = r.stderr ?? "";
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
  const total = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  return voicedFromSilences(text, total);
}

/** Voiced stretches between the silences ffmpeg reported (pure, tested). */
export function voicedFromSilences(log: string, total: number) {
  const silences: { start: number; end: number }[] = [];
  let open: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) open = Math.max(0, Number(s[1]));
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e) { silences.push({ start: open ?? 0, end: Number(e[1]) }); open = null; }
  }
  if (open !== null) silences.push({ start: open, end: total });
  const out: { start: number; end: number }[] = [];
  let t = 0;
  for (const sil of silences.sort((a, b) => a.start - b.start)) {
    if (sil.start - t > 0.05) out.push({ start: +t.toFixed(3), end: +sil.start.toFixed(3) });
    t = Math.max(t, sil.end);
  }
  if (total - t > 0.05) out.push({ start: +t.toFixed(3), end: +total.toFixed(3) });
  return out;
}

/**
 * Re-times recognised words onto the voiced stretches, in order, each word taking time in proportion to its letters.
 * The words and their order come from Whisper; when they are said comes from the sound itself. Falls back to the
 * original timings when the voice cannot be told apart from the background (music under the speech).
 */
export function alignToVoice(words: Word[], voiced: { start: number; end: number }[]): Word[] {
  if (!words.length || !voiced.length) return words;
  const span = words[words.length - 1].end - words[0].start;
  // Only the stretches where Whisper heard something (± 1 s) — a long intro or outro without words stays empty.
  const near = voiced.filter(v => v.end > words[0].start - 1 && v.start < words[words.length - 1].end + 1);
  const total = near.reduce((a, v) => a + (v.end - v.start), 0);
  if (!near.length || total < 0.3 * span || total > 2.2 * span) return words;
  const weight = (w: string) => w.replace(/[\u064B-\u0652\u0670\u0640.,!?؟،:؛"«»()]/g, "").length + 1;
  const ws = words.map(w => weight(w.word));
  const rate = total / ws.reduce((a, b) => a + b, 0);
  let k = 0;
  let pos = near[0].start;
  const advance = (d: number) => {
    while (d > 1e-6 && k < near.length) {
      const room = near[k].end - pos;
      if (d <= room) { pos += d; return; }
      d -= room;
      k++;
      if (k < near.length) pos = near[k].start;
    }
  };
  return words.map((w, i) => {
    if (k < near.length && pos >= near[k].end - 1e-6 && k + 1 < near.length) { k++; pos = near[k].start; }
    const start = pos;
    advance(ws[i] * rate);
    return { word: w.word, start: +start.toFixed(3), end: +Math.max(start + 0.08, pos).toFixed(3) };
  });
}

/** OpenAI Whisper with word timestamps (vault provider "openai"). Audio is sent as a small mono MP3. */
export async function transcribeOpenAI(path: string, language?: string): Promise<Word[]> {
  const key = (await getIntegrationConfig("openai")).apiKey?.trim();
  if (!key) throw new Error("التفريغ عبر OpenAI يحتاج مفتاح OpenAI في مركز التكاملات — أو اختر التفريغ على هذا الجهاز (مجاني)");
  const dir = await mkdtemp(join(tmpdir(), "asr-"));
  try {
    const mp3 = join(dir, "a.mp3");
    await run("ffmpeg", ["-y", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", mp3]);
    const buf = await readFile(mp3);
    if (buf.length > 25 * 1024 * 1024) throw new Error("الصوت أطول من حد OpenAI (25MB ≈ ساعة) — استعمل التفريغ على هذا الجهاز");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type: "audio/mpeg" }), "a.mp3");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    if (language) form.append("language", language);
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    if (!res.ok) throw new Error(`OpenAI Whisper ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { words?: { word: string; start: number; end: number }[] };
    return (j.words ?? []).map(w => ({ word: w.word.trim(), start: w.start, end: w.end })).filter(w => w.word);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Groups words into sentences (punctuation, pauses ≥ 0.6 s, or 14 words). */
export function sentencesFrom(words: Word[]) {
  const out: { start: number; end: number; text: string }[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map(w => w.word).join(" ") });
    cur = [];
  };
  words.forEach((w, i) => {
    const next = words[i + 1];
    cur.push(w);
    if (/[.!?؟…]$/.test(w.word) || cur.length >= 14 || (next && next.start - w.end >= 0.6)) flush();
  });
  flush();
  return out;
}

/** Scene cut times (seconds) from ffmpeg's scene score. */
export async function detectScenes(path: string, threshold = 0.32) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", path, "-an", "-vf", `scale=320:-2,select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const cuts = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1])).filter(t => t > 0.4);
  return cuts.filter((t, i) => i === 0 || t - cuts[i - 1] > 0.5);
}

/** Times to look at: every scene's middle plus a regular grid (≤ 48 frames in all). */
export function frameTimes(duration: number, cuts: number[]) {
  const bounds = [0, ...cuts, duration];
  const mids = bounds.slice(0, -1).map((s, i) => (s + bounds[i + 1]) / 2);
  const step = Math.max(1, duration / 40);
  const grid: number[] = [];
  for (let t = Math.min(0.5, duration / 2); t < duration; t += step) grid.push(t);
  const all = [...mids, ...grid].map(t => Math.round(Math.min(duration - 0.05, Math.max(0, t)) * 10) / 10).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all) if (!out.length || t - out[out.length - 1] >= Math.min(0.8, step / 2)) out.push(t);
  return out.slice(0, 48);
}

export async function grabFrames(path: string, times: number[], width = 480) {
  const out: Buffer[] = [];
  for (const t of times) {
    const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", t.toFixed(2), "-i", path, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 } as never);
    out.push(stdout as unknown as Buffer);
  }
  return out;
}

export function sceneIndex(t: number, cuts: number[]) {
  let i = 0;
  while (i < cuts.length && cuts[i] <= t) i++;
  return i;
}

/** A compact text form of the map for prompts: one line per second with speech, scene and what is seen. */
export function mapForPrompt(map: VideoMap) {
  const lines: string[] = [];
  lines.push(`VIDEO ${map.width}x${map.height}, ${map.duration.toFixed(2)} s, ${map.fps} fps, speech: ${map.transcriber === "none" ? "none" : map.language ?? "detected"}`);
  lines.push("SCENES:");
  for (const s of map.scenes) lines.push(`- #${s.index} ${s.start.toFixed(2)}–${s.end.toFixed(2)} s: ${s.summary}`);
  lines.push("FRAMES (t s | what | subject box x,y,w,h in % of the frame | free areas for text):");
  for (const f of map.frames) lines.push(`- ${f.t.toFixed(1)} | ${f.what}${f.subject ? ` | ${f.subject} ${f.subjectBox ? f.subjectBox.map(n => Math.round(n)).join(",") : ""}` : ""} | free: ${f.free.join(", ") || "?"}${f.textOnScreen ? ` | text already on screen: ${f.textOnScreen}` : ""}`);
  if (map.words.length) {
    lines.push("SENTENCES (start–end s):");
    for (const s of map.sentences) lines.push(`- ${s.start.toFixed(2)}–${s.end.toFixed(2)}: ${s.text}`);
    lines.push("WORDS (JSON, use these timings exactly for captions):");
    lines.push(JSON.stringify(map.words.map(w => [w.word, +w.start.toFixed(2), +w.end.toFixed(2)])));
  }
  return lines.join("\n");
}
