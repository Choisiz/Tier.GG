import type {
  TierDetail,
  ChampionTierItem,
  ChampionImageApiResponse,
  ChampionTierApiResponse,
} from "@/types/champion";

const VERSION = process.env.VERSION ?? "15.11.1";
const BACKEND_URL =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5500";

const tierPriority: Record<string, number> = {
  OP: 0,
  "1tier": 1,
  "2tier": 2,
  "3tier": 3,
  "4tier": 4,
};

// 티어 데이터를 맵으로 빌드하는 유틸리티 함수
function buildTierMaps(tiers: ChampionTierApiResponse["data"] = []) {
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
      primaryRunes: Array.isArray(data.primaryRunes) ? data.primaryRunes : [],
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
}


// 챔피언 티어 리스트를 가져오는 함수
export async function getChampionTierList(): Promise<ChampionTierItem[]> {

  const [imageResponse, tierResponse] = await Promise.all([
    fetch(
      `${process.env.NEXT_PUBLIC_URL}/api/champion_images?version=${VERSION}&lang=ko_KR`,
      { cache: "no-store" }
    ),
    fetch(`${BACKEND_URL}/info/champion/tierList`, { cache: "no-store" }),
  ]);

  if (!imageResponse.ok) {
    throw new Error("챔피언 이미지 API 호출 실패");
  }
  if (!tierResponse.ok) {
    throw new Error("챔피언 티어 API 호출 실패");
  }

  const [imageData, tierData]: [
    ChampionImageApiResponse,
    ChampionTierApiResponse,
  ] = await Promise.all([imageResponse.json(), tierResponse.json()]);

  const { bestDetail, detailByPosition } = buildTierMaps(tierData?.data ?? []);

  const championStats = imageData.championImageUrls.map((champ) => {
    const positionDetails =
      champ.championId != null
        ? detailByPosition.get(champ.championId) ?? {}
        : {};
    const best =
      champ.championId != null ? bestDetail.get(champ.championId) : undefined;

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

  return championStats;
}
