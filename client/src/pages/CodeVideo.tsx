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
  AGENT_MODES,
  AGENT_MODE_LABELS,
  type AgentMode,
  pageFromPasted,
  storyboardPrompt,
  SOUND_MODES,
  SOUND_MODE_LABELS,
  SOUND_MOODS,
  SOUND_MOOD_LABELS,
  type SoundModeId,
  type SoundMoodId,
} from "@shared/code-video";
import { VIDEO_KINDS, CRITIC_RUBRIC, type VideoKind } from "@shared/code-craft/knowledge";
import { looksLikeStoryboard, type Storyboard } from "@shared/code-craft/storyboard";
import { TEMPLATE_CATEGORIES, VIDEO_TEMPLATES, findTemplate, templateScenario, templateSeconds, templateStoryboard, type VideoTemplate } from "@shared/code-craft/templates";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Clapperboard, LayoutTemplate, X as XIcon, Bot, CircleAlert, CircleCheck, Code2, Download, Eye, Film, Image as ImageIcon, Lock, Map as MapIcon, RefreshCw, ScanSearch, Scissors, Search, ShieldCheck, Shuffle, Sparkles, Terminal, Trash2, TriangleAlert, Undo2, Upload, Wand2, WifiOff } from "lucide-react";
import { uploadBlob } from "@/lib/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { CopyButton, EmptyBlock, PageHeader, Tally, type RouterOutputs } from "@/components/fab/common";
import { CinemaDialog } from "@/components/fab/CinemaDialog";

type Row = RouterOutputs["codeVideos"]["list"][number];
const TONE: Record<string, "go" | "hold" | "stop" | "idle"> = { analyzing: "hold", writing: "hold", draft: "idle", queued: "idle", running: "hold", done: "go", failed: "stop" };
const DRAFT_KEY = "code-video-draft";

function readDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") as { html?: string; size?: CodeVideoSizeId; duration?: number; fps?: 30 | 60; idea?: string; engine?: CodeAgentEngine; auto?: boolean; styleId?: StyleRecipeId | ""; quality?: RenderQuality; agentMode?: AgentMode; kind?: VideoKind | ""; accent?: string; sound?: SoundModeId; mood?: SoundMoodId | ""; musicAssetId?: number | null; stock?: boolean; library?: boolean; templateId?: string } | null;
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
  const [agentMode, setAgentMode] = useState<AgentMode>(draft?.agentMode ?? "compose");
  const [kind, setKind] = useState<VideoKind | "">(draft?.kind ?? "");
  const [accent, setAccent] = useState(draft?.accent ?? "");
  const [sound, setSound] = useState<SoundModeId>(draft?.sound ?? "auto");
  const [mood, setMood] = useState<SoundMoodId | "">(draft?.mood ?? "");
  const [musicAssetId, setMusicAssetId] = useState<number | null>(draft?.musicAssetId ?? null);
  // Pictures: free photos/clips only when switched on; the owner's library likewise.
  const [stock, setStock] = useState(draft?.stock ?? false);
  const [library, setLibrary] = useState(draft?.library ?? false);
  const [slots, setSlots] = useState<MediaSlotView[]>([]);
  // A ready-made template: fixed structure and style; the idea box holds its scenario.
  const [templateId, setTemplateId] = useState<string>(draft?.templateId ?? "");
  const [cinemaOpen, setCinemaOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const template = findTemplate(templateId);
  const [credits, setCredits] = useState<string[]>([]);
  const [inspection, setInspection] = useState<{ result: CodeInspection; fixedFrom?: { html: string; before: CodeIssue[] } } | null>(null);
  const size = codeVideoSize(sizeId);
  const seconds = Math.round(Number(duration));
  const durationOk = Number.isFinite(seconds) && seconds >= 1 && seconds <= CODE_VIDEO_MAX_SECONDS;
  const parts = durationOk ? segmentCount(seconds) : 1;

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ html, size: sizeId, duration: seconds, fps, idea, engine, auto, styleId, quality, agentMode, kind, accent, sound, mood, musicAssetId, stock, library, templateId })); } catch { /* private mode */ }
    }, 400);
    return () => clearTimeout(t);
  }, [html, sizeId, seconds, fps, idea, engine, auto, styleId, quality, agentMode, kind, accent, sound, mood, musicAssetId, stock, library, templateId]);
  const tracks = trpc.codeVideos.musicTracks.useQuery(undefined, { staleTime: 60_000 });
  const soundOpts = { sound, mood: mood || undefined, musicAssetId: sound !== "off" && musicAssetId ? musicAssetId : undefined };
  const mediaOpts = { stock, library };

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
      void utils.codeVideos.get.fetch({ id: current.id }).then(full => {
        if (!full.html) return;
        setHtml(full.html);
        // A storyboard with pictures or maps: show it with them, and the strip to swap any picture before export.
        if (current.status === "draft" && /id="cv-storyboard"/.test(full.html) && /"media"|"type":"photo"/.test(full.html)) previewMut.mutate({ html: full.html, size: sizeId, durationSec: full.durationSec, ...mediaOpts });
      });
    }
  }, [current, utils]);

  const done = () => void utils.codeVideos.list.invalidate();
  type MediaResult = { html: string; preview: string; slots: MediaSlotView[]; notes: string[]; issues: string[]; credits: string[] };
  const showMedia = (r: MediaResult) => {
    setHtml(r.html);
    setSlots(r.slots);
    setCredits(r.credits);
    setPreview({ html: withCodeVideoCsp(r.preview), key: Date.now() });
    if (r.notes.length) toast.warning(r.notes.slice(0, 2).join(" · "));
  };
  const previewMut = trpc.codeVideos.preview.useMutation({ onSuccess: r => { showMedia(r); if (r.issues.length) toast.warning(`القصة شُغّلت مع ${r.issues.length} ملاحظة: ${r.issues[0]}`); }, onError: e => toast.error(e.message) });
  const swapMut = trpc.codeVideos.swapMedia.useMutation({ onSuccess: r => { showMedia(r); toast.success("تبدّلت الصورة"); }, onError: e => toast.error(e.message) });
  const swap = (slot: MediaSlotView, change: { query?: string; asset?: number; remove?: boolean }) =>
    swapMut.mutate({ html, size: sizeId, durationSec: durationOk ? seconds : 15, styleId: styleId || undefined, stock: true, library, slot: { scene: slot.scene, item: slot.item }, ...change });
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
  const startInspect = () => pasted() && inspect.mutate({ html, size: sizeId, durationSec: seconds, ...mediaOpts });
  const startFix = () => pasted() && fix.mutate({ html, size: sizeId, durationSec: seconds, engine, styleId: styleId || undefined, ...mediaOpts });

  const startPreview = () => {
    if (html.trim().length < 20) return toast.error("ألصق ملف HTML أو قصة JSON أولًا");
    if (looksLikeStoryboard(html) || /id="cv-storyboard"/.test(html)) {
      previewMut.mutate({ html, size: sizeId, durationSec: durationOk ? seconds : 15, styleId: styleId || undefined, ...mediaOpts });
      return;
    }
    try {
      const page = pageFromPasted(html, size.width, size.height, durationOk ? seconds : 15, styleId || null);
      if (page.issues.length) toast.warning(`القصة شُغّلت مع ${page.issues.length} ملاحظة: ${page.issues[0]}`);
      setSlots([]);
      setPreview({ html: withCodeVideoCsp(page.html), key: Date.now() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };
  const startConvert = () => {
    if (html.trim().length < 20) return toast.error("ألصق ملف HTML أولًا");
    if (!durationOk) return toast.error("اختر مدة بين ثانية و40 دقيقة");
    if (current && current.status === "draft") return queueDraft.mutate({ id: current.id, html: current.segments > 1 ? undefined : html });
    convert.mutate({ html, size: sizeId, durationSec: seconds, fps, quality, ...soundOpts, ...mediaOpts });
  };
  const startAgent = () => {
    if (idea.trim().length < 8) return toast.error("اكتب الفكرة بجملة على الأقل");
    if (!durationOk) return toast.error("اختر مدة بين ثانية و40 دقيقة");
    agent.mutate({ idea, size: sizeId, durationSec: seconds, fps, engine, autoConvert: auto, styleId: styleId || undefined, quality, mode: agentMode, kind: kind || undefined, accent: /^#[\da-f]{6}$/i.test(accent) ? accent : undefined, ...soundOpts, ...mediaOpts, templateId: template && agentMode === "compose" ? template.id : undefined });
  };
  /** Picks a template: its length, music and pictures; its scenario sheet in the idea box; its layout in the preview. */
  const chooseTemplate = (t: VideoTemplate) => {
    setTemplateId(t.id);
    setGalleryOpen(false);
    setMode("idea");
    setAgentMode("compose");
    setStyleId("");
    setKind(t.kind);
    setMood(t.mood);
    setSound("auto");
    const sec = templateSeconds(t);
    setDuration(String(sec));
    if (t.pictures) setStock(true);
    if (!idea.trim() || /^الموضوع:/.test(idea.trim())) setIdea(templateScenario(t));
    const json = JSON.stringify(templateStoryboard(t), null, 2);
    setHtml(json);
    previewMut.mutate({ html: json, size: sizeId, durationSec: sec, stock: t.pictures || stock, library });
    toast.success(`القالب «${t.name}» جاهز — املأ السيناريو ثم «اكتب بالوكيل» أو انسخ الطلب لذكاء مجاني`);
  };
  const e = engines.data;

  return (
    <div>
      <TemplateGallery open={galleryOpen} onOpenChange={setGalleryOpen} current={templateId} onPick={chooseTemplate} />
      <CinemaDialog open={cinemaOpen} onOpenChange={setCinemaOpen} />
      <PageHeader
        title="كود ← فيديو"
        subtitle="اكتب الفكرة فيخرجها الوكيل بمكتبة قطع مجرَّبة، أو انسخ «قالب القصة» لأي ذكاء اصطناعي مجاني (DeepSeek، Gemini…) وألصق القصة JSON التي يكتبها، أو ألصق ملف HTML كاملًا. يتحول إلى MP4 فريمًا بفريم حتى 40 دقيقة، مجانًا على جهازك، والكود يشتغل معزولًا بلا وصول للاستوديو أو مفاتيحه. الفيديو يدخل مكتبة الأصول لتستعمله غرفة المونتاج."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setCinemaOpen(true)} className="bg-tally font-bold text-black hover:bg-tally/90"><Clapperboard /> ريل سينمائي بصوت</Button>
            <Button onClick={() => setGalleryOpen(true)} variant="outline"><LayoutTemplate /> القوالب الجاهزة ({VIDEO_TEMPLATES.length})</Button>
            <CopyButton text={storyboardPrompt(size.width, size.height, durationOk ? seconds : 15, styleId || null, idea.trim() || undefined, kind || undefined, { stock }, templateId || null)} label="نسخ قالب القصة (JSON)" variant="default" />
            <CopyButton text={strongPrompt(size.width, size.height, durationOk ? seconds : 15, styleId || "documentary", idea.trim() || undefined)} label="نسخ قالب الكود (HTML)" variant="secondary" />
          </div>
        }
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
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">الصوت — مؤثرات تتبع كل حركة (رنين، صفير، ضربة، فرقعة…) وموسيقى تناسب الموضوع، بلا كلام</span>
              <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="الصوت">
                {SOUND_MODES.map(m => <Chip key={m} on={sound === m} onClick={() => setSound(m)}>{SOUND_MODE_LABELS[m]}</Chip>)}
              </div>
              {sound !== "off" && (
                <>
                  <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="مزاج الموسيقى">
                    <Chip on={mood === ""} onClick={() => setMood("")} title="المخرج يختار حسب الموضوع، أو حسب الأسلوب">يختار المخرج</Chip>
                    {SOUND_MOODS.map(m => <Chip key={m} on={mood === m} onClick={() => setMood(m)}>{SOUND_MOOD_LABELS[m]}</Chip>)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <label htmlFor="cv-music" className="shrink-0">الموسيقى:</label>
                    <select id="cv-music" value={musicAssetId ?? ""} onChange={ev => setMusicAssetId(ev.target.value ? Number(ev.target.value) : null)} className="h-8 min-w-0 max-w-full flex-1 rounded-md border border-border bg-black/40 px-2 text-xs">
                      <option value="">مولّدة على جهازك حسب المزاج (مجانية)</option>
                      {(tracks.data ?? []).map(t => <option key={t.id} value={t.id}>{(t.title ?? `مقطع #${t.id}`).slice(0, 60)}</option>)}
                    </select>
                  </div>
                  <span className="text-[11px] leading-5 text-muted-foreground">الصوت يُضاف عند التحويل إلى MP4؛ المعاينة في المتصفح صامتة.</span>
                </>
              )}
            </div>
            <MediaSettings stock={stock} setStock={setStock} library={library} setLibrary={setLibrary} />
          </div>

          <div className="cv-term" aria-label="الوكيل">
            <div className="cv-bar">
              <Bot className="size-3.5" />
              <span className="truncate">agent@reellllocal:~# write --from-idea</span>
            </div>
            <div className="flex flex-col gap-3 p-4" dir="rtl">
              <TemplateBar template={template} onOpen={() => setGalleryOpen(true)} onClear={() => { setTemplateId(""); if (/^الموضوع:/.test(idea.trim())) setIdea(""); }} />
              <Label htmlFor="code-video-idea" className="text-xs text-muted-foreground">{template ? "السيناريو — املأ ما بعد كل نقطتين (الأرقام والأسماء والمصادر منك)" : "الفكرة — ماذا يظهر في الفيديو، بأي أسلوب، بأي لغة"}</Label>
              <Textarea id="code-video-idea" value={idea} onChange={ev => setIdea(ev.target.value)} placeholder="مثال: فيديو يشرح كيف يأكل التضخم الرواتب، أسلوب وثائقي داكن بالأحمر، أرقام كبيرة متحركة، بالعربية" className={cn("resize-y bg-black/40 p-3 text-sm leading-6", template ? "min-h-[260px]" : "min-h-[96px]")} />
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">طريقة العمل</span>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="طريقة عمل الوكيل">
                  {AGENT_MODES.map(m => (
                    <Chip key={m} on={agentMode === m} onClick={() => setAgentMode(m)} title={m === "compose" ? "المخرج يكتب القصة مشهدًا مشهدًا، وتُبنى بمكتبة قطع مجرَّبة، ثم ناقد يقيّمها ويحسّنها حتى 8/10" : "الوكيل يكتب الأنيميشن كله بالكود — لأفكار غير معتادة"}>
                      {AGENT_MODE_LABELS[m]}
                    </Chip>
                  ))}
                </div>
              </div>
              {agentMode === "compose" && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">نوع الفيديو — يحدد الإيقاع والبناء</span>
                  <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="نوع الفيديو">
                    <Chip on={kind === ""} onClick={() => setKind("")} title="يُستنتج من الفكرة والمدة">يختار الوكيل</Chip>
                    {VIDEO_KINDS.map(k => <Chip key={k.id} on={kind === k.id} onClick={() => setKind(k.id)} title={k.hint}>{k.label}</Chip>)}
                    <label className="ms-1 flex items-center gap-1.5 text-[11px] text-muted-foreground" title="لون علامتك يصبح لون التأكيد في الفيديو">
                      <input type="checkbox" checked={Boolean(accent)} onChange={ev => setAccent(ev.target.checked ? "#ff3b30" : "")} className="accent-current" /> لون العلامة
                      {accent && <input type="color" value={accent} onChange={ev => setAccent(ev.target.value)} aria-label="لون العلامة" className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent" />}
                    </label>
                  </div>
                </div>
              )}
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
              <span className="ms-auto num">{looksLikeStoryboard(html) ? "storyboard.json · " : ""}{html.length.toLocaleString("en")} chars</span>
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
              placeholder={"<!doctype html> … أو قصة JSON:\n{ \"theme\": \"documentary\", \"scenes\": [ … ] }"}
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
              {slots.length > 0 && current?.status !== "done" && <MediaStrip slots={slots} credits={credits} busy={swapMut.isPending || previewMut.isPending} onSwap={swap} />}
              {previewMut.isPending && <p className="mt-2 text-xs text-muted-foreground">يجلب الصور ويرسم الخرائط…</p>}
              {current && current.status !== "done" && <JobProgress row={current} />}
              {current?.sourceKey && !["analyzing"].includes(current.status) && <VideoMapView id={current.id} />}
              {current && !current.sourceKey && !["writing", "analyzing"].includes(current.status) && <StoryboardView id={current.id} />}
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
          <Label htmlFor="overlay-instruction" className="text-xs text-muted-foreground">ماذا تريد فوقه؟ يكفي سطر: المونتير يختار وحده جملًا مختصرة تظهر لحظة نطق الكلمة، وعدّادات للأرقام، وأيقونات تُرسم، وقوائم، وتقريب الكاميرا على الوجه، وترجمة بتوقيت كل كلمة، ومؤثرات صوتية خفيفة، دون أن يغطي الوجه</Label>
          <Textarea id="overlay-instruction" value={instruction} onChange={ev => setInstruction(ev.target.value)} placeholder="مثال: مونتاج قوي لريل إنستغرام، اسمها سارة — مدربة تسويق، لون ذهبي، بدون ترجمة كاملة لأن الفيديو فيه ترجمة" className="min-h-[96px] resize-y bg-black/40 p-3 text-sm leading-6" />
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

/** The director's storyboard and the critic's scores, round by round. */
function StoryboardView({ id }: { id: number }) {
  const q = trpc.codeVideos.get.useQuery({ id }, { staleTime: 30_000 });
  const a = q.data?.analysis as { storyboard?: Storyboard; reviews?: { round: number; overall: number; scores: Record<string, number>; issues: string[]; measured: string[] }[] } | null | undefined;
  const sb = a?.storyboard;
  const reviews = a?.reviews ?? [];
  if (!sb && !reviews.length) return null;
  const best = reviews.reduce<(typeof reviews)[number] | null>((b, r) => (!b || r.overall > b.overall ? r : b), null);
  const describe = (it: Record<string, unknown>) => {
    const t = String(it.type);
    const txt = typeof it.text === "string" ? it.text : Array.isArray(it.lines) ? (it.lines as string[]).join(" / ") : t === "stat" ? `${it.prefix ?? ""}${it.value}${it.suffix ?? ""} ${it.label ?? ""}` : Array.isArray(it.items) ? `${(it.items as unknown[]).length} عناصر` : Array.isArray(it.events) ? `${(it.events as unknown[]).length} أحداث` : typeof it.name === "string" ? it.name : "";
    return `${t}${txt ? `: ${txt}` : ""}`;
  };
  return (
    <details className="mt-3 rounded-lg border border-border bg-black/40 p-3 text-sm" open>
      <summary className="cursor-pointer text-xs text-muted-foreground">
        قصة المخرج{sb ? ` — ${sb.scenes.length} مشهد · ${sb.theme}` : ""}{best ? ` · التقييم ${best.overall}/10` : ""}{reviews.length > 1 ? ` بعد ${reviews.length} جولات` : ""}
      </summary>
      {best && Object.keys(best.scores).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {CRITIC_RUBRIC.map(r => best.scores[r.id] !== undefined && (
            <span key={r.id} className={cn("cv-chip num", best.scores[r.id] >= 8 ? "text-tally" : best.scores[r.id] < 6 ? "text-[var(--stop,#ff5a4f)]" : "")}>{r.label} {best.scores[r.id]}</span>
          ))}
        </div>
      )}
      {sb && (
        <ol className="mt-3 flex flex-col gap-2">
          {sb.scenes.map((sc, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-6">
              <span className="num shrink-0 text-tally" dir="ltr">{sc.from.toFixed(1)}–{sc.to.toFixed(1)}s</span>
              <span className="min-w-0">
                {sc.note && <span className="text-muted-foreground">{sc.note} — </span>}
                {sc.items.map(it => describe(it as Record<string, unknown>)).join(" · ")}
              </span>
            </li>
          ))}
          {sb.end && <li className="flex gap-2 text-[13px] leading-6"><span className="num shrink-0 text-tally">END</span><span>{sb.end.text}{sb.end.cta ? ` · ${sb.end.cta}` : ""}</span></li>}
        </ol>
      )}
      {best && (best.issues.length > 0 || best.measured.length > 0) && (
        <div className="mt-3 border-t border-border pt-2 text-[12px] leading-6 text-muted-foreground">
          <div className="mb-1 font-semibold text-foreground">ملاحظات الناقد الباقية</div>
          {[...best.measured, ...best.issues].slice(0, 6).map((x, i) => <div key={i}>• {x}</div>)}
        </div>
      )}
    </details>
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

type MediaSlotView = { scene: number; item: number | null; kind: "photo" | "clip"; query: string | null; asset: number | null; credit: string | null; url: string | null };

/** Pictures: free photos and clips (Pexels / Pixabay) on a switch, the owner's own library (photos, logo), maps always. */
function MediaSettings({ stock, setStock, library, setLibrary }: { stock: boolean; setStock: (v: boolean) => void; library: boolean; setLibrary: (v: boolean) => void }) {
  const status = trpc.codeVideos.stockStatus.useQuery(undefined, { staleTime: 60_000, enabled: stock });
  const lib = trpc.codeVideos.libraryMedia.useQuery(undefined, { staleTime: 30_000, enabled: library });
  const utils = trpc.useUtils();
  const [uploading, setUploading] = useState<"" | "photo" | "logo">("");
  const noKey = stock && status.data && status.data.sources.length === 0;
  const own = (lib.data?.items ?? []).filter(i => !i.stock);
  const upload = async (file: File, as: "photo" | "logo") => {
    setUploading(as);
    try {
      const name = file.name.replace(/\.[^.]+$/, "");
      const dims = await new Promise<{ w: number; h: number }>(res => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => res({ w: 0, h: 0 });
        img.src = URL.createObjectURL(file);
      });
      await uploadBlob(file, { kind: as === "logo" ? "other" : "background", filename: file.name, title: as === "logo" ? `شعار — ${name}` : name, width: dims.w || undefined, height: dims.h || undefined });
      toast.success(as === "logo" ? "رُفع الشعار — يظهر في خاتمة كل فيديو حين تفعّل «مكتبتي»" : "رُفعت الصورة إلى مكتبتك");
      void utils.codeVideos.libraryMedia.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading("");
    }
  };
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="text-xs text-muted-foreground">الصور — المخرج يضعها حيث تفيد فقط، بنفس ألوان الفيديو وبحركة كاميرا بطيئة. الخرائط المتحركة تعمل دائمًا بلا مفاتيح.</span>
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={stock} onCheckedChange={setStock} aria-label="صور ومقاطع مجانية" />
        <ImageIcon className="size-3.5 text-muted-foreground" /> صور ومقاطع مجانية (Pexels / Pixabay)
        {stock && status.data && status.data.sources.length > 0 && <span className="cv-chip">{status.data.sources.join(" + ")}</span>}
      </label>
      {noKey && (
        <span className="text-[11px] leading-5 text-hold">
          لا يوجد مفتاح بعد: أضف مفتاح Pixabay (مجاني، pixabay.com/api/docs) أو Pexels في <Link href="/integrations" className="underline">مركز التكاملات</Link> — بدونه تُحذف الصور ويبقى الفيديو بالكتابة والخرائط.
        </span>
      )}
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={library} onCheckedChange={setLibrary} aria-label="مكتبتي" />
        مكتبتي — صوري وشعاري
        {library && lib.data && <span className="cv-chip num">{own.length} من صورك{lib.data.hasLogo ? " · شعار ✓" : ""}</span>}
      </label>
      {library && (
        <div className="flex flex-wrap items-center gap-2">
          {(["photo", "logo"] as const).map(as => (
            <Button key={as} asChild variant="outline" size="sm" disabled={!!uploading}>
              <label className="cursor-pointer">
                <Upload /> {uploading === as ? "يرفع…" : as === "logo" ? "ارفع الشعار" : "ارفع صورًا"}
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple={as === "photo"} className="sr-only" onChange={async ev => { const files = [...(ev.target.files ?? [])]; ev.target.value = ""; for (const f of files) await upload(f, as); }} />
              </label>
            </Button>
          ))}
          <span className="text-[11px] text-muted-foreground">المخرج يرى أسماءها فيختار المناسب؛ والشعار يوضع في الخاتمة تلقائيًا.</span>
        </div>
      )}
    </div>
  );
}

/** The pictures the director chose, before export: another result, other search words, one from the library, or none. */
function MediaStrip({ slots, credits, busy, onSwap }: { slots: MediaSlotView[]; credits: string[]; busy: boolean; onSwap: (s: MediaSlotView, change: { query?: string; asset?: number; remove?: boolean }) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [words, setWords] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const lib = trpc.codeVideos.libraryMedia.useQuery(undefined, { staleTime: 30_000, enabled: picking !== null });
  const id = (s: MediaSlotView) => `${s.scene}-${s.item ?? "bg"}`;
  return (
    <div className="mt-3 rounded-lg border border-border bg-black/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><ImageIcon className="size-3.5" /> صور الفيديو ({slots.length}) — بدّل ما لا يعجبك قبل التحويل</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {slots.map(s => (
          <div key={id(s)} className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border p-1.5">
            <div className="relative aspect-video overflow-hidden rounded bg-black">
              {s.url ? <img src={s.url} alt="" className="size-full object-cover" loading="lazy" /> : <div className="grid size-full place-items-center text-[11px] text-muted-foreground">لا صورة</div>}
              <span className="cv-chip absolute start-1 top-1 num">مشهد {s.scene + 1}{s.kind === "clip" ? " · مقطع" : s.item !== null ? " · إطار" : ""}</span>
            </div>
            <div className="truncate text-[11px] text-muted-foreground" dir="auto" title={s.credit ?? undefined}>{s.query ?? (s.asset ? `من مكتبتك #${s.asset}` : "")}</div>
            {editing === id(s) ? (
              <form className="flex gap-1" onSubmit={ev => { ev.preventDefault(); if (words.trim()) onSwap(s, { query: words.trim() }); setEditing(null); }}>
                <Input value={words} onChange={ev => setWords(ev.target.value)} placeholder="english words" dir="ltr" className="h-7 text-xs" autoFocus />
                <Button type="submit" size="sm" className="h-7 px-2" disabled={busy}><Search /></Button>
              </form>
            ) : (
              <div className="flex flex-wrap gap-1">
                {s.query && <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => onSwap(s, {})} title="النتيجة التالية لنفس البحث"><Shuffle /> أخرى</Button>}
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => { setEditing(id(s)); setWords(s.query ?? ""); }} title="ابحث بكلمات أخرى (بالإنجليزية)"><Search /></Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => setPicking(picking === id(s) ? null : id(s))} title="من مكتبتك"><ImageIcon /></Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => onSwap(s, { remove: true })} title="بلا صورة في هذا المشهد"><Trash2 /></Button>
              </div>
            )}
            {picking === id(s) && (
              <div className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
                {(lib.data?.items ?? []).filter(i => (s.kind === "clip") === i.video).slice(0, 30).map(i => (
                  <button key={i.id} type="button" className="aspect-square overflow-hidden rounded border border-border hover:border-tally" title={i.title ?? ""} onClick={() => { setPicking(null); onSwap(s, { asset: i.id }); }}>
                    {i.video ? <span className="grid size-full place-items-center text-[10px]">{(i.title ?? `#${i.id}`).slice(0, 18)}</span> : <img src={i.url} alt="" className="size-full object-cover" loading="lazy" />}
                  </button>
                ))}
                {lib.data && !lib.data.items.some(i => (s.kind === "clip") === i.video) && <span className="col-span-3 text-[11px] text-muted-foreground">مكتبتك فارغة لهذا النوع</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      {credits.length > 0 && <p className="mt-2 text-[10px] leading-4 text-muted-foreground" dir="ltr">{credits.slice(0, 8).join(" · ")}</p>}
      <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><MapIcon className="size-3" /> الخرائط لا تحتاج تبديلًا: تُرسم من أسماء الدول في القصة.</p>
    </div>
  );
}

const THEME_SWATCH: Record<string, [string, string, string]> = {
  documentary: ["#0b0d10", "#ff3b30", "#f2f2f2"],
  kinetic: ["#111111", "#ffd60a", "#ffffff"],
  neon: ["#070712", "#22d3ee", "#e9e9ff"],
  infographic: ["#f6f5f1", "#2563eb", "#14161a"],
  storybook: ["#fdf6e3", "#ff7a59", "#2b2d42"],
};
const MOOD_AR: Record<string, string> = { tense: "توتر", upbeat: "حماسي", tech: "تقني", calm: "هادئ", playful: "مرح", epic: "ملحمي" };

/** The chosen template, or the button that opens the gallery. */
function TemplateBar({ template, onOpen, onClear }: { template: VideoTemplate | null; onOpen: () => void; onClear: () => void }) {
  if (!template) {
    return (
      <Button variant="outline" onClick={onOpen} className="justify-start">
        <LayoutTemplate /> اختر قالبًا جاهزًا ({VIDEO_TEMPLATES.length}) — سياسة، اقتصاد، علوم، رياضة…
      </Button>
    );
  }
  const [bg, ac, ink] = THEME_SWATCH[template.theme] ?? THEME_SWATCH.documentary;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-2.5">
      <div className="grid size-12 shrink-0 place-items-center rounded-md text-lg font-black" style={{ background: bg, color: template.accent ?? ac, border: `2px solid ${template.accent ?? ac}` }}>
        <span style={{ color: ink }}>{TEMPLATE_CATEGORIES.find(c => c.id === template.cat)?.icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">القالب: {template.name}</div>
        <div className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">{template.style}</div>
      </div>
      <Button size="sm" variant="outline" onClick={onOpen}>تغيير</Button>
      <Button size="sm" variant="ghost" onClick={onClear} aria-label="بلا قالب"><XIcon /></Button>
    </div>
  );
}

/** All templates by category: a card each (look, length, music, pictures). */
function TemplateGallery({ open, onOpenChange, current, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; current: string; onPick: (t: VideoTemplate) => void }) {
  const [cat, setCat] = useState<string>("all");
  const shown = VIDEO_TEMPLATES.filter(t => cat === "all" || t.cat === cat);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl" dir="rtl">
        <DialogHeader className="shrink-0 border-b border-border p-4 pb-3">
          <DialogTitle>القوالب الجاهزة</DialogTitle>
          <DialogDescription>كل قالب له أسلوبه وبناؤه الثابت وسيناريو تملؤه. اختر واحدًا، اكتب السيناريو، والمخرج يصنعه.</DialogDescription>
          <div className="flex flex-wrap gap-1.5 pt-2" role="tablist">
            <Chip on={cat === "all"} onClick={() => setCat("all")}>الكل ({VIDEO_TEMPLATES.length})</Chip>
            {TEMPLATE_CATEGORIES.map(c => (
              <Chip key={c.id} on={cat === c.id} onClick={() => setCat(c.id)}>{c.icon} {c.label} ({VIDEO_TEMPLATES.filter(t => t.cat === c.id).length})</Chip>
            ))}
          </div>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(t => {
            const [bg, ac, ink] = THEME_SWATCH[t.theme] ?? THEME_SWATCH.documentary;
            const accent = t.accent ?? ac;
            return (
              <button key={t.id} type="button" onClick={() => onPick(t)} className={cn("group flex flex-col overflow-hidden rounded-lg border text-start transition hover:border-tally", current === t.id ? "border-tally" : "border-border")}>
                <div className="relative flex h-24 items-center justify-center gap-2 px-3" style={{ background: bg }}>
                  <span className="text-2xl">{TEMPLATE_CATEGORIES.find(c => c.id === t.cat)?.icon}</span>
                  <span className="line-clamp-2 text-center text-base font-black leading-6" style={{ color: ink }}>
                    {t.name.split(" ").map((w, i) => <span key={i} style={i === t.name.split(" ").length - 1 ? { color: accent } : undefined}>{w} </span>)}
                  </span>
                  <span className="absolute bottom-0 start-0 h-1 w-full" style={{ background: accent }} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  <p className="line-clamp-3 text-[11px] leading-4 text-muted-foreground">{t.style}</p>
                  <div className="mt-auto flex flex-wrap gap-1 pt-1">
                    <span className="cv-chip num">{templateSeconds(t)} ث</span>
                    <span className="cv-chip">{t.scenes.length} مشهد</span>
                    <span className="cv-chip">♪ {MOOD_AR[t.mood]}</span>
                    {t.pictures && <span className="cv-chip">صور</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
