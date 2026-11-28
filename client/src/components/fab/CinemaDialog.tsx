import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { CINEMA_VOICES } from "@shared/cinema";
import { Clapperboard, Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const STATUS: Record<string, string> = {
  writing: "المخرج يكتب",
  voicing: "الصوت",
  pictures: "الصور والبلدان",
  recording: "الرسم إطارًا إطارًا",
  mixing: "الموسيقى والمزج",
  done: "جاهز",
  failed: "توقف",
};

/**
 * Narrated cinema reel: one idea in, a finished video out — the director writes the narration and picks the shot
 * for every sentence (3D globe, real photos that shatter, maps that assemble, launches, flags), the voice and the
 * music follow the same beats.
 */
export function CinemaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [idea, setIdea] = useState("");
  const [seconds, setSeconds] = useState("30");
  const [format, setFormat] = useState<"9:16" | "16:9">("9:16");
  const [voice, setVoice] = useState<string>(CINEMA_VOICES[0].id);
  const [jobId, setJobId] = useState<string | null>(null);
  const list = trpc.cinema.list.useQuery(undefined, { enabled: open, refetchInterval: open ? 4000 : false });
  const job = trpc.cinema.get.useQuery({ id: jobId ?? "" }, { enabled: !!jobId && open, refetchInterval: q => (q.state.data && ["done", "failed"].includes(q.state.data.status) ? false : 2000) });
  const start = trpc.cinema.start.useMutation({
    onSuccess: r => { setJobId(r.id); toast.success("بدأ المخرج — الريل يُصنع على حاسوبك"); list.refetch(); },
    onError: e => toast.error(e.message),
  });
  useEffect(() => {
    if (!jobId && list.data?.length) {
      const live = list.data.find(j => j.running);
      if (live) setJobId(live.id);
    }
  }, [list.data, jobId]);
  const j = job.data;
  const busy = !!j && !["done", "failed"].includes(j.status);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border p-4">
          <DialogTitle className="flex items-center gap-2"><Clapperboard className="size-5 text-tally" /> ريل سينمائي بصوت</DialogTitle>
          <DialogDescription>
            اكتب الفكرة وزاويتك فقط. المخرج يكتب التعليق ويختار لكل جملة أقوى لقطة: كرة أرضية ثلاثية الأبعاد تنزل إلى البلد، صورة الشخص الحقيقية تتشقق وتتحطم، خريطة تتجمع من شظايا ذهبية، إطلاق صاروخ، علم يرفرف — مع صوت وثائقي وموسيقى على نفس الإيقاع.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-3">
            <Textarea value={idea} onChange={e => setIdea(e.target.value)} placeholder="مثال: إيران منذ 1979 محاصرة من العالم كله ومع ذلك لم تنكسر، صنعت صواريخها ووصلت للفضاء — أنا معها، هذه قناتي وهذا رأيي" className="min-h-[150px] text-sm leading-6" />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>المدة</Label>
                <Select value={seconds} onValueChange={setSeconds}>
                  <SelectTrigger aria-label="المدة"><SelectValue /></SelectTrigger>
                  <SelectContent>{["20", "30", "45", "60", "90"].map(s => <SelectItem key={s} value={s}>{s} ثانية</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>الشكل</Label>
                <Select value={format} onValueChange={v => setFormat(v as "9:16" | "16:9")}>
                  <SelectTrigger aria-label="الشكل"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="9:16">عمودي — ريل</SelectItem><SelectItem value="16:9">عريض — يوتيوب</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>الصوت</Label>
                <Select value={voice} onValueChange={setVoice}>
                  <SelectTrigger aria-label="الصوت"><SelectValue /></SelectTrigger>
                  <SelectContent>{CINEMA_VOICES.map(v => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full bg-tally font-bold text-black hover:bg-tally/90" disabled={idea.trim().length < 8 || start.isPending || busy} onClick={() => start.mutate({ idea, seconds: Number(seconds), format, voice })}>
              {start.isPending || busy ? <RefreshCw className="animate-spin" /> : <Clapperboard />} اصنع الريل
            </Button>
            {j && (
              <div className={cn("rounded-xl border p-3 text-xs", j.status === "failed" ? "border-stop/40 bg-stop/10" : "border-tally/30 bg-tally/5")}>
                <div className="flex items-center justify-between font-semibold"><span>{STATUS[j.status] ?? j.status}</span>{j.status === "recording" && <span className="num">{j.progress}%</span>}</div>
                {busy && <Progress className="mt-2 h-1.5" value={j.status === "recording" ? j.progress : ({ writing: 8, voicing: 20, pictures: 32, mixing: 96 } as Record<string, number>)[j.status] ?? 50} />}
                <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px] text-muted-foreground">{j.log.slice(-10).map((l, i) => <div key={i}>{l}</div>)}</div>
                {j.video && (
                  <div className="mt-3">
                    <video key={j.video} src={j.video} poster={j.poster} controls playsInline className={cn("mx-auto rounded-lg bg-black", j.options.format === "9:16" ? "max-h-[60vh]" : "w-full")} />
                    <Button asChild size="sm" variant="secondary" className="mt-2"><a href={j.video} download={`${j.script?.title ?? "reel"}.mp4`}><Download /> تنزيل MP4</a></Button>
                  </div>
                )}
                {j.script && (
                  <details className="mt-2"><summary className="cursor-pointer text-muted-foreground">التعليق ({j.script.lines.length} جملة)</summary>
                    <ol className="mt-1 list-decimal space-y-1 ps-5 text-[12px] leading-6">{j.script.lines.map((l, i) => <li key={i}>{l.say} <span className="text-muted-foreground">— {l.shots.map(s => s.type).join(" ← ") || "—"}</span></li>)}</ol>
                  </details>
                )}
              </div>
            )}
          </div>
          <aside className="space-y-2">
            <h4 className="text-sm font-semibold">آخر الريلز</h4>
            {(list.data ?? []).map(r => (
              <button key={r.id} type="button" onClick={() => setJobId(r.id)} className={cn("flex w-full items-center gap-2 rounded-lg border p-2 text-start text-xs hover:border-tally", jobId === r.id ? "border-tally" : "border-border")}>
                {r.poster ? <img src={r.poster} alt="" className="h-14 w-9 rounded object-cover" /> : <div className="grid h-14 w-9 place-items-center rounded bg-muted text-[10px]">…</div>}
                <div className="min-w-0"><div className="truncate font-medium">{r.script?.title ?? r.idea.slice(0, 40)}</div><div className="text-muted-foreground">{STATUS[r.status] ?? r.status}{r.running && r.status === "recording" ? ` · ${r.progress}%` : ""}</div></div>
              </button>
            ))}
            {!list.data?.length && <p className="text-xs text-muted-foreground">لا ريلز بعد.</p>}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
