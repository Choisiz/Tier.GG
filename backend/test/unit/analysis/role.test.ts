// 유형 판정 (feedback_design 7장 예시 챔피언)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  determineRole,
  ROLE_OVERRIDES,
  ROLE_OVERRIDES_PENDING,
  roleByTags,
} from '../../../src/analysis/role.js';
import type { Position, Role } from '../../../src/analysis/types.js';
import { TAGS } from './helpers.js';

const ID = {
  Alistar: 12,
  Ornn: 516,
  Sejuani: 113,
  Zac: 154,
  Galio: 3,
  Darius: 122,
  Sett: 875,
  Warwick: 19,
  Leona: 89,
  Nautilus: 111,
  Thresh: 412,
  Taric: 44,
  Brand: 63,
  Lux: 99,
  Xerath: 101,
  Senna: 235,
  Pyke: 555,
  Lulu: 117,
  Janna: 40,
  Soraka: 16,
  Nami: 267,
  Milio: 902,
  Morgana: 25,
  Karma: 43,
  Rakan: 497,
} as const;

const role = (pos: Position, name: keyof typeof ID): Role => determineRole(pos, ID[name], TAGS);

describe('유형 판정 (7장)', () => {
  it('탑·정글·미드: 첫 태그 Tank면 탱 (알리스타, 오른, 세주아니, 자크, 갈리오)', () => {
    assert.equal(role('TOP', 'Ornn'), 'TOP_TANK');
    assert.equal(role('JUNGLE', 'Sejuani'), 'JUNGLE_TANK');
    assert.equal(role('JUNGLE', 'Zac'), 'JUNGLE_TANK');
    assert.equal(role('MIDDLE', 'Galio'), 'MID_TANK');
    assert.equal(role('JUNGLE', 'Alistar'), 'JUNGLE_TANK');
  });
  it('탑·정글·미드: 파이터 포함 나머지는 딜 (다리우스, 세트, 워윅)', () => {
    assert.equal(role('TOP', 'Darius'), 'TOP_DAMAGE');
    assert.equal(role('TOP', 'Sett'), 'TOP_DAMAGE');
    assert.equal(role('JUNGLE', 'Warwick'), 'JUNGLE_DAMAGE');
    assert.equal(role('MIDDLE', 'Lux'), 'MID_DAMAGE');
  });
  it('원딜은 챔피언과 관계없이 원딜', () => {
    assert.equal(role('BOTTOM', 'Senna'), 'ADC');
    assert.equal(role('BOTTOM', 'Brand'), 'ADC');
  });
  it('탱서폿: 첫 태그 Tank 또는 [Support, Tank] (레오나, 노틸러스, 알리스타, 쓰레쉬, 타릭)', () => {
    for (const n of ['Leona', 'Nautilus', 'Alistar', 'Thresh', 'Taric'] as const) assert.equal(role('UTILITY', n), 'SUPPORT_TANK', n);
  });
  it('딜서폿: 첫 태그 Mage·Marksman·Assassin·Fighter 또는 [Support, Marksman/Assassin] (브랜드, 럭스, 제라스, 세나, 파이크)', () => {
    for (const n of ['Brand', 'Lux', 'Xerath', 'Senna', 'Pyke'] as const) assert.equal(role('UTILITY', n), 'SUPPORT_DAMAGE', n);
  });
  it('유틸서폿: 그 밖 Support 첫 태그 (룰루, 잔나, 소라카, 나미, 밀리오)', () => {
    for (const n of ['Lulu', 'Janna', 'Soraka', 'Nami', 'Milio'] as const) assert.equal(role('UTILITY', n), 'SUPPORT_UTILITY', n);
  });
  it('태그를 모르는 챔피언: 탑·정글·미드 딜, 서폿 유틸', () => {
    assert.equal(roleByTags('TOP', []), 'TOP_DAMAGE');
    assert.equal(roleByTags('UTILITY', []), 'SUPPORT_UTILITY');
  });
});

describe('덮어쓰기 목록 (사용자 승인 2026-11-02)', () => {
  it('카르마 → 유틸서폿, 모르가나 → 딜서폿, 라칸 → 탱서폿 (서폿 자리)', () => {
    assert.equal(ROLE_OVERRIDES.length, 3);
    assert.equal(roleByTags('UTILITY', TAGS.get(ID.Karma)!), 'SUPPORT_DAMAGE', '태그 규칙만이면 딜서폿');
    assert.equal(role('UTILITY', 'Karma'), 'SUPPORT_UTILITY');
    assert.equal(roleByTags('UTILITY', TAGS.get(ID.Morgana)!), 'SUPPORT_UTILITY', '태그 규칙만이면 유틸서폿');
    assert.equal(role('UTILITY', 'Morgana'), 'SUPPORT_DAMAGE');
    assert.equal(roleByTags('UTILITY', TAGS.get(ID.Rakan)!), 'SUPPORT_UTILITY', '태그 규칙만이면 유틸서폿');
    assert.equal(role('UTILITY', 'Rakan'), 'SUPPORT_TANK');
  });
  it('포지션이 다르면 덮어쓰지 않음', () => {
    assert.equal(role('MIDDLE', 'Karma'), 'MID_DAMAGE');
    assert.equal(role('JUNGLE', 'Morgana'), 'JUNGLE_DAMAGE');
  });
  it('세트(서폿)는 보류: 적용하지 않아 태그 규칙대로 딜서폿', () => {
    assert.equal(role('UTILITY', 'Sett'), 'SUPPORT_DAMAGE');
    assert.ok(ROLE_OVERRIDES_PENDING.some((o) => o.championId === ID.Sett));
    assert.equal(determineRole('UTILITY', ID.Sett, TAGS, ROLE_OVERRIDES_PENDING), 'SUPPORT_TANK');
  });
  it('목록의 챔피언 ID가 스냅숏에 있음', () => {
    for (const o of [...ROLE_OVERRIDES, ...ROLE_OVERRIDES_PENDING]) assert.ok(TAGS.has(o.championId), o.champion);
  });
});
