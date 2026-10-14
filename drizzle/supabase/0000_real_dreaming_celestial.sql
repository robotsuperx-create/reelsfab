CREATE TABLE "assets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "assets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"characterId" integer,
	"title" varchar(255),
	"url" varchar(1024) NOT NULL,
	"storageKey" varchar(512),
	"mimeType" varchar(120),
	"sizeBytes" integer,
	"durationMs" integer,
	"width" integer,
	"height" integer,
	"tags" jsonb,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "automation_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"batchId" integer,
	"summary" jsonb,
	"error" text,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"finishedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(255) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"plan" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"totalScripts" integer DEFAULT 0 NOT NULL,
	"premiumScripts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "characters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" varchar(40) NOT NULL,
	"name" varchar(120) NOT NULL,
	"nameAr" varchar(120),
	"age" varchar(120),
	"origin" varchar(160),
	"niche" varchar(240),
	"appearancePrompt" text,
	"wardrobe" text,
	"voiceDescription" text,
	"style" varchar(240),
	"catchphrase" varchar(240),
	"contentTemplates" jsonb,
	"product" text,
	"rules" text,
	"loraKeyword" varchar(80),
	"ttsVoice" varchar(40) DEFAULT 'af_heart' NOT NULL,
	"ttsSpeed" integer DEFAULT 100 NOT NULL,
	"externalVoiceId" varchar(160),
	"colors" jsonb,
	"captionFont" varchar(60) DEFAULT 'Montserrat' NOT NULL,
	"referenceImages" jsonb,
	"needsDesignFile" boolean DEFAULT false NOT NULL,
	"dailyQuota" integer DEFAULT 3 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "characters_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cost_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cost_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"category" text NOT NULL,
	"amountMilliCents" integer DEFAULT 0 NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"description" varchar(500),
	"model" varchar(80),
	"tokensIn" integer DEFAULT 0 NOT NULL,
	"tokensOut" integer DEFAULT 0 NOT NULL,
	"refType" varchar(40),
	"refId" integer,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "insights_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"content" text NOT NULL,
	"periodDays" integer DEFAULT 14 NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "integrations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"provider" varchar(80) NOT NULL,
	"label" varchar(120) NOT NULL,
	"capabilities" jsonb NOT NULL,
	"configKeys" jsonb NOT NULL,
	"encryptedConfig" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"lastCheckedAt" timestamp,
	"lastError" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"firstAttemptAt" timestamp NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "post_metrics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"postId" integer NOT NULL,
	"capturedAt" timestamp DEFAULT now() NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"avgWatchMs" integer DEFAULT 0 NOT NULL,
	"completionPermille" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"follows" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "posts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"renderId" integer NOT NULL,
	"scriptId" integer NOT NULL,
	"characterId" integer NOT NULL,
	"platform" text NOT NULL,
	"accountHandle" varchar(160),
	"caption" text,
	"scheduledAt" timestamp NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"postUrl" varchar(1024),
	"externalId" varchar(160),
	"publishedAt" timestamp,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "premium_clips" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "premium_clips_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scriptId" integer NOT NULL,
	"characterId" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"model" varchar(120),
	"providerRequestId" varchar(160),
	"providerStatusUrl" varchar(1024),
	"providerCancelUrl" varchar(1024),
	"providerError" text,
	"submittedAt" timestamp,
	"completedAt" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"creditsSpent" integer DEFAULT 0 NOT NULL,
	"costCents" integer DEFAULT 0 NOT NULL,
	"videoAssetId" integer,
	"videoUrl" varchar(1024),
	"durationMs" integer,
	"transcript" text,
	"transcriptWords" jsonb,
	"derivativesCreated" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "renders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scriptId" integer NOT NULL,
	"characterId" integer NOT NULL,
	"kind" text DEFAULT 'economic' NOT NULL,
	"variantLabel" varchar(120),
	"videoUrl" varchar(1024) NOT NULL,
	"storageKey" varchar(512),
	"thumbnailUrl" varchar(1024),
	"durationMs" integer DEFAULT 0 NOT NULL,
	"width" integer DEFAULT 0 NOT NULL,
	"height" integer DEFAULT 0 NOT NULL,
	"hasAudio" boolean DEFAULT false NOT NULL,
	"hasCaptions" boolean DEFAULT false NOT NULL,
	"hasDisclosure" boolean DEFAULT false NOT NULL,
	"fileSize" integer DEFAULT 0 NOT NULL,
	"settings" jsonb,
	"qcStatus" text DEFAULT 'pending' NOT NULL,
	"qcReport" jsonb,
	"visualQc" jsonb,
	"reviewNotes" text,
	"reviewedBy" integer,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scripts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"characterId" integer NOT NULL,
	"batchId" integer,
	"status" text DEFAULT 'script_ready' NOT NULL,
	"track" text DEFAULT 'economic' NOT NULL,
	"templateKey" varchar(40) DEFAULT 'direct_tip' NOT NULL,
	"hookType" varchar(40),
	"topic" varchar(255),
	"hook" text NOT NULL,
	"body" text NOT NULL,
	"payoff" text,
	"cta" text,
	"onScreenText" varchar(255),
	"caption" text,
	"hashtags" varchar(500),
	"higgsfieldPrompt" text,
	"visualAction" text,
	"wordCount" integer DEFAULT 0 NOT NULL,
	"complianceFlags" jsonb,
	"duplicateOf" integer,
	"similarity" integer,
	"parentScriptId" integer,
	"premiumClipId" integer,
	"notes" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "social_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"characterId" integer NOT NULL,
	"platform" text NOT NULL,
	"handle" varchar(160),
	"platformUserId" varchar(160),
	"encryptedAccessToken" text,
	"encryptedRefreshToken" text,
	"tokenExpiresAt" timestamp,
	"timezone" varchar(80) DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"lastError" text,
	"connectedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" text DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE INDEX "assets_kind_idx" ON "assets" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "assets_char_idx" ON "assets" USING btree ("characterId");--> statement-breakpoint
CREATE INDEX "cost_created_idx" ON "cost_entries" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "integrations_provider_idx" ON "integrations" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "integrations_status_idx" ON "integrations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "metrics_post_idx" ON "post_metrics" USING btree ("postId");--> statement-breakpoint
CREATE INDEX "posts_sched_idx" ON "posts" USING btree ("scheduledAt");--> statement-breakpoint
CREATE INDEX "posts_status_idx" ON "posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "renders_qc_idx" ON "renders" USING btree ("qcStatus");--> statement-breakpoint
CREATE INDEX "renders_script_idx" ON "renders" USING btree ("scriptId");--> statement-breakpoint
CREATE INDEX "scripts_status_idx" ON "scripts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scripts_char_idx" ON "scripts" USING btree ("characterId");--> statement-breakpoint
CREATE INDEX "scripts_track_idx" ON "scripts" USING btree ("track");--> statement-breakpoint
CREATE INDEX "social_character_idx" ON "social_accounts" USING btree ("characterId");--> statement-breakpoint
CREATE INDEX "social_platform_idx" ON "social_accounts" USING btree ("platform");