// Riot 응답 타입: 사용하는 필드만 정의한다

export interface LeagueEntryDto {
  puuid: string;
  tier: string;
  rank: string;
  inactive?: boolean;
  leaguePoints?: number;
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
    frames: { timestamp?: number; events: TimelineEventDto[] }[];
  };
}
