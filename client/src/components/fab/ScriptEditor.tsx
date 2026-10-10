import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  checkCompliance,
  countWords,
  HOOK_TYPES,
  ruleLabel,
  spokenText,
  STATUS_LABELS,
  TEMPLATES,
  WORDS_MAX,
  WORDS_MIN,
  WORDS_TARGET_MAX,
  WORDS_TARGET_MIN,
  type TemplateKey,
} from "@shared/domain";
import { Clapperboard, RefreshCw, Save, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { CharacterAvatar, CopyButton, TrackBadge, useCharacterMap, type ScriptRow } from "./common";

type Editable = {
  topic: string;
  templateKey: TemplateKey;
  hookType: string;
  hook: string;
  body: string;
  payoff: string;
  cta: string;
  onScreenText: string;
  caption: string;
  hashtags: string;
  higgsfieldPrompt: string;
  status: ScriptRow["status"];
};

function toEditable(s: ScriptRow): Editable {
  return {
    topic: s.topic ?? "",
    templateKey: (s.templateKey as TemplateKey) ?? "direct_tip",
    hookType: s.hookType ?? "question",
    hook: s.hook,
    body: s.body,
    payoff: s.payoff ?? "",
    cta: s.cta ?? "",
    onScreenText: s.onScreenText ?? "",
    caption: s.caption ?? "",
    hashtags: s.hashtags ?? "",
    higgsfieldPrompt: s.higgsfieldPrompt ?? "",
    status: s.status,
  };
}

export function WordMeter({ words }: { words: number }) {
  const ok = words >= WORDS_TARGET_MIN && words <= WORDS_TARGET_MAX;
  const warn = !ok && words >= WORDS_MIN && words <= WORDS_MAX;
  const pct = Math.min(100, (words / 50) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-28 overflow-hidden rounded-full bg-secondary">
        <div className="absolute inset-y-0 bg-go/25" style={{ right: `${(WORDS_TARGET_MIN / 50) * 100}%`, width: `${((WORDS_TARGET_MAX - WORDS_TARGET_MIN) / 50) * 100}%` }} />
        <div className={cn("absolute inset-y-0 right-0", ok ? "bg-go" : warn ? "bg-hold" : "bg-stop")} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("timecode text-xs", ok ? "text-go" : warn ? "text-hold" : "text-stop")}>{words} كلمة</span>
    </div>
  );
}

export default function ScriptEditor({ script, open, onOpenChange }: { script: ScriptRow | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const utils = trpc.useUtils();
  const { map } = useCharacterMap();
  const [e, setE] = useState<Editable | null>(null);
  const [hooks, setHooks] = useState<{ hookType: string; hook: string }[]>([]);

  useEffect(() => {
    if (script) {
      setE(toEditable(script));
      setHooks([]);
    }
  }, [script]);

  const update = trpc.scripts.update.useMutation({
    onSuccess: () => {
      utils.scripts.list.invalidate();
      toast.success("تم حفظ النص");
    },
    onError: err => toast.error(err.message),
  });
  const rewrite = trpc.scripts.rewriteHooks.useMutation({
    onSuccess: r => setHooks(r),
    onError: err => toast.error(err.message),
  });

  const live = useMemo(() => {
    if (!e) return { words: 0, flags: [] as ReturnType<typeof checkCompliance> };
    const text = spokenText(e);
    return { words: countWords(text), flags: checkCompliance([text, e.onScreenText, e.caption].join(" ")) };
  }, [e]);

  if (!script || !e) return null;
  const character = map.get(script.characterId);
  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => setE(prev => (prev ? { ...prev, [k]: v } : prev));

  const save = () =>
    update.mutate({
      id: script.id,
      data: {
        topic: e.topic || null,
        templateKey: e.templateKey,
        hookType: e.hookType || null,
        hook: e.hook,
        body: e.body,
        payoff: e.payoff || null,
        cta: e.cta || null,
        onScreenText: e.onScreenText || null,
        caption: e.caption || null,
        hashtags: e.hashtags || null,
        higgsfieldPrompt: e.higgsfieldPrompt || null,
        status: e.status,
      },
    });

  const L = ({ children }: { children: React.ReactNode }) => <Label className="text-xs text-muted-foreground">{children}</Label>;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b pb-3">
          <SheetTitle className="flex items-center gap-3">
            <CharacterAvatar character={character} size={30} />
            <div className="min-w-0 text-right">
              <div className="truncate text-sm">{character?.name}</div>
              <div className="timecode text-[11px] font-normal text-muted-foreground">SCRIPT #{script.id}</div>
            </div>
            <TrackBadge track={script.track} />
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <WordMeter words={live.words} />
            <div className="text-[11px] text-muted-foreground">الهدف 30–40 كلمة ≈ 15 ثانية</div>
          </div>
          {live.flags.length > 0 && (
            <div className="rounded-md border border-stop/40 bg-stop/10 p-2.5 text-xs">
              {live.flags.map(f => (
                <div key={f.rule} className={f.severity === "block" ? "text-stop" : "text-hold"}>
                  {f.severity === "block" ? "ممنوع" : "تحذير"}: {ruleLabel(f.rule)} — <span dir="ltr">“{f.match}”</span>
                </div>
              ))}
            </div>
          )}
          {script.duplicateOf && (
            <div className="rounded-md border border-hold/40 bg-hold/10 p-2.5 text-xs text-hold">
              تشابه {script.similarity}% مع النص #{script.duplicateOf} — غيّر الزاوية أو الـHook.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <L>القالب</L>
              <Select value={e.templateKey} onValueChange={v => set("templateKey", v as TemplateKey)}>
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
            <div className="flex flex-col gap-1.5">
              <L>نوع الـHook</L>
              <Select value={e.hookType} onValueChange={v => set("hookType", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOOK_TYPES.map(h => (
                    <SelectItem key={h.key} value={h.key}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <L>الفكرة / الموضوع</L>
            <Input value={e.topic} onChange={ev => set("topic", ev.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <L>Hook (أول 2 ثانية)</L>
              <Button size="sm" variant="ghost" onClick={() => rewrite.mutate({ id: script.id })} disabled={rewrite.isPending}>
                <Wand2 /> {rewrite.isPending ? "جارٍ الكتابة…" : "بدائل Hook"}
              </Button>
            </div>
            <Textarea value={e.hook} onChange={ev => set("hook", ev.target.value)} rows={2} dir="ltr" />
            {hooks.length > 0 && (
              <div className="flex flex-col gap-1">
                {hooks.map((h, i) => (
                  <button
                    key={i}
                    className="rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors hover:border-tally hover:bg-tally/5"
                    dir="ltr"
                    onClick={() => {
                      set("hook", h.hook);
                      set("hookType", h.hookType);
                    }}
                  >
                    <span className="text-muted-foreground">[{h.hookType}]</span> {h.hook}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <L>الفكرة (Body)</L>
            <Textarea value={e.body} onChange={ev => set("body", ev.target.value)} rows={3} dir="ltr" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <L>النتيجة (Payoff)</L>
              <Textarea value={e.payoff} onChange={ev => set("payoff", ev.target.value)} rows={2} dir="ltr" />
            </div>
            <div className="flex flex-col gap-1.5">
              <L>CTA</L>
              <Textarea value={e.cta} onChange={ev => set("cta", ev.target.value)} rows={2} dir="ltr" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <L>نص الشاشة (≤ 6 كلمات) — للمقارنة استخدم "A vs B"</L>
            <Input value={e.onScreenText} onChange={ev => set("onScreenText", ev.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <L>الكابشن</L>
              <CopyButton text={`${e.caption}\n\n${e.hashtags}`.trim()} label="نسخ مع الهاشتاغات" variant="ghost" />
            </div>
            <Textarea value={e.caption} onChange={ev => set("caption", ev.target.value)} rows={2} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <L>الهاشتاغات (#AIcharacter إلزامي)</L>
            <Input value={e.hashtags} onChange={ev => set("hashtags", ev.target.value)} dir="ltr" />
          </div>
          {script.track === "premium" && (
            <div className="flex flex-col gap-1.5">
              <L>مشهد Higgsfield (بالإنجليزية)</L>
              <Textarea value={e.higgsfieldPrompt} onChange={ev => set("higgsfieldPrompt", ev.target.value)} rows={3} dir="ltr" />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <L>الحالة</L>
            <Select value={e.status} onValueChange={v => set("status", v as Editable["status"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t bg-background/95 p-4 backdrop-blur">
            <Button onClick={save} disabled={update.isPending}>
              {update.isPending ? <RefreshCw className="animate-spin" /> : <Save />} حفظ
            </Button>
            {script.track !== "premium" || script.premiumClipId ? (
              <Button asChild variant="secondary">
                <Link href={`/studio?script=${script.id}`}>
                  <Clapperboard /> فتح في الاستوديو
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
