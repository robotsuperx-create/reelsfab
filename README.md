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

## Runtime services

Text generation uses Claude by default (Anthropic/OpenAI/Gemini keys), transcription calls OpenAI Whisper, owner alerts go to Telegram, scheduling is the in-process autopilot (or an external cron calling `/api/scheduled/*` with `Authorization: Bearer $CRON_SECRET`), and sign-in is Supabase Auth or the local admin (`SESSION_SECRET`).

## Full-cycle test

`pnpm e2e` runs the whole studio against a throwaway local Postgres with every external service (Claude, Supabase Storage, Instagram) faked at the network boundary: seed + reference images → daily batch → render queue (real ffmpeg) → QC → scheduling (connected platforms only) → concurrent publishing (no double posts) → autopilot tick. It refuses to run unless `DATABASE_URL` points at localhost.

```
createdb reelsfab_e2e && psql reelsfab_e2e -f drizzle/supabase/0000_*.sql -f drizzle/supabase/0001_*.sql
DATABASE_URL=postgres://postgres@127.0.0.1:5432/reelsfab_e2e pnpm e2e
```

## Run locally (Windows / macOS / Linux)

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
`SESSION_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, and `APP_ADMIN_IDENTIFIER` + `APP_ADMIN_PASSWORD` for the local admin login.
Keep `AUTOPILOT_ENABLED=false` locally unless you want this machine to render and publish.
