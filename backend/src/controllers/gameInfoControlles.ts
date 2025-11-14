import { Request, Response, NextFunction } from "express";
import axios from "axios";
import {
  insertMatchDetails,
  MatchDetailRow,
  insertMatchDetailBans,
  insertMatchDetailPerks,
  MatchDetailPerkRow,
} from "../lib/db";
import { riotRateLimiter } from "../lib/rateLimiter";
import {
  getAllMatchIds,
  deleteMatchDetailsByMatchIds,
  hasMatches,
} from "../lib/db";

// Riot Match API 응답에서 3개 테이블에 넣을 행들을 구성한다.
function buildRowsFromMatch(info: any, metadata: any, matchIdFallback: string) {
  const matchId: string = metadata?.matchId || matchIdFallback;
  const gameVersion: string = info.gameVersion;
  const gameMode: string = info.gameMode;

  // 팀별 밴 정보 매핑
  const teams: any[] = Array.isArray(info?.teams) ? info.teams : [];
  const teamIdToBans = new Map<number, number[]>();
  for (const team of teams) {
    const teamId = team?.teamId; //레드팀 or 블루팀
    const team_ban = Array.isArray(team?.bans) ? team.bans : [];
    const ban_ids = team_ban
      .map((summoner: any) =>
        typeof summoner?.championId === "number" ? summoner.championId : null
      )
      .filter((x: number | null) => typeof x === "number") as number[];
    teamIdToBans.set(teamId, ban_ids);
  }

  // 참가자 목록
  const participantsSrc: any[] = Array.isArray(info?.participants)
    ? info.participants
    : [];

  // 적재 대상 버퍼
  const banRows: {
    matchId: string;
    puuid: string;
    banChampionId: number;
  }[] = [];
  const perkRows: MatchDetailPerkRow[] = [];
  const detailRows: MatchDetailRow[] = [];

  // 팀 단위 밴을 팀 내 참가자 5명과 1:1 매핑(매치당 총 10개, puuid당 1개)
  // 팀별 참가자 목록을 participantId(숫자) 오름차순으로 정렬해 안정적인 매핑을 보장
  const teamIdToPlayers: Map<number, any[]> = new Map();
  for (const summoner of participantsSrc) {
    const teamId =
      typeof summoner?.teamId === "number" ? summoner.teamId : null;
    if (teamId == null) continue;
    const arr = teamIdToPlayers.get(teamId) || [];
    arr.push(summoner);
    teamIdToPlayers.set(teamId, arr);
  }
  for (const [teamId, bans] of teamIdToBans.entries()) {
    const players = (teamIdToPlayers.get(teamId) || [])
      .filter((p) => typeof p?.puuid === "string" && p.puuid)
      .sort((a, b) => {
        const ai = typeof a?.participantId === "number" ? a.participantId : 0;
        const bi = typeof b?.participantId === "number" ? b.participantId : 0;
        return ai - bi;
      })
      .slice(0, 5);
    const pairCount = Math.min(players.length, bans.length, 5);
    for (let i = 0; i < pairCount; i++) {
      const puuid: string = players[i].puuid;
      const banId = bans[i];
      if (typeof banId === "number") {
        banRows.push({
          matchId,
          puuid,
          banChampionId: banId,
        });
      }
    }
  }

  for (const summoner of participantsSrc) {
    const teamId =
      typeof summoner?.teamId === "number" ? summoner.teamId : null; //레드팀 or 블루팀
    const puuid: string = summoner?.puuid; //소환사 puuid
    if (typeof puuid !== "string" || !puuid) {
      continue;
    }

    // 룬(perks) 행 생성
    const styles = Array.isArray(summoner?.perks?.styles)
      ? summoner.perks.styles
      : [];
    //주요룬
    const primary =
      styles.find((s: any) => s?.description === "primaryStyle") ||
      styles[0] ||
      {};
    //주요룬 선택 정보
    const primarySelections = Array.isArray(primary?.selections)
      ? primary.selections
      : [];
    for (const sel of primarySelections) {
      if (typeof sel?.perk === "number") {
        perkRows.push({
          matchId,
          puuid,
          slotType: "primary",
          perkId: sel.perk,
        });
      }
    }
    //보조룬
    const sub =
      styles.find((s: any) => s?.description === "subStyle") || styles[1] || {};
    //보조룬 선택 정보
    const subSelections = Array.isArray(sub?.selections) ? sub.selections : [];
    for (const sel of subSelections) {
      if (typeof sel?.perk === "number") {
        perkRows.push({
          matchId,
          puuid,
          slotType: "sub",
          perkId: sel.perk,
        });
      }
    }
    // 상세(detail) 행 생성
    const row: MatchDetailRow = {
      matchId,
      gameVersion,
      gameMode,
      puuid,
      gameResult: typeof summoner?.win === "boolean" ? summoner.win : null,
      pickChampionId:
        typeof summoner?.championId === "number" ? summoner.championId : null,
      position:
        typeof summoner?.teamPosition === "string"
          ? summoner.teamPosition
          : null,
      item0: typeof summoner?.item0 === "number" ? summoner.item0 : null,
      item1: typeof summoner?.item1 === "number" ? summoner.item1 : null,
      item2: typeof summoner?.item2 === "number" ? summoner.item2 : null,
      item3: typeof summoner?.item3 === "number" ? summoner.item3 : null,
      item4: typeof summoner?.item4 === "number" ? summoner.item4 : null,
      item5: typeof summoner?.item5 === "number" ? summoner.item5 : null,
      item6: typeof summoner?.item6 === "number" ? summoner.item6 : null,
      spell1Casts:
        typeof summoner?.spell1Casts === "number" ? summoner.spell1Casts : null,
      spell2Casts:
        typeof summoner?.spell2Casts === "number" ? summoner.spell2Casts : null,
    };
    detailRows.push(row);
  }

  return {
    matchId,
    gameVersion,
    gameMode,
    banRows,
    perkRows,
    detailRows,
  };
}

export const gameInfo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Riot API 인증/베이스 URL 확인
    const token = process.env.RIOT_API_KEY;
    const base = process.env.RIOT_API_ASIA_BASE_URL;
    if (!token) {
      return res.status(500).json({ error: "Missing RIOT_API_KEY" });
    }
    if (!base) {
      return res.status(500).json({ error: "Missing RIOT_API_ASIA_BASE_URL" });
    }
    // 선행 조건: `matches`에 최소 1건 이상 있어야 수집 가능
    if (!(await hasMatches())) {
      return res.status(409).json({
        error: "No matches in DB. Call /info/matches first.",
      });
    }

    // batchSize: DB에서 가져올 매치 수
    const batchSize = Math.max(1, Number(req.query.batchSize || 20));
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    const processedMatchIds: string[] = [];
    let page = 0;
    // 배치 루프: match_id를 가져와 순차 처리(전체 재적재)
    while (true) {
      const offset = page * batchSize;
      //DB에서 매치 수 가져오기 (페이지네이션)
      const matchIds = await getAllMatchIds(batchSize, offset);
      console.log("matchIds", {
        page,
        batchSize,
        offset,
        count: matchIds.length,
      });
      if (!matchIds || matchIds.length === 0) break;

      for (const matchId of matchIds) {
        try {
          await riotRateLimiter.wait();
          const url = `${base}/lol/match/v5/matches/${encodeURIComponent(
            matchId
          )}`;
          const { data } = await axios.get(url, {
            headers: { "X-Riot-Token": token },
            timeout: 15000,
          });
          const metadata = data?.metadata || {};
          const info = data?.info || {};
          const currentGameMode: string | undefined = info?.gameMode;
          if (currentGameMode !== "CLASSIC") {
            skipped += 1;
            continue;
          }
          const {
            matchId: resolvedMatchId,
            banRows,
            perkRows,
            detailRows,
          } = buildRowsFromMatch(info, metadata, matchId);
          await deleteMatchDetailsByMatchIds([resolvedMatchId]);
          await insertMatchDetails(detailRows);
          await insertMatchDetailBans(banRows);
          await insertMatchDetailPerks(perkRows);
          processed += 1;
          processedMatchIds.push(resolvedMatchId);
        } catch (e) {
          console.error("gameInfo.process match failed:", { matchId, err: e });
          failed += 1;
        }
      }
      page += 1;
    }
    // 최종 처리 통계 반환
    return res.json({
      ok: true,
      processed,
      failed,
      skipped,
      processedMatchIds,
    });
  } catch (error) {
    console.error("gameInfo fatal error:", error);
    return next(error);
  }
};
