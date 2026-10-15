import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { characters } from "../../drizzle/schema";
import { requireDb } from "../db";
import { storagePut } from "../storage";

/** Reference portraits shipped with the repo (assets/characters/<slug>.jpg), from the Character Bible. */
export const BUNDLED_DIR = join(process.cwd(), "assets", "characters");

const usable = (refs: string[] | null) => (refs ?? []).some(r => r.startsWith("/api/media/") || /^https?:\/\//.test(r));

/**
 * Gives every character without a usable reference image its bundled portrait:
 * uploads it to Supabase Storage once and stores the media URL. Idempotent and safe to call at startup.
 */
export async function syncBundledCharacterImages() {
  const db = await requireDb();
  const rows = await db.select({ id: characters.id, slug: characters.slug, referenceImages: characters.referenceImages }).from(characters);
  const done: string[] = [];
  for (const c of rows) {
    if (usable(c.referenceImages)) continue;
    const file = join(BUNDLED_DIR, `${c.slug}.jpg`);
    if (!existsSync(file)) continue;
    const put = await storagePut(`character_image/${c.slug}.jpg`, await readFile(file), "image/jpeg");
    await db.update(characters).set({ referenceImages: [put.url] }).where(eq(characters.id, c.id));
    done.push(c.slug);
  }
  if (done.length) console.log(`[seed] uploaded reference images: ${done.join(", ")}`);
  return done;
}
