# AI Reels Factory

React / Express / tRPC / Drizzle starter, adapted from the Sandbox web-db-user template.

- `pnpm dev`: development server; honors `PORT` (default 3000).
- `pnpm build` / `pnpm start`: build and serve `dist/index.js` and `dist/public/`.
- `pnpm db:migrate`: apply checked-in migrations. `pnpm db:push`: generate and apply new schema changes.
- `pnpm check` / `pnpm test`: types and application tests.

Start with the Webdev skill's default-template guide. Platform login, storage, payments and service contracts live in its shared references; read the relevant capability before extending its helper.

`server/_core/publicConfig.ts` exposes only named public runtime values. Private keys stay server-side.

Platform configuration is readable and editable through `webdev.config`. Default settings are initial values, not enforced constraints. The agent may modify the files, commands and configuration or follow the flexible guide for another stack.

## Autonomous studio (server worker)

`AUTOPILOT_ENABLED=true` starts a one-minute loop inside the app container (`server/worker/autopilot.ts`),
guarded by a lease row in `settings` so only one instance works at a time:

1. daily script batch at `automationHourUtc` (when automation is enabled) — premium clips are capped by the remaining monthly budget (`premiumAllowance`);
2. `render_jobs` queue (`FOR UPDATE SKIP LOCKED`, retries with backoff) renders economic scripts with ffmpeg: Ken Burns motion, Kokoro-82M voice, word-by-word ASS captions, hook, CTA card and the AI-character badge;
3. QC → auto-schedule for the next 3 days → publish due posts → sync Higgsfield clips and metrics.

Cost: economic reels cost only LLM tokens (voice and render are local). Character reference images must be uploaded in Supabase Storage (the nine Character Bible portraits ship in `assets/characters/` and are uploaded to Supabase Storage automatically on first start; Shelly's spec is in `shelly.md` and her image is added manually).
Note: Kokoro downloads its model from Hugging Face on first use; this was not testable in the build sandbox (blocked), so the render tests use `TTS_PROVIDER=test`.

## Montage studio (free, server-side)

`/montage` is an edit room on top of the same ffmpeg engine. A project starts from a script — its Higgsfield clip with the
transcript, or the character's stills with Kokoro narration — and its edit is a declarative spec (`shared/montage.ts`,
the same idea as Editly's JSON edits): video/still segments with trims and Ken Burns motions, `xfade` transitions,
three caption styles (karaoke / classic / boxed), a music bed ducked under the voice with `sidechaincompress`, hook and
CTA card. "Quick preview" renders 540×960 synchronously; "Final render" goes through `render_jobs` (`montageId`), lands
in QC as a `montage` render and supersedes the script's automatic reel so the scheduler never posts both.

Free B-roll comes from Pexels (API key in the Integrations page; 200 requests/hour): portrait clips are imported into
the library as `broll` assets with the videographer credit in `assets.meta`, and the editor shows the required
"Videos provided by Pexels" link.

## Long-form pillar: full videos at zero cost (`/videos`)

Ten YouTube channels are seeded (`server/channel-seed.ts`): history, geopolitics, philosophy, book summaries (EN),
public-domain readings, kids stories, science, economics, psychology, tech/AI (EN). Each channel is an editorial
line — angle, guidelines, template, voice, visual style, topic bank — which is the human input YouTube's
inauthentic-content policy expects from faceless channels.

An episode goes through three steps, all free:
1. **Script** — scene-by-scene JSON (narration, on-screen title, English stock keywords, chapter) from the model in
   `settings.episodeModel` (default `gemini-3.8-flash`, free tier; `ollama:<model>` runs a local model through the
   Ollama provider in the Integrations page).
2. **Prepare** — narration per scene (Kokoro locally for English, Gemini TTS free tier for Arabic; each scene is
   synthesized once and cached in storage by text+voice hash, so re-renders cost no quota) and a free Pexels clip or
   still per scene (landscape, deduplicated inside the episode, credit kept). The editor reviews and swaps any scene.
3. **Render** — `server/worker/episode-render.ts`: every scene becomes a 1920×1080 clip (trimmed/padded to its
   narration, Ken Burns for stills), clips are joined without re-encoding, then one pass burns intro card, lower-thirds,
   chapter cards, captions (phrase captions for Arabic with the bundled IBM Plex Sans Arabic font, karaoke for English),
   outro and AI badge, and mixes narration with a ducked music bed. Output: MP4 + thumbnail + YouTube chapters text.

Schema upgrades for this pillar run idempotently at startup (`server/db-upgrades.ts`), so `git pull` is enough.

## Runtime services

Every service key (Claude, OpenAI, Gemini, Higgsfield, ElevenLabs, Instagram/Meta, TikTok, YouTube, Telegram, Pexels) is entered in the Integrations page and stored encrypted with `INTEGRATION_ENCRYPTION_KEY` — `.env` holds infrastructure only. Text generation uses Claude by default, transcription calls OpenAI Whisper, owner alerts go to Telegram, scheduling is the in-process autopilot (or an external cron calling `/api/scheduled/*` with `Authorization: Bearer $CRON_SECRET`), and sign-in is Supabase Auth or the local admin (`SESSION_SECRET`).

## Full-cycle test

`pnpm e2e` runs the whole studio against a throwaway local Postgres with every external service (Claude, Supabase Storage, Instagram) faked at the network boundary: seed + reference images → daily batch → render queue (real ffmpeg) → QC → scheduling (connected platforms only) → concurrent publishing (no double posts) → premium clip pipeline → montage (fake Pexels B-roll, preview, queued final render that supersedes the automatic reel) → long-form episode (10 seeded channels, fake Gemini script, cached narration, stock per scene, 1080p render with chapters) → autopilot tick. It refuses to run unless `DATABASE_URL` points at localhost.

```
createdb reelsfab_e2e && psql reelsfab_e2e -f drizzle/supabase/0000_*.sql -f drizzle/supabase/0001_*.sql -f drizzle/supabase/0002_*.sql -f drizzle/supabase/0003_*.sql
DATABASE_URL=postgres://postgres@127.0.0.1:5432/reelsfab_e2e pnpm e2e
```

## Run locally (Windows / macOS / Linux)

On first start open http://localhost:3000/setup (works only from this computer): enter the Supabase service key, the database password (the pooler URL is built and tested for you) and the admin login; secrets are generated. Then add service keys in the Integrations page.

Needs Node 22+, Git and (for server-side rendering) ffmpeg — on Windows: `winget install Gyan.FFmpeg`.

```
git clone https://github.com/robotsuperx-create/reelsfab.git
cd reelsfab
corepack enable
pnpm install
copy .env.example .env        # macOS/Linux: cp .env.example .env
pnpm dev                       # http://localhost:3000
```

Minimum `.env` for local use: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`,
`SESSION_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, and `APP_ADMIN_IDENTIFIER` + `APP_ADMIN_PASSWORD` for the local admin login. Then add your service keys in the Integrations page.
Keep `AUTOPILOT_ENABLED=false` locally unless you want this machine to render and publish.
