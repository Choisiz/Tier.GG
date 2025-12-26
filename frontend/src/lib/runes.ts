export type RuneDefinition = {
  id: number;
  icon: string;
};

// 룬 정보 URL
export const getRunes_Url = (version: string, language: string): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/runesReforged.json`;
};
