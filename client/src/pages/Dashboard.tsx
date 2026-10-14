import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { tzOffset } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import { formatUsd } from "@shared/domain";
import { ArrowLeft, Clapperboard, Layers, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";
import { CharacterAvatar, PageHeader, Stat, StatusTally, Tally, useCharacterMap } from "@/components/fab/common";

const STAGES: { key: string; label: string; statuses: string[]; href: string }[] = [
  { key: "script", label: "نصوص جاهزة", statuses: ["script_ready", "idea"], href: "/scripts" },
  { key: "prompt", label: "برومبت Premium", statuses: ["prompt_ready"], href: "/premium" },
  { key: "uploaded", label: "Premium مرفوع", statuses: ["premium_uploaded"], href: "/premium" },
  { key: "review", label: "يحتاج مراجعة", statuses: ["needs_review", "rendered"], href: "/qc" },
  { key: "approved", label: "معتمد", statuses: ["approved"], href: "/calendar" },
  { key: "scheduled", label: "مجدول", statuses: ["scheduled"], href: "/calendar" },
  { key: "published", label: "منشور", statuses: ["published"], href: "/analytics" },
];

export default function Dashboard() {
  const q = trpc.dashboard.overview.useQuery({ tzOffsetMinutes: tzOffset() }, { refetchInterval: 15000 });
  const ap = trpc.automation.status.useQuery(undefined, { refetchInterval: 15000 });
  const { map } = useCharacterMap();
  const d = q.data;

  const stageCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const st of STAGES) out[st.key] = (d?.pipeline ?? []).filter(p => st.statuses.includes(p.status)).reduce((a, p) => a + p.n, 0);
    return out;
  }, [d]);

  const rendersToday = (d?.rendersToday ?? []).reduce((a, r) => a + r.n, 0);
  const approvedToday = (d?.rendersToday ?? []).filter(r => r.qc === "approved").reduce((a, r) => a + r.n, 0);
  const premiumToday = (d?.rendersToday ?? []).filter(r => r.kind !== "economic").reduce((a, r) => a + r.n, 0);
  const postsToday = (d?.postsToday ?? []).reduce((a, r) => a + r.n, 0);
  const target = d?.dailyTarget ?? 30;
  const premiumWaiting = (d?.premium ?? []).filter(p => p.status === "requested" || p.status === "generating").reduce((a, p) => a + p.n, 0);
  const budgetPct = d ? Math.min(100, (d.monthCostUsd / Math.max(1, d.monthlyBudgetUsd)) * 100) : 0;
  const today = new Date().toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      <PageHeader
        kicker={`ON AIR · ${new Date().toISOString().slice(0, 10)}`}
        title="غرفة التحكم"
        subtitle={`${today} — هدف اليوم ${target} ريل: ${d?.premiumSharePercent ?? 30}% Premium من Higgsfield و${100 - (d?.premiumSharePercent ?? 30)}% اقتصادي من الاستوديو.`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/automation">
                <Timer /> دفعة اليوم
              </Link>
            </Button>
            <Button asChild>
              <Link href="/render">
                <Layers /> الرندر الجماعي
              </Link>
            </Button>
          </>
        }
      />

      {/* Autopilot strip */}
      <Link href="/automation" className="panel mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-tally/20 px-4 py-3 text-sm">
        <Tally
          tone={!ap.data?.workerEnabled ? "stop" : ap.data.workerAlive ? "go" : "hold"}
          live={Boolean(ap.data?.workerAlive)}
          label={!ap.data?.workerEnabled ? "الاستوديو الآلي متوقف" : ap.data.workerAlive ? "الاستوديو الآلي يعمل" : "الاستوديو الآلي يبدأ…"}
        />
        <span className="timecode text-xs text-muted-foreground">
          طابور {ap.data?.queue.queued ?? 0} · يُرندر {ap.data?.queue.running ?? 0} · تم {ap.data?.queue.done ?? 0} · فشل {ap.data?.queue.failed ?? 0}
        </span>
        <span className="mr-auto text-xs text-tally">فتح لوحة الاستوديو الآلي ←</span>
      </Link>

      {/* Creative pipeline cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {STAGES.map((st, i) => (
            <Link key={st.key} href={st.href} className="panel group relative overflow-hidden p-4 transition-all hover:-translate-y-0.5 hover:border-tally/35">
              <div className="timecode text-[10px] text-muted-foreground/70">{String(i + 1).padStart(2, "0")}</div>
              <div className="timecode mt-2 text-3xl font-bold tracking-[-0.06em] group-hover:text-tally">{stageCounts[st.key] ?? 0}</div>
              <div className="mt-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">{st.label}</div>
              <div className="absolute inset-x-0 bottom-0 h-0.5 origin-right scale-x-0 bg-tally transition-transform duration-300 group-hover:scale-x-100" />
            </Link>
          ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="panel p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">تقدم هدف اليوم (ريلات معتمدة)</div>
              <div className="timecode mt-1 text-4xl font-semibold">
                {approvedToday}
                <span className="text-xl text-muted-foreground"> / {target}</span>
              </div>
            </div>
            <Tally tone={approvedToday >= target ? "go" : "hold"} live={approvedToday < target} label={approvedToday >= target ? "الهدف مكتمل" : "قيد الإنتاج"} />
          </div>
          <Progress value={Math.min(100, (approvedToday / Math.max(1, target)) * 100)} className="mt-4 h-2" />
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="نصوص اليوم" value={d?.scriptsToday ?? 0} />
            <Stat label="رندرات اليوم" value={rendersToday} hint={`${premiumToday} من فيديو Premium`} />
            <Stat label="منشورات مجدولة اليوم" value={postsToday} />
            <Stat label="Premium بانتظار Higgsfield" value={premiumWaiting} tone={premiumWaiting ? "hold" : "go"} />
          </div>
        </div>
        <div className="panel p-5">
          <div className="text-sm text-muted-foreground">تكلفة الشهر مقابل الميزانية</div>
          <div className="timecode mt-1 text-3xl font-semibold">{formatUsd(d?.monthCostUsd ?? 0)}</div>
          <div className="text-xs text-muted-foreground">من {formatUsd(d?.monthlyBudgetUsd ?? 0)}</div>
          <Progress value={budgetPct} className="mt-4 h-2" />
          <div className="mt-4 flex flex-col gap-2">
            <Button asChild variant="secondary" className="justify-between">
              <Link href="/premium">
                <span className="flex items-center gap-2">
                  <Sparkles className="text-tally" /> انسخ برومبتات Higgsfield
                </span>
                <ArrowLeft />
              </Link>
            </Button>
            <Button asChild variant="secondary" className="justify-between">
              <Link href="/qc">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="text-go" /> راجع الجودة قبل النشر
                </span>
                <ArrowLeft />
              </Link>
            </Button>
            <Button asChild variant="secondary" className="justify-between">
              <Link href="/studio">
                <span className="flex items-center gap-2">
                  <Clapperboard className="text-chart-3" /> افتح الاستوديو
                </span>
                <ArrowLeft />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">آخر الدفعات</h2>
            <Link href="/scripts" className="text-xs text-tally hover:underline">
              كل النصوص
            </Link>
          </div>
          {(d?.recentBatches ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد دفعات بعد. ابدأ من "الأتمتة اليومية" أو "بنك الأفكار".</p>
          ) : (
            <div className="flex flex-col divide-y">
              {d!.recentBatches.map(b => (
                <div key={b.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{b.name}</div>
                    <div className="timecode text-[11px] text-muted-foreground">{new Date(b.createdAt).toLocaleString("en-GB")}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="timecode text-xs text-muted-foreground">
                      {b.totalScripts} نص · {b.premiumScripts} Premium
                    </span>
                    <StatusTally status={b.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">جاهزية الشخصيات</h2>
            <Link href="/characters" className="text-xs text-tally hover:underline">
              إدارة الشخصيات
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(d?.characters ?? []).map(c => (
              <Link key={c.id} href={`/characters/${c.id}`} className="flex items-center gap-2 rounded-md border p-2 transition-colors hover:bg-accent/40">
                <CharacterAvatar character={map.get(c.id)} size={28} />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{c.name}</div>
                  {c.needsDesignFile && !c.hasImage ? (
                    <Tally tone="hold" label="بانتظار ملف التصميم" className="text-[10px]" />
                  ) : !c.isActive ? (
                    <Tally tone="idle" label="متوقفة" className="text-[10px]" />
                  ) : (
                    <Tally tone={c.hasImage ? "go" : "stop"} label={c.hasImage ? "جاهزة" : "بلا صورة"} className="text-[10px]" />
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
