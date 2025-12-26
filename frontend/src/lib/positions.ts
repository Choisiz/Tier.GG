const DEFAULT_VERSION =
  process.env.NEXT_PUBLIC_DDRAGON_VERSION ?? "15.11.1";

const POSITION_FILENAME: Record<string, string> = {
  TOP: "Position_Top.png",
  JUNGLE: "Position_Jungle.png",
  MIDDLE: "Position_Middle.png",
  MID: "Position_Middle.png",
  BOTTOM: "Position_Bot.png",
  BOT: "Position_Bot.png",
  ADC: "Position_Bot.png",
  UTILITY: "Position_Support.png",
  SUPPORT: "Position_Support.png",
};

const POSITION_LABELS: Record<string, string> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MIDDLE: "MIDDLE",
  MID: "MIDDLE",
  BOTTOM: "BOTTOM",
  BOT: "BOTTOM",
  ADC: "BOTTOM",
  UTILITY: "SUPPORT",
  SUPPORT: "SUPPORT",
};

// 포지션 아이콘 URL
export const getPositionIcon = (
  position?: string | null,
  version: string = DEFAULT_VERSION
): string => {
  const key = position?.toUpperCase();
  const file = POSITION_FILENAME[key ?? ""] ?? "Position_Middle.png";
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/ui/${file}`;
};

// 포지션 라벨
export const getPositionLabel = (position?: string | null): string => {
  if (!position) return "전체";
  const key = position.toUpperCase();
  return POSITION_LABELS[key] ?? key;
};

export const DEFAULT_POSITION_ICON_VERSION = DEFAULT_VERSION;
