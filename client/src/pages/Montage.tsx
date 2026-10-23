import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  CAPTION_POSITIONS,
  CAPTION_STYLE_LABELS,
  CAPTION_STYLES,
  MONTAGE_MOTIONS,
  MONTAGE_TRANSITIONS,
  MOTION_LABELS,
  TRANSITION_LABELS,
  VOICE_SOURCE_LABELS,
  VOICE_SOURCES,
  montageProblems,
  montageTimeline,
  newSegmentId,
  segmentDuration,
  type MontageSegment,
  type MontageSpec,
} from "@shared/montage";
import { ArrowLeft, ArrowRight, Clapperboard, Copy, Film, Image as ImageIcon, Music, Play, Plus, RefreshCw, Save, Scissors, Search, ShieldCheck, Trash2, Volume2, VolumeX, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { CharacterAvatar, EmptyBlock, PageHeader, Tally, useCharacterMap, type RouterOutputs } from "@/components/fab/common";

type MontageRow = RouterOutputs["montage"]["list"][number];
type Media = RouterOutputs["montage"]["media"][number];
type Stock = RouterOutputs["montage"]["stockSearch"]["items"][number];

const STATUS: Record<string, { label: string; tone: "go" | "hold" | "stop" | "idle" }> = {
  draft: { label: "مسودة", tone: "idle" },
  rendering: { label: "جارٍ الرندر", tone: "hold" },
  rendered: { label: "مُصدَّر", tone: "go" },
  failed: { label: "فشل", tone: "stop" },
};

const fmt = (s: number) => `${s.toFixed(1)}s`;

/* ------------------------------------------------------------------ list */

export default function MontageList() {
  const utils = trpc.useUtils();
  const list = trpc.montage.list.useQuery(undefined, { refetchInterval: 5000 });
  const remove = trpc.montage.remove.useMutation({ onSuccess: () => utils.montage.list.invalidate() });
  const { map } = useCharacterMap();
  const [picker, setPicker] = useState(false);
  const rows = list.data ?? [];
  return (
    <div>
      <PageHeader
        title="المونتاج"
        subtitle="غرفة مونتاج داخل المصنع: لقطة Premium أو صور الشخصية، لقطات B-roll مجانية من Pexels، انتقالات، ترجمة بأسلوبك، وموسيقى تُخفَّض تلقائيًا تحت الصوت. الرندر على الخادم بـ ffmpeg مجانًا، والنتيجة تدخل فحص الجودة ثم التقويم."
        actions={
          <Button onClick={() => setPicker(true)}>
            <Plus /> مونتاج جديد
          </Button>
        }
      />
      <ScriptPicker open={picker} onClose={() => setPicker(false)} />
      {list.isLoading ? (
        <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
      ) : rows.length === 0 ? (
        <EmptyBlock title="لا توجد مشاريع مونتاج بعد" action={<Button onClick={() => setPicker(true)}><Plus /> ابدأ من نص</Button>}>
          اختر نصًا جاهزًا؛ يبدأ المشروع من لقطته Premium (مع ترجمتها) أو من صور الشخصية مع تعليق صوتي، ثم أضف ما تريد.
        </EmptyBlock>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {rows.map(m => (
            <MontageCard key={m.id} m={m} character={map.get(m.characterId)} onRemove={() => confirm("حذف مشروع المونتاج؟ (الريل المُصدَّر يبقى في فحص الجودة)") && remove.mutate({ id: m.id })} />
          ))}
        </div>
      )}
    </div>
  );
}

function MontageCard({ m, character, onRemove }: { m: MontageRow; character?: { name: string; referenceImages: string[] | null; colors: { primary: string; accent: string; text: string } | null }; onRemove: () => void }) {
  const st = STATUS[m.status] ?? STATUS.draft;
  const poster = m.thumbnailUrl ?? character?.referenceImages?.[0];
  return (
    <div className="panel group overflow-hidden">
      <Link href={`/montage/${m.id}`} className="reel block aspect-[9/16] bg-black">
        {m.previewUrl && !m.thumbnailUrl ? (
          <video src={m.previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : poster ? (
          <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground"><Clapperboard /></div>
        )}
      </Link>
      <div className="flex flex-col gap-1.5 p-2.5">
        <div className="truncate text-[13px] font-semibold">{m.title}</div>
        <div className="flex items-center justify-between gap-2">
          <Tally tone={st.tone} live={m.status === "rendering"} label={st.label} />
          <span className="num text-[11px] text-muted-foreground">{m.segments} مقاطع</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CharacterAvatar character={character} size={18} />
          <span className="truncate text-[11px] text-muted-foreground">{character?.name ?? "—"}</span>
        </div>
        <div className="flex gap-1">
          <Button asChild size="sm" variant="secondary" className="flex-1">
            <Link href={`/montage/${m.id}`}><Scissors /> فتح</Link>
          </Button>
          {m.renderId && (
            <Button asChild size="icon-sm" variant="ghost" title="الريل في فحص الجودة">
              <Link href="/qc"><ShieldCheck /></Link>
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" aria-label="حذف المونتاج" onClick={onRemove}><Trash2 /></Button>
        </div>
      </div>
    </div>
  );
}

function ScriptPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const q = trpc.montage.candidates.useQuery(undefined, { enabled: open });
  const { map } = useCharacterMap();
  const [search, setSearch] = useState("");
  const create = trpc.montage.create.useMutation({
    onSuccess: r => { onClose(); navigate(`/montage/${r.id}`); },
    onError: e => toast.error(e.message),
  });
  const rows = (q.data ?? []).filter(r => !search || r.hook.toLowerCase().includes(search.toLowerCase()) || map.get(r.characterId)?.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>ابدأ مونتاجًا من نص</DialogTitle>
          <DialogDescription>النصوص التي لها لقطة Premium تبدأ من اللقطة وترجمتها؛ الباقي يبدأ من صور الشخصية مع تعليق صوتي.</DialogDescription>
        </DialogHeader>
        <Input placeholder="بحث في الـ Hook أو اسم الشخصية" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {q.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">جارٍ التحميل…</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">لا توجد نصوص مطابقة.</div>
          ) : (
            rows.map(r => {
              const c = map.get(r.characterId);
              return (
                <button key={r.id} type="button" className="flex w-full items-center gap-3 p-3 text-right transition-colors hover:bg-white/[.04] disabled:opacity-50" disabled={create.isPending || !r.canStart} title={r.canStart ? undefined : "الشخصية بلا صورة مرجعية محفوظة"} onClick={() => create.mutate({ scriptId: r.id })}>
                  <CharacterAvatar character={c} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{r.hook}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{c?.name}</span>
                      <span>·</span>
                      <span>{r.track === "premium" ? (r.hasClip ? "Premium (لقطة جاهزة)" : "Premium") : r.track === "derivative" ? "مشتق" : "اقتصادي"}</span>
                      {r.hasMontage && <span className="rounded-full bg-tally/15 px-1.5 text-tally">له مونتاج</span>}
                      {!r.canStart && <span className="rounded-full bg-hold/15 px-1.5 text-hold">يحتاج صورة مرجعية</span>}
                    </div>
                  </div>
                  <Plus className="size-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** /montage/from/:scriptId — creates a project for the script then opens the editor. */
export function MontageFromScript() {
  const [, params] = useRoute("/montage/from/:scriptId");
  const [, navigate] = useLocation();
  const started = useRef(false);
  const create = trpc.montage.create.useMutation({
    onSuccess: r => navigate(`/montage/${r.id}`, { replace: true }),
    onError: e => { toast.error(e.message); navigate("/montage", { replace: true }); },
  });
  useEffect(() => {
    if (started.current || !params?.scriptId) return;
    started.current = true;
    create.mutate({ scriptId: Number(params.scriptId) });
  }, [params?.scriptId]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="p-8 text-sm text-muted-foreground">جارٍ تجهيز مشروع المونتاج…</div>;
}

/* ---------------------------------------------------------------- editor */

export function MontageEditor() {
  const [, params] = useRoute("/montage/:id");
  const id = Number(params?.id);
  const utils = trpc.useUtils();
  const q = trpc.montage.get.useQuery({ id }, { enabled: Number.isFinite(id), refetchInterval: d => (d.state.data?.status === "rendering" ? 3000 : false) });
  const media = trpc.montage.media.useQuery();
  const [spec, setSpec] = useState<MontageSpec | null>(null);
  const [title, setTitle] = useState("");
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const loadedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!q.data) return;
    if (loadedFor.current === q.data.id && dirty) return; // keep local edits while polling
    loadedFor.current = q.data.id;
    setSpec(q.data.spec);
    setTitle(q.data.title);
    setDirty(false);
    setSelected(s => s ?? q.data.spec.segments[0]?.id ?? null);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => { utils.montage.get.invalidate({ id }); utils.montage.list.invalidate(); };
  const update = trpc.montage.update.useMutation({ onError: e => toast.error(e.message) });
  const preview = trpc.montage.preview.useMutation({
    onSuccess: r => { toast.success(`المعاينة جاهزة (${(r.durationMs / 1000).toFixed(1)}s)`); setShowPreview(true); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const render = trpc.montage.render.useMutation({
    onSuccess: r => { toast.success(r.already ? "الرندر قيد التنفيذ بالفعل" : "أُضيف إلى طابور الرندر — النتيجة ستظهر في فحص الجودة"); invalidate(); },
    onError: e => toast.error(e.message),
  });

  const problems = useMemo(() => (spec ? montageProblems(spec) : []), [spec]);
  const timeline = useMemo(() => (spec ? montageTimeline(spec) : null), [spec]);

  const edit = (fn: (s: MontageSpec) => MontageSpec) => {
    setSpec(s => (s ? fn(s) : s));
    setDirty(true);
  };
  const save = async () => {
    if (!spec) return false;
    const r = await update.mutateAsync({ id, spec, title: title.trim() || undefined }).catch(() => null);
    if (!r) return false;
    setDirty(false);
    invalidate();
    return true;
  };
  const doPreview = async () => { if ((dirty ? await save() : true) && !problems.length) preview.mutate({ id }); };
  const doRender = async () => { if ((dirty ? await save() : true) && !problems.length) render.mutate({ id }); };

  if (q.isLoading || !spec) return <div className="text-sm text-muted-foreground">{q.error ? q.error.message : "جارٍ التحميل…"}</div>;
  const m = q.data!;
  const st = STATUS[m.status] ?? STATUS.draft;
  const sel = spec.segments.find(s => s.id === selected) ?? null;
  // "rendering" with a job still queued means no worker has taken it yet: allow kicking it again.
  const queuedOnly = m.status === "rendering" && m.job?.status === "queued";
  const busy = m.status === "rendering" && !queuedOnly;
  const addSegment = (seg: MontageSegment) => {
    edit(s => ({ ...s, segments: [...s.segments, seg] }));
    setSelected(seg.id);
    setShowPreview(false);
    toast.success("أُضيف إلى الخط الزمني");
  };

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <Link href="/montage" className="text-xs text-muted-foreground hover:text-foreground">← كل المشاريع</Link>
          <input
            aria-label="عنوان المونتاج"
            value={title}
            onChange={e => { setTitle(e.target.value); setDirty(true); }}
            className="display-xl mt-1 w-full bg-transparent text-[28px] outline-none focus:text-tally md:text-[38px]"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <CharacterAvatar character={{ name: m.character.name, referenceImages: null, colors: m.character.colors }} size={20} />
            <span>{m.character.name}</span>
            <span>·</span>
            <span className="truncate">{m.script.hook}</span>
            <Tally tone={st.tone} live={busy} label={queuedOnly ? "في طابور الرندر" : st.label} />
            {dirty && <span className="text-hold">تعديلات غير محفوظة</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={save} disabled={update.isPending || !dirty}>
            {update.isPending ? <RefreshCw className="animate-spin" /> : <Save />} حفظ
          </Button>
          <Button variant="secondary" onClick={doPreview} disabled={preview.isPending || busy || problems.length > 0}>
            {preview.isPending ? <RefreshCw className="animate-spin" /> : <Play />} {preview.isPending ? "جارٍ تجهيز المعاينة…" : "معاينة سريعة"}
          </Button>
          <Button onClick={doRender} disabled={render.isPending || busy || problems.length > 0}>
            <Wand2 /> {busy ? "الرندر جارٍ…" : queuedOnly ? "شغّل الرندر الآن" : "رندر نهائي"}
          </Button>
        </div>
      </div>

      {m.error && <div className="mb-4 rounded-xl border border-stop/40 bg-stop/10 p-3 text-sm text-stop">{m.error}</div>}
      {problems.length > 0 && (
        <div className="mb-4 rounded-xl border border-hold/40 bg-hold/10 p-3 text-sm text-hold">{problems.join(" · ")}</div>
      )}
      {m.render && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white/[.03] p-3 text-sm">
          <ShieldCheck className="size-4 text-go" />
          <span>الريل النهائي مُصدَّر ({((m.render.durationMs ?? 0) / 1000).toFixed(1)}s) — حالة الجودة: {m.render.qcStatus === "approved" ? "معتمد" : m.render.qcStatus === "needs_review" ? "يحتاج مراجعة" : m.render.qcStatus}</span>
          <Button asChild size="sm" variant="outline"><Link href="/qc">افتح فحص الجودة</Link></Button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="min-w-0">
          <Stage spec={spec} sel={sel} previewUrl={m.previewUrl} poster={m.render?.thumbnailUrl} showPreview={showPreview} setShowPreview={setShowPreview} media={media.data ?? []} />
          <Timeline spec={spec} selected={selected} onSelect={id => { setSelected(id); setShowPreview(false); }} timeline={timeline!} />
        </section>
        <aside className="panel p-4">
          <Tabs defaultValue="segment">
            <TabsList className="w-full">
              <TabsTrigger value="segment" className="flex-1">المقطع</TabsTrigger>
              <TabsTrigger value="settings" className="flex-1">الإعدادات</TabsTrigger>
              <TabsTrigger value="media" className="flex-1">إضافة وسائط</TabsTrigger>
            </TabsList>
            <TabsContent value="segment" className="mt-4">
              {sel ? (
                <SegmentInspector
                  seg={sel}
                  index={spec.segments.findIndex(s => s.id === sel.id)}
                  count={spec.segments.length}
                  media={media.data ?? []}
                  onChange={next => edit(s => ({ ...s, segments: s.segments.map(x => (x.id === next.id ? next : x)) }))}
                  onMove={dir => edit(s => {
                    const i = s.segments.findIndex(x => x.id === sel.id);
                    const j = i + dir;
                    if (j < 0 || j >= s.segments.length) return s;
                    const arr = [...s.segments];
                    [arr[i], arr[j]] = [arr[j], arr[i]];
                    return { ...s, segments: arr };
                  })}
                  onDuplicate={() => { const copy = { ...sel, id: newSegmentId() }; edit(s => ({ ...s, segments: [...s.segments, copy] })); setSelected(copy.id); }}
                  onRemove={() => { edit(s => ({ ...s, segments: s.segments.filter(x => x.id !== sel.id) })); setSelected(spec.segments.find(x => x.id !== sel.id)?.id ?? null); }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">اختر مقطعًا من الخط الزمني.</p>
              )}
            </TabsContent>
            <TabsContent value="settings" className="mt-4">
              <SpecSettings spec={spec} onChange={edit} media={media.data ?? []} hasCta={!!m.script.cta} />
            </TabsContent>
            <TabsContent value="media" className="mt-4">
              <MediaPanel media={media.data ?? []} characterId={m.characterId} onAdd={addSegment} onImported={() => media.refetch()} />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- stage */

function Stage({ spec, sel, previewUrl, poster, showPreview, setShowPreview, media }: { spec: MontageSpec; sel: MontageSegment | null; previewUrl: string | null; poster?: string | null; showPreview: boolean; setShowPreview: (v: boolean) => void; media: Media[] }) {
  const { total } = montageTimeline(spec);
  const playingPreview = !!previewUrl && showPreview;
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
      <div className="reel relative aspect-[9/16] w-full max-w-[250px] shrink-0 bg-black">
        {playingPreview ? (
          <video key={previewUrl} src={previewUrl!} poster={poster ?? undefined} controls playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : sel ? (
          sel.kind === "video" ? (
            <video key={`${sel.id}-${sel.in}-${sel.out}`} src={`${sel.src}#t=${sel.in.toFixed(2)},${sel.out.toFixed(2)}`} controls muted={!!sel.muted} playsInline preload="metadata" className="h-full w-full object-cover" />
          ) : (
            <img src={sel.src} alt="" className={cn("h-full w-full object-cover", sel.motion === "pan_left" ? "kenburns-alt" : "kenburns")} />
          )
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">أضف مقطعًا للبدء</div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-2 pt-9 text-[10px] text-white/80">
          <span className="rounded bg-black/60 px-1.5 py-0.5">{playingPreview ? "معاينة 540×960" : sel ? (sel.label ?? (sel.kind === "video" ? "فيديو" : "صورة")) : ""}</span>
          <span className="num rounded bg-black/60 px-1.5 py-0.5">{fmt(total)}</span>
        </div>
      </div>
      <div className="w-full space-y-2 text-sm">
        <div className="panel p-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">المعاينة</span>
            {previewUrl && (
              <Button size="sm" variant={showPreview ? "secondary" : "outline"} onClick={() => setShowPreview(!showPreview)}>
                <Play /> {showPreview ? "تعرض المعاينة" : "عرض آخر معاينة"}
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {previewUrl ? "آخر معاينة مرندرة من الخادم بالحجم النصفي. أي تعديل جديد يحتاج معاينة جديدة." : "اضغط «معاينة سريعة» لرندر نسخة خفيفة (540×960) ترى فيها الانتقالات والترجمة والموسيقى كما ستظهر."}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Mini label="المدة" value={fmt(total)} />
          <Mini label="مقاطع" value={String(spec.segments.length)} />
          <Mini label="انتقال" value={TRANSITION_LABELS[spec.transition.type]} />
        </div>
        {spec.segments.some(s => s.credit) && (
          <div className="rounded-xl border border-border p-3 text-[11px] text-muted-foreground">
            <div className="mb-1 font-semibold text-foreground/80">اعتمادات اللقطات</div>
            {spec.segments.filter(s => s.credit).map(s => <div key={s.id} dir="ltr" className="truncate text-left">{s.credit}</div>)}
            {media.some(x => x.sourceUrl) && <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="mt-1 inline-block text-tally">Videos provided by Pexels</a>}
          </div>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-2.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="num mt-0.5 text-sm font-bold">{value}</div>
    </div>
  );
}

/* -------------------------------------------------------------- timeline */

function Timeline({ spec, selected, onSelect, timeline }: { spec: MontageSpec; selected: string | null; onSelect: (id: string) => void; timeline: ReturnType<typeof montageTimeline> }) {
  const total = Math.max(1, timeline.total + timeline.transition * (spec.segments.length - 1));
  return (
    <div className="panel mt-4 p-3" dir="ltr">
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground" dir="rtl">
        <span>الخط الزمني — اضغط مقطعًا لتحريره، ورتّب بالأسهم من تبويب «المقطع»</span>
        <span className="num">{fmt(timeline.total)}</span>
      </div>
      <div className="flex min-h-[84px] gap-1 overflow-x-auto pb-1" role="list" aria-label="مقاطع المونتاج">
        {spec.segments.map((s, i) => {
          const d = segmentDuration(s);
          const w = Math.max(9, (d / total) * 100);
          const active = s.id === selected;
          return (
            <button
              key={s.id}
              type="button"
              role="listitem"
              aria-label={`${s.label ?? (s.kind === "video" ? "فيديو" : "صورة")} ${fmt(d)}`}
              onClick={() => onSelect(s.id)}
              style={{ width: `${w}%`, minWidth: 76 }}
              className={cn(
                "relative h-[84px] shrink-0 overflow-hidden rounded-[10px] border text-left transition-colors",
                active ? "border-tally ring-2 ring-tally/60" : "border-border hover:border-foreground/40",
              )}
            >
              {s.kind === "image" ? (
                <img src={s.src} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
              ) : (
                <video src={`${s.src}#t=${(s.in + 0.1).toFixed(2)}`} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover opacity-80" />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1.5">
                <div className="flex items-center gap-1 text-[10px] text-white">
                  {s.kind === "video" ? <Film className="size-3" /> : <ImageIcon className="size-3" />}
                  <span className="truncate">{s.label ?? (s.kind === "video" ? "فيديو" : "صورة")}</span>
                  {s.kind === "video" && s.muted && <VolumeX className="size-3 text-white/60" />}
                </div>
                <div className="num text-[10px] text-white/70">{fmt(d)}</div>
              </div>
              {i > 0 && timeline.transition > 0 && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-tally" title={TRANSITION_LABELS[spec.transition.type]} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- inspector */

function SegmentInspector({ seg, index, count, media, onChange, onMove, onDuplicate, onRemove }: {
  seg: MontageSegment; index: number; count: number; media: Media[];
  onChange: (s: MontageSegment) => void; onMove: (dir: -1 | 1) => void; onDuplicate: () => void; onRemove: () => void;
}) {
  const asset = media.find(x => x.url === seg.src);
  const maxSec = asset?.durationMs ? asset.durationMs / 1000 : Math.max(seg.kind === "video" ? seg.out + 5 : 15, 15);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-col gap-1.5">
        <Label>اسم المقطع</Label>
        <Input value={seg.label ?? ""} onChange={e => onChange({ ...seg, label: e.target.value.slice(0, 120) })} placeholder={seg.kind === "video" ? "فيديو" : "صورة"} />
      </div>
      {seg.kind === "video" ? (
        <>
          <div>
            <div className="flex items-center justify-between"><Label>بداية القص</Label><span className="num text-xs">{fmt(seg.in)}</span></div>
            <Slider className="mt-2" min={0} max={maxSec} step={0.1} value={[seg.in]} onValueChange={([v]) => onChange({ ...seg, in: Math.min(v, seg.out - 0.5) })} aria-label="بداية القص" />
          </div>
          <div>
            <div className="flex items-center justify-between"><Label>نهاية القص</Label><span className="num text-xs">{fmt(seg.out)}</span></div>
            <Slider className="mt-2" min={0} max={maxSec} step={0.1} value={[seg.out]} onValueChange={([v]) => onChange({ ...seg, out: Math.max(v, seg.in + 0.5) })} aria-label="نهاية القص" />
            <p className="mt-1 text-[11px] text-muted-foreground">المدة {fmt(seg.out - seg.in)} {asset?.durationMs ? `من أصل ${fmt(asset.durationMs / 1000)}` : ""}</p>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">{seg.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />} كتم صوت المقطع</span>
            <Switch checked={!!seg.muted} onCheckedChange={v => onChange({ ...seg, muted: v })} aria-label="كتم صوت المقطع" />
          </label>
          {!!seg.words?.length && <p className="text-[11px] text-muted-foreground">يحمل ترجمة كلامه ({seg.words.length} كلمة) — تظهر عند اختيار «صوت المقاطع نفسها».</p>}
        </>
      ) : (
        <>
          <div>
            <div className="flex items-center justify-between"><Label>المدة</Label><span className="num text-xs">{fmt(seg.duration)}</span></div>
            <Slider className="mt-2" min={0.5} max={15} step={0.1} value={[seg.duration]} onValueChange={([v]) => onChange({ ...seg, duration: v })} aria-label="مدة الصورة" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>حركة الكاميرا</Label>
            <Select value={seg.motion} onValueChange={v => onChange({ ...seg, motion: v as (typeof MONTAGE_MOTIONS)[number] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MONTAGE_MOTIONS.map(k => <SelectItem key={k} value={k}>{MOTION_LABELS[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </>
      )}
      {seg.credit && <p dir="ltr" className="text-left text-[11px] text-muted-foreground">{seg.credit}</p>}
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" onClick={() => onMove(-1)} disabled={index <= 0} aria-label="تقديم المقطع"><ArrowRight /> قبل</Button>
        <Button size="sm" variant="outline" onClick={() => onMove(1)} disabled={index >= count - 1} aria-label="تأخير المقطع">بعد <ArrowLeft /></Button>
        <Button size="sm" variant="outline" onClick={onDuplicate}><Copy /> تكرار</Button>
        <Button size="sm" variant="ghost" className="text-stop" onClick={onRemove} disabled={count <= 1}><Trash2 /> حذف</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ settings */

function SpecSettings({ spec, onChange, media, hasCta }: { spec: MontageSpec; onChange: (fn: (s: MontageSpec) => MontageSpec) => void; media: Media[]; hasCta: boolean }) {
  const music = media.filter(x => x.kind === "music");
  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-2">
        <Label>الانتقال بين المقاطع</Label>
        <Select value={spec.transition.type} onValueChange={v => onChange(s => ({ ...s, transition: { ...s.transition, type: v as (typeof MONTAGE_TRANSITIONS)[number] } }))}>
          <SelectTrigger aria-label="نوع الانتقال"><SelectValue /></SelectTrigger>
          <SelectContent>{MONTAGE_TRANSITIONS.map(k => <SelectItem key={k} value={k}>{TRANSITION_LABELS[k]}</SelectItem>)}</SelectContent>
        </Select>
        {spec.transition.type !== "none" && (
          <div>
            <div className="flex items-center justify-between text-xs"><span>مدة الانتقال</span><span className="num">{fmt(spec.transition.duration)}</span></div>
            <Slider className="mt-2" min={0.1} max={2} step={0.1} value={[spec.transition.duration]} onValueChange={([v]) => onChange(s => ({ ...s, transition: { ...s.transition, duration: v } }))} aria-label="مدة الانتقال" />
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label>الصوت</Label>
        <Select value={spec.voice.source} onValueChange={v => onChange(s => ({ ...s, voice: { source: v as (typeof VOICE_SOURCES)[number] } }))}>
          <SelectTrigger aria-label="مصدر الصوت"><SelectValue /></SelectTrigger>
          <SelectContent>{VOICE_SOURCES.map(k => <SelectItem key={k} value={k}>{VOICE_SOURCE_LABELS[k]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>الترجمة على الشاشة</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {CAPTION_STYLES.map(k => (
            <button key={k} type="button" onClick={() => onChange(s => ({ ...s, captions: { ...s.captions, style: k } }))} className={cn("rounded-[10px] border px-2.5 py-2 text-right text-xs transition-colors", spec.captions.style === k ? "border-tally bg-tally/10 text-foreground" : "border-border text-muted-foreground hover:border-foreground/40")} aria-pressed={spec.captions.style === k}>
              {CAPTION_STYLE_LABELS[k]}
            </button>
          ))}
        </div>
        {spec.captions.style !== "none" && (
          <div className="flex gap-1.5">
            {CAPTION_POSITIONS.map(p => (
              <button key={p} type="button" onClick={() => onChange(s => ({ ...s, captions: { ...s.captions, position: p } }))} className={cn("flex-1 rounded-[10px] border px-2 py-1.5 text-xs", spec.captions.position === p ? "border-tally text-foreground" : "border-border text-muted-foreground")} aria-pressed={spec.captions.position === p}>
                {p === "bottom" ? "أسفل الشاشة" : "وسط الشاشة"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-2"><Music className="size-4" /> موسيقى الخلفية</Label>
        <Select value={spec.music.assetId ? String(spec.music.assetId) : "none"} onValueChange={v => onChange(s => { const a = music.find(x => String(x.id) === v); return { ...s, music: { ...s.music, assetId: a?.id ?? null, src: a?.url ?? null } }; })}>
          <SelectTrigger aria-label="موسيقى الخلفية"><SelectValue placeholder="بدون موسيقى" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">بدون موسيقى</SelectItem>
            {music.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.title ?? `#${a.id}`}</SelectItem>)}
          </SelectContent>
        </Select>
        {music.length === 0 && <p className="text-[11px] text-muted-foreground">ارفع ملفات موسيقى مرخّصة إلى المكتبة (قسم موسيقى) لتظهر هنا.</p>}
        {spec.music.assetId && (
          <>
            <div>
              <div className="flex items-center justify-between text-xs"><span>مستوى الموسيقى</span><span className="num">{Math.round(spec.music.volume * 100)}%</span></div>
              <Slider className="mt-2" min={0} max={1} step={0.02} value={[spec.music.volume]} onValueChange={([v]) => onChange(s => ({ ...s, music: { ...s.music, volume: v } }))} aria-label="مستوى الموسيقى" />
            </div>
            <label className="flex items-center justify-between gap-3">
              <span>خفض الموسيقى تلقائيًا تحت الصوت (ducking)</span>
              <Switch checked={spec.music.duck} onCheckedChange={v => onChange(s => ({ ...s, music: { ...s.music, duck: v } }))} aria-label="خفض الموسيقى تلقائيًا" />
            </label>
          </>
        )}
      </div>
      <div className="space-y-2 border-t border-border pt-4">
        <label className="flex items-center justify-between gap-3">
          <span>عنوان الـ Hook في البداية</span>
          <Switch checked={spec.hook.show} onCheckedChange={v => onChange(s => ({ ...s, hook: { show: v } }))} aria-label="إظهار الهوك" />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>بطاقة CTA في النهاية {hasCta ? "" : "(النص بلا CTA)"}</span>
          <Switch checked={spec.cta.show} disabled={!hasCta} onCheckedChange={v => onChange(s => ({ ...s, cta: { show: v } }))} aria-label="إظهار بطاقة الدعوة" />
        </label>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- media */

const KIND_LABEL: Record<string, string> = { broll: "B-roll", premium_video: "Premium", render: "ريل مُصدّر", background: "خلفية", character_image: "صورة شخصية", music: "موسيقى" };

function MediaPanel({ media, characterId, onAdd, onImported }: { media: Media[]; characterId: number; onAdd: (s: MontageSegment) => void; onImported: () => void }) {
  const [tab, setTab] = useState<"library" | "stock">("library");
  const [kind, setKind] = useState<string>("all");
  const visual = media.filter(x => x.kind !== "music" && (kind === "all" || x.kind === kind));
  const addFromAsset = (a: Media) => {
    const isVideo = a.kind === "broll" || a.kind === "premium_video" || a.kind === "render";
    const dur = (a.durationMs ?? 0) / 1000;
    onAdd(
      isVideo
        ? { id: newSegmentId(), kind: "video", src: a.url, assetId: a.id, label: a.title?.slice(0, 60) ?? KIND_LABEL[a.kind], credit: a.credit ?? undefined, in: 0, out: Number((dur > 0 ? Math.min(dur, 5) : 5).toFixed(2)), muted: a.kind === "broll" }
        : { id: newSegmentId(), kind: "image", src: a.url, assetId: a.id, label: a.title?.slice(0, 60) ?? KIND_LABEL[a.kind], duration: 4, motion: MONTAGE_MOTIONS[Math.floor(Math.random() * MONTAGE_MOTIONS.length)] },
    );
  };
  return (
    <div className="space-y-3 text-sm">
      <div className="flex gap-1.5">
        <Button size="sm" variant={tab === "library" ? "secondary" : "outline"} onClick={() => setTab("library")} className="flex-1">المكتبة</Button>
        <Button size="sm" variant={tab === "stock" ? "secondary" : "outline"} onClick={() => setTab("stock")} className="flex-1"><Search /> Pexels مجاني</Button>
      </div>
      {tab === "library" ? (
        <>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger aria-label="نوع الوسائط"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              {Object.entries(KIND_LABEL).filter(([k]) => k !== "music").map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          {visual.length === 0 ? (
            <p className="text-xs text-muted-foreground">لا توجد وسائط من هذا النوع. ارفع من مكتبة الأصول أو ابحث في Pexels.</p>
          ) : (
            <div className="grid max-h-[46vh] grid-cols-3 gap-1.5 overflow-y-auto pr-0.5">
              {visual.slice(0, 120).map(a => (
                <button key={a.id} type="button" onClick={() => addFromAsset(a)} className="group relative aspect-[9/16] overflow-hidden rounded-[10px] border border-border bg-black text-left hover:border-tally" aria-label={`إضافة ${a.title ?? KIND_LABEL[a.kind]}`}>
                  {a.kind === "background" || a.kind === "character_image" ? (
                    <img src={a.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <video src={`${a.url}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1 text-[9px] text-white">
                    <div className="truncate">{a.title ?? KIND_LABEL[a.kind]}</div>
                    <div className="text-white/60">{KIND_LABEL[a.kind]}{a.durationMs ? ` · ${(a.durationMs / 1000).toFixed(0)}s` : ""}</div>
                  </div>
                  <Plus className="absolute right-1 top-1 size-4 rounded-full bg-tally p-0.5 text-black opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <StockPanel characterId={characterId} onAdd={onAdd} onImported={onImported} />
      )}
    </div>
  );
}

function StockPanel({ characterId, onAdd, onImported }: { characterId: number; onAdd: (s: MontageSegment) => void; onImported: () => void }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const search = trpc.montage.stockSearch.useQuery({ query: submitted, page: 1 }, { enabled: submitted.length > 0, retry: false });
  const importStock = trpc.montage.stockImport.useMutation({
    onSuccess: (a, vars) => {
      onImported();
      onAdd({ id: newSegmentId(), kind: "video", src: a.url, assetId: a.id, label: `B-roll: ${vars.query}`.slice(0, 60), credit: a.credit ?? undefined, in: 0, out: Number(Math.min((a.durationMs ?? 5000) / 1000, 5).toFixed(2)), muted: true });
    },
    onError: e => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <form className="flex gap-1.5" onSubmit={e => { e.preventDefault(); setSubmitted(query.trim()); }}>
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="مثال: garden sunrise, city night, cooking" dir="ltr" aria-label="بحث Pexels" />
        <Button type="submit" size="sm" disabled={!query.trim() || search.isFetching}><Search /></Button>
      </form>
      <p className="text-[11px] text-muted-foreground">
        لقطات عمودية مجانية للاستخدام التجاري. يُحفظ المقطع في مكتبتك مع اسم المصوّر. <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="text-tally">Videos provided by Pexels</a>
      </p>
      {search.error && <p className="text-xs text-stop">{search.error.message}</p>}
      {search.isFetching && <p className="text-xs text-muted-foreground">جارٍ البحث…</p>}
      {search.data && search.data.items.length === 0 && <p className="text-xs text-muted-foreground">لا نتائج — جرّب كلمات إنجليزية أبسط.</p>}
      {!!search.data?.items.length && (
        <div className="grid max-h-[46vh] grid-cols-3 gap-1.5 overflow-y-auto pr-0.5">
          {search.data.items.map((it: Stock) => (
            <button key={it.id} type="button" disabled={importStock.isPending} onClick={() => importStock.mutate({ item: it, query: submitted, characterId })} className="group relative aspect-[9/16] overflow-hidden rounded-[10px] border border-border bg-black hover:border-tally disabled:opacity-60" aria-label={`إضافة لقطة ${it.id}`}>
              <img src={it.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1 text-[9px] text-white">
                <div className="num">{it.durationSec.toFixed(0)}s · {it.width}×{it.height}</div>
                <div className="truncate text-white/60" dir="ltr">{it.credit}</div>
              </div>
              <Plus className="absolute right-1 top-1 size-4 rounded-full bg-tally p-0.5 text-black opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}
      {importStock.isPending && <p className="text-xs text-muted-foreground">جارٍ تنزيل اللقطة إلى مكتبتك…</p>}
    </div>
  );
}
