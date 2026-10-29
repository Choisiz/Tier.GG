// Riot 응답 타입: 사용하는 필드만 정의한다

export interface LeagueEntryDto {
  puuid: string;
  tier: string;
  rank: string;
  inactive?: boolean;
  leaguePoints?: number;
}

// account-v1 by-riot-id (back_spec 변경 03 W-2)
export interface AccountDto {
  puuid: string;
  gameName: string;
  tagLine: string;
}

// summoner-v4 by-puuid (back_spec 변경 03 W-2)
export interface SummonerDto {
  profileIconId: number;
  summonerLevel: number;
}

// league-v4 entries by-puuid (back_spec 변경 03 W-2). entries/{tier}/{division} 응답(LeagueEntryDto)과 모양이 다르다.
export interface LeagueEntryByPuuidDto {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  hotStreak: boolean;
}

export interface PerkSelectionDto {
  perk: number;
}

export interface PerkStyleDto {
  description?: string;
  style: number;
  selections: PerkSelectionDto[];
}

export interface ParticipantDto {
  participantId: number;
  puuid: string;
  championId: number;
  teamPosition?: string;
  win: boolean;
  summoner1Id: number;
  summoner2Id: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  perks: {
    statPerks: { offense: number; flex: number; defense: number };
    styles: PerkStyleDto[];
  };
  // 아래부터 전적 검색(소환사 상세, back_spec 변경 03 W-2)에만 쓰는 필드. 수집기(transform.ts)는 쓰지 않는다.
  /** 100 또는 200. 같은 팀/상대팀 구분용 (팀 순서가 항상 100 먼저는 아님) */
  teamId: number;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  item6: number;
  individualPosition?: string;
  champLevel: number;
  goldEarned: number;
  totalDamageDealtToChampions: number;
  riotIdGameName?: string;
  riotIdTagline?: string;
  gameEndedInEarlySurrender?: boolean;
  /** 변경 04: 킬관여(0~1 비율). 오래된 게임·특수 큐에서는 challenges 전체가 빠질 수 있다 */
  challenges?: { killParticipation?: number };
}

export interface BanDto {
  championId: number;
  pickTurn: number;
}

export interface TeamDto {
  teamId: number;
  bans: BanDto[];
}

export interface MatchDto {
  metadata: { matchId: string; participants?: string[] };
  info: {
    gameVersion: string;
    gameDuration: number;
    /** 게임 시작 시각 (ms). matches.game_start_at */
    gameStartTimestamp: number;
    queueId: number;
    participants: ParticipantDto[];
    teams: TeamDto[];
  };
}

export interface TimelineEventDto {
  type: string;
  timestamp: number;
  participantId?: number;
  skillSlot?: number;
  levelUpType?: string;
}

export interface TimelineDto {
  metadata: { matchId: string };
  info: {
    participants: { participantId: number; puuid: string }[];
    frames: {
      timestamp?: number;
      events: TimelineEventDto[];
      /** 변경 04: 키는 문자열 participantId("1"~"10"). 수집기는 쓰지 않는다 */
      participantFrames?: Record<string, { totalGold?: number }>;
    }[];
  };
}
