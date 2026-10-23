import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, EmptyBlock, Tally } from "@/components/fab/common";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, KeyRound, Plug, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const providers = [
  ["openai", "OpenAI", "النصوص · المراجعة · الصور · الصوت"],
  ["anthropic", "Claude / Anthropic", "النصوص · بناء الشخصيات"],
  ["gemini", "Gemini / Google", "النصوص · المراجعة · الصور"],
  ["higgsfield", "Higgsfield", "الفيديو Premium"],
  ["elevenlabs", "ElevenLabs", "الصوت · التعليق الصوتي"],
  ["instagram", "Instagram Graph API", "النشر · التحليلات"],
  ["tiktok", "TikTok API", "النشر · التحليلات"],
  ["youtube", "YouTube Data API", "النشر · التحليلات"],
  ["telegram", "Telegram", "إشعارات المالك"],
  ["pexels", "Pexels (مجاني)", "لقطات B-roll مجانية للمونتاج"],
  ["custom", "Custom API", "موصل قابل للتخصيص"],
] as const;
/** Fields each service needs, pre-filled in the form so nothing has to live in .env. */
const providerFields: Record<string, string[]> = {
  openai: ["apiKey"],
  anthropic: ["apiKey"],
  gemini: ["apiKey"],
  higgsfield: ["apiKey", "apiSecret"],
  elevenlabs: ["apiKey"],
  instagram: ["appId", "appSecret"],
  tiktok: ["clientId", "clientSecret"],
  youtube: ["clientId", "clientSecret"],
  telegram: ["botToken", "chatId"],
  pexels: ["apiKey"],
  custom: ["apiKey", "testUrl"],
};
const capabilities = ["text", "review", "image", "video", "voice", "transcription", "social_publish", "analytics", "storage"] as const;
const capabilityLabels: Record<string, string> = { text: "نصوص", review: "مراجعة", image: "صور", video: "فيديو", voice: "صوت", transcription: "تفريغ", social_publish: "نشر", analytics: "تحليلات", storage: "تخزين" };

type Provider = typeof providers[number][0];
export default function IntegrationsPage() {
  const utils = trpc.useUtils();
  const list = trpc.integrations.list.useQuery();
  const save = trpc.integrations.save.useMutation({ onSuccess: () => { utils.integrations.list.invalidate(); toast.success("تم حفظ التكامل في الخزنة المشفرة"); setForm(null); }, onError: e => toast.error(e.message) });
  const test = trpc.integrations.test.useMutation({ onSuccess: r => { utils.integrations.list.invalidate(); r.ok ? toast.success("تم الاتصال بنجاح") : toast.error(r.message); } });
  const remove = trpc.integrations.remove.useMutation({ onSuccess: () => { utils.integrations.list.invalidate(); toast.success("تم حذف التكامل"); } });
  const [form, setForm] = useState<{ id?: number; provider: Provider; label: string; capabilities: string[]; config: Record<string, string> } | null>(null);
  const start = (provider: Provider, existing?: any) => setForm({ id: existing?.id, provider, label: existing?.label ?? providers.find(p => p[0] === provider)?.[1] ?? provider, capabilities: existing?.capabilities ?? [provider === "higgsfield" ? "video" : provider === "elevenlabs" ? "voice" : provider === "instagram" || provider === "tiktok" || provider === "youtube" ? "social_publish" : provider === "telegram" ? "analytics" : provider === "pexels" ? "storage" : "text"], config: existing ? {} : Object.fromEntries((providerFields[provider] ?? ["apiKey"]).map(k => [k, ""])) });
  const selected = providers.find(p => p[0] === form?.provider);
  return <div>
    <PageHeader kicker="CONTROL PLANE · INTEGRATIONS" title="مركز التكاملات" subtitle="خزنة واحدة مشفرة لكل مزودي الذكاء والصوت والصور والفيديو ومنصات النشر. القيم السرية لا تظهر في الواجهة ولا تُعاد من الخادم." actions={<Button onClick={() => start("openai")}><Plus /> إضافة تكامل</Button>} />
    <div className="mb-6 grid gap-4 md:grid-cols-3"><div className="panel p-4"><div className="text-xs text-muted-foreground">التكاملات المسجلة</div><div className="mt-2 text-3xl font-black text-tally">{list.data?.length ?? 0}</div></div><div className="panel p-4"><div className="text-xs text-muted-foreground">متصلة</div><div className="mt-2 text-3xl font-black">{list.data?.filter(x => x.status === "connected").length ?? 0}</div></div><div className="panel p-4"><div className="text-xs text-muted-foreground">مكان الحسابات الاجتماعية</div><div className="mt-2 text-sm">حسابات Instagram الخاصة بكل شخصية تبقى في ملف الشخصية، أما مفاتيح API العامة فتدار هنا.</div></div></div>
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="panel overflow-hidden"><div className="border-b border-border p-4"><h2 className="font-semibold">الخدمات والموصلات</h2><p className="mt-1 text-xs text-muted-foreground">أضف المفتاح مرة واحدة، ثم تختاره وحدات الإنتاج عند الحاجة.</p></div>{!list.data?.length ? <EmptyBlock title="لا توجد تكاملات بعد">ابدأ بإضافة مفتاح OpenAI أو Claude أو Gemini أو Higgsfield.</EmptyBlock> : <div className="divide-y divide-border">{list.data.map(item => <div key={item.id} className="flex items-center gap-4 p-4"><div className="grid size-10 place-items-center rounded-xl bg-tally/10 text-tally"><Plug className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-semibold">{item.label}</span><Tally tone={item.status === "connected" ? "go" : "stop"} label={item.status === "connected" ? "متصل" : item.status === "error" ? "خطأ" : "معطل"} /></div><div className="mt-1 text-xs text-muted-foreground">{item.provider} · {item.configKeys.map(k => `${k}:••••`).join(" · ")}</div><div className="mt-2 flex flex-wrap gap-1">{item.capabilities.map(c => <span key={c} className="rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-muted-foreground">{capabilityLabels[c] ?? c}</span>)}</div></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => test.mutate({ id: item.id })} disabled={test.isPending}><RefreshCw className="size-3.5" /> اختبار</Button><Button size="icon-sm" variant="ghost" aria-label="حذف التكامل" onClick={() => confirm("حذف هذا التكامل ومفاتيحه؟") && remove.mutate({ id: item.id })}><Trash2 className="size-4 text-red-400" /></Button></div></div>)}</div>}</div>
      <div className="panel p-5"><h2 className="flex items-center gap-2 font-semibold"><KeyRound className="size-4 text-tally" />{form ? "إضافة خدمة" : "بنية المركز"}</h2>{!form ? <div className="mt-4 space-y-3 text-sm text-muted-foreground"><p>هذا المركز يفصل بين <b className="text-foreground">بيانات التكامل</b> وبيانات الإنتاج والشخصيات.</p><p>المفتاح يُشفّر قبل التخزين، والقائمة تعرض أسماء الحقول فقط.</p><p>اختر المزود من القائمة التالية لبدء الإعداد:</p><div className="grid gap-2">{providers.map(([id, label, desc]) => <button key={id} className="rounded-xl border border-border p-3 text-right transition hover:border-tally/50" onClick={() => start(id)}><div className="font-semibold text-foreground">{label}</div><div className="text-xs">{desc}</div></button>)}</div></div> : <form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(form as any); }}><div><Label>الخدمة</Label><div className="mt-1 rounded-lg border border-border bg-white/[.03] p-3"><div className="font-semibold">{selected?.[1]}</div><div className="text-xs text-muted-foreground">{selected?.[2]}</div></div></div><div><Label>اسم الظهور</Label><Input className="mt-1" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></div><div><Label>القدرات</Label><div className="mt-2 grid grid-cols-3 gap-2">{capabilities.map(c => <label key={c} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={form.capabilities.includes(c)} onChange={e => setForm({ ...form, capabilities: e.target.checked ? [...form.capabilities, c] : form.capabilities.filter(x => x !== c) })} />{capabilityLabels[c]}</label>)}</div></div><div><Label>المفاتيح والقيم</Label><p className="mt-1 text-[11px] text-muted-foreground">الحقول المطلوبة لكل خدمة تظهر تلقائيًا. تُحفظ مشفّرة في القاعدة ولا تُعاد للواجهة أبدًا.</p><div className="mt-2 space-y-2">{Object.entries(form.config).map(([key, value]) => <div key={key} className="flex gap-2"><Input placeholder="اسم الحقل" value={key} readOnly className="w-1/3" /><Input type="password" placeholder="القيمة السرية" value={value} onChange={e => setForm({ ...form, config: { ...form.config, [key]: e.target.value } })} /></div>)}<Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, config: { ...form.config, apiKey: form.config.apiKey ?? "" } })}><Plus className="size-3" /> apiKey</Button>{form.provider === "higgsfield" && <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, config: { ...form.config, apiSecret: form.config.apiSecret ?? "" } })}><Plus className="size-3" /> apiSecret</Button>}{form.provider === "youtube" && <><Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, config: { ...form.config, clientId: form.config.clientId ?? "" } })}><Plus className="size-3" /> clientId</Button><Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, config: { ...form.config, clientSecret: form.config.clientSecret ?? "" } })}><Plus className="size-3" /> clientSecret</Button></>}{form.provider === "custom" && <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, config: { ...form.config, testUrl: form.config.testUrl ?? "" } })}>إضافة testUrl</Button>}</div></div><div className="flex gap-2"><Button type="submit" disabled={save.isPending}><CheckCircle2 /> حفظ مشفر</Button><Button type="button" variant="ghost" onClick={() => setForm(null)}><XCircle /> إلغاء</Button></div></form>}</div>
    </div>
  </div>;
}
