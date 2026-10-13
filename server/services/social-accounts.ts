import { and, eq } from "drizzle-orm";
import { socialAccounts } from "../../drizzle/schema";
import { requireDb } from "../db";
import { decryptSecret, encryptSecret } from "./integration-vault";

export { decryptSecret, encryptSecret } from "./integration-vault";

export async function listSocialAccounts(characterId?: number) {
  const db = await requireDb();
  const rows = await db.select({ id: socialAccounts.id, characterId: socialAccounts.characterId, platform: socialAccounts.platform, handle: socialAccounts.handle, platformUserId: socialAccounts.platformUserId, tokenExpiresAt: socialAccounts.tokenExpiresAt, timezone: socialAccounts.timezone, status: socialAccounts.status, lastError: socialAccounts.lastError, createdAt: socialAccounts.createdAt, updatedAt: socialAccounts.updatedAt }).from(socialAccounts).where(characterId ? eq(socialAccounts.characterId, characterId) : undefined);
  return rows;
}

export async function saveSocialToken(input: { id?: number; characterId: number; platform: "instagram"|"tiktok"|"youtube"; handle?: string|null; platformUserId?: string|null; accessToken: string; refreshToken?: string|null; expiresAt?: Date|null; timezone?: string; userId: number }) {
  const db = await requireDb();
  const values = { characterId: input.characterId, platform: input.platform, handle: input.handle ?? null, platformUserId: input.platformUserId ?? null, encryptedAccessToken: encryptSecret(input.accessToken), encryptedRefreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : null, tokenExpiresAt: input.expiresAt ?? null, timezone: input.timezone ?? "UTC", status: "connected" as const, lastError: null, connectedBy: input.userId };
  if (input.id) await db.update(socialAccounts).set(values).where(eq(socialAccounts.id, input.id));
  else await db.insert(socialAccounts).values(values);
  return listSocialAccounts(input.characterId);
}

export async function deleteSocialAccount(id: number) {
  const db = await requireDb();
  await db.delete(socialAccounts).where(eq(socialAccounts.id, id));
  return { ok: true };
}

export async function getInstagramToken(id: number) {
  const db = await requireDb();
  const [row] = await db.select().from(socialAccounts).where(and(eq(socialAccounts.id, id), eq(socialAccounts.platform, "instagram")));
  if (!row?.encryptedAccessToken) throw new Error("Instagram account is not connected");
  return { ...row, accessToken: decryptSecret(row.encryptedAccessToken) };
}
