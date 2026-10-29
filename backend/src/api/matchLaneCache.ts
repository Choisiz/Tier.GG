// 경기 캐시 (back_spec 변경 04, 04-7). 키 = matchId.
// 라인전 계산에 필요한 최소 정보만 둔다: 경기 길이, 참가자 10명의 id·puuid·팀·포지션, 15분 골드(gold15).
// timeline 원본(0.6MB)은 저장하지 않는다. 끝난 게임은 안 변하므로 TTL 6시간, 최대 5,000개.
import { POSITIONS } from '../config/api.js';
import type { MatchDto } from '../riot/types.js';
import { createSummonerCache, type SummonerCache } from './summonerCache.js';

export interface LanePlayer {
  participantId: number;
  puuid: string;
  teamId: number;
  /** individualPosition. 5개 포지션이 아니면(빈 값, Invalid 등) null */
  position: string | null;
}

export interface MatchLaneInfo {
  durationSec: number;
  players: LanePlayer[];
  /**
   * participantId → 15:00 totalGold.
   * undefined: 아직 timeline을 보지 않음 / null: 계산 불가(프레임 부족·404)를 기억해 다시 부르지 않음.
   */
  gold15?: Record<number, number> | null;
}

export type MatchLaneCache = SummonerCache<MatchLaneInfo>;

export function createMatchLaneCache(ttlMs: number, maxSize: number): MatchLaneCache {
  return createSummonerCache<MatchLaneInfo>(ttlMs, maxSize);
}

const POSITION_SET = new Set<string>(POSITIONS);

/** match-v5 상세 → 경기 캐시 값 (gold15는 아직 없음) */
export function laneInfoFromMatch(match: MatchDto): MatchLaneInfo {
  return {
    durationSec: match.info.gameDuration,
    players: match.info.participants.map((p) => ({
      participantId: p.participantId,
      puuid: p.puuid,
      teamId: p.teamId,
      position: p.individualPosition && POSITION_SET.has(p.individualPosition) ? p.individualPosition : null,
    })),
  };
}
