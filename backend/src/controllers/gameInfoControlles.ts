import { Request, Response, NextFunction } from "express";
import axios from "axios";
import {
  upsertMatchDetails,
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

  for (const summoner of participantsSrc) {
    const teamId =
      typeof summoner?.teamId === "number" ? summoner.teamId : null; //레드팀 or 블루팀
    const bansForTeam = teamId != null ? teamIdToBans.get(teamId) || [] : []; //레드팀 or 블루팀 밴 챔피언 아이디 목록리스트
    const puuid: string = summoner?.puuid; //소환사 puuid
    if (typeof puuid !== "string" || !puuid) {
      continue;
    }
    // 밴 행 생성
    for (const banId of bansForTeam) {
      if (typeof banId === "number") {
        banRows.push({
          matchId,
          puuid,
          banChampionId: banId,
        });
      }
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
      gameResult: typeof p?.win === "boolean" ? p.win : null,
      pickChampionId: typeof p?.championId === "number" ? p.championId : null,
      position: typeof p?.teamPosition === "string" ? p.teamPosition : null,
      item0: typeof p?.item0 === "number" ? p.item0 : null,
      item1: typeof p?.item1 === "number" ? p.item1 : null,
      item2: typeof p?.item2 === "number" ? p.item2 : null,
      item3: typeof p?.item3 === "number" ? p.item3 : null,
      item4: typeof p?.item4 === "number" ? p.item4 : null,
      item5: typeof p?.item5 === "number" ? p.item5 : null,
      item6: typeof p?.item6 === "number" ? p.item6 : null,
      spell1Casts: typeof p?.spell1Casts === "number" ? p.spell1Casts : null,
      spell2Casts: typeof p?.spell2Casts === "number" ? p.spell2Casts : null,
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

    // 쿼리 파라미터
    // batchSize: DB에서 가져올 매치 수
    const batchSize = Math.max(1, Number(req.query.batchSize || 20));
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    const processedMatchIds: string[] = [];
    const seen = new Set<string>(); // 동일 요청 내 중복 match_id 방지
    var abc = 1;
    // 배치 루프: match_id를 가져와 순차 처리(전체 재적재)
    while (abc == 1) {
      //DB에서 매치 수 가져오기
      const matchIds = await getAllMatchIds(batchSize);
      console.log("matchIds", matchIds);
      if (!matchIds || matchIds.length === 0) break;

      // 동일 요청에서 이미 처리한 match_id는 제외(무한 루프/중복 방지)
      const freshIds = matchIds.filter((id) => !seen.has(id));
      console.log("freshIds", freshIds);
      var abc = 2;
      freshIds.forEach((id) => seen.add(id));
      if (freshIds.length === 0) break;

      for (const matchId of freshIds) {
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
          // CLASSIC(소환사의 협곡) 모드만 수집
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
          //     // 기존 상세/부가 데이터는 항상 삭제 후 재적재(갈아치우기 정책)
          //     await deleteMatchDetailsByMatchIds([resolvedMatchId]);
          //     // 일괄 적재
          //     await upsertMatchDetails(detailRows);
          //     await insertMatchDetailBans(banRows);
          //     await insertMatchDetailPerks(perkRows);
          //     processed += 1;
          //     processedMatchIds.push(resolvedMatchId);
        } catch (e) {
          console.error("gameInfo.process match failed:", { matchId, err: e });
          failed += 1;
        }
      }

      // 다음 배치로 계속 진행
    }

    // 최종 처리 통계 반환
    // return res.json({
    //   ok: true,
    //   processed,
    //   failed,
    //   skipped,
    //   processedMatchIds,
    // });
  } catch (error) {
    // 전역 오류
    console.error("gameInfo fatal error:", error);
    return next(error);
  }
};
