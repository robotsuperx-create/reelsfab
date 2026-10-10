import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  CalendarClock,
  Clapperboard,
  Coins,
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
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "./common";

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
      { href: "/automation", label: "الأتمتة اليومية", icon: Timer },
      { href: "/settings", label: "الإعدادات والفريق", icon: Settings },
    ],
  },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const [loc] = useLocation();
  return (
    <nav className="flex flex-col gap-5">
      {NAV.map(g => (
        <div key={g.group}>
          <div className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{g.group}</div>
          <div className="flex flex-col gap-0.5">
            {g.items.map(it => {
              const active = it.href === "/" ? loc === "/" : loc.startsWith(it.href);
              const Icon = it.icon;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={onNavigate}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    active ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  {active && <span className="absolute inset-y-1.5 right-0 w-[3px] rounded-full bg-tally" />}
                  <Icon className={cn("size-4", active ? "text-tally" : "text-muted-foreground group-hover:text-foreground")} />
                  {it.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-4 pt-5">
        <Logo />
        <div className="mt-1.5 text-[11px] text-muted-foreground">مصنع ريلات شخصيات AI · 15s</div>
      </div>
      <div className="sprockets mx-4 mb-4 opacity-60" />
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
  const { user, loading } = useAuth();
  const access = trpc.team.access.useQuery(undefined, { enabled: Boolean(user), retry: false });
  if (loading || (user && access.isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-6 text-tally" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="panel w-full max-w-md p-8 text-center">
          <div className="flex justify-center">
            <Logo />
          </div>
          <div className="sprockets mx-auto my-6 w-48 opacity-70" />
          <h1 className="text-xl font-bold">نظام إنتاج داخلي للفريق</h1>
          <p className="mt-2 text-sm text-muted-foreground">سجّل الدخول للوصول إلى خط إنتاج الريلات، الشخصيات، والتقويم.</p>
          <Button className="mt-6 w-full" onClick={() => startLogin()}>
            تسجيل الدخول
          </Button>
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
  return (
    <Gate>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 border-l border-sidebar-border bg-sidebar lg:block">
          <SidebarBody />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/85 px-4 py-2.5 backdrop-blur lg:hidden">
            <Logo />
            <Sheet>
              <SheetTrigger asChild>
                <Button size="icon-sm" variant="ghost">
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[260px] bg-sidebar p-0">
                <SidebarBody />
              </SheetContent>
            </Sheet>
          </header>
          <main className="container flex-1 py-6 md:py-8">{children}</main>
        </div>
      </div>
    </Gate>
  );
}
