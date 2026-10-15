/**
 * One-off: copies character reference images that still point at /manus-storage/... from the OLD
 * deployment into Supabase Storage and rewrites the character rows.
 *
 *   OLD_BASE_URL=https://your-old-app.manus.space pnpm tsx scripts/migrate-manus-images.ts
 *
 * Run it BEFORE cancelling the old subscription. Needs SUPABASE_* and DATABASE_URL in the environment.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { characters } from "../drizzle/schema";
import { ensureSeed, requireDb } from "../server/db";
import { storagePut } from "../server/storage";

const base = (process.env.OLD_BASE_URL ?? "").replace(/\/$/, "");
if (!base) {
  console.error("Set OLD_BASE_URL to the old deployment origin (where /manus-storage/... still resolves).");
  process.exit(1);
}

await ensureSeed();
const db = await requireDb();
const rows = await db.select().from(characters);
let moved = 0;
let failed = 0;
for (const c of rows) {
  const refs = c.referenceImages ?? [];
  const next: string[] = [];
  for (const [i, ref] of refs.entries()) {
    if (!ref.startsWith("/manus-storage/")) {
      next.push(ref);
      continue;
    }
    try {
      const res = await fetch(`${base}${ref}`, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type")?.split(";")[0] ?? "image/webp";
      if (!/^image\/(png|jpeg|webp)$/.test(type)) throw new Error(`unexpected type ${type}`);
      const ext = type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";
      const put = await storagePut(`character_image/${c.slug}-${i + 1}.${ext}`, Buffer.from(await res.arrayBuffer()), type);
      next.push(put.url);
      moved++;
      console.log(`✓ ${c.slug}: ${ref} -> ${put.url}`);
    } catch (e) {
      failed++;
      next.push(ref);
      console.error(`✗ ${c.slug}: ${ref} (${e instanceof Error ? e.message : e})`);
    }
  }
  if (next.some((u, i) => u !== refs[i])) await db.update(characters).set({ referenceImages: next }).where(eq(characters.id, c.id));
}
console.log(`done: ${moved} moved, ${failed} failed`);
process.exit(failed ? 1 : 0);
