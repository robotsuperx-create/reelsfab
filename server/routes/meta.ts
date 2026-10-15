import crypto from "node:crypto";
import type { Express, Request } from "express";
import { sdk } from "../_core/sdk";
import { exchangeInstagramToken, saveSocialToken } from "../services/social-accounts";

const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url");
const secret = () => process.env.META_APP_SECRET || "";
const STATE_TTL_MS = 15 * 60 * 1000;
function sign(payload: string) { return b64(crypto.createHmac("sha256", secret()).update(payload).digest()); }
function encodeState(data: Record<string, unknown>) { const payload = b64(JSON.stringify(data)); return `${payload}.${sign(payload)}`; }
function decodeState(state: string) { const [payload, sig] = state.split("."); if (!payload || !sig || !secret() || Buffer.from(sig).length !== Buffer.from(sign(payload)).length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(payload)))) throw new Error("Invalid OAuth state"); const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { userId: number; characterId: number; exp?: number }; if (!data.exp || data.exp < Date.now()) throw new Error("OAuth state expired, start again"); return data; }
function env(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is not configured`); return value; }

export function registerMetaRoutes(app: Express) {
  app.get("/api/meta/start", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req as Request).catch(() => null);
      if (!user) return res.status(401).send("Login required");
      if (user.role !== "member" && user.role !== "admin") return res.status(403).send("Account pending approval");
      const characterId = Number(req.query.characterId); if (!Number.isInteger(characterId) || characterId < 1) return res.status(400).send("characterId is required");
      const redirect = new URL("https://www.instagram.com/oauth/authorize");
      redirect.searchParams.set("client_id", env("META_APP_ID")); redirect.searchParams.set("redirect_uri", env("META_REDIRECT_URI")); redirect.searchParams.set("response_type", "code"); redirect.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish"); redirect.searchParams.set("state", encodeState({ userId: user.id, characterId, exp: Date.now() + STATE_TTL_MS }));
      return res.redirect(redirect.toString());
    } catch (e) { return res.status(500).send(e instanceof Error ? e.message : "Meta OAuth is not configured"); }
  });
  app.get("/api/meta/callback", async (req, res) => {
    try {
      const state = decodeState(String(req.query.state ?? "")); const code = String(req.query.code ?? ""); if (!code) return res.status(400).send("Missing OAuth code");
      const form = new URLSearchParams({ client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), grant_type: "authorization_code", redirect_uri: env("META_REDIRECT_URI"), code });
      const tokenResponse = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form }); const token = await tokenResponse.json() as { access_token?: string; user_id?: string; error_message?: string }; if (!tokenResponse.ok || !token.access_token || !token.user_id) throw new Error(token.error_message || "Instagram token exchange failed");
      // The login token lives ~1 hour; publishing needs the 60-day long-lived token.
      const longLived = await exchangeInstagramToken(token.access_token, env("META_APP_SECRET"));
      const profileResponse = await fetch(`https://graph.instagram.com/v26.0/${encodeURIComponent(String(token.user_id))}?fields=id,username&access_token=${encodeURIComponent(longLived.accessToken)}`); const profile = await profileResponse.json() as { id?: string; username?: string };
      await saveSocialToken({ characterId: state.characterId, platform: "instagram", handle: profile.username ? `@${profile.username}` : null, platformUserId: profile.id ?? String(token.user_id), accessToken: longLived.accessToken, expiresAt: longLived.expiresAt, timezone: "UTC", userId: state.userId });
      return res.redirect(`/characters/${state.characterId}?social=connected`);
    } catch (e) { return res.status(400).send(e instanceof Error ? e.message : "Instagram connection failed"); }
  });
}
