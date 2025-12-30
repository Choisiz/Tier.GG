import type { ChampionSkinsResponse } from "@/types/skin";

const DEFAULT_LANGUAGE = "ko_KR";

export async function getChampionSkins(
  championName: string,
  version?: string,
  language: string = DEFAULT_LANGUAGE
): Promise<ChampionSkinsResponse> {
  const params = new URLSearchParams({
    championName,
    ...(version && { version }),
    lang: language,
  });

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_URL}/api/champion_skins?${params}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "스킨 데이터를 불러올 수 없습니다.");
  }

  return response.json();
}
