import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

const PUBLIC = new Set(["auth.me", "auth.localLogin", "auth.logout", "system.health"]);
const procedures = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);

function ctx(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {}, hostname: "example.com", socket: {} } as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}
const pending = { id: 9, openId: "supabase:pending", name: "Pending", email: "p@example.com", loginMethod: "supabase", role: "user" as const, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };

async function codeOf(user: TrpcContext["user"], path: string) {
  const caller = appRouter.createCaller(ctx(user)) as unknown as Record<string, unknown>;
  const fn = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], caller) as (i?: unknown) => Promise<unknown>;
  try {
    await fn(undefined);
    return "OK";
  } catch (e) {
    return e instanceof TRPCError ? e.code : "THROW";
  }
}

describe("access control on every tRPC procedure", () => {
  it("has a meaningful number of procedures", () => {
    expect(procedures.length).toBeGreaterThan(40);
  });
  it("rejects anonymous visitors everywhere except the public auth endpoints", async () => {
    const leaks: string[] = [];
    for (const p of procedures) {
      if (PUBLIC.has(p)) continue;
      const code = await codeOf(null, p);
      if (code !== "UNAUTHORIZED" && code !== "FORBIDDEN") leaks.push(`${p} -> ${code}`);
    }
    expect(leaks).toEqual([]);
  });
  it("rejects users still pending approval", async () => {
    const leaks: string[] = [];
    for (const p of procedures) {
      if (PUBLIC.has(p) || p === "team.access") continue;
      const code = await codeOf(pending, p);
      if (code !== "FORBIDDEN") leaks.push(`${p} -> ${code}`);
    }
    expect(leaks).toEqual([]);
  });
});
