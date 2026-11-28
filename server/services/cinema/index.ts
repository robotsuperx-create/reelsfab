/**
 * Cinema reels, end to end: the director writes the narrated script → the voice is synthesized with word timings →
 * every cue word becomes an exact time → pictures, cutouts, countries and flags are resolved → the runtime is
 * recorded frame by frame → music and effects are designed on the same beats and mixed under the voice.
 *
 * Jobs live in output/cinema/<id>/ (job.json, plan.json, a/, final.mp4) so they survive restarts and can be listed.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { CINEMA_SIZE, cinemaScriptSchema, compileCinema, estimateTiming, type CinemaScript, type LineTiming } from "../../../shared/cinema";
import type { CodeAgentEngine } from "../../../shared/code-video";
import { outputDir } from "../../output";
import { storageDownload, storageKeyFromUrl } from "../../storage";
import { designSoundtrack, type Cue } from "../../worker/sound/soundtrack";
import { countryInfo } from "../code-maps";
import { importWikiImage } from "../code-media";
import { importStockPhoto, searchStockPhotos } from "../stock";
import { recordCinema } from "./recorder";

const run = promisify(execFile);
const PY = process.platform === "win32" ? "python" : "python3";
const TOOLS = resolve(process.cwd(), "tools", "cinema");

export type CinemaJob = {
  id: string;
  idea: string;
  status: "writing" | "voicing" | "pictures" | "recording" | "mixing" | "done" | "failed";
  progress: number;
  log: string[];
  error?: string;
  script?: CinemaScript;
  options: { format: "9:16" | "16:9"; seconds: number; voice?: string; engine?: CodeAgentEngine; music?: string };
  video?: string;
  poster?: string;
  createdAt: string;
  updatedAt: string;
};

export const cinemaRoot = () => join(outputDir(), "cinema");
const jobDir = (id: string) => join(cinemaRoot(), id);
const running = new Set<string>();

async function save(job: CinemaJob) {
  job.updatedAt = new Date().toISOString();
  await mkdir(jobDir(job.id), { recursive: true });
  await writeFile(join(jobDir(job.id), "job.json"), JSON.stringify(job, null, 1));
}
async function say(job: CinemaJob, line: string) {
  job.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  if (job.log.length > 80) job.log.splice(0, job.log.length - 80);
  await save(job);
}

export async function getCinemaJob(id: string): Promise<CinemaJob | null> {
  if (!/^[a-z0-9-]{6,40}$/.test(id)) return null;
  try {
    return JSON.parse(await readFile(join(jobDir(id), "job.json"), "utf8")) as CinemaJob;
  } catch {
    return null;
  }
}
export async function listCinemaJobs(limit = 30) {
  const names = await readdir(cinemaRoot()).catch(() => [] as string[]);
  const jobs = (await Promise.all(names.map(getCinemaJob))).filter((j): j is CinemaJob => !!j);
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(j => ({ ...j, running: running.has(j.id) }));
}

/* ------------------------------------------------------------------ voice */

async function voiceLines(script: CinemaScript, dir: string): Promise<{ timings: LineTiming[]; files: string[]; engine: string }> {
  const files = script.lines.map((_, i) => join(dir, `line${i}.mp3`));
  try {
    const out = await new Promise<string>((res, rej) => {
      const p = spawn(PY, [join(TOOLS, "tts.py")], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
      let o = "", e = "";
      p.stdout.on("data", d => { o += d; });
      p.stderr.on("data", d => { e += d; });
      p.on("error", rej);
      p.on("close", c => (c === 0 ? res(o) : rej(new Error(e.slice(-400) || `tts ${c}`))));
      p.stdin.end(Buffer.from(JSON.stringify({ voice: script.voice || (script.lang === "en" ? "en-US-AndrewNeural" : "ar-SA-HamedNeural"), rate: "+2%", pitch: "-5Hz", lines: script.lines.map(l => l.say), out: dir }), "utf8"));
    });
    const words = JSON.parse(out) as { words: { w: string; s: number; d: number }[] }[];
    const timings: LineTiming[] = [];
    for (let i = 0; i < files.length; i++) {
      const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", files[i]]);
      const w = words[i]?.words ?? [];
      timings.push(w.length ? { words: w, seconds: Number(stdout.trim()) || 0 } : estimateTiming(script.lines[i].say));
    }
    return { timings, files, engine: "edge" };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (!process.env.CINEMA_SILENT_OK) throw new Error(`الصوت لم يُصنع (edge-tts): ${why.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 240)} — ثبّته بـ: python -m pip install --user edge-tts`);
    // Tests and offline machines: estimated timing and silence, so the picture still renders.
    const timings = script.lines.map(l => estimateTiming(l.say));
    for (let i = 0; i < files.length; i++) await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", timings[i].seconds.toFixed(2), "-c:a", "libmp3lame", files[i]]);
    return { timings, files, engine: `silent (${e instanceof Error ? e.message.slice(0, 120) : e})` };
  }
}

/* ------------------------------------------------------------------ pictures, countries, flags */

async function assetToFile(url: string, dir: string, name: string) {
  const key = storageKeyFromUrl(url);
  if (!key) throw new Error("مصدر غير صالح");
  const ext = (key.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const file = join(dir, "a", `${name}.${ext}`);
  await writeFile(file, await storageDownload(key));
  return { file, rel: `/a/${name}.${ext}` };
}
async function cutout(file: string, out: string) {
  try {
    await run(PY, [join(TOOLS, "cutout.py"), file, out], { timeout: 240_000 });
    return existsSync(out);
  } catch {
    return false;
  }
}
const flagFile = (a2: string) => resolve(process.cwd(), "node_modules", "flag-icons", "flags", "4x3", `${a2}.svg`);

async function resolveNeeds(plan: ReturnType<typeof compileCinema>, dir: string, userId: number | null, log: (s: string) => Promise<void>) {
  await mkdir(join(dir, "a"), { recursive: true });
  const credits: string[] = [];
  for (const n of plan.needs) {
    const shot = plan.shots[n.shot];
    const type = shot.type as string;
    if (n.country) {
      const c = countryInfo(n.country);
      if (!c) { await log(`› لم أعرف البلد «${n.country}» — صار المشهد بلا تركيز`); }
      else {
        if (type === "globe") shot.focus = { id: c.id, lat: c.lat, lon: c.lon };
        if (type === "assemble") shot.country = { id: c.id, lat: c.lat };
        if (type === "flag") {
          if (c.a2 && existsSync(flagFile(c.a2))) shot.flag = `/lib/flags/${c.a2}.svg`;
          else { shot.type = "dark"; await log(`› لا علم لـ «${n.country}» — مشهد داكن بدله`); }
        }
      }
    }
    if (type === "globe") {
      if (!shot.focus) shot.focus = { id: "", lat: 25, lon: 30 };
      shot.arcs = (n.arcsFrom ?? []).map(a => countryInfo(a)).filter(Boolean).map(c => ({ lat: c!.lat, lon: c!.lon }));
      shot.highlight = (n.highlight ?? []).map(h => ({ c: countryInfo(h.country), color: h.color })).filter(h => h.c).map(h => ({ id: h.c!.id, color: h.color }));
    }
    if (type === "assemble" && !shot.country) shot.type = "dark";
    if (type === "photo") {
      let got: { file: string; rel: string } | null = null;
      const name = `p${n.shot}`;
      if (n.wiki) {
        try {
          const r = await importWikiImage(n.wiki, userId);
          if (r?.asset) { got = await assetToFile(r.asset.url, dir, name); credits.push(r.credit); }
        } catch (e) { await log(`› صورة ويكيبيديا «${n.wiki}»: ${e instanceof Error ? e.message.slice(0, 100) : e}`); }
      }
      if (!got && n.query) {
        try {
          const found = await searchStockPhotos(n.query, 1, plan.h > plan.w ? "portrait" : "landscape");
          const item = found.items[0];
          if (item) { const imp = await importStockPhoto(item, { query: n.query, userId }); got = await assetToFile(imp.asset.url, dir, name); credits.push(item.credit); }
        } catch (e) { await log(`› صورة مجانية «${n.query}»: ${e instanceof Error ? e.message.slice(0, 100) : e}`); }
      }
      if (!got) { shot.type = "dark"; await log(`› لا صورة لـ «${n.wiki ?? n.query ?? "?"}» — مشهد داكن بدلها`); continue; }
      shot.img = got.rel;
      shot.cut = null;
      if (n.cutout) {
        const out = join(dir, "a", `${name}_cut.png`);
        if (await cutout(got.file, out)) shot.cut = `/a/${name}_cut.png`;
      }
    }
  }
  return credits;
}

/* ------------------------------------------------------------------ sound */

async function mix(dir: string, files: string[], starts: number[], cues: Cue[], duration: number, mood: string) {
  const { wav } = await designSoundtrack({ durationSec: duration, cues, mood: (mood as never) ?? "epic", seed: 1979 });
  await writeFile(join(dir, "bed.wav"), wav);
  const inputs: string[] = [];
  const parts: string[] = [];
  files.forEach((f, i) => {
    inputs.push("-i", f);
    const ms = Math.round(starts[i] * 1000);
    parts.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},apad=whole_dur=${duration}[v${i}]`);
  });
  inputs.push("-i", join(dir, "bed.wav"));
  const b = files.length;
  parts.push(`${files.map((_, i) => `[v${i}]`).join("")}amix=inputs=${files.length}:normalize=0,highpass=f=70,acompressor=threshold=0.12:ratio=3:attack=5:release=120,volume=1.35[voice]`);
  parts.push(`[voice]asplit=2[vo][key]`);
  parts.push(`[${b}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0.75[bed]`);
  parts.push(`[bed][key]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=350[ducked]`);
  parts.push(`[vo][ducked]amix=inputs=2:normalize=0,atrim=0:${duration},loudnorm=I=-14:TP=-1.2:LRA=9[out]`);
  await run("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-ar", "48000", join(dir, "mix.wav")], { maxBuffer: 16 * 1024 * 1024 });
}

/* ------------------------------------------------------------------ the job */

export async function startCinemaJob(input: { idea: string; script?: CinemaScript; options: CinemaJob["options"]; userId: number | null; write?: (job: CinemaJob) => Promise<CinemaScript> }) {
  const id = `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const job: CinemaJob = { id, idea: input.idea, status: input.script ? "voicing" : "writing", progress: 0, log: [], options: input.options, script: input.script, createdAt: now, updatedAt: now };
  await save(job);
  running.add(id);
  void runJob(job, input.userId, input.write)
    .catch(async e => {
      job.status = "failed";
      job.error = e instanceof Error ? e.message : String(e);
      await say(job, `✗ ${job.error.slice(0, 300)}`).catch(() => undefined);
    })
    .finally(() => running.delete(id));
  return { id };
}

async function runJob(job: CinemaJob, userId: number | null, write?: (job: CinemaJob) => Promise<CinemaScript>) {
  const dir = jobDir(job.id);
  if (!job.script) {
    if (!write) throw new Error("لا سكربت ولا مخرج");
    await say(job, "› المخرج يكتب التعليق ويختار لقطة لكل جملة…");
    job.script = cinemaScriptSchema.parse(await write(job));
    await say(job, `✓ «${job.script.title}» — ${job.script.lines.length} جملة`);
  }
  const script = cinemaScriptSchema.parse({ ...job.script, format: job.options.format, voice: job.options.voice || job.script.voice, music: job.options.music || job.script.music });
  job.script = script;
  job.status = "voicing";
  await say(job, "› الصوت الوثائقي جملة جملة مع توقيت كل كلمة…");
  const voice = await voiceLines(script, dir);
  await say(job, voice.engine === "edge" ? `✓ الصوت جاهز (${script.voice || "ar-SA-HamedNeural"})` : `› بلا صوت — ${voice.engine}`);
  const plan = compileCinema(script, voice.timings);
  job.status = "pictures";
  await say(job, `› ${plan.shots.length} لقطة في ${plan.duration.toFixed(1)} ث — يجلب الصور والبلدان ويفصل الأشخاص عن خلفياتهم…`);
  const credits = await resolveNeeds(plan, dir, userId, l => say(job, l));
  const { needs: _n, cues, lineStarts, ...page } = plan;
  await writeFile(join(dir, "plan.json"), JSON.stringify(page));
  job.status = "recording";
  job.progress = 0;
  await say(job, "› يرسم الفيديو إطارًا إطارًا…");
  const size = CINEMA_SIZE[script.format];
  let lastSaved = Date.now();
  const rec = await recordCinema({
    dir, width: size.w, height: size.h, fps: 30,
    onProgress: (d, t) => {
      job.progress = Math.round((d / t) * 100);
      if (Date.now() - lastSaved > 3000) { lastSaved = Date.now(); void save(job); }
    },
  });
  if (rec.errors.length) await say(job, `› ملاحظات الصفحة: ${rec.errors.slice(0, 2).join(" | ").slice(0, 200)}`);
  job.status = "mixing";
  await say(job, "› الموسيقى والمؤثرات على نفس الإيقاع، تحت الصوت…");
  await mix(dir, voice.files, lineStarts, cues as Cue[], plan.duration, script.music);
  const final = join(dir, "final.mp4");
  await run("ffmpeg", ["-y", "-v", "error", "-i", join(dir, "silent.mp4"), "-i", join(dir, "mix.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", final]);
  await run("ffmpeg", ["-y", "-v", "error", "-ss", String(Math.min(2.5, plan.duration / 3)), "-i", final, "-frames:v", "1", "-q:v", "3", join(dir, "poster.jpg")]);
  if (credits.length) await writeFile(join(dir, "credits.txt"), [...new Set(credits)].join("\n"));
  job.video = `/api/output/cinema/${job.id}/final.mp4`;
  job.poster = `/api/output/cinema/${job.id}/poster.jpg`;
  job.status = "done";
  job.progress = 100;
  await say(job, "✓ جاهز");
}

/** Copies a finished reel somewhere the owner keeps videos (Windows: Videos\ReellllLocaL). */
export async function exportCinema(id: string, to: string) {
  await copyFile(join(jobDir(id), "final.mp4"), to);
}
