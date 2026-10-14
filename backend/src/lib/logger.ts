// 한 줄 로그 + 비밀값 가리기
// 형식: 시각 레벨 [영역] 메시지 key=value ...
// DATABASE_URL(전체·비밀번호·사용자·호스트)과 RIOT_API_KEY는 모든 출력에서 *** 로 가린다.

type Level = 'INFO' | 'WARN' | 'ERROR';
type Fields = Record<string, unknown>;

function decodeSafe(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    // 잘못된 % 인코딩 (db_review L1): 원문만 가린다
    return null;
  }
}

function secretsToHide(): string[] {
  const out: string[] = [];
  const url = process.env.DATABASE_URL ?? '';
  if (url) {
    out.push(url);
    try {
      const u = new URL(url);
      for (const part of [u.password, u.username]) {
        if (!part) continue;
        out.push(part);
        const decoded = decodeSafe(part);
        if (decoded) out.push(decoded);
      }
      if (u.hostname) out.push(u.hostname);
    } catch {
      // 형식이 이상해도 전체 문자열은 가린다
    }
  }
  const key = process.env.RIOT_API_KEY ?? '';
  if (key) out.push(key);
  return out.filter((s) => s.length >= 3).sort((a, b) => b.length - a.length);
}

export function redact(text: unknown): string {
  let s = String(text ?? '');
  for (const secret of secretsToHide()) s = s.split(secret).join('***');
  // 접속 문자열 모양이 남아 있으면 통째로 가린다
  s = s.replace(/postgres(?:ql)?:\/\/\S+/g, '***');
  s = s.replace(/RGAPI-[0-9a-fA-F-]+/g, '***');
  return s;
}

/** puuid는 로그에 앞 8자만 */
export function shortPuuid(puuid: string): string {
  return puuid.length > 8 ? `${puuid.slice(0, 8)}…` : puuid;
}

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    const parts = [err.message];
    const code = (err as { code?: unknown }).code;
    if (code) parts.push(`code=${String(code)}`);
    return redact(parts.join(' | '));
  }
  return redact(err);
}

function formatValue(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return /\s/.test(v) ? JSON.stringify(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v);
  return JSON.stringify(v);
}

export interface Logger {
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
}

export function createLogger(area: string, write: (line: string) => void = (l) => console.log(l)): Logger {
  const emit = (level: Level, msg: string, fields?: Fields) => {
    const kv = fields
      ? Object.entries(fields)
          .map(([k, v]) => ` ${k}=${formatValue(v)}`)
          .join('')
      : '';
    write(redact(`${new Date().toISOString()} ${level} [${area}] ${msg}${kv}`));
  };
  return {
    info: (m, f) => emit('INFO', m, f),
    warn: (m, f) => emit('WARN', m, f),
    error: (m, f) => emit('ERROR', m, f),
  };
}

/** 테스트용: 아무것도 출력하지 않는 로거 */
export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
