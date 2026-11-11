// facts: LLM이 문장에 쓸 수 있는 숫자·이름 목록 (ai_spec 2-4).
// 엔진 결과(AnalysisResult)만 입력으로 하는 순수 함수. 엔진을 고치지 않고 파생값(차이 절댓값, 분 단위 시각)을 여기서 만든다.
// 등급·등급 점수·과목 점수·impact·반영 비율·총점은 넣지 않는다.
import { ADVICE_RULES, METRIC_LABEL, rulesFor } from '../advice.js';
import { DAMAGE_PHASES } from '../rules.js';
import { ROLE_LABEL } from '../role.js';
import type { AdviceRuleId, AnalysisResult, FactValue, FightScene, FiredRule, ObjectiveScene, PlayScene, Scenes } from '../types.js';
import { AREA_LABEL, FIRST_DEATH_LABEL, followUpLabel, OBJECTIVE_LABEL, REGION_LABEL, SUBJECT_FACT_LABEL, SUBJECT_LABEL, type Area } from './labels.js';

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

/** 칸에 붙은 조언 규칙 (Q3). 조언 문장은 이 규칙이 있을 때만, required fact를 인용해야 쓸 수 있다 */
export interface SlotRule {
  id: AdviceRuleId;
  /** 조언 요지 (advice.ts ADVICE_RULES) */
  gist: string;
  /** 행동 조언을 허용하는 규칙인가 (R4는 해석 문장만) */
  action: boolean;
  /** 문장에 반드시 인용할 fact ID */
  required: string[];
  /** 이 규칙의 fact ID 전체 (required 포함) */
  factIds: string[];
  /** R4: 5-4-1 표 문장 (그대로 써야 함) */
  text?: string;
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
  /** 이 칸에서 발동한 조언 규칙 (Q3). 없으면 빈 배열 = 조언 문장 금지 */
  rules: SlotRule[];
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

/** 초 → 게임 시계 표기 "분:초" (Q3, 2026-11-11 사용자 요청: "15.1분" → "15:06"). 초는 반올림 */
export function timeDisplay(sec: number): string[] {
  const total = Math.max(0, Math.round(sec));
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

  num(id: string, label: string, value: number, unit: string, approx?: number): string {
    return this.push({ id, label, value, unit, display: numberDisplay(value), ...(approx ? { approx: { step: approx } } : {}) });
  }

  /** 게임 시각 (값 = 초, 표기 = 분:초) */
  min(id: string, label: string, sec: number): string {
    return this.push({ id, label, value: Math.max(0, Math.round(sec)), unit: TIME_UNIT, display: timeDisplay(sec) });
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
      ids.push(b.num(`${it.id}.diffAbs`, `${name} 차이`, Math.abs(it.diff), it.id === 'laning.gold' ? '골드' : it.id === 'laning.cs' ? '개' : '', step));
      perItem.set(it.id, ids);
    }
    if (laning.deathsBeforeReferenceSec.length > 0) {
      laneCommon.push(b.num('laning.deathsBefore.count', '비교 시점 전 내 데스 수', laning.deathsBeforeReferenceSec.length, '번'));
      laning.deathsBeforeReferenceSec.forEach((s, i) => laneCommon.push(b.min(`laning.deathsBefore.${i}.min`, `비교 시점 전 ${i + 1}번째 데스 시각`, s)));
      // 장면 (Q2): 데스 지역·관여한 상대 (최대 3개, 시각 순)
      (result.scenes?.laningDeaths ?? []).forEach((d, i) => {
        const p = `laning.deathsBefore.${i}`;
        if (d.region) laneCommon.push(b.text(`${p}.region`, `라인전 데스${i + 1} 지역`, REGION_LABEL[d.region] ?? d.region));
        laneCommon.push(b.num(`${p}.enemies`, `라인전 데스${i + 1} 관여한 상대 수`, d.enemies, '명'));
        laneCommon.push(b.text(`${p}.jungler`, `라인전 데스${i + 1} 상대 정글`, d.enemyJungler ? '관여함' : '관여 안 함'));
      });
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
          // 라인전에는 조언 규칙이 없다 (Q3: 라인전 조언은 쓰지 않음)
          rules: [],
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
        if (result.scenes) ids.push(...sceneFacts(b, subjectId, result.scenes));
        const rules = rulesFor(result.advice, subjectId, kind).map((r) => ruleFacts(b, r, result, championNames));
        for (const r of rules) ids.push(...r.factIds);
        slots.push({ slot: `${area}.${kind}.${i}`, area, kind, subjectId, index: null, factIds: [...common, ...ids], rules });
      });
    }
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
  result.keyMoments.forEach((_, i) => {
    slots.push({ slot: `keyMoment.${i}`, area: 'keyMoment', kind: null, subjectId: null, index: i, factIds: [...common, ...kmIds[i]!], rules: [] });
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

function fightSceneFacts(b: Builder, p: string, n: number, f: FightScene): string[] {
  const ids = [
    b.min(`${p}.min`, `장면${n} 싸움 시각`, f.startSec),
    b.num(`${p}.killsOurs`, `장면${n} 우리 팀 킬`, f.killsOurs, '개'),
    b.num(`${p}.killsTheirs`, `장면${n} 상대 팀 킬`, f.killsTheirs, '개'),
    b.text(`${p}.outcome`, `장면${n} 득실`, outcomeText(f)),
    // 처음 죽은 사람 + 내 데스를 한 값으로 (토큰 절약)
    b.text(`${p}.firstDeath`, `장면${n} 처음 죽은 사람`, `${FIRST_DEATH_LABEL[f.firstDeath] ?? f.firstDeath}${f.firstDeath !== 'ME' ? (f.iDied ? ', 나도 죽음' : ', 나는 살아남음') : ''}`),
  ];
  const objs = objectivesText(f);
  if (objs) ids.push(b.text(`${p}.objectives`, `장면${n} 잡힌 오브젝트`, objs));
  if (f.region) ids.push(b.text(`${p}.region`, `장면${n} 지역`, REGION_LABEL[f.region] ?? f.region));
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
function sceneFacts(b: Builder, subjectId: string, scenes: Scenes): string[] {
  const ids = (WINDOW_FACTS[subjectId] ?? []).map((w) => windowFacts(b, w, scenes));
  const key = SCENE_SOURCE[subjectId];
  if (!key) return ids;
  const list = scenes[key] as readonly (ObjectiveScene | FightScene | PlayScene)[];
  list.forEach((x, i) => {
    const p = `scene.${subjectId}.${i}`;
    const n = i + 1;
    if (key === 'fightVision') ids.push(...objectiveSceneFacts(b, p, n, x as ObjectiveScene, true));
    else if (key === 'fightObjective') ids.push(...objectiveSceneFacts(b, p, n, x as ObjectiveScene, false));
    else if (key === 'macroSolo') ids.push(...playSceneFacts(b, p, n, x as PlayScene));
    else ids.push(...fightSceneFacts(b, p, n, x as FightScene));
  });
  return ids;
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

// ---------- 조언 규칙 facts (Q3) ----------

const pct = (v: FactValue | undefined): number | null => (typeof v === 'number' ? v : null);

/** 규칙 하나 → rule.* facts + 칸 규칙 정보 */
function ruleFacts(b: Builder, r: FiredRule, result: AnalysisResult, championNames: ReadonlyMap<number, string>): SlotRule {
  const meta = ADVICE_RULES[r.id];
  const ids: string[] = [];
  const req: string[] = [];
  const f = r.facts;
  const need = (id: string) => {
    ids.push(id);
    req.push(id);
  };
  switch (r.id) {
    case 'R1': {
      const p = `rule.R1.${r.subjectId}`;
      const [label, unit] = METRIC_LABEL[r.subjectId] ?? [SUBJECT_LABEL[r.subjectId] ?? r.subjectId, ''];
      const subjectName = SUBJECT_LABEL[r.subjectId] ?? r.subjectId;
      need(b.num(`${p}.weight`, `이 유형에서 ${subjectName}의 반영 비율 (영역 합 100)`, Number(f.weight), ''));
      need(b.num(`${p}.me`, `${label} (나)`, Number(f.me), unit));
      if (typeof f.opponent === 'number') {
        const oppId = result.laning?.opponent.championId;
        const who = oppId !== undefined ? `상대 라이너 ${championNames.get(oppId) ?? ''}`.trim() : '상대 라이너';
        need(b.num(`${p}.opponent`, `${label} (${who})`, f.opponent, unit));
      }
      break;
    }
    case 'R2':
    case 'R3': {
      const p = `rule.${r.id}`;
      need(b.num(`${p}.myDeaths`, '내가 참여한 오브젝트 싸움에서 내 데스 수', Number(f.myDeaths), '번'));
      need(b.num(`${p}.deathPoints`, `내 데스로 상대 팀이 얻은 득실 점수 (데스 1번 = 내 포지션 점수 ${f.pointsPerDeath})`, Number(f.deathPoints), '점'));
      ids.push(b.num(`${p}.pointsPerDeath`, '데스 1번에 상대 팀이 얻는 득실 점수 (내 포지션)', Number(f.pointsPerDeath), '점'));
      const share = pct(f.sharePct);
      if (share !== null) ids.push(b.num(`${p}.sharePct`, '오브젝트 싸움 득실 중 우리 팀 몫', share, '%'));
      const ds = pct(f.damageShare);
      const de = pct(f.damageExpected);
      const k = typeof f.damagePhase === 'number' ? f.damagePhase : null;
      if (ds !== null && de !== null && k !== null) {
        const [from, to] = DAMAGE_PHASES[k]!;
        const span = Number.isFinite(to) ? `${from}~${to}분` : `${from}분 이후`;
        const dsId = b.num(`${p}.damageShare`, `${span} 구간 챔피언 딜 비중`, ds, '%');
        if (r.id === 'R2') need(dsId);
        else ids.push(dsId);
        ids.push(b.num(`${p}.damageExpected`, `${span} 구간 이 유형의 기대 딜 비중`, de, '%'));
      }
      if (r.id === 'R3' && typeof f.keyMomentIndex === 'number') {
        const km = result.keyMoments[f.keyMomentIndex];
        if (km) ids.push(b.min(`keyMoment.${f.keyMomentIndex}.startMin`, `${f.keyMomentIndex + 1}번째 장면 싸움 시작`, km.startSec));
      }
      break;
    }
    case 'R4': {
      const p = `rule.R4.${r.kind}`;
      const who = f.firstVictimIsMe ? '내가' : '우리 팀 다른 사람이';
      const role = f.tank ? '탱커' : '딜러';
      if (typeof f.deathSec === 'number') need(b.min(`${p}.deathMin`, '우리 팀이 먼저 죽은 싸움의 첫 데스 시각', f.deathSec));
      need(b.text(`${p}.firstDeath`, '그 싸움에서 먼저 죽은 사람', `${who} 먼저 죽음(${role})`));
      need(b.text(`${p}.outcome`, '그 싸움 결과 (득실 기준)', f.won ? '우리 팀이 더 얻음' : '상대 팀이 더 얻음'));
      return { id: r.id, gist: meta.gist, action: meta.action, required: req, factIds: ids, text: String(f.text) };
    }
    case 'R5': {
      const p = 'rule.R5';
      if (typeof f.deathSec === 'number') need(b.min(`${p}.deathMin`, '오브젝트 싸움 밖 단독 데스 시각', f.deathSec));
      if (typeof f.region === 'string') need(b.text(`${p}.region`, '그 단독 데스 지역', REGION_LABEL[f.region] ?? f.region));
      ids.push(b.num(`${p}.enemies`, '그 단독 데스에 관여한 상대 수', Number(f.enemies), '명'));
      break;
    }
  }
  return { id: r.id, gist: meta.gist, action: meta.action, required: req, factIds: ids };
}
