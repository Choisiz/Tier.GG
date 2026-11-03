// 게임 피드백 분석 API 설정값 (back_spec 변경 05, 05-12). 환경 변수는 config/env.ts의 loadFeedbackEnv가 읽는다.
import { fileURLToPath } from 'node:url';

/** 분석하는 큐: 솔로랭크 420, 자유랭크 440 (사용자 결정 3) */
export const FEEDBACK_QUEUES: readonly number[] = [420, 440];
/** 이보다 짧은 판은 분석하지 않는다 (초) */
export const FEEDBACK_MIN_DURATION_SEC = 900;
/** 서버 응답 상한 (ms). 넘으면 504, 분석은 계속해 캐시에 넣는다 */
export const FEEDBACK_DEADLINE_MS = 30_000;
/** 504·busy 때 다시 누르라고 안내하는 초 */
export const FEEDBACK_RETRY_AFTER_SEC = 15;
/** LLM 호출 1번 상한과 SDK 재시도 (CLI 기본 60초·1회보다 짧게) */
export const FEEDBACK_LLM_TIMEOUT_MS = 25_000;
export const FEEDBACK_LLM_MAX_RETRIES = 0;
/** LLM 동시 실행 수와 대기열 길이 */
export const FEEDBACK_CONCURRENCY = 2;
export const FEEDBACK_QUEUE_MAX = 4;
/** Riot 제한기 대기가 이보다 길면 시작하지 않고 503 ANALYSIS_BUSY */
export const FEEDBACK_RIOT_MAX_WAIT_MS = 5_000;
/** ANALYSIS_BUSY retryAfterSec 상한 */
export const FEEDBACK_BUSY_RETRY_MAX_SEC = 60;
/** 결과 캐시 (mode="llm") */
export const FEEDBACK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FEEDBACK_CACHE_MAX = 500;
/** 템플릿 캐시 (mode="template") */
export const FEEDBACK_TEMPLATE_CACHE_TTL_MS = 10 * 60 * 1000;
export const FEEDBACK_TEMPLATE_CACHE_MAX = 200;
/** auth·billing·model_not_found 뒤 LLM을 부르지 않는 시간 */
export const FEEDBACK_BREAKER_MS = 10 * 60 * 1000;
/** API 장부에 같은 모델·프롬프트 실측이 없을 때 쓰는 입력 어림 보정 계수 (2단계 실측) */
export const FEEDBACK_DEFAULT_INPUT_FACTOR = 1.64;
/** 재시도 메시지 어림 토큰 (CLI 예상 비용 계산과 같은 값) */
export const FEEDBACK_RETRY_MSG_TOKENS = 1500;
/** 응답 meta.knowledgeVersion 자리 (RAG 전). 캐시 키에는 "none"으로 들어간다 */
export const FEEDBACK_KNOWLEDGE_VERSION: string | null = null;
/** POST 본문 크기 상한 */
export const FEEDBACK_BODY_LIMIT = '2kb';

/** API 전용 사용량 장부 (루트 .gitignore의 logs/로 git 제외). CLI 평가 장부(test/eval/usage-ledger.jsonl)와 섞지 않는다 */
export const FEEDBACK_LEDGER_PATH = fileURLToPath(new URL('../../logs/feedback-api-ledger.jsonl', import.meta.url));

/** 환경 변수 기본값 (05-12). 기본은 모두 꺼짐/보수적 */
export const FEEDBACK_ENV_DEFAULTS = {
  enabled: false,
  llmEnabled: false,
  dailyLimit: 20,
  budgetUsd: 0.25,
  model: 'claude-opus-5-5',
  effort: 'low' as const,
};

// ───────── Data Dragon (05-5 B안) ─────────
export const DDRAGON_BASE_URL = 'https://ddragon.leagueoflegends.com';
export const DDRAGON_TIMEOUT_MS = 3_000;
/** 메모리에 두는 버전 수 (넘치면 오래 넣은 것부터 지움) */
export const DDRAGON_CACHE_VERSIONS = 4;
export const DDRAGON_VERSIONS_TTL_MS = 60 * 60 * 1000;
/** 같은 경고를 다시 남기기까지 (ms) */
export const DDRAGON_WARN_INTERVAL_MS = 10 * 60 * 1000;
/** 저장소 스냅숏 (받기 실패 때 사용) */
export const DDRAGON_SNAPSHOT_PATH = fileURLToPath(new URL('../../data/ddragon/champion-tags.16.21.1.json', import.meta.url));
