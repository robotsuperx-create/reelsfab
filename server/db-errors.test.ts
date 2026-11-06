import { afterEach, describe, expect, it } from "vitest";
import { describeDbError, looksLikePausedProject, setupUrl } from "./db";

const PORT = process.env.PORT;
afterEach(() => {
  if (PORT === undefined) delete process.env.PORT;
  else process.env.PORT = PORT;
});

describe("describeDbError", () => {
  it("explains a paused Supabase project (pooler forgot the tenant)", () => {
    const e = { message: "Failed query: select 1", cause: { message: "Tenant or user not found", code: "XX000" } };
    const text = describeDbError(e);
    expect(text).toContain("Tenant or user not found (XX000)");
    expect(text).toContain("PAUSED");
    expect(text).toContain("Restore project");
    expect(looksLikePausedProject(e)).toBe(true);
  });

  it("treats a vanished host as paused/deleted too, but not a refused local connection", () => {
    expect(looksLikePausedProject({ message: "connect", cause: { message: "getaddrinfo ENOTFOUND db.ref.supabase.co", code: "ENOTFOUND" } })).toBe(true);
    const refused = { message: "connect", cause: { message: "connect ECONNREFUSED 127.0.0.1:1", code: "ECONNREFUSED" } };
    expect(looksLikePausedProject(refused)).toBe(false);
    expect(describeDbError(refused)).toBe("connect — connect ECONNREFUSED 127.0.0.1:1 (ECONNREFUSED)");
  });

  it("points the setup hints at the port the server actually runs on", () => {
    process.env.PORT = "3100";
    expect(setupUrl()).toBe("http://localhost:3100/setup");
    expect(describeDbError({ message: "password authentication failed for user", cause: { code: "28P01" } })).toContain("http://localhost:3100/setup");
    delete process.env.PORT;
    expect(setupUrl()).toBe("http://localhost:3000/setup");
  });
});
