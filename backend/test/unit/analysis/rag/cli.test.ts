// npm run rag (ai_spec B4-3): ingest 미리보기는 임베딩을 만들지 않음, --yes는 키가 있어야 함, 바뀐 조각만 쓰기,
// eval --check는 네트워크 없음, eval은 상위 2개 적중률. 가짜 DB·가짜 임베딩만.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadKnowledgeDir, type KnowledgeChunk } from '../../../../src/analysis/rag/chunks.js';
import { RAG_DEFAULTS, runRagCli, type CliDb, type RagCliDeps } from '../../../../src/cli/rag.js';

const CHUNKS = loadKnowledgeDir(RAG_DEFAULTS.dir).chunks;

/** rag_chunk를 흉내 낸 가짜 DB: SELECT는 stored, search_rag_chunks는 조각 목록 그대로 (거리 = 순서) */
function fakeDb(stored: readonly KnowledgeChunk[]) {
  const sql: string[] = [];
  let ended = 0;
  const db: CliDb = {
    query: async (text: string, values?: unknown[]) => {
      sql.push(text.split(/\s+/)[0]!);
      if (text.startsWith('SELECT id, source, position')) {
        return { rows: stored.map((c) => ({ ...c, content_hash: c.contentHash, embedding_model: 'voyage-4' })) };
      }
      if (text.includes('search_rag_chunks')) {
        const [, role, , area, subjects, polarity] = values as [string, string, string, string, string[], string];
        const rows = CHUNKS.filter((c) => (c.role === role || c.role === 'ALL') && c.area === area && (c.subject === null || subjects.includes(c.subject)) && c.polarity === polarity);
        return { rows: rows.map((c, i) => ({ id: c.id, source: c.source, area: c.area, subject: c.subject, polarity: c.polarity, content: c.content, distance: i / 10 })) };
      }
      return { rows: [] };
    },
    end: async () => {
      ended++;
    },
  };
  return { db, sql, ended: () => ended };
}

function harness(stored: readonly KnowledgeChunk[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const f = fakeDb(stored);
  let made = 0;
  let embedded = 0;
  const deps: RagCliDeps = {
    openDb: async () => f.db,
    embedFactory: (_key, onUsage) => {
      made++;
      return async (texts) => {
        embedded += texts.length;
        onUsage(texts.length);
        return texts.map(() => Array.from({ length: 1024 }, () => 0));
      };
    },
  };
  return { out, err, deps, io: { log: (s: string) => out.push(s), error: (s: string) => err.push(s) }, f, made: () => made, embedded: () => embedded };
}

const ENV = { DATABASE_URL: 'postgresql://u:p@h/db', VOYAGE_API_KEY: 'vk-secret' };

describe('rag ingest', () => {
  it('--offline: DB·임베딩 없이 문서 검사, 조각 수·knowledgeVersion 출력', async () => {
    const h = harness();
    const code = await runRagCli(['ingest', '--offline'], {}, h.io, h.deps);
    assert.equal(code, 0);
    assert.equal(h.f.sql.length, 0);
    assert.equal(h.made(), 0);
    assert.match(h.out.join('\n'), new RegExp(`조각 ${CHUNKS.length}개`));
    assert.match(h.out.join('\n'), /knowledgeVersion [0-9a-f]{12}/);
  });
  it('미리보기(기본): DB SELECT만, 임베딩 함수를 만들지 않음, 키 값 출력 없음', async () => {
    const h = harness(CHUNKS.slice(0, 10));
    const code = await runRagCli(['ingest'], ENV, h.io, h.deps);
    assert.equal(code, 0);
    assert.deepEqual(h.f.sql, ['SELECT']);
    assert.equal(h.made(), 0);
    assert.match(h.out.join('\n'), new RegExp(`새 ${CHUNKS.length - 10} · 본문 바뀜 0 · 메타만 바뀜 0 · 그대로 10`));
    assert.doesNotMatch(h.out.join('\n') + h.err.join('\n'), /vk-secret|u:p@/);
    assert.equal(h.f.ended(), 1);
  });
  it('--yes인데 키 없음: 쓰지 않고 종료 코드 1', async () => {
    const h = harness();
    const code = await runRagCli(['ingest', '--yes'], { DATABASE_URL: ENV.DATABASE_URL }, h.io, h.deps);
    assert.equal(code, 1);
    assert.equal(h.made(), 0);
    assert.ok(!h.f.sql.includes('BEGIN'));
  });
  it('--yes: 새 조각만 임베딩·upsert, 다시 하면 "바뀐 조각 0", --prune 없이는 DELETE 없음', async () => {
    const extra = { ...CHUNKS[0]!, id: 'gone.common.ALL.bad.01' };
    const h = harness([...CHUNKS.slice(0, 20), extra]);
    const code = await runRagCli(['ingest', '--yes'], ENV, h.io, h.deps);
    assert.equal(code, 0);
    assert.equal(h.embedded(), CHUNKS.length - 20);
    assert.equal(h.f.sql.filter((s) => s === 'INSERT').length, CHUNKS.length - 20);
    assert.ok(!h.f.sql.includes('DELETE'));
    const h2 = harness(CHUNKS);
    assert.equal(await runRagCli(['ingest', '--yes'], ENV, h2.io, h2.deps), 0);
    assert.match(h2.out.join('\n'), /바뀐 조각 0/);
    assert.equal(h2.made(), 0);
  });
  it('--prune --yes: 문서에 없는 조각 DELETE', async () => {
    const h = harness([...CHUNKS, { ...CHUNKS[0]!, id: 'gone.common.ALL.bad.01' }]);
    assert.equal(await runRagCli(['ingest', '--prune', '--yes'], ENV, h.io, h.deps), 0);
    assert.ok(h.f.sql.includes('DELETE'));
    assert.equal(h.made(), 0); // 지우기만이라 임베딩 없음
  });
  it('문서에 숫자가 있으면 오류로 멈춤 (종료 코드 1, DB 안 읽음)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kn-'));
    writeFileSync(join(dir, 'adc.md'), '### fight.damage.ADC.bad.R1 제목\n- meta: role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1\n딜이 22% 낮다. 다음 판에 해 본다.\n');
    const h = harness();
    assert.equal(await runRagCli(['ingest', '--dir', dir], ENV, h.io, h.deps), 1);
    assert.match(h.err.join('\n'), /숫자 포함/);
    assert.equal(h.f.sql.length, 0);
  });
});

describe('rag eval', () => {
  it('--check: 네트워크·DB 없이 형식 검사 통과', async () => {
    const h = harness();
    assert.equal(await runRagCli(['eval', '--check'], {}, h.io, h.deps), 0);
    assert.equal(h.made(), 0);
    assert.equal(h.f.sql.length, 0);
  });
  it('eval: 질의 20개를 임베딩 1번(한 묶음)에, 문항마다 검색, 적중률 출력', async () => {
    const h = harness();
    assert.equal(await runRagCli(['eval'], ENV, h.io, h.deps), 0);
    assert.equal(h.made(), 1);
    assert.equal(h.embedded(), 20);
    assert.equal(h.f.sql.filter((s) => s === 'SELECT').length, 20);
    assert.match(h.out.join('\n'), /상위 2개 적중: 기대 조각 \d+\/22 \(\d+\.\d%\)/);
  });
});
