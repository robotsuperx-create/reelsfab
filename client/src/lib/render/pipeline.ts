import type { TemplateKey } from "@shared/domain";
import { exportReel, uploadRender, type RenderCreatePayload } from "./encode";
import type { MusicChoice, PreparedReel } from "./prepare";

export function defaultMusicFor(template: string | null | undefined): MusicChoice {
  const t = (template ?? "direct_tip") as TemplateKey;
  if (t === "story_wisdom") return { kind: "generated", mood: "moody" };
  if (t === "comparison" || t === "three_points") return { kind: "generated", mood: "bright" };
  return { kind: "generated", mood: "warm" };
}

export type QcResult = { verdict: "approved" | "needs_review" | "rejected"; checks: { key: string; label: string; status: "pass" | "warn" | "fail"; detail?: string }[] };

/** Encodes, uploads and registers a render; returns the server-side QC verdict. */
export async function renderAndSave(opts: {
  prepared: PreparedReel;
  slug: string;
  create: (p: RenderCreatePayload) => Promise<{ id: number; qc: QcResult }>;
  onProgress?: (phase: "encoding" | "uploading" | "qc", p: number) => void;
}) {
  const result = await exportReel(opts.prepared, p => opts.onProgress?.("encoding", p));
  opts.onProgress?.("uploading", 0);
  const payload = await uploadRender(opts.prepared, result, opts.slug);
  opts.onProgress?.("qc", 0);
  const saved = await opts.create(payload);
  return { ...saved, blob: result.blob, meta: result.meta };
}
