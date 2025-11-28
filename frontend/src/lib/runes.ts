export type RuneDefinition = {
  id: number;
  icon: string;
};

export async function fetchRunes(version: string, language = "ko_KR") {
  const response = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/runesReforged.json`,
    { cache: "force-cache" }
  );
  if (!response.ok) {
    throw new Error("룬 정보를 가져오지 못했습니다.");
  }
  return (await response.json()) as Array<{
    slots?: Array<{ runes?: RuneDefinition[] }>;
  }>;
}

