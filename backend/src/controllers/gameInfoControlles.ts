import { Request, Response, NextFunction } from "express";
import axios from "axios";
import {
  upsertMatchDetails,
  MatchDetailRow,
  insertMatchDetailBans,
} from "../lib/db";
import { riotRateLimiter } from "../lib/rateLimiter";
import { getUnprocessedMatchIds } from "../lib/db";

export const gameInfo = async (
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

    const puuidFilter = String(req.query.puuid || "").trim();
    const maxTotal = Number(req.query.max || 0); // 0이면 제한 없음
    const batchSize = Math.max(1, Number(req.query.batchSize || 20));

    let processed = 0;
    let failed = 0;
    const processedMatchIds: string[] = [];

    while (true) {
      const remain = maxTotal > 0 ? maxTotal - processed : batchSize;
      const take = maxTotal > 0 ? Math.min(batchSize, remain) : batchSize;
      if (maxTotal > 0 && remain <= 0) break;

      const matchIds = await getUnprocessedMatchIds(
        take,
        puuidFilter || undefined
      );
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
          const gameVersion: string | undefined = info.gameVersion;
          const gameMode: string | undefined = info.gameMode;

          const teams: any[] = Array.isArray(info.teams) ? info.teams : [];
          const teamIdToBans = new Map<number, number[]>();
          for (const t of teams) {
            const teamId = t?.teamId;
            if (typeof teamId !== "number") continue;
            const tb = Array.isArray(t?.bans) ? t.bans : [];
            const ids = tb
              .map((b: any) =>
                typeof b?.championId === "number" ? b.championId : null
              )
              .filter((x: number | null) => typeof x === "number") as number[];
            teamIdToBans.set(teamId, ids);
          }

          const participantsSrc: any[] = Array.isArray(info.participants)
            ? info.participants
            : [];

          const banRows: {
            matchId: string;
            puuid: string;
            banChampionId: number;
          }[] = [];
          const rows: MatchDetailRow[] = participantsSrc.map((p) => {
            const teamId = typeof p?.teamId === "number" ? p.teamId : null;
            const bansForTeam =
              teamId != null ? teamIdToBans.get(teamId) || [] : [];
            const puuid: string = p?.puuid;

            for (const banId of bansForTeam) {
              if (typeof banId === "number") {
                banRows.push({
                  matchId: metadata.matchId || matchId,
                  puuid,
                  banChampionId: banId,
                });
              }
            }

            const row: MatchDetailRow = {
              matchId: metadata.matchId || matchId,
              gameVersion: gameVersion ?? null,
              gameMode: gameMode ?? null,
              puuid,
              gameResult: typeof p?.win === "boolean" ? p.win : null,
              pickChampionId:
                typeof p?.championId === "number" ? p.championId : null,
              position:
                typeof p?.teamPosition === "string" ? p.teamPosition : null,
              item0: typeof p?.item0 === "number" ? p.item0 : null,
              item1: typeof p?.item1 === "number" ? p.item1 : null,
              item2: typeof p?.item2 === "number" ? p.item2 : null,
              item3: typeof p?.item3 === "number" ? p.item3 : null,
              item4: typeof p?.item4 === "number" ? p.item4 : null,
              item5: typeof p?.item5 === "number" ? p.item5 : null,
              item6: typeof p?.item6 === "number" ? p.item6 : null,
              spell1Casts:
                typeof p?.spell1Casts === "number" ? p.spell1Casts : null,
              spell2Casts:
                typeof p?.spell2Casts === "number" ? p.spell2Casts : null,
            };
            return row;
          });

          await upsertMatchDetails(rows);
          await insertMatchDetailBans(banRows);
          processed += 1;
          processedMatchIds.push(matchId);
          if (maxTotal > 0 && processed >= maxTotal) break;
        } catch (e) {
          failed += 1;
        }
      }

      if (maxTotal > 0 && processed >= maxTotal) break;
    }

    return res.json({ ok: true, processed, failed, processedMatchIds });
  } catch (error) {
    return next(error);
  }
};
