import { afterEach, describe, expect, it, vi } from "vitest";

const vault: Record<string, Record<string, string>> = {};
vi.mock("./integration-vault", () => ({ getIntegrationConfig: async (p: string) => vault[p] ?? {} }));
const { isStockHost, normalizePixabayPhoto, normalizePixabayVideo, searchStockPhotos, searchStockVideos, stockProviders } = await import("./stock");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; for (const k of Object.keys(vault)) delete vault[k]; });

const pixVideo = (id: number, w = 1920, h = 1080) => ({
  id, pageURL: `https://pixabay.com/videos/x-${id}/`, duration: 12, user: "Ali",
  videos: {
    large: { url: `https://cdn.pixabay.com/video/${id}_large.mp4`, width: w * 2, height: h * 2, size: 9, thumbnail: `https://cdn.pixabay.com/video/${id}_large.jpg` },
    medium: { url: `https://cdn.pixabay.com/video/${id}_medium.mp4`, width: w, height: h, size: 3, thumbnail: `https://cdn.pixabay.com/video/${id}_medium.jpg` },
    tiny: { url: `https://cdn.pixabay.com/video/${id}_tiny.mp4`, width: w / 3, height: h / 3, size: 1, thumbnail: "" },
  },
});

describe("Pixabay normalizers", () => {
  it("keeps the 1080p rendition (skips 4K) with credit and page link", () => {
    expect(normalizePixabayVideo(pixVideo(5))).toEqual({
      id: "5", source: "pixabay", thumb: "https://cdn.pixabay.com/video/5_large.jpg", file: "https://cdn.pixabay.com/video/5_medium.mp4",
      width: 1920, height: 1080, durationSec: 12, credit: "Video by Ali on Pixabay", sourceUrl: "https://pixabay.com/videos/x-5/",
    });
    expect(normalizePixabayVideo(pixVideo(6, 1080, 1920))?.file).toBe("https://cdn.pixabay.com/video/6_medium.mp4");
    expect(normalizePixabayVideo({ id: 7, pageURL: "https://pixabay.com/videos/7/", duration: 5, videos: { large: { url: "", width: 0, height: 0 } } })).toBeNull();
  });

  it("uses the 1280px still (1920px when the key has full access) and scales the size", () => {
    const base = { id: 9, pageURL: "https://pixabay.com/photos/9/", user: "Sara", imageWidth: 6000, imageHeight: 3375, webformatURL: "https://cdn.pixabay.com/photo/9_640.jpg", largeImageURL: "https://cdn.pixabay.com/photo/9_1280.jpg" };
    expect(normalizePixabayPhoto(base)).toMatchObject({ file: "https://cdn.pixabay.com/photo/9_1280.jpg", width: 1280, height: 720, credit: "Photo by Sara on Pixabay", thumb: "https://cdn.pixabay.com/photo/9_640.jpg" });
    expect(normalizePixabayPhoto({ ...base, fullHDURL: "https://cdn.pixabay.com/photo/9_1920.jpg" })).toMatchObject({ file: "https://cdn.pixabay.com/photo/9_1920.jpg", width: 1920, height: 1080 });
  });

  it("accepts only provider hosts for imports", () => {
    expect(isStockHost("https://cdn.pixabay.com/video/1.mp4")).toBe(true);
    expect(isStockHost("https://videos.pexels.com/video-files/1/hd.mp4")).toBe(true);
    expect(isStockHost("https://pixabay.com.evil.example/x.mp4")).toBe(false);
    expect(isStockHost("not a url")).toBe(false);
  });
});

describe("stock providers", () => {
  it("asks for a Pixabay or Pexels key when neither exists", async () => {
    await expect(stockProviders()).rejects.toThrow(/Pixabay/);
  });

  it("searches Pixabay with only its key, sends safesearch, and orders clips matching the orientation first", async () => {
    vault.pixabay = { apiKey: "pk" };
    const urls: string[] = [];
    globalThis.fetch = (async (url: URL | string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ totalHits: 2, hits: [pixVideo(1), pixVideo(2, 1080, 1920)] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await searchStockVideos("ocean waves unique-1", 1, "portrait");
    expect(r.source).toBe("pixabay");
    expect(r.items.map(i => i.id)).toEqual(["2", "1"]);
    const u = new URL(urls[0]);
    expect(u.origin + u.pathname).toBe("https://pixabay.com/api/videos/");
    expect(u.searchParams.get("key")).toBe("pk");
    expect(u.searchParams.get("safesearch")).toBe("true");
    // Pixabay asks for 24-hour caching: the same search does not hit the API again.
    await searchStockVideos("ocean waves unique-1", 1, "portrait");
    expect(urls).toHaveLength(1);
  });

  it("falls back from Pexels to Pixabay when Pexels hits its rate limit, but not on a rejected key", async () => {
    vault.pexels = { apiKey: "px" };
    vault.pixabay = { apiKey: "pk" };
    const hosts: string[] = [];
    globalThis.fetch = (async (url: URL | string) => {
      const u = new URL(String(url));
      hosts.push(u.hostname);
      if (u.hostname === "api.pexels.com") return new Response("slow down", { status: 429 });
      return new Response(JSON.stringify({ totalHits: 1, hits: [{ id: 3, pageURL: "https://pixabay.com/photos/3/", user: "Omar", imageWidth: 4000, imageHeight: 2250, webformatURL: "https://cdn.pixabay.com/photo/3_640.jpg", largeImageURL: "https://cdn.pixabay.com/photo/3_1280.jpg" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await searchStockPhotos("desert dunes unique-2");
    expect(hosts).toEqual(["api.pexels.com", "pixabay.com"]);
    expect(r.source).toBe("pixabay");
    expect(r.items[0].credit).toBe("Photo by Omar on Pixabay");

    globalThis.fetch = (async () => new Response('[ERROR 400] "key" is invalid', { status: 400 })) as unknown as typeof fetch;
    delete vault.pexels;
    await expect(searchStockPhotos("desert dunes unique-3")).rejects.toThrow(/مفتاح Pixabay مرفوض/);
  });
});
