/**
 * 능력치 파편 표 (front_spec 변경 01 01-1-4). Data Dragon JSON에 파편이 없어 프론트가 둔다.
 * 아이콘 파일은 /cdn/img/perk-images/StatMods/{file}.png.
 */
export type StatShardRow = "offense" | "flex" | "defense";

export type StatShard = { id: number; name: string; file: string };

const ADAPTIVE: StatShard = { id: 5008, name: "적응형 능력치", file: "StatModsAdaptiveForceIcon" };
const HEALTH_SCALING: StatShard = {
  id: 5001,
  name: "체력 증가(레벨 비례)",
  file: "StatModsHealthScalingIcon",
};

/** 줄별 선택지 (게임 화면 순서) */
export const STAT_SHARD_ROWS: Record<StatShardRow, StatShard[]> = {
  offense: [
    ADAPTIVE,
    { id: 5005, name: "공격 속도", file: "StatModsAttackSpeedIcon" },
    { id: 5007, name: "스킬 가속", file: "StatModsCDRScalingIcon" },
  ],
  flex: [
    ADAPTIVE,
    { id: 5010, name: "이동 속도", file: "StatModsMovementSpeedIcon" },
    HEALTH_SCALING,
  ],
  defense: [
    { id: 5011, name: "체력", file: "StatModsHealthPlusIcon" },
    { id: 5013, name: "강인함 및 둔화 저항", file: "StatModsTenacityIcon" },
    HEALTH_SCALING,
  ],
};

/** 줄 이름 */
export const STAT_SHARD_ROW_LABELS: Record<StatShardRow, string> = {
  offense: "공격",
  flex: "유연",
  defense: "방어",
};

export const STAT_SHARD_ROW_ORDER: StatShardRow[] = ["offense", "flex", "defense"];
