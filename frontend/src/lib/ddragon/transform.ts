import {
  championIconUrl,
  championLoadingUrl,
  championSplashUrl,
  passiveIconUrl,
  skillIconUrl,
} from "./images";
import type {
  AbilityKey,
  ChampionAbility,
  ChampionDetail,
  ChampionSkin,
  ChampionSummary,
  ChampionTag,
  DDragonChampionDetail,
  DDragonChampionSummary,
} from "./types";

/** 역할군 태그 한글 이름 (표시 순서 = 필터 버튼 순서) */
export const TAG_LABELS: Record<ChampionTag, string> = {
  Fighter: "전사",
  Tank: "탱커",
  Mage: "마법사",
  Assassin: "암살자",
  Marksman: "원거리",
  Support: "서포터",
};

/** spells 배열 순서(0~3)에 대응하는 키. 패시브(P)는 별도 */
const SKILL_KEYS: AbilityKey[] = ["Q", "W", "E", "R"];

/** stripHtml에서 일반 문자로 바꿀 HTML 엔티티 */
const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/**
 * Data Dragon 설명의 HTML을 순수 텍스트로 바꾼다.
 * `<br>`·`<br />` → 줄바꿈, 나머지 태그 제거, 연속 공백 정리.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 원본 챔피언 데이터 → 리스트 카드용 데이터 (아이콘 URL 포함) */
export function toChampionSummary(
  raw: DDragonChampionSummary,
  version: string,
): ChampionSummary {
  return {
    id: raw.id,
    key: raw.key,
    name: raw.name,
    title: raw.title,
    tags: raw.tags,
    iconUrl: championIconUrl(version, raw.image.full),
  };
}

/** 한글 이름 가나다순 정렬 */
export function sortChampions(list: ChampionSummary[]): ChampionSummary[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/**
 * 원본 챔피언 상세 → 상세 화면용 데이터.
 * 스킬은 [패시브, Q, W, E, R] 순서, 스킨은 크로마를 빼고 번호순, 설명은 HTML 제거.
 */
export function toChampionDetail(
  raw: DDragonChampionDetail,
  version: string,
): ChampionDetail {
  const passive: ChampionAbility = {
    key: "P",
    name: raw.passive.name,
    description: stripHtml(raw.passive.description),
    iconUrl: passiveIconUrl(version, raw.passive.image.full),
  };

  const skills: ChampionAbility[] = raw.spells.slice(0, 4).map((skill, index) => ({
    key: SKILL_KEYS[index],
    name: skill.name,
    description: stripHtml(skill.description),
    cooldown: skill.cooldownBurn || undefined,
    // 이미지 파일명이 skill.id와 다를 수 있으므로 반드시 image.full 사용
    iconUrl: skillIconUrl(version, skill.image.full),
  }));

  const skins: ChampionSkin[] = raw.skins
    .filter((skin) => skin.parentSkin === undefined) // 크로마 제외
    .sort((a, b) => a.num - b.num)
    .map((skin) => ({
      num: skin.num,
      name: skin.name === "default" ? "기본" : skin.name,
      splashUrl: championSplashUrl(raw.id, skin.num),
      loadingUrl: championLoadingUrl(raw.id, skin.num),
    }));

  return {
    ...toChampionSummary(raw, version),
    difficulty: raw.info.difficulty,
    lore: stripHtml(raw.lore),
    abilities: [passive, ...skills],
    skins,
  };
}
