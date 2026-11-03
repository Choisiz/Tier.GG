// 평가 판 받기 (ai_spec 2-9): DB 표본에서 matchId 고르기 → 기존 Node RiotClient로 match·timeline 받기 → 계정 식별 값 가림 → 저장.
// 기존 src/riot·src/db·src/config·src/lib는 import만 한다. Riot 응답은 데이터로만 다룬다.
// 실행: node --env-file=../.env --import tsx test/eval/fetchSet.ts [--max-calls 12] [--dry-run]
// 출력에 puuid·닉네임을 쓰지 않는다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { championTagsFromJson } from '../../src/analysis/index.js';
import { determineRole, isPosition } from '../../src/analysis/role.js';
import type { ChampionTags } from '../../src/analysis/types.js';
import { RIOT_CLIENT_CONFIG } from '../../src/config/collection.js';
import { loadDbEnv, loadRiotEnv } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { createLogger } from '../../src/lib/logger.js';
import { RiotClient } from '../../src/riot/client.js';
import { RateLimiter } from '../../src/riot/rateLimiter.js';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const OUT = join(HERE, 'set5');
const TAGS = championTagsFromJson(JSON.parse(readFileSync(join(HERE, '../fixtures/ddragon/champion-tags.json'), 'utf8')));
const determineRoleForEval = (pos: string, id: number, tags: ChampionTags): string => (isPosition(pos) ? determineRole(pos, id, tags) : 'UNKNOWN');
const EXCLUDE = new Set(['KR_8437852704', 'KR_8408851980']);
const MIN_DURATION_SEC = 15 * 60;

/** 포지션별 원하는 조건 (가능하면 승·패 섞기, 탱·딜 섞기) */
const WANT: { position: string; win: boolean; tank: boolean | null }[] = [
  { position: 'TOP', win: true, tank: true },
  { position: 'JUNGLE', win: false, tank: null },
  { position: 'MIDDLE', win: true, tank: null },
  { position: 'BOTTOM', win: false, tank: null },
];

interface Candidate {
  matchId: string;
  puuid: string;
  championId: number;
  position: string;
  win: boolean;
}

type Json = Record<string, unknown>;

/** 세나 fixture 관례(ai_build.md 9장)대로 10명 계정 식별 값을 가린다. 원래 문자열 목록을 돌려준다 */
export function maskMatch(match: Json, timeline: Json): { originals: string[]; puuidToPid: Map<string, number> } {
  const originals: string[] = [];
  const puuidToPid = new Map<string, number>();
  const info = match.info as { participants: Json[] };
  const fake = new Map<string, string>();
  for (const p of info.participants) {
    const pid = p.participantId as number;
    const n = String(pid).padStart(2, '0');
    for (const k of ['puuid', 'riotIdGameName', 'riotIdName', 'summonerName', 'riotIdTagline', 'summonerId']) {
      if (typeof p[k] === 'string' && (p[k] as string).length > 0) originals.push(p[k] as string);
    }
    puuidToPid.set(p.puuid as string, pid);
    fake.set(p.puuid as string, `TEST_PUUID_${n}`);
    p.puuid = `TEST_PUUID_${n}`;
    if ('riotIdGameName' in p) p.riotIdGameName = `Player${n}`;
    if ('riotIdName' in p) p.riotIdName = `Player${n}`;
    if ('summonerName' in p) p.summonerName = `Player${n}`;
    if ('riotIdTagline' in p) p.riotIdTagline = 'TEST';
    if ('summonerId' in p) p.summonerId = `TEST_SUMMONER_${n}`;
    if ('profileIcon' in p) p.profileIcon = 0;
    if ('summonerLevel' in p) p.summonerLevel = 1;
  }
  const md = match.metadata as { participants?: string[] };
  if (Array.isArray(md.participants)) md.participants = md.participants.map((x) => fake.get(x) ?? 'TEST_PUUID_XX');
  const tmd = timeline.metadata as { participants?: string[] } | undefined;
  if (tmd && Array.isArray(tmd.participants)) tmd.participants = tmd.participants.map((x) => fake.get(x) ?? 'TEST_PUUID_XX');
  const tinfo = timeline.info as { participants?: Json[] };
  for (const p of tinfo.participants ?? []) {
    if (typeof p.puuid === 'string') p.puuid = fake.get(p.puuid) ?? 'TEST_PUUID_XX';
  }
  return { originals: [...new Set(originals)], puuidToPid };
}

/** 가린 뒤 원래 식별 문자열이 남았는지. 6자 이상은 0개여야 하고, 짧은 태그는 따로 센다 */
export function leftovers(text: string, originals: readonly string[]): { long: number; short: { len: number; hits: number }[] } {
  let long = 0;
  const short: { len: number; hits: number }[] = [];
  for (const o of originals) {
    const hits = text.split(o).length - 1;
    if (o.length >= 6) long += hits;
    else if (hits > 0) short.push({ len: o.length, hits });
  }
  return { long, short };
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { 'max-calls': { type: 'string', default: '12' }, 'dry-run': { type: 'boolean', default: false } } });
  const maxCalls = Number(values['max-calls']);
  const logger = createLogger('eval');
  const pool = createPool(loadDbEnv().databaseUrl, 1, logger);
  let rows: Candidate[];
  try {
    const r = await pool.query<{ match_id: string; puuid: string; champion_id: number; team_position: string; win: boolean }>(
      `SELECT mp.match_id, mp.puuid, mp.champion_id, mp.team_position, mp.win
         FROM match_players mp JOIN matches m USING (match_id)
        ORDER BY m.game_start_at DESC NULLS LAST, mp.match_id
        LIMIT 600`,
    );
    rows = r.rows.map((x) => ({ matchId: x.match_id, puuid: x.puuid, championId: x.champion_id, position: x.team_position, win: x.win }));
  } finally {
    await pool.end();
  }
  console.log(`DB 표본 ${rows.length}줄 (최근 판, 읽기만)`);

  const used = new Set<string>(EXCLUDE);
  const picks: { want: (typeof WANT)[number]; queue: Candidate[] }[] = WANT.map((w) => {
    const ok = rows.filter((c) => c.position === w.position && c.win === w.win);
    const isTank = (c: Candidate) => determineRoleForEval(c.position, c.championId, TAGS).endsWith('TANK');
    const pref = w.tank === null ? ok : [...ok.filter((c) => isTank(c) === w.tank), ...ok.filter((c) => isTank(c) !== w.tank)];
    return { want: w, queue: pref };
  });
  if (values['dry-run']) {
    for (const p of picks) console.log(p.want.position, '후보', p.queue.length, p.queue.slice(0, 3).map((c) => `${c.matchId}/${c.championId}`).join(' '));
    return 0;
  }

  const env = loadRiotEnv();
  const riot = new RiotClient({
    apiKey: env.apiKey,
    platformUrl: env.platformUrl,
    regionUrl: env.regionUrl,
    limiter: new RateLimiter({ perSecond: RIOT_CLIENT_CONFIG.perSecondLimit, perWindow: RIOT_CLIENT_CONFIG.perWindowLimit, windowMs: RIOT_CLIENT_CONFIG.windowMs }),
    // 호출 수 상한(12회)을 지키려고 자동 재시도를 1회로 줄인다
    config: { ...RIOT_CLIENT_CONFIG, retry5xx: 1, retry429: 1 },
    logger: createLogger('riot'),
  });
  const callsLeft = () => maxCalls - riot.stats.calls;
  mkdirSync(OUT, { recursive: true });

  const chosen: { matchId: string; participantId: number; position: string; role: string; win: boolean; durationSec: number; match: Json }[] = [];
  let haveLongOrShort = false;
  for (const [i, p] of picks.entries()) {
    const remainingPositions = picks.length - i - 1;
    for (const c of p.queue) {
      if (used.has(c.matchId)) continue;
      // 남은 포지션마다 match+timeline 2회를 남겨 둔다
      if (callsLeft() < 2 + remainingPositions * 2) break;
      used.add(c.matchId);
      const match = (await riot.getMatch(c.matchId)) as unknown as Json;
      const info = match.info as { gameDuration: number; queueId?: number; participants: { teamPosition: string; puuid: string; participantId: number }[] };
      const allPos = info.participants.every((x) => ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(x.teamPosition));
      const dur = info.gameDuration;
      const longShort = dur < 20 * 60 || dur >= 30 * 60;
      const lastChanceForLongShort = !haveLongOrShort && remainingPositions === 0 && callsLeft() >= 3;
      if (!allPos || dur < MIN_DURATION_SEC || info.queueId !== 420 || (lastChanceForLongShort && !longShort)) {
        console.log(`건너뜀 ${c.matchId}: 포지션 ${allPos ? 'OK' : '빠짐'}, ${Math.round(dur / 60)}분, 큐 ${info.queueId}`);
        continue;
      }
      // DB의 puuid는 수집 때 키 기준이라 지금 응답의 puuid와 다를 수 있다 (2026-11-03 첫 실행에서 11판 모두 불일치).
      // 랭크 게임에서 챔피언은 판마다 하나뿐이므로 championId + 포지션으로 찾는다.
      const me = info.participants.find((x) => (x as { championId?: number }).championId === c.championId && x.teamPosition === c.position);
      if (!me) {
        console.log(`건너뜀 ${c.matchId}: 챔피언 ${c.championId}·${c.position} 참가자를 찾지 못함`);
        continue;
      }
      haveLongOrShort ||= longShort;
      chosen.push({
        matchId: c.matchId,
        participantId: me.participantId,
        position: c.position,
        role: determineRoleForEval(c.position, c.championId, TAGS),
        win: c.win,
        durationSec: dur,
        match,
      });
      break;
    }
  }
  if (chosen.length < WANT.length) console.log(`주의: ${chosen.length}/${WANT.length}판만 골랐습니다 (호출 ${riot.stats.calls}회)`);

  const items: Json[] = [];
  for (const c of chosen) {
    if (callsLeft() < 1) break;
    const timeline = (await riot.getTimeline(c.matchId)) as unknown as Json;
    const { originals } = maskMatch(c.match, timeline);
    const mText = `${JSON.stringify(c.match, null, 2)}\n`;
    const tText = `${JSON.stringify(timeline)}\n`;
    const lo = leftovers(mText + tText, originals);
    if (lo.long > 0) {
      console.error(`가림 실패: ${c.matchId}에 원래 식별 문자열(6자 이상) ${lo.long}곳. 저장하지 않습니다.`);
      return 1;
    }
    writeFileSync(join(OUT, `${c.matchId}.match.json`), mText);
    writeFileSync(join(OUT, `${c.matchId}.timeline.json`), tText);
    console.log(
      `저장 ${c.matchId}: p${c.participantId} ${c.position} ${c.role} ${c.win ? '승' : '패'} ${(c.durationSec / 60).toFixed(1)}분 · 가림 검사 6자 이상 0곳, 짧은 값 우연 일치 ${JSON.stringify(lo.short)}`,
    );
    items.push({
      matchId: c.matchId,
      match: `${c.matchId}.match.json`,
      timeline: `${c.matchId}.timeline.json`,
      participantId: c.participantId,
      position: c.position,
      role: c.role,
      note: `${c.win ? '승' : '패'}, ${(c.durationSec / 60).toFixed(1)}분`,
    });
  }
  const set = {
    description: '2단계 기준선 평가 판 5개 (포지션별 1판). 세나 판은 fixture를 가리킨다. 계정 식별 값은 가림 (ai_spec 2-9)',
    items: [
      {
        matchId: 'KR_8437852704',
        match: '../../fixtures/KR_8437852704.match.json',
        timeline: '../../fixtures/KR_8437852704.timeline.json',
        participantId: 5,
        position: 'UTILITY',
        role: 'SUPPORT_DAMAGE',
        note: '세나 판 (설계 9장), 패, 23.1분',
      },
      ...items,
    ],
  };
  writeFileSync(join(OUT, 'set.json'), `${JSON.stringify(set, null, 2)}\n`);
  console.log(`Riot 호출 ${riot.stats.calls}회 (상한 ${maxCalls}), 상태별 ${JSON.stringify(riot.stats.byStatus)}`);
  return 0;
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
