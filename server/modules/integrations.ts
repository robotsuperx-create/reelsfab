import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { integrations } from "../../drizzle/schema";
import { decryptSecret, encryptSecret } from "../services/social-accounts";
import { requireDb } from "../db";
import { memberProcedure, teamAdminProcedure } from "../procedures";
import { router } from "../_core/trpc";

const CAPABILITIES = ["text", "review", "image", "video", "voice", "transcription", "social_publish", "analytics", "storage"] as const;
const PROVIDERS = ["openai", "anthropic", "gemini", "higgsfield", "elevenlabs", "elevenlabs-speech", "instagram", "tiktok", "youtube", "cloudinary", "replicate", "telegram", "pexels", "ollama", "speech", "fal", "custom"] as const;

async function getRow(id: number) {
  const db = await requireDb();
  const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
  if (!row) throw new Error("Integration not found");
  return row;
}

async function probe(provider: string, config: Record<string, string>) {
  const key = config.apiKey || config.accessToken || config.token;
  if (provider === "telegram") {
    const token = config.botToken || config.apiKey;
    if (!token || !config.chatId) throw new Error("Telegram يحتاج botToken و chatId");
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    if (!r.ok) throw new Error(`Telegram رفض التوكن (${r.status})`);
    return { checked: true };
  }
  if (provider === "instagram" && (config.appId || config.clientId)) {
    if (!(config.appSecret || config.clientSecret)) throw new Error("Instagram يحتاج appId و appSecret من تطبيق Meta");
    return { checked: false, note: "بيانات تطبيق Meta محفوظة؛ اربط حساب كل شخصية من صفحتها." };
  }
  if (provider === "fal") {
    // fal has no free "whoami" call; a malformed key is caught here, a wrong one on the first image (no charge on 401).
    if (!config.apiKey || !/^[A-Za-z0-9_-]{8,}:[A-Za-z0-9_-]{16,}$/.test(config.apiKey.trim())) throw new Error("مفتاح fal.ai يكون بالشكل key-id:key-secret — انسخه من fal.ai/dashboard/keys");
    for (const k of ["draftModel", "standardModel", "premiumModel"]) {
      const v = config[k]?.trim();
      if (v && !/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){1,5}$/i.test(v)) throw new Error(`${k} ليس معرّف نموذج fal صالحًا (مثال: meta/muse-image/text-to-image)`);
    }
    return { checked: false, note: "شكل المفتاح صحيح؛ أول صورة تولّدها تتحقق منه (لا تُحتسب تكلفة عند الرفض)." };
  }
  if (provider === "speech") {
    // OpenAI's endpoint needs a key (this one or the OpenAI provider's); a self-hosted clone server may be open.
    const base = (config.baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    const openai = /api\.openai\.com/i.test(base);
    if (config.extraJson?.trim()) {
      try { JSON.parse(config.extraJson); } catch { throw new Error("extraJson ليس JSON صالحًا"); }
    }
    if (openai) {
      if (!key) return { checked: false, note: "سيُستخدم مفتاح مزوّد OpenAI المحفوظ في الخزنة (أو أضف apiKey هنا)." };
      const r = await fetch("https://api.openai.com/v1/models/gpt-4o-mini-tts", { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) throw new Error(`OpenAI رفض المفتاح (${r.status})`);
      return { checked: true };
    }
    const r = await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} }).catch(() => null);
    if (!r) throw new Error(`خادم الصوت لا يستجيب على ${base} — شغّله أولًا (نفق/عنوان عام إن كان على جهاز آخر)`);
    return { checked: r.ok, note: r.ok ? undefined : `الخادم يرد ${r.status} على /models؛ سيُختبر /audio/speech عند أول حلقة.` };
  }
  if (!key && provider !== "custom" && provider !== "higgsfield" && provider !== "youtube" && provider !== "ollama") throw new Error("أدخل apiKey أو accessToken أولاً");
  if (provider === "openai") {
    const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`OpenAI رفض الاتصال (${r.status})`);
  } else if (provider === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key!, "anthropic-version": "2023-06-01" } });
    if (!r.ok) throw new Error(`Claude رفض الاتصال (${r.status})`);
  } else if (provider === "gemini") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key!)}`);
    if (!r.ok) throw new Error(`Gemini رفض الاتصال (${r.status})`);
  } else if (provider === "elevenlabs") {
    const r = await fetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": key! } });
    if (!r.ok) throw new Error(`ElevenLabs رفض الاتصال (${r.status})`);
  } else if (provider === "higgsfield") {
    if (!config.apiKey || !config.apiSecret) throw new Error("Higgsfield يحتاج apiKey و apiSecret");
    return { checked: false, note: "تم التحقق من وجود المفتاحين؛ أول طلب فيديو سيجري اختبار الصلاحية دون استهلاك إضافي." };
  } else if (provider === "youtube") {
    if (!config.clientId || !config.clientSecret) throw new Error("YouTube يحتاج clientId و clientSecret بالإضافة إلى OAuth token للحساب");
    return { checked: false, note: "بيانات OAuth مسجلة؛ اختبار الرفع يتم عند نشر أول فيديو." };
  } else if (provider === "ollama") {
    const base = (config.baseUrl?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "");
    const r = await fetch(`${base}/api/tags`).catch(() => null);
    if (!r?.ok) throw new Error("Ollama لا يستجيب — تأكد أنه يعمل على هذا الجهاز (ollama serve)");
    const data = (await r.json()) as { models?: { name: string }[] };
    const names = (data.models ?? []).map(m => m.name);
    if (config.model && !names.some(n => n === config.model || n.startsWith(`${config.model}:`))) {
      throw new Error(`النموذج ${config.model} غير منزّل. النماذج المتاحة: ${names.join(", ") || "لا شيء"} — نزّله بـ ollama pull`);
    }
  } else if (provider === "pexels") {
    const r = await fetch("https://api.pexels.com/v1/videos/search?query=nature&per_page=1", { headers: { Authorization: key! } });
    if (!r.ok) throw new Error(`Pexels رفض المفتاح (${r.status})`);
  } else if (provider === "custom") {
    if (!config.testUrl) throw new Error("أضف testUrl لاختبار الموصل المخصص");
    const r = await fetch(config.testUrl, { headers: key ? { Authorization: `Bearer ${key}` } : undefined });
    if (!r.ok) throw new Error(`الخدمة المخصصة رفضت الاتصال (${r.status})`);
  } else {
    return { checked: false, note: "تم حفظ الموصل. اختبار الاتصال الخاص بهذا المزود سيستخدم محوله عند أول طلب." };
  }
  return { checked: true };
}

export const integrationsRouter = router({
  list: memberProcedure.query(async () => {
    const db = await requireDb();
    return db.select({
      id: integrations.id,
      provider: integrations.provider,
      label: integrations.label,
      capabilities: integrations.capabilities,
      configKeys: integrations.configKeys,
      status: integrations.status,
      lastCheckedAt: integrations.lastCheckedAt,
      lastError: integrations.lastError,
      createdAt: integrations.createdAt,
      updatedAt: integrations.updatedAt,
    }).from(integrations).orderBy(desc(integrations.updatedAt));
  }),
  save: teamAdminProcedure.input(z.object({
    id: z.number().optional(),
    provider: z.enum(PROVIDERS),
    label: z.string().min(1).max(120),
    capabilities: z.array(z.enum(CAPABILITIES)).min(1),
    config: z.record(z.string(), z.string()).default({}),
  })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const encryptedConfig = encryptSecret(JSON.stringify(input.config));
    const values = {
      provider: input.provider,
      label: input.label,
      capabilities: input.capabilities,
      configKeys: Object.keys(input.config),
      encryptedConfig,
      status: "connected" as const,
      lastError: null,
      createdBy: ctx.user.id,
      updatedAt: new Date(),
    };
    if (input.id) await db.update(integrations).set(values).where(eq(integrations.id, input.id));
    else await db.insert(integrations).values(values);
    return { ok: true };
  }),
  test: teamAdminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const row = await getRow(input.id);
    try {
      const result = await probe(row.provider, JSON.parse(decryptSecret(row.encryptedConfig)) as Record<string, string>);
      await db.update(integrations).set({ status: "connected", lastCheckedAt: new Date(), lastError: null }).where(eq(integrations.id, row.id));
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "فشل اختبار الاتصال";
      await db.update(integrations).set({ status: "error", lastCheckedAt: new Date(), lastError: message }).where(eq(integrations.id, row.id));
      return { ok: false, message };
    }
  }),
  remove: teamAdminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = await requireDb();
    await db.delete(integrations).where(eq(integrations.id, input.id));
    return { ok: true };
  }),
});
