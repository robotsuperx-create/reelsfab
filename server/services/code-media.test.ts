import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compileStoryboard, mediaSlots, normalizeStoryboard, storyboardDoc, storyboardFromHtml } from "../../shared/code-craft/storyboard";
import { knowledgeFor } from "../../shared/code-craft/knowledge";
import { CODE_VIDEO_CSP } from "../../shared/code-video";
import { countryId, mapGeometry } from "./code-maps";
import { prepareStoryboard, swapSlot } from "./code-media";

describe("pictures in storyboards", () => {
  it("keeps photo / clip / map backdrops and photo cards, and drops what cannot work", () => {
    const { storyboard, issues } = normalizeStoryboard(
      {
        grade: "warm",
        brand: { logo: "local/stills/logo_1.png", watermark: true },
        scenes: [
          { from: 0, to: 3, media: { type: "photo", query: "oil refinery at night!!", motion: "left", dim: 2 }, items: [{ type: "title", text: "النفط" }] },
          { from: 3, to: 6, place: "top", media: { type: "map", focus: ["MA"], routes: [["MA", "ES"], ["MA"]], pins: ["EG"] }, items: [{ type: "title", text: "الطريق" }] },
          { from: 6, to: 9, media: { type: "clip", key: "local/broll/a_1.mp4", start: 1, dur: 8, credit: "Video by A on Pexels" }, items: [{ type: "photo", asset: 12, frame: "polaroid", caption: "صورتي" }] },
          { from: 9, to: 12, media: { type: "photo" }, items: [{ type: "photo", key: "../../etc/passwd" }, { type: "title", text: "x" }] },
          { from: 12, to: 15, media: { type: "map" }, items: [{ type: "title", text: "y" }] },
        ],
      },
      15,
    );
    const [a, b, c, d, e] = storyboard.scenes;
    expect(a.media).toEqual({ type: "photo", query: "oil refinery at night", motion: "left", dim: 0.85 });
    expect(b.media).toMatchObject({ type: "map", focus: ["MA"], routes: [["MA", "ES"]], pins: [{ at: "EG" }] });
    expect(b.place).toBe("top");
    expect(c.media).toMatchObject({ type: "clip", key: "local/broll/a_1.mp4", start: 1, dur: 8 });
    expect(c.items[0]).toMatchObject({ type: "photo", asset: 12, frame: "polaroid", caption: "صورتي" });
    expect(d.media).toBeUndefined();
    expect(d.items.map(i => i.type)).toEqual(["title"]);
    expect(e.media).toBeUndefined();
    expect(issues.some(i => /backdrop needs a "query"/.test(i))).toBe(true);
    expect(issues.some(i => /map needs "focus"/.test(i))).toBe(true);
    expect(storyboard.grade).toBe("warm");
    expect(storyboard.brand).toEqual({ logo: "local/stills/logo_1.png", watermark: true });
    expect(mediaSlots(storyboard).map(s => `${s.scene}:${s.item}:${s.kind}`)).toEqual(["0:null:photo", "2:null:clip", "2:0:photo"]);
  });

  it("tells the director about free photos only when they are switched on", () => {
    expect(storyboardDoc(1080, 1920, 20, { stock: true })).toMatch(/"query":"oil refinery at night"/);
    expect(storyboardDoc(1080, 1920, 20, { stock: false })).toMatch(/switched off/);
    expect(storyboardDoc(1080, 1920, 20, { stock: false })).toMatch(/"type":"map"/);
    expect(knowledgeFor("documentary", { vertical: true, media: { stock: false } })).toMatch(/OFF for this video/);
    expect(knowledgeFor("documentary", { vertical: true, media: { stock: true, library: true, libraryText: "  #4 photo: \"me\"" } })).toMatch(/#4 photo/);
    expect(CODE_VIDEO_CSP).toMatch(/img-src[^;]*https:\/\/code-video\.local/);
  });

  it("carries map geometry and preview pictures inside the page, and reads the storyboard back without them", () => {
    const { storyboard } = normalizeStoryboard({ scenes: [{ from: 0, to: 3, items: [{ type: "title", text: "a" }] }] }, 3);
    const html = compileStoryboard(storyboard, { width: 540, height: 960, durationSec: 3, geo: { g1: { land: "M0,0" } }, media: { "local/a.jpg": "data:image/jpeg;base64,AA" } });
    expect(html).toContain('"__geo":{"g1"');
    expect(html).toContain("window.__cvMedia=");
    expect(html).not.toMatch(/<\/script><script>[^<]*<\/script>\s*<\/head>[\s\S]*__cvMedia/);
    const back = storyboardFromHtml(html) as Record<string, unknown>;
    expect(back.__geo).toBeUndefined();
    expect(back.scenes).toHaveLength(1);
  });

  it("swaps one picture: the next result, new words, a library asset, or none", () => {
    const { storyboard } = normalizeStoryboard({ scenes: [{ from: 0, to: 3, media: { type: "photo", query: "desert", key: "local/x_1.jpg", credit: "c", ref: "pexels:1" }, items: [{ type: "photo", query: "camel" }, { type: "title", text: "t" }] }] }, 3);
    const next = swapSlot(storyboard, { scene: 0, item: null }, {});
    expect(next.scenes[0].media).toMatchObject({ type: "photo", query: "desert", pick: 1 });
    expect((next.scenes[0].media as { key?: string }).key).toBeUndefined();
    expect(storyboard.scenes[0].media).toMatchObject({ key: "local/x_1.jpg" });
    expect(swapSlot(storyboard, { scene: 0, item: null }, { query: "sand dunes" }).scenes[0].media).toMatchObject({ query: "sand dunes" });
    expect(swapSlot(storyboard, { scene: 0, item: 0 }, { asset: 9 }).scenes[0].items[0]).toMatchObject({ type: "photo", asset: 9 });
    expect(swapSlot(storyboard, { scene: 0, item: 0 }, { remove: true }).scenes[0].items.map(i => i.type)).toEqual(["title"]);
    expect(() => swapSlot(storyboard, { scene: 0, item: 1 }, {})).toThrow();
  });

  it("drops searched pictures when free photos are off, keeps stored ones, and draws the maps", async () => {
    const { storyboard } = normalizeStoryboard(
      {
        lang: "ar",
        scenes: [
          { from: 0, to: 3, media: { type: "photo", query: "desert" }, items: [{ type: "title", text: "a" }] },
          { from: 3, to: 6, media: { type: "photo", key: "local/x_1.jpg", credit: "Photo by B on Pixabay" }, items: [{ type: "title", text: "b" }] },
          { from: 6, to: 9, media: { type: "map", focus: ["المغرب"], highlight: ["ES"] }, items: [{ type: "title", text: "c" }] },
        ],
      },
      9,
    );
    const r = await prepareStoryboard(storyboard, { stock: false, library: false, width: 1080, height: 1920 });
    expect(r.storyboard.scenes[0].media).toBeUndefined();
    expect(r.storyboard.scenes[1].media).toMatchObject({ key: "local/x_1.jpg" });
    const map = r.storyboard.scenes[2].media as { geoId?: string };
    expect(map.geoId).toMatch(/^g[0-9a-f]{10}$/);
    const geo = r.geo[map.geoId!];
    expect(geo.hi.map(h => h.name)).toEqual(["المغرب", "إسبانيا"]);
    expect(geo.zoom.k).toBeGreaterThan(1.2);
    expect(r.credits).toEqual(["Photo by B on Pixabay"]);
    expect(r.notes.join(" ")).toMatch(/مطفأة/);
  });
});

describe("maps", () => {
  it("finds countries by ISO code, number, English or Arabic name", () => {
    const g = mapGeometry({ focus: ["MA", "MAR", "Morocco", "المغرب", "Atlantis"] }, { width: 1080, height: 1920, lang: "ar", dark: true })!;
    expect(g.hi).toHaveLength(1);
    expect(g.hi[0].id).toBe("504");
  });

  it("draws Morocco whole, with its Sahara, unless asked otherwise", () => {
    const whole = mapGeometry({ focus: ["MA"], highlight: ["EH"] }, { width: 1080, height: 1920, lang: "ar", dark: true })!;
    expect(whole.hi.map(h => h.id)).toEqual(["504"]);
    const apart = mapGeometry({ focus: ["MA"], highlight: ["EH"], sahara: "separate" }, { width: 1080, height: 1920, lang: "en", dark: true })!;
    expect(apart.hi.map(h => h.id)).toEqual(["504", "732"]);
    expect(countryId("Morocco", [] as never)).toBeNull();
  });

  it("zooms close on small countries, stays light, keeps labels apart and on screen", () => {
    const g = mapGeometry({ focus: ["LB"], highlight: ["SY", "IL", "JO"] }, { width: 1920, height: 1080, lang: "ar", dark: true })!;
    expect(g.zoom.k).toBeGreaterThan(4);
    expect(JSON.stringify(g).length).toBeLessThan(200_000);
    const boxes = g.hi.filter(h => h.lb).map(h => h.lb!);
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i][0]).toBeGreaterThan(0);
      expect(boxes[i][0]).toBeLessThan(1920);
      for (let j = 0; j < i; j++) expect(Math.abs(boxes[i][0] - boxes[j][0]) > 60 || Math.abs(boxes[i][1] - boxes[j][1]) > 40).toBe(true);
    }
    const w = mapGeometry({ world: true, routes: [["US", "CN"]] }, { width: 1080, height: 1920, lang: "en", dark: true })!;
    expect(w.world).toBe(true);
    expect(w.routes[0].d).toMatch(/^M[\d.-]+,[\d.-]+Q/);
  });
});

// Needs GSAP and the fonts from the CDN (or a filled CODE_VIDEO_CDN_CACHE), and ffmpeg. CODE_VIDEO_OFFLINE=1 skips it.
describe.skipIf(process.env.CODE_VIDEO_OFFLINE === "1")("pictures in the real recorder", () => {
  it("shows a stored photo, plays a clip frame by frame and draws a map", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cv-media-test-"));
    process.env.MEDIA_STORAGE = "local";
    process.env.MEDIA_DIR = dir;
    const { mediaPut } = await import("../storage");
    const { captureStills } = await import("../worker/code-video");
    const clipFile = join(dir, "src.mp4");
    // A clip whose colour changes every second, and a striped photo.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1,format=yuv420p", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1,format=yuv420p", "-filter_complex", "[0][1]concat=n=2:v=1", "-c:v", "libx264", clipFile]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x480:d=1", "-frames:v", "1", join(dir, "photo.jpg")]);
    const clip = await mediaPut("broll/test.mp4", await readFile(clipFile), "video/mp4");
    const photo = await mediaPut("stills/test.jpg", await readFile(join(dir, "photo.jpg")), "image/jpeg");
    const { storyboard } = normalizeStoryboard(
      {
        grade: "none",
        scenes: [
          { from: 0, to: 2, transition: "cut", media: { type: "photo", key: photo.key, dim: 0 }, items: [{ type: "title", text: "a" }] },
          { from: 2, to: 4.5, transition: "cut", media: { type: "clip", key: clip.key, start: 0, dur: 2, dim: 0 }, items: [{ type: "title", text: "b" }] },
          { from: 4.5, to: 7, transition: "cut", media: { type: "map", focus: ["MA"] }, items: [{ type: "title", text: "c" }] },
        ],
      },
      7,
    );
    const ready = await prepareStoryboard(storyboard, { stock: false, library: false, width: 270, height: 480 });
    const html = compileStoryboard(ready.storyboard, { width: 270, height: 480, durationSec: 7, geo: ready.geo });
    const r = await captureStills({ html, width: 270, height: 480, at: [1.5, 2.5, 3.6, 6.5], scale: 1 });
    expect(r.consoleErrors).toEqual([]);
    expect(r.blocked).toEqual([]);
    // Average colour of a band below the title in each still.
    const mean = async (jpg: Buffer) => {
      const out = execFileSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", "crop=230:120:20:300,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { input: jpg });
      return [out[0], out[1], out[2]];
    };
    const [p, red, blue] = [await mean(r.stills[0]), await mean(r.stills[1]), await mean(r.stills[2])];
    expect(Math.max(...p) - Math.min(...p)).toBeGreaterThan(5);
    expect(red[0]).toBeGreaterThan(red[2] + 40);
    expect(blue[2]).toBeGreaterThan(blue[0] + 40);
    expect(r.stills[3].length).toBeGreaterThan(2000);
  }, 180_000);
});
