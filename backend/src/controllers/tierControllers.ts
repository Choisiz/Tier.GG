import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { upsertPlayer } from "../lib/db";
import { riotRateLimiter } from "../lib/rateLimiter";

async function fetchPuuidBySummonerId(
  base: string,
  token: string,
  summonerId: string
): Promise<string | null> {
  try {
    const url = `${base}/lol/summoner/v4/summoners/${encodeURIComponent(
      summonerId
    )}`;
    await riotRateLimiter.wait();
    const resp = await axios.get(url, {
      headers: { "X-Riot-Token": token },
      timeout: 10000,
    });
    return resp.data?.puuid ?? null;
  } catch (e) {
    const err = e as Error;
    console.error("fetchPuuidBySummonerId error:", err.message);
    return null;
  }
}

export const puuid = async (
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
    if (!base) {
      return res.status(500).json({ error: "Missing RIOT_API_BASE_URL" });
    }
    const { queue = "RANKED_SOLO_5x5", page = "1" } = req.query as {
      queue?: string;
      page?: string;
    };

    const TIERS = [
      "IRON",
      "SILVER",
      "GOLD",
      "PLATINUM",
      "EMERALD",
      "DIAMOND",
    ] as const;

    const DIVISIONS = ["IV", "III", "II", "I"] as const;

    const all: Array<{
      puuid: string;
      tier: string;
      rank: string;
      wins: number;
      losses: number;
    }> = [];

    for (const t of TIERS) {
      for (const d of DIVISIONS) {
        const url = `${base}/lol/league/v4/entries/${encodeURIComponent(
          queue
        )}/${encodeURIComponent(t)}/${encodeURIComponent(
          d
        )}?page=${encodeURIComponent(page)}`;
        try {
          const response = await axios.get(url, {
            headers: { "X-Riot-Token": token },
            timeout: 10000,
          });
          const items = Array.isArray(response.data) ? response.data : [];
          const limited = items.slice(0, 4); // 조합당 최대 4명으로 제한
          for (const it of limited) {
            let p: string | null = it.puuid ?? null;
            if (!p && it.summonerId) {
              p = await fetchPuuidBySummonerId(base, token, it.summonerId);
            }
            if (!p) continue;
            all.push({
              puuid: p,
              tier: it.tier,
              rank: it.rank,
              wins: it.wins,
              losses: it.losses,
            });
            try {
              await upsertPlayer({
                puuid: p,
                tier: it.tier,
                rank: it.rank,
                wins: it.wins,
                losses: it.losses,
              });
            } catch (e) {
              const err = e as Error;
              console.error("upsertPlayer error:", err.message);
            }
          }
        } catch (err) {
          console.error("tierControllers error:", err);
        }
      }
    }

    return res.json({ ok: true, count: all.length, data: all });
  } catch (error) {}
};
