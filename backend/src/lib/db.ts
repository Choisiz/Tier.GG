import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL || "postgresql://app:app@localhost:5433/tier";

export const pool = new Pool({ connectionString });

export type MatchDetailRow = {
  matchId: string;
  gameVersion?: string | null;
  gameMode?: string | null;
  puuid: string;
  gameResult?: boolean | null;
  pickChampionId?: number | null;
  position?: string | null;
  item0?: number | null;
  item1?: number | null;
  item2?: number | null;
  item3?: number | null;
  item4?: number | null;
  item5?: number | null;
  item6?: number | null;
  spell1Casts?: number | null;
  spell2Casts?: number | null;
};

export type MatchDetailBanRow = {
  matchId: string;
  puuid: string;
  banChampionId: number;
};

export type MatchDetailPerkRow = {
  matchId: string;
  puuid: string;
  slotType: "primary" | "sub";
  perkId: number;
};

//player 테이블
export async function insertPlayer(args: {
  puuid: string;
  tier?: string;
  rank?: string;
  wins?: number;
  losses?: number;
}) {
  const { puuid, tier, rank, wins, losses } = args;
  await pool.query("BEGIN");
  try {
    await pool.query(`DELETE FROM players WHERE puuid = $1`, [puuid]);
    await pool.query(
      `INSERT INTO players (puuid, tier, rank, wins, losses)
       VALUES ($1, $2, $3, $4, $5)`,
      [puuid, tier ?? null, rank ?? null, wins ?? null, losses ?? null]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

//matches 테이블
export async function insertPlayerMatches(puuid: string, matchIds: string[]) {
  await pool.query("BEGIN");
  try {
    await pool.query(`DELETE FROM matches WHERE puuid = $1`, [puuid]);
    if (Array.isArray(matchIds) && matchIds.length > 0) {
      await pool.query(
        `INSERT INTO matches (puuid, match_id)
         SELECT $1, unnest($2::text[])
         ON CONFLICT (puuid, match_id) DO NOTHING`,
        [puuid, matchIds]
      );
    }
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

// 통합 매치 상세 테이블 - 삽입
export async function insertMatchDetails(rows: MatchDetailRow[]) {
  if (!rows || rows.length === 0) return;
  const columns = [
    "match_id",
    "game_version",
    "game_mode",
    "puuid",
    "game_result",
    "pick_champion_id",
    "position",
    "item0",
    "item1",
    "item2",
    "item3",
    "item4",
    "item5",
    "item6",
    "spell1_casts",
    "spell2_casts",
  ];

  const values: any[] = [];
  const placeholders: string[] = [];
  rows.forEach((r, i) => {
    values.push(
      r.matchId,
      r.gameVersion ?? null,
      r.gameMode ?? null,
      r.puuid,
      typeof r.gameResult === "boolean" ? r.gameResult : null,
      r.pickChampionId ?? null,
      r.position ?? null,
      r.item0 ?? null,
      r.item1 ?? null,
      r.item2 ?? null,
      r.item3 ?? null,
      r.item4 ?? null,
      r.item5 ?? null,
      r.item6 ?? null,
      r.spell1Casts ?? null,
      r.spell2Casts ?? null
    );
    const baseIndex = i * columns.length + 1;
    const ph = columns.map((_, j) => `$${baseIndex + j}`);
    placeholders.push(`(${ph.join(",")})`);
  });

  await pool.query(
    `INSERT INTO gameinfo (${columns.join(", ")})
     VALUES ${placeholders.join(",")}
     ON CONFLICT (match_id, puuid) DO UPDATE SET
       game_version = EXCLUDED.game_version,
       game_mode = EXCLUDED.game_mode,
       game_result = EXCLUDED.game_result,
       pick_champion_id = EXCLUDED.pick_champion_id,
       position = EXCLUDED.position,
       item0 = EXCLUDED.item0,
       item1 = EXCLUDED.item1,
       item2 = EXCLUDED.item2,
       item3 = EXCLUDED.item3,
       item4 = EXCLUDED.item4,
       item5 = EXCLUDED.item5,
       item6 = EXCLUDED.item6,
       spell1_casts = EXCLUDED.spell1_casts,
       spell2_casts = EXCLUDED.spell2_casts`,
    values
  );
}

// 통합 매치 벤픽 테이블 - 삽입
export async function insertMatchDetailBans(rows: MatchDetailBanRow[]) {
  if (!rows || rows.length === 0) return;
  const columns = ["match_id", "ban_champion_id", "puuid"];
  const values: any[] = [];
  const placeholders: string[] = [];
  rows.forEach((r, i) => {
    values.push(r.matchId, r.banChampionId, r.puuid);
    const baseIndex = i * columns.length + 1;
    const ph = columns.map((_, j) => `$${baseIndex + j}`);
    placeholders.push(`(${ph.join(",")})`);
  });

  await pool.query(
    `INSERT INTO gameinfo_bans (${columns.join(", ")})
     VALUES ${placeholders.join(",")}
     ON CONFLICT (match_id, puuid, ban_champion_id) DO NOTHING`,
    values
  );
}

// 통합 매치 룬 테이블 - 삽입
export async function insertMatchDetailPerks(rows: MatchDetailPerkRow[]) {
  if (!rows || rows.length === 0) return;
  const columns = ["match_id", "puuid", "slot_type", "perk_id"];
  const values: any[] = [];
  const placeholders: string[] = [];
  rows.forEach((r, i) => {
    values.push(r.matchId, r.puuid, r.slotType, r.perkId);
    const baseIndex = i * columns.length + 1;
    const ph = columns.map((_, j) => `$${baseIndex + j}`);
    placeholders.push(`(${ph.join(",")})`);
  });

  await pool.query(
    `INSERT INTO gameinfo_perks (${columns.join(", ")})
     VALUES ${placeholders.join(",")}
     ON CONFLICT (match_id, puuid, slot_type, perk_id) DO NOTHING`,
    values
  );
}

//puuid 목록 조회
export async function getAllPuuids(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT puuid FROM players ORDER BY updated_at DESC`
  );
  return rows.map((r: any) => r.puuid as string);
}

//match_id 목록 조회
export async function getAllMatchIds(
  limit?: number,
  offset?: number
): Promise<string[]> {
  const params: any[] = [];
  let sql = `
    SELECT DISTINCT ON (m.match_id) m.match_id
    FROM matches m
    ORDER BY m.match_id, m.created_at DESC
  `;
  if (typeof limit === "number" && limit > 0) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }
  if (typeof offset === "number" && offset > 0) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }
  const { rows } = await pool.query(sql, params);
  return rows.map((r: any) => r.match_id as string);
}

export async function deleteMatchDetailsByMatchIds(matchIds: string[]) {
  if (!Array.isArray(matchIds) || matchIds.length === 0) return;
  await pool.query("BEGIN");
  try {
    await pool.query(
      `DELETE FROM gameinfo_perks WHERE match_id = ANY($1::text[])`,
      [matchIds]
    );
    await pool.query(
      `DELETE FROM gameinfo_bans WHERE match_id = ANY($1::text[])`,
      [matchIds]
    );
    await pool.query(`DELETE FROM gameinfo WHERE match_id = ANY($1::text[])`, [
      matchIds,
    ]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

//players 테이블 존재여부확인
export async function hasPlayers(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM players) AS e`
  );
  return Boolean(rows[0]?.e);
}
//matches 테이블 존재여부확인
export async function hasMatches(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM matches) AS e`
  );
  return Boolean(rows[0]?.e);
}
