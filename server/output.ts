/**
 * Local output folder for big renders (long-form episodes): free disk instead of object storage quota.
 * Files are served to signed-in members at /api/output/<path> with range support for the player.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";

export function outputDir() {
  return resolve(process.env.OUTPUT_DIR || join(process.cwd(), "output"));
}

/** Absolute path inside the output folder, or null when the relative path tries to escape it. */
export function outputPath(rel: string) {
  const base = outputDir();
  const abs = resolve(base, normalize(rel).replace(/^([/\\])+/, ""));
  return abs === base || abs.startsWith(base + sep) ? abs : null;
}

export async function writeOutput(rel: string, data: Buffer) {
  const abs = outputPath(rel);
  if (!abs) throw new Error(`bad output path: ${rel}`);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, data);
  return { path: abs, url: `/api/output/${rel.replace(/\\/g, "/").replace(/^\/+/, "")}` };
}
