import { NextResponse } from "next/server";
import { getVersions_Url, getChampionData_Url, getChampionImageUrl } from "../../../lib/champions";

//GET http://localhost:3001/api/champion_images?version=15.11.1&lang=ko_KR
// 버전정보,챔피언이름,챔피언별 스퀘어 이미지
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let version = searchParams.get("version");
  const language = searchParams.get("lang") || "ko_KR";

  try {
    // 버전이 없으면 최신 버전 가져오기
    if (!version) {
      const versionRes = await fetch(getVersions_Url());
      if (!versionRes.ok) throw new Error("버전 정보를 가져올 수 없습니다.");
      const versions = await versionRes.json();
      version = versions[0];
    }

    // 챔피언 데이터 가져오기
    const champRes = await fetch(getChampionData_Url(version, language));
    if (!champRes.ok) throw new Error("챔피언 데이터를 불러올 수 없습니다.");
    const champions = await champRes.json();

    type ChampionSummary = { key?: string };
    const entries = Object.entries(champions.data) as Array<[string, ChampionSummary]>;
    const championImageUrls = entries.map(([name, info]) => {
      const championId = Number(info?.key ?? 0);
      return {
        name,
        championId,
        url: getChampionImageUrl(version as string, name),
      };
    });
    return NextResponse.json({ championImageUrls });
  } catch (e) {
    console.log("error", e);
    return NextResponse.json({ error: e }, { status: 500 });
  }
}
