import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  CODE_AGENT_ENGINE_LABELS,
  CODE_AGENT_ENGINES,
  CODE_VIDEO_DURATIONS,
  CODE_VIDEO_FPS,
  CODE_VIDEO_MAX_SECONDS,
  CODE_VIDEO_SIZES,
  CODE_VIDEO_STATUS_LABELS,
  STYLE_RECIPES,
  RENDER_QUALITIES,
  RENDER_QUALITY_LABELS,
  type RenderQuality,
  strongPrompt,
  type CodeInspection,
  type CodeIssue,
  type StyleRecipeId,
  codeVideoSize,
  estimateAgentUsd,
  formatDuration,
  segmentCount,
  withCodeVideoCsp,
  type CodeAgentEngine,
  TRANSCRIBER_LABELS,
  TRANSCRIBERS,
  type TranscriberId,
  type CodeVideoSizeId,
} from "@shared/code-video";
import { Switch } from "@/components/ui/switch";
import { Bot, CircleAlert, CircleCheck, Code2, Download, Eye, Film, Lock, RefreshCw, ScanSearch, Scissors, ShieldCheck, Sparkles, Terminal, Trash2, TriangleAlert, Undo2, Upload, Wand2, WifiOff } from "lucide-react";
import { uploadBlob } from "@/lib/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { CopyButton, EmptyBlock, PageHeader, Tally, type RouterOutputs } from "@/components/fab/common";

type Row = RouterOutputs["codeVideos"]["list"][number];
const TONE: Record<string, "go" | "hold" | "stop" | "idle"> = { analyzing: "hold", writing: "hold", draft: "idle", queued: "idle", running: "hold", done: "go", failed: "stop" };
const DRAFT_KEY = "code-video-draft";

function readDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") as { html?: string; size?: CodeVideoSizeId; duration?: number; fps?: 30 | 60; idea?: string; engine?: CodeAgentEngine; auto?: boolean; styleId?: StyleRecipeId | ""; quality?: RenderQuality } | null;
  } catch {
    return null;
  }
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} title={title} className={cn("num rounded-[10px] border px-2.5 py-1.5 text-xs transition-colors", on ? "border-tally bg-tally/10 text-foreground" : "border-border text-muted-foreground hover:border-foreground/40")}>
      {children}
    </button>
  );
}

export default function CodeVideoPage() {
  const draft = useMemo(readDraft, []);
  const [html, setHtml] = useState(draft?.html ?? "");
  const [sizeId, setSizeId] = useState<CodeVideoSizeId>(draft?.size ?? "1080x1920");
  const [duration, setDuration] = useState(String(draft?.duration ?? 15));
  const [fps, setFps] = useState<30 | 60>(draft?.fps ?? 30);
  const [idea, setIdea] = useState(draft?.idea ?? "");
  const [engine, setEngine] = useState<CodeAgentEngine>(draft?.engine ?? "claude-code");
  const [auto, setAuto] = useState(draft?.auto ?? true);
  const [preview, setPreview] = useState<{ html: string; key: number } | null>(null);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [mode, setMode] = useState<"idea" | "video">("idea");
  const [quality, setQuality] = useState<RenderQuality>(draft?.quality ?? "standard");
  const [styleId, setStyleId] = useState<StyleRecipeId | "">(draft?.styleId ?? "");
  const [inspection, setInspection] = useState<{ result: CodeInspection; fixedFrom?: { html: string; before: CodeIssue[] } } | null>(null);
  const size = codeVideoSize(sizeId);
  const seconds = Math.round(Number(duration));
  const durationOk = Number.isFinite(seconds) && seconds >= 1 && seconds <= CODE_VIDEO_MAX_SECONDS;
  const parts = durationOk ? segmentCount(seconds) : 1;

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ html, size: sizeId, duration: seconds, fps, idea, engine, auto, styleId, quality })); } catch { /* private mode */ }
    }, 400);
    return () => clearTimeout(t);
  }, [html, sizeId, seconds, fps, idea, engine, auto, styleId, quality]);

  const utils = trpc.useUtils();
  const engines = trpc.codeVideos.engines.useQuery(undefined, { staleTime: 60_000 });
  useEffect(() => {
    const e = engines.data;
    if (!e) return;
    if (engine === "claude-code" && !e.claudeCode && e.api) setEngine("api");
    if (engine === "api" && !e.api && e.claudeCode) setEngine("claude-code");
  }, [engines.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = trpc.codeVideos.list.useQuery(undefined, {
    refetchInterval: q => ((q.state.data ?? []).some(r => ["queued", "running", "writing", "analyzing"].includes(r.status)) ? 1500 : 10000),
  });
  const rows = list.data ?? [];
  const current = rows.find(r => r.id === currentId) ?? null;

  // When the agent finishes a single file, it lands in the editor.
  const loadedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!current || loadedFor.current === current.id) return;
    if (current.status === "draft" || (current.status === "queued" && current.engine)) {
      loadedFor.current = current.id;
      void utils.codeVideos.get.fetch({ id: current.id }).then(full => { if (full.html) setHtml(full.html); });
    }
  }, [current, utils]);

  const done = () => void utils.codeVideos.list.invalidate();
  const convert = trpc.codeVideos.convert.useMutation({ onSuccess: r => { setCurrentId(r.id); toast.success("دخل الطابور — التحويل بدأ"); done(); }, onError: e => toast.error(e.message) });
  const queueDraft = trpc.codeVideos.queueDraft.useMutation({ onSuccess: () => { toast.success("دخل الطابور — التحويل بدأ"); done(); }, onError: e => toast.error(e.message) });
  const agent = trpc.codeVideos.agentWrite.useMutation({
    onSuccess: r => { setCurrentId(r.id); loadedFor.current = null; setPreview(null); toast.success(parts > 1 ? `الوكيل يخطّط ${parts} مقطعًا ثم يكتبها` : "الوكيل يكتب الأنيميشن"); done(); },
    onError: e => toast.error(e.message),
  });

  const inspect = trpc.codeVideos.inspect.useMutation({
    onSuccess: r => {
      setInspection({ result: r });
      toast[r.issues.length ? "warning" : "success"](r.issues.length ? `وجدت ${r.issues.length} مشكلة` : "الكود سليم في كل ما فحصته");
    },
    onError: e => toast.error(e.message),
  });
  const fix = trpc.codeVideos.fix.useMutation({
    onSuccess: (r, vars) => {
      setHtml(r.html);
      setInspection({ result: r.after, fixedFrom: { html: vars.html, before: r.before } });
      setPreview(null);
      toast.success(`أصلحه Claude: ${r.before.length} مشكلة قبل ← ${r.after.issues.length} بعد`);
    },
    onError: e => toast.error(e.message),
  });
  const pasted = () => {
    if (html.trim().length < 20) { toast.error("ألصق ملف HTML أولًا"); return false; }
    if (!durationOk) { toast.error("اختر مدة بين ثانية و40 دقيقة"); return false; }
    return true;
  };
  const startInspect = () => pasted() && inspect.mutate({ html, size: sizeId, durationSec: seconds });
  const startFix = () => pasted() && fix.mutate({ html, size: sizeId, durationSec: seconds, engine, styleId: styleId || undefined });

  const startPreview = () => {
    if (html.trim().length < 20) return toast.error("ألصق ملف HTML أولًا");
    setPreview({ html: withCodeVideoCsp(html), key: Date.now() });
  };
  const startConvert = () => {
    if (html.trim().length < 20) return toast.error("ألصق ملف HTML أولًا");
    if (!durationOk) return toast.error("اختر مدة بين ثانية و40 دقيقة");
    if (current && current.status === "draft") return queueDraft.mutate({ id: current.id, html: current.segments > 1 ? undefined : html });
    convert.mutate({ html, size: sizeId, durationSec: seconds, fps, quality });
  };
  const startAgent = () => {
    if (idea.trim().length < 8) return toast.error("اكتب الفكرة بجملة على الأقل");
    if (!durationOk) return toast.error("اختر مدة بين ثانية و40 دقيقة");
    agent.mutate({ idea, size: sizeId, durationSec: seconds, fps, engine, autoConvert: auto, styleId: styleId || undefined, quality });
  };
  const e = engines.data;

  return (
    <div>
      <PageHeader
        title="كود ← فيديو"
        subtitle="اكتب الفكرة فيكتب الوكيل الأنيميشن، أو ألصق ملف HTML من أي ذكاء اصطناعي. يتحول إلى MP4 فريمًا بفريم حتى 40 دقيقة، مجانًا على جهازك، والكود يشتغل معزولًا بلا وصول للاستوديو أو مفاتيحه. الفيديو يدخل مكتبة الأصول لتستعمله غرفة المونتاج."
        actions={<CopyButton text={strongPrompt(size.width, size.height, durationOk ? seconds : 15, styleId || "documentary", idea.trim() || undefined)} label="نسخ القالب القوي" variant="secondary" />}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <section className="flex min-w-0 flex-col gap-4" aria-label="الكود والإعدادات">
          <div className="flex flex-wrap gap-1.5" aria-label="العزل">
            <span className="cv-chip"><ShieldCheck className="size-3.5" /> يشتغل معزولًا</span>
            <span className="cv-chip"><WifiOff className="size-3.5" /> الشبكة: CDN والخطوط فقط</span>
            <span className="cv-chip"><Lock className="size-3.5" /> بلا وصول لمفاتيح الاستوديو</span>
          </div>

          <div className="flex gap-1.5" role="tablist" aria-label="طريقة العمل">
            <Chip on={mode === "idea"} onClick={() => setMode("idea")}>من فكرة أو كود</Chip>
            <Chip on={mode === "video"} onClick={() => setMode("video")}>على فيديوك</Chip>
          </div>

          {mode === "video" && <OverlayPanel engine={engine} setEngine={setEngine} engines={e} auto={auto} setAuto={setAuto} fps={fps} setFps={setFps} onStarted={id => { setCurrentId(id); loadedFor.current = null; setPreview(null); done(); }} />}
          {mode === "idea" && (<>

          <div className="panel flex flex-col gap-4 p-4" aria-label="الإعدادات">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">المقاس</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="المقاس">
                {CODE_VIDEO_SIZES.map(sz => <Chip key={sz.id} on={sizeId === sz.id} onClick={() => setSizeId(sz.id)} title={sz.label}>{sz.id.replace("x", "×")}</Chip>)}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">المدة</span>
              <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="المدة">
                {CODE_VIDEO_DURATIONS.map(d => <Chip key={d} on={seconds === d} onClick={() => setDuration(String(d))}>{formatDuration(d)}</Chip>)}
                <Label htmlFor="code-video-duration" className="sr-only">المدة بالثواني</Label>
                <Input id="code-video-duration" type="number" inputMode="numeric" min={1} max={CODE_VIDEO_MAX_SECONDS} value={duration} onChange={ev => setDuration(ev.target.value)} className="num h-8 w-24" aria-invalid={!durationOk} title="أو اكتب المدة بالثواني" />
                <span className="text-[11px] text-muted-foreground">ثانية</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">الأسلوب — للوكيل وللقالب القوي</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="الأسلوب">
                <Chip on={styleId === ""} onClick={() => setStyleId("")} title="الوكيل يختار ما يناسب الفكرة؛ القالب المنسوخ يأخذ الوثائقي">يختار الوكيل</Chip>
                {STYLE_RECIPES.map(st => <Chip key={st.id} on={styleId === st.id} onClick={() => setStyleId(st.id)} title={st.recipe}>{st.label}</Chip>)}
              </div>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">الفريمات</span>
                <div className="flex gap-1.5" role="radiogroup" aria-label="الفريمات في الثانية">
                  {CODE_VIDEO_FPS.map(f => <Chip key={f} on={fps === f} onClick={() => setFps(f)}>{f}</Chip>)}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">جودة التصوير</span>
                <div className="flex gap-1.5" role="radiogroup" aria-label="جودة التصوير">
                  {RENDER_QUALITIES.map(q => (
                    <Chip key={q} on={quality === q} onClick={() => setQuality(q)} title={q === "cinema" ? "رسم بضعف الدقة + ضبابية حركة حقيقية + ترميز أعلى — أنعم وأنظف، وأبطأ نحو 6–10 مرات" : "سريع"}>
                      {RENDER_QUALITY_LABELS[q]}
                    </Chip>
                  ))}
                </div>
              </div>
              <span className="num text-[11px] text-muted-foreground">
                {durationOk ? `${formatDuration(seconds)} · ${(seconds * fps).toLocaleString("en")} فريم${parts > 1 ? ` · ${parts} مقطعًا يكتبها الوكيل` : ""}` : "المدة بين ثانية و40 دقيقة"}
              </span>
            </div>
          </div>

          <div className="cv-term" aria-label="الوكيل">
            <div className="cv-bar">
              <Bot className="size-3.5" />
              <span className="truncate">agent@reellllocal:~# write --from-idea</span>
            </div>
            <div className="flex flex-col gap-3 p-4" dir="rtl">
              <Label htmlFor="code-video-idea" className="text-xs text-muted-foreground">الفكرة — ماذا يظهر في الفيديو، بأي أسلوب، بأي لغة</Label>
              <Textarea id="code-video-idea" value={idea} onChange={ev => setIdea(ev.target.value)} placeholder="مثال: فيديو يشرح كيف يأكل التضخم الرواتب، أسلوب وثائقي داكن بالأحمر، أرقام كبيرة متحركة، بالعربية" className="min-h-[96px] resize-y bg-black/40 p-3 text-sm leading-6" />
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">من يكتب</span>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="المحرّك">
                  {CODE_AGENT_ENGINES.map(en => {
                    const ok = en === "api" ? e?.api : e?.claudeCode;
                    return (
                      <Chip key={en} on={engine === en} onClick={() => setEngine(en)} title={ok === false ? "غير متاح الآن" : undefined}>
                        {CODE_AGENT_ENGINE_LABELS[en]}{ok === false ? " — غير متاح" : ""}
                      </Chip>
                    );
                  })}
                </div>
                <span className="text-[11px] leading-5 text-muted-foreground">
                  {engine === "api"
                    ? `التكلفة التقريبية: ${estimateAgentUsd(durationOk ? seconds : 15) < 0.1 ? "أقل من 0.1" : `≈ ${estimateAgentUsd(durationOk ? seconds : 15).toFixed(2)}`} دولار، تُسجَّل في صفحة التكلفة.`
                    : e?.claudeCode
                      ? `يستعمل Claude Code ${e.claudeCodeVersion ?? ""} المسجّل على هذا الجهاز، من حدود اشتراكك، بلا أدوات وبلا مفاتيح الاستوديو.`
                      : "ثبّت Claude Code وسجّل الدخول باشتراكك ليعمل بلا مفتاح."}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <Button onClick={startAgent} disabled={agent.isPending}><Bot /> اكتب بالوكيل</Button>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={auto} onCheckedChange={setAuto} aria-label="حوّل مباشرة بعد الكتابة" /> حوّل مباشرة بعد الكتابة
                </label>
              </div>
            </div>
          </div>
          </>)}

          <div className="cv-term">
            <div className="cv-bar">
              <i /><i /><i />
              <span className="truncate">root@reellllocal:~/code-video# nano animation.html</span>
              <span className="ms-auto num">{html.length.toLocaleString("en")} chars</span>
            </div>
            <Label htmlFor="code-video-html" className="sr-only">ملف HTML</Label>
            <Textarea
              id="code-video-html"
              dir="ltr"
              spellCheck={false}
              value={html}
              onChange={ev => setHtml(ev.target.value)}
              onKeyDown={ev => {
                if (ev.key !== "Tab") return;
                ev.preventDefault();
                const el = ev.currentTarget;
                const { selectionStart: a, selectionEnd: b } = el;
                setHtml(`${html.slice(0, a)}  ${html.slice(b)}`);
                requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
              }}
              placeholder={"<!doctype html>\n<html>\n<head>…</head>\n<body>…</body>\n</html>"}
              className="cv-code min-h-[300px] resize-y p-4 font-mono text-[12.5px] leading-5 xl:min-h-[380px]"
            />
            <div className="flex flex-wrap gap-2 border-t border-border p-3" dir="rtl">
              <Button variant="outline" onClick={startPreview}><Eye /> معاينة</Button>
              <Button variant="outline" onClick={startInspect} disabled={inspect.isPending || fix.isPending}><ScanSearch /> {inspect.isPending ? "يفحص…" : "افحص الكود"}</Button>
              <Button variant="outline" onClick={startFix} disabled={fix.isPending || inspect.isPending} title={`يصلحه ${CODE_AGENT_ENGINE_LABELS[engine]} ثم يفحصه من جديد`}><Sparkles /> {fix.isPending ? "Claude يصلح…" : "أصلحه لي"}</Button>
              <Button onClick={startConvert} disabled={convert.isPending || queueDraft.isPending}><Wand2 /> تحويل لفيديو</Button>
              {current?.segments && current.segments > 1 ? <span className="self-center text-[11px] text-muted-foreground">فيديو من {current.segments} مقطعًا — المحرر يعرض المقطع الأول</span> : null}
            </div>
          </div>
          {inspection && <InspectPanel data={inspection} onUndo={inspection.fixedFrom ? () => { setHtml(inspection.fixedFrom!.html); setInspection(null); toast("رجع الكود الأصلي"); } : undefined} onClose={() => setInspection(null)} />}
        </section>

        <section className="flex min-w-0 flex-col gap-4" aria-label="المعاينة والنتيجة">
          <div className="cv-term">
            <div className="cv-bar">
              <Terminal className="size-3.5" />
              <span className="truncate">{current?.status === "done" ? `output/code-video-${current.id}.mp4` : preview ? "sandbox://preview — live, real time" : "sandbox://preview"}</span>
              <span className="ms-auto num">{size.width}×{size.height}</span>
            </div>
            <div className="p-3">
              {current?.status === "done" && current.videoUrl ? (
                <ResultPlayer row={current} />
              ) : preview ? (
                <ScaledFrame key={preview.key} html={preview.html} width={size.width} height={size.height} />
              ) : (
                <div className="grid place-items-center rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground" style={{ aspectRatio: `${size.width} / ${size.height}`, maxHeight: "62vh", marginInline: "auto", width: "100%" }}>
                  <div className="flex flex-col items-center gap-2 p-6"><Code2 className="size-6" />اكتب فكرة للوكيل، أو ألصق الكود ثم اضغط «معاينة»</div>
                </div>
              )}
              {current && current.status !== "done" && <JobProgress row={current} />}
              {current?.sourceKey && !["analyzing"].includes(current.status) && <VideoMapView id={current.id} />}
            </div>
          </div>
        </section>
      </div>

      <h2 className="mb-3 mt-10 font-display text-lg font-semibold">التحويلات السابقة</h2>
      {list.isLoading ? (
        <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
      ) : rows.length === 0 ? (
        <EmptyBlock title="لا توجد فيديوهات من الكود بعد">اكتب فكرة للوكيل، أو انسخ القالب القوي وأعطه لأي ذكاء اصطناعي ثم ألصق الملف الذي يكتبه هنا.</EmptyBlock>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {rows.map(r => (
            <HistoryCard key={r.id} row={r} active={r.id === currentId} onOpen={async () => {
              const full = await utils.codeVideos.get.fetch({ id: r.id });
              setHtml(full.html || full.plan?.segments?.[0]?.html || "");
              if (full.idea) setIdea(full.idea);
              const sz = CODE_VIDEO_SIZES.find(x => x.width === full.width && x.height === full.height);
              if (sz) setSizeId(sz.id);
              setDuration(String(full.durationSec));
              setFps(full.fps === 60 ? 60 : 30);
              setCurrentId(r.id);
              loadedFor.current = r.id;
              setPreview(null);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The pasted page at its real size, scaled down to fit; sandboxed (scripts only, opaque origin) and under the CSP. */
function ScaledFrame({ html, width, height }: { html: string; width: number; height: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  const maxW = `min(100%, calc(62vh * ${width / height}))`;
  return (
    <div ref={box} className="relative mx-auto overflow-hidden rounded-xl bg-black" style={{ width: maxW, aspectRatio: `${width} / ${height}` }}>
      <iframe
        title="معاينة الأنيميشن"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={html}
        style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left", border: 0, position: "absolute", top: 0, left: 0 }}
      />
    </div>
  );
}

function ResultPlayer({ row }: { row: Row }) {
  return (
    <div className="flex flex-col gap-3">
      <video src={row.videoUrl!} poster={row.posterUrl ?? undefined} controls playsInline loop className="mx-auto rounded-xl bg-black" style={{ width: `min(100%, calc(62vh * ${row.width / row.height}))`, aspectRatio: `${row.width} / ${row.height}` }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm"><a href={row.videoUrl!} download={`code-video-${row.id}.mp4`}><Download /> تحميل MP4</a></Button>
        <Button asChild size="sm" variant="secondary"><Link href="/montage"><Scissors /> إلى غرفة المونتاج</Link></Button>
        <span className="num text-[11px] text-muted-foreground">{row.durationSec}s · {row.fps}fps{row.sizeBytes ? ` · ${(row.sizeBytes / 1048576).toFixed(1)}MB` : ""}</span>
      </div>
      {row.error && <p className="text-xs text-hold">{row.error}</p>}
    </div>
  );
}

/** The conversion told as a console log, stage by stage, from the job's progress. */
function JobProgress({ row }: { row: Row }) {
  const retry = trpc.codeVideos.retry.useMutation();
  const frames = row.durationSec * row.fps;
  const shot = Math.min(frames, Math.round((Math.min(row.progress, 95) / 95) * frames));
  const lines: { t: string; cls?: string }[] = (row.agentLog ?? []).slice(-12).map(t => ({ t, cls: t.includes("✗") ? "err" : t.includes("✓") ? "ok" : undefined }));
  if (row.status !== "writing" && row.status !== "analyzing") lines.push({ t: `$ code2video --size ${row.width}x${row.height} --duration ${row.durationSec}s --fps ${row.fps}${row.segments > 1 ? ` --segments ${row.segments}` : ""}`, cls: "dim" });
  if (row.status === "draft") lines.push({ t: "› written — review it in the editor, then press convert" });
  if (row.status === "queued") lines.push({ t: "› waiting in queue…" });
  if (row.status === "running" || (row.status === "failed" && !(row.agentLog ?? []).some(l => l.includes("✗")))) {
    lines.push({ t: "› spawning isolated Chromium (clean env, CSP, allow-list)" }, { t: "› injecting virtual clock: Date · performance · rAF · CSS animations" });
    if (row.progress > 0) lines.push({ t: `› capturing frame ${shot}/${frames}  [${"█".repeat(Math.round(row.progress / 5))}${"░".repeat(20 - Math.round(row.progress / 5))}] ${row.progress}%` });
    if (row.progress >= 95) lines.push({ t: "› encoding H.264 · yuv420p · veryfast" });
  }
  if (row.status === "failed" && !lines.some(l => l.cls === "err")) lines.push({ t: `✗ ${row.error ?? "failed"}`, cls: "err" });
  return (
    <div className="mt-3 flex flex-col gap-3" aria-live="polite">
      <div className="flex items-center justify-between" dir="rtl">
        <Tally tone={TONE[row.status]} live={["running", "writing", "analyzing"].includes(row.status)} label={CODE_VIDEO_STATUS_LABELS[row.status]} />
        {row.status === "running" && <span className="num text-xs text-muted-foreground">{row.progress}%</span>}
      </div>
      {!["writing", "draft", "analyzing"].includes(row.status) && <Progress value={row.status === "queued" ? 0 : row.progress} />}
      <div className="cv-log rounded-lg bg-black/60 p-3">
        {lines.map((l, i) => (
          <div key={i} className={cn("break-all", l.cls)}>
            {l.t}
            {i === lines.length - 1 && row.status !== "failed" && row.status !== "draft" && <span className="cv-cursor" aria-hidden />}
          </div>
        ))}
      </div>
      {row.status === "failed" && (
        <Button size="sm" variant="outline" className="self-start" onClick={() => retry.mutate({ id: row.id })}><RefreshCw /> إعادة المحاولة</Button>
      )}
    </div>
  );
}

function HistoryCard({ row, active, onOpen }: { row: Row; active: boolean; onOpen: () => void }) {
  const utils = trpc.useUtils();
  const remove = trpc.codeVideos.remove.useMutation({ onSuccess: () => utils.codeVideos.list.invalidate(), onError: e => toast.error(e.message) });
  return (
    <div className={cn("panel overflow-hidden", active && "border-tally")}>
      <button type="button" onClick={onOpen} className="block w-full bg-black" style={{ aspectRatio: `${row.width} / ${row.height}`, maxHeight: 260 }} aria-label={`فتح ${row.title}`}>
        {row.posterUrl ? <img src={row.posterUrl} alt="" className="h-full w-full object-contain" loading="lazy" /> : <div className="grid h-full w-full place-items-center text-muted-foreground"><Film /></div>}
      </button>
      <div className="flex flex-col gap-1.5 p-2.5">
        <div className="truncate text-[13px] font-semibold" title={row.title}>{row.title}</div>
        <div className="flex items-center justify-between gap-2">
          <Tally tone={TONE[row.status]} live={["running", "writing", "analyzing"].includes(row.status)} label={row.status === "running" ? `${row.progress}%` : CODE_VIDEO_STATUS_LABELS[row.status]} />
          <span className="num text-[11px] text-muted-foreground">{row.width}×{row.height} · {formatDuration(row.durationSec)}</span>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" className="flex-1" onClick={onOpen}><Code2 /> فتح</Button>
          {row.videoUrl && <Button asChild size="icon-sm" variant="ghost" aria-label="تحميل"><a href={row.videoUrl} download={`code-video-${row.id}.mp4`}><Download /></a></Button>}
          <Button size="icon-sm" variant="ghost" aria-label="حذف" onClick={() => confirm("حذف هذا التحويل من القائمة؟ (الفيديو يبقى في مكتبة الأصول)") && remove.mutate({ id: row.id })}><Trash2 /></Button>
        </div>
      </div>
    </div>
  );
}

type Engines = RouterOutputs["codeVideos"]["engines"] | undefined;
const LANGS = [
  { id: "ar", label: "عربي" },
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
  { id: "es", label: "Español" },
  { id: "auto", label: "تلقائي" },
] as const;

/** "On your video": pick or upload a clip, say what to add; the agent watches it, then writes the animation on top. */
function OverlayPanel(props: { engine: CodeAgentEngine; setEngine: (e: CodeAgentEngine) => void; engines: Engines; auto: boolean; setAuto: (v: boolean) => void; fps: 30 | 60; setFps: (f: 30 | 60) => void; onStarted: (id: number) => void }) {
  const utils = trpc.useUtils();
  const videos = trpc.codeVideos.sourceVideos.useQuery();
  const [assetId, setAssetId] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");
  const [transcriber, setTranscriber] = useState<TranscriberId>("local");
  const [language, setLanguage] = useState<(typeof LANGS)[number]["id"]>("ar");
  const [uploading, setUploading] = useState(false);
  const start = trpc.codeVideos.overlayStart.useMutation({ onSuccess: r => { props.onStarted(r.id); toast.success("الوكيل يشاهد الفيديو ويفهمه…"); }, onError: e => toast.error(e.message) });
  const list = videos.data ?? [];
  const chosen = list.find(v => v.id === assetId) ?? null;

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const meta = await new Promise<{ d: number; w: number; h: number }>(resolve => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => resolve({ d: v.duration * 1000, w: v.videoWidth, h: v.videoHeight });
        v.onerror = () => resolve({ d: 0, w: 0, h: 0 });
        v.src = URL.createObjectURL(file);
      });
      const type = file.type || "video/mp4";
      const r = await uploadBlob(file.type ? file : new Blob([file], { type }), { kind: "broll", filename: file.name, title: file.name.replace(/\.[^.]+$/, ""), durationMs: meta.d || undefined, width: meta.w || undefined, height: meta.h || undefined });
      await utils.codeVideos.sourceVideos.invalidate();
      setAssetId(r.id);
      toast.success("رُفع الفيديو");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر رفع الفيديو");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="cv-term" aria-label="على فيديوك">
      <div className="cv-bar">
        <Bot className="size-3.5" />
        <span className="truncate">agent@reellllocal:~# watch --video && write --overlay</span>
      </div>
      <div className="flex flex-col gap-4 p-4" dir="rtl">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">الفيديو</span>
          <div className="flex flex-wrap items-center gap-2">
            <select value={assetId ?? ""} onChange={ev => setAssetId(ev.target.value ? Number(ev.target.value) : null)} className="h-9 min-w-0 flex-1 rounded-md border border-border bg-black/40 px-2 text-sm" aria-label="اختر فيديو من المكتبة">
              <option value="">اختر من المكتبة…</option>
              {list.map(v => (
                <option key={v.id} value={v.id}>{(v.title ?? `فيديو #${v.id}`).slice(0, 60)}{v.durationMs ? ` · ${formatDuration(Math.round(v.durationMs / 1000))}` : ""}</option>
              ))}
            </select>
            <Button asChild variant="outline" size="sm" disabled={uploading}>
              <label className="cursor-pointer">
                <Upload /> {uploading ? "يرفع…" : "ارفع فيديوك"}
                <input type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" onChange={ev => { const f = ev.target.files?.[0]; if (f) void upload(f); ev.target.value = ""; }} />
              </label>
            </Button>
          </div>
          {chosen && <video src={chosen.url} controls playsInline className="mt-2 max-h-56 self-start rounded-lg bg-black" />}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="overlay-instruction" className="text-xs text-muted-foreground">ماذا تريد فوقه — ترجمة الكلام، عناوين، تأكيد الكلمات المهمة، أسهم، أرقام…</Label>
          <Textarea id="overlay-instruction" value={instruction} onChange={ev => setInstruction(ev.target.value)} placeholder="مثال: ترجمة كلامي كلمة بكلمة أسفل الشاشة بالأصفر، عنوان كبير في أول ثانيتين، وعند كل رقم أقوله يظهر الرقم كبيرًا بجانبي" className="min-h-[96px] resize-y bg-black/40 p-3 text-sm leading-6" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">تفريغ الكلام</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="التفريغ">
              {TRANSCRIBERS.map(t => <Chip key={t} on={transcriber === t} onClick={() => setTranscriber(t)}>{TRANSCRIBER_LABELS[t]}</Chip>)}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">لغة الكلام</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="اللغة">
              {LANGS.map(l => <Chip key={l.id} on={language === l.id} onClick={() => setLanguage(l.id)}>{l.label}</Chip>)}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">من يشاهد ويكتب</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="المحرّك">
            {CODE_AGENT_ENGINES.map(en => {
              const ok = en === "api" ? props.engines?.api : props.engines?.claudeCode;
              return <Chip key={en} on={props.engine === en} onClick={() => props.setEngine(en)}>{CODE_AGENT_ENGINE_LABELS[en]}{ok === false ? " — غير متاح" : ""}</Chip>;
            })}
          </div>
          <span className="text-[11px] text-muted-foreground">المقاس يتبع شكل فيديوك (عمودي 1080×1920، أفقي 1920×1080، مربع 1080×1080)، وصوته يبقى كما هو.</span>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <Button disabled={!assetId || start.isPending} onClick={() => assetId && start.mutate({ assetId, instruction, engine: props.engine, transcriber, language, fps: props.fps, autoConvert: props.auto })}>
            <Bot /> حلّل واكتب فوقه
          </Button>
          <div className="flex gap-1.5" role="radiogroup" aria-label="الفريمات">
            {CODE_VIDEO_FPS.map(f => <Chip key={f} on={props.fps === f} onClick={() => props.setFps(f)}>{f}fps</Chip>)}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={props.auto} onCheckedChange={props.setAuto} aria-label="ركّب مباشرة بعد الكتابة" /> ركّب مباشرة بعد الكتابة
          </label>
        </div>
      </div>
    </div>
  );
}

/** What the agent understood: scenes with what is seen, and the speech with its timings. */
function VideoMapView({ id }: { id: number }) {
  const q = trpc.codeVideos.get.useQuery({ id }, { staleTime: 30_000 });
  const map = (q.data?.analysis as { map?: { scenes: { index: number; start: number; end: number; summary: string }[]; sentences: { start: number; end: number; text: string }[]; frames: { t: number; what: string; free: string[] }[] } } | null)?.map;
  if (!map) return null;
  const ts = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return (
    <details className="mt-3 rounded-lg border border-border bg-black/40 p-3 text-sm" open>
      <summary className="cursor-pointer text-xs text-muted-foreground">ما فهمه الوكيل من الفيديو — {map.scenes.length} مشهد · {map.sentences.length} جملة · {map.frames.length} لقطة</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold">المشاهد</div>
          {map.scenes.map(sc => (
            <div key={sc.index} className="flex gap-2 text-[13px] leading-6">
              <span className="num shrink-0 text-tally" dir="ltr">{ts(sc.start)}–{ts(sc.end)}</span>
              <span className="text-muted-foreground">{sc.summary}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold">الكلام</div>
          {map.sentences.length ? map.sentences.map((s2, i) => (
            <div key={i} className="flex gap-2 text-[13px] leading-6">
              <span className="num shrink-0 text-tally" dir="ltr">{ts(s2.start)}</span>
              <span>{s2.text}</span>
            </div>
          )) : <span className="text-muted-foreground">لا كلام في الفيديو</span>}
        </div>
      </div>
    </details>
  );
}

/** What «افحص الكود» measured: problems with numbers, frames at sample times, and the message to paste back. */
function InspectPanel({ data, onUndo, onClose }: { data: { result: CodeInspection; fixedFrom?: { html: string; before: CodeIssue[] } }; onUndo?: () => void; onClose: () => void }) {
  const r = data.result;
  const errors = r.issues.filter(i => i.severity === "error").length;
  const warns = r.issues.length - errors;
  return (
    <div className="cv-term" aria-label="نتيجة الفحص">
      <div className="cv-bar">
        <ScanSearch className="size-3.5" />
        <span className="truncate">inspect animation.html — {errors} errors · {warns} warnings{r.timelineSec !== null ? ` · timeline ${r.timelineSec.toFixed(1)}s` : ""}</span>
        <button type="button" onClick={onClose} className="ms-auto text-[11px] opacity-70 hover:opacity-100">إغلاق</button>
      </div>
      <div className="flex flex-col gap-3 p-4" dir="rtl">
        {data.fixedFrom && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="cv-chip"><Sparkles className="size-3.5" /> أصلحه Claude: {data.fixedFrom.before.length} مشكلة قبل ← {r.issues.length} بعد</span>
            {onUndo && <Button size="sm" variant="ghost" onClick={onUndo}><Undo2 /> رجّع الأصلي</Button>}
          </div>
        )}
        {r.issues.length === 0 ? (
          <div className="flex items-center gap-2 text-sm"><CircleCheck className="size-4 text-tally" /> لا مشاكل فيما فحصته: المدة، الأخطاء، الإطار، التراكب، حجم النص، العربي، الحركة.</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {r.issues.map((i, n) => (
              <li key={n} className="flex gap-2 text-[13px] leading-6">
                {i.severity === "error" ? <CircleAlert className="mt-1 size-4 shrink-0 text-[var(--stop,#ff5a4f)]" aria-label="خطأ" /> : <TriangleAlert className="mt-1 size-4 shrink-0 text-amber-400" aria-label="ملاحظة" />}
                <span className="min-w-0 break-words">{i.message}</span>
              </li>
            ))}
          </ul>
        )}
        {r.stills.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="لقطات من الفيديو">
            {r.stills.map((src, n) => (
              <figure key={n} className="shrink-0">
                <img src={src} alt={`لقطة عند ${r.stillTimes[n]} ثانية`} className="h-40 w-auto rounded-md border border-border" loading="lazy" />
                <figcaption className="num mt-1 text-center text-[10px] text-muted-foreground">{r.stillTimes[n]}s</figcaption>
              </figure>
            ))}
          </div>
        )}
        {r.fixPrompt && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <CopyButton text={r.fixPrompt} label="انسخ رسالة الإصلاح" variant="secondary" />
            <span className="text-[11px] leading-5 text-muted-foreground">ألصقها في Gemini أو DeepSeek مع نفس المحادثة، أو اضغط «أصلحه لي».</span>
          </div>
        )}
      </div>
    </div>
  );
}
