// 쿼리·경로 파라미터 검사 (api_contract v2 2-3, 2-4). 대상은 position, championId만 (patch 쿼리는 무시). 결과 객체를 돌려주고, 라우트가 ApiError로 바꾼다.
import { POSITIONS, type Position } from '../config/api.js';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const CHAMPION_ID_RE = /^[1-9][0-9]{0,4}$/;
const POSITION_SET = new Set<string>(POSITIONS);

export function parsePositionParam(v: unknown, required: true): Parsed<Position>;
export function parsePositionParam(v: unknown, required: false): Parsed<Position | null>;
export function parsePositionParam(v: unknown, required: boolean): Parsed<Position | null> {
  if (v === undefined && !required) return { ok: true, value: null };
  if (typeof v !== 'string' || !POSITION_SET.has(v)) {
    return { ok: false, message: `position은 ${POSITIONS.join(', ')} 중 하나여야 합니다.` };
  }
  return { ok: true, value: v as Position };
}

export function parseChampionIdParam(v: unknown): Parsed<number> {
  if (typeof v !== 'string' || !CHAMPION_ID_RE.test(v)) {
    return { ok: false, message: 'championId는 1~99999 숫자여야 합니다 (Data Dragon champion.json의 key).' };
  }
  return { ok: true, value: Number(v) };
}

// 전적 검색 (back_spec 변경 03 W-5, 결정 S1·S2)

/** region 경로 값. RIOT_PLATFORM_URL·RIOT_REGION_URL이 단일 지역(KR/asia)이라 kr만 허용 */
export function parseRegionParam(v: unknown): Parsed<'kr'> {
  if (v !== 'kr') return { ok: false, message: 'region은 kr만 지원합니다.' };
  return { ok: true, value: 'kr' };
}

export interface RiotIdParts {
  gameName: string;
  tagLine: string;
}

const TAG_LINE_RE = /^[0-9A-Za-z]{2,5}$/;

/**
 * riotId 경로 파라미터(`gameName-tagLine`)를 **마지막** '-'에서 자른다.
 * tagLine은 짧은 영숫자로 고정이고 gameName은 공백·하이픈을 포함할 수 있어, 마지막 '-'로 자르면 안전하다.
 */
export function parseRiotIdParam(v: unknown): Parsed<RiotIdParts> {
  if (typeof v !== 'string') {
    return { ok: false, message: 'riotId는 gameName-tagLine 형식이어야 합니다.' };
  }
  const idx = v.lastIndexOf('-');
  if (idx <= 0 || idx === v.length - 1) {
    return { ok: false, message: 'riotId는 gameName-tagLine 형식이어야 합니다.' };
  }
  const gameName = v.slice(0, idx);
  const tagLine = v.slice(idx + 1);
  if (!TAG_LINE_RE.test(tagLine)) {
    return { ok: false, message: 'tagLine은 영숫자 2~5자여야 합니다.' };
  }
  return { ok: true, value: { gameName, tagLine } };
}
