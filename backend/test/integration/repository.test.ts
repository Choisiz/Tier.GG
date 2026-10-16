// 저장소·창 집계·purge 미리보기·스냅숏·수집 기록 (실제 Supabase, 모두 ROLLBACK)
// 가짜 게임은 2021년 시작, 집계는 과거 p_until(2021-01-15)로 2021년 창만 센다 (변경 01-7-3).
// 실제 stats_window는 트랜잭션 안에서만 바뀌고 되돌려진다. 05:00 KST(20:00 UTC)에는 돌리지 않는다.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import pg from 'pg';
import { aggregateWindow, planPurgeGames } from '../../src/collector/aggregate.js';
import { readSnapshot } from '../../src/db/snapshot.js';
import { silentLogger } from '../../src/lib/logger.js';
import {
  closeStaleRunning,
  finishRun,
  lastDoneAt,
  startRun,
} from '../../src/repositories/logRepository.js';
import {
  countMatchesSince,
  countRankedPlayersByTier,
  existingMatchIds,
  saveMatch,
  upsertRankedPlayers,
} from '../../src/repositories/rawRepository.js';
import {
  connect,
  FAKE_START_MS,
  FAKE_UNTIL,
  FAKE_WINDOW_START_MS,
  fakeGames,
  inRollback,
  insertSamplePlayer,
  TEST_PATCH,
  TEST_SAMPLE_PUUID,
} from '../helpers/db.js';

describe('rawRepository (ROLLBACK)', () => {
  it('게임 저장 → matches(game_start_at) 1줄 + match_players 10줄, 다시 저장하면 duplicate(0줄)', async () => {
    await inRollback(async (c) => {
      await insertSamplePlayer(c);
      const [g] = fakeGames(1);
      assert.ok(g);
      assert.equal(await saveMatch(c, g.match, g.players), 'saved');
      const n = await c.query(`SELECT count(*)::int AS n FROM match_players WHERE match_id = $1`, [g.match.match_id]);
      assert.equal(n.rows[0].n, 10);
      const m = await c.query(`SELECT puuid, patch, game_start_at FROM matches WHERE match_id = $1`, [g.match.match_id]);
      assert.deepEqual(m.rows[0], {
        puuid: TEST_SAMPLE_PUUID,
        patch: TEST_PATCH,
        game_start_at: new Date(FAKE_START_MS + 60_000),
      });

      assert.equal(await saveMatch(c, g.match, g.players), 'duplicate');
      const n2 = await c.query(`SELECT count(*)::int AS n FROM match_players WHERE match_id = $1`, [g.match.match_id]);
      assert.equal(n2.rows[0].n, 10);
      assert.deepEqual([...(await existingMatchIds(c, [g.match.match_id, 'KR_1']))], [g.match.match_id]);

      // DB에 저장된 1번 참가자 값 = 계약 6-3
      const p = await c.query(
        `SELECT champion_id, team_position, win, ban_champion_id, summoner1_id, summoner2_id,
                primary_style, sub_style, item4, item5, skill_order
           FROM match_players WHERE match_id = $1 AND puuid = $2`,
        [g.match.match_id, 'TEST_PUUID_01_G001'],
      );
      // 1번째 가짜 게임은 홀수라 승패를 뒤집었다
      assert.deepEqual(p.rows[0], {
        champion_id: 23,
        team_position: 'TOP',
        win: false,
        ban_champion_id: 64,
        summoner1_id: 14,
        summoner2_id: 4,
        primary_style: 8100,
        sub_style: 8000,
        item4: 1036,
        item5: 1036,
        skill_order: 'EQQWQRQEQEREEW',
      });
    });
  });

  it('countMatchesSince: 창 시작 이후 게임만 센다', async () => {
    await inRollback(async (c) => {
      const since = new Date(FAKE_WINDOW_START_MS);
      const mid = new Date(FAKE_START_MS + 90_000); // 두 게임 시작(00:01, 00:02) 사이
      const before = await countMatchesSince(c, since);
      const beforeMid = await countMatchesSince(c, mid);
      await insertSamplePlayer(c);
      for (const g of fakeGames(2)) await saveMatch(c, g.match, g.players);
      assert.equal(await countMatchesSince(c, since), before + 2);
      assert.equal(await countMatchesSince(c, mid), beforeMid + 1);
    });
  });

  it('ranked_players upsert (다시 넣으면 tier·rank 갱신)', async () => {
    await inRollback(async (c) => {
      await upsertRankedPlayers(c, [{ puuid: 'TEST_RP_1', tier: 'PLATINUM', rank: 'IV' }]);
      await upsertRankedPlayers(c, [{ puuid: 'TEST_RP_1', tier: 'EMERALD', rank: 'II' }]);
      const r = await c.query(`SELECT tier, rank FROM ranked_players WHERE puuid = 'TEST_RP_1'`);
      assert.deepEqual(r.rows, [{ tier: 'EMERALD', rank: 'II' }]);
      assert.ok((await countRankedPlayersByTier(c, ['EMERALD'])).get('EMERALD')! >= 1);
    });
  });
});

describe('창 집계 (ROLLBACK)', () => {
  it('2021년 가짜 게임 3개 → ANALYZE + refresh_window_stats(14, 2021-01-15): games 3, patches [{0.9, 3}]', async () => {
    await inRollback(async (c) => {
      const st0 = (await c.query('SHOW statement_timeout')).rows[0].statement_timeout;
      await insertSamplePlayer(c);
      for (const g of fakeGames(3)) await saveMatch(c, g.match, g.players);
      const r = await aggregateWindow(c, { days: 14, until: FAKE_UNTIL }, silentLogger);
      assert.equal(r.ok, true);
      assert.ok(r.analyzeMs >= 0 && r.refreshMs >= 0);
      assert.equal(r.result?.games, 3);
      assert.equal(r.result?.days, 14);
      assert.deepEqual(r.result?.patches, [{ patch: TEST_PATCH, games: 3 }]);
      assert.equal(r.result?.champion_rows, 10);
      assert.ok(Number(r.result?.skill_rows) >= 1);
      const w = await c.query(`SELECT days, window_start, window_end, games FROM stats_window`);
      assert.deepEqual(w.rows, [
        { days: 14, window_start: new Date('2021-01-01T00:00:00Z'), window_end: new Date(FAKE_UNTIL), games: 3 },
      ]);
      const p = await c.query(`SELECT patch, games FROM stats_window_patch`);
      assert.deepEqual(p.rows, [{ patch: TEST_PATCH, games: 3 }]);
      // statement_timeout은 원래대로
      assert.equal((await c.query('SHOW statement_timeout')).rows[0].statement_timeout, st0);
    });
  });

  it('창 안 완료 게임 0개(P0002) → ok:false, stats_window는 호출 전과 같음', async () => {
    await inRollback(async (c) => {
      const before = (await c.query(`SELECT * FROM stats_window`)).rows;
      await c.query('SAVEPOINT agg');
      const r = await aggregateWindow(c, { days: 14, until: '2020-06-01T00:00:00Z' }, silentLogger);
      assert.equal(r.ok, false);
      assert.ok(r.warning);
      await c.query('ROLLBACK TO SAVEPOINT agg'); // 오류로 멈춘 트랜잭션을 되살림
      const after = (await c.query(`SELECT * FROM stats_window`)).rows;
      assert.deepEqual(after, before);
    });
  });

  it('purge 미리보기(읽기만): 2021년 게임 1개는 21일보다 오래된 지울 대상으로 셈. purge_old_games는 실행하지 않음', async () => {
    await inRollback(async (c) => {
      const before = await planPurgeGames(c, 21);
      await insertSamplePlayer(c);
      for (const g of fakeGames(1)) await saveMatch(c, g.match, g.players);
      const after = await planPurgeGames(c, 21);
      assert.equal(after.total, before.total + 1);
      assert.equal(after.remove, before.remove + 1);
      assert.deepEqual(after.oldestStartAt, new Date(FAKE_START_MS + 60_000));
      assert.ok(after.newestRemoveStartAt instanceof Date);
    });
  });
});

describe('스냅숏 (실제 풀)', () => {
  it('readSnapshot 안: transaction_isolation = repeatable read, transaction_read_only = on, 쓰기는 거부', async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: 'tiergg-backend-test' });
    try {
      const r = await readSnapshot(pool, async (q) => ({
        iso: (await q.query<{ transaction_isolation: string }>('SHOW transaction_isolation')).rows[0]?.transaction_isolation,
        ro: (await q.query<{ transaction_read_only: string }>('SHOW transaction_read_only')).rows[0]?.transaction_read_only,
      }));
      assert.deepEqual(r, { iso: 'repeatable read', ro: 'on' });
      await assert.rejects(
        readSnapshot(pool, (q) => q.query(`UPDATE collection_logs SET status = status WHERE false`)),
        (e: { code?: string }) => e.code === '25006',
      );
      // 실패 뒤에도 연결이 정상으로 돌아와 다음 스냅숏이 된다 (ROLLBACK 확인)
      const again = await readSnapshot(pool, async (q) => (await q.query<{ one: number }>('SELECT 1 AS one')).rows[0]?.one);
      assert.equal(again, 1);
    } finally {
      await pool.end();
    }
  });
});

describe('collection_logs (ROLLBACK)', () => {
  it('running → done, lastDoneAt', async () => {
    await inRollback(async (c) => {
      await closeStaleRunning(c);
      const id = await startRun(c);
      assert.equal(typeof id, 'number');
      await finishRun(c, id, { status: 'done', players: 3, matchesSaved: 30, errorMessage: null });
      const r = await c.query(`SELECT status, players, matches_saved, finished_at IS NOT NULL AS fin FROM collection_logs WHERE id = $1`, [id]);
      assert.deepEqual(r.rows[0], { status: 'done', players: 3, matches_saved: 30, fin: true });
      assert.ok((await lastDoneAt(c)) instanceof Date);
    });
  });

  it('error_message는 500자로 자른다', async () => {
    await inRollback(async (c) => {
      const id = await startRun(c);
      await finishRun(c, id, { status: 'failed', players: null, matchesSaved: 0, errorMessage: 'x'.repeat(900) });
      const r = await c.query(`SELECT length(error_message)::int AS n FROM collection_logs WHERE id = $1`, [id]);
      assert.equal(r.rows[0].n, 500);
    });
  });
});

after(async () => {
  // 정리 확인: 테스트 데이터가 하나도 남지 않았는지
  const c = connect();
  await c.connect();
  try {
    const r = await c.query(
      `SELECT (SELECT count(*)::int FROM matches WHERE match_id LIKE 'KR\\_9000000%') AS m,
              (SELECT count(*)::int FROM stats_window_patch WHERE patch IN ('0.8', '0.9')) AS p,
              (SELECT count(*)::int FROM stats_window WHERE window_end < '2022-01-01') AS w,
              (SELECT count(*)::int FROM ranked_players WHERE puuid LIKE 'TEST\\_%') AS rp`,
    );
    assert.deepEqual(r.rows[0], { m: 0, p: 0, w: 0, rp: 0 });
  } finally {
    await c.end();
  }
});
