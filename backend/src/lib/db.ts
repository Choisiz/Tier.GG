import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL || "postgresql://app:app@localhost:5433/tier";

export const pool = new Pool({ connectionString });

export async function upsertPlayer(args: {
  puuid: string;
  tier?: string;
  rank?: string;
  wins?: number;
  losses?: number;
}) {
  const { puuid, tier, rank, wins, losses } = args;
  await pool.query(
    `INSERT INTO players (puuid, tier, rank, wins, losses)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (puuid)
     DO UPDATE SET tier = EXCLUDED.tier, rank = EXCLUDED.rank, wins = EXCLUDED.wins, losses = EXCLUDED.losses, updated_at = NOW()`,
    [puuid, tier ?? null, rank ?? null, wins ?? null, losses ?? null]
  );
}

export async function insertPlayerMatches(puuid: string, matchIds: string[]) {
  if (matchIds.length === 0) return;
  const values: any[] = [];
  const placeholders: string[] = [];
  matchIds.forEach((mid, i) => {
    values.push(puuid, mid);
    placeholders.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
  });
  await pool.query(
    `INSERT INTO player_matches (puuid, match_id) VALUES ${placeholders.join(
      ","
    )}
     ON CONFLICT (puuid, match_id) DO NOTHING`,
    values
  );
}

export async function getPuuidsFromDb(limit?: number): Promise<string[]> {
  if (typeof limit === "number" && limit > 0) {
    const { rows } = await pool.query(
      `SELECT puuid FROM players ORDER BY updated_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map((r: any) => r.puuid as string);
  }
  const { rows } = await pool.query(
    `SELECT puuid FROM players ORDER BY updated_at DESC`
  );
  return rows.map((r: any) => r.puuid as string);
}
