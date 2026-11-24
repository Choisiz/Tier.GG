// facts: LLM이 문장에 쓸 수 있는 숫자·이름 목록 (ai_spec 2-4).
// 엔진 결과(AnalysisResult)만 입력으로 하는 순수 함수. 엔진을 고치지 않고 파생값(차이 절댓값, 분 단위 시각)을 여기서 만든다.
// 등급·등급 점수·과목 점수·impact·반영 비율·총점은 넣지 않는다.
import { ADVICE_RULES, METRIC_LABEL } from '../advice.js';
import { initiateFight, MAX_ITEMS_PER_KIND, planItems, type ItemPlan, type MergeCandidate, type PlannedItem } from '../coverage.js';
import { ADVANTAGE_OUTCOME, DAMAGE_PHASES, LANING_DEATH_WARD_WINDOW_MS, OBJECTIVE_WINDOW_MS, ROAM_PLATE_WINDOW_MS, VISION_WINDOW_MS } from '../rules.js';
import { ROLE_LABEL, TANK_ROLES } from '../role.js';
import type { AdviceRuleId, AnalysisResult, Facts, FactValue, FightScene, FiredRule, LaneInvolvement, LaningCauseId, LaningResult, ObjectiveScene, PlayScene, Scenes } from '../types.js';
import { templateFor } from './template.js';
import { sentenceCount } from './verify.js';
import {
  AREA_LABEL,
  CAUSE_LABEL,
  DEATH_TYPE_LABEL,
  followUpLabel,
  MY_FIGHT_LABEL,
  OBJECTIVE_LABEL,
  REGION_LABEL,
  ROLE_AVERAGE_LABEL,
  SUBJECT_FACT_LABEL,
  SUBJECT_LABEL,
  type Area,
} from './labels.js';

export interface Fact {
  id: string;
  label: string;
  value: number | string;
  unit: string;
  /** 문장에 쓸 수 있는 표기. 숫자는 이 표기(또는 approx 어림)만 허용 */
  display: string[];
  /** "약 N"·"N 넘게"·"N 가까이" 어림을 허용할 때 단위 */
  approx?: { step: number };
  /** 추정 값 (Q4): 이 값을 쓴 문장은 "~로 보입니다"로 끝맺어야 한다 (검증기) */
  estimate?: true;
}

export type SlotKind = 'good' | 'bad';

/** 칸에 붙은 조언 규칙 (Q3). 조언 문장은 이 규칙이 있을 때만, required fact를 인용해야 쓸 수 있다 */
export interface SlotRule {
  id: AdviceRuleId;
  /** 이 규칙이 붙은 과목 (합친 규칙이면 원래 과목) */
  subjectId: string;
  /** 조언 요지 (advice.ts ADVICE_RULES) */
  gist: string;
  /** 행동 조언을 허용하는 규칙인가 (R4는 해석 문장만) */
  action: boolean;
  /** 문장에 반드시 인용할 fact ID */
  required: string[];
  /** 이 규칙의 fact ID 전체 (required 포함) */
  factIds: string[];
  /** R4: 5-4-1 표·내 역할·이득 교환 문장 (그대로 써야 함) */
  text?: string;
  /** Q5(A2·A3) R6·R8: 조언은 이 말 그대로 ("다음 판에는 ○○에 신경 쓰세요"). 조언 문장이 이 규칙을 근거로 하면 이 말이 있어야 한다 */
  actionText?: string;
  /** Q5 B: 이 규칙이 있었다는 것을 말하는 최소 fact (합친 규칙은 반드시 문장에 쓴다) */
  mention: string[];
  /** Q5 B: 칸이 다 차서 이 칸에 합친 규칙이면 true (원래 과목은 subjectId) */
  merged?: true;
}

export interface Slot {
  /** summary | laning.bad.0 | fight.good.1 | keyMoment.0 */
  slot: string;
  area: Area | 'summary' | 'keyMoment';
  kind: SlotKind | null;
  subjectId: string | null;
  /** keyMoment 칸의 엔진 결정적 장면 index */
  index: number | null;
  /** 이 칸에서 쓸 수 있는 fact ID (공통 fact 포함) */
  factIds: string[];
  /** 이 칸에서 발동한 조언 규칙 (Q3). 없으면 빈 배열 = 조언 문장 금지. Q5: 합친 규칙(merged)도 여기 있다 */
  rules: SlotRule[];
  /** Q5 B: graded = 엔진 말할 순서(등급 과목) · rule = 발동 규칙으로 빈 칸을 채움 · material = 판단 틀 재료(이니시 추정·라인 밖 KDA)로 채움. 요약·결정적 장면은 graded */
  origin: PlannedItem['origin'];
}

/** Q5 B: 합칠 후보 규칙 하나를 어디에 합쳤나 (합치지 못했으면 slot null + 이유) */
export interface MergeOutcome {
  candidate: MergeCandidate;
  slot: string | null;
  reason: string;
}

export interface FactSheet {
  matchId: string;
  participantId: number;
  facts: Fact[];
  byId: ReadonlyMap<string, Fact>;
  slots: Slot[];
  commonFactIds: string[];
  /** 문장에 나와도 되는 챔피언 이름 (내 챔피언·상대 라이너) */
  allowedNames: string[];
  result: AnalysisResult;
  /** Q5 B: 칸 정하기 결과 (빈 칸 채움·합칠 후보·재료) */
  plan: ItemPlan;
  /** Q5 B: 합칠 후보마다 합친 칸 또는 빠진 이유 */
  merges: MergeOutcome[];
}

/** 영역마다 좋은 점·부족한 점 각각 최대 몇 개를 말하나 (2-1, api_contract 2-7) */
export const MAX_PER_KIND = MAX_ITEMS_PER_KIND;

/**
 * Q5 B 합치기 길이 한도: 합친 뒤 그 칸의 템플릿(사실만, 조언 없음) 문장이 이 글자 수·문장 수 안이어야 합친다.
 * 처음엔 계약(api_contract 2-7)의 "약 120자"로 120자였으나, 사용자 결정(2026-11-22)으로 145자 (Q4 아리 판 R9가 139·142자로 빠져서).
 * LLM 문장은 검증기 한도(170자·3문장) 안이라 긴 합친 칸은 사실을 줄여야 조언이 들어간다. 계약 문구는 !백엔드가 맞춘다.
 */
export const MERGE_LIMIT = { chars: 145, sentences: 3 } as const;

const round = (v: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

const comma = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** 숫자 표기 규칙 (facts.ts 한 곳): 정수는 쉼표 있는/없는 형태, 소수는 둘째 자리까지 원래 값 + 첫째 자리 반올림 (정수 반올림은 허용하지 않음) */
export function numberDisplay(v: number): string[] {
  if (Number.isInteger(v)) return uniq([String(v), comma(v)]);
  const v2 = round(v, 2);
  const v1 = round(v, 1);
  const out = [String(v2)];
  if (!Number.isInteger(v1)) out.push(String(v1));
  return uniq(out);
}

/** 게임 시각 fact 값 (초, 정수). 초 아래는 버린다: 화면(frontend formatGameTime)과 같은 내림이라 장면 제목과 문장 시각이 같다 (2026-11-15) */
export const timeSec = (sec: number): number => Math.max(0, Math.floor(sec));

/** 초 → 게임 시계 표기 "분:초" (Q3, 2026-11-11 사용자 요청: "15.1분" → "15:06"). 초 아래는 내림 (timeSec) */
export function timeDisplay(sec: number): string[] {
  const total = timeSec(sec);
  return [`${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`];
}

/** 시각 fact의 단위 (게임 시계, 분:초로만 쓴다) */
export const TIME_UNIT = '시각';

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

class Builder {
  readonly facts: Fact[] = [];
  readonly byId = new Map<string, Fact>();

  num(id: string, label: string, value: number, unit: string, approx?: number, estimate = false): string {
    // Q7(사용자 채점 2026-11-24): 비중(%·%p)은 소수 첫째 자리로만 쓴다 ("30.57%" → "30.6%"). 판정은 엔진이 반올림 전 값으로 이미 했다
    const v = unit === '%' || unit === '%p' ? round(value, 1) : value;
    return this.push({ id, label, value: v, unit, display: numberDisplay(v), ...(approx ? { approx: { step: approx } } : {}), ...(estimate ? { estimate: true as const } : {}) });
  }

  /** 게임 시각 (값 = 초, 표기 = 분:초) */
  min(id: string, label: string, sec: number): string {
    return this.push({ id, label, value: timeSec(sec), unit: TIME_UNIT, display: timeDisplay(sec) });
  }

  text(id: string, label: string, value: string, estimate = false): string {
    return this.push({ id, label, value, unit: '', display: [value], ...(estimate ? { estimate: true as const } : {}) });
  }

  /** 추정 숫자 (Q4) */
  est(id: string, label: string, value: number, unit: string): string {
    return this.num(id, `${label} (추정)`, value, unit, undefined, true);
  }

  private push(f: Fact): string {
    if (!this.byId.has(f.id)) {
      this.facts.push(f);
      this.byId.set(f.id, f);
    }
    return f.id;
  }
}

const GOLD_STEP = 100;

/** championNames: championId → 한국어 이름 (Data Dragon ko_KR) */
export function buildFacts(result: AnalysisResult, championNames: ReadonlyMap<number, string>): FactSheet {
  const b = new Builder();
  const common: string[] = [];
  const myName = championNames.get(result.player.championId) ?? `챔피언 ${result.player.championId}`;
  common.push(b.text('player.champion', '내 챔피언', myName));
  common.push(b.text('player.role', '내 유형', ROLE_LABEL[result.player.role]));
  // Q7: 기대 딜 비중(5-2)은 "이 유형의 기대치" 대신 포지션 이름으로 ("미드 딜러 평균 22%")
  common.push(b.text('player.roleAverage', '기대 딜 비중(5-2 표)을 문장에 쓸 때의 이름 (뒤에 비중 N%를 붙인다)', ROLE_AVERAGE_LABEL[result.player.role]));
  common.push(b.text('player.result', '승패', result.player.win ? '승리' : '패배'));
  common.push(b.min('player.durationMin', '게임 시간', result.player.durationSec));
  const allowedNames = [myName];
  const nameOf = (pid: number): string => {
    const p = result.participants.find((x) => x.participantId === pid);
    return p ? (championNames.get(p.championId) ?? `챔피언 ${p.championId}`) : `참가자 ${pid}`;
  };
  // Q5 B: 칸 정하기 (등급 과목 → 빈 칸 채우기 → 합칠 후보). RAG 검색도 같은 함수를 쓴다
  const plan = planItems(result);

  const slots: Slot[] = [];

  // ---------- 라인전 (Q4: 2-1 성장 표 · 2-3 데스 유형 · 2-2 라인 밖 관여) ----------
  const laning = result.laning;
  if (laning) {
    const opp = championNames.get(laning.opponent.championId) ?? `챔피언 ${laning.opponent.championId}`;
    allowedNames.push(opp);
    common.push(b.text('laning.opponent', '상대 라이너 챔피언', opp));
    const laneCommon = [b.min('laning.referenceMin', '라인전 비교 시점', laning.referenceSec)];
    // 기준 전 데스 수는 라인전 모든 칸에서 (성장 칸의 원인 설명에도 쓴다)
    if (laning.deaths.length > 0) laneCommon.push(b.num('laning.deathsBefore.count', '비교 시점 전 내 데스 수', laning.deaths.length, '번'));
    const perSubject = new Map<string, string[]>([
      ['laning.growth', growthFacts(b, laning)],
      ['laning.deaths', deathFacts(b, laning, nameOf, allowedNames)],
      ['laning.roam', roamFacts(b, laning, result.scenes?.laneInvolvement ?? null, opp)],
    ]);
    for (const kind of ['good', 'bad'] as const) {
      plan.items
        .filter((it) => it.area === 'laning' && it.kind === kind)
        .forEach((it, i) => {
          const ids = [...(perSubject.get(it.subjectId) ?? [])];
          // Q4: 라인전 칸에도 조언 규칙 R6~R9 (발동한 칸만)
          const rules = it.rules.map((r) => ruleFacts(b, r, result, championNames, nameOf, allowedNames));
          for (const r of rules) ids.push(...r.factIds);
          slots.push({ slot: `laning.${kind}.${i}`, area: 'laning', kind, subjectId: it.subjectId, index: null, factIds: [...common, ...laneCommon, ...ids], rules, origin: it.origin });
        });
    }
  }

  // ---------- 교전·운영 ----------
  for (const area of ['fight', 'macro'] as const) {
    for (const kind of ['good', 'bad'] as const) {
      plan.items
        .filter((it) => it.area === area && it.kind === kind)
        .forEach((it, i) => {
          const subjectId = it.subjectId;
          const ids: string[] = [];
          if (it.origin === 'graded') {
            // 등급 과목: 과목 facts + 장면 (Q2) — Q4까지와 같음
            const subject = result[area].subjects.find((s) => s.id === subjectId);
            if (subject) ids.push(...subjectFacts(b, subjectId, subject.facts));
            // Q7(사용자 채점 2026-11-24 "득실 중 우리 팀 몫 82.7%는 무슨 말?"): 득실 과목은 몫(%) 대신 두 팀 점수와 결과(등급 경계 그대로의 말)
            if (subject?.grade && (subjectId === 'fight.advantage' || subjectId === 'macro.advantage')) {
              ids.push(b.text(`${subjectId}.outcome`, '두 팀 점수로 본 결과 (크게 이김/이김/비슷함/짐/크게 짐)', ADVANTAGE_OUTCOME[subject.grade]));
            }
            if (result.scenes) ids.push(...sceneFacts(b, subjectId, result.scenes, TANK_ROLES.includes(result.player.role), r6DeathSecs(result)));
          } else if (subjectId === 'fight.initiate') {
            ids.push(...initiateFacts(b, result));
          } else if (subjectId === 'macro.roam' && result.scenes?.roamKda) {
            ids.push(...roamKdaFacts(b, result.scenes.roamKda), b.text('macro.roam.side', '다른 라인·정글 싸움 (킬+어시스트−데스) 비교', kind === 'good' ? '내가 상대 라이너보다 많음' : '상대 라이너가 나보다 많음'));
          }
          // origin rule: 과목 등급 판정이 아니라 발동한 규칙 근거만 쓴다 (그 과목의 등급 문장·장면은 넣지 않는다)
          const rules = it.rules.map((r) => ruleFacts(b, r, result, championNames, nameOf, allowedNames));
          for (const r of rules) ids.push(...r.factIds);
          // Q4 4장: 라인 밖 킬·어시스트·데스 (게임 전체, 나 대 상대 라이너)는 운영 득실·단독 킬·데스 칸에
          if (it.origin === 'graded' && (subjectId === 'macro.advantage' || subjectId === 'macro.solo') && result.scenes?.roamKda) ids.push(...roamKdaFacts(b, result.scenes.roamKda));
          slots.push({ slot: `${area}.${kind}.${i}`, area, kind, subjectId, index: null, factIds: [...common, ...ids], rules, origin: it.origin });
        });
    }
  }

  // ---------- Q5 B: 칸이 다 차 남은 규칙을 같은 영역의 관련 칸에 합친다 (우선순위 순, 템플릿 길이 한도 안에서만) ----------
  const merges: MergeOutcome[] = [];
  const measure = { byId: b.byId, result } as unknown as FactSheet;
  for (const m of plan.merges) {
    const namesBefore = allowedNames.length;
    const sr = { ...ruleFacts(b, m.rule, result, championNames, nameOf, allowedNames), merged: true as const };
    let placed: string | null = null;
    for (const target of m.targets) {
      const slot = slots.find((x) => x.area === m.area && x.kind === m.kind && x.subjectId === target);
      if (!slot) continue;
      const before = { rules: slot.rules, factIds: slot.factIds };
      slot.rules = [...slot.rules, sr];
      slot.factIds = [...slot.factIds, ...sr.factIds];
      const t = templateFor(measure, slot).text;
      if (t.length <= MERGE_LIMIT.chars && sentenceCount(t) <= MERGE_LIMIT.sentences) {
        placed = slot.slot;
        break;
      }
      slot.rules = before.rules;
      slot.factIds = before.factIds;
    }
    if (!placed) allowedNames.length = namesBefore; // 합치지 못한 규칙의 이름(갱 정글 등)은 허용하지 않는다
    const head = m.why === 'not_standalone' ? '혼자 칸을 만들지 않는 R4 해석(이긴 싸움에서 나도 죽음·먼저 잡힘, 진 싸움에서 살아남음) → ' : '';
    merges.push({ candidate: m, slot: placed, reason: placed ? '합침' : `${head}${m.targets.length === 0 ? '합칠 칸 없음' : `길이 한도 (템플릿 ${MERGE_LIMIT.chars}자·${MERGE_LIMIT.sentences}문장)`}` });
  }

  // ---------- 결정적 장면 ----------
  // 앞선 팀이 바뀐 장면(역전)은 |뒤|−|앞|(gapChangeAbs)이 실제 손익을 작게 보이게 하므로 주지 않고,
  // 우리 팀 기준 골드 변화 크기(swingAbs)와 얻음/잃음(swingSide)으로 말하게 한다 (Q1)
  const kmIds: string[][] = result.keyMoments.map((m, i) => {
    const p = `keyMoment.${i}`;
    const reversed = isReversed(m.goldDiffBefore, m.goldDiffAfter);
    const ids = [
      b.min(`${p}.startMin`, `${i + 1}번째 장면 싸움 시작`, m.startSec),
      b.min(`${p}.endMin`, `${i + 1}번째 장면 마지막 킬`, m.endSec),
      b.num(`${p}.kills`, `${i + 1}번째 장면 킬 수 (양 팀 합)`, m.kills, '개'),
      b.num(`${p}.killsOurs`, `${i + 1}번째 장면 우리 팀 킬`, m.killsOurs, '개'),
      b.num(`${p}.killsTheirs`, `${i + 1}번째 장면 상대 팀 킬`, m.killsTheirs, '개'),
      b.num(`${p}.goldGapBeforeAbs`, `${i + 1}번째 장면 전 팀 골드 격차`, Math.abs(m.goldDiffBefore), '골드', GOLD_STEP),
      b.num(`${p}.goldGapAfterAbs`, `${i + 1}번째 장면 뒤 팀 골드 격차`, Math.abs(m.goldDiffAfter), '골드', GOLD_STEP),
      ...(reversed ? [] : [b.num(`${p}.gapChangeAbs`, `${i + 1}번째 장면 골드 격차 변화`, Math.abs(m.gapChange), '골드', GOLD_STEP)]),
      b.num(`${p}.swingAbs`, `${i + 1}번째 장면에서 우리 팀 골드가 얻거나 잃은 크기`, Math.abs(m.swing), '골드', GOLD_STEP),
      b.text(`${p}.swingSide`, `${i + 1}번째 장면 골드 변화 (우리 팀 기준)`, swingSide(m.swing)),
      b.text(`${p}.reversed`, `${i + 1}번째 장면에서 앞선 팀이 바뀌었나`, reversed ? '바뀜' : '그대로'),
      b.text(`${p}.leaderBefore`, `${i + 1}번째 장면 전 골드가 앞선 팀`, leader(m.goldDiffBefore)),
      b.text(`${p}.leaderAfter`, `${i + 1}번째 장면 뒤 골드가 앞선 팀`, leader(m.goldDiffAfter)),
    ];
    m.followUps.forEach((f, j) => ids.push(b.text(`${p}.followUp.${j}`, `${i + 1}번째 장면 뒤 이어진 일`, followUpLabel(f.what, f.ours))));
    return ids;
  });
  // Q5(A5): 고르는 방법(격차 큰 순)은 그대로, 보여주는 순서만 시간순. 칸 이름·index는 엔진 index 그대로
  result.keyMoments
    .map((m, i) => ({ m, i }))
    .sort((a, c) => a.m.startSec - c.m.startSec || a.i - c.i)
    .forEach(({ i }) => {
      slots.push({ slot: `keyMoment.${i}`, area: 'keyMoment', kind: null, subjectId: null, index: i, factIds: [...common, ...kmIds[i]!], rules: [], origin: 'graded' });
    });

  // ---------- 요약 ----------
  const kmi = result.summary.keyMomentIndex;
  slots.unshift({
    slot: 'summary',
    area: 'summary',
    kind: null,
    subjectId: null,
    index: null,
    factIds: [...common, ...(kmi !== null ? (kmIds[kmi] ?? []) : [])],
    rules: [],
    origin: 'graded',
  });

  // ---------- 해석 노트 (점수 밖 추정) ----------
  result.notes.forEach((n, i) => {
    const s = n.facts.windowStartSec;
    if (typeof s === 'number') b.min(`note.${i}.startMin`, `해석 노트 ${i + 1} 싸움 시작`, s);
  });

  for (const s of slots) s.factIds = uniq(s.factIds);
  return {
    matchId: result.matchId,
    participantId: result.player.participantId,
    facts: b.facts,
    byId: b.byId,
    slots,
    commonFactIds: common,
    allowedNames: uniq(allowedNames),
    result,
    plan,
    merges,
  };
}

// ---------- 라인전 facts (Q4) ----------

const TREND_TEXT = { AHEAD: '내가 앞섬', EVEN: '같음', BEHIND: '상대가 앞섬' } as const;
const sideText = (me: number, enemy: number) => (me > enemy ? '내가 더 많음' : me < enemy ? '상대가 더 많음' : '같음');

/** 원인 하나의 facts (단위: 킬 골드 = 골드, CS·방패 = 개, 데스·라인 밖 = 번) */
const CAUSE_UNIT: Readonly<Record<LaningCauseId, string>> = { killGold: '골드', cs: '개', plates: '개', deaths: '번', outOfLane: '번' };
const CAUSE_WHAT: Readonly<Record<LaningCauseId, string>> = {
  killGold: '킬 현상금 합(킬러 기준)',
  cs: '기준 시점 CS',
  plates: '깬 포탑 방패',
  deaths: '기준 시점 전 데스',
  outOfLane: '라인 밖 싸움 킬·어시스트',
};

function causeFacts(b: Builder, L: LaningResult, id: LaningCauseId, me: number, enemy: number): string[] {
  const p = `laning.cause.${id}`;
  const unit = CAUSE_UNIT[id];
  const step = id === 'killGold' ? GOLD_STEP : undefined;
  const ids = [
    b.num(`${p}.me`, `${CAUSE_WHAT[id]} (나)`, me, unit, step),
    b.num(`${p}.enemy`, `${CAUSE_WHAT[id]} (상대)`, enemy, unit, step),
    b.num(`${p}.diffAbs`, `${CAUSE_WHAT[id]} 차이 (${sideText(me, enemy)})`, Math.abs(me - enemy), unit, step),
  ];
  if (id === 'killGold') {
    const g = L.growth;
    // 상대가 킬 골드를 더 얻었으면 그 킬이 어디서 났나(나를 잡은 킬·내 데스 어시스트·라인 밖), 내가 더 얻었으면 내 킬 수
    if (enemy > me) {
      ids.push(
        b.num(`${p}.enemyKills`, '기준 시점까지 상대 라이너 킬', g.kills.enemy, '번'),
        b.num(`${p}.enemyKillsOnMe`, '그중 상대 라이너가 나를 잡은 킬', g.enemyKillsOnMe, '번'),
        b.num(`${p}.enemyAssistsOnMe`, '상대 라이너가 내 데스에 어시스트한 수', g.enemyAssistsOnMe, '번'),
      );
      if (L.roam && L.roam.enemy.length > 0) ids.push(b.num(`${p}.enemyOutOfLane`, '상대 라이너의 라인 밖 싸움 킬·어시스트', L.roam.enemy.length, '번'));
    } else {
      ids.push(b.num(`${p}.meKills`, '기준 시점까지 내 킬', g.kills.me, '번'));
    }
  }
  return ids;
}

/** 2-1 성장 칸: 판정(칸 이름) + 골드·레벨 + 원인 2개 + 기존 비교(KDA·CS) */
function growthFacts(b: Builder, L: LaningResult): string[] {
  const g = L.growth;
  const gold = L.items.find((x) => x.id === 'laning.gold');
  const level = L.items.find((x) => x.id === 'laning.level');
  const ids = [b.text('laning.growth.cell', '라인전 판정 (골드×레벨 표의 칸)', L.cell.label)];
  if (gold) {
    ids.push(
      b.num('laning.gold.me', '라인전 골드 (나)', gold.me, '골드', GOLD_STEP),
      b.num('laning.gold.enemy', '라인전 골드 (상대)', gold.enemy, '골드', GOLD_STEP),
      b.num('laning.gold.diffAbs', '라인전 골드 차이', Math.abs(gold.diff), '골드', GOLD_STEP),
      b.text('laning.growth.gold', '골드', L.cell.gold === 'EVEN' ? '비슷함(작은 차이)' : TREND_TEXT[L.cell.gold]),
    );
  }
  if (level) {
    ids.push(
      b.num('laning.level.me', '라인전 레벨 (나)', level.me, ''),
      b.num('laning.level.enemy', '라인전 레벨 (상대)', level.enemy, ''),
      b.text('laning.growth.level', '레벨', TREND_TEXT[L.cell.level]),
    );
    if (level.diff !== 0) ids.push(b.num('laning.level.diffAbs', '라인전 레벨 차이', Math.abs(level.diff), ''));
  }
  // 원인 큰 순 2개 (1장). 순서 문장에는 숫자를 넣지 않는다
  if (g.causes.length > 0) {
    const order = g.causes.map((c) => `${CAUSE_LABEL[c.id]}(${c.favors === 'ME' ? '내가 앞섬' : '상대가 앞섬'})`).join(', 그다음 ');
    ids.push(b.text('laning.growth.causes', '골드·레벨 차의 원인 (큰 것부터)', order));
    for (const c of g.causes) ids.push(...causeFacts(b, L, c.id, c.me, c.enemy));
  }
  if (g.deaths.me > 0) ids.push(b.num('laning.growth.deathBounty', '내 데스로 상대 팀이 얻은 현상금 합', g.deathBounty.me, '골드', GOLD_STEP));
  return ids;
}

/** 2-3 데스 칸: 데스마다 시각·지역·유형 (+1:1 준·받은 피해, 갱 와드 수, 6레벨) */
function deathFacts(b: Builder, L: LaningResult, nameOf: (pid: number) => string, allowedNames: string[]): string[] {
  const ids = [b.num('laning.deathsBefore.count', '비교 시점 전 내 데스 수', L.deaths.length, '번')];
  const counts = new Map<string, number>();
  for (const d of L.deaths) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
  for (const [t, n] of counts) ids.push(b.num(`laning.deathType.${t}.count`, `그중 ${DEATH_TYPE_LABEL[t as keyof typeof DEATH_TYPE_LABEL]} 데스 수`, n, '번'));
  L.deaths.slice(0, 3).forEach((d, i) => {
    const p = `laning.deathsBefore.${i}`;
    const n = i + 1;
    ids.push(b.min(`${p}.min`, `라인전 데스${n} 시각`, d.sec));
    if (d.region) ids.push(b.text(`${p}.region`, `라인전 데스${n} 지역`, REGION_LABEL[d.region] ?? d.region));
    ids.push(b.text(`${p}.type`, `라인전 데스${n} 유형`, DEATH_TYPE_LABEL[d.type], d.type === 'DIVE'));
    ids.push(b.num(`${p}.enemies`, `라인전 데스${n} 관여한 상대 수`, d.enemies.length, '명'));
    if (d.enemies.length > 0) {
      const names = d.enemies.map(nameOf);
      allowedNames.push(...names);
      ids.push(b.text(`${p}.enemyNames`, `라인전 데스${n} 관여한 상대 챔피언`, names.join('·')));
    }
    if ((d.type === 'SOLO' || d.type === 'JUNGLE_SOLO') && d.dealt !== null && d.received !== null) {
      ids.push(
        b.num(`${p}.dealt`, `라인전 데스${n} 죽기 직전 내가 준 피해`, d.dealt, ''),
        b.num(`${p}.received`, `라인전 데스${n} 죽기 직전 상대 챔피언에게 받은 피해`, d.received, ''),
        b.text(`${p}.trade`, `라인전 데스${n} 교환 결과`, d.oneSided ? '일방적으로 당함' : '교환 끝에 짐'),
      );
    }
    if (d.type === 'GANK') {
      ids.push(b.num('laning.deathsBefore.wardWindowSec', '갱 데스 전 와드를 세는 기준: 죽기 전 N초', LANING_DEATH_WARD_WINDOW_MS / 1000, '초'));
      ids.push(b.num(`${p}.wardsBefore`, `라인전 데스${n} 죽기 전 60초 동안 내가 설치한 와드`, d.wardsBefore, '개'));
    }
    if (d.levelSix) ids.push(b.text(`${p}.levelSix`, `라인전 데스${n} 6레벨`, '상대가 6레벨을 먼저 찍은 뒤의 데스라 6레벨 차이로 진 싸움', true));
  });
  if (L.deaths.some((d) => d.levelSix)) {
    if (L.levelSix.enemySec !== null) ids.push(b.min('laning.levelSix.enemyMin', '상대 라이너가 6레벨을 찍은 시각', L.levelSix.enemySec));
    if (L.levelSix.meSec !== null) ids.push(b.min('laning.levelSix.meMin', '내가 6레벨을 찍은 시각', L.levelSix.meSec));
  }
  return ids;
}

/**
 * Q7(사용자 채점 2026-11-24 "1인데 왜 0?"): 라인전 킬 관여(킬+어시스트) 나·상대 라이너와, 그 킬이 어디서 났나
 * (맞상대를 잡음 / 다른 라인·정글 싸움 / 그 밖 라인 안). 라인 밖 수는 laning.roam.me·enemy와 같다
 */
export const LANE_INVOLVE_IDS = ['laning.involve.me.count', 'laning.involve.enemy.count'] as const;
function involvementFacts(b: Builder, li: LaneInvolvement, nameOf: string): string[] {
  const ids: string[] = [];
  for (const who of ['me', 'enemy'] as const) {
    const xs = li[who];
    const w = who === 'me' ? '나' : '상대 라이너';
    const p = `laning.involve.${who}`;
    ids.push(
      b.num(`${p}.count`, `비교 시점까지 라인전 킬 관여 = 킬 + 어시스트 (${w}, 라인 안·밖 모두)`, xs.length, '번'),
      b.num(`${p}.kills`, `그중 킬 (${w})`, xs.filter((x) => x.kind === 'KILL').length, '번'),
      b.num(`${p}.assists`, `그중 어시스트 (${w})`, xs.filter((x) => x.kind === 'ASSIST').length, '번'),
    );
    const vs = xs.filter((x) => x.where === 'VS_LANER');
    const inLane = xs.filter((x) => x.where === 'IN_LANE');
    const target = who === 'me' ? `상대 라이너 ${nameOf}` : '나';
    ids.push(b.num(`${p}.vsLaner`, `그중 ${target}를 잡은 킬 관여 (${w})`, vs.length, '번'));
    if (vs.length > 0) {
      ids.push(b.min(`${p}.vsLaner.0.min`, `${w}가 ${target}를 잡은 첫 킬 관여 시각`, vs[0]!.sec));
      if (vs[0]!.region) ids.push(b.text(`${p}.vsLaner.0.region`, `그 킬 지역`, REGION_LABEL[vs[0]!.region] ?? vs[0]!.region));
      ids.push(b.text(`${p}.vsLaner.0.kind`, '그 킬 관여 종류', vs[0]!.kind === 'KILL' ? '킬' : '어시스트'));
    }
    if (inLane.length > 0) ids.push(b.num(`${p}.inLane`, `그중 내 라인에서 맞상대가 아닌 상대(정글 등)를 잡은 킬 관여 (${w})`, inLane.length, '번'));
  }
  return ids;
}

/** 2-2 라인 밖 관여 칸 */
function roamFacts(b: Builder, L: LaningResult, li: LaneInvolvement | null = null, oppName = '상대'): string[] {
  const r = L.roam;
  if (!r) return [];
  const ids = [
    // Q7: 전체 킬 관여 먼저 → 그 킬이 어디서 났나
    ...(li ? involvementFacts(b, li, oppName) : []),
    b.num('laning.roam.me', '비교 시점까지 내 라인 밖(다른 라인·정글) 싸움 킬·어시스트', r.me.length, '번'),
    b.num('laning.roam.enemy', '비교 시점까지 상대 라이너의 라인 밖(다른 라인·정글) 싸움 킬·어시스트', r.enemy.length, '번'),
    b.text('laning.roam.verdict', '라인 밖(다른 라인·정글) 싸움 참여 결론', r.verdict === 'OPPONENT' ? '상대 로밍 우위' : r.verdict === 'ME' ? '내 로밍 우위' : '비슷'),
    b.num('laning.plates.me', '비교 시점까지 내가 깬 포탑 방패', L.growth.plates.me, '개'),
    b.num('laning.plates.enemy', '비교 시점까지 상대가 깬 포탑 방패', L.growth.plates.enemy, '개'),
    // Q5(A1): 라인 밖 수만 쓰면 "상대 0번"이 라인에서 킬이 없었다는 뜻으로 읽힌다 → 라인전 전체 킬/데스/어시스트(나·상대)를 함께 쓴다
    ...laneKdaFacts(b, L),
  ];
  r.enemy.slice(0, 3).forEach((x, i) => {
    ids.push(b.min(`laning.roam.enemy.${i}.min`, `상대 라이너 다른 라인·정글 싸움${i + 1} 시각`, x.sec));
    if (x.region) ids.push(b.text(`laning.roam.enemy.${i}.region`, `상대 라이너 다른 라인·정글 싸움${i + 1} 지역`, REGION_LABEL[x.region] ?? x.region));
  });
  r.me.slice(0, 3).forEach((x, i) => {
    ids.push(b.min(`laning.roam.me.${i}.min`, `내 다른 라인·정글 싸움${i + 1} 시각`, x.sec));
    if (x.region) ids.push(b.text(`laning.roam.me.${i}.region`, `내 다른 라인·정글 싸움${i + 1} 지역`, REGION_LABEL[x.region] ?? x.region));
  });
  if (r.enemy.length > 0) {
    ids.push(b.num('laning.roam.windowSec', '상대가 라인을 비운 동안으로 보는 기준: 라인 밖 싸움 시각 앞뒤 N초', ROAM_PLATE_WINDOW_MS / 1000, '초'));
    ids.push(b.num('laning.roam.platesWhileAway', '상대가 라인 밖에 간 시각 앞뒤 60초 안에 내가 깬 방패', r.platesWhileAwaySec.length, '개'));
    if (r.platesWhileAwaySec.length > 0) ids.push(b.min('laning.roam.platesWhileAway.0.min', '그 방패를 깬 시각', r.platesWhileAwaySec[0]!));
    if (r.csWhileAway !== null) ids.push(b.est('laning.roam.csWhileAway', '상대가 라인 밖에 간 1분 동안 늘어난 내 CS', r.csWhileAway, '개'));
  }
  return ids;
}

/** Q5(C2): R6이 발동했으면 R6이 다룬 라인전 1:1 데스 시각 (단독 데스 장면에서 뺀다, advice.ruleR5와 같은 기준) */
function r6DeathSecs(result: AnalysisResult): Set<number> {
  if (!(result.advice?.rules ?? []).some((r) => r.id === 'R6')) return new Set();
  return new Set((result.laning?.deaths ?? []).filter((d) => d.type === 'SOLO').map((d) => d.sec));
}

/** Q5(A1) 라인전 전체(비교 시점까지, 라인 안·밖 모두) 킬/데스/어시스트, 나·상대 라이너 */
export const LANE_KDA_IDS = ['laning.kda.me.kills', 'laning.kda.me.deaths', 'laning.kda.me.assists', 'laning.kda.enemy.kills', 'laning.kda.enemy.deaths', 'laning.kda.enemy.assists'] as const;
function laneKdaFacts(b: Builder, L: LaningResult): string[] {
  const kda = L.items.find((x) => x.id === 'laning.kda')?.detail;
  const me = kda?.me;
  const enemy = kda?.enemy;
  if (!Array.isArray(me) || !Array.isArray(enemy)) return [];
  const ids: string[] = [];
  const what = ['킬', '데스', '어시스트'] as const;
  const key = ['kills', 'deaths', 'assists'] as const;
  for (const [who, arr, w] of [['me', me, '나'], ['enemy', enemy, '상대 라이너']] as const) {
    key.forEach((k, i) => ids.push(b.num(`laning.kda.${who}.${k}`, `비교 시점까지 라인전 전체 ${what[i]} (${w}, 라인 안·밖 모두)`, Number(arr[i]), '번')));
  }
  return ids;
}

/** Q4 4장: 게임 전체 라인 밖 킬·어시스트·데스 */
function roamKdaFacts(b: Builder, k: NonNullable<Scenes['roamKda']>): string[] {
  const ids: string[] = [];
  for (const who of ['me', 'enemy'] as const) {
    const w = who === 'me' ? '나' : '상대 라이너';
    ids.push(
      b.num(`macro.roam.${who}.kills`, `게임 전체 다른 라인·정글 싸움 킬 (${w})`, k[who].kills, '번'),
      b.num(`macro.roam.${who}.assists`, `게임 전체 다른 라인·정글 싸움 어시스트 (${w})`, k[who].assists, '번'),
      b.num(`macro.roam.${who}.deaths`, `게임 전체 다른 라인·정글 싸움 데스 (${w})`, k[who].deaths, '번'),
    );
  }
  return ids;
}

/** Q5 B 오브젝트 · 이니시(추정) 재료: 이긴 오브젝트 싸움 중 첫 킬에 내가 참여한 싸움 (확정 사실 + 첫 가해자 추정) */
function initiateFacts(b: Builder, result: AnalysisResult): string[] {
  const ini = initiateFight(result);
  if (!ini) return [];
  const f = ini.fight;
  const p = 'fight.initiate';
  const ids = [
    b.min(`${p}.min`, '그 싸움 첫 킬 시각', f.startSec),
    b.text(`${p}.inFirstKill`, '그 싸움 첫 킬에 내가 킬·어시스트로 참여 (확정)', '참여함'),
    b.text(`${p}.outcome`, '그 싸움 결과 (득실 기준)', outcomeText(f)),
    b.num(`${p}.count`, '이긴 오브젝트 싸움 중 첫 킬에 내가 참여한 싸움 수', ini.count, '번'),
  ];
  const ours = [...new Set(f.objectives.filter((o) => o.ours).map((o) => OBJECTIVE_LABEL[o.kind] ?? o.kind))];
  if (ours.length > 0) ids.push(b.text(`${p}.objective`, '그 싸움에서 우리 팀이 잡은 오브젝트', ours.join('·')));
  if (f.region) ids.push(b.text(`${p}.region`, '그 싸움 첫 킬 지역', REGION_LABEL[f.region] ?? f.region));
  if (f.firstHitByMe === true) ids.push(b.text(`${p}.firstHitByMe`, '그 싸움 첫 데스에게 처음 피해를 준 사람', '나', true));
  return ids;
}

/** Q6 칭찬 근거 킬 목록 (시각·상대 챔피언, 최대 5개). 상대 이름은 문장에 써도 되는 이름에 더한다 */
function praiseKills(b: Builder, p: string, secs: FactValue | undefined, victims: FactValue | undefined, what: string, nameOf: (pid: number) => string, allowedNames: string[]): string[] {
  const ts = Array.isArray(secs) ? (secs as number[]) : [];
  const vs = Array.isArray(victims) ? (victims as number[]) : [];
  const ids: string[] = [];
  ts.slice(0, 5).forEach((t, i) => {
    ids.push(b.min(`${p}.${i}.min`, `${what}${i + 1} 시각`, t));
    if (typeof vs[i] === 'number') {
      const name = nameOf(vs[i]!);
      allowedNames.push(name);
      ids.push(b.text(`${p}.${i}.victim`, `${what}${i + 1} 상대 챔피언`, name));
    }
  });
  return ids;
}

/** 앞선 팀이 바뀌었나 (우리 팀 기준 골드 차의 부호가 반대로). 0(같음)에서 시작하거나 끝나면 역전이 아니다 */
export function isReversed(before: number, after: number): boolean {
  return before * after < 0;
}

function swingSide(swing: number): string {
  if (swing > 0) return '우리 팀이 얻음';
  if (swing < 0) return '우리 팀이 잃음';
  return '변화 없음';
}

function leader(diff: number): string {
  if (diff > 0) return '우리 팀';
  if (diff < 0) return '상대 팀';
  return '같음';
}

// ---------- 장면 facts (Q2) ----------

/** 과목마다 쓰는 기준 시간 fact */
const WINDOW_FACTS: Readonly<Record<string, readonly ('fight' | 'vision')[]>> = {
  'fight.advantage': ['fight'],
  'fight.vision': ['vision'],
  'fight.objective': ['vision'],
  'macro.advantage': ['fight'],
  'macro.solo': ['fight'],
  'macro.vision': ['vision'],
};

/** 장면 facts의 과목별 출처 */
// Q7: 딜 칸의 오브젝트 싸움 1분 딜 비중(추정, 예: "장로 용 싸움 79.5%로 보입니다")은 내지 않는다 → 오브젝트 싸움 내 기여(확정 값, P4·R12)로 대체
const SCENE_SOURCE: Readonly<Record<string, keyof Scenes>> = {
  'fight.vision': 'fightVision',
  'fight.objective': 'fightObjective',
  'fight.advantage': 'fightAdvantage',
  'macro.advantage': 'macroAdvantage',
  'macro.solo': 'macroSolo',
};

function windowFacts(b: Builder, which: 'fight' | 'vision', scenes: Scenes): string {
  return which === 'fight'
    ? b.num('fight.windowSec', '오브젝트 싸움 기준: 처치 시각 앞뒤 N초', scenes.fightWindowSec, '초')
    : b.num('fight.vision.windowSec', '오브젝트 전 시야 기준: 처치 전 N초', scenes.visionWindowSec, '초');
}

const takenText = (ours: boolean) => (ours ? '우리 팀이 잡음' : '상대 팀이 잡음');

function objectiveSceneFacts(b: Builder, p: string, n: number, s: ObjectiveScene, withWards: boolean): string[] {
  const ids = [
    b.min(`${p}.min`, `장면${n} 처치 시각`, s.sec),
    b.text(`${p}.objective`, `장면${n} 오브젝트`, OBJECTIVE_LABEL[s.kind] ?? s.kind),
    b.text(`${p}.taken`, `장면${n} 잡은 팀`, takenText(s.ours)),
  ];
  if (withWards) {
    ids.push(
      b.num(`${p}.wardsPlaced`, `장면${n} 처치 전 60초 내 와드 설치(제어 와드 포함)`, s.wardsPlaced, '개'),
      b.num(`${p}.controlWards`, `장면${n} 그중 제어 와드`, s.controlWards, '개'),
      b.num(`${p}.wardKills`, `장면${n} 처치 전 60초 내 와드 제거`, s.wardKills, '개'),
    );
  } else {
    ids.push(b.text(`${p}.lastHit`, `장면${n} 막타`, s.lastHitByMe ? '내가 막타를 침' : '내가 막타를 치지 않음'));
  }
  return ids;
}

function outcomeText(f: FightScene): string {
  if (f.pointsOurs > f.pointsTheirs) return '우리 팀이 더 얻음';
  if (f.pointsOurs < f.pointsTheirs) return '상대 팀이 더 얻음';
  return '비슷함';
}

function objectivesText(f: FightScene): string | null {
  if (f.objectives.length === 0) return null;
  const by = (ours: boolean) => [...new Set(f.objectives.filter((o) => o.ours === ours).map((o) => OBJECTIVE_LABEL[o.kind] ?? o.kind))];
  const parts: string[] = [];
  const o = by(true);
  const t = by(false);
  if (o.length) parts.push(`우리 팀이 ${o.join('·')} 잡음`);
  if (t.length) parts.push(`상대 팀이 ${t.join('·')} 잡음`);
  return parts.join(', ');
}

function fightSceneFacts(b: Builder, p: string, n: number, f: FightScene, tank: boolean): string[] {
  const ids = [
    b.min(`${p}.min`, `장면${n} 싸움 시각`, f.startSec),
    b.num(`${p}.killsOurs`, `장면${n} 우리 팀 킬`, f.killsOurs, '개'),
    b.num(`${p}.killsTheirs`, `장면${n} 상대 팀 킬`, f.killsTheirs, '개'),
    b.text(`${p}.outcome`, `장면${n} 득실`, outcomeText(f)),
    // 이 싸움에서 나 (내 역할만 말한다, 2026-11-15: 다른 아군이 먼저 죽은 일은 넣지 않는다)
    b.text(`${p}.firstDeath`, `장면${n} 이 싸움에서 나`, f.firstDeath === 'ME' ? MY_FIGHT_LABEL.FIRST : f.iDied ? MY_FIGHT_LABEL.DIED : MY_FIGHT_LABEL.SURVIVED),
  ];
  const objs = objectivesText(f);
  if (objs) ids.push(b.text(`${p}.objectives`, `장면${n} 잡힌 오브젝트`, objs));
  if (f.region) ids.push(b.text(`${p}.region`, `장면${n} 지역`, REGION_LABEL[f.region] ?? f.region));
  // Q4 3장 "오래 버텼는가"(확정): 첫 킬 뒤 몇 초에 죽었나
  if (f.myDeathAfterFirstKillSec !== null) ids.push(b.num(`${p}.myDeathAfterSec`, `장면${n} 싸움 첫 킬 뒤 내가 죽기까지`, f.myDeathAfterFirstKillSec, '초'));
  // Q4 3장 이니시 근거: 첫 킬 참여(확정 사실), 첫 데스의 첫 가해자(추정)
  if (f.inFirstKill) ids.push(b.text(`${p}.inFirstKill`, `장면${n} 그 싸움 첫 킬에 내가 킬·어시스트로 참여`, '참여함'));
  if (f.firstHitByMe === true) ids.push(b.text(`${p}.firstHitByMe`, `장면${n} 그 싸움 첫 데스에게 처음 피해를 준 사람`, '나', true));
  // Q4 4장: 싸움 전·후 팀 골드 차 변화 (1분 단위)
  if (f.goldBefore !== null && f.goldAfter !== null) {
    const swing = f.goldAfter - f.goldBefore;
    ids.push(b.num(`${p}.goldSwingAbs`, `장면${n} 싸움 전후 우리 팀 골드 변화 크기 (1분 단위)`, Math.abs(swing), '골드', GOLD_STEP));
    ids.push(b.text(`${p}.goldSwingSide`, `장면${n} 싸움 전후 골드 변화 (우리 팀 기준)`, swingSide(swing)));
  }
  // 탱 유형: 받은 피해 비중·건 CC (1분 단위라 추정)
  if (tank && f.frame) {
    if (f.frame.takenSharePct !== null) ids.push(b.est(`${p}.takenSharePct`, `장면${n} 그 1분 동안 우리 팀 받은 피해 중 내 비중`, f.frame.takenSharePct, '%'));
    if (f.frame.ccSec !== null && f.frame.ccSec > 0) ids.push(b.est(`${p}.ccSec`, `장면${n} 그 1분 동안 내가 상대에게 건 CC 시간`, f.frame.ccSec, '초'));
  }
  return ids;
}

function playSceneFacts(b: Builder, p: string, n: number, s: PlayScene): string[] {
  const ids = [
    b.min(`${p}.min`, `장면${n} 시각`, s.sec),
    b.text(`${p}.what`, `장면${n} 무엇`, s.kind === 'KILL' ? '단독 킬' : '단독 데스'),
  ];
  if (s.region) ids.push(b.text(`${p}.region`, `장면${n} 지역`, REGION_LABEL[s.region] ?? s.region));
  if (s.kind === 'DEATH') {
    ids.push(b.num(`${p}.enemies`, `장면${n} 관여한 상대 수`, s.enemies, '명'));
    ids.push(b.text(`${p}.jungler`, `장면${n} 상대 정글`, s.enemyJungler ? '관여함' : '관여 안 함'));
  }
  return ids;
}

/** 과목 칸에 붙는 기준 시간 + 장면 facts (과목마다 최대 3개, 엔진이 정한 중요한 순) */
function sceneFacts(b: Builder, subjectId: string, scenes: Scenes, tank = false, skipSoloSecs: ReadonlySet<number> = new Set()): string[] {
  const ids = (WINDOW_FACTS[subjectId] ?? []).map((w) => windowFacts(b, w, scenes));
  const key = SCENE_SOURCE[subjectId];
  if (!key) return ids;
  let list = (scenes[key] ?? []) as readonly (ObjectiveScene | FightScene | PlayScene)[];
  // Q5(C2): 단독 킬·데스 장면에서 라인전 1:1 데스(R6이 다룬 데스)는 빼서 같은 데스를 두 번 말하지 않는다
  if (key === 'macroSolo' && skipSoloSecs.size > 0) list = (list as readonly PlayScene[]).filter((x) => !(x.kind === 'DEATH' && skipSoloSecs.has(x.sec)));
  // 싸움 장면(교전·운영 득실)은 내가 죽은 싸움을 먼저 (엔진 순서는 그대로 두고 그 안에서 안정 정렬, 2026-11-15)
  if (key === 'fightAdvantage' || key === 'macroAdvantage') {
    const fs = list as readonly FightScene[];
    list = [...fs.filter((x) => x.iDied), ...fs.filter((x) => !x.iDied)];
  }
  list.forEach((x, i) => {
    const p = `scene.${subjectId}.${i}`;
    const n = i + 1;
    if (key === 'fightVision') ids.push(...objectiveSceneFacts(b, p, n, x as ObjectiveScene, true));
    else if (key === 'fightObjective') ids.push(...objectiveSceneFacts(b, p, n, x as ObjectiveScene, false));
    else if (key === 'macroSolo') ids.push(...playSceneFacts(b, p, n, x as PlayScene));
    else ids.push(...fightSceneFacts(b, p, n, x as FightScene, tank));
  });
  return ids;
}

/** 과목 facts를 평평하게. 배열 구간 [시작분, 끝분]은 phaseNStartMin/EndMin, 음수 diff·net은 절댓값 fact로. SUBJECT_FACT_LABEL에 없는 키는 버린다 */
function subjectFacts(b: Builder, subjectId: string, facts: Record<string, FactValue>): string[] {
  const ids: string[] = [];
  for (const [key, v] of Object.entries(facts)) {
    if (/^phase\d$/.test(key) && Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') {
      const n = key.slice(5);
      const label = ['첫 구간', '둘째 구간', '셋째 구간'][Number(n)] ?? `${n}번째 구간`;
      ids.push(b.min(`${subjectId}.phase${n}StartMin`, `딜 비중 ${label} 시작`, v[0] * 60));
      ids.push(b.min(`${subjectId}.phase${n}EndMin`, `딜 비중 ${label} 끝`, v[1] * 60));
      continue;
    }
    if (typeof v !== 'number') continue;
    const absKey = /^(diff\d|net)$/.test(key) ? `${key}Abs` : key;
    const meta = SUBJECT_FACT_LABEL[`${subjectId}.${absKey}`];
    if (!meta) continue;
    const value = absKey === key ? v : Math.abs(v);
    // Q5(C4): 시간 길이(분)는 소수("21.03분")로 쓰지 않는다 → 반올림한 정수 분, "약 N분" 허용
    if (meta[1] === '분') {
      ids.push(b.num(`${subjectId}.${absKey}`, `${meta[0]} (반올림한 분, "약 N분"으로 쓴다)`, Math.round(value), '분', 1));
      continue;
    }
    ids.push(b.num(`${subjectId}.${absKey}`, meta[0], value, meta[1]));
  }
  return ids;
}

export const AREA_NAMES = AREA_LABEL;

// ---------- 오브젝트 싸움 내 기여 facts (Q7) ----------

/**
 * P4·R12의 내 기여 facts (확정 값). which = 'high'(P4: 높은 값을 required) | 'low'(R12: 낮은 값을 required).
 * ① 우리 팀 킬 수·내 관여 수·비율 ② 잡은 상대가 죽기 전 받은 챔피언 피해 중 내 몫
 */
function contributionFacts(b: Builder, p: string, f: Facts, which: 'high' | 'low'): { id: string; required: boolean }[] {
  const out: { id: string; required: boolean }[] = [];
  if (typeof f.teamKills !== 'number') return out;
  const invFlag = which === 'high' ? f.involvementHigh === true : f.involvementLow === true;
  const dmgFlag = which === 'high' ? f.killedDamageHigh === true : f.killedDamageLow === true;
  if (typeof f.involvementPct === 'number') {
    out.push({ id: b.num(`${p}.teamKills`, '그 싸움들에서 우리 팀이 잡은 상대 챔피언 수', f.teamKills, '번'), required: invFlag });
    if (typeof f.involvement === 'number') out.push({ id: b.num(`${p}.involvement`, '그중 내가 킬·어시스트로 관여한 수', f.involvement, '번'), required: invFlag });
    out.push({ id: b.num(`${p}.involvementPct`, '우리 팀 킬 중 내 관여 비율', f.involvementPct, '%'), required: invFlag });
  }
  if (typeof f.killedDamagePct === 'number') {
    out.push({ id: b.num(`${p}.killedDamagePct`, '잡은 상대가 죽기 직전 받은 챔피언 피해 중 내 몫 (우리 팀 피해 합 기준, 확정 값)', f.killedDamagePct, '%'), required: dmgFlag });
  }
  out.push({ id: b.text(`${p}.level`, which === 'high' ? '내 기여 중 높았던 것 (최근 200판 분포 기준)' : '내 기여 중 낮았던 것 (최근 200판 분포 기준)', levelText(invFlag, dmgFlag)), required: false });
  return out;
}

const levelText = (inv: boolean, dmg: boolean): string =>
  inv && dmg ? '킬 관여 비율과 피해 몫 모두' : inv ? '킬 관여 비율' : dmg ? '잡은 상대가 받은 피해 중 내 몫' : '없음 (보통)';

// ---------- 조언 규칙 facts (Q3) ----------

const pct = (v: FactValue | undefined): number | null => (typeof v === 'number' ? v : null);

/** 규칙 하나 → rule.* facts + 칸 규칙 정보 */
function ruleFacts(
  b: Builder,
  r: FiredRule,
  result: AnalysisResult,
  championNames: ReadonlyMap<number, string>,
  nameOf: (pid: number) => string,
  allowedNames: string[],
): SlotRule {
  const meta = ADVICE_RULES[r.id];
  const ids: string[] = [];
  const req: string[] = [];
  const mention: string[] = [];
  let actionText: string | undefined;
  const f = r.facts;
  const need = (id: string) => {
    ids.push(id);
    req.push(id);
  };
  /** Q5 B: 이 규칙이 있었다는 것을 말하는 최소 fact (합친 규칙은 반드시 쓴다) */
  const say = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
    mention.push(id);
  };
  switch (r.id) {
    case 'R1': {
      const p = `rule.R1.${r.subjectId}`;
      const [label, unit] = METRIC_LABEL[r.subjectId] ?? [SUBJECT_LABEL[r.subjectId] ?? r.subjectId, ''];
      const subjectName = SUBJECT_LABEL[r.subjectId] ?? r.subjectId;
      need(b.num(`${p}.weight`, `이 유형에서 ${subjectName}의 반영 비율 (영역 합 100)`, Number(f.weight), ''));
      need(b.num(`${p}.me`, `${label} (나)`, Number(f.me), unit));
      say(`${p}.me`);
      if (typeof f.opponent === 'number') {
        const oppId = result.laning?.opponent.championId;
        const who = oppId !== undefined ? `상대 라이너 ${championNames.get(oppId) ?? ''}`.trim() : '상대 라이너';
        need(b.num(`${p}.opponent`, `${label} (${who})`, f.opponent, unit));
        say(`${p}.opponent`);
      }
      break;
    }
    case 'R2':
    case 'R3': {
      const p = `rule.${r.id}`;
      need(b.num(`${p}.myDeaths`, '내가 참여한 오브젝트 싸움에서 내 데스 수', Number(f.myDeaths), '번'));
      need(b.num(`${p}.deathPoints`, `내 데스로 상대 팀이 얻은 득실 점수 (데스 1번 = 내 포지션 점수 ${f.pointsPerDeath})`, Number(f.deathPoints), '점'));
      say(`${p}.myDeaths`);
      say(`${p}.deathPoints`);
      ids.push(b.num(`${p}.pointsPerDeath`, '데스 1번에 상대 팀이 얻는 득실 점수 (내 포지션)', Number(f.pointsPerDeath), '점'));
      // Q7: 득실 몫(%)은 내지 않는다 (칸의 과목 facts가 두 팀 점수를 준다)
      const ds = pct(f.damageShare);
      const de = pct(f.damageExpected);
      const k = typeof f.damagePhase === 'number' ? f.damagePhase : null;
      if (ds !== null && de !== null && k !== null) {
        const [from, to] = DAMAGE_PHASES[k]!;
        const span = Number.isFinite(to) ? `${from}~${to}분` : `${from}분 이후`;
        const dsId = b.num(`${p}.damageShare`, `${span} 구간 챔피언 딜 비중`, ds, '%');
        if (r.id === 'R2') need(dsId);
        else ids.push(dsId);
        ids.push(b.num(`${p}.damageExpected`, `${span} 구간 포지션 평균 딜 비중 (문장에는 player.roleAverage 이름으로)`, de, '%'));
      }
      if (r.id === 'R3' && typeof f.keyMomentIndex === 'number') {
        const km = result.keyMoments[f.keyMomentIndex];
        if (km) ids.push(b.min(`keyMoment.${f.keyMomentIndex}.startMin`, `${f.keyMomentIndex + 1}번째 장면 싸움 시작`, km.startSec));
      }
      break;
    }
    case 'R4': {
      // 내 역할만 (2026-11-15): 이득 교환(Q5 A4) / 내가 먼저 죽음 / 먼저는 아니지만 죽음 / 살아남음
      const p = `rule.R4.${r.kind}`;
      const role = f.tank ? '탱커' : '딜러';
      if (typeof f.sec === 'number') need(b.min(`${p}.min`, f.status === 'SURVIVED' ? '그 싸움의 첫 킬 시각' : '그 싸움에서 내가 죽은 시각', f.sec));
      if (typeof f.sec === 'number') say(`${p}.min`);
      const me = f.status === 'TRADE' ? '이득 교환' : f.status === 'FIRST' ? `${MY_FIGHT_LABEL.FIRST}(${role})` : f.status === 'DIED' ? MY_FIGHT_LABEL.DIED : MY_FIGHT_LABEL.SURVIVED;
      need(b.text(`${p}.me`, '그 싸움에서 나', me));
      if (f.status === 'DIED' || f.status === 'TRADE') {
        need(b.num(`${p}.deathPoints`, `그 싸움의 내 데스로 상대 팀이 얻은 득실 점수 (데스 1번 = 내 포지션 점수 ${f.pointsPerDeath})`, Number(f.deathPoints), '점'));
        const md = b.num(`${p}.myDeaths`, '그 싸움에서 내 데스 수', Number(f.myDeaths), '번');
        if (f.status === 'TRADE') need(md);
        else ids.push(md);
      }
      if (f.status === 'TRADE') {
        // Q5(A4): 그 싸움에서 우리 팀이 잡은 오브젝트와 점수(5-3), 양 팀 데스 (이득 교환 근거)
        need(b.text(`${p}.objective`, '그 싸움에서 우리 팀이 잡은 오브젝트', String(f.objective)));
        need(b.num(`${p}.objectivePoints`, '그 오브젝트로 우리 팀이 얻은 득실 점수', Number(f.objectivePoints), '점'));
        ids.push(b.num(`${p}.ourDeaths`, '그 싸움에서 우리 팀 데스 (나 포함)', Number(f.ourDeaths), '번'));
        ids.push(b.num(`${p}.enemyDeaths`, '그 싸움에서 상대 팀 데스', Number(f.enemyDeaths), '번'));
      }
      need(b.text(`${p}.outcome`, '그 싸움 결과 (득실 기준)', f.won ? '우리 팀이 더 얻음' : '상대 팀이 더 얻음'));
      return { id: r.id, subjectId: r.subjectId, gist: meta.gist, action: meta.action, required: req, factIds: ids, text: String(f.text), mention };
    }
    case 'R5': {
      const p = 'rule.R5';
      if (typeof f.deathSec === 'number') need(b.min(`${p}.deathMin`, '오브젝트 싸움 밖 단독 데스 시각', f.deathSec));
      if (typeof f.deathSec === 'number') say(`${p}.deathMin`);
      if (typeof f.region === 'string') need(b.text(`${p}.region`, '그 단독 데스 지역', REGION_LABEL[f.region] ?? f.region));
      ids.push(b.num(`${p}.enemies`, '그 단독 데스에 관여한 상대 수', Number(f.enemies), '명'));
      break;
    }
    // ---------- Q4 ----------
    case 'R6': {
      const p = 'rule.R6';
      need(b.min(`${p}.min`, '상대 라이너에게 1:1로 죽은 시각', Number(f.sec)));
      say(`${p}.min`);
      if (typeof f.region === 'string') need(b.text(`${p}.region`, '그 1:1 데스 지역', REGION_LABEL[f.region] ?? f.region));
      if (typeof f.dealt === 'number' && typeof f.received === 'number') {
        need(b.num(`${p}.dealt`, '그 1:1 데스 직전 내가 준 피해', f.dealt, ''));
        need(b.num(`${p}.received`, '그 1:1 데스 직전 상대 라이너에게 받은 피해', f.received, ''));
      }
      if (typeof f.oneSided === 'boolean') ids.push(b.text(`${p}.trade`, '그 1:1 교환 결과', f.oneSided ? '일방적으로 당함' : '교환 끝에 짐'));
      // Q5(A3): 조언은 이 말 그대로
      if (typeof f.action === 'string') {
        actionText = f.action;
        ids.push(b.text(`${p}.action`, '이 규칙의 조언 (조언은 이 말 그대로 쓴다)', f.action));
      }
      break;
    }
    case 'R7': {
      const p = 'rule.R7';
      need(b.min(`${p}.min`, '상대 정글이 관여한 갱에 죽은 시각', Number(f.sec)));
      say(`${p}.min`);
      if (typeof f.region === 'string') need(b.text(`${p}.region`, '그 갱 데스 지역', REGION_LABEL[f.region] ?? f.region));
      if (typeof f.junglerId === 'number') {
        const name = nameOf(f.junglerId);
        allowedNames.push(name);
        need(b.text(`${p}.jungler`, '갱에 관여한 상대 정글 챔피언', name));
      }
      need(b.num(`${p}.wardsBefore`, '그 갱 데스 전 60초 동안 내가 설치한 와드', Number(f.wardsBefore), '개'));
      ids.push(b.num(`${p}.windowSec`, '와드를 세는 기준: 죽기 전 N초', LANING_DEATH_WARD_WINDOW_MS / 1000, '초'));
      break;
    }
    case 'R8': {
      const p = 'rule.R8';
      const cause = String(f.cause) as LaningCauseId;
      ids.push(b.text(`${p}.cause`, '라인전 골드·레벨 차의 가장 큰 원인 (상대가 앞선 것)', CAUSE_LABEL[cause] ?? cause));
      need(b.num(`${p}.me`, `${CAUSE_WHAT[cause] ?? cause} (나)`, Number(f.me), CAUSE_UNIT[cause] ?? ''));
      need(b.num(`${p}.enemy`, `${CAUSE_WHAT[cause] ?? cause} (상대)`, Number(f.enemy), CAUSE_UNIT[cause] ?? ''));
      say(`${p}.me`);
      say(`${p}.enemy`);
      // Q5(A2): "다음 판에는 ○○에 신경 쓰세요" 그대로
      actionText = String(f.action);
      ids.push(b.text(`${p}.action`, '이 원인에 맞춘 조언 (조언은 이 말 그대로 쓴다)', actionText));
      break;
    }
    case 'R9': {
      const p = 'rule.R9';
      need(b.num(`${p}.enemy`, '비교 시점까지 상대 라이너의 라인 밖(다른 라인·정글) 싸움 킬·어시스트', Number(f.enemy), '번'));
      need(b.num(`${p}.me`, '비교 시점까지 내 라인 밖(다른 라인·정글) 싸움 킬·어시스트', Number(f.me), '번'));
      say(`${p}.enemy`);
      say(`${p}.me`);
      const away = Array.isArray(f.awaySec) ? (f.awaySec as number[]) : [];
      away.slice(0, 3).forEach((t, i) => {
        const id = b.min(`${p}.away.${i}.min`, `상대 라이너가 라인 밖 싸움에 참여한 시각${i + 1}`, t);
        if (i === 0) need(id);
        else ids.push(id);
      });
      if (typeof f.awayRegion === 'string') ids.push(b.text(`${p}.awayRegion`, '상대 라이너가 처음 라인 밖 싸움에 간 지역', REGION_LABEL[f.awayRegion] ?? f.awayRegion));
      const plates = Array.isArray(f.platesWhileAwaySec) ? (f.platesWhileAwaySec as number[]) : [];
      ids.push(b.num(`${p}.platesWhileAway`, '상대가 라인 밖에 간 시각 앞뒤 60초 안에 내가 깬 방패 (잘한 점)', plates.length, '개'));
      ids.push(b.num(`${p}.windowSec`, '상대가 라인을 비운 동안으로 보는 기준: 앞뒤 N초', ROAM_PLATE_WINDOW_MS / 1000, '초'));
      if (plates.length > 0) ids.push(b.min(`${p}.platesWhileAway.0.min`, '그 방패를 깬 시각', plates[0]!));
      break;
    }
    case 'R10': {
      const p = 'rule.R10';
      need(b.min(`${p}.deathMin`, '오브젝트 싸움에서 내가 죽은 시각', Number(f.deathSec)));
      need(b.num(`${p}.afterSec`, '그 싸움 첫 킬 뒤 내가 죽기까지', Number(f.afterSec), '초'));
      say(`${p}.deathMin`);
      say(`${p}.afterSec`);
      ids.push(b.num(`${p}.surviveSec`, '오래 버티지 못했다고 보는 기준 (첫 킬 뒤)', Number(f.surviveSec), '초'));
      ids.push(b.min(`${p}.firstKillMin`, '그 싸움 첫 킬 시각', Number(f.firstKillSec)));
      // Q7: 그 싸움 1분 단위 추정 딜은 내지 않는다
      ids.push(b.text(`${p}.outcome`, '그 싸움 결과 (득실 기준)', f.won ? '우리 팀이 더 얻음' : '상대 팀이 더 얻음'));
      break;
    }
    case 'R11': {
      const p = 'rule.R11';
      need(b.min(`${p}.min`, '상대가 잡은 오브젝트 처치 시각', Number(f.sec)));
      need(b.text(`${p}.objective`, '상대가 잡은 오브젝트', OBJECTIVE_LABEL[String(f.objective)] ?? String(f.objective)));
      need(b.num(`${p}.controlWards`, '그 오브젝트 전 60초 동안 내가 설치한 제어 와드', Number(f.controlWards), '개'));
      ids.push(b.num(`${p}.windowSec`, '제어 와드를 세는 기준: 처치 전 N초', VISION_WINDOW_MS / 1000, '초'));
      say(`${p}.min`);
      say(`${p}.objective`);
      break;
    }
    // ---------- Q6 칭찬 규칙 (확정 값만. 추정 fact를 만들지 않는다) ----------
    case 'P1': {
      const p = 'rule.P1';
      ids.push(b.text(`${p}.teamRank`, '우리 팀 5명 안 게임 전체 챔피언 딜 순위', '팀에서 가장 많음 (1위)'));
      need(b.num(`${p}.teamSharePct`, '우리 팀 챔피언 딜 합 중 내 비중 (게임 전체)', Number(f.teamSharePct), '%'));
      ids.push(b.num(`${p}.damage`, '내 챔피언 딜 (게임 전체)', Number(f.damage), ''));
      const k = Number(f.phase);
      ids.push(b.num(`${p}.phase`, '딜 비중이 포지션 평균보다 가장 높았던 구간 번호 (0 = 0~15분, 1 = 15~30분, 2 = 30분 이후)', k, ''));
      const [from] = DAMAGE_PHASES[k] ?? [0];
      if (k > 0) ids.push(b.min(`${p}.phaseStartMin`, '그 구간 시작', from * 60));
      if (typeof f.phaseEndSec === 'number') ids.push(b.min(`${p}.phaseEndMin`, '그 구간 끝', f.phaseEndSec));
      need(b.num(`${p}.share`, '그 구간 챔피언 딜 비중', Number(f.share), '%'));
      need(b.num(`${p}.expected`, '그 구간 포지션 평균 딜 비중 (문장에는 player.roleAverage 이름으로, 예: "미드 딜러 평균 22%")', Number(f.expected), '%'));
      ids.push(b.num(`${p}.diffAbs`, '그 구간 딜 비중이 포지션 평균보다 높은 정도', Number(f.diff), '%p'));
      say(`${p}.teamSharePct`);
      break;
    }
    case 'P2': {
      const p = 'rule.P2';
      need(b.num(`${p}.count`, '게임 전체 1:1 킬 수 (킬러 나·어시스트 없음·상대가 죽기 직전 받은 챔피언 피해가 나뿐. 운영 "단독 킬"과 다른 수)', Number(f.count), '번'));
      say(`${p}.count`);
      praiseKills(b, p, f.secs, f.victimIds, '1:1 킬', nameOf, allowedNames).forEach((id) => ids.push(id));
      break;
    }
    case 'P3': {
      const weak = f.laningWeak === true && result.laning ? result.laning.cell.label : null;
      if (weak) ids.push(b.text('rule.P3.laning', '라인전 판정 (열세였음, 2-1 칸 이름)', weak));
      if (f.basis === 'kills') {
        const p = 'rule.P3.kills';
        need(b.num(`${p}.lateCount`, '30분 이후 1:1 킬 수', Number(f.lateCount), '번'));
        say(`${p}.lateCount`);
        ids.push(b.min(`${p}.lateMin`, '후반 기준 시각 (이 시각 이후)', Number(f.lateSec)));
        praiseKills(b, p, f.secs, f.victimIds, '30분 이후 1:1 킬', nameOf, allowedNames).forEach((id) => ids.push(id));
        break;
      }
      const p = 'rule.P3.damage';
      for (const k of [0, 1, 2]) {
        const v = f[`share${k}`];
        if (typeof v !== 'number') continue;
        const [from, to] = DAMAGE_PHASES[k]!;
        const id = b.num(`${p}.share${k}`, `${Number.isFinite(to) ? `${from}~${to}분` : `${from}분 이후`} 챔피언 딜 비중`, v, '%');
        if (k === 2) need(id);
        else ids.push(id);
      }
      say(`${p}.share2`);
      ids.push(b.num(`${p}.expected`, '30분 이후 포지션 평균 딜 비중 (문장에는 player.roleAverage 이름으로)', Number(f.expected), '%'));
      ids.push(b.num(`${p}.diffAbs`, '30분 이후 딜 비중이 포지션 평균보다 높은 정도', Number(f.diff), '%p'));
      ids.push(b.min(`${p}.lateMin`, '후반 기준 시각 (이 시각 이후)', Number(f.lateSec)));
      ids.push(b.text(`${p}.trend`, '구간 딜 비중의 흐름', f.rising === true ? '구간마다 올랐음' : '30분 이후가 가장 높음'));
      break;
    }
    case 'P4': {
      // Q7: 몫(%) 대신 두 팀 점수와 결과 + 그 싸움들에서 내 기여(확정 값). 높은 기여는 반드시 짚는다
      const p = 'rule.P4';
      need(b.num(`${p}.fights`, '내가 참여한 오브젝트 싸움 수', Number(f.fights), '번'));
      need(b.num(`${p}.ours`, '그 싸움들에서 킬·포탑·억제기·오브젝트를 점수로 합친 우리 팀 점수 (5-4 득실)', Number(f.ours), '점'));
      need(b.num(`${p}.theirs`, '그 싸움들에서 상대 팀 점수 (5-4 득실)', Number(f.theirs), '점'));
      ids.push(b.text(`${p}.outcome`, '두 팀 점수로 본 결과', String(f.outcome)));
      say(`${p}.fights`);
      ids.push(b.num('fight.windowSec', '오브젝트 싸움 기준: 처치 시각 앞뒤 N초', OBJECTIVE_WINDOW_MS / 1000, '초'));
      contributionFacts(b, p, f, 'high').forEach((x) => (x.required ? need(x.id) : ids.push(x.id)));
      break;
    }
    // ---------- Q7 ----------
    case 'R12': {
      const p = 'rule.R12';
      need(b.num(`${p}.fights`, '내가 참여한 오브젝트 싸움 수', Number(f.fights), '번'));
      say(`${p}.fights`);
      if (typeof f.ours === 'number' && typeof f.theirs === 'number') {
        ids.push(b.num(`${p}.ours`, '그 싸움들에서 킬·포탑·억제기·오브젝트를 점수로 합친 우리 팀 점수 (5-4 득실)', f.ours, '점'));
        ids.push(b.num(`${p}.theirs`, '그 싸움들에서 상대 팀 점수 (5-4 득실)', f.theirs, '점'));
      }
      if (typeof f.outcome === 'string') ids.push(b.text(`${p}.outcome`, '두 팀 점수로 본 결과', f.outcome));
      ids.push(b.num('fight.windowSec', '오브젝트 싸움 기준: 처치 시각 앞뒤 N초', OBJECTIVE_WINDOW_MS / 1000, '초'));
      contributionFacts(b, p, f, 'low').forEach((x) => {
        if (x.required) {
          need(x.id);
          say(x.id);
        } else ids.push(x.id);
      });
      break;
    }
  }
  return { id: r.id, subjectId: r.subjectId, gist: meta.gist, action: meta.action, required: req, factIds: ids, mention, ...(actionText ? { actionText } : {}) };
}
