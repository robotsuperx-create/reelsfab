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
  falPrompts: [] as string[],
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
  if (/Write the full episode script/.test(prompt)) {
    const ar = /Language of narration[^\n]*Arabic/.test(prompt);
    const sections = ar ? ["خطاف", "السياق", "الذروة"] : ["Hook", "Context", "Climax"];
    const mk = (i: number) => ({
      narration: ar
        ? `هذا هو المشهد رقم ${i + 1} من الحلقة التجريبية، وفيه نشرح الفكرة بهدوء وبجملتين قصيرتين.`
        : `This is scene number ${i + 1} of the test episode, where the idea is explained calmly in two short sentences.`,
      title: i % 2 === 0 ? (ar ? `عنوان المشهد ${i + 1}` : `Scene title ${i + 1}`) : undefined,
      keywords: ["garden", "sunrise", "city"].slice(0, 2 + (i % 2)),
      ...(/"imagePrompt"/.test(prompt) ? { imagePrompt: `A quiet garden at sunrise with a small child watering flowers, scene ${i + 1}, wide shot` } : {}),
      chapter: sections[Math.min(sections.length - 1, Math.floor(i / 2))],
    });
    return {
      title: ar ? "حلقة تجريبية عن الموضوع" : "A test episode about the topic",
      hook: ar ? "سؤال مدهش يفتح الحلقة" : "A surprising question opens the episode",
      scenes: Array.from({ length: 6 }, (_, i) => mk(i)),
      outro: ar ? "اشترك ليصلك الجديد" : "Subscribe for the next one",
      description: ar ? "وصف الحلقة. Sources: كتاب تجريبي" : "Episode description. Sources: a test book",
      tags: ["test", "episode", "free"],
    };
  }
  if (/character bible from this description/.test(prompt)) {
    return { name: "Test Persona", nameAr: "شخصية تجريبية", age: "35", origin: "American", niche: "Home cooking", appearancePrompt: "friendly woman in her 30s, curly hair, warm smile", wardrobe: "apron", voiceDescription: "warm", style: "cheerful", catchphrase: "Cook it simple", contentTemplates: ["recipe", "tip", "story"], product: "recipe cards", rules: "no health claims", loraKeyword: "chr_test", ttsVoice: "af_heart", ttsSpeed: 100, colors: { primary: "#222222", accent: "#DFFF00", text: "#FFFFFF" }, dailyQuota: 2 };
  }
  if (/QC reviewer/i.test(prompt)) return { score: 92, consistent: true, issues: [] };
  if (/Markdown|markdown/.test(prompt) || /growth analyst|محلل نمو/.test(prompt)) return { markdown: "## ما ينجح\n- بيانات تجريبية" };
  return { hooks: [{ hook: "Fresh angle on this idea", hookType: "question", onScreenText: "Fresh angle" }] };
}

/** Minimal 16-bit mono WAV wrapper for fake speech responses. */
function pcmWav(pcm: Buffer, sampleRate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
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

    // Local services (Ollama, a voice-clone speech server) are real even in the faked world.
    if ((u.hostname === "127.0.0.1" || u.hostname === "localhost") && !/^(3000|4310)$/.test(u.port)) {
      hit(`local:${u.port}`);
      return realFetch(input as RequestInfo, init);
    }

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
        if (u.pathname.startsWith("/v1/models")) return json({ data: [{ id: "claude-sonnet-5-5", type: "model" }] });
        const body = JSON.parse(await bodyText());
        const result = llmJson(promptOf(body));
        // Structured requests arrive as a forced tool call and are answered with a tool_use block, like the real API.
        if (body?.tool_choice?.type === "tool") {
          return json({ content: [{ type: "tool_use", id: "toolu_fake", name: body.tool_choice.name, input: result }], stop_reason: "tool_use", usage: { input_tokens: 1200, output_tokens: 900 } });
        }
        return json({ content: [{ type: "text", text: JSON.stringify(result) }], usage: { input_tokens: 1200, output_tokens: 900 } });
      }
      case "api.openai.com": {
        hit("openai");
        if (u.pathname.includes("/audio/transcriptions")) {
          return json({ text: "Water deeply twice a week at sunrise.", language: "en", duration: 3, segments: [{ start: 0, end: 3, text: "Water deeply twice a week at sunrise." }] });
        }
        if (u.pathname.includes("/images/generations")) return json({ data: [{ b64_json: PNG.toString("base64") }] });
        if (u.pathname.includes("/audio/speech")) {
          hit("openai.tts");
          if (!new Headers(init?.headers).get("authorization")) return json({ error: "missing key" }, 401);
          const b = JSON.parse(await bodyText());
          // 0.34s of 24 kHz silence per word, like the test TTS provider — returned as a real WAV like OpenAI does.
          const words = String(b.input ?? "").split(/\s+/).filter(Boolean).length;
          const pcm = Buffer.alloc(Math.max(1, Math.round(words * 0.34 * 24000)) * 2);
          return new Response(new Uint8Array(pcmWav(pcm)), { headers: { "content-type": "audio/wav" } });
        }
        if (u.pathname.endsWith("/models/gpt-4o-mini-tts")) return json({ id: "gpt-4o-mini-tts", object: "model" });
        const body = JSON.parse(await bodyText());
        return json({ output_text: JSON.stringify(llmJson(promptOf(body))), usage: { input_tokens: 800, output_tokens: 500 } });
      }
      case "generativelanguage.googleapis.com": {
        hit("gemini");
        const body = JSON.parse(await bodyText());
        if (u.pathname.includes("image")) return json({ candidates: [{ content: { parts: [{ inlineData: { data: PNG.toString("base64"), mimeType: "image/png" } }] } }] });
        if (body?.generationConfig?.responseModalities?.includes("AUDIO")) {
          hit("gemini.tts");
          if (!init?.headers || !new Headers(init.headers).get("x-goog-api-key")) return json({ error: "missing key" }, 401);
          // 0.34s of 24 kHz silence per word, like the test TTS provider.
          const words = String(body.contents?.[0]?.parts?.[0]?.text ?? "").split(/\s+/).filter(Boolean).length;
          const pcm = Buffer.alloc(Math.max(1, Math.round(words * 0.34 * 24000)) * 2);
          return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm.toString("base64") } }] } }] });
        }
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
        const landscape = u.searchParams.get("orientation") === "landscape";
        if (u.pathname === "/v1/search") {
          // Photos: ids derive from the query so different scenes get different stills.
          const seed = [...q].reduce((a, c) => a + c.charCodeAt(0), 0) % 50;
          const photo = (id: number) => ({ id, width: 4000, height: landscape ? 2250 : 6000, url: `https://www.pexels.com/photo/${id}/`, photographer: `Photographer ${id}`, src: { original: `https://images.pexels.com/photos/${id}/orig.jpg`, large2x: `https://images.pexels.com/photos/${id}/large2x.jpg`, large: `https://images.pexels.com/photos/${id}/large.jpg`, medium: `https://images.pexels.com/photos/${id}/medium.jpg` } });
          return json({ page: 1, per_page: 24, total_results: 3, photos: q ? [photo(5000 + seed), photo(5100 + seed), photo(5200 + seed)] : [] });
        }
        const [w, h] = landscape ? [1920, 1080] : [1080, 1920];
        const mk = (id: number, d: number) => ({
          id, width: w, height: h, duration: d, url: `https://www.pexels.com/video/${id}/`, image: `https://images.pexels.com/videos/${id}/thumb.jpg`,
          user: { name: `Creator ${id}`, url: `https://www.pexels.com/@creator${id}` },
          video_files: [
            { id: id * 10 + 1, quality: "hd", file_type: "video/mp4", width: w, height: h, fps: 30, link: `https://videos.pexels.com/video-files/${id}/hd.mp4` },
            { id: id * 10 + 2, quality: "sd", file_type: "video/mp4", width: Math.round(w / 3), height: Math.round(h / 3), fps: 30, link: `https://videos.pexels.com/video-files/${id}/sd.mp4` },
          ],
        });
        const base = landscape ? 2000 : 1000;
        const seed = [...q].reduce((a, c) => a + c.charCodeAt(0), 0) % 7;
        return json({ page: 1, per_page: 24, total_results: 3, videos: q ? [mk(base + 1 + seed * 3, 8), mk(base + 2 + seed * 3, 15), mk(base + 3 + seed * 3, 6)] : [] });
      }
      case "videos.pexels.com": {
        hit("pexels.cdn");
        const { readFile } = await import("node:fs/promises");
        const file = process.env.E2E_SAMPLE_MP4;
        return new Response(new Uint8Array(file ? await readFile(file) : Buffer.alloc(4096)), { headers: { "content-type": "video/mp4" } });
      }
      case "images.pexels.com": {
        // Photos must be real raster images for ffmpeg (a 640×360 test card); thumbnails can stay tiny.
        if (u.pathname.includes("/photos/")) {
          const { execFileSync } = await import("node:child_process");
          const img = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=1", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], { maxBuffer: 4 * 1024 * 1024 });
          return new Response(new Uint8Array(img), { headers: { "content-type": "image/jpeg" } });
        }
        return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
      }
      case "pixabay.com": {
        hit("pixabay");
        if (u.searchParams.get("key") !== "test-pixabay-key") return new Response('[ERROR 400] "key" is invalid', { status: 400 });
        const q = u.searchParams.get("q") ?? "";
        const seed = [...q].reduce((a, c) => a + c.charCodeAt(0), 0) % 40;
        if (u.pathname === "/api/videos/") {
          const mk = (id: number, d: number) => ({
            id, pageURL: `https://pixabay.com/videos/clip-${id}/`, type: "film", tags: q, duration: d, user: `Pixa${id}`,
            videos: {
              large: { url: `https://cdn.pixabay.com/video/2026/${id}_large.mp4`, width: 3840, height: 2160, size: 9_000_000, thumbnail: `https://cdn.pixabay.com/video/2026/${id}_large.jpg` },
              medium: { url: `https://cdn.pixabay.com/video/2026/${id}_medium.mp4`, width: 1920, height: 1080, size: 3_000_000, thumbnail: `https://cdn.pixabay.com/video/2026/${id}_medium.jpg` },
              small: { url: `https://cdn.pixabay.com/video/2026/${id}_small.mp4`, width: 1280, height: 720, size: 1_000_000, thumbnail: `https://cdn.pixabay.com/video/2026/${id}_small.jpg` },
            },
          });
          return json({ total: 3, totalHits: 3, hits: q ? [mk(7000 + seed * 3, 9), mk(7001 + seed * 3, 14), mk(7002 + seed * 3, 70)] : [] });
        }
        const photo = (id: number) => ({ id, pageURL: `https://pixabay.com/photos/still-${id}/`, user: `Pixa${id}`, imageWidth: 6000, imageHeight: 3375, webformatURL: `https://cdn.pixabay.com/photo/2026/${id}_640.jpg`, largeImageURL: `https://cdn.pixabay.com/photo/2026/${id}_1280.jpg` });
        return json({ total: 3, totalHits: 3, hits: q ? [photo(8000 + seed * 3), photo(8001 + seed * 3), photo(8002 + seed * 3)] : [] });
      }
      case "cdn.pixabay.com": {
        hit("pixabay.cdn");
        if (u.pathname.startsWith("/video/") && u.pathname.endsWith(".mp4")) {
          const { readFile } = await import("node:fs/promises");
          const file = process.env.E2E_SAMPLE_MP4;
          return new Response(new Uint8Array(file ? await readFile(file) : Buffer.alloc(4096)), { headers: { "content-type": "video/mp4" } });
        }
        const { execFileSync } = await import("node:child_process");
        const img = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=1", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], { maxBuffer: 4 * 1024 * 1024 });
        return new Response(new Uint8Array(img), { headers: { "content-type": "image/jpeg" } });
      }
      case "fal.run": {
        hit("fal");
        if (new Headers(init?.headers).get("authorization") !== "Key test-fal-id:test-fal-secret-0000") return json({ detail: "Unauthorized" }, 401);
        const b = JSON.parse(await bodyText());
        hit(`fal:${u.pathname.slice(1)}`);
        fakeState.falPrompts.push(String(b.prompt ?? ""));
        return json({ images: [{ url: `https://v3.fal.media/files/fake/${fakeState.falPrompts.length}.jpg`, content_type: "image/jpeg", width: 1344, height: 768 }], seed: 1 });
      }
      case "v3.fal.media": {
        hit("fal.cdn");
        const { execFileSync } = await import("node:child_process");
        const img = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=1", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], { maxBuffer: 4 * 1024 * 1024 });
        return new Response(new Uint8Array(img), { headers: { "content-type": "image/jpeg" } });
      }
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
    ["gemini", "Gemini", ["text"], { apiKey: "test-gemini-key" }],
    ["fal", "fal.ai", ["image"], { apiKey: "test-fal-id:test-fal-secret-0000" }],
  ];
  if (withTelegram) rows.push(["telegram", "Telegram", ["analytics"], { botToken: "e2e-telegram", chatId: "1" }]);
  for (const [provider, label, capabilities, config] of rows) {
    const existing = await db.select({ id: integrations.id }).from(integrations).where((await import("drizzle-orm")).eq(integrations.provider, provider));
    if (existing.length) continue;
    await db.insert(integrations).values({ provider, label, capabilities, configKeys: Object.keys(config), encryptedConfig: encryptSecret(JSON.stringify(config)) });
  }
}
