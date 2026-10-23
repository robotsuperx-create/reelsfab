CREATE TABLE "montages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "montages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scriptId" integer NOT NULL,
	"characterId" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"spec" jsonb NOT NULL,
	"previewUrl" varchar(1024),
	"previewKey" varchar(512),
	"renderId" integer,
	"error" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "render_jobs" DROP CONSTRAINT "render_jobs_scriptId_unique";--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD COLUMN "montageId" integer;--> statement-breakpoint
CREATE INDEX "montages_script_idx" ON "montages" USING btree ("scriptId");--> statement-breakpoint
CREATE INDEX "montages_status_idx" ON "montages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "render_jobs_script_auto_idx" ON "render_jobs" USING btree ("scriptId") WHERE "montageId" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "render_jobs_montage_idx" ON "render_jobs" USING btree ("montageId") WHERE "montageId" is not null;