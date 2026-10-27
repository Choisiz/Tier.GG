import Image from "next/image";
import type { ChampionAbility } from "@/lib/ddragon/types";

const KEY_LABELS: Record<ChampionAbility["key"], string> = {
  P: "패시브",
  Q: "Q",
  W: "W",
  E: "E",
  R: "R",
};

export default function ChampionAbilities({
  abilities,
}: {
  abilities: ChampionAbility[];
}) {
  return (
    <section aria-labelledby="abilities-heading" className="space-y-4">
      <h2 id="abilities-heading" className="text-xl font-bold">
        스킬
      </h2>
      <ul className="space-y-3">
        {abilities.map((ability) => (
          <li
            key={ability.key}
            className="flex gap-4 rounded-lg border border-border bg-surface p-4"
          >
            <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-surface-2 sm:size-14">
              <Image
                src={ability.iconUrl}
                alt={ability.name}
                fill
                sizes="56px"
                className="object-cover"
              />
              <span className="absolute right-0 bottom-0 rounded-tl-md bg-background/90 px-1 text-[10px] leading-4 font-bold text-accent">
                {ability.key}
              </span>
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="font-semibold">
                <span className="mr-2 text-sm text-accent">
                  {KEY_LABELS[ability.key]}
                </span>
                {ability.name}
              </h3>
              {ability.cooldown && (
                <p className="text-xs text-muted">
                  재사용 대기시간 {ability.cooldown}초
                </p>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">
                {ability.description}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
