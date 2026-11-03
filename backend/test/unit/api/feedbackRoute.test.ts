// POST /api/v1/matches/:matchId/feedback 라우트 (back_spec 변경 05, 05-1·05-3·05-14): 가짜 feedback 함수 + listen(0) + fetch.
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp, type ApiDb } from '../../../src/api/app.js';
import { ApiError } from '../../../src/api/errors.js';
import type { FeedbackDto } from '../../../src/api/feedback/dto.js';
import { unavailableFeedback, type FeedbackFn } from '../../../src/api/feedback/service.js';
import { silentLogger } from '../../../src/lib/logger.js';
import { harness, SENA_ID, SENA_PUUID } from './feedbackHelpers.js';

const db: ApiDb = {
  query: async () => ({ rows: [], rowCount: 0 }) as never,
  snapshot: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) as never }),
};

async function serve(feedback?: FeedbackFn): Promise<{ base: string; server: Server }> {
  const server = createApp(db, silentLogger, feedback ? { feedback } : {}).listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`, server };
}

const post = (base: string, path: string, body: string, type = 'application/json') =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': type }, body });

describe('POST /matches/:matchId/feedback', () => {
  let base = '';
  let server: Server;
  const seen: [string, string][] = [];
  let next: (() => Promise<FeedbackDto>) | null = null;
  const fake: FeedbackFn = async (matchId, puuid) => {
    seen.push([matchId, puuid]);
    if (next) return next();
    return { matchId } as FeedbackDto;
  };
  before(async () => ({ base, server } = await serve(fake)));
  after(() => server.close());

  it('200 + no-store, 본문의 puuid를 넘기고 모르는 필드는 무시', async () => {
    const res = await post(base, '/matches/KR_123/feedback', JSON.stringify({ puuid: 'abc-_1', extra: 1 }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { matchId: 'KR_123' });
    assert.deepEqual(seen.at(-1), ['KR_123', 'abc-_1']);
  });

  it('같은 경로 GET은 404, 다른 경로 POST는 404', async () => {
    assert.equal((await fetch(`${base}/matches/KR_123/feedback`)).status, 404);
    const r = await post(base, '/matches/lane-gold', '{}');
    assert.equal(r.status, 404);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'NOT_FOUND');
    assert.equal((await post(base, '/champions', '{}')).status, 404);
  });

  it('400 INVALID_PARAMETER: matchId·깨진 JSON·3KB·text/plain·배열·puuid 누락/형식 (값은 details에 없음)', async () => {
    const n = seen.length;
    const cases: [string, string, string | undefined, string][] = [
      ['/matches/NA_1/feedback', '{"puuid":"a"}', undefined, 'matchId'],
      ['/matches/KR_1/feedback', '{"puuid":', undefined, 'body'],
      ['/matches/KR_1/feedback', JSON.stringify({ puuid: 'a', pad: 'x'.repeat(3000) }), undefined, 'body'],
      ['/matches/KR_1/feedback', '{"puuid":"a"}', 'text/plain', 'body'],
      ['/matches/KR_1/feedback', '["a"]', undefined, 'body'],
      ['/matches/KR_1/feedback', '{}', undefined, 'puuid'],
      ['/matches/KR_1/feedback', '{"puuid":"a b"}', undefined, 'puuid'],
    ];
    for (const [path, body, type, param] of cases) {
      const res = await post(base, path, body, type);
      assert.equal(res.status, 400, `${param} ${body.slice(0, 20)}`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const j = (await res.json()) as { error: { code: string; details: Record<string, unknown> } };
      assert.equal(j.error.code, 'INVALID_PARAMETER');
      assert.equal(j.error.details.param, param);
      if (param !== 'matchId') assert.equal('value' in j.error.details, false);
    }
    assert.equal(seen.length, n);
  });

  it('서비스 오류는 오류 형식 + Retry-After (429·503·504)', async () => {
    const cases: [ApiError, string | null][] = [
      [new ApiError(429, 'ANALYSIS_LIMIT_REACHED', 'x', { reason: 'daily', limit: 20, resetAt: 'z' }, 3600), '3600'],
      [new ApiError(503, 'ANALYSIS_BUSY', 'x', { retryAfterSec: 15 }, 15), '15'],
      [new ApiError(504, 'ANALYSIS_TIMEOUT', 'x', { retryAfterSec: 15 }, 15), '15'],
      [new ApiError(422, 'ANALYSIS_UNSUPPORTED', 'x', { reason: 'queue' }), null],
    ];
    for (const [err, ra] of cases) {
      next = async () => {
        throw err;
      };
      const res = await post(base, '/matches/KR_1/feedback', '{"puuid":"a"}');
      assert.equal(res.status, err.status);
      assert.equal(res.headers.get('retry-after'), ra);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const j = (await res.json()) as { error: { code: string; details: unknown } };
      assert.equal(j.error.code, err.code);
      assert.deepEqual(j.error.details, err.details);
    }
    next = null;
  });
});

describe('POST feedback: 스위치·미설정', () => {
  it('꺼짐(unavailable)이면 본문 검사 전에 503 ANALYSIS_DISABLED (깨진 JSON이어도)', async () => {
    const { base, server } = await serve(unavailableFeedback(new ApiError(503, 'ANALYSIS_DISABLED', '꺼짐')));
    try {
      const res = await post(base, '/matches/NA_1/feedback', '{bad');
      assert.equal(res.status, 503);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'ANALYSIS_DISABLED');
    } finally {
      server.close();
    }
  });
  it('feedback을 넘기지 않은 createApp에서는 500 INTERNAL_ERROR', async () => {
    const { base, server } = await serve();
    try {
      const res = await post(base, '/matches/KR_1/feedback', '{"puuid":"a"}');
      assert.equal(res.status, 500);
    } finally {
      server.close();
    }
  });
  it('실제 서비스(가짜 Riot·LLM)로 끝까지: 200 mode=llm, 응답에 puuid 없음', async () => {
    const h = harness();
    const { base, server } = await serve(h.feedback);
    try {
      const res = await post(base, `/matches/${SENA_ID}/feedback`, JSON.stringify({ puuid: SENA_PUUID }));
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.equal(text.includes(SENA_PUUID), false);
      assert.equal((JSON.parse(text) as FeedbackDto).mode, 'llm');
    } finally {
      server.close();
    }
  });
});
