// 미니맵 이미지 URL
export const getMinimap_Image = (version: string, mapNumber: number): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/map/map${mapNumber}.png`;
};
