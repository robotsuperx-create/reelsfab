/** Builds the ASS subtitle script (hook, word-by-word captions, AI badge, CTA card) for a reel. */

export type CaptionStyle = "karaoke" | "classic" | "boxed" | "none";
export type CaptionPosition = "bottom" | "center";

export type AssInput = {
  words: { word: string; start: number; end: number }[];
  hook: string | null;
  cta: string | null;
  disclosure: string;
  durationSec: number;
  font: string;
  colors: { primary: string; accent: string; text: string };
  /** Caption look; "karaoke" (active word in the accent colour) is the studio default. */
  captionStyle?: CaptionStyle;
  captionPosition?: CaptionPosition;
  /** Length of the CTA card at the end (default 2.6s). */
  ctaSeconds?: number;
};

/** "#RRGGBB" -> ASS "&HBBGGRR&" (alpha handled separately). */
export function assColor(hex: string, fallback = "#FFFFFF") {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) ?? /^#?([0-9a-f]{6})$/i.exec(fallback)!;
  const [r, g, b] = [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)];
  return `&H${b}${g}${r}&`.toUpperCase();
}

export function assTime(sec: number) {
  const s = Math.max(0, sec);
  const cs = Math.round((s % 1) * 100);
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const c = cs === 100 ? 99 : cs;
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

export function assEscape(text: string) {
  return text.replace(/\\/g, "").replace(/[{}]/g, "").replace(/\r?\n/g, " ").trim();
}

/** Spreads the words of `text` over [start, start+duration] proportionally to length (+ pause after punctuation). */
export function wordTimings(text: string, start: number, duration: number) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const weights = tokens.map(t => t.replace(/[^\p{L}\p{N}]/gu, "").length + 1 + (/[.!?]$/.test(t) ? 2.5 : /[,;:]$/.test(t) ? 1.2 : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  let cursor = start;
  return tokens.map((word, i) => {
    const len = (weights[i] / sum) * duration;
    const out = { word, start: cursor, end: cursor + len };
    cursor += len;
    return out;
  });
}

const CTA_SECONDS = 2.6;

/** Groups caption words into display chunks: 3 for word-by-word styles, up to 5 (or a sentence end) for classic. */
export function chunkWords<T extends { word: string }>(words: T[], style: CaptionStyle) {
  const groups: T[][] = [];
  if (style === "classic") {
    let cur: T[] = [];
    for (const w of words) {
      cur.push(w);
      if (cur.length >= 5 || /[.!?]$/.test(w.word)) {
        groups.push(cur);
        cur = [];
      }
    }
    if (cur.length) groups.push(cur);
    return groups;
  }
  for (let g = 0; g < words.length; g += 3) groups.push(words.slice(g, g + 3));
  return groups;
}

export function buildAss(input: AssInput) {
  const { colors, font } = input;
  const style = input.captionStyle ?? "karaoke";
  const position = input.captionPosition ?? "bottom";
  const ctaSeconds = input.ctaSeconds ?? CTA_SECONDS;
  const accent = assColor(colors.accent, "#DFFF00");
  const text = assColor(colors.text, "#FFFFFF");
  const primary = assColor(colors.primary, "#000000");
  const safeFont = assEscape(font) || "DejaVu Sans";
  // Alignment 2 = bottom centre with a margin above the platform UI; 5 = dead centre.
  const place = position === "center" ? "5,60,60,0" : "2,60,60,430";
  const capStyle =
    style === "boxed"
      ? `Style: Cap,${safeFont},80,${text},${text},${primary},${primary},-1,0,0,0,100,100,0,0,3,18,0,${place},1`
      : style === "classic"
        ? `Style: Cap,${safeFont},76,${text},${text},&H00000000&,&H64000000&,-1,0,0,0,100,100,0,0,1,6,2,${place},1`
        : `Style: Cap,${safeFont},86,${text},${text},&H00000000&,&H64000000&,-1,0,0,0,100,100,0,0,1,7,2,${place},1`;
  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    capStyle,
    `Style: Hook,${safeFont},74,${text},${text},&H00000000&,&H96000000&,-1,0,0,0,100,100,0,0,1,6,3,8,70,70,250,1`,
    `Style: Badge,${safeFont},32,${text},${text},&H00000000&,&H78000000&,-1,0,0,0,100,100,1,0,3,10,0,7,40,40,56,1`,
    `Style: Cta,${safeFont},68,${primary},${primary},${accent},${accent},-1,0,0,0,100,100,0,0,3,26,0,2,60,60,200,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const dur = input.durationSec;
  const push = (style: string, s: number, e: number, txt: string, layer = 0) =>
    lines.push(`Dialogue: ${layer},${assTime(s)},${assTime(Math.min(e, dur))},${style},,0,0,0,,${txt}`);

  // Persistent AI disclosure badge.
  push("Badge", 0, dur, assEscape(input.disclosure), 5);

  // Hook text for the opening seconds.
  if (input.hook) push("Hook", 0, Math.min(3.2, dur), `{\\fad(150,250)}${assEscape(input.hook).toUpperCase()}`, 2);

  // Captions: word-by-word styles light the active word in the accent colour; classic shows whole phrases.
  const ctaStart = Math.max(0, dur - ctaSeconds);
  const words = style === "none" ? [] : input.words.filter(w => w.word.trim());
  const capEnd = input.cta ? ctaStart : dur;
  for (const group of chunkWords(words, style)) {
    if (style === "classic") {
      const start = group[0].start;
      const end = Math.max(group[group.length - 1].end, start + 0.3);
      if (start >= ctaStart && input.cta) continue;
      push("Cap", start, Math.min(end, capEnd), group.map(x => assEscape(x.word)).join(" "), 1);
      continue;
    }
    group.forEach((w, i) => {
      const start = w.start;
      const end = i === group.length - 1 ? Math.max(w.end, start + 0.12) : group[i + 1].start;
      if (start >= ctaStart && input.cta) return; // the CTA card owns the tail
      const body = group
        .map((x, k) => (k === i ? `{\\c${accent}}${assEscape(x.word)}{\\c${text}}` : assEscape(x.word)))
        .join(" ");
      push("Cap", start, Math.min(end, capEnd), body, 1);
    });
  }

  if (input.cta) push("Cta", ctaStart, dur, `{\\fad(200,0)}${assEscape(input.cta)}`, 3);
  return lines.join("\n") + "\n";
}
