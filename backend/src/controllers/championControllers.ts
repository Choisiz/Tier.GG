import { Request, Response } from "express";
import { pool } from "../lib/db";

// 챔피언 티어 계산에 사용되는 최소 필드 묶음
type ChampionTierRow = {
  champion_id: number;
  position: string;
  position_pick: number;
  position_wins: number;
  rate_position_pick: number;
  rate_position_win: number;
  rate_total_ban: number;
  adjusted_win_rate: number;
  confidence: number;
};

export const champion = async (req: Request, res: Response) => {
  try {
    // 기준일: 오늘 날짜(UTC 기준)
    const statDate = new Date().toISOString().slice(0, 10);

    // 분모: 총 매치 수(클래식 데이터만 적재 중이므로 전체)
    const { rows: totalRows } = await pool.query(
      `SELECT COUNT(DISTINCT match_id) AS total_matches FROM gameinfo`
    );
    const totalMatches = Number(totalRows[0]?.total_matches || 0);
    if (totalMatches === 0) {
      return res.json({ ok: true, inserted: 0, note: "no data" });
    }

    // 챔피언별 전체(포지션 무관) 지표: 픽/승/밴/포지션수
    const { rows: overall } = await pool.query(
      `
      WITH picks AS (
        SELECT pick_champion_id AS champ_id,
               COUNT(DISTINCT match_id) AS pick_matches,
               COUNT(DISTINCT match_id) FILTER (WHERE game_result) AS wins
        FROM gameinfo
        GROUP BY pick_champion_id
      ),
      bans AS (
        SELECT ban_champion_id AS champ_id,
               COUNT(DISTINCT match_id) AS ban_matches
        FROM gameinfo_bans
        GROUP BY ban_champion_id
      ),
      pos AS (
        SELECT pick_champion_id AS champ_id,
               COUNT(DISTINCT position) FILTER (WHERE position IS NOT NULL) AS position_count
        FROM gameinfo
        GROUP BY pick_champion_id
      )
      SELECT
        COALESCE(p.champ_id, b.champ_id) AS champ_id,
        COALESCE(p.pick_matches, 0) AS total_pick_matches,
        COALESCE(p.wins, 0) AS total_wins,
        COALESCE(b.ban_matches, 0) AS total_ban_matches,
        COALESCE(po.position_count, 0) AS position_count
      FROM picks p
      FULL OUTER JOIN bans b ON b.champ_id = p.champ_id
      LEFT JOIN pos po ON po.champ_id = COALESCE(p.champ_id, b.champ_id)
      `
    );

    // 챔피언×포지션별 지표
    const { rows: byPos } = await pool.query(
      `
      SELECT
        pick_champion_id AS champ_id,
        position,
        COUNT(DISTINCT match_id) AS pos_pick_matches,
        COUNT(DISTINCT match_id) FILTER (WHERE game_result) AS pos_wins
      FROM gameinfo
      WHERE position IS NOT NULL
      GROUP BY pick_champion_id, position
      `
    );

    // 챔피언×포지션별 대표 아이템 6개(최빈)
    const { rows: topItemsByPos } = await pool.query(
      `
      WITH unnested AS (
        SELECT
          pick_champion_id AS champ_id,
          position,
          unnest(ARRAY[item0,item1,item2,item3,item4,item5,item6]) AS item_id
        FROM gameinfo
        WHERE position IS NOT NULL
      ),
      counted AS (
        SELECT champ_id, position, item_id, COUNT(*) AS cnt
        FROM unnested
        WHERE item_id IS NOT NULL AND item_id <> 0
        GROUP BY champ_id, position, item_id
      )
      SELECT champ_id, position,
             (ARRAY_AGG(item_id ORDER BY cnt DESC, item_id ASC))[1:6] AS items
      FROM counted
      GROUP BY champ_id, position
      `
    );

    // 챔피언×포지션별 대표 룬(최빈): primary 4개, sub 2개
    const { rows: topRunesByPos } = await pool.query(
      `
      WITH counted AS (
        SELECT gi.pick_champion_id AS champ_id, gi.position, gp.slot_type, gp.perk_id, COUNT(*) AS cnt
        FROM gameinfo_perks gp
        JOIN gameinfo gi ON gi.match_id = gp.match_id AND gi.puuid = gp.puuid
        WHERE gi.position IS NOT NULL
        GROUP BY gi.pick_champion_id, gi.position, gp.slot_type, gp.perk_id
      ),
      prim AS (
        SELECT champ_id, position,
               (ARRAY_AGG(perk_id ORDER BY cnt DESC, perk_id ASC))[1:4] AS primary
        FROM counted WHERE slot_type = 'primary'
        GROUP BY champ_id, position
      ),
      sub AS (
        SELECT champ_id, position,
               (ARRAY_AGG(perk_id ORDER BY cnt DESC, perk_id ASC))[1:2] AS sub
        FROM counted WHERE slot_type = 'sub'
        GROUP BY champ_id, position
      )
      SELECT COALESCE(p.champ_id, s.champ_id) AS champ_id,
             COALESCE(p.position, s.position) AS position,
             p.primary AS primary_ids,
             s.sub AS sub_ids
      FROM prim p
      FULL OUTER JOIN sub s
        ON s.champ_id = p.champ_id AND s.position = p.position
      `
    );

    // 빠른 lookup용 맵 구성
    const posMap = new Map<string, any>();
    for (const r of byPos) {
      posMap.set(`${r.champ_id}__${r.position}`, r);
    }
    const itemMap = new Map<string, number[]>();
    for (const r of topItemsByPos) {
      itemMap.set(`${r.champ_id}__${r.position}`, r.items || []);
    }
    const runeMap = new Map<string, { primary?: number[]; sub?: number[] }>();
    for (const r of topRunesByPos) {
      runeMap.set(`${r.champ_id}__${r.position}`, {
        primary: r.primary_ids || [],
        sub: r.sub_ids || [],
      });
    }

    // 기존 해당 날짜 데이터 제거 후 삽입
    await pool.query("BEGIN");
    await pool.query(`DELETE FROM champion WHERE stat_date = $1`, [statDate]);

    const insertValues: any[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (const o of overall) {
      const champId = Number(o.champ_id);
      const total_pick_matches = Number(o.total_pick_matches || 0);
      const total_wins = Number(o.total_wins || 0);
      const total_ban_matches = Number(o.total_ban_matches || 0);
      const position_count = Number(o.position_count || 0);

      const total_pick_rate =
        totalMatches > 0
          ? Math.round((10000 * total_pick_matches) / totalMatches) / 100
          : 0;
      const total_ban_rate =
        totalMatches > 0
          ? Math.round((10000 * total_ban_matches) / totalMatches) / 100
          : 0;
      const total_win_rate =
        total_pick_matches > 0
          ? Math.round((10000 * total_wins) / total_pick_matches) / 100
          : 0;

      // 포지션 목록: byPos에서 해당 챔피언의 포지션들 추출
      const positions = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
      const posRows: Array<{ position: string; picks: number; wins: number }> =
        [];
      for (const p of positions) {
        const key = `${champId}__${p}`;
        if (posMap.has(key)) {
          const r = posMap.get(key);
          posRows.push({
            position: p,
            picks: Number(r.pos_pick_matches || 0),
            wins: Number(r.pos_wins || 0),
          });
        }
      }
      // 포지션 없으면 NULL 한 행이라도 넣을 수 있으나 요구는 포지션별 행 생성이므로 존재하는 포지션만
      if (posRows.length === 0) {
        // 통합만 한 행 넣고 싶으면 주석 해제
        // posRows.push({ position: null, picks: total_pick_matches, wins: total_wins } as any);
      }

      for (const pr of posRows) {
        // 대표 아이템/룬: 챔피언×포지션 기준 최빈
        const items = itemMap.get(`${champId}__${pr.position}`) || [];
        const runes = runeMap.get(`${champId}__${pr.position}`) || {};
        const primary = runes.primary || [];
        const sub = runes.sub || [];

        const pos_pick_rate =
          totalMatches > 0
            ? Math.round((10000 * pr.picks) / totalMatches) / 100
            : 0;
        const pos_win_rate =
          pr.picks > 0 ? Math.round((10000 * pr.wins) / pr.picks) / 100 : 0;

        // values 푸시
        insertValues.push(
          statDate,
          champId,
          pr.position,
          total_wins,
          total_pick_matches,
          total_ban_matches,
          total_pick_rate,
          total_win_rate,
          total_ban_rate,
          totalMatches,
          pr.picks,
          pr.wins,
          pos_pick_rate,
          pos_win_rate,
          items[0] || null,
          items[1] || null,
          items[2] || null,
          items[3] || null,
          items[4] || null,
          items[5] || null,
          primary[0] || null,
          primary[1] || null,
          primary[2] || null,
          primary[3] || null,
          sub[0] || null,
          sub[1] || null
        );
        const base = idx;
        idx += 26;
        placeholders.push(
          `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${
            base + 4
          }, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${
            base + 9
          }, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${
            base + 14
          }, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${
            base + 19
          }, $${base + 20}, $${base + 21}, $${base + 22}, $${base + 23}, $${
            base + 24
          }, $${base + 25})`
        );
      }
    }

    if (insertValues.length > 0) {
      await pool.query(
        `
        INSERT INTO champion (
          stat_date, champion_id, position,
          total_win, total_pick, total_ban,
          rate_total_pick, rate_total_win, rate_total_ban, total_matches,
          position_pick, position_wins, rate_position_pick, rate_position_win,
          item1, item2, item3, item4, item5, item6,
          rune_primary1, rune_primary2, rune_primary3, rune_primary4,
          rune_sub1, rune_sub2
        )
        VALUES ${placeholders.join(",")}
        ON CONFLICT (stat_date, champion_id, position) DO UPDATE SET
          total_win = EXCLUDED.total_win,
          total_pick = EXCLUDED.total_pick,
          total_ban = EXCLUDED.total_ban,
          rate_total_pick = EXCLUDED.rate_total_pick,
          rate_total_win = EXCLUDED.rate_total_win,
          rate_total_ban = EXCLUDED.rate_total_ban,
          total_matches = EXCLUDED.total_matches,
          position_pick = EXCLUDED.position_pick,
          position_wins = EXCLUDED.position_wins,
          rate_position_pick = EXCLUDED.rate_position_pick,
          rate_position_win = EXCLUDED.rate_position_win,
          item1 = EXCLUDED.item1, item2 = EXCLUDED.item2, item3 = EXCLUDED.item3,
          item4 = EXCLUDED.item4, item5 = EXCLUDED.item5, item6 = EXCLUDED.item6,
          rune_primary1 = EXCLUDED.rune_primary1, rune_primary2 = EXCLUDED.rune_primary2,
          rune_primary3 = EXCLUDED.rune_primary3, rune_primary4 = EXCLUDED.rune_primary4,
          rune_sub1 = EXCLUDED.rune_sub1, rune_sub2 = EXCLUDED.rune_sub2
        `,
        insertValues
      );
    }

    await pool.query("COMMIT");
    return res.json({
      ok: true,
      inserted: insertValues.length ? insertValues.length / 26 : 0,
    });
  } catch (err) {
    await pool.query("ROLLBACK").catch(() => {});
    const e = err as any;
    console.error("champion aggregation failed:", e?.message || e, e?.stack);
    return res.status(500).json({
      ok: false,
      error: "champion aggregation failed",
      detail: e?.message || String(e),
    });
  }
};

export const championTierList = async (req: Request, res: Response) => {
  try {
    const priorPick = Number(process.env.TIER_PRIOR_PICK ?? 15);
    const priorWinRate = Number(process.env.TIER_PRIOR_WIN_RATE ?? 50);
    const sampleThreshold = Number(process.env.TIER_SAMPLE_THRESHOLD ?? 30);

    const statDateParam = (req.query.statDate as string) || null;

    let statDate = statDateParam;
    if (!statDate) {
      const { rows } = await pool.query(
        `SELECT MAX(stat_date) AS max_date FROM champion`
      );
      statDate = rows[0]?.max_date;
    }

    if (!statDate) {
      return res.status(404).json({ ok: false, error: "no champion data" });
    }

    // champion 테이블에서 포지션별 집계 데이터 조회
    const { rows } = await pool.query(
      `
      SELECT
        champion_id,
        position,
        position_pick,
        position_wins,
        rate_position_pick,
        rate_position_win,
        rate_total_ban
      FROM champion
      WHERE stat_date = $1
      `,
      [statDate]
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ ok: false, error: "no champion data", statDate });
    }

    const grouped = new Map<string, ChampionTierRow[]>();
    for (const r of rows) {
      const key = r.position || "UNKNOWN";
      const arr = grouped.get(key) || [];
      const position_pick = Number(r.position_pick || 0);
      const rate_position_win = Number(r.rate_position_win || 0);
      const adjusted_win_rate =
        position_pick > 0
          ? (rate_position_win * position_pick + priorWinRate * priorPick) /
            (position_pick + priorPick)
          : priorWinRate;
      const confidence =
        position_pick > 0
          ? Math.max(
              0,
              Math.min(1, position_pick / Math.max(sampleThreshold, 1))
            )
          : 0;
      arr.push({
        champion_id: Number(r.champion_id),
        position: key,
        position_pick,
        position_wins: Number(r.position_wins || 0),
        rate_position_pick: Number(r.rate_position_pick || 0),
        rate_position_win,
        rate_total_ban: Number(r.rate_total_ban || 0),
        adjusted_win_rate,
        confidence,
      });
      grouped.set(key, arr);
    }

    const result: Array<{
      statDate: string;
      position: string;
      championId: number;
      tier: string;
      pickCount: number;
      winCount: number;
      pickRate: number;
      winRate: number;
      banRate: number;
      score: number;
    }> = [];

    // 간단한 퍼센타일 계산기 (0~1 사이 값으로 정규화)
    const percentile = (
      items: ChampionTierRow[],
      selector: (row: ChampionTierRow) => number
    ): Map<string, number> => {
      const sorted = [...items]
        .map((row) => ({ row, value: selector(row) }))
        .sort((a, b) => a.value - b.value);
      const map = new Map<string, number>();
      const n = sorted.length;
      if (n === 1) {
        const onlyKey = `${sorted[0].row.champion_id}__${sorted[0].row.position}`;
        map.set(onlyKey, 1);
        return map;
      }
      sorted.forEach((entry, idx) => {
        const key = `${entry.row.champion_id}__${entry.row.position}`;
        map.set(key, idx / (n - 1));
      });
      return map;
    };

    for (const [position, items] of grouped.entries()) {
      // 승률/픽률/벤률 각각을 퍼센타일로 정규화
      const winMap = percentile(items, (row) => row.adjusted_win_rate);
      const pickMap = percentile(items, (row) => row.rate_position_pick);
      const banMap = percentile(items, (row) => row.rate_total_ban);

      const scored = items
        .map((row) => {
          const key = `${row.champion_id}__${row.position}`;
          const score =
            (winMap.get(key) || 0) * 0.6 +
            (pickMap.get(key) || 0) * 0.3 +
            (banMap.get(key) || 0) * 0.1;
          const confidenceScore = score * (row.confidence || 0);
          return { row, score: confidenceScore };
        })
        .sort((a, b) => b.score - a.score);

      scored.forEach((entry, idx) => {
        // 포지션별 최고점 챔피언은 OP, 이후 비율 기준으로 1~4티어 배정
        const tier = (() => {
          if (idx === 0) return "OP";
          if (scored.length === 1) return "OP";
          const ratio = scored.length > 1 ? idx / (scored.length - 1) : 1;
          if (ratio <= 0.25) return "1tier";
          if (ratio <= 0.5) return "2tier";
          if (ratio <= 0.75) return "3tier";
          return "4tier";
        })();

        result.push({
          statDate,
          position,
          championId: entry.row.champion_id,
          tier,
          pickCount: entry.row.position_pick,
          winCount: entry.row.position_wins,
          pickRate: entry.row.rate_position_pick,
          winRate: entry.row.rate_position_win,
          banRate: entry.row.rate_total_ban,
          score: Math.round(entry.score * 1000) / 1000,
        });
      });
    }

    return res.json({
      ok: true,
      statDate,
      count: result.length,
      data: result,
    });
  } catch (err) {
    const e = err as any;
    console.error("champion tier list failed:", e?.message || e, e?.stack);
    return res.status(500).json({
      ok: false,
      error: "champion tier list failed",
      detail: e?.message || String(e),
    });
  }
};
