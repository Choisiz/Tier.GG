// mainPositions, validate, 수집 설정·표본 도우미, 로그 가리기
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mainPositions } from '../../src/api/mainPositions.js';
import { parseChampionIdParam, parseMatchIdsParam, parsePositionParam, parsePuuidParam, parseRegionParam, parseRiotIdParam } from '../../src/api/validate.js';
import { divisionQuota, buildCollectionConfig, windowStart } from '../../src/config/collection.js';
import { eligibleEntries, pickRandom, seededRandom } from '../../src/collector/sample.js';
import { sortIdsNewestFirst } from '../../src/collector/matches.js';
import { redact } from '../../src/lib/logger.js';

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

  it('region은 kr만 허용 (변경 03, 결정 S1)', () => {
    assert.deepEqual(parseRegionParam('kr'), { ok: true, value: 'kr' });
    for (const bad of ['KR', 'na', 'asia', '', undefined]) {
      assert.equal(parseRegionParam(bad).ok, false, String(bad));
    }
  });

  it('riotId는 마지막 "-"에서 gameName/tagLine으로 자른다 (변경 03, 결정 S2)', () => {
    assert.deepEqual(parseRiotIdParam('너희는개다-KR1'), { ok: true, value: { gameName: '너희는개다', tagLine: 'KR1' } });
    // gameName에 '-'가 있어도 마지막 '-'에서 자른다
    assert.deepEqual(parseRiotIdParam('Hide-on-bush-KR1'), { ok: true, value: { gameName: 'Hide-on-bush', tagLine: 'KR1' } });
    assert.deepEqual(parseRiotIdParam('a-12'), { ok: true, value: { gameName: 'a', tagLine: '12' } });
    assert.deepEqual(parseRiotIdParam('a-abcde'), { ok: true, value: { gameName: 'a', tagLine: 'abcde' } });
    for (const bad of ['noDash', '-KR1', 'name-', 'name-abcdef', 'name-a', 'name-한글1', 123]) {
      assert.equal(parseRiotIdParam(bad).ok, false, String(bad));
    }
  });
});

describe('lane-gold 입력 검사 (변경 04)', () => {
  it('puuid: 영숫자·-·_ 1~100자', () => {
    assert.equal(parsePuuidParam('abc-DEF_123').ok, true);
    assert.equal(parsePuuidParam('a'.repeat(100)).ok, true);
    for (const bad of ['', 'a'.repeat(101), 'a/b', 'a b', 'a%b', undefined, ['a']]) assert.equal(parsePuuidParam(bad).ok, false, String(bad));
  });

  it('matchIds: KR_숫자 1~10개, 쉼표 구분', () => {
    assert.deepEqual(parseMatchIdsParam('KR_1,KR_8437852704'), { ok: true, value: ['KR_1', 'KR_8437852704'] });
    assert.equal(parseMatchIdsParam(Array.from({ length: 10 }, (_, i) => `KR_${i}`).join(',')).ok, true);
    assert.equal(parseMatchIdsParam(Array.from({ length: 11 }, (_, i) => `KR_${i}`).join(',')).ok, false);
    for (const bad of ['', 'KR_', 'kr_1', 'KR_1,', ',KR_1', 'KR_1,,KR_2', 'KR_1 ', 'KR_1/../x', 'KR_1234567890123456', ['KR_1']]) {
      assert.equal(parseMatchIdsParam(bad).ok, false, String(bad));
    }
  });
});

describe('수집 설정·표본', () => {
  it('티어당 100명 → 25/25/25/25, 50명 → 13/13/12/12', () => {
    assert.deepEqual(divisionQuota(100), { I: 25, II: 25, III: 25, IV: 25 });
    assert.deepEqual(divisionQuota(50), { I: 13, II: 13, III: 12, IV: 12 });
    assert.deepEqual(divisionQuota(3), { I: 1, II: 1, III: 1, IV: 0 });
  });

  it('표본 보충: have=180, playersPerTier=250 → 모자란 70명 (02-2)', () => {
    const q = divisionQuota(Math.max(0, 250 - 180));
    assert.equal(q.I + q.II + q.III + q.IV, 70);
  });

  it('test 프리셋과 덮어쓰기', () => {
    const c = buildCollectionConfig('test');
    assert.deepEqual(c.tiers, ['PLATINUM', 'EMERALD', 'DIAMOND']);
    assert.equal(c.playersPerTier, 250);
    assert.equal(c.gamesPerPlayer, 20);
    assert.equal(c.maxMatchesPerRun, null);
    assert.equal(c.windowDays, 14);
    assert.equal(c.maxGamesPerWindow, 25_000);
    assert.equal(c.keepDays, 21);
    assert.ok(!('keepPatches' in c) && !('maxGamesPerPatch' in c));
    const o = buildCollectionConfig('test', { tiers: ['emerald'], maxMatches: 30 });
    assert.deepEqual(o.tiers, ['EMERALD']);
    assert.equal(o.maxMatchesPerRun, 30);
    assert.throws(() => buildCollectionConfig('test', { tiers: ['MASTER'] }));
    assert.throws(() => buildCollectionConfig('nope'));
  });

  it('windowStart: 2026-10-15T01:00:00Z − 14일 → sec 1790816400, ms 끝 3자리 버림', () => {
    const now = Date.parse('2026-10-15T01:00:00Z');
    assert.deepEqual(windowStart(now, 14), { ms: now - 14 * 86_400_000, sec: 1790816400 });
    const w = windowStart(now + 999, 14);
    assert.equal(w.sec, 1790816400);
    assert.equal(w.ms, now + 999 - 14 * 86_400_000);
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
