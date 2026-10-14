import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { formatUsd } from "@shared/domain";
import { Play, RefreshCw, Timer, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyBlock, PageHeader, Stat, StatusTally, Tally } from "@/components/fab/common";

const FLOW = [
  { n: "01", t: "نصوص", d: "دفعة يومية بالذكاء الاصطناعي" },
  { n: "02", t: "رندر", d: "ffmpeg + صوت Kokoro + ترجمة كلمة بكلمة" },
  { n: "03", t: "جودة", d: "فحص آلي ثم اعتماد" },
  { n: "04", t: "جدولة", d: "ملء التقويم 3 أيام قادمة" },
  { n: "05", t: "نشر", d: "كل منصة في موعدها" },
];

export default function Automation() {
  const utils = trpc.useUtils();
  const st = trpc.automation.status.useQuery(undefined, { refetchInterval: 10000 });
  const jobs = trpc.automation.jobs.useQuery(undefined, { refetchInterval: 10000 });
  const runs = trpc.automation.runs.useQuery();
  const [hour, setHour] = useState<string | null>(null);
  const refresh = () => utils.automation.invalidate();
  const onError = (e: { message: string }) => toast.error(e.message);
  const runNow = trpc.automation.runNow.useMutation({ onSuccess: () => { refresh(); toast.success("بدأت دفعة النصوص في الخلفية"); }, onError });
  const renderNow = trpc.automation.renderNow.useMutation({ onSuccess: r => { refresh(); toast.success(`أُضيف ${r.queued} نصًا للطابور وبدأ الرندر`); }, onError });
  const retry = trpc.automation.retryFailed.useMutation({ onSuccess: () => { refresh(); toast.success("أُعيدت المهام الفاشلة للطابور"); }, onError });
  const enable = trpc.automation.enable.useMutation({ onSuccess: () => { refresh(); toast.success("الاستوديو الآلي مفعّل"); }, onError });
  const disable = trpc.automation.disable.useMutation({ onSuccess: () => { refresh(); toast.success("تم الإيقاف"); }, onError });

  const d = st.data;
  const q = d?.queue ?? {};
  const budgetPct = d ? Math.min(100, (d.monthCostUsd / Math.max(1, d.monthlyBudgetUsd)) * 100) : 0;
  const hourValue = hour ?? String(d?.hourUtc ?? 5);
  const workerTone = !d?.workerEnabled ? "stop" : d.workerAlive ? "go" : "hold";
  const workerLabel = !d?.workerEnabled ? "العامل متوقف (AUTOPILOT_ENABLED)" : d.workerAlive ? "العامل يعمل" : "بانتظار أول نبضة";

  return (
    <div>
      <PageHeader
        kicker="AUTOPILOT · LIVE"
        title="الاستوديو الآلي"
        subtitle="ينتج المحتوى وينشره يوميًا بلا تدخل: نصوص، رندر على الخادم، فحص جودة، جدولة، ونشر — بتكلفة شبه صفرية للريلات الاقتصادية."
        actions={
          <>
            <Button variant="outline" onClick={() => renderNow.mutate()} disabled={renderNow.isPending}>
              <Zap /> ارندر الآن
            </Button>
            <Button onClick={() => runNow.mutate()} disabled={runNow.isPending}>
              <Play /> {runNow.isPending ? "جارٍ البدء…" : "دفعة نصوص الآن"}
            </Button>
          </>
        }
      />

      <div className="panel overflow-hidden p-0">
        <div className="grid divide-y sm:grid-cols-5 sm:divide-x sm:divide-y-0 sm:divide-x-reverse">
          {FLOW.map(f => (
            <div key={f.n} className="p-4">
              <div className="timecode text-[10px] text-tally">{f.n}</div>
              <div className="mt-1 font-semibold">{f.t}</div>
              <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{f.d}</div>
            </div>
          ))}
        </div>
        <div className="sprockets opacity-50" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="الجدولة اليومية" value={d?.enabled ? "مفعّلة" : "متوقفة"} tone={d?.enabled ? "go" : "hold"} />
        <Stat label="في الطابور" value={q.queued ?? 0} tone={q.queued ? "hold" : undefined} />
        <Stat label="يُرندر الآن" value={q.running ?? 0} tone={q.running ? "hold" : undefined} />
        <Stat label="تم" value={q.done ?? 0} tone="go" />
        <Stat label="فشل" value={q.failed ?? 0} tone={q.failed ? "stop" : undefined} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="panel">
          <div className="flex items-center justify-between border-b p-4">
            <h2 className="text-sm font-semibold">طابور الرندر</h2>
            <div className="flex items-center gap-3">
              <Tally tone={workerTone} label={workerLabel} live={workerTone === "go"} />
              {(q.failed ?? 0) > 0 && (
                <Button size="sm" variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
                  <RefreshCw /> أعد الفاشلة
                </Button>
              )}
            </div>
          </div>
          {!jobs.data?.length ? (
            <EmptyBlock title="الطابور فارغ">النصوص الاقتصادية الجاهزة تدخل الطابور تلقائيًا كل دقيقة.</EmptyBlock>
          ) : (
            <div className="divide-y">
              {jobs.data.map(j => (
                <div key={j.id} className="flex items-center gap-3 p-3 text-sm">
                  <span className="timecode text-xs text-muted-foreground">#{j.scriptId}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{j.hook ?? "—"}</div>
                    {j.error && <div className="mt-0.5 truncate text-[11px] text-stop">{j.error}</div>}
                  </div>
                  {j.attempts > 1 && <span className="timecode text-[11px] text-muted-foreground">×{j.attempts}</span>}
                  <StatusTally status={j.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <div className="panel p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">الجدولة</h2>
              <Timer className="text-tally" />
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">يُولَّد بنك النصوص مرة يوميًا عند هذه الساعة (UTC). الباقي يجري تلقائيًا كل دقيقة.</p>
            <div className="mt-4 flex items-end gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">ساعة UTC (0–23)</Label>
                <Input type="number" min="0" max="23" value={hourValue} onChange={e => setHour(e.target.value)} className="timecode mt-1 w-24" />
              </div>
              <Button onClick={() => enable.mutate({ hourUtc: Math.max(0, Math.min(23, Number(hourValue) || 0)) })} disabled={enable.isPending}>
                {d?.enabled ? "تحديث" : "تفعيل"}
              </Button>
              {d?.enabled && (
                <Button variant="outline" onClick={() => disable.mutate()} disabled={disable.isPending}>
                  إيقاف
                </Button>
              )}
            </div>
          </div>

          <div className="panel p-5">
            <div className="text-sm text-muted-foreground">ميزانية الشهر</div>
            <div className="timecode mt-1 text-2xl font-semibold">{formatUsd(d?.monthCostUsd ?? 0)}</div>
            <div className="text-xs text-muted-foreground">من {formatUsd(d?.monthlyBudgetUsd ?? 0)} — مقاطع Premium تتوقف تلقائيًا عند نفاد حصة اليوم</div>
            <Progress value={budgetPct} className="mt-3 h-2" />
          </div>
        </div>
      </div>

      <div className="panel mt-5">
        <div className="border-b p-3 text-sm font-semibold">سجل الدفعات اليومية</div>
        {!runs.data?.length ? (
          <EmptyBlock title="لا يوجد تشغيل بعد" />
        ) : (
          <div className="divide-y">
            {runs.data.map(r => (
              <div key={r.id} className="flex items-center gap-3 p-3 text-sm">
                <span className="timecode">#{r.id}</span>
                <span className="flex-1">{r.trigger === "manual" ? "يدوي" : "تلقائي"}</span>
                <StatusTally status={r.status} />
                <span className="text-xs text-muted-foreground">{new Date(r.startedAt).toLocaleString("en-GB")}</span>
                {r.error && <span className="max-w-xs truncate text-xs text-stop">{r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
