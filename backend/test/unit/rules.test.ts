// patchSelection, mainPositions, validate, 표본 도우미, 로그 가리기
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../../src/api/errors.js';
import { mainPositions } from '../../src/api/mainPositions.js';
import { selectPatch } from '../../src/api/patchSelection.js';
import { parseChampionIdParam, parsePatchParam, parsePositionParam } from '../../src/api/validate.js';
import { divisionQuota, buildCollectionConfig } from '../../src/config/collection.js';
import { eligibleEntries, pickRandom, seededRandom } from '../../src/collector/sample.js';
import { sortIdsNewestFirst } from '../../src/collector/matches.js';
import { redact } from '../../src/lib/logger.js';

describe('patchSelection', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof ApiError ? `${e.status} ${e.code}` : 'other';
    }
    return 'none';
  };

  it('패치 0개 → 503 STATS_NOT_READY', () => {
    assert.equal(code(() => selectPatch([], null)), '503 STATS_NOT_READY');
  });

  it('패치 1개 → 그 패치 (표본이 적어도)', () => {
    assert.deepEqual(selectPatch([{ patch: '16.19', games: 30 }], null), {
      data: '16.19',
      latest: '16.19',
      requested: null,
      isFallback: false,
      games: 30,
    });
  });

  it('최신 표본 부족 + 직전이 더 많음 → 직전 패치', () => {
    const s = selectPatch(
      [
        { patch: '16.20', games: 812 },
        { patch: '16.19', games: 2712 },
      ],
      null,
    );
    assert.equal(s.data, '16.19');
    assert.equal(s.latest, '16.20');
    assert.equal(s.isFallback, true);
    assert.equal(s.games, 2712);
  });

  it('직전이 더 적으면 최신', () => {
    const s = selectPatch(
      [
        { patch: '16.20', games: 812 },
        { patch: '16.19', games: 500 },
      ],
      null,
    );
    assert.equal(s.data, '16.20');
    assert.equal(s.isFallback, false);
  });

  it('최신이 5,000 이상이면 최신 (경계 5000)', () => {
    const s = selectPatch(
      [
        { patch: '16.20', games: 5000 },
        { patch: '16.19', games: 25000 },
      ],
      null,
    );
    assert.equal(s.data, '16.20');
  });

  it('patch 지정 → 그대로 (대체 없음), 없으면 404', () => {
    const list = [
      { patch: '16.20', games: 812 },
      { patch: '16.19', games: 2712 },
    ];
    const s = selectPatch(list, '16.20');
    assert.equal(s.data, '16.20');
    assert.equal(s.requested, '16.20');
    assert.equal(s.isFallback, false);
    assert.equal(code(() => selectPatch(list, '16.1')), '404 PATCH_NOT_FOUND');
  });
});

describe('mainPositions', () => {
  it('2순위 9.9% → 1개, 10.0% → 2개', () => {
    assert.deepEqual(
      mainPositions([
        { position: 'TOP', pick: 901 },
        { position: 'MIDDLE', pick: 99 },
      ]),
      ['TOP'],
    );
    assert.deepEqual(
      mainPositions([
        { position: 'TOP', pick: 90 },
        { position: 'MIDDLE', pick: 10 },
      ]),
      ['TOP', 'MIDDLE'],
    );
  });

  it('3순위는 항상 제외', () => {
    assert.deepEqual(
      mainPositions([
        { position: 'TOP', pick: 40 },
        { position: 'MIDDLE', pick: 30 },
        { position: 'JUNGLE', pick: 30 },
      ]),
      ['TOP', 'JUNGLE'],
    );
  });

  it('동률은 포지션 이름 순', () => {
    assert.deepEqual(
      mainPositions([
        { position: 'UTILITY', pick: 5 },
        { position: 'BOTTOM', pick: 5 },
      ]),
      ['BOTTOM', 'UTILITY'],
    );
    assert.deepEqual(mainPositions([]), []);
  });
});

describe('validate', () => {
  it('patch', () => {
    assert.deepEqual(parsePatchParam(undefined), { ok: true, value: null });
    assert.equal(parsePatchParam('16.19').ok, true);
    assert.equal(parsePatchParam('0.9').ok, true);
    for (const bad of ['16', '16.19.1', 'a.b', '16.19 ', '12345.12345', ['16.19']]) {
      assert.equal(parsePatchParam(bad).ok, false, String(bad));
    }
  });

  it('position (대문자 정확히)', () => {
    assert.equal(parsePositionParam('TOP', true).ok, true);
    assert.equal(parsePositionParam('top', true).ok, false);
    assert.equal(parsePositionParam(undefined, true).ok, false);
    assert.deepEqual(parsePositionParam(undefined, false), { ok: true, value: null });
    assert.equal(parsePositionParam(['TOP', 'MIDDLE'], false).ok, false);
  });

  it('championId ^[1-9][0-9]{0,4}$', () => {
    assert.deepEqual(parseChampionIdParam('23'), { ok: true, value: 23 });
    assert.deepEqual(parseChampionIdParam('99999'), { ok: true, value: 99999 });
    for (const bad of ['0', '023', '100000', '-1', 'Aatrox', '1.5', '']) {
      assert.equal(parseChampionIdParam(bad).ok, false, bad);
    }
  });
});

describe('수집 설정·표본', () => {
  it('티어당 50명 → 13/13/12/12', () => {
    assert.deepEqual(divisionQuota(50), { I: 13, II: 13, III: 12, IV: 12 });
    assert.deepEqual(divisionQuota(3), { I: 1, II: 1, III: 1, IV: 0 });
  });

  it('test 프리셋과 덮어쓰기', () => {
    const c = buildCollectionConfig('test');
    assert.deepEqual(c.tiers, ['PLATINUM', 'EMERALD', 'DIAMOND']);
    assert.equal(c.playersPerTier, 50);
    assert.equal(c.gamesPerPlayer, 20);
    assert.equal(c.maxMatchesPerRun, null);
    const o = buildCollectionConfig('test', { tiers: ['emerald'], maxMatches: 30 });
    assert.deepEqual(o.tiers, ['EMERALD']);
    assert.equal(o.maxMatchesPerRun, 30);
    assert.throws(() => buildCollectionConfig('test', { tiers: ['MASTER'] }));
    assert.throws(() => buildCollectionConfig('nope'));
  });

  it('inactive 제외, 요청 티어·디비전만', () => {
    const e = eligibleEntries(
      [
        { puuid: 'a', tier: 'EMERALD', rank: 'I' },
        { puuid: 'b', tier: 'EMERALD', rank: 'I', inactive: true },
        { puuid: 'c', tier: 'DIAMOND', rank: 'I' },
        { puuid: 'd', tier: 'EMERALD', rank: 'II' },
      ],
      'EMERALD',
      'I',
    );
    assert.deepEqual(e.map((x) => x.puuid), ['a']);
  });

  it('같은 시드면 같은 무작위 선택, 중복 없음', () => {
    const items = Array.from({ length: 205 }, (_, i) => i);
    const a = pickRandom(items, 13, seededRandom(42));
    const b = pickRandom(items, 13, seededRandom(42));
    assert.deepEqual(a, b);
    assert.equal(new Set(a).size, 13);
    assert.equal(pickRandom([1, 2], 5, seededRandom(1)).length, 2);
  });

  it('게임 ID 숫자 내림차순', () => {
    assert.deepEqual(sortIdsNewestFirst(['KR_9', 'KR_10', 'KR_8408851980']), ['KR_8408851980', 'KR_10', 'KR_9']);
  });
});

describe('logger 가리기', () => {
  it('DATABASE_URL·비밀번호·호스트·RIOT_API_KEY를 가린다 (잘못된 % 인코딩 포함)', () => {
    const before = { db: process.env.DATABASE_URL, key: process.env.RIOT_API_KEY };
    process.env.DATABASE_URL = 'postgresql://user.abc:p%ZZass@db.example.com:5432/postgres';
    process.env.RIOT_API_KEY = 'RGAPI-11111111-2222-3333-4444-555555555555';
    try {
      const s = redact(
        'fail postgresql://user.abc:p%ZZass@db.example.com:5432/postgres host=db.example.com pw=p%ZZass key=RGAPI-11111111-2222-3333-4444-555555555555',
      );
      assert.ok(!s.includes('p%ZZass') && !s.includes('db.example.com') && !s.includes('RGAPI-1'), s);
    } finally {
      if (before.db === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = before.db;
      if (before.key === undefined) delete process.env.RIOT_API_KEY;
      else process.env.RIOT_API_KEY = before.key;
    }
  });
});
