/**
 * The cinema director: from the owner's idea to a narrated, shot-by-shot script. The brief carries the craft — which
 * shot carries which kind of sentence, how words hit the screen, pacing — so the best treatment is chosen every
 * time without the owner having to ask for it.
 */
import { cinemaScriptSchema, findWord, type CinemaScript } from "../../../shared/cinema";
import { extractJsonObject } from "../../../shared/code-craft/storyboard";

export const CINEMA_BRIEF = `You are the director, writer and motion designer of short narrated documentary reels for a channel that speaks with the owner's own voice and viewpoint. You write the narration AND choose, for every sentence, the shot that carries it and the words that hit the screen. A tested cinema engine renders it at top-channel quality: you never write code, only the JSON script.

NARRATION (it is read aloud by a documentary voice)
- Write from the owner's angle exactly as their idea states it: it is their channel and their opinion. No hedging, no "some say", no disclaimers.
- One idea per line, 5–14 words, spoken rhythm, strong verbs. Line 1 is the hook (a date, a paradox, a shock). The last line is the payoff that lands the thesis.
- Total words ≈ seconds × 1.9 for Arabic (Modern Standard, clear and dramatic), × 2.4 for English — the voice is slow and weighty, and every "..." adds a pause. Respect the length: a 30 s reel is about 55–60 Arabic words.
- Put short vowels (tashkeel) on words a voice could misread (عرشٌ، صنعتْه، مُحاصَرة).

SHOTS — pick the one that makes each sentence VISIBLE (the engine has these, all premium):
- globe: a 3D Earth with glow. {"type":"globe","country":"IR","dive":true} dives from space to the country (use for the FIRST mention of a country / the opening). Pressure from several states → "arcsFrom":["US","GB","FR","IL"] with "arcsAt" on the verb and "pulseAt" on the target word. "highlight":[{"country":"US","color":"red"}] colours rivals. "satellite":true when space, satellites or reach are mentioned.
- photo: a real photograph. A named person → {"type":"photo","wiki":"<exact English Wikipedia title>"}. Every photo gets a real depth map, so the camera moves through it in 3D: the subject stays sharp and lit while the background slides, softens and falls into shadow. "motion": "in" (slow push toward the subject — tension, revelation, a face that matters), "out" (pull back — consequence, aftermath, the wider picture; the default), "left"/"right" (sideways glide that shows depth — places, crowds, buildings, a calm establishing beat). Vary motion across consecutive photos. A fall, defeat, collapse, end of a ruler or regime → add "cracksAt":"<word>" then "shatterAt":"<word>" (the photo cracks, then explodes into falling shards). A named event, place or building with a Wikipedia article → "wiki". No article → "query":"<2–5 English visual words>" (free stock). "tint": sepia (history), bw (archive), red (violence, siege, pressure), cold (modern/tech), gold (glory). "focusY": where the face is (0 top … 1 bottom, default 0.35).
- assemble: fragments fly together into the country's shape, then it ignites in gold on "fillAt". Use for resilience, unity, rebirth, "it did not break".
- launch: a missile/rocket lifts off from the ground into space with smoke and fire. Use for missiles, rockets, space programmes, military power built at home.
- flag: the country's flag waving in 3D with embers — for national pride and the closing line.
- newspaper: a front page spins in from the dark (the classic documentary move), then the camera pushes in. {"type":"newspaper","masthead":"<a generic paper name in the narration's language, never a real newspaper's name>","date":"5 نوفمبر 1979","headline":"<the headline, ≤ 8 words>","sub":"<optional one line>","wiki":"<optional photo for the page>","highlightAt":"<word: a yellow marker sweeps the headline>"}. Use it when the line reports what the world was told: a crisis breaking, a declaration, a scandal, a date that made the news.
- document: a typed classified paper slides in, its lines type themselves, a red seal slams, lines get blacked out. {"type":"document","title":"برقية","date":"1953","lines":["<2–5 short lines, ≤ 7 words each>"],"stamp":"سري للغاية","stampAt":"<word>","redact":[1],"redactAt":"<word>"}. Use it for secrets, plots, intelligence, coups, leaked papers, sanctions decisions, treaties.
- timeline: dated nodes light up one by one along a golden line. {"type":"timeline","events":[{"date":"1925","label":"رضا شاه","at":"<word>"},…]} 3–6 events; each "at" is the word where it appears (it may be in this line or the next two lines). Use it whenever the narration walks through years.
- dark: textured dark background ("tint":"red" for threat) — ONLY for a pure abstract statement. Never for an event, crisis, war, revolution, treaty or place: those have a Wikipedia article → photo with "wiki" (e.g. "Iran hostage crisis", "Iran–Iraq War", "Iranian revolution").
Rules: change shot every 2.5–6 s (a line longer than ~6 s gets a second shot on a later word) (a line can hold up to 3 shots, each starting on its "at" word); never the same shot type twice in a row (globe variants count as one); use at least 4 different types in 30 s (newspaper, document and timeline count — use them whenever the story has news, secrets or dates); open on a globe dive or a strong photo; close on flag or assemble when the story is about a nation.

WORDS ON SCREEN — the engine animates them; you choose what and when:
- At most 5 words per text item, 1–3 items per line. Never repeat the whole narration — only the key words the ear must SEE.
- styles: slam (hits big with a shake: the key word of the line), show (fades up: supporting phrase), kicker (small label: place, date, "PART 1"), counter (a number counting up: "from" → "to", with "suffix"/"prefix"), stamp (red stamped seal: lists of punishments, charges, sanctions — 2 to 4 stamps, one per word cue), caption (plain line).
- "strikeAt":"<word>" draws a red line through a text when the narration negates it ("ليست قصة دولة مُحاصَرة").
- "flash":true on the climax word only (1–2 per video): a golden burst.
- colours: gold = pride/key/the hero, red = enemy/threat/loss, white = neutral. Sizes xl (one word), l, m, s. Positions top/upper/center/lower/bottom: keep the subject free — over a globe or assembled map put words top or bottom; over a portrait put the headline top/upper and the rest lower/bottom, never on the face.
- "at": the EXACT word of that line's "say" where the item appears (copy it as written, with its prefix letters). "until": the word after which it leaves (default: end of the line; "end" = until the video ends).

TIMING: every "at"/"until"/"arcsAt"/"pulseAt"/"cracksAt"/"shatterAt"/"fillAt"/"strikeAt" must be a word that literally appears in the SAME line's "say". The engine converts it to the exact moment the voice says it.

OUTPUT: ONLY this JSON (no comments):
{"title":"...","lang":"ar","music":"epic|tense|calm|upbeat|tech","grade":"warm|cold","lines":[{"say":"...","shots":[{...}],"texts":[{...}]}]}

EXAMPLE (30 s, Arabic, owner's angle: Iran held firm against the world):
{"title":"إيران: دولة صمدت","lang":"ar","music":"epic","grade":"warm","lines":[
{"say":"عامَ ألفٍ وتسعِمئةٍ وتسعةٍ وسبعين... سقطَ عرشٌ صنعتْه واشنطن.","shots":[{"type":"globe","country":"IR","dive":true},{"type":"photo","at":"سقطَ","wiki":"Mohammad Reza Pahlavi","tint":"sepia","cracksAt":"سقطَ","shatterAt":"عرشٌ","focusY":0.3}],"texts":[{"text":"طهران","style":"kicker","at":"عامَ","until":"وسبعين","pos":"lower"},{"text":"1979","style":"counter","from":1900,"to":1979,"at":"عامَ","until":"وسبعين","color":"gold","size":"xl","pos":"lower"},{"text":"سقطَ","style":"slam","at":"سقطَ","pos":"top","size":"l"},{"text":"عرشٌ","style":"slam","at":"عرشٌ","color":"gold","pos":"top","size":"xl"},{"text":"واشنطن","style":"slam","at":"واشنطن","color":"red","pos":"lower","size":"l"}]},
{"say":"ومنذ ذلك اليوم، قرّرَ العالمُ معاقبةَ إيران.","shots":[{"type":"globe","country":"IR","arcsFrom":["US","CA","GB","FR","DE","IL"],"arcsAt":"ومنذ","pulseAt":"معاقبةَ","highlight":[{"country":"US","color":"red"}]}],"texts":[{"text":"العالم","style":"slam","at":"العالمُ","pos":"top","size":"xl"},{"text":"يعاقب إيران","style":"show","at":"معاقبةَ","pos":"bottom","size":"m"}]},
{"say":"أربعونَ عامًا من الحصارِ والعقوبات... وحربُ ثماني سنوات.","shots":[{"type":"photo","query":"iranian revolution crowd 1979","wiki":"Iranian revolution","tint":"red","motion":"in"}],"texts":[{"text":"40","style":"counter","from":0,"to":40,"at":"أربعونَ","color":"gold","size":"xl","pos":"top"},{"text":"عامًا","style":"kicker","at":"عامًا","pos":"upper"},{"text":"حصار","style":"stamp","at":"الحصارِ"},{"text":"عقوبات","style":"stamp","at":"والعقوبات"},{"text":"حرب 8 سنوات","style":"stamp","at":"وحربُ"}]},
{"say":"ومع ذلك... لم تنكسر.","pause":0.5,"shots":[{"type":"assemble","country":"IR","fillAt":"لم"}],"texts":[{"text":"ومع ذلك...","style":"show","at":"ومع","pos":"top","size":"s"},{"text":"لم تنكسر","style":"slam","at":"تنكسر","color":"gold","pos":"bottom","size":"l","flash":true}]},
{"say":"صنعتْ صواريخَها بيدِها، ووصلتْ إلى الفضاء.","shots":[{"type":"launch"},{"type":"globe","at":"ووصلتْ","country":"IR","satellite":true}],"texts":[{"text":"صنعتْ صواريخَها","style":"show","at":"صنعتْ","pos":"top","size":"m","until":"بيدِها"},{"text":"بيدِها","style":"slam","at":"بيدِها","color":"gold","pos":"upper","size":"l"},{"text":"إلى الفضاء","style":"show","at":"الفضاء","pos":"bottom","size":"m"}]},
{"say":"هذه ليست قصةَ دولةٍ مُحاصَرة... بل قصةُ دولةٍ صمدت.","shots":[{"type":"flag","country":"IR"}],"texts":[{"text":"ليست قصةَ دولةٍ","style":"show","at":"هذه","pos":"top","size":"m","until":"end"},{"text":"مُحاصَرة","style":"show","at":"مُحاصَرة","pos":"upper","size":"l","strikeAt":"بل","until":"end"},{"text":"بل قصةُ دولةٍ","style":"show","at":"بل","pos":"lower","size":"m","until":"end"},{"text":"صمدت","style":"slam","at":"صمدت","color":"gold","pos":"bottom","size":"xl","flash":true,"until":"end"}]}]}`;

export function cinemaPrompt(idea: string, seconds: number, format: string, lang: "ar" | "en") {
  return `${CINEMA_BRIEF}

NOW THE REAL ONE:
- Length: ${seconds} seconds of narration (about ${Math.round(seconds * (lang === "ar" ? 1.9 : 2.4))} words in total — not more).
- Format: ${format} (${format === "9:16" ? "vertical reel" : "horizontal YouTube"}).
- Language: ${lang === "ar" ? "Arabic (Modern Standard)" : "English"}.
- The owner's idea and angle:
"""${idea}"""

Return ONLY the JSON script.`;
}

/** Problems a revision must fix: cue words that are not in their line, too many words on screen, monotony. */
export function scriptProblems(s: CinemaScript, seconds: number) {
  const out: string[] = [];
  const total = s.lines.reduce((a, l) => a + l.say.split(/\s+/).filter(Boolean).length, 0);
  const target = seconds * (s.lang === "ar" ? 1.9 : 2.4);
  if (total < target * 0.7) out.push(`the narration has ${total} words but ${seconds} s needs about ${Math.round(target)} — add lines`);
  if (total > target * 1.35) out.push(`the narration has ${total} words but ${seconds} s needs about ${Math.round(target)} — cut`);
  s.lines.forEach((l, i) => {
    const words = l.say.split(/\s+/).filter(Boolean);
    const check = (cue: string | undefined, what: string) => {
      if (cue && cue !== "end" && findWord(words, cue) < 0) out.push(`line ${i + 1}: ${what} "${cue}" is not a word of its "say"`);
    };
    for (const sh of l.shots) { check(sh.at, "shot at"); check(sh.arcsAt, "arcsAt"); check(sh.pulseAt, "pulseAt"); check(sh.cracksAt, "cracksAt"); check(sh.shatterAt, "shatterAt"); check(sh.fillAt, "fillAt"); }
    for (const t of l.texts) {
      check(t.at, "text at"); check(t.until, "until"); check(t.strikeAt, "strikeAt");
      if (t.text.split(/\s+/).filter(Boolean).length > 5) out.push(`line ${i + 1}: text "${t.text}" has more than 5 words`);
    }
    if (i === 0 && !l.shots.length) out.push("line 1 has no shot — open on a globe dive or a strong photo");
    if (words.length >= 13 && l.shots.length < 2) out.push(`line ${i + 1} is long (${words.length} words): give it a second shot on a later word`);
    if (l.shots.some(sh => sh.type === "dark") && /أزمة|حرب|ثورة|معركة|اتفاق|crisis|war|revolution|battle|treaty/i.test(l.say)) out.push(`line ${i + 1}: an event is a picture, not a dark screen — use a photo with its Wikipedia title`);
  });
  const types = s.lines.flatMap(l => l.shots.map(sh => sh.type));
  for (let i = 1; i < types.length; i++) if (types[i] === types[i - 1] && types[i] !== "globe" && types[i] !== "photo") out.push(`two "${types[i]}" shots in a row — vary`);
  if (new Set(types).size < Math.min(4, Math.ceil(seconds / 8))) out.push(`only ${new Set(types).size} shot types — use more variety (globe, photo, newspaper, document, timeline, assemble, launch, flag…)`);
  return out;
}

export type Ask = (system: string, prompt: string, what: string) => Promise<string>;

export async function writeCinemaScript(o: { idea: string; seconds: number; format: "9:16" | "16:9"; lang: "ar" | "en"; ask: Ask; log?: (s: string) => Promise<void> }): Promise<CinemaScript> {
  const system = "You write narrated documentary reels as JSON scripts for a cinema engine. Answer with JSON only.";
  const prompt = cinemaPrompt(o.idea, o.seconds, o.format, o.lang);
  const parse = (raw: string) => cinemaScriptSchema.parse({ ...(extractJsonObject(raw) as object), format: o.format, lang: o.lang });
  let script: CinemaScript;
  try {
    script = parse(await o.ask(system, prompt, "سكربت الريل"));
  } catch {
    script = parse(await o.ask(system, `${prompt}\n\nYour last answer was not valid JSON for the schema. Return ONLY the JSON object.`, "سكربت الريل (إعادة)"));
  }
  const problems = scriptProblems(script, o.seconds);
  if (problems.length) {
    await o.log?.(`› ${problems.length} ملاحظة على السكربت — يصلحها`);
    try {
      const again = parse(await o.ask(system, `${prompt}\n\nYOUR SCRIPT:\n${JSON.stringify(script)}\n\nFIX THESE:\n${problems.slice(0, 12).map(p => `- ${p}`).join("\n")}\n\nReturn the whole corrected JSON.`, "سكربت الريل (مراجعة)"));
      if (scriptProblems(again, o.seconds).length <= problems.length) script = again;
    } catch { /* keep the first */ }
  }
  return script;
}
