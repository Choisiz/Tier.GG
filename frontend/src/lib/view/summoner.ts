import "server-only";
import type {
  League,
  MatchParticipant,
  MatchSummary,
  SummonerResponse,
} from "@/lib/api/types";
import { profileIconUrl } from "@/lib/ddragon/images";
import type { ChampionSummary, IconInfo, ItemInfo, RuneTreeInfo } from "@/lib/ddragon/types";
import { formatCsPerMinute, formatDuration, formatKda, formatPercent, formatRelativeKo } from "./format";

/* ───────── 랭크 (D33, D34) ───────── */

const QUEUE_LABELS: Record<string, string> = {
  RANKED_SOLO_5x5: "솔로/듀오",
  RANKED_FLEX_SR: "자유랭크",
};

/** 모르는 큐는 원문 그대로 (D33 (a)) */
function queueLabel(queueType: string): string {
  return QUEUE_LABELS[queueType] ?? queueType;
}

const TIER_LABELS: Record<string, string> = {
  IRON: "아이언",
  BRONZE: "브론즈",
  SILVER: "실버",
  GOLD: "골드",
  PLATINUM: "플래티넘",
  EMERALD: "에메랄드",
  DIAMOND: "다이아몬드",
  MASTER: "마스터",
  GRANDMASTER: "그랜드마스터",
  CHALLENGER: "챌린저",
};

const RANK_LABELS: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4" };

/** 상위 4티어(마스터+)는 랭크(단계)가 없다 */
const RANKLESS_TIERS = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

/** "에메랄드 2" (D34: 글자 배지만) */
function tierLabel(league: League): string {
  const tier = TIER_LABELS[league.tier] ?? league.tier;
  if (RANKLESS_TIERS.has(league.tier)) return tier;
  const rank = RANK_LABELS[league.rank] ?? league.rank;
  return `${tier} ${rank}`;
}

/**
 * 2026-10-27: D34를 뒤집음 — 사용자가 직접 마련한 랭크 엠블럼 이미지(`public/rank-emblems/`,
 * 10개 티어)를 쓴다. Data Dragon에는 정식 엠블럼이 없어서 로컬 정적 파일로 둔다.
 */
function tierEmblemUrl(tier: string): string | undefined {
  if (!TIER_LABELS[tier]) return undefined;
  return `/rank-emblems/${tier.toLowerCase()}.png`;
}

export type LeagueView = {
  queueLabel: string;
  tierLabel: string;
  tierEmblemUrl?: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  winRate: string;
};

function toLeagueView(league: League): LeagueView {
  const total = league.wins + league.losses;
  const winRate = total > 0 ? formatPercent((league.wins / total) * 100) : "0.0%";
  return {
    queueLabel: queueLabel(league.queueType),
    tierLabel: tierLabel(league),
    tierEmblemUrl: tierEmblemUrl(league.tier),
    leaguePoints: league.leaguePoints,
    wins: league.wins,
    losses: league.losses,
    winRate,
  };
}

/* ───────── 프로필 ───────── */

export type SummonerProfileView = {
  gameName: string;
  tagLine: string;
  level: number;
  iconUrl: string;
};

/* ───────── 아이템·주문·룬 조회표 ───────── */

export type SlotView = {
  id: number;
  name: string;
  iconUrl?: string;
  description?: string;
} | null;

function toSlotView(itemId: number, items: Map<number, ItemInfo>): SlotView {
  if (itemId === 0) return null;
  const info = items.get(itemId);
  return {
    id: itemId,
    name: info?.name ?? `알 수 없는 아이템 #${itemId}`,
    iconUrl: info?.iconUrl,
    description: info?.description,
  };
}

function toSpellView(spellId: number, spells: Map<string, IconInfo>) {
  const info = spells.get(String(spellId));
  return {
    id: spellId,
    name: info?.name ?? `알 수 없는 주문 #${spellId}`,
    iconUrl: info?.iconUrl,
    description: info?.description,
  };
}

export type KeystoneView = {
  id: number;
  name: string;
  iconUrl?: string;
  description?: string;
  treeName?: string;
  treeIconUrl?: string;
};

/** 핵심 룬 id → 룬 정보 + 소속 트리(D32). `getRuneTrees()`를 평탄화해 한 번만 만든다 */
export type KeystoneMap = Map<number, KeystoneView>;

export function toKeystoneMap(trees: RuneTreeInfo[]): KeystoneMap {
  const map: KeystoneMap = new Map();
  for (const tree of trees) {
    // 0번 줄 = 핵심 룬 줄
    for (const rune of tree.rows[0] ?? []) {
      map.set(rune.id, {
        id: rune.id,
        name: rune.name,
        iconUrl: rune.iconUrl,
        description: rune.description,
        treeName: tree.name,
        treeIconUrl: tree.iconUrl,
      });
    }
  }
  return map;
}

function toKeystoneView(perkId: number, keystones: KeystoneMap): KeystoneView {
  return (
    keystones.get(perkId) ?? {
      id: perkId,
      name: `알 수 없는 룬 #${perkId}`,
    }
  );
}

export type ChampionIconView = {
  championId: number;
  name: string;
  iconUrl?: string;
};

function toChampionIconView(
  championId: number,
  champions: Map<string, ChampionSummary>,
): ChampionIconView {
  const info = champions.get(String(championId));
  return {
    championId,
    name: info?.name ?? `챔피언 #${championId}`,
    iconUrl: info?.iconUrl,
  };
}

/**
 * 같은 팀/상대팀 참가자 1명. 챔피언 아이콘 + (있으면) 닉네임. 목록에선 태그(#...)는 빼고 이름만(2026-10-27).
 * `damagePercent`는 그 매치 10명 중 최댓값 대비 비율(0~100) — 초상화·이름 아래 딜량 막대그래프용(2026-10-27 추가).
 */
export type ParticipantView = ChampionIconView & { displayName?: string; damagePercent: number };

function toParticipantView(
  participant: MatchParticipant,
  champions: Map<string, ChampionSummary>,
  maxDamage: number,
): ParticipantView {
  const icon = toChampionIconView(participant.championId, champions);
  const damagePercent = maxDamage > 0 ? Math.round((participant.damage / maxDamage) * 100) : 0;
  return { ...icon, displayName: participant.gameName ?? undefined, damagePercent };
}

/* ───────── 매치 ───────── */

export type MatchView = {
  matchId: string;
  win: boolean;
  champion: ChampionIconView;
  champLevel: number;
  /** "솔랭" 등, 승리/패배 아래 표시 (2026-10-27 추가, 포지션 줄을 대신함) */
  queueLabel: string;
  relativeTime: string;
  duration: string;
  kills: number;
  deaths: number;
  assists: number;
  kda: string;
  cs: number;
  csPerMinute: string;
  items: SlotView[];
  trinket: SlotView;
  summonerSpells: ReturnType<typeof toSpellView>[];
  keystone: KeystoneView;
  team: ParticipantView[];
  enemy: ParticipantView[];
};

type MatchContext = {
  champions: Map<string, ChampionSummary>;
  items: Map<number, ItemInfo>;
  spells: Map<string, IconInfo>;
  keystones: KeystoneMap;
};

/**
 * 매치 1건의 Riot 큐 ID → 짧은 한글 이름. "승리" 아래 자리라 짧게(2026-10-27 추가, 포지션 줄을 대신함).
 * 모르는 큐는 숨기지 않고 "기타"로 표시해 정보가 사라지지 않게 한다(D33과 같은 원칙).
 */
const QUEUE_ID_KO: Record<number, string> = {
  420: "솔랭",
  440: "자유랭크",
  430: "일반",
  400: "일반",
  490: "일반",
  450: "칼바람",
  900: "URF",
  1700: "아레나",
  720: "칼바람 격전",
  830: "AI 상대",
  840: "AI 상대",
  850: "AI 상대",
};

function queueIdLabel(queueId: number): string {
  return QUEUE_ID_KO[queueId] ?? "기타";
}

function toMatchView(match: MatchSummary, ctx: MatchContext): MatchView {
  const allDamage = [...match.participants.team, ...match.participants.enemy].map((p) => p.damage);
  const maxDamage = Math.max(0, ...allDamage);
  return {
    matchId: match.matchId,
    win: match.win,
    champion: toChampionIconView(match.championId, ctx.champions),
    champLevel: match.champLevel,
    queueLabel: queueIdLabel(match.queueId),
    relativeTime: formatRelativeKo(match.gameStartAt),
    duration: formatDuration(match.gameDurationSec),
    kills: match.kills,
    deaths: match.deaths,
    assists: match.assists,
    kda: formatKda(match.kills, match.deaths, match.assists),
    cs: match.cs,
    csPerMinute: formatCsPerMinute(match.cs, match.gameDurationSec),
    items: match.items.map((itemId) => toSlotView(itemId, ctx.items)),
    trinket: toSlotView(match.trinket, ctx.items),
    summonerSpells: match.summonerSpells.map((id) => toSpellView(id, ctx.spells)),
    keystone: toKeystoneView(match.keystone, ctx.keystones),
    team: match.participants.team.map((p) => toParticipantView(p, ctx.champions, maxDamage)),
    enemy: match.participants.enemy.map((p) => toParticipantView(p, ctx.champions, maxDamage)),
  };
}

/* ───────── 전체 화면용 데이터 ───────── */

export type SummonerPageView = {
  profile: SummonerProfileView;
  leagues: LeagueView[];
  matches: MatchView[];
};

export function toSummonerPageView(
  response: SummonerResponse,
  version: string,
  ctx: MatchContext,
): SummonerPageView {
  return {
    profile: {
      gameName: response.summoner.gameName,
      tagLine: response.summoner.tagLine,
      level: response.summoner.summonerLevel,
      iconUrl: profileIconUrl(version, response.summoner.profileIconId),
    },
    // 2026-10-27: 자유랭크 카드 삭제, 솔로/듀오만 보여준다
    leagues: response.leagues.filter((l) => l.queueType === "RANKED_SOLO_5x5").map(toLeagueView),
    matches: response.matches.map((match) => toMatchView(match, ctx)),
  };
}
