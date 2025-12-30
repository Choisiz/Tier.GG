import type {
  ChampionDetailData,
  ChampionPositionInsight,
  ChampionInfoPageData,
} from "@/types/championInfo";

const VERSION = process.env.VERSION ?? "15.11.1";
const LANGUAGE = "ko_KR";

// 챔피언 기본 정보 가져오기
async function fetchChampionData(
  championName: string,
  version: string,
  language: string
): Promise<ChampionDetailData> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_URL}/api/champion_info?version=${version}&lang=${language}&name=${championName}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error(`챔피언 정보 API 호출 실패: ${response.status}`);
  }

  const data = await response.json();

  if (!data.data || !data.data[championName]) {
    throw new Error("챔피언 데이터를 찾을 수 없습니다");
  }

  return data.data[championName];
}

// 챔피언 포지션별 빌드 정보 가져오기
async function fetchPositionData(
  championId: number
): Promise<ChampionPositionInsight[]> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_URL}/api/champion_item?championId=${championId}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    console.error(`포지션 데이터 호출 실패: ${response.status}`);
    return [];
  }

  const payload = await response.json();

  if (!payload?.ok) {
    console.error(payload?.error || "포지션 데이터를 찾을 수 없습니다");
    return [];
  }

  return payload.positions || [];
}

// 챔피언 정보 페이지 데이터 통합 조회
export async function getChampionInfoPageData(
  championName: string,
  version: string = VERSION,
  language: string = LANGUAGE
): Promise<ChampionInfoPageData> {
  // 먼저 챔피언 기본 정보 가져오기
  const championData = await fetchChampionData(championName, version, language);

  // 챔피언 ID로 포지션 데이터 가져오기
  const champId = Number(championData.key);
  const positionData = champId ? await fetchPositionData(champId) : [];

  return {
    championData,
    positionData,
    version,
  };
}
