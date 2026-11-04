// 개발용 명령 (ai_spec 2-8): 로컬 파일로 LLM 문장 피드백을 만든다.
// 기본은 미리보기(예상 비용만 출력, 네트워크·키·클라이언트 없음). --yes일 때만 유료 호출. --replay는 녹화본으로 0원 실행.
// --rag(B4): DB·Voyage로 판마다 RAG 조각을 찾아 함께 준다(미리보기도 검색은 함, Voyage 무료 범위). 녹화본에 조각을 저장해 --replay --rag는 검색 없이 0원 재현.
// --rag 없이는 RAG 전(Q1)과 같은 요청이다.
// 키 값은 출력하지 않는다("있음/없음"만). process.env는 이 파일에서만 읽는다.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { allChampionNames, championNamesFromJson, createFeedbackFromResult, type FeedbackResult, type KnowledgeInput } from '../analysis/feedback.js';
import { AnalysisError, analyzeMatch, championTagsFromJson } from '../analysis/index.js';
import { createAnthropicClient, type LlmClient, type LlmEffort } from '../analysis/llm/client.js';
import { ReplayLlmClient, type RecordedCall, type Recording } from '../analysis/llm/fakeClient.js';
import { buildFacts, type FactSheet } from '../analysis/llm/facts.js';
import { MAX_TOKENS } from '../analysis/llm/generate.js';
import { calibration, fileLedger, memoryLedger, type Ledger } from '../analysis/llm/ledger.js';
import { estimateTokens, priceOf, worstCallCost } from '../analysis/llm/pricing.js';
import { buildUserMessage, promptVersionFor, PROMPT_VERSION_NO_RAG, SYSTEM_PROMPT, systemPromptFor, type KnowledgeChunkInput } from '../analysis/llm/prompt.js';
import { knowledgeVersion, loadKnowledgeDir } from '../analysis/rag/chunks.js';
import { pgSearch, retrieveKnowledge, type RetrieveOutcome } from '../analysis/rag/retrieve.js';
import { createVoyageEmbed } from '../analysis/rag/voyage.js';
import pg from 'pg';
import { RAG_DEFAULTS } from './rag.js';
import { verifySlot } from '../analysis/llm/verify.js';
import type { AnalysisMatch, AnalysisResult, AnalysisTimeline } from '../analysis/types.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULTS = {
  tags: join(ROOT, 'test/fixtures/ddragon/champion-tags.json'),
  ledger: join(ROOT, 'test/eval/usage-ledger.jsonl'),
  recordings: join(ROOT, 'test/eval/recordings'),
  results: join(ROOT, 'test/eval/results'),
  model: 'claude-opus-5-5',
  effort: 'low' as LlmEffort,
  budgetUsd: 1.0,
};

/** 재시도 메시지 어림 토큰 (실패 칸 몇 개 + 쓸 수 있는 값) */
const RETRY_MSG_TOKENS = 1500;
/** 실측이 없을 때 첫 호출 예상 출력 토큰 (문장 JSON 약 1,500 + thinking) */
const DEFAULT_EXPECTED_OUTPUT = 2500;

const USAGE = `사용법:
  npm run feedback -- --match <match.json> --timeline <timeline.json> (--participant N | --puuid P)   # 미리보기 (0원)
  npm run feedback -- ... --yes                    # 실제 호출 1판 (유료)
  npm run feedback -- --set test/eval/set5         # 세트 미리보기
  npm run feedback -- --set test/eval/set5 --yes   # 세트 실행 (판마다 예산 검사)
  npm run feedback -- ... --replay <녹화본 파일|폴더>   # 녹화본으로 0원 재검증
  npm run feedback -- --set test/eval/set5 --rag [--yes | --replay <폴더>]   # RAG 조각을 함께 (검색: DB + Voyage)
옵션: --effort low|medium|high, --show-prompt, --compact, --tags <파일>, --ledger <파일>, --out <폴더>, --recordings <폴더>
환경 변수: ANTHROPIC_API_KEY(--yes만), FEEDBACK_LLM_MODEL, FEEDBACK_LLM_EFFORT, FEEDBACK_BUDGET_USD, DATABASE_URL·VOYAGE_API_KEY(--rag, --replay 제외)`;

export interface CliIo {
  log: (s: string) => void;
  error: (s: string) => void;
}

/** --rag 검색기 (DB 연결 + Voyage). 다 쓰면 close */
export interface CliRag {
  retrieve: (result: AnalysisResult) => Promise<RetrieveOutcome>;
  knowledgeVersion: string;
  close: () => Promise<void>;
}

export interface CliDeps {
  /** --yes일 때만 부른다. 테스트에서 바꿔 끼워 "미리보기는 클라이언트를 만들지 않음"을 확인한다 */
  clientFactory: (apiKey: string) => LlmClient;
  now: () => number;
  /** --rag일 때만 부른다 (--replay --rag는 녹화본의 조각을 쓰고 부르지 않는다). 키·접속 문자열 검사도 여기서 */
  ragFactory?: (env: NodeJS.ProcessEnv) => Promise<CliRag>;
}

interface Job {
  matchId: string;
  matchPath: string;
  timelinePath: string;
  participantId: number | null;
  puuid: string | null;
  note: string | null;
}

interface SetItem {
  matchId: string;
  match: string;
  timeline: string;
  participantId: number;
  position?: string;
  role?: string;
  note?: string;
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const usd = (x: number) => `$${x.toFixed(4)}`;

function loadSet(dir: string): Job[] {
  const raw = readJson(join(dir, 'set.json')) as { items: SetItem[] };
  return raw.items.map((it) => ({
    matchId: it.matchId,
    matchPath: resolve(dir, it.match),
    timelinePath: resolve(dir, it.timeline),
    participantId: it.participantId,
    puuid: null,
    note: it.note ?? null,
  }));
}

/** 녹화본 이름. 버전은 그 판 요청의 프롬프트 버전(조각이 있으면 .2, 없으면 .1) */
function recordingBase(matchId: string, pid: number, model: string, effort: string, promptVersion: string): string {
  return `${matchId}.p${pid}.${promptVersion}.${model}.${effort}`;
}

function findRecording(replay: string, base: string): string | null {
  if (!existsSync(replay)) return null;
  if (statSync(replay).isFile()) return replay;
  // base.json = 1번째, base.N.json = N번째 녹화. 가장 최근(N이 큰) 녹화본을 쓴다
  const order = (f: string) => (f === `${base}.json` ? 1 : Number(f.slice(base.length + 1, -5)));
  const files = readdirSync(replay)
    .filter((f) => f === `${base}.json` || new RegExp(`^${base.replace(/\./g, '\\.')}\\.\\d+\\.json$`).test(f))
    .sort((a, b) => order(a) - order(b));
  return files.length > 0 ? join(replay, files[files.length - 1]!) : null;
}

function uniquePath(dir: string, base: string): string {
  let p = join(dir, `${base}.json`);
  for (let n = 2; existsSync(p); n++) p = join(dir, `${base}.${n}.json`);
  return p;
}

export interface Estimate {
  inputTokens: number;
  systemTokens: number;
  expectedUsd: number;
  worstUsd: number;
  inputFactor: number;
  calibrationSamples: number;
}

/**
 * 첫 호출 예상 비용(재시도 없음 가정)과 판당 최악 비용(1차 max_tokens 전부 + 재시도 최악).
 * 조각이 있으면 RAG 프롬프트로 어림한다. RAG 버전 실측이 아직 없으면 RAG 전 버전의 보정 계수·평균 출력을 빌려 쓴다.
 */
export function estimateCost(sheet: FactSheet, model: string, ledger: Ledger, knowledge: readonly KnowledgeChunkInput[] | null = null): Estimate {
  const withKnowledge = knowledge !== null && knowledge.length > 0;
  let cal = calibration(ledger.entries(), model, promptVersionFor(withKnowledge));
  if (withKnowledge && cal.samples === 0) cal = calibration(ledger.entries(), model, PROMPT_VERSION_NO_RAG);
  const user = buildUserMessage(sheet, knowledge);
  const systemTokens = estimateTokens(systemPromptFor(withKnowledge), cal.inputFactor);
  const userTokens = estimateTokens(JSON.stringify([{ role: 'user', content: user }]), cal.inputFactor);
  const inputTokens = systemTokens + userTokens;
  const p = priceOf(model);
  const expectedOut = cal.avgOutput ?? DEFAULT_EXPECTED_OUTPUT;
  const expectedUsd = (systemTokens * p.cacheWrite5m + userTokens * p.input + expectedOut * p.output) / 1_000_000;
  const worstUsd =
    worstCallCost(inputTokens, MAX_TOKENS.first, model) +
    worstCallCost(inputTokens + MAX_TOKENS.first + RETRY_MSG_TOKENS, MAX_TOKENS.retry, model);
  return { inputTokens, systemTokens, expectedUsd, worstUsd, inputFactor: cal.inputFactor, calibrationSamples: cal.samples };
}

export interface FinalCheck {
  number: number;
  direction: number;
  forbidden: number;
  other: number;
  details: { slot: string; rule: string; detail: string }[];
}

/** 최종 결과 문장을 검증기로 다시 돌린다 (완료 기준: 틀린 숫자·방향·금지어 0) */
export function finalCheck(sheet: FactSheet, fb: FeedbackResult, all: readonly string[]): FinalCheck {
  const out: FinalCheck = { number: 0, direction: 0, forbidden: 0, other: 0, details: [] };
  const texts = new Map<string, { text: string; factIds: string[] }>();
  texts.set('summary', fb.summary);
  for (const area of ['laning', 'fight', 'macro'] as const) {
    for (const kind of ['good', 'bad'] as const) fb.sections[area][kind].forEach((it, i) => texts.set(`${area}.${kind}.${i}`, it));
  }
  fb.keyMoments.forEach((k) => texts.set(`keyMoment.${k.index}`, k));
  for (const s of sheet.slots) {
    const st = texts.get(s.slot);
    if (!st) continue;
    for (const f of verifySlot(s, st, { sheet, allChampionNames: all })) {
      if (f.rule === 'number') out.number++;
      else if (f.rule === 'direction') out.direction++;
      else if (f.rule === 'forbidden') out.forbidden++;
      else out.other++;
      out.details.push(f);
    }
  }
  return out;
}

interface JobResult {
  matchId: string;
  participantId: number;
  position: string;
  role: string;
  note: string | null;
  feedback: FeedbackResult;
  finalCheck: FinalCheck;
  recording: string | null;
  replayMismatches?: number[];
}

function gradingSheet(results: readonly JobResult[], label: string): string {
  const lines = [
    `# 근거 없는 주장 채점표 (${label})`,
    '',
    '- 문장마다 마지막 칸에 하나를 적는다: **O** = 근거 있음 / **X** = 근거 없는 주장 있음 / **H** = 해석인데 "보입니다" 없음.',
    '- "근거"는 같은 줄의 판정·facts(숫자)다. 숫자는 검증기가 이미 대조했으므로, 숫자 밖의 주장(원인·해석·평가)이 판정과 facts로 뒷받침되는지를 본다.',
    '',
  ];
  for (const r of results) {
    lines.push(`## ${r.matchId} p${r.participantId} (${r.position}, ${r.role}) — mode ${r.feedback.mode}`, '');
    lines.push('| 칸 | 출처 | 문장 | 쓴 facts | 채점 |', '|----|------|------|----------|------|');
    const row = (slot: string, t: { text: string; factIds: string[]; source: string }) =>
      lines.push(`| ${slot} | ${t.source} | ${t.text.replace(/\|/g, '/')} | ${t.factIds.join(', ')} |  |`);
    row('summary', r.feedback.summary);
    for (const area of ['laning', 'fight', 'macro'] as const) {
      for (const kind of ['good', 'bad'] as const) r.feedback.sections[area][kind].forEach((it, i) => row(`${area}.${kind}.${i} ${it.subjectId}`, it));
    }
    r.feedback.keyMoments.forEach((k) => row(`keyMoment.${k.index}`, k));
    lines.push('');
  }
  return lines.join('\n');
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv, io: CliIo, deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        match: { type: 'string' },
        timeline: { type: 'string' },
        participant: { type: 'string' },
        puuid: { type: 'string' },
        set: { type: 'string' },
        yes: { type: 'boolean', default: false },
        replay: { type: 'string' },
        rag: { type: 'boolean', default: false },
        effort: { type: 'string' },
        'show-prompt': { type: 'boolean', default: false },
        compact: { type: 'boolean', default: false },
        tags: { type: 'string' },
        ledger: { type: 'string' },
        out: { type: 'string' },
        recordings: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
    }));
  } catch (e) {
    io.error(e instanceof Error ? e.message : String(e));
    io.error(USAGE);
    return 1;
  }
  if (values.help) {
    io.log(USAGE);
    return 0;
  }
  const model = env.FEEDBACK_LLM_MODEL?.trim() || DEFAULTS.model;
  const effortRaw = values.effort ?? (env.FEEDBACK_LLM_EFFORT?.trim() || DEFAULTS.effort);
  if (!['low', 'medium', 'high'].includes(effortRaw)) {
    io.error(`effort는 low|medium|high: ${effortRaw}`);
    return 1;
  }
  const effort = effortRaw as LlmEffort;
  const budgetUsd = env.FEEDBACK_BUDGET_USD?.trim() ? Number(env.FEEDBACK_BUDGET_USD) : DEFAULTS.budgetUsd;
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    io.error('FEEDBACK_BUDGET_USD는 0 이상 숫자');
    return 1;
  }
  try {
    priceOf(model);
  } catch (e) {
    io.error((e as Error).message);
    return 1;
  }
  if (values.yes && values.replay) {
    io.error('--yes와 --replay는 함께 쓸 수 없음');
    return 1;
  }

  let jobs: Job[];
  if (values.set) {
    jobs = loadSet(resolve(values.set));
  } else {
    if (!values.match || !values.timeline || (!values.participant && !values.puuid)) {
      io.error(USAGE);
      return 1;
    }
    jobs = [
      {
        matchId: '',
        matchPath: resolve(values.match),
        timelinePath: resolve(values.timeline),
        participantId: values.participant ? Number(values.participant) : null,
        puuid: values.puuid ?? null,
        note: null,
      },
    ];
  }

  const tagsJson = readJson(values.tags ?? DEFAULTS.tags);
  const championTags = championTagsFromJson(tagsJson);
  const championNames = championNamesFromJson(tagsJson);
  const allNames = allChampionNames(championNames);
  const ledgerPath = values.ledger ?? DEFAULTS.ledger;
  const ledger = fileLedger(ledgerPath);
  const recDir = values.recordings ?? DEFAULTS.recordings;
  const outDir = values.out ?? DEFAULTS.results;

  // ---------- 판마다 엔진 결과 ----------
  const prepared: { job: Job; result: AnalysisResult; sheet: FactSheet }[] = [];
  for (const job of jobs) {
    const match = readJson(job.matchPath) as AnalysisMatch;
    const timeline = readJson(job.timelinePath) as AnalysisTimeline;
    const puuid = job.puuid ?? match.info.participants.find((p) => p.participantId === job.participantId)?.puuid;
    if (!puuid) {
      io.error(`participantId ${job.participantId}가 ${match.metadata.matchId}에 없음`);
      return 1;
    }
    try {
      const result = analyzeMatch({ match, timeline, puuid, championTags });
      prepared.push({ job, result, sheet: buildFacts(result, championNames) });
    } catch (e) {
      if (e instanceof AnalysisError) {
        io.error(`분석 불가 ${match.metadata.matchId} (${e.code}): ${e.message}`);
        return 2;
      }
      throw e;
    }
  }

  // ---------- RAG 조각 (--rag, 녹화본 재생이 아닐 때만 검색) ----------
  const knowledgeOf = new Map<AnalysisResult, KnowledgeInput | null>();
  if (values.rag && !values.replay) {
    if (!deps.ragFactory) {
      io.error('--rag 검색기를 만들 수 없음');
      return 1;
    }
    let rag: CliRag;
    try {
      rag = await deps.ragFactory(env);
    } catch (e) {
      io.error(`--rag 준비 실패: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
      return 1;
    }
    try {
      io.log(`RAG knowledgeVersion ${rag.knowledgeVersion}`);
      for (const { result } of prepared) {
        const out = await rag.retrieve(result);
        knowledgeOf.set(result, out.chunks.length > 0 ? { version: rag.knowledgeVersion, chunks: out.chunks.map((c) => ({ id: c.id, content: c.content })) } : null);
        io.log(
          `- RAG ${result.matchId} p${result.player.participantId}: 과목 ${out.queries}개 → 조각 ${out.chunks.length}개 (ALL로 넓힘 ${out.picks.filter((p) => p.widened).length}과목)${out.notes.length ? ` · ${out.notes.join(' / ')}` : ''}`,
        );
      }
    } finally {
      await rag.close();
    }
  }
  const chunksOf = (r: AnalysisResult) => knowledgeOf.get(r)?.chunks ?? null;

  // ---------- 미리보기 (항상 출력) ----------
  const spent = ledger.totalUsd();
  io.log(
    `모델 ${model} · effort ${effort} · PROMPT_VERSION ${values.rag ? `${promptVersionFor(true)} (조각 없는 판은 ${PROMPT_VERSION_NO_RAG})` : PROMPT_VERSION_NO_RAG} · max_tokens 1차 ${MAX_TOKENS.first} / 재시도 ${MAX_TOKENS.retry}`,
  );
  let sumExp = 0;
  let sumWorst = 0;
  for (const { result, sheet } of prepared) {
    const est = estimateCost(sheet, model, ledger, chunksOf(result));
    sumExp += est.expectedUsd;
    sumWorst += est.worstUsd;
    io.log(
      `- ${result.matchId} p${result.player.participantId} ${result.player.position} ${result.player.role}: 칸 ${sheet.slots.length}개, 입력 어림 ${est.inputTokens}토큰(시스템 ${est.systemTokens}, 보정 ×${est.inputFactor.toFixed(2)}, 실측 ${est.calibrationSamples}건) → 예상 ${usd(est.expectedUsd)}, 최악 ${usd(est.worstUsd)}`,
    );
  }
  io.log(`합계 ${prepared.length}판: 예상 ${usd(sumExp)}, 최악 ${usd(sumWorst)}`);
  io.log(`장부 ${basename(ledgerPath)}: 누적 ${usd(spent)} / 상한 $${budgetUsd.toFixed(2)} → 남은 예산 ${usd(Math.max(0, budgetUsd - spent))}`);
  if (values['show-prompt']) {
    io.log('\n===== 시스템 프롬프트 =====\n' + (values.rag ? systemPromptFor(true) : SYSTEM_PROMPT));
    for (const { sheet, result } of prepared) io.log(`\n===== 사용자 메시지 ${sheet.matchId} p${sheet.participantId} =====\n${buildUserMessage(sheet, chunksOf(result))}`);
  }
  if (!values.yes && !values.replay) {
    io.log(`\n미리보기만 했습니다 (${values.rag ? 'LLM 호출 없음, RAG 검색만' : '네트워크 호출 없음'}). 실제 호출은 --yes, 녹화본 재검증은 --replay.`);
    return 0;
  }

  // ---------- 실제 호출 또는 녹화본 재생 ----------
  let realClient: LlmClient | null = null;
  if (values.yes) {
    const key = env.ANTHROPIC_API_KEY?.trim();
    io.log(`ANTHROPIC_API_KEY: ${key ? '있음' : '없음'}`);
    if (!key) {
      io.error('키가 없어 실제 호출을 하지 않습니다.');
      return 1;
    }
    if (spent + (prepared.length > 0 ? estimateCost(prepared[0]!.sheet, model, ledger, chunksOf(prepared[0]!.result)).worstUsd : 0) > budgetUsd) {
      io.error(`예산 초과: 누적 ${usd(spent)} + 첫 판 최악 > $${budgetUsd.toFixed(2)}. 호출하지 않습니다.`);
      return 3;
    }
    realClient = deps.clientFactory(key);
  }

  const results: JobResult[] = [];
  let exit = 0;
  for (const { job, result, sheet } of prepared) {
    const pid = result.player.participantId;
    let knowledge = knowledgeOf.get(result) ?? null;
    let base = recordingBase(result.matchId, pid, model, effort, promptVersionFor(knowledge !== null));
    const calls: RecordedCall[] = [];
    let client: LlmClient;
    let runLedger: Ledger = ledger;
    let runBudget = budgetUsd;
    let recPath: string | null = null;
    let replay: ReplayLlmClient | null = null;
    if (values.replay) {
      // --rag 재생: RAG 버전 녹화본을 먼저 찾고(조각은 녹화본에서), 없으면 조각 없이 만든 판(.1)
      const ragBase = recordingBase(result.matchId, pid, model, effort, promptVersionFor(true));
      const file = (values.rag ? findRecording(resolve(values.replay), ragBase) : null) ?? findRecording(resolve(values.replay), base);
      if (!file) {
        io.error(`녹화본 없음: ${values.rag ? `${ragBase} 또는 ` : ''}${base}`);
        exit = 1;
        continue;
      }
      const rec = readJson(file) as Recording;
      if (values.rag && rec.knowledge) {
        knowledge = rec.knowledge;
        base = ragBase;
      }
      replay = new ReplayLlmClient(rec);
      client = replay;
      runLedger = memoryLedger();
      runBudget = Number.POSITIVE_INFINITY;
      recPath = file;
    } else {
      client = realClient!;
      mkdirSync(recDir, { recursive: true });
      recPath = uniquePath(recDir, base);
    }
    const run = createFeedbackFromResult({
      client,
      model,
      effort,
      budgetUsd: runBudget,
      ledger: runLedger,
      championNames,
      now: deps.now,
      inputFactor: estimateCost(sheet, model, ledger, knowledge?.chunks ?? null).inputFactor,
      onCall: (c) => calls.push(c),
      recordingName: recPath ? basename(recPath) : null,
    });
    const { feedback } = await run(result, knowledge);
    if (values.yes && calls.length > 0) {
      const rec: Recording = {
        matchId: result.matchId,
        participantId: pid,
        engineVersion: result.engineVersion,
        promptVersion: feedback.meta.promptVersion,
        model,
        effort,
        recordedAt: new Date(deps.now()).toISOString(),
        calls,
        ...(knowledge ? { knowledge: { version: knowledge.version, chunks: knowledge.chunks.map((c) => ({ id: c.id, content: c.content })) } } : {}),
      };
      writeFileSync(recPath!, `${JSON.stringify(rec, null, 2)}\n`);
    }
    const fc = finalCheck(sheet, feedback, allNames);
    const jr: JobResult = {
      matchId: result.matchId,
      participantId: pid,
      position: result.player.position,
      role: result.player.role,
      note: job.note,
      feedback,
      finalCheck: fc,
      recording: values.yes && calls.length === 0 ? null : recPath ? basename(recPath) : null,
      ...(replay ? { replayMismatches: replay.mismatches } : {}),
    };
    results.push(jr);
    const v = feedback.meta.verification;
    io.log(
      `\n[${result.matchId} p${pid}] mode ${feedback.mode}${feedback.meta.fallbackReason ? ` (${feedback.meta.fallbackReason})` : ''} · 호출 ${feedback.meta.attempts}회 · 1차 통과 ${v.firstPass}/${v.firstTotal} (숫자 ${v.numberFirstPass}/${v.firstTotal}) · 재시도 ${v.retried}칸 · 템플릿 ${v.templated}칸 · 최종 검사 숫자 ${fc.number}·방향 ${fc.direction}·금지어 ${fc.forbidden}`,
    );
    const u = feedback.meta.usage;
    io.log(`  토큰 입력 ${u.input} · 캐시쓰기 ${u.cacheWrite} · 캐시읽기 ${u.cacheRead} · 출력 ${u.output} · 비용 ${usd(feedback.meta.costUsd)} · ${feedback.meta.durationMs}ms`);
    if (replay && replay.mismatches.length > 0) io.log(`  주의: 녹화 때와 요청이 다른 호출 ${replay.mismatches.join(', ')}번 (프롬프트·검증 결과가 바뀜)`);
    for (const f of [...v.failures, ...v.retryFailures, ...v.extras]) io.log(`  · ${f.slot} [${f.rule}] ${f.detail}`);
    io.log(values.compact ? JSON.stringify(feedback) : JSON.stringify({ summary: feedback.summary, sections: feedback.sections, keyMoments: feedback.keyMoments }, null, 2));
    const reason = feedback.meta.fallbackReason;
    if (values.yes && reason && ['auth', 'billing', 'model_not_found', 'bad_request', 'budget'].includes(reason)) {
      if (reason === 'billing') io.error('크레딧 소진(402): 콘솔에서 잔액 확인 필요. 세트를 멈춥니다.');
      else io.error(`세트를 멈춥니다: ${reason}`);
      exit = reason === 'budget' ? 3 : 4;
      break;
    }
  }

  // ---------- 결과 파일 ----------
  if (results.length > 0) {
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date(deps.now()).toISOString().replace(/[:.]/g, '-');
    const label = `${values.replay ? 'replay' : 'live'}.${values.set ? basename(resolve(values.set)) : results[0]!.matchId}.${model}.${effort}${values.rag ? '.rag' : ''}`;
    const outPath = join(outDir, `${stamp}.${label}.json`);
    const totals = results.reduce(
      (a, r) => {
        const v = r.feedback.meta.verification;
        a.slots += v.firstTotal;
        a.firstPass += v.firstPass;
        a.numberFirstPass += v.numberFirstPass;
        a.retried += v.retried;
        a.templated += v.templated;
        a.templateMode += r.feedback.mode === 'template' ? 1 : 0;
        a.costUsd += r.feedback.meta.costUsd;
        a.finalNumber += r.finalCheck.number;
        a.finalDirection += r.finalCheck.direction;
        a.finalForbidden += r.finalCheck.forbidden;
        return a;
      },
      { slots: 0, firstPass: 0, numberFirstPass: 0, retried: 0, templated: 0, templateMode: 0, costUsd: 0, finalNumber: 0, finalDirection: 0, finalForbidden: 0 },
    );
    writeFileSync(outPath, `${JSON.stringify({ label, promptVersion: values.rag ? promptVersionFor(true) : PROMPT_VERSION_NO_RAG, model, effort, totals, results }, null, 2)}\n`);
    io.log(`\n결과: ${outPath}`);
    io.log(
      `합계: 칸 ${totals.slots} · 1차 통과 ${totals.firstPass} · 숫자 1차 통과 ${totals.numberFirstPass} · 재시도 ${totals.retried} · 템플릿 ${totals.templated} · 전체 템플릿 판 ${totals.templateMode} · 최종 숫자 ${totals.finalNumber}·방향 ${totals.finalDirection}·금지어 ${totals.finalForbidden} · 비용 ${usd(totals.costUsd)}`,
    );
    if (values.set) {
      const gp = join(outDir, `${stamp}.${label}.grading.md`);
      writeFileSync(gp, `${gradingSheet(results, label)}\n`);
      io.log(`채점표: ${gp}`);
    }
    if (values.yes) io.log(`장부 누적: ${usd(ledger.totalUsd())} / $${budgetUsd.toFixed(2)}`);
  }
  return exit;
}

/** --rag 기본 검색기: 지식 문서로 knowledgeVersion, DB 연결 1개 + Voyage 질의 임베딩. 키·접속 문자열은 출력하지 않는다 */
async function createCliRag(env: NodeJS.ProcessEnv): Promise<CliRag> {
  const url = env.DATABASE_URL?.trim();
  const key = env.VOYAGE_API_KEY?.trim();
  console.log(`VOYAGE_API_KEY: ${key ? '있음' : '없음'} · DATABASE_URL: ${url ? '있음' : '없음'}`);
  if (!url || !key) throw new Error('DATABASE_URL과 VOYAGE_API_KEY가 필요합니다');
  const parsed = loadKnowledgeDir(RAG_DEFAULTS.dir);
  if (parsed.errors.length > 0) throw new Error(`지식 문서 오류 ${parsed.errors.length}건 (npm run rag -- ingest --offline)`);
  // 과목별 검색을 동시에 보내므로 연결 1개(Client)가 아니라 작은 풀
  const pool = new pg.Pool({ connectionString: url, max: 2, application_name: 'tiergg-feedback-cli', connectionTimeoutMillis: 10_000 });
  const deps = { embed: createVoyageEmbed({ apiKey: key, rateRetries: 4 }), search: pgSearch({ query: (text, values) => pool.query(text, values) }) };
  return { retrieve: (r) => retrieveKnowledge(r, deps), knowledgeVersion: knowledgeVersion(parsed.chunks), close: () => pool.end() };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli(process.argv.slice(2), process.env, { log: (s) => console.log(s), error: (s) => console.error(s) }, {
    clientFactory: (apiKey) => createAnthropicClient({ apiKey }),
    now: () => Date.now(),
    ragFactory: createCliRag,
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    },
  );
}
