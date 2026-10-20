import { cn } from "@/lib/utils";
import { Link } from "wouter";

export type ReelWallItem = { key: string | number; src?: string | null; name: string; caption?: string; href?: string; live?: boolean; color?: string };

/**
 * A row of tall 9:16 frames drifting with a slow Ken Burns zoom — the same motion the studio renders into
 * every economic reel. Used once per screen as the hero; everything around it stays quiet.
 */
export function ReelWall({ items, className, height = 380 }: { items: ReelWallItem[]; className?: string; height?: number }) {
  return (
    <div className={cn("flex gap-2 overflow-hidden", className)} style={{ height }} aria-hidden={!items.some(i => i.href)}>
      {items.map((it, i) => {
        const frame = (
          <div
            className={cn("reel h-full shrink-0", it.live && "is-live")}
            style={{ width: (height * 9) / 16, background: it.color ?? undefined, marginTop: i % 2 ? 28 : 0 }}
          >
            {it.src ? (
              <img src={it.src} alt={it.name} className={i % 2 ? "kenburns-alt" : "kenburns"} loading="lazy" draggable={false} />
            ) : (
              <div className="flex h-full items-center justify-center display-xl text-5xl text-white/70">{it.name.slice(0, 1)}</div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
            <div className="absolute inset-x-3 bottom-3">
              <div className="font-display text-[15px] font-bold leading-tight text-white" dir="ltr">
                {it.name}
              </div>
              {it.caption && <div className="mt-0.5 truncate text-[11px] text-white/65">{it.caption}</div>}
            </div>
          </div>
        );
        return it.href ? (
          <Link key={it.key} href={it.href} className="h-full rounded-[22px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tally">
            {frame}
          </Link>
        ) : (
          <div key={it.key} className="h-full">
            {frame}
          </div>
        );
      })}
    </div>
  );
}

/** Public portraits shipped with the app (used where the user is not signed in yet). */
export const BRAND_PORTRAITS = ["walt", "maya", "oliver", "rosa", "daniel", "vivienne", "leo", "claire", "sam"].map(slug => ({
  key: slug,
  src: `/brand/characters/${slug}.jpg`,
  name: { walt: "Walt Brooks", maya: "Maya Laurent", oliver: "Oliver Ashford", rosa: "Nonna Rosa", daniel: "Daniel Hayes", vivienne: "Vivienne Cross", leo: "Leo Moreau", claire: "Claire Donovan", sam: "Sam Whitaker" }[slug]!,
}));
