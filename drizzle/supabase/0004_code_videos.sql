-- "Code → video" room (also applied at startup by server/db-upgrades.ts).
CREATE TABLE IF NOT EXISTS "code_videos" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "title" varchar(160) NOT NULL,
  "html" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "durationSec" integer NOT NULL,
  "fps" integer DEFAULT 30 NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "videoUrl" varchar(1024),
  "storageKey" varchar(512),
  "posterUrl" varchar(1024),
  "assetId" integer,
  "sizeBytes" integer,
  "error" text,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "code_videos_status_idx" ON "code_videos" USING btree ("status", "id");
ALTER TABLE "code_videos" ENABLE ROW LEVEL SECURITY;
