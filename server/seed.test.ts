import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTER_SEED } from "./seed";

describe("character seed", () => {
  it("ships a bundled reference portrait for every character except design-file ones", () => {
    for (const c of CHARACTER_SEED) {
      const file = join(process.cwd(), "assets", "characters", `${c.slug}.jpg`);
      expect(existsSync(file), c.slug).toBe(!c.needsDesignFile);
    }
  });
  it("has no legacy storage paths and no age/result claims", () => {
    for (const c of CHARACTER_SEED) {
      expect(c.referenceImages ?? []).toEqual([]);
      expect(c.age ?? "").not.toMatch(/112/);
      expect(c.rules ?? "").toMatch(/AI/);
    }
  });
});
