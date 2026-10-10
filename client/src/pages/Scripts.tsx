import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { HOOK_TYPES, STATUS_LABELS, TEMPLATES, type TemplateKey } from "@shared/domain";
import { AlertTriangle, ChevronDown, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import BatchDialog from "@/components/fab/BatchDialog";
import { CharacterAvatar, EmptyBlock, PageHeader, StatusTally, TrackBadge, useCharacterMap, type ScriptRow } from "@/components/fab/common";
import ScriptEditor, { WordMeter } from "@/components/fab/ScriptEditor";

type Status = ScriptRow["status"];
type Track = ScriptRow["track"];

function NewScriptDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { list } = useCharacterMap();
  const utils = trpc.useUtils();
  const [f, setF] = useState({ characterId: 0, track: "economic" as Track, templateKey: "direct_tip" as TemplateKey, hook: "", body: "", payoff: "", cta: "", onScreenText: "", caption: "", hashtags: "#AIcharacter" });
  const create = trpc.scripts.create.useMutation({
    onSuccess: () => {
      utils.scripts.list.invalidate();
      toast.success("تمت إضافة النص");
      onOpenChange(false);
    },
    onError: e => toast.error(e.message),
  });
  const set = (k: keyof typeof f, v: string | number) => setF(p => ({ ...p, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>نص يدوي جديد</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Select value={f.characterId ? String(f.characterId) : ""} onValueChange={v => set("characterId", Number(v))}>
              <SelectTrigger>
                <SelectValue placeholder="الشخصية" />
              </SelectTrigger>
              <SelectContent>
                {list.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={f.track} onValueChange={v => set("track", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="economic">اقتصادي</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
              </SelectContent>
            </Select>
            <Select value={f.templateKey} onValueChange={v => set("templateKey", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATES.map(t => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(["hook", "body", "payoff", "cta"] as const).map(k => (
            <div key={k} className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">{{ hook: "Hook", body: "الفكرة", payoff: "النتيجة", cta: "CTA" }[k]}</Label>
              <Textarea rows={k === "body" ? 3 : 2} dir="ltr" value={f[k]} onChange={e => set(k, e.target.value)} />
            </div>
          ))}
          <Input placeholder="On-screen text" dir="ltr" value={f.onScreenText} onChange={e => set("onScreenText", e.target.value)} />
          <Textarea placeholder="Caption" dir="ltr" rows={2} value={f.caption} onChange={e => set("caption", e.target.value)} />
          <Input placeholder="#hashtags" dir="ltr" value={f.hashtags} onChange={e => set("hashtags", e.target.value)} />
        </div>
        <DialogFooter>
          <Button
            disabled={!f.characterId || !f.hook || !f.body || create.isPending}
            onClick={() =>
              create.mutate({
                characterId: f.characterId,
                track: f.track,
                templateKey: f.templateKey,
                hook: f.hook,
                body: f.body,
                payoff: f.payoff || null,
                cta: f.cta || null,
                onScreenText: f.onScreenText || null,
                caption: f.caption || null,
                hashtags: f.hashtags || null,
              })
            }
          >
            إضافة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Scripts() {
  const { list: characters, map } = useCharacterMap();
  const utils = trpc.useUtils();
  const [characterId, setCharacterId] = useState<number | undefined>();
  const [status, setStatus] = useState<Status | "all">("all");
  const [track, setTrack] = useState<Track | "all">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<ScriptRow | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const q = trpc.scripts.list.useQuery({
    characterId,
    status: status === "all" ? undefined : [status],
    track: track === "all" ? undefined : track,
    search: search.trim() || undefined,
    limit: 500,
  });
  const rows = q.data ?? [];
  const bulk = trpc.scripts.bulkStatus.useMutation({
    onSuccess: r => {
      utils.scripts.list.invalidate();
      setSelected(new Set());
      toast.success(`تم تحديث ${r.updated} نص`);
    },
  });
  const remove = trpc.scripts.remove.useMutation({
    onSuccess: r => {
      utils.scripts.list.invalidate();
      setSelected(new Set());
      toast.success(`تم حذف ${r.removed} نص`);
    },
  });
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const counts = useMemo(() => {
    const c = { premium: 0, economic: 0, derivative: 0, flagged: 0 };
    for (const r of rows) {
      c[r.track]++;
      if ((r.complianceFlags ?? []).some(f => f.severity === "block") || r.duplicateOf) c.flagged++;
    }
    return c;
  }, [rows]);

  return (
    <div>
      <PageHeader
        kicker="SCRIPT BANK"
        title="بنك الأفكار والنصوص"
        subtitle="كل نص: Hook ← فكرة ← نتيجة ← CTA بـ30–40 كلمة إنجليزية (≈15 ثانية). يُفحص تلقائيًا للادعاءات الممنوعة والتكرار."
        actions={
          <>
            <Button variant="outline" onClick={() => setNewOpen(true)}>
              <Plus /> نص يدوي
            </Button>
            <Button onClick={() => setBatchOpen(true)}>
              <Sparkles /> توليد دفعة
            </Button>
          </>
        }
      />

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في Hook أو الفكرة أو الموضوع" className="pr-8" />
        </div>
        <Select value={characterId ? String(characterId) : "all"} onValueChange={v => setCharacterId(v === "all" ? undefined : Number(v))}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الشخصيات</SelectItem>
            {characters.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={v => setStatus(v as Status | "all")}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={track} onValueChange={v => setTrack(v as Track | "all")}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المسارات</SelectItem>
            <SelectItem value="economic">اقتصادي</SelectItem>
            <SelectItem value="premium">Premium</SelectItem>
            <SelectItem value="derivative">مشتق</SelectItem>
          </SelectContent>
        </Select>
        <div className="timecode mr-auto text-xs text-muted-foreground">
          {rows.length} نص · {counts.premium} P · {counts.derivative} D · {counts.economic} E{counts.flagged ? ` · ${counts.flagged} تنبيه` : ""}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="panel mb-3 flex flex-wrap items-center gap-2 border-tally/40 p-2.5">
          <span className="timecode px-2 text-sm">{selected.size} محدد</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                تغيير الحالة <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <DropdownMenuItem key={k} onClick={() => bulk.mutate({ ids: Array.from(selected), status: k as Status })}>
                  {v}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="ghost"
            className="text-stop"
            onClick={() => {
              if (confirm(`حذف ${selected.size} نص نهائيًا؟`)) remove.mutate({ ids: Array.from(selected) });
            }}
          >
            <Trash2 /> حذف
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            إلغاء التحديد
          </Button>
        </div>
      )}

      {q.isLoading ? (
        <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
      ) : rows.length === 0 ? (
        <EmptyBlock title="لا توجد نصوص بعد" action={<Button onClick={() => setBatchOpen(true)}><Sparkles /> ولّد أول دفعة</Button>}>
          اضغط "توليد دفعة" لتوليد نصوص لكل الشخصيات حسب حصصها اليومية ونسبة Premium.
        </EmptyBlock>
      ) : (
        <div className="panel overflow-hidden">
          <div className="hidden grid-cols-[32px_180px_1fr_110px_120px_140px] gap-3 border-b px-3 py-2 text-[11px] text-muted-foreground md:grid">
            <Checkbox
              checked={allSelected}
              onCheckedChange={v => setSelected(v ? new Set(rows.map(r => r.id)) : new Set())}
            />
            <span>الشخصية</span>
            <span>Hook والفكرة</span>
            <span>القالب</span>
            <span>الطول</span>
            <span>الحالة</span>
          </div>
          <div className="divide-y">
            {rows.map(r => {
              const c = map.get(r.characterId);
              const blocked = (r.complianceFlags ?? []).some(f => f.severity === "block");
              const warned = (r.complianceFlags ?? []).length > 0 || Boolean(r.duplicateOf);
              return (
                <div
                  key={r.id}
                  className={cn("grid cursor-pointer grid-cols-[32px_1fr] gap-3 px-3 py-2.5 transition-colors hover:bg-accent/30 md:grid-cols-[32px_180px_1fr_110px_120px_140px]", selected.has(r.id) && "bg-tally/5")}
                  onClick={() => setEditing(r)}
                >
                  <div onClick={e => e.stopPropagation()} className="pt-1">
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={v =>
                        setSelected(prev => {
                          const n = new Set(prev);
                          if (v) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <CharacterAvatar character={c} size={26} />
                    <div className="min-w-0">
                      <div className="truncate text-sm">{c?.name}</div>
                      <div className="flex items-center gap-1.5">
                        <TrackBadge track={r.track} />
                        <span className="timecode text-[10px] text-muted-foreground">#{r.id}</span>
                      </div>
                    </div>
                  </div>
                  <div className="col-start-2 min-w-0 md:col-start-auto" dir="ltr">
                    <div className="flex items-start gap-1.5">
                      {warned && <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", blocked ? "text-stop" : "text-hold")} />}
                      <div className="line-clamp-1 text-sm font-medium">{r.hook}</div>
                    </div>
                    <div className="line-clamp-1 text-xs text-muted-foreground">{r.body}</div>
                  </div>
                  <div className="col-start-2 text-xs text-muted-foreground md:col-start-auto">
                    {TEMPLATES.find(t => t.key === r.templateKey)?.label}
                    <div className="text-[10px]">{HOOK_TYPES.find(h => h.key === r.hookType)?.label}</div>
                  </div>
                  <div className="col-start-2 md:col-start-auto">
                    <WordMeter words={r.wordCount} />
                  </div>
                  <div className="col-start-2 md:col-start-auto">
                    <StatusTally status={r.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ScriptEditor script={editing} open={editing !== null} onOpenChange={v => !v && setEditing(null)} />
      <BatchDialog open={batchOpen} onOpenChange={setBatchOpen} />
      <NewScriptDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
