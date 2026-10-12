import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ChampionAbilities from "@/components/champions/ChampionAbilities";
import ChampionHero from "@/components/champions/ChampionHero";
import ChampionLore from "@/components/champions/ChampionLore";
import SkinGallery from "@/components/champions/SkinGallery";
import { getChampionDetail, getChampionList } from "@/lib/ddragon/api";
import { championSplashUrl } from "@/lib/ddragon/images";

// 빌드 시 전 챔피언 정적 생성 + ISR. dynamicParams는 기본값(true) 유지.
export const revalidate = 3600;

export async function generateStaticParams() {
  const champions = await getChampionList();
  return champions.map((champion) => ({ championId: champion.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/champions/[championId]">): Promise<Metadata> {
  const { championId } = await params;
  const champion = await getChampionDetail(championId);
  if (!champion) {
    return { title: "챔피언을 찾을 수 없습니다" };
  }
  return {
    title: `${champion.name} - ${champion.title}`,
    description: `${champion.name}(${champion.title})의 스킬, 스킨, 스토리`,
  };
}

export default async function ChampionDetailPage({
  params,
}: PageProps<"/champions/[championId]">) {
  const { championId } = await params;
  const champion = await getChampionDetail(championId);
  if (!champion) {
    notFound();
  }

  const defaultSkinNum = champion.skins[0]?.num ?? 0;

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <Link
          href="/champions"
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-foreground"
        >
          <span aria-hidden="true">←</span> 챔피언 목록
        </Link>
        <ChampionHero
          champion={champion}
          splashUrl={championSplashUrl(champion.id, defaultSkinNum)}
        />
      </div>
      <ChampionAbilities abilities={champion.abilities} />
      <SkinGallery skins={champion.skins} />
      <ChampionLore lore={champion.lore} />
    </div>
  );
}
