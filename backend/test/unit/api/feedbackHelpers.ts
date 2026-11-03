// 피드백 API 테스트 도우미 (back_spec 변경 05, 05-14): 가짜 Riot·가짜 LLM·조립. 네트워크·유료 호출 없음.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LlmClient, LlmRequest, LlmResponse } from '../../../src/analysis/llm/client.js';
import { LlmError, type LlmErrorKind } from '../../../src/analysis/llm/client.js';
import { memoryLedger, type Ledger } from '../../../src/analysis/llm/ledger.js';
import { loadSnapshot, type ChampionDataProvider } from '../../../src/api/feedback/championData.js';
import { createBreaker, createBudgetGuard, createDailyLimit, createSemaphore, type Semaphore } from '../../../src/api/feedback/limits.js';
import { createFeedbackService, type FeedbackFn, type FeedbackRiot } from '../../../src/api/feedback/service.js';
import { DDRAGON_SNAPSHOT_PATH } from '../../../src/config/feedback.js';
import { silentLogger, type Logger } from '../../../src/lib/logger.js';
import { RiotNotFoundError } from '../../../src/riot/errors.js';
import type { MatchDto, TimelineDto } from '../../../src/riot/types.js';
import { passingAnswer, senaSheet } from '../analysis/llm/helpers.js';

const dir = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const SENA_MATCH = JSON.parse(readFileSync(`${dir}KR_8437852704.match.json`, 'utf8')) as MatchDto;
const SENA_TIMELINE = JSON.parse(readFileSync(`${dir}KR_8437852704.timeline.json`, 'utf8')) as TimelineDto;

export const SENA_ID = 'KR_8437852704';
export const SENA_PUUID = 'TEST_PUUID_05';
export const GOOD_TEXT = JSON.stringify(passingAnswer(senaSheet()));
export const SNAPSHOT = loadSnapshot(DDRAGON_SNAPSHOT_PATH);

/** 세나 판을 matchId만 바꿔 준다 (timeline matchId도 같이 바꿔 MATCH_MISMATCH가 나지 않게) */
export function senaMatch(id = SENA_ID, edit?: (m: MatchDto) => void): MatchDto {
  const m = structuredClone(SENA_MATCH);
  m.metadata.matchId = id;
  edit?.(m);
  return m;
}
export function senaTimeline(id = SENA_ID): TimelineDto {
  const t = structuredClone(SENA_TIMELINE);
  t.metadata.matchId = id;
  return t;
}

export interface FakeRiot extends FeedbackRiot {
  matchCalls: number;
  timelineCalls: number;
  wait: number;
}

export function fakeRiot(o: {
  match?: (id: string) => MatchDto | Error;
  timeline?: (id: string) => TimelineDto | Error;
} = {}): FakeRiot {
  const r: FakeRiot = {
    matchCalls: 0,
    timelineCalls: 0,
    wait: 0,
    limiterWaitMs: () => r.wait,
    async getMatch(id) {
      r.matchCalls++;
      const v = o.match ? o.match(id) : senaMatch(id);
      if (v instanceof Error) throw v;
      return v;
    },
    async getTimeline(id) {
      r.timelineCalls++;
      const v = o.timeline ? o.timeline(id) : senaTimeline(id);
      if (v instanceof Error) throw v;
      return v;
    },
  };
  return r;
}

export const notFound = () => new RiotNotFoundError('없음 (HTTP 404)', 404, '/x');

/** 매번 같은 답(또는 오류)을 주는 가짜 LLM. gate가 있으면 풀릴 때까지 기다린다 */
export class ScriptClient implements LlmClient {
  calls = 0;
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;
  constructor(
    public step: (n: number) => { text: string; output?: number } | { error: LlmErrorKind; status?: number } = () => ({ text: GOOD_TEXT }),
  ) {}
  hold(): void {
    this.gate = new Promise((r) => (this.open = r));
  }
  release(): void {
    this.open?.();
    this.gate = null;
  }
  async create(req: LlmRequest): Promise<LlmResponse> {
    this.calls++;
    const n = this.calls;
    if (this.gate) await this.gate;
    const s = this.step(n);
    if ('error' in s) throw new LlmError(s.error, `가짜 ${s.error}`, s.status ?? null);
    const content = [{ type: 'text', text: s.text }];
    return {
      content,
      text: s.text,
      stopReason: 'end_turn',
      stopDetails: null,
      usage: { input: 1000, cacheWrite: 0, cacheRead: 0, output: s.output ?? 500 },
      model: req.model,
      durationMs: 1,
    };
  }
}

export const snapshotData = (): ChampionDataProvider & { calls: number } => {
  const p = {
    calls: 0,
    async forGameVersion() {
      p.calls++;
      return SNAPSHOT;
    },
  };
  return p;
};

export interface Harness {
  feedback: FeedbackFn;
  riot: FakeRiot;
  client: ScriptClient | null;
  ledger: Ledger;
  clock: { t: number };
  logs: { level: string; msg: string; fields?: Record<string, unknown> }[];
}

/** 2026-11-03T03:00:00Z = KST 12:00 */
export const NOON_KST = Date.parse('2026-11-03T03:00:00.000Z');

export function harness(o: {
  riot?: FakeRiot;
  client?: ScriptClient | null;
  ledger?: Ledger;
  dailyLimit?: number;
  restored?: number;
  budgetUsd?: number;
  semaphore?: Semaphore;
  deadlineMs?: number;
  startMs?: number;
} = {}): Harness {
  const clock = { t: o.startMs ?? NOON_KST };
  const riot = o.riot ?? fakeRiot();
  const client = o.client === undefined ? new ScriptClient() : o.client;
  const ledger = o.ledger ?? memoryLedger();
  const logs: Harness['logs'] = [];
  const logger: Logger = {
    info: (msg, fields) => logs.push({ level: 'info', msg, fields }),
    warn: (msg, fields) => logs.push({ level: 'warn', msg, fields }),
    error: (msg, fields) => logs.push({ level: 'error', msg, fields }),
  };
  const feedback = createFeedbackService({
    riot,
    llm: { client, model: 'claude-opus-5-5', effort: 'low' },
    ledger,
    champData: snapshotData(),
    daily: createDailyLimit(o.dailyLimit ?? 20, o.restored ?? 0, clock.t),
    budget: createBudgetGuard(o.budgetUsd ?? 1, () => ledger.totalUsd()),
    semaphore: o.semaphore ?? createSemaphore(2, 4),
    breaker: createBreaker(10 * 60 * 1000),
    logger,
    now: () => clock.t,
    deadlineMs: o.deadlineMs ?? 5_000,
  });
  return { feedback, riot, client, ledger, clock, logs };
}

export { silentLogger };

/** 응답 JSON의 모든 키 (재귀) */
export function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) allKeys(x, out);
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      allKeys(x, out);
    }
  }
  return out;
}

export const tick = () => new Promise((r) => setImmediate(r));
