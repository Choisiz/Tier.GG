import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { insertPlayerMatches, getPuuidsFromDb } from "../lib/db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RATE_PER_SEC = 9;
const DELAY_MS = Math.ceil(1000 / RATE_PER_SEC); // 초당 9회 이하로 제한

export const matches10 = async (
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

    // puuid당 matchId 개수
    const perPuuidLimit = Number(req.query.limit || 5);

    // DB에서 PUUID 목록 가져오기
    const puuidListLimit = Number(req.query.puuidLimit || 0);
    const puuidAll: string[] = await getPuuidsFromDb(
      isNaN(puuidListLimit) || puuidListLimit <= 0 ? undefined : puuidListLimit
    );

    // 요청 간 최소 지연: 초당 9회 이하로 제한(사용자가 더 큰 값을 넣으면 그 값 사용)
    const userDelay = Number(req.query.delayMs || DELAY_MS);
    const delayMs = isNaN(userDelay) ? DELAY_MS : Math.max(userDelay, DELAY_MS);
    const results: Array<{ puuid: string; matchIds: string[] }> = [];
    const seen = new Set<string>();
    for (const p of puuidAll) {
      try {
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
      await sleep(delayMs);
    }

    return res.json({ ok: true, count: results.length, data: results });
  } catch (error) {
    return next(error);
  }
};
