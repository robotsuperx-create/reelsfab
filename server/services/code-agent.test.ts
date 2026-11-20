import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { estimateAgentUsd, formatDuration, segmentCount } from "../../shared/code-video";
import { normalizePlan } from "./code-agent";
import { renderSegments } from "./code-videos";

const run = promisify(execFile);

describe("code → video agent", () => {
  it("cuts long videos into 30–60 s segments and keeps the exact total", () => {
    expect(segmentCount(15)).toBe(1);
    expect(segmentCount(90)).toBe(1);
    expect(segmentCount(180)).toBe(3);
    expect(segmentCount(2400)).toBe(40);
    const plan = normalizePlan({ style: "dark", segments: [{ title: "a", seconds: 999, brief: "x" }] }, 610);
    expect(plan.segments).toHaveLength(11);
    expect(plan.segments.reduce((a, s) => a + s.seconds, 0)).toBe(610);
    expect(plan.segments.every(s => s.seconds >= 30 && s.seconds <= 60)).toBe(true);
    expect(normalizePlan({} as never, 120).segments.map(s => s.seconds)).toEqual([60, 60]);
  });

  it("labels durations and estimates the API cost", () => {
    expect(formatDuration(15)).toBe("15 ث");
    expect(formatDuration(180)).toBe("3 د");
    expect(formatDuration(90)).toBe("1 د 30 ث");
    expect(estimateAgentUsd(2400)).toBeGreaterThan(estimateAgentUsd(30));
    expect(estimateAgentUsd(2400)).toBeLessThan(10);
  });

  it("joins rendered segments into one video of the summed length", async () => {
    const page = (color: string) => `<!doctype html><html><head><style>html,body{margin:0;width:320px;height:320px;background:${color}}</style></head><body></body></html>`;
    const r = await renderSegments([{ html: page("#f00"), seconds: 1 }, { html: page("#00f"), seconds: 1 }], 320, 320, 30, () => undefined);
    const dir = await mkdtemp(join(tmpdir(), "seg-test-"));
    try {
      const file = join(dir, "v.mp4");
      await writeFile(file, r.video);
      const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file]);
      expect(Number(stdout.trim())).toBe(60);
      expect(r.frames).toBe(60);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
