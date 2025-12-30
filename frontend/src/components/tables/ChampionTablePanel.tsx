'use client';

import { useMemo, useState } from "react";
import BasicTableOne from "./BasicTableOne";
import type { ChampionImageData, PositionDetail } from "@/types/champion";

const POSITIONS = [
  { key: "ALL", label: "전체" },
  { key: "TOP", label: "TOP" },
  { key: "JUNGLE", label: "JUNGLE" },
  { key: "MIDDLE", label: "MIDDLE" },
  { key: "BOTTOM", label: "BOTTOM" },
  { key: "UTILITY", label: "SUPPORT" },
];

const TIER_PRIORITY: Record<string, number> = {
  OP: 0,
  "1tier": 1,
  "2tier": 2,
  "3tier": 3,
  "4tier": 4,
};

const getBestTier = (champ: ChampionImageData) => {
  if (champ.tier) return champ.tier;
  if (!champ.positionDetails) return null;
  const entries = Object.entries(champ.positionDetails);
  if (!entries.length) return null;
  entries.sort(
    (a, b) =>
      (TIER_PRIORITY[a[1]?.tier ?? ""] ?? 99) -
      (TIER_PRIORITY[b[1]?.tier ?? ""] ?? 99)
  );
  return entries[0]?.[1]?.tier ?? null;
};

export default function ChampionTablePanel({
  champions,
}: {
  champions: ChampionImageData[];
}) {
  const [position, setPosition] = useState<string>("ALL");

  const filtered = useMemo(() => {
    const baseList: ChampionImageData[] = [];

    if (position === "ALL") {
      champions.forEach((champ) => {
        const detailEntries = Object.entries(champ.positionDetails || {});
        if (detailEntries.length) {
          detailEntries.forEach(([pos, detail]: [string, PositionDetail]) => {
            baseList.push({
              ...champ,
              tier: detail.tier ?? getBestTier(champ),
              position: pos,
              pickCount: detail.pickCount ?? champ.pickCount ?? null,
              winCount: detail.winCount ?? champ.winCount ?? null,
              pickRate: detail.pickRate ?? champ.pickRate ?? null,
              winRate: detail.winRate ?? champ.winRate ?? null,
              banRate: detail.banRate ?? champ.banRate ?? null,
            });
          });
        } else {
          baseList.push({
            ...champ,
            tier: getBestTier(champ),
            position: "전체",
            pickCount: champ.pickCount ?? null,
            winCount: champ.winCount ?? null,
            pickRate: champ.pickRate ?? null,
            winRate: champ.winRate ?? null,
            banRate: champ.banRate ?? null,
          });
        }
      });
    } else {
      champions.forEach((champ) => {
        const detail = champ.positionDetails?.[position] as PositionDetail | undefined;
        const tier = detail?.tier ?? null;
        if (!tier) return;
        baseList.push({
          ...champ,
          tier,
          position,
          pickCount: detail?.pickCount ?? champ.pickCount ?? null,
          winCount: detail?.winCount ?? champ.winCount ?? null,
          pickRate: detail?.pickRate ?? champ.pickRate ?? null,
          winRate: detail?.winRate ?? champ.winRate ?? null,
          banRate: detail?.banRate ?? champ.banRate ?? null,
        });
      });
    }

    return [...baseList].sort((a, b) => {
      const aRank = TIER_PRIORITY[a.tier ?? ""] ?? 99;
      const bRank = TIER_PRIORITY[b.tier ?? ""] ?? 99;
      if (aRank !== bRank) return aRank - bRank;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [champions, position]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {POSITIONS.map((pos) => (
          <button
            key={pos.key}
            type="button"
            onClick={() => setPosition(pos.key)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              position === pos.key
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-gray-300"
            }`}
          >
            {pos.label}
          </button>
        ))}
      </div>
      <BasicTableOne champions={filtered} />
    </div>
  );
}
