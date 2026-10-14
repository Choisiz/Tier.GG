// 마이그레이션 실행기
//   node --env-file=../.env scripts/migrate.mjs up           아직 적용하지 않은 파일만 순서대로 적용
//   node --env-file=../.env scripts/migrate.mjs status       파일별 적용 여부, 체크섬 불일치 출력
//   node --env-file=../.env scripts/migrate.mjs fresh-check  임시 스키마에 전체 파일을 적용해 보고 항상 ROLLBACK
//
// 규칙 (db_spec 2-4)
// - 파일 이름 ^\d{3}_[a-z0-9_]+\.sql$, 이름 오름차순
// - 파일 1개 = 트랜잭션 1개. 실패하면 ROLLBACK 후 멈춤
// - 이미 적용한 파일의 체크섬이 달라졌으면 아무것도 적용하지 않고 오류로 멈춤
// - MIGRATIONS_DIR 환경 변수로 폴더를 바꿀 수 있다 (체크섬 검사 시험용)
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, formatError } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : path.resolve(here, '..', 'migrations');
const NAME_RE = /^\d{3}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 'tiergg_schema_migrations';

function loadFiles() {
  const all = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const bad = all.filter((f) => !NAME_RE.test(f));
  if (bad.length) throw new Error(`파일 이름 규칙 위반: ${bad.join(', ')}`);
  return all.map((filename) => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    return { filename, sql, checksum };
  });
}

async function ensureMetaTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.schema_migrations FROM anon, authenticated;
    COMMENT ON TABLE public.schema_migrations IS '마이그레이션 실행기 기록 (적용한 SQL 파일과 sha256 체크섬)';
  `);
}

async function loadApplied(client) {
  const exists = await client.query(`SELECT to_regclass('public.schema_migrations') AS t`);
  if (!exists.rows[0].t) return new Map();
  const { rows } = await client.query(
    'SELECT filename, checksum, applied_at FROM public.schema_migrations ORDER BY filename',
  );
  return new Map(rows.map((r) => [r.filename, r]));
}

function compare(files, applied) {
  const mismatched = files.filter((f) => applied.has(f.filename) && applied.get(f.filename).checksum !== f.checksum);
  const missing = [...applied.keys()].filter((name) => !files.some((f) => f.filename === name));
  const pending = files.filter((f) => !applied.has(f.filename));
  return { mismatched, missing, pending };
}

async function cmdStatus(client) {
  const files = loadFiles();
  const applied = await loadApplied(client);
  const { mismatched, missing } = compare(files, applied);
  for (const f of files) {
    const a = applied.get(f.filename);
    let state = '대기';
    if (a) state = a.checksum === f.checksum ? `적용됨 (${a.applied_at.toISOString()})` : '체크섬 불일치';
    console.log(`${f.filename.padEnd(40)} ${state}`);
  }
  for (const name of missing) console.log(`${name.padEnd(40)} 기록에는 있으나 파일 없음`);
  if (mismatched.length || missing.length) {
    console.error('오류: 적용된 파일이 바뀌었거나 사라졌습니다.');
    process.exitCode = 1;
  }
}

async function cmdUp(client) {
  const files = loadFiles();
  await ensureMetaTable(client);
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
  try {
    const applied = await loadApplied(client);
    const { mismatched, missing, pending } = compare(files, applied);
    if (mismatched.length || missing.length) {
      for (const f of mismatched) console.error(`체크섬 불일치: ${f.filename}`);
      for (const name of missing) console.error(`기록에는 있으나 파일 없음: ${name}`);
      console.error('오류: 적용된 파일은 수정할 수 없습니다. 변경은 새 번호 파일로 하세요. 아무것도 적용하지 않았습니다.');
      process.exitCode = 1;
      return;
    }
    if (!pending.length) {
      console.log('적용할 파일 없음');
      return;
    }
    for (const f of pending) {
      try {
        await client.query('BEGIN');
        // 함수의 SET search_path FROM CURRENT 가 이 값을 잡는다
        await client.query('SET LOCAL search_path = public, pg_catalog');
        await client.query(f.sql);
        await client.query('INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)', [
          f.filename,
          f.checksum,
        ]);
        await client.query('COMMIT');
        console.log(`적용: ${f.filename}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`실패: ${f.filename} → ROLLBACK`);
        console.error(formatError(err));
        process.exitCode = 1;
        return;
      }
    }
    console.log(`완료: ${pending.length}개 적용`);
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => {});
  }
}

async function cmdFreshCheck(client) {
  const files = loadFiles();
  const before = await client.query(
    `SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'migration_check'`,
  );
  if (before.rows[0].n > 0) throw new Error('migration_check 스키마가 이미 있습니다. 확인이 필요합니다.');
  let ok = true;
  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA migration_check');
    await client.query('SET LOCAL search_path = migration_check, pg_catalog');
    for (const f of files) {
      try {
        await client.query(`SAVEPOINT f`);
        await client.query(f.sql);
        await client.query(`RELEASE SAVEPOINT f`);
        console.log(`통과: ${f.filename}`);
      } catch (err) {
        ok = false;
        console.error(`실패: ${f.filename}`);
        console.error(formatError(err));
        break;
      }
    }
    if (ok) {
      const { rows } = await client.query(`
        SELECT
          (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'migration_check' AND c.relkind = 'r') AS tables,
          (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'migration_check' AND c.relkind = 'v') AS views,
          (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'migration_check') AS functions`);
      console.log(`임시 스키마 결과: 테이블 ${rows[0].tables}, 뷰 ${rows[0].views}, 함수 ${rows[0].functions}`);
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }
  const after = await client.query(
    `SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'migration_check'`,
  );
  console.log(`ROLLBACK 완료. migration_check 스키마 남음: ${after.rows[0].n > 0 ? '예' : '아니오'}`);
  if (!ok || after.rows[0].n > 0) process.exitCode = 1;
  else console.log(`fresh-check 통과: ${files.length}개 파일`);
}

const commands = { up: cmdUp, status: cmdStatus, 'fresh-check': cmdFreshCheck };
const cmd = process.argv[2];
if (!commands[cmd]) {
  console.error('사용법: migrate.mjs up | status | fresh-check');
  process.exit(1);
}

let client;
try {
  client = await connect();
  await commands[cmd](client);
} catch (err) {
  console.error('오류:', formatError(err));
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
