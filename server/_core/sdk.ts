import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { getSupabaseIdentity } from "../services/supabase-auth";
import { ENV } from "./env";
import { LOCAL_OPEN_ID } from "./localAuth";

export type SessionPayload = { openId: string; appId: string; name: string };
export type AuthenticatedUser = User;

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Session handling: signed cookie (local admin login) or a Supabase Auth access token. */
class AuthServer {
  private secret() {
    if (!ENV.cookieSecret) throw new Error("SESSION_SECRET is unavailable");
    return new TextEncoder().encode(ENV.cookieSecret);
  }

  async createSessionToken(openId: string, options: { expiresInMs?: number; name?: string } = {}) {
    return this.signSession({ openId, appId: ENV.appId, name: options.name || "" }, options);
  }

  async signSession(payload: SessionPayload, options: { expiresInMs?: number } = {}) {
    const exp = Math.floor((Date.now() + (options.expiresInMs ?? ONE_YEAR_MS)) / 1000);
    return new SignJWT({ openId: payload.openId, appId: payload.appId, name: payload.name })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(exp)
      .sign(this.secret());
  }

  async verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.secret(), { algorithms: ["HS256"] });
      const { openId, appId, name } = payload as Record<string, unknown>;
      if (!isNonEmptyString(openId) || appId !== ENV.appId || typeof name !== "string") return null;
      return { openId, appId, name };
    } catch {
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const cookies = new Map(Object.entries(parseCookieHeader(req.headers.cookie ?? "")));
    let token = cookies.get(COOKIE_NAME);
    let bearer: string | null = null;
    if (!token) {
      const h = req.headers.authorization;
      if (typeof h === "string" && h.startsWith("Bearer ")) {
        bearer = h.slice(7);
        token = bearer;
      }
    }
    const session = await this.verifySession(token);

    if (!session && bearer) {
      const identity = await getSupabaseIdentity(bearer);
      if (identity) {
        const openId = `supabase:${identity.id}`;
        await db.upsertUser({ openId, name: identity.name, email: identity.email, loginMethod: "supabase", lastSignedIn: new Date() });
        const user = await db.getUserByOpenId(openId);
        if (user) return user;
      }
    }
    if (!session) throw ForbiddenError("Invalid session");

    const user = await db.getUserByOpenId(session.openId);
    if (!user) throw ForbiddenError("User not found");
    if (session.openId === LOCAL_OPEN_ID && user.role !== "admin") throw ForbiddenError("Local administrator is not provisioned");
    await db.upsertUser({ openId: user.openId, lastSignedIn: new Date(), ...(session.openId === LOCAL_OPEN_ID ? { role: "admin" as const } : {}) });
    return user;
  }
}

export const sdk = new AuthServer();
