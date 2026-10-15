import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { uploadBlob } from "@/lib/api";
import { extractSpeechWav } from "@/lib/render/audio";
import { trpc } from "@/lib/trpc";
import { formatUsd } from "@shared/domain";
import { ALL_FORMATS, BlobSource, Input as MbInput } from "mediabunny";
import { Ban, Coins, ExternalLink, FileVideo, GitBranch, RefreshCw, Send, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { CharacterAvatar, CopyButton, EmptyBlock, PageHeader, StatusTally, type RouterOutputs } from "@/components/fab/common";

type Row = RouterOutputs["premium"]["list"][number];
type ClipStatus = Row["clip"]["status"];

async function probeVideo(file: Blob) {
  const input = new MbInput({ source: new BlobSource(file), formats: ALL_FORMATS });
  const dur = await input.computeDuration();
  const vt = await input.getPrimaryVideoTrack();
  return { durationMs: Math.round(dur * 1000), width: vt?.displayWidth ?? 0, height: vt?.displayHeight ?? 0 };
}

function AttemptDialog({ row, open, onOpenChange, defaultCredits }: { row: Row; open: boolean; onOpenChange: (v: boolean) => void; defaultCredits: number }) {
  const utils = trpc.useUtils();
  const [attempts, setAttempts] = useState(1);
  const [credits, setCredits] = useState(defaultCredits);
  const log = trpc.premium.logAttempt.useMutation({
    onSuccess: r => {
      utils.premium.list.invalidate();
      toast.success(`سُجلت ${r.credits} رصيد ≈ ${formatUsd(r.usd)}`);
      onOpenChange(false);
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>تسجيل محاولات Higgsfield</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">عدد المحاولات</Label>
            <Input type="number" min={1} max={20} value={attempts} onChange={e => setAttempts(Math.max(1, Number(e.target.value) || 1))} className="timecode" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">رصيد لكل محاولة</Label>
            <Input type="number" min={0} value={credits} onChange={e => setCredits(Math.max(0, Number(e.target.value) || 0))} className="timecode" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          الإجمالي: <span className="timecode">{attempts * credits}</span> رصيد — تُسجل تلقائيًا في التكلفة.
        </p>
        <DialogFooter>
          <Button onClick={() => log.mutate({ id: row.clip.id, attempts, creditsPerAttempt: credits })} disabled={log.isPending}>
            <Coins /> تسجيل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClipCard({ row, defaultCredits, derivativesDefault }: { row: Row; defaultCredits: number; derivativesDefault: number }) {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attemptOpen, setAttemptOpen] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const { clip, script, character, fullPrompt } = row;

  const attach = trpc.premium.attachVideo.useMutation();
  const setT = trpc.premium.setTranscript.useMutation({
    onSuccess: () => {
      utils.premium.list.invalidate();
      setTranscript(null);
      toast.success("تم حفظ التفريغ");
    },
  });
  const update = trpc.premium.update.useMutation({ onSuccess: () => utils.premium.list.invalidate() });
  const derive = trpc.premium.generateDerivatives.useMutation({
    onSuccess: r => {
      utils.premium.list.invalidate();
      utils.scripts.list.invalidate();
      toast.success(`تم إنشاء ${r.created} نسخ مشتقة — يرندرها الاستوديو الآلي تلقائيًا (أو من الرندر الجماعي)`);
    },
    onError: e => toast.error(e.message),
  });
  const submit = trpc.premium.submitToHiggsfield.useMutation({ onSuccess: () => { utils.premium.list.invalidate(); toast.success("تم إرسال اللقطة إلى Higgsfield"); }, onError: e => toast.error(e.message) });
  const sync = trpc.premium.syncFromHiggsfield.useMutation({ onSuccess: r => { utils.premium.list.invalidate(); toast.success(r.status === "received" ? "اكتمل الفيديو وحُفظ في مكتبة النظام" : `حالة Higgsfield: ${r.status}`); }, onError: e => toast.error(e.message) });
  const cancel = trpc.premium.cancelHiggsfield.useMutation({ onSuccess: () => { utils.premium.list.invalidate(); toast.success("تم إلغاء الطلب"); }, onError: e => toast.error(e.message) });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setBusy("قراءة الفيديو");
      const meta = await probeVideo(file);
      setBusy("رفع الفيديو");
      const up = await uploadBlob(file, {
        kind: "premium_video",
        filename: file.name,
        characterId: character.id,
        title: `${character.name} · Premium #${script.id}`,
        ...meta,
      });
      setBusy("استخراج الصوت للتفريغ");
      let audioUrl: string | null = null;
      const wav = await extractSpeechWav(file);
      if (wav) {
        const a = await uploadBlob(wav, { kind: "voice", filename: `premium-${clip.id}.wav`, characterId: character.id });
        audioUrl = a.url;
      }
      setBusy("تفريغ الكلام (Whisper)");
      const r = await attach.mutateAsync({ id: clip.id, assetId: up.id, videoUrl: up.url, durationMs: meta.durationMs, audioUrl });
      if (r.transcribeError) toast.warning(`تم الرفع، لكن التفريغ فشل: ${r.transcribeError}. أدخل النص يدويًا.`);
      else toast.success(`تم الرفع والتفريغ (${r.words} كلمة)`);
      if (meta.height < meta.width) toast.warning("الفيديو أفقي — المطلوب 9:16 عمودي");
      utils.premium.list.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل الرفع");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CharacterAvatar character={character} size={34} />
          <div>
            <div className="text-sm font-semibold">{character.name}</div>
            <div className="timecode text-[11px] text-muted-foreground">
              SCRIPT #{script.id} · CLIP #{clip.id} · {clip.model}
            </div>
          </div>
        </div>
        <StatusTally status={clip.status} kind="clip" />
      </div>
      <div className="text-sm font-medium" dir="ltr">
        {script.hook}
      </div>
      <div className="relative rounded-md border bg-background/60 p-3">
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-left font-mono text-[11.5px] leading-relaxed text-foreground/85" dir="ltr">
          {fullPrompt}
        </pre>
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyButton text={fullPrompt} label="نسخ البرومبت" />
          {character.loraKeyword && <CopyButton text={character.loraKeyword} label="نسخ LoRA" variant="ghost" />}
          <Button size="sm" variant="ghost" asChild>
            <a href="https://higgsfield.ai" target="_blank" rel="noreferrer">
              <ExternalLink /> Higgsfield
            </a>
          </Button>
        </div>
      </div>
      <div className="timecode flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>المحاولات: {clip.attempts}</span>
        <span>الرصيد: {clip.creditsSpent}</span>
        <span>التكلفة: {formatUsd(clip.costCents / 100)}</span>
        {clip.durationMs ? <span>المدة: {(clip.durationMs / 1000).toFixed(1)}s</span> : null}
        {clip.derivativesCreated ? <span>مشتقات: {clip.derivativesCreated}</span> : null}
      </div>
      {clip.videoUrl && (
        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <video src={clip.videoUrl} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-md border bg-black object-cover" />
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">التفريغ (يُستخدم للترجمة المتزامنة)</Label>
            <Textarea
              rows={4}
              dir="ltr"
              value={transcript ?? clip.transcript ?? ""}
              onChange={e => setTranscript(e.target.value)}
              placeholder="إن فشل التفريغ التلقائي، الصق النص المنطوق هنا"
            />
            {transcript !== null && transcript.trim() && (
              <Button size="sm" variant="outline" onClick={() => setT.mutate({ id: clip.id, transcript })} disabled={setT.isPending}>
                حفظ التفريغ
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t pt-3">
        {clip.status === "requested" && <Button size="sm" onClick={() => submit.mutate({ id: clip.id })} disabled={submit.isPending}><Send /> {submit.isPending ? "جارٍ الإرسال…" : "إرسال إلى Higgsfield"}</Button>}
        {clip.status === "generating" && <Button size="sm" variant="outline" onClick={() => sync.mutate({ id: clip.id })} disabled={sync.isPending}><RefreshCw /> {sync.isPending ? "جارٍ الفحص…" : "تحديث الحالة"}</Button>}
        {clip.status === "generating" && clip.providerCancelUrl && <Button size="sm" variant="ghost" className="text-stop" onClick={() => cancel.mutate({ id: clip.id })} disabled={cancel.isPending}><Ban /> إلغاء الطلب</Button>}
        {clip.status === "requested" && (
          <Button size="sm" variant="outline" onClick={() => update.mutate({ id: clip.id, data: { status: "generating" } })}>
            بدأت التوليد
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setAttemptOpen(true)}>
          <Coins /> تسجيل محاولة
        </Button>
        <Button size="sm" variant={clip.videoUrl ? "outline" : "default"} onClick={() => fileRef.current?.click()} disabled={busy !== null}>
          <Upload /> {busy ?? (clip.videoUrl ? "استبدال MP4" : "رفع MP4 الناتج")}
        </Button>
        <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={e => onFile(e.target.files?.[0])} />
        {clip.videoUrl && (
          <>
            <Button size="sm" variant="secondary" onClick={() => derive.mutate({ id: clip.id, count: derivativesDefault })} disabled={derive.isPending}>
              <GitBranch /> {derive.isPending ? "جارٍ التوليد…" : `ولّد ${derivativesDefault} نسخ مشتقة`}
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/studio?script=${script.id}`}>
                <FileVideo /> رندر الأصل
              </Link>
            </Button>
          </>
        )}
        {clip.status !== "failed" && !clip.videoUrl && (
          <Button size="sm" variant="ghost" className="text-stop" onClick={() => update.mutate({ id: clip.id, data: { status: "failed" } })}>
            تعذر
          </Button>
        )}
      </div>
      <AttemptDialog row={row} open={attemptOpen} onOpenChange={setAttemptOpen} defaultCredits={defaultCredits} />
    </div>
  );
}

export default function Premium() {
  const [tab, setTab] = useState<"open" | "received" | "failed" | "all">("open");
  const statusFor: Record<typeof tab, ClipStatus[] | undefined> = {
    open: ["requested", "generating"],
    received: ["received"],
    failed: ["failed"],
    all: undefined,
  };
  const q = trpc.premium.list.useQuery({ status: statusFor[tab] });
  const settings = trpc.settings.get.useQuery();
  const s = settings.data;
  const rows = q.data ?? [];
  const perClip = s ? s.higgsfieldCreditsPerAttempt * s.higgsfieldAttemptsPerClip * s.higgsfieldUsdPerCredit : 0;

  return (
    <div>
      <PageHeader
        kicker="PREMIUM · HIGGSFIELD"
        title="مركز Higgsfield"
        subtitle={
          <>
            انسخ البرومبت الجاهز (LoRA + المظهر + المشهد + الحوار) إلى Higgsfield، سجّل المحاولات، ثم ارفع MP4. النظام يفرّغ الكلام ويصنع منه {s?.derivativesPerPremium ?? 3} نسخ مشتقة
            اقتصادية. التكلفة المتوقعة للقطة صالحة ≈ <span className="timecode">{formatUsd(perClip)}</span>.
          </>
        }
      />
      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)} className="mb-4">
        <TabsList>
          <TabsTrigger value="open">بانتظار التوليد</TabsTrigger>
          <TabsTrigger value="received">تم الاستلام</TabsTrigger>
          <TabsTrigger value="failed">تعذر</TabsTrigger>
          <TabsTrigger value="all">الكل</TabsTrigger>
        </TabsList>
      </Tabs>
      {q.isLoading ? (
        <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
      ) : rows.length === 0 ? (
        <EmptyBlock title="لا توجد لقطات Premium في هذا القسم">النصوص المصنفة Premium في الدفعات تظهر هنا تلقائيًا مع برومبت جاهز للنسخ.</EmptyBlock>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.map(r => (
            <ClipCard key={`premium-${r.clip.id}-${r.script.id}`} row={r} defaultCredits={s?.higgsfieldCreditsPerAttempt ?? 72} derivativesDefault={s?.derivativesPerPremium ?? 3} />
          ))}
        </div>
      )}
    </div>
  );
}
