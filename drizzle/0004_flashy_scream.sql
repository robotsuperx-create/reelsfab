CREATE TABLE `integrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(80) NOT NULL,
	`label` varchar(120) NOT NULL,
	`capabilities` json NOT NULL,
	`configKeys` json NOT NULL,
	`encryptedConfig` text NOT NULL,
	`status` enum('connected','error','disabled') NOT NULL DEFAULT 'connected',
	`lastCheckedAt` timestamp,
	`lastError` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `integrations_provider_idx` ON `integrations` (`provider`);--> statement-breakpoint
CREATE INDEX `integrations_status_idx` ON `integrations` (`status`);