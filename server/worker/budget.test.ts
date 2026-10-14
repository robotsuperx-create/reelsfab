import { describe, expect, it } from "vitest";
import { premiumAllowance } from "../services/batch";

describe("premiumAllowance", () => {
  const now = new Date("2026-10-14T00:00:00Z"); // 18 days left incl. today
  it("caps premium clips to the daily share of the remaining budget", () => {
    // $300 budget, nothing spent, $10.8/clip => 300/18=16.6/day => 1 clip
    expect(premiumAllowance({ requested: 9, budgetUsd: 300, spentUsd: 0, perClipUsd: 10.8, now })).toBe(1);
  });
  it("returns zero when the budget is exhausted", () => {
    expect(premiumAllowance({ requested: 9, budgetUsd: 300, spentUsd: 400, perClipUsd: 10.8, now })).toBe(0);
  });
  it("never exceeds the request", () => {
    expect(premiumAllowance({ requested: 2, budgetUsd: 5000, spentUsd: 0, perClipUsd: 1, now })).toBe(2);
  });
});
