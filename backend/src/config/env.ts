// 환경 변수 읽기·검사. 값은 절대 출력하지 않는다 (오류 메시지에도 변수 이름만).
// 실행: node --env-file=../.env (루트 .env)

export class EnvError extends Error {
  override name = 'EnvError';
}

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new EnvError(`${name}이(가) 비어 있습니다. 루트 .env를 확인하세요. (node --env-file=../.env 로 실행)`);
  return v;
}

function httpsUrl(name: string, fallback: string): string {
  const v = process.env[name]?.trim() || fallback;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new EnvError(`${name} 형식이 URL이 아닙니다.`);
  }
  if (u.protocol !== 'https:') throw new EnvError(`${name}은(는) https:// 주소여야 합니다.`);
  return v.replace(/\/+$/, '');
}

export interface DbEnv {
  databaseUrl: string;
}

export function loadDbEnv(): DbEnv {
  const databaseUrl = required('DATABASE_URL');
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new EnvError('DATABASE_URL 형식이 postgresql:// 접속 문자열이 아닙니다.');
  }
  return { databaseUrl };
}

export interface RiotEnv {
  apiKey: string;
  platformUrl: string;
  regionUrl: string;
}

/** 수집 CLI 전용. API 서버는 부르지 않는다 (Riot 키를 읽지 않음). */
export function loadRiotEnv(): RiotEnv {
  const apiKey = required('RIOT_API_KEY');
  if (/\s/.test(apiKey)) throw new EnvError('RIOT_API_KEY에 공백이 있습니다.');
  return {
    apiKey,
    platformUrl: httpsUrl('RIOT_PLATFORM_URL', 'https://kr.api.riotgames.com'),
    regionUrl: httpsUrl('RIOT_REGION_URL', 'https://asia.api.riotgames.com'),
  };
}

export function loadApiPort(): number {
  const raw = process.env.API_PORT?.trim();
  if (!raw) return 4000;
  if (!/^[0-9]{1,5}$/.test(raw)) throw new EnvError('API_PORT는 1~65535 숫자여야 합니다.');
  const n = Number(raw);
  if (n < 1 || n > 65535) throw new EnvError('API_PORT는 1~65535 숫자여야 합니다.');
  return n;
}
