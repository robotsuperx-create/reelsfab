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

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Refusing to run: DATABASE_URL must be a local throwaway database.");
  process.exit(1);
}
Object.assign(process.env, {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  INTEGRATION_ENCRYPTION_KEY: "e2e-encryption-key-not-secret",
  TTS_PROVIDER: "test",
  DISCLOSURE_TAGS: "#AIgenerated #ad",
});
delete process.env.TELEGRAM_BOT_TOKEN;

// ---------------------------------------------------------------- network fakes
const objects = new Map<string, Buffer>();
const calls: Record<string, number> = {};
const hit = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
const published: { caption: string; videoUrl: string }[] = [];

const SCRIPT_BANK = [
  ["Your garden needs less water than you think", "Water deeply twice a week at sunrise instead of a little every evening. Roots chase moisture downward and the plants handle summer heat much better.", "Deeper roots mean tougher tomatoes", "Follow for weekly garden notes"],
  ["Three ingredients make the best weeknight sauce", "Simmer crushed tomatoes with olive oil and a whole peeled onion for forty minutes. Remove the onion before serving and keep the sweetness.", "Simple food tastes like home", "Save this for Sunday dinner"],
  ["Most beginners mix their paint far too early", "Lay the colors side by side and blend only at the edges with a dry brush. The canvas keeps its light and the shadows stay clean.", "Patience paints brighter pictures", "Comment brush if this helped"],
  ["One budgeting rule beats every spreadsheet", "Move savings on payday before anything else gets spent. What remains is yours to enjoy without guilt or late night arithmetic.", "Discipline makes freedom feel lighter", "Follow for more money habits"],
  ["Stop starting conversations with your phone", "Put it face down and ask one curious question about their day. People remember how attentive you felt far longer than your words.", "Presence is the rarest gift", "Share this with a friend"],
  ["This automation saves my team every Monday", "A short script collects last week's orders, tags late ones and drafts polite follow ups. Someone reviews them in ten minutes over coffee.", "Systems give back your weekends", "Follow to learn the setup"],
  ["Small business idea nobody talks about", "Local bakeries throw away perfectly good bread every evening. A tiny subscription that delivers it to cafes at a discount solves waste for both sides.", "Problems hide inside everyday routines", "Save this idea for later"],
  ["Walk like the runway is yours", "Shoulders relaxed, chin level, and let your hips lead each step forward. Practice in the hallway for two minutes daily and confidence becomes muscle memory.", "Posture tells your story first", "Follow for day two tips"],
  ["I made $5000 a month with this one trick", "Copy my exact method and you will earn the same money every single month without any effort or risk at all, guaranteed.", "Easy money is waiting", "Follow to get rich"],
  ["Start your workout before motivation shows up", "Put on your shoes and do five gentle squats right now. Momentum arrives once your body moves, not while you wait on the couch.", "Action creates the energy", "Comment start to join me"],
];
let scriptCursor = 0;

function fakeAnthropic(body: { messages: { content: { type: string; text?: string }[] }[] }) {
  hit("anthropic");
  const prompt = body.messages.map(m => m.content.map(c => c.text ?? "").join(" ")).join(" ");
  const count = Number(/Write (\d+) different/.exec(prompt)?.[1] ?? 1);
  const scriptsOut = Array.from({ length: count }, () => {
    const [hook, b, payoff, cta] = SCRIPT_BANK[scriptCursor++ % SCRIPT_BANK.length];
    return {
      topic: hook.slice(0, 40), templateKey: "direct_tip", hookType: "secret", hook, body: b, payoff, cta,
      onScreenText: hook.split(" ").slice(0, 5).join(" "), caption: `${hook}.`, hashtags: "#AIcharacter #tips #daily #learn",
      higgsfieldPrompt: "Character speaks to camera in warm morning light, slow push-in, natural gestures, cozy home setting, vertical 9:16.",
    };
  });
  return { content: [{ type: "text", text: JSON.stringify({ scripts: scriptsOut }) }], usage: { input_tokens: 1200, output_tokens: 900 } };
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? "GET").toUpperCase();
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  if (u.host === "supabase.test") {
    const m = /^\/storage\/v1\/object\/(sign\/)?([^/]+)\/(.+)$/.exec(u.pathname);
    if (m && method === "POST" && !m[1]) {
      hit("storage.put");
      objects.set(decodeURIComponent(m[3]), Buffer.from(await new Response(init?.body as BodyInit).arrayBuffer()));
      return json({ Key: m[3] });
    }
    if (m && method === "POST" && m[1]) {
      hit("storage.sign");
      return json({ signedURL: `/object/sign/${m[2]}/${m[3]}?token=t` });
    }
    if (m && method === "GET" && m[1]) {
      hit("storage.get");
      const buf = objects.get(decodeURIComponent(m[3]));
      return buf ? new Response(new Uint8Array(buf)) : json({ error: "not found" }, 404);
    }
    return json({ error: `unexpected ${method} ${u.pathname}` }, 500);
  }
  if (u.host === "api.anthropic.com") return json(fakeAnthropic(JSON.parse(String(init?.body))));
  if (u.host === "graph.instagram.com") {
    hit("instagram");
    if (u.pathname.endsWith("/media") && method === "POST") {
      const b = JSON.parse(String(init?.body));
      published.push({ caption: b.caption, videoUrl: b.video_url });
      return json({ id: `container-${published.length}` });
    }
    if (u.pathname.endsWith("/media_publish")) return json({ id: `ig-media-${Date.now()}` });
    if (/\/container-\d+$/.test(u.pathname)) return json({ id: "c", status_code: "FINISHED" });
    return json({ data: [] });
  }
  if (u.host === "127.0.0.1" || u.host === "localhost") return realFetch(input, init);
  hit(`unexpected:${u.host}`);
  return json({ error: "blocked in e2e" }, 503);
}) as typeof fetch;

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
