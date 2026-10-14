// Riot JSON → DB 줄 변환 (순수 함수, DB·네트워크 없음). 계약 6·7장, back_spec 4장.
import { POSITIONS } from '../config/api.js';
import type { MatchDto, ParticipantDto, PerkStyleDto, TimelineDto } from '../riot/types.js';

export type SkipReason = 'not_solo' | 'too_short' | 'not_10_players' | 'out_of_window' | 'bad_format';

export interface MatchRow {
  match_id: string;
  puuid: string | null;
  patch: string;
  /** info.gameStartTimestamp(ms) → timestamptz */
  game_start_at: Date;
}

export interface PlayerRow {
  match_id: string;
  puuid: string;
  champion_id: number;
  team_position: string | null;
  win: boolean;
  ban_champion_id: number | null;
  summoner1_id: number;
  summoner2_id: number;
  primary_style: number;
  primary_perk1: number;
  primary_perk2: number;
  primary_perk3: number;
  primary_perk4: number;
  sub_style: number;
  sub_perk1: number;
  sub_perk2: number;
  stat_offense: number;
  stat_flex: number;
  stat_defense: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  skill_order: string | null;
}

/** 저장은 하되 기록해 둘 이상한 값 개수 (stdout 요약용, collection_logs에 컬럼 없음) */
export interface TransformWarnings {
  banUnmatched: number;
  badPosition: number;
  badSkillSlot: number;
}

export const emptyWarnings = (): TransformWarnings => ({ banUnmatched: 0, badPosition: 0, badSkillSlot: 0 });

export type TransformResult =
  | { ok: true; match: MatchRow; players: PlayerRow[]; warnings: TransformWarnings }
  | { ok: false; reason: SkipReason; detail: string };

const MATCH_ID_RE = /^KR_[0-9]+$/;
const PATCH_RE = /^[0-9]+\.[0-9]+$/;
const SKILL_LETTER: Record<number, string> = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' };
const POSITION_SET = new Set<string>(POSITIONS);

/** '16.19.823.722' → '16.19', '16.9.1' → '16.9'. 형식이 틀리면 null */
export function parsePatch(gameVersion: unknown): string | null {
  if (typeof gameVersion !== 'string') return null;
  const parts = gameVersion.split('.');
  if (parts.length < 2) return null;
  const patch = `${parts[0]}.${parts[1]}`;
  if (!PATCH_RE.test(patch)) return null;
  // 앞의 0 정리: '16.09' 같은 값이 오면 숫자 기준으로 맞춘다
  return `${Number(parts[0])}.${Number(parts[1])}`;
}

export interface PrefilterOptions {
  queue: number;
  minGameDurationSec: number;
  /** 창 시작 시각 (ms). 실행을 시작할 때 한 번 정한 값 (back_spec 변경 01-4) */
  windowStartMs: number;
}

/** DB CHECK matches_game_start_at_check 하한: 2020-01-01T00:00:00Z */
export const MIN_GAME_START_MS = 1_577_836_800_000;

/**
 * 타임라인을 부르기 전에 거르기 (호출 절약). 통과하면 { patch, gameStartAt }.
 * 순서: bad_format(ID) → not_solo → too_short → not_10_players → bad_format(패치) → 시작 시각 (변경 01-4-2)
 */
export function prefilterMatch(
  match: MatchDto,
  opts: PrefilterOptions,
): { ok: true; patch: string; gameStartAt: Date } | { ok: false; reason: SkipReason; detail: string } {
  const info = match?.info;
  const id = match?.metadata?.matchId;
  if (!info || typeof id !== 'string' || !MATCH_ID_RE.test(id)) {
    return { ok: false, reason: 'bad_format', detail: 'match_id 형식' };
  }
  if (info.queueId !== opts.queue) return { ok: false, reason: 'not_solo', detail: `queueId=${info.queueId}` };
  if (typeof info.gameDuration !== 'number' || info.gameDuration < opts.minGameDurationSec) {
    return { ok: false, reason: 'too_short', detail: `gameDuration=${info.gameDuration}` };
  }
  if (!Array.isArray(info.participants) || info.participants.length !== 10) {
    return { ok: false, reason: 'not_10_players', detail: `participants=${info.participants?.length}` };
  }
  const patch = parsePatch(info.gameVersion);
  if (!patch) return { ok: false, reason: 'bad_format', detail: `gameVersion=${String(info.gameVersion)}` };
  const start: unknown = info.gameStartTimestamp;
  if (typeof start !== 'number' || !Number.isInteger(start) || start < MIN_GAME_START_MS) {
    return { ok: false, reason: 'bad_format', detail: `gameStartTimestamp=${String(start)}` };
  }
  if (start < opts.windowStartMs) {
    return { ok: false, reason: 'out_of_window', detail: `gameStartTimestamp=${start}` };
  }
  return { ok: true, patch, gameStartAt: new Date(start) };
}

class BadFormat extends Error {}

function int(v: unknown, what: string, min = Number.MIN_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) throw new BadFormat(`${what}=${String(v)}`);
  return v;
}

function pickStyle(styles: PerkStyleDto[], description: string, fallbackIndex: number): PerkStyleDto {
  const s = styles.find((x) => x?.description === description) ?? styles[fallbackIndex];
  if (!s) throw new BadFormat(`perks.styles ${description} 없음`);
  return s;
}

/** 그 참가자의 SKILL_LEVEL_UP(NORMAL)을 timestamp 순으로 Q/W/E/R 문자열로 */
export function buildSkillOrder(
  timeline: TimelineDto,
  participantId: number,
  warnings: TransformWarnings,
): string | null {
  const events: { t: number; i: number; slot: number }[] = [];
  let i = 0;
  for (const frame of timeline.info.frames ?? []) {
    for (const e of frame.events ?? []) {
      i++;
      if (e.type !== 'SKILL_LEVEL_UP' || e.participantId !== participantId) continue;
      if (e.levelUpType !== 'NORMAL') continue; // 카이사 등의 EVOLVE 제외
      events.push({ t: e.timestamp, i, slot: e.skillSlot ?? -1 });
    }
  }
  // timestamp 오름차순, 같으면 원래 순서 유지
  events.sort((a, b) => a.t - b.t || a.i - b.i);
  let out = '';
  for (const e of events) {
    const letter = SKILL_LETTER[e.slot];
    if (!letter) {
      warnings.badSkillSlot++;
      continue;
    }
    out += letter;
  }
  return out.length > 0 ? out : null;
}

/**
 * match + timeline → matches 1줄 + match_players 10줄 (또는 건너뛸 이유)
 * samplePuuid: ②에서 이 게임 ID를 처음 찾은 표본 플레이어
 */
export function transformMatch(
  match: MatchDto,
  timeline: TimelineDto,
  samplePuuid: string | null,
  opts: PrefilterOptions,
): TransformResult {
  const pre = prefilterMatch(match, opts);
  if (!pre.ok) return pre;
  const matchId = match.metadata.matchId;
  const warnings = emptyWarnings();
  try {
    if (timeline?.metadata?.matchId !== matchId) throw new BadFormat('타임라인 matchId 불일치');
    const tlParticipants = timeline.info?.participants;
    if (!Array.isArray(tlParticipants)) throw new BadFormat('타임라인 participants 없음');

    // 밴: pickTurn → championId
    const banByTurn = new Map<number, number>();
    for (const team of match.info.teams ?? []) {
      for (const b of team.bans ?? []) banByTurn.set(b.pickTurn, b.championId);
    }

    const seen = new Set<string>();
    const players = match.info.participants.map((p: ParticipantDto): PlayerRow => {
      if (typeof p.puuid !== 'string' || p.puuid.length === 0) throw new BadFormat('puuid 없음');
      if (seen.has(p.puuid)) throw new BadFormat('puuid 중복');
      seen.add(p.puuid);
      const participantId = int(p.participantId, 'participantId', 1);

      // 타임라인 참가자는 puuid로 확인 (번호만 믿지 않음)
      const tl = tlParticipants.find((x) => x.puuid === p.puuid);
      if (!tl) throw new BadFormat('타임라인 참가자 매칭 실패');

      let teamPosition: string | null = null;
      if (typeof p.teamPosition === 'string' && p.teamPosition !== '') {
        if (POSITION_SET.has(p.teamPosition)) teamPosition = p.teamPosition;
        else warnings.badPosition++;
      }

      let ban: number | null = null;
      if (banByTurn.has(participantId)) {
        const c = banByTurn.get(participantId) as number;
        ban = typeof c === 'number' && c > 0 ? c : null;
      } else {
        warnings.banUnmatched++;
      }

      const styles = p.perks?.styles;
      if (!Array.isArray(styles)) throw new BadFormat('perks.styles 없음');
      const primary = pickStyle(styles, 'primaryStyle', 0);
      const sub = pickStyle(styles, 'subStyle', 1);
      if (primary.selections?.length !== 4) throw new BadFormat(`핵심 룬 ${primary.selections?.length}개`);
      if (sub.selections?.length !== 2) throw new BadFormat(`보조 룬 ${sub.selections?.length}개`);
      const sp = p.perks.statPerks;
      if (!sp) throw new BadFormat('statPerks 없음');
      const [p1, p2, p3, p4] = primary.selections as [{ perk: number }, { perk: number }, { perk: number }, { perk: number }];
      const [s1, s2] = sub.selections as [{ perk: number }, { perk: number }];

      if (typeof p.win !== 'boolean') throw new BadFormat('win');

      return {
        match_id: matchId,
        puuid: p.puuid,
        champion_id: int(p.championId, 'championId', 1),
        team_position: teamPosition,
        win: p.win,
        ban_champion_id: ban,
        summoner1_id: int(p.summoner1Id, 'summoner1Id', 1),
        summoner2_id: int(p.summoner2Id, 'summoner2Id', 1),
        primary_style: int(primary.style, 'primaryStyle'),
        primary_perk1: int(p1.perk, 'perk'),
        primary_perk2: int(p2.perk, 'perk'),
        primary_perk3: int(p3.perk, 'perk'),
        primary_perk4: int(p4.perk, 'perk'),
        sub_style: int(sub.style, 'subStyle'),
        sub_perk1: int(s1.perk, 'perk'),
        sub_perk2: int(s2.perk, 'perk'),
        stat_offense: int(sp.offense, 'statPerks.offense'),
        stat_flex: int(sp.flex, 'statPerks.flex'),
        stat_defense: int(sp.defense, 'statPerks.defense'),
        // item6(장신구)은 저장하지 않는다. 빈 칸은 0 그대로
        item0: int(p.item0, 'item0', 0),
        item1: int(p.item1, 'item1', 0),
        item2: int(p.item2, 'item2', 0),
        item3: int(p.item3, 'item3', 0),
        item4: int(p.item4, 'item4', 0),
        item5: int(p.item5, 'item5', 0),
        skill_order: buildSkillOrder(timeline, tl.participantId, warnings),
      };
    });

    return {
      ok: true,
      match: { match_id: matchId, puuid: samplePuuid, patch: pre.patch, game_start_at: pre.gameStartAt },
      players,
      warnings,
    };
  } catch (err) {
    if (err instanceof BadFormat) return { ok: false, reason: 'bad_format', detail: err.message };
    throw err;
  }
}
