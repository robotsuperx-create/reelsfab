import { AI_DISCLOSURE, REEL_SECONDS, type TemplateKey } from "@shared/domain";
import type { Character, PremiumClip, Script } from "../../../../drizzle/schema";
import { fetchBlob } from "../api";
import { speak } from "../tts";
import { decodeAudioBlob, decodeVideoAudio, generateMusicBed, mixReelAudio, type VoiceClip } from "./audio";
import type { BgSource, CaptionWord, ReelSpec, Segment } from "./draw";

export type MusicChoice = { kind: "none" } | { kind: "generated"; mood: "warm" | "bright" | "moody" } | { kind: "asset"; url: string };

export type PreparedReel = {
  kind: "economic" | "derivative" | "premium";
  scriptId: number;
  characterId: number;
  variantLabel: string | null;
  spec: ReelSpec;
  audio: AudioBuffer;
  images: BgSource[];
  videoBlob: Blob | null;
  settingsUsed: Record<string, unknown>;
};

const W = 1080;
const H = 1920;
const FPS = 30;

function lookOf(c: Character) {
  return {
    name: c.name,
    catchphrase: c.catchphrase ?? "",
    colors: c.colors ?? { primary: "#1B1B1F", accent: "#FFB627", text: "#FFFFFF" },
    font: c.captionFont || "Montserrat",
  };
}

const tokenize = (s: string) => s.split(/\s+/).map(w => w.trim()).filter(Boolean);

/** Spreads words across [start, end] proportionally to their length. */
function timeWords(text: string, start: number, end: number): CaptionWord[] {
  const words = tokenize(text);
  if (!words.length) return [];
  const total = words.reduce((a, w) => a + w.length + 1.5, 0);
  const span = Math.max(0.1, end - start);
  let t = start;
  return words.map(w => {
    const d = (span * (w.length + 1.5)) / total;
    const out = { text: w, start: t, end: t + d };
    t += d;
    return out;
  });
}

function parseComparison(text: string | null | undefined): [string, string] | null {
  if (!text) return null;
  const m = text.split(/\s+(?:vs\.?|versus|or)\s+/i);
  if (m.length === 2 && m[0].trim() && m[1].trim()) return [m[0].trim(), m[1].trim()];
  return null;
}

function shorten(s: string, maxWords = 7) {
  const w = tokenize(s.replace(/^(and|but|so|then|first|second|third|finally)[,:]?\s+/i, ""));
  const out = w.slice(0, maxWords).join(" ");
  return (w.length > maxWords ? `${out}…` : out).replace(/[.,;:]+$/, "");
}

/** Derives up to 3 on-screen points from the body, timed to when each phrase is spoken. */
function derivePoints(body: string, words: CaptionWord[]): { text: string; at: number }[] {
  let parts = body.split(/(?<=[.!?;])\s+/).filter(p => tokenize(p).length >= 2);
  if (parts.length < 3) parts = body.split(/(?<=[,.!?;])\s+/).filter(p => tokenize(p).length >= 2);
  parts = parts.slice(0, 3);
  let cursor = 0;
  return parts.map(p => {
    const at = words[cursor]?.start ?? 0;
    cursor += tokenize(p).length;
    return { text: shorten(p), at };
  });
}

async function loadImages(urls: string[]) {
  const out: BgSource[] = [];
  for (const u of urls) {
    try {
      const blob = await fetchBlob(u);
      const bmp = await createImageBitmap(blob);
      out.push({ source: bmp, w: bmp.width, h: bmp.height });
    } catch (e) {
      console.warn("image load failed", u, e);
    }
  }
  return out;
}

async function loadMusic(choice: MusicChoice, duration: number) {
  if (choice.kind === "none") return null;
  if (choice.kind === "generated") return generateMusicBed(duration, choice.mood);
  try {
    return await decodeAudioBlob(await fetchBlob(choice.url));
  } catch {
    return null;
  }
}

export type EconomicOptions = {
  script: Script;
  character: Character;
  imageUrls: string[];
  music: MusicChoice;
  musicVolume: number;
  /** Optional externally recorded voice-over (e.g. ElevenLabs export) instead of free Kokoro. */
  voiceUrl?: string | null;
  voiceOverride?: string | null;
  onStep?: (label: string) => void;
};

export async function prepareEconomic(o: EconomicOptions): Promise<PreparedReel> {
  const { script, character } = o;
  o.onStep?.("تحميل الصور");
  const images = await loadImages(o.imageUrls);
  if (!images.length) throw new Error("لا توجد صورة للشخصية — ارفع صورة مرجعية أولًا");

  const segTexts: [keyof ReelSpec["segments"], string][] = (
    [
      ["hook", script.hook],
      ["body", script.body],
      ["payoff", script.payoff ?? ""],
      ["cta", script.cta ?? ""],
    ] as [keyof ReelSpec["segments"], string][]
  ).filter(([, t]) => t.trim().length > 0);

  const voice: VoiceClip[] = [];
  const segments: ReelSpec["segments"] = {};
  let words: CaptionWord[] = [];
  const START = 0.3;
  const GAP = 0.14;
  let voiceEnd = START;
  const voiceId = o.voiceOverride || character.ttsVoice || "af_heart";
  let speed = (character.ttsSpeed || 100) / 100;

  if (o.voiceUrl) {
    o.onStep?.("تحميل التعليق الصوتي");
    const buf = await decodeAudioBlob(await fetchBlob(o.voiceUrl));
    const mono = buf.getChannelData(0);
    voice.push({ samples: new Float32Array(mono), sampleRate: buf.sampleRate, at: START });
    voiceEnd = START + buf.duration;
    const allText = segTexts.map(s => s[1]).join(" ");
    words = timeWords(allText, START, voiceEnd - 0.1);
    // Approximate segment bounds by word share.
    let cursor = 0;
    for (const [key, text] of segTexts) {
      const n = tokenize(text).length;
      const first = words[cursor];
      const last = words[Math.min(words.length - 1, cursor + n - 1)];
      if (first && last) segments[key] = { start: first.start, end: last.end };
      cursor += n;
    }
  } else {
    let attempt = 0;
    for (;;) {
      o.onStep?.(attempt === 0 ? "توليد الصوت (Kokoro مجاني)" : "ضبط سرعة الصوت لتناسب 15 ثانية");
      voice.length = 0;
      words = [];
      let t = START;
      for (const [key, text] of segTexts) {
        const out = await speak(text, voiceId, speed);
        const dur = out.audio.length / out.sampleRate;
        voice.push({ samples: out.audio, sampleRate: out.sampleRate, at: t });
        const seg: Segment = { start: t, end: t + dur };
        segments[key] = seg;
        words.push(...timeWords(text, t + 0.04, t + dur - 0.06));
        t += dur + GAP;
      }
      voiceEnd = t - GAP;
      const limit = REEL_SECONDS - 0.7;
      if (voiceEnd <= limit || attempt >= 1 || speed >= 1.35) break;
      speed = Math.min(1.35, speed * ((voiceEnd - START) / (limit - START)) * 1.02);
      attempt++;
    }
  }

  const duration = voiceEnd + 0.5 > REEL_SECONDS ? Math.min(15.5, voiceEnd + 0.4) : REEL_SECONDS;
  let ctaStart = segments.cta?.start ?? Math.max(voiceEnd - 1.2, duration - 3);
  ctaStart = Math.min(ctaStart, duration - 2.5);

  o.onStep?.("تجهيز الموسيقى والمزج");
  const bed = await loadMusic(o.music, duration);
  const audio = await mixReelAudio({ duration, voice, bed, bedGain: o.musicVolume / 100 });

  const template = (script.templateKey as TemplateKey) || "direct_tip";
  const bodyWords = segments.body ? words.filter(w => w.start >= segments.body!.start - 0.01 && w.end <= segments.body!.end + 0.05) : [];
  const spec: ReelSpec = {
    width: W,
    height: H,
    fps: FPS,
    duration,
    template,
    look: lookOf(character),
    bigTitle: script.onScreenText || script.hook,
    chip: script.onScreenText || "",
    points: template === "three_points" ? derivePoints(script.body, bodyWords) : [],
    comparison: template === "comparison" ? parseComparison(script.onScreenText) : null,
    words,
    ctaText: script.cta || "Follow for more",
    ctaStart,
    segments,
    disclosure: AI_DISCLOSURE,
    bg: { kind: "image", count: images.length },
  };
  return {
    kind: "economic",
    scriptId: script.id,
    characterId: character.id,
    variantLabel: null,
    spec,
    audio,
    images,
    videoBlob: null,
    settingsUsed: {
      voice: o.voiceUrl ? "uploaded" : voiceId,
      speed: Number(speed.toFixed(2)),
      music: o.music.kind === "generated" ? `generated:${o.music.mood}` : o.music.kind,
      musicVolume: o.musicVolume,
      images: o.imageUrls,
      template,
    },
  };
}

export type VideoOptions = {
  script: Script;
  character: Character;
  clip: PremiumClip;
  kind: "derivative" | "premium";
  music: MusicChoice;
  musicVolume: number;
  onStep?: (label: string) => void;
};

export async function prepareVideoBased(o: VideoOptions): Promise<PreparedReel> {
  const { script, character, clip } = o;
  if (!clip.videoUrl) throw new Error("لا يوجد فيديو Premium مرفوع لهذا النص");
  o.onStep?.("تحميل فيديو Premium");
  const videoBlob = await fetchBlob(clip.videoUrl);
  o.onStep?.("استخراج صوت الفيديو");
  const videoAudio = await decodeVideoAudio(videoBlob);
  const vd = (clip.durationMs ?? 8000) / 1000;
  const duration = Math.min(REEL_SECONDS, vd + 3);
  const ctaStart = Math.max(Math.min(vd, duration - 3), duration - 3.5);
  const words: CaptionWord[] = (clip.transcriptWords ?? [])
    .filter(w => w.start < duration)
    .map(w => ({ text: w.word, start: w.start, end: w.end }));
  o.onStep?.("المزج");
  const bed = await loadMusic(o.music, duration);
  const audio = await mixReelAudio({ duration, videoAudio, videoGain: 1, bed, bedGain: o.musicVolume / 100 });
  const template = (script.templateKey as TemplateKey) || "direct_tip";
  const spec: ReelSpec = {
    width: W,
    height: H,
    fps: FPS,
    duration,
    template,
    look: lookOf(character),
    bigTitle: o.kind === "derivative" ? script.hook : script.onScreenText || script.hook,
    chip: o.kind === "derivative" ? script.onScreenText || "" : "",
    points: [],
    comparison: null,
    words,
    ctaText: script.cta || "Follow for more",
    ctaStart,
    segments: {},
    disclosure: AI_DISCLOSURE,
    bg: { kind: "video", videoDuration: vd },
  };
  return {
    kind: o.kind,
    scriptId: script.id,
    characterId: character.id,
    variantLabel: o.kind === "derivative" ? script.notes ?? null : "Premium",
    spec,
    audio,
    images: [],
    videoBlob,
    settingsUsed: {
      premiumClipId: clip.id,
      music: o.music.kind === "generated" ? `generated:${o.music.mood}` : o.music.kind,
      musicVolume: o.musicVolume,
      template,
    },
  };
}
