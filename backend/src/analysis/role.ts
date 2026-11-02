// 유형 10개 판정 (feedback_design 7장) + 덮어쓰기 목록
import type { ChampionTags, Position, Role } from './types.js';

export const POSITIONS: readonly Position[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

export function isPosition(v: string): v is Position {
  return (POSITIONS as readonly string[]).includes(v);
}

export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  TOP_TANK: '탱탑',
  TOP_DAMAGE: '딜탑',
  JUNGLE_TANK: '탱정글',
  JUNGLE_DAMAGE: '딜정글',
  MID_TANK: '탱미드',
  MID_DAMAGE: '딜미드',
  ADC: '원딜',
  SUPPORT_TANK: '탱서폿',
  SUPPORT_DAMAGE: '딜서폿',
  SUPPORT_UTILITY: '유틸서폿',
};

export const TANK_ROLES: readonly Role[] = ['TOP_TANK', 'JUNGLE_TANK', 'MID_TANK', 'SUPPORT_TANK'];

export interface RoleOverride {
  championId: number;
  /** 챔피언 영문 id (읽기 쉽게) */
  champion: string;
  position: Position;
  role: Role;
  reason: string;
}

/**
 * 실제로 적용하는 덮어쓰기 (사용자 승인 2026-11-02). 근거는 docs/ai/ai_build.md "유형 덮어쓰기 목록" 표.
 * 바꾸면 ENGINE_VERSION을 올린다.
 */
export const ROLE_OVERRIDES: readonly RoleOverride[] = [
  { championId: 43, champion: 'Karma', position: 'UTILITY', role: 'SUPPORT_UTILITY', reason: '첫 태그 Mage라 딜서폿이지만 실제 딜 비중이 유틸서폿 수준' },
  { championId: 25, champion: 'Morgana', position: 'UTILITY', role: 'SUPPORT_DAMAGE', reason: '[Support, Mage]라 유틸서폿이지만 15분 이후 딜 비중이 딜서폿에 가까움' },
  { championId: 497, champion: 'Rakan', position: 'UTILITY', role: 'SUPPORT_TANK', reason: '[Support]라 유틸서폿이지만 이니시(진입) 역할' },
];

/** 보류한 덮어쓰기 초안 (적용하지 않음). 표본이 늘면 다시 판단 */
export const ROLE_OVERRIDES_PENDING: readonly RoleOverride[] = [
  { championId: 875, champion: 'Sett', position: 'UTILITY', role: 'SUPPORT_TANK', reason: '[Fighter, Tank]라 딜서폿이지만 서폿에서는 탱·이니시 빌드 (표본 1명이라 보류)' },
];

const SUPPORT_DAMAGE_FIRST_TAGS = ['Mage', 'Marksman', 'Assassin', 'Fighter'];

/** Data Dragon 첫 태그 규칙만으로 유형을 정한다 (덮어쓰기 없음) */
export function roleByTags(position: Position, tags: readonly string[]): Role {
  const [first, second] = tags;
  switch (position) {
    case 'BOTTOM':
      return 'ADC';
    case 'UTILITY':
      if (first === 'Tank' || (first === 'Support' && second === 'Tank')) return 'SUPPORT_TANK';
      if (
        (first !== undefined && SUPPORT_DAMAGE_FIRST_TAGS.includes(first)) ||
        (first === 'Support' && (second === 'Marksman' || second === 'Assassin'))
      ) {
        return 'SUPPORT_DAMAGE';
      }
      return 'SUPPORT_UTILITY';
    case 'TOP':
      return first === 'Tank' ? 'TOP_TANK' : 'TOP_DAMAGE';
    case 'JUNGLE':
      return first === 'Tank' ? 'JUNGLE_TANK' : 'JUNGLE_DAMAGE';
    case 'MIDDLE':
      return first === 'Tank' ? 'MID_TANK' : 'MID_DAMAGE';
  }
}

/** 덮어쓰기 → 태그 규칙 순. 태그를 모르는 챔피언은 빈 태그로 본다(탑·정글·미드 딜, 서폿 유틸) */
export function determineRole(
  position: Position,
  championId: number,
  championTags: ChampionTags,
  overrides: readonly RoleOverride[] = ROLE_OVERRIDES,
): Role {
  const o = overrides.find((x) => x.championId === championId && x.position === position);
  if (o) return o.role;
  return roleByTags(position, championTags.get(championId) ?? []);
}

/** Data Dragon champion.json 또는 테스트 스냅숏({champions:[{key,tags}]})에서 태그 표를 만든다 */
export function championTagsFromJson(json: unknown): ChampionTags {
  const out = new Map<number, readonly string[]>();
  const add = (key: unknown, tags: unknown) => {
    const id = typeof key === 'string' ? Number(key) : key;
    if (typeof id === 'number' && Number.isInteger(id) && Array.isArray(tags)) {
      out.set(id, tags.filter((t): t is string => typeof t === 'string'));
    }
  };
  if (json && typeof json === 'object') {
    const o = json as { champions?: unknown; data?: unknown };
    if (Array.isArray(o.champions)) {
      for (const c of o.champions as { key?: unknown; tags?: unknown }[]) add(c.key, c.tags);
    } else if (o.data && typeof o.data === 'object') {
      for (const c of Object.values(o.data as Record<string, { key?: unknown; tags?: unknown }>)) add(c.key, c.tags);
    }
  }
  return out;
}
