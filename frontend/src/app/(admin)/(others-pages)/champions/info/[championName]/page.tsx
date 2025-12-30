// app/(admin)/(others-pages)/champions/info/[championName]/page.tsx
import { notFound } from "next/navigation";
import ChampionDetailClient from "@/components/champions/ChampionDetailClient";
import { getChampionInfoPageData } from "@/services/championInfoData";

interface Props {
  params: { championName: string };
  searchParams?: {
    version?: string;
    lang?: string;
    language?: string;
  };
}

export default async function ChampionDetailPage({ params, searchParams }: Props) {
  const version = searchParams?.version;
  const language = searchParams?.lang ?? searchParams?.language ?? "ko_KR";

  try {
    const pageData = await getChampionInfoPageData(
      params.championName,
      version,
      language
    );
    return <ChampionDetailClient {...pageData} />;
  } catch (err) {
    console.error("챔피언 정보 페이지 로딩 실패:", err);
    return notFound();
  }
}