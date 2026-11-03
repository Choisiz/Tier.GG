// 게임 피드백 분석 서비스 (back_spec 변경 05, 05-14): 흐름·오류 매핑·캐시·진행 중 공유·하루 상한·예산·LLM 처리·시간 제한·동시 실행.
// 가짜 Riot·가짜 LLM·가짜 시계. 유료 호출 0회.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { memoryLedger, type LedgerEntry } from '../../../src/analysis/llm/ledger.js';
import { ApiError } from '../../../src/api/errors.js';
import { createSemaphore } from '../../../src/api/feedback/limits.js';
import { createFeedbackService } from '../../../src/api/feedback/service.js';
import { createSummonerCache } from '../../../src/api/summonerCache.js';
import type { FeedbackDto } from '../../../src/api/feedback/dto.js';
import { createBreaker, createBudgetGuard, createDailyLimit } from '../../../src/api/feedback/limits.js';
import { RiotKeyExpiredError, RiotRetryExhaustedError } from '../../../src/riot/errors.js';
import {
  fakeRiot,
  harness,
  NOON_KST,
  notFound,
  ScriptClient,
  SENA_ID,
  SENA_PUUID,
  senaMatch,
  senaTimeline,
  silentLogger,
  snapshotData,
  tick,
} from './feedbackHelpers.js';

async function expectApiError(p: Promise<unknown>, status: number, code: string, details?: Record<string, unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError가 아님: ${String(e)}`);
    assert.equal(e.status, status);
    assert.equal(e.code, code);
    if (details) for (const [k, v] of Object.entries(details)) assert.deepEqual(e.details?.[k], v, k);
    return e;
  }
  assert.fail('오류가 나지 않음');
}

const DAY = 24 * 60 * 60 * 1000;

describe('피드백 서비스: 정상 흐름과 오류 매핑', () => {
  it('세나 판: 200 mode=llm, Riot 2회·LLM 1회, 결정적 장면 0~3개(세나 3개), 장부 1줄', async () => {
    const h = harness();
    const dto = await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(dto.mode, 'llm');
    assert.equal(dto.templateReason, null);
    assert.equal(dto.championId, 235);
    assert.equal(dto.position, 'UTILITY');
    assert.equal(dto.role, 'SUPPORT_DAMAGE');
    assert.equal(dto.win, false);
    assert.equal(dto.keyMoments.length, 3);
    assert.equal(dto.meta.knowledgeVersion, null);
    assert.equal(dto.meta.championDataVersion, '16.21.1');
    assert.equal(h.riot.matchCalls + h.riot.timelineCalls, 2);
    assert.equal(h.client!.calls, 1);
    assert.equal(h.ledger.entries().length, 1);
  });

  it('사전 검사 실패: 참가자 아님 404 participant, 큐 450·400 422 queue, 899초 too_short, 포지션 빈 값 no_position → timeline 0회', async () => {
    const cases: [ReturnType<typeof fakeRiot>, string, number, string, string][] = [
      [fakeRiot(), 'NOT_IN_GAME', 404, 'MATCH_NOT_FOUND', 'participant'],
      [fakeRiot({ match: (id) => senaMatch(id, (m) => (m.info.queueId = 450)) }), SENA_PUUID, 422, 'ANALYSIS_UNSUPPORTED', 'queue'],
      [fakeRiot({ match: (id) => senaMatch(id, (m) => (m.info.queueId = 400)) }), SENA_PUUID, 422, 'ANALYSIS_UNSUPPORTED', 'queue'],
      [fakeRiot({ match: (id) => senaMatch(id, (m) => (m.info.gameDuration = 899)) }), SENA_PUUID, 422, 'ANALYSIS_UNSUPPORTED', 'too_short'],
      [fakeRiot({ match: (id) => senaMatch(id, (m) => (m.info.participants[2]!.teamPosition = '')) }), SENA_PUUID, 422, 'ANALYSIS_UNSUPPORTED', 'no_position'],
    ];
    for (const [riot, puuid, status, code, reason] of cases) {
      const h = harness({ riot });
      await expectApiError(h.feedback(SENA_ID, puuid), status, code, { reason });
      assert.equal(riot.timelineCalls, 0, reason);
      assert.equal(h.client!.calls, 0);
    }
  });

  it('getMatch 404 → 404 match / timeline 404 → 422 no_timeline / 빈 프레임 → 422 no_timeline', async () => {
    await expectApiError(harness({ riot: fakeRiot({ match: () => notFound() }) }).feedback(SENA_ID, SENA_PUUID), 404, 'MATCH_NOT_FOUND', { reason: 'match' });
    await expectApiError(harness({ riot: fakeRiot({ timeline: () => notFound() }) }).feedback(SENA_ID, SENA_PUUID), 422, 'ANALYSIS_UNSUPPORTED', { reason: 'no_timeline' });
    const empty = fakeRiot({ timeline: (id) => ({ ...senaTimeline(id), info: { participants: [], frames: [] } }) });
    await expectApiError(harness({ riot: empty }).feedback(SENA_ID, SENA_PUUID), 422, 'ANALYSIS_UNSUPPORTED', { reason: 'no_timeline' });
  });

  it('Riot 401/403 → 503 RIOT_KEY_EXPIRED, 재시도 소진 → 502, MATCH_MISMATCH → 500', async () => {
    const expired = fakeRiot({ match: () => new RiotKeyExpiredError('x', 401, '/x') });
    await expectApiError(harness({ riot: expired }).feedback(SENA_ID, SENA_PUUID), 503, 'RIOT_KEY_EXPIRED');
    const busy = fakeRiot({ timeline: () => new RiotRetryExhaustedError('x', 429, '/x') });
    await expectApiError(harness({ riot: busy }).feedback(SENA_ID, SENA_PUUID), 502, 'RIOT_UNAVAILABLE');
    const mismatch = fakeRiot({ timeline: () => senaTimeline('KR_1') });
    await expectApiError(harness({ riot: mismatch }).feedback(SENA_ID, SENA_PUUID), 500, 'INTERNAL_ERROR');
  });

  it('오류는 캐시하지 않는다: 404 뒤 다시 부르면 Riot을 다시 부른다', async () => {
    const riot = fakeRiot({ match: () => notFound() });
    const h = harness({ riot });
    await expectApiError(h.feedback(SENA_ID, SENA_PUUID), 404, 'MATCH_NOT_FOUND');
    await expectApiError(h.feedback(SENA_ID, SENA_PUUID), 404, 'MATCH_NOT_FOUND');
    assert.equal(riot.matchCalls, 2);
  });
});

describe('피드백 서비스: 캐시와 진행 중 공유', () => {
  it('두 번째 요청은 Riot 0·LLM 0, 같은 generatedAt. 7일 뒤에는 다시 만든다', async () => {
    const h = harness();
    const a = await h.feedback(SENA_ID, SENA_PUUID);
    h.clock.t += 1000;
    const b = await h.feedback(SENA_ID, SENA_PUUID);
    assert.deepEqual(b, a);
    assert.equal(h.riot.matchCalls, 1);
    assert.equal(h.client!.calls, 1);
    h.clock.t += 7 * DAY;
    await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(h.riot.matchCalls, 2);
    assert.equal(h.client!.calls, 2);
  });

  it('LLM 끔(client null): template llm_off, LLM 0, 하루 셈 0. 템플릿 캐시는 10분 뒤 다시 만든다', async () => {
    const h = harness({ client: null });
    const a = await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(a.mode, 'template');
    assert.equal(a.templateReason, 'llm_off');
    assert.equal(h.ledger.entries().length, 0);
    await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(h.riot.matchCalls, 1);
    h.clock.t += 10 * 60 * 1000;
    await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(h.riot.matchCalls, 2);
  });

  it('LLM을 켠 서비스는 템플릿 캐시의 llm_off를 무시하고 새로 만든다', async () => {
    const templateCache = createSummonerCache<FeedbackDto>(10 * 60 * 1000, 200);
    const resultCache = createSummonerCache<FeedbackDto>(7 * DAY, 500);
    const make = (client: ScriptClient | null) => {
      const ledger = memoryLedger();
      return createFeedbackService({
        riot: fakeRiot(),
        llm: { client, model: 'claude-opus-5-5', effort: 'low' },
        ledger,
        champData: snapshotData(),
        daily: createDailyLimit(20, 0, NOON_KST),
        budget: createBudgetGuard(1, () => ledger.totalUsd()),
        semaphore: createSemaphore(2, 4),
        breaker: createBreaker(600_000),
        logger: silentLogger,
        now: () => NOON_KST,
        resultCache,
        templateCache,
      });
    };
    assert.equal((await make(null)(SENA_ID, SENA_PUUID)).templateReason, 'llm_off');
    const client = new ScriptClient();
    assert.equal((await make(client)(SENA_ID, SENA_PUUID)).mode, 'llm');
    assert.equal(client.calls, 1);
  });

  it('같은 키 동시 3요청 → Riot 2회·LLM 1회·하루 셈 1', async () => {
    const client = new ScriptClient();
    client.hold();
    const h = harness({ client });
    const ps = [h.feedback(SENA_ID, SENA_PUUID), h.feedback(SENA_ID, SENA_PUUID), h.feedback(SENA_ID, SENA_PUUID)];
    await tick();
    await tick();
    client.release();
    const out = await Promise.all(ps);
    assert.equal(out[0], out[1]);
    assert.equal(out[1], out[2]);
    assert.equal(h.riot.matchCalls + h.riot.timelineCalls, 2);
    assert.equal(client.calls, 1);
    assert.equal(h.ledger.entries().length, 1);
  });
});

describe('피드백 서비스: 하루 상한 (KST)', () => {
  it('20번째까지 통과, 21번째 429 daily(resetAt = 다음 KST 자정, Retry-After), 상한이어도 캐시 적중은 200', async () => {
    const h = harness();
    for (let i = 1; i <= 20; i++) await h.feedback(`KR_${i}`, SENA_PUUID);
    const e = await expectApiError(h.feedback('KR_21', SENA_PUUID), 429, 'ANALYSIS_LIMIT_REACHED', {
      reason: 'daily',
      limit: 20,
      resetAt: '2026-11-03T15:00:00.000Z',
    });
    assert.equal(e.retryAfterSec, 12 * 3600);
    assert.equal(h.client!.calls, 20);
    assert.equal((await h.feedback('KR_1', SENA_PUUID)).mode, 'llm');
  });

  it('KST 자정(UTC 14:59→15:00)을 지나면 초기화', async () => {
    const start = Date.parse('2026-11-03T14:59:00.000Z');
    const h = harness({ dailyLimit: 1, startMs: start });
    await h.feedback('KR_1', SENA_PUUID);
    await expectApiError(h.feedback('KR_2', SENA_PUUID), 429, 'ANALYSIS_LIMIT_REACHED');
    h.clock.t = Date.parse('2026-11-03T15:00:00.000Z');
    assert.equal((await h.feedback('KR_2', SENA_PUUID)).mode, 'llm');
  });

  it('비용 0 오류(auth)는 하루 자리를 반납하고, 템플릿 llm_error + 차단기 10분(그동안 LLM 0회, 오류 로그 1번)', async () => {
    const client = new ScriptClient(() => ({ error: 'auth', status: 401 }));
    const h = harness({ client, dailyLimit: 1 });
    const a = await h.feedback('KR_1', SENA_PUUID);
    assert.equal(a.mode, 'template');
    assert.equal(a.templateReason, 'llm_error');
    const b = await h.feedback('KR_2', SENA_PUUID); // 상한 1인데 반납돼 429가 아님, 차단기로 LLM 0회
    assert.equal(b.templateReason, 'llm_error');
    assert.equal(client.calls, 1);
    assert.equal(h.logs.filter((l) => l.level === 'error').length, 1);
    h.clock.t += 10 * 60 * 1000;
    await h.feedback('KR_3', SENA_PUUID);
    assert.equal(client.calls, 2);
  });

  it('402 billing → "크레딧 소진" 오류 로그', async () => {
    const h = harness({ client: new ScriptClient(() => ({ error: 'billing', status: 402 })) });
    await h.feedback(SENA_ID, SENA_PUUID);
    assert.ok(h.logs.some((l) => l.level === 'error' && l.msg.includes('크레딧 소진')));
  });

  it('하루 상한 0이면 LLM 없이 템플릿 llm_off', async () => {
    const h = harness({ dailyLimit: 0 });
    const a = await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(a.templateReason, 'llm_off');
    assert.equal(h.client!.calls, 0);
  });
});

describe('피드백 서비스: LLM 결과 처리', () => {
  for (const kind of ['rate', 'server', 'timeout', 'network'] as const) {
    it(`${kind} → 200 template llm_error, 차단기 안 엶`, async () => {
      const client = new ScriptClient(() => ({ error: kind }));
      const h = harness({ client });
      assert.equal((await h.feedback('KR_1', SENA_PUUID)).templateReason, 'llm_error');
      await h.feedback('KR_2', SENA_PUUID);
      assert.equal(client.calls, 2);
    });
  }
  it('파싱 실패(두 번) → template llm_error, 하루 셈 1(토큰을 썼음)', async () => {
    const h = harness({ client: new ScriptClient(() => ({ text: 'not json' })), dailyLimit: 1 });
    assert.equal((await h.feedback('KR_1', SENA_PUUID)).templateReason, 'llm_error');
    await expectApiError(h.feedback('KR_2', SENA_PUUID), 429, 'ANALYSIS_LIMIT_REACHED');
  });
  it('칸 일부만 검증 실패 → 그 칸만 템플릿, mode=llm (재시도 포함)', async () => {
    const good = JSON.parse((await import('./feedbackHelpers.js')).GOOD_TEXT) as { summary: { text: string } };
    const bad = structuredClone(good);
    bad.summary.text = '골드가 123456 앞섰습니다.';
    const client = new ScriptClient((n) => (n === 1 ? { text: JSON.stringify(bad) } : { text: 'not json' }));
    const h = harness({ client });
    const dto = await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(dto.mode, 'llm');
    const line = h.logs.find((l) => l.msg === '분석' && l.fields?.cache === 'miss');
    assert.equal(line?.fields?.templated, 1);
    assert.ok(!dto.summary.text.includes('123456'));
  });
});

describe('피드백 서비스: 예산', () => {
  const spent = (usd: number): LedgerEntry => ({
    at: '2026-11-01T00:00:00.000Z',
    matchId: 'KR_0',
    participantId: 1,
    model: 'claude-opus-5-5',
    effort: 'low',
    promptVersion: 'old',
    attempt: 1,
    kind: 'first',
    estInputTokens: 1,
    usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 },
    stopReason: 'end_turn',
    costUsd: usd,
    durationMs: 1,
    recording: null,
    error: null,
  });
  it('장부 + 최악 > 상한 → 429 budget, LLM 0회, 하루 자리 반납', async () => {
    const h = harness({ ledger: memoryLedger([spent(0.2)]), budgetUsd: 0.25, dailyLimit: 1 });
    await expectApiError(h.feedback('KR_1', SENA_PUUID), 429, 'ANALYSIS_LIMIT_REACHED', { reason: 'budget' });
    assert.equal(h.client!.calls, 0);
    assert.ok(h.logs.some((l) => l.level === 'warn' && l.msg.includes('예산')));
  });
  it('동시 2요청이 같이 통과해 상한을 넘지 않는다 (예약)', async () => {
    const client = new ScriptClient();
    client.hold();
    const h = harness({ client, budgetUsd: 0.3 });
    const p1 = h.feedback('KR_1', SENA_PUUID);
    await tick();
    await tick();
    await expectApiError(h.feedback('KR_2', SENA_PUUID), 429, 'ANALYSIS_LIMIT_REACHED', { reason: 'budget' });
    client.release();
    assert.equal((await p1).mode, 'llm');
    assert.equal(client.calls, 1);
  });
});

describe('피드백 서비스: 시간 제한과 동시 실행', () => {
  it('응답 상한을 넘으면 504(Retry-After 15), 분석은 계속돼 다음 요청은 추가 LLM 0으로 결과', async () => {
    const client = new ScriptClient();
    client.hold();
    const h = harness({ client, deadlineMs: 20 });
    const e = await expectApiError(h.feedback(SENA_ID, SENA_PUUID), 504, 'ANALYSIS_TIMEOUT', { retryAfterSec: 15 });
    assert.equal(e.retryAfterSec, 15);
    const again = h.feedback(SENA_ID, SENA_PUUID); // 진행 중 Promise에 붙는다
    client.release();
    assert.equal((await again).mode, 'llm');
    assert.equal(client.calls, 1);
    assert.equal(h.riot.matchCalls, 1);
  });
  it('동시 실행 + 대기열이 꽉 차면 503 ANALYSIS_BUSY (retryAfterSec 15), 하루 자리 반납', async () => {
    const client = new ScriptClient();
    client.hold();
    const h = harness({ client, semaphore: createSemaphore(1, 0), dailyLimit: 2 });
    const p1 = h.feedback('KR_1', SENA_PUUID);
    await tick();
    await tick();
    await expectApiError(h.feedback('KR_2', SENA_PUUID), 503, 'ANALYSIS_BUSY', { retryAfterSec: 15 });
    client.release();
    await p1;
    assert.equal((await h.feedback('KR_3', SENA_PUUID)).mode, 'llm'); // 반납돼 2번째 자리 남음
  });
  it('Riot 제한기 대기 6초 → 503 busy(retryAfterSec 6), Riot 0회', async () => {
    const riot = fakeRiot();
    riot.wait = 6000;
    const h = harness({ riot });
    await expectApiError(h.feedback(SENA_ID, SENA_PUUID), 503, 'ANALYSIS_BUSY', { retryAfterSec: 6 });
    assert.equal(riot.matchCalls, 0);
  });
});

describe('피드백 서비스: 로그', () => {
  it('분석 로그에 puuid 앞 8자만, 비용·토큰·하루 수', async () => {
    const h = harness();
    await h.feedback(SENA_ID, SENA_PUUID);
    const line = h.logs.find((l) => l.msg === '분석' && l.fields?.cache === 'miss');
    assert.ok(line);
    assert.equal(line.fields?.puuid, 'TEST_PUU…');
    assert.equal(line.fields?.today, '1/20');
    assert.ok(Number(line.fields?.costUsd) > 0);
    assert.ok(!JSON.stringify(h.logs).includes(SENA_PUUID));
  });
});
