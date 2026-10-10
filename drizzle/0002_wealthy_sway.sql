CREATE TABLE `social_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`characterId` int NOT NULL,
	`platform` enum('instagram','tiktok','youtube') NOT NULL,
	`handle` varchar(160),
	`platformUserId` varchar(160),
	`encryptedAccessToken` text,
	`encryptedRefreshToken` text,
	`tokenExpiresAt` timestamp,
	`timezone` varchar(80) NOT NULL DEFAULT 'UTC',
	`status` enum('disconnected','connected','expired','error') NOT NULL DEFAULT 'disconnected',
	`lastError` text,
	`connectedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `social_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `social_character_idx` ON `social_accounts` (`characterId`);--> statement-breakpoint
CREATE INDEX `social_platform_idx` ON `social_accounts` (`platform`);