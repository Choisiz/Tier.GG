import "server-only";
import type {
  League,
  MatchParticipant,
  MatchSummary,
  SummonerResponse,
} from "@/lib/api/types";
import { profileIconUrl } from "@/lib/ddragon/images";
import type { ChampionSummary, IconInfo, ItemInfo, RuneTreeInfo } from "@/lib/ddragon/types";
import { formatKillParticipation } from "./laneGold";
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

/** "에메랄드 2" (마스터 이상은 단계 없이 "마스터") */
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
  hotStreak: boolean;
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
    hotStreak: league.hotStreak,
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
  /** 킬관여 "62%", 값이 없으면 "-" (2026-10-30 추가) */
  killParticipation: string;
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
    killParticipation: formatKillParticipation(match.killParticipation),
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

/* ───────── 최근 게임 요약 카드 (변경 07) ───────── */

/** 5분 미만 게임은 요약에서 뺀다 (다시하기 근사, D39) */
const MIN_SUMMARY_DURATION_SEC = 300;

export type MostChampionView = {
  champion: ChampionIconView;
  games: number;
  /** 정수 % */
  winRate: number;
  kda: string;
};

export type MatchSummaryView = {
  /** 집계한 게임 수 N (5분 미만 제외 후) */
  count: number;
  wins: number;
  losses: number;
  /** 정수 % */
  winRate: number;
  avgKills: string;
  avgDeaths: string;
  avgAssists: string;
  kda: string;
  /** 5분 미만이라 뺀 게임 수 */
  excludedCount: number;
  most: MostChampionView[];
};

/**
 * 받은 매치 전체(최대 20건)를 합산해 요약한다. 게임별 KDA의 평균이 아니라 K·D·A 합으로 계산한다.
 * 모스트 3 정렬: 게임 수 → 승 수 → 최근 플레이(matches가 최신순이라 처음 나타난 순서).
 */
export function toMatchSummary(
  matches: MatchSummary[],
  champions: Map<string, ChampionSummary>,
): MatchSummaryView {
  const counted = matches.filter((m) => m.gameDurationSec >= MIN_SUMMARY_DURATION_SEC);
  const count = counted.length;
  const wins = counted.filter((m) => m.win).length;
  const sum = (pick: (m: MatchSummary) => number) => counted.reduce((acc, m) => acc + pick(m), 0);
  const kills = sum((m) => m.kills);
  const deaths = sum((m) => m.deaths);
  const assists = sum((m) => m.assists);
  const avg = (total: number) => (count > 0 ? (total / count).toFixed(1) : "0.0");

  type Acc = { championId: number; games: number; wins: number; k: number; d: number; a: number };
  const byChampion = new Map<number, Acc>(); // Map은 삽입순 = 최근 플레이 순서
  for (const m of counted) {
    const acc = byChampion.get(m.championId) ?? {
      championId: m.championId,
      games: 0,
      wins: 0,
      k: 0,
      d: 0,
      a: 0,
    };
    acc.games += 1;
    if (m.win) acc.wins += 1;
    acc.k += m.kills;
    acc.d += m.deaths;
    acc.a += m.assists;
    byChampion.set(m.championId, acc);
  }
  const most = [...byChampion.values()]
    // Array.prototype.sort는 안정 정렬이라 동률이면 삽입순(최근 먼저)이 유지된다
    .sort((x, y) => y.games - x.games || y.wins - x.wins)
    .slice(0, 3)
    .map((acc) => ({
      champion: toChampionIconView(acc.championId, champions),
      games: acc.games,
      winRate: Math.round((100 * acc.wins) / acc.games),
      kda: formatKda(acc.k, acc.d, acc.a),
    }));

  return {
    count,
    wins,
    losses: count - wins,
    winRate: count > 0 ? Math.round((100 * wins) / count) : 0,
    avgKills: avg(kills),
    avgDeaths: avg(deaths),
    avgAssists: avg(assists),
    kda: formatKda(kills, deaths, assists),
    excludedCount: matches.length - count,
    most,
  };
}

/* ───────── 전체 화면용 데이터 ───────── */

export type SummonerPageView = {
  profile: SummonerProfileView;
  /** 솔로/듀오 슬롯. 해당 큐 항목이 없으면 null (Unranked 카드) */
  soloLeague: LeagueView | null;
  /** 자유랭크 슬롯. 해당 큐 항목이 없으면 null */
  flexLeague: LeagueView | null;
  /** 프로필 헤더 티어 줄 기준: 솔로 → 자유랭크 → null(Unranked) (변경 09 Q4) */
  headline: { league: LeagueView; isFlex: boolean } | null;
  matches: MatchView[];
  summary: MatchSummaryView;
};

export function toSummonerPageView(
  response: SummonerResponse,
  version: string,
  ctx: MatchContext,
): SummonerPageView {
  const find = (queueType: string) => {
    const league = response.leagues.find((l) => l.queueType === queueType);
    return league ? toLeagueView(league) : null;
  };
  const soloLeague = find("RANKED_SOLO_5x5");
  const flexLeague = find("RANKED_FLEX_SR");
  return {
    profile: {
      gameName: response.summoner.gameName,
      tagLine: response.summoner.tagLine,
      level: response.summoner.summonerLevel,
      iconUrl: profileIconUrl(version, response.summoner.profileIconId),
    },
    // 2026-10-30: 자유랭크 카드를 다시 보여준다(2026-10-27 삭제를 되돌림). 응답 순서와 무관하게 큐로 찾는다
    soloLeague,
    flexLeague,
    headline: soloLeague
      ? { league: soloLeague, isFlex: false }
      : flexLeague
        ? { league: flexLeague, isFlex: true }
        : null,
    matches: response.matches.map((match) => toMatchView(match, ctx)),
    summary: toMatchSummary(response.matches, ctx.champions),
  };
}
