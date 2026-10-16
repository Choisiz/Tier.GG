import type { ItemBuild, RuneBuild, SkillBuild, SpellBuild } from "@/lib/api/types";
import {
  BOOTS_MIN_PICK_RATE,
  CORE_ITEM_COUNT,
  categorizeItem,
} from "@/lib/ddragon/itemFilter";
import { statShardIconUrl } from "@/lib/ddragon/images";
import {
  STAT_SHARD_ROW_LABELS,
  STAT_SHARD_ROW_ORDER,
  STAT_SHARD_ROWS,
} from "@/lib/ddragon/statShards";
import type { ChampionAbility, IconInfo, ItemInfo, RuneTreeInfo } from "@/lib/ddragon/types";
import { formatCount, formatPercent } from "./format";

/** 빌드 공통 숫자 (가공된 글자) */
export type BuildRateView = {
  pickRate: string;
  winRate: string;
  pick: string;
};

function toRates(build: { pickRate: number; winRate: number; pick: number }): BuildRateView {
  return {
    pickRate: formatPercent(build.pickRate),
    winRate: formatPercent(build.winRate),
    pick: formatCount(build.pick),
  };
}

/* ───────── 룬 ───────── */

export type RuneCellView = {
  id: number;
  name: string;
  /** 못 찾은 룬은 없음 (회색 칸) */
  iconUrl?: string;
  selected: boolean;
};

export type RuneTreeView = {
  id: number;
  name: string;
  iconUrl?: string;
  rows: RuneCellView[][];
};

export type RunePageView = BuildRateView & {
  primary: RuneTreeView;
  secondary: RuneTreeView;
  shards: { label: string; cells: RuneCellView[] }[];
  /** 스크린리더용 요약 "핵심 룬: 정복자, 승전보, …" */
  summary: string;
};

/**
 * 트리 1개를 줄별로 만든다. 고른 룬만 `selected`.
 * 트리에서 못 찾은 고른 룬은 맨 아래 줄에 "알 수 없는 룬 #id"로 붙인다.
 * @param rowStart 보조 트리는 1 (핵심 룬 줄 제외)
 */
function toRuneTree(
  trees: RuneTreeInfo[],
  treeId: number,
  perks: number[],
  rowStart: number,
): RuneTreeView {
  const tree = trees.find((t) => t.id === treeId);
  const chosen = new Set(perks);
  const rows: RuneCellView[][] = (tree?.rows.slice(rowStart) ?? []).map((row) =>
    row.map((rune) => ({ ...rune, selected: chosen.has(rune.id) })),
  );
  const found = new Set(rows.flat().filter((cell) => cell.selected).map((cell) => cell.id));
  const missing = perks.filter((id) => !found.has(id));
  if (missing.length > 0) {
    rows.push(
      missing.map((id) => ({ id, name: `알 수 없는 룬 #${id}`, selected: true })),
    );
  }
  return {
    id: treeId,
    name: tree?.name ?? `알 수 없는 룬 #${treeId}`,
    iconUrl: tree?.iconUrl,
    rows,
  };
}

/** 고른 룬 이름을 API 순서대로 */
function chosenNames(tree: RuneTreeView, perks: number[]): string[] {
  const byId = new Map(tree.rows.flat().map((cell) => [cell.id, cell.name]));
  return perks.map((id) => byId.get(id) ?? `알 수 없는 룬 #${id}`);
}

export function toRunePage(build: RuneBuild, trees: RuneTreeInfo[]): RunePageView {
  const primary = toRuneTree(trees, build.primaryStyle, build.primaryPerks, 0);
  const secondary = toRuneTree(trees, build.subStyle, build.subPerks, 1);

  const shards = STAT_SHARD_ROW_ORDER.map((row) => {
    const chosenId = build.statPerks[row];
    const cells: RuneCellView[] = STAT_SHARD_ROWS[row].map((shard) => ({
      id: shard.id,
      name: shard.name,
      iconUrl: statShardIconUrl(shard.file),
      selected: shard.id === chosenId,
    }));
    if (!cells.some((cell) => cell.selected)) {
      cells.push({ id: chosenId, name: "알 수 없는 파편", selected: true });
    }
    return { label: STAT_SHARD_ROW_LABELS[row], cells };
  });

  const shardNames = shards.map(
    (row) => `${row.label} ${row.cells.find((cell) => cell.selected)?.name ?? ""}`,
  );
  const summary = [
    `핵심 룬(${primary.name}): ${chosenNames(primary, build.primaryPerks).join(", ")}`,
    `보조 룬(${secondary.name}): ${chosenNames(secondary, build.subPerks).join(", ")}`,
    `능력치 파편: ${shardNames.join(", ")}`,
  ].join(". ");

  return { ...toRates(build), primary, secondary, shards, summary };
}

/* ───────── 소환사 주문 ───────── */

export type SpellComboView = BuildRateView & {
  spells: { id: number; name: string; iconUrl?: string }[];
};

export function toSpellCombo(build: SpellBuild, spells: Map<string, IconInfo>): SpellComboView {
  return {
    ...toRates(build),
    spells: build.spellIds.map((id) => {
      const info = spells.get(String(id));
      return { id, name: info?.name ?? `알 수 없는 주문 #${id}`, iconUrl: info?.iconUrl };
    }),
  };
}

/* ───────── 스킬 순서 ───────── */

export type SkillKey = "Q" | "W" | "E" | "R";

export const SKILL_KEYS: SkillKey[] = ["Q", "W", "E", "R"];

export type SkillOrderView = BuildRateView & {
  /** 11칸, 1번째 = 1레벨 */
  order: SkillKey[];
};

export type SkillOrderSet = {
  /** Q/W/E/R 줄 머리 (스킬 이름·아이콘) */
  heads: { key: SkillKey; name?: string; iconUrl?: string }[];
  builds: SkillOrderView[];
};

export function toSkillOrders(builds: SkillBuild[], abilities: ChampionAbility[]): SkillOrderSet {
  return {
    heads: SKILL_KEYS.map((key) => {
      const ability = abilities.find((a) => a.key === key);
      return { key, name: ability?.name, iconUrl: ability?.iconUrl };
    }),
    builds: builds.map((build) => ({
      ...toRates(build),
      order: build.skillOrder.split("").filter((c): c is SkillKey =>
        (SKILL_KEYS as string[]).includes(c),
      ),
    })),
  };
}

/* ───────── 아이템 ───────── */

export type ItemView = BuildRateView & {
  id: number;
  name: string;
  iconUrl: string;
};

export type CoreItemsView = {
  core: ItemView[];
  /** 사용률 5% 미만이거나 없으면 없음 (칸 숨김) */
  boots?: ItemView;
};

/**
 * 핵심 3개 + 신발 1개 (D3·D9). API 순서(pick 내림차순)를 유지한다.
 * Data Dragon에서 못 찾은 아이템은 빼고 서버 경고 1줄.
 */
export function toCoreItems(
  builds: ItemBuild[],
  items: Map<number, ItemInfo>,
  context: string,
): CoreItemsView {
  const core: ItemView[] = [];
  let boots: ItemView | undefined;
  const unknown: number[] = [];

  for (const build of builds) {
    const info = items.get(build.itemId);
    if (!info) {
      unknown.push(build.itemId);
      continue;
    }
    const category = categorizeItem(info);
    const view: ItemView = { ...toRates(build), id: build.itemId, name: info.name, iconUrl: info.iconUrl };
    if (category === "core" && core.length < CORE_ITEM_COUNT) {
      core.push(view);
    } else if (category === "boots" && !boots && build.pickRate >= BOOTS_MIN_PICK_RATE) {
      boots = view;
    }
  }
  if (unknown.length > 0) {
    console.warn(`[view] Data Dragon에 없는 아이템 (${context}): ${unknown.join(", ")}`);
  }
  return { core, boots };
}
