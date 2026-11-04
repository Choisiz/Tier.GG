// 게임 피드백 분석 부품 (back_spec 변경 05, 05-14): 사전 검사, DTO, KST 상한·장부 복원, 세마포어, Data Dragon, 환경 변수, 비밀값 가림.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFeedbackFromResult } from '../../../src/analysis/feedback.js';
import { memoryLedger, type LedgerEntry } from '../../../src/analysis/llm/ledger.js';
import { createChampionData, patchPrefix, pickVersion, type FetchJson } from '../../../src/api/feedback/championData.js';
import { FORBIDDEN_DTO_KEYS, toFeedbackDto } from '../../../src/api/feedback/dto.js';
import {
  countTodayFromLedger,
  createBudgetGuard,
  createDailyLimit,
  createSemaphore,
  kstDateKey,
  nextKstMidnight,
} from '../../../src/api/feedback/limits.js';
import { precheckMatch } from '../../../src/api/feedback/precheck.js';
import { loadFeedbackEnv } from '../../../src/config/env.js';
import { redact } from '../../../src/lib/logger.js';
import { NAMES, secondResult, senaResult } from '../analysis/llm/helpers.js';
import { allKeys, GOOD_TEXT, ScriptClient, senaMatch, SENA_PUUID, silentLogger, SNAPSHOT } from './feedbackHelpers.js';

describe('precheckMatch (05-4 ⑥)', () => {
  it('참가자 아님 404 participant가 포지션 없음보다 먼저', () => {
    const m = senaMatch(undefined, (x) => (x.info.participants[0]!.teamPosition = ''));
    assert.deepEqual(precheckMatch(m, 'nobody'), { ok: false, status: 404, code: 'MATCH_NOT_FOUND', reason: 'participant' });
    assert.equal((precheckMatch(m, SENA_PUUID) as { reason: string }).reason, 'no_position');
  });
  it('큐 420·440 통과, 450·400 queue / 899초 too_short, 900초 통과', () => {
    for (const q of [420, 440]) assert.deepEqual(precheckMatch(senaMatch(undefined, (x) => (x.info.queueId = q)), SENA_PUUID), { ok: true });
    for (const q of [450, 400]) assert.equal((precheckMatch(senaMatch(undefined, (x) => (x.info.queueId = q)), SENA_PUUID) as { reason: string }).reason, 'queue');
    assert.equal((precheckMatch(senaMatch(undefined, (x) => (x.info.gameDuration = 899)), SENA_PUUID) as { reason: string }).reason, 'too_short');
    assert.deepEqual(precheckMatch(senaMatch(undefined, (x) => (x.info.gameDuration = 900)), SENA_PUUID), { ok: true });
  });
});

describe('toFeedbackDto (05-2)', () => {
  const meta = { templateReason: null, knowledgeVersion: null, championDataVersion: '16.21.1', generatedAtMs: Date.parse('2026-11-03T12:00:00Z') };
  it('응답 키 전체(재귀)에 금지 키가 없고, keyMoments 시각·방향이 엔진 결과와 같다', async () => {
    const result = senaResult();
    const run = createFeedbackFromResult({ client: new ScriptClient(), model: 'claude-opus-5-5', effort: 'low', budgetUsd: 1, ledger: memoryLedger(), championNames: NAMES, now: () => 0 });
    const { feedback } = await run(result);
    const dto = toFeedbackDto(result, feedback, meta);
    const keys = allKeys(dto);
    for (const k of FORBIDDEN_DTO_KEYS) assert.ok(!keys.has(k), k);
    assert.equal(dto.keyMoments.length, feedback.keyMoments.length);
    assert.ok(dto.keyMoments.length <= 3);
    dto.keyMoments.forEach((k, i) => {
      const m = result.keyMoments[feedback.keyMoments[i]!.index]!;
      assert.deepEqual([k.startSec, k.endSec, k.direction], [m.startSec, m.endSec, m.direction]);
    });
    assert.equal(dto.meta.knowledgeVersion, null);
    assert.equal(dto.meta.generatedAt, '2026-11-03T12:00:00.000Z');
    assert.equal(dto.sections.laning.note, null);
    assert.equal(dto.templateReason, null);
    assert.equal(JSON.stringify(dto).includes(SENA_PUUID), false);
    assert.ok(GOOD_TEXT.length > 0);
  });
  it('라인전 비교 불가 판은 note 한 줄, 템플릿은 templateReason', async () => {
    const result = secondResult(1);
    const run = createFeedbackFromResult({ client: null, model: 'claude-opus-5-5', effort: 'low', budgetUsd: 1, ledger: memoryLedger(), championNames: NAMES, now: () => 0 });
    const { feedback } = await run(result);
    const dto = toFeedbackDto(result, feedback, { ...meta, templateReason: 'llm_off' });
    assert.equal(dto.mode, 'template');
    assert.equal(dto.templateReason, 'llm_off');
    assert.equal(typeof dto.sections.laning.note, 'string');
  });
});

describe('하루 상한·예산·세마포어 (05-8)', () => {
  it('KST 날짜와 다음 자정', () => {
    assert.equal(kstDateKey(Date.parse('2026-11-03T14:59:59Z')), '2026-11-03');
    assert.equal(kstDateKey(Date.parse('2026-11-03T15:00:00Z')), '2026-11-04');
    assert.equal(new Date(nextKstMidnight(Date.parse('2026-11-03T03:00:00Z'))).toISOString(), '2026-11-03T15:00:00.000Z');
    assert.equal(new Date(nextKstMidnight(Date.parse('2026-11-03T15:00:00Z'))).toISOString(), '2026-11-04T15:00:00.000Z');
  });
  it('장부로 오늘 수 복원: 어제 줄·retry 줄·비용 0 줄 제외', () => {
    const e = (at: string, kind: LedgerEntry['kind'], costUsd: number) => ({ at, kind, costUsd }) as LedgerEntry;
    const now = Date.parse('2026-11-03T03:00:00Z');
    const entries = [
      e('2026-11-02T15:00:01Z', 'first', 0.05), // KST 11-03 00:00 → 오늘
      e('2026-11-02T14:59:59Z', 'first', 0.05), // 어제
      e('2026-11-03T01:00:00Z', 'retry', 0.02),
      e('2026-11-03T01:00:00Z', 'first', 0),
      e('2026-11-03T02:00:00Z', 'first', 0.07),
    ];
    assert.equal(countTodayFromLedger(entries, now), 2);
    const d = createDailyLimit(3, 2, now);
    assert.equal(d.used(now), 2);
    assert.equal(d.tryReserve(now), true);
    assert.equal(d.tryReserve(now), false);
    d.settle(false, now);
    assert.equal(d.tryReserve(now), true);
  });
  it('예산 예약: 장부 + 예약 + 최악 > 상한이면 null, 해제하면 다시 가능', () => {
    const b = createBudgetGuard(0.5, () => 0.1);
    const id = b.tryReserve(0.22);
    assert.notEqual(id, null);
    assert.equal(b.tryReserve(0.22), null);
    b.release(id!);
    assert.notEqual(b.tryReserve(0.22), null);
  });
  it('세마포어 2 + 대기 4: 7번째는 null, 해제하면 대기 순서대로', async () => {
    const s = createSemaphore(2, 4);
    const r1 = await s.acquire();
    await s.acquire();
    const waits = [s.acquire(), s.acquire(), s.acquire(), s.acquire()];
    assert.equal(await s.acquire(), null);
    assert.equal(s.waiting, 4);
    r1!();
    const r3 = await waits[0];
    assert.ok(r3);
    assert.equal(s.active, 2);
    assert.equal(s.waiting, 3);
  });
});

describe('Data Dragon 챔피언 데이터 (05-5 B안)', () => {
  const champJson = { data: { Sena: { key: '235', name: '세나', tags: ['Support', 'Marksman'] } } };
  function fake(fail = false) {
    const calls: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      calls.push(url);
      await new Promise((r) => setImmediate(r));
      if (fail) throw new Error('timeout');
      if (url.endsWith('versions.json')) return ['16.22.1', '16.21.1', '16.20.1'];
      return champJson;
    };
    return { calls, fetchJson };
  }
  const opts = (fetchJson: FetchJson, logger = silentLogger, now = () => 0) => ({
    baseUrl: 'https://dd',
    timeoutMs: 3000,
    maxVersions: 2,
    versionsTtlMs: 3_600_000,
    warnIntervalMs: 600_000,
    snapshot: SNAPSHOT,
    logger,
    fetchJson,
    now,
  });
  it('16.21.534.1234 → 16.21.1, 버전별 1번만 받고 동시 요청은 공유', async () => {
    assert.equal(patchPrefix('16.21.534.1234'), '16.21');
    assert.equal(pickVersion(['16.22.1', '16.21.1'], '16.21'), '16.21.1');
    assert.equal(pickVersion(['16.2.1', '16.21.1'], '16.2'), '16.2.1');
    const f = fake();
    const cd = createChampionData(opts(f.fetchJson));
    const [a, b] = await Promise.all([cd.forGameVersion('16.21.534.1234'), cd.forGameVersion('16.21.9.1')]);
    assert.equal(a, b);
    assert.equal(a.version, '16.21.1');
    assert.equal(a.source, 'ddragon');
    assert.deepEqual(a.tags.get(235), ['Support', 'Marksman']);
    assert.equal(a.names.get(235), '세나');
    await cd.forGameVersion('16.21.1.1');
    assert.equal(f.calls.filter((u) => u.includes('champion.json')).length, 1);
    assert.equal(f.calls.filter((u) => u.endsWith('versions.json')).length, 1);
    assert.ok(f.calls.includes('https://dd/cdn/16.21.1/data/ko_KR/champion.json'));
  });
  it('최대 버전 수를 넘으면 오래된 것을 지운다', async () => {
    const f = fake();
    const cd = createChampionData(opts(f.fetchJson));
    await cd.forGameVersion('16.20.1');
    await cd.forGameVersion('16.21.1');
    await cd.forGameVersion('16.22.1');
    await cd.forGameVersion('16.20.1'); // 지워져 다시 받음
    assert.equal(f.calls.filter((u) => u.includes('16.20.1/data')).length, 2);
  });
  it('실패·맞는 버전 없음·형식 다름 → 스냅숏 + 경고(10분에 1번)', async () => {
    const warns: string[] = [];
    const logger = { ...silentLogger, warn: (m: string) => void warns.push(m) };
    const cd = createChampionData(opts(fake(true).fetchJson, logger));
    const a = await cd.forGameVersion('16.21.1');
    assert.equal(a.source, 'snapshot');
    assert.equal(a.version, '16.21.1');
    await cd.forGameVersion('16.21.1');
    assert.equal(warns.length, 1);
    const cd2 = createChampionData(opts(fake().fetchJson));
    assert.equal((await cd2.forGameVersion('99.1.1')).source, 'snapshot');
    assert.equal((await cd2.forGameVersion(undefined)).source, 'snapshot');
  });
  it('스냅숏 파일: 16.21.1, 태그·이름 있음', () => {
    assert.equal(SNAPSHOT.version, '16.21.1');
    assert.ok(SNAPSHOT.tags.size > 150);
    assert.equal(SNAPSHOT.names.get(235), '세나');
  });
});

describe('loadFeedbackEnv (05-12)', () => {
  it('기본값: 꺼짐/꺼짐/20/0.25/claude-opus-5-5/low, 키 없음, RAG 꺼짐', () => {
    const e = loadFeedbackEnv({});
    assert.deepEqual(e, {
      enabled: false,
      llmEnabled: false,
      apiKey: null,
      model: 'claude-opus-5-5',
      effort: 'low',
      dailyLimit: 20,
      budgetUsd: 0.25,
      ragEnabled: false,
      voyageKey: null,
      problems: [],
    });
  });
  it('RAG (B4-4): FEEDBACK_RAG_ENABLED=true·VOYAGE_API_KEY 읽음, true/false 밖이면 기능 끔', () => {
    const e = loadFeedbackEnv({ FEEDBACK_ENABLED: 'true', FEEDBACK_RAG_ENABLED: 'true', VOYAGE_API_KEY: 'vk-x' });
    assert.equal(e.ragEnabled, true);
    assert.equal(e.voyageKey, 'vk-x');
    const bad = loadFeedbackEnv({ FEEDBACK_ENABLED: 'true', FEEDBACK_RAG_ENABLED: 'on' });
    assert.equal(bad.enabled, false);
    assert.equal(bad.ragEnabled, false);
    assert.match(bad.problems[0]!, /FEEDBACK_RAG_ENABLED/);
  });
  it('켬 + 값', () => {
    const e = loadFeedbackEnv({ FEEDBACK_ENABLED: 'true', FEEDBACK_LLM_ENABLED: 'false', FEEDBACK_DAILY_LIMIT: '5', FEEDBACK_API_BUDGET_USD: '1.5', ANTHROPIC_API_KEY: 'sk-ant-x' });
    assert.equal(e.enabled, true);
    assert.equal(e.llmEnabled, false);
    assert.equal(e.dailyLimit, 5);
    assert.equal(e.budgetUsd, 1.5);
    assert.equal(e.apiKey, 'sk-ant-x');
  });
  it('잘못된 값 → 기능 끔, 문제 설명에 값 없음', () => {
    for (const env of [
      { FEEDBACK_ENABLED: 'yes' },
      { FEEDBACK_ENABLED: 'true', FEEDBACK_LLM_ENABLED: '1' },
      { FEEDBACK_ENABLED: 'true', FEEDBACK_DAILY_LIMIT: '-1' },
      { FEEDBACK_ENABLED: 'true', FEEDBACK_API_BUDGET_USD: 'abc' },
      { FEEDBACK_ENABLED: 'true', FEEDBACK_LLM_EFFORT: 'max' },
    ]) {
      const e = loadFeedbackEnv(env);
      assert.equal(e.enabled, false, JSON.stringify(env));
      assert.equal(e.llmEnabled === true && e.problems.length === 0, false);
      assert.equal(e.problems.length, 1);
      for (const v of Object.values(env)) if (v !== 'true') assert.ok(!e.problems[0]!.includes(`${v} `));
    }
  });
});

describe('비밀값 가림 (05-9)', () => {
  it('sk-ant- 모양과 ANTHROPIC_API_KEY 값이 *** 로 가려진다', () => {
    assert.equal(redact('key=sk-ant-api03-AbC_d-1234 end'), 'key=*** end');
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'custom-anthropic-secret-xyz';
    try {
      assert.equal(redact('x custom-anthropic-secret-xyz y'), 'x *** y');
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
