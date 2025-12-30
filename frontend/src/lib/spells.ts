/* 스펠_정보
ex) https://ddragon.leagueoflegends.com/cdn/14.18.1/data/ko_KR/summoner.json
*/
export const getSpells_Info = (version: string, language: string): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/summoner.json`;
};

/* 스펠_이미지
ex) https://ddragon.leagueoflegends.com/cdn/14.18.1/img/spell/SummonerFlash.png
*/
export const getSpells_Image = (version: string, name: string): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${name}.png`;
};
