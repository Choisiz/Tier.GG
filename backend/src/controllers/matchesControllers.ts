import { Request, Response, NextFunction } from "express";
import axios from "axios";

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
    const base = process.env.RIOT_API_BASE_URL2;
    if (!token) {
      return res.status(500).json({ error: "Missing RIOT_API_KEY" });
    }
    if (!base) {
      return res.status(500).json({ error: "Missing RIOT_API_BASE_URL2" });
    }

    // puuid당 matchId 개수
    const perPuuidLimit = Number(req.query.limit || 5);

    //puuid 정보를 가져올 백엔드 주소
    const baseUrl =
      `http://${process.env.BACKEND_URL}:${process.env.PORT}` ||
      `http://localhost:5500}`;
    const tierUrl = `${baseUrl}/info/tier/puuid`;

    const tierResp = await axios.get(tierUrl, { timeout: 15000 });
    const tierData = Array.isArray(tierResp.data?.data)
      ? tierResp.data.data
      : [];
    const puuidAll: string[] = tierData
      .map((it: any) => it.puuid)
      .filter(Boolean);

    // 요청 간 최소 지연: 초당 9회 이하로 제한(사용자가 더 큰 값을 넣으면 그 값 사용)
    const userDelay = Number(req.query.delayMs || DELAY_MS);
    const delayMs = isNaN(userDelay) ? DELAY_MS : Math.max(userDelay, DELAY_MS);
    const results: Array<{ puuid: string; matchIds: string[] }> = [];
    const seen = new Set<string>(); // 이전 puuid에서 이미 본 matchId 누적
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
