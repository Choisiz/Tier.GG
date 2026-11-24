// 칭찬 규칙 (ai_spec Q6, feedback_design 8-2): 잘한 점도 코드가 조건을 판정하고 LLM은 문장으로만 옮긴다.
// 사용자 지적(2026-11-22) "딜을 많이 넣었으면 '캐리했다' 같은 긍정 피드백", "후반 솔킬은 아주 강력한 활력의 징후".
// 근거는 확정 데이터만: 게임 끝 챔피언 딜(팀 순위), 구간 딜 비중(5-2와 같은 누적 스냅샷 차이), 킬 직전 피해 출처(1:1 킬), 오브젝트 싸움 득실.
// 1분 단위로 어림한 싸움 딜·받은 피해·CC(추정 값)는 칭찬 근거로 쓰지 않는다.
// 판정(등급·점수·말할 순서)은 바꾸지 않는다. 운영 "단독 킬·데스"(6-1) 정의도 그대로이고, 1:1 킬은 문장 근거로만 더한다.
import { damagePhases, type DamagePhase } from './fight.js';
import { ADVANTAGE_OUTCOME, DAMAGE_PHASES, PRAISE } from './rules.js';
import { round, type MatchContext } from './timeline.js';
import type { Facts, FiredRule, JudgedResult } from './types.js';

const LATE_PHASE = DAMAGE_PHASES.findIndex(([from]) => from * 60 === PRAISE.lateSec);

/** 구간 번호 (0 = 0~15분, 1 = 15~30분, 2 = 30분 이후) */
const phaseIndex = (p: DamagePhase): number => DAMAGE_PHASES.findIndex(([from]) => from === p.fromMin);

/** 라인전이 열세였나 (2-1 칸의 요약 방향). P3 "라인전은 열세였지만 후반에 뒤집었다" */
const laningWeak = (me: JudgedResult): boolean => me.laning?.verdict === '열세';

/** 구간 딜 비중 facts (share0~2, 있는 구간만, 소수 둘째 자리) */
function phaseShares(phases: readonly DamagePhase[]): Facts {
  const f: Facts = {};
  for (const p of phases) f[`share${phaseIndex(p)}`] = round(p.share, 2);
  return f;
}

// ---------- P1 딜 캐리 ----------

/** P1: 팀 챔피언 딜 1위이고, 어떤 구간 딜 비중이 기대치 + carryDiff 이상 (차이가 가장 큰 구간을 짚는다) */
export function ruleP1(me: JudgedResult, phases: readonly DamagePhase[]): FiredRule[] {
  const td = me.scenes.teamDamage;
  if (!td || td.rank !== 1 || phases.length === 0) return [];
  const best = [...phases].sort((a, b) => b.diff - a.diff)[0]!;
  if (best.diff < PRAISE.carryDiff) return [];
  return [
    {
      id: 'P1',
      subjectId: 'fight.damage',
      kind: 'good',
      facts: {
        teamRank: td.rank,
        damage: td.damage,
        teamDamage: td.teamTotal,
        teamSharePct: td.sharePct,
        phase: phaseIndex(best),
        // 구간 끝(초). 30분 이후 구간은 끝이 없어 null, 게임이 구간 끝 전에 끝났으면 마지막 스냅샷 시각
        phaseEndSec: Number.isFinite(DAMAGE_PHASES[phaseIndex(best)]![1]) ? Math.round(Math.min(DAMAGE_PHASES[phaseIndex(best)]![1] * 60, best.toMin * 60)) : null,
        share: round(best.share, 2),
        expected: best.expected,
        diff: round(best.diff, 2),
        carryDiff: PRAISE.carryDiff,
      },
    },
  ];
}

// ---------- P2 1:1 킬 ----------

/** P2: 1:1 킬(scenes.soloKills) ≥ soloKillsMin. 운영 단독 킬·데스 좋은 점 칸에 붙는다 */
export function ruleP2(me: JudgedResult): FiredRule[] {
  const ks = me.scenes.soloKills;
  if (ks.length < PRAISE.soloKillsMin) return [];
  return [
    {
      id: 'P2',
      subjectId: 'macro.solo',
      kind: 'good',
      facts: { count: ks.length, secs: ks.map((k) => k.sec), victimIds: ks.map((k) => k.victimId), lateCount: ks.filter((k) => k.sec >= PRAISE.lateSec).length },
    },
  ];
}

// ---------- P3 후반 영향력 ----------

/**
 * P3: 후반(30분 이후)으로 갈수록 강해졌다. 근거마다 다른 칸에 붙는다.
 * - 교전 딜 칸(basis damage): 30분 이후 구간 딜 비중이 세 구간 중 가장 높고 기대치 + lateDiff 이상
 * - 운영 단독 킬·데스 칸(basis kills): 30분 이후 1:1 킬 ≥ lateSoloKillsMin
 * 라인전이 열세였으면 laningWeak = true ("라인전은 열세였지만 후반에 뒤집었다").
 */
export function ruleP3(me: JudgedResult, phases: readonly DamagePhase[]): FiredRule[] {
  const out: FiredRule[] = [];
  const weak = laningWeak(me);
  const late = phases.find((p) => phaseIndex(p) === LATE_PHASE);
  if (late && phases.every((p) => p === late || p.share < late.share) && late.diff >= PRAISE.lateDiff) {
    const ordered = [...phases].sort((a, b) => a.fromMin - b.fromMin);
    out.push({
      id: 'P3',
      subjectId: 'fight.damage',
      kind: 'good',
      facts: {
        basis: 'damage',
        ...phaseShares(phases),
        expected: late.expected,
        diff: round(late.diff, 2),
        // 구간마다 비중이 계속 올랐나 (문장 "후반으로 갈수록 높아져")
        rising: ordered.every((p, i) => i === 0 || p.share > ordered[i - 1]!.share),
        lateSec: PRAISE.lateSec,
        laningWeak: weak,
      },
    });
  }
  const lateKills = me.scenes.soloKills.filter((k) => k.sec >= PRAISE.lateSec);
  if (lateKills.length >= PRAISE.lateSoloKillsMin) {
    out.push({
      id: 'P3',
      subjectId: 'macro.solo',
      kind: 'good',
      facts: {
        basis: 'kills',
        lateCount: lateKills.length,
        count: me.scenes.soloKills.length,
        secs: lateKills.map((k) => k.sec),
        victimIds: lateKills.map((k) => k.victimId),
        lateSec: PRAISE.lateSec,
        laningWeak: weak,
      },
    });
  }
  return out;
}

// ---------- P4 오브젝트 싸움 기여 ----------

/**
 * P4: 오브젝트 싸움 득실 등급 A이고 참여한 싸움 ≥ objectiveFightsMin (발동 조건은 Q6 그대로).
 * Q7: 문장은 몫(%) 대신 두 팀 점수와 결과, 그리고 그 싸움들에서 내 기여(확정 값, scenes.objectiveContribution). 높은 기여만 칭찬 근거로 짚는다.
 */
export function ruleP4(me: JudgedResult): FiredRule[] {
  const adv = me.fight.subjects.find((s) => s.id === 'fight.advantage');
  const fights = adv?.facts.fights;
  if (!adv || adv.grade !== 'A' || typeof fights !== 'number' || fights < PRAISE.objectiveFightsMin) return [];
  const c = me.scenes.objectiveContribution;
  // 낮은 기여(LOW)는 칭찬 칸에 쓰지 않는다 (그 값은 R12 부족한 점 근거)
  const contribution: Facts = c
    ? {
        teamKills: c.teamKills,
        involvement: c.myKills + c.myAssists,
        involvementPct: c.involvementLevel === 'LOW' ? null : c.involvementPct,
        killedDamagePct: c.killedDamageLevel === 'LOW' ? null : c.killedDamagePct,
        involvementHigh: c.involvementLevel === 'HIGH',
        killedDamageHigh: c.killedDamageLevel === 'HIGH',
        myKillPoints: c.myKillPoints,
        myDeathPoints: c.myDeathPoints,
        lastHits: c.lastHits.length,
      }
    : {};
  return [
    {
      id: 'P4',
      subjectId: 'fight.advantage',
      kind: 'good',
      facts: { fights, sharePct: adv.facts.sharePct ?? null, ours: adv.facts.ours ?? null, theirs: adv.facts.theirs ?? null, outcome: ADVANTAGE_OUTCOME.A, ...contribution },
    },
  ];
}

/** 칭찬 규칙 모으기 (P1 → P2 → P3 → P4). Riot 호출·DB 없음 */
export function buildPraise(ctx: MatchContext, me: JudgedResult): FiredRule[] {
  const phases = ctx.hasFrames ? damagePhases(ctx) : [];
  return [...ruleP1(me, phases), ...ruleP2(me), ...ruleP3(me, phases), ...ruleP4(me)];
}

/** 칭찬 규칙인가 */
export const isPraise = (id: string): boolean => /^P[1-4]$/.test(id);

/** 칭찬 근거의 세기 (좋은 점 칸 순서: 가장 강한 근거 먼저, ai_spec Q6). 딜 캐리 > 후반 영향력 > 1:1 킬 > 오브젝트 싸움 기여 */
export const PRAISE_STRENGTH: Readonly<Record<string, number>> = { P1: 4, P3: 3, P2: 2, P4: 1 };
