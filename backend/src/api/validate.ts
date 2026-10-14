// 쿼리·경로 파라미터 검사 (api_contract 2-3, 2-4). 결과 객체를 돌려주고, 라우트가 ApiError로 바꾼다.
import { POSITIONS, type Position } from '../config/api.js';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const PATCH_RE = /^[0-9]+\.[0-9]+$/;
const CHAMPION_ID_RE = /^[1-9][0-9]{0,4}$/;
const POSITION_SET = new Set<string>(POSITIONS);

/** 없으면 null. 배열(같은 이름 반복) 등 문자열이 아니면 오류 */
export function parsePatchParam(v: unknown): Parsed<string | null> {
  if (v === undefined) return { ok: true, value: null };
  if (typeof v !== 'string' || v.length > 10 || !PATCH_RE.test(v)) {
    return { ok: false, message: 'patch는 16.19 같은 형식(숫자.숫자, 10자 이하)이어야 합니다.' };
  }
  return { ok: true, value: v };
}

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
