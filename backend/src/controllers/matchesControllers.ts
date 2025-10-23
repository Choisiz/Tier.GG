import { Request, Response, NextFunction } from "express";
import axios from "axios";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const matches10 = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = process.env.RIOT_API_KEY;
    const base = process.env.RIOT_API_BASE_URL;
    if (!token) {
      return res.status(500).json({ error: "Missing RIOT_API_KEY" });
    }

    const perPuuidLimit = Number(req.query.limit || 5); // puuid당 matchId 개수

    const internalBase =
      process.env.INTERNAL_API_BASE_URL ||
      `http://localhost:${process.env.PORT || 5500}`;
    const tierUrl = `${internalBase}/info/tier/puuid`;

    const tierResp = await axios.get(tierUrl, { timeout: 15000 });
    const tierData = Array.isArray(tierResp.data?.data)
      ? tierResp.data.data
      : [];
    const puuidAll: string[] = tierData
      .map((it: any) => it.puuid)
      .filter(Boolean);

    const delayMs = Number(req.query.delayMs || 200);
    const results: Array<{ puuid: string; matchIds: string[] }> = [];
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
        results.push({ puuid: p, matchIds });
      } catch {
        results.push({ puuid: p, matchIds: [] });
      }
      if (delayMs > 0) await sleep(delayMs);
    }

    return res.json({ ok: true, count: results.length, data: results });
  } catch (error) {
    return next(error);
  }
};
