// 출력 JSON 스키마 2개 (첫 답, 재시도)와 응답 모양 검사 (ai_spec 2-5).
// 스키마는 판마다 바뀌지 않는 고정 모양이다. 길이·개수·과목 일치는 검증기가 본다
// (구조화 출력은 minLength·maxItems 같은 제약을 지원하지 않는다).
import type { FirstAnswer, LlmItem, RetryAnswer } from './verify.js';

const factIds = { type: 'array', items: { type: 'string' } } as const;

const item = {
  type: 'object',
  properties: { subjectId: { type: 'string' }, text: { type: 'string' }, factIds },
  required: ['subjectId', 'text', 'factIds'],
  additionalProperties: false,
} as const;

const goodBad = {
  type: 'object',
  properties: { good: { type: 'array', items: item }, bad: { type: 'array', items: item } },
  required: ['good', 'bad'],
  additionalProperties: false,
} as const;

export const FIRST_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'object',
      properties: { text: { type: 'string' }, factIds },
      required: ['text', 'factIds'],
      additionalProperties: false,
    },
    sections: {
      type: 'object',
      properties: { laning: goodBad, fight: goodBad, macro: goodBad },
      required: ['laning', 'fight', 'macro'],
      additionalProperties: false,
    },
    keyMoments: {
      type: 'array',
      items: {
        type: 'object',
        properties: { index: { type: 'integer' }, text: { type: 'string' }, factIds },
        required: ['index', 'text', 'factIds'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'sections', 'keyMoments'],
  additionalProperties: false,
} as const;

export const RETRY_SCHEMA = {
  type: 'object',
  properties: {
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { slot: { type: 'string' }, text: { type: 'string' }, factIds },
        required: ['slot', 'text', 'factIds'],
        additionalProperties: false,
      },
    },
  },
  required: ['fixes'],
  additionalProperties: false,
} as const;

// ---------- 모양 검사 (스키마를 코드로 한 번 더) ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function asItem(v: unknown): LlmItem | null {
  if (!isObj(v) || typeof v.subjectId !== 'string' || typeof v.text !== 'string' || !isStrArr(v.factIds)) return null;
  return { subjectId: v.subjectId, text: v.text, factIds: v.factIds };
}

function asItems(v: unknown): LlmItem[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map(asItem);
  return out.every((x): x is LlmItem => x !== null) ? out : null;
}

/** JSON 문자열 → 첫 답. 모양이 틀리면 null */
export function parseFirstAnswer(text: string): FirstAnswer | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(v) || !isObj(v.summary) || !isObj(v.sections) || !Array.isArray(v.keyMoments)) return null;
  const s = v.summary;
  if (typeof s.text !== 'string' || !isStrArr(s.factIds)) return null;
  const sections = {} as FirstAnswer['sections'];
  for (const area of ['laning', 'fight', 'macro'] as const) {
    const a = v.sections[area];
    if (!isObj(a)) return null;
    const good = asItems(a.good);
    const bad = asItems(a.bad);
    if (!good || !bad) return null;
    sections[area] = { good, bad };
  }
  const keyMoments: FirstAnswer['keyMoments'] = [];
  for (const k of v.keyMoments) {
    if (!isObj(k) || typeof k.index !== 'number' || !Number.isInteger(k.index) || typeof k.text !== 'string' || !isStrArr(k.factIds)) {
      return null;
    }
    keyMoments.push({ index: k.index, text: k.text, factIds: k.factIds });
  }
  return { summary: { text: s.text, factIds: s.factIds }, sections, keyMoments };
}

/** JSON 문자열 → 재시도 답. 모양이 틀리면 null */
export function parseRetryAnswer(text: string): RetryAnswer | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(v) || !Array.isArray(v.fixes)) return null;
  const fixes: RetryAnswer['fixes'] = [];
  for (const f of v.fixes) {
    if (!isObj(f) || typeof f.slot !== 'string' || typeof f.text !== 'string' || !isStrArr(f.factIds)) return null;
    fixes.push({ slot: f.slot, text: f.text, factIds: f.factIds });
  }
  return { fixes };
}
