import ComponentCard from "@/components/common/ComponentCard";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import ChampionTablePanel from "@/components/tables/ChampionTablePanel";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Next.js Basic Table | TailAdmin - Next.js Dashboard Template",
  description:
    "This is Next.js Basic Table  page for TailAdmin  Tailwind CSS Admin Dashboard Template",
  // other metadata
};

interface ChampionImageData {
  name: string;
  url: string;
  championId?: number;
  tier?: string | null;
  positionDetails?: Record<string, TierDetail>;
  pickCount?: number | null;
  winCount?: number | null;
  pickRate?: number | null;
  winRate?: number | null;
  banRate?: number | null;
}

interface ApiResponse {
  championImageUrls: ChampionImageData[];
}

interface ChampionTierResponse {
  ok: boolean;
  data: Array<{
    championId: number;
    tier: string;
    position: string;
    score: number;
    pickCount: number;
    winCount: number;
    pickRate: number;
    winRate: number;
    banRate: number;
    items: number[];
    primaryRunes: number[];
    subRunes: number[];
  }>;
}

interface TierDetail {
  tier: string;
  position: string;
  pickCount: number;
  winCount: number;
  pickRate: number;
  winRate: number;
  banRate: number;
  items: number[];
  primaryRunes: number[];
  subRunes: number[];
}

const tierPriority: Record<string, number> = {
  OP: 0,
  "1tier": 1,
  "2tier": 2,
  "3tier": 3,
  "4tier": 4,
};

const buildTierMaps = (tiers: ChampionTierResponse["data"] = []) => {
  const bestDetail = new Map<number, TierDetail>();
  const detailByPosition = new Map<number, Record<string, TierDetail>>();

  for (const data of tiers) {
    const detail: TierDetail = {
      tier: data.tier,
      position: data.position,
      pickCount: data.pickCount,
      winCount: data.winCount,
      pickRate: data.pickRate,
      winRate: data.winRate,
      banRate: data.banRate,
      items: Array.isArray(data.items) ? data.items : [],
      primaryRunes: Array.isArray(data.primaryRunes)
        ? data.primaryRunes
        : [],
      subRunes: Array.isArray(data.subRunes) ? data.subRunes : [],
    };

    const currentBest = bestDetail.get(data.championId);
    const newRank = tierPriority[data.tier] ?? 99;
    const currentRank =
      currentBest != null ? tierPriority[currentBest.tier] ?? 99 : 99;
    if (currentBest == null || newRank < currentRank) {
      bestDetail.set(data.championId, detail);
    }

    const detailMap =
      detailByPosition.get(data.championId) ??
      ({} as Record<string, TierDetail>);
    detailMap[data.position] = detail;
    detailByPosition.set(data.championId, detailMap);
  }

  return { bestDetail, detailByPosition };
};

const DDRAGON_VERSION = "15.11.1";

async function Champion_images() {
      const backendUrl =
        process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5500";
      const [imageResponse, tierResponse] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_URL}/api/champion_images?version=${DDRAGON_VERSION}&lang=ko_KR`, { cache: "no-store" }),
        fetch(
          `${backendUrl}/info/champion/tierList`,
          { cache: "no-store" }
        ),
      ]);

      if (!imageResponse.ok) {
        throw new Error('챔피언 이미지 API 호출 실패');
      }
      if (!tierResponse.ok) {
        throw new Error('챔피언 티어 API 호출 실패');
      }
      
      const [imageData, tierData]: [ApiResponse, ChampionTierResponse] = await Promise.all([
        imageResponse.json(),
        tierResponse.json(),
      ]);

      //bestDetail: 챔피언 티어 최고점
      //detailByPosition: 챔피언 포지션별 티어
      const { bestDetail, detailByPosition } = buildTierMaps(
        tierData?.data ?? []
      );
      const enrichedChampions = imageData.championImageUrls.map((champ) => {
        
        const positionDetails =
          champ.championId != null
            ? detailByPosition.get(champ.championId) ?? {}
            : {};
        const best = champ.championId != null ? bestDetail.get(champ.championId) : undefined;
        return {
          ...champ,
          tier: best?.tier ?? null,
          positionDetails,
          pickCount: best?.pickCount ?? null,
          winCount: best?.winCount ?? null,
          pickRate: best?.pickRate ?? null,
          winRate: best?.winRate ?? null,
          banRate: best?.banRate ?? null,
        };
      });

      return(
       <>
       <ChampionTablePanel champions={enrichedChampions}/>
       </>
      )
};

export default function BasicTables() {
  return (
    <div>
      <PageBreadcrumb pageTitle="챔피언 리스트" />
      <div className="space-y-6">
        <ComponentCard title="Basic Table 1">
          <Champion_images />
        </ComponentCard>
      </div>
    </div>
  );
}
