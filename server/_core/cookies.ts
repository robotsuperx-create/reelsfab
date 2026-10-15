import type { CookieOptions, Request } from "express";

function isHttps(req: Request) {
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  return req.protocol === "https" || forwarded === "https";
}

/**
 * First-party session cookie: HttpOnly, SameSite=Lax (blocks cross-site form posts) and Secure on HTTPS.
 * Plain-HTTP localhost is allowed for development and the local test suites.
 */
export function getSessionCookieOptions(req: Request): CookieOptions {
  const local = ["localhost", "127.0.0.1"].includes(req.hostname);
  return { httpOnly: true, path: "/", sameSite: "lax", secure: isHttps(req) || !local };
}
