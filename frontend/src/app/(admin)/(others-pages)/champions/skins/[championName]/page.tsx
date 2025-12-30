import { Metadata } from 'next';
import ChampionSkinsClient from '@/components/champions/ChampionSkinsClient';
import { getChampionSkins } from '@/services/skinData';

interface Props {
  params: {
    championName: string;
  };
  searchParams: {
    version?: string;
    language?: string;
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    title: `${params.championName} 스킨 목록 | LoL Champion Skins`,
    description: `${params.championName} 챔피언의 모든 스킨을 확인하세요. 스플래시 아트, 로딩 화면 이미지 등을 제공합니다.`,
  };
}

export default async function ChampionSkinsPage({ params, searchParams }: Props) {
  const skinData = await getChampionSkins(
    params.championName,
    searchParams.version,
    searchParams.language
  );

  return <ChampionSkinsClient initialData={skinData} />;
}
