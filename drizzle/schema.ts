import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Users. role semantics for this internal tool:
 *  - user   : signed in, waiting for an admin to approve access
 *  - member : approved team member (full production access)
 *  - admin  : manages team, settings and automation
 */
export const users = pgTable("users", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: text("role").$type<"user" | "member" | "admin">().default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const loginAttempts = pgTable("login_attempts", {
  key: varchar("key", { length: 255 }).primaryKey(),
  count: integer("count").default(0).notNull(),
  firstAttemptAt: timestamp("firstAttemptAt").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type CharacterColors = { primary: string; accent: string; text: string };

export const characters = pgTable("characters", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  slug: varchar("slug", { length: 40 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  nameAr: varchar("nameAr", { length: 120 }),
  age: varchar("age", { length: 120 }),
  origin: varchar("origin", { length: 160 }),
  niche: varchar("niche", { length: 240 }),
  appearancePrompt: text("appearancePrompt"),
  wardrobe: text("wardrobe"),
  voiceDescription: text("voiceDescription"),
  style: varchar("style", { length: 240 }),
  catchphrase: varchar("catchphrase", { length: 240 }),
  contentTemplates: jsonb("contentTemplates").$type<string[]>(),
  product: text("product"),
  rules: text("rules"),
  loraKeyword: varchar("loraKeyword", { length: 80 }),
  /** Kokoro voice used by the free economic pipeline. */
  ttsVoice: varchar("ttsVoice", { length: 40 }).default("af_heart").notNull(),
  /** Speed multiplier x100 (100 = normal). */
  ttsSpeed: integer("ttsSpeed").default(100).notNull(),
  /** Final voice ID chosen after voice tests (e.g. ElevenLabs / Higgsfield). */
  externalVoiceId: varchar("externalVoiceId", { length: 160 }),
  colors: jsonb("colors").$type<CharacterColors>(),
  captionFont: varchar("captionFont", { length: 60 }).default("Montserrat").notNull(),
  referenceImages: jsonb("referenceImages").$type<string[]>(),
  needsDesignFile: boolean("needsDesignFile").default(false).notNull(),
  dailyQuota: integer("dailyQuota").default(3).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: integer("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Character = typeof characters.$inferSelect;
export type InsertCharacter = typeof characters.$inferInsert;

export const assets = pgTable(
  "assets",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    kind: text("kind").$type<"character_image" | "background" | "music" | "premium_video" | "render" | "thumbnail" | "voice" | "other">().notNull(),
    characterId: integer("characterId"),
    title: varchar("title", { length: 255 }),
    url: varchar("url", { length: 1024 }).notNull(),
    storageKey: varchar("storageKey", { length: 512 }),
    mimeType: varchar("mimeType", { length: 120 }),
    sizeBytes: integer("sizeBytes"),
    durationMs: integer("durationMs"),
    width: integer("width"),
    height: integer("height"),
    tags: jsonb("tags").$type<string[]>(),
    createdBy: integer("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("assets_kind_idx").on(t.kind), index("assets_char_idx").on(t.characterId)],
);
export type Asset = typeof assets.$inferSelect;

export const batches = pgTable("batches", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  source: text("source").$type<"manual" | "automation">().default("manual").notNull(),
  plan: jsonb("plan").$type<Record<string, unknown>>(),
  status: text("status").$type<"running" | "done" | "failed">().default("running").notNull(),
  totalScripts: integer("totalScripts").default(0).notNull(),
  premiumScripts: integer("premiumScripts").default(0).notNull(),
  error: text("error"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Batch = typeof batches.$inferSelect;

export const SCRIPT_STATUSES = [
  "idea",
  "script_ready",
  "prompt_ready",
  "premium_uploaded",
  "rendered",
  "approved",
  "needs_review",
  "rejected",
  "scheduled",
  "published",
] as const;
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];

export type ComplianceFlag = { rule: string; severity: "block" | "warn"; match: string };

export const scripts = pgTable(
  "scripts",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    characterId: integer("characterId").notNull(),
    batchId: integer("batchId"),
    status: text("status").$type<ScriptStatus>().default("script_ready").notNull(),
    track: text("track").$type<"economic" | "premium" | "derivative">().default("economic").notNull(),
    templateKey: varchar("templateKey", { length: 40 }).default("direct_tip").notNull(),
    hookType: varchar("hookType", { length: 40 }),
    topic: varchar("topic", { length: 255 }),
    hook: text("hook").notNull(),
    body: text("body").notNull(),
    payoff: text("payoff"),
    cta: text("cta"),
    onScreenText: varchar("onScreenText", { length: 255 }),
    caption: text("caption"),
    hashtags: varchar("hashtags", { length: 500 }),
    higgsfieldPrompt: text("higgsfieldPrompt"),
    visualAction: text("visualAction"),
    wordCount: integer("wordCount").default(0).notNull(),
    complianceFlags: jsonb("complianceFlags").$type<ComplianceFlag[]>(),
    duplicateOf: integer("duplicateOf"),
    similarity: integer("similarity"),
    parentScriptId: integer("parentScriptId"),
    premiumClipId: integer("premiumClipId"),
    notes: text("notes"),
    createdBy: integer("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => [
    index("scripts_status_idx").on(t.status),
    index("scripts_char_idx").on(t.characterId),
    index("scripts_track_idx").on(t.track),
  ],
);
export type Script = typeof scripts.$inferSelect;
export type InsertScript = typeof scripts.$inferInsert;

export type TranscriptWord = { word: string; start: number; end: number };

export const premiumClips = pgTable("premium_clips", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  scriptId: integer("scriptId").notNull(),
  characterId: integer("characterId").notNull(),
  status: text("status").$type<"requested" | "generating" | "received" | "failed">()
    .default("requested")
    .notNull(),
  model: varchar("model", { length: 120 }),
  providerRequestId: varchar("providerRequestId", { length: 160 }),
  providerStatusUrl: varchar("providerStatusUrl", { length: 1024 }),
  providerCancelUrl: varchar("providerCancelUrl", { length: 1024 }),
  providerError: text("providerError"),
  submittedAt: timestamp("submittedAt"),
  completedAt: timestamp("completedAt"),
  attempts: integer("attempts").default(0).notNull(),
  creditsSpent: integer("creditsSpent").default(0).notNull(),
  costCents: integer("costCents").default(0).notNull(),
  videoAssetId: integer("videoAssetId"),
  videoUrl: varchar("videoUrl", { length: 1024 }),
  durationMs: integer("durationMs"),
  transcript: text("transcript"),
  transcriptWords: jsonb("transcriptWords").$type<TranscriptWord[]>(),
  derivativesCreated: integer("derivativesCreated").default(0).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type PremiumClip = typeof premiumClips.$inferSelect;

export type QcCheck = { key: string; label: string; status: "pass" | "warn" | "fail"; detail?: string };
export type QcReport = { checks: QcCheck[]; verdict: "approved" | "needs_review" | "rejected"; score: number };
export type VisualQc = { score: number; consistent: boolean; issues: string[]; checkedAt: string };

export const renders = pgTable(
  "renders",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    scriptId: integer("scriptId").notNull(),
    characterId: integer("characterId").notNull(),
    kind: text("kind").$type<"economic" | "derivative" | "premium">().default("economic").notNull(),
    variantLabel: varchar("variantLabel", { length: 120 }),
    videoUrl: varchar("videoUrl", { length: 1024 }).notNull(),
    storageKey: varchar("storageKey", { length: 512 }),
    thumbnailUrl: varchar("thumbnailUrl", { length: 1024 }),
    durationMs: integer("durationMs").default(0).notNull(),
    width: integer("width").default(0).notNull(),
    height: integer("height").default(0).notNull(),
    hasAudio: boolean("hasAudio").default(false).notNull(),
    hasCaptions: boolean("hasCaptions").default(false).notNull(),
    hasDisclosure: boolean("hasDisclosure").default(false).notNull(),
    fileSize: integer("fileSize").default(0).notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>(),
    qcStatus: text("qcStatus")
      .default("pending")
      .notNull(),
    qcReport: jsonb("qcReport").$type<QcReport>(),
    visualQc: jsonb("visualQc").$type<VisualQc>(),
    reviewNotes: text("reviewNotes"),
    reviewedBy: integer("reviewedBy"),
    createdBy: integer("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("renders_qc_idx").on(t.qcStatus), index("renders_script_idx").on(t.scriptId)],
);
export type Render = typeof renders.$inferSelect;

export const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const posts = pgTable(
  "posts",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    renderId: integer("renderId").notNull(),
    scriptId: integer("scriptId").notNull(),
    characterId: integer("characterId").notNull(),
    platform: text("platform").$type<Platform>().notNull(),
    accountHandle: varchar("accountHandle", { length: 160 }),
    caption: text("caption"),
    scheduledAt: timestamp("scheduledAt").notNull(),
    status: text("status").$type<"queued" | "published" | "failed" | "skipped">().default("queued").notNull(),
    postUrl: varchar("postUrl", { length: 1024 }),
    externalId: varchar("externalId", { length: 160 }),
    publishedAt: timestamp("publishedAt"),
    createdBy: integer("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("posts_sched_idx").on(t.scheduledAt), index("posts_status_idx").on(t.status)],
);
export type Post = typeof posts.$inferSelect;

export const postMetrics = pgTable(
  "post_metrics",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    postId: integer("postId").notNull(),
    capturedAt: timestamp("capturedAt").defaultNow().notNull(),
    views: integer("views").default(0).notNull(),
    avgWatchMs: integer("avgWatchMs").default(0).notNull(),
    /** Completion rate in permille (0–1000). */
    completionPermille: integer("completionPermille").default(0).notNull(),
    likes: integer("likes").default(0).notNull(),
    comments: integer("comments").default(0).notNull(),
    shares: integer("shares").default(0).notNull(),
    saves: integer("saves").default(0).notNull(),
    follows: integer("follows").default(0).notNull(),
  },
  t => [index("metrics_post_idx").on(t.postId)],
);
export type PostMetric = typeof postMetrics.$inferSelect;

export const costEntries = pgTable(
  "cost_entries",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    category: text("category").$type<"llm" | "higgsfield" | "voice" | "subscription" | "storage" | "other">().notNull(),
    /** Amount in US cents (may be fractional costs rounded up to 1 cent minimum for LLM aggregates). */
    amountMilliCents: integer("amountMilliCents").default(0).notNull(),
    credits: integer("credits").default(0).notNull(),
    description: varchar("description", { length: 500 }),
    model: varchar("model", { length: 80 }),
    tokensIn: integer("tokensIn").default(0).notNull(),
    tokensOut: integer("tokensOut").default(0).notNull(),
    refType: varchar("refType", { length: 40 }),
    refId: integer("refId"),
    createdBy: integer("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("cost_created_idx").on(t.createdAt)],
);
export type CostEntry = typeof costEntries.$inferSelect;

export const settings = pgTable("settings", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: jsonb("value").$type<unknown>(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const integrations = pgTable(
  "integrations",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    provider: varchar("provider", { length: 80 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    capabilities: jsonb("capabilities").$type<string[]>().notNull(),
    configKeys: jsonb("configKeys").$type<string[]>().notNull(),
    encryptedConfig: text("encryptedConfig").notNull(),
    status: text("status").$type<"connected" | "error" | "disabled">().default("connected").notNull(),
    lastCheckedAt: timestamp("lastCheckedAt"),
    lastError: text("lastError"),
    createdBy: integer("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => [index("integrations_provider_idx").on(t.provider), index("integrations_status_idx").on(t.status)],
);
export type Integration = typeof integrations.$inferSelect;

export const automationRuns = pgTable("automation_runs", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  trigger: text("trigger").$type<"manual" | "schedule">().notNull(),
  status: text("status").$type<"running" | "done" | "failed">().default("running").notNull(),
  batchId: integer("batchId"),
  summary: jsonb("summary").$type<Record<string, unknown>>(),
  error: text("error"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
});
export type AutomationRun = typeof automationRuns.$inferSelect;

export const insights = pgTable("insights", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  content: text("content").notNull(),
  periodDays: integer("periodDays").default(14).notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Insight = typeof insights.$inferSelect;
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    characterId: integer("characterId").notNull(),
    platform: text("platform").$type<Platform>().notNull(),
    handle: varchar("handle", { length: 160 }),
    platformUserId: varchar("platformUserId", { length: 160 }),
    encryptedAccessToken: text("encryptedAccessToken"),
    encryptedRefreshToken: text("encryptedRefreshToken"),
    tokenExpiresAt: timestamp("tokenExpiresAt"),
    timezone: varchar("timezone", { length: 80 }).default("UTC").notNull(),
    status: text("status").$type<"disconnected" | "connected" | "expired" | "error">().default("disconnected").notNull(),
    lastError: text("lastError"),
    connectedBy: integer("connectedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => [index("social_character_idx").on(t.characterId), index("social_platform_idx").on(t.platform)],
);
export type SocialAccount = typeof socialAccounts.$inferSelect;
