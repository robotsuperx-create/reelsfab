/**
 * Long-form episode renderer (1920×1080, free, local): every scene becomes its own clip (stock video trimmed
 * and padded to the narration, or a still with Ken Burns), the clips are joined without re-encoding, then one
 * pass burns the captions / lower-thirds / intro / outro and mixes narration with a ducked music bed.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { EPISODE_INTRO_SECONDS, EPISODE_OUTRO_SECONDS, SCENE_GAP, episodeTimeline, type EpisodeLanguage, type Scene } from "../../shared/episodes";
import { assColor, assEscape, assTime, chunkWords } from "./ass";
import { motionExpr } from "./renderer";
import { probeDuration } from "./tts";

const run = promisify(execFile);
export const EP_W = 1920;
export const EP_H = 1080;
const FPS = 30;
const f2 = (n: number) => n.toFixed(2);
/** Bundled OFL fonts (IBM Plex Sans Arabic) so Arabic captions render the same on every machine. */
export const FONTS_DIR = resolve(process.cwd(), "assets", "fonts");

export type EpisodeAssInput = {
  language: EpisodeLanguage;
  /** Caption words on the final timeline (seconds). */
  words: { word: string; start: number; end: number }[];
  /** Scene starts/durations on the final timeline, with the on-screen title shown for the first seconds. */
  scenes: { start: number; duration: number; title?: string }[];
  chapters: { time: number; name: string }[];
  intro: { title: string; channel: string; seconds: number };
  outro: { text: string; seconds: number };
  total: number;
  font: string;
  colors: { primary: string; accent: string; text: string };
  disclosure: string;
};

/** Subtitle/graphics track for a 16:9 episode. Arabic uses phrase captions (inline colour tags break RTL runs in libass). */
export function buildEpisodeAss(input: EpisodeAssInput) {
  const rtl = input.language === "ar";
  const accent = assColor(input.colors.accent, "#DFFF00");
  const text = assColor(input.colors.text, "#FFFFFF");
  const primary = assColor(input.colors.primary, "#000000");
  const font = assEscape(input.font) || "IBM Plex Sans Arabic";
  const titleAlign = rtl ? 3 : 1; // lower-third sits on the reading side
  const chapterAlign = rtl ? 9 : 7; // chapter card at the top of the reading side
  const badgeAlign = rtl ? 7 : 9; // opposite top corner
  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${EP_W}`,
    `PlayResY: ${EP_H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,${font},56,${text},${text},&H00000000&,&H64000000&,-1,0,0,0,100,100,0,0,1,3,1,2,160,160,70,1`,
    `Style: Title,${font},40,${text},${text},${primary},${primary},-1,0,0,0,100,100,0,0,3,14,0,${titleAlign},90,90,170,1`,
    `Style: Chapter,${font},34,${primary},${primary},${accent},${accent},-1,0,0,0,100,100,0,0,3,12,0,${chapterAlign},90,90,90,1`,
    `Style: Intro,${font},84,${text},${text},&H00000000&,&H96000000&,-1,0,0,0,100,100,0,0,1,4,2,5,120,120,0,1`,
    `Style: IntroSub,${font},36,${accent},${accent},&H00000000&,&H96000000&,0,0,0,0,100,100,0,0,1,2,1,5,120,120,-150,1`,
    `Style: Outro,${font},58,${primary},${primary},${accent},${accent},-1,0,0,0,100,100,0,0,3,22,0,5,160,160,0,1`,
    `Style: Badge,${font},22,${text},${text},&H00000000&,&H80000000&,0,0,0,0,100,100,0,0,3,8,0,${badgeAlign},40,40,32,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const push = (style: string, s: number, e: number, txt: string, layer = 0) => {
    if (e <= s) return;
    lines.push(`Dialogue: ${layer},${assTime(s)},${assTime(e)},${style},,0,0,0,,${txt}`);
  };
  const total = input.total;
  push("Badge", 0, total, assEscape(input.disclosure), 5);

  // Intro card: title + channel name.
  const introEnd = Math.min(input.intro.seconds, total);
  push("Intro", 0, introEnd, `{\\fad(200,300)}${assEscape(input.intro.title)}`, 3);
  push("IntroSub", 0, introEnd, `{\\fad(400,300)}${assEscape(input.intro.channel)}`, 3);

  // Lower-thirds: scene titles for their first seconds, chapter cards when a chapter starts.
  const chapterTimes = new Set(input.chapters.map(c => Math.round(c.time * 100)));
  for (const s of input.scenes) {
    if (!s.title?.trim()) continue;
    const isChapter = chapterTimes.has(Math.round(s.start * 100));
    const show = Math.min(s.duration - 0.2, isChapter ? 5 : 4);
    push("Title", s.start + 0.2, s.start + 0.2 + show, `{\\fad(200,250)}${assEscape(s.title)}`, 2);
  }
  for (const c of input.chapters) {
    push("Chapter", c.time + 0.2, Math.min(total, c.time + 5.2), `{\\fad(200,250)}${assEscape(c.name)}`, 2);
  }

  // Captions: phrases for Arabic, three-word karaoke for English.
  const outroStart = Math.max(0, total - input.outro.seconds);
  const words = input.words.filter(w => w.word.trim());
  const style = rtl ? "classic" : "karaoke";
  for (const group of chunkWords(words, style)) {
    const start = group[0].start;
    if (start >= outroStart) continue;
    if (style === "classic") {
      const end = Math.min(outroStart, Math.max(group[group.length - 1].end, start + 0.3));
      push("Cap", start, end, group.map(x => assEscape(x.word)).join(" "), 1);
      continue;
    }
    group.forEach((w, i) => {
      const s = w.start;
      const e = i === group.length - 1 ? Math.max(w.end, s + 0.12) : group[i + 1].start;
      if (s >= outroStart) return;
      const body = group.map((x, k) => (k === i ? `{\\c${accent}}${assEscape(x.word)}{\\c${text}}` : assEscape(x.word))).join(" ");
      push("Cap", s, Math.min(e, outroStart), body, 1);
    });
  }

  // Outro card.
  if (input.outro.text.trim()) push("Outro", outroStart, total, `{\\fad(250,0)}${assEscape(input.outro.text)}`, 3);
  return lines.join("\n") + "\n";
}

export type SceneSource = { kind: "video" | "image"; file: string; in?: number; motion?: string };

/** ffmpeg arguments for one scene clip of exactly `duration` seconds (video padded with its last frame). */
export function sceneArgs(src: SceneSource, duration: number, out: string, preview = false) {
  const W = preview ? 960 : EP_W;
  const H = preview ? 540 : EP_H;
  const common = ["-y", "-hide_banner", "-loglevel", "error"];
  const encode = ["-c:v", "libx264", "-preset", preview ? "ultrafast" : "veryfast", "-crf", preview ? "30" : "21", "-pix_fmt", "yuv420p", "-r", String(FPS), "-an", "-t", f2(duration), out];
  if (src.kind === "video") {
    return [
      ...common,
      ...(src.in && src.in > 0 ? ["-ss", f2(src.in)] : []),
      "-i", src.file,
      "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${f2(duration)}`,
      ...encode,
    ];
  }
  const frames = Math.max(2, Math.round(duration * FPS));
  const m = motionExpr(src.motion ?? "slow_push", frames);
  return [
    ...common,
    "-i", src.file,
    "-vf", `scale=${W * 1.5}:${H * 1.5}:force_original_aspect_ratio=increase,crop=${W * 1.5}:${H * 1.5},zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p`,
    ...encode,
  ];
}

/** Audio graph: narration (delayed by the intro) + optional ducked music bed, loudness-normalized. */
export function buildEpisodeAudioGraph(o: { narrationIndex: number; musicIndex: number | null; introSec: number; total: number; musicVolume: number; duck: boolean }) {
  const fmt = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo";
  const delay = Math.round(o.introSec * 1000);
  const parts = [`[${o.narrationIndex}:a]${fmt},adelay=${delay}|${delay},apad=pad_dur=${f2(o.total)},atrim=0:${f2(o.total)}[nar]`];
  if (o.musicIndex === null) {
    parts.push(`[nar]loudnorm=I=-16:TP=-1.5:LRA=11[a]`);
    return parts.join(";\n");
  }
  const fadeAt = Math.max(0, o.total - 2);
  parts.push(`[${o.musicIndex}:a]${fmt},atrim=0:${f2(o.total)},volume=${Math.max(0, Math.min(1, o.musicVolume)).toFixed(3)},afade=t=out:st=${f2(fadeAt)}:d=2[mus0]`);
  if (o.duck) {
    parts.push(`[nar]asplit=2[narA][narB]`);
    parts.push(`[mus0][narB]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=500:makeup=1[mus]`);
    parts.push(`[narA][mus]amix=inputs=2:duration=longest:normalize=0,atrim=0:${f2(o.total)},loudnorm=I=-16:TP=-1.5:LRA=11[a]`);
  } else {
    parts.push(`[nar][mus0]amix=inputs=2:duration=longest:normalize=0,atrim=0:${f2(o.total)},loudnorm=I=-16:TP=-1.5:LRA=11[a]`);
  }
  return parts.join(";\n");
}

export type EpisodeRenderRequest = {
  language: EpisodeLanguage;
  title: string;
  channelName: string;
  outroText: string;
  scenes: (Scene & { source: SceneSource; wav: string; durationSec: number })[];
  musicFile: string | null;
  musicVolume: number;
  font: string;
  colors: { primary: string; accent: string; text: string };
  disclosure: string;
  /** Word timings per scene relative to the scene's own narration (seconds). */
  sceneWords: { word: string; start: number; end: number }[][];
  preview?: boolean;
  onProgress?: (done: number, total: number) => void;
};

export type EpisodeRenderResult = { video: Buffer; thumbnail: Buffer; durationMs: number; width: number; height: number; chapters: { time: number; name: string }[] };

async function hasAudioStream(path: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path]);
  return stdout.trim().length > 0;
}

export async function renderEpisode(req: EpisodeRenderRequest): Promise<EpisodeRenderResult> {
  const dir = await mkdtemp(join(tmpdir(), "episode-"));
  try {
    const preview = !!req.preview;
    const W = preview ? 960 : EP_W;
    const H = preview ? 540 : EP_H;
    const tl = episodeTimeline(req.scenes, { intro: EPISODE_INTRO_SECONDS, outro: EPISODE_OUTRO_SECONDS, gap: SCENE_GAP });
    const clips: string[] = [];
    const steps = req.scenes.length + 2;
    let done = 0;

    // Intro: the first scene's visual, dimmed, under the title card.
    const first = req.scenes[0].source;
    const intro = join(dir, "intro.mp4");
    const introArgs = sceneArgs(first, tl.intro, intro, preview);
    const vfIndex = introArgs.indexOf("-vf");
    introArgs[vfIndex + 1] = `${introArgs[vfIndex + 1]},eq=brightness=-0.22:saturation=0.8`;
    await run("ffmpeg", introArgs, { maxBuffer: 8 * 1024 * 1024 });
    clips.push(intro);
    req.onProgress?.(++done, steps);

    for (let i = 0; i < req.scenes.length; i++) {
      const s = req.scenes[i];
      const out = join(dir, `scene${i}.mp4`);
      await run("ffmpeg", sceneArgs(s.source, tl.durations[i], out, preview), { maxBuffer: 8 * 1024 * 1024 });
      clips.push(out);
      req.onProgress?.(++done, steps);
    }

    // Outro: solid brand colour.
    const outro = join(dir, "outro.mp4");
    const primary = /^#?[0-9a-f]{6}$/i.test(req.colors.primary) ? `0x${req.colors.primary.replace("#", "")}` : "black";
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${primary}:s=${W}x${H}:r=${FPS}:d=${f2(tl.outro)}`, "-c:v", "libx264", "-preset", preview ? "ultrafast" : "veryfast", "-crf", preview ? "30" : "21", "-pix_fmt", "yuv420p", "-r", String(FPS), "-t", f2(tl.outro), outro]);
    clips.push(outro);

    // Join without re-encoding.
    const list = join(dir, "list.txt");
    await writeFile(list, clips.map(c => `file '${c.replace(/'/g, "'\\''")}'`).join("\n"));
    const joined = join(dir, "joined.mp4");
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);

    // Narration track: scene wavs with the gap after each.
    const narrationArgs = ["-y", "-hide_banner", "-loglevel", "error"];
    const parts: string[] = [];
    req.scenes.forEach((s, i) => {
      narrationArgs.push("-i", s.wav);
      parts.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad=pad_dur=${f2(SCENE_GAP)},atrim=0:${f2(tl.durations[i])}[n${i}]`);
    });
    parts.push(`${req.scenes.map((_, i) => `[n${i}]`).join("")}concat=n=${req.scenes.length}:v=0:a=1[a]`);
    const narration = join(dir, "narration.wav");
    await run("ffmpeg", [...narrationArgs, "-filter_complex", parts.join(";\n"), "-map", "[a]", narration], { maxBuffer: 8 * 1024 * 1024 });

    // Captions on the final timeline.
    const words: { word: string; start: number; end: number }[] = [];
    req.sceneWords.forEach((ws, i) => {
      for (const w of ws) words.push({ word: w.word, start: tl.starts[i] + w.start, end: tl.starts[i] + w.end });
    });
    const ass = join(dir, "episode.ass");
    await writeFile(
      ass,
      buildEpisodeAss({
        language: req.language,
        words,
        scenes: req.scenes.map((s, i) => ({ start: tl.starts[i], duration: tl.durations[i], title: s.title })),
        chapters: tl.chapters,
        intro: { title: req.title, channel: req.channelName, seconds: tl.intro },
        outro: { text: req.outroText, seconds: tl.outro },
        total: tl.total,
        font: req.font,
        colors: req.colors,
        disclosure: req.disclosure,
      }),
    );

    // Final pass: graphics + audio mix.
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", joined, "-i", narration];
    let musicIndex: number | null = null;
    if (req.musicFile && req.musicVolume > 0 && (await hasAudioStream(req.musicFile))) {
      musicIndex = 2;
      args.push("-stream_loop", "-1", "-i", req.musicFile);
    }
    const audioGraph = buildEpisodeAudioGraph({ narrationIndex: 1, musicIndex, introSec: tl.intro, total: tl.total, musicVolume: req.musicVolume, duck: true });
    const out = join(dir, "episode.mp4");
    await run(
      "ffmpeg",
      [
        ...args,
        "-filter_complex", `[0:v]ass=${ass}:fontsdir=${FONTS_DIR}[v];\n${audioGraph}`,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", preview ? "ultrafast" : "veryfast", "-crf", preview ? "30" : "21", "-r", String(FPS),
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
        "-movflags", "+faststart", "-t", f2(tl.total),
        out,
      ],
      { cwd: dir, maxBuffer: 32 * 1024 * 1024 },
    );
    const thumbPath = join(dir, "thumb.jpg");
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "1.6", "-i", out, "-frames:v", "1", "-q:v", "2", thumbPath]);
    const video = await readFile(out);
    req.onProgress?.(steps, steps);
    return { video, thumbnail: await readFile(thumbPath), durationMs: Math.round((await probeDuration(out)) * 1000), width: W, height: H, chapters: tl.chapters };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
