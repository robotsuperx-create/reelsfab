import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";

export const MIX_RATE = 48000;

export type VoiceClip = { samples: Float32Array; sampleRate: number; at: number };

/** Mixes voice clips, an optional music bed and optional source-video audio into one stereo buffer. */
export async function mixReelAudio(opts: {
  duration: number;
  voice?: VoiceClip[];
  bed?: AudioBuffer | null;
  bedGain?: number;
  videoAudio?: AudioBuffer | null;
  videoGain?: number;
}) {
  const length = Math.ceil(opts.duration * MIX_RATE);
  const ctx = new OfflineAudioContext(2, length, MIX_RATE);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 8;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  comp.connect(ctx.destination);

  for (const v of opts.voice ?? []) {
    if (!v.samples.length) continue;
    const buf = ctx.createBuffer(1, v.samples.length, v.sampleRate);
    buf.copyToChannel(new Float32Array(v.samples), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 1;
    src.connect(g).connect(comp);
    src.start(Math.max(0, v.at));
  }

  if (opts.videoAudio) {
    const src = ctx.createBufferSource();
    src.buffer = opts.videoAudio;
    const g = ctx.createGain();
    g.gain.value = opts.videoGain ?? 1;
    src.connect(g).connect(comp);
    src.start(0);
    src.stop(opts.duration);
  }

  if (opts.bed && (opts.bedGain ?? 0) > 0) {
    const src = ctx.createBufferSource();
    src.buffer = opts.bed;
    src.loop = true;
    const g = ctx.createGain();
    const level = opts.bedGain ?? 0.18;
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(level, 0.6);
    g.gain.setValueAtTime(level, Math.max(0.7, opts.duration - 1.3));
    g.gain.linearRampToValueAtTime(0, opts.duration);
    src.connect(g).connect(comp);
    src.start(0);
    src.stop(opts.duration);
  }

  return ctx.startRendering();
}

const MOODS: Record<string, number[][]> = {
  // Chord progressions as MIDI note sets.
  warm: [
    [57, 60, 64],
    [53, 57, 60],
    [48, 52, 55],
    [55, 59, 62],
  ],
  bright: [
    [60, 64, 67],
    [55, 59, 62],
    [57, 60, 64],
    [53, 57, 60],
  ],
  moody: [
    [57, 60, 64],
    [53, 57, 60],
    [55, 58, 62],
    [52, 55, 59],
  ],
};

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Royalty-free procedural ambient bed (soft pad + sub bass). */
export async function generateMusicBed(duration: number, mood: keyof typeof MOODS = "warm") {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * MIX_RATE), MIX_RATE);
  const master = ctx.createGain();
  master.gain.value = 0.5;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  lp.Q.value = 0.4;
  lp.connect(master).connect(ctx.destination);
  const chords = MOODS[mood] ?? MOODS.warm;
  const chordLen = 2.4;
  const count = Math.ceil(duration / chordLen) + 1;
  for (let i = 0; i < count; i++) {
    const t0 = i * chordLen;
    const notes = chords[i % chords.length];
    for (const n of notes) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = midiHz(n);
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.05, t0 + 0.6);
        g.gain.setValueAtTime(0.05, t0 + chordLen - 0.4);
        g.gain.linearRampToValueAtTime(0, t0 + chordLen + 0.4);
        o.connect(g).connect(lp);
        o.start(t0);
        o.stop(t0 + chordLen + 0.5);
      }
    }
    const b = ctx.createOscillator();
    b.type = "sine";
    b.frequency.value = midiHz(notes[0] - 12);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t0);
    bg.gain.linearRampToValueAtTime(0.12, t0 + 0.08);
    bg.gain.exponentialRampToValueAtTime(0.02, t0 + chordLen);
    b.connect(bg).connect(master);
    b.start(t0);
    b.stop(t0 + chordLen + 0.1);
  }
  return ctx.startRendering();
}

export async function decodeAudioBlob(blob: Blob) {
  const ac = new AudioContext();
  try {
    return await ac.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ac.close();
  }
}

/** Decodes the audio track of a video file into a 48 kHz stereo AudioBuffer (null if silent). */
export async function decodeVideoAudio(blob: Blob, maxSeconds = 30) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) return null;
  const duration = Math.min(maxSeconds, await input.computeDuration());
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * MIX_RATE)), MIX_RATE);
  const sink = new AudioBufferSink(track);
  let any = false;
  for await (const { buffer, timestamp } of sink.buffers(0, duration)) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(Math.max(0, timestamp));
    any = true;
  }
  if (!any) return null;
  return ctx.startRendering();
}

/** Resamples to mono at the given rate. */
export async function toMono(buffer: AudioBuffer, sampleRate: number) {
  const ctx = new OfflineAudioContext(1, Math.ceil(buffer.duration * sampleRate), sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

/** 16-bit PCM WAV encoder. */
export function audioBufferToWav(buffer: AudioBuffer) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const rate = buffer.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o: number, s: string) => s.split("").forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  data.setUint32(4, 36 + len * ch * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  w(36, "data");
  data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buffer.getChannelData(i));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([data.buffer], { type: "audio/wav" });
}

/** Extracts a compact 16 kHz mono WAV from a video (for Whisper transcription). */
export async function extractSpeechWav(videoBlob: Blob) {
  const audio = await decodeVideoAudio(videoBlob, 60);
  if (!audio) return null;
  const mono = await toMono(audio, 16000);
  return audioBufferToWav(mono);
}
