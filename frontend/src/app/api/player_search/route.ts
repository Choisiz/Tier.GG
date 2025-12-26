import { NextResponse } from "next/server";
import { getByRiotId } from "@/lib/getByRiotId";
import { getMatchIdsByPuuid, getMatchesByIds } from "@/lib/getPlayer";

// GET /api/player_search?gameName=욘서못해&tagLine=KR1&count=20
// 닉네임으로 검색 후 전적 데이터까지 한번에 조회
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const gameName = searchParams.get("gameName");
  const tagLine = searchParams.get("tagLine") || "KR1";
  const count = parseInt(searchParams.get("count") || "10");

  if (!gameName) {
    return NextResponse.json(
      { error: "gameName is required" },
      { status: 400 }
    );
  }

  try {
    // 1. 닉네임으로 PUUID 조회
    const playerInfo = await getByRiotId(gameName, tagLine);

    // 2. PUUID로 매치 ID 리스트 조회
    const matchIds = await getMatchIdsByPuuid(playerInfo.puuid, 0, count);

    // 3. 각 매치의 상세 데이터 조회 (병렬 처리)
    const matchDetails = await getMatchesByIds(matchIds);

    // 4. 응답 데이터 가공 (검색한 플레이어 기준)
    const matches = matchDetails.map((match) => {
      const playerData = match.info.participants.find(
        (p) => p.puuid === playerInfo.puuid
      );

      return {
        matchId: match.metadata.matchId,
        gameCreation: match.info.gameCreation,
        gameDuration: match.info.gameDuration,
        gameMode: match.info.gameMode,
        queueId: match.info.queueId,
        player: playerData
          ? {
              championId: playerData.championId,
              championName: playerData.championName,
              teamPosition: playerData.teamPosition,
              win: playerData.win,
              kills: playerData.kills,
              deaths: playerData.deaths,
              assists: playerData.assists,
              cs: playerData.totalMinionsKilled + playerData.neutralMinionsKilled,
              goldEarned: playerData.goldEarned,
              totalDamageDealtToChampions: playerData.totalDamageDealtToChampions,
              items: [
                playerData.item0,
                playerData.item1,
                playerData.item2,
                playerData.item3,
                playerData.item4,
                playerData.item5,
                playerData.item6,
              ],
              summoner1Id: playerData.summoner1Id,
              summoner2Id: playerData.summoner2Id,
            }
          : null,
        participants: match.info.participants.map((p) => ({
          puuid: p.puuid,
          summonerName: p.riotIdGameName || p.summonerName,
          tagLine: p.riotIdTagline,
          championId: p.championId,
          championName: p.championName,
          teamId: p.teamId,
          win: p.win,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
        })),
      };
    });

    return NextResponse.json({
      player: playerInfo,
      matches,
    });
  } catch (e) {
    console.error("Player search error:", e);

    const errorMessage = e instanceof Error ? e.message : "Failed to fetch player data";
    const status = errorMessage === "Player not found" ? 404 : 500;

    return NextResponse.json(
      { error: errorMessage },
      { status }
    );
  }
}
