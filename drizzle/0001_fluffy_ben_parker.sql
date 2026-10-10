CREATE TABLE `assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('character_image','background','music','premium_video','render','thumbnail','voice','other') NOT NULL,
	`characterId` int,
	`title` varchar(255),
	`url` varchar(1024) NOT NULL,
	`storageKey` varchar(512),
	`mimeType` varchar(120),
	`sizeBytes` int,
	`durationMs` int,
	`width` int,
	`height` int,
	`tags` json,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`trigger` enum('manual','schedule') NOT NULL,
	`status` enum('running','done','failed') NOT NULL DEFAULT 'running',
	`batchId` int,
	`summary` json,
	`error` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`finishedAt` timestamp,
	CONSTRAINT `automation_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`source` enum('manual','automation') NOT NULL DEFAULT 'manual',
	`plan` json,
	`status` enum('running','done','failed') NOT NULL DEFAULT 'running',
	`totalScripts` int NOT NULL DEFAULT 0,
	`premiumScripts` int NOT NULL DEFAULT 0,
	`error` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(40) NOT NULL,
	`name` varchar(120) NOT NULL,
	`nameAr` varchar(120),
	`age` varchar(120),
	`origin` varchar(160),
	`niche` varchar(240),
	`appearancePrompt` text,
	`wardrobe` text,
	`voiceDescription` text,
	`style` varchar(240),
	`catchphrase` varchar(240),
	`contentTemplates` json,
	`product` text,
	`rules` text,
	`loraKeyword` varchar(80),
	`ttsVoice` varchar(40) NOT NULL DEFAULT 'af_heart',
	`ttsSpeed` int NOT NULL DEFAULT 100,
	`externalVoiceId` varchar(160),
	`colors` json,
	`captionFont` varchar(60) NOT NULL DEFAULT 'Montserrat',
	`referenceImages` json,
	`needsDesignFile` boolean NOT NULL DEFAULT false,
	`dailyQuota` int NOT NULL DEFAULT 3,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `characters_id` PRIMARY KEY(`id`),
	CONSTRAINT `characters_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `cost_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` enum('llm','higgsfield','voice','subscription','storage','other') NOT NULL,
	`amountMilliCents` int NOT NULL DEFAULT 0,
	`credits` int NOT NULL DEFAULT 0,
	`description` varchar(500),
	`model` varchar(80),
	`tokensIn` int NOT NULL DEFAULT 0,
	`tokensOut` int NOT NULL DEFAULT 0,
	`refType` varchar(40),
	`refId` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cost_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `insights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`content` text NOT NULL,
	`periodDays` int NOT NULL DEFAULT 14,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `insights_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `post_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	`views` int NOT NULL DEFAULT 0,
	`avgWatchMs` int NOT NULL DEFAULT 0,
	`completionPermille` int NOT NULL DEFAULT 0,
	`likes` int NOT NULL DEFAULT 0,
	`comments` int NOT NULL DEFAULT 0,
	`shares` int NOT NULL DEFAULT 0,
	`saves` int NOT NULL DEFAULT 0,
	`follows` int NOT NULL DEFAULT 0,
	CONSTRAINT `post_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`renderId` int NOT NULL,
	`scriptId` int NOT NULL,
	`characterId` int NOT NULL,
	`platform` enum('tiktok','instagram','youtube') NOT NULL,
	`accountHandle` varchar(160),
	`caption` text,
	`scheduledAt` timestamp NOT NULL,
	`status` enum('queued','published','failed','skipped') NOT NULL DEFAULT 'queued',
	`postUrl` varchar(1024),
	`externalId` varchar(160),
	`publishedAt` timestamp,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `premium_clips` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scriptId` int NOT NULL,
	`characterId` int NOT NULL,
	`status` enum('requested','generating','received','failed') NOT NULL DEFAULT 'requested',
	`model` varchar(120),
	`attempts` int NOT NULL DEFAULT 0,
	`creditsSpent` int NOT NULL DEFAULT 0,
	`costCents` int NOT NULL DEFAULT 0,
	`videoAssetId` int,
	`videoUrl` varchar(1024),
	`durationMs` int,
	`transcript` text,
	`transcriptWords` json,
	`derivativesCreated` int NOT NULL DEFAULT 0,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `premium_clips_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `renders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scriptId` int NOT NULL,
	`characterId` int NOT NULL,
	`kind` enum('economic','derivative','premium') NOT NULL DEFAULT 'economic',
	`variantLabel` varchar(120),
	`videoUrl` varchar(1024) NOT NULL,
	`storageKey` varchar(512),
	`thumbnailUrl` varchar(1024),
	`durationMs` int NOT NULL DEFAULT 0,
	`width` int NOT NULL DEFAULT 0,
	`height` int NOT NULL DEFAULT 0,
	`hasAudio` boolean NOT NULL DEFAULT false,
	`hasCaptions` boolean NOT NULL DEFAULT false,
	`hasDisclosure` boolean NOT NULL DEFAULT false,
	`fileSize` int NOT NULL DEFAULT 0,
	`settings` json,
	`qcStatus` enum('pending','approved','needs_review','rejected') NOT NULL DEFAULT 'pending',
	`qcReport` json,
	`visualQc` json,
	`reviewNotes` text,
	`reviewedBy` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `renders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scripts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`characterId` int NOT NULL,
	`batchId` int,
	`status` enum('idea','script_ready','prompt_ready','premium_uploaded','rendered','approved','needs_review','rejected','scheduled','published') NOT NULL DEFAULT 'script_ready',
	`track` enum('economic','premium','derivative') NOT NULL DEFAULT 'economic',
	`templateKey` varchar(40) NOT NULL DEFAULT 'direct_tip',
	`hookType` varchar(40),
	`topic` varchar(255),
	`hook` text NOT NULL,
	`body` text NOT NULL,
	`payoff` text,
	`cta` text,
	`onScreenText` varchar(255),
	`caption` text,
	`hashtags` varchar(500),
	`higgsfieldPrompt` text,
	`visualAction` text,
	`wordCount` int NOT NULL DEFAULT 0,
	`complianceFlags` json,
	`duplicateOf` int,
	`similarity` int,
	`parentScriptId` int,
	`premiumClipId` int,
	`notes` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scripts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(80) NOT NULL,
	`value` json,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','member','admin') NOT NULL DEFAULT 'user';--> statement-breakpoint
CREATE INDEX `assets_kind_idx` ON `assets` (`kind`);--> statement-breakpoint
CREATE INDEX `assets_char_idx` ON `assets` (`characterId`);--> statement-breakpoint
CREATE INDEX `cost_created_idx` ON `cost_entries` (`createdAt`);--> statement-breakpoint
CREATE INDEX `metrics_post_idx` ON `post_metrics` (`postId`);--> statement-breakpoint
CREATE INDEX `posts_sched_idx` ON `posts` (`scheduledAt`);--> statement-breakpoint
CREATE INDEX `posts_status_idx` ON `posts` (`status`);--> statement-breakpoint
CREATE INDEX `renders_qc_idx` ON `renders` (`qcStatus`);--> statement-breakpoint
CREATE INDEX `renders_script_idx` ON `renders` (`scriptId`);--> statement-breakpoint
CREATE INDEX `scripts_status_idx` ON `scripts` (`status`);--> statement-breakpoint
CREATE INDEX `scripts_char_idx` ON `scripts` (`characterId`);--> statement-breakpoint
CREATE INDEX `scripts_track_idx` ON `scripts` (`track`);