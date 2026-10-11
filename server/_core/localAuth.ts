import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";

export const LOCAL_OPEN_ID = "local_admin";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; firstAttemptAt: number }>();

function clientKey(req: Request, identifier: string) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : req.ip;
  return `${ip || "unknown"}:${identifier.trim().toLowerCase()}`;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyLocalCredentials(req: Request, identifier: string, password: string) {
  const configuredIdentifier = process.env.APP_ADMIN_IDENTIFIER ?? "";
  const configuredPassword = process.env.APP_ADMIN_PASSWORD ?? "";
  const normalizedIdentifier = identifier.trim();
  const key = clientKey(req, normalizedIdentifier);
  const now = Date.now();
  const current = attempts.get(key);

  if (current && now - current.firstAttemptAt >= WINDOW_MS) attempts.delete(key);
  const active = attempts.get(key);
  if (active && active.count >= MAX_ATTEMPTS) return false;

  const valid = Boolean(configuredIdentifier && configuredPassword)
    && safeEqual(normalizedIdentifier, configuredIdentifier.trim())
    && safeEqual(password, configuredPassword);

  if (valid) {
    attempts.delete(key);
    return true;
  }

  const next = active && now - active.firstAttemptAt < WINDOW_MS
    ? { count: active.count + 1, firstAttemptAt: active.firstAttemptAt }
    : { count: 1, firstAttemptAt: now };
  attempts.set(key, next);
  return false;
}

export function setLocalSessionCookie(req: Request, res: Response, sessionToken: string) {
  res.cookie(COOKIE_NAME, sessionToken, {
    ...getSessionCookieOptions(req),
    maxAge: ONE_YEAR_MS,
  });
}
