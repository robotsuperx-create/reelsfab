/**
 * Full-cycle check of the studio with every external service faked at the network boundary:
 * daily batch (LLM) -> render queue (ffmpeg + test voice) -> QC -> schedule -> publish -> autopilot tick.
 *
 *   DATABASE_URL=postgres://postgres@127.0.0.1:54329/reelsfab_e2e pnpm e2e
 *
 * Runs against a throwaway local Postgres. Never point it at production.
 */
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { characters, posts, renderJobs, renders, scripts, settings } from "../../drizzle/schema";
import { FAKE_ENV, fakeState, installFakes } from "./fakes";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Refusing to run: DATABASE_URL must be a local throwaway database.");
  process.exit(1);
}
for (const [k, v] of Object.entries(FAKE_ENV)) process.env[k] = v;
// The fake Higgsfield CDN serves this clip (8s, 9:16, with speech-like audio).
if (!process.env.E2E_SAMPLE_MP4) {
  const { execFileSync } = await import("node:child_process");
  const file = `/tmp/reelsfab-e2e-premium-${process.pid}.mp4`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", "assets/characters/oliver.jpg", "-f", "lavfi", "-i", "sine=frequency=330:duration=8",
    "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p", "-t", "8", "-r", "30", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", file]);
  process.env.E2E_SAMPLE_MP4 = file;
}
delete process.env.TELEGRAM_BOT_TOKEN;
installFakes();
const { objects, calls } = fakeState;
const published = fakeState.instagramPosts;

// ---------------------------------------------------------------- run
const step = (msg: string) => console.log(`\n▶ ${msg}`);

async function main() {
  const { requireDb, ensureSeed, saveSettings } = await import("../db");
  const { runDailyAutomation } = await import("../services/batch");
  const { enqueueReadyScripts, drainQueue } = await import("../worker/jobs");
  const { autoFillSchedule } = await import("../services/scheduler");
  const { publishDueInstagramPosts, publishDueSocialPosts } = await import("../services/publishing");
  const { saveSocialToken } = await import("../services/social-accounts");
  const { autopilotTick } = await import("../worker/autopilot");
  const db = await requireDb();

  step("reset database");
  await db.execute(sql`truncate table assets, automation_runs, batches, characters, cost_entries, insights, integrations,
    login_attempts, post_metrics, posts, premium_clips, render_jobs, renders, scripts, settings, social_accounts, users restart identity cascade`);

  step("seed characters + bundled reference images");
  await ensureSeed();
  const chars = await db.select().from(characters);
  assert.equal(chars.length, 10, "10 characters seeded");
  const withImage = chars.filter(c => (c.referenceImages ?? []).some(r => r.startsWith("/api/media/")));
  assert.equal(withImage.length, 9, "9 portraits uploaded (Shelly waits for her image)");
  assert.ok(chars.find(c => c.slug === "shelly")?.needsDesignFile, "Shelly flagged as awaiting design");
  console.log(`  ${withImage.length} images in storage`);

  step("daily batch (fake Claude)");
  await saveSettings({ dailyTarget: 10, automationEnabled: true, platforms: ["instagram", "tiktok"], postingTimezone: "America/New_York" });
  const run = await runDailyAutomation("manual");
  assert.equal(run.skipped, false);
  for (let i = 0; i < 60; i++) {
    const [b] = await db.execute(sql`select status from batches order by id desc limit 1`) as unknown as { status: string }[];
    if (b?.status !== "running") break;
    await new Promise(r => setTimeout(r, 500));
  }
  const all = await db.select().from(scripts);
  assert.ok(all.length >= 8, `scripts generated (${all.length})`);
  assert.ok(!all.some(s => s.characterId === chars.find(c => c.slug === "shelly")!.id), "no scripts for Shelly without an image");
  const held = all.filter(s => s.status === "needs_review");
  assert.equal(held.length, 1, "the income-claim script is held for review");
  assert.ok(held[0].hook.includes("$5000") && held[0].track === "economic", "held script is never premium");
  const premium = all.filter(s => s.track === "premium");
  assert.ok(premium.length <= 1, `budget guard caps premium (${premium.length})`);
  console.log(`  ${all.length} scripts, ${premium.length} premium, statuses: ${JSON.stringify(countBy(all.map(s => s.status)))}`);

  step("render queue (ffmpeg, test voice)");
  const queued = await enqueueReadyScripts();
  const economic = all.filter(s => s.status === "script_ready").length;
  assert.equal(queued, economic, "every ready economic script queued");
  assert.equal(await enqueueReadyScripts(), 0, "enqueue is idempotent");
  const started = Date.now();
  let done = 0;
  for (;;) {
    const r = await drainQueue(1);
    if (!r.done && !r.failed) break;
    done += r.done;
    assert.equal(r.failed, 0, "no render failed");
  }
  console.log(`  ${done} reels rendered in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const rs = await db.select().from(renders);
  assert.equal(rs.length, economic, "one render per economic script");
  for (const r of rs) {
    assert.equal(r.width, 1080);
    assert.equal(r.height, 1920);
    assert.ok(r.durationMs >= 13000 && r.durationMs <= 15600, `duration ${r.durationMs}`);
    assert.ok(objects.has(r.storageKey!), "video stored");
    assert.equal(objects.get(r.storageKey!)!.type, "video/mp4");
  }
  console.log(`  QC: ${JSON.stringify(countBy(rs.map(r => r.qcStatus)))}`);
  const jobsLeft = await db.select().from(renderJobs).where(eq(renderJobs.status, "queued"));
  assert.equal(jobsLeft.length, 0);

  step("schedule: only connected platforms");
  const approved = rs.filter(r => r.qcStatus === "approved");
  assert.ok(approved.length > 0, "at least one reel auto-approved");
  const none = await autoFillSchedule({ startDay: new Date().toISOString().slice(0, 10), days: 3, userId: null, onlyConnected: true });
  assert.equal(none.scheduledReels, 0, "nothing scheduled without connected accounts");
  for (const c of withImage) {
    await saveSocialToken({ characterId: c.id, platform: "instagram", handle: c.slug, platformUserId: `ig-${c.slug}`, accessToken: `tok-${c.slug}`, userId: 0 });
  }
  const sched = await autoFillSchedule({ startDay: new Date().toISOString().slice(0, 10), days: 3, userId: null, onlyConnected: true });
  assert.equal(sched.scheduledReels, approved.length, "every approved reel scheduled");
  const ps = await db.select().from(posts);
  assert.ok(ps.every(p => p.platform === "instagram"), "TikTok skipped: no account connected");
  console.log(`  ${ps.length} instagram posts scheduled`);

  step("publish due posts (concurrent runners must not double-publish)");
  await db.update(posts).set({ scheduledAt: new Date(Date.now() - 60_000) });
  const [a, b] = await Promise.all([publishDueInstagramPosts(50), publishDueInstagramPosts(50)]);
  assert.equal(a.published + b.published, ps.length, "each post published exactly once");
  assert.equal(published.length, ps.length, "Instagram received each post once");
  assert.ok(published.every(p => p.caption.includes("#AIgenerated") && p.caption.includes("#ad")), "disclosure tags on every caption");
  assert.ok(published.every(p => p.videoUrl.startsWith("https://")), "public HTTPS video URL");
  const social = await publishDueSocialPosts(50);
  assert.equal(social.attempted, 0);
  const after = await db.select().from(posts);
  assert.ok(after.every(p => p.status === "published"));
  console.log(`  ${published.length} published, captions carry disclosure`);

  step("manual post for an unconnected platform stays queued (no failure, no alert)");
  const first = after[0];
  await db.insert(posts).values({ renderId: first.renderId, scriptId: first.scriptId, characterId: first.characterId, platform: "tiktok", caption: "manual", scheduledAt: new Date(Date.now() - 60_000) });
  const manual = await publishDueSocialPosts(50);
  assert.equal(manual.attempted, 0, "unconnected platform is not attempted");
  const [tt] = await db.select().from(posts).where(eq(posts.platform, "tiktok"));
  assert.equal(tt.status, "queued", "left queued for manual posting");

  step("premium path: Higgsfield delivers -> transcribe -> derivatives -> server render from video");
  const { integrations, premiumClips } = await import("../../drizzle/schema");
  const { encryptSecret } = await import("../services/integration-vault");
  const { syncHiggsfieldClips } = await import("../services/higgsfield-jobs");
  const { processReceivedClips } = await import("../services/premium-pipeline");
  await db.insert(integrations).values({ provider: "higgsfield", label: "Higgsfield", capabilities: ["video"], configKeys: ["apiKey", "apiSecret"], encryptedConfig: encryptSecret(JSON.stringify({ apiKey: "k", apiSecret: "s" })) });
  const [clip] = await db.select().from(premiumClips).limit(1);
  assert.ok(clip, "a premium clip was planned by the batch");
  await db.update(premiumClips).set({ status: "generating", providerStatusUrl: "https://api.higgsfield.ai/requests/hf-req-1/status" }).where(eq(premiumClips.id, clip.id));
  const synced = await syncHiggsfieldClips();
  assert.equal(synced.completed, 1, "clip downloaded from Higgsfield");
  const prepared = await processReceivedClips();
  assert.deepEqual(prepared.errors, []);
  assert.equal(prepared.transcribed, 1, "clip transcribed");
  assert.equal(prepared.derived, 3, "3 derivative scripts created");
  assert.equal((await processReceivedClips()).checked, 0, "derivatives are created only once");
  const queuedPremium = await enqueueReadyScripts();
  assert.equal(queuedPremium, 4, "premium original + 3 derivatives queued");
  for (;;) {
    const r = await drainQueue(1);
    if (!r.done && !r.failed) break;
    assert.equal(r.failed, 0, "no premium render failed");
  }
  const videoRenders = (await db.select().from(renders)).filter(r => r.kind !== "economic");
  assert.equal(videoRenders.length, 4);
  for (const r of videoRenders) {
    assert.equal(r.width, 1080);
    assert.ok(r.hasCaptions, "captions from the transcript");
    assert.ok(r.durationMs >= 8000 && r.durationMs <= 15600, `premium duration ${r.durationMs}`);
  }
  console.log(`  ${videoRenders.length} premium/derivative reels, QC: ${JSON.stringify(countBy(videoRenders.map(r => r.qcStatus)))}`);

  step("autopilot tick (lease + full loop, nothing left to do)");
  await autopilotTick(new Date());
  const [lease] = await db.select().from(settings).where(eq(settings.key, "autopilot_lease"));
  assert.ok(lease, "lease row written");

  const unexpected = Object.keys(calls).filter(k => k.startsWith("unexpected:"));
  console.log(`\nnetwork calls: ${JSON.stringify(calls)}`);
  assert.deepEqual(unexpected, [], "no call left the fakes");
  console.log("\n✅ full cycle passed");
}

function countBy(xs: string[]) {
  return xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error("\n❌ full cycle failed:", e);
    process.exit(1);
  });
