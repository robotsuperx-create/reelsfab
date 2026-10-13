import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { uploadBlob } from "@/lib/api";
import { defaultMusicFor, renderAndSave, type QcResult } from "@/lib/render/pipeline";
import { prepareEconomic, prepareVideoBased, type MusicChoice, type PreparedReel } from "@/lib/render/prepare";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { KOKORO_VOICES, TEMPLATES } from "@shared/domain";
import { Clapperboard, Download, Eye, Mic, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useSearch } from "wouter";
import { CharacterAvatar, EmptyBlock, PageHeader, StatusTally, TrackBadge, TtsStatusBadge, useCharacterMap } from "@/components/fab/common";
import ReelPreview from "@/components/fab/ReelPreview";

const STUDIO_STATUSES = ["script_ready", "premium_uploaded", "needs_review", "approved", "rendered"] as const;

export default function Studio() {
  const search = useSearch();
  const initialId = Number(new URLSearchParams(search).get("script")) || null;
  const [scriptId, setScriptId] = useState<number | null>(initialId);
  const [filter, setFilter] = useState("");
  const { map } = useCharacterMap();
  const utils = trpc.useUtils();
  const scripts = trpc.scripts.list.useQuery({ status: [...STUDIO_STATUSES], limit: 400 });
  const one = trpc.scripts.get.useQuery({ id: scriptId ?? 0 }, { enabled: scriptId !== null });
  const script = one.data;
  const character = script ? map.get(script.characterId) : undefined;
  const clipQ = trpc.renders.clipForScript.useQuery({ scriptId: scriptId ?? 0 }, { enabled: Boolean(script && script.track !== "economic") });
  const clip = clipQ.data ?? null;
  const assets = trpc.assets.list.useQuery({ kinds: ["character_image", "background"], characterId: script?.characterId ?? null }, { enabled: Boolean(script) });
  const music = trpc.assets.list.useQuery({ kinds: ["music"] });
  const settings = trpc.settings.get.useQuery();
  const createRender = trpc.renders.create.useMutation();
  const eleven = trpc.mediaGeneration.elevenlabsSpeech.useMutation({ onSuccess: r => { setVoiceUrl(r.url); toast.success("تم توليد التعليق الصوتي عبر ElevenLabs"); }, onError: e => toast.error(e.message) });

  const [images, setImages] = useState<string[]>([]);
  const [voice, setVoice] = useState<string>("");
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [musicChoice, setMusicChoice] = useState<MusicChoice>({ kind: "generated", mood: "warm" });
  const [volume, setVolume] = useState(18);
  const [prepared, setPrepared] = useState<PreparedReel | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [qc, setQc] = useState<QcResult | null>(null);
  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const voiceFile = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings.data) setVolume(settings.data.musicVolume);
  }, [settings.data]);

  useEffect(() => {
    setPrepared(null);
    setQc(null);
    setLastBlob(null);
    setVoiceUrl(null);
    if (script && character) {
      setImages((character.referenceImages ?? []).slice(0, 3));
      setVoice(character.ttsVoice);
      setMusicChoice(script.track === "economic" ? defaultMusicFor(script.templateKey) : { kind: "none" });
    }
  }, [script?.id, character?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = useMemo(() => {
    const set = new Set<string>(character?.referenceImages ?? []);
    for (const a of assets.data ?? []) set.add(a.url);
    return Array.from(set);
  }, [character, assets.data]);

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (scripts.data ?? []).filter(s => !f || s.hook.toLowerCase().includes(f) || (map.get(s.characterId)?.name.toLowerCase().includes(f) ?? false));
  }, [scripts.data, filter, map]);

  const videoBased = script ? script.track !== "economic" : false;

  const prepare = async () => {
    if (!script || !character) return;
    setQc(null);
    try {
      let p: PreparedReel;
      if (videoBased) {
        if (!clip?.videoUrl) throw new Error("لا يوجد فيديو Premium مرفوع لهذا النص");
        p = await prepareVideoBased({ script, character, clip, kind: script.track === "premium" ? "premium" : "derivative", music: musicChoice, musicVolume: volume, onStep: setStep });
      } else {
        p = await prepareEconomic({ script, character, imageUrls: images, music: musicChoice, musicVolume: volume, voiceUrl, voiceOverride: voice, onStep: setStep });
      }
      setPrepared(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التجهيز");
    } finally {
      setStep(null);
    }
  };

  const exportNow = async () => {
    if (!prepared || !character) return;
    setProgress(0);
    try {
      const r = await renderAndSave({
        prepared,
        slug: character.slug,
        create: p => createRender.mutateAsync(p) as Promise<{ id: number; qc: QcResult }>,
        onProgress: (phase, v) => {
          setStep(phase === "encoding" ? "ترميز MP4" : phase === "uploading" ? "رفع الملف" : "فحص الجودة");
          if (phase === "encoding") setProgress(v * 100);
        },
      });
      setQc(r.qc);
      setLastBlob(r.blob);
      utils.renders.list.invalidate();
      utils.scripts.list.invalidate();
      toast.success("تم حفظ الريل وفحصه");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التصدير");
    } finally {
      setProgress(null);
      setStep(null);
    }
  };

  const onVoiceFile = async (f: File | undefined) => {
    if (!f || !script) return;
    try {
      setStep("رفع التعليق الصوتي");
      const r = await uploadBlob(f, { kind: "voice", filename: f.name, characterId: script.characterId });
      setVoiceUrl(r.url);
      toast.success("سيُستخدم هذا الصوت بدل الصوت المجاني");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل الرفع");
    } finally {
      setStep(null);
    }
  };

  return (
    <div>
      <PageHeader
        kicker="ECONOMIC STUDIO · 1080×1920 · 15s"
        title="الاستوديو الاقتصادي"
        subtitle="صورة الشخصية + حركة كاميرا + صوت مجاني + ترجمة كلمة بكلمة + وسم AI + CTA. الرندر يتم داخل متصفحك مجانًا (Chrome/Edge)."
        actions={<TtsStatusBadge />}
      />
      <div className="grid gap-5 xl:grid-cols-[300px_1fr_340px]">
        <div className="panel flex max-h-[78vh] flex-col overflow-hidden">
          <div className="border-b p-2.5">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="ابحث عن نص أو شخصية" className="pr-8" />
            </div>
          </div>
          <div className="flex-1 divide-y overflow-y-auto">
            {list.map((s, index) => (
              <button
                key={`script-${s.id}-${index}`}
                onClick={() => setScriptId(s.id)}
                className={cn("flex w-full items-start gap-2 p-2.5 text-right transition-colors hover:bg-accent/40", s.id === scriptId && "bg-tally/10")}
              >
                <CharacterAvatar character={map.get(s.characterId)} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-xs font-medium" dir="ltr">
                    {s.hook}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <TrackBadge track={s.track} />
                    <StatusTally status={s.status} />
                  </div>
                </div>
              </button>
            ))}
            {list.length === 0 && <div className="p-4 text-xs text-muted-foreground">لا توجد نصوص جاهزة للرندر.</div>}
          </div>
        </div>

        <div className="panel flex min-h-[560px] items-center justify-center p-5">
          {prepared ? (
            <ReelPreview prepared={prepared} />
          ) : (
            <EmptyBlock title={script ? "اضغط تجهيز المعاينة" : "اختر نصًا من القائمة"}>
              {script ? "يُولّد الصوت ويُحسب توقيت الترجمة ثم تظهر المعاينة الحية بنفس شكل التصدير النهائي." : "النصوص الجاهزة والمشتقة من Premium تظهر هنا."}
            </EmptyBlock>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {script && character ? (
            <>
              <div className="panel p-4">
                <div className="mb-2 flex items-center gap-2">
                  <CharacterAvatar character={character} size={30} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{character.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {TEMPLATES.find(t => t.key === script.templateKey)?.label} · <TrackBadge track={script.track} />
                    </div>
                  </div>
                </div>
                <div className="space-y-1 text-xs leading-relaxed" dir="ltr">
                  <p className="font-semibold">{script.hook}</p>
                  <p className="text-muted-foreground">{script.body}</p>
                  {script.payoff && <p className="text-muted-foreground">{script.payoff}</p>}
                  {script.cta && <p className="text-tally">{script.cta}</p>}
                </div>
              </div>

              {!videoBased ? (
                <div className="panel flex flex-col gap-3 p-4">
                  <Label className="text-xs text-muted-foreground">الصور (تتناوب داخل الريل)</Label>
                  {candidates.length === 0 ? (
                    <div className="text-xs text-stop">لا توجد صور لهذه الشخصية — ارفعها من صفحة الشخصية.</div>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                      {candidates.map((u, index) => {
                        const on = images.includes(u);
                        return (
                          <button
                            key={`image-${index}-${u}`}
                            onClick={() => setImages(prev => (on ? prev.filter(x => x !== u) : [...prev, u]))}
                            className={cn("relative overflow-hidden rounded border-2", on ? "border-tally" : "border-transparent opacity-60")}
                          >
                            <img src={u} alt="" className="aspect-[9/16] w-full object-cover" />
                            {on && <span className="timecode absolute right-0.5 top-0.5 rounded bg-tally px-1 text-[9px] text-black">{images.indexOf(u) + 1}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <Label className="text-xs text-muted-foreground">الصوت</Label>
                  <Select value={voice} onValueChange={setVoice} disabled={Boolean(voiceUrl)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KOKORO_VOICES.map((v, index) => (
                        <SelectItem key={`voice-${v.id}-${index}`} value={v.id}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    {character.externalVoiceId && <Button size="sm" variant="outline" onClick={() => eleven.mutate({ voiceId: character.externalVoiceId!, text: [script.hook, script.body, script.payoff, script.cta].filter(Boolean).join(" ") })} disabled={eleven.isPending || Boolean(voiceUrl)}><Mic /> {eleven.isPending ? "جارٍ توليد ElevenLabs…" : "توليد ElevenLabs"}</Button>}
                    <Button size="sm" variant="outline" onClick={() => voiceFile.current?.click()}>
                      <Mic /> {voiceUrl ? "تم رفع صوت خارجي" : "رفع صوت جاهز (اختياري)"}
                    </Button>
                    {voiceUrl && (
                      <Button size="sm" variant="ghost" onClick={() => setVoiceUrl(null)}>
                        إلغاء
                      </Button>
                    )}
                    <input ref={voiceFile} type="file" accept="audio/*" hidden onChange={e => onVoiceFile(e.target.files?.[0])} />
                  </div>
                </div>
              ) : (
                <div className="panel p-4 text-xs">
                  {clip?.videoUrl ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-go">فيديو Premium جاهز · {((clip.durationMs ?? 0) / 1000).toFixed(1)}s</span>
                      <span className="text-muted-foreground">الترجمة من التفريغ: {(clip.transcriptWords ?? []).length} كلمة. الـHook الجديد يظهر كبطاقة في أول ثانيتين.</span>
                    </div>
                  ) : (
                    <span className="text-stop">لم يُرفع فيديو Premium بعد — ارفعه من مركز Higgsfield.</span>
                  )}
                </div>
              )}

              <div className="panel flex flex-col gap-3 p-4">
                <Label className="text-xs text-muted-foreground">الموسيقى</Label>
                <Select
                  value={musicChoice.kind === "asset" ? `asset:${musicChoice.url}` : musicChoice.kind === "generated" ? `gen:${musicChoice.mood}` : "none"}
                  onValueChange={v => {
                    if (v === "none") setMusicChoice({ kind: "none" });
                    else if (v.startsWith("gen:")) setMusicChoice({ kind: "generated", mood: v.slice(4) as "warm" | "bright" | "moody" });
                    else setMusicChoice({ kind: "asset", url: v.slice(6) });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون موسيقى</SelectItem>
                    <SelectItem value="gen:warm">مولّدة — دافئة</SelectItem>
                    <SelectItem value="gen:bright">مولّدة — مشرقة</SelectItem>
                    <SelectItem value="gen:moody">مولّدة — هادئة/قصصية</SelectItem>
                    {(music.data ?? []).map((m, index) => (
                      <SelectItem key={`music-${m.id}-${index}`} value={`asset:${m.url}`}>
                        {m.title || `#${m.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label className="text-xs text-muted-foreground">مستوى الموسيقى: {volume}%</Label>
                <Slider value={[volume]} min={0} max={60} step={1} onValueChange={v => setVolume(v[0])} />
              </div>

              <div className="panel flex flex-col gap-3 p-4">
                <Button variant="secondary" onClick={prepare} disabled={step !== null || (videoBased && !clip?.videoUrl) || (!videoBased && images.length === 0)}>
                  <Eye /> {step && progress === null ? step : "تجهيز المعاينة"}
                </Button>
                <Button onClick={exportNow} disabled={!prepared || progress !== null}>
                  <Clapperboard /> {progress !== null ? `${step ?? ""} ${Math.round(progress)}%` : "تصدير MP4 وحفظ"}
                </Button>
                {progress !== null && <Progress value={progress} className="h-1.5" />}
                {qc && (
                  <div className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium">نتيجة الفحص</span>
                      <StatusTally status={qc.verdict} kind="qc" />
                    </div>
                    <div className="flex flex-col gap-1">
                      {qc.checks.map((c, index) => (
                        <div key={`qc-${c.key}-${index}`} className="flex items-center justify-between text-[11px]">
                          <span className={c.status === "pass" ? "text-muted-foreground" : c.status === "warn" ? "text-hold" : "text-stop"}>{c.label}</span>
                          <span className="timecode text-muted-foreground">{c.detail}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link href="/qc">
                          <ShieldCheck /> صفحة الفحص
                        </Link>
                      </Button>
                      {lastBlob && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const u = URL.createObjectURL(lastBlob);
                            const a = document.createElement("a");
                            a.href = u;
                            a.download = `${character.slug}-${script.id}.mp4`;
                            a.click();
                            setTimeout(() => URL.revokeObjectURL(u), 3000);
                          }}
                        >
                          <Download /> تنزيل
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="panel p-4 text-sm text-muted-foreground">اختر نصًا لعرض الخيارات.</div>
          )}
        </div>
      </div>
    </div>
  );
}
