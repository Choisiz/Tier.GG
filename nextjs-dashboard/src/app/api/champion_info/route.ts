import { NextResponse } from "next/server";
import {  getLatestVersion, getChampionData_Detail } from '../../../lib/champions';

//GET http://localhost:3000/api/champion_info?version=15.11.1&lang=ko_KR&name=Ahri
// 챔피언 개별정보(스킨,패시브정보,스킬정보,기본능력치,이미지정보,태그(포지션)등)
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const version = searchParams.get("version") || await getLatestVersion();
    const language = searchParams.get("lang") || "ko_KR";
    const name = searchParams.get("name") || "Ahri";
    try{
        const ChampionData_Detail= await getChampionData_Detail(version,language,name)
        console.log('cc',ChampionData_Detail)
        return NextResponse.json(ChampionData_Detail);
    }catch(e){
        console.log('error',e)
        return NextResponse.json({error:e},{ status: 500 })
    }
    
}