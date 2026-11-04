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

// ---------- RAG 스키마 (B4) ----------
// 조각이 없는 요청은 위 FIRST_SCHEMA·RETRY_SCHEMA를 그대로 써서 Q1과 같은 요청이 된다.
// 첫 답은 칸마다 chunkIds를 넣지 않고 맨 위 chunkUse 하나([{slot, chunkIds}])로 받는다:
// 칸 객체 8곳에 칸을 더했더니 API가 "compiled grammar is too large"(400)로 거절했다 (Build B 실측 2026-11-04).

const chunkIdsField = factIds;

const chunkUse = {
  type: 'array',
  items: {
    type: 'object',
    properties: { slot: { type: 'string' }, chunkIds: chunkIdsField },
    required: ['slot', 'chunkIds'],
    additionalProperties: false,
  },
} as const;

export const FIRST_SCHEMA_RAG = {
  ...FIRST_SCHEMA,
  properties: { ...FIRST_SCHEMA.properties, chunkUse },
  required: [...FIRST_SCHEMA.required, 'chunkUse'],
};

/** 재시도 fix는 한 곳뿐이라 chunkIds를 바로 둔다 */
export const RETRY_SCHEMA_RAG = {
  ...RETRY_SCHEMA,
  properties: {
    fixes: {
      type: 'array',
      items: {
        ...RETRY_SCHEMA.properties.fixes.items,
        properties: { ...RETRY_SCHEMA.properties.fixes.items.properties, chunkIds: chunkIdsField },
        required: [...RETRY_SCHEMA.properties.fixes.items.required, 'chunkIds'],
      },
    },
  },
};

export function firstSchemaFor(withKnowledge: boolean): Record<string, unknown> {
  return (withKnowledge ? FIRST_SCHEMA_RAG : FIRST_SCHEMA) as unknown as Record<string, unknown>;
}

export function retrySchemaFor(withKnowledge: boolean): Record<string, unknown> {
  return (withKnowledge ? RETRY_SCHEMA_RAG : RETRY_SCHEMA) as unknown as Record<string, unknown>;
}

// ---------- 모양 검사 (스키마를 코드로 한 번 더) ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** chunkIds: 없으면 undefined(RAG 꺼짐), 있으면 문자열 배열이어야 한다. 잘못된 모양이면 false */
function chunkIdsOf(v: Record<string, unknown>): { chunkIds?: string[] } | false {
  if (!('chunkIds' in v)) return {};
  return isStrArr(v.chunkIds) ? { chunkIds: v.chunkIds } : false;
}

function asItem(v: unknown): LlmItem | null {
  if (!isObj(v) || typeof v.subjectId !== 'string' || typeof v.text !== 'string' || !isStrArr(v.factIds)) return null;
  const c = chunkIdsOf(v);
  if (c === false) return null;
  return { subjectId: v.subjectId, text: v.text, factIds: v.factIds, ...c };
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
  const sc = chunkIdsOf(s);
  if (sc === false) return null;
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
    const kc = chunkIdsOf(k);
    if (kc === false) return null;
    keyMoments.push({ index: k.index, text: k.text, factIds: k.factIds, ...kc });
  }
  let use: FirstAnswer['chunkUse'];
  if ('chunkUse' in v) {
    if (!Array.isArray(v.chunkUse)) return null;
    use = [];
    for (const u of v.chunkUse) {
      if (!isObj(u) || typeof u.slot !== 'string' || !isStrArr(u.chunkIds)) return null;
      use.push({ slot: u.slot, chunkIds: u.chunkIds });
    }
  }
  return { summary: { text: s.text, factIds: s.factIds, ...sc }, sections, keyMoments, ...(use ? { chunkUse: use } : {}) };
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
    const fc = chunkIdsOf(f);
    if (fc === false) return null;
    fixes.push({ slot: f.slot, text: f.text, factIds: f.factIds, ...fc });
  }
  return { fixes };
}
