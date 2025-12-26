const RIOT_API_KEY = process.env.RIOT_API_KEY;
const RIOT_API_ASIA_BASE_URL = "https://asia.api.riotgames.com";

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

export interface MatchInfo {
  gameCreation: number;
  gameDuration: number;
  gameMode: string;
  queueId: number;
  participants: MatchParticipant[];
}

export interface MatchData {
  metadata: {
    matchId: string;
  };
  info: MatchInfo;
}

// PUUID로 매치 ID 리스트 조회
export const getMatchIdsByPuuid = async (
  puuid: string,
  start: number = 0,
  count: number = 20
): Promise<string[]> => {
  if (!RIOT_API_KEY) {
    throw new Error("RIOT_API_KEY is not configured");
  }

  const url = `${RIOT_API_ASIA_BASE_URL}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}&api_key=${RIOT_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Riot API error: ${response.status}`);
  }

  return response.json();
};

// 매치 ID로 게임 상세 데이터 조회
export const getMatchById = async (matchId: string): Promise<MatchData | null> => {
  if (!RIOT_API_KEY) {
    throw new Error("RIOT_API_KEY is not configured");
  }

  const url = `${RIOT_API_ASIA_BASE_URL}/lol/match/v5/matches/${matchId}?api_key=${RIOT_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    console.error(`Failed to fetch match ${matchId}: ${response.status}`);
    return null;
  }

  return response.json();
};

// 여러 매치 상세 데이터 병렬 조회
export const getMatchesByIds = async (matchIds: string[]): Promise<MatchData[]> => {
  const matchPromises = matchIds.map((id) => getMatchById(id));
  const matches = await Promise.all(matchPromises);
  return matches.filter((m): m is MatchData => m !== null);
};
