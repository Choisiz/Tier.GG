import Image from "next/image";
import { TAG_LABELS } from "@/lib/ddragon/transform";
import type { ChampionDetail } from "@/lib/ddragon/types";

const DIFFICULTY_MAX = 10;

type ChampionHeroProps = {
  champion: ChampionDetail;
  // 기본 스킨(num 0) 스플래시
  splashUrl: string;
};

export default function ChampionHero({
  champion,
  splashUrl,
}: ChampionHeroProps) {
  const difficulty = Math.max(0, Math.min(DIFFICULTY_MAX, champion.difficulty));

  return (
    <section
      aria-labelledby="champion-name"
      className="relative overflow-hidden rounded-xl border border-border bg-surface md:min-h-[420px]"
    >
      {/* 모바일: 스플래시 위 / md 이상: 배경 */}
      <div className="relative aspect-video w-full bg-surface-2 md:absolute md:inset-0 md:aspect-auto md:h-full">
        <Image
          src={splashUrl}
          alt=""
          fill
          fetchPriority="high"
          loading="eager"
          sizes="(min-width: 1152px) 1152px, 100vw"
          className="object-cover object-top"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent md:from-background md:via-background/60"
        />
      </div>

      <div className="relative flex items-end gap-4 p-4 sm:p-6 md:min-h-[420px] md:p-8">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-surface-2 ring-2 ring-accent sm:size-20">
          <Image
            src={champion.iconUrl}
            alt={champion.name}
            fill
            sizes="80px"
            className="object-cover"
          />
        </div>
        <div className="min-w-0 space-y-2">
          <div>
            <h1
              id="champion-name"
              className="text-3xl font-extrabold sm:text-4xl"
            >
              {champion.name}
            </h1>
            <p className="text-muted md:text-foreground/85">{champion.title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ul className="flex flex-wrap gap-1.5" aria-label="역할군">
              {champion.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full border border-accent/60 bg-background/70 px-2.5 py-0.5 text-xs font-semibold text-accent"
                >
                  {TAG_LABELS[tag]}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">난이도</span>
              <span aria-hidden="true" className="flex gap-0.5">
                {Array.from({ length: DIFFICULTY_MAX }, (_, i) => (
                  <span
                    key={i}
                    className={`size-2.5 rounded-full ${i < difficulty ? "bg-accent" : "bg-border"}`}
                  />
                ))}
              </span>
              <span className="text-muted md:text-foreground/85">
                ({difficulty}/{DIFFICULTY_MAX})
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
