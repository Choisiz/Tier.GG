// 통합 테스트 도우미: 실제 Supabase에 연결해 BEGIN … ROLLBACK 안에서만 쓴다.
// 가짜 패치 0.8·0.9, 가짜 match_id KR_90000000xx, 가짜 puuid TEST_…, 2021년 시작 시각만 쓴다
// (실제 데이터와 섞이지 않게. 집계는 과거 p_until로 2021년 창만 센다, 변경 01-7).
import pg from 'pg';
import { transformMatch, type MatchRow, type PlayerRow } from '../../src/collector/transform.js';
import { clone, loadMatch, loadTimeline, OPTS } from './fixture.js';

export const TEST_PATCH = '0.9';
export const TEST_SAMPLE_PUUID = 'TEST_SAMPLE_PUUID_0001';
/** 가짜 게임 기본 시작 시각 */
export const FAKE_START_MS = Date.parse('2021-01-10T00:00:00Z');
/** 가짜 게임 변환에 쓰는 창 시작 */
export const FAKE_WINDOW_START_MS = Date.parse('2021-01-01T00:00:00Z');
/** 가짜 게임 집계용 과거 p_until: [2021-01-01, 2021-01-15) 창 */
export const FAKE_UNTIL = '2021-01-15T00:00:00Z';

export function connect(): pg.Client {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL이 없습니다 (npm run test:integration은 ../.env를 읽음)');
  return new pg.Client({ connectionString: url, application_name: 'tiergg-backend-test' });
}

/** BEGIN → fn → 항상 ROLLBACK */
export async function inRollback<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = connect();
  await c.connect();
  try {
    await c.query('BEGIN');
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}

/**
 * fixture를 n개의 서로 다른 가짜 게임으로 (홀수 번째는 승패를 뒤집음).
 * 게임마다 gameStartTimestamp = startMs + k × 60,000. firstId로 match_id 번호가 겹치지 않게 할 수 있다.
 */
export function fakeGames(
  n: number,
  o: { patch?: string; startMs?: number; firstId?: number } = {},
): { match: MatchRow; players: PlayerRow[] }[] {
  const patch = o.patch ?? TEST_PATCH;
  const startMs = o.startMs ?? FAKE_START_MS;
  const firstId = o.firstId ?? 1;
  const out: { match: MatchRow; players: PlayerRow[] }[] = [];
  for (let k = firstId; k < firstId + n; k++) {
    const m = clone(loadMatch());
    const tl = clone(loadTimeline());
    const id = `KR_${9_000_000_000 + k}`;
    m.metadata.matchId = id;
    tl.metadata.matchId = id;
    m.info.gameVersion = `${patch}.1.1`;
    m.info.gameStartTimestamp = startMs + k * 60_000;
    const suffix = `_G${String(k).padStart(3, '0')}`;
    for (const p of m.info.participants) {
      p.puuid += suffix;
      if (k % 2 === 1) p.win = !p.win;
    }
    for (const p of tl.info.participants) p.puuid += suffix;
    const r = transformMatch(m, tl, TEST_SAMPLE_PUUID, { ...OPTS, windowStartMs: FAKE_WINDOW_START_MS });
    if (!r.ok) throw new Error(`fixture 변환 실패: ${r.reason} ${r.detail}`);
    out.push({ match: r.match, players: r.players });
  }
  return out;
}

export async function insertSamplePlayer(c: pg.Client): Promise<void> {
  await c.query(`INSERT INTO ranked_players (puuid, tier, rank) VALUES ($1, 'EMERALD', 'I')`, [TEST_SAMPLE_PUUID]);
}
