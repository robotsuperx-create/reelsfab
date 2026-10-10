import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TEMPLATES, type TemplateKey } from "@shared/domain";
import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CharacterAvatar, StatusTally, useCharacterMap } from "./common";

type Item = { characterId: number; count: number; premium: number };

export default function BatchDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone?: () => void }) {
  const utils = trpc.useUtils();
  const { map } = useCharacterMap();
  const [target, setTarget] = useState(30);
  const [share, setShare] = useState(30);
  const plan = trpc.batches.previewPlan.useQuery({ target, premiumSharePercent: share }, { enabled: open });
  const [items, setItems] = useState<Item[]>([]);
  const [templates, setTemplates] = useState<TemplateKey[]>(TEMPLATES.map(t => t.key));
  const [hints, setHints] = useState("");
  const [name, setName] = useState("");
  const [batchId, setBatchId] = useState<number | null>(null);

  useEffect(() => {
    if (plan.data) setItems(plan.data.items);
  }, [plan.data]);
  useEffect(() => {
    if (open) {
      setBatchId(null);
      setName(`دفعة ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`);
    }
  }, [open]);

  const start = trpc.batches.start.useMutation({
    onSuccess: r => {
      setBatchId(r.batchId);
      toast.success("بدأ توليد الدفعة في الخلفية");
    },
    onError: e => toast.error(e.message),
  });
  const batch = trpc.batches.get.useQuery(
    { id: batchId ?? 0 },
    { enabled: batchId !== null, refetchInterval: q => (q.state.data?.status === "running" ? 2500 : false) },
  );
  const total = useMemo(() => items.reduce((a, b) => a + b.count, 0), [items]);
  const premium = useMemo(() => items.reduce((a, b) => a + Math.min(b.premium, b.count), 0), [items]);

  useEffect(() => {
    if (batch.data && batch.data.status !== "running") {
      utils.scripts.list.invalidate();
      utils.dashboard.overview.invalidate();
      if (batch.data.status === "done") onDone?.();
    }
  }, [batch.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const setItem = (id: number, patch: Partial<Item>) => setItems(prev => prev.map(i => (i.characterId === id ? { ...i, ...patch } : i)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>توليد دفعة نصوص</DialogTitle>
        </DialogHeader>
        {batchId === null ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">إجمالي الريلات</Label>
                <Input type="number" min={1} max={300} value={target} onChange={e => setTarget(Math.max(1, Number(e.target.value) || 1))} className="timecode" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">نسبة Premium %</Label>
                <Input type="number" min={0} max={100} value={share} onChange={e => setShare(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} className="timecode" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">اسم الدفعة</Label>
                <Input value={name} onChange={e => setName(e.target.value)} />
              </div>
            </div>
            <div className="rounded-lg border">
              <div className="grid grid-cols-[1fr_90px_90px] gap-2 border-b px-3 py-2 text-[11px] text-muted-foreground">
                <span>الشخصية</span>
                <span>عدد النصوص</span>
                <span>منها Premium</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {items.map(i => {
                  const c = map.get(i.characterId);
                  return (
                    <div key={i.characterId} className="grid grid-cols-[1fr_90px_90px] items-center gap-2 border-b px-3 py-1.5 last:border-0">
                      <div className="flex items-center gap-2">
                        <CharacterAvatar character={c} size={22} />
                        <span className="text-sm">{c?.name}</span>
                      </div>
                      <Input type="number" min={0} max={40} value={i.count} onChange={e => setItem(i.characterId, { count: Math.max(0, Number(e.target.value) || 0) })} className="timecode h-8" />
                      <Input type="number" min={0} max={40} value={i.premium} onChange={e => setItem(i.characterId, { premium: Math.max(0, Number(e.target.value) || 0) })} className="timecode h-8" />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between px-3 py-2 text-xs">
                <span className="text-muted-foreground">الإجمالي</span>
                <span className="timecode">
                  {total} نص · {premium} Premium · {total - premium} اقتصادي
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">القوالب المسموحة</Label>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map(t => {
                  const on = templates.includes(t.key);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTemplates(prev => (on ? prev.filter(k => k !== t.key) : [...prev, t.key]))}
                      className={cn("rounded-md border px-2.5 py-1 text-xs transition-colors", on ? "border-tally bg-tally/10 text-tally" : "text-muted-foreground")}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">توجيهات للمواضيع (اختياري — مثل ترند هذا الأسبوع أو منتج معين)</Label>
              <Textarea value={hints} onChange={e => setHints(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button
                disabled={start.isPending || total === 0 || templates.length === 0}
                onClick={() => start.mutate({ name, items, templateKeys: templates, topicHints: hints || undefined })}
              >
                <Sparkles /> {start.isPending ? "جارٍ البدء…" : `ولّد ${total} نصًا`}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{batch.data?.name ?? name}</div>
              {batch.data && <StatusTally status={batch.data.status} />}
            </div>
            <Progress value={Math.min(100, ((batch.data?.totalScripts ?? 0) / Math.max(1, total)) * 100)} className="h-2" />
            <div className="timecode text-sm text-muted-foreground">
              {batch.data?.totalScripts ?? 0} / {total} نص · {batch.data?.premiumScripts ?? 0} Premium
            </div>
            {batch.data?.status === "failed" && <div className="rounded-md bg-stop/10 p-2 text-xs text-stop">{batch.data.error}</div>}
            <p className="text-xs text-muted-foreground">يمكنك إغلاق النافذة — التوليد يكمل في الخادم وستظهر النصوص في البنك تلقائيًا.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                إغلاق
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
