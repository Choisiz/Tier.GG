// 저장소·집계 호출·수집 기록 (실제 Supabase, 모두 ROLLBACK)
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { aggregateOnConnection, planPurge } from '../../src/collector/aggregate.js';
import { silentLogger } from '../../src/lib/logger.js';
import {
  closeStaleRunning,
  finishRun,
  lastDoneAt,
  startRun,
} from '../../src/repositories/logRepository.js';
import {
  countRankedPlayersByTier,
  existingMatchIds,
  saveMatch,
  upsertRankedPlayers,
} from '../../src/repositories/rawRepository.js';
import { connect, fakeGames, inRollback, insertSamplePlayer, TEST_PATCH, TEST_SAMPLE_PUUID } from '../helpers/db.js';

describe('rawRepository (ROLLBACK)', () => {
  it('fixture 게임 저장 → matches 1줄 + match_players 10줄, 다시 저장하면 duplicate(0줄)', async () => {
    await inRollback(async (c) => {
      await insertSamplePlayer(c);
      const [g] = fakeGames(1);
      assert.ok(g);
      assert.equal(await saveMatch(c, g.match, g.players), 'saved');
      const n = await c.query(`SELECT count(*)::int AS n FROM match_players WHERE match_id = $1`, [g.match.match_id]);
      assert.equal(n.rows[0].n, 10);
      const m = await c.query(`SELECT puuid, patch FROM matches WHERE match_id = $1`, [g.match.match_id]);
      assert.deepEqual(m.rows[0], { puuid: TEST_SAMPLE_PUUID, patch: TEST_PATCH });

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

describe('집계 호출 (ROLLBACK)', () => {
  it('같은 연결에서 ANALYZE → refresh_patch_stats(0.9), 반환 jsonb 확인', async () => {
    await inRollback(async (c) => {
      await insertSamplePlayer(c);
      for (const g of fakeGames(3)) await saveMatch(c, g.match, g.players);
      const r = await aggregateOnConnection(c, [TEST_PATCH], silentLogger);
      assert.ok(r.analyzeMs >= 0);
      assert.equal(r.patches.length, 1);
      const p = r.patches[0]!;
      assert.equal(p.ok, true);
      assert.equal(p.result?.patch, TEST_PATCH);
      assert.equal(p.result?.games, 3);
      assert.equal(p.result?.champion_rows, 10);
      // 스킬은 11자 이상인 줄만: 10명 중 11레벨 이상 찍은 사람 수와 같아야 함
      assert.ok(Number(p.result?.skill_rows) >= 1);
      const t = await c.query(`SELECT games FROM patch WHERE patch = $1`, [TEST_PATCH]);
      assert.equal(t.rows[0].games, 3);
      // statement_timeout은 원래대로
      const st = await c.query('SHOW statement_timeout');
      assert.notEqual(st.rows[0].statement_timeout, '5min');
    });
  });

  it('완료 게임 0개 패치는 경고만 (P0002), 기존 집계 유지', async () => {
    await inRollback(async (c) => {
      const r = await aggregateOnConnection(c, ['0.99'], silentLogger);
      assert.equal(r.patches[0]?.ok, false);
    });
  });

  it('purge 미리보기는 읽기만 (지울 패치 계산)', async () => {
    await inRollback(async (c) => {
      await insertSamplePlayer(c);
      for (const g of fakeGames(1, '0.7')) await saveMatch(c, g.match, g.players);
      const plan = await planPurge(c, 2);
      // 0.7은 가장 오래된 패치이므로, 실제 패치가 2개 이상이면 지울 대상, 아니면 보관
      assert.ok(plan.perPatch.some((p) => p.patch === '0.7'));
      assert.ok(plan.keep.length <= 2);
    });
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
      `SELECT (SELECT count(*)::int FROM matches WHERE patch IN ('0.9', '0.7', '0.99')) AS m,
              (SELECT count(*)::int FROM patch WHERE patch IN ('0.9', '0.7', '0.99')) AS p,
              (SELECT count(*)::int FROM ranked_players WHERE puuid LIKE 'TEST\\_%') AS rp`,
    );
    assert.deepEqual(r.rows[0], { m: 0, p: 0, rp: 0 });
  } finally {
    await c.end();
  }
});
