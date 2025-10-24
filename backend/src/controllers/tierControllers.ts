import { Request, Response, NextFunction } from "express";
import axios from "axios";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RATE_PER_SEC = 9;
const DELAY_MS = Math.ceil(1000 / RATE_PER_SEC); // 초당 9회 이하로 제한

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
            all.push({
              puuid: it.puuid,
              tier: it.tier,
              rank: it.rank,
              wins: it.wins,
              losses: it.losses,
            });
          }
        } catch (err) {
          // 실패해도 다음 조합으로 진행
        } finally {
          // 초당 9회 이하로 호출 속도 제한
          await sleep(DELAY_MS);
        }
      }
    }

    return res.json({ ok: true, count: all.length, data: all });
  } catch (error) {}
};
