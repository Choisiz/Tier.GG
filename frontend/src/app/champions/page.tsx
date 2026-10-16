import type { Metadata } from "next";
import TierListPage from "@/components/champions/TierListPage";

// SSG + ISR: 1시간마다 다시 만든다 (계약 4장 권장 revalidate와 같은 값)
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "탑 챔피언 티어",
  description: "최근 14일 기준 탑 챔피언 티어, 승률, 픽률, 밴률. 포지션별로 볼 수 있습니다.",
};

/** /champions = 탑 탭 (변경 01 D1) */
export default function ChampionsPage() {
  return <TierListPage position="TOP" />;
}
