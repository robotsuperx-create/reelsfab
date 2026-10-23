import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeDuration } from "./tts";

/** Real length of a media buffer in milliseconds (ffprobe); `fallbackMs` when ffprobe is unavailable. */
export async function probeBufferDurationMs(buf: Buffer, fallbackMs: number) {
  const dir = await mkdtemp(join(tmpdir(), "probe-"));
  try {
    const file = join(dir, "media.bin");
    await writeFile(file, buf);
    const sec = await probeDuration(file);
    return sec > 0 ? Math.round(sec * 1000) : fallbackMs;
  } catch {
    return fallbackMs;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
