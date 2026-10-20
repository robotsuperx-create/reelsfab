import { KOKORO_VOICES } from "@shared/domain";
import { Link } from "wouter";
import { PageHeader, Tally, useCharacterMap } from "@/components/fab/common";
import CharacterGeneratorDialog from "@/components/fab/CharacterGeneratorDialog";

export default function Characters() {
  const { list, isLoading } = useCharacterMap();
  return (
    <div>
      <PageHeader
        title="الشخصيات"
        subtitle="كل شخصية تُعلَن بوضوح كشخصية AI، ولها لونها وخطها وصوتها وحصتها اليومية. افتح أي شخصية لتعديلها أو ربط حساباتها."
        actions={<CharacterGeneratorDialog />}
      />
      {isLoading ? (
        <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 sm:gap-4">
          {list.map(c => {
            const img = c.referenceImages?.[0];
            const voice = KOKORO_VOICES.find(v => v.id === c.ttsVoice);
            return (
              <Link key={c.id} href={`/characters/${c.id}`} className="group block rounded-[22px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-tally">
                <div className={`reel aspect-[9/16] ${c.isActive && img ? "" : "opacity-80"}`} style={{ background: c.colors?.primary ?? undefined }}>
                  {img ? (
                    <img src={img} alt={c.name} className="transition-transform duration-700 group-hover:scale-[1.04]" loading="lazy" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                      <div className="display-xl text-6xl text-white/85">{c.name.slice(0, 1)}</div>
                      <div className="text-[13px] text-white/75">{c.needsDesignFile ? "بانتظار صورة الشخصية" : "لا توجد صورة مرجعية"}</div>
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black via-black/55 to-transparent" />
                  <span className="absolute left-3 top-3 rounded-md bg-black/55 px-2 py-0.5 text-[10.5px] text-white/85 backdrop-blur" dir="ltr">AI character</span>
                  <div className="absolute inset-x-4 bottom-4">
                    <div className="display-xl text-[26px] text-white" dir="ltr">{c.name}</div>
                    <div className="mt-1.5 line-clamp-1 text-[12.5px] text-white/70">{c.niche}</div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-white/80">
                      <Tally tone={!c.isActive ? "idle" : img ? "go" : "hold"} label={!c.isActive ? "متوقفة" : `${c.dailyQuota} يوميًا`} />
                      <span className="truncate">{voice?.label.split(" — ")[0] ?? c.ttsVoice}</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
