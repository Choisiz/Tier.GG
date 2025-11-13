import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { insertPlayerMatches, getAllPuuids, hasPlayers } from "../lib/db";
import { riotRateLimiter } from "../lib/rateLimiter";

export const matches = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = process.env.RIOT_API_KEY;
    const base = process.env.RIOT_API_ASIA_BASE_URL;
    if (!token) {
      return res.status(500).json({ error: "Missing RIOT_API_KEY" });
    }
    if (!base) {
      return res.status(500).json({ error: "Missing RIOT_API_ASIA_BASE_URL" });
    }

    //players 테이블 존재여부확인
    if (!(await hasPlayers())) {
      return res
        .status(409)
        .json({ error: "No players in DB. Call /info/player first." });
    }

    // puuid당 matchId 개수 5개로 제한(고정)
    const perPuuidLimit = 5;

    // DB에서 모든 PUUID 가져오기
    const puuidAll: string[] = await getAllPuuids();

    const results: Array<{ puuid: string; matchIds: string[] }> = [];
    const seen = new Set<string>();

    for (const puuid of puuidAll) {
      try {
        await riotRateLimiter.wait();
        const url = `${base}/lol/match/v5/matches/by-puuid/${encodeURIComponent(
          puuid
        )}/ids?count=${perPuuidLimit}`;
        const response = await axios.get(url, {
          headers: { "X-Riot-Token": token },
          timeout: 10000,
        });
        const matchIds: string[] = Array.isArray(response.data)
          ? response.data
          : [];

        //플레이어별 중복 matchId 제거
        const filtered = matchIds.filter((id) => !seen.has(id));
        filtered.forEach((id) => seen.add(id));
        results.push({ puuid: puuid, matchIds: filtered });

        // DB에 저장
        try {
          await insertPlayerMatches(puuid, filtered);
        } catch (err) {
          console.error("insertPlayerMatches error:", err);
        }
      } catch (err) {
        console.error("fetch match ids error:", { puuid, err });
      }
    }
    return res.json({ ok: true, count: results.length, data: results });
  } catch (error) {
    return next(error);
  }
};
