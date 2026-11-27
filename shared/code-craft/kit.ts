/**
 * The motion kit (window.CV) inside pages: a page asks for it with `<script data-cv-kit></script>` (or simply calls
 * CV.play / CV.create), and expandKit() inlines the kit right there, plus GSAP and the kit's fonts when missing.
 * Pages are stored with the placeholder only, so a better kit improves every re-render.
 */
import { CV_KIT_SOURCE, CV_KIT_VERSION } from "./kit-source";

export { CV_KIT_VERSION };

export const GSAP_URL = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js";
export const KIT_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Alexandria:wght@600;800;900&family=Cairo:wght@400;700;900&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&family=Readex+Pro:wght@400;500;700&display=block";
export const KIT_PLACEHOLDER = "<script data-cv-kit></script>";

export const KIT_THEMES = ["documentary", "kinetic", "neon", "infographic", "storybook"] as const;
export type KitTheme = (typeof KIT_THEMES)[number];
export const KIT_ICONS = ["check", "x", "arrow", "arrow-up", "arrow-down", "alert", "money", "chart-up", "chart-down", "globe", "person", "people", "clock", "lock", "fire", "star", "bolt", "house", "phone", "eye", "target", "scale", "bank", "oil", "shield", "flag", "spark", "question"] as const;

const PLACEHOLDER_RE = /<script\b[^>]*\bdata-cv-kit\b[^>]*>\s*<\/script>/i;

/** True when the page relies on the kit. */
export function usesKit(html: string) {
  return PLACEHOLDER_RE.test(html) || /\bCV\.(play|create)\s*\(/.test(html);
}

function insertInHead(html: string, tags: string) {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tags + html.slice(head.index + head[0].length);
  const htmlTag = /<html(\s[^>]*)?>/i.exec(html);
  if (htmlTag) return html.slice(0, htmlTag.index + htmlTag[0].length) + `<head>${tags}</head>` + html.slice(htmlTag.index + htmlTag[0].length);
  return `<head>${tags}</head>${html}`;
}

/**
 * Inlines the kit where the page asks for it (or at the end of <head> when the page only calls CV.*), and makes sure
 * GSAP loads before it and the kit's fonts are linked. Pages that don't use the kit come back unchanged.
 */
export function expandKit(html: string) {
  if (!usesKit(html)) return html;
  const kit = `<script data-cv-kit-version="${CV_KIT_VERSION}">${CV_KIT_SOURCE}</script>`;
  let out = html;
  const hasGsap = /<script[^>]+src=["'][^"']*gsap(\.min)?\.js["']/i.test(out);
  const hasFonts = out.includes("fonts.googleapis.com/css2?family=Alexandria") && out.includes("Readex+Pro");
  const before = `${hasFonts ? "" : `<link href="${KIT_FONTS_URL}" rel="stylesheet">`}${hasGsap ? "" : `<script src="${GSAP_URL}"></script>`}`;
  if (PLACEHOLDER_RE.test(out)) {
    out = out.replace(PLACEHOLDER_RE, () => before + kit);
  } else {
    // Only calls CV.*: the kit has to exist before the first script that calls it.
    const first = /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?\bCV\.(play|create)\s*\(/i.exec(out);
    const at = first ? first.index : -1;
    out = at >= 0 ? out.slice(0, at) + before + kit + out.slice(at) : insertInHead(out, before + kit);
  }
  return out;
}

/** What a writer (the agent, or any AI) needs to build a page with the kit by hand. */
export const KIT_API_DOC = `MOTION KIT (window.CV) — a tested design system for this recorder. Prefer it over hand-built layout and motion.
Load it with exactly: <script data-cv-kit></script> (the room inlines the kit there, with GSAP and the fonts).
Then, in one <script> after it:
  const cv = CV.create({ width, height, duration, theme: "documentary"|"kinetic"|"neon"|"infographic"|"storybook", accent?: "#hex", lang: "ar"|"en"|..., sound?: { mood: "tense"|"upbeat"|"tech"|"calm"|"playful"|"epic" } });
  cv.progress();                       // optional thin progress bar
  const s = cv.scene({ from: 0, to: 3.2, transition: "rise"|"fade"|"mask"|"zoom"|"slide"|"flash"|"cut"|"iris"|"stripes"|"whip"|"glitch", camera: "push"|"pull"|"drift"|"none",
                       fx: ["confetti"|"sparkles"|"shake"|"rings"|"lightleak"|"letterbox"|"dust"|"glitch"], fxEmoji: "💸" });
  s.kicker("...").title("...", { emphasis: ["word"] }).text("...");     // stacked, centred in the safe area
  s.kinetic(["line 1", "line 2"], { emphasis: [] }) · s.stat({ value: 42, prefix: "", suffix: "%", label: "..." })
  s.bars([{ label, value }], { unit: "%" }) · s.list(["..."], { numbered: true }) · s.timeline([{ date, text }])
  s.compare({ left: { title, items: [] }, right: { title, items: [] } }) · s.quote("...", { by: "..." }) · s.icon("globe")
  s.emoji("🔥", { motion: "float"|"bounce"|"spin"|"pulse"|"wiggle", size: 240 })   // glossy 3D emoji
  s.divider() · s.cta("...") · s.source("...") · s.lowerThird(name, role)
  // Pictures and maps are easier through a storyboard (CV.play): the studio fetches them and draws the maps.
  cv.cue(seconds, "impact"|"hit"|"whoosh"|"pop"|"ding"|"chime"|"riser"|"sparkle"|..., gain)   // extra sound (kit movements already make theirs)
  // every component takes { at: seconds from the scene start } — omit it and items follow one another.
  cv.end({ text: "...", cta: "...", seconds: 2.6 });   // optional composed final card
  cv.finish();                         // REQUIRED last call: fixes the exact duration
  cv.tl is the master GSAP timeline (absolute seconds) if you add custom tweens; cv.stage is the root element.
Scenes must follow one another without gaps (from = previous to). Icons: ${KIT_ICONS.join(", ")}.`;
