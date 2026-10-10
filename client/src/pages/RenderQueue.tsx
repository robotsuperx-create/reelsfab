import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { preloadTts } from "@/lib/tts";
import { defaultMusicFor, renderAndSave, type QcResult } from "@/lib/render/pipeline";
import { prepareEconomic, prepareVideoBased } from "@/lib/render/prepare";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TEMPLATES } from "@shared/domain";
import { Layers, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CharacterAvatar, EmptyBlock, PageHeader, StatusTally, TrackBadge, TtsStatusBadge, useCharacterMap, type RouterOutputs } from "@/components/fab/common";

type Queue = RouterOutputs["renders"]["queue"];
type Item = { key: string; script: Queue["economic"][number]; clip: Queue["video"][number]["clip"] | null };
type JobState = { phase: "waiting" | "preparing" | "encoding" | "uploading" | "qc" | "done" | "error"; progress: number; label?: string; verdict?: QcResult["verdict"]; error?: string };

export default function RenderQueue() {
  const q = trpc.renders.queue.useQuery(undefined, { refetchOnWindowFocus: false });
  const settings = trpc.settings.get.useQuery();
  const createRender = trpc.renders.create.useMutation();
  const utils = trpc.useUtils();
  const { map } = useCharacterMap();
  const [tab, setTab] = useState<"all" | "economic" | "video">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [music, setMusic] = useState(true);
  const [volume, setVolume] = useState(18);
  const [maxImages, setMaxImages] = useState(3);
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const [running, setRunning] = useState(false);
  const [runItems, setRunItems] = useState<Item[]>([]);
  const stopRef = useRef(false);

  useEffect(() => {
    if (settings.data) setVolume(settings.data.musicVolume);
  }, [settings.data]);

  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  const items: Item[] = useMemo(() => {
    const e = (q.data?.economic ?? []).map(s => ({ key: `s${s.id}`, script: s, clip: null }));
    const v = (q.data?.video ?? []).map(r => ({ key: `s${r.script.id}`, script: r.script, clip: r.clip }));
    return [...v, ...e];
  }, [q.data]);
  const visible = items.filter(i => tab === "all" || (tab === "economic" ? !i.clip : Boolean(i.clip)));
  const chosen = items.filter(i => selected.has(i.key));
  const done = Object.values(jobs).filter(j => j.phase === "done").length;
  const failed = Object.values(jobs).filter(j => j.phase === "error").length;

  const setJob = (key: string, s: Partial<JobState>) => setJobs(prev => ({ ...prev, [key]: { ...(prev[key] ?? { phase: "waiting", progress: 0 }), ...s } }));

  const run = async () => {
    if (!chosen.length) return;
    stopRef.current = false;
    setRunning(true);
    const init: Record<string, JobState> = {};
    chosen.forEach(i => (init[i.key] = { phase: "waiting", progress: 0 }));
    setJobs(init);
    setRunItems(chosen);
    if (chosen.some(i => !i.clip)) void preloadTts().catch(() => undefined);
    for (const it of chosen) {
      if (stopRef.current) break;
      const character = map.get(it.script.characterId);
      if (!character) {
        setJob(it.key, { phase: "error", error: "الشخصية غير موجودة" });
        continue;
      }
      try {
        setJob(it.key, { phase: "preparing", label: "تجهيز" });
        const musicChoice = music ? defaultMusicFor(it.script.templateKey) : ({ kind: "none" } as const);
        const prepared = it.clip
          ? await prepareVideoBased({
              script: it.script,
              character,
              clip: it.clip,
              kind: it.script.track === "premium" ? "premium" : "derivative",
              music: music ? musicChoice : { kind: "none" },
              musicVolume: Math.round(volume * 0.6),
              onStep: l => setJob(it.key, { label: l }),
            })
          : await prepareEconomic({
              script: it.script,
              character,
              imageUrls: (character.referenceImages ?? []).slice(0, maxImages),
              music: musicChoice,
              musicVolume: volume,
              onStep: l => setJob(it.key, { label: l }),
            });
        const r = await renderAndSave({
          prepared,
          slug: character.slug,
          create: p => createRender.mutateAsync(p) as Promise<{ id: number; qc: QcResult }>,
          onProgress: (phase, v) => setJob(it.key, { phase, progress: phase === "encoding" ? v : 1, label: undefined }),
        });
        setJob(it.key, { phase: "done", progress: 1, verdict: r.qc.verdict });
      } catch (e) {
        setJob(it.key, { phase: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
    setRunning(false);
    setSelected(new Set());
    utils.renders.queue.invalidate();
    utils.renders.list.invalidate();
    utils.scripts.list.invalidate();
    toast.success("انتهى الرندر الجماعي — راجع النتائج في فحص الجودة");
  };

  const phaseLabel: Record<JobState["phase"], string> = {
    waiting: "بالانتظار",
    preparing: "تجهيز",
    encoding: "ترميز",
    uploading: "رفع",
    qc: "فحص",
    done: "تم",
    error: "خطأ",
  };

  const allJobs = Object.keys(jobs).length;
  return (
    <div>
      <PageHeader
        kicker="BATCH RENDER · BROWSER ENGINE"
        title="الرندر الجماعي"
        subtitle="حدّد النصوص الاقتصادية والنسخ المشتقة ثم اضغط ابدأ: يُولّد الصوت ويُرندر كل ريل ويُرفع ويُفحص تلقائيًا بالتتابع. اترك هذه الصفحة مفتوحة أثناء العمل (≈20–40 ثانية للريل)."
        actions={<TtsStatusBadge />}
      />
      <div className="panel mb-4 flex flex-wrap items-end gap-5 p-4">
        <div className="flex items-center gap-2">
          <Switch checked={music} onCheckedChange={setMusic} />
          <Label className="text-sm">موسيقى مولّدة مجانية</Label>
        </div>
        <div className="flex w-48 flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">مستوى الموسيقى {volume}%</Label>
          <Slider value={[volume]} min={0} max={60} step={1} onValueChange={v => setVolume(v[0])} disabled={!music} />
        </div>
        <div className="flex w-40 flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">صور لكل ريل: {maxImages}</Label>
          <Slider value={[maxImages]} min={1} max={5} step={1} onValueChange={v => setMaxImages(v[0])} />
        </div>
        <div className="mr-auto flex items-center gap-2">
          {running ? (
            <Button variant="destructive" onClick={() => (stopRef.current = true)}>
              <Square /> إيقاف بعد العنصر الحالي
            </Button>
          ) : (
            <Button onClick={run} disabled={!chosen.length}>
              <Layers /> ابدأ رندر {chosen.length} ريل
            </Button>
          )}
        </div>
      </div>

      {allJobs > 0 && (
        <div className="panel mb-4 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span>التقدم الإجمالي</span>
            <span className="timecode text-muted-foreground">
              {done} / {allJobs} تم{failed ? ` · ${failed} خطأ` : ""}
            </span>
          </div>
          <Progress value={((done + failed) / allJobs) * 100} className="h-2" />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">الكل ({items.length})</TabsTrigger>
            <TabsTrigger value="video">من فيديو Premium ({items.filter(i => i.clip).length})</TabsTrigger>
            <TabsTrigger value="economic">اقتصادي ({items.filter(i => !i.clip).length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="sm"
          disabled={running}
          onClick={() => setSelected(prev => (visible.every(i => prev.has(i.key)) ? new Set() : new Set(visible.map(i => i.key))))}
        >
          تحديد/إلغاء الكل
        </Button>
      </div>

      {q.isLoading ? (
        <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
      ) : visible.length === 0 && allJobs === 0 ? (
        <EmptyBlock title="لا توجد عناصر بانتظار الرندر">النصوص الجاهزة (اقتصادي) والنسخ المشتقة من فيديوهات Premium المرفوعة تظهر هنا.</EmptyBlock>
      ) : (
        <div className="panel divide-y">
          {[...runItems, ...visible.filter(i => !runItems.some(r => r.key === i.key))].map(it => {
            const c = map.get(it.script.characterId);
            const j = jobs[it.key];
            const noImage = !it.clip && !(c?.referenceImages ?? []).length;
            return (
              <label key={it.key} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5", selected.has(it.key) && "bg-tally/5")}>
                <Checkbox
                  disabled={running || noImage || Boolean(j)}
                  checked={selected.has(it.key)}
                  onCheckedChange={v =>
                    setSelected(prev => {
                      const n = new Set(prev);
                      if (v) n.add(it.key);
                      else n.delete(it.key);
                      return n;
                    })
                  }
                />
                <CharacterAvatar character={c} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" dir="ltr">
                    {it.script.hook}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <TrackBadge track={it.script.track} />
                    <span>{c?.name}</span>
                    <span>{TEMPLATES.find(t => t.key === it.script.templateKey)?.label}</span>
                    {noImage && <span className="text-stop">لا توجد صورة للشخصية</span>}
                  </div>
                </div>
                <div className="w-48 shrink-0">
                  {j ? (
                    j.phase === "done" ? (
                      <StatusTally status={j.verdict ?? "approved"} kind="qc" />
                    ) : j.phase === "error" ? (
                      <span className="line-clamp-2 text-[11px] text-stop">{j.error}</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground">
                          {j.label ?? phaseLabel[j.phase]} {j.phase === "encoding" ? `${Math.round(j.progress * 100)}%` : ""}
                        </span>
                        <Progress value={j.phase === "encoding" ? j.progress * 100 : j.phase === "waiting" ? 0 : 15} className="h-1" />
                      </div>
                    )
                  ) : (
                    <StatusTally status={it.script.status} />
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
