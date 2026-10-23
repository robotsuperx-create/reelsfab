import { and, desc, eq, sql } from "drizzle-orm";
import { renders, scripts } from "../../drizzle/schema";
import { similarity, spokenText } from "../../shared/domain";
import { evaluateQc } from "../../shared/production";
import { requireDb } from "../db";

export type RenderRecordInput = {
  scriptId: number;
  kind: "economic" | "derivative" | "premium" | "montage";
  variantLabel?: string | null;
  videoUrl: string;
  storageKey?: string | null;
  thumbnailUrl?: string | null;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasCaptions: boolean;
  hasDisclosure: boolean;
  fileSize: number;
  settings?: Record<string, unknown>;
};

async function maxSimilarityFor(scriptId: number) {
  const db = await requireDb();
  const [s] = await db.select().from(scripts).where(eq(scripts.id, scriptId));
  if (!s) return { script: null, max: 0 };
  if (s.track === "derivative") return { script: s, max: 0 };
  const others = await db
    .select({ id: scripts.id, hook: scripts.hook, body: scripts.body, payoff: scripts.payoff, cta: scripts.cta })
    .from(scripts)
    .where(and(eq(scripts.characterId, s.characterId), sql`${scripts.id} <> ${s.id}`, sql`${scripts.track} <> 'derivative'`))
    .orderBy(desc(scripts.id))
    .limit(300);
  const text = spokenText(s);
  let max = 0;
  for (const o of others) max = Math.max(max, similarity(text, spokenText(o)));
  return { script: s, max };
}

/** Stores a finished render, runs the automatic QC and moves the script to its next status. */
export async function createRenderRecord(input: RenderRecordInput, createdBy: number | null) {
  const db = await requireDb();
  const { script, max } = await maxSimilarityFor(input.scriptId);
  if (!script) throw new Error("Script not found");
  const qc = evaluateQc({ ...input, script, maxSimilarity: max });
  const [r] = await db
    .insert(renders)
    .values({
      ...input,
      variantLabel: input.variantLabel ?? null,
      characterId: script.characterId,
      qcStatus: qc.verdict,
      qcReport: qc,
      createdBy,
    })
    .returning({ id: renders.id });
  await db
    .update(scripts)
    .set({ status: qc.verdict === "approved" ? "approved" : qc.verdict })
    .where(eq(scripts.id, script.id));
  return { id: r.id, qc };
}
