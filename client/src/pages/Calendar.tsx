import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadUrl, localDayKey, saveTextFile, toCsv, tzOffset } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { PLATFORM_LABELS } from "@shared/domain";
import { CalendarPlus, ChevronLeft, ChevronRight, Download, FileSpreadsheet, MoreHorizontal, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CharacterAvatar, CopyButton, EmptyBlock, PageHeader, StatusTally, TrackBadge, useCharacterMap, type RouterOutputs } from "@/components/fab/common";

type PostRow = RouterOutputs["posts"]["list"][number];
type Unscheduled = RouterOutputs["posts"]["unscheduled"][number];
type Platform = PostRow["post"]["platform"];

const PLATFORM_COLOR: Record<string, string> = {
  tiktok: "bg-[#25F4EE]/15 text-[#25F4EE] border-[#25F4EE]/30",
  instagram: "bg-[#E1306C]/15 text-[#FF6FA3] border-[#E1306C]/30",
  youtube: "bg-[#FF0000]/15 text-[#FF5A5A] border-[#FF0000]/30",
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function ScheduleDialog({ item, onClose }: { item: Unscheduled | null; onClose: () => void }) {
  const settings = trpc.settings.get.useQuery();
  const utils = trpc.useUtils();
  const [day, setDay] = useState(localDayKey());
  const [time, setTime] = useState("18:00");
  const [platforms, setPlatforms] = useState<Platform[] | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const schedule = trpc.posts.schedule.useMutation({
    onSuccess: () => {
      utils.posts.invalidate();
      toast.success("تمت الجدولة");
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  if (!item) return null;
  const plats = platforms ?? ((settings.data?.platforms ?? ["tiktok", "instagram", "youtube"]) as Platform[]);
  const defaultCaption = [item.script.caption, item.script.hashtags].filter(Boolean).join("\n\n");
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>جدولة الريل R#{item.render.id}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">اليوم</Label>
              <Input type="date" value={day} onChange={e => setDay(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">الوقت (بتوقيتك)</Label>
              <Input type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(settings.data?.postingSlots ?? []).map(s => (
              <button key={s} onClick={() => setTime(s)} className={cn("timecode rounded border px-2 py-0.5 text-xs", time === s && "border-tally text-tally")}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">المنصات</Label>
            {(["tiktok", "instagram", "youtube"] as Platform[]).map(p => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <Checkbox checked={plats.includes(p)} onCheckedChange={v => setPlatforms(v ? [...plats, p] : plats.filter(x => x !== p))} />
                {PLATFORM_LABELS[p]}
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">الكابشن</Label>
            <Textarea rows={4} dir="ltr" value={caption ?? defaultCaption} onChange={e => setCaption(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!plats.length || schedule.isPending}
            onClick={() => schedule.mutate({ renderId: item.render.id, platforms: plats, scheduledAt: new Date(`${day}T${time}:00`), caption: caption ?? undefined })}
          >
            <CalendarPlus /> جدولة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublishDialog({ row, onClose }: { row: PostRow | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [url, setUrl] = useState("");
  const update = trpc.posts.update.useMutation({
    onSuccess: () => {
      utils.posts.invalidate();
      toast.success("تم تعليمه كمنشور");
      onClose();
    },
  });
  if (!row) return null;
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تم النشر على {PLATFORM_LABELS[row.post.platform]}</DialogTitle>
        </DialogHeader>
        <Label className="text-xs text-muted-foreground">رابط المنشور (لربط التحليلات لاحقًا)</Label>
        <Input dir="ltr" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.tiktok.com/@.../video/..." />
        <DialogFooter>
          <Button onClick={() => update.mutate({ id: row.post.id, data: { status: "published", postUrl: url || null } })} disabled={update.isPending}>
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CalendarPage() {
  const { map } = useCharacterMap();
  const utils = trpc.useUtils();
  const [weekStart, setWeekStart] = useState(() => startOfDay(new Date()));
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * 86400000), [weekStart]);
  const posts = trpc.posts.list.useQuery({ from: weekStart, to: weekEnd });
  const unscheduled = trpc.posts.unscheduled.useQuery();
  const [scheduling, setScheduling] = useState<Unscheduled | null>(null);
  const [publishing, setPublishing] = useState<PostRow | null>(null);
  const update = trpc.posts.update.useMutation({ onSuccess: () => utils.posts.invalidate() });
  const remove = trpc.posts.remove.useMutation({ onSuccess: () => utils.posts.invalidate() });
  const auto = trpc.posts.autoSchedule.useMutation({
    onSuccess: r => {
      utils.posts.invalidate();
      toast.success(`تمت جدولة ${r.scheduledReels} ريل على خانات النشر`);
    },
    onError: e => toast.error(e.message),
  });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400000)), [weekStart]);
  const byDay = useMemo(() => {
    const m = new Map<string, PostRow[]>();
    for (const p of posts.data ?? []) {
      const k = localDayKey(new Date(p.post.scheduledAt));
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [posts.data]);

  const exportToday = async () => {
    const from = startOfDay(new Date());
    const to = new Date(from.getTime() + 86400000);
    const rows = await utils.posts.list.fetch({ from, to });
    if (!rows.length) return toast.info("لا توجد منشورات اليوم");
    const csv = toCsv(
      rows.map(r => ({
        time: new Date(r.post.scheduledAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        platform: PLATFORM_LABELS[r.post.platform],
        account: r.post.accountHandle ?? "",
        character: map.get(r.post.characterId)?.name ?? "",
        hook: r.script.hook,
        caption: r.post.caption ?? "",
        video: `${window.location.origin}${r.render.videoUrl}`,
        status: r.post.status,
        post_id: r.post.id,
      })),
    );
    saveTextFile(csv, `posting-plan-${localDayKey()}.csv`);
  };

  return (
    <div>
      <PageHeader
        kicker="SCHEDULE · PUBLISHING QUEUE"
        title="التقويم وطابور النشر"
        subtitle="الريلات المعتمدة فقط تُجدول. انسخ الكابشن، نزّل الفيديو، انشره على المنصة، ثم علّمه كمنشور مع الرابط لربط التحليلات."
        actions={
          <>
            <Button variant="outline" onClick={exportToday}>
              <FileSpreadsheet /> جدول اليوم CSV
            </Button>
            <Button onClick={() => auto.mutate({ startDay: localDayKey(), days: 3, tzOffsetMinutes: tzOffset() })} disabled={auto.isPending}>
              <Wand2 /> جدولة تلقائية (3 أيام)
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Button size="icon-sm" variant="outline" aria-label="الأسبوع السابق" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 86400000))}>
              <ChevronRight />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWeekStart(startOfDay(new Date()))}>
              اليوم
            </Button>
            <Button size="icon-sm" variant="outline" aria-label="الأسبوع التالي" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 86400000))}>
              <ChevronLeft />
            </Button>
            <span className="timecode text-sm text-muted-foreground">
              {weekStart.toLocaleDateString("en-GB")} — {new Date(weekEnd.getTime() - 1).toLocaleDateString("en-GB")}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            {days.map(d => {
              const k = localDayKey(d);
              const list = byDay.get(k) ?? [];
              const isToday = k === localDayKey();
              return (
                <div key={k} className={cn("panel flex min-h-[180px] flex-col", isToday && "border-tally/50")}>
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <div className="text-sm font-medium">{d.toLocaleDateString("ar", { weekday: "long" })}</div>
                    <div className="timecode text-[11px] text-muted-foreground">
                      {k.slice(5)} · {list.length}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-2">
                    {list.map(r => {
                      const c = map.get(r.post.characterId);
                      return (
                        <div key={r.post.id} className={cn("rounded-md border p-2", r.post.status === "published" && "opacity-60")}>
                          <div className="flex items-center justify-between gap-1">
                            <span className="timecode text-xs">{new Date(r.post.scheduledAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                            <span className={cn("rounded border px-1.5 text-[10px]", PLATFORM_COLOR[r.post.platform])}>{PLATFORM_LABELS[r.post.platform].split(" ")[0]}</span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <CharacterAvatar character={c} size={18} />
                            <span className="truncate text-[11px]" dir="ltr">
                              {r.script.hook}
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between">
                            <StatusTally status={r.post.status} kind="post" />
                            <div className="flex items-center">
                              <CopyButton text={r.post.caption ?? ""} size="icon-sm" variant="ghost" />
                              <Button size="icon-sm" variant="ghost" aria-label="تنزيل الفيديو" onClick={() => downloadUrl(r.render.videoUrl, `${c?.slug ?? "reel"}-${r.post.platform}-${r.post.id}.mp4`)}>
                                <Download />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon-sm" variant="ghost" aria-label="خيارات المنشور">
                                    <MoreHorizontal />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                  <DropdownMenuItem onClick={() => setPublishing(r)}>تم النشر…</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => update.mutate({ id: r.post.id, data: { status: "skipped" } })}>تخطي</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => update.mutate({ id: r.post.id, data: { status: "queued" } })}>إعادة للطابور</DropdownMenuItem>
                                  <DropdownMenuItem className="text-stop" onClick={() => remove.mutate({ id: r.post.id })}>
                                    حذف من التقويم
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                          {r.post.accountHandle && <div className="mt-1 text-[10px] text-muted-foreground" dir="ltr">@{r.post.accountHandle.replace(/^@/, "")}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="panel flex max-h-[80vh] flex-col">
          <div className="border-b px-3 py-2.5 text-sm font-medium">
            معتمد وغير مجدول <span className="timecode text-muted-foreground">({unscheduled.data?.length ?? 0})</span>
          </div>
          <div className="flex-1 divide-y overflow-y-auto">
            {(unscheduled.data ?? []).length === 0 ? (
              <div className="p-4">
                <EmptyBlock title="لا شيء بانتظار الجدولة">اعتمد الريلات من صفحة فحص الجودة.</EmptyBlock>
              </div>
            ) : (
              unscheduled.data!.map(u => (
                <div key={u.render.id} className="flex items-center gap-2.5 p-2.5">
                  {u.render.thumbnailUrl ? (
                    <img src={u.render.thumbnailUrl} alt="" className="h-16 w-9 rounded object-cover" />
                  ) : (
                    <CharacterAvatar character={map.get(u.render.characterId)} size={36} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-xs" dir="ltr">
                      {u.script.hook}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <TrackBadge track={u.render.kind} />
                      {map.get(u.render.characterId)?.name}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setScheduling(u)}>
                    جدولة
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <ScheduleDialog key={scheduling?.render.id ?? 0} item={scheduling} onClose={() => setScheduling(null)} />
      <PublishDialog key={publishing?.post.id ?? 0} row={publishing} onClose={() => setPublishing(null)} />
    </div>
  );
}
