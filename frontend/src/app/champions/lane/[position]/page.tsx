import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import TierListPage from "@/components/champions/TierListPage";
import { fromPositionSlug, POSITION_LABELS, POSITIONS, toPositionSlug } from "@/lib/api/positions";

// 5개 조각(소문자)만 미리 만들고 다른 값(TOP, mid 등)은 바로 404 (변경 01 D1).
// top은 같은 내용이 두 주소에 있지 않게 /champions로 308.
// (next.config redirects는 대소문자를 구분하지 않아 /lane/TOP까지 308이 되므로 쓰지 않는다)
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return POSITIONS.map((position) => ({ position: toPositionSlug(position) }));
}

export async function generateMetadata({
  params,
}: PageProps<"/champions/lane/[position]">): Promise<Metadata> {
  const position = fromPositionSlug((await params).position);
  if (!position || position === "TOP") return {};
  const label = POSITION_LABELS[position];
  return {
    title: `${label} 챔피언 티어`,
    description: `최근 14일 기준 ${label} 챔피언 티어, 승률, 픽률, 밴률.`,
  };
}

export default async function LaneTierListPage({
  params,
}: PageProps<"/champions/lane/[position]">) {
  const position = fromPositionSlug((await params).position);
  if (!position) {
    notFound();
  }
  if (position === "TOP") {
    permanentRedirect("/champions");
  }
  return <TierListPage position={position} />;
}
