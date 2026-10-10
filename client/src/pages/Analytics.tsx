import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { saveTextFile } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import { HOOK_TYPES, PLATFORM_LABELS, TEMPLATES, TRACK_LABELS } from "@shared/domain";
import Papa from "papaparse";
import { FileUp, Lightbulb, PencilLine } from "lucide-react";
import { useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { EmptyBlock, PageHeader, Stat, type RouterOutputs } from "@/components/fab/common";

type Summary = RouterOutputs["analytics"]["summary"];
type Agg = Summary["byCharacter"][number];
type Published = RouterOutputs["analytics"]["publishedPosts"][number];

const nf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function labelFor(group: string, key: string, fallback: string) {
  if (group === "template") return TEMPLATES.find(t => t.key === key)?.label ?? fallback;
  if (group === "hook") return HOOK_TYPES.find(h => h.key === key)?.label ?? fallback;
  if (group === "track") return TRACK_LABELS[key] ?? fallback;
  if (group === "platform") return PLATFORM_LABELS[key] ?? fallback;
  return fallback;
}

function AggTable({ rows, group }: { rows: Agg[]; group: string }) {
  if (!rows.length) return <div className="p-4 text-sm text-muted-foreground">لا توجد بيانات بعد.</div>;
  const maxAvg = Math.max(...rows.map(r => r.views / Math.max(1, r.posts)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-[11px] text-muted-foreground">
            <th className="px-3 py-2 text-right font-normal">العنصر</th>
            <th className="px-3 py-2 text-right font-normal">منشورات</th>
            <th className="px-3 py-2 text-right font-normal">متوسط المشاهدات</th>
            <th className="px-3 py-2 text-right font-normal">الإكمال</th>
            <th className="px-3 py-2 text-right font-normal">متوسط المشاهدة</th>
            <th className="px-3 py-2 text-right font-normal">حفظ</th>
            <th className="px-3 py-2 text-right font-normal">مشاركة</th>
            <th className="px-3 py-2 text-right font-normal">متابعات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const avg = r.views / Math.max(1, r.posts);
            return (
              <tr key={r.key} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {i === 0 && <span className="tally-dot text-go" />}
                    {labelFor(group, r.key, r.label)}
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-secondary">
                    <div className="h-1 rounded-full bg-tally" style={{ width: `${(avg / Math.max(1, maxAvg)) * 100}%` }} />
                  </div>
                </td>
                <td className="timecode px-3 py-2">{r.posts}</td>
                <td className="timecode px-3 py-2">{nf.format(avg)}</td>
                <td className="timecode px-3 py-2">{(r.completion / 10).toFixed(1)}%</td>
                <td className="timecode px-3 py-2">{(r.avgWatchMs / 1000).toFixed(1)}s</td>
                <td className="timecode px-3 py-2">{nf.format(r.saves)}</td>
                <td className="timecode px-3 py-2">{nf.format(r.shares)}</td>
                <td className="timecode px-3 py-2">{nf.format(r.follows)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MetricsDialog({ row, onClose }: { row: Published | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const m = row?.metric;
  const [f, setF] = useState({
    views: m?.views ?? 0,
    avgWatchSec: (m?.avgWatchMs ?? 0) / 1000,
    completionPct: (m?.completionPermille ?? 0) / 10,
    likes: m?.likes ?? 0,
    comments: m?.comments ?? 0,
    shares: m?.shares ?? 0,
    saves: m?.saves ?? 0,
    follows: m?.follows ?? 0,
  });
  const save = trpc.analytics.saveMetrics.useMutation({
    onSuccess: () => {
      utils.analytics.invalidate();
      toast.success("تم حفظ الأرقام");
      onClose();
    },
  });
  if (!row) return null;
  const fields: [keyof typeof f, string][] = [
    ["views", "المشاهدات"],
    ["avgWatchSec", "متوسط المشاهدة (ث)"],
    ["completionPct", "نسبة الإكمال %"],
    ["likes", "الإعجابات"],
    ["comments", "التعليقات"],
    ["shares", "المشاركات"],
    ["saves", "الحفظ"],
    ["follows", "المتابعات الجديدة"],
  ];
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            أرقام المنشور #{row.post.id} · {PLATFORM_LABELS[row.post.platform]}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {fields.map(([k, l]) => (
            <div key={k} className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">{l}</Label>
              <Input type="number" min={0} step="any" value={f[k]} onChange={e => setF(p => ({ ...p, [k]: Number(e.target.value) || 0 }))} className="timecode" />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button
            onClick={() =>
              save.mutate({
                postId: row.post.id,
                metrics: {
                  views: Math.round(f.views),
                  avgWatchMs: Math.round(f.avgWatchSec * 1000),
                  completionPermille: Math.min(1000, Math.round(f.completionPct * 10)),
                  likes: Math.round(f.likes),
                  comments: Math.round(f.comments),
                  shares: Math.round(f.shares),
                  saves: Math.round(f.saves),
                  follows: Math.round(f.follows),
                },
              })
            }
          >
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Analytics() {
  const [days, setDays] = useState(30);
  const summary = trpc.analytics.summary.useQuery({ days });
  const published = trpc.analytics.publishedPosts.useQuery({ days });
  const insights = trpc.analytics.insights.useQuery();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<Published | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const gen = trpc.analytics.generateInsights.useMutation({
    onSuccess: () => {
      utils.analytics.insights.invalidate();
      toast.success("تم توليد الاقتراحات");
    },
    onError: e => toast.error(e.message),
  });
  const importRows = trpc.analytics.importRows.useMutation({
    onSuccess: r => {
      utils.analytics.invalidate();
      toast.success(`تم استيراد ${r.imported} صف${r.unmatched.length ? ` · ${r.unmatched.length} غير مطابق` : ""}`);
    },
    onError: e => toast.error(e.message),
  });
  const s = summary.data;

  const onCsv = (file: File | undefined) => {
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: res => {
        const num = (v: string | undefined) => Number(String(v ?? "0").replace(/[,%\s]/g, "")) || 0;
        const rows = res.data.map(r => ({
          postId: r.post_id ? Number(r.post_id) : undefined,
          postUrl: r.post_url || undefined,
          views: Math.round(num(r.views)),
          avgWatchMs: Math.round(num(r.avg_watch_sec) * 1000),
          completionPermille: Math.min(1000, Math.round(num(r.completion_pct) * 10)),
          likes: Math.round(num(r.likes)),
          comments: Math.round(num(r.comments)),
          shares: Math.round(num(r.shares)),
          saves: Math.round(num(r.saves)),
          follows: Math.round(num(r.follows)),
        }));
        importRows.mutate({ rows });
      },
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const template = () =>
    saveTextFile(
      "post_id,post_url,views,avg_watch_sec,completion_pct,likes,comments,shares,saves,follows\n" +
        (published.data ?? []).map(p => `${p.post.id},${p.post.postUrl ?? ""},,,,,,,,`).join("\n"),
      "metrics-template.csv",
    );

  return (
    <div>
      <PageHeader
        kicker="ANALYTICS"
        title="التحليلات"
        subtitle="أدخل أرقام كل منشور يدويًا أو استورد CSV من لوحات المنصات، ثم دع الـAI يقترح ما يجب تكراره وما يجب إيقافه."
        actions={
          <>
            <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">آخر 7 أيام</SelectItem>
                <SelectItem value="14">آخر 14 يومًا</SelectItem>
                <SelectItem value="30">آخر 30 يومًا</SelectItem>
                <SelectItem value="90">آخر 90 يومًا</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={template}>
              قالب CSV
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importRows.isPending}>
              <FileUp /> استيراد CSV
            </Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => onCsv(e.target.files?.[0])} />
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="منشورات (مقاسة)" value={`${s?.measuredPosts ?? 0}/${s?.publishedPosts ?? 0}`} />
        <Stat label="المشاهدات" value={nf.format(s?.totals.views ?? 0)} />
        <Stat label="متوسط الإكمال" value={`${((s?.totals.completion ?? 0) / 10).toFixed(1)}%`} />
        <Stat label="متوسط المشاهدة" value={`${((s?.totals.avgWatchMs ?? 0) / 1000).toFixed(1)}s`} />
        <Stat label="الحفظ" value={nf.format(s?.totals.saves ?? 0)} />
        <Stat label="المتابعات" value={nf.format(s?.totals.follows ?? 0)} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="panel">
          <Tabs defaultValue="character">
            <div className="border-b p-2">
              <TabsList>
                <TabsTrigger value="character">الشخصية</TabsTrigger>
                <TabsTrigger value="hook">نوع Hook</TabsTrigger>
                <TabsTrigger value="template">القالب</TabsTrigger>
                <TabsTrigger value="track">المسار</TabsTrigger>
                <TabsTrigger value="platform">المنصة</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="character">
              <AggTable rows={s?.byCharacter ?? []} group="character" />
            </TabsContent>
            <TabsContent value="hook">
              <AggTable rows={s?.byHookType ?? []} group="hook" />
            </TabsContent>
            <TabsContent value="template">
              <AggTable rows={s?.byTemplate ?? []} group="template" />
            </TabsContent>
            <TabsContent value="track">
              <AggTable rows={s?.byTrack ?? []} group="track" />
            </TabsContent>
            <TabsContent value="platform">
              <AggTable rows={s?.byPlatform ?? []} group="platform" />
            </TabsContent>
          </Tabs>
        </div>
        <div className="panel flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">اقتراحات AI</div>
            <Button size="sm" onClick={() => gen.mutate({ days: Math.min(days, 30) })} disabled={gen.isPending}>
              <Lightbulb /> {gen.isPending ? "جارٍ التحليل…" : "حلّل الآن"}
            </Button>
          </div>
          {insights.data?.[0] ? (
            <div className="prose prose-sm prose-invert max-h-[440px] max-w-none overflow-y-auto text-sm">
              <div className="timecode mb-2 text-[11px] text-muted-foreground">{new Date(insights.data[0].createdAt).toLocaleString("en-GB")}</div>
              <Streamdown>{insights.data[0].content}</Streamdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">بعد إدخال أرقام 3 منشورات على الأقل، اضغط "حلّل الآن" لمعرفة أفضل شخصية وHook وقالب، وما يجب إيقافه.</p>
          )}
        </div>
      </div>

      <div className="panel mt-5">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">المنشورات المنشورة — إدخال الأرقام</div>
        {(published.data ?? []).length === 0 ? (
          <div className="p-4">
            <EmptyBlock title="لا توجد منشورات منشورة بعد">علّم المنشورات كـ"تم النشر" من صفحة التقويم.</EmptyBlock>
          </div>
        ) : (
          <div className="divide-y">
            {published.data!.map(p => (
              <div key={p.post.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="timecode w-12 text-[11px] text-muted-foreground">#{p.post.id}</span>
                <span className="w-28 text-xs">{PLATFORM_LABELS[p.post.platform]}</span>
                <span className="w-28 truncate text-xs">{p.character.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs" dir="ltr">
                  {p.script.hook}
                </span>
                <span className="timecode w-24 text-xs">{p.metric ? `${nf.format(p.metric.views)} views` : "—"}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                  <PencilLine /> أرقام
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <MetricsDialog key={editing?.post.id ?? 0} row={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
