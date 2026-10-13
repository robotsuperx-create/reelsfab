import { costEntries, type Character } from "../../drizzle/schema";
import { HOOK_TYPE_KEYS, LLM_PRICE_PER_MTOK, TEMPLATES, TEMPLATE_KEYS } from "../../shared/domain";
import { invokeLLM, type Message } from "../_core/llm";
import { requireDb } from "../db";
import { invokeProvider, providerConfigured, type ProviderName } from "./ai-providers";

type JsonSchemaObject = Record<string, unknown>;

function estimateMilliCents(model: string, tokensIn: number, tokensOut: number) {
  const price = LLM_PRICE_PER_MTOK[model] ?? { in: 3, out: 15 };
  const usd = (tokensIn * price.in + tokensOut * price.out) / 1_000_000;
  return Math.max(1, Math.round(usd * 100000));
}

function resolveProvider(model: string): { provider: ProviderName; model: string } {
  const explicit = model.match(/^(manus|openai|anthropic|gemini):(.+)$/i);
  if (explicit) return { provider: explicit[1].toLowerCase() as ProviderName, model: explicit[2] };
  if (/^gpt[-_]/i.test(model)) return { provider: "openai", model };
  if (/^claude[-_]/i.test(model)) return { provider: "anthropic", model };
  if (/^gemini[-_]/i.test(model)) return { provider: "gemini", model };
  return { provider: "manus", model };
}

function textOnlyMessages(messages: Message[]) {
  const text = (content: Message["content"]): string | null => {
    const parts = Array.isArray(content) ? content : [content];
    if (parts.some(part => typeof part !== "string" && part.type !== "text")) return null;
    return parts.map(part => typeof part === "string" ? part : part.type === "text" ? part.text : "").join("\n");
  };
  const values = messages.map(message => ({ role: message.role, text: text(message.content) }));
  return values.some(value => value.text === null) ? null : values as { role: Message["role"]; text: string }[];
}

/** Uses the configured external provider when its model/key is available; otherwise keeps Manus as a safe fallback. */
export async function callJson<T>(opts: {
  model: string;
  messages: Message[];
  schemaName: string;
  schema: JsonSchemaObject;
  maxTokens?: number;
  description: string;
  refType?: string;
  refId?: number;
  userId?: number;
}): Promise<T> {
  const target = resolveProvider(opts.model);
  const textMessages = textOnlyMessages(opts.messages);
  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let billedModel = opts.model;

  if (target.provider !== "manus" && textMessages && await providerConfigured(target.provider)) {
    const system = textMessages.filter(message => message.role === "system").map(message => message.text).join("\n\n");
    const prompt = textMessages.filter(message => message.role !== "system").map(message => `${message.role.toUpperCase()}:\n${message.text}`).join("\n\n");
    let result: Awaited<ReturnType<typeof invokeProvider>>;
    try {
      result = await invokeProvider({
        provider: target.provider,
        model: target.model,
        system: system || undefined,
        prompt,
        jsonSchema: opts.schema,
        maxTokens: opts.maxTokens ?? 8000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (target.provider === "anthropic" && /credit balance|insufficient_quota|billing/i.test(message)) {
        throw new Error("Claude رفض الطلب لأن رصيد Anthropic غير كافٍ. أضف رصيدًا من Plans & Billing في Anthropic، أو غيّر نموذج النصوص إلى manus أو مزود آخر. مفتاح Higgsfield لا يولّد النصوص؛ هو مخصص لفيديو Premium.");
      }
      throw new Error(`${target.provider} لم يتمكن من توليد النص: ${message.slice(0, 500)}`);
    }
    text = result.text;
    tokensIn = result.usage?.inputTokens ?? 0;
    tokensOut = result.usage?.outputTokens ?? 0;
    billedModel = target.model;
  } else {
    const result = await invokeLLM({
      model: opts.model,
      messages: opts.messages,
      maxTokens: opts.maxTokens ?? 8000,
      outputSchema: { name: opts.schemaName, schema: opts.schema, strict: true },
    });
    const raw = result.choices?.[0]?.message?.content;
    text = typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw.map(p => (p.type === "text" ? p.text : "")).join("")
        : "";
    tokensIn = result.usage?.prompt_tokens ?? 0;
    tokensOut = result.usage?.completion_tokens ?? 0;
  }
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  let parsed: T;
  try {
    parsed = JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("لم يُرجع النموذج JSON صالحًا");
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as T;
  }
  try {
    const db = await requireDb();
    await db.insert(costEntries).values({
      category: "llm",
      amountMilliCents: estimateMilliCents(billedModel, tokensIn, tokensOut),
      description: opts.description.slice(0, 500),
      model: billedModel,
      tokensIn,
      tokensOut,
      refType: opts.refType,
      refId: opts.refId,
      createdBy: opts.userId,
    });
  } catch (e) {
    console.warn("[cost] failed to record LLM cost", e);
  }
  return parsed;
}

function characterBrief(c: Character) {
  return [
    `Name: ${c.name} (${c.nameAr ?? ""})`,
    `Age: ${c.age ?? "-"} | Origin: ${c.origin ?? "-"}`,
    `Niche: ${c.niche ?? "-"}`,
    `Appearance (prompt-ready): ${c.appearancePrompt ?? "-"}`,
    `Wardrobe: ${c.wardrobe ?? "-"}`,
    `Voice: ${c.voiceDescription ?? "-"}`,
    `Personality/style: ${c.style ?? "-"}`,
    `Catchphrase: ${c.catchphrase || "(none)"}`,
    `Signature content formats: ${(c.contentTemplates ?? []).join(" | ")}`,
    `Product to softly promote: ${c.product ?? "-"}`,
    `Character-specific rules: ${c.rules || "(none)"}`,
  ].join("\n");
}

const GLOBAL_RULES = `Global rules (Character Bible):
- Every character is openly an AI character. Never claim to be human; never deny being AI.
- Content language: natural spoken American/British English for a Western audience.
- Claims policy: NO invented income numbers, NO dollar amounts earned, NO health/medical results or cures, NO weight-loss numbers, NO investment recommendations, NO job/contract promises, NO gambling or counterfeit promotion, NO smoking.
- Titles and hooks are value-based (ideas, studies, plans, experiments, lessons) — curiosity without lies.`;

export type GeneratedScript = {
  topic: string;
  templateKey: string;
  hookType: string;
  hook: string;
  body: string;
  payoff: string;
  cta: string;
  onScreenText: string;
  caption: string;
  hashtags: string;
  higgsfieldPrompt: string;
};

const scriptItemSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "topic",
    "templateKey",
    "hookType",
    "hook",
    "body",
    "payoff",
    "cta",
    "onScreenText",
    "caption",
    "hashtags",
    "higgsfieldPrompt",
  ],
  properties: {
    topic: { type: "string", description: "Short topic label (max 8 words)" },
    templateKey: { type: "string", enum: TEMPLATE_KEYS },
    hookType: { type: "string", enum: HOOK_TYPE_KEYS },
    hook: { type: "string", description: "Spoken hook, first 2 seconds, 5-10 words" },
    body: { type: "string", description: "Spoken core idea" },
    payoff: { type: "string", description: "Spoken result / takeaway" },
    cta: { type: "string", description: "Spoken soft call to action, 3-8 words" },
    onScreenText: { type: "string", description: "Big on-screen title, max 6 words" },
    caption: { type: "string", description: "Post caption, max 150 characters, no hashtags" },
    hashtags: { type: "string", description: "4-6 hashtags separated by spaces, include #AIcharacter" },
    higgsfieldPrompt: {
      type: "string",
      description:
        "Only for PREMIUM scripts: English video-generation prompt (scene, wardrobe, action, camera move, lighting, mood), 40-70 words. Empty string for economic scripts.",
    },
  },
};

export async function generateScriptsForCharacter(opts: {
  character: Character;
  count: number;
  premiumCount: number;
  templateKeys?: string[];
  topicHints?: string;
  avoidHooks: string[];
  model: string;
  userId?: number;
  batchId?: number;
}): Promise<GeneratedScript[]> {
  const templates = TEMPLATES.filter(t => !opts.templateKeys?.length || opts.templateKeys.includes(t.key));
  const templateList = templates.map(t => `- ${t.key}: ${t.description}`).join("\n");
  const system = `You are the head writer of a short-form video studio producing 15-second vertical reels (TikTok, Instagram Reels, YouTube Shorts) for AI influencer characters. You write tight, natural spoken scripts in the character's own voice.\n\n${GLOBAL_RULES}`;
  const user = `CHARACTER\n${characterBrief(opts.character)}\n\nWrite ${opts.count} different 15-second reel scripts for this character.\n\nSTRUCTURE per script: hook (0-2s) → body (the idea) → payoff (the result/lesson) → cta. TOTAL spoken words (hook+body+payoff+cta) MUST be 30 to 40 words so it fits 15 seconds.\n\nAllowed visual templates (vary them):\n${templateList}\n\nMix hook types (question, mistake, contrarian, number, story, secret). Use the character's signature formats and personality. Use the catchphrase in at most 1 of every 3 scripts. CTA rotates between: follow for more, save this, comment a word, and a soft product mention (${opts.character.product ?? "-"}) — product mention in at most 1 of every 4 scripts, never pushy.\n\nThe FIRST ${opts.premiumCount} scripts are PREMIUM (filmed with an AI video model, the character on camera doing a visual action): fill higgsfieldPrompt for them. All other scripts are ECONOMIC (still image + voice-over): higgsfieldPrompt = "".\n\n${opts.topicHints ? `Topic direction from the team: ${opts.topicHints}\n\n` : ""}Do NOT repeat or closely paraphrase these recent hooks:\n${opts.avoidHooks.slice(0, 40).map(h => `- ${h}`).join("\n") || "- (none)"}\n\nReturn JSON {"scripts":[...]} with exactly ${opts.count} items.`;
  const res = await callJson<{ scripts: GeneratedScript[] }>({
    model: opts.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    schemaName: "reel_scripts",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["scripts"],
      properties: { scripts: { type: "array", items: scriptItemSchema } },
    },
    maxTokens: 12000,
    description: `توليد ${opts.count} نص لـ ${opts.character.name}`,
    refType: "batch",
    refId: opts.batchId,
    userId: opts.userId,
  });
  return (res.scripts ?? []).slice(0, opts.count);
}

export async function rewriteHooks(opts: {
  character: Character;
  hook: string;
  body: string;
  model: string;
  userId?: number;
  scriptId: number;
}) {
  const res = await callJson<{ hooks: { hook: string; hookType: string; onScreenText: string }[] }>({
    model: opts.model,
    messages: [
      { role: "system", content: `You write scroll-stopping hooks for 15-second reels.\n${GLOBAL_RULES}` },
      {
        role: "user",
        content: `CHARACTER\n${characterBrief(opts.character)}\n\nCurrent hook: "${opts.hook}"\nScript body: "${opts.body}"\n\nWrite 5 alternative spoken hooks (5-10 words each, different hook types) and a matching on-screen title (max 6 words) for each.`,
      },
    ],
    schemaName: "hooks",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["hooks"],
      properties: {
        hooks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["hook", "hookType", "onScreenText"],
            properties: {
              hook: { type: "string" },
              hookType: { type: "string", enum: HOOK_TYPE_KEYS },
              onScreenText: { type: "string" },
            },
          },
        },
      },
    },
    maxTokens: 2000,
    description: `إعادة كتابة Hook للنص #${opts.scriptId}`,
    refType: "script",
    refId: opts.scriptId,
    userId: opts.userId,
  });
  return res.hooks ?? [];
}

export type DerivativeVariant = {
  variantLabel: string;
  hook: string;
  hookType: string;
  onScreenText: string;
  cta: string;
  caption: string;
  hashtags: string;
};

export async function generateDerivativeVariants(opts: {
  character: Character;
  transcript: string;
  originalHook: string;
  count: number;
  model: string;
  userId?: number;
  clipId: number;
}) {
  const res = await callJson<{ variants: DerivativeVariant[] }>({
    model: opts.model,
    messages: [
      {
        role: "system",
        content: `You repurpose one premium AI-character video into several distinct reels. The video and its spoken audio stay the same; you change the on-screen hook title (shown in the first 2.5 seconds), the end-card CTA and the post caption, to test different angles.\n${GLOBAL_RULES}`,
      },
      {
        role: "user",
        content: `CHARACTER\n${characterBrief(opts.character)}\n\nVideo transcript: "${opts.transcript}"\nOriginal hook: "${opts.originalHook}"\n\nCreate ${opts.count} variants with clearly different angles (e.g. curiosity, mistake, contrarian, list/number, emotional/story). For each: variantLabel (2-4 words), hook (on-screen hook sentence, max 9 words), hookType, onScreenText (max 6 words), cta (end card, max 6 words), caption (max 150 chars, no hashtags), hashtags (4-6, include #AIcharacter).`,
      },
    ],
    schemaName: "derivatives",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["variants"],
      properties: {
        variants: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["variantLabel", "hook", "hookType", "onScreenText", "cta", "caption", "hashtags"],
            properties: {
              variantLabel: { type: "string" },
              hook: { type: "string" },
              hookType: { type: "string", enum: HOOK_TYPE_KEYS },
              onScreenText: { type: "string" },
              cta: { type: "string" },
              caption: { type: "string" },
              hashtags: { type: "string" },
            },
          },
        },
      },
    },
    maxTokens: 4000,
    description: `توليد ${opts.count} نسخ مشتقة من Premium #${opts.clipId}`,
    refType: "premium_clip",
    refId: opts.clipId,
    userId: opts.userId,
  });
  return (res.variants ?? []).slice(0, opts.count);
}

export type VisualCheckResult = { score: number; consistent: boolean; issues: string[] };

export async function visualConsistencyCheck(opts: {
  frameUrl: string;
  referenceUrl: string | null;
  character: Character;
  model: string;
  userId?: number;
  renderId: number;
}) {
  const content: Message["content"] = [
    {
      type: "text",
      text: `You are a strict QC reviewer for AI-character reels. Image 1 is a frame from a rendered reel${opts.referenceUrl ? "; image 2 is the official reference of the character" : ""}.\nCharacter spec: ${opts.character.appearancePrompt}\nCheck: (1) the person matches the character identity (face, hair, age, build) ${opts.referenceUrl ? "and the reference" : ""}; (2) no visual defects (extra fingers, warped face, artifacts); (3) text overlays are readable and not covering the face; (4) an "AI-generated" disclosure label is visible; (5) nothing violates platform rules (smoking, nudity). Score 0-100 overall. List concrete issues in Arabic (short).`,
    },
    { type: "image_url", image_url: { url: opts.frameUrl, detail: "low" } },
  ];
  if (opts.referenceUrl) content.push({ type: "image_url", image_url: { url: opts.referenceUrl, detail: "low" } });
  return callJson<VisualCheckResult>({
    model: opts.model,
    messages: [{ role: "user", content }],
    schemaName: "visual_qc",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["score", "consistent", "issues"],
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        consistent: { type: "boolean" },
        issues: { type: "array", items: { type: "string" } },
      },
    },
    maxTokens: 1500,
    description: `فحص بصري للرندر #${opts.renderId}`,
    refType: "render",
    refId: opts.renderId,
    userId: opts.userId,
  });
}

export async function performanceInsights(opts: { dataJson: string; model: string; userId?: number }) {
  const res = await callJson<{ markdown: string }>({
    model: opts.model,
    messages: [
      {
        role: "system",
        content:
          "أنت محلل نمو لمحتوى الفيديو القصير. تكتب بالعربية، بإيجاز ووضوح، وتعتمد فقط على الأرقام المعطاة دون اختلاق.",
      },
      {
        role: "user",
        content: `هذه بيانات أداء ريلات 15 ثانية لشخصيات AI (مجمعة حسب الشخصية والقالب ونوع الـHook والمسار، مع أفضل وأسوأ المنشورات):\n${opts.dataJson}\n\nاكتب تقرير Markdown قصيرًا: 1) ما الذي ينجح (كرره)، 2) ما الذي يفشل (أوقفه)، 3) خمس تجارب محددة للأسبوع القادم (شخصية + قالب + نوع Hook + فكرة)، 4) توصية لتوزيع الحصة اليومية بين الشخصيات. إن كانت البيانات قليلة فقل ذلك صراحة.`,
      },
    ],
    schemaName: "insights",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["markdown"],
      properties: { markdown: { type: "string" } },
    },
    maxTokens: 4000,
    description: "تحليل الأداء واقتراحات",
    userId: opts.userId,
  });
  return res.markdown;
}
