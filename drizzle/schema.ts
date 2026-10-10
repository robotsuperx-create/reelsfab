import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Users. role semantics for this internal tool:
 *  - user   : signed in, waiting for an admin to approve access
 *  - member : approved team member (full production access)
 *  - admin  : manages team, settings and automation
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "member", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type CharacterColors = { primary: string; accent: string; text: string };

export const characters = mysqlTable("characters", {
  id: int("id").autoincrement().primaryKey(),
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
  contentTemplates: json("contentTemplates").$type<string[]>(),
  product: text("product"),
  rules: text("rules"),
  loraKeyword: varchar("loraKeyword", { length: 80 }),
  /** Kokoro voice used by the free economic pipeline. */
  ttsVoice: varchar("ttsVoice", { length: 40 }).default("af_heart").notNull(),
  /** Speed multiplier x100 (100 = normal). */
  ttsSpeed: int("ttsSpeed").default(100).notNull(),
  /** Final voice ID chosen after voice tests (e.g. ElevenLabs / Higgsfield). */
  externalVoiceId: varchar("externalVoiceId", { length: 160 }),
  colors: json("colors").$type<CharacterColors>(),
  captionFont: varchar("captionFont", { length: 60 }).default("Montserrat").notNull(),
  referenceImages: json("referenceImages").$type<string[]>(),
  needsDesignFile: boolean("needsDesignFile").default(false).notNull(),
  dailyQuota: int("dailyQuota").default(3).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Character = typeof characters.$inferSelect;
export type InsertCharacter = typeof characters.$inferInsert;

export const assets = mysqlTable(
  "assets",
  {
    id: int("id").autoincrement().primaryKey(),
    kind: mysqlEnum("kind", [
      "character_image",
      "background",
      "music",
      "premium_video",
      "render",
      "thumbnail",
      "voice",
      "other",
    ]).notNull(),
    characterId: int("characterId"),
    title: varchar("title", { length: 255 }),
    url: varchar("url", { length: 1024 }).notNull(),
    storageKey: varchar("storageKey", { length: 512 }),
    mimeType: varchar("mimeType", { length: 120 }),
    sizeBytes: int("sizeBytes"),
    durationMs: int("durationMs"),
    width: int("width"),
    height: int("height"),
    tags: json("tags").$type<string[]>(),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("assets_kind_idx").on(t.kind), index("assets_char_idx").on(t.characterId)],
);
export type Asset = typeof assets.$inferSelect;

export const batches = mysqlTable("batches", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  source: mysqlEnum("source", ["manual", "automation"]).default("manual").notNull(),
  plan: json("plan").$type<Record<string, unknown>>(),
  status: mysqlEnum("status", ["running", "done", "failed"]).default("running").notNull(),
  totalScripts: int("totalScripts").default(0).notNull(),
  premiumScripts: int("premiumScripts").default(0).notNull(),
  error: text("error"),
  createdBy: int("createdBy"),
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

export const scripts = mysqlTable(
  "scripts",
  {
    id: int("id").autoincrement().primaryKey(),
    characterId: int("characterId").notNull(),
    batchId: int("batchId"),
    status: mysqlEnum("status", SCRIPT_STATUSES).default("script_ready").notNull(),
    track: mysqlEnum("track", ["economic", "premium", "derivative"]).default("economic").notNull(),
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
    wordCount: int("wordCount").default(0).notNull(),
    complianceFlags: json("complianceFlags").$type<ComplianceFlag[]>(),
    duplicateOf: int("duplicateOf"),
    similarity: int("similarity"),
    parentScriptId: int("parentScriptId"),
    premiumClipId: int("premiumClipId"),
    notes: text("notes"),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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

export const premiumClips = mysqlTable("premium_clips", {
  id: int("id").autoincrement().primaryKey(),
  scriptId: int("scriptId").notNull(),
  characterId: int("characterId").notNull(),
  status: mysqlEnum("status", ["requested", "generating", "received", "failed"])
    .default("requested")
    .notNull(),
  model: varchar("model", { length: 120 }),
  attempts: int("attempts").default(0).notNull(),
  creditsSpent: int("creditsSpent").default(0).notNull(),
  costCents: int("costCents").default(0).notNull(),
  videoAssetId: int("videoAssetId"),
  videoUrl: varchar("videoUrl", { length: 1024 }),
  durationMs: int("durationMs"),
  transcript: text("transcript"),
  transcriptWords: json("transcriptWords").$type<TranscriptWord[]>(),
  derivativesCreated: int("derivativesCreated").default(0).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PremiumClip = typeof premiumClips.$inferSelect;

export type QcCheck = { key: string; label: string; status: "pass" | "warn" | "fail"; detail?: string };
export type QcReport = { checks: QcCheck[]; verdict: "approved" | "needs_review" | "rejected"; score: number };
export type VisualQc = { score: number; consistent: boolean; issues: string[]; checkedAt: string };

export const renders = mysqlTable(
  "renders",
  {
    id: int("id").autoincrement().primaryKey(),
    scriptId: int("scriptId").notNull(),
    characterId: int("characterId").notNull(),
    kind: mysqlEnum("kind", ["economic", "derivative", "premium"]).default("economic").notNull(),
    variantLabel: varchar("variantLabel", { length: 120 }),
    videoUrl: varchar("videoUrl", { length: 1024 }).notNull(),
    storageKey: varchar("storageKey", { length: 512 }),
    thumbnailUrl: varchar("thumbnailUrl", { length: 1024 }),
    durationMs: int("durationMs").default(0).notNull(),
    width: int("width").default(0).notNull(),
    height: int("height").default(0).notNull(),
    hasAudio: boolean("hasAudio").default(false).notNull(),
    hasCaptions: boolean("hasCaptions").default(false).notNull(),
    hasDisclosure: boolean("hasDisclosure").default(false).notNull(),
    fileSize: int("fileSize").default(0).notNull(),
    settings: json("settings").$type<Record<string, unknown>>(),
    qcStatus: mysqlEnum("qcStatus", ["pending", "approved", "needs_review", "rejected"])
      .default("pending")
      .notNull(),
    qcReport: json("qcReport").$type<QcReport>(),
    visualQc: json("visualQc").$type<VisualQc>(),
    reviewNotes: text("reviewNotes"),
    reviewedBy: int("reviewedBy"),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("renders_qc_idx").on(t.qcStatus), index("renders_script_idx").on(t.scriptId)],
);
export type Render = typeof renders.$inferSelect;

export const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const posts = mysqlTable(
  "posts",
  {
    id: int("id").autoincrement().primaryKey(),
    renderId: int("renderId").notNull(),
    scriptId: int("scriptId").notNull(),
    characterId: int("characterId").notNull(),
    platform: mysqlEnum("platform", PLATFORMS).notNull(),
    accountHandle: varchar("accountHandle", { length: 160 }),
    caption: text("caption"),
    scheduledAt: timestamp("scheduledAt").notNull(),
    status: mysqlEnum("status", ["queued", "published", "failed", "skipped"]).default("queued").notNull(),
    postUrl: varchar("postUrl", { length: 1024 }),
    externalId: varchar("externalId", { length: 160 }),
    publishedAt: timestamp("publishedAt"),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("posts_sched_idx").on(t.scheduledAt), index("posts_status_idx").on(t.status)],
);
export type Post = typeof posts.$inferSelect;

export const postMetrics = mysqlTable(
  "post_metrics",
  {
    id: int("id").autoincrement().primaryKey(),
    postId: int("postId").notNull(),
    capturedAt: timestamp("capturedAt").defaultNow().notNull(),
    views: int("views").default(0).notNull(),
    avgWatchMs: int("avgWatchMs").default(0).notNull(),
    /** Completion rate in permille (0–1000). */
    completionPermille: int("completionPermille").default(0).notNull(),
    likes: int("likes").default(0).notNull(),
    comments: int("comments").default(0).notNull(),
    shares: int("shares").default(0).notNull(),
    saves: int("saves").default(0).notNull(),
    follows: int("follows").default(0).notNull(),
  },
  t => [index("metrics_post_idx").on(t.postId)],
);
export type PostMetric = typeof postMetrics.$inferSelect;

export const costEntries = mysqlTable(
  "cost_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    category: mysqlEnum("category", ["llm", "higgsfield", "voice", "subscription", "storage", "other"]).notNull(),
    /** Amount in US cents (may be fractional costs rounded up to 1 cent minimum for LLM aggregates). */
    amountMilliCents: int("amountMilliCents").default(0).notNull(),
    credits: int("credits").default(0).notNull(),
    description: varchar("description", { length: 500 }),
    model: varchar("model", { length: 80 }),
    tokensIn: int("tokensIn").default(0).notNull(),
    tokensOut: int("tokensOut").default(0).notNull(),
    refType: varchar("refType", { length: 40 }),
    refId: int("refId"),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("cost_created_idx").on(t.createdAt)],
);
export type CostEntry = typeof costEntries.$inferSelect;

export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: json("value").$type<unknown>(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const automationRuns = mysqlTable("automation_runs", {
  id: int("id").autoincrement().primaryKey(),
  trigger: mysqlEnum("trigger", ["manual", "schedule"]).notNull(),
  status: mysqlEnum("status", ["running", "done", "failed"]).default("running").notNull(),
  batchId: int("batchId"),
  summary: json("summary").$type<Record<string, unknown>>(),
  error: text("error"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
});
export type AutomationRun = typeof automationRuns.$inferSelect;

export const insights = mysqlTable("insights", {
  id: int("id").autoincrement().primaryKey(),
  content: text("content").notNull(),
  periodDays: int("periodDays").default(14).notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Insight = typeof insights.$inferSelect;
export const socialAccounts = mysqlTable(
  "social_accounts",
  {
    id: int("id").autoincrement().primaryKey(),
    characterId: int("characterId").notNull(),
    platform: mysqlEnum("platform", ["instagram", "tiktok", "youtube"]).notNull(),
    handle: varchar("handle", { length: 160 }),
    platformUserId: varchar("platformUserId", { length: 160 }),
    encryptedAccessToken: text("encryptedAccessToken"),
    encryptedRefreshToken: text("encryptedRefreshToken"),
    tokenExpiresAt: timestamp("tokenExpiresAt"),
    timezone: varchar("timezone", { length: 80 }).default("UTC").notNull(),
    status: mysqlEnum("status", ["disconnected", "connected", "expired", "error"]).default("disconnected").notNull(),
    lastError: text("lastError"),
    connectedBy: int("connectedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  t => [index("social_character_idx").on(t.characterId), index("social_platform_idx").on(t.platform)],
);
export type SocialAccount = typeof socialAccounts.$inferSelect;
