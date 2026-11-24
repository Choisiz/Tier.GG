// Q6 칭찬 규칙 경계값 표본 (ai_spec Q6, feedback_design 8-2): Q4 표본 캐시(저장소 밖, 최근 솔로랭크 200판)를 다시 읽어 분포만 남긴다.
// Riot 호출·DB·LLM 없음(0원). 원본·puuid·닉네임은 결과에 넣지 않는다. 캐시를 새로 받으려면 sampleLaning.ts fetch.
// 실행: node --import tsx test/eval/samplePraise.ts --cache <저장소 밖 폴더> [--out test/eval/results/2026-11-22.q6.thresholds.json]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { analyzeMatch, championTagsFromJson } from '../../src/analysis/index.js';
import { PRAISE } from '../../src/analysis/rules.js';
import type { AnalysisMatch, AnalysisResult, AnalysisTimeline } from '../../src/analysis/types.js';
import { dist } from './sampleLaning.js';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const TAGS = championTagsFromJson(JSON.parse(readFileSync(join(HERE, '../fixtures/ddragon/champion-tags.json'), 'utf8')));

type Raw = { participantId: number; puuid: string; challenges?: { soloKills?: number } };

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
function histogram(xs: readonly (number | string)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[String(x)] = (out[String(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => (Number(a[0]) || 0) - (Number(b[0]) || 0)));
}

function analyze(cache: string, outPath: string): void {
  const files = readdirSync(cache).filter((f) => f.endsWith('.timeline.json')).sort();
  let games = 0;
  const durationsMin: number[] = [];
  // 1:1 킬 정의 검증 (Riot challenges.soloKills와 비교)
  const soloAgree = { players: 0, same: 0, diff: [] as number[] };
  const soloKillMin: number[] = [];
  const soloCounts: number[] = [];
  const lateSoloCounts: number[] = [];
  // P1: 팀 딜 1위의 "가장 높은 구간 차이"(%p) 분포, 경계별 발동률
  const bestDiffRank1: number[] = [];
  const bestDiffAll: number[] = [];
  const rank1ByRole: Record<string, number> = {};
  const playersByRole: Record<string, number> = {};
  const p1Candidates: { role: string; rank: number; best: number }[] = [];
  // P3 교전: 30분 이후 구간이 있는 사람 중 그 구간이 가장 높은 사람의 차이
  const late = { players: 0, lateHighest: 0, diffWhenHighest: [] as number[] };
  // P4
  const adv = { graded: 0, gradeA: 0, aFights: [] as number[] };
  const fired: Record<string, number> = {};
  const firedByRole: Record<string, Record<string, number>> = {};
  for (const f of files) {
    const id = f.replace('.timeline.json', '');
    const match = JSON.parse(readFileSync(join(cache, `${id}.match.json`), 'utf8')) as AnalysisMatch;
    const timeline = JSON.parse(readFileSync(join(cache, f), 'utf8')) as AnalysisTimeline;
    if (match.info.gameDuration < 15 * 60) continue;
    games++;
    durationsMin.push(Math.round((match.info.gameDuration / 60) * 10) / 10);
    for (const p of match.info.participants as (AnalysisMatch['info']['participants'][number] & Raw)[]) {
      let r: AnalysisResult;
      try {
        r = analyzeMatch({ match, timeline, puuid: p.puuid, championTags: TAGS });
      } catch {
        continue;
      }
      const role = r.player.role;
      playersByRole[role] = (playersByRole[role] ?? 0) + 1;
      const solo = r.scenes.soloKills;
      soloCounts.push(solo.length);
      lateSoloCounts.push(solo.filter((k) => k.sec >= PRAISE.lateSec).length);
      for (const k of solo) soloKillMin.push(Math.floor(k.sec / 60));
      const riot = p.challenges?.soloKills;
      if (typeof riot === 'number') {
        soloAgree.players++;
        if (riot === solo.length) soloAgree.same++;
        else soloAgree.diff.push(solo.length - riot);
      }
      // 구간 딜 비중 차이 (5-2 facts, 소수 둘째 자리)
      const dmg = r.fight.subjects.find((s) => s.id === 'fight.damage');
      const diffs = [0, 1, 2].map((k) => dmg?.facts[`diff${k}`]).filter((x): x is number => typeof x === 'number');
      const shares = [0, 1, 2].map((k) => dmg?.facts[`share${k}`]);
      const best = diffs.length ? Math.max(...diffs) : null;
      const td = r.scenes.teamDamage;
      if (best !== null) bestDiffAll.push(best);
      if (td && best !== null) {
        p1Candidates.push({ role, rank: td.rank, best });
        if (td.rank === 1) {
          bestDiffRank1.push(best);
          rank1ByRole[role] = (rank1ByRole[role] ?? 0) + 1;
        }
      }
      if (typeof shares[2] === 'number') {
        late.players++;
        const s2 = shares[2];
        if (shares.every((s, k) => k === 2 || typeof s !== 'number' || s < s2)) {
          late.lateHighest++;
          late.diffWhenHighest.push(dmg!.facts.diff2 as number);
        }
      }
      const a = r.fight.subjects.find((s) => s.id === 'fight.advantage');
      if (a?.grade) {
        adv.graded++;
        if (a.grade === 'A') {
          adv.gradeA++;
          adv.aFights.push(Number(a.facts.fights));
        }
      }
      for (const x of new Set(r.advice.rules.filter((x) => x.id.startsWith('P')).map((x) => (x.id === 'P3' ? `P3.${x.facts.basis}` : x.id)))) {
        fired[x] = (fired[x] ?? 0) + 1;
        (firedByRole[role] ??= {})[x] = (firedByRole[role]![x] ?? 0) + 1;
      }
    }
  }
  const players = soloCounts.length;
  const p1Rate = (n: number) => pct(p1Candidates.filter((c) => c.rank === 1 && c.best >= n).length, players);
  const p1RateRank1 = (n: number) => pct(bestDiffRank1.filter((x) => x >= n).length, bestDiffRank1.length);
  const p3Rate = (n: number) => pct(late.diffWhenHighest.filter((x) => x >= n).length, players);
  const out = {
    description: 'Q6 칭찬 규칙 경계값 표본 (ai_spec Q6, feedback_design 8-2). Q4 캐시 200판 재사용, 원본·계정 식별 값 없이 분포만',
    games,
    players,
    thresholds: PRAISE,
    duration: { minutes: dist(durationsMin), shareAtLeast30: pct(durationsMin.filter((x) => x >= 30).length, games), shareAtLeast33: pct(durationsMin.filter((x) => x >= 33).length, games) },
    soloKills: {
      note: '1:1 킬 = 킬러 나 · 어시스트 없음 · 피해자가 받은 챔피언 피해 출처가 나뿐 (이름 먼저)',
      agreeWithRiotSoloKills: { players: soloAgree.players, same: soloAgree.same, samePct: pct(soloAgree.same, soloAgree.players), diffHistogram: histogram(soloAgree.diff) },
      perPlayer: { histogram: histogram(soloCounts), atLeast2Pct: pct(soloCounts.filter((x) => x >= 2).length, players), atLeast3Pct: pct(soloCounts.filter((x) => x >= 3).length, players) },
      killMinuteHistogram5: histogram(soloKillMin.map((m) => Math.min(40, Math.floor(m / 5) * 5))),
      killsAfter30Pct: pct(soloKillMin.filter((m) => m >= 30).length, soloKillMin.length),
      lateKillsPerPlayer: { histogram: histogram(lateSoloCounts), atLeast1Pct: pct(lateSoloCounts.filter((x) => x >= 1).length, players), atLeast2Pct: pct(lateSoloCounts.filter((x) => x >= 2).length, players) },
    },
    carry: {
      note: '가장 높은 구간의 딜 비중 − 기대치(%p). 팀 딜 1위 = 팀 5명 중 게임 전체 챔피언 딜 최다',
      bestDiffAllPlayers: dist(bestDiffAll),
      bestDiffRank1: dist(bestDiffRank1),
      rank1ByRole,
      playersByRole,
      fireRateAllPlayersByN: Object.fromEntries([3, 4, 5, 6, 7, 8, 9, 10, 12].map((n) => [n, p1Rate(n)])),
      fireRateAmongRank1ByN: Object.fromEntries([3, 4, 5, 6, 7, 8, 9, 10, 12].map((n) => [n, p1RateRank1(n)])),
    },
    late: {
      note: '30분 이후 구간(3분 이상)이 있는 사람 중 그 구간 딜 비중이 세 구간에서 가장 높은 사람',
      playersWithLatePhase: late.players,
      lateHighest: late.lateHighest,
      diffWhenHighest: dist(late.diffWhenHighest),
      fireRateAllPlayersByN: Object.fromEntries([0, 3, 4, 5, 6, 7, 8].map((n) => [n, p3Rate(n)])),
    },
    objective: { graded: adv.graded, gradeA: adv.gradeA, gradeAPct: pct(adv.gradeA, adv.graded), fightsWhenA: histogram(adv.aFights), aWithAtLeast3Pct: pct(adv.aFights.filter((x) => x >= 3).length, players) },
    firedPlayers: Object.fromEntries(Object.entries(fired).map(([k, v]) => [k, { n: v, pct: pct(v, players) }])),
    firedByRole,
  };
  writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify(out, null, 1));
}

const { values } = parseArgs({ options: { cache: { type: 'string' }, out: { type: 'string', default: join(HERE, 'results/2026-11-22.q6.thresholds.json') } } });
if (!values.cache) throw new Error('--cache <저장소 밖 폴더>가 필요합니다');
analyze(resolve(values.cache), resolve(values.out));
