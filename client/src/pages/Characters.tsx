import { Badge } from "@/components/ui/badge";
import { KOKORO_VOICES } from "@shared/domain";
import { Link } from "wouter";
import { PageHeader, Tally, useCharacterMap } from "@/components/fab/common";
import CharacterGeneratorDialog from "@/components/fab/CharacterGeneratorDialog";

export default function Characters() {
  const { list, isLoading } = useCharacterMap();
  return (
    <div>
      <PageHeader
        kicker="CHARACTER BIBLE · v1"
        title="الشخصيات"
        subtitle="عشر شخصيات من ملف الشخصيات. كل شخصية تُعلَن كشخصية AI، ولكل منها هوية ألوان، خط ترجمة، صوت مجاني للاختبار، وحصة يومية."
        actions={<CharacterGeneratorDialog />}
      />
      {isLoading ? (
        <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.map(c => {
            const img = c.referenceImages?.[0];
            const voice = KOKORO_VOICES.find(v => v.id === c.ttsVoice);
            return (
              <Link key={c.id} href={`/characters/${c.id}`} className="group panel overflow-hidden transition-transform hover:-translate-y-0.5">
                <div className="relative aspect-[9/16] overflow-hidden" style={{ background: c.colors?.primary }}>
                  {img ? (
                    <img src={img} alt={c.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white/80">
                      <div className="font-display text-3xl font-bold">{c.name.slice(0, 1)}</div>
                      {c.needsDesignFile ? "ارفع ملف التصميم الحالي" : "لا توجد صورة مرجعية"}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-10">
                    <div className="font-display text-base font-bold text-white ltr" dir="ltr">
                      {c.name}
                    </div>
                    <div className="text-xs text-white/75">{c.niche}</div>
                  </div>
                  <div className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white ltr" dir="ltr">
                    AI character
                  </div>
                  <span className="absolute right-2 top-2 h-3 w-3 rounded-full border border-white/40" style={{ background: c.colors?.accent }} />
                </div>
                <div className="flex items-center justify-between gap-2 p-3">
                  <Tally tone={!c.isActive ? "idle" : img ? "go" : "hold"} label={!c.isActive ? "متوقفة" : `${c.dailyQuota} يوميًا`} />
                  <Badge variant="secondary" className="max-w-[110px] truncate text-[10px]">
                    {voice?.label.split(" — ")[0] ?? c.ttsVoice}
                  </Badge>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
