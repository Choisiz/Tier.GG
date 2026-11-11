// RAG 부품 (ai_spec B4-3): 조각 파싱·검사, 해시·버전, 검색(묶음 임베딩·필터·넓히기·상한·중복), Voyage 요청 모양, 적재 계획·쓰기.
// 가짜 임베딩·가짜 DB·가짜 fetch만 쓴다. 네트워크·유료 호출 0회.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  knowledgeVersion,
  loadKnowledgeDir,
  parseKnowledgeFile,
  parseKnowledgeFiles,
  roleOfId,
  ROLE_POSITION,
  ruleOfId,
  type KnowledgeChunk,
} from '../../../../src/analysis/rag/chunks.js';
import { applyIngest, DELETE_SQL, planIngest, type StoredChunk } from '../../../../src/analysis/rag/ingest.js';
import { pgSearch, ragTargets, retrieveKnowledge, SEARCH_SQL, type RagRow, type RagSearchParams, type SearchFn } from '../../../../src/analysis/rag/retrieve.js';
import { createVoyageEmbed, VoyageError, type EmbedFn } from '../../../../src/analysis/rag/voyage.js';
import { checkEvalSet, RAG_DEFAULTS, readEvalSet } from '../../../../src/cli/rag.js';
import { senaResult } from '../llm/helpers.js';

const ok = (id: string, meta: string, body = '첫 문장이다. 둘째 문장이다.') => `### ${id} 제목\n- meta: ${meta}\n${body}\n`;

describe('조각 파싱·검사', () => {
  it('정상 조각: 메타 → 칸, position은 유형에서, content = 소제목 + 본문, 해시는 소문자 hex 64자', () => {
    const r = parseKnowledgeFile(ok('fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1'), 'adc.md');
    assert.deepEqual(r.errors, []);
    const c = r.chunks[0]!;
    assert.equal(c.position, 'BOTTOM');
    assert.equal(c.source, 'perspective');
    assert.equal(c.content, '제목\n첫 문장이다. 둘째 문장이다.');
    assert.match(c.contentHash, /^[0-9a-f]{64}$/);
    assert.equal(roleOfId(c.id), 'ADC');
    assert.equal(roleOfId('laning.gold.ALL.bad.01'), 'ALL');
    assert.equal(c.rule, 'R1');
    assert.equal(ruleOfId(c.id), 'R1');
    assert.equal(ruleOfId('fight.vision.ALL.bad.R1-2'), 'R1');
    assert.equal(ruleOfId('fight.vision.ALL.bad.01'), null); // Q3 전 조각은 규칙 없음
  });
  it('Q3: rule 메타 필수, 규칙마다 붙을 수 있는 과목·방향만, ID 끝 = 규칙', () => {
    const cases: [string, string, RegExp][] = [
      ['fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad', /필수 meta 누락: rule/],
      ['fight.damage.ADC.bad.R9', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R9', /허용되지 않은 rule/],
      ['fight.damage.ADC.bad.R5', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R5', /R5은 과목 macro\.solo에만/],
      ['fight.damage.ADC.good.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=good, rule=R1', /R1은 방향 bad에만/],
      ['laning.gold.ALL.bad.R1', 'role=ALL, area=laning, subject=laning.gold, polarity=bad, rule=R1', /R1은 과목/],
      ['fight.damage.ADC.bad.R2', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1', /ID가 규칙과 다름/],
      ['fight.damage.ADC.bad.01', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1', /ID가 규칙과 다름/],
    ];
    for (const [id, meta, re] of cases) {
      const r = parseKnowledgeFile(ok(id, meta), 'a.md');
      assert.equal(r.chunks.length, 0, `${id} ${meta}`);
      assert.ok(r.errors.some((e) => re.test(e.message)), `${id} ${meta}: ${r.errors.map((e) => e.message).join(' / ')}`);
    }
    assert.deepEqual(parseKnowledgeFile(ok('fight.advantage.ALL.good.R4-2', 'role=ALL, area=fight, subject=fight.advantage, polarity=good, rule=R4'), 'a.md').errors, []);
  });
  it('숫자가 있으면 오류 (아라비아·전각 숫자 모두), 조각은 버림', () => {
    for (const body of ['딜이 22% 낮다. 다음 판에 해 본다.', '딜이 ２배 낮다. 다음 판에 해 본다.']) {
      const r = parseKnowledgeFile(ok('fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1', body), 'a.md');
      assert.equal(r.chunks.length, 0);
      assert.match(r.errors[0]!.message, /숫자 포함/);
    }
  });
  it('메타 누락·허용 안 되는 값·과목/영역 불일치·ID 규칙·포지션 불일치는 오류', () => {
    const cases: [string, string, RegExp][] = [
      ['fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage', /필수 meta 누락: polarity/],
      ['fight.damage.ADC.bad.R1', 'role=ADX, area=fight, subject=fight.damage, polarity=bad, rule=R1', /허용되지 않은 role/],
      ['fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.dmg, polarity=bad', /허용되지 않은 subject/],
      ['fight.damage.ADC.bad.R1', 'role=ADC, area=macro, subject=fight.damage, polarity=bad, rule=R1', /area macro에 속하지 않음/],
      ['fight.damage.ADC.good.01', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1', /ID가 규칙과 다름/],
      ['fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1, position=TOP', /포지션/],
      ['fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1, champ=1', /알 수 없는 meta 키/],
    ];
    for (const [id, meta, re] of cases) {
      const r = parseKnowledgeFile(ok(id, meta), 'a.md');
      assert.equal(r.chunks.length, 0, meta);
      assert.ok(r.errors.some((e) => re.test(e.message)), `${meta}: ${r.errors.map((e) => e.message).join(' / ')}`);
    }
    const noMeta = parseKnowledgeFile('### fight.damage.ADC.bad.R1 제목\n본문만 있다. 둘째.\n', 'a.md');
    assert.match(noMeta.errors[0]!.message, /meta:/);
  });
  it('ID 중복은 파일이 달라도 오류', () => {
    const t = ok('fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1');
    const r = parseKnowledgeFiles([
      { name: 'a.md', text: t },
      { name: 'b.md', text: t },
    ]);
    assert.equal(r.chunks.length, 1);
    assert.match(r.errors[0]!.message, /ID 중복/);
  });
  it('경고: 600자 초과, 문장 수, 검증기가 막는 해석어·금지 표현', () => {
    const long = `${'가'.repeat(610)}. 둘째 문장이다.`;
    const r1 = parseKnowledgeFile(ok('fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1', long), 'a.md');
    assert.ok(r1.warnings.some((w) => /권장 600자/.test(w.message)));
    const r2 = parseKnowledgeFile(ok('fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1', '한 문장뿐이다.'), 'a.md');
    assert.ok(r2.warnings.some((w) => /문장/.test(w.message)));
    const r3 = parseKnowledgeFile(ok('fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1', '이니시가 늦었다. 등급이 낮다.'), 'a.md');
    assert.ok(r3.warnings.some((w) => /해석어/.test(w.message)));
    assert.ok(r3.warnings.some((w) => /금지 표현/.test(w.message)));
    assert.equal(r3.chunks.length, 1); // 경고는 적재를 막지 않는다
  });
  it('첫 조각 앞의 제목·설명 줄과 ## 소제목 뒤 내용은 조각에 안 들어감', () => {
    const t = `# 제목\n> 설명\n${ok('macro.solo.ALL.bad.R5', 'role=ALL, area=macro, subject=macro.solo, polarity=bad, rule=R5')}\n## 기타\n이건 조각이 아니다.\n`;
    const r = parseKnowledgeFile(t, 'c.md');
    assert.equal(r.chunks.length, 1);
    assert.equal(r.chunks[0]!.position, 'ALL');
    assert.doesNotMatch(r.chunks[0]!.content, /조각이 아니다/);
  });
});

describe('해시·버전', () => {
  const a = parseKnowledgeFile(ok('fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1'), 'a.md').chunks;
  it('같은 조각이면 순서와 관계없이 같은 12자, 본문이나 메타가 바뀌면 다름', () => {
    const b = parseKnowledgeFile(ok('macro.solo.ALL.bad.R5', 'role=ALL, area=macro, subject=macro.solo, polarity=bad, rule=R5'), 'c.md').chunks;
    const v = knowledgeVersion([...a, ...b]);
    assert.match(v, /^[0-9a-f]{12}$/);
    assert.equal(knowledgeVersion([...b, ...a]), v);
    const edited = parseKnowledgeFile(ok('fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1', '첫 문장이다. 바뀐 문장이다.'), 'a.md').chunks;
    assert.notEqual(knowledgeVersion([...edited, ...b]), v);
    assert.notEqual(knowledgeVersion([{ ...a[0]!, polarity: 'any' }, ...b]), v);
  });
});

describe('저장소 지식 문서 (docs/ai/knowledge)', () => {
  const parsed = loadKnowledgeDir(RAG_DEFAULTS.dir);
  it('오류·경고 0, 조각 30~60개(Q3 규칙 연결), 유형 10개 모두 + ALL, 숫자 없음, 600자 이하, 규칙 R1~R5 모두', () => {
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.warnings, []);
    assert.ok(parsed.chunks.length >= 30 && parsed.chunks.length <= 60, String(parsed.chunks.length));
    assert.deepEqual([...new Set(parsed.chunks.map((c) => c.rule))].sort(), ['R1', 'R2', 'R3', 'R4', 'R5']);
    const roles = new Set(parsed.chunks.map((c) => c.role));
    assert.equal(roles.size, 11);
    for (const c of parsed.chunks) {
      assert.doesNotMatch(c.content, /\p{Nd}/u, c.id);
      assert.ok(c.content.length <= 600, c.id);
    }
  });
  it('검색 평가 세트 20문항: 기대 조각이 문서에 있고 필터로 검색될 수 있음', () => {
    const items = readEvalSet(RAG_DEFAULTS.evalFile);
    assert.equal(items.length, 20);
    assert.deepEqual(checkEvalSet(items, parsed.chunks), []);
  });
});

// ---------- 검색 ----------

/** 계약 12-2 필터를 흉내 낸 가짜 DB. 거리는 조각 목록 순서 (앞일수록 가깝다) */
function fakeDb(chunks: readonly KnowledgeChunk[]) {
  const calls: RagSearchParams[] = [];
  const search: SearchFn = async (p) => {
    calls.push(p);
    return chunks
      .map((c, i) => ({ c, i }))
      .filter(
        ({ c }) =>
          (c.role === p.role || c.role === 'ALL') &&
          (c.position === p.position || c.position === 'ALL') &&
          (c.area === p.area || c.area === 'general') &&
          (p.subjects === null || c.subject === null || p.subjects.includes(c.subject)) &&
          (c.polarity === p.polarity || c.polarity === 'any'),
      )
      .slice(0, p.limit)
      .map(({ c, i }): RagRow => ({ id: c.id, source: c.source, area: c.area, subject: c.subject, polarity: c.polarity, content: c.content, distance: i / 100 }));
  };
  return { search, calls };
}

function fakeEmbed() {
  const calls: { texts: readonly string[]; type: string }[] = [];
  const embed: EmbedFn = async (texts, type) => {
    calls.push({ texts, type });
    return texts.map((_, i) => [i, 0, 0]);
  };
  return { embed, calls };
}

const chunk = (id: string, meta: string) => parseKnowledgeFile(ok(id, meta), 'x.md').chunks[0]!;

describe('검색 (가짜 임베딩·가짜 DB)', () => {
  const result = senaResult(); // 딜서폿, 라인전·교전·운영 모두 부족, 패배
  const real = loadKnowledgeDir(RAG_DEFAULTS.dir).chunks;

  it('Q3: 조언 규칙이 발동한 칸만 검색 (라인전·규칙 없는 칸 제외), 질의 문장에 유형·과목·방향·판정·승패·규칙 근거, 숫자 없음', () => {
    const t = ragTargets(result);
    assert.deepEqual(
      t.map((x) => `${x.key}:${x.subjectId}:${x.rules.join('+')}`),
      ['fight.bad.0:fight.vision:R1', 'fight.bad.1:fight.advantage:R4', 'macro.bad.1:macro.advantage:R1'],
    );
    assert.equal(t[0]!.query, '딜서폿 오브젝트 전 시야 부족, 오브젝트 싸움 부족, 패배, 반영 비율');
    for (const x of t) assert.doesNotMatch(x.query, /\d/);
  });

  it('질의 임베딩은 1번(한 요청, input_type=query), 칸마다 DB 1번, 그 칸 규칙의 조각만 (유형 조각 먼저)', async () => {
    const e = fakeEmbed();
    const d = fakeDb(real);
    const out = await retrieveKnowledge(result, { embed: e.embed, search: d.search });
    assert.equal(e.calls.length, 1);
    assert.equal(e.calls[0]!.type, 'query');
    assert.equal(e.calls[0]!.texts.length, 3);
    assert.equal(d.calls.length, 3);
    for (const c of d.calls) {
      assert.equal(c.role, 'SUPPORT_DAMAGE');
      assert.equal(c.position, 'UTILITY');
      assert.equal(c.championId, null);
      assert.equal(c.subjects!.length, 1);
      assert.equal(c.limit, 10);
    }
    assert.equal(out.queries, 3);
    const byKey = Object.fromEntries(out.picks.map((p) => [p.key, p]));
    assert.deepEqual(byKey['fight.bad.0']!.ids, ['fight.vision.SUPPORT_DAMAGE.bad.R1', 'fight.vision.ALL.bad.R1']);
    assert.equal(byKey['fight.bad.0']!.widened, false);
    // 득실 칸은 R4만 발동 → R2·R3 조각은 같은 과목·방향이라도 쓰지 않는다
    assert.deepEqual(byKey['fight.bad.1']!.ids, ['fight.advantage.ALL.bad.R4']);
    assert.equal(byKey['fight.bad.1']!.widened, true);
    assert.deepEqual(byKey['macro.bad.1']!.ids, ['macro.advantage.ALL.bad.R1']);
    assert.equal(out.chunks.length, 4);
    assert.ok(out.notes.some((n) => /ALL 조각/.test(n)));
  });

  it('규칙 칸이 없는 옛 조각(…bad.01)과 다른 규칙 조각은 DB에 남아 있어도 버린다', async () => {
    const row = (id: string, i: number): RagRow => ({ id, source: 'perspective', area: 'fight', subject: 'fight.vision', polarity: 'bad', content: id, distance: i });
    const search: SearchFn = async (p) => (p.subjects?.[0] === 'fight.vision' ? [row('fight.vision.ALL.bad.01', 0), row('fight.vision.SUPPORT_DAMAGE.bad.01', 0.1), row('fight.vision.ALL.bad.R2', 0.2), row('fight.vision.ALL.bad.R1', 0.3)] : []);
    const out = await retrieveKnowledge(result, { embed: fakeEmbed().embed, search });
    assert.deepEqual(out.chunks.map((c) => c.id), ['fight.vision.ALL.bad.R1']);
  });

  it('유형 조각을 거리순으로 먼저, 과목당 2개, 판당 상한, 같은 조각은 한 번', async () => {
    const many: KnowledgeChunk[] = [];
    for (const [s, rule] of [
      ['fight.vision', 'R1'],
      ['fight.advantage', 'R4'],
      ['macro.advantage', 'R1'],
    ] as const) {
      const area = s.split('.')[0]!;
      // ALL 조각을 앞(더 가까움)에 둬도 유형 조각이 먼저 골라져야 한다
      many.push(chunk(`${s}.ALL.bad.${rule}`, `role=ALL, area=${area}, subject=${s}, polarity=bad, rule=${rule}`));
      for (const n of ['', '-2', '-3']) many.push(chunk(`${s}.SUPPORT_DAMAGE.bad.${rule}${n}`, `role=SUPPORT_DAMAGE, area=${area}, subject=${s}, polarity=bad, rule=${rule}`));
    }
    const out = await retrieveKnowledge(result, { embed: fakeEmbed().embed, search: fakeDb(many).search, limits: { perGame: 4 } });
    for (const p of out.picks) {
      assert.equal(p.ids.length, 2);
      assert.ok(p.ids.every((id) => id.includes('SUPPORT_DAMAGE')), p.ids.join());
    }
    assert.deepEqual(out.picks[0]!.ids, ['fight.vision.SUPPORT_DAMAGE.bad.R1', 'fight.vision.SUPPORT_DAMAGE.bad.R1-2']);
    // 칸마다 1순위부터 돌아가며 담는다: 3칸의 1순위 3개 + 2순위 첫 칸 1개
    assert.deepEqual(out.chunks.map((c) => c.id), ['fight.vision.SUPPORT_DAMAGE.bad.R1', 'fight.advantage.SUPPORT_DAMAGE.bad.R4', 'macro.advantage.SUPPORT_DAMAGE.bad.R1', 'fight.vision.SUPPORT_DAMAGE.bad.R1-2']);
    assert.ok(out.notes.some((n) => /판당 상한 4개로 2개 뺌/.test(n)));
  });

  it('맞는 조각이 0개면 chunks 빈 배열 (RAG 없이 생성)', async () => {
    const out = await retrieveKnowledge(result, { embed: fakeEmbed().embed, search: fakeDb([]).search });
    assert.equal(out.chunks.length, 0);
    assert.ok(out.notes.some((n) => /RAG 없이/.test(n)));
  });

  it('pgSearch: 계약 함수와 벡터 리터럴 $1::extensions.vector, 인자 8개 순서', async () => {
    const seen: { text: string; values: unknown[] }[] = [];
    const s = pgSearch({
      query: async (text, values) => {
        seen.push({ text, values: values ?? [] });
        return { rows: [{ id: 'a', source: 'perspective', area: 'fight', subject: null, polarity: 'bad', content: 'c', distance: '0.25' }] };
      },
    });
    const rows = await s({ embedding: [0.5, -1], role: 'ADC', position: 'BOTTOM', area: 'fight', subjects: ['fight.damage'], polarity: 'bad', championId: null, limit: 6 });
    assert.equal(seen[0]!.text, SEARCH_SQL);
    assert.match(SEARCH_SQL, /search_rag_chunks\(\$1::extensions\.vector/);
    assert.deepEqual(seen[0]!.values, ['[0.5,-1]', 'ADC', 'BOTTOM', 'fight', ['fight.damage'], 'bad', null, 6]);
    assert.equal(rows[0]!.distance, 0.25);
    assert.equal(rows[0]!.subject, null);
  });

  it('ROLE_POSITION은 유형 10개 모두', () => {
    assert.equal(Object.keys(ROLE_POSITION).length, 10);
  });
});

// ---------- Voyage ----------

describe('Voyage 요청 (가짜 fetch)', () => {
  const vec = () => Array.from({ length: 1024 }, () => 0.01);
  it('voyage-4, input_type, 1,024차원, Bearer 키, batchSize로 나눔, 사용 토큰 콜백', async () => {
    const bodies: Record<string, unknown>[] = [];
    let auth = '';
    let tokens = 0;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)) as { input: string[] };
      bodies.push(b as unknown as Record<string, unknown>);
      auth = String((init.headers as Record<string, string>).authorization);
      return new Response(JSON.stringify({ data: b.input.map((_, i) => ({ index: i, embedding: vec() })), usage: { total_tokens: 7 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const embed = createVoyageEmbed({ apiKey: 'vk-test', fetchFn, batchSize: 2, onUsage: (t) => (tokens += t) });
    const out = await embed(['a', 'b', 'c'], 'document');
    assert.equal(out.length, 3);
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0], { input: ['a', 'b'], model: 'voyage-4', input_type: 'document', output_dimension: 1024 });
    assert.equal(auth, 'Bearer vk-test');
    assert.equal(tokens, 14);
  });
  it('429는 rateRetries만큼 기다렸다 다시 보냄 (Retry-After 초), 기본은 재시도 없음', async () => {
    let n = 0;
    const waits: number[] = [];
    const fetchFn = (async () => {
      n++;
      if (n === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '2' } });
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: vec() }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await createVoyageEmbed({ apiKey: 'k', fetchFn, rateRetries: 2, sleep: async (ms) => void waits.push(ms) })(['a'], 'query');
    assert.equal(out.length, 1);
    assert.deepEqual(waits, [2000]);
    n = 0;
    await assert.rejects(createVoyageEmbed({ apiKey: 'k', fetchFn })(['a'], 'query'), (e: unknown) => e instanceof VoyageError && e.kind === 'rate');
  });
  it('401 → auth, 429 → rate, 차원이 다르면 shape. 오류 메시지에 키 없음', async () => {
    const mk = (status: number, body: unknown = {}) =>
      createVoyageEmbed({ apiKey: 'vk-secret', fetchFn: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch });
    for (const [status, kind] of [
      [401, 'auth'],
      [429, 'rate'],
      [500, 'server'],
    ] as const) {
      await assert.rejects(mk(status)(['a'], 'query'), (e: unknown) => e instanceof VoyageError && e.kind === kind && !e.message.includes('vk-secret'));
    }
    await assert.rejects(mk(200, { data: [{ index: 0, embedding: [1, 2] }] })(['a'], 'query'), (e: unknown) => e instanceof VoyageError && e.kind === 'shape');
  });
});

// ---------- 적재 ----------

describe('적재 계획·쓰기 (가짜 DB)', () => {
  const a = chunk('fight.damage.ADC.bad.R1', 'role=ADC, area=fight, subject=fight.damage, polarity=bad, rule=R1');
  const b = chunk('macro.solo.ALL.bad.R5', 'role=ALL, area=macro, subject=macro.solo, polarity=bad, rule=R5');
  const c = chunk('fight.advantage.ALL.bad.R3', 'role=ALL, area=fight, subject=fight.advantage, polarity=bad, rule=R3');
  const stored = (k: KnowledgeChunk, o: Partial<StoredChunk> = {}): StoredChunk => ({
    id: k.id,
    source: k.source,
    position: k.position,
    role: k.role,
    area: k.area,
    subject: k.subject,
    polarity: k.polarity,
    contentHash: k.contentHash,
    embeddingModel: 'voyage-4',
    ...o,
  });

  it('새·본문 바뀜·임베딩 모델 다름·메타만 바뀜·그대로·문서에 없음을 나눈다', () => {
    const p = planIngest([a, b, c], [stored(a, { contentHash: '0'.repeat(64) }), stored(b, { polarity: 'any' }), stored(c, { embeddingModel: 'old' }), stored(a, { id: 'gone.x' })]);
    assert.deepEqual(p.added, []);
    assert.deepEqual(p.changed.map((x) => x.id), [a.id, c.id]);
    assert.deepEqual(p.metaOnly.map((x) => x.id), [b.id]);
    assert.deepEqual(p.removed, ['gone.x']);
    assert.ok(p.estTokens > 0);
    const again = planIngest([a, b], [stored(a), stored(b)]);
    assert.equal(again.unchanged, 2);
    assert.equal(again.added.length + again.changed.length + again.metaOnly.length + again.removed.length, 0);
  });

  function recDb() {
    const sql: { text: string; values?: unknown[] }[] = [];
    return { sql, db: { query: async (text: string, values?: unknown[]) => (sql.push({ text, values }), { rows: [] }) } };
  }

  it('바뀐 조각만 document 임베딩 → 트랜잭션 1개로 upsert, --prune 없으면 DELETE 없음', async () => {
    const r = recDb();
    const e = fakeEmbed();
    const embed: EmbedFn = async (t, type) => (await e.embed(t, type)).map(() => Array.from({ length: 1024 }, () => 0));
    const plan = planIngest([a, b], [stored(b), stored(a, { id: 'gone.x' })]);
    const res = await applyIngest(r.db, plan, embed, { prune: false });
    assert.equal(e.calls.length, 1);
    assert.equal(e.calls[0]!.type, 'document');
    assert.deepEqual(e.calls[0]!.texts, [a.content]);
    assert.deepEqual(r.sql.map((x) => x.text.split(' ')[0]), ['BEGIN', 'INSERT', 'COMMIT']);
    assert.match(r.sql[1]!.text, /\$10::extensions\.vector/);
    assert.match(String(r.sql[1]!.values![8]), /^[0-9a-f]{64}$/);
    assert.equal(res.deleted, 0);
  });

  it('--prune이면 사라진 조각 DELETE. 임베딩이 실패하면 DB를 건드리지 않음', async () => {
    const r = recDb();
    const plan = planIngest([b], [stored(b), stored(a, { id: 'gone.x' })]);
    const res = await applyIngest(r.db, plan, fakeEmbed().embed, { prune: true });
    assert.equal(res.deleted, 1);
    assert.equal(r.sql[1]!.text, DELETE_SQL);
    assert.deepEqual(r.sql[1]!.values, [['gone.x']]);
    const r2 = recDb();
    await assert.rejects(applyIngest(r2.db, planIngest([a], []), async () => Promise.reject(new VoyageError('auth', 'x')), { prune: false }));
    assert.equal(r2.sql.length, 0);
  });
});

describe('import 경계 (rag/**)', () => {
  const dir = fileURLToPath(new URL('../../../../src/analysis/rag/', import.meta.url));
  it('process.env 없음, riot·db·api import 없음, fetch는 voyage.ts만', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const t = readFileSync(join(dir, f), 'utf8');
      assert.doesNotMatch(t, /process\.env/, f);
      assert.doesNotMatch(t, /from '\.\.\/\.\.\/(riot|db|repositories|api|collector)\//, f);
      if (f !== 'voyage.ts') assert.doesNotMatch(t, /fetch\(/, f);
    }
  });
});
