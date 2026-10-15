import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Baseline security headers (a dependency-free subset of helmet). */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", process.env.ALLOW_FRAMING === "true" ? "SAMEORIGIN" : "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Content-Security-Policy", contentSecurityPolicy());
  }
  next();
}

let cachedCsp: string | null = null;
/** Strict CSP for the app shell: own scripts plus the few third parties the UI really uses (Supabase Auth, Google Fonts, Kokoro). */
export function contentSecurityPolicy() {
  if (cachedCsp) return cachedCsp;
  let supabase = "";
  try {
    const u = new URL(process.env.SUPABASE_URL ?? "");
    supabase = ` ${u.origin} wss://${u.host}`;
  } catch {
    /* no Supabase configured */
  }
  cachedCsp = [
    "default-src 'self'",
    // In-browser Kokoro voice (Studio) loads its module + ONNX wasm from jsDelivr.
    "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    // ...and its model weights from Hugging Face (which redirects to its CDNs).
    `connect-src 'self'${supabase} https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.hf.co`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return cachedCsp;
}

/** Fixed-window in-memory limiter keyed by socket address (per instance). */
export function rateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, opts.windowMs).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const cur = hits.get(key);
    if (!cur || cur.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    cur.count += 1;
    if (cur.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((cur.resetAt - now) / 1000)));
      res.status(429).json({ error: "too many requests" });
      return;
    }
    next();
  };
}

/** Constant-time check of `Authorization: Bearer <CRON_SECRET>` for scheduler callbacks. */
export function hasValidCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 24) return false;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const UPLOAD_MIME_ALLOWLIST = new Set([
  "image/png", "image/jpeg", "image/webp",
  "video/mp4", "video/webm", "video/quicktime",
  "audio/mpeg", "audio/wav", "audio/mp4", "audio/webm",
]);
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
