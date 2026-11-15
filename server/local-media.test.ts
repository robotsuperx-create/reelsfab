import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localMediaEnabled, localMediaPath, mediaPut, storageDownload, storageKeyFromUrl } from "./storage";

let dir = "";
const env = { MEDIA_DIR: process.env.MEDIA_DIR, MEDIA_STORAGE: process.env.MEDIA_STORAGE, NODE_ENV: process.env.NODE_ENV };
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "media-"));
  process.env.MEDIA_DIR = dir;
  process.env.MEDIA_STORAGE = "local";
});
afterAll(async () => {
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  await rm(dir, { recursive: true, force: true });
});

describe("local media storage", () => {
  it("writes heavy media to disk and reads it back through the same key", async () => {
    const put = await mediaPut("broll/pixabay-42.mp4", Buffer.from("video-bytes"), "video/mp4");
    expect(put.key).toMatch(/^local\/broll\/pixabay-42_[0-9a-f]{8}\.mp4$/);
    expect(put.url).toBe(`/api/media/${put.key}`);
    expect(storageKeyFromUrl(put.url)).toBe(put.key);
    expect((await stat(localMediaPath(put.key))).size).toBe(11);
    expect((await storageDownload(put.key)).toString()).toBe("video-bytes");
  });

  it("refuses keys that would leave the media folder", () => {
    expect(() => localMediaPath("local/../secret.txt")).toThrow();
    expect(() => localMediaPath("local/a\\..\\b")).toThrow();
    expect(() => localMediaPath("broll/x.mp4")).toThrow(/not a local/);
  });

  it("is on by default outside production and can be forced either way", () => {
    delete process.env.MEDIA_STORAGE;
    process.env.NODE_ENV = "development";
    expect(localMediaEnabled()).toBe(true);
    process.env.NODE_ENV = "production";
    expect(localMediaEnabled()).toBe(false);
    process.env.MEDIA_STORAGE = "local";
    expect(localMediaEnabled()).toBe(true);
    process.env.MEDIA_STORAGE = "supabase";
    process.env.NODE_ENV = "development";
    expect(localMediaEnabled()).toBe(false);
    process.env.MEDIA_STORAGE = "local";
  });
});
