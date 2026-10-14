import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSkillOrder,
  emptyWarnings,
  parsePatch,
  prefilterMatch,
  transformMatch,
} from '../../src/collector/transform.js';
import { clone, FIXTURE_START_MS, loadMatch, loadTimeline, OPTS } from '../helpers/fixture.js';

describe('transform: 실제 게임 KR_8408851980', () => {
  const r = transformMatch(loadMatch(), loadTimeline(), 'TEST_PUUID_01', OPTS);

  it('matches 1줄(game_start_at 포함) + match_players 10줄, patch 16.19', () => {
    assert.ok(r.ok);
    assert.deepEqual(r.match, {
      match_id: 'KR_8408851980',
      puuid: 'TEST_PUUID_01',
      patch: '16.19',
      game_start_at: new Date('2026-10-06T05:19:50.514Z'),
    });
    assert.equal(r.match.game_start_at.getTime(), 1791263990514);
    assert.equal(r.players.length, 10);
    assert.equal(new Set(r.players.map((p) => p.puuid)).size, 10);
  });

  it('1번 참가자 = 계약 6-3 예시 값', () => {
    assert.ok(r.ok);
    const p = r.players[0];
    assert.deepEqual(p, {
      match_id: 'KR_8408851980',
      puuid: 'TEST_PUUID_01',
      champion_id: 23,
      team_position: 'TOP',
      win: true,
      ban_champion_id: 64,
      summoner1_id: 14,
      summoner2_id: 4,
      primary_style: 8100,
      primary_perk1: 9923,
      primary_perk2: 8143,
      primary_perk3: 8140,
      primary_perk4: 8135,
      sub_style: 8000,
      sub_perk1: 8299,
      sub_perk2: 9104,
      stat_offense: 5008,
      stat_flex: 5008,
      stat_defense: 5011,
      item0: 1018,
      item1: 3074,
      item2: 3006,
      item3: 3046,
      item4: 1036,
      item5: 1036,
      skill_order: 'EQQWQRQEQEREEW',
    });
  });

  it('밴 -1(10번 참가자)은 NULL, 경고 0', () => {
    assert.ok(r.ok);
    assert.equal(r.players[9]?.ban_champion_id, null);
    assert.deepEqual(r.warnings, emptyWarnings());
  });

  it('모든 skill_order는 ^[QWER]*$', () => {
    assert.ok(r.ok);
    for (const p of r.players) assert.match(p.skill_order ?? '', /^[QWER]*$/);
  });
});

describe('transform: 가공 입력', () => {
  it("teamPosition '' → NULL, 이상한 값 → NULL + 경고", () => {
    const m = clone(loadMatch());
    (m.info.participants[0] as { teamPosition: string }).teamPosition = '';
    (m.info.participants[1] as { teamPosition: string }).teamPosition = 'Invalid';
    const r = transformMatch(m, loadTimeline(), null, OPTS);
    assert.ok(r.ok);
    assert.equal(r.players[0]?.team_position, null);
    assert.equal(r.players[1]?.team_position, null);
    assert.equal(r.warnings.badPosition, 1);
  });

  it('짝 없는 밴 → NULL + 경고', () => {
    const m = clone(loadMatch());
    m.info.teams[0]!.bans = m.info.teams[0]!.bans.filter((b) => b.pickTurn !== 2);
    const r = transformMatch(m, loadTimeline(), null, OPTS);
    assert.ok(r.ok);
    assert.equal(r.players[1]?.ban_champion_id, null);
    assert.equal(r.warnings.banUnmatched, 1);
  });

  it('EVOLVE 제외, timestamp 순, skillSlot 1~4 → QWER, 이상한 slot은 버리고 경고', () => {
    const tl = clone(loadTimeline());
    tl.info.frames = [
      {
        events: [
          { type: 'SKILL_LEVEL_UP', timestamp: 300, participantId: 1, skillSlot: 4, levelUpType: 'NORMAL' },
          { type: 'SKILL_LEVEL_UP', timestamp: 100, participantId: 1, skillSlot: 3, levelUpType: 'NORMAL' },
          { type: 'SKILL_LEVEL_UP', timestamp: 150, participantId: 1, skillSlot: 1, levelUpType: 'EVOLVE' },
          { type: 'SKILL_LEVEL_UP', timestamp: 200, participantId: 2, skillSlot: 2, levelUpType: 'NORMAL' },
          { type: 'ITEM_PURCHASED', timestamp: 210, participantId: 1 },
        ],
      },
      {
        events: [
          { type: 'SKILL_LEVEL_UP', timestamp: 200, participantId: 1, skillSlot: 2, levelUpType: 'NORMAL' },
          { type: 'SKILL_LEVEL_UP', timestamp: 200, participantId: 1, skillSlot: 1, levelUpType: 'NORMAL' },
          { type: 'SKILL_LEVEL_UP', timestamp: 400, participantId: 1, skillSlot: 9, levelUpType: 'NORMAL' },
        ],
      },
    ];
    const w = emptyWarnings();
    // 같은 timestamp(200)는 원래 순서 유지: W 다음 Q
    assert.equal(buildSkillOrder(tl, 1, w), 'EWQR');
    assert.equal(w.badSkillSlot, 1);
    assert.equal(buildSkillOrder(tl, 3, emptyWarnings()), null);
  });

  it('타임라인 참가자는 puuid로 잇는다 (번호가 달라도)', () => {
    const tl = clone(loadTimeline());
    // 타임라인 번호를 뒤집어도 puuid로 찾으므로 1번 참가자의 스킬은 타임라인 participantId(=11-1)의 이벤트
    const original = transformMatch(loadMatch(), loadTimeline(), null, OPTS);
    tl.info.participants = tl.info.participants.map((p) => ({ ...p, participantId: 11 - p.participantId }));
    const r = transformMatch(loadMatch(), tl, null, OPTS);
    assert.ok(original.ok && r.ok);
    assert.equal(r.players[0]?.skill_order, original.players[9]?.skill_order);
  });

  it('타임라인에 없는 puuid → bad_format', () => {
    const tl = clone(loadTimeline());
    tl.info.participants[0]!.puuid = 'SOMEONE_ELSE';
    const r = transformMatch(loadMatch(), tl, null, OPTS);
    assert.deepEqual(r.ok ? null : r.reason, 'bad_format');
  });

  it('gameDuration 299 → too_short, 300은 통과', () => {
    const m = clone(loadMatch());
    m.info.gameDuration = 299;
    assert.deepEqual(prefilterMatch(m, OPTS), { ok: false, reason: 'too_short', detail: 'gameDuration=299' });
    m.info.gameDuration = 300;
    assert.equal(prefilterMatch(m, OPTS).ok, true);
  });

  it('queueId 440 → not_solo', () => {
    const m = clone(loadMatch());
    m.info.queueId = 440;
    const r = prefilterMatch(m, OPTS);
    assert.equal(r.ok ? null : r.reason, 'not_solo');
  });

  it('참가자 9명 → not_10_players', () => {
    const m = clone(loadMatch());
    m.info.participants.pop();
    const r = transformMatch(m, loadTimeline(), null, OPTS);
    assert.equal(r.ok ? null : r.reason, 'not_10_players');
  });

  it('룬 개수 오류 → bad_format', () => {
    const m = clone(loadMatch());
    m.info.participants[0]!.perks.styles[0]!.selections.pop();
    const r = transformMatch(m, loadTimeline(), null, OPTS);
    assert.equal(r.ok ? null : r.reason, 'bad_format');
  });

  it('description이 없으면 styles[0]/[1]로', () => {
    const m = clone(loadMatch());
    for (const s of m.info.participants[0]!.perks.styles) delete s.description;
    const r = transformMatch(m, loadTimeline(), null, OPTS);
    assert.ok(r.ok);
    assert.equal(r.players[0]?.primary_style, 8100);
    assert.equal(r.players[0]?.sub_style, 8000);
  });

  it('match_id 형식 오류 → bad_format', () => {
    const m = clone(loadMatch());
    m.metadata.matchId = 'NA1_123';
    const r = prefilterMatch(m, OPTS);
    assert.equal(r.ok ? null : r.reason, 'bad_format');
  });
});

describe('패치', () => {
  it('parsePatch', () => {
    assert.equal(parsePatch('16.19.823.722'), '16.19');
    assert.equal(parsePatch('16.9.1'), '16.9');
    assert.equal(parsePatch('16'), null);
    assert.equal(parsePatch('a.b.c'), null);
    assert.equal(parsePatch(undefined), null);
  });
});

describe('시작 시각 검사 (변경 01-4-2)', () => {
  const withStart = (v: unknown) => {
    const m = clone(loadMatch());
    (m.info as { gameStartTimestamp: unknown }).gameStartTimestamp = v;
    return m;
  };
  const reason = (m: ReturnType<typeof loadMatch>, opts = OPTS) => {
    const r = prefilterMatch(m, opts);
    return r.ok ? 'ok' : r.reason;
  };

  it('없음·문자열·소수·2020-01-01 이전 → bad_format', () => {
    const m = clone(loadMatch());
    delete (m.info as { gameStartTimestamp?: number }).gameStartTimestamp;
    assert.equal(reason(m), 'bad_format');
    assert.equal(reason(withStart('1791263990514')), 'bad_format');
    assert.equal(reason(withStart(1791263990514.5)), 'bad_format');
    const early = { ...OPTS, windowStartMs: 0 };
    assert.equal(reason(withStart(1_577_836_799_999), early), 'bad_format');
    assert.equal(reason(withStart(1_577_836_800_000), early), 'ok');
  });

  it('창 시작 − 1ms → out_of_window, 정확히 창 시작 → 통과', () => {
    const opts = { ...OPTS, windowStartMs: FIXTURE_START_MS };
    assert.equal(reason(withStart(FIXTURE_START_MS - 1), opts), 'out_of_window');
    const r = prefilterMatch(withStart(FIXTURE_START_MS), opts);
    assert.ok(r.ok);
    assert.equal(r.gameStartAt.getTime(), FIXTURE_START_MS);
  });

  it('패치 형식 오류가 시작 시각 검사보다 먼저', () => {
    const m = withStart(1);
    m.info.gameVersion = 'x';
    const r = prefilterMatch(m, OPTS);
    assert.deepEqual(r.ok ? null : r.detail, 'gameVersion=x');
  });

  it('transformMatch도 창 밖이면 out_of_window', () => {
    const r = transformMatch(loadMatch(), loadTimeline(), null, { ...OPTS, windowStartMs: FIXTURE_START_MS + 1 });
    assert.equal(r.ok ? null : r.reason, 'out_of_window');
  });
});
