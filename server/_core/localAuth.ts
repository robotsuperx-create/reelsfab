import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { loginAttempts } from "../../drizzle/schema";
import { requireDb } from "../db";
import { getSessionCookieOptions } from "./cookies";

export const LOCAL_OPEN_ID = "local_admin";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
function clientKey(req: Request, identifier: string) {
  // Do not trust X-Forwarded-For: clients can spoof it unless a trusted proxy
  // allow-list is configured. The socket address is the only safe default here.
  const ip = req.socket.remoteAddress || "unknown";
  return `${ip || "unknown"}:${identifier.trim().toLowerCase()}`;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function verifyLocalCredentials(req: Request, identifier: string, password: string) {
  const db = await requireDb();
  const configuredIdentifier = process.env.APP_ADMIN_IDENTIFIER ?? "";
  const configuredPassword = process.env.APP_ADMIN_PASSWORD ?? "";
  const normalizedIdentifier = identifier.trim();
  const key = clientKey(req, normalizedIdentifier);
  const now = new Date();
  const [current] = await db.select().from(loginAttempts).where(eq(loginAttempts.key, key));

  if (current && now.getTime() - current.firstAttemptAt.getTime() >= WINDOW_MS) {
    await db.delete(loginAttempts).where(eq(loginAttempts.key, key));
  }
  const active = current && now.getTime() - current.firstAttemptAt.getTime() < WINDOW_MS ? current : null;
  if (active && active.count >= MAX_ATTEMPTS) return false;

  const valid = Boolean(configuredIdentifier && configuredPassword)
    && safeEqual(normalizedIdentifier, configuredIdentifier.trim())
    && safeEqual(password, configuredPassword);

  if (valid) {
    await db.delete(loginAttempts).where(eq(loginAttempts.key, key));
    return true;
  }

  if (active) {
    await db.update(loginAttempts).set({ count: active.count + 1, updatedAt: now }).where(eq(loginAttempts.key, key));
  } else {
    await db.insert(loginAttempts).values({ key, count: 1, firstAttemptAt: now, updatedAt: now });
  }
  return false;
}

export function setLocalSessionCookie(req: Request, res: Response, sessionToken: string) {
  res.cookie(COOKIE_NAME, sessionToken, {
    ...getSessionCookieOptions(req),
    maxAge: ONE_YEAR_MS,
  });
}
