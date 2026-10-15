import { afterEach, describe, expect, it } from "vitest";
import { checkCompliance, similarity } from "../shared/domain";
import { evaluateQc } from "../shared/production";
import { withDisclosure } from "./services/publishing";
import { slotDate } from "./services/scheduler";

const GOOD_TEXT = {
  hook: "Stop wasting your mornings on tiny tasks",
  body: "Pick one thing that moves your week forward and finish it before you open any messages. Batch the rest after lunch.",
  payoff: "You will feel the difference by Friday",
  cta: "Follow for one small habit every day",
};
const base = {
  durationMs: 14000, width: 1080, height: 1920, hasAudio: true, hasCaptions: true, hasDisclosure: true,
  fileSize: 4_000_000, script: { ...GOOD_TEXT, track: "economic" }, maxSimilarity: 0.1,
};

describe("evaluateQc", () => {
  it("approves a clean reel", () => {
    const r = evaluateQc(base);
    expect(r.verdict).toBe("approved");
    expect(r.score).toBe(100);
  });
  it("rejects a reel with no audio or no AI disclosure", () => {
    expect(evaluateQc({ ...base, hasAudio: false }).verdict).toBe("rejected");
    expect(evaluateQc({ ...base, hasDisclosure: false }).verdict).toBe("rejected");
  });
  it("rejects near-duplicate scripts and flags medium similarity for review", () => {
    expect(evaluateQc({ ...base, maxSimilarity: 0.8 }).verdict).toBe("rejected");
    expect(evaluateQc({ ...base, maxSimilarity: 0.6 }).verdict).toBe("needs_review");
  });
  it("rejects income claims", () => {
    const r = evaluateQc({ ...base, script: { ...base.script, body: `${GOOD_TEXT.body} I made $5000 a month with this.` } });
    expect(r.verdict).toBe("rejected");
  });
  it("sends wrong aspect ratio or length to review/reject", () => {
    expect(evaluateQc({ ...base, width: 1080, height: 1080 }).verdict).toBe("rejected");
    expect(evaluateQc({ ...base, durationMs: 9000 }).verdict).not.toBe("approved");
  });
});

describe("checkCompliance", () => {
  it("blocks income figures and guarantees", () => {
    expect(checkCompliance("I earn $10k per month").some(f => f.severity === "block")).toBe(true);
    expect(checkCompliance("guaranteed results, risk-free").some(f => f.severity === "block")).toBe(true);
  });
  it("lets neutral advice through", () => {
    expect(checkCompliance("Drink water and take a short walk after lunch")).toEqual([]);
  });
});

describe("similarity", () => {
  it("is 1 for identical text and low for unrelated text", () => {
    expect(similarity("alpha beta gamma delta", "alpha beta gamma delta")).toBe(1);
    expect(similarity("alpha beta gamma delta", "totally different words here")).toBeLessThan(0.2);
  });
});

describe("slotDate", () => {
  it("converts a local slot to UTC using the browser offset", () => {
    // UTC+1 (offset -60): 09:00 local is 08:00 UTC
    expect(slotDate("2026-10-15", "09:00", -60).toISOString()).toBe("2026-10-15T08:00:00.000Z");
    expect(slotDate("2026-10-15", "21:30", 0).toISOString()).toBe("2026-10-15T21:30:00.000Z");
  });
});

describe("withDisclosure", () => {
  const prev = process.env.DISCLOSURE_TAGS;
  afterEach(() => {
    if (prev === undefined) delete process.env.DISCLOSURE_TAGS;
    else process.env.DISCLOSURE_TAGS = prev;
  });
  it("appends AI and ad tags once", () => {
    const once = withDisclosure("Tip of the day #habits");
    expect(once).toContain("#AIgenerated");
    expect(once).toContain("#ad");
    expect(withDisclosure(once)).toBe(once);
  });
  it("respects max length and can be disabled", () => {
    expect(withDisclosure("x".repeat(200), 100).length).toBeLessThanOrEqual(100);
    process.env.DISCLOSURE_TAGS = "";
    expect(withDisclosure("hello")).toBe("hello");
  });
});

import { tzOffsetMinutes } from "../shared/domain";

describe("tzOffsetMinutes", () => {
  it("follows daylight saving for the audience time zone", () => {
    expect(tzOffsetMinutes("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(300);
    expect(tzOffsetMinutes("America/New_York", new Date("2026-07-15T12:00:00Z"))).toBe(240);
    expect(tzOffsetMinutes("UTC", new Date())).toBe(0);
    expect(tzOffsetMinutes("Not/AZone", new Date())).toBe(0);
  });
  it("puts a 09:00 New York slot at 13:00 UTC in summer", () => {
    const day = "2026-07-15";
    expect(slotDate(day, "09:00", tzOffsetMinutes("America/New_York", new Date(`${day}T12:00:00Z`))).toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });
});

import { higgsfieldEndpoint } from "./services/higgsfield";

describe("higgsfieldEndpoint", () => {
  it("never turns a display label into an API path", () => {
    expect(higgsfieldEndpoint("Seedance 2.5 · 8s · 1080p")).toBe("https://api.higgsfield.ai/kling-video/v3.0/std/text-to-video");
    expect(higgsfieldEndpoint("bytedance/seedance/v2.5/text-to-video")).toBe("https://api.higgsfield.ai/bytedance/seedance/v2.5/text-to-video");
    expect(higgsfieldEndpoint("https://evil.example.com/x")).toBe("https://api.higgsfield.ai/kling-video/v3.0/std/text-to-video");
    expect(higgsfieldEndpoint(null)).toBe("https://api.higgsfield.ai/kling-video/v3.0/std/text-to-video");
  });
});
