# Motion kit (window.CV)

The design system of the "code → video" room. It is inlined into every page the room previews or renders that asks
for it (`<script data-cv-kit></script>`, or any call to `CV.play` / `CV.create`), together with GSAP and its fonts.

- **Source:** `cv-kit.js` (this folder). After editing it run `pnpm kit:build`, which regenerates
  `shared/code-craft/kit-source.ts`; a test fails if the two drift apart.
- **Themes:** `documentary`, `kinetic`, `neon`, `infographic`, `storybook` (plus an optional brand `accent`).
- **Components:** kicker, title, text, kinetic, stat, bars, list, timeline, compare, quote, icon, divider, source,
  lowerThird, cta; end card, word-timed captions, progress bar.
- **Exact on the recorder's virtual clock:** one GSAP timeline, absolute times, ends exactly at the duration (nothing
  may run past it), seeded randomness, Arabic animated by whole words and never letter-spaced.

## Emoji, effects, transitions (v1.1)

- `emoji` item: glossy 3D emojis (Microsoft Fluent Emoji via `@lobehub/fluent-emoji-3d`, MIT, from jsdelivr) that
  pop in and keep moving (`float`, `bounce`, `spin`, `pulse`, `wiggle`); the system emoji is the fallback.
- Scene `fx` (at most 2): `confetti` (or an emoji rain with `fxEmoji`), `sparkles`, `shake`, `rings`, `lightleak`,
  `letterbox`, `dust`, `glitch`. Transitions: `rise`, `fade`, `mask`, `zoom`, `slide`, `flash`, `cut`, `iris`,
  `stripes`, `whip`, `glitch`.

## Sound (server/worker/sound)

The kit logs a cue for each movement (`window.__cvSound`): whoosh on transitions, hit on slammed lines, ticks while a
number counts and a ding when it lands, pops on list items, a riser into the end card and a chime on its CTA… The
renderer reads them, synthesises every effect and a music bed for the mood (`tense`, `upbeat`, `tech`, `calm`,
`playful`, `epic` — or one of the owner's library tracks), ducks the music under the big hits, and muxes it. All
synthesised (no samples, no licences), seeded (same video → same sound), around −16 LUFS. Long videos: segments are
recorded silent and one soundtrack is laid over the joined file. No voice.

## Storyboards

Most videos never need hand-written code: a storyboard (short JSON, see `shared/code-craft/storyboard.ts` →
`storyboardDoc`) is played by `CV.play`. The agent's director writes one in "compose" mode, and any other AI can write
one from the room's «نسخ قالب القصة (JSON)» prompt — the JSON is pasted in place of HTML.
`../samples/oil-storyboard.json` (22 s, documentary, tense) and `../samples/income-reel-storyboard.json` (15 s, kinetic, emoji + effects) are examples.

## Quality loop (server/services/code-director.ts)

Director → storyboard → normalised (timings, limits, reading time) → compiled → measured in the recorder (out of
frame, overlaps, tiny text, script errors) → critic scores the settled frame of each scene (legibility counts double)
→ revised below 8/10, up to two rounds → the best-scoring version is kept.
