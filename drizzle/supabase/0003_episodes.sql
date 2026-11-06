CREATE TABLE "channels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "channels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" varchar(64) NOT NULL,
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
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channels_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "episodes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
);
--> statement-breakpoint
ALTER TABLE "render_jobs" ALTER COLUMN "scriptId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD COLUMN "episodeId" integer;--> statement-breakpoint
CREATE INDEX "channels_active_idx" ON "channels" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "episodes_channel_idx" ON "episodes" USING btree ("channelId");--> statement-breakpoint
CREATE INDEX "episodes_status_idx" ON "episodes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "render_jobs_episode_idx" ON "render_jobs" USING btree ("episodeId") WHERE "episodeId" is not null;