// 샘플 검증 실행기
//   node --env-file=../.env scripts/verify.mjs          실제 스키마(public)에 대해 db/tests/*.sql 실행
//   node --env-file=../.env scripts/verify.mjs --fresh  임시 스키마 migration_check에 마이그레이션을 적용한 뒤 실행
//
// - 테스트 파일 1개 = 트랜잭션 1개 (BEGIN → 실행 → 항상 ROLLBACK). 샘플 데이터는 커밋되지 않는다.
// - 테스트 SQL은 기대값이 틀리면 RAISE EXCEPTION, 확인한 값은 RAISE NOTICE 로 남긴다.
// - 실행 전후에 테이블별 count(*)를 비교해 샘플이 남지 않았는지 확인한다.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, formatError, redact } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = path.resolve(here, '..', 'tests');
const MIGRATIONS_DIR = path.resolve(here, '..', 'migrations');
const fresh = process.argv.includes('--fresh');

const TABLES = [
  'ranked_players', 'matches', 'match_players', 'collection_logs',
  'stats_window', 'stats_window_patch', 'champion', 'champion_item', 'champion_rune', 'champion_spell', 'champion_skill',
];

async function countRows(client) {
  const out = {};
  for (const t of TABLES) {
    const exists = await client.query('SELECT to_regclass($1) AS t', [`public.${t}`]);
    out[t] = exists.rows[0].t ? Number((await client.query(`SELECT count(*) AS n FROM public.${t}`)).rows[0].n) : null;
  }
  return out;
}

function readSqlDir(dir) {
  return readdirSync(dir)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(path.join(dir, f), 'utf8') }));
}

let client;
let failed = 0;
try {
  client = await connect();
  let notices = [];
  client.on('notice', (msg) => notices.push(redact(msg.message)));

  const tests = readSqlDir(TESTS_DIR);
  const migrations = fresh ? readSqlDir(MIGRATIONS_DIR) : [];
  const before = await countRows(client);
  console.log(`모드: ${fresh ? 'fresh (임시 스키마 migration_check)' : '실제 스키마 public'}`);

  for (const t of tests) {
    notices = [];
    const started = Date.now();
    try {
      await client.query('BEGIN');
      if (fresh) {
        await client.query('CREATE SCHEMA migration_check');
        await client.query('SET LOCAL search_path = migration_check, pg_catalog');
        for (const m of migrations) await client.query(m.sql);
      } else {
        await client.query('SET LOCAL search_path = public, pg_catalog');
      }
      await client.query(t.sql);
      console.log(`통과: ${t.name} (${Date.now() - started}ms)`);
    } catch (err) {
      failed++;
      console.error(`실패: ${t.name}`);
      console.error(`  ${formatError(err)}`);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
    }
    for (const n of notices) console.log(`    ${n}`);
  }

  const after = await countRows(client);
  const leftovers = TABLES.filter((t) => before[t] !== after[t]);
  console.log('테이블별 줄 수 (검증 전 → 후):');
  for (const t of TABLES) console.log(`  ${t.padEnd(16)} ${before[t] ?? '-'} → ${after[t] ?? '-'}`);
  const schemaLeft = await client.query(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'migration_check'`);
  if (leftovers.length || schemaLeft.rows[0].n > 0) {
    failed++;
    console.error(`오류: 샘플 데이터 또는 임시 스키마가 남았습니다: ${leftovers.join(', ')}`);
  } else {
    console.log('샘플 데이터 남음: 없음');
  }
  console.log(failed ? `결과: 실패 ${failed}건` : `결과: ${tests.length}개 파일 모두 통과`);
} catch (err) {
  failed++;
  console.error('오류:', formatError(err));
} finally {
  await client?.end().catch(() => {});
  process.exitCode = failed ? 1 : 0;
}
