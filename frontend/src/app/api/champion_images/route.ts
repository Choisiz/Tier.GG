import { NextResponse } from "next/server";
import {  getLatestVersion,getChampionData, getChampionImageUrl } from '../../../lib/champions';

//GET http://localhost:3001/api/champion_images?version=15.11.1&lang=ko_KR
// 버전정보,챔피언이름,챔피언별 스퀘어 이미지
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const version = searchParams.get("version") || await getLatestVersion();
    const language = searchParams.get("lang") || "ko_KR";

    try{
        const champions = await getChampionData(version, language);
        type ChampionSummary = { key?: string };
        const entries = Object.entries(champions.data) as Array<
          [string, ChampionSummary]
        >;
        const championImageUrls = entries.map(([name, info]) => {
          const championId = Number(info?.key ?? 0);
          return {
            name,
            championId,
            url: getChampionImageUrl(version, name),
          };
        });
        return NextResponse.json({ championImageUrls });
    }catch(e){
        console.log('error',e)
        return NextResponse.json({error:e},{ status: 500 })
    }
    
}