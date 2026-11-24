// Q7 오브젝트 싸움 내 기여 경계값 표본 (ai_spec Q7, feedback_design 8-3): 표본 캐시(저장소 밖, 최근 솔로랭크 200판)를 읽어 분포만 남긴다.
// Riot 호출·DB·LLM 없음(0원). 원본·puuid·닉네임은 결과에 넣지 않는다. 캐시를 새로 받으려면 sampleLaning.ts fetch.
// 실행: node --import tsx test/eval/sampleContribution.ts --cache <저장소 밖 폴더> [--out test/eval/results/2026-11-24.q7.thresholds.json]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { analyzeMatch, championTagsFromJson } from '../../src/analysis/index.js';
import { CONTRIBUTION, PRAISE } from '../../src/analysis/rules.js';
import type { AnalysisMatch, AnalysisResult, AnalysisTimeline, Position, Role, TimelineEvent } from '../../src/analysis/types.js';
import { dist } from './sampleLaning.js';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const TAGS = championTagsFromJson(JSON.parse(readFileSync(join(HERE, '../fixtures/ddragon/champion-tags.json'), 'utf8')));

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const q = (xs: readonly number[], p: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

interface Row {
  role: Role;
  position: Position;
  /** 발동한 P4·R12 (그 판 그 사람) */
  p4: boolean;
  p4High: boolean;
  r12: boolean;
  win: boolean;
  fights: number;
  teamKills: number;
  inv: number | null;
  dmg: number | null;
  /** participantId만 본 피해 몫 (이름 먼저와 비교) */
  dmgPid: number | null;
  advGrade: string | null;
  lastHits: number;
  killPts: number;
  deathPts: number;
}

/** participantId만 보는 피해 몫 (비교용) */
function pidShare(r: AnalysisResult, events: readonly TimelineEvent[], fightsSec: readonly [number, number][]): number | null {
  const team = new Set(r.participants.filter((p) => p.participantId === r.player.participantId || p.teamId === r.participants.find((x) => x.participantId === r.player.participantId)!.teamId).map((p) => p.participantId));
  let all = 0;
  let mine = 0;
  for (const e of events) {
    if (e.type !== 'CHAMPION_KILL' || e.victimId === undefined || team.has(e.victimId)) continue;
    const t = e.timestamp / 1000;
    if (!fightsSec.some(([a, b]) => a <= t && t <= b)) continue;
    for (const d of e.victimDamageReceived ?? []) {
      if (d.type && ['MINION', 'MONSTER', 'TOWER'].includes(d.type)) continue;
      if (d.participantId === undefined || !team.has(d.participantId)) continue;
      const v = (d.magicDamage ?? 0) + (d.physicalDamage ?? 0) + (d.trueDamage ?? 0);
      all += v;
      if (d.participantId === r.player.participantId) mine += v;
    }
  }
  return all > 0 ? Math.round((1000 * mine) / all) / 10 : null;
}

function analyze(cache: string, outPath: string): void {
  const files = readdirSync(cache).filter((f) => f.endsWith('.timeline.json')).sort();
  let games = 0;
  const rows: Row[] = [];
  const laneCheck = { players: 0, same: 0 };
  for (const f of files) {
    const id = f.replace('.timeline.json', '');
    const match = JSON.parse(readFileSync(join(cache, `${id}.match.json`), 'utf8')) as AnalysisMatch;
    const timeline = JSON.parse(readFileSync(join(cache, f), 'utf8')) as AnalysisTimeline;
    if (match.info.gameDuration < 15 * 60) continue;
    games++;
    const events = timeline.info.frames.flatMap((fr) => fr.events);
    for (const p of match.info.participants) {
      let r: AnalysisResult;
      try {
        r = analyzeMatch({ match, timeline, puuid: p.puuid, championTags: TAGS });
      } catch {
        continue;
      }
      // 라인전 킬 관여 = 라인전 K + A (laning.kda), 라인 밖 수 = laning.roam
      const li = r.scenes.laneInvolvement;
      const kda = r.laning?.items.find((x) => x.id === 'laning.kda')?.detail;
      if (li && Array.isArray(kda?.me) && Array.isArray(kda?.enemy)) {
        laneCheck.players++;
        const me = kda.me as number[];
        const en = kda.enemy as number[];
        const outMe = li.me.filter((x) => x.where === 'OUT_OF_LANE').length;
        const outEn = li.enemy.filter((x) => x.where === 'OUT_OF_LANE').length;
        if (li.me.length === me[0]! + me[2]! && li.enemy.length === en[0]! + en[2]! && outMe === r.laning!.roam!.me.length && outEn === r.laning!.roam!.enemy.length) laneCheck.same++;
      }
      const c = r.scenes.objectiveContribution;
      if (!c) continue;
      const fightsSec = r.scenes.objectiveFights.map((x) => [x.startSec - 0.1, x.endSec + 0.1] as [number, number]);
      const adv = r.fight.subjects.find((s) => s.id === 'fight.advantage');
      const p4 = r.advice.rules.find((x) => x.id === 'P4');
      rows.push({
        role: r.player.role,
        position: r.player.position,
        p4: !!p4,
        p4High: !!p4 && (p4.facts.involvementHigh === true || p4.facts.killedDamageHigh === true),
        r12: r.advice.rules.some((x) => x.id === 'R12'),
        win: r.player.win,
        fights: c.fights,
        teamKills: c.teamKills,
        inv: c.involvementPct,
        dmg: c.killedDamagePct,
        dmgPid: pidShare(r, events, fightsSec),
        advGrade: adv?.grade ?? null,
        lastHits: c.lastHits.length,
        killPts: c.myKillPoints,
        deathPts: c.myDeathPoints,
      });
    }
  }
  // 판단 대상: 참여한 싸움 3번 이상(P4와 같은 수) + 우리 팀 킬 minTeamKills 이상
  const judged = rows.filter((x) => x.fights >= PRAISE.objectiveFightsMin && x.teamKills >= CONTRIBUTION.minTeamKills);
  const nums = (xs: readonly Row[], k: 'inv' | 'dmg') => xs.map((x) => x[k]).filter((v): v is number => v !== null);
  const roles = [...new Set(rows.map((x) => x.role))].sort();
  const positions = [...new Set(rows.map((x) => x.position))].sort();
  const GROUP: Readonly<Record<Role, string>> = { ADC: '딜러', MID_DAMAGE: '딜러', TOP_DAMAGE: '딜러', JUNGLE_DAMAGE: '딜러', TOP_TANK: '탱커', MID_TANK: '탱커', JUNGLE_TANK: '탱커', SUPPORT_DAMAGE: '딜서폿', SUPPORT_TANK: '탱·유틸서폿', SUPPORT_UTILITY: '탱·유틸서폿' };
  const involvementByPosition = Object.fromEntries(positions.map((pos) => [pos, dist(nums(judged.filter((x) => x.position === pos), 'inv'))]));
  const killedDamageByGroup = Object.fromEntries([...new Set(Object.values(GROUP))].map((g) => [g, dist(nums(judged.filter((x) => GROUP[x.role] === g), 'dmg'))]));
  const byRole = Object.fromEntries(
    roles.map((role) => {
      const xs = judged.filter((x) => x.role === role);
      return [role, { n: xs.length, involvement: { p20: q(nums(xs, 'inv'), 20), p50: q(nums(xs, 'inv'), 50), p80: q(nums(xs, 'inv'), 80) }, killedDamage: { p20: q(nums(xs, 'dmg'), 20), p50: q(nums(xs, 'dmg'), 50), p80: q(nums(xs, 'dmg'), 80) } }];
    }),
  );
  const nameVsPid = rows.filter((x) => x.dmg !== null && x.dmgPid !== null);
  const level = (v: number | null, c: { high: number; low: number }) => (v === null ? null : v >= c.high ? 'HIGH' : v <= c.low ? 'LOW' : 'MID');
  const levels = judged.map((x) => ({ inv: level(x.inv, CONTRIBUTION.involvement[x.position]), dmg: level(x.dmg, CONTRIBUTION.killedDamage[x.role]), grade: x.advGrade }));
  const count = (f: (l: (typeof levels)[number]) => boolean) => ({ n: levels.filter(f).length, pct: pct(levels.filter(f).length, levels.length) });
  const out = {
    description: 'Q7 오브젝트 싸움 내 기여 경계값 표본 (ai_spec Q7, feedback_design 8-3). 최근 솔로랭크 판, 원본·계정 식별 값 없이 분포만',
    games,
    players: rows.length,
    judgedPlayers: judged.length,
    judgedRule: `참여한 오브젝트 싸움 ${PRAISE.objectiveFightsMin}번 이상 + 그 싸움들의 우리 팀 킬 ${CONTRIBUTION.minTeamKills}개 이상`,
    thresholds: CONTRIBUTION,
    laneInvolvementCheck: { note: '라인전 킬 관여 수 = 라인전 K+A, 라인 밖 수 = laning.roam (나·상대)', ...laneCheck, samePct: pct(laneCheck.same, laneCheck.players) },
    teamKills: dist(rows.map((x) => x.teamKills)),
    fights: dist(rows.map((x) => x.fights)),
    involvementAll: dist(nums(judged, 'inv')),
    killedDamageAll: dist(nums(judged, 'dmg')),
    involvementByPosition,
    killedDamageByGroup,
    byRole,
    involvementByWin: { win: dist(nums(judged.filter((x) => x.win), 'inv')), loss: dist(nums(judged.filter((x) => !x.win), 'inv')) },
    damageSourceNameVsPid: {
      note: '피해 출처를 이름 먼저(championSourceOf)로 본 몫과 participantId만 본 몫의 차이(%p)',
      players: nameVsPid.length,
      samePct: pct(nameVsPid.filter((x) => Math.abs(x.dmg! - x.dmgPid!) < 0.05).length, nameVsPid.length),
      absDiff: dist(nameVsPid.map((x) => Math.round(Math.abs(x.dmg! - x.dmgPid!) * 10) / 10)),
    },
    levels: {
      involvementHigh: count((l) => l.inv === 'HIGH'),
      involvementLow: count((l) => l.inv === 'LOW'),
      killedDamageHigh: count((l) => l.dmg === 'HIGH'),
      killedDamageLow: count((l) => l.dmg === 'LOW'),
      anyHighWithGradeA: count((l) => l.grade === 'A' && (l.inv === 'HIGH' || l.dmg === 'HIGH')),
      gradeA: count((l) => l.grade === 'A'),
      anyLow: count((l) => l.inv === 'LOW' || l.dmg === 'LOW'),
      anyLowWithGradeAB: count((l) => (l.grade === 'A' || l.grade === 'B') && (l.inv === 'LOW' || l.dmg === 'LOW')),
    },
    fired: {
      note: '발동률은 전체 사람(오브젝트 싸움 참여 1번 이상) 대비',
      P4: { n: rows.filter((x) => x.p4).length, pct: pct(rows.filter((x) => x.p4).length, rows.length) },
      P4WithHigh: { n: rows.filter((x) => x.p4High).length, pct: pct(rows.filter((x) => x.p4High).length, rows.length) },
      R12: { n: rows.filter((x) => x.r12).length, pct: pct(rows.filter((x) => x.r12).length, rows.length) },
      R12WithGradeAB: { n: rows.filter((x) => x.r12 && (x.advGrade === 'A' || x.advGrade === 'B')).length, pct: pct(rows.filter((x) => x.r12 && (x.advGrade === 'A' || x.advGrade === 'B')).length, rows.length) },
    },
    lastHitPlayersPct: pct(rows.filter((x) => x.lastHits > 0).length, rows.length),
    killMinusDeathPoints: dist(rows.map((x) => x.killPts - x.deathPts)),
  };
  writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify(out, null, 1));
}

const { values } = parseArgs({ options: { cache: { type: 'string' }, out: { type: 'string', default: join(HERE, 'results/2026-11-24.q7.thresholds.json') } } });
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  if (!values.cache) throw new Error('--cache <저장소 밖 폴더>가 필요합니다');
  analyze(values.cache, values.out);
}
