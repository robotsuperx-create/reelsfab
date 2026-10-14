CREATE TABLE "render_jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "render_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scriptId" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 3 NOT NULL,
	"runAfter" timestamp DEFAULT now() NOT NULL,
	"lockedAt" timestamp,
	"lockedBy" varchar(80),
	"renderId" integer,
	"error" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "render_jobs_scriptId_unique" UNIQUE("scriptId")
);
--> statement-breakpoint
CREATE INDEX "render_jobs_claim_idx" ON "render_jobs" USING btree ("status","runAfter");