import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { uploadBlob } from "@/lib/api";
import { speak } from "@/lib/tts";
import { trpc } from "@/lib/trpc";
import { CAPTION_FONTS, KOKORO_VOICES } from "@shared/domain";
import { ArrowRight, ImagePlus, Play, Save, Star, Trash2, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useParams } from "wouter";
import { PageHeader, TtsStatusBadge, type CharacterRow } from "@/components/fab/common";

type Draft = Omit<CharacterRow, "id" | "slug" | "createdAt" | "updatedAt" | "sortOrder">;

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function CharacterDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const utils = trpc.useUtils();
  const q = trpc.characters.get.useQuery({ id }, { enabled: Number.isFinite(id) });
  const social = trpc.socialAccounts.list.useQuery({ characterId: id }, { enabled: Number.isFinite(id) });
  const update = trpc.characters.update.useMutation({
    onSuccess: () => {
      utils.characters.list.invalidate();
      utils.characters.get.invalidate({ id });
      toast.success("تم حفظ الشخصية");
    },
    onError: e => toast.error(e.message),
  });
  const [d, setD] = useState<Draft | null>(null);
  const [testing, setTesting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [account, setAccount] = useState({ platform: "tiktok" as "tiktok" | "youtube", handle: "", platformUserId: "", accessToken: "", refreshToken: "", timezone: "America/New_York" });
  const connectAccount = trpc.socialAccounts.connectManual.useMutation({ onSuccess: () => { utils.socialAccounts.list.invalidate({ characterId: id }); setAccountOpen(false); setAccount(a => ({ ...a, accessToken: "", refreshToken: "" })); toast.success("تم حفظ الحساب المشفر"); }, onError: e => toast.error(e.message) });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q.data) {
      const { id: _i, slug: _s, createdAt: _c, updatedAt: _u, sortOrder: _o, ...rest } = q.data;
      setD(rest);
    }
  }, [q.data]);

  if (!d || !q.data) return <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => (prev ? { ...prev, [k]: v } : prev));
  const colors = d.colors ?? { primary: "#1B1B1F", accent: "#FFB627", text: "#FFFFFF" };
  const images = d.referenceImages ?? [];

  const save = (patch?: Partial<Draft>) => {
    const data = { ...d, ...patch };
    update.mutate({
      id,
      data: {
        name: data.name,
        nameAr: data.nameAr,
        age: data.age,
        origin: data.origin,
        niche: data.niche,
        appearancePrompt: data.appearancePrompt,
        wardrobe: data.wardrobe,
        voiceDescription: data.voiceDescription,
        style: data.style,
        catchphrase: data.catchphrase,
        contentTemplates: data.contentTemplates ?? [],
        product: data.product,
        rules: data.rules,
        loraKeyword: data.loraKeyword,
        ttsVoice: data.ttsVoice,
        ttsSpeed: data.ttsSpeed,
        externalVoiceId: data.externalVoiceId,
        colors: data.colors ?? colors,
        captionFont: data.captionFont,
        referenceImages: data.referenceImages ?? [],
        needsDesignFile: data.needsDesignFile,
        dailyQuota: data.dailyQuota,
        isActive: data.isActive,
      },
    });
  };

  const testVoice = async () => {
    setTesting(true);
    try {
      const line = d.catchphrase?.trim() || `Hi, I'm ${d.name}. Here's one idea worth fifteen seconds of your day.`;
      const out = await speak(line, d.ttsVoice, d.ttsSpeed / 100);
      const ac = new AudioContext();
      const buf = ac.createBuffer(1, out.audio.length, out.sampleRate);
      buf.copyToChannel(new Float32Array(out.audio), 0);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.onended = () => void ac.close();
      src.start();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل اختبار الصوت");
    } finally {
      setTesting(false);
    }
  };

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) {
        const r = await uploadBlob(f, { kind: "character_image", filename: f.name, characterId: id, title: `${d.name} reference` });
        urls.push(r.url);
      }
      const next = [...images, ...urls];
      set("referenceImages", next);
      save({ referenceImages: next, needsDesignFile: d.needsDesignFile && next.length === 0 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل الرفع");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <Link href="/characters" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-3.5" /> كل الشخصيات
      </Link>
      <PageHeader
        kicker={`CHR · ${q.data.slug.toUpperCase()}`}
        title={`${d.name}${d.nameAr ? ` — ${d.nameAr}` : ""}`}
        subtitle={d.niche ?? ""}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { window.location.href = `/api/meta/start?characterId=${id}`; }}>
              {social.data?.some(a => a.platform === "instagram" && a.status === "connected") ? "إعادة ربط Instagram" : "ربط Instagram"}
            </Button>
            <Button variant="outline" onClick={() => setAccountOpen(v => !v)}><Link2 /> TikTok / YouTube</Button>
            <Button onClick={() => save()} disabled={update.isPending}>
              <Save /> حفظ التعديلات
            </Button>
          </div>
        }
      />
      {accountOpen && <div className="panel mb-5 grid gap-3 p-4 md:grid-cols-3"><div><Label>المنصة</Label><Select value={account.platform} onValueChange={v => setAccount({ ...account, platform: v as "tiktok" | "youtube" })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tiktok">TikTok</SelectItem><SelectItem value="youtube">YouTube</SelectItem></SelectContent></Select></div><div><Label>اسم الحساب</Label><Input className="mt-1" value={account.handle} onChange={e => setAccount({ ...account, handle: e.target.value })} placeholder="@handle" /></div><div><Label>Platform User ID / Channel ID</Label><Input className="mt-1" dir="ltr" value={account.platformUserId} onChange={e => setAccount({ ...account, platformUserId: e.target.value })} /></div><div className="md:col-span-2"><Label>Access Token</Label><Input className="mt-1" type="password" dir="ltr" value={account.accessToken} onChange={e => setAccount({ ...account, accessToken: e.target.value })} /></div><div><Label>Refresh Token (YouTube)</Label><Input className="mt-1" type="password" dir="ltr" value={account.refreshToken} onChange={e => setAccount({ ...account, refreshToken: e.target.value })} /></div><div><Label>Timezone</Label><Input className="mt-1" dir="ltr" value={account.timezone} onChange={e => setAccount({ ...account, timezone: e.target.value })} /></div><div className="flex items-end"><Button disabled={connectAccount.isPending || account.accessToken.length < 10} onClick={() => connectAccount.mutate({ characterId: id, platform: account.platform, handle: account.handle || null, platformUserId: account.platformUserId || null, accessToken: account.accessToken, refreshToken: account.refreshToken || null, expiresAt: null, timezone: account.timezone })}>حفظ وربط الحساب</Button></div></div>}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-4">
          <div className="panel p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium">الصور المرجعية</div>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <ImagePlus /> {uploading ? "جارٍ الرفع…" : "رفع"}
              </Button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => onUpload(e.target.files)} />
            </div>
            {d.needsDesignFile && images.length === 0 && (
              <div className="mb-2 rounded-md border border-tally/40 bg-tally/10 p-2 text-xs text-tally">
                حسب ملف الشخصيات: ارفع ملف تصميم Shelly الحالي كما هو دون تغيير.
              </div>
            )}
            {images.length === 0 ? (
              <div className="flex aspect-[9/16] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">لا توجد صور</div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {images.map((u, i) => (
                  <div key={u} className="group relative overflow-hidden rounded-md border">
                    <img src={u} alt="" className="aspect-[9/16] w-full object-cover" />
                    {i === 0 && <span className="absolute right-1 top-1 rounded bg-tally px-1.5 text-[10px] font-semibold text-black">رئيسية</span>}
                    <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {i > 0 && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="اجعلها رئيسية"
                          onClick={() => {
                            const next = [u, ...images.filter(x => x !== u)];
                            set("referenceImages", next);
                            save({ referenceImages: next });
                          }}
                        >
                          <Star />
                        </Button>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="إزالة"
                        onClick={() => {
                          const next = images.filter(x => x !== u);
                          set("referenceImages", next);
                          save({ referenceImages: next });
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">الصور المتعددة تتناوب داخل الريل الاقتصادي. استخدم صورًا بنفس الوجه (من LoRA/Soul) للحفاظ على الثبات.</p>
          </div>

          <div className="panel flex flex-col gap-3 p-4">
            <div className="text-sm font-medium">الهوية البصرية</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="اللون الأساسي">
                <Input type="color" value={colors.primary} onChange={e => set("colors", { ...colors, primary: e.target.value })} className="h-9 p-1" />
              </Field>
              <Field label="لون التمييز">
                <Input type="color" value={colors.accent} onChange={e => set("colors", { ...colors, accent: e.target.value })} className="h-9 p-1" />
              </Field>
            </div>
            <Field label="خط الترجمة">
              <Select value={d.captionFont} onValueChange={v => set("captionFont", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAPTION_FONTS.map(f => (
                    <SelectItem key={f} value={f}>
                      <span style={{ fontFamily: f }}>{f}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="rounded-md p-3 text-center" style={{ background: colors.primary }}>
              <span className="font-black uppercase" style={{ fontFamily: d.captionFont, color: "#fff" }} dir="ltr">
                ONE <span style={{ color: colors.accent }}>IDEA</span> TODAY
              </span>
            </div>
          </div>

          <div className="panel flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">الإنتاج</div>
              <div className="flex items-center gap-2 text-xs">
                نشطة
                <Switch checked={d.isActive} onCheckedChange={v => set("isActive", v)} />
              </div>
            </div>
            <Field label={`الحصة اليومية: ${d.dailyQuota} ريل`}>
              <Slider value={[d.dailyQuota]} min={0} max={15} step={1} onValueChange={v => set("dailyQuota", v[0])} />
            </Field>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel grid gap-4 p-5 md:grid-cols-2">
            <Field label="الاسم (Name)">
              <Input value={d.name} onChange={e => set("name", e.target.value)} dir="ltr" />
            </Field>
            <Field label="الاسم بالعربية">
              <Input value={d.nameAr ?? ""} onChange={e => set("nameAr", e.target.value)} />
            </Field>
            <Field label="العمر">
              <Input value={d.age ?? ""} onChange={e => set("age", e.target.value)} />
            </Field>
            <Field label="الأصل">
              <Input value={d.origin ?? ""} onChange={e => set("origin", e.target.value)} />
            </Field>
            <Field label="المجال">
              <Input value={d.niche ?? ""} onChange={e => set("niche", e.target.value)} />
            </Field>
            <Field label="الأسلوب">
              <Input value={d.style ?? ""} onChange={e => set("style", e.target.value)} />
            </Field>
            <div className="md:col-span-2">
              <Field label="المظهر (بالإنجليزية — يدخل مباشرة في برومبت Higgsfield)">
                <Textarea value={d.appearancePrompt ?? ""} onChange={e => set("appearancePrompt", e.target.value)} dir="ltr" rows={3} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="الأزياء والمشاهد">
                <Textarea value={d.wardrobe ?? ""} onChange={e => set("wardrobe", e.target.value)} rows={2} />
              </Field>
            </div>
            <Field label="العبارة المميزة (Catchphrase)">
              <Input value={d.catchphrase ?? ""} onChange={e => set("catchphrase", e.target.value)} dir="ltr" />
            </Field>
            <Field label="كلمة LoRA / Soul" hint="تُضاف في بداية كل برومبت Premium لتثبيت الوجه">
              <Input value={d.loraKeyword ?? ""} onChange={e => set("loraKeyword", e.target.value)} dir="ltr" className="timecode" />
            </Field>
            <div className="md:col-span-2">
              <Field label="القوالب المميزة (افصل بسطر جديد)">
                <Textarea
                  value={(d.contentTemplates ?? []).join("\n")}
                  onChange={e => set("contentTemplates", e.target.value.split("\n").map(s => s.trim()).filter(Boolean))}
                  rows={3}
                />
              </Field>
            </div>
            <Field label="المنتج">
              <Textarea value={d.product ?? ""} onChange={e => set("product", e.target.value)} rows={2} />
            </Field>
            <Field label="ملاحظات وقيود">
              <Textarea value={d.rules ?? ""} onChange={e => set("rules", e.target.value)} rows={2} />
            </Field>
          </div>

          <div className="panel grid gap-4 p-5 md:grid-cols-2">
            <div className="flex items-center justify-between md:col-span-2">
              <div className="text-sm font-medium">الصوت</div>
              <TtsStatusBadge />
            </div>
            <Field label="وصف الصوت (من ملف الشخصيات)">
              <Input value={d.voiceDescription ?? ""} onChange={e => set("voiceDescription", e.target.value)} />
            </Field>
            <Field label="معرّف الصوت النهائي (ElevenLabs / Higgsfield)" hint="يُحدد بعد اختبارات الصوت ويُذكر في برومبت Premium">
              <Input value={d.externalVoiceId ?? ""} onChange={e => set("externalVoiceId", e.target.value)} dir="ltr" className="timecode" />
            </Field>
            <Field label="الصوت المجاني (Kokoro) للمسار الاقتصادي">
              <Select value={d.ttsVoice} onValueChange={v => set("ttsVoice", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KOKORO_VOICES.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={`السرعة: ${(d.ttsSpeed / 100).toFixed(2)}×`}>
              <Slider value={[d.ttsSpeed]} min={75} max={130} step={1} onValueChange={v => set("ttsSpeed", v[0])} />
            </Field>
            <div className="md:col-span-2">
              <Button variant="secondary" onClick={testVoice} disabled={testing}>
                <Play /> {testing ? "جارٍ التوليد… (أول مرة يحمّل النموذج ~90MB)" : "اختبار الصوت بالعبارة المميزة"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
