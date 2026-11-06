import { EmptyBlock, PageHeader, Tally, type RouterOutputs } from "@/components/fab/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { KOKORO_VOICES } from "@shared/domain";
import {
  EPISODE_STATUS_LABELS,
  GEMINI_VOICES,
  VISUAL_STYLES,
  VISUAL_STYLE_LABELS,
  episodeTimeline,
  newSceneId,
  timestamp,
  type EpisodeScript,
  type EpisodeStatus,
  type Scene,
} from "@shared/episodes";
import { ArrowDown, ArrowUp, Check, Copy, Download, ExternalLink, Film, Image as ImageIcon, Mic, Plus, RefreshCw, Save, Search, Settings2, Sparkles, Trash2, Tv, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useRoute } from "wouter";

type ChannelRow = RouterOutputs["videos"]["channels"][number];
type EpisodeListRow = RouterOutputs["videos"]["episodes"][number];
type EpisodeFull = RouterOutputs["videos"]["episode"];
type Media = RouterOutputs["videos"]["media"][number];

const STATUS_TONE: Record<EpisodeStatus, "go" | "hold" | "stop" | "idle"> = {
  planned: "idle",
  script_ready: "go",
  needs_review: "hold",
  rendering: "hold",
  rendered: "go",
  failed: "stop",
  published: "go",
};
const LANG_LABEL = { ar: "عربي", en: "English" } as const;
const fmtMin = (ms?: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}` : "—");

/* ------------------------------------------------------------- overview */

export default function VideosPage() {
  const channels = trpc.videos.channels.useQuery();
  const episodes = trpc.videos.episodes.useQuery(undefined, { refetchInterval: 8000 });
  const rows = channels.data ?? [];
  return (
    <div>
      <PageHeader
        title="الفيديوهات الكاملة"
        subtitle="عشر قنوات يوتيوب بإنتاج مجاني بالكامل: سكربت مشاهد من نموذج مجاني، تعليق صوتي محلي أو من الخطة المجانية، لقطات مجانية تُراجعها بنفسك، ثم رندر 1080p على جهازك بالفصول والترجمة."
      />
      {channels.isLoading ? (
        <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {rows.map(c => <ChannelCard key={c.id} c={c} />)}
        </div>
      )}
      <h2 className="mb-3 mt-10 text-lg font-semibold">آخر الحلقات</h2>
      <EpisodeList rows={episodes.data ?? []} loading={episodes.isLoading} showChannel />
    </div>
  );
}

function ChannelCard({ c }: { c: ChannelRow }) {
  const total = Object.values(c.stats).reduce((a, b) => a + b, 0);
  return (
    <Link href={`/videos/channel/${c.id}`} className="panel group flex flex-col gap-3 p-4 transition-colors hover:border-tally/40">
      <div className="flex items-start justify-between gap-2">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl text-lg font-extrabold" style={{ background: c.colors.primary, color: c.colors.accent }}>
          <Tv className="size-5" />
        </div>
        <div className="flex gap-1.5">
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{LANG_LABEL[c.language]}</span>
          {c.madeForKids && <span className="rounded-full bg-hold/15 px-2 py-0.5 text-[11px] text-hold">للأطفال</span>}
          {!c.isActive && <span className="rounded-full bg-stop/15 px-2 py-0.5 text-[11px] text-stop">متوقفة</span>}
        </div>
      </div>
      <div>
        <div className="text-[17px] font-bold leading-tight">{c.name}</div>
        <div className="mt-1 line-clamp-2 text-[12.5px] text-muted-foreground">{c.niche}</div>
      </div>
      <div className="mt-auto flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{VISUAL_STYLE_LABELS[c.visualStyle]} · {c.episodeTemplate.minutes} د</span>
        <span className="num">{total} حلقة{c.stats.rendered ? ` · ${c.stats.rendered} مُصدَّرة` : ""}</span>
      </div>
    </Link>
  );
}

function EpisodeList({ rows, loading, showChannel }: { rows: EpisodeListRow[]; loading: boolean; showChannel?: boolean }) {
  if (loading) return <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>;
  if (!rows.length) return <EmptyBlock title="لا توجد حلقات بعد">افتح قناة واضغط «حلقة جديدة»: اختر موضوعًا من بنك المواضيع أو اكتب موضوعك.</EmptyBlock>;
  return (
    <div className="panel divide-y divide-border">
      {rows.map(e => (
        <Link key={e.id} href={`/videos/episode/${e.id}`} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[.03]">
          <div className="h-12 w-[84px] shrink-0 overflow-hidden rounded-lg bg-black">
            {e.thumbnailUrl ? <img src={e.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="grid h-full place-items-center text-muted-foreground"><Film className="size-4" /></div>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{e.title || e.topic}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              {showChannel && <span>{e.channelName}</span>}
              <span className="num">{e.scenes} مشهد</span>
              {e.durationMs ? <span className="num">{fmtMin(e.durationMs)}</span> : null}
            </div>
          </div>
          <Tally tone={STATUS_TONE[e.status]} live={e.status === "rendering"} label={EPISODE_STATUS_LABELS[e.status]} />
        </Link>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- channel */

export function ChannelPage() {
  const [, params] = useRoute("/videos/channel/:id");
  const id = Number(params?.id);
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const q = trpc.videos.channel.useQuery({ id }, { enabled: Number.isFinite(id), refetchInterval: 8000 });
  const media = trpc.videos.media.useQuery();
  const [topic, setTopic] = useState("");
  const [settings, setSettings] = useState(false);
  const create = trpc.videos.createEpisode.useMutation({
    onSuccess: r => { utils.videos.channel.invalidate({ id }); navigate(`/videos/episode/${r.id}`); },
    onError: e => toast.error(e.message),
  });
  if (q.isLoading || !q.data) return <div className="text-sm text-muted-foreground">{q.error ? q.error.message : "جارٍ التحميل…"}</div>;
  const c = q.data;
  const voiceLabel = c.ttsProvider === "kokoro" ? KOKORO_VOICES.find(v => v.id === c.voice)?.label ?? c.voice : GEMINI_VOICES.find(v => v.id === c.voice)?.label ?? c.voice;
  return (
    <div>
      <Link href="/videos" className="text-xs text-muted-foreground hover:text-foreground">← كل القنوات</Link>
      <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="display-xl text-[30px] md:text-[44px]">{c.name}</h1>
          <p className="mt-2 max-w-[70ch] text-sm text-muted-foreground">{c.description || c.niche}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11.5px] text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-0.5">{LANG_LABEL[c.language]}</span>
            <span className="rounded-full border border-border px-2 py-0.5">الصوت: {voiceLabel}</span>
            <span className="rounded-full border border-border px-2 py-0.5">{VISUAL_STYLE_LABELS[c.visualStyle]}</span>
            <span className="rounded-full border border-border px-2 py-0.5">{c.episodeTemplate.minutes} دقيقة · {c.episodeTemplate.structure.length} أقسام</span>
            {c.madeForKids && <span className="rounded-full bg-hold/15 px-2 py-0.5 text-hold">مخصص للأطفال</span>}
          </div>
        </div>
        {user?.role === "admin" && (
          <Button variant="outline" onClick={() => setSettings(s => !s)}><Settings2 /> إعدادات القناة</Button>
        )}
      </div>

      {settings && <ChannelSettings c={c} media={media.data ?? []} onSaved={() => { setSettings(false); utils.videos.channel.invalidate({ id }); utils.videos.channels.invalidate(); }} />}

      <section className="panel mt-6 p-4">
        <h2 className="font-semibold">حلقة جديدة</h2>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={e => { e.preventDefault(); if (topic.trim().length >= 3) create.mutate({ channelId: c.id, topic: topic.trim() }); }}
        >
          <Input value={topic} onChange={e => setTopic(e.target.value)} placeholder="موضوع الحلقة (سؤال واحد كبير يجيب عنه الفيديو)" aria-label="موضوع الحلقة" />
          <Button type="submit" disabled={create.isPending || topic.trim().length < 3}><Plus /> أنشئ الحلقة</Button>
        </form>
        {c.topicsBank.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {c.topicsBank.map(t => (
              <button key={t} type="button" onClick={() => setTopic(t)} className={cn("rounded-full border px-2.5 py-1 text-[12px] transition-colors", topic === t ? "border-tally text-foreground" : "border-border text-muted-foreground hover:border-foreground/40")}>
                {t}
              </button>
            ))}
          </div>
        )}
      </section>

      <h2 className="mb-3 mt-8 text-lg font-semibold">حلقات القناة</h2>
      <EpisodeList rows={c.episodes} loading={false} />
    </div>
  );
}

function ChannelSettings({ c, media, onSaved }: { c: RouterOutputs["videos"]["channel"]; media: Media[]; onSaved: () => void }) {
  const [f, setF] = useState({
    name: c.name,
    niche: c.niche,
    description: c.description,
    language: c.language,
    ttsProvider: c.ttsProvider,
    voice: c.voice,
    ttsSpeed: c.ttsSpeed,
    visualStyle: c.visualStyle,
    minutes: c.episodeTemplate.minutes,
    structure: c.episodeTemplate.structure.join("، "),
    hookSeconds: c.episodeTemplate.hookSeconds,
    cta: c.episodeTemplate.cta,
    guidelines: c.guidelines,
    topics: c.topicsBank.join("\n"),
    musicAssetId: c.musicAssetId,
    madeForKids: c.madeForKids,
    isActive: c.isActive,
  });
  const update = trpc.videos.updateChannel.useMutation({ onSuccess: () => { toast.success("حُفظت إعدادات القناة"); onSaved(); }, onError: e => toast.error(e.message) });
  const voices = f.ttsProvider === "kokoro" ? KOKORO_VOICES.map(v => ({ id: v.id, label: v.label })) : GEMINI_VOICES.map(v => ({ id: v.id, label: v.label }));
  const music = media.filter(m => m.kind === "music");
  return (
    <form
      className="panel mt-5 grid gap-4 p-4 md:grid-cols-2"
      onSubmit={e => {
        e.preventDefault();
        update.mutate({
          id: c.id,
          patch: {
            name: f.name, niche: f.niche, description: f.description, language: f.language, ttsProvider: f.ttsProvider, voice: f.voice, ttsSpeed: Number(f.ttsSpeed),
            visualStyle: f.visualStyle,
            episodeTemplate: { minutes: Number(f.minutes), structure: f.structure.split(/[،,\n]/).map(x => x.trim()).filter(Boolean), hookSeconds: Number(f.hookSeconds), cta: f.cta },
            guidelines: f.guidelines, topicsBank: f.topics.split("\n").map(x => x.trim()).filter(Boolean), musicAssetId: f.musicAssetId ?? null, madeForKids: f.madeForKids, isActive: f.isActive,
            colors: c.colors,
          },
        });
      }}
    >
      <div className="flex flex-col gap-1.5"><Label>اسم القناة</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
      <div className="flex flex-col gap-1.5"><Label>الزاوية</Label><Input value={f.niche} onChange={e => setF({ ...f, niche: e.target.value })} /></div>
      <div className="flex flex-col gap-1.5 md:col-span-2"><Label>الوصف</Label><Textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div>
      <div className="flex flex-col gap-1.5">
        <Label>اللغة</Label>
        <Select value={f.language} onValueChange={v => setF({ ...f, language: v as "ar" | "en", ttsProvider: v === "ar" ? "gemini" : "kokoro", voice: v === "ar" ? "Charon" : "af_heart" })}>
          <SelectTrigger aria-label="اللغة"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ar">عربي</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>محرّك الصوت</Label>
        <Select value={f.ttsProvider} onValueChange={v => setF({ ...f, ttsProvider: v as "kokoro" | "gemini", voice: v === "kokoro" ? "af_heart" : "Charon" })}>
          <SelectTrigger aria-label="محرّك الصوت"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="kokoro">Kokoro — محلي مجاني (إنجليزي)</SelectItem><SelectItem value="gemini">Gemini TTS — الخطة المجانية (عربي وغيره)</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>الصوت</Label>
        <Select value={f.voice} onValueChange={v => setF({ ...f, voice: v })}>
          <SelectTrigger aria-label="الصوت"><SelectValue /></SelectTrigger>
          <SelectContent>{voices.map(v => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5"><Label>سرعة الصوت %</Label><Input type="number" min={70} max={130} value={f.ttsSpeed} onChange={e => setF({ ...f, ttsSpeed: Number(e.target.value) })} /></div>
      <div className="flex flex-col gap-1.5">
        <Label>الأسلوب البصري</Label>
        <Select value={f.visualStyle} onValueChange={v => setF({ ...f, visualStyle: v as (typeof VISUAL_STYLES)[number] })}>
          <SelectTrigger aria-label="الأسلوب البصري"><SelectValue /></SelectTrigger>
          <SelectContent>{VISUAL_STYLES.map(k => <SelectItem key={k} value={k}>{VISUAL_STYLE_LABELS[k]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>موسيقى الخلفية</Label>
        <Select value={f.musicAssetId ? String(f.musicAssetId) : "none"} onValueChange={v => setF({ ...f, musicAssetId: v === "none" ? null : Number(v) })}>
          <SelectTrigger aria-label="موسيقى الخلفية"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">بدون موسيقى</SelectItem>{music.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.title ?? `#${m.id}`}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5"><Label>مدة الحلقة (دقائق)</Label><Input type="number" min={2} max={25} value={f.minutes} onChange={e => setF({ ...f, minutes: Number(e.target.value) })} /></div>
      <div className="flex flex-col gap-1.5"><Label>ثواني الخطاف</Label><Input type="number" min={5} max={40} value={f.hookSeconds} onChange={e => setF({ ...f, hookSeconds: Number(e.target.value) })} /></div>
      <div className="flex flex-col gap-1.5 md:col-span-2"><Label>أقسام الحلقة بالترتيب (مفصولة بفواصل)</Label><Input value={f.structure} onChange={e => setF({ ...f, structure: e.target.value })} /></div>
      <div className="flex flex-col gap-1.5 md:col-span-2"><Label>دعوة النهاية</Label><Input value={f.cta} onChange={e => setF({ ...f, cta: e.target.value })} /></div>
      <div className="flex flex-col gap-1.5 md:col-span-2"><Label>الخط التحريري (قواعد كتابة السكربت)</Label><Textarea rows={3} value={f.guidelines} onChange={e => setF({ ...f, guidelines: e.target.value })} /></div>
      <div className="flex flex-col gap-1.5 md:col-span-2"><Label>بنك المواضيع (موضوع في كل سطر)</Label><Textarea rows={4} value={f.topics} onChange={e => setF({ ...f, topics: e.target.value })} /></div>
      <label className="flex items-center justify-between gap-3 text-sm"><span>محتوى مخصص للأطفال</span><Switch checked={f.madeForKids} onCheckedChange={v => setF({ ...f, madeForKids: v })} aria-label="مخصص للأطفال" /></label>
      <label className="flex items-center justify-between gap-3 text-sm"><span>القناة نشطة</span><Switch checked={f.isActive} onCheckedChange={v => setF({ ...f, isActive: v })} aria-label="القناة نشطة" /></label>
      <div className="md:col-span-2"><Button type="submit" disabled={update.isPending}><Save /> حفظ إعدادات القناة</Button></div>
    </form>
  );
}

/* --------------------------------------------------------------- episode */

export function EpisodePage() {
  const [, params] = useRoute("/videos/episode/:id");
  const id = Number(params?.id);
  const utils = trpc.useUtils();
  const q = trpc.videos.episode.useQuery({ id }, { enabled: Number.isFinite(id), refetchInterval: d => (d.state.data?.status === "rendering" ? 4000 : false) });
  const media = trpc.videos.media.useQuery();
  const [script, setScript] = useState<EpisodeScript | null>(null);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const loadedFor = useRef<string>("");

  useEffect(() => {
    if (!q.data) return;
    const stamp = `${q.data.id}:${q.data.updatedAt}`;
    if (loadedFor.current === stamp || (dirty && loadedFor.current.startsWith(`${q.data.id}:`))) return;
    loadedFor.current = stamp;
    setScript(q.data.script);
    setDirty(false);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => { utils.videos.episode.invalidate({ id }); utils.videos.episodes.invalidate(); };
  const onErr = (e: { message: string }) => toast.error(e.message);
  const generate = trpc.videos.generateScript.useMutation({ onSuccess: r => { toast.success(`السكربت جاهز: ${r.scenes} مشهد`); setDirty(false); loadedFor.current = ""; invalidate(); }, onError: onErr });
  const prepare = trpc.videos.prepare.useMutation({ onSuccess: r => { toast.success(`جُهّز الصوت (${r.synthesized} مشهد جديد) واللقطات (${r.picked} مختارة${r.missing ? `، ${r.missing} بلا لقطة` : ""})`); setDirty(false); loadedFor.current = ""; invalidate(); }, onError: onErr });
  const replan = trpc.videos.planVisuals.useMutation({ onSuccess: r => { toast.success(`اختيار جديد للقطات: ${r.picked}`); setDirty(false); loadedFor.current = ""; invalidate(); }, onError: onErr });
  const update = trpc.videos.updateScript.useMutation({ onError: onErr });
  const render = trpc.videos.render.useMutation({ onSuccess: r => { toast.success(r.already ? "الرندر قيد التنفيذ بالفعل" : "بدأ الرندر — قد يستغرق دقائق حسب طول الحلقة"); invalidate(); }, onError: onErr });
  const setVisual = trpc.videos.setSceneVisual.useMutation({ onSuccess: () => { loadedFor.current = ""; invalidate(); }, onError: onErr });
  const markPublished = trpc.videos.markPublished.useMutation({ onSuccess: () => { toast.success("حُدّثت حالة النشر"); invalidate(); }, onError: onErr });

  const save = async () => {
    if (!script) return false;
    const r = await update.mutateAsync({ id, script }).catch(() => null);
    if (!r) return false;
    setDirty(false);
    loadedFor.current = "";
    invalidate();
    if (r.problems.length) toast.message(r.problems[0]);
    return true;
  };
  const edit = (fn: (s: EpisodeScript) => EpisodeScript) => { setScript(s => (s ? fn(s) : s)); setDirty(true); };

  if (q.isLoading || !q.data) return <div className="text-sm text-muted-foreground">{q.error ? q.error.message : "جارٍ التحميل…"}</div>;
  const e = q.data;
  const busy = e.status === "rendering" && e.job?.status !== "queued";
  const working = generate.isPending || prepare.isPending || replan.isPending;
  const tl = script ? episodeTimeline(script.scenes) : null;
  const problems = script ? e.problems : ["لا يوجد سكربت بعد — ولّد السكربت أولًا"];
  const canRender = !!script && problems.length === 0 && !busy && !working;
  const copy = (text: string, msg: string) => navigator.clipboard?.writeText(text).then(() => toast.success(msg)).catch(() => toast.error("تعذر النسخ"));

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <Link href={`/videos/channel/${e.channelId}`} className="text-xs text-muted-foreground hover:text-foreground">← {e.channel.name}</Link>
          <h1 className="display-xl mt-1 text-[26px] md:text-[36px]">{script?.title || e.title || e.topic}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Tally tone={STATUS_TONE[e.status]} live={busy} label={e.job?.status === "queued" && e.status === "rendering" ? "في طابور الرندر" : EPISODE_STATUS_LABELS[e.status]} />
            <span>{LANG_LABEL[e.channel.language]}</span>
            {tl && <span className="num">{script!.scenes.length} مشهد · {timestamp(tl.total)}</span>}
            {dirty && <span className="text-hold">تعديلات غير محفوظة</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant={script ? "outline" : "default"} onClick={() => generate.mutate({ id })} disabled={working || busy}>
            {generate.isPending ? <RefreshCw className="animate-spin" /> : <Sparkles />} {script ? "أعد توليد السكربت" : "ولّد السكربت"}
          </Button>
          <Button variant={script && problems.length ? "default" : "outline"} onClick={async () => { if (dirty && !(await save())) return; prepare.mutate({ id }); }} disabled={!script || working || busy}>
            {prepare.isPending ? <RefreshCw className="animate-spin" /> : <Mic />} {prepare.isPending ? "جارٍ التجهيز…" : "جهّز الصوت واللقطات"}
          </Button>
          <Button variant="outline" onClick={save} disabled={!dirty || update.isPending}><Save /> حفظ</Button>
          <Button onClick={async () => { if (dirty && !(await save())) return; render.mutate({ id }); }} disabled={!canRender || render.isPending}>
            <Wand2 /> {busy ? "الرندر جارٍ…" : e.job?.status === "queued" && e.status === "rendering" ? "شغّل الرندر الآن" : "رندر الحلقة"}
          </Button>
        </div>
      </div>

      {e.error && <div className="mt-4 rounded-xl border border-stop/40 bg-stop/10 p-3 text-sm text-stop">{e.error}</div>}
      {problems.length > 0 && script && <div className="mt-4 rounded-xl border border-hold/40 bg-hold/10 p-3 text-sm text-hold">{problems.join(" · ")}</div>}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0">
          {!script ? (
            <EmptyBlock title="الخطوة الأولى: السكربت" action={<Button onClick={() => generate.mutate({ id })} disabled={generate.isPending}><Sparkles /> ولّد السكربت</Button>}>
              يكتب النموذج المجاني سكربتًا مشهدًا بمشهد بالخط التحريري للقناة: تعليق، عنوان على الشاشة، كلمات بحث للقطات، وفصول. بعدها تراجع كل مشهد وتغيّر ما تريد.
            </EmptyBlock>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">المشاهد</h2>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={async () => { if (dirty && !(await save())) return; replan.mutate({ id, onlyMissing: false }); }} disabled={working || busy}><RefreshCw /> اختيار تلقائي جديد للقطات</Button>
                  <Button size="sm" variant="outline" onClick={() => edit(s => ({ ...s, scenes: [...s.scenes, { id: newSceneId(), narration: "", keywords: [] }] }))} disabled={busy}><Plus /> مشهد</Button>
                </div>
              </div>
              {script.scenes.map((sc, i) => (
                <SceneCard
                  key={sc.id}
                  scene={sc}
                  index={i}
                  start={tl?.starts[i] ?? 0}
                  count={script.scenes.length}
                  language={e.channel.language}
                  disabled={busy}
                  onChange={next => edit(s => ({ ...s, scenes: s.scenes.map(x => (x.id === next.id ? next : x)) }))}
                  onMove={dir => edit(s => { const j = i + dir; if (j < 0 || j >= s.scenes.length) return s; const arr = [...s.scenes]; [arr[i], arr[j]] = [arr[j], arr[i]]; return { ...s, scenes: arr }; })}
                  onRemove={() => edit(s => ({ ...s, scenes: s.scenes.filter(x => x.id !== sc.id) }))}
                  onPick={() => setPicker(sc.id)}
                  onClearVisual={() => setVisual.mutate({ id, sceneId: sc.id, visual: null })}
                />
              ))}
              <div className="panel p-4 text-sm">
                <Label>الخاتمة (دعوة الاشتراك)</Label>
                <Input className="mt-1.5" value={script.outro} onChange={ev => edit(s => ({ ...s, outro: ev.target.value }))} disabled={busy} />
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold">النتيجة</h3>
            {e.videoUrl ? (
              <>
                <video key={e.videoUrl} src={e.videoUrl} poster={e.thumbnailUrl ?? undefined} controls playsInline preload="none" className="mt-3 aspect-video w-full rounded-xl bg-black" />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="secondary"><a href={e.videoUrl} download><Download /> تنزيل MP4</a></Button>
                  {e.thumbnailUrl && <Button asChild size="sm" variant="outline"><a href={e.thumbnailUrl} download><ImageIcon /> المصغّرة</a></Button>}
                </div>
                <div className="num mt-2 text-xs text-muted-foreground">{fmtMin(e.durationMs)} · 1920×1080</div>
              </>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{busy ? "الرندر جارٍ على الخادم: مشهد بمشهد ثم الدمج والترجمة والصوت. الصفحة تتحدث تلقائيًا." : "بعد تجهيز الصوت واللقطات اضغط «رندر الحلقة»."}</p>
            )}
          </div>
          {e.chaptersText && (
            <div className="panel p-4">
              <div className="flex items-center justify-between"><h3 className="font-semibold">الفصول (للوصف)</h3><Button size="sm" variant="ghost" onClick={() => copy(e.chaptersText!, "نُسخت الفصول")}><Copy /></Button></div>
              <pre dir="ltr" className="mt-2 whitespace-pre-wrap text-left font-mono text-[11px] text-muted-foreground">{e.chaptersText}</pre>
            </div>
          )}
          {script && (
            <div className="panel p-4 text-sm">
              <div className="flex items-center justify-between"><h3 className="font-semibold">الوصف والوسوم</h3><Button size="sm" variant="ghost" onClick={() => copy(`${script.description}\n\n${e.chaptersText ?? ""}\n\n${script.tags.map(t => `#${t}`).join(" ")}`, "نُسخ الوصف")}><Copy /></Button></div>
              <Textarea className="mt-2" rows={5} value={script.description} onChange={ev => edit(s => ({ ...s, description: ev.target.value }))} disabled={busy} />
              <Input className="mt-2" dir="ltr" value={script.tags.join(", ")} onChange={ev => edit(s => ({ ...s, tags: ev.target.value.split(",").map(x => x.trim()).filter(Boolean) }))} disabled={busy} aria-label="الوسوم" />
            </div>
          )}
          {e.videoUrl && (
            <div className="panel p-4 text-sm">
              <h3 className="font-semibold">النشر</h3>
              <p className="mt-1 text-xs text-muted-foreground">ارفع الملف إلى يوتيوب مع الوصف والفصول، وفعّل وسم «استخدام AI» إن احتوت الحلقة مشاهد واقعية مولَّدة، ثم ضع رابط الفيديو هنا.</p>
              <PublishForm current={e.publishedUrl} onSave={url => markPublished.mutate({ id, url })} />
            </div>
          )}
        </aside>
      </div>

      {picker && script && (
        <VisualPicker
          sceneKeywords={script.scenes.find(s => s.id === picker)?.keywords ?? []}
          media={media.data ?? []}
          onClose={() => setPicker(null)}
          onChoose={v => { setVisual.mutate({ id, sceneId: picker, visual: v }); setPicker(null); media.refetch(); }}
        />
      )}
    </div>
  );
}

function PublishForm({ current, onSave }: { current: string | null; onSave: (url: string | null) => void }) {
  const [url, setUrl] = useState(current ?? "");
  return (
    <form className="mt-2 flex gap-2" onSubmit={ev => { ev.preventDefault(); onSave(url.trim() || null); }}>
      <Input dir="ltr" value={url} onChange={ev => setUrl(ev.target.value)} placeholder="https://youtu.be/…" aria-label="رابط الفيديو المنشور" />
      <Button type="submit" size="sm" variant="secondary"><Check /> {url.trim() ? "تم النشر" : "إلغاء"}</Button>
      {current && <Button asChild size="sm" variant="ghost"><a href={current} target="_blank" rel="noreferrer"><ExternalLink /></a></Button>}
    </form>
  );
}

function SceneCard({ scene, index, start, count, language, disabled, onChange, onMove, onRemove, onPick, onClearVisual }: {
  scene: Scene; index: number; start: number; count: number; language: "ar" | "en"; disabled: boolean;
  onChange: (s: Scene) => void; onMove: (d: -1 | 1) => void; onRemove: () => void; onPick: () => void; onClearVisual: () => void;
}) {
  const v = scene.visual;
  return (
    <div className={cn("panel grid gap-3 p-3 md:grid-cols-[200px_minmax(0,1fr)]", !v && "border-hold/40")}>
      <div>
        <button type="button" onClick={onPick} disabled={disabled} className="relative block aspect-video w-full overflow-hidden rounded-lg border border-border bg-black text-left hover:border-tally" aria-label={`لقطة المشهد ${index + 1}`}>
          {v ? (
            v.kind === "video" ? <video src={`${v.src}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <img src={v.src} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="grid h-full place-items-center text-xs text-hold">بلا لقطة — اضغط للاختيار</div>
          )}
          {v && <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{v.kind === "video" ? "فيديو" : "صورة"}{v.auto ? " · تلقائي" : ""}</span>}
        </button>
        {v?.credit && <div dir="ltr" className="mt-1 truncate text-left text-[10px] text-muted-foreground" title={v.credit}>{v.credit}</div>}
        <div className="mt-1.5 flex gap-1">
          <Button size="sm" variant="outline" onClick={onPick} disabled={disabled}><Search /> تغيير</Button>
          {v && <Button size="sm" variant="ghost" onClick={onClearVisual} disabled={disabled} aria-label="إزالة اللقطة"><Trash2 /></Button>}
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="num font-semibold text-foreground">{index + 1}</span>
          <span className="num">{timestamp(start)}</span>
          {scene.durationSec ? <span className="num">{scene.durationSec.toFixed(1)}s صوت</span> : <span className="text-hold">الصوت لم يُجهَّز</span>}
          {scene.chapter && <span className="rounded-full bg-tally/10 px-2 py-0.5 text-tally">{scene.chapter}</span>}
          <span className="mr-auto flex gap-0.5">
            <Button size="icon-sm" variant="ghost" onClick={() => onMove(-1)} disabled={disabled || index === 0} aria-label="تقديم المشهد"><ArrowUp /></Button>
            <Button size="icon-sm" variant="ghost" onClick={() => onMove(1)} disabled={disabled || index === count - 1} aria-label="تأخير المشهد"><ArrowDown /></Button>
            <Button size="icon-sm" variant="ghost" onClick={onRemove} disabled={disabled || count <= 1} aria-label="حذف المشهد"><Trash2 /></Button>
          </span>
        </div>
        <Textarea rows={2} value={scene.narration} onChange={ev => onChange({ ...scene, narration: ev.target.value })} disabled={disabled} dir={language === "ar" ? "rtl" : "ltr"} aria-label={`تعليق المشهد ${index + 1}`} className="text-[14px] leading-relaxed" />
        <div className="grid gap-2 sm:grid-cols-3">
          <Input value={scene.title ?? ""} onChange={ev => onChange({ ...scene, title: ev.target.value || undefined })} placeholder="عنوان على الشاشة" disabled={disabled} aria-label="عنوان على الشاشة" />
          <Input value={scene.chapter ?? ""} onChange={ev => onChange({ ...scene, chapter: ev.target.value || undefined })} placeholder="الفصل" disabled={disabled} aria-label="الفصل" />
          <Input dir="ltr" value={scene.keywords.join(", ")} onChange={ev => onChange({ ...scene, keywords: ev.target.value.split(",").map(x => x.trim()).filter(Boolean).slice(0, 8) })} placeholder="stock keywords" disabled={disabled} aria-label="كلمات البحث" />
        </div>
      </div>
    </div>
  );
}

function VisualPicker({ sceneKeywords, media, onClose, onChoose }: { sceneKeywords: string[]; media: Media[]; onClose: () => void; onChoose: (v: NonNullable<Scene["visual"]>) => void }) {
  const [tab, setTab] = useState<"stock" | "library">("stock");
  const [kind, setKind] = useState<"video" | "photo">("video");
  const [query, setQuery] = useState(sceneKeywords.slice(0, 3).join(" "));
  const [submitted, setSubmitted] = useState(sceneKeywords.slice(0, 3).join(" "));
  const search = trpc.videos.stockSearch.useQuery({ query: submitted, kind, page: 1 }, { enabled: tab === "stock" && submitted.length > 0, retry: false });
  const importStock = trpc.videos.stockImport.useMutation({
    onSuccess: a => onChoose({ kind: a.kind, src: a.url, assetId: a.id, credit: a.credit ?? undefined, in: 0, motion: a.kind === "image" ? "slow_push" : undefined }),
    onError: e => toast.error(e.message),
  });
  const visual = useMemo(() => media.filter(m => m.kind !== "music"), [media]);
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>لقطة المشهد</DialogTitle>
          <DialogDescription>لقطات مجانية من Pexels (تُحفظ في مكتبتك مع اسم المصوّر) أو ملفات مكتبتك.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1.5">
          <Button size="sm" variant={tab === "stock" ? "secondary" : "outline"} onClick={() => setTab("stock")}><Search /> Pexels مجاني</Button>
          <Button size="sm" variant={tab === "library" ? "secondary" : "outline"} onClick={() => setTab("library")}>المكتبة</Button>
        </div>
        {tab === "stock" ? (
          <>
            <form className="flex gap-1.5" onSubmit={ev => { ev.preventDefault(); setSubmitted(query.trim()); }}>
              <Select value={kind} onValueChange={v => setKind(v as "video" | "photo")}>
                <SelectTrigger className="w-32" aria-label="نوع اللقطة"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="video">فيديو</SelectItem><SelectItem value="photo">صورة</SelectItem></SelectContent>
              </Select>
              <Input dir="ltr" value={query} onChange={ev => setQuery(ev.target.value)} placeholder="english keywords" aria-label="بحث اللقطات" />
              <Button type="submit" size="sm" disabled={!query.trim() || search.isFetching}><Search /></Button>
            </form>
            {search.error && <p className="text-xs text-stop">{search.error.message}</p>}
            {search.isFetching && <p className="text-xs text-muted-foreground">جارٍ البحث…</p>}
            <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
              {search.data?.items.map(it => (
                <button key={it.id} type="button" disabled={importStock.isPending} onClick={() => importStock.mutate(search.data!.kind === "video" ? { query: submitted, video: it as never } : { query: submitted, photo: it as never })} className="group relative aspect-video overflow-hidden rounded-lg border border-border bg-black hover:border-tally disabled:opacity-60" aria-label={`إضافة لقطة ${it.id}`}>
                  <img src={it.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1 text-[9px] text-white">
                    <div dir="ltr" className="truncate">{"durationSec" in it ? `${it.durationSec.toFixed(0)}s · ` : ""}{it.credit}</div>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground"><a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="text-tally">Videos and photos provided by Pexels</a></p>
          </>
        ) : (
          <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
            {visual.length === 0 && <p className="col-span-full text-xs text-muted-foreground">المكتبة فارغة من اللقطات.</p>}
            {visual.map(a => {
              const isVideo = a.kind === "broll" || a.kind === "premium_video" || a.kind === "render";
              return (
                <button key={a.id} type="button" onClick={() => onChoose(isVideo ? { kind: "video", src: a.url, assetId: a.id, credit: a.credit ?? undefined, in: 0 } : { kind: "image", src: a.url, assetId: a.id, credit: a.credit ?? undefined, motion: "slow_push" })} className="group relative aspect-video overflow-hidden rounded-lg border border-border bg-black hover:border-tally" aria-label={`اختيار ${a.title ?? a.kind}`}>
                  {isVideo ? <video src={`${a.url}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <img src={a.url} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1 text-[9px] text-white"><div className="truncate">{a.title ?? a.kind}</div></div>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

