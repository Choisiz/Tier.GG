// Q4 경계값 표본 (ai_spec Q4 7장): 최근 솔로랭크 판의 match·timeline을 받아 라인전·오브젝트 경계값 분포만 남긴다.
// 1단계 fetch: DB에서 최근 matchId를 고르고(읽기만) 기존 RiotClient로 받아, 계정 식별 값을 가려 **저장소 밖** 캐시 폴더에 둔다.
// 2단계 analyze: 캐시 폴더의 판마다 10명을 엔진으로 분석해 분포(20/40/60/80% 지점 등)만 results/에 쓴다. 원본·puuid·닉네임은 결과에 넣지 않는다.
// 기존 src/riot·src/db·src/config·src/lib는 import만 한다.
// 실행:
//   node --env-file=../.env --import tsx test/eval/sampleLaning.ts fetch --cache <저장소 밖 폴더> [--games 200] [--max-calls 450]
//   node --import tsx test/eval/sampleLaning.ts analyze --cache <폴더> [--out test/eval/results/2026-11-19.q4.thresholds.json]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { analyzeMatch, championTagsFromJson } from '../../src/analysis/index.js';
import { TANK_ROLES } from '../../src/analysis/role.js';
import type { AnalysisMatch, AnalysisResult, AnalysisTimeline } from '../../src/analysis/types.js';
import { maskMatch, leftovers } from './fetchSet.js';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const REPO = resolve(HERE, '../../..');
const TAGS = championTagsFromJson(JSON.parse(readFileSync(join(HERE, '../fixtures/ddragon/champion-tags.json'), 'utf8')));
/** 이미 테스트·평가에 쓰는 판 (표본에서 뺀다) */
const EXCLUDE = new Set(['KR_8437852704', 'KR_8408851980', 'KR_8456658640', 'KR_8419421568', 'KR_8419447142', 'KR_8419451137', 'KR_8419458143']);
const MIN_DURATION_SEC = 15 * 60;
const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

type Json = Record<string, unknown>;

function assertOutsideRepo(dir: string): void {
  const abs = resolve(dir);
  if (abs === REPO || abs.startsWith(`${REPO}/`)) throw new Error(`캐시 폴더는 저장소 밖이어야 합니다 (원본 200판을 커밋하지 않음): ${abs}`);
}

// ---------- 1단계: 받기 ----------

async function fetchPhase(cache: string, games: number, maxCalls: number): Promise<number> {
  assertOutsideRepo(cache);
  mkdirSync(cache, { recursive: true });
  const { RIOT_CLIENT_CONFIG } = await import('../../src/config/collection.js');
  const { loadDbEnv, loadRiotEnv } = await import('../../src/config/env.js');
  const { createPool } = await import('../../src/db/pool.js');
  const { createLogger } = await import('../../src/lib/logger.js');
  const { RiotClient } = await import('../../src/riot/client.js');
  const { RateLimiter } = await import('../../src/riot/rateLimiter.js');

  const have = new Set(readdirSync(cache).filter((f) => f.endsWith('.timeline.json')).map((f) => f.replace('.timeline.json', '')));
  const skipped = new Set(existsSync(join(cache, 'skipped.json')) ? (JSON.parse(readFileSync(join(cache, 'skipped.json'), 'utf8')) as string[]) : []);
  const logger = createLogger('eval');
  const pool = createPool(loadDbEnv().databaseUrl, 1, logger);
  let ids: string[];
  try {
    const r = await pool.query<{ match_id: string }>(
      `SELECT match_id FROM matches ORDER BY game_start_at DESC NULLS LAST, match_id LIMIT $1`,
      [games * 2],
    );
    ids = r.rows.map((x) => x.match_id).filter((id) => !EXCLUDE.has(id));
  } finally {
    await pool.end();
  }
  console.log(`DB 후보 ${ids.length}판 (최근 판, 읽기만). 캐시에 이미 ${have.size}판`);

  const env = loadRiotEnv();
  const riot = new RiotClient({
    apiKey: env.apiKey,
    platformUrl: env.platformUrl,
    regionUrl: env.regionUrl,
    limiter: new RateLimiter({ perSecond: RIOT_CLIENT_CONFIG.perSecondLimit, perWindow: RIOT_CLIENT_CONFIG.perWindowLimit, windowMs: RIOT_CLIENT_CONFIG.windowMs }),
    config: { ...RIOT_CLIENT_CONFIG, retry5xx: 2, retry429: 3 },
    logger: createLogger('riot'),
  });
  let saved = have.size;
  for (const id of ids) {
    if (saved >= games) break;
    if (have.has(id) || skipped.has(id)) continue;
    if (maxCalls - riot.stats.calls < 2) {
      console.log(`호출 상한 ${maxCalls}에 닿아 멈춤`);
      break;
    }
    const match = (await riot.getMatch(id)) as unknown as Json;
    const info = match.info as { gameDuration: number; queueId?: number; participants: { teamPosition: string }[] };
    const allPos = info.participants.length === 10 && info.participants.every((x) => POSITIONS.includes(x.teamPosition));
    if (!allPos || info.gameDuration < MIN_DURATION_SEC || info.queueId !== 420) {
      skipped.add(id);
      continue;
    }
    const timeline = (await riot.getTimeline(id)) as unknown as Json;
    const { originals } = maskMatch(match, timeline);
    const mText = JSON.stringify(match);
    const tText = JSON.stringify(timeline);
    if (leftovers(mText + tText, originals).long > 0) {
      console.error(`가림 실패: ${id}. 저장하지 않음`);
      skipped.add(id);
      continue;
    }
    writeFileSync(join(cache, `${id}.match.json`), mText);
    writeFileSync(join(cache, `${id}.timeline.json`), tText);
    saved++;
    if (saved % 20 === 0) console.log(`저장 ${saved}판, 호출 ${riot.stats.calls}회`);
  }
  writeFileSync(join(cache, 'skipped.json'), JSON.stringify([...skipped]));
  console.log(`끝: 캐시 ${saved}판, 이번 Riot 호출 ${riot.stats.calls}회 (상한 ${maxCalls}), 상태별 ${JSON.stringify(riot.stats.byStatus)}, 429 ${riot.stats.status429}회`);
  return 0;
}

// ---------- 2단계: 분포 ----------

/** 20/40/60/80% 지점과 중앙값·평균 */
export function dist(xs: readonly number[]): { n: number; p10: number; p20: number; p40: number; p50: number; p60: number; p80: number; p90: number; mean: number } | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]!;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { n: s.length, p10: r(q(0.1)), p20: r(q(0.2)), p40: r(q(0.4)), p50: r(q(0.5)), p60: r(q(0.6)), p80: r(q(0.8)), p90: r(q(0.9)), mean: r(s.reduce((a, b) => a + b, 0) / s.length) };
}

/** 값 → 개수 표 (정수 값) */
function histogram(xs: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[String(x)] = (out[String(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0])));
}

/** 최소제곱: y ≈ Σ b_k x_k (절편 없음). 정규방정식을 가우스 소거로 */
export function leastSquares(rows: readonly { x: number[]; y: number }[]): number[] {
  const k = rows[0]?.x.length ?? 0;
  const a = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  for (const { x, y } of rows) {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) a[i]![j]! += x[i]! * x[j]!;
      a[i]![k]! += x[i]! * y;
    }
  }
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(a[r]![i]!) > Math.abs(a[p]![i]!)) p = r;
    [a[i], a[p]] = [a[p]!, a[i]!];
    for (let r = 0; r < k; r++) {
      if (r === i || a[i]![i] === 0) continue;
      const f = a[r]![i]! / a[i]![i]!;
      for (let c = i; c <= k; c++) a[r]![c]! -= f * a[i]![c]!;
    }
  }
  return a.map((row, i) => (row[i] === 0 ? 0 : row[k]! / row[i]!));
}

function analyzePhase(cache: string, outPath: string): number {
  const files = readdirSync(cache).filter((f) => f.endsWith('.timeline.json')).sort();
  const goldAbs: number[] = [];
  const goldAbsByPos: Record<string, number[]> = {};
  const levelEqualGold: number[] = [];
  const cells: Record<string, number> = {};
  const oneSided: number[] = [];
  const soloDeaths: { ratio: number }[] = [];
  const deathTypes: Record<string, number> = {};
  const roamDiff: Record<string, number[]> = {};
  const roamCounts: number[] = [];
  const surviveSec: number[] = [];
  const surviveSecDealer: number[] = [];
  const fightsDealerInvolved = { fights: 0, died: 0 };
  const dealerPlayers = { players: 0, within5: 0, within10: 0 };
  const fired: Record<string, number> = {};
  const spokenLaningBad: Record<string, number> = {};
  const regress: { x: number[]; y: number }[] = [];
  let games = 0;
  for (const f of files) {
    const id = f.replace('.timeline.json', '');
    const match = JSON.parse(readFileSync(join(cache, `${id}.match.json`), 'utf8')) as AnalysisMatch;
    const timeline = JSON.parse(readFileSync(join(cache, f), 'utf8')) as AnalysisTimeline;
    games++;
    for (const p of match.info.participants) {
      let r: AnalysisResult;
      try {
        r = analyzeMatch({ match, timeline, puuid: p.puuid, championTags: TAGS });
      } catch {
        continue;
      }
      const pos = r.player.position;
      const L = r.laning;
      if (L) {
        const g = L.items.find((x) => x.id === 'laning.gold');
        const lv = L.items.find((x) => x.id === 'laning.level');
        if (g) {
          goldAbs.push(Math.abs(g.diff));
          (goldAbsByPos[pos] ??= []).push(Math.abs(g.diff));
          if (lv && lv.diff === 0) levelEqualGold.push(Math.abs(g.diff));
        }
        cells[L.cell.id] = (cells[L.cell.id] ?? 0) + 1;
        for (const d of L.deaths) {
          deathTypes[d.type] = (deathTypes[d.type] ?? 0) + 1;
          if (d.type === 'SOLO' && d.dealt !== null && d.received !== null && d.received > 0) {
            soloDeaths.push({ ratio: d.dealt / d.received });
            oneSided.push(Math.round((d.dealt / d.received) * 100) / 100);
          }
        }
        if (L.roam) {
          (roamDiff[pos] ??= []).push(L.roam.enemy.length - L.roam.me.length);
          roamCounts.push(L.roam.me.length);
        }
        // 골드 분해 회귀 (서폿·정글 제외: 서폿 퀘스트·정글 몬스터 골드가 섞임). y = 골드 차 − 킬 현상금 차
        const gd = L.growth;
        if (g && gd && (pos === 'TOP' || pos === 'MIDDLE' || pos === 'BOTTOM')) {
          regress.push({ x: [gd.cs.me - gd.cs.enemy, gd.assists.me - gd.assists.enemy, gd.plates.me - gd.plates.enemy], y: g.diff - (gd.killBounty.me - gd.killBounty.enemy) });
        }
      }
      for (const id of new Set(r.advice.rules.map((x) => x.id))) fired[id] = (fired[id] ?? 0) + 1;
      for (const id of r.speakOrder.laning.bad.slice(0, 2)) spokenLaningBad[id] = (spokenLaningBad[id] ?? 0) + 1;
      // R10 버티기: 내가 참여한 오브젝트 싸움에서 내가 죽었으면 싸움 첫 킬 뒤 몇 초
      if (!TANK_ROLES.includes(r.player.role)) {
        const ds = r.scenes.objectiveFights.map((x) => x.myDeathAfterFirstKillSec).filter((x): x is number => x !== null);
        dealerPlayers.players++;
        if (ds.some((d) => d <= 5)) dealerPlayers.within5++;
        if (ds.some((d) => d <= 10)) dealerPlayers.within10++;
      }
      for (const s of r.scenes.objectiveFights) {
        if (TANK_ROLES.includes(r.player.role)) {
          if (s.myDeathAfterFirstKillSec !== null) surviveSec.push(s.myDeathAfterFirstKillSec);
          continue;
        }
        fightsDealerInvolved.fights++;
        if (s.myDeathAfterFirstKillSec !== null) {
          fightsDealerInvolved.died++;
          surviveSecDealer.push(s.myDeathAfterFirstKillSec);
        }
      }
    }
  }
  const coef = regress.length > 10 ? leastSquares(regress).map((v) => Math.round(v * 10) / 10) : null;
  const share = (xs: number[], pred: (x: number) => boolean) => (xs.length ? Math.round((xs.filter(pred).length / xs.length) * 1000) / 10 : null);
  const out = {
    description: 'Q4 경계값 표본 (ai_spec Q4 7장). 원본·계정 식별 값 없이 분포만',
    games,
    players: games * 10,
    laning: {
      goldAbsDiff: dist(goldAbs),
      goldAbsDiffByPosition: Object.fromEntries(Object.entries(goldAbsByPos).map(([k, v]) => [k, dist(v)])),
      goldAbsDiffWhenLevelEqual: dist(levelEqualGold),
      shareWithin: { 100: share(goldAbs, (x) => x <= 100), 150: share(goldAbs, (x) => x <= 150), 200: share(goldAbs, (x) => x <= 200), 300: share(goldAbs, (x) => x <= 300) },
      cells,
    },
    deaths: {
      types: deathTypes,
      soloDealtOverReceived: dist(oneSided),
      soloShareBelow: { '0.2': share(oneSided, (x) => x < 0.2), '0.25': share(oneSided, (x) => x < 0.25), '0.33': share(oneSided, (x) => x < 1 / 3), '0.5': share(oneSided, (x) => x < 0.5), '1': share(oneSided, (x) => x < 1) },
      soloRatioHistogram10: histogram(soloDeaths.map((d) => Math.min(20, Math.floor(d.ratio * 10)) / 10)),
    },
    roaming: {
      opponentMinusMeByPosition: Object.fromEntries(Object.entries(roamDiff).map(([k, v]) => [k, { dist: dist(v), histogram: histogram(v) }])),
      allDiffHistogram: histogram(Object.values(roamDiff).flat()),
      myOutOfLaneCount: dist(roamCounts),
    },
    survive: {
      dealerFights: fightsDealerInvolved,
      dealerDeathSecAfterFirstKill: dist(surviveSecDealer),
      dealerDeathSecHistogram5: histogram(surviveSecDealer.map((s) => Math.min(40, Math.floor(s / 5) * 5))),
      dealerDeathSecHistogram1: histogram(surviveSecDealer.map((s) => Math.min(20, Math.floor(s)))),
      dealerDeathExactlyFirst: surviveSecDealer.filter((s) => s === 0).length,
      dealerPlayersWithDeathWithin: dealerPlayers,
      tankDeathSecAfterFirstKill: dist(surviveSec),
    },
    rulesFiredPlayers: fired,
    laningBadSpokenFirst2: spokenLaningBad,
    goldRegression: coef ? { rows: regress.length, perCs: coef[0], perAssist: coef[1], perPlate: coef[2], note: '골드 차 − 킬 현상금 차 ≈ a·CS 차 + b·어시스트 차 + c·방패 차 (탑·미드·원딜, 절편 없음)' } : null,
  };
  writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify(out, null, 1));
  return 0;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cache: { type: 'string' },
      games: { type: 'string', default: '200' },
      'max-calls': { type: 'string', default: '450' },
      out: { type: 'string', default: join(HERE, 'results/2026-11-19.q4.thresholds.json') },
    },
  });
  const cmd = positionals[0];
  if (!values.cache) throw new Error('--cache <저장소 밖 폴더>가 필요합니다');
  if (cmd === 'fetch') return fetchPhase(values.cache, Number(values.games), Number(values['max-calls']));
  if (cmd === 'analyze') return analyzePhase(values.cache, values.out);
  throw new Error('명령: fetch | analyze');
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().then(
    (c) => (process.exitCode = c),
    (e: unknown) => {
      console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
      process.exitCode = 1;
    },
  );
}
