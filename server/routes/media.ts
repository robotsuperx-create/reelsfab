import express, { type Express, type Request, type Response } from "express";
import { jwtVerify } from "jose";
import { parse as parseCookieHeader } from "cookie";
import { assets } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { sdk } from "../_core/sdk";
import { getSettings, requireDb } from "../db";
import { runDailyAutomation } from "../services/batch";
import { publishDueInstagramPosts, publishDueSocialPosts } from "../services/publishing";
import { syncHiggsfieldClips } from "../services/higgsfield-jobs";
import { syncPublishedMetrics } from "../services/analytics-sync";
import { storageGetSignedUrl, storagePut } from "../storage";
import { hasValidCronSecret, UPLOAD_MAX_BYTES, UPLOAD_MIME_ALLOWLIST } from "../_core/security";

const ASSET_KINDS = [
  "character_image",
  "background",
  "music",
  "premium_video",
  "render",
  "thumbnail",
  "voice",
  "other",
] as const;
type AssetKind = (typeof ASSET_KINDS)[number];

async function requireMember(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (user.role !== "member" && user.role !== "admin") {
      res.status(403).json({ error: "pending approval" });
      return null;
    }
    return user;
  } catch {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80) || "file";
}

async function requireScheduledTask(req: Request, res: Response, expectedTaskUid: string | null) {
  if (hasValidCronSecret(req)) return "cron-secret";
  try {
    const token = parseCookieHeader(req.headers.cookie ?? "")["app_session_id"];
    if (!token || !expectedTaskUid) {
      res.status(401).json({ error: "missing scheduler ticket" });
      return null;
    }
    const { payload } = await jwtVerify(token, new TextEncoder().encode(ENV.cookieSecret), { algorithms: ["HS256"] });
    if (payload.appId !== ENV.appId || typeof payload.openId !== "string" || !payload.openId.startsWith("cron_")) {
      res.status(403).json({ error: "invalid scheduler ticket" });
      return null;
    }
    const infoResp = await fetch(`${ENV.oAuthServerUrl.replace(/\/$/, "")}/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jwt_token: token, project_id: ENV.appId }),
    });
    if (!infoResp.ok) {
      res.status(403).json({ error: "identity lookup failed" });
      return null;
    }
    const info = (await infoResp.json()) as { taskUid?: string };
    if (info.taskUid !== expectedTaskUid) {
      res.status(403).json({ error: "unknown schedule" });
      return null;
    }
    return token;
  } catch {
    res.status(403).json({ error: "invalid scheduler ticket" });
    return null;
  }
}

export function registerMediaRoutes(app: Express) {
  // Raw binary upload → project storage → assets row.
  app.post(
    "/api/upload",
    express.raw({ type: () => true, limit: UPLOAD_MAX_BYTES }),
    async (req: Request, res: Response) => {
      const user = await requireMember(req, res);
      if (!user) return;
      const kind = String(req.query.kind ?? "other") as AssetKind;
      if (!ASSET_KINDS.includes(kind)) {
        res.status(400).json({ error: "invalid kind" });
        return;
      }
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: "empty body" });
        return;
      }
      const filename = safeName(String(req.query.filename ?? "upload.bin"));
      const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!UPLOAD_MIME_ALLOWLIST.has(contentType)) {
        res.status(415).json({ error: "unsupported media type" });
        return;
      }
      const num = (k: string) => {
        const v = req.query[k];
        const n = typeof v === "string" ? Number(v) : NaN;
        return Number.isFinite(n) ? Math.round(n) : null;
      };
      try {
        const { key, url } = await storagePut(`${kind}/${filename}`, body, contentType);
        const db = await requireDb();
        const [r] = await db.insert(assets).values({
          kind,
          characterId: num("characterId"),
          title: String(req.query.title ?? filename).slice(0, 255),
          url,
          storageKey: key,
          mimeType: contentType.slice(0, 120),
          sizeBytes: body.length,
          durationMs: num("durationMs"),
          width: num("width"),
          height: num("height"),
          createdBy: user.id,
        }).returning({ id: assets.id });
        res.json({ id: r.id, url, key, size: body.length });
      } catch (e) {
        console.error("[upload] failed", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "upload failed" });
      }
    },
  );

  // Same-origin byte proxy so canvases/WebCodecs can read stored media without CORS tainting.
  app.get("/api/media/*", async (req: Request, res: Response) => {
    const user = await requireMember(req, res);
    if (!user) return;
    const key = (req.params as Record<string, string>)[0];
    if (!key || key.includes("..")) {
      res.status(400).send("bad key");
      return;
    }
    try {
      const signed = await storageGetSignedUrl(key);
      const upstream = await fetch(signed);
      if (!upstream.ok || !upstream.body) {
        res.status(upstream.status || 502).send("upstream error");
        return;
      }
      const upstreamType = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      // Never reflect an arbitrary stored type: anything outside the allow-list is served as an opaque download.
      res.setHeader("Content-Type", UPLOAD_MIME_ALLOWLIST.has(upstreamType) ? upstreamType : "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Content-Disposition", "inline");
      const len = upstream.headers.get("content-length");
      if (len) res.setHeader("Content-Length", len);
      res.setHeader("Cache-Control", "private, max-age=600");
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) await new Promise(r => res.once("drain", r));
      }
      res.end();
    } catch (e) {
      console.error("[media] proxy failed", e);
      if (!res.headersSent) res.status(502).send("proxy error");
      else res.end();
    }
  });

  // Heartbeat daily batch callback.
  app.post("/api/scheduled/daily-batch", async (req: Request, res: Response) => {
    try {
      const settings = await getSettings();
      const ticket = await requireScheduledTask(req, res, settings.automationTaskUid);
      if (!ticket) return;
      if (!settings.automationEnabled) {
        res.json({ ok: true, skipped: "automation disabled" });
        return;
      }
      const result = await runDailyAutomation("schedule");
      const higgsfield = await syncHiggsfieldClips();
      res.json({ ok: true, ...result, higgsfield });
    } catch (e) {
      console.error("[scheduled] daily batch failed", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "failed" });
    }
  });

  app.post("/api/scheduled/publish-due", async (req: Request, res: Response) => {
    try {
      const settings = await getSettings();
      const ticket = await requireScheduledTask(req, res, settings.publishingTaskUid);
      if (!ticket) return;
      if (!settings.automationEnabled) {
        res.json({ ok: true, skipped: "automation disabled" });
        return;
      }
      const higgsfield = await syncHiggsfieldClips();
      const instagram = await publishDueInstagramPosts();
      const social = await publishDueSocialPosts();
      const analytics = await syncPublishedMetrics();
      res.json({ ok: true, instagram, social, higgsfield, analytics });
    } catch (e) {
      console.error("[scheduled] Instagram publish failed", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "publish failed" });
    }
  });
}
