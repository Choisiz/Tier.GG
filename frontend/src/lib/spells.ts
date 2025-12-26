// 스펠 정보 URL
export const getSpells_Info = (version: string, language: string): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/summoner.json`;
};

// 스펠 이미지 URL
export const getSpells_Image = (version: string, name: string): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${name}.png`;
};
