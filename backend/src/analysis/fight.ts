// 5장 교전: 이득 여부, 딜, 시야, 오브젝트 (반영 비율 5-1)
import { objectiveFights, type ObjectiveFight, type ObjectiveKill } from './fights.js';
import { TANK_ROLES } from './role.js';
import {
  DAMAGE_EXPECTED,
  DAMAGE_PHASE_MIN_MS,
  DAMAGE_PHASES,
  FIGHT_ADVANTAGE_CUTS,
  FIGHT_VISION_CUTS,
  FIGHT_WEIGHTS,
  GRADE_POINT,
  INITIATE_MIN_ENEMIES,
  JUNGLE_OBJECTIVE_CUTS,
  VISION_OBJECTIVE_TYPES,
  VISION_WINDOW_MS,
  WARD_KILL_POINTS,
  WARD_PLACED_POINTS,
  gradeByCuts,
  gradeDamageDiff,
  gradeFromPoint,
} from './rules.js';
import { area, graded, ungraded } from './score.js';
import { damageToChampions, enemyTeam, frameMs, lastFrameIndex, round, sec, type MatchContext } from './timeline.js';
import type { AreaResult, Facts, Note, SubjectResult, TimelineEvent } from './types.js';

// ---------- 5-2. 딜 ----------

export interface DamagePhase {
  fromMin: number;
  toMin: number;
  share: number;
  expected: number;
  diff: number;
}

/** 구간별 팀 내 딜 비중. 3분 미만 구간·스냅샷이 없는 구간은 빠진다 */
export function damagePhases(ctx: MatchContext): DamagePhase[] {
  const me = ctx.me;
  const last = lastFrameIndex(ctx);
  const mates = [...ctx.players.values()].filter((p) => p.teamId === me.teamId);
  const out: DamagePhase[] = [];
  DAMAGE_PHASES.forEach(([from, to], i) => {
    const a = from;
    const b = Math.min(to, last);
    if (b <= a || frameMs(ctx, b) - frameMs(ctx, a) < DAMAGE_PHASE_MIN_MS) return;
    let team = 0;
    let mine = 0;
    for (const p of mates) {
      const x = damageToChampions(ctx, a, p.participantId);
      const y = damageToChampions(ctx, b, p.participantId);
      if (x === undefined || y === undefined) return;
      team += y - x;
      if (p.participantId === me.participantId) mine = y - x;
    }
    if (team <= 0) return;
    const share = (100 * mine) / team;
    const expected = DAMAGE_EXPECTED[me.role][i]!;
    out.push({ fromMin: a, toMin: round(frameMs(ctx, b) / 60_000, 2), share, expected, diff: share - expected });
  });
  return out;
}

function damageSubject(ctx: MatchContext, weight: number): SubjectResult {
  const phases = damagePhases(ctx);
  if (phases.length === 0) return ungraded('fight.damage', weight, '3분 이상인 딜 구간이 없음');
  const grades = phases.map((p) => gradeDamageDiff(p.diff));
  const point = grades.reduce((s, g) => s + GRADE_POINT[g], 0) / grades.length;
  // 구간 i: 0 = 0~15분, 1 = 15~30분, 2 = 30분 이후. 판정은 반올림 전 값으로 한다
  const facts: Facts = {};
  phases.forEach((p, i) => {
    const k = DAMAGE_PHASES.findIndex(([from]) => from === p.fromMin);
    facts[`phase${k}`] = [p.fromMin, p.toMin];
    facts[`share${k}`] = round(p.share, 2);
    facts[`expected${k}`] = p.expected;
    facts[`diff${k}`] = round(p.diff, 2);
    facts[`grade${k}`] = grades[i]!;
  });
  return graded('fight.damage', weight, gradeFromPoint(point), facts, point);
}

// ---------- 5-3. 오브젝트 ----------

function objectiveSubject(ctx: MatchContext, weight: number, objectives: readonly ObjectiveKill[]): SubjectResult {
  if (objectives.length === 0) return ungraded('fight.objective', weight, '오브젝트가 한 번도 나오지 않음');
  const mine = objectives.filter((o) => o.killerId === ctx.me.participantId);
  const points = mine.reduce((s, o) => s + o.points, 0);
  const facts: Facts = { lastHits: mine.length, lastHitPoints: points, lastHitKinds: mine.map((o) => o.kind) };
  if (ctx.me.position === 'JUNGLE') return graded('fight.objective', weight, gradeByCuts(points, JUNGLE_OBJECTIVE_CUTS), facts);
  // 정글 외: 막타 없음 = C(기본), 1번 이상 = A(가산점)
  return graded('fight.objective', weight, mine.length > 0 ? 'A' : 'C', facts);
}

// ---------- 5-4. 이득 여부 ----------

function teamShare(fights: readonly ObjectiveFight[], teamId: number): { ours: number; theirs: number } {
  let ours = 0;
  let theirs = 0;
  for (const f of fights) {
    ours += f.points.get(teamId) ?? 0;
    theirs += f.points.get(enemyTeam(teamId)) ?? 0;
  }
  return { ours, theirs };
}

function advantageSubject(ctx: MatchContext, weight: number, fights: readonly ObjectiveFight[]): SubjectResult {
  const mine = fights.filter((f) => f.involved.has(ctx.me.participantId));
  if (mine.length === 0) return ungraded('fight.advantage', weight, '오브젝트 싸움에 한 번도 끼지 않음');
  const { ours, theirs } = teamShare(mine, ctx.me.teamId);
  if (ours + theirs === 0) return ungraded('fight.advantage', weight, '낀 오브젝트 싸움의 득실이 0', { fights: mine.length });
  const pct = (100 * ours) / (ours + theirs);
  return graded('fight.advantage', weight, gradeByCuts(pct, FIGHT_ADVANTAGE_CUTS), {
    fights: mine.length,
    ours,
    theirs,
    sharePct: round(pct, 1),
  });
}

// ---------- 5-5. 시야 ----------

export function wardPoints(e: TimelineEvent, pid: number): number {
  if (e.type === 'WARD_PLACED' && e.creatorId === pid) return WARD_PLACED_POINTS[e.wardType ?? ''] ?? 0;
  if (e.type === 'WARD_KILL' && e.killerId === pid) return WARD_KILL_POINTS;
  return 0;
}

/** 시야 창을 여는 오브젝트 처치 시각들 (용·바론·전령) */
export function visionObjectiveTimes(objectives: readonly ObjectiveKill[]): number[] {
  return objectives.filter((o) => VISION_OBJECTIVE_TYPES.includes(o.monsterType)).map((o) => o.timestamp);
}

export const inVisionWindow = (ts: number, objTimes: readonly number[]): boolean =>
  objTimes.some((x) => x - VISION_WINDOW_MS <= ts && ts <= x);

function visionSubject(ctx: MatchContext, weight: number, objectives: readonly ObjectiveKill[]): SubjectResult {
  const times = visionObjectiveTimes(objectives);
  if (times.length === 0) return ungraded('fight.vision', weight, '용·바론·전령이 한 번도 나오지 않음');
  // 오브젝트마다 직전 60초 점수를 따로 센다 (창이 겹치면 같은 와드가 두 오브젝트에 들어갈 수 있음, 검산 스크립트와 같음)
  let points = 0;
  for (const x of times) {
    for (const e of ctx.events) {
      if (e.timestamp < x - VISION_WINDOW_MS || e.timestamp > x) continue;
      points += wardPoints(e, ctx.me.participantId);
    }
  }
  const per = points / times.length;
  return graded('fight.vision', weight, gradeByCuts(per, FIGHT_VISION_CUTS[ctx.me.position]), {
    objectives: times.length,
    points,
    perObjective: round(per, 2),
  });
}

// ---------- 5-4-1. 첫 데스 해석 (점수 밖, 문장 재료) ----------

const FIRST_DEATH_TEXT: Readonly<Record<string, string>> = {
  TANK_WIN: '이니시를 걸어 싸움을 연 것으로 보입니다',
  TANK_LOSS: '혼자 들어갔거나 팀이 따라오지 못한 것으로 보입니다',
  DEALER_LOSS: '먼저 잡혀 싸움을 졌습니다',
  DEALER_WIN: '먼저 잡혔지만 팀이 받아쳐 이겼습니다',
};

/** 내가 낀 오브젝트 싸움 중 우리 팀이 먼저 죽은 싸움마다 해석 노트 (비긴 싸움은 뺀다) */
export function firstDeathNotes(ctx: MatchContext, fights: readonly ObjectiveFight[]): Note[] {
  const notes: Note[] = [];
  for (const f of fights) {
    if (!f.involved.has(ctx.me.participantId)) continue;
    const first = f.kills.find((k) => k.victimId !== undefined && ctx.players.has(k.victimId));
    const victim = first?.victimId === undefined ? undefined : ctx.players.get(first.victimId);
    if (!first || !victim || victim.teamId !== ctx.me.teamId) continue;
    const ours = f.points.get(victim.teamId) ?? 0;
    const theirs = f.points.get(enemyTeam(victim.teamId)) ?? 0;
    if (ours === theirs) continue;
    const tank = TANK_ROLES.includes(victim.role);
    const won = ours > theirs;
    const key = `${tank ? 'TANK' : 'DEALER'}_${won ? 'WIN' : 'LOSS'}`;
    const enemies = new Set(
      (first.victimDamageReceived ?? [])
        .map((d) => d.participantId)
        .filter((id): id is number => id !== undefined && ctx.players.get(id)?.teamId === enemyTeam(victim.teamId)),
    );
    notes.push({
      id: 'fight.firstDeath',
      kind: 'interpretation',
      key,
      text: FIRST_DEATH_TEXT[key]!,
      facts: {
        windowStartSec: sec(f.window.start),
        windowEndSec: sec(f.window.end),
        firstVictimId: victim.participantId,
        firstVictimIsMe: victim.participantId === ctx.me.participantId,
        firstVictimRole: victim.role,
        deathSec: sec(first.timestamp),
        ours,
        theirs,
        enemiesDamagingVictim: enemies.size,
        // 탱 해석의 확신도: 죽기 직전 피해에 상대 3명 이상이면 이니시 가능성 높음
        initiateLikely: tank ? enemies.size >= INITIATE_MIN_ENEMIES : null,
      },
    });
  }
  return notes;
}

export interface FightOutcome {
  area: AreaResult;
  notes: Note[];
}

export function analyzeFight(ctx: MatchContext, objectives: readonly ObjectiveKill[]): FightOutcome {
  const w = FIGHT_WEIGHTS[ctx.me.role];
  const fights = objectiveFights(ctx, objectives);
  const subjects = [
    advantageSubject(ctx, w.advantage, fights),
    damageSubject(ctx, w.damage),
    visionSubject(ctx, w.vision, objectives),
    objectiveSubject(ctx, w.objective, objectives),
  ];
  return { area: area({ ...w }, subjects), notes: firstDeathNotes(ctx, fights) };
}
