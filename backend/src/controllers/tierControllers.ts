import { Request, Response } from "express";
import axios from "axios";
import { insertPlayer } from "../lib/db";
import { riotRateLimiter } from "../lib/rateLimiter";

export const player = async (req: Request, res: Response) => {
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

    for (const tier of TIERS) {
      for (const division of DIVISIONS) {
        const url = `${base}/lol/league/v4/entries/${encodeURIComponent(
          queue
        )}/${encodeURIComponent(tier)}/${encodeURIComponent(
          division
        )}?page=${encodeURIComponent(page)}`;
        try {
          await riotRateLimiter.wait();
          const response = await axios.get(url, {
            headers: { "X-Riot-Token": token },
            timeout: 10000,
          });
          console.log("response", response);
          const items = Array.isArray(response.data) ? response.data : [];
          const limited = items.slice(0, 4); // 티어당 최대 4명으로 제한
          for (const player of limited) {
            // 환경상 entries 응답에 puuid가 항상 포함됨
            const resolvedPuuid: string | null = (player as any)?.puuid ?? null;
            if (!resolvedPuuid) continue;
            all.push({
              puuid: resolvedPuuid,
              tier: player.tier,
              rank: player.rank,
              wins: player.wins,
              losses: player.losses,
            });
            try {
              //DB에 저장
              await insertPlayer({
                puuid: resolvedPuuid,
                tier: player.tier,
                rank: player.rank,
                wins: player.wins,
                losses: player.losses,
              });
            } catch (err) {
              //console.error("insertPlayer error:", err);
            }
          }
        } catch (err) {
          //console.error("tierControllers api error:", err);
        }
      }
    }
    return res.json({ ok: true, count: all.length, data: all });
  } catch (err) {
    //console.error("tierControllers error:", err);
    return res.status(500).json({ ok: false, error: "tierControllers error" });
  }
};
