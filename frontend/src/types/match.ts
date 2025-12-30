// 매치 관련 타입 정의

/** 매치 참여자 정보 */
export interface MatchParticipant {
  puuid: string;
  summonerName: string;
  riotIdGameName: string;
  riotIdTagline: string;
  championId: number;
  championName: string;
  teamId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  goldEarned: number;
  totalDamageDealtToChampions: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
  summoner1Id: number;
  summoner2Id: number;
  teamPosition: string;
}

/** 매치 정보 */
export interface MatchInfo {
  gameCreation: number;
  gameDuration: number;
  gameMode: string;
  queueId: number;
  participants: MatchParticipant[];
}

/** 매치 데이터 */
export interface MatchData {
  metadata: {
    matchId: string;
  };
  info: MatchInfo;
}
