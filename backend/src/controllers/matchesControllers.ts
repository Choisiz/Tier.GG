import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { insertPlayerMatches, getPuuidsFromDb } from "../lib/db";
import { riotRateLimiter } from "../lib/rateLimiter";

export const matches10 = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = process.env.RIOT_API_KEY;

    const base = process.env.RIOT_API_ASIA_BASE_URL2;
    if (!token) {
      return res.status(500).json({ error: "Missing RIOT_API_KEY" });
    }
    if (!base) {
      return res.status(500).json({ error: "Missing RIOT_API_ASIA_BASE_URL" });
    }

    // puuid당 matchId 개수
    const perPuuidLimit = Number(req.query.limit || 5);

    // DB에서 PUUID 목록 가져오기
    const puuidListLimit = Number(req.query.puuidLimit || 0);
    const puuidAll: string[] = await getPuuidsFromDb(
      isNaN(puuidListLimit) || puuidListLimit <= 0 ? undefined : puuidListLimit
    );

    const results: Array<{ puuid: string; matchIds: string[] }> = [];
    const seen = new Set<string>();
    for (const p of puuidAll) {
      try {
        await riotRateLimiter.wait();
        const url = `${base}/lol/match/v5/matches/by-puuid/${encodeURIComponent(
          p
        )}/ids?count=${perPuuidLimit}`;
        const response = await axios.get(url, {
          headers: { "X-Riot-Token": token },
          timeout: 10000,
        });
        const matchIds: string[] = Array.isArray(response.data)
          ? response.data.slice(0, perPuuidLimit)
          : [];

        // 이전 puuid에서 이미 포함된 matchId는 제거
        const filtered = matchIds.filter((id) => !seen.has(id));
        filtered.forEach((id) => seen.add(id));
        results.push({ puuid: p, matchIds: filtered });

        // DB에 저장
        try {
          await insertPlayerMatches(p, filtered);
        } catch (e) {
          const err = e as Error;
          console.error("insertPlayerMatches error:", err.message);
        }
      } catch {
        results.push({ puuid: p, matchIds: [] });
      }
    }

    return res.json({ ok: true, count: results.length, data: results });
  } catch (error) {
    return next(error);
  }
};
