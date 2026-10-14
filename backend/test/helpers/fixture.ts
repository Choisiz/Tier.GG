// 테스트 fixture: 실제 게임 KR_8408851980 (puuid·riotId는 가짜 값으로 바꿔 저장, 타임라인은 SKILL_LEVEL_UP만)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MatchDto, TimelineDto } from '../../src/riot/types.js';

const dir = fileURLToPath(new URL('../fixtures/', import.meta.url));

export function loadMatch(): MatchDto {
  return JSON.parse(readFileSync(`${dir}KR_8408851980.match.json`, 'utf8')) as MatchDto;
}

export function loadTimeline(): TimelineDto {
  return JSON.parse(readFileSync(`${dir}KR_8408851980.timeline.json`, 'utf8')) as TimelineDto;
}

/** 깊은 복사 (테스트마다 가공해 쓰기 위해) */
export const clone = <T>(v: T): T => structuredClone(v);

export const OPTS = { queue: 420, minGameDurationSec: 300 };
