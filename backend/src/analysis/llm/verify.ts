// 검증기 (ai_spec 2-6): 문장마다 모양·방향·숫자·금지어·길이·이름을 검사한다.
// 판단은 코드가 한다. LLM 문장의 숫자는 그 문장의 factIds가 가리키는 fact의 표기(또는 어림 규칙)와만 대조한다.
import { isPraise } from '../praise.js';
import { isReversed, LANE_INVOLVE_IDS, TIME_UNIT, type Fact, type FactSheet, type Slot, type SlotRule } from './facts.js';
import {
  ADVICE_SENTENCE,
  allowedUnitWords,
  FIRST_DEATH_SENTENCES,
  R4_ME_STEMS,
  AREAS,
  DEATH_CLAUSE,
  DIRECTION_WORDS,
  ESTIMATE_ENDING,
  FORBIDDEN_PATTERNS,
  LANING_CELL_WORDS,
  INTERPRETIVE_WORDS,
  NUMBER_NAME_PATTERNS,
  PRAISE_WORDS,
  RULE_EXEMPT_PATTERNS,
  REVERSAL_WORDS,
  SUBJECT_EXEMPT_PATTERNS,
  SUBJECT_DIRECTION_WORDS,
  SWING_WORDS,
  UNIT_WORD_RE,
  VERDICT_OPPOSITE,
  VERDICT_WORDS,
  type Area,
} from './labels.js';
import type { KeyMoment, LaningCell } from '../types.js';

export type VerifyRule = 'shape' | 'direction' | 'number' | 'forbidden' | 'length' | 'name';

export interface VerifyFailure {
  slot: string;
  rule: VerifyRule;
  detail: string;
}

export interface SlotText {
  text: string;
  factIds: string[];
  /** RAG 조각을 준 요청에서만: 이 문장에 반영한 조각 ID (B4) */
  chunkIds?: string[];
}

// Q2: 좋은 점·부족한 점 칸은 "결과 + 장면 + 조언"을 담도록 2문장 120자 → 3문장 170자
export const LIMITS = {
  itemChars: 170,
  itemSentences: 3,
  summaryChars: 200,
  summarySentences: 2,
} as const;

// ---------- 숫자 뽑기 ----------

export interface NumberToken {
  raw: string;
  value: number;
  /** 약/정도 = about, 넘게/이상/남짓 = over, 가까이/미만/이하 = under */
  approx: 'about' | 'over' | 'under' | null;
  /** 숫자 바로 뒤 단위어 (골드·킬·데스·CS·개·번·분·%p 등). 없으면 null */
  unit: string | null;
  /** 게임 시각 "분:초" 표기면 true (value = 초) */
  time?: boolean;
}

/** 게임 시각 "m:ss" (Q3). 앞뒤가 숫자가 아니어야 한다 */
const TIME_RE = /(?<![\d.:])(\d{1,2}):([0-5]\d)(?![\d:])/g;

const KOREAN_NUM: Readonly<Record<string, number>> = {
  한: 1,
  두: 2,
  세: 3,
  네: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
};
const KOREAN_UNIT = '(번|명|개|킬|데스|차례|회|판|마리)';
const KOREAN_RE = new RegExp(`(^|[^가-힣])(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\\s*${KOREAN_UNIT}(?!째)(도)?`, 'g');
const NUMBER_RE = /(약\s*)?([-−])?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s*(?:넘게|이상|남짓|가까이|미만|이하|정도))?/g;

/** 문장에서 숫자를 모두 뽑는다 (쉼표·소수·부호·어림 표현·한글 수사+단위). 이름 속 숫자("1차 포탑")는 뺀다 */
export function extractNumbers(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  // 시각 "15:06"을 먼저 하나의 값(초)으로 읽고 지운다 ("1:1" 같은 이름 패턴보다 먼저)
  let t = text.replace(TIME_RE, (m, mm: string, ss: string) => {
    out.push({ raw: m, value: Number(mm) * 60 + Number(ss), approx: null, unit: null, time: true });
    return ' '.repeat(m.length);
  });
  for (const re of NUMBER_NAME_PATTERNS) t = t.replace(new RegExp(re.source, 'g'), (m) => ' '.repeat(m.length));
  for (const m of t.matchAll(NUMBER_RE)) {
    const idx = m.index ?? 0;
    const sign = m[2];
    // "15-20" 같은 범위의 '-'는 부호가 아니다
    const prev = sign ? t[idx + (m[1]?.length ?? 0) - 1] : undefined;
    const negative = !!sign && !(prev !== undefined && /\d/.test(prev));
    const value = Number(m[3]!.replace(/,/g, '') + (m[4] ?? '')) * (negative ? -1 : 1);
    const word = m[5]?.trim();
    const approx = m[1] || word === '정도' ? 'about' : word && ['넘게', '이상', '남짓'].includes(word) ? 'over' : word ? 'under' : null;
    // 단위는 숫자(소수 포함) 바로 뒤에서 읽는다 ("약 3,900골드 넘게"의 골드)
    const end = idx + (m[1]?.length ?? 0) + (m[2]?.length ?? 0) + m[3]!.length + (m[4]?.length ?? 0);
    out.push({ raw: m[0].trim(), value, approx, unit: unitWord(t.slice(end)) });
  }
  for (const m of t.matchAll(KOREAN_RE)) {
    const n = m[4] === '도' && m[2] === '한' ? 0 : KOREAN_NUM[m[2]!]!;
    out.push({ raw: m[0].trim(), value: n, approx: null, unit: unitWord(m[3]!) });
  }
  return out;
}

/** 문자열 맨 앞의 단위어 (공백 1칸까지 허용). CS는 대문자로 맞춘다 */
function unitWord(rest: string): string | null {
  const u = UNIT_WORD_RE.exec(rest)?.[1];
  return u ? (u === 'cs' ? 'CS' : u) : null;
}

function displayValues(f: Fact): number[] {
  return f.display.map((d) => Number(d.replace(/,/g, ''))).filter((n) => Number.isFinite(n));
}

/** 숫자 하나가 fact 하나의 표기·어림 규칙과 맞는지 */
export function numberMatchesFact(tok: NumberToken, f: Fact): boolean {
  if (typeof f.value !== 'number') return false;
  // 시각은 시각 fact와만, 초 단위로 같아야 한다 (표기 "분:초")
  if (tok.time || f.unit === TIME_UNIT) return !!tok.time && f.unit === TIME_UNIT && tok.value === f.value;
  const exact = displayValues(f).some((d) => Math.abs(d - tok.value) < 1e-9);
  const step = f.approx?.step;
  if (tok.approx === null) return exact;
  if (!step) return false; // 어림 표현은 approx가 있는 fact만
  const v = f.value;
  if (tok.approx === 'about') return exact || Math.round(v / step) * step === tok.value;
  if (tok.approx === 'over') return v > tok.value && v - tok.value <= step;
  return v < tok.value && tok.value - v <= step;
}

// ---------- 칸 하나 검사 ----------

const hasAny = (text: string, words: readonly string[]) => words.some((w) => text.includes(w));

/** 결정적 장면 방향 검사: 역전이면 벌어/좁혀 둘 다 금지, 아니면 반대 방향 금지. 우리 팀 손익(이득/손해)이 반대면 실패 */
function keyMomentDirection(km: KeyMoment, text: string, requireWord: boolean): string[] {
  const out: string[] = [];
  if (isReversed(km.goldDiffBefore, km.goldDiffAfter)) {
    if (requireWord && !hasAny(text, REVERSAL_WORDS)) out.push(`앞선 팀이 바뀐 장면인데 바뀜을 뜻하는 말(${REVERSAL_WORDS.join('/')})이 없음`);
    const w = [...DIRECTION_WORDS.widened, ...DIRECTION_WORDS.narrowed].find((x) => text.includes(x));
    if (w) out.push(`앞선 팀이 바뀐 장면에는 격차가 벌어졌다/좁혀졌다고 쓰지 않음: "${w}" (우리 팀 기준 골드 변화 swingAbs로 쓴다)`);
  } else {
    const opp = km.direction === 'widened' ? 'narrowed' : 'widened';
    if (requireWord && !hasAny(text, DIRECTION_WORDS[km.direction])) out.push(`격차 방향 단어(${DIRECTION_WORDS[km.direction].join('/')})가 없음`);
    const w = DIRECTION_WORDS[opp].find((x) => text.includes(x));
    if (w) out.push(`격차가 ${km.direction === 'widened' ? '벌어졌는데' : '좁혀졌는데'} "${w}"`);
  }
  if (km.swing !== 0) {
    const wrong = SWING_WORDS[km.swing > 0 ? 'loss' : 'gain'].find((x) => text.includes(x));
    if (wrong) out.push(`우리 팀 골드가 ${km.swing > 0 ? '늘었는데' : '줄었는데'} "${wrong}"`);
  }
  return out;
}

/** 좋은 점 칸에 부족 방향 단어, 부족한 점 칸에 좋음 방향 단어가 있는지 */
function subjectDirection(subjectId: string, kind: 'good' | 'bad', text: string): string | null {
  const words = SUBJECT_DIRECTION_WORDS[subjectId];
  if (!words) return null;
  // 데스가 주인공이 아닌 과목은 "데스가 많았" 같은 구절을 빼고 본다
  const t = subjectId === 'macro.solo' ? text : text.replace(DEATH_CLAUSE, ' ');
  const wrong = (kind === 'good' ? words.bad : words.good).find((w) => t.includes(w));
  return wrong ? `${kind === 'good' ? '좋은 점' : '부족한 점'} 칸에 반대 방향 단어 "${wrong}"` : null;
}

/**
 * Q4 라인전 성장 칸 방향: 판정은 칸(골드·레벨 앞섬/같음/뒤짐)이라 좋은 점/부족한 점 칸 단어 대신 골드·레벨 각각의 방향을 본다.
 * 절(쉼표·"~지만"·"~고 "·"~며 ")마다 주어가 골드("골드가/는/도")나 레벨("레벨이/은/도") 하나뿐이면, 그 방향과 반대인 말이 있는지 본다.
 * 골드 "같음"(작은 차이)은 많다/적다 모두 사실일 수 있어 보지 않고, 레벨 같음은 앞섰다/뒤졌다 모두 틀린 말이다.
 */
const GROWTH_UP = ['많았', '앞섰', '앞서', '높았'];
const GROWTH_DOWN = ['적었', '뒤졌', '뒤처', '낮았', '밀렸'];
export function growthDirection(cell: LaningCell, text: string): string | null {
  const clauses = text.replace(DEATH_CLAUSE, ' ').split(/[.,]|(?<=지만)|(?<=고)\s|(?<=며)\s/);
  for (const c of clauses) {
    const gold = /골드[가는도]/.test(c);
    const level = /레벨[이은도]/.test(c);
    if (gold === level) continue;
    const trend = gold ? cell.gold : cell.level;
    const what = gold ? '골드' : '레벨';
    if (trend === 'EVEN' && gold) continue;
    const wrong = trend === 'AHEAD' ? GROWTH_DOWN : trend === 'BEHIND' ? GROWTH_UP : [...GROWTH_UP, ...GROWTH_DOWN];
    const w = wrong.find((x) => c.includes(x));
    if (w) return `라인전 ${what}는 ${trend === 'AHEAD' ? '앞섰는데' : trend === 'BEHIND' ? '뒤졌는데' : '같았는데'} "${w}"`;
  }
  return null;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|(?<=[다요])\.(?!\d)/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/[.!?。\s]/g, '').length > 0);
}

export function sentenceCount(text: string): number {
  return splitSentences(text).length;
}

const PARTICLE_AFTER =
  /^(?:$|[^가-힣]|은|는|이|가|을|를|의|와|과|도|로|으로|에게|에서|한테|보다|처럼|까지|만|께|랑|이랑)/;

/** 문장에 나온 챔피언 이름 (이름 뒤가 끝·비한글·조사일 때만 이름으로 본다) */
export function findChampionNames(text: string, allNames: readonly string[]): string[] {
  const found: string[] = [];
  for (const name of allNames) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(name, from);
      if (i < 0) break;
      const before = i === 0 ? '' : text[i - 1]!;
      const after = text.slice(i + name.length);
      if ((before === '' || !/[가-힣]/.test(before)) && PARTICLE_AFTER.test(after)) {
        found.push(name);
        break;
      }
      from = i + 1;
    }
  }
  // 긴 이름 안의 짧은 이름(예: "리 신" 속 "신")은 하나로 본다
  return found.filter((n) => !found.some((m) => m !== n && m.includes(n)));
}

export interface VerifyContext {
  sheet: FactSheet;
  /** Data Dragon 챔피언 한국어 이름 전체 */
  allChampionNames: readonly string[];
  /** 프롬프트에 준 RAG 조각 ID. 없으면(RAG 꺼짐) chunkIds를 쓰면 안 된다 */
  knowledgeIds?: ReadonlySet<string>;
}

/** 장면 fact가 문장에 나왔나: 시각은 "분:초", 오브젝트·지역은 괄호 설명을 뺀 이름. 횟수 같은 숫자 값·그 밖의 글자 값은 장면을 짚은 것으로 보지 않는다 */
export function citesScene(f: Fact, text: string): boolean {
  if (f.unit === TIME_UNIT) return citesFact(f, text);
  if (typeof f.value === 'string' && /\.(objective|region)$/.test(f.id)) return citesFact(f, text);
  return false;
}

/**
 * fact 값이 문장에 나왔나 (Q3 조언 근거 인용). 시각·숫자는 문장에서 뽑은 숫자 중 이 fact와 맞는 것이 있어야 하고,
 * 글자 값은 괄호 설명을 뺀 값(또는 "~(탱커)"처럼 괄호 앞부분)이 문장에 있어야 한다.
 */
export function citesFact(f: Fact, text: string): boolean {
  if (typeof f.value === 'number') return extractNumbers(text).some((tok) => numberMatchesFact(tok, f));
  const name = f.value.replace(/\(.*?\)/g, '').trim();
  return name.length > 0 && text.includes(name);
}

/** 조언 문장인가 (Q3): "다음 판", 명령형 "~세요"·"~라", "신경 써" */
export function isAdviceSentence(sentence: string): boolean {
  return ADVICE_SENTENCE.some((re) => re.test(sentence));
}

/** Q5(A2·A3) 정해진 조언 말의 어간: "다음 판에는 CS에 신경 쓰세요" → "CS에 신경 쓰" (쓰세요·쓰고 모두 허용) */
export const actionStem = (action: string): string => action.replace(/^다음\s*판에는\s*/, '').replace(/세요[.!]?$/, '');

/** 규칙의 근거 fact를 모두 factIds에 적고 문장에 썼나. Q5: 정해진 조언 말(actionText)이 있으면 그 말도 있어야 한다 */
function citesRule(r: SlotRule, st: SlotText, sheet: FactSheet, text: string): string[] {
  const missing: string[] = [];
  for (const id of r.required) {
    const f = sheet.byId.get(id);
    if (!f || !st.factIds.includes(id) || !citesFact(f, text)) missing.push(id);
  }
  if (r.actionText && !text.includes(actionStem(r.actionText))) missing.push(`조언 "${r.actionText}"`);
  return missing;
}

export function verifySlot(slot: Slot, st: SlotText, ctx: VerifyContext): VerifyFailure[] {
  const fails: VerifyFailure[] = [];
  const add = (rule: VerifyRule, detail: string) => fails.push({ slot: slot.slot, rule, detail });
  const { sheet } = ctx;
  const text = st.text.trim();

  // 1. 모양: 빈 문장, 없는 fact ID, 이 칸에서 쓸 수 없는 fact ID
  if (text.length === 0) add('shape', '빈 문장');
  const allowed = new Set(slot.factIds);
  for (const id of st.factIds) {
    if (!sheet.byId.has(id)) add('shape', `없는 fact ID: ${id}`);
    else if (!allowed.has(id)) add('shape', `이 칸에서 쓸 수 없는 fact ID: ${id}`);
  }
  // 1-1. 조각 ID: 프롬프트에 준 조각 안에서만 (B4)
  for (const id of st.chunkIds ?? []) {
    if (!ctx.knowledgeIds) add('shape', `조각을 주지 않았는데 chunkIds가 있음: ${id}`);
    else if (!ctx.knowledgeIds.has(id)) add('shape', `준 적 없는 조각 ID: ${id}`);
  }

  // 2. 방향
  if (slot.area === 'summary') {
    const v = sheet.result.summary;
    // Q4: 라인전은 2-1 칸(cell)마다 판정어·반대 방향 말이 다르다 (요약 방향 v.laning은 칸에서 정해진다)
    const cell = sheet.result.laning?.cell ?? null;
    const verdicts = [cell ? null : v.laning, v.fight, v.macro].filter((x): x is NonNullable<typeof x> => x !== null);
    const otherWords = verdicts.flatMap((x) => VERDICT_WORDS[x]);
    if (cell) {
      const cw = LANING_CELL_WORDS[cell.id];
      if (!hasAny(text, cw.words)) add('direction', `요약에 라인전 판정 "${cell.label}"을 뜻하는 말(${cw.words.join('/')})이 없음`);
      const w = cw.opposite.find((x) => text.includes(x) && !otherWords.some((o) => o.includes(x) || x.includes(o)));
      if (w) add('direction', `요약에 라인전 반대 방향 단어 "${w}" (판정 ${cell.label})`);
    }
    for (const verdict of verdicts) {
      if (!hasAny(text, VERDICT_WORDS[verdict])) add('direction', `요약에 판정어 "${verdict}"(또는 동의어)가 없음`);
      for (const opp of VERDICT_OPPOSITE[verdict]) {
        if (verdicts.includes(opp)) continue; // 다른 영역의 판정어일 수 있음
        const w = VERDICT_WORDS[opp].find((x) => text.includes(x));
        if (w) add('direction', `요약에 반대 방향 단어 "${w}" (판정 ${verdict})`);
      }
    }
    if (v.keyMomentIndex !== null) {
      const km = sheet.result.keyMoments[v.keyMomentIndex];
      if (km) for (const d of keyMomentDirection(km, text, false)) add('direction', `결정적 장면: ${d}`);
    }
  } else if (slot.area === 'keyMoment' && slot.index !== null) {
    const km = sheet.result.keyMoments[slot.index];
    if (km) for (const d of keyMomentDirection(km, text, true)) add('direction', d);
  } else if (slot.subjectId === 'laning.growth' && sheet.result.laning) {
    const d = growthDirection(sheet.result.laning.cell, text);
    if (d) add('direction', d);
  } else if (slot.kind !== null && slot.subjectId !== null) {
    const d = subjectDirection(slot.subjectId, slot.kind, text);
    if (d) add('direction', d);
  }

  // 3. 숫자 (값 + 단위: 숫자 바로 뒤 단위어가 있으면 맞은 fact 중 하나는 그 단위를 허용해야 한다)
  const facts = st.factIds.map((id) => sheet.byId.get(id)).filter((f): f is Fact => f !== undefined);
  for (const tok of extractNumbers(text)) {
    const matched = facts.filter((f) => numberMatchesFact(tok, f));
    if (tok.unit === '분' && !Number.isInteger(tok.value)) {
      // Q5(C4): "21.03분" 같은 소수 분 표기 금지 (시각은 분:초, 시간 길이는 "약 N분")
      add('number', `"${tok.raw}분": 분은 소수로 쓰지 않는다 (시각은 "분:초", 시간 길이는 "약 N분")`);
      continue;
    }
    if (matched.length === 0) {
      const near = facts.filter((f) => typeof f.value === 'number').map((f) => `${f.id}=${f.display[0]}`);
      add('number', `"${tok.raw}"가 이 문장의 factIds 값과 맞지 않음${near.length ? ` (쓸 수 있는 값: ${near.slice(0, 6).join(', ')})` : ' (factIds에 숫자 fact 없음)'}`);
    } else if (tok.unit !== null && !matched.some((f) => allowedUnitWords(f.id, f.unit).includes(tok.unit!))) {
      const can = matched.map((f) => `${f.id}(${allowedUnitWords(f.id, f.unit).join('·') || '단위어 없음'})`).join(', ');
      add('number', `단위: "${tok.raw}" 뒤 "${tok.unit}"는 이 값의 fact가 허용하지 않음 — ${can}`);
    }
  }

  // 4. 금지어·해석어 (Q3: 발동한 규칙의 근거를 말할 때만 "반영 비율"(R1)·"득실 점수"(R1·R2·R3)를 허용)
  // Q7: 득실 과목 칸은 두 팀 점수("363점")를 쓴다
  const exempt = new Set([...slot.rules.flatMap((r) => RULE_EXEMPT_PATTERNS[r.id] ?? []), ...((slot.subjectId && SUBJECT_EXEMPT_PATTERNS[slot.subjectId]) || [])]);
  for (const { re, why } of FORBIDDEN_PATTERNS) if (!exempt.has(re) && re.test(text)) add('forbidden', why);
  // Q6: 칭찬 규칙의 칭찬 말(P1 "캐리")은 데이터가 정한 칭찬이라 해석어 검사에서 뺀다 (근거 인용은 4-5가 본다)
  const praiseRules = slot.rules.filter((r) => isPraise(r.id));
  const praiseOk = new Set(praiseRules.flatMap((r) => PRAISE_WORDS[r.id] ?? []));
  const interp = INTERPRETIVE_WORDS.find((w) => text.includes(w) && !praiseOk.has(w));
  if (interp && !text.includes(ESTIMATE_ENDING)) add('forbidden', `해석어 "${interp}"는 "~것으로 보입니다"로 끝맺어야 함`);
  // 4-0. 추정 fact (Q4): 추정 값(1분 단위 딜·받은 피해·CC, 다이브, 6레벨 차이 등)을 쓴 문장은 그 문장 안에서 "~로 보입니다"로 끝맺는다
  for (const sentence of splitSentences(text)) {
    if (sentence.includes(ESTIMATE_ENDING)) continue;
    const est = facts.find((f) => f.estimate && citesFact(f, sentence));
    if (est) add('forbidden', `추정 값 ${est.id}("${est.display[0]}")를 쓴 문장은 "~로 보입니다"로 끝맺어야 함`);
  }
  // 4-1. 조언 규칙 (Q3, Q2의 "장면 없는 조언" 검사를 대체): 조언 문장("다음 판", 명령형, "신경 써")은
  //      이 칸에서 행동 조언 규칙(R1·R2·R3·R5)이 발동했을 때만 쓸 수 있고, 그 규칙의 근거 fact를 factIds에 적고 칸 문장에 써야 한다.
  //      규칙이 없는 칸(라인전·좋은 점·요약·결정적 장면 등)의 조언은 실패 → 재시도 → 템플릿(조언 없음).
  const actionRules = slot.rules.filter((r) => r.action);
  if (splitSentences(text).some(isAdviceSentence)) {
    if (actionRules.length === 0) {
      add('forbidden', `근거 없는 조언: 이 칸에는 발동한 조언 규칙이 없어 "다음 판"·"~하세요" 같은 조언을 쓸 수 없음${slot.rules.length ? ` (발동 규칙 ${slot.rules.map((r) => r.id).join(', ')}은 해석 문장만)` : ''}`);
    } else {
      const misses = actionRules.map((r) => ({ r, miss: citesRule(r, st, sheet, text) }));
      if (!misses.some((m) => m.miss.length === 0)) {
        add('forbidden', `조언 근거 미인용: 발동한 규칙의 근거 fact를 factIds에 적고 문장에 써야 함 — ${misses.map((m) => `${m.r.id}(${m.miss.join(', ')})`).join(' / ')}`);
      }
    }
  }
  // 4-2. 첫 데스 해석(5-4-1) 문장은 R4가 발동한 칸에서 그 규칙의 문장 그대로만
  const r4 = slot.rules.find((r) => r.id === 'R4');
  for (const sentence of FIRST_DEATH_SENTENCES) {
    if (!text.includes(sentence.stem)) continue;
    if (!r4) add('forbidden', `첫 데스 해석 "${sentence.stem}"은 R4가 발동한 칸에서만 쓴다`);
    else if (!text.includes(r4.text ?? '') || sentence.full !== r4.text) add('forbidden', `첫 데스 해석은 이 칸의 R4 문장 "${r4.text}" 그대로만 쓴다`);
  }
  for (const stem of R4_ME_STEMS) {
    if (!text.includes(stem)) continue;
    if (!r4) add('forbidden', `"${stem}" 문장은 R4가 발동한 칸에서만 쓴다`);
    else if (!slot.rules.some((r) => r.id === 'R4' && text.includes(r.text ?? ''))) add('forbidden', `내 역할 문장은 이 칸의 R4 문장 "${r4.text}" 그대로만 쓴다`);
  }

  // 4-3. Q5 B: 합친 규칙(merged)은 반드시 말한다 — 그 규칙의 최소 fact(mention)를 factIds에 적고 문장에 쓴다. R4는 그 문장 그대로
  for (const r of slot.rules.filter((x) => x.merged)) {
    const miss = r.mention.filter((id) => {
      const f = sheet.byId.get(id);
      return !f || !st.factIds.includes(id) || !citesFact(f, text);
    });
    if (r.id === 'R4' && r.text && !text.includes(r.text)) miss.push(`R4 문장 "${r.text}"`);
    if (miss.length > 0) add('shape', `이 칸에 합친 ${r.id}(${r.subjectId})를 쓰지 않음 — 필요한 것: ${miss.join(', ')}`);
  }
  // 4-5. Q6 칭찬: ① 칭찬 말(캐리·주도 등)은 그 말의 칭찬 규칙이 이 칸에 있을 때만 ② 칸에 처음부터 붙은 칭찬 규칙은 근거 fact(required)를
  //      factIds에 적고 문장에 쓴다(합친 칭찬은 4-3의 mention) ③ 칭찬하는 문장(칭찬 말 또는 칭찬 근거 값)에 추정 값(1분 단위)을 쓰지 않는다
  //      ④ 1:1 킬(P2) 칸에서는 운영 "단독 킬"(6-1, 다른 정의) 수를 함께 쓰지 않는다
  for (const [pid, words] of Object.entries(PRAISE_WORDS)) {
    const w = words.find((x) => text.includes(x));
    if (w && !praiseRules.some((r) => r.id === pid)) add('forbidden', `칭찬 말 "${w}"은 칭찬 규칙 ${pid}가 발동한 칸에서만 쓴다 (데이터로 정한 칭찬만)`);
  }
  for (const r of praiseRules.filter((x) => !x.merged)) {
    const miss = r.required.filter((id) => {
      const f = sheet.byId.get(id);
      return !f || !st.factIds.includes(id) || !citesFact(f, text);
    });
    if (miss.length > 0) add('shape', `칭찬 규칙 ${r.id}(${r.subjectId})의 근거를 쓰지 않음 — 필요한 것: ${miss.join(', ')}`);
  }
  if (praiseRules.length > 0) {
    const praiseFactIds = new Set(praiseRules.flatMap((r) => r.factIds));
    const allWords = Object.values(PRAISE_WORDS).flat();
    for (const sentence of splitSentences(text)) {
      const praising = allWords.some((w) => sentence.includes(w)) || facts.some((f) => praiseFactIds.has(f.id) && citesFact(f, sentence));
      if (!praising) continue;
      const est = facts.find((f) => f.estimate && citesFact(f, sentence));
      if (est) add('forbidden', `추정 값 ${est.id}("${est.display[0]}")를 칭찬 근거로 쓰지 않는다 (칭찬은 확정 값만)`);
    }
    if (praiseRules.some((r) => r.id === 'P2') && /단독\s*킬/.test(text)) add('forbidden', '1:1 킬(P2) 칸에서는 운영 "단독 킬"(오브젝트 싸움 밖 킬 1개 싸움, 다른 정의) 수를 쓰지 않는다 → "1:1 킬"로만');
  }
  // 4-4. Q5(A1)·Q7(1): 라인 밖 싸움 칸은 라인전 전체 킬 관여(킬+어시스트, 나·상대)를 먼저 쓴다 ("상대 0번"이 라인에서도 0으로 읽히지 않게)
  if (slot.subjectId === 'laning.roam' && LANE_INVOLVE_IDS.every((id) => sheet.byId.has(id) && slot.factIds.includes(id))) {
    const miss = LANE_INVOLVE_IDS.filter((id) => !st.factIds.includes(id) || !citesFact(sheet.byId.get(id)!, text));
    if (miss.length > 0) add('shape', `라인 밖 싸움 칸은 라인전 전체 킬 관여(킬+어시스트, 나·상대)를 먼저 쓴다 — 쓰지 않음: ${miss.join(', ')}`);
  }
  // 4-6. Q7(4): 포지션 평균 딜 비중(5-2 기대 비중)을 쓰면 "이 유형의 기대치" 대신 포지션 이름("미드 딜러 평균")으로
  const avg = sheet.byId.get('player.roleAverage');
  if (avg) {
    const expected = facts.find((f) => /(^fight\.damage\.expected\d|\.expected$|\.damageExpected$)/.test(f.id) && citesFact(f, text));
    if (expected && !text.includes(String(avg.value))) add('forbidden', `포지션 평균 딜 비중(${expected.id})은 "${String(avg.value)} ${expected.display[0]}%"처럼 포지션 이름으로 쓴다`);
  }
  // 4-7. Q7(2): 득실 과목 칸(등급 과목)은 몫(%) 대신 두 팀 점수를 쓴다
  if (slot.origin === 'graded' && (slot.subjectId === 'fight.advantage' || slot.subjectId === 'macro.advantage')) {
    const ids = [`${slot.subjectId}.ours`, `${slot.subjectId}.theirs`].filter((id) => sheet.byId.has(id) && slot.factIds.includes(id));
    const hasPraise = slot.rules.some((r) => r.id === 'P4' && !r.merged);
    const miss = ids.filter((id) => !st.factIds.includes(id) || !citesFact(sheet.byId.get(id)!, text));
    if (!hasPraise && miss.length > 0) add('shape', `득실 칸은 두 팀 점수(우리 팀·상대 팀)를 쓴다 — 쓰지 않음: ${miss.join(', ')}`);
  }

  // 5. 길이
  const isSummary = slot.area === 'summary';
  const maxChars = isSummary ? LIMITS.summaryChars : LIMITS.itemChars;
  const maxSent = isSummary ? LIMITS.summarySentences : LIMITS.itemSentences;
  if (text.length > maxChars) add('length', `${text.length}자 (최대 ${maxChars}자)`);
  const sc = sentenceCount(text);
  if (sc > maxSent) add('length', `${sc}문장 (최대 ${maxSent}문장)`);

  // 6. 이름
  for (const n of findChampionNames(text, ctx.allChampionNames)) {
    if (!sheet.allowedNames.includes(n)) add('name', `이 판의 내 챔피언·상대 라이너가 아닌 "${n}"`);
  }
  return fails;
}

// ---------- 첫 답 전체 검사 ----------

export interface LlmItem {
  subjectId: string;
  text: string;
  factIds: string[];
  chunkIds?: string[];
}

export interface FirstAnswer {
  summary: SlotText;
  sections: Record<Area, { good: LlmItem[]; bad: LlmItem[] }>;
  keyMoments: { index: number; text: string; factIds: string[]; chunkIds?: string[] }[];
  /** RAG 요청만: 칸마다 반영한 조각 ID (B4). 칸 이름은 slots[].slot */
  chunkUse?: { slot: string; chunkIds: string[] }[];
}

export interface RetryAnswer {
  fixes: { slot: string; text: string; factIds: string[]; chunkIds?: string[] }[];
}

export interface AnswerCheck {
  /** 칸 → 답 문장 (칸에 맞는 답이 있을 때) */
  texts: Map<string, SlotText>;
  /** 통과한 칸 */
  passed: Set<string>;
  failures: VerifyFailure[];
  /** 칸에 대응하지 않는 답 (엔진이 안 고른 과목 등) */
  extras: VerifyFailure[];
}

/** 답 한 칸 → SlotText (chunkIds는 있을 때만 옮긴다. RAG 꺼짐이면 Q1과 같은 모양) */
function slotText(x: { text: string; factIds: string[]; chunkIds?: string[] }): SlotText {
  return { text: x.text, factIds: x.factIds, ...(x.chunkIds !== undefined ? { chunkIds: x.chunkIds } : {}) };
}

/** 답을 칸에 맞춰 나누고 칸마다 검사한다. 빠진 칸은 shape 실패 */
export function checkFirstAnswer(answer: FirstAnswer, ctx: VerifyContext): AnswerCheck {
  const texts = new Map<string, SlotText>();
  const extras: VerifyFailure[] = [];
  texts.set('summary', answer.summary);
  for (const area of AREAS) {
    for (const kind of ['good', 'bad'] as const) {
      const slots = ctx.sheet.slots.filter((s) => s.area === area && s.kind === kind);
      const items = answer.sections[area][kind];
      const used = new Set<number>();
      for (const s of slots) {
        const j = items.findIndex((it, k) => !used.has(k) && it.subjectId === s.subjectId);
        if (j >= 0) {
          used.add(j);
          texts.set(s.slot, slotText(items[j]!));
        }
      }
      items.forEach((it, k) => {
        if (!used.has(k)) extras.push({ slot: `${area}.${kind}`, rule: 'shape', detail: `엔진이 고르지 않은 과목: ${it.subjectId}` });
      });
    }
  }
  const kmUsed = new Set<number>();
  for (const km of answer.keyMoments) {
    const s = ctx.sheet.slots.find((x) => x.area === 'keyMoment' && x.index === km.index);
    if (!s || kmUsed.has(km.index)) {
      extras.push({ slot: 'keyMoment', rule: 'shape', detail: `범위 밖이거나 중복된 결정적 장면 index: ${km.index}` });
      continue;
    }
    kmUsed.add(km.index);
    texts.set(s.slot, slotText(km));
  }
  // RAG: chunkUse의 조각 ID를 칸에 붙인다. 조각을 준 요청이면 적지 않은 칸은 빈 배열
  for (const u of answer.chunkUse ?? []) {
    const st = texts.get(u.slot);
    if (!st) {
      extras.push({ slot: 'chunkUse', rule: 'shape', detail: `chunkUse에 없는 칸: ${u.slot}` });
      continue;
    }
    texts.set(u.slot, { ...st, chunkIds: [...(st.chunkIds ?? []), ...u.chunkIds] });
  }
  if (ctx.knowledgeIds) for (const [k, st] of texts) if (st.chunkIds === undefined) texts.set(k, { ...st, chunkIds: [] });
  return finish(texts, extras, ctx);
}

function finish(texts: Map<string, SlotText>, extras: VerifyFailure[], ctx: VerifyContext): AnswerCheck {
  const failures: VerifyFailure[] = [];
  const passed = new Set<string>();
  for (const s of ctx.sheet.slots) {
    const st = texts.get(s.slot);
    if (!st) {
      failures.push({ slot: s.slot, rule: 'shape', detail: '이 칸의 문장이 없음' });
      continue;
    }
    const f = verifySlot(s, st, ctx);
    if (f.length === 0) passed.add(s.slot);
    failures.push(...f);
  }
  return { texts, passed, failures, extras };
}

/** 재시도 답: 요청한 칸만 받아 검사 */
export function checkRetryAnswer(answer: RetryAnswer, wanted: readonly string[], ctx: VerifyContext): { texts: Map<string, SlotText>; passed: Set<string>; failures: VerifyFailure[] } {
  const texts = new Map<string, SlotText>();
  const failures: VerifyFailure[] = [];
  const passed = new Set<string>();
  for (const fx of answer.fixes) {
    if (wanted.includes(fx.slot) && !texts.has(fx.slot)) texts.set(fx.slot, slotText(fx));
  }
  for (const slotId of wanted) {
    const s = ctx.sheet.slots.find((x) => x.slot === slotId)!;
    const st = texts.get(slotId);
    if (!st) {
      failures.push({ slot: slotId, rule: 'shape', detail: '재시도 답에 이 칸이 없음' });
      continue;
    }
    const f = verifySlot(s, st, ctx);
    if (f.length === 0) passed.add(slotId);
    failures.push(...f);
  }
  return { texts, passed, failures };
}
