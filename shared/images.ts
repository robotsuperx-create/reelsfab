/**
 * AI image generation through fal.ai — one key, every major model, pay per image.
 * Tiers chosen from the Artificial Analysis text-to-image arena and fal's price list (Nov 2026):
 *   draft     FLUX.1 [schnell]   ~$0.003  fast placeholders, backgrounds
 *   standard  Meta Muse Image    ~$0.01   best quality per dollar (arena Elo ≈1126) — the default
 *   premium   Nano Banana 2.1    ~$0.04   near the top of the arena (Elo ≈1175) — thumbnails, hero shots
 * Any other fal endpoint id can be typed in the vault; its price is then taken from `usdPerImage`.
 */
export const IMAGE_TIERS = ["draft", "standard", "premium"] as const;
export type ImageTier = (typeof IMAGE_TIERS)[number];

export const IMAGE_TIER_DEFAULTS: Record<ImageTier, { model: string; usd: number; label: string }> = {
  draft: { model: "fal-ai/flux/schnell", usd: 0.003, label: "مسودة — FLUX schnell (~0.003$)" },
  standard: { model: "meta/muse-image/text-to-image", usd: 0.01, label: "قياسي — Meta Muse Image (~0.01$)" },
  premium: { model: "google/nano-banana-2.1", usd: 0.04, label: "ممتاز — Nano Banana 2.1 (~0.04$)" },
};

/** Known list prices (USD per 1K image) for cost logging; unknown models fall back to the vault's usdPerImage. */
export const IMAGE_MODEL_USD: Record<string, number> = {
  "fal-ai/flux/schnell": 0.003,
  "fal-ai/z-image/turbo": 0.005,
  "fal-ai/flux-2/klein/4b": 0.005,
  "blackforestlabs/flux-3/klein/text-to-image": 0.009,
  "meta/muse-image/text-to-image": 0.01,
  "bytedance/seedream/v5/flash/text-to-image": 0.027,
  "fal-ai/flux-2-pro": 0.03,
  "bytedance/seedream/v5/lite/text-to-image": 0.035,
  "google/nano-banana-2.1": 0.04,
  "alibaba/qwen-image-3/text-to-image": 0.04,
  "blackforestlabs/flux-3/text-to-image": 0.048,
  "fal-ai/nano-banana-2": 0.08,
  "fal-ai/nano-banana-pro": 0.15,
};

export type ImageAspect = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

/** Style suffix per channel visual style: consistent look inside a channel, and never text in the picture (we overlay our own). */
export const IMAGE_STYLE_BY_VISUAL: Record<string, string> = {
  illustration:
    "children's picture-book illustration, soft watercolor and gouache textures, warm friendly palette, rounded shapes, gentle lighting, wholesome and safe for young children",
  maps: "vintage cartographic illustration, aged parchment texture, hand-drawn coastlines and terrain, muted sepia and teal palette, documentary style",
  stills: "cinematic documentary still, natural light, shallow depth of field, realistic, rich but natural colors",
  stock: "cinematic documentary still, natural light, realistic, rich but natural colors",
};
export const IMAGE_NEGATIVE = "no text, no letters, no captions, no watermark, no logo";

/** The request body each fal model family expects. */
export function falImageBody(model: string, prompt: string, aspect: ImageAspect) {
  if (/flux\/schnell|flux-1|z-image|flux-2\/klein|flux\/dev/i.test(model)) {
    const size = aspect === "16:9" ? "landscape_16_9" : aspect === "9:16" ? "portrait_16_9" : aspect === "4:3" ? "landscape_4_3" : aspect === "3:4" ? "portrait_4_3" : "square_hd";
    return { prompt, image_size: size, num_images: 1, output_format: "jpeg", enable_safety_checker: true };
  }
  if (/nano-banana/i.test(model)) return { prompt, aspect_ratio: aspect, resolution: "1K", num_images: 1, output_format: "jpeg", limit_generations: true };
  return { prompt, aspect_ratio: aspect, num_images: 1, output_format: "jpeg" };
}

export function imagePromptFor(scenePrompt: string, visualStyle: string, extraStyle?: string) {
  const style = [extraStyle?.trim(), IMAGE_STYLE_BY_VISUAL[visualStyle] ?? IMAGE_STYLE_BY_VISUAL.stills].filter(Boolean).join(", ");
  return `${scenePrompt.trim().replace(/\s+/g, " ").slice(0, 900)}. Style: ${style}. ${IMAGE_NEGATIVE}.`;
}
