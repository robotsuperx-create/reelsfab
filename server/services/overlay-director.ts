/**
 * The overlay director: watches the map of the owner's video (aligned words, scenes, where faces are) and writes a
 * short JSON plan of motion graphics on top. The brief carries the editing craft of top talking-head channels, so
 * the strongest treatment is chosen every time; a tested runtime renders it (the model never writes animation code).
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { extractJsonObject } from "../../shared/code-craft/storyboard";
import { compileOverlay, OVERLAY_ICONS, parseOverlayPlan, type CompiledOverlay, type OverlayPlan } from "../../shared/overlay";
import { storageDownload, storageKeyFromUrl } from "../storage";
import { importWikiImage } from "./code-media";
import { importStockPhoto, importStockVideo, searchStockPhotos, searchStockVideos } from "./stock";
import type { VideoMap } from "./video-understanding";

const run = promisify(execFile);

export const OVERLAY_BRIEF = `You are the editor and motion designer of a top talking-head channel. You get the full map of a real video (what is said word by word with exact timings, the scenes, where the person's face is) and you decide the motion graphics laid over it. A tested engine renders them at broadcast quality — you NEVER write code, only a JSON plan.

YOU ARE THE EDITOR, NOT A SUBTITLER. Unless the owner explicitly limits you, deliver a full professional edit: grade the footage, choose music, cut to b-roll on the images the words evoke, punch in on the face, mark the turning word with an effect (a crack on "destroy/break", a warm glow and particles on "love/memory"), add the key line as a punch or icon, and close on a quote card when the speech ends before the video does. "Do your best", "free hand", "اعمل ما في جهدك" = the full treatment. Captions alone are NEVER an edit.

THE OWNER'S INSTRUCTION COMES FIRST. Everything below is a default: when the owner asks for a colour, a caption style, captions off, "a symbol for every sentence", a name, a density — do exactly that (white captions → "accent":"white" or caption style "clean"; "an animated icon for each word/sentence" → one icon or punch per phrase, every 1.5–3 s, each fitting what is said at that moment).

THE CRAFT (what separates a great edit from noise)
- Graphics serve the speech. By default pick the 4–10 strongest moments per minute (a short clip under 20 s: one every 2–4 s) — a key claim, a number, a list, a turn, a name — and land each one EXACTLY on the word that carries it. Silence between graphics is part of the rhythm.
- A punch line is a REWRITE, not a transcript: the idea in 2–5 punchy words, in the video's language (Arabic speech → Arabic text, same dialect register). Never copy a whole sentence. Never invent facts that were not said.
- Timing: "at" = the index of the word that triggers it — the element appears when that word is HEARD, never before. "until" = the index of the word where the idea ends (it holds 0.45 s past it). A punch holds at least ~1.5 s, usually 2–4 s; the viewer must be able to read it.
- Max 2 graphics on screen at once (captions not counted). Never cover the face: use the FREE areas listed for that moment; faces are usually in the upper half of a talking-head frame, so "lower"/"center" or "top" are often the safe bands — check the frame list.
- Variety: alternate punch styles, mix in icons, counters and lists; never the same treatment three times in a row.
- Zoom punches (camera punch-in on the speaker) on emphasis: every 5–10 s, "scale" 1.1–1.25, "x","y" = the face centre in % of the frame (from the subject box), hold 1.5–5 s, ease "cut" for punchy jump-cut energy, "smooth" for a slow push on an emotional line. Never two zooms closer than ~3 s.
- Captions: word-synced captions are ON for talking videos (most viewers watch muted) unless the owner says no or the frames already have burned-in text. 2–4 words per caption chunk.
- Accent: one accent colour for the whole video (yellow = energetic default, gold = premium/money, red = urgent/news, green = growth/health, blue = tech/calm, orange, pink).

ELEMENTS (each needs "type" and "at"; "until" optional)
- punch: {"type":"punch","at":12,"until":19,"text":"2–5 words","style":"slam|show|highlight|kicker|stamp|typewriter","color":"accent|white|red|yellow|green|blue","emphasis":"one word of the text in accent","position":"top|upper|center|lower|bottom","size":"xl|l|m|s","strikeAt":<word index, optional: a red line strikes the text — for myths, wrong beliefs, 'not X'>}
  slam = the key claim (big, lands hard) · show = a calm line, words rise one by one · highlight = dark text on an accent marker bar (very readable — definitions, takeaways) · kicker = small label/heading ("الخطوة الأولى", "TIP") · stamp = verdict word ("خطأ", "مجاني", "100%") · typewriter = a quote or a search/question.
- counter: {"type":"counter","at":i,"until":j,"from":0,"to":250000,"prefix":"$","suffix":"+","decimals":0,"label":"short label","position":...} — whenever a number is said (money, %, years, people). The number counts up as it is said.
- icon: {"type":"icon","at":i,"until":j,"icon":"<name from ICONS>","label":"1–3 words","color":"accent","position":...,"side":"left|center|right"} — a concrete concept (money, time, growth, warning, idea, check, phone…). The icon pops in a badge and draws itself.
- list: {"type":"list","at":i,"until":j,"title":"optional","items":[{"text":"…","at":k},…],"position":...} — when the speaker enumerates (steps, reasons, mistakes). Each item ticks in at ITS word.
- lower3: {"type":"lower3","at":i,"until":j,"name":"…","role":"…"} — the speaker's name and title in the first seconds, ONLY if the owner gave the name.
- chapter: {"type":"chapter","at":i,"until":j,"num":"01","title":"…"} — a new section in a long video (≥ 90 s); 1.5–2.5 s.
- photo: {"type":"photo","at":i,"until":j,"wiki":"exact English Wikipedia title","caption":"…","position":...,"side":"left|right"} — a named person, place, company or product that has a Wikipedia article; or "query":"2–4 English words" for a generic picture. Hold 2–4 s.
- zoom: {"type":"zoom","at":i,"until":j,"scale":1.15,"x":50,"y":35,"ease":"cut|smooth"}
- flash: {"type":"flash","at":i} — a white flash on a big reveal; rare (0–2 per video).
- cutaway: {"type":"cutaway","at":i,"until":j,"query":"2–5 English words for a free stock clip","transition":"dissolve|cut"} — full-frame b-roll of what the words evoke ("couple arguing silhouette", "holding hands sunset", "old couple walking", "city night traffic"); her voice continues under it. 1–4 s each, never over the first 1.5 s (the viewer must meet the speaker first), at most ~35% of the video, and always come back to the speaker for the key line.
- crack: {"type":"crack","at":i,"until":j,"x":50,"y":45} — the screen cracks from a point on a word of breaking/destroying/betrayal (with an impact sound); pair it with a cut zoom.
- glow: {"type":"glow","at":i,"until":j,"color":"warm|gold|red|cold|pink"} — a light leak washing over the frame: love, warmth, memory, hope (2–5 s).
- particles: {"type":"particles","at":i,"until":j,"kind":"hearts|bokeh|sparks|dust|snow"} — atmosphere under the text: bokeh/hearts for love, sparks for success, dust for nostalgia. Subtle, 2–6 s.
- quote: {"type":"quote","at":i or "t":seconds,"end":seconds,"text":"the message in one line","emphasis":"the key word","author":"optional"} — the closing card in elegant type; use it when the speech ends and the video still runs (a smile, a look), or for the final takeaway. Captions hide while it is up.

PLAN-LEVEL CHOICES
- "grade": {"look":"natural|warm|cinematic|cold|vivid|bw","enhance":true} — always grade: warm for intimate/emotional talk, cinematic for drama/storytelling, cold for tech/business, vivid for energetic/lifestyle. "enhance" cleans and sharpens phone footage and lifts it when it is dark (keep true).
- "music": {"mood":"calm|epic|tense|upbeat|tech|playful|none","volume":0.35–0.6} — a bed under the voice (it ducks automatically while she speaks): calm for emotional/advice, upbeat for energetic, tense for drama. "none" only if the owner asks.
- Caption style "reveal" = each word fades in as it is spoken, white, elegant — the right style for emotional or poetic speech; "pop" for energetic talk.

ICONS: ${OVERLAY_ICONS.join(", ")}

OUTPUT (JSON only):
{"accent":"yellow","grade":{"look":"warm","enhance":true},"music":{"mood":"calm","volume":0.45},"captions":{"on":true,"style":"pop|box|karaoke|clean|reveal","position":"lower|bottom|center","words":3},"sfx":true,"progress":false,"items":[ … in time order … ]}`;

export function overlayPrompt(map: VideoMap, idea: string, w: number, h: number) {
  const lines: string[] = [];
  lines.push(`VIDEO ${w}x${h} (${h > w ? "vertical" : "wide"}), ${map.duration.toFixed(2)} s, speech: ${map.transcriber === "none" ? "none (use \"t\"/\"end\" in seconds instead of word indexes)" : map.language ?? "detected"}`);
  lines.push(`WHAT THE OWNER WANTS: """${idea}"""`);
  lines.push("SCENES:");
  for (const s of map.scenes) lines.push(`- #${s.index} ${s.start.toFixed(1)}–${s.end.toFixed(1)} s: ${s.summary}`);
  lines.push("FRAMES (t s | what | subject box x,y,w,h in % | free areas):");
  for (const f of map.frames) lines.push(`- ${f.t.toFixed(1)} | ${f.what}${f.subject ? ` | ${f.subject} ${f.subjectBox ? f.subjectBox.map(n => Math.round(n)).join(",") : ""}` : ""} | free: ${f.free.join(", ") || "?"}${f.textOnScreen ? ` | burned-in text: ${f.textOnScreen}` : ""}`);
  if (map.words.length) {
    lines.push("SENTENCES:");
    for (const s of map.sentences) lines.push(`- ${s.start.toFixed(1)}–${s.end.toFixed(1)} s: ${s.text}`);
    lines.push("WORDS — index:word@start (seconds). Use the INDEX for at / until / strikeAt / list items:");
    lines.push(map.words.map((x, i) => `${i}:${x.word.trim()}@${x.start.toFixed(2)}`).join(" "));
  }
  return lines.join("\n");
}

export type Ask = (system: string, prompt: string, what: string) => Promise<string>;

/** Writes the plan, compiles it against the real timings, and sends it back once with what is wrong. */
export async function writeOverlayPlan(o: { map: VideoMap; idea: string; w: number; h: number; ask: Ask; log?: (s: string) => Promise<void>; feedback?: string[]; previous?: OverlayPlan }) {
  const system = `${OVERLAY_BRIEF}\nAnswer with the JSON object only.`;
  const prompt = overlayPrompt(o.map, o.idea, o.w, o.h);
  const compile = (plan: OverlayPlan) => compileOverlay(plan, { words: o.map.words, frames: o.map.frames, duration: o.map.duration, w: o.w, h: o.h });
  const parse = (raw: string) => parseOverlayPlan(extractJsonObject(raw));
  let first: ReturnType<typeof parse>;
  const ask1 = o.previous && o.feedback?.length
    ? `${prompt}\n\nYOUR PLAN:\n${JSON.stringify(o.previous)}\n\nA reviewer watched it on the real frames and found:\n${o.feedback.map(f => `- ${f}`).join("\n")}\nFix every point. Return the whole corrected JSON.`
    : prompt;
  try {
    first = parse(await o.ask(system, ask1, o.previous ? "تحسين الخطة" : "خطة الأنيميشن"));
  } catch {
    first = parse(await o.ask(system, `${ask1}\n\nYour last answer was not valid JSON. Return ONLY the JSON object.`, "خطة الأنيميشن (إعادة)"));
  }
  let plan = first.plan;
  let compiled = compile(plan);
  const issues = [...first.dropped, ...compiled.problems];
  if (!plan.items.length) issues.push("the plan has no elements — add the strongest moments");
  if (issues.length) {
    await o.log?.(`› ${issues.length} ملاحظة على الخطة — يصلحها`);
    try {
      const again = parse(await o.ask(system, `${prompt}\n\nYOUR PLAN:\n${JSON.stringify(plan)}\n\nFIX THESE:\n${issues.slice(0, 14).map(p => `- ${p}`).join("\n")}\n\nReturn the whole corrected JSON.`, "مراجعة الخطة"));
      const c2 = compile(again.plan);
      if (again.plan.items.length && again.dropped.length + c2.problems.length <= issues.length) { plan = again.plan; compiled = c2; }
    } catch { /* keep the first */ }
  }
  return { plan, compiled };
}

/* ------------------------------------------------------------------ icons and pictures for the page */

const ICON_DIR = resolve(process.cwd(), "node_modules", "lucide-react", "dist", "esm", "icons");
const kebab = (s: string) => s.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
/** SVG body of a lucide icon (its child elements), read from the installed package. */
export function iconSvg(name: string): string | null {
  const safe = name.toLowerCase().replace(/[^a-z0-9-]/g, "");
  let src: string;
  try { src = readFileSync(join(ICON_DIR, `${safe}.js`), "utf8"); } catch { return null; }
  const out: string[] = [];
  for (const m of src.matchAll(/\[\s*"(\w+)",\s*\{([^}]*)\}\s*\]/g)) {
    const attrs = [...m[2].matchAll(/(\w+):\s*"([^"]*)"/g)].filter(a => a[1] !== "key").map(a => `${kebab(a[1])}="${a[2].replace(/"/g, "&quot;")}"`);
    out.push(`<${m[1]} ${attrs.join(" ")}/>`);
  }
  return out.length ? out.join("") : null;
}

/** Pictures named in the plan → small JPEG data URIs (the render page has no network access to the studio). */
export async function resolveOverlayPhotos(compiled: CompiledOverlay, userId: number | null, log?: (s: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "overlay-photos-"));
  try {
    for (const it of compiled.items) {
      if (it.type !== "photo") continue;
      const wiki = it.wiki as string | undefined, query = it.query as string | undefined;
      let url: string | null = null;
      if (wiki) {
        try { const r = await importWikiImage(wiki, userId); url = r?.asset?.url ?? null; } catch (e) { await log?.(`› صورة «${wiki}»: ${e instanceof Error ? e.message.slice(0, 80) : e}`); }
      }
      if (!url && query) {
        try {
          const found = await searchStockPhotos(query, 1, "landscape");
          if (found.items[0]) url = (await importStockPhoto(found.items[0], { query, userId })).asset.url;
        } catch (e) { await log?.(`› صورة «${query}»: ${e instanceof Error ? e.message.slice(0, 80) : e}`); }
      }
      const key = url ? storageKeyFromUrl(url) : null;
      if (!key) { it.src = null; continue; }
      try {
        const raw = join(dir, `in${it.start}`), out = join(dir, `out${it.start}.jpg`);
        await writeFile(raw, await storageDownload(key));
        await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", "scale='min(900,iw)':-2", "-q:v", "4", out], { timeout: 60_000 });
        it.src = `data:image/jpeg;base64,${(await readFile(out)).toString("base64")}`;
      } catch { it.src = null; }
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** B-roll for the cutaways: free stock clips (Pexels/Pixabay), saved to the library so a re-render reuses them. */
export async function resolveCutaways(compiled: CompiledOverlay, userId: number | null, log?: (s: string) => Promise<void>) {
  const orientation = compiled.h > compiled.w ? "portrait" : "landscape";
  const used = new Set<string>();
  for (const c of compiled.cutaways) {
    try {
      const found = await searchStockVideos(c.query, 1, orientation);
      const need = c.end - c.start;
      const pick = found.items.find(v => !used.has(v.id) && v.durationSec >= need) ?? found.items.find(v => !used.has(v.id));
      if (!pick) { c.key = null; await log?.(`› لا لقطة مجانية لـ «${c.query}»`); continue; }
      used.add(pick.id);
      const { asset } = await importStockVideo(pick, { characterId: null, query: c.query, userId });
      c.key = asset.storageKey ?? storageKeyFromUrl(asset.url);
    } catch (e) {
      c.key = null;
      await log?.(`› لقطة «${c.query}»: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
  }
  const ok = compiled.cutaways.filter(c => c.key).length;
  if (compiled.cutaways.length) await log?.(`✓ ${ok}/${compiled.cutaways.length} لقطة قطع (B-roll)`);
}

const RUNTIME = resolve(process.cwd(), "tools", "overlay", "runtime.js");
/** The self-contained page the overlay renderer plays: fonts, the plan (editable JSON), icons, the runtime. */
export function buildOverlayHtml(compiled: CompiledOverlay) {
  const icons: Record<string, string> = {};
  for (const name of new Set(["check", "sparkles", ...compiled.items.filter(i => i.type === "icon").map(i => String(i.icon))])) {
    const svg = iconSvg(name);
    if (svg) icons[name] = svg;
  }
  const { problems: _p, cues: _c, zooms: _z, ...page } = compiled;
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  const runtime = readFileSync(RUNTIME, "utf8");
  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800;900&family=Reem+Kufi:wght@700&family=Amiri:wght@700&display=block" rel="stylesheet">
<style>html,body{margin:0;background:transparent!important}</style>
</head><body><div id="ov"></div>
<script type="application/json" id="plan">${json(page)}</script>
<script type="application/json" id="icons">${json(icons)}</script>
<script>${runtime}</script>
</body></html>`;
}
