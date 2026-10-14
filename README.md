# AI Reels Factory

React / Express / tRPC / Drizzle starter, adapted from the Sandbox web-db-user template.

- `pnpm dev`: development server; honors `PORT` (default 3000).
- `pnpm build` / `pnpm start`: build and serve `dist/index.js` and `dist/public/`.
- `pnpm db:migrate`: apply checked-in migrations. `pnpm db:push`: generate and apply new schema changes.
- `pnpm check` / `pnpm test`: types and application tests.

Start with the Webdev skill's default-template guide. Platform login, storage, payments and service contracts live in its shared references; read the relevant capability before extending its helper.

`server/_core/publicConfig.ts` exposes only named public runtime values. Private keys stay server-side. The platform serves managed `/manus-storage/` assets; the application does not register a second proxy.

Platform configuration is readable and editable through `webdev.config`. Default settings are initial values, not enforced constraints. The agent may modify the files, commands and configuration or follow the flexible guide for another stack.

## Autonomous studio (server worker)

`AUTOPILOT_ENABLED=true` starts a one-minute loop inside the app container (`server/worker/autopilot.ts`),
guarded by a lease row in `settings` so only one instance works at a time:

1. daily script batch at `automationHourUtc` (when automation is enabled) — premium clips are capped by the remaining monthly budget (`premiumAllowance`);
2. `render_jobs` queue (`FOR UPDATE SKIP LOCKED`, retries with backoff) renders economic scripts with ffmpeg: Ken Burns motion, Kokoro-82M voice, word-by-word ASS captions, hook, CTA card and the AI-character badge;
3. QC → auto-schedule for the next 3 days → publish due posts → sync Higgsfield clips and metrics.

Cost: economic reels cost only LLM tokens (voice and render are local). Character reference images must be uploaded in Supabase Storage (seeded `/manus-storage/...` paths do not resolve).
Note: Kokoro downloads its model from Hugging Face on first use; this was not testable in the build sandbox (blocked), so the render tests use `TTS_PROVIDER=test`.
