/**
 * Montage renderer: turns a MontageSpec (segments, transitions, narration, captions, music) into one
 * ffmpeg run. Everything is local and free — xfade transitions, Ken Burns on stills, sidechain ducking
 * of the music under the voice, ASS captions — the same engine the automatic reels use.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AI_DISCLOSURE } from "../../shared/domain";
import { CTA_TAIL_SECONDS, MAX_MONTAGE_SECONDS, montageTimeline, segmentDuration, type MontageSpec } from "../../shared/montage";
import { buildAss, wordTimings } from "./ass";
import { motionExpr } from "./renderer";
import { probeDuration, synthesize } from "./tts";

const run = promisify(execFile);
const FPS = 30;

export type MontageInputs = {
  /** ffmpeg input index per segment (same order as spec.segments). */
  segments: { index: number; hasAudio: boolean }[];
  /** Narration (TTS) input, when voice.source is "tts". */
  voice?: { index: number; durationSec: number };
  /** Music input (opened with -stream_loop -1), when a track is set. */
  music?: { index: number };
  /** ASS file name inside the working directory; omitted = no subtitle pass. */
  assFile?: string;
  /** Output length in seconds (visual total plus any CTA tail / narration padding). */
  total: number;
  preview?: boolean;
};

const f2 = (n: number) => n.toFixed(2);

/** Builds the filter_complex graph. Pure: unit-tested without ffmpeg. */
export function buildMontageGraph(spec: MontageSpec, inputs: MontageInputs) {
  const W = inputs.preview ? 540 : 1080;
  const H = inputs.preview ? 960 : 1920;
  const { starts, durations, transition, total: visualTotal } = montageTimeline(spec);
  const n = spec.segments.length;
  const parts: string[] = [];

  // --- video stems
  spec.segments.forEach((seg, i) => {
    const ii = inputs.segments[i].index;
    if (seg.kind === "video") {
      parts.push(
        `[${ii}:v]trim=start=${f2(seg.in)}:end=${f2(seg.out)},setpts=PTS-STARTPTS,fps=${FPS},` +
          `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p[v${i}]`,
      );
    } else {
      const frames = Math.round(seg.duration * FPS);
      const m = motionExpr(seg.motion, frames);
      parts.push(
        `[${ii}:v]scale=${W * 1.5}:${H * 1.5}:force_original_aspect_ratio=increase,crop=${W * 1.5}:${H * 1.5},` +
          `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`,
      );
    }
  });

  // --- join (xfade chain or plain concat)
  let last = "[v0]";
  if (n > 1) {
    if (transition > 0) {
      for (let k = 1; k < n; k++) {
        const out = `[x${k}]`;
        parts.push(`${last}[v${k}]xfade=transition=${spec.transition.type}:duration=${f2(transition)}:offset=${f2(starts[k])}${out}`);
        last = out;
      }
    } else {
      parts.push(`${spec.segments.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0[xc]`);
      last = "[xc]";
    }
  }
  const pad = Math.max(0, inputs.total - visualTotal);
  const tail: string[] = [];
  if (pad > 0.01) tail.push(`tpad=stop_mode=clone:stop_duration=${f2(pad)}`);
  if (inputs.assFile) tail.push(`ass=${inputs.assFile}`);
  parts.push(`${last}${tail.length ? tail.join(",") : "null"}[v]`);

  // --- narration stem: TTS voice or the segments' own audio
  const fmt = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo";
  let narration: string | null = null;
  if (spec.voice.source === "tts" && inputs.voice) {
    parts.push(`[${inputs.voice.index}:a]${fmt},apad=pad_dur=${f2(inputs.total)},atrim=0:${f2(inputs.total)}[nar]`);
    narration = "[nar]";
  } else if (spec.voice.source === "segments") {
    spec.segments.forEach((seg, i) => {
      const ii = inputs.segments[i].index;
      const d = durations[i];
      if (seg.kind === "video" && !seg.muted && inputs.segments[i].hasAudio) {
        parts.push(`[${ii}:a]atrim=start=${f2(seg.in)}:end=${f2(seg.out)},asetpts=PTS-STARTPTS,${fmt},apad=pad_dur=${f2(d)},atrim=0:${f2(d)}[a${i}]`);
      } else {
        parts.push(`aevalsrc=0:d=${f2(d)}:s=44100:c=stereo,${fmt}[a${i}]`);
      }
    });
    let lastA = "[a0]";
    if (n > 1) {
      if (transition > 0) {
        for (let k = 1; k < n; k++) {
          const out = `[ax${k}]`;
          parts.push(`${lastA}[a${k}]acrossfade=d=${f2(transition)}:c1=tri:c2=tri${out}`);
          lastA = out;
        }
      } else {
        parts.push(`${spec.segments.map((_, i) => `[a${i}]`).join("")}concat=n=${n}:v=0:a=1[axc]`);
        lastA = "[axc]";
      }
    }
    parts.push(`${lastA}apad=pad_dur=${f2(inputs.total)},atrim=0:${f2(inputs.total)}[nar]`);
    narration = "[nar]";
  }

  // --- music bed (looped input), ducked under the narration with a sidechain compressor
  let music: string | null = null;
  if (inputs.music) {
    const vol = Math.max(0, Math.min(1, spec.music.volume));
    const fadeAt = Math.max(0, inputs.total - 1.5);
    parts.push(`[${inputs.music.index}:a]${fmt},atrim=0:${f2(inputs.total)},volume=${vol.toFixed(3)},afade=t=out:st=${f2(fadeAt)}:d=1.5[mus0]`);
    music = "[mus0]";
    if (narration && spec.music.duck) {
      parts.push(`${narration}asplit=2[narA][narB]`);
      parts.push(`[mus0][narB]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=450:makeup=1[mus]`);
      narration = "[narA]";
      music = "[mus]";
    }
  }

  // --- mix
  if (narration && music) parts.push(`${narration}${music}amix=inputs=2:duration=longest:normalize=0,atrim=0:${f2(inputs.total)},loudnorm=I=-16:TP=-1.5:LRA=11[a]`);
  else if (narration) parts.push(`${narration}loudnorm=I=-16:TP=-1.5:LRA=11[a]`);
  else if (music) parts.push(`${music}loudnorm=I=-16:TP=-1.5:LRA=11[a]`);
  else parts.push(`aevalsrc=0:d=${f2(inputs.total)}:s=44100:c=stereo,${fmt}[a]`);

  return parts.join(";\n");
}

/** Output length: visuals, extended for the narration (+CTA card) or for the CTA tail after real clips. */
export function planMontageTotal(spec: MontageSpec, voiceSec: number | null, hasCta: boolean) {
  const { total: visualTotal } = montageTimeline(spec);
  const tail = hasCta ? CTA_TAIL_SECONDS : 0;
  const needed = spec.voice.source === "tts" && voiceSec !== null ? voiceSec + 0.4 + tail : visualTotal + tail;
  return Math.min(MAX_MONTAGE_SECONDS, Math.max(visualTotal, needed));
}

/** Caption words on the final timeline: narration words for TTS, or the clips' own transcripts offset by their start. */
export function montageWords(spec: MontageSpec, spokenText: string, voiceSec: number | null) {
  if (spec.captions.style === "none") return [];
  if (spec.voice.source === "tts") return voiceSec ? wordTimings(spokenText, 0.25, voiceSec) : [];
  if (spec.voice.source !== "segments") return [];
  const { starts } = montageTimeline(spec);
  const out: { word: string; start: number; end: number }[] = [];
  spec.segments.forEach((seg, i) => {
    if (seg.kind !== "video" || seg.muted || !seg.words?.length) return;
    for (const w of seg.words) {
      if (w.start < seg.in || w.start >= seg.out) continue;
      out.push({ word: w.word, start: starts[i] + (w.start - seg.in), end: starts[i] + Math.min(w.end, seg.out) - seg.in });
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

export type MontageRenderRequest = {
  spec: MontageSpec;
  /** Local file per segment (same order as spec.segments). */
  files: string[];
  musicFile: string | null;
  spokenText: string;
  hook: string | null;
  cta: string | null;
  voice: string;
  speed: number;
  font: string;
  colors: { primary: string; accent: string; text: string };
  preview?: boolean;
};

export type MontageRenderResult = {
  video: Buffer;
  thumbnail: Buffer;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasCaptions: boolean;
  fileSize: number;
};

async function hasAudioStream(path: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path]);
  return stdout.trim().length > 0;
}

export async function renderMontage(req: MontageRenderRequest): Promise<MontageRenderResult> {
  const dir = await mkdtemp(join(tmpdir(), "montage-"));
  try {
    // Trim points are clamped to the real clip length so the timeline math matches what ffmpeg can cut.
    const spec: MontageSpec = { ...req.spec, segments: req.spec.segments.map(s => ({ ...s })) };
    const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
    const segInputs: { index: number; hasAudio: boolean }[] = [];
    let index = 0;
    for (let i = 0; i < spec.segments.length; i++) {
      const seg = spec.segments[i];
      const file = req.files[i];
      if (seg.kind === "video") {
        const dur = await probeDuration(file);
        if (dur > 0 && seg.in >= dur - 0.2) throw new Error(`بداية المقطع "${seg.label ?? i + 1}" بعد نهاية الفيديو (${dur.toFixed(1)}s)`);
        if (dur > 0 && seg.out > dur) seg.out = Number(dur.toFixed(2));
        segInputs.push({ index, hasAudio: await hasAudioStream(file) });
        args.push("-i", file);
      } else {
        segInputs.push({ index, hasAudio: false });
        args.push("-i", file);
      }
      index++;
    }

    let voice: MontageInputs["voice"];
    let voiceSec: number | null = null;
    if (spec.voice.source === "tts") {
      if (!req.spokenText.trim()) throw new Error("لا يوجد نص للتعليق الصوتي");
      const wav = join(dir, "voice.wav");
      const tts = await synthesize({ text: req.spokenText, voice: req.voice, speed: req.speed, outPath: wav });
      voiceSec = tts.durationSec;
      if (voiceSec + 0.4 + (req.cta && spec.cta.show ? CTA_TAIL_SECONDS : 0) > MAX_MONTAGE_SECONDS) {
        throw new Error(`النص أطول من حد المونتاج (${voiceSec.toFixed(1)}s صوت) — اختصر النص`);
      }
      voice = { index, durationSec: voiceSec };
      args.push("-i", tts.wavPath);
      index++;
    }

    let music: MontageInputs["music"];
    if (req.musicFile && spec.music.volume > 0) {
      music = { index };
      args.push("-stream_loop", "-1", "-i", req.musicFile);
      index++;
    }

    const cta = spec.cta.show ? req.cta : null;
    const total = planMontageTotal(spec, voiceSec, !!cta);
    const words = montageWords(spec, req.spokenText, voiceSec);
    const assFile = "montage.ass";
    await writeFile(
      join(dir, assFile),
      buildAss({
        words,
        hook: spec.hook.show ? req.hook : null,
        cta,
        disclosure: AI_DISCLOSURE,
        durationSec: total,
        font: req.font,
        colors: req.colors,
        captionStyle: spec.captions.style,
        captionPosition: spec.captions.position,
        ctaSeconds: CTA_TAIL_SECONDS,
      }),
    );

    const graph = buildMontageGraph(spec, { segments: segInputs, voice, music, assFile, total, preview: req.preview });
    const out = join(dir, "montage.mp4");
    await run(
      "ffmpeg",
      [
        ...args,
        "-filter_complex", graph,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", req.preview ? "ultrafast" : "veryfast", "-crf", req.preview ? "30" : "23", "-r", String(FPS),
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        "-movflags", "+faststart", "-t", f2(total),
        out,
      ],
      { cwd: dir, maxBuffer: 32 * 1024 * 1024 },
    );
    const thumbPath = join(dir, "thumb.jpg");
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", f2(Math.min(1.2, total / 2)), "-i", out, "-frames:v", "1", "-q:v", "3", thumbPath]);
    const video = await readFile(out);
    return {
      video,
      thumbnail: await readFile(thumbPath),
      durationMs: Math.round((await probeDuration(out)) * 1000),
      width: req.preview ? 540 : 1080,
      height: req.preview ? 960 : 1920,
      hasAudio: true,
      hasCaptions: words.length > 0,
      fileSize: video.length,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Human summary for the render settings column. */
export function describeSpec(spec: MontageSpec) {
  const { total } = montageTimeline(spec);
  return {
    engine: "server-ffmpeg-montage",
    segments: spec.segments.length,
    clips: spec.segments.filter(s => s.kind === "video").length,
    stills: spec.segments.filter(s => s.kind === "image").length,
    transition: spec.transition.type,
    captions: spec.captions.style,
    voice: spec.voice.source,
    music: spec.music.assetId ? `asset ${spec.music.assetId} @ ${Math.round(spec.music.volume * 100)}%${spec.music.duck ? " ducked" : ""}` : "none",
    visualSeconds: Number(total.toFixed(2)),
    segmentSeconds: spec.segments.map(segmentDuration).map(d => Number(d.toFixed(2))),
  };
}
