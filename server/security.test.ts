import { afterEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import { hasValidCronSecret, UPLOAD_MIME_ALLOWLIST } from "./_core/security";

const req = (authorization?: string) => ({ headers: { authorization } }) as unknown as Request;

describe("scheduler secret", () => {
  afterEach(() => { delete process.env.CRON_SECRET; });

  it("rejects when no secret is configured", () => {
    expect(hasValidCronSecret(req("Bearer anything"))).toBe(false);
  });
  it("rejects short secrets", () => {
    process.env.CRON_SECRET = "short";
    expect(hasValidCronSecret(req("Bearer short"))).toBe(false);
  });
  it("accepts only the exact bearer token", () => {
    process.env.CRON_SECRET = "a".repeat(32);
    expect(hasValidCronSecret(req(`Bearer ${"a".repeat(32)}`))).toBe(true);
    expect(hasValidCronSecret(req(`Bearer ${"b".repeat(32)}`))).toBe(false);
    expect(hasValidCronSecret(req(undefined))).toBe(false);
  });
});

describe("upload allow-list", () => {
  it("blocks active content types", () => {
    for (const t of ["text/html", "image/svg+xml", "application/javascript"]) {
      expect(UPLOAD_MIME_ALLOWLIST.has(t)).toBe(false);
    }
    expect(UPLOAD_MIME_ALLOWLIST.has("video/mp4")).toBe(true);
  });
});
