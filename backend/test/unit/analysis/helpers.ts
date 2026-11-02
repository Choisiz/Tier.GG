// 판정 엔진 테스트 도우미: fixture 읽기 + 가짜 판 만들기
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { championTagsFromJson } from '../../../src/analysis/role.js';
import type {
  AnalysisMatch,
  AnalysisParticipant,
  AnalysisTimeline,
  ChampionTags,
  ParticipantFrame,
  TimelineEvent,
} from '../../../src/analysis/types.js';

const dir = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const readJson = <T>(name: string): T => JSON.parse(readFileSync(`${dir}${name}`, 'utf8')) as T;

export const TAGS: ChampionTags = championTagsFromJson(readJson('ddragon/champion-tags.json'));

/** 세나 판 KR_8437852704 (닉네임·계정 식별 값 가림). 세나 = participantId 5 */
export const loadSena = () => ({
  match: readJson<AnalysisMatch>('KR_8437852704.match.json'),
  timeline: readJson<AnalysisTimeline>('KR_8437852704.timeline.json'),
});

/** 기존 fixture KR_8408851980 (timeline은 SKILL_LEVEL_UP만, participantFrames 없음) */
export const loadSecond = () => ({
  match: readJson<AnalysisMatch>('KR_8408851980.match.json'),
  timeline: readJson<AnalysisTimeline>('KR_8408851980.timeline.json'),
});

export const puuidOf = (n: number): string => `TEST_PUUID_${String(n).padStart(2, '0')}`;

// ---------- 가짜 판 ----------
// 1~5 = 100팀, 6~10 = 200팀. 포지션은 TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY 순.
// 100팀: 가렌(86, 딜탑) 리 신(64) 럭스(99) 케이틀린(51) 쓰레쉬(412, 탱서폿)
// 200팀: 오른(516, 탱탑) 마스터 이(11) 제드(238) 미스 포츈(21) 룰루(117, 유틸서폿)
const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const CHAMPS = [86, 64, 99, 51, 412, 516, 11, 238, 21, 117];

export interface FakeOptions {
  durationSec?: number;
  events?: TimelineEvent[];
  /** 프레임 i의 참가자 pid 값. 기본: 골드 1000·레벨 1·CS 0·딜 0 + i에 비례 */
  frame?: (i: number, pid: number) => ParticipantFrame;
  positions?: string[];
  turretDamage?: (pid: number) => number;
  noFrames?: boolean;
}

export function fakeGame(o: FakeOptions = {}): { match: AnalysisMatch; timeline: AnalysisTimeline } {
  const duration = o.durationSec ?? 1800;
  const positions = o.positions ?? [...POS, ...POS];
  const participants: AnalysisParticipant[] = CHAMPS.map((championId, idx) => ({
    participantId: idx + 1,
    puuid: puuidOf(idx + 1),
    teamId: idx < 5 ? 100 : 200,
    teamPosition: positions[idx]!,
    championId,
    win: idx < 5,
    damageDealtToTurrets: o.turretDamage?.(idx + 1) ?? 0,
  }));
  const whole = Math.floor(duration / 60);
  const times = Array.from({ length: whole + 1 }, (_, i) => i * 60_000);
  if (duration * 1000 > times[times.length - 1]!) times.push(duration * 1000);
  const frameOf =
    o.frame ??
    ((i: number) => ({
      totalGold: 500 + i * 400,
      level: Math.min(18, 1 + i),
      minionsKilled: i * 7,
      jungleMinionsKilled: 0,
      damageStats: { totalDamageDoneToChampions: i * 300 },
    }));
  const frames = times.map((t, i) => ({
    timestamp: t,
    events: [] as TimelineEvent[],
    ...(o.noFrames
      ? {}
      : { participantFrames: Object.fromEntries(participants.map((p) => [String(p.participantId), frameOf(i, p.participantId)])) }),
  }));
  // 이벤트는 엔진이 펼쳐 정렬하므로 마지막 프레임에 몰아 넣어도 된다
  frames[frames.length - 1]!.events.push(...(o.events ?? []));
  return {
    match: { metadata: { matchId: 'KR_1' }, info: { gameDuration: duration, participants } },
    timeline: { metadata: { matchId: 'KR_1' }, info: { frames } },
  };
}

export const kill = (min: number, killerId: number, victimId: number, assists: number[] = []): TimelineEvent => ({
  type: 'CHAMPION_KILL',
  timestamp: Math.round(min * 60_000),
  killerId,
  victimId,
  assistingParticipantIds: assists,
});

export const monster = (min: number, killerId: number, monsterType: string, monsterSubType?: string): TimelineEvent => ({
  type: 'ELITE_MONSTER_KILL',
  timestamp: Math.round(min * 60_000),
  killerId,
  killerTeamId: killerId <= 5 ? 100 : 200,
  monsterType,
  ...(monsterSubType ? { monsterSubType } : {}),
});

/** lostTeamId = 건물을 잃은 팀 */
export const turret = (min: number, lostTeamId: number, laneType: string, towerType = 'OUTER_TURRET'): TimelineEvent => ({
  type: 'BUILDING_KILL',
  timestamp: Math.round(min * 60_000),
  teamId: lostTeamId,
  buildingType: 'TOWER_BUILDING',
  laneType,
  towerType,
});

export const ward = (min: number, creatorId: number, wardType: string): TimelineEvent => ({
  type: 'WARD_PLACED',
  timestamp: Math.round(min * 60_000),
  creatorId,
  wardType,
});
