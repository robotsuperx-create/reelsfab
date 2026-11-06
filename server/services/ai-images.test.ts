process.env.AI_RETRY_FAST = "1";
import { describe, expect, it, vi } from "vitest";
import { IMAGE_TIER_DEFAULTS, falImageBody, imagePromptFor } from "../../shared/images";

const vault: Record<string, Record<string, string>> = { fal: { apiKey: "id:secret" } };
vi.mock("./integration-vault", () => ({ getIntegrationConfig: async (p: string) => vault[p] ?? {} }));
const { falGenerate, resolveImageModel } = await import("./ai-images");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(200).fill(1)]);

describe("image request bodies", () => {
  it("speaks each fal model family's dialect", () => {
    expect(falImageBody("fal-ai/flux/schnell", "a cat", "16:9")).toMatchObject({ prompt: "a cat", image_size: "landscape_16_9", num_images: 1, output_format: "jpeg" });
    expect(falImageBody("fal-ai/flux/schnell", "a cat", "9:16")).toMatchObject({ image_size: "portrait_16_9" });
    expect(falImageBody("meta/muse-image/text-to-image", "a cat", "16:9")).toEqual({ prompt: "a cat", aspect_ratio: "16:9", num_images: 1, output_format: "jpeg" });
    expect(falImageBody("google/nano-banana-2.1", "a cat", "16:9")).toMatchObject({ aspect_ratio: "16:9", resolution: "1K" });
  });

  it("adds the channel style and forbids text in the picture", () => {
    const p = imagePromptFor("A boy feeding ducks by a pond", "illustration");
    expect(p).toMatch(/^A boy feeding ducks by a pond\. Style: children's picture-book illustration/);
    expect(p).toMatch(/no text, no letters/);
    expect(imagePromptFor("Old map of Andalusia", "maps")).toMatch(/vintage cartographic/);
  });
});

describe("fal client", () => {
  it("uses the tier defaults and the vault overrides", async () => {
    vault.fal = { apiKey: "id:secret" };
    expect((await resolveImageModel("standard")).model).toBe(IMAGE_TIER_DEFAULTS.standard.model);
    expect((await resolveImageModel("standard")).usd).toBe(0.01);
    vault.fal = { apiKey: "id:secret", premiumModel: "bytedance/seedream/v5/lite/text-to-image" };
    expect(await resolveImageModel("premium")).toMatchObject({ model: "bytedance/seedream/v5/lite/text-to-image", usd: 0.035 });
    vault.fal = { apiKey: "id:secret", draftModel: "https://evil.example/x" };
    await expect(resolveImageModel("draft")).rejects.toThrow(/غير صالح/);
    vault.fal = { apiKey: "id:secret", standardModel: "someone/new-model", usdPerImage: "0.02" };
    expect((await resolveImageModel("standard")).usd).toBe(0.02);
  });

  it("calls fal.run with the Key header, retries a 429 and downloads the picture from fal's CDN", async () => {
    const calls: { url: string; auth?: string; body?: any }[] = [];
    let n = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith("https://fal.run/")) {
        if (n++ === 0) return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
        return new Response(JSON.stringify({ images: [{ url: "https://v3.fal.media/files/x/1.jpg", content_type: "image/jpeg", width: 1344, height: 768 }] }), { status: 200 });
      }
      return new Response(new Uint8Array(JPEG), { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    const out = await falGenerate("meta/muse-image/text-to-image", "id:secret", { prompt: "x" }, fetchImpl);
    expect(out.buf.equals(JPEG)).toBe(true);
    expect(out).toMatchObject({ type: "image/jpeg", width: 1344, height: 768 });
    expect(calls.map(c => c.url)).toEqual(["https://fal.run/meta/muse-image/text-to-image", "https://fal.run/meta/muse-image/text-to-image", "https://v3.fal.media/files/x/1.jpg"]);
    expect(calls[0].auth).toBe("Key id:secret");
  });

  it("explains a rejected key, an empty balance, a safety refusal and a foreign image host", async () => {
    const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    await expect(falGenerate("m/x", "id:secret", {}, respond(401, { detail: "no" }))).rejects.toThrow(/مرفوض/);
    await expect(falGenerate("m/x", "id:secret", {}, respond(403, { detail: "User is locked. Reason: Exhausted balance" }))).rejects.toThrow(/رصيد/);
    await expect(falGenerate("m/x", "id:secret", {}, respond(402, { detail: "balance" }))).rejects.toThrow(/رصيد/);
    await expect(falGenerate("m/x", "id:secret", {}, respond(200, { images: [{ url: "https://v3.fal.media/a.jpg" }], has_nsfw_concepts: [true] }))).rejects.toThrow(/الأمان/);
    await expect(falGenerate("m/x", "id:secret", {}, respond(200, { images: [{ url: "https://attacker.example/a.jpg" }] }))).rejects.toThrow(/غير متوقع/);
    await expect(falGenerate("m/x", "", {})).rejects.toThrow(/fal\.ai/);
  });

  it("accepts a data URI result (sync_mode)", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ images: [{ url: `data:image/png;base64,${JPEG.toString("base64")}` }] }), { status: 200 })) as unknown as typeof fetch;
    const out = await falGenerate("m/x", "id:secret", {}, fetchImpl);
    expect(out.type).toBe("image/png");
    expect(out.buf.length).toBe(JPEG.length);
  });
});
