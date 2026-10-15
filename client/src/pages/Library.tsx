import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { downloadUrl, uploadBlob, type UploadKind } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import { Download, ImagePlus, Star, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { CharacterAvatar, EmptyBlock, PageHeader, useCharacterMap } from "@/components/fab/common";

type Kind = UploadKind;
const KIND_LABELS: Record<Kind, string> = {
  character_image: "صور الشخصيات",
  background: "خلفيات",
  music: "موسيقى",
  voice: "أصوات",
  premium_video: "فيديوهات Premium",
  render: "ريلات مُصدّرة",
  thumbnail: "صور مصغرة",
  other: "أخرى",
};
const ACCEPT: Partial<Record<Kind, string>> = {
  character_image: "image/*",
  background: "image/*",
  music: "audio/*",
  voice: "audio/*",
  other: "*/*",
};
const UPLOADABLE: Kind[] = ["character_image", "background", "music", "voice", "other"];

function fmtSize(b?: number | null) {
  if (!b) return "";
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.round(b / 1e3)} KB`;
}

async function imageSize(file: File) {
  try {
    const bmp = await createImageBitmap(file);
    const r = { width: bmp.width, height: bmp.height };
    bmp.close();
    return r;
  } catch {
    return {};
  }
}

export default function Library() {
  const [kind, setKind] = useState<Kind>("character_image");
  const [characterId, setCharacterId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { list: characters, map } = useCharacterMap();
  const utils = trpc.useUtils();
  const q = trpc.assets.list.useQuery({ kinds: [kind], characterId });
  const updateAsset = trpc.assets.update.useMutation({ onSuccess: () => utils.assets.list.invalidate() });
  const removeAsset = trpc.assets.remove.useMutation({ onSuccess: () => utils.assets.list.invalidate() });
  const updateChar = trpc.characters.update.useMutation({
    onSuccess: () => {
      utils.characters.list.invalidate();
      toast.success("أُضيفت كصورة مرجعية للشخصية");
    },
  });
  const rows = q.data ?? [];

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let n = 0;
    for (const f of Array.from(files)) {
      try {
        setBusy(`رفع ${++n}/${files.length}`);
        const dims = f.type.startsWith("image/") ? await imageSize(f) : {};
        await uploadBlob(f, { kind, filename: f.name, characterId, title: f.name.replace(/\.[^.]+$/, ""), ...dims });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "فشل الرفع");
      }
    }
    setBusy(null);
    utils.assets.list.invalidate();
    if (fileRef.current) fileRef.current.value = "";
  };

  const makeReference = (url: string, cid: number | null) => {
    const c = cid ? map.get(cid) : null;
    if (!c) return toast.error("اربط الصورة بشخصية أولًا");
    const refs = c.referenceImages ?? [];
    if (refs.includes(url)) return toast.info("موجودة مسبقًا ضمن الصور المرجعية");
    updateChar.mutate({ id: c.id, data: { referenceImages: [...refs, url] } });
  };

  const canUpload = UPLOADABLE.includes(kind);
  const isImage = kind === "character_image" || kind === "background" || kind === "thumbnail";
  const isAudio = kind === "music" || kind === "voice";
  const isVideo = kind === "premium_video" || kind === "render";

  return (
    <div>
      <PageHeader
        kicker="ASSET LIBRARY"
        title="مكتبة الأصول"
        subtitle="كل ما يصنعه الفريق محفوظ هنا: صور الشخصيات والخلفيات والموسيقى (المرخصة أو المجانية) والأصوات وفيديوهات Premium والريلات المصدّرة."
        actions={
          canUpload ? (
            <>
              <Button onClick={() => fileRef.current?.click()} disabled={busy !== null}>
                <Upload /> {busy ?? `رفع إلى ${KIND_LABELS[kind]}`}
              </Button>
              <input ref={fileRef} type="file" multiple accept={ACCEPT[kind]} hidden onChange={e => onFiles(e.target.files)} />
            </>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={kind} onValueChange={v => setKind(v as Kind)}>
          <TabsList className="flex-wrap">
            {(Object.keys(KIND_LABELS) as Kind[]).map(k => (
              <TabsTrigger key={k} value={k}>
                {KIND_LABELS[k]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select value={characterId ? String(characterId) : "all"} onValueChange={v => setCharacterId(v === "all" ? null : Number(v))}>
          <SelectTrigger className="w-44">
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
      </div>
      {q.isLoading ? (
        <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
      ) : rows.length === 0 ? (
        <EmptyBlock title={`لا توجد ${KIND_LABELS[kind]}`}>
          {canUpload ? "ارفع ملفات من الزر أعلاه. اختر شخصية من القائمة قبل الرفع لربط الملفات بها مباشرة." : "تظهر هنا تلقائيًا عند الرفع أو الرندر."}
        </EmptyBlock>
      ) : (
        <div className={isImage || isVideo ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7" : "panel divide-y"}>
          {rows.map(a => {
            const c = a.characterId ? map.get(a.characterId) : null;
            if (isAudio || kind === "other") {
              return (
                <div key={a.id} className="flex flex-wrap items-center gap-3 p-3">
                  <CharacterAvatar character={c} size={26} />
                  <div className="min-w-[160px] flex-1">
                    <div className="truncate text-sm">{a.title || `#${a.id}`}</div>
                    <div className="timecode text-[10px] text-muted-foreground">
                      {fmtSize(a.sizeBytes)} {a.durationMs ? `· ${(a.durationMs / 1000).toFixed(1)}s` : ""}
                    </div>
                  </div>
                  {isAudio && <audio src={a.url} controls preload="none" className="h-8 w-64" />}
                  <AssetCharacterSelect value={a.characterId} onChange={cid => updateAsset.mutate({ id: a.id, characterId: cid })} />
                  <Button size="icon-sm" variant="ghost" aria-label="تنزيل" onClick={() => downloadUrl(a.url, a.title || `asset-${a.id}`)}>
                    <Download />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="حذف الملف" onClick={() => confirm("حذف الملف من المكتبة؟") && removeAsset.mutate({ id: a.id })}>
                    <Trash2 />
                  </Button>
                </div>
              );
            }
            return (
              <div key={a.id} className="panel group overflow-hidden">
                <div className="relative bg-black">
                  {isVideo ? (
                    <video src={a.url} controls preload="none" playsInline className="aspect-[9/16] w-full object-cover" />
                  ) : (
                    <img src={a.url} alt={a.title ?? ""} className="aspect-[9/16] w-full object-cover" loading="lazy" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5 p-2">
                  <div className="flex items-center gap-1.5">
                    <CharacterAvatar character={c} size={18} />
                    <span className="truncate text-[11px]">{c?.name ?? "غير مرتبط"}</span>
                  </div>
                  <div className="timecode text-[10px] text-muted-foreground">
                    {a.width && a.height ? `${a.width}×${a.height}` : ""} {fmtSize(a.sizeBytes)}
                  </div>
                  <div className="flex items-center gap-0.5">
                    {kind === "character_image" && (
                      <Button size="icon-sm" variant="ghost" title="اجعلها صورة مرجعية" onClick={() => makeReference(a.url, a.characterId)}>
                        <Star />
                      </Button>
                    )}
                    <AssetCharacterSelect compact value={a.characterId} onChange={cid => updateAsset.mutate({ id: a.id, characterId: cid })} />
                    <Button size="icon-sm" variant="ghost" aria-label="تنزيل" onClick={() => downloadUrl(a.url, `${a.title || `asset-${a.id}`}.${isVideo ? "mp4" : "png"}`)}>
                      <Download />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="حذف الملف" onClick={() => confirm("حذف الملف من المكتبة؟") && removeAsset.mutate({ id: a.id })}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {kind === "character_image" && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImagePlus className="size-3.5" /> نصيحة: ارفع 4–8 صور لكل شخصية بزوايا وأماكن مختلفة — الاستوديو يتنقل بينها داخل الريل لتبدو الريلات الاقتصادية متنوعة.
        </p>
      )}
    </div>
  );
}

function AssetCharacterSelect({ value, onChange, compact }: { value: number | null; onChange: (v: number | null) => void; compact?: boolean }) {
  const { list } = useCharacterMap();
  return (
    <Select value={value ? String(value) : "none"} onValueChange={v => onChange(v === "none" ? null : Number(v))}>
      <SelectTrigger className={compact ? "h-7 flex-1 px-1.5 text-[10px]" : "w-36"} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">بدون شخصية</SelectItem>
        {list.map(c => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
