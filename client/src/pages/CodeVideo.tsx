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
  codeVideoPrompt,
  codeVideoSize,
  estimateAgentUsd,
  formatDuration,
  segmentCount,
  withCodeVideoCsp,
  type CodeAgentEngine,
  type CodeVideoSizeId,
} from "@shared/code-video";
import { Switch } from "@/components/ui/switch";
import { Bot, Code2, Download, Eye, Film, Lock, RefreshCw, Scissors, ShieldCheck, Terminal, Trash2, Wand2, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { CopyButton, EmptyBlock, PageHeader, Tally, type RouterOutputs } from "@/components/fab/common";

type Row = RouterOutputs["codeVideos"]["list"][number];
const TONE: Record<string, "go" | "hold" | "stop" | "idle"> = { writing: "hold", draft: "idle", queued: "idle", running: "hold", done: "go", failed: "stop" };
const DRAFT_KEY = "code-video-draft";

function readDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") as { html?: string; size?: CodeVideoSizeId; duration?: number; fps?: 30 | 60; idea?: string; engine?: CodeAgentEngine; auto?: boolean } | null;
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
  const size = codeVideoSize(sizeId);
  const seconds = Math.round(Number(duration));
  const durationOk = Number.isFinite(seconds) && seconds >= 1 && seconds <= CODE_VIDEO_MAX_SECONDS;
  const parts = durationOk ? segmentCount(seconds) : 1;

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ html, size: sizeId, duration: seconds, fps, idea, engine, auto })); } catch { /* private mode */ }
    }, 400);
    return () => clearTimeout(t);
  }, [html, sizeId, seconds, fps, idea, engine, auto]);

  const utils = trpc.useUtils();
  const engines = trpc.codeVideos.engines.useQuery(undefined, { staleTime: 60_000 });
  useEffect(() => {
    const e = engines.data;
    if (!e) return;
    if (engine === "claude-code" && !e.claudeCode && e.api) setEngine("api");
    if (engine === "api" && !e.api && e.claudeCode) setEngine("claude-code");
  }, [engines.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = trpc.codeVideos.list.useQuery(undefined, {
    refetchInterval: q => ((q.state.data ?? []).some(r => ["queued", "running", "writing"].includes(r.status)) ? 1500 : 10000),
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

  const startPreview = () => {
    if (html.trim().length < 20) return toast.error("ألصق ملف HTML أولًا");
    setPreview({ html: withCodeVideoCsp(html), key: Date.now() });
  };
  const startConvert = () => {
    if (html.trim().length < 20) return toast.error("ألصق ملف HTML أولًا");
    if (!durationOk) return toast.error("اختر مدة بين ثانية و40 دقيقة");
    if (current && current.status === "draft") return queueDraft.mutate({ id: current.id, html: current.segments > 1 ? undefined : html });
    convert.mutate({ html, size: sizeId, durationSec: seconds, fps });
  };
  const startAgent = () => {
    if (idea.trim().length < 8) return toast.error("اكتب الفكرة بجملة على الأقل");
    if (!durationOk) return toast.error("اختر مدة بين ثانية و40 دقيقة");
    agent.mutate({ idea, size: sizeId, durationSec: seconds, fps, engine, autoConvert: auto });
  };
  const e = engines.data;

  return (
    <div>
      <PageHeader
        title="كود ← فيديو"
        subtitle="اكتب الفكرة فيكتب الوكيل الأنيميشن، أو ألصق ملف HTML من أي ذكاء اصطناعي. يتحول إلى MP4 فريمًا بفريم حتى 40 دقيقة، مجانًا على جهازك، والكود يشتغل معزولًا بلا وصول للاستوديو أو مفاتيحه. الفيديو يدخل مكتبة الأصول لتستعمله غرفة المونتاج."
        actions={<CopyButton text={codeVideoPrompt(size.width, size.height, durationOk ? seconds : 15)} label="نسخ قالب الطلب" variant="secondary" />}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <section className="flex min-w-0 flex-col gap-4" aria-label="الكود والإعدادات">
          <div className="flex flex-wrap gap-1.5" aria-label="العزل">
            <span className="cv-chip"><ShieldCheck className="size-3.5" /> يشتغل معزولًا</span>
            <span className="cv-chip"><WifiOff className="size-3.5" /> الشبكة: CDN والخطوط فقط</span>
            <span className="cv-chip"><Lock className="size-3.5" /> بلا وصول لمفاتيح الاستوديو</span>
          </div>

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
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">الفريمات</span>
                <div className="flex gap-1.5" role="radiogroup" aria-label="الفريمات في الثانية">
                  {CODE_VIDEO_FPS.map(f => <Chip key={f} on={fps === f} onClick={() => setFps(f)}>{f}</Chip>)}
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
              <Button onClick={startConvert} disabled={convert.isPending || queueDraft.isPending}><Wand2 /> تحويل لفيديو</Button>
              {current?.segments && current.segments > 1 ? <span className="self-center text-[11px] text-muted-foreground">فيديو من {current.segments} مقطعًا — المحرر يعرض المقطع الأول</span> : null}
            </div>
          </div>
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
            </div>
          </div>
        </section>
      </div>

      <h2 className="mb-3 mt-10 font-display text-lg font-semibold">التحويلات السابقة</h2>
      {list.isLoading ? (
        <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
      ) : rows.length === 0 ? (
        <EmptyBlock title="لا توجد فيديوهات من الكود بعد">اكتب فكرة للوكيل، أو انسخ قالب الطلب وأعطه لأي ذكاء اصطناعي ثم ألصق الملف الذي يكتبه هنا.</EmptyBlock>
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
  if (row.status !== "writing") lines.push({ t: `$ code2video --size ${row.width}x${row.height} --duration ${row.durationSec}s --fps ${row.fps}${row.segments > 1 ? ` --segments ${row.segments}` : ""}`, cls: "dim" });
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
        <Tally tone={TONE[row.status]} live={row.status === "running" || row.status === "writing"} label={CODE_VIDEO_STATUS_LABELS[row.status]} />
        {row.status === "running" && <span className="num text-xs text-muted-foreground">{row.progress}%</span>}
      </div>
      {row.status !== "writing" && row.status !== "draft" && <Progress value={row.status === "queued" ? 0 : row.progress} />}
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
          <Tally tone={TONE[row.status]} live={row.status === "running" || row.status === "writing"} label={row.status === "running" ? `${row.progress}%` : CODE_VIDEO_STATUS_LABELS[row.status]} />
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
