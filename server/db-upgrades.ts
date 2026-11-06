/**
 * Idempotent schema upgrades applied at startup, so a `git pull` is enough on a machine whose database was
 * created from the earlier migrations (Supabase or local). Every statement is safe to run again.
 * Mirrors drizzle/supabase/0003_episodes.sql.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "channels" (
    "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "slug" varchar(64) NOT NULL UNIQUE,
    "name" varchar(120) NOT NULL,
    "niche" varchar(200) NOT NULL,
    "description" text DEFAULT '' NOT NULL,
    "language" text DEFAULT 'ar' NOT NULL,
    "ttsProvider" text DEFAULT 'gemini' NOT NULL,
    "voice" varchar(60) DEFAULT 'Charon' NOT NULL,
    "ttsSpeed" integer DEFAULT 100 NOT NULL,
    "visualStyle" text DEFAULT 'stock' NOT NULL,
    "episodeTemplate" jsonb NOT NULL,
    "guidelines" text DEFAULT '' NOT NULL,
    "topicsBank" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "colors" jsonb NOT NULL,
    "musicAssetId" integer,
    "madeForKids" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp DEFAULT now() NOT NULL,
    "updatedAt" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "episodes" (
    "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "channelId" integer NOT NULL,
    "topic" varchar(240) NOT NULL,
    "title" varchar(200) DEFAULT '' NOT NULL,
    "status" text DEFAULT 'planned' NOT NULL,
    "script" jsonb,
    "narrationKey" varchar(512),
    "narrationUrl" varchar(1024),
    "videoUrl" varchar(1024),
    "storageKey" varchar(512),
    "thumbnailUrl" varchar(1024),
    "durationMs" integer,
    "chaptersText" text,
    "costMilliCents" integer DEFAULT 0 NOT NULL,
    "error" text,
    "publishedUrl" varchar(1024),
    "publishedAt" timestamp,
    "createdBy" integer,
    "createdAt" timestamp DEFAULT now() NOT NULL,
    "updatedAt" timestamp DEFAULT now() NOT NULL
  )`,
  `ALTER TABLE "render_jobs" ALTER COLUMN "scriptId" DROP NOT NULL`,
  `ALTER TABLE "render_jobs" ADD COLUMN IF NOT EXISTS "episodeId" integer`,
  `CREATE INDEX IF NOT EXISTS "channels_active_idx" ON "channels" USING btree ("isActive")`,
  `CREATE INDEX IF NOT EXISTS "episodes_channel_idx" ON "episodes" USING btree ("channelId")`,
  `CREATE INDEX IF NOT EXISTS "episodes_status_idx" ON "episodes" USING btree ("status")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "render_jobs_episode_idx" ON "render_jobs" USING btree ("episodeId") WHERE "episodeId" is not null`,
  // Same posture as every other table on Supabase: locked for the anon/authenticated API roles (the app uses the service role).
  `ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "episodes" ENABLE ROW LEVEL SECURITY`,
];

let done = false;

/** Runs once per process; cheap when everything already exists. */
export async function ensureSchemaUpgrades() {
  if (done) return;
  const db = await getDb();
  if (!db) return;
  const [probe] = (await db.execute(sql`select
      to_regclass('public.channels') is not null as channels,
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='render_jobs' and column_name='episodeId') as episode_jobs`)) as unknown as { channels: boolean; episode_jobs: boolean }[];
  if (!probe?.channels || !probe?.episode_jobs) {
    for (const statement of STATEMENTS) await db.execute(sql.raw(statement));
    console.log("[database] long-form schema upgrade applied (channels, episodes, episode render jobs)");
  }
  done = true;
}
