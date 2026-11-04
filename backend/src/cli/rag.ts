// 개발용 명령 (ai_spec B4-3): RAG 지식 문서 적재·검색·검색 평가.
//   npm run rag -- ingest                 # 미리보기 (문서 검사 + DB와 비교: 새·바뀜·지울 조각 수, 예상 토큰). 임베딩 호출 없음
//   npm run rag -- ingest --offline       # DB도 읽지 않고 문서 검사만
//   npm run rag -- ingest --yes           # 바뀐 조각만 Voyage 임베딩 → upsert (지우기 없음)
//   npm run rag -- ingest --prune --yes   # 위 + 문서에서 사라진 조각 DELETE
//   npm run rag -- search "<질의>" --role R --area A [--subject S] [--polarity good|bad|any] [--limit N]
//   npm run rag -- eval [--file F]        # 검색 평가 세트: 상위 2개 적중률 (Voyage 질의 임베딩 + DB)
//   npm run rag -- eval --check           # 평가 세트가 문서 조각과 맞는지만 (네트워크 없음)
// 키 값은 출력하지 않는다("있음/없음"만). process.env는 이 파일 맨 아래 진입점에서만 읽는다.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { knowledgeVersion, loadKnowledgeDir, ROLE_POSITION, ROLES, type ChunkPolarity, type KnowledgeChunk, type ParseResult } from '../analysis/rag/chunks.js';
import { applyIngest, planIngest, readStored } from '../analysis/rag/ingest.js';
import { pgSearch, pickForSubject, RAG_LIMITS, type RagDb } from '../analysis/rag/retrieve.js';
import { createVoyageEmbed, VOYAGE_MODEL, type EmbedFn } from '../analysis/rag/voyage.js';
import type { Area } from '../analysis/llm/labels.js';
import type { Role } from '../analysis/types.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const RAG_DEFAULTS = {
  dir: resolve(ROOT, '../docs/ai/knowledge'),
  evalFile: join(ROOT, 'test/eval/rag-eval.json'),
};

const USAGE = `사용법:
  npm run rag -- ingest [--offline] [--yes] [--prune] [--dir <폴더>]
  npm run rag -- search "<질의>" --role <유형> --area laning|fight|macro [--subject <과목>] [--polarity good|bad|any] [--limit N]
  npm run rag -- eval [--check] [--file <파일>]
환경 변수: DATABASE_URL(ingest 미리보기·search·eval), VOYAGE_API_KEY(ingest --yes·search·eval)`;

export interface RagCliIo {
  log: (s: string) => void;
  error: (s: string) => void;
}

export type CliDb = RagDb & { end: () => Promise<void> };

export interface RagCliDeps {
  openDb: (databaseUrl: string) => Promise<CliDb>;
  /** 임베딩이 필요한 명령에서만 부른다. 테스트에서 바꿔 끼워 "미리보기는 만들지 않음"을 확인한다 */
  embedFactory: (apiKey: string, onUsage: (tokens: number) => void) => EmbedFn;
}

export interface EvalItem {
  id: string;
  query: string;
  role: Role;
  area: Area;
  subject: string;
  polarity: 'good' | 'bad';
  expected: string[];
  note?: string;
}

function printIssues(io: RagCliIo, parsed: ParseResult): void {
  for (const e of parsed.errors) io.error(`  오류 ${e.file}:${e.line} ${e.id ?? ''} ${e.message}`);
  for (const w of parsed.warnings) io.log(`  경고 ${w.file}:${w.line} ${w.id ?? ''} ${w.message}`);
}

function summarize(io: RagCliIo, chunks: readonly KnowledgeChunk[]): void {
  const byFile = new Map<string, number>();
  for (const c of chunks) byFile.set(c.file, (byFile.get(c.file) ?? 0) + 1);
  io.log(`조각 ${chunks.length}개: ${[...byFile].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([f, n]) => `${f} ${n}`).join(', ')}`);
  io.log(`knowledgeVersion ${knowledgeVersion(chunks)} · 최장 ${Math.max(0, ...chunks.map((c) => c.content.length))}자`);
}

async function withDb<T>(env: NodeJS.ProcessEnv, io: RagCliIo, deps: RagCliDeps, fn: (db: CliDb) => Promise<T>): Promise<T | null> {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    io.error('DATABASE_URL이 없습니다. 문서 검사만 하려면 --offline');
    return null;
  }
  const db = await deps.openDb(url);
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

function voyageKey(env: NodeJS.ProcessEnv, io: RagCliIo): string | null {
  const key = env.VOYAGE_API_KEY?.trim();
  io.log(`VOYAGE_API_KEY: ${key ? '있음' : '없음'}`);
  if (!key) io.error('키가 없어 임베딩을 호출하지 않습니다.');
  return key || null;
}

async function ingest(values: Record<string, unknown>, env: NodeJS.ProcessEnv, io: RagCliIo, deps: RagCliDeps): Promise<number> {
  const dir = resolve(String(values.dir ?? RAG_DEFAULTS.dir));
  const parsed = loadKnowledgeDir(dir);
  io.log(`지식 문서 ${dir}`);
  printIssues(io, parsed);
  if (parsed.errors.length > 0) {
    io.error(`문서 오류 ${parsed.errors.length}건: 고친 뒤 다시 실행하세요. 적재하지 않습니다.`);
    return 1;
  }
  summarize(io, parsed.chunks);
  if (values.offline) {
    if (values.yes) {
      io.error('--offline과 --yes는 함께 쓸 수 없습니다.');
      return 1;
    }
    io.log('\n--offline: DB 비교 없이 문서 검사만 했습니다.');
    return 0;
  }
  const code = await withDb(env, io, deps, async (db) => {
    const plan = planIngest(parsed.chunks, await readStored(db));
    io.log(
      `\nDB 비교 (모델 ${VOYAGE_MODEL}): 새 ${plan.added.length} · 본문 바뀜 ${plan.changed.length} · 메타만 바뀜 ${plan.metaOnly.length} · 그대로 ${plan.unchanged} · 문서에 없음 ${plan.removed.length}`,
    );
    io.log(`임베딩할 조각 ${plan.added.length + plan.changed.length}개, 예상 약 ${plan.estTokens.toLocaleString('en-US')}토큰 (Voyage 무료 범위)`);
    if (plan.removed.length > 0) io.log(`문서에 없는 DB 조각${values.prune ? ' (--prune --yes면 지움)' : ' (--prune 없이는 지우지 않음)'}: ${plan.removed.join(', ')}`);
    if (!values.yes) {
      io.log('\n미리보기만 했습니다 (임베딩·쓰기 없음). 적재는 --yes, 지우기까지는 --prune --yes.');
      return 0;
    }
    if (plan.added.length + plan.changed.length + plan.metaOnly.length + (values.prune ? plan.removed.length : 0) === 0) {
      io.log('바뀐 조각 0: 쓸 것이 없습니다.');
      return 0;
    }
    let embed: EmbedFn = async () => [];
    let tokens = 0;
    if (plan.added.length + plan.changed.length > 0) {
      const key = voyageKey(env, io);
      if (!key) return 1;
      embed = deps.embedFactory(key, (t) => (tokens += t));
    }
    const r = await applyIngest(db, plan, embed, { prune: Boolean(values.prune) });
    io.log(`적재 완료: 임베딩·upsert ${r.upserted} · 메타 갱신 ${r.metaUpdated} · 삭제 ${r.deleted} · Voyage 토큰 ${tokens}`);
    return 0;
  });
  return code ?? 1;
}

const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);
const isArea = (v: unknown): v is Area => v === 'laning' || v === 'fight' || v === 'macro';

async function search(positionals: string[], values: Record<string, unknown>, env: NodeJS.ProcessEnv, io: RagCliIo, deps: RagCliDeps): Promise<number> {
  const query = positionals.join(' ').trim();
  const polarity = String(values.polarity ?? 'any') as ChunkPolarity;
  const limit = Number(values.limit ?? 5);
  if (!query || !isRole(values.role) || !isArea(values.area) || !['good', 'bad', 'any'].includes(polarity) || !Number.isInteger(limit)) {
    io.error(USAGE);
    return 1;
  }
  const role = values.role;
  const area = values.area;
  const key = voyageKey(env, io);
  if (!key) return 1;
  const code = await withDb(env, io, deps, async (db) => {
    const [vec] = await deps.embedFactory(key, () => {})([query], 'query');
    const rows = await pgSearch(db)({
      embedding: vec!,
      role,
      position: ROLE_POSITION[role],
      area,
      subjects: values.subject ? [String(values.subject)] : null,
      polarity,
      championId: null,
      limit,
    });
    io.log(`"${query}" → ${rows.length}개`);
    for (const r of rows) io.log(`  ${r.distance.toFixed(4)}  ${r.id}  ${r.content.split('\n')[0]}`);
    return 0;
  });
  return code ?? 1;
}

export function readEvalSet(path: string): EvalItem[] {
  const json = JSON.parse(readFileSync(path, 'utf8')) as { items?: EvalItem[] };
  if (!Array.isArray(json.items)) throw new Error(`평가 세트 형식 오류: items 배열 없음 (${path})`);
  return json.items;
}

/** 평가 세트 검사 (네트워크 없음): 기대 조각이 문서에 있고, 필터(유형·영역·과목·방향)로 검색될 수 있는지 */
export function checkEvalSet(items: readonly EvalItem[], chunks: readonly KnowledgeChunk[]): string[] {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) problems.push(`${it.id}: 문항 ID 중복`);
    seen.add(it.id);
    if (!isRole(it.role) || !isArea(it.area) || !['good', 'bad'].includes(it.polarity) || !it.query) problems.push(`${it.id}: 필터·질의 형식 오류`);
    if (!Array.isArray(it.expected) || it.expected.length === 0) problems.push(`${it.id}: expected 없음`);
    for (const e of it.expected ?? []) {
      const c = byId.get(e);
      if (!c) {
        problems.push(`${it.id}: 문서에 없는 조각 ${e}`);
        continue;
      }
      const ok =
        (c.role === it.role || c.role === 'ALL') &&
        (c.position === ROLE_POSITION[it.role] || c.position === 'ALL') &&
        (c.area === it.area || c.area === 'general') &&
        (c.subject === null || c.subject === it.subject) &&
        (c.polarity === it.polarity || c.polarity === 'any');
      if (!ok) problems.push(`${it.id}: ${e}는 이 문항의 필터로 검색되지 않음`);
    }
  }
  return problems;
}

async function evaluate(values: Record<string, unknown>, env: NodeJS.ProcessEnv, io: RagCliIo, deps: RagCliDeps): Promise<number> {
  const file = resolve(String(values.file ?? RAG_DEFAULTS.evalFile));
  const items = readEvalSet(file);
  const parsed = loadKnowledgeDir(resolve(String(values.dir ?? RAG_DEFAULTS.dir)));
  const problems = [...parsed.errors.map((e) => `문서 오류 ${e.file}:${e.line} ${e.message}`), ...checkEvalSet(items, parsed.chunks)];
  io.log(`평가 세트 ${file}: ${items.length}문항, 문서 조각 ${parsed.chunks.length}개`);
  for (const p of problems) io.error(`  ${p}`);
  if (problems.length > 0) return 1;
  if (values.check) {
    io.log('검사 통과 (네트워크 없음). 실제 검색 평가는 --check 없이.');
    return 0;
  }
  const key = voyageKey(env, io);
  if (!key) return 1;
  const code = await withDb(env, io, deps, async (db) => {
    let tokens = 0;
    const vecs = await deps.embedFactory(key, (t) => (tokens += t))(
      items.map((it) => it.query),
      'query',
    );
    const searchFn = pgSearch(db);
    let hit = 0;
    let total = 0;
    let full = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const rows = await searchFn({
        embedding: vecs[i]!,
        role: it.role,
        position: ROLE_POSITION[it.role],
        area: it.area,
        subjects: [it.subject],
        polarity: it.polarity,
        championId: null,
        limit: RAG_LIMITS.candidates,
      });
      const top = pickForSubject(rows, it.role, it.subject, RAG_LIMITS.perSubject).rows.map((r) => r.id);
      const got = it.expected.filter((e) => top.includes(e)).length;
      hit += got;
      total += it.expected.length;
      if (got === it.expected.length) full++;
      io.log(`  ${got === it.expected.length ? 'O' : 'X'} ${it.id} "${it.query}" → ${top.join(', ') || '(없음)'}${got < it.expected.length ? ` (기대 ${it.expected.join(', ')})` : ''}`);
    }
    const rate = total > 0 ? (hit / total) * 100 : 0;
    io.log(`상위 ${RAG_LIMITS.perSubject}개 적중: 기대 조각 ${hit}/${total} (${rate.toFixed(1)}%) · 문항 전부 적중 ${full}/${items.length} · Voyage 토큰 ${tokens}`);
    return 0;
  });
  return code ?? 1;
}

export async function runRagCli(argv: string[], env: NodeJS.ProcessEnv, io: RagCliIo, deps: RagCliDeps): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        yes: { type: 'boolean', default: false },
        prune: { type: 'boolean', default: false },
        offline: { type: 'boolean', default: false },
        check: { type: 'boolean', default: false },
        dir: { type: 'string' },
        file: { type: 'string' },
        role: { type: 'string' },
        area: { type: 'string' },
        subject: { type: 'string' },
        polarity: { type: 'string' },
        limit: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
    });
  } catch (e) {
    io.error(e instanceof Error ? e.message : String(e));
    io.error(USAGE);
    return 1;
  }
  const [cmd, ...rest] = parsed.positionals;
  const values = parsed.values as Record<string, unknown>;
  if (values.help || !cmd) {
    (values.help ? io.log : io.error)(USAGE);
    return values.help ? 0 : 1;
  }
  if (cmd === 'ingest') return ingest(values, env, io, deps);
  if (cmd === 'search') return search(rest, values, env, io, deps);
  if (cmd === 'eval') return evaluate(values, env, io, deps);
  io.error(`알 수 없는 명령: ${cmd}\n${USAGE}`);
  return 1;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runRagCli(process.argv.slice(2), process.env, { log: (s) => console.log(s), error: (s) => console.error(s) }, {
    openDb: async (url) => {
      const client = new pg.Client({ connectionString: url, application_name: 'tiergg-rag-cli', connectionTimeoutMillis: 10_000 });
      await client.connect();
      return { query: (text, values) => client.query(text, values), end: () => client.end() };
    },
    embedFactory: (apiKey, onUsage) => createVoyageEmbed({ apiKey, onUsage, rateRetries: 4 }),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      // 오류 메시지에 접속 문자열·키가 섞이지 않게 이름과 메시지 첫 줄만
      console.error(e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : 'error');
      process.exitCode = 1;
    },
  );
}
