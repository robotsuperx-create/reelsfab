import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyText, proxied } from "@/lib/api";
import { useTtsStatus } from "@/lib/tts";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { QC_LABELS, STATUS_LABELS, TRACK_LABELS } from "@shared/domain";
import type { inferRouterOutputs } from "@trpc/server";
import { Check, Copy } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { AppRouter } from "../../../../server/routers";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type CharacterRow = RouterOutputs["characters"]["list"][number];
export type ScriptRow = RouterOutputs["scripts"]["list"][number];

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 ltr" dir="ltr">
      <div className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-[10px] border border-tally/80 bg-tally text-[10px] font-black tracking-[-0.08em] text-black shadow-[0_0_22px_oklch(0.92_0.24_112_/_35%)]">
        <span className="relative z-10">RF</span>
        <span className="absolute -bottom-3 -left-2 h-7 w-7 rounded-full bg-white/45 blur-md" />
      </div>
      {!compact && (
        <span className="font-display text-[17px] font-extrabold tracking-[-0.04em]">
          REELS<span className="text-tally">/</span><span className="text-foreground">FAB</span>
        </span>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, kicker }: { title: string; subtitle?: ReactNode; actions?: ReactNode; kicker?: string }) {
  return (
    <div className="relative mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="relative">
        {kicker && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-tally/25 bg-tally/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-tally">
            <span className="tally-dot tally-live" style={{ width: 5, height: 5 }} />
            <span className="timecode">{kicker}</span>
          </div>
        )}
        <h1 className="max-w-3xl text-3xl font-extrabold leading-[1.08] tracking-[-0.045em] md:text-5xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "go" | "hold" | "stop" | "idle" | "info";
const toneClass: Record<Tone, string> = {
  go: "text-go",
  hold: "text-hold",
  stop: "text-stop",
  idle: "text-muted-foreground",
  info: "text-chart-3",
};

export function Tally({ tone, label, live = false, className }: { tone: Tone; label: ReactNode; live?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", className)}>
      <span className={cn("tally-dot", toneClass[tone], live && "tally-live")} />
      <span className="text-foreground/90">{label}</span>
    </span>
  );
}

const statusTone: Record<string, Tone> = {
  idea: "idle",
  script_ready: "info",
  prompt_ready: "hold",
  premium_uploaded: "info",
  rendered: "info",
  approved: "go",
  needs_review: "hold",
  rejected: "stop",
  scheduled: "info",
  published: "go",
  pending: "idle",
  queued: "info",
  failed: "stop",
  skipped: "idle",
  requested: "hold",
  generating: "hold",
  received: "go",
  running: "hold",
  done: "go",
};

export function StatusTally({ status, kind = "script" }: { status: string; kind?: "script" | "qc" | "post" | "clip" }) {
  const label =
    kind === "qc"
      ? QC_LABELS[status] ?? status
      : kind === "post"
        ? ({ queued: "مجدول", published: "منشور", failed: "فشل", skipped: "متخطى" } as Record<string, string>)[status] ?? status
        : kind === "clip"
          ? ({ requested: "بانتظار التوليد", generating: "قيد التوليد", received: "تم الاستلام", failed: "فشل" } as Record<string, string>)[status] ?? status
          : STATUS_LABELS[status] ?? status;
  return <Tally tone={statusTone[status] ?? "idle"} label={label} live={status === "generating" || status === "running"} />;
}

export function TrackBadge({ track }: { track: string }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium",
        track === "premium" && "border-tally/40 bg-tally/10 text-tally",
        track === "derivative" && "border-chart-3/40 bg-chart-3/10 text-chart-3",
        track === "economic" && "border-border bg-secondary text-muted-foreground",
      )}
    >
      {TRACK_LABELS[track] ?? track}
    </span>
  );
}

export function CharacterAvatar({ character, size = 36, className }: { character?: Pick<CharacterRow, "name" | "referenceImages" | "colors"> | null; size?: number; className?: string }) {
  const img = character?.referenceImages?.[0];
  return (
    <div
      className={cn("shrink-0 overflow-hidden rounded-xl border bg-secondary shadow-lg", className)}
      style={{ width: size, height: size * 1.25, background: character?.colors?.primary }}
      title={character?.name}
    >
      {img ? (
        <img src={img} alt={character?.name} className="h-full w-full object-cover object-top" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-display text-xs font-bold text-white/80">
          {character?.name?.slice(0, 2) ?? "?"}
        </div>
      )}
    </div>
  );
}

export function CopyButton({ text, label = "نسخ", size = "sm", variant = "outline" }: { text: string; label?: string; size?: "sm" | "icon-sm" | "default"; variant?: "outline" | "ghost" | "secondary" | "default" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      onClick={async e => {
        e.stopPropagation();
        const ok = await copyText(text);
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } else toast.error("تعذر النسخ");
      }}
    >
      {done ? <Check className="text-go" /> : <Copy />}
      {size !== "icon-sm" && (done ? "تم النسخ" : label)}
    </Button>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="panel group relative overflow-hidden p-4">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-tally/45 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {tone && <span className={cn("tally-dot", toneClass[tone])} />}
        {label}
      </div>
      <div className="timecode mt-2 text-2xl font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function EmptyBlock({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="sprockets mb-3 w-40 opacity-70" />
      <div className="font-display text-base font-semibold">{title}</div>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function TtsStatusBadge() {
  const s = useTtsStatus();
  if (s.state === "idle") return <Tally tone="idle" label="محرك الصوت المجاني: غير محمّل" />;
  if (s.state === "loading") return <Tally tone="hold" live label={`تحميل نموذج الصوت ${Math.round(s.progress)}%`} />;
  if (s.state === "error")
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Tally tone="stop" label="تعذر تحميل محرك الصوت" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{s.error}</TooltipContent>
      </Tooltip>
    );
  return <Tally tone="go" label="محرك الصوت جاهز (مجاني)" />;
}

export function useCharacterMap() {
  const q = trpc.characters.list.useQuery();
  const map = useMemo(() => new Map((q.data ?? []).map(c => [c.id, c])), [q.data]);
  return { list: q.data ?? [], map, isLoading: q.isLoading };
}

export function Timecode({ seconds }: { seconds: number }) {
  const s = Math.max(0, seconds);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  const ff = String(Math.floor((s % 1) * 30)).padStart(2, "0");
  return <span className="timecode">{`${mm}:${ss}:${ff}`}</span>;
}

export function VideoThumb({ url, poster, className }: { url: string; poster?: string | null; className?: string }) {
  return (
    <video
      src={url}
      poster={poster ?? undefined}
      controls
      playsInline
      preload="none"
      className={cn("aspect-[9/16] w-full rounded-lg border bg-black object-cover", className)}
    />
  );
}

export { proxied };
