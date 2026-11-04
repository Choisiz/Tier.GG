// 환경 변수 읽기·검사. 값은 절대 출력하지 않는다 (오류 메시지에도 변수 이름만).
// 실행: node --env-file=../.env (루트 .env)
import { FEEDBACK_ENV_DEFAULTS } from './feedback.js';

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

// ───────── 게임 피드백 분석 API (back_spec 변경 05, 05-12) ─────────
// 잘못된 값은 서버를 멈추지 않고 problems에 남기고 기능을 끈다(enabled=false). 키 값은 돌려주지만 출력하지 않는다.

export interface FeedbackEnv {
  enabled: boolean;
  llmEnabled: boolean;
  /** ANTHROPIC_API_KEY. 없으면 null. 로그에는 "있음/없음"만 */
  apiKey: string | null;
  model: string;
  effort: 'low' | 'medium' | 'high';
  dailyLimit: number;
  budgetUsd: number;
  /** FEEDBACK_RAG_ENABLED (B4). 기본 false */
  ragEnabled: boolean;
  /** VOYAGE_API_KEY (RAG 질의 임베딩). 없으면 null. 로그에는 "있음/없음"만 */
  voyageKey: string | null;
  /** 잘못된 값 설명 (변수 이름만, 값 없음). 1개 이상이면 enabled=false */
  problems: string[];
}

export function loadFeedbackEnv(env: Record<string, string | undefined> = process.env): FeedbackEnv {
  const defaults = FEEDBACK_ENV_DEFAULTS;
  const problems: string[] = [];
  const get = (name: string): string | undefined => {
    const v = env[name]?.trim();
    return v ? v : undefined;
  };
  const bool = (name: string, fallback: boolean): boolean => {
    const v = get(name);
    if (v === undefined) return fallback;
    if (v === 'true') return true;
    if (v === 'false') return false;
    problems.push(`${name}은(는) true 또는 false여야 합니다.`);
    return false;
  };
  const int = (name: string, fallback: number): number => {
    const v = get(name);
    if (v === undefined) return fallback;
    if (!/^[0-9]{1,6}$/.test(v)) {
      problems.push(`${name}은(는) 0 이상 정수여야 합니다.`);
      return 0;
    }
    return Number(v);
  };
  const num = (name: string, fallback: number): number => {
    const v = get(name);
    if (v === undefined) return fallback;
    if (!/^[0-9]+(\.[0-9]+)?$/.test(v)) {
      problems.push(`${name}은(는) 0 이상 숫자여야 합니다.`);
      return 0;
    }
    return Number(v);
  };
  const enabled = bool('FEEDBACK_ENABLED', defaults.enabled);
  const llmEnabled = bool('FEEDBACK_LLM_ENABLED', defaults.llmEnabled);
  const dailyLimit = int('FEEDBACK_DAILY_LIMIT', defaults.dailyLimit);
  const budgetUsd = num('FEEDBACK_API_BUDGET_USD', defaults.budgetUsd);
  const model = get('FEEDBACK_LLM_MODEL') ?? defaults.model;
  const effortRaw = get('FEEDBACK_LLM_EFFORT') ?? defaults.effort;
  let effort: FeedbackEnv['effort'] = defaults.effort;
  if (effortRaw === 'low' || effortRaw === 'medium' || effortRaw === 'high') effort = effortRaw;
  else problems.push('FEEDBACK_LLM_EFFORT는 low, medium, high 중 하나여야 합니다.');
  const apiKey = get('ANTHROPIC_API_KEY') ?? null;
  const ragEnabled = bool('FEEDBACK_RAG_ENABLED', defaults.ragEnabled);
  const voyageKey = get('VOYAGE_API_KEY') ?? null;
  return { enabled: enabled && problems.length === 0, llmEnabled, apiKey, model, effort, dailyLimit, budgetUsd, ragEnabled, voyageKey, problems };
}
