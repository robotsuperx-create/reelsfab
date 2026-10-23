/**
 * Network-boundary fakes for every external service the studio talks to. Used only by the e2e
 * suites and the local test server; production never imports this file.
 */
export const fakeState = {
  objects: new Map<string, { body: Buffer; type: string }>(),
  calls: {} as Record<string, number>,
  instagramPosts: [] as { caption: string; videoUrl: string }[],
  tiktokPosts: [] as string[],
  youtubePosts: [] as string[],
  telegram: [] as string[],
};

const hit = (k: string) => (fakeState.calls[k] = (fakeState.calls[k] ?? 0) + 1);

export const SCRIPT_BANK = [
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
] as const;
let cursor = 0;

/** A tiny valid PNG (8x8, lime) for image endpoints. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4/58BK2IYlRgVBQB4Rx+BLKN5DwAAAABJRU5ErkJggg==",
  "base64",
);

function llmJson(prompt: string): unknown {
  const count = Number(/Write (\d+) different/.exec(prompt)?.[1] ?? 0);
  if (count) {
    return {
      scripts: Array.from({ length: count }, () => {
        const [hook, body, payoff, cta] = SCRIPT_BANK[cursor++ % SCRIPT_BANK.length];
        return {
          topic: hook.slice(0, 40), templateKey: "direct_tip", hookType: "secret", hook, body, payoff, cta,
          onScreenText: hook.split(" ").slice(0, 5).join(" "), caption: `${hook}.`, hashtags: "#AIcharacter #tips #daily #learn",
          higgsfieldPrompt: "Character speaks to camera in warm morning light, slow push-in, natural gestures, cozy home setting, vertical 9:16.",
        };
      }),
    };
  }
  const hooks = Number(/Write (\d+) alternative spoken hooks/.exec(prompt)?.[1] ?? 0);
  if (hooks) {
    return { hooks: Array.from({ length: hooks }, (_, i) => ({ hook: `Fresh angle number ${i + 1} on this idea`, hookType: "question", onScreenText: `Angle ${i + 1}` })) };
  }
  const variants = Number(/Create (\d+) variants/.exec(prompt)?.[1] ?? 0);
  if (variants) {
    return { variants: Array.from({ length: variants }, (_, i) => ({ variantLabel: `Angle ${i + 1}`, hook: `Watch what happens next ${i + 1}`, hookType: "story", onScreenText: `Part ${i + 1}`, cta: "Follow for more", caption: `Clip ${i + 1}`, hashtags: "#AIcharacter #clip #daily #tips" })) };
  }
  if (/character bible from this description/.test(prompt)) {
    return { name: "Test Persona", nameAr: "شخصية تجريبية", age: "35", origin: "American", niche: "Home cooking", appearancePrompt: "friendly woman in her 30s, curly hair, warm smile", wardrobe: "apron", voiceDescription: "warm", style: "cheerful", catchphrase: "Cook it simple", contentTemplates: ["recipe", "tip", "story"], product: "recipe cards", rules: "no health claims", loraKeyword: "chr_test", ttsVoice: "af_heart", ttsSpeed: 100, colors: { primary: "#222222", accent: "#DFFF00", text: "#FFFFFF" }, dailyQuota: 2 };
  }
  if (/QC reviewer/i.test(prompt)) return { score: 92, consistent: true, issues: [] };
  if (/Markdown|markdown/.test(prompt) || /growth analyst|محلل نمو/.test(prompt)) return { markdown: "## ما ينجح\n- بيانات تجريبية" };
  return { hooks: [{ hook: "Fresh angle on this idea", hookType: "question", onScreenText: "Fresh angle" }] };
}

function promptOf(body: any): string {
  if (Array.isArray(body?.messages)) {
    return body.messages
      .map((m: any) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((c: any) => c.text ?? "").join(" ")))
      .join("\n") + (body.system ? `\n${body.system}` : "");
  }
  if (Array.isArray(body?.input)) return JSON.stringify(body.input);
  if (Array.isArray(body?.contents)) return JSON.stringify(body.contents);
  return JSON.stringify(body ?? "");
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Optional on-disk persistence so a restarted test server keeps its "Supabase Storage" objects. */
function persist(key: string, obj: { body: Buffer; type: string }) {
  const STORE_DIR = process.env.E2E_STORAGE_DIR;
  if (!STORE_DIR) return;
  const file = join(STORE_DIR, encodeURIComponent(key));
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(file, obj.body);
  writeFileSync(`${file}.type`, obj.type);
}
function restore(key: string) {
  const STORE_DIR = process.env.E2E_STORAGE_DIR;
  if (!STORE_DIR) return undefined;
  const file = join(STORE_DIR, encodeURIComponent(key));
  return existsSync(file) ? { body: readFileSync(file), type: readFileSync(`${file}.type`, "utf8") } : undefined;
}

export function installFakes() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
    const bodyText = async () => (init?.body ? await new Response(init.body as BodyInit).text() : "");

    switch (u.host) {
      case "supabase.test": {
        const m = /^\/storage\/v1\/object\/(sign\/)?([^/]+)\/(.+)$/.exec(u.pathname);
        const key = m ? decodeURIComponent(m[3]) : "";
        if (m && method === "POST" && !m[1]) {
          hit("storage.put");
          const type = new Headers(init?.headers).get("content-type") ?? "application/octet-stream";
          const obj = { body: Buffer.from(await new Response(init?.body as BodyInit).arrayBuffer()), type };
          fakeState.objects.set(key, obj);
          persist(key, obj);
          return json({ Key: key });
        }
        if (m && method === "POST" && m[1]) {
          hit("storage.sign");
          return json({ signedURL: `/object/sign/${m[2]}/${m[3]}?token=t` });
        }
        if (m && method === "GET") {
          hit("storage.get");
          const obj = fakeState.objects.get(key) ?? restore(key);
          return obj ? new Response(new Uint8Array(obj.body), { headers: { "content-type": obj.type } }) : json({ error: "not found" }, 404);
        }
        if (/\/auth\/v1\/user/.test(u.pathname)) return json({ error: "invalid" }, 401);
        return json({ error: `unexpected ${method} ${u.pathname}` }, 500);
      }
      case "api.anthropic.com": {
        hit("anthropic");
        const body = JSON.parse(await bodyText());
        return json({ content: [{ type: "text", text: JSON.stringify(llmJson(promptOf(body))) }], usage: { input_tokens: 1200, output_tokens: 900 } });
      }
      case "api.openai.com": {
        hit("openai");
        if (u.pathname.includes("/audio/transcriptions")) {
          return json({ text: "Water deeply twice a week at sunrise.", language: "en", duration: 3, segments: [{ start: 0, end: 3, text: "Water deeply twice a week at sunrise." }] });
        }
        if (u.pathname.includes("/images/generations")) return json({ data: [{ b64_json: PNG.toString("base64") }] });
        const body = JSON.parse(await bodyText());
        return json({ output_text: JSON.stringify(llmJson(promptOf(body))), usage: { input_tokens: 800, output_tokens: 500 } });
      }
      case "generativelanguage.googleapis.com": {
        hit("gemini");
        const body = JSON.parse(await bodyText());
        if (u.pathname.includes("image")) return json({ candidates: [{ content: { parts: [{ inlineData: { data: PNG.toString("base64"), mimeType: "image/png" } }] } }] });
        return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(llmJson(promptOf(body))) }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 400 } });
      }
      case "api.elevenlabs.io":
        hit("elevenlabs");
        return new Response(new Uint8Array(Buffer.alloc(2048)), { headers: { "content-type": "audio/mpeg" } });
      case "api.higgsfield.ai": {
        hit("higgsfield");
        if (u.pathname.includes("/requests/") && u.pathname.endsWith("/status")) {
          return json({ status: "completed", video: { url: "https://cdn.higgsfield.test/clip.mp4" } });
        }
        if (u.pathname.endsWith("/cancel")) return json({ ok: true });
        return json({ status: "queued", request_id: "hf-req-1", status_url: "https://api.higgsfield.ai/requests/hf-req-1/status", cancel_url: "https://api.higgsfield.ai/requests/hf-req-1/cancel" });
      }
      case "cdn.higgsfield.test": {
        hit("higgsfield.cdn");
        const { readFile } = await import("node:fs/promises");
        const file = process.env.E2E_SAMPLE_MP4;
        return new Response(new Uint8Array(file ? await readFile(file) : Buffer.alloc(4096)), { headers: { "content-type": "video/mp4" } });
      }
      case "graph.instagram.com": {
        hit("instagram");
        if (u.pathname.endsWith("/media") && method === "POST") {
          const b = JSON.parse(await bodyText());
          fakeState.instagramPosts.push({ caption: b.caption, videoUrl: b.video_url });
          return json({ id: `container-${fakeState.instagramPosts.length}` });
        }
        if (u.pathname.endsWith("/media_publish")) return json({ id: `ig-media-${fakeState.instagramPosts.length}` });
        if (/\/container-\d+$/.test(u.pathname)) return json({ id: "c", status_code: "FINISHED" });
        if (u.pathname.endsWith("/me")) return json({ id: "ig-user", username: "fake_handle" });
        if (/\/ig-media-\d+$/.test(u.pathname)) return json({ like_count: 12, comments_count: 3, plays: 340 });
        return json({ data: [] });
      }
      case "open.tiktokapis.com": {
        hit("tiktok");
        if (u.pathname.includes("creator_info")) return json({ data: { privacy_level_options: ["SELF_ONLY"] } });
        if (u.pathname.includes("/video/init/")) return json({ data: { upload_url: "https://upload.tiktok.test/u", publish_id: `tt-${fakeState.tiktokPosts.length + 1}` } });
        if (u.pathname.includes("/status/fetch/")) {
          fakeState.tiktokPosts.push("ok");
          return json({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7000000000"] } });
        }
        if (u.pathname.includes("/video/query/")) return json({ data: { videos: [{ view_count: 100, like_count: 5 }] } });
        return json({ data: {} });
      }
      case "upload.tiktok.test":
        hit("tiktok.upload");
        return new Response("", { status: 201 });
      case "www.googleapis.com": {
        hit("youtube");
        if (u.pathname.startsWith("/upload/youtube")) return new Response("", { status: 200, headers: { location: "https://upload.youtube.test/session" } });
        return json({ items: [{ statistics: { viewCount: "50", likeCount: "4" } }] });
      }
      case "upload.youtube.test":
        fakeState.youtubePosts.push("ok");
        return json({ id: `yt-${fakeState.youtubePosts.length}` });
      case "oauth2.googleapis.com":
        return json({ access_token: "fresh-youtube-token", expires_in: 3600 });
      case "api.pexels.com": {
        hit("pexels");
        if (!new Headers(init?.headers).get("authorization")) return json({ error: "Unauthorized" }, 401);
        const q = u.searchParams.get("query") ?? "";
        const mk = (id: number, w: number, h: number, d: number) => ({
          id, width: w, height: h, duration: d, url: `https://www.pexels.com/video/${id}/`, image: `https://images.pexels.com/videos/${id}/thumb.jpg`,
          user: { name: `Creator ${id}`, url: `https://www.pexels.com/@creator${id}` },
          video_files: [
            { id: id * 10 + 1, quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, fps: 30, link: `https://videos.pexels.com/video-files/${id}/hd.mp4` },
            { id: id * 10 + 2, quality: "sd", file_type: "video/mp4", width: 360, height: 640, fps: 30, link: `https://videos.pexels.com/video-files/${id}/sd.mp4` },
          ],
        });
        return json({ page: 1, per_page: 24, total_results: 2, videos: q ? [mk(1001, 1080, 1920, 8), mk(1002, 1080, 1920, 15)] : [] });
      }
      case "videos.pexels.com": {
        hit("pexels.cdn");
        const { readFile } = await import("node:fs/promises");
        const file = process.env.E2E_SAMPLE_MP4;
        return new Response(new Uint8Array(file ? await readFile(file) : Buffer.alloc(4096)), { headers: { "content-type": "video/mp4" } });
      }
      case "images.pexels.com":
        return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
      case "api.telegram.org":
        fakeState.telegram.push(JSON.parse(await bodyText()).text);
        return json({ ok: true });
      case "127.0.0.1":
      case "localhost":
        return realFetch(input, init);
      default:
        hit(`unexpected:${u.host}`);
        return json({ error: `blocked in e2e: ${u.host}` }, 503);
    }
  }) as typeof fetch;
}

export const FAKE_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  INTEGRATION_ENCRYPTION_KEY: "e2e-encryption-key-not-secret",
  SESSION_SECRET: "e2e-session-secret-0123456789abcdef",
  CRON_SECRET: "e2e-cron-secret-0123456789abcdef0123",
  TTS_PROVIDER: "test",
  DISCLOSURE_TAGS: "#AIgenerated #ad",
};

/** Service keys live in the encrypted vault (Integrations page), never in env: seed fake ones there. */
export async function seedFakeIntegrations(withTelegram = true) {
  const { integrations } = await import("../../drizzle/schema");
  const { encryptSecret } = await import("../services/integration-vault");
  const { requireDb } = await import("../db");
  const db = await requireDb();
  const rows: [string, string, string[], Record<string, string>][] = [
    ["anthropic", "Claude", ["text", "review"], { apiKey: "test-anthropic-key" }],
    ["openai", "OpenAI", ["transcription"], { apiKey: "test-openai-key" }],
    ["pexels", "Pexels", ["storage"], { apiKey: "test-pexels-key" }],
  ];
  if (withTelegram) rows.push(["telegram", "Telegram", ["analytics"], { botToken: "e2e-telegram", chatId: "1" }]);
  for (const [provider, label, capabilities, config] of rows) {
    const existing = await db.select({ id: integrations.id }).from(integrations).where((await import("drizzle-orm")).eq(integrations.provider, provider));
    if (existing.length) continue;
    await db.insert(integrations).values({ provider, label, capabilities, configKeys: Object.keys(config), encryptedConfig: encryptSecret(JSON.stringify(config)) });
  }
}
