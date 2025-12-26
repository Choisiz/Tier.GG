const RIOT_API_KEY = process.env.RIOT_API_KEY;

export interface PlayerInfo {
  puuid: string;
  gameName: string;
  tagLine: string;
}

// 라이엇ID 조회 URL
export const getByRiotId_Url = (gameName: string, tagLine: string, api_key: string): string => {
  return `https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}?api_key=${api_key}`;
};

// 라이엇ID로 플레이어 정보 조회 (게임이름, 태그, puuid)
export const getByRiotId = async (
  gameName: string,
  tagLine: string = "KR1"
): Promise<PlayerInfo> => {
  if (!RIOT_API_KEY) {
    throw new Error("RIOT_API_KEY is not configured");
  }

  const encodedGameName = encodeURIComponent(gameName);
  const encodedTagLine = encodeURIComponent(tagLine);

  const url = getByRiotId_Url(encodedGameName, encodedTagLine, RIOT_API_KEY);

  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Player not found");
    }
    throw new Error(`Riot API error: ${response.status}`);
  }

  return response.json();
};
