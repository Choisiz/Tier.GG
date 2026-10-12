import type { Metadata } from "next";
import ChampionBrowser from "@/components/champions/ChampionBrowser";
import { getChampionList } from "@/lib/ddragon/api";

// SSG + ISR: 1시간마다 새 패치 여부 확인 (REVALIDATE_SECONDS와 같은 값)
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "챔피언",
  description: "리그 오브 레전드 전체 챔피언 목록. 이름 검색과 역할군 필터를 지원합니다.",
};

export default async function ChampionsPage() {
  const champions = await getChampionList();
  return <ChampionBrowser champions={champions} />;
}
