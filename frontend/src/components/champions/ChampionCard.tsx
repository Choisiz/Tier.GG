import Image from "next/image";
import Link from "next/link";
import type { ChampionSummary } from "@/lib/ddragon/types";

export default function ChampionCard({ champion }: { champion: ChampionSummary }) {
  return (
    <Link
      href={`/champions/${champion.id}`}
      aria-label={champion.name}
      className="group flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition-colors hover:bg-surface-2"
    >
      <span className="relative block aspect-square w-full overflow-hidden rounded-md bg-surface-2 ring-1 ring-border group-hover:ring-accent">
        <Image
          src={champion.iconUrl}
          alt={champion.name}
          fill
          sizes="(min-width: 1024px) 96px, (min-width: 768px) 12vw, (min-width: 640px) 16vw, 25vw"
          className="object-cover transition-transform group-hover:scale-105"
        />
      </span>
      <span className="w-full truncate text-center text-xs font-medium sm:text-sm">
        {champion.name}
      </span>
    </Link>
  );
}
