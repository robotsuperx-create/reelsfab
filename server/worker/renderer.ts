import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AI_DISCLOSURE } from "../../shared/domain";
import { buildAss, wordTimings } from "./ass";
import { probeDuration, synthesize } from "./tts";

const run = promisify(execFile);
const FPS = 30;
const VOICE_MAX_SECONDS = 12.8;

export type RenderRequest = {
  image: Buffer;
  imageExt?: string;
  spokenText: string;
  hook: string | null;
  cta: string | null;
  voice: string;
  speed: number;
  font: string;
  colors: { primary: string; accent: string; text: string };
  /** One of the template motions from shared/domain TEMPLATES. */
  motion: string;
};

export type RenderResult = {
  video: Buffer;
  thumbnail: Buffer;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  fileSize: number;
};

/** zoompan expressions per template motion (frames = total output frames). */
export function motionExpr(motion: string, frames: number) {
  const t = `on/${frames}`;
  switch (motion) {
    case "slow_pull":
      return { z: `1.14-0.14*${t}`, x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" };
    case "pan_left":
      return { z: "1.12", x: `(iw-iw/zoom)*(1-${t})`, y: "ih/2-(ih/zoom/2)" };
    case "split_zoom":
    case "step_zoom":
      return { z: `1.0+0.16*(floor(${t}*3)/3)+0.02*${t}`, x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" };
    default:
      return { z: `1.0+0.14*${t}`, x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" };
  }
}

/** Layout of a finished reel: total length leaves room for the CTA tail. */
export function planDuration(voiceSec: number) {
  return Math.max(13.2, Math.min(15.4, voiceSec + 0.4 + 1.3));
}

export async function renderReel(req: RenderRequest): Promise<RenderResult> {
  const dir = await mkdtemp(join(tmpdir(), "reel-"));
  try {
    const imagePath = join(dir, `ref.${req.imageExt ?? "png"}`);
    await writeFile(imagePath, req.image);

    const rawWav = join(dir, "voice-raw.wav");
    let { wavPath, durationSec } = await synthesize({ text: req.spokenText, voice: req.voice, speed: req.speed, outPath: rawWav });

    // Keep the voice inside the reel: speed up (max 1.35x) when it runs long.
    if (durationSec > VOICE_MAX_SECONDS) {
      const tempo = Math.min(1.35, durationSec / VOICE_MAX_SECONDS);
      const fitted = join(dir, "voice.wav");
      await run("ffmpeg", ["-y", "-i", wavPath, "-filter:a", `atempo=${tempo.toFixed(3)}`, fitted]);
      wavPath = fitted;
      durationSec = await probeDuration(fitted);
    }

    const total = planDuration(durationSec);
    const frames = Math.round(total * FPS);
    const words = wordTimings(req.spokenText, 0.25, durationSec);
    const assPath = join(dir, "reel.ass");
    await writeFile(
      assPath,
      buildAss({
        words,
        hook: req.hook,
        cta: req.cta,
        disclosure: AI_DISCLOSURE,
        durationSec: total,
        font: req.font,
        colors: req.colors,
      }),
    );

    const m = motionExpr(req.motion, frames);
    const filter =
      `[0:v]scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,` +
      `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${frames}:s=1080x1920:fps=${FPS},` +
      `format=yuv420p,ass=reel.ass[v];` +
      `[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=${total.toFixed(2)},atrim=0:${total.toFixed(2)}[a]`;
    const out = join(dir, "reel.mp4");
    await run(
      "ffmpeg",
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", imagePath, "-i", wavPath,
        "-filter_complex", filter,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", String(FPS),
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        "-movflags", "+faststart", "-t", total.toFixed(2),
        out,
      ],
      { cwd: dir, maxBuffer: 16 * 1024 * 1024 },
    );

    const thumbPath = join(dir, "thumb.jpg");
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "1.2", "-i", out, "-frames:v", "1", "-q:v", "3", thumbPath]);

    const video = await readFile(out);
    return {
      video,
      thumbnail: await readFile(thumbPath),
      durationMs: Math.round((await probeDuration(out)) * 1000),
      width: 1080,
      height: 1920,
      hasAudio: true,
      fileSize: video.length,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
