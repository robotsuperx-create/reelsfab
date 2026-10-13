ALTER TABLE `premium_clips` ADD `providerRequestId` varchar(160);--> statement-breakpoint
ALTER TABLE `premium_clips` ADD `providerStatusUrl` varchar(1024);--> statement-breakpoint
ALTER TABLE `premium_clips` ADD `providerCancelUrl` varchar(1024);--> statement-breakpoint
ALTER TABLE `premium_clips` ADD `providerError` text;--> statement-breakpoint
ALTER TABLE `premium_clips` ADD `submittedAt` timestamp;--> statement-breakpoint
ALTER TABLE `premium_clips` ADD `completedAt` timestamp;