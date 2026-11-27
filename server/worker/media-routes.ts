/**
 * Pictures inside the recorder. Pages are isolated (no network but the CDN allow-list), so stored pictures are
 * served under the render origin:
 *   https://code-video.local/cv-media/<storage key>              a stored image
 *   https://code-video.local/cv-clip/<storage key>/<startMs>/<n>.jpg   frame n (25 fps) of a stored clip
 * Clip frames are extracted once per clip with ffmpeg, already cropped to the stage, so every recorded frame shows
 * exactly the clip frame of its moment (no <video> element, which the virtual clock cannot drive exactly).
 * Only image and video files of the studio's own storage are served.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Route } from "playwright-core";
import { storageDownload } from "../storage";

export const MEDIA_ORIGIN = "https://code-video.local/";
export const CLIP_FPS = 25;
const CLIP_SECONDS = 20;
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const VIDEO_RE = /\.(mp4|mov|m4v|webm)$/i;
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

function ffmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => execFile("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024 }, (err, _o, stderr) => (err ? reject(new Error(String(stderr).slice(0, 300) || err.message)) : resolve())));
}

export class MediaRoutes {
  private dir: Promise<string> | null = null;
  private images = new Map<string, Promise<Buffer>>();
  private clips = new Map<string, Promise<{ dir: string; count: number }>>();

  constructor(private width: number, private height: number) {}

  handles(url: string) {
    return url.startsWith(`${MEDIA_ORIGIN}cv-media/`) || url.startsWith(`${MEDIA_ORIGIN}cv-clip/`);
  }

  private work() {
    this.dir ??= mkdtemp(join(tmpdir(), "cv-media-"));
    return this.dir;
  }

  private image(key: string) {
    let p = this.images.get(key);
    if (!p) {
      p = storageDownload(key);
      this.images.set(key, p);
    }
    return p;
  }

  private clip(key: string, startMs: number) {
    const id = `${key}|${startMs}`;
    let p = this.clips.get(id);
    if (!p) {
      p = (async () => {
        const root = await this.work();
        const tag = createHash("sha1").update(id).digest("hex").slice(0, 12);
        const src = join(root, `${tag}.src`);
        const out = join(root, tag);
        await writeFile(src, await storageDownload(key));
        await mkdir(out, { recursive: true });
        const W = this.width + (this.width % 2), H = this.height + (this.height % 2);
        await ffmpeg(["-v", "error", "-y", "-ss", (startMs / 1000).toFixed(3), "-i", src, "-t", String(CLIP_SECONDS), "-an", "-vf", `fps=${CLIP_FPS},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic,crop=${W}:${H}`, "-q:v", "3", "-start_number", "0", join(out, "%d.jpg")]);
        const count = (await readdir(out)).filter(f => f.endsWith(".jpg")).length;
        if (!count) throw new Error("clip has no frames");
        return { dir: out, count };
      })();
      this.clips.set(id, p);
    }
    return p;
  }

  async fulfill(route: Route, url: string) {
    try {
      const rest = url.slice(MEDIA_ORIGIN.length);
      if (rest.startsWith("cv-media/")) {
        const key = decodeURIComponent(rest.slice("cv-media/".length).split("?")[0]);
        if (!IMAGE_RE.test(key) || key.includes("..")) return route.abort("blockedbyclient");
        const body = await this.image(key);
        return route.fulfill({ status: 200, contentType: TYPES[key.split(".").pop()!.toLowerCase()] ?? "image/jpeg", headers: { "cache-control": "no-store" }, body });
      }
      const m = /^cv-clip\/([^/]+)\/(\d+)\/(\d+)\.jpg$/.exec(rest.split("?")[0]);
      if (!m) return route.abort("blockedbyclient");
      const key = decodeURIComponent(m[1]);
      if (!VIDEO_RE.test(key) || key.includes("..")) return route.abort("blockedbyclient");
      const clip = await this.clip(key, Number(m[2]));
      const n = Math.min(clip.count - 1, Number(m[3]));
      const body = await readFile(join(clip.dir, `${n}.jpg`));
      return route.fulfill({ status: 200, contentType: "image/jpeg", headers: { "cache-control": "max-age=3600" }, body });
    } catch {
      return route.abort("failed").catch(() => undefined);
    }
  }

  async dispose() {
    const d = this.dir;
    this.dir = null;
    this.images.clear();
    this.clips.clear();
    if (d) await rm(await d, { recursive: true, force: true }).catch(() => undefined);
  }
}
