// 조언 규칙표 (ai_spec Q3 / RAG3): "데이터로 유추하지 못하는 피드백은 하지 않는다" (사용자 원칙 2026-11-11).
// 조언도 코드가 고른다. 조건은 feedback_design.md에 이미 정한 규칙(반영 비율 5-1·6-2, 득실 점수 5-4, 첫 데스 해석 5-4-1,
// 단독 킬·데스 6-1)과 기존 등급만 쓴다. 새 경계값은 R1의 "반영 비율 30 이상" 하나다.
// 판정(등급·점수·말할 순서)은 바꾸지 않는다. 엔진이 다 계산한 뒤 문장 재료만 더한다.
// Q4(2026-11-19): R6~R11 추가. 라인전 2-1·2-2·2-3과 오브젝트 싸움 버티기·제어 와드 근거로 고른다 (경계값은 rules.ts, 근거는 feedback_design 3-1~3-3·5-6).
// Q5(2026-11-22): 사용자 채점 반영 — R4 이득 교환(A4), R6·R8 조언 문구(A2·A3), R5는 R6 데스를 건너뜀(C2), R10은 라인전 데스·소규모 싸움 제외(C1).
// Q6(2026-11-22): 칭찬 규칙 P1~P4 (praise.ts). 좋은 점 칸에만 붙고 행동 조언은 없다(action false). 같은 표·같은 FiredRule로 모은다.
// Q7(2026-11-24): R12 오브젝트 싸움 내 기여 낮음(확정 값, 해석만). R10은 1분 단위 추정 딜을 근거로 넘기지 않는다.
import { inWindow, objectiveFights, type ObjectiveKill } from './fights.js';
import { OBJECTIVE_LABEL } from './llm/labels.js';
import { buildPraise } from './praise.js';
import { TANK_ROLES } from './role.js';
import { ADVANTAGE_OUTCOME, DAMAGE_PHASES, KILL_POINTS, LANING, PRAISE, SURVIVE_MIN_INVOLVED, SURVIVE_SEC, VISION_OBJECTIVE_TYPES } from './rules.js';
import { OBJECTIVE_WEIGHT, objectiveScenes } from './scenes.js';
import { LANING_SUBJECTS } from './summary.js';
import { sec, type MatchContext } from './timeline.js';
import type { AdviceResult, AdviceRuleId, Facts, FiredRule, Grade, JudgedResult, KeyMoment, LaningCauseId, LaningDeath, Scenes, SubjectResult } from './types.js';

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
    gist: '오브젝트 싸움에서 딜 비중도 포지션 평균보다 낮고, 내 데스가 상대 팀 득실 점수가 됐다 → 싸움 기여가 매우 적었다. 오브젝트 싸움에서 죽지 않을 위치를 잡으라',
    action: true,
  },
  R3: {
    basis: '득실 점수 (5-4) + 딜 등급',
    gist: '딜 비중은 포지션 평균보다 높았지만 내 데스가 상대 팀 득실 점수가 되어 싸움을 내줬다 → 이런 데스가 역전의 시발점이 된다. 내가 죽은 결정적 장면이 있으면 그 장면과 연결한다',
    action: true,
  },
  R4: {
    basis: '첫 데스 해석 (5-4-1) + 득실 점수 (5-4)',
    gist: '내가 참여한 오브젝트 싸움 하나에서 나에 대해서만 말한다: 내가 죽었지만 우리 팀 데스가 나뿐(또는 상대보다 적음)이고 우리 팀이 잡은 오브젝트 점수가 내 데스 점수보다 크면 이득 교환 문장, 그 밖에 내가 먼저 죽었으면 내 유형(탱/딜러)과 싸움 결과에 맞는 5-4-1 표 문장, 먼저는 아니지만 죽었으면 내 데스로 상대 팀이 얻은 점수, 살았으면 살아남았다는 문장(text)을 그대로 쓴다. 다른 아군이 먼저 죽은 일은 말하지 않는다. 해석일 뿐이므로 행동 조언은 붙이지 않는다',
    action: false,
  },
  R5: {
    basis: '단독 킬·데스 (6-1)',
    gist: '오브젝트 싸움 밖에서 혼자 싸워 죽은 장면이 있다 → 그 시각·지역을 짚고, 그런 상황에서 혼자 싸우지 않도록 하라',
    action: true,
  },
  R6: {
    basis: '라인전 일대일 데스 (2-3)',
    gist: '라인전에서 상대 라이너에게 1:1로 죽은 장면이 있다 → 그 시각·지역과 죽기 직전 내가 준 피해·받은 피해를 짚고, 준 피해가 받은 피해보다 훨씬 적었으면(일방적으로 당함) 그 점을 짚는다. 조언은 rule.R6.action 그대로("다음 판에는 라인전 1:1 교환에 더 집중해서 신경 쓰세요"). 체력 상태는 데이터에 없으므로 교환에서 진 원인은 말하지 않는다',
    action: true,
  },
  R7: {
    basis: '라인전 갱 데스 (2-3)',
    gist: '라인전에서 상대 정글이 관여한 갱에 죽은 장면이 있다 → 그 시각·지역, 상대 정글 챔피언, 죽기 전 60초 동안 내가 설치한 와드 수를 짚고, 갱 회피가 아쉬웠다고 쓴다. 와드가 0개면 그 지역 쪽에 와드를 두라',
    action: true,
  },
  R8: {
    basis: '라인전 성장 표 (2-1) + 골드 분해 (1장)',
    gist: '라인전 성장이 뒤졌다(2-1 칸). 골드 차의 가장 큰 원인(원인 1위, 상대 쪽이 앞선 것)에 맞춘 조언 하나만 rule.R8.action 그대로 쓴다: "다음 판에는 ○○에 신경 쓰세요" (킬 골드 → 상대에게 킬을 내주는 데스 / CS → CS / 포탑 방패 → 포탑 방패 / 데스 → 데스 / 라인 밖 → 라인을 비우는 횟수)',
    action: true,
  },
  R9: {
    basis: '라인 밖 관여 (2-2)',
    gist: '라인전 동안 상대 라이너가 나보다 라인 밖 싸움에 더 많이 참여했다(상대 로밍 우위) → 상대가 라인을 비운 시각을 짚고, 그때 상대를 따라가거나 상대 포탑(방패)을 압박하라. 그동안 내가 방패를 깼다면 잘한 점으로 함께 쓴다',
    action: true,
  },
  R10: {
    basis: '오브젝트 싸움 버티기 (3장)',
    gist: '딜러 유형인데 오브젝트 싸움 첫 킬 뒤 곧바로(경계 초 안) 죽었다 → 그 시각과 첫 킬 뒤 몇 초인지를 짚고, 오래 버티지 못해 그 싸움에서 딜을 넣지 못한 것으로 보인다고 쓴다(Q7: 1분 단위 추정 딜 값은 쓰지 않는다). 오브젝트 싸움에서 죽지 않을 위치를 잡으라',
    action: true,
  },
  R11: {
    basis: '오브젝트 전 제어 와드 (5-5, 3장)',
    gist: '상대가 잡은 오브젝트 전 60초 동안 내가 설치한 제어 와드가 0개였다 → 그 오브젝트·시각을 짚고, 그 오브젝트 전에 제어 와드를 돌려 상대 와드를 탐지·제거하라(조언 문구: "다음 판에는 그 오브젝트 전에 제어 와드를 돌리세요". 제어 와드는 시야를 "두는" 것보다 상대 와드를 찾아 지우는 탐지 용도)',
    action: true,
  },
  // ---------- Q7 ----------
  R12: {
    basis: '오브젝트 싸움 내 기여 (확정 값)',
    gist: '내가 참여한 오브젝트 싸움들에서 우리 팀 킬 중 내 관여(킬·어시스트) 비율이나, 잡은 상대가 죽기 전 받은 챔피언 피해 중 내 몫이 낮았다 → 싸움 수, 우리 팀 킬 수와 내 관여 수(비율), 피해 몫을 짚는다(낮은 값을 반드시). 팀이 이겼으면 "우리 팀은 앞섰지만"처럼 쓴다. 해석일 뿐이라 행동 조언은 붙이지 않는다',
    action: false,
  },
  // ---------- Q6 칭찬 규칙 (좋은 점 칸만, 행동 조언 없음. 말투: 담백 + 게임 용어, 커뮤니티 말투 금지) ----------
  P1: {
    basis: '팀 챔피언 딜 순위 + 구간 딜 비중 (5-2)',
    gist: '팀에서 챔피언 딜을 가장 많이 넣었고(게임 전체 딜·팀 내 비중), 한 구간의 딜 비중이 포지션 평균(예: "미드 딜러 평균")보다 크게 높았다 → 그 구간·비중·평균을 짚고 "싸움을 캐리했습니다"처럼 담백하게 칭찬한다. 1분 단위 추정 값은 근거로 쓰지 않는다',
    action: false,
  },
  P2: {
    basis: '1:1 킬 (킬 직전 피해 출처)',
    gist: '상대를 1:1로(킬러가 나, 어시스트 없음, 상대가 죽기 직전 받은 챔피언 피해가 나뿐) N번 잡았다 → 횟수와 대표 시각·상대를 짚는다. 운영의 "단독 킬"(오브젝트 싸움 밖에서 킬 1개로 끝난 싸움)과 다른 수라서 "1:1 킬"로만 쓰고 단독 킬 수와 섞지 않는다',
    action: false,
  },
  P3: {
    basis: '구간 딜 비중 추이 (5-2) + 후반 1:1 킬',
    gist: '후반(30분 이후)으로 갈수록 강해졌다. 딜 칸: 구간 딜 비중이 30분 이후에 가장 높고 포지션 평균보다 크게 높았다. 운영 칸: 30분 이후 1:1 킬이 많았다 → "후반으로 갈수록 강해져 게임을 주도했습니다". 라인전이 열세였으면(laning) "라인전은 열세였지만 후반에 뒤집었습니다"',
    action: false,
  },
  P4: {
    basis: '오브젝트 싸움 득실 (5-4) + 내 기여 (Q7)',
    gist: '내가 참여한 오브젝트 싸움 N번에서 킬·포탑·오브젝트를 점수로 합치면 우리 팀 M점, 상대 팀 K점으로 크게 이겼다 → 싸움 수와 두 팀 점수를 짚는다(몫 % 대신). 내 기여가 높으면(우리 팀 킬 중 내 관여 비율, 잡은 상대가 받은 챔피언 피해 중 내 몫) 그 값도 짚는다',
    action: false,
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

/** 5-4-1 첫 데스 해석 문장 (fight.ts FIRST_DEATH_TEXT와 같은 문장). 여기서는 "내가" 먼저 죽은 싸움에만 쓴다 */
export const R4_FIRST_TEXT: Readonly<Record<string, string>> = {
  TANK_WIN: '이니시를 걸어 싸움을 연 것으로 보입니다',
  TANK_LOSS: '혼자 들어갔거나 팀이 따라오지 못한 것으로 보입니다',
  DEALER_LOSS: '먼저 잡혀 싸움을 졌습니다',
  DEALER_WIN: '먼저 잡혔지만 팀이 받아쳐 이겼습니다',
};

/** 먼저는 아니지만 내가 죽은 싸움 (N = 내 포지션 킬 점수 × 그 싸움의 내 데스 수, 5-4) */
export const r4DiedText = (points: number): string => `이 싸움에서 나도 죽어 상대 팀이 ${points}점을 얻었습니다`;
/** 내가 살아남은 싸움 */
export const R4_SURVIVED_TEXT = '이 싸움에서 나는 살아남았습니다';
/**
 * Q5(A4) 이득 교환: 내가 죽었지만 그 싸움의 우리 팀 데스가 나뿐(또는 상대 팀 데스보다 적음)이고,
 * 우리 팀이 그 싸움에서 잡은 오브젝트 점수(5-3)가 내 데스 점수(5-4)보다 큰 이긴 싸움.
 */
export const r4TradeText = (myDeaths: number, deathPoints: number, objective: string, objectivePoints: number): string =>
  `내 데스 ${myDeaths}번(상대 팀 ${deathPoints}점)으로 우리 팀이 ${objective}(${objectivePoints}점)을 얻어 이득 교환이었습니다`;

/**
 * R4 (사용자 결정 2026-11-15: 피드백은 내 역할에 대해서만). 내가 참여한 오브젝트 싸움(비긴 싸움 제외) 중
 * 진 싸움 → 부족한 점 칸, 이긴 싸움 → 좋은 점 칸에 하나씩. 내가 죽은 싸움을 먼저, 그다음 득실 차가 큰 싸움, 이른 싸움.
 * - Q5(A4) 이긴 싸움에서 내가 죽었고, 우리 팀 데스가 나뿐(또는 상대보다 적음)이고, 우리 팀 오브젝트 점수 > 내 데스 점수 → 이득 교환
 * - 내가 먼저 죽음 → 내 유형(탱/딜러)·결과의 5-4-1 문장
 * - 먼저는 아니지만 죽음 → "나도 죽어 상대 팀이 N점을 얻었습니다"
 * - 살아남음 → "나는 살아남았습니다"
 * 다른 아군이 먼저 죽은 일은 말하지 않는다.
 */
export function ruleR4(ctx: MatchContext, objectives: readonly ObjectiveKill[]): FiredRule[] {
  const meId = ctx.me.participantId;
  const team = ctx.me.teamId;
  const fights = objectiveFights(ctx, objectives)
    .filter((f) => f.involved.has(meId))
    .map((f) => {
      const kills = f.kills.filter((k) => k.victimId !== undefined && ctx.players.has(k.victimId));
      const myDeaths = kills.filter((k) => k.victimId === meId);
      const ours = f.points.get(team) ?? 0;
      let theirs = 0;
      for (const [t, v] of f.points) if (t !== team) theirs += v;
      const ourDeaths = kills.filter((k) => ctx.players.get(k.victimId!)!.teamId === team).length;
      // 그 싸움에서 우리 팀이 잡은 오브젝트 (점수 큰 순)
      const ourObjectives = objectives.filter((o) => inWindow(o.timestamp, f.window) && o.killerTeamId === team).sort((a, b) => b.points - a.points);
      return { kills, myDeaths, ours, theirs, ourDeaths, enemyDeaths: kills.length - ourDeaths, ourObjectives, firstIsMe: kills[0]?.victimId === meId };
    })
    .filter((f) => f.ours !== f.theirs && f.kills.length > 0);
  const tank = TANK_ROLES.includes(ctx.me.role);
  const per = KILL_POINTS[ctx.me.position];
  const out: FiredRule[] = [];
  for (const kind of ['bad', 'good'] as const) {
    const won = kind === 'good';
    const cands = fights.filter((f) => (f.ours > f.theirs) === won);
    if (cands.length === 0) continue;
    const died = (f: (typeof cands)[number]) => Number(f.myDeaths.length > 0);
    const margin = (f: (typeof cands)[number]) => Math.abs(f.ours - f.theirs);
    const f = [...cands].sort((a, b) => died(b) - died(a) || margin(b) - margin(a) || a.kills[0]!.timestamp - b.kills[0]!.timestamp)[0]!;
    const deathPoints = per * f.myDeaths.length;
    const objectivePoints = f.ourObjectives.reduce((s, o) => s + o.points, 0);
    const objective = [...new Set(f.ourObjectives.map((o) => OBJECTIVE_LABEL[o.kind] ?? o.kind))].join('·');
    const trade = won && f.myDeaths.length > 0 && (f.ourDeaths === f.myDeaths.length || f.ourDeaths < f.enemyDeaths) && objectivePoints > deathPoints;
    const status = trade ? 'TRADE' : f.firstIsMe ? 'FIRST' : f.myDeaths.length > 0 ? 'DIED' : 'SURVIVED';
    const text =
      status === 'TRADE'
        ? r4TradeText(f.myDeaths.length, deathPoints, objective, objectivePoints)
        : status === 'FIRST'
          ? R4_FIRST_TEXT[`${tank ? 'TANK' : 'DEALER'}_${won ? 'WIN' : 'LOSS'}`]!
          : status === 'DIED'
            ? r4DiedText(deathPoints)
            : R4_SURVIVED_TEXT;
    out.push({
      id: 'R4',
      subjectId: 'fight.advantage',
      kind,
      facts: {
        status,
        text,
        // 내가 죽었으면 내 (첫) 데스 시각, 살았으면 그 싸움 첫 킬 시각
        sec: sec((f.myDeaths[0] ?? f.kills[0]!).timestamp),
        myDeaths: f.myDeaths.length,
        pointsPerDeath: per,
        deathPoints,
        tank,
        won,
        // Q5(A4) 이득 교환 근거: 그 싸움의 우리 팀·상대 팀 데스, 우리 팀이 잡은 오브젝트와 점수
        ourDeaths: f.ourDeaths,
        enemyDeaths: f.enemyDeaths,
        objective: objective || null,
        objectivePoints,
      },
    });
  }
  return out;
}

// ---------- R5 ----------

/** R5: 단독 데스. Q5(C2): R6이 다룬 라인전 1:1 데스(기준 시점 전 1:1 데스, R6이 센 것)는 건너뛰고 다음 단독 데스를 고른다. 없으면 발동하지 않는다 */
export function ruleR5(me: JudgedResult): FiredRule[] {
  const solo = subjectOf(me, 'macro.solo');
  if (!solo?.grade || !BAD.includes(solo.grade)) return [];
  const r6Secs = new Set((me.laning?.deaths ?? []).filter((d) => d.type === 'SOLO').map((d) => d.sec));
  const death = me.scenes.macroSolo.find((s) => s.kind === 'DEATH' && !r6Secs.has(s.sec));
  if (!death) return [];
  return [{ id: 'R5', subjectId: 'macro.solo', kind: 'bad', facts: { deathSec: death.sec, region: death.region, enemies: death.enemies, enemyJungler: death.enemyJungler } }];
}

// ---------- R6 · R7 (2-3 라인전 데스) ----------

/** R6 조언 (Q5 A3, 사용자 채점 2026-11-22: "1:1 교환을 줄여라"보다 "집중해서 신경 써야") */
export const R6_ACTION = '다음 판에는 라인전 1:1 교환에 더 집중해서 신경 쓰세요';

/** R6: 1:1 데스 ≥ 1. 일방적으로 당한 데스를 먼저, 그다음 이른 데스 */
export function ruleR6(me: JudgedResult): FiredRule[] {
  const solos = (me.laning?.deaths ?? []).filter((d) => d.type === 'SOLO');
  if (solos.length === 0) return [];
  const d = [...solos].sort((a, b) => Number(b.oneSided === true) - Number(a.oneSided === true) || a.sec - b.sec)[0]!;
  return [
    {
      id: 'R6',
      subjectId: LANING_SUBJECTS.deaths,
      kind: 'bad',
      facts: { sec: d.sec, region: d.region, dealt: d.dealt, received: d.received, oneSided: d.oneSided, count: solos.length, action: R6_ACTION },
    },
  ];
}

/** R7: 갱 데스 ≥ 1. 이른 데스 */
export function ruleR7(me: JudgedResult): FiredRule[] {
  const ganks = (me.laning?.deaths ?? []).filter((d): d is LaningDeath & { enemyJunglerId: number } => d.type === 'GANK' && d.enemyJunglerId !== null);
  if (ganks.length === 0) return [];
  const d = ganks[0]!;
  return [{ id: 'R7', subjectId: LANING_SUBJECTS.deaths, kind: 'bad', facts: { sec: d.sec, region: d.region, junglerId: d.enemyJunglerId, wardsBefore: d.wardsBefore, enemies: d.enemies.length, count: ganks.length } }];
}

// ---------- R8 (2-1 성장 + 1장 원인) ----------

/** R8 원인별 조언 (Q5 A2, 사용자 채점 2026-11-22: "다음 판에는 CS에 신경 쓰세요" 꼴로 통일) */
export const R8_ACTION: Readonly<Record<LaningCauseId, string>> = {
  killGold: '다음 판에는 상대에게 킬을 내주는 데스에 신경 쓰세요',
  cs: '다음 판에는 CS에 신경 쓰세요',
  plates: '다음 판에는 포탑 방패에 신경 쓰세요',
  deaths: '다음 판에는 데스에 신경 쓰세요',
  outOfLane: '다음 판에는 라인을 비우는 횟수에 신경 쓰세요',
};

/** R8: "라인전 패배" 또는 "경험치는 따라갔지만 골드를 내줌" 칸이고, 원인 중 상대 쪽이 앞선 것이 있을 때 (원인 1위) */
export function ruleR8(me: JudgedResult): FiredRule[] {
  const L = me.laning;
  if (!L || (L.cell.id !== 'LOST' && L.cell.id !== 'XP_KEPT_GOLD_LOST')) return [];
  const c = L.growth.causes.find((x) => x.favors === 'ENEMY');
  if (!c) return [];
  return [{ id: 'R8', subjectId: LANING_SUBJECTS.growth, kind: 'bad', facts: { cell: L.cell.id, cause: c.id, me: c.me, enemy: c.enemy, action: R8_ACTION[c.id] } }];
}

// ---------- R9 (2-2 로밍) ----------

/** R9: 상대 로밍 우위 */
export function ruleR9(me: JudgedResult): FiredRule[] {
  const r = me.laning?.roam;
  if (!r || r.verdict !== 'OPPONENT' || r.enemy.length === 0) return [];
  return [
    {
      id: 'R9',
      subjectId: LANING_SUBJECTS.roam,
      kind: 'bad',
      facts: {
        me: r.me.length,
        enemy: r.enemy.length,
        awaySec: r.enemy.map((x) => x.sec),
        awayRegion: r.enemy[0]!.region,
        platesWhileAwaySec: r.platesWhileAwaySec,
      },
    },
  ];
}

// ---------- R10 (3장 버티기) ----------

/**
 * R10: 딜러 유형(탱 유형 밖)이 내가 참여한 오브젝트 싸움에서 싸움 첫 킬 뒤 SURVIVE_SEC초 안에 죽음.
 * 상대 팀 득실이 가장 큰 싸움, 같으면 이른 싸움. 딜 칸·득실 칸에 붙는다(그 칸이 부족한 점일 때만 말해진다).
 * Q5(C1): 라인전 기준 시점 전 데스(라인전 1:1이 오브젝트 창에 걸린 것)와, 양 팀 각각 SURVIVE_MIN_INVOLVED명 이상이
 * 킬에 관여하지 않은 싸움은 오브젝트 싸움 버티기로 보지 않는다.
 */
export function ruleR10(me: JudgedResult): FiredRule[] {
  if (TANK_ROLES.includes(me.player.role)) return [];
  const refSec = me.laning?.referenceSec ?? LANING.defaultSec;
  const cands = me.scenes.objectiveFights.filter(
    (f) =>
      f.myDeathAfterFirstKillSec !== null &&
      f.myDeathAfterFirstKillSec <= SURVIVE_SEC &&
      f.startSec + f.myDeathAfterFirstKillSec > refSec &&
      f.involvedOurs >= SURVIVE_MIN_INVOLVED &&
      f.involvedTheirs >= SURVIVE_MIN_INVOLVED,
  );
  if (cands.length === 0) return [];
  const net = (f: (typeof cands)[number]) => f.pointsTheirs - f.pointsOurs;
  const f = [...cands].sort((a, b) => net(b) - net(a) || a.startSec - b.startSec)[0]!;
  const facts: Facts = {
    deathSec: f.startSec + f.myDeathAfterFirstKillSec!,
    afterSec: f.myDeathAfterFirstKillSec,
    firstKillSec: f.startSec,
    won: f.pointsOurs > f.pointsTheirs,
    // Q7: 1분 단위 추정 딜(f.frame)은 근거로 넘기지 않는다
    surviveSec: SURVIVE_SEC,
  };
  return ['fight.damage', 'fight.advantage'].map((subjectId) => ({ id: 'R10' as const, subjectId, kind: 'bad' as const, facts }));
}

// ---------- R11 (오브젝트 전 제어 와드) ----------

/** R11: 상대가 잡은 시야 오브젝트(용·바론·전령) 전 60초 제어 와드 0. 큰 오브젝트 먼저, 같으면 이른 것 */
export function ruleR11(ctx: MatchContext, objectives: readonly ObjectiveKill[]): FiredRule[] {
  const scenes = objectiveScenes(ctx, objectives).filter((s, i) => VISION_OBJECTIVE_TYPES.includes(objectives[i]!.monsterType) && !s.ours && s.controlWards === 0);
  if (scenes.length === 0) return [];
  const w = (k: string) => OBJECTIVE_WEIGHT[k] ?? 0;
  const s = [...scenes].sort((a, b) => w(b.kind) - w(a.kind) || a.sec - b.sec)[0]!;
  return [{ id: 'R11', subjectId: 'fight.vision', kind: 'bad', facts: { sec: s.sec, objective: s.kind, controlWards: 0, wardsPlaced: s.wardsPlaced, count: scenes.length } }];
}

// ---------- R12 (Q7 오브젝트 싸움 내 기여 낮음) ----------

/**
 * R12: 내가 참여한 오브젝트 싸움이 objectiveFightsMin번 이상이고, 내 관여 비율 또는 잡은 상대가 받은 피해 중 내 몫이 낮음
 * (경계 rules.ts CONTRIBUTION, 우리 팀 킬이 적으면 판단 안 함). 오브젝트 싸움 득실 부족한 점 칸. 해석만(행동 조언 없음).
 * 사용자 채점(2026-11-24): "팀은 이겼지만 내 관여 적음" 같은 경우를 부족한 점 근거로.
 */
export function ruleR12(me: JudgedResult): FiredRule[] {
  const c = me.scenes.objectiveContribution;
  if (!c || c.fights < PRAISE.objectiveFightsMin) return [];
  const invLow = c.involvementLevel === 'LOW';
  const dmgLow = c.killedDamageLevel === 'LOW';
  if (!invLow && !dmgLow) return [];
  const adv = subjectOf(me, 'fight.advantage');
  return [
    {
      id: 'R12',
      subjectId: 'fight.advantage',
      kind: 'bad',
      facts: {
        fights: c.fights,
        ours: (adv?.facts.ours as number | undefined) ?? null,
        theirs: (adv?.facts.theirs as number | undefined) ?? null,
        outcome: adv?.grade ? ADVANTAGE_OUTCOME[adv.grade] : null,
        teamKills: c.teamKills,
        involvement: c.myKills + c.myAssists,
        involvementPct: c.involvementPct,
        killedDamagePct: c.killedDamagePct,
        involvementLow: invLow,
        killedDamageLow: dmgLow,
      },
    },
  ];
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
    rules: [
      ...ruleR1(me, opp),
      ...ruleR2R3(me, myObjectiveFightDeaths(ctx, objectives)),
      ...ruleR4(ctx, objectives),
      ...ruleR5(me),
      ...ruleR6(me),
      ...ruleR7(me),
      ...ruleR8(me),
      ...ruleR9(me),
      ...ruleR10(me),
      ...ruleR11(ctx, objectives),
      ...ruleR12(me),
      // Q6 칭찬 규칙
      ...buildPraise(ctx, me),
    ],
    opponentParticipantId,
  };
}

/** 칸(과목 × 방향)에 붙은 규칙 */
export function rulesFor(advice: AdviceResult | undefined, subjectId: string | null, kind: 'good' | 'bad' | null): FiredRule[] {
  if (!advice || !subjectId || !kind) return [];
  return advice.rules.filter((r) => r.subjectId === subjectId && r.kind === kind);
}
