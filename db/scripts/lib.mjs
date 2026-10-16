// 공통: DB 접속과 비밀값 가리기
// DATABASE_URL 값은 절대 출력하지 않는다. 오류 메시지에서도 접속 문자열·비밀번호·호스트를 가린다.
import pg from 'pg';

export function getConnectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL이 비어 있습니다. 루트 .env를 확인하세요. (node --env-file=../.env 로 실행)');
    process.exit(1);
  }
  return url;
}

function secretsToHide() {
  const url = process.env.DATABASE_URL ?? '';
  const out = [];
  if (url) out.push(url);
  try {
    const u = new URL(url);
    if (u.password) {
      out.push(u.password);
      try { out.push(decodeURIComponent(u.password)); } catch { /* 잘못된 % 인코딩: 원문만 가린다 */ }
    }
    if (u.username) {
      out.push(u.username);
      try { out.push(decodeURIComponent(u.username)); } catch { /* 위와 같음 */ }
    }
    if (u.hostname) out.push(u.hostname);
  } catch {
    /* 형식이 이상해도 전체 문자열은 가린다 */
  }
  return out.filter((s) => s && s.length >= 3).sort((a, b) => b.length - a.length);
}

export function redact(text) {
  let s = String(text ?? '');
  for (const secret of secretsToHide()) s = s.split(secret).join('***');
  return s;
}

export function formatError(err) {
  const parts = [err?.message ?? String(err)];
  if (err?.code) parts.push(`code=${err.code}`);
  if (err?.where) parts.push(`where=${err.where}`);
  if (err?.position) parts.push(`position=${err.position}`);
  return redact(parts.join(' | '));
}

export async function connect() {
  const client = new pg.Client({ connectionString: getConnectionString() });
  // 접속 오류 이벤트도 가려서 출력
  client.on('error', (err) => console.error('DB 연결 오류:', formatError(err)));
  await client.connect();
  return client;
}
