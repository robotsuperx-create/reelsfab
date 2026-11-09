/**
 * Long-form episodes: script generation (free LLM tier or local Ollama), per-scene narration cached in
 * storage (free TTS, one call per scene), automatic stock visuals the editor reviews, and the final render.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { desc, eq, sql } from "drizzle-orm";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assets, channels, costEntries, episodes, type Channel, type Episode } from "../../drizzle/schema";
import { AI_DISCLOSURE, CLAUDE_DEFAULT_MODEL } from "../../shared/domain";
import { chaptersText, episodeProblems, episodeScriptSchema, newSceneId, type EpisodeScript, type Scene } from "../../shared/episodes";
import { getSettings, requireDb } from "../db";
import { writeOutput } from "../output";
import { storageDownload, storageKeyFromUrl, storagePut } from "../storage";
import { wordTimings } from "../worker/ass";
import { renderEpisode, type SceneSource } from "../worker/episode-render";
import { synthesize } from "../worker/tts";
import { callJson } from "./ai";
import { importStockPhoto, importStockVideo, searchStockPhotos, searchStockVideos } from "./stock";
import { generateImageAsset, imageProviderReady } from "./ai-images";
import { imagePromptFor } from "../../shared/images";

const WORDS_PER_MINUTE = { ar: 125, en: 150 } as const;
const run = promisify(execFile);

export async function loadEpisode(id: number) {
  const db = await requireDb();
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, id));
  if (!episode) throw new Error("Episode not found");
  const [channel] = await db.select().from(channels).where(eq(channels.id, episode.channelId));
  if (!channel) throw new Error("Channel not found");
  return { episode, channel };
}

const scriptJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    hook: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          narration: { type: "string" },
          title: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          imagePrompt: { type: "string" },
          chapter: { type: "string" },
        },
        required: ["narration", "keywords"],
      },
    },
    outro: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["title", "hook", "scenes", "outro", "description", "tags"],
};

/** Writes the scene-by-scene script with the channel's editorial line. Model comes from settings (Claude by default). */
export async function generateEpisodeScript(channel: Channel, topic: string, userId?: number): Promise<EpisodeScript> {
  const settings = await getSettings();
  const model = settings.episodeModel || CLAUDE_DEFAULT_MODEL;
  const minutes = channel.episodeTemplate.minutes;
  const words = Math.round(minutes * WORDS_PER_MINUTE[channel.language]);
  const sceneCount = Math.max(6, Math.min(40, Math.round(minutes * 3)));
  const perScene = Math.round(words / sceneCount);
  const lang = channel.language === "ar" ? "Arabic (Modern Standard, clear and warm)" : "English";
  const system = [
    `You write narrated YouTube documentary-style episodes for the channel "${channel.name}".`,
    `Channel angle: ${channel.niche}.`,
    `Editorial rules (follow strictly): ${channel.guidelines || "accurate, sourced, calm, original analysis."}`,
    channel.madeForKids ? "The audience is children aged 5-9: short sentences, warm tone, nothing frightening, one clear value." : "",
    "Write original analysis with a clear point of view; never read sources verbatim; cite sources by name in the description.",
  ].filter(Boolean).join("\n");
  const prompt = [
    `Write the full episode script for the topic: "${topic}".`,
    `Language of narration, titles, outro and description: ${lang}.`,
    `Target length: ${minutes} minutes of narration = about ${words} words in total, split into ${sceneCount} scenes.`,
    `Each scene's "narration" must be about ${perScene} words (${perScene < 30 ? "2-3" : "3-5"} full sentences) — not shorter: a scene that is too short makes the episode too short. Before answering, check that the narrations together reach about ${words} words.`,
    `Structure the episode in these sections, in order: ${channel.episodeTemplate.structure.join(" → ")}. Put the section name in "chapter" on the first scene of each section (same string for the section's scenes).`,
    `The first ${Math.max(1, Math.round(channel.episodeTemplate.hookSeconds / 7))} scene(s) are the hook: a surprising question or fact that makes the viewer stay.`,
    `For every scene give "keywords": 2-4 English search terms for free stock footage that visually matches the scene (concrete nouns, places, actions — never abstract words).`,
    `For every scene give "imagePrompt": one English sentence (15-35 words) describing a single picture that illustrates the scene — subject, setting, era, mood, camera framing — usable by an image generator. No text, signs or captions in the picture; no real living people by name.`,
    `"title" is an optional short on-screen caption (max 6 words) for scenes that introduce a new idea, name, date or place.`,
    `"outro" is one sentence inviting to subscribe: ${channel.episodeTemplate.cta}.`,
    `"description" is the YouTube description (3-6 sentences) ending with a Sources: list. "tags" are 8-15 short tags.`,
    `Return ONLY JSON.`,
  ].join("\n");
  const raw = await callJson<{ title: string; hook: string; scenes: { narration: string; title?: string; keywords?: string[]; chapter?: string; imagePrompt?: string }[]; outro: string; description: string; tags: string[] }>({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    schemaName: "episode_script",
    schema: scriptJsonSchema,
    // Room for adaptive thinking + the script: Arabic ≈ 3-4 tokens per word, ~150 tokens of keywords/image prompt/JSON
    // per scene, plus description. Only used tokens are billed; the cap just prevents a cut-off script.
    maxTokens: Math.min(64_000, 8_000 + words * 6 + sceneCount * 150),
    description: `سكربت حلقة «${topic.slice(0, 60)}» لقناة ${channel.name}`,
    refType: "channel",
    refId: channel.id,
    userId,
  });
  const scenes: Scene[] = (raw.scenes ?? [])
    .filter(s => typeof s?.narration === "string" && s.narration.trim())
    .slice(0, 60)
    .map(s => ({
      id: newSceneId(),
      narration: s.narration.trim().slice(0, 2000),
      title: s.title?.trim().slice(0, 120) || undefined,
      keywords: (s.keywords ?? []).map(k => String(k).trim().slice(0, 60)).filter(Boolean).slice(0, 8),
      imagePrompt: typeof s.imagePrompt === "string" && s.imagePrompt.trim() ? s.imagePrompt.trim().slice(0, 600) : undefined,
      chapter: s.chapter?.trim().slice(0, 80) || undefined,
    }));
  const wordCount = scenes.reduce((a, sc) => a + sc.narration.split(/\s+/).filter(Boolean).length, 0);
  if (wordCount < words * 0.6) console.warn(`[episodes] script for "${topic.slice(0, 40)}" is short: ${wordCount}/${words} words`);
  const script = episodeScriptSchema.parse({
    title: String(raw.title ?? topic).trim().slice(0, 160) || topic.slice(0, 160),
    hook: String(raw.hook ?? "").slice(0, 400),
    scenes,
    outro: String(raw.outro ?? channel.episodeTemplate.cta).slice(0, 400),
    description: String(raw.description ?? "").slice(0, 4000),
    tags: (raw.tags ?? []).map(t => String(t).replace(/^#/, "").trim().slice(0, 40)).filter(Boolean).slice(0, 20),
  });
  return script;
}

export function narrationHash(text: string, voice: string, provider: string, speed: number) {
  return createHash("sha1").update(`${provider}|${voice}|${speed}|${text.trim()}`).digest("hex").slice(0, 10);
}

/**
 * Synthesizes each scene once (cached in storage by text+voice) so re-renders never spend free-tier quota again,
 * and records every scene's narration length — the visual timeline follows the voice.
 */
export async function prepareNarration(episodeId: number, onProgress?: (done: number, total: number) => void) {
  const db = await requireDb();
  const { episode, channel } = await loadEpisode(episodeId);
  if (!episode.script) throw new Error("لا يوجد سكربت بعد — ولّد السكربت أولًا");
  const script = episodeScriptSchema.parse(episode.script);
  const dir = await mkdtemp(join(tmpdir(), "narration-"));
  const speed = (Number(channel.ttsSpeed) || 100) / 100;
  try {
    let synthesized = 0;
    let spentMilliCents = 0;
    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      const hash = narrationHash(scene.narration, channel.voice, channel.ttsProvider, speed);
      if (scene.narrationKey && scene.narrationHash === hash && scene.durationSec) {
        onProgress?.(i + 1, script.scenes.length);
        continue;
      }
      const wav = join(dir, `${scene.id}.wav`);
      const r = await synthesize({ text: scene.narration, voice: channel.voice, speed, outPath: wav, provider: channel.ttsProvider });
      spentMilliCents += r.costMilliCents ?? 0;
      // Cached as AAC (≈1/6 of the WAV) so a 15-minute episode costs a few MB of storage, not 40+.
      const m4a = join(dir, `${scene.id}.m4a`);
      await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", r.wavPath, "-c:a", "aac", "-b:a", "72k", m4a]);
      const { readFile } = await import("node:fs/promises");
      const put = await storagePut(`episodes/${episodeId}/narration/${scene.id}-${hash}.m4a`, await readFile(m4a), "audio/mp4");
      scene.narrationKey = put.key;
      scene.narrationHash = hash;
      scene.durationSec = Number(r.durationSec.toFixed(2));
      synthesized++;
      onProgress?.(i + 1, script.scenes.length);
      // Persist progressively so a quota error half-way keeps what was done.
      await db.update(episodes).set({ script, updatedAt: new Date() }).where(eq(episodes.id, episodeId));
    }
    await db.update(episodes).set({ script, updatedAt: new Date(), ...(spentMilliCents ? { costMilliCents: sql`${episodes.costMilliCents} + ${spentMilliCents}` } : {}) }).where(eq(episodes.id, episodeId));
    if (spentMilliCents) {
      await db.insert(costEntries).values({ category: "voice", amountMilliCents: spentMilliCents, description: `تعليق صوتي (${channel.ttsProvider}) لحلقة #${episodeId} — ${synthesized} مشهد`, refType: "episode", refId: episodeId }).catch(e => console.warn("[cost] tts", e));
    }
    return { synthesized, scenes: script.scenes.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const MOTIONS = ["slow_push", "pan_left", "slow_pull", "step_zoom"] as const;

/** Prompt for a scene's AI picture: the script's English visual description, else its stock keywords. */
export function scenePrompt(scene: Scene, channel: Pick<Channel, "niche">) {
  const base = scene.imagePrompt?.trim() || (scene.keywords.length ? scene.keywords.join(", ") : channel.niche);
  return base;
}

/**
 * Picks a visual for scenes without one. Source "stock" = free Pexels/Pixabay (one search per scene, no clip reused inside
 * the episode); "ai" = a generated picture per scene (fal.ai, standard tier); "auto" = AI for illustration channels
 * when the image provider is configured, stock otherwise.
 */
export async function planVisuals(episodeId: number, opts?: { onlyMissing?: boolean; userId?: number | null; source?: "auto" | "stock" | "ai"; onProgress?: (done: number, total: number) => void }) {
  const db = await requireDb();
  const { episode, channel } = await loadEpisode(episodeId);
  if (!episode.script) throw new Error("لا يوجد سكربت بعد — ولّد السكربت أولًا");
  const script = episodeScriptSchema.parse(episode.script);
  const onlyMissing = opts?.onlyMissing ?? true;
  const source = opts?.source ?? "auto";
  const aiReady = await imageProviderReady();
  if (source === "ai" && !aiReady) throw new Error("أضف مفتاح fal.ai من مركز التكاملات (مزوّد «صور الذكاء الاصطناعي») أولًا");
  if (source === "ai" || (source === "auto" && aiReady && channel.visualStyle === "illustration")) {
    return planAiVisuals(episodeId, script, channel, { onlyMissing, userId: opts?.userId ?? null, onProgress: opts?.onProgress });
  }
  // Assets already placed in this episode are not reused (imports are deduplicated by source id, so
  // re-importing a known clip costs no download).
  const used = new Set(script.scenes.map(s => s.visual?.assetId).filter((x): x is number => typeof x === "number"));
  const stills = channel.visualStyle === "stills" || channel.visualStyle === "illustration";
  let picked = 0;
  let missing = 0;
  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (onlyMissing && scene.visual) {
      opts?.onProgress?.(i + 1, script.scenes.length);
      continue;
    }
    const queries = [scene.keywords.slice(0, 3).join(" "), scene.keywords[0] ?? "", channel.niche.split(/[:،,]/)[0]].map(q => q.trim()).filter(Boolean);
    let chosen: Scene["visual"] | undefined;
    for (const q of queries) {
      try {
        if (stills) {
          const r = await searchStockPhotos(q, 1, "landscape");
          for (const item of r.items.slice(0, 4)) {
            const imp = await importStockPhoto(item, { query: q, userId: opts?.userId ?? null });
            if (used.has(imp.asset.id)) continue;
            used.add(imp.asset.id);
            chosen = { kind: "image", src: imp.asset.url, assetId: imp.asset.id, credit: imp.asset.meta?.credit, motion: MOTIONS[i % MOTIONS.length], auto: true };
            break;
          }
        } else {
          const r = await searchStockVideos(q, 1, "landscape");
          const need = Math.min(scene.durationSec ?? 8, 12);
          const ordered = [...r.items.filter(x => x.durationSec >= need), ...r.items.filter(x => x.durationSec < need)];
          for (const item of ordered.slice(0, 4)) {
            const imp = await importStockVideo(item, { characterId: null, query: q, userId: opts?.userId ?? null });
            if (used.has(imp.asset.id)) continue;
            used.add(imp.asset.id);
            chosen = { kind: "video", src: imp.asset.url, assetId: imp.asset.id, credit: imp.asset.meta?.credit, in: 0, auto: true };
            break;
          }
        }
        if (chosen) break;
      } catch (e) {
        if (/حد الطلبات|429|مفتاح|لا يستجيب/.test(e instanceof Error ? e.message : String(e))) throw e;
      }
    }
    if (chosen) {
      scene.visual = chosen;
      picked++;
    } else missing++;
    opts?.onProgress?.(i + 1, script.scenes.length);
    await db.update(episodes).set({ script, updatedAt: new Date() }).where(eq(episodes.id, episodeId));
  }
  return { picked, missing };
}

async function planAiVisuals(
  episodeId: number,
  script: EpisodeScript,
  channel: Channel,
  opts: { onlyMissing: boolean; userId: number | null; onProgress?: (done: number, total: number) => void },
) {
  const db = await requireDb();
  let picked = 0;
  let missing = 0;
  let spentUsd = 0;
  let lastError = "";
  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (opts.onlyMissing && scene.visual) {
      opts.onProgress?.(i + 1, script.scenes.length);
      continue;
    }
    try {
      const r = await generateImageAsset({
        prompt: imagePromptFor(scenePrompt(scene, channel), channel.visualStyle),
        tier: "standard",
        aspect: "16:9",
        title: `${channel.name}: ${scene.title || scene.narration.slice(0, 60)}`,
        userId: opts.userId,
        ref: { type: "episode", id: episodeId },
      });
      spentUsd += r.usd;
      scene.visual = { kind: "image", src: r.asset.url, assetId: r.asset.id, credit: r.asset.meta?.credit, motion: MOTIONS[i % MOTIONS.length], auto: true };
      picked++;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      // A wrong key or an empty balance stops the run; a refused prompt only skips that scene.
      if (/مفتاح|رصيد|key|balance/i.test(lastError)) throw e;
      missing++;
    }
    opts.onProgress?.(i + 1, script.scenes.length);
    await db.update(episodes).set({ script, updatedAt: new Date() }).where(eq(episodes.id, episodeId));
  }
  if (spentUsd > 0) {
    await db.update(episodes).set({ costMilliCents: sql`${episodes.costMilliCents} + ${Math.round(spentUsd * 100000)}` }).where(eq(episodes.id, episodeId));
  }
  return { picked, missing, ai: true as const, spentUsd: Number(spentUsd.toFixed(4)), lastError: missing ? lastError : undefined };
}

/** Both preparation steps; status moves to needs_review (kids) or script_ready. */
export async function prepareEpisode(episodeId: number, userId?: number | null) {
  const db = await requireDb();
  const narration = await prepareNarration(episodeId);
  const visuals = await planVisuals(episodeId, { onlyMissing: true, userId });
  const { episode, channel } = await loadEpisode(episodeId);
  const script = episodeScriptSchema.parse(episode.script);
  const problems = episodeProblems(script, channel.language);
  await db
    .update(episodes)
    .set({ status: channel.madeForKids || problems.length ? "needs_review" : "script_ready", title: script.title, error: null, updatedAt: new Date() })
    .where(eq(episodes.id, episodeId));
  return { ...narration, ...visuals, problems };
}

async function fetchToDir(url: string, dir: string, name: string) {
  const key = storageKeyFromUrl(url);
  if (!key) throw new Error(`مصدر غير صالح: ${url.slice(0, 80)}`);
  const ext = (key.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = join(dir, `${name}.${ext}`);
  await writeFile(path, await storageDownload(key));
  return path;
}

/** Downloads sources + cached narration, renders the episode and stores the result on the episode row. */
export async function finishEpisodeRender(episodeId: number, opts?: { preview?: boolean; onProgress?: (done: number, total: number) => void }) {
  const db = await requireDb();
  const { episode, channel } = await loadEpisode(episodeId);
  if (!episode.script) throw new Error("لا يوجد سكربت بعد — ولّد السكربت أولًا");
  const script = episodeScriptSchema.parse(episode.script);
  const problems = episodeProblems(script, channel.language);
  if (problems.length) throw new Error(problems[0]);
  const speedNow = (Number(channel.ttsSpeed) || 100) / 100;
  if (script.scenes.some(s => !s.durationSec || !s.narrationKey || s.narrationHash !== narrationHash(s.narration, channel.voice, channel.ttsProvider, speedNow))) await prepareNarration(episodeId);
  const fresh = episodeScriptSchema.parse((await loadEpisode(episodeId)).episode.script);
  const dir = await mkdtemp(join(tmpdir(), "episode-src-"));
  try {
    const scenes = [];
    const sceneWords: { word: string; start: number; end: number }[][] = [];
    const cache = new Map<string, string>();
    for (let i = 0; i < fresh.scenes.length; i++) {
      const s = fresh.scenes[i];
      const v = s.visual!;
      let file = cache.get(v.src);
      if (!file) {
        file = await fetchToDir(v.src, dir, `v${i}`);
        cache.set(v.src, file);
      }
      const wav = join(dir, `${s.id}${s.narrationKey!.endsWith(".m4a") ? ".m4a" : ".wav"}`);
      await writeFile(wav, await storageDownload(s.narrationKey!));
      const source: SceneSource = v.kind === "video" ? { kind: "video", file, in: v.in ?? 0 } : { kind: "image", file, motion: v.motion ?? "slow_push" };
      scenes.push({ ...s, source, wav, durationSec: s.durationSec! });
      sceneWords.push(wordTimings(s.narration, 0.05, s.durationSec!));
    }
    let musicFile: string | null = null;
    if (channel.musicAssetId) {
      const [music] = await db.select().from(assets).where(eq(assets.id, channel.musicAssetId));
      if (music) musicFile = await fetchToDir(music.url, dir, "music").catch(() => null);
    }
    const out = await renderEpisode({
      language: channel.language,
      title: fresh.title,
      channelName: channel.name,
      outroText: fresh.outro,
      scenes,
      sceneWords,
      musicFile,
      musicVolume: 0.16,
      font: "IBM Plex Sans Arabic",
      colors: channel.colors,
      disclosure: channel.language === "ar" ? "تعليق صوتي مولَّد بالذكاء الاصطناعي" : AI_DISCLOSURE,
      preview: opts?.preview,
      onProgress: opts?.onProgress,
    });
    // The video goes to the local output folder (free disk); only the small thumbnail goes to storage.
    const name = opts?.preview ? `episodes/episode-${episodeId}-preview.mp4` : `episodes/episode-${episodeId}.mp4`;
    const video = { ...(await writeOutput(name, out.video)), key: null as string | null };
    const thumb = await storagePut(`episodes/${episodeId}/${opts?.preview ? "preview" : "episode"}.jpg`, out.thumbnail, "image/jpeg");
    const chapters = chaptersText(fresh.scenes, channel.language === "ar" ? "المقدمة" : "Intro");
    if (!opts?.preview) {
      await db
        .update(episodes)
        .set({ status: "rendered", videoUrl: video.url, storageKey: video.path, thumbnailUrl: thumb.url, durationMs: out.durationMs, chaptersText: chapters, title: fresh.title, error: null, updatedAt: new Date() })
        .where(eq(episodes.id, episodeId));
    }
    return { videoUrl: video.url, thumbnailUrl: thumb.url, durationMs: out.durationMs, chapters };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function listEpisodes(channelId?: number, limit = 80) {
  const db = await requireDb();
  return db
    .select({
      id: episodes.id,
      channelId: episodes.channelId,
      topic: episodes.topic,
      title: episodes.title,
      status: episodes.status,
      thumbnailUrl: episodes.thumbnailUrl,
      videoUrl: episodes.videoUrl,
      durationMs: episodes.durationMs,
      error: episodes.error,
      publishedUrl: episodes.publishedUrl,
      updatedAt: episodes.updatedAt,
      scenes: sql<number>`coalesce(jsonb_array_length(${episodes.script}->'scenes'), 0)`,
      channelName: channels.name,
      language: channels.language,
    })
    .from(episodes)
    .leftJoin(channels, eq(channels.id, episodes.channelId))
    .where(channelId ? eq(episodes.channelId, channelId) : sql`true`)
    .orderBy(desc(episodes.updatedAt))
    .limit(limit);
}

export async function channelStats() {
  const db = await requireDb();
  const rows = await db
    .select({ channelId: episodes.channelId, status: episodes.status, n: sql<number>`count(*)::int` })
    .from(episodes)
    .groupBy(episodes.channelId, episodes.status);
  const out: Record<number, Record<string, number>> = {};
  for (const r of rows) (out[r.channelId] ??= {})[r.status] = r.n;
  return out;
}

export type EpisodeRow = Episode;
