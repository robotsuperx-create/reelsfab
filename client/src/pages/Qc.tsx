import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { downloadUrl } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Check, Download, Eye, Scissors, Trash2, X, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { CharacterAvatar, EmptyBlock, PageHeader, StatusTally, TrackBadge, useCharacterMap, type RouterOutputs } from "@/components/fab/common";

type Row = RouterOutputs["renders"]["list"][number];
type QcTab = "needs_review" | "approved" | "rejected" | "all";

function RenderCard({ row }: { row: Row }) {
  const { map } = useCharacterMap();
  const utils = trpc.useUtils();
  const [notes, setNotes] = useState(row.render.reviewNotes ?? "");
  const r = row.render;
  const c = map.get(r.characterId);
  const invalidate = () => {
    utils.renders.list.invalidate();
    utils.scripts.list.invalidate();
    utils.posts.unscheduled.invalidate();
  };
  const review = trpc.renders.review.useMutation({ onSuccess: invalidate, onError: e => toast.error(e.message) });
  const visual = trpc.renders.visualCheck.useMutation({ onSuccess: invalidate, onError: e => toast.error(e.message) });
  const remove = trpc.renders.remove.useMutation({ onSuccess: invalidate });
  const checks = r.qcReport?.checks ?? [];
  const v = r.visualQc;

  return (
    <div className="panel flex flex-col overflow-hidden sm:flex-row">
      <div className="w-full shrink-0 bg-black sm:w-[200px]">
        <video src={r.videoUrl} poster={r.thumbnailUrl ?? undefined} controls playsInline preload="none" className="aspect-[9/16] w-full object-cover" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <CharacterAvatar character={c} size={28} />
            <div>
              <div className="text-sm font-semibold">{c?.name}</div>
              <div className="flex items-center gap-1.5">
                <TrackBadge track={r.kind} />
                <span className="timecode text-[10px] text-muted-foreground">
                  R#{r.id} · {(r.durationMs / 1000).toFixed(1)}s · {r.width}×{r.height}
                </span>
              </div>
            </div>
          </div>
          <StatusTally status={r.qcStatus} kind="qc" />
        </div>
        <div className="line-clamp-2 text-sm" dir="ltr">
          {row.script.hook}
        </div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
          {checks.map(ch => (
            <div key={ch.key} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className={cn("tally-dot", ch.status === "pass" ? "text-go" : ch.status === "warn" ? "text-hold" : "text-stop")} style={{ width: 6, height: 6 }} />
                {ch.label}
              </span>
              <span className="timecode truncate text-muted-foreground" dir="ltr">
                {ch.detail}
              </span>
            </div>
          ))}
        </div>
        {v ? (
          <div className={cn("rounded-md border p-2 text-[11px]", v.consistent ? "border-go/30 bg-go/5" : "border-hold/40 bg-hold/5")}>
            <div className="flex items-center justify-between">
              <span>الفحص البصري بالـAI</span>
              <span className="timecode">{v.score}/100</span>
            </div>
            {v.issues.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {v.issues.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="ملاحظات المراجعة (اختياري)" className="text-xs" />
        <div className="mt-auto flex flex-wrap gap-2">
          <Button size="sm" className="bg-go text-black hover:bg-go/90" onClick={() => review.mutate({ id: r.id, qcStatus: "approved", notes: notes || null })}>
            <Check /> اعتماد
          </Button>
          <Button size="sm" variant="outline" className="border-hold/50 text-hold" onClick={() => review.mutate({ id: r.id, qcStatus: "needs_review", notes: notes || null })}>
            <AlertTriangle /> يحتاج مراجعة
          </Button>
          <Button size="sm" variant="outline" className="border-stop/50 text-stop" onClick={() => review.mutate({ id: r.id, qcStatus: "rejected", notes: notes || null })}>
            <X /> رفض
          </Button>
          <Button size="sm" variant="ghost" onClick={() => visual.mutate({ id: r.id })} disabled={visual.isPending}>
            <Eye /> {visual.isPending ? "جارٍ الفحص…" : "فحص بصري"}
          </Button>
          <Button size="icon-sm" variant="ghost" title="تنزيل" onClick={() => downloadUrl(r.videoUrl, `${c?.slug ?? "reel"}-${r.scriptId}-${r.id}.mp4`)}>
            <Download />
          </Button>
          <Button asChild size="icon-sm" variant="ghost" title="افتح في غرفة المونتاج">
            <Link href={`/montage/from/${r.scriptId}`} aria-label="افتح في غرفة المونتاج"><Scissors /></Link>
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title="حذف الرندر"
            onClick={() => {
              if (confirm("حذف هذا الرندر وإعادة النص لطابور الرندر؟")) remove.mutate({ id: r.id });
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function QcPage() {
  const [tab, setTab] = useState<QcTab>("needs_review");
  const [characterId, setCharacterId] = useState<number | undefined>();
  const { list } = useCharacterMap();
  const q = trpc.renders.list.useQuery({ qcStatus: tab === "all" ? undefined : [tab], characterId, limit: 200 });
  const rows = q.data ?? [];
  return (
    <div>
      <PageHeader
        kicker="QUALITY CONTROL"
        title="فحص الجودة"
        subtitle="كل ريل يُفحص آليًا: المدة، المقاس 1080×1920، الصوت، الترجمة، عدد الكلمات، وسم AI، الادعاءات الصحية/المالية/الدخل، والتكرار. الفحص البصري بالـAI يقارن الإطار بالصورة المرجعية."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={v => setTab(v as QcTab)}>
          <TabsList>
            <TabsTrigger value="needs_review">يحتاج مراجعة</TabsTrigger>
            <TabsTrigger value="approved">معتمد</TabsTrigger>
            <TabsTrigger value="rejected">مرفوض</TabsTrigger>
            <TabsTrigger value="all">الكل</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={characterId ? String(characterId) : "all"} onValueChange={v => setCharacterId(v === "all" ? undefined : Number(v))}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الشخصيات</SelectItem>
            {list.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {q.isLoading ? (
        <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
      ) : rows.length === 0 ? (
        <EmptyBlock title="لا توجد ريلات في هذا القسم">بعد الرندر من الاستوديو أو الرندر الجماعي تظهر الريلات هنا مع نتيجة الفحص.</EmptyBlock>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-2">
          {rows.map(r => (
            <RenderCard key={r.render.id} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}
