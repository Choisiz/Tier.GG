// 조언 규칙표 (ai_spec Q3 / RAG3): "데이터로 유추하지 못하는 피드백은 하지 않는다" (사용자 원칙 2026-11-11).
// 조언도 코드가 고른다. 조건은 feedback_design.md에 이미 정한 규칙(반영 비율 5-1·6-2, 득실 점수 5-4, 첫 데스 해석 5-4-1,
// 단독 킬·데스 6-1)과 기존 등급만 쓴다. 새 경계값은 R1의 "반영 비율 30 이상" 하나다.
// 판정(등급·점수·말할 순서)은 바꾸지 않는다. 엔진이 다 계산한 뒤 문장 재료만 더한다.
import { objectiveFights, type ObjectiveKill } from './fights.js';
import { DAMAGE_PHASES, KILL_POINTS } from './rules.js';
import type { MatchContext } from './timeline.js';
import type { AdviceResult, AdviceRuleId, Facts, FiredRule, Grade, JudgedResult, KeyMoment, Note, Scenes, SubjectResult } from './types.js';

export type { AdviceResult, AdviceRuleId, FiredRule } from './types.js';

/** 규칙표 (ai_spec Q3). gist = 조언 요지 (LLM 프롬프트에 그대로 준다) */
export const ADVICE_RULES: Readonly<Record<AdviceRuleId, { basis: string; gist: string; action: boolean }>> = {
  R1: {
    basis: '반영 비율 (5-1, 6-2)',
    gist: '이 유형은 이 과목의 비중이 크다(반영 비율). 그런데 이 판에서 이 과목이 부족했고 상대 라이너보다도 낮았다 → 이 과목에 신경 쓰라. 이 과목의 장면이 있으면 하나를 짚는다',
    action: true,
  },
  R2: {
    basis: '득실 점수 (5-4) + 딜 등급',
    gist: '오브젝트 싸움에서 딜 비중도 기대치보다 낮고, 내 데스가 상대 팀 득실 점수가 됐다 → 싸움 기여가 매우 적었다. 오브젝트 싸움에서 죽지 않을 위치를 잡으라',
    action: true,
  },
  R3: {
    basis: '득실 점수 (5-4) + 딜 등급',
    gist: '딜 비중은 기대치보다 높았지만 내 데스가 상대 팀 득실 점수가 되어 싸움을 내줬다 → 이런 데스가 역전의 시발점이 된다. 내가 죽은 결정적 장면이 있으면 그 장면과 연결한다',
    action: true,
  },
  R4: {
    basis: '첫 데스 해석 (5-4-1)',
    gist: '싸움에서 먼저 죽은 사람(탱/딜러)과 싸움 결과(승/패)에 맞는 5-4-1 표 문장을 그대로 쓴다. 해석일 뿐이므로 행동 조언은 붙이지 않는다',
    action: false,
  },
  R5: {
    basis: '단독 킬·데스 (6-1)',
    gist: '오브젝트 싸움 밖에서 혼자 싸워 죽은 장면이 있다 → 그 시각·지역을 짚고, 그런 상황에서 혼자 싸우지 않도록 하라',
    action: true,
  },
};

/** R1: 부족한 과목의 반영 비율이 이 값 이상일 때만 (ai_spec Q3의 유일한 새 경계값) */
export const R1_MIN_WEIGHT = 30;

const BAD: readonly Grade[] = ['D', 'E'];
const HIGH: readonly Grade[] = ['A', 'B'];

/** R1에서 상대와 비교하는 값: 과목마다 엔진 facts의 값 하나 (같은 판·같은 계산) */
export function subjectMetric(s: SubjectResult | undefined): number | null {
  if (!s || s.grade === null) return null;
  const f = s.facts;
  const num = (k: string) => (typeof f[k] === 'number' ? (f[k] as number) : null);
  switch (s.id) {
    case 'fight.advantage':
    case 'macro.advantage':
      return num('sharePct');
    case 'fight.damage': {
      // 구간별 팀 내 딜 비중의 평균 (같은 구간끼리 비교)
      const shares = DAMAGE_PHASES.map((_, k) => num(`share${k}`)).filter((x): x is number => x !== null);
      return shares.length > 0 ? Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 10) / 10 : null;
    }
    case 'fight.vision':
      return num('perObjective');
    case 'fight.objective':
      return num('lastHitPoints');
    case 'macro.solo':
      return num('net');
    case 'macro.side':
    case 'macro.farm':
    case 'macro.vision':
      return num('perMinute');
    default:
      return null;
  }
}

/** R1 비교값의 이름 (사람이 읽는 말, 단위) */
export const METRIC_LABEL: Readonly<Record<string, readonly [string, string]>> = {
  'fight.advantage': ['오브젝트 싸움 득실 중 우리 팀 몫', '%'],
  'fight.damage': ['챔피언 딜 비중(구간 평균)', '%'],
  'fight.vision': ['오브젝트당 시야 점수', ''],
  'fight.objective': ['오브젝트 막타로 얻은 점수', ''],
  'macro.advantage': ['오브젝트 밖 싸움 득실 중 우리 팀 몫', '%'],
  'macro.solo': ['단독 킬에서 단독 데스를 뺀 값', ''],
  'macro.side': ['분당 포탑 피해량', ''],
  'macro.farm': ['15분 이후 분당 CS', '개'],
  'macro.vision': ['분당 시야 점수', ''],
};

function subjectOf(r: JudgedResult, id: string): SubjectResult | undefined {
  return [...r.fight.subjects, ...r.macro.subjects].find((s) => s.id === id);
}

/** 장면 키 (R1의 "그 과목 장면 1개") */
const SCENE_KEY: Readonly<Record<string, keyof Scenes>> = {
  'fight.vision': 'fightVision',
  'fight.objective': 'fightObjective',
  'fight.advantage': 'fightAdvantage',
  'macro.advantage': 'macroAdvantage',
  'macro.solo': 'macroSolo',
};

// ---------- R1 ----------

export function ruleR1(me: JudgedResult, opp: JudgedResult | null): FiredRule[] {
  const out: FiredRule[] = [];
  for (const s of [...me.fight.subjects, ...me.macro.subjects]) {
    if (s.grade === null || !BAD.includes(s.grade) || s.weight < R1_MIN_WEIGHT) continue;
    const mine = subjectMetric(s);
    if (mine === null) continue;
    const theirs = opp ? subjectMetric(subjectOf(opp, s.id)) : null;
    // 상대에게도 계산할 수 있으면 상대보다 낮을 때만
    if (theirs !== null && !(mine < theirs)) continue;
    const key = SCENE_KEY[s.id];
    const hasScene = key ? (me.scenes[key] as readonly unknown[]).length > 0 : false;
    out.push({
      id: 'R1',
      subjectId: s.id,
      kind: 'bad',
      facts: { weight: s.weight, me: mine, opponent: theirs, hasScene },
    });
  }
  return out;
}

// ---------- R2 · R3 ----------

/** 내가 참여한 오브젝트 싸움 안의 내 데스 수 (데스가 있으면 그 싸움에 참여한 것) */
export function myObjectiveFightDeaths(ctx: MatchContext, objectives: readonly ObjectiveKill[]): number {
  let n = 0;
  for (const f of objectiveFights(ctx, objectives)) {
    if (!f.involved.has(ctx.me.participantId)) continue;
    n += f.kills.filter((k) => k.victimId === ctx.me.participantId).length;
  }
  return n;
}

/** 딜 구간 중 기대치와 차이가 가장 큰 쪽 (R2: 가장 낮은 구간, R3: 가장 높은 구간) */
function damagePhase(s: SubjectResult, lowest: boolean): { k: number; share: number; expected: number } | null {
  let best: { k: number; share: number; expected: number; diff: number } | null = null;
  DAMAGE_PHASES.forEach((_, k) => {
    const share = s.facts[`share${k}`];
    const expected = s.facts[`expected${k}`];
    const diff = s.facts[`diff${k}`];
    if (typeof share !== 'number' || typeof expected !== 'number' || typeof diff !== 'number') return;
    if (!best || (lowest ? diff < best.diff : diff > best.diff)) best = { k, share, expected, diff };
  });
  return best;
}

/** 내가 죽은 결정적 장면 (R3) */
function deathKeyMoment(kms: readonly KeyMoment[]): number | null {
  const i = kms.findIndex((m) => m.playerDied);
  return i >= 0 ? i : null;
}

/** R2·R3. deaths = 내가 참여한 오브젝트 싸움 안의 내 데스 수 */
export function ruleR2R3(me: JudgedResult, deaths: number): FiredRule[] {
  const dmg = subjectOf(me, 'fight.damage');
  const adv = subjectOf(me, 'fight.advantage');
  if (!dmg?.grade || !adv?.grade || !BAD.includes(adv.grade)) return [];
  if (deaths === 0) return [];
  // 5-4: 킬 점수 = 죽은 플레이어의 포지션 점수. 내 데스 1번마다 상대 팀이 내 포지션 점수를 얻는다
  const per = KILL_POINTS[me.player.position];
  const base: Facts = {
    myDeaths: deaths,
    pointsPerDeath: per,
    deathPoints: per * deaths,
    sharePct: (adv.facts.sharePct as number | undefined) ?? null,
    ours: (adv.facts.ours as number | undefined) ?? null,
    theirs: (adv.facts.theirs as number | undefined) ?? null,
  };
  if (BAD.includes(dmg.grade)) {
    const ph = damagePhase(dmg, true);
    const facts: Facts = { ...base, damagePhase: ph?.k ?? null, damageShare: ph?.share ?? null, damageExpected: ph?.expected ?? null };
    return [
      { id: 'R2', subjectId: 'fight.damage', kind: 'bad', facts },
      { id: 'R2', subjectId: 'fight.advantage', kind: 'bad', facts },
    ];
  }
  if (HIGH.includes(dmg.grade)) {
    const ph = damagePhase(dmg, false);
    return [
      {
        id: 'R3',
        subjectId: 'fight.advantage',
        kind: 'bad',
        facts: { ...base, damagePhase: ph?.k ?? null, damageShare: ph?.share ?? null, damageExpected: ph?.expected ?? null, keyMomentIndex: deathKeyMoment(me.keyMoments) },
      },
    ];
  }
  return [];
}

// ---------- R4 ----------

export function ruleR4(notes: readonly Note[]): FiredRule[] {
  const out: FiredRule[] = [];
  for (const kind of ['bad', 'good'] as const) {
    const want = kind === 'bad' ? 'LOSS' : 'WIN';
    const cands = notes.filter((n) => n.id === 'fight.firstDeath' && n.key.endsWith(want));
    if (cands.length === 0) continue;
    // 득실 차가 가장 큰 싸움 (같으면 이른 싸움)
    const margin = (n: Note) => Math.abs(Number(n.facts.ours ?? 0) - Number(n.facts.theirs ?? 0));
    const n = [...cands].sort((a, b) => margin(b) - margin(a) || Number(a.facts.deathSec) - Number(b.facts.deathSec))[0]!;
    out.push({
      id: 'R4',
      subjectId: 'fight.advantage',
      kind,
      facts: {
        key: n.key,
        text: n.text,
        deathSec: n.facts.deathSec ?? null,
        firstVictimIsMe: n.facts.firstVictimIsMe ?? null,
        tank: n.key.startsWith('TANK'),
        won: n.key.endsWith('WIN'),
      },
    });
  }
  return out;
}

// ---------- R5 ----------

export function ruleR5(me: JudgedResult): FiredRule[] {
  const solo = subjectOf(me, 'macro.solo');
  if (!solo?.grade || !BAD.includes(solo.grade)) return [];
  const death = me.scenes.macroSolo.find((s) => s.kind === 'DEATH');
  if (!death) return [];
  return [{ id: 'R5', subjectId: 'macro.solo', kind: 'bad', facts: { deathSec: death.sec, region: death.region, enemies: death.enemies, enemyJungler: death.enemyJungler } }];
}

/**
 * 판정이 끝난 결과(me)와 상대 라이너의 결과(opp, 같은 판을 상대 puuid로 분석)로 발동한 규칙을 모은다.
 * Riot 호출·DB 없음.
 */
export function buildAdvice(
  ctx: MatchContext,
  objectives: readonly ObjectiveKill[],
  me: JudgedResult,
  opp: JudgedResult | null,
  opponentParticipantId: number | null,
): AdviceResult {
  return {
    rules: [...ruleR1(me, opp), ...ruleR2R3(me, myObjectiveFightDeaths(ctx, objectives)), ...ruleR4(me.notes), ...ruleR5(me)],
    opponentParticipantId,
  };
}

/** 칸(과목 × 방향)에 붙은 규칙 */
export function rulesFor(advice: AdviceResult | undefined, subjectId: string | null, kind: 'good' | 'bad' | null): FiredRule[] {
  if (!advice || !subjectId || !kind) return [];
  return advice.rules.filter((r) => r.subjectId === subjectId && r.kind === kind);
}
