/* 룬_정보
https://ddragon.leagueoflegends.com/cdn/14.18.1/data/ko_KR/runesReforged.json
*/

export const getRunes = (version: string, language: string): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/runesReforged.json`;
};
