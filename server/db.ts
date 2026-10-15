import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { characters, InsertUser, settings, users } from "../drizzle/schema";
import { AppSettings, DEFAULT_SETTINGS } from "../shared/domain";
import { ENV } from './_core/env';
import { getDatabaseUrl } from './_core/database-url';
import { CHARACTER_SEED } from "./seed";

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlClient: ReturnType<typeof postgres> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  const databaseUrl = getDatabaseUrl();
  if (!_db && databaseUrl) {
    try {
      // TLS is mandatory for Supabase; a local Postgres (dev/e2e) can opt out with sslmode=disable or a loopback host.
      const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(databaseUrl) || /sslmode=disable/.test(databaseUrl);
      _sqlClient = postgres(databaseUrl, { prepare: false, max: 10, ssl: local ? false : "require" });
      _db = drizzle(_sqlClient);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet as never,
    });

    // Admin bootstrap. Never "first sign-in wins": that lets a stranger take over a fresh
    // deployment. Admins come from ADMIN_EMAILS (verified e-mails only, see supabase-auth)
    // or OWNER_OPEN_ID. ALLOW_FIRST_USER_ADMIN=true re-enables the old behaviour for local dev.
    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);
    const email = typeof user.email === "string" ? user.email.toLowerCase() : null;
    if (email && adminEmails.includes(email) && user.loginMethod === "supabase") {
      await db.update(users).set({ role: "admin" }).where(eq(users.openId, user.openId));
    } else if (process.env.ALLOW_FIRST_USER_ADMIN === "true") {
      const [{ admins }] = (await db
        .select({ admins: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.role, "admin"))) as { admins: number }[];
      if (Number(admins) === 0) {
        await db.update(users).set({ role: "admin" }).where(eq(users.openId, user.openId));
      }
    }
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

export async function getSettings(): Promise<AppSettings> {
  const db = await requireDb();
  const rows = await db.select().from(settings);
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) merged[row.key] = row.value;
  const deprecatedGeminiModels = new Set(["gemini-2.5-flash", "gemini-3-flash-preview", "gemini:gemini-2.5-flash", "gemini:gemini-3-flash-preview"]);
  for (const key of ["scriptModel", "reviewModel"] as const) {
    if (typeof merged[key] === "string" && deprecatedGeminiModels.has(merged[key] as string)) {
      merged[key] = "gemini-3.8-flash";
      await db.insert(settings).values({ key, value: merged[key] }).onConflictDoUpdate({ target: settings.key, set: { value: merged[key] } });
    }
  }
  return merged as AppSettings;
}

export async function saveSettings(patch: Partial<AppSettings>) {
  const db = await requireDb();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await db
      .insert(settings)
      .values({ key, value: value as unknown })
      .onConflictDoUpdate({ target: settings.key, set: { value: value as unknown } });
  }
  return getSettings();
}

let seeded = false;
/** Inserts the Character Bible roster once (idempotent by slug). */
export async function ensureSeed() {
  if (seeded) return;
  const db = await getDb();
  if (!db) return;
  const existing = await db.select({ slug: characters.slug }).from(characters);
  const have = new Set(existing.map(r => r.slug));
  const missing = CHARACTER_SEED.filter(c => !have.has(c.slug));
  if (missing.length) await db.insert(characters).values(missing);
  try {
    const { syncBundledCharacterImages } = await import("./services/character-images");
    await syncBundledCharacterImages();
  } catch (e) {
    console.warn("[seed] reference images not synced:", e instanceof Error ? e.message : e);
  }
  seeded = true;
}
