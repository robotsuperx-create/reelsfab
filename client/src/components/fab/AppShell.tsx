import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getSupabaseClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  CalendarClock,
  Clapperboard,
  Coins,
  Scissors,
  FolderOpen,
  Gauge,
  Layers,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Timer,
  Users,
  Cable,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "./common";
import { BRAND_PORTRAITS, ReelWall } from "./ReelWall";

const NAV: { group: string; items: { href: string; label: string; icon: typeof Gauge }[] }[] = [
  {
    group: "الإنتاج",
    items: [
      { href: "/", label: "غرفة التحكم", icon: Gauge },
      { href: "/characters", label: "الشخصيات", icon: Users },
      { href: "/scripts", label: "بنك الأفكار والنصوص", icon: ScrollText },
      { href: "/premium", label: "مركز Higgsfield", icon: Sparkles },
      { href: "/studio", label: "الاستوديو الاقتصادي", icon: Clapperboard },
      { href: "/render", label: "الرندر الجماعي", icon: Layers },
      { href: "/montage", label: "غرفة المونتاج", icon: Scissors },
    ],
  },
  {
    group: "الجودة والنشر",
    items: [
      { href: "/qc", label: "فحص الجودة", icon: ShieldCheck },
      { href: "/calendar", label: "التقويم والنشر", icon: CalendarClock },
      { href: "/analytics", label: "التحليلات", icon: BarChart3 },
    ],
  },
  {
    group: "التشغيل",
    items: [
      { href: "/library", label: "مكتبة الأصول", icon: FolderOpen },
      { href: "/costs", label: "التكلفة", icon: Coins },
      { href: "/automation", label: "الاستوديو الآلي", icon: Timer },
      { href: "/settings", label: "الإعدادات والفريق", icon: Settings },
      { href: "/integrations", label: "مركز التكاملات", icon: Cable },
    ],
  },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const [loc] = useLocation();
  return (
    <nav className="flex flex-col gap-6" aria-label="التنقل الرئيسي">
      {NAV.map(g => (
        <div key={g.group}>
          <div className="mb-2 px-3 text-[11.5px] font-medium text-muted-foreground/70">{g.group}</div>
          <div className="flex flex-col gap-1">
            {g.items.map(it => {
              const active = it.href === "/" ? loc === "/" : loc.startsWith(it.href);
              const Icon = it.icon;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] leading-none transition-colors focus-visible:outline-2 focus-visible:outline-tally",
                    active ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  {active && <span className="absolute inset-y-2 right-0 w-[3px] rounded-full bg-tally" />}
                  <Icon className={cn("size-[22px] shrink-0", active ? "text-tally" : "text-muted-foreground group-hover:text-foreground")} strokeWidth={active ? 2.2 : 1.9} />
                  <span className="truncate">{it.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Desktop sidebar: full names with large icons. */
function Rail() {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 hidden w-[236px] flex-col border-l border-sidebar-border bg-sidebar lg:flex">
      <div className="px-4 pb-3 pt-5">
        <Link href="/" aria-label="غرفة التحكم" className="inline-flex">
          <Logo />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-6">
        <NavList />
      </div>
    </aside>
  );
}

function AutopilotPill() {
  const st = trpc.automation.status.useQuery(undefined, { refetchInterval: 30000, retry: false });
  const d = st.data;
  const live = Boolean(d?.workerEnabled && d.workerAlive);
  const queued = (d?.queue.queued ?? 0) + (d?.queue.running ?? 0);
  return (
    <Link
      href="/automation"
      className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1.5 pl-3.5 pr-3 text-[12.5px] transition-colors hover:border-white/20"
    >
      <span className={cn("tally-dot", live ? "text-tally tally-live" : d?.workerEnabled ? "text-hold" : "text-muted-foreground")} style={{ width: 7, height: 7 }} />
      <span className="text-foreground/90">{live ? "الاستوديو يعمل" : d?.workerEnabled ? "الاستوديو يبدأ" : "الاستوديو متوقف"}</span>
      {queued > 0 && <span className="num text-muted-foreground">{queued} في الطابور</span>}
    </Link>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-4 pt-5">
        <Logo />
        <div className="mt-2 text-[12px] text-muted-foreground">مصنع ريلات شخصيات AI</div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <NavList onNavigate={onNavigate} />
      </div>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{user?.name || user?.email || "عضو الفريق"}</div>
            <div className="text-[11px] text-muted-foreground">{user?.role === "admin" ? "مدير" : "عضو فريق"}</div>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={() => logout()} title="تسجيل الخروج">
            <LogOut />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { user, loading, refresh } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [supabaseEmail, setSupabaseEmail] = useState("");
  const [supabasePassword, setSupabasePassword] = useState("");
  const [supabaseMode, setSupabaseMode] = useState<"signin" | "signup">("signin");
  const [supabaseBusy, setSupabaseBusy] = useState(false);
  const [supabaseMessage, setSupabaseMessage] = useState<string | null>(null);
  const localLogin = trpc.auth.localLogin.useMutation({
    onSuccess: async () => {
      setPassword("");
      await refresh();
    },
  });
  const access = trpc.team.access.useQuery(undefined, { enabled: Boolean(user), retry: false });
  const handleSupabaseAuth = async (event: FormEvent) => {
    event.preventDefault();
    setSupabaseMessage(null);
    const supabase = getSupabaseClient();
    if (!supabase) {
      setSupabaseMessage("لم تُضبط مفاتيح Supabase العامة بعد.");
      return;
    }
    setSupabaseBusy(true);
    try {
      const result = supabaseMode === "signin"
        ? await supabase.auth.signInWithPassword({ email: supabaseEmail, password: supabasePassword })
        : await supabase.auth.signUp({ email: supabaseEmail, password: supabasePassword });
      if (result.error) throw result.error;
      if (result.data.session) {
        setSupabasePassword("");
        await refresh();
      } else {
        setSupabaseMessage("تم إنشاء الحساب. تحقق من بريدك الإلكتروني ثم سجّل الدخول.");
        setSupabaseMode("signin");
      }
    } catch (error) {
      setSupabaseMessage(error instanceof Error ? error.message : "تعذر إتمام مصادقة Supabase.");
    } finally {
      setSupabaseBusy(false);
    }
  };
  if (loading || (user && access.isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-6 text-tally" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="grid min-h-screen lg:grid-cols-[minmax(400px,480px)_1fr]">
        <div className="flex items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <Logo />
          <h1 className="display-xl mt-12 text-[44px]">مصنع الريلات</h1>
          <p className="mt-3 text-[15px] leading-7 text-muted-foreground">عشر شخصيات، ريلات جديدة كل يوم. سجّل الدخول لإدارة الإنتاج والنشر.</p>
          <form className="mt-6 space-y-3 text-right" onSubmit={handleSupabaseAuth}>
            <label className="block text-xs text-muted-foreground" htmlFor="supabase-email">البريد الإلكتروني</label>
            <Input
              id="supabase-email"
              type="email"
              value={supabaseEmail}
              onChange={event => setSupabaseEmail(event.target.value)}
              autoComplete="email"
              dir="ltr"
              placeholder="you@example.com"
              required
            />
            <label className="block text-xs text-muted-foreground" htmlFor="supabase-password">كلمة المرور</label>
            <Input
              id="supabase-password"
              type="password"
              value={supabasePassword}
              onChange={event => setSupabasePassword(event.target.value)}
              autoComplete={supabaseMode === "signin" ? "current-password" : "new-password"}
              dir="ltr"
              minLength={6}
              placeholder="••••••••"
              required
            />
            <Button className="w-full" type="submit" variant="outline" disabled={supabaseBusy}>
              {supabaseBusy ? "جارٍ الاتصال…" : supabaseMode === "signin" ? "دخول مستقل" : "إنشاء حساب مستقل"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-[11px] text-tally hover:underline"
              onClick={() => { setSupabaseMode(mode => mode === "signin" ? "signup" : "signin"); setSupabaseMessage(null); }}
            >
              {supabaseMode === "signin" ? "ليس لديك حساب؟ أنشئ حساب Supabase" : "لديك حساب؟ عُد إلى تسجيل الدخول"}
            </button>
            {supabaseMessage && <p className="text-center text-xs text-amber-300">{supabaseMessage}</p>}
          </form>
          <div className="my-5 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>أو دخول محلي آمن</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <form
            className="space-y-3 text-right"
            onSubmit={event => {
              event.preventDefault();
              localLogin.mutate({ identifier, password });
            }}
          >
            <label className="block text-xs text-muted-foreground" htmlFor="local-identifier">رقم الدخول</label>
            <Input
              id="local-identifier"
              value={identifier}
              onChange={event => setIdentifier(event.target.value)}
              autoComplete="username"
              inputMode="tel"
              dir="ltr"
              placeholder="أدخل المعرّف"
              required
            />
            <label className="block text-xs text-muted-foreground" htmlFor="local-password">كلمة المرور</label>
            <Input
              id="local-password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="current-password"
              dir="ltr"
              placeholder="••••••••"
              required
            />
            <Button className="w-full" type="submit" disabled={localLogin.isPending}>
              {localLogin.isPending ? "جارٍ التحقق…" : "دخول محلي"}
            </Button>
            {localLogin.error && <p className="text-center text-xs text-red-400">بيانات الدخول غير صحيحة أو تم تجاوز عدد المحاولات.</p>}
            <p className="text-center text-[11px] leading-5 text-muted-foreground/70">تُرسل البيانات إلى الخادم عبر HTTPS ولا تُخزَّن في المتصفح.</p>
          </form>
        </div>
        </div>
        <div className="relative hidden items-center overflow-hidden lg:flex" aria-hidden="true">
          <ReelWall items={BRAND_PORTRAITS} height={640} className="-mr-16" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-40 bg-gradient-to-l from-background to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-56 bg-gradient-to-r from-background to-transparent" />
        </div>
      </div>
    );
  }
  if (access.data && !access.data.approved) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="panel w-full max-w-md p-8 text-center">
          <div className="flex justify-center">
            <Logo />
          </div>
          <h1 className="mt-6 text-xl font-bold">حسابك بانتظار الموافقة</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            أرسل لمدير الفريق أن يفتح "الإعدادات والفريق" ويعتمد حسابك ({user.email || user.name}). بعد الموافقة حدّث الصفحة.
          </p>
          <Button variant="outline" className="mt-6" onClick={() => window.location.reload()}>
            تحديث
          </Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <Gate>
      <div className="min-h-screen">
        <Rail />
        <div className="lg:pr-[236px]">
          <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-background/85 backdrop-blur-xl">
            <div className="container flex h-16 items-center gap-3">
              <div className="lg:hidden">
                <Logo />
              </div>
              <AutopilotPill />
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <div className="hidden items-center gap-2 sm:flex">
                  <span className="grid size-8 place-items-center rounded-full bg-secondary font-display text-[11px] font-bold text-foreground">{user?.name?.slice(0, 2) || "RL"}</span>
                  <span className="max-w-32 truncate text-[13px] text-muted-foreground">{user?.name || "عضو الفريق"}</span>
                  <Button size="icon-sm" variant="ghost" onClick={() => logout()} title="تسجيل الخروج" aria-label="تسجيل الخروج">
                    <LogOut />
                  </Button>
                </div>
                <Sheet>
                  <SheetTrigger asChild>
                    <Button size="icon-sm" variant="ghost" className="lg:hidden" aria-label="القائمة">
                      <Menu />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-[280px] bg-sidebar p-0">
                    <SheetTitle className="sr-only">القائمة</SheetTitle>
                    <SheetDescription className="sr-only">التنقل بين أقسام المصنع</SheetDescription>
                    <SidebarBody />
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          </header>
          <main className="container flex-1 py-8 md:py-10">{children}</main>
        </div>
      </div>
    </Gate>
  );
}
