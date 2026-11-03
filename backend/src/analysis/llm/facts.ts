// facts: LLM이 문장에 쓸 수 있는 숫자·이름 목록 (ai_spec 2-4).
// 엔진 결과(AnalysisResult)만 입력으로 하는 순수 함수. 엔진을 고치지 않고 파생값(차이 절댓값, 분 단위 시각)을 여기서 만든다.
// 등급·등급 점수·과목 점수·impact·반영 비율·총점은 넣지 않는다.
import { ROLE_LABEL } from '../role.js';
import type { AnalysisResult, FactValue } from '../types.js';
import { AREA_LABEL, followUpLabel, SUBJECT_FACT_LABEL, SUBJECT_LABEL, type Area } from './labels.js';

export interface Fact {
  id: string;
  label: string;
  value: number | string;
  unit: string;
  /** 문장에 쓸 수 있는 표기. 숫자는 이 표기(또는 approx 어림)만 허용 */
  display: string[];
  /** "약 N"·"N 넘게"·"N 가까이" 어림을 허용할 때 단위 */
  approx?: { step: number };
}

export type SlotKind = 'good' | 'bad';

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
}

/** 영역마다 좋은 점·부족한 점 각각 최대 몇 개를 말하나 (2-1) */
export const MAX_PER_KIND = 2;

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

/** 초 → 분 표기: 첫째 자리 반올림 "N.N"과 내림한 정수 분 "N" (게임 시계 읽는 법) */
export function minuteDisplay(sec: number): string[] {
  const m1 = round(sec / 60, 1);
  const floor = Math.floor(sec / 60);
  return uniq([String(m1), String(floor)]);
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

class Builder {
  readonly facts: Fact[] = [];
  readonly byId = new Map<string, Fact>();

  num(id: string, label: string, value: number, unit: string, approx?: number): string {
    return this.push({ id, label, value, unit, display: numberDisplay(value), ...(approx ? { approx: { step: approx } } : {}) });
  }

  min(id: string, label: string, sec: number): string {
    return this.push({ id, label, value: round(sec / 60, 2), unit: '분', display: minuteDisplay(sec) });
  }

  text(id: string, label: string, value: string): string {
    return this.push({ id, label, value, unit: '', display: [value] });
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
  common.push(b.text('player.result', '승패', result.player.win ? '승리' : '패배'));
  common.push(b.min('player.durationMin', '게임 시간', result.player.durationSec));
  const allowedNames = [myName];

  const slots: Slot[] = [];

  // ---------- 라인전 ----------
  const laning = result.laning;
  if (laning) {
    const opp = championNames.get(laning.opponent.championId) ?? `챔피언 ${laning.opponent.championId}`;
    allowedNames.push(opp);
    common.push(b.text('laning.opponent', '상대 라이너 챔피언', opp));
    const laneCommon = [b.min('laning.referenceMin', '라인전 비교 시점', laning.referenceSec)];
    const perItem = new Map<string, string[]>();
    for (const it of laning.items) {
      const ids: string[] = [];
      const name = SUBJECT_LABEL[it.id] ?? it.id;
      const step = it.id === 'laning.gold' ? GOLD_STEP : undefined;
      if (it.id === 'laning.kda') {
        const formula = String(it.detail?.formula ?? '(K+A)-D');
        const formulaLabel = formula === 'K-D' ? '킬에서 데스를 뺀 값' : '킬과 어시스트를 더하고 데스를 뺀 값';
        ids.push(b.text('laning.kda.formula', 'KDA 비교 방식', formulaLabel));
        ids.push(b.num('laning.kda.me', `${formulaLabel} (나)`, it.me, ''));
        ids.push(b.num('laning.kda.enemy', `${formulaLabel} (상대)`, it.enemy, ''));
        const kdaKeys = ['kills', 'deaths', 'assists'] as const;
        const kdaLabel = { kills: '킬', deaths: '데스', assists: '어시스트' } as const;
        for (const who of ['me', 'enemy'] as const) {
          const arr = it.detail?.[who];
          if (Array.isArray(arr)) {
            kdaKeys.forEach((k, i) => {
              const v = arr[i];
              if (typeof v === 'number') ids.push(b.num(`laning.kda.${who}.${k}`, `비교 시점까지 ${who === 'me' ? '내' : '상대'} ${kdaLabel[k]}`, v, '번'));
            });
          }
        }
      } else {
        const unit = it.id === 'laning.gold' ? '골드' : it.id === 'laning.cs' ? '개' : '';
        ids.push(b.num(`${it.id}.me`, `${name} (나)`, it.me, unit, step));
        ids.push(b.num(`${it.id}.enemy`, `${name} (상대)`, it.enemy, unit, step));
      }
      ids.push(b.num(`${it.id}.diffAbs`, `${name} 차이`, Math.abs(it.diff), it.id === 'laning.gold' ? '골드' : '', step));
      perItem.set(it.id, ids);
    }
    if (laning.deathsBeforeReferenceSec.length > 0) {
      laneCommon.push(b.num('laning.deathsBefore.count', '비교 시점 전 내 데스 수', laning.deathsBeforeReferenceSec.length, '번'));
      laning.deathsBeforeReferenceSec.forEach((s, i) => laneCommon.push(b.min(`laning.deathsBefore.${i}.min`, `비교 시점 전 ${i + 1}번째 데스 시각`, s)));
    }
    for (const kind of ['good', 'bad'] as const) {
      result.speakOrder.laning[kind].slice(0, MAX_PER_KIND).forEach((subjectId, i) => {
        slots.push({
          slot: `laning.${kind}.${i}`,
          area: 'laning',
          kind,
          subjectId,
          index: null,
          factIds: [...common, ...laneCommon, ...(perItem.get(subjectId) ?? [])],
        });
      });
    }
  }

  // ---------- 교전·운영 ----------
  for (const area of ['fight', 'macro'] as const) {
    for (const kind of ['good', 'bad'] as const) {
      result.speakOrder[area][kind].slice(0, MAX_PER_KIND).forEach((subjectId, i) => {
        const subject = result[area].subjects.find((s) => s.id === subjectId);
        const ids = subject ? subjectFacts(b, subjectId, subject.facts) : [];
        slots.push({ slot: `${area}.${kind}.${i}`, area, kind, subjectId, index: null, factIds: [...common, ...ids] });
      });
    }
  }

  // ---------- 결정적 장면 ----------
  const kmIds: string[][] = result.keyMoments.map((m, i) => {
    const p = `keyMoment.${i}`;
    const ids = [
      b.min(`${p}.startMin`, `${i + 1}번째 장면 싸움 시작`, m.startSec),
      b.min(`${p}.endMin`, `${i + 1}번째 장면 마지막 킬`, m.endSec),
      b.num(`${p}.kills`, `${i + 1}번째 장면 킬 수 (양 팀 합)`, m.kills, '개'),
      b.num(`${p}.killsOurs`, `${i + 1}번째 장면 우리 팀 킬`, m.killsOurs, '개'),
      b.num(`${p}.killsTheirs`, `${i + 1}번째 장면 상대 팀 킬`, m.killsTheirs, '개'),
      b.num(`${p}.goldGapBeforeAbs`, `${i + 1}번째 장면 전 팀 골드 격차`, Math.abs(m.goldDiffBefore), '골드', GOLD_STEP),
      b.num(`${p}.goldGapAfterAbs`, `${i + 1}번째 장면 뒤 팀 골드 격차`, Math.abs(m.goldDiffAfter), '골드', GOLD_STEP),
      b.num(`${p}.gapChangeAbs`, `${i + 1}번째 장면 골드 격차 변화`, Math.abs(m.gapChange), '골드', GOLD_STEP),
      b.text(`${p}.leaderBefore`, `${i + 1}번째 장면 전 골드가 앞선 팀`, leader(m.goldDiffBefore)),
      b.text(`${p}.leaderAfter`, `${i + 1}번째 장면 뒤 골드가 앞선 팀`, leader(m.goldDiffAfter)),
    ];
    m.followUps.forEach((f, j) => ids.push(b.text(`${p}.followUp.${j}`, `${i + 1}번째 장면 뒤 이어진 일`, followUpLabel(f.what, f.ours))));
    return ids;
  });
  result.keyMoments.forEach((_, i) => {
    slots.push({ slot: `keyMoment.${i}`, area: 'keyMoment', kind: null, subjectId: null, index: i, factIds: [...common, ...kmIds[i]!] });
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
  };
}

function leader(diff: number): string {
  if (diff > 0) return '우리 팀';
  if (diff < 0) return '상대 팀';
  return '같음';
}

/** 과목 facts를 평평하게. 배열 구간 [시작분, 끝분]은 phaseNStartMin/EndMin, 음수 diff·net은 절댓값 fact로. SUBJECT_FACT_LABEL에 없는 키는 버린다 */
function subjectFacts(b: Builder, subjectId: string, facts: Record<string, FactValue>): string[] {
  const ids: string[] = [];
  for (const [key, v] of Object.entries(facts)) {
    if (/^phase\d$/.test(key) && Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') {
      const n = key.slice(5);
      const label = n === '0' ? '첫 구간' : '둘째 구간';
      ids.push(b.min(`${subjectId}.phase${n}StartMin`, `딜 비중 ${label} 시작`, v[0] * 60));
      ids.push(b.min(`${subjectId}.phase${n}EndMin`, `딜 비중 ${label} 끝`, v[1] * 60));
      continue;
    }
    if (typeof v !== 'number') continue;
    const absKey = /^(diff\d|net)$/.test(key) ? `${key}Abs` : key;
    const meta = SUBJECT_FACT_LABEL[`${subjectId}.${absKey}`];
    if (!meta) continue;
    const value = absKey === key ? v : Math.abs(v);
    ids.push(b.num(`${subjectId}.${absKey}`, meta[0], value, meta[1]));
  }
  return ids;
}

export const AREA_NAMES = AREA_LABEL;
