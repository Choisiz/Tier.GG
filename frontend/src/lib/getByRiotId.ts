//라이엇ID정보(게임이름,태그,puuid)
export const getByRiotId= (gameName: string, tagLine: string, api_key:string): string =>{
  return `https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}?api_key=${api_key}`;
}