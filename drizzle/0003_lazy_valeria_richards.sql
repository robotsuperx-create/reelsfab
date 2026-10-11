CREATE TABLE `login_attempts` (
	`key` varchar(255) NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	`firstAttemptAt` timestamp NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `login_attempts_key` PRIMARY KEY(`key`)
);
