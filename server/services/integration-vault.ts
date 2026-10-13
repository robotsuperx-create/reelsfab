import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { integrations } from "../../drizzle/schema";
import { requireDb } from "../db";

function encryptionKey() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.META_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(value: string) {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("Invalid encrypted integration value");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export async function getIntegrationConfig(provider: string): Promise<Record<string, string>> {
  const db = await requireDb();
  const [row] = await db.select({ encryptedConfig: integrations.encryptedConfig })
    .from(integrations)
    .where(eq(integrations.provider, provider))
    .orderBy(desc(integrations.updatedAt))
    .limit(1);
  if (!row) return {};
  try { return JSON.parse(decryptSecret(row.encryptedConfig)) as Record<string, string>; } catch { return {}; }
}
