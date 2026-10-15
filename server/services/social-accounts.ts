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

/** Short-lived Instagram login token -> long-lived (60 days) token. */
export async function exchangeInstagramToken(shortToken: string, appSecret: string) {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortToken);
  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!res.ok || !body.access_token) throw new Error(`Instagram long-lived token exchange failed: ${body.error?.message ?? res.status}`);
  return { accessToken: body.access_token, expiresAt: new Date(Date.now() + (body.expires_in ?? 5_184_000) * 1000) };
}

/** Refreshes long-lived Instagram tokens that expire within `withinDays` (each refresh grants another 60 days). */
export async function refreshExpiringInstagramTokens(withinDays = 10) {
  const db = await requireDb();
  const rows = await db.select().from(socialAccounts).where(and(eq(socialAccounts.platform, "instagram"), eq(socialAccounts.status, "connected")));
  const soon = Date.now() + withinDays * 86400000;
  let refreshed = 0;
  const errors: string[] = [];
  for (const row of rows) {
    if (!row.encryptedAccessToken || !row.tokenExpiresAt || row.tokenExpiresAt.getTime() > soon) continue;
    try {
      const url = new URL("https://graph.instagram.com/refresh_access_token");
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", decryptSecret(row.encryptedAccessToken));
      const res = await fetch(url);
      const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { message?: string } };
      if (!res.ok || !body.access_token) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      await db
        .update(socialAccounts)
        .set({ encryptedAccessToken: encryptSecret(body.access_token), tokenExpiresAt: new Date(Date.now() + (body.expires_in ?? 5_184_000) * 1000), lastError: null })
        .where(eq(socialAccounts.id, row.id));
      refreshed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${row.handle ?? row.id}: ${msg}`);
      await db.update(socialAccounts).set({ lastError: `token refresh: ${msg}`.slice(0, 500) }).where(eq(socialAccounts.id, row.id));
    }
  }
  return { refreshed, errors };
}
