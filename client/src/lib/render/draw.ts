import type { TemplateKey } from "@shared/domain";

export type CaptionWord = { text: string; start: number; end: number };
export type Segment = { start: number; end: number };

export type ReelLook = {
  name: string;
  catchphrase: string;
  colors: { primary: string; accent: string; text: string };
  font: string;
};

export type ReelSpec = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  template: TemplateKey;
  look: ReelLook;
  /** Big on-screen hook card (first ~2.6s). */
  bigTitle: string;
  /** Small persistent title chip after the hook. */
  chip: string;
  points: { text: string; at: number }[];
  comparison: [string, string] | null;
  words: CaptionWord[];
  ctaText: string;
  ctaStart: number;
  segments: { hook?: Segment; body?: Segment; payoff?: Segment; cta?: Segment };
  disclosure: string;
  bg: { kind: "image"; count: number } | { kind: "video"; videoDuration: number };
};

export type BgSource = { source: CanvasImageSource; w: number; h: number };

const HOOK_END = 2.6;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const v = clamp(x);
  return 1 + c3 * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2);
};

function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function font(weight: number, size: number, family: string) {
  return `${weight} ${size}px "${family}", "Montserrat", sans-serif`;
}

function wrap(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bg: BgSource,
  W: number,
  H: number,
  scale: number,
  ox: number,
  oy: number,
  alpha = 1,
) {
  const base = Math.max(W / bg.w, H / bg.h) * scale;
  const dw = bg.w * base;
  const dh = bg.h * base;
  const dx = (W - dw) / 2 + ox * W;
  const dy = (H - dh) / 2 + oy * H;
  ctx.globalAlpha = alpha;
  ctx.drawImage(bg.source, dx, dy, dw, dh);
  ctx.globalAlpha = 1;
}

function motionFor(spec: ReelSpec, t: number) {
  const p = easeInOut(clamp(t / spec.duration));
  switch (spec.template) {
    case "common_mistake":
      return { scale: 1.2, ox: 0.04 - 0.08 * p, oy: -0.01 };
    case "comparison":
      return { scale: 1.08 + 0.1 * p, ox: 0.02 * Math.sin(p * Math.PI * 2), oy: -0.01 };
    case "three_points": {
      const shown = spec.points.filter(pt => t >= pt.at).length;
      return { scale: 1.06 + 0.045 * shown + 0.02 * p, ox: 0, oy: -0.015 * shown };
    }
    case "story_wisdom":
      return { scale: 1.22 - 0.15 * p, ox: 0, oy: 0.01 };
    case "direct_tip":
    default:
      return { scale: 1.05 + 0.15 * p, ox: 0, oy: -0.025 * p };
  }
}

function drawBackground(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  spec: ReelSpec,
  t: number,
  images: BgSource[],
  video: BgSource | null,
) {
  const { width: W, height: H } = spec;
  ctx.fillStyle = spec.look.colors.primary;
  ctx.fillRect(0, 0, W, H);
  if (spec.bg.kind === "video") {
    if (!video) return;
    const vd = spec.bg.videoDuration;
    const hold = t > vd ? clamp((t - vd) / Math.max(0.5, spec.duration - vd)) : 0;
    drawCover(ctx, video, W, H, 1 + 0.08 * easeOut(hold), 0, -0.01 * hold);
    return;
  }
  if (!images.length) return;
  const m = motionFor(spec, t);
  if (images.length === 1) {
    drawCover(ctx, images[0], W, H, m.scale, m.ox, m.oy);
    return;
  }
  const seg = spec.duration / images.length;
  const idx = Math.min(images.length - 1, Math.floor(t / seg));
  const local = t - idx * seg;
  drawCover(ctx, images[idx], W, H, m.scale + 0.03 * (local / seg), m.ox, m.oy);
  const fade = 0.45;
  if (idx < images.length - 1 && seg - local < fade) {
    drawCover(ctx, images[idx + 1], W, H, m.scale, m.ox, m.oy, 1 - (seg - local) / fade);
  }
}

function drawGradients(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, spec: ReelSpec) {
  const { width: W, height: H } = spec;
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.34);
  top.addColorStop(0, "rgba(0,0,0,0.62)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.34);
  const bot = ctx.createLinearGradient(0, H * 0.48, 0, H);
  bot.addColorStop(0, "rgba(0,0,0,0)");
  bot.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = bot;
  ctx.fillRect(0, H * 0.48, W, H * 0.52);
  if (spec.template === "story_wisdom" && spec.bg.kind === "image") {
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.fillRect(0, 0, W, H * 0.045);
    ctx.fillRect(0, H * 0.955, W, H * 0.045);
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
    v.addColorStop(0, "rgba(40,20,0,0)");
    v.addColorStop(1, "rgba(40,20,0,0.35)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawDisclosure(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, spec: ReelSpec) {
  const x = 48;
  const y = 128;
  ctx.font = font(700, 30, "Montserrat");
  const tw = ctx.measureText(spec.disclosure).width;
  const w = tw + 74;
  const h = 56;
  roundRect(ctx, x, y, w, h, 28);
  ctx.fillStyle = "rgba(0,0,0,0.58)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 30, y + h / 2, 8, 0, Math.PI * 2);
  ctx.fillStyle = spec.look.colors.accent;
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(spec.disclosure, x + 52, y + h / 2 + 1);
}

function drawHookCard(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, spec: ReelSpec, t: number) {
  if (t >= HOOK_END || !spec.bigTitle) return;
  const { width: W, height: H } = spec;
  const pop = easeOutBack(t / 0.32);
  const fade = t > HOOK_END - 0.25 ? clamp((HOOK_END - t) / 0.25) : 1;
  const size = spec.bigTitle.length > 48 ? 70 : 84;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(W / 2, H * 0.27);
  const s = 0.82 + 0.18 * pop;
  ctx.scale(s, s);
  ctx.font = font(900, size, spec.look.font);
  const lines = wrap(ctx, spec.bigTitle.toUpperCase(), W * 0.8).slice(0, 4);
  const lh = size * 1.22;
  const total = lines.length * lh;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    const y = -total / 2 + i * lh + lh / 2;
    const w = ctx.measureText(line).width + 44;
    roundRect(ctx, -w / 2, y - lh / 2 + 4, w, lh - 8, 14);
    ctx.fillStyle = i % 2 === 0 ? spec.look.colors.accent : "#FFFFFF";
    ctx.fill();
    ctx.fillStyle = spec.look.colors.primary;
    ctx.fillText(line, 0, y + 3);
  });
  ctx.restore();
}

function drawChip(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, spec: ReelSpec, t: number) {
  if (t < HOOK_END || t >= spec.ctaStart || !spec.chip) return;
  if (spec.template === "comparison" && spec.comparison) return;
  const { width: W, height: H } = spec;
  const a = easeOut((t - HOOK_END) / 0.3);
  ctx.save();
  ctx.globalAlpha = a;
  let label = "";
  let labelColor = spec.look.colors.accent;
  if (spec.template === "direct_tip") label = "TIP";
  if (spec.template === "common_mistake") {
    const fixAt = spec.segments.payoff?.start ?? spec.duration;
    if (t >= fixAt) {
      label = "THE FIX";
      labelColor = "#2BD47D";
    } else {
      label = "THE MISTAKE";
      labelColor = "#FF4D4D";
    }
  }
  if (spec.template === "story_wisdom") label = "STORY";
  ctx.font = font(800, 44, spec.look.font);
  const text = spec.chip.toUpperCase();
  const lines = wrap(ctx, text, W * 0.78).slice(0, 2);
  const lh = 56;
  let y = H * 0.115;
  if (label) {
    ctx.font = font(900, 30, "Montserrat");
    const lw = ctx.measureText(label).width + 36;
    roundRect(ctx, W / 2 - lw / 2, y - 26, lw, 48, 10);
    ctx.fillStyle = labelColor;
    ctx.fill();
    ctx.fillStyle = "#111111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, W / 2, y);
    y += 62;
  }
  ctx.font = font(800, 44, spec.look.font);
  const maxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 56;
  roundRect(ctx, W / 2 - maxW / 2, y - 34, maxW, lines.length * lh + 16, 16);
  ctx.fillStyle = hexA(spec.look.colors.primary, 0.82);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y + i * lh + 4));
  ctx.restore();
}

function drawComparison(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, spec: ReelSpec, t: number) {
  if (spec.template !== "comparison" || !spec.comparison || t < HOOK_END || t >= spec.ctaStart) return;
  const { width: W, height: H } = spec;
  const a = easeOut((t - HOOK_END) / 0.35);
  const y = H * 0.16;
  ctx.save();
  ctx.globalAlpha = a;
  const pillW = W * 0.38;
  const pillH = 120;
  const pick = spec.segments.payoff && t >= spec.segments.payoff.start ? 1 : -1;
  spec.comparison.forEach((label, i) => {
    const x = i === 0 ? W * 0.07 : W * 0.55;
    roundRect(ctx, x, y, pillW, pillH, 22);
    const chosen = pick === i;
    ctx.fillStyle = chosen ? spec.look.colors.accent : hexA(spec.look.colors.primary, 0.85);
    ctx.fill();
    ctx.font = font(800, label.length > 14 ? 36 : 44, spec.look.font);
    ctx.fillStyle = chosen ? spec.look.colors.primary : "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = wrap(ctx, label.toUpperCase(), pillW - 30).slice(0, 2);
    lines.forEach((l, k) => ctx.fillText(l, x + pillW / 2, y + pillH / 2 + (k - (lines.length - 1) / 2) * 42));
  });
  ctx.beginPath();
  ctx.arc(W / 2, y + pillH / 2, 54, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.font = font(900, 44, "Anton");
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VS", W / 2, y + pillH / 2 + 2);
  ctx.restore();
}

function drawPoints(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, spec: ReelSpec, t: number) {
  if (spec.template !== "three_points" || !spec.points.length || t >= spec.ctaStart) return;
  const { width: W, height: H } = spec;
  let y = H * 0.33;
  ctx.save();
  spec.points.forEach((pt, i) => {
    if (t < pt.at) return;
    const a = easeOut((t - pt.at) / 0.3);
    ctx.globalAlpha = a;
    const x = W * 0.08 + (1 - a) * 60;
    ctx.font = font(800, 46, spec.look.font);
    const lines = wrap(ctx, pt.text, W * 0.66).slice(0, 2);
    const h = 40 + lines.length * 56;
    roundRect(ctx, x, y, W * 0.84, h, 20);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 62, y + h / 2, 38, 0, Math.PI * 2);
    ctx.fillStyle = spec.look.colors.accent;
    ctx.fill();
    ctx.font = font(900, 44, "Montserrat");
    ctx.fillStyle = spec.look.colors.primary;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), x + 62, y + h / 2 + 2);
    ctx.font = font(800, 46, spec.look.font);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";
    lines.forEach((l, k) => ctx.fillText(l, x + 124, y + 20 + 28 + k * 56));
    y += h + 22;
  });
  ctx.restore();
}

/** Groups words into short caption chunks (max 3 words, break on punctuation). */
export function chunkWords(words: CaptionWord[]) {
  const chunks: CaptionWord[][] = [];
  let cur: CaptionWord[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= 3 || /[.,!?;:]$/.test(w.text)) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function drawCaptions(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  spec: ReelSpec,
  t: number,
  chunks: CaptionWord[][],
) {
  if (!chunks.length) return;
  let idx = -1;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i][0].start <= t) idx = i;
    else break;
  }
  if (idx === -1) return;
  const chunk = chunks[idx];
  const last = chunk[chunk.length - 1];
  const nextStart = chunks[idx + 1]?.[0].start ?? Infinity;
  if (t > last.end + 0.6 && t < nextStart) return;
  const { width: W, height: H } = spec;
  const size = 80;
  ctx.save();
  ctx.font = font(900, size, spec.look.font);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  const texts = chunk.map(w => w.text.toUpperCase());
  const space = ctx.measureText(" ").width;
  const widths = texts.map(s => ctx.measureText(s).width);
  // Layout on up to 2 lines.
  const maxW = W * 0.86;
  const lines: number[][] = [[]];
  let lw = 0;
  texts.forEach((_, i) => {
    const add = widths[i] + (lines[lines.length - 1].length ? space : 0);
    if (lw + add > maxW && lines[lines.length - 1].length) {
      lines.push([i]);
      lw = widths[i];
    } else {
      lines[lines.length - 1].push(i);
      lw += add;
    }
  });
  const pop = 1 + 0.08 * (1 - easeOut((t - chunk[0].start) / 0.12));
  const cy = H * 0.665;
  ctx.translate(W / 2, cy);
  ctx.scale(pop, pop);
  const lh = size * 1.15;
  lines.forEach((ln, li) => {
    const total = ln.reduce((a, i, k) => a + widths[i] + (k ? space : 0), 0);
    let x = -total / 2;
    const y = (li - (lines.length - 1) / 2) * lh;
    ln.forEach(i => {
      const w = chunk[i];
      const active = t >= w.start && t < w.end + 0.05;
      ctx.lineWidth = 14;
      ctx.strokeStyle = "rgba(0,0,0,0.92)";
      ctx.strokeText(texts[i], x, y);
      ctx.fillStyle = active ? spec.look.colors.accent : "#FFFFFF";
      ctx.fillText(texts[i], x, y);
      x += widths[i] + space;
    });
  });
  ctx.restore();
}

function drawCta(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, spec: ReelSpec, t: number) {
  if (t < spec.ctaStart) return;
  const { width: W, height: H } = spec;
  const a = easeOut((t - spec.ctaStart) / 0.4);
  const x = W * 0.08;
  const w = W * 0.84;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(0, (1 - a) * 80);
  ctx.font = font(900, 56, spec.look.font);
  const ctaLines = wrap(ctx, spec.ctaText.toUpperCase(), w - 100).slice(0, 2);
  const hasPhrase = Boolean(spec.look.catchphrase);
  const h = 70 + ctaLines.length * 66 + 58 + (hasPhrase ? 50 : 0);
  const y = H * 0.4;
  roundRect(ctx, x, y, w, h, 28);
  ctx.fillStyle = hexA(spec.look.colors.primary, 0.93);
  ctx.fill();
  ctx.fillStyle = spec.look.colors.accent;
  roundRect(ctx, x, y, 16, h, 8);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = font(900, 56, spec.look.font);
  ctaLines.forEach((l, i) => ctx.fillText(l, x + 56, y + 92 + i * 66));
  let yy = y + 92 + ctaLines.length * 66;
  ctx.font = font(700, 36, "Montserrat");
  ctx.fillStyle = spec.look.colors.accent;
  ctx.fillText(spec.look.name, x + 56, yy);
  if (hasPhrase) {
    yy += 50;
    ctx.font = `italic 600 34px "Playfair Display", serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(`“${spec.look.catchphrase}”`, x + 56, yy);
  }
  ctx.restore();
}

function drawProgress(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, spec: ReelSpec, t: number) {
  const { width: W } = spec;
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, 0, W, 8);
  ctx.fillStyle = spec.look.colors.accent;
  ctx.fillRect(0, 0, W * clamp(t / spec.duration), 8);
}

export type FrameCache = { chunks: CaptionWord[][] };

export function makeFrameCache(spec: ReelSpec): FrameCache {
  return { chunks: chunkWords(spec.words) };
}

export function drawFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  spec: ReelSpec,
  t: number,
  cache: FrameCache,
  images: BgSource[],
  video: BgSource | null,
) {
  ctx.save();
  drawBackground(ctx, spec, t, images, video);
  drawGradients(ctx, spec);
  drawProgress(ctx, spec, t);
  drawDisclosure(ctx, spec);
  drawHookCard(ctx, spec, t);
  drawChip(ctx, spec, t);
  drawComparison(ctx, spec, t);
  drawPoints(ctx, spec, t);
  drawCta(ctx, spec, t);
  drawCaptions(ctx, spec, t, cache.chunks);
  ctx.restore();
}

export async function ensureFonts(family: string) {
  if (typeof document === "undefined" || !document.fonts) return;
  const loads = [
    `900 80px "${family}"`,
    `800 46px "${family}"`,
    `700 36px "Montserrat"`,
    `900 44px "Montserrat"`,
    `400 44px "Anton"`,
    `italic 600 34px "Playfair Display"`,
  ].map(f => document.fonts.load(f).catch(() => undefined));
  await Promise.all(loads);
}
