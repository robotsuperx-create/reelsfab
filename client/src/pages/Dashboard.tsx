import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { tzOffset } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import { formatUsd } from "@shared/domain";
import { ArrowLeft, Clapperboard, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";
import { CharacterAvatar, Stat, StatusTally, Tally, useCharacterMap } from "@/components/fab/common";
import { ReelWall } from "@/components/fab/ReelWall";

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
  const { map, list } = useCharacterMap();
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
      <section className="relative mb-8 grid items-end gap-8 overflow-hidden lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="relative z-10">
          <p className="text-[15px] text-muted-foreground">{today}</p>
          <h1 className="display-xl mt-3 text-[64px] md:text-[96px]">
            <span className="num">{approvedToday}</span>
            <span className="text-muted-foreground/60"> / </span>
            <span className="num text-muted-foreground/60">{target}</span>
          </h1>
          <p className="mt-3 max-w-[40ch] text-[17px] leading-8 text-foreground/85">
            {approvedToday >= target
              ? "اكتمل هدف اليوم. الريلات المعتمدة في طريقها إلى التقويم."
              : `ريل معتمد اليوم من هدف ${target}. ${d?.premiumSharePercent ?? 30}% منها Premium من Higgsfield والباقي من الاستوديو.`}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link href="/automation">
                <Timer /> الاستوديو الآلي
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/qc">
                <ShieldCheck /> مراجعة الجودة
              </Link>
            </Button>
          </div>
        </div>
        <div className="relative -mx-4 lg:mx-0">
          <ReelWall
            height={360}
            items={list
              .filter(c => c.isActive)
              .sort((a, b) => Number(!!b.referenceImages?.[0]) - Number(!!a.referenceImages?.[0]))
              .map(c => ({ key: c.id, src: c.referenceImages?.[0], name: c.name, caption: c.niche ?? undefined, href: `/characters/${c.id}`, color: c.colors?.primary }))}
          />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent" />
        </div>
      </section>

      {/* Creative pipeline cards */}
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 lg:grid-cols-7">
          {STAGES.map(st => (
            <Link key={st.key} href={st.href} className="panel group relative min-w-[132px] shrink-0 snap-start overflow-hidden p-4 transition-colors hover:border-tally/35">
              <div className="num text-3xl font-bold group-hover:text-tally">{stageCounts[st.key] ?? 0}</div>
              <div className="mt-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">{st.label}</div>
              <div className="absolute inset-x-0 bottom-0 h-0.5 origin-right scale-x-0 bg-tally transition-transform duration-300 group-hover:scale-x-100" />
            </Link>
          ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="panel p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-semibold">إنتاج اليوم</div>
              <div className="mt-0.5 text-sm text-muted-foreground">{Math.max(0, target - approvedToday)} ريل متبقٍ للوصول إلى الهدف</div>
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
          <div className="num mt-1 text-3xl font-bold">{formatUsd(d?.monthCostUsd ?? 0)}</div>
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
