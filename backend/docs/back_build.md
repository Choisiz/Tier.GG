# 백엔드 구현 기록 — 수집 워커 + 챔피언 통계 API

> 기준: `backend/docs/back_spec.md` (승인됨, 변경 05 포함), `docs/contracts/api_contract.md` **v4**(전적 검색 2026-10-27, 킬관여·라인전 2026-10-30, 게임 피드백 분석 POST 2026-11-03), `docs/contracts/db_contract.md` v8
> 이 문서는 **지금 구현 상태만** 적는다. v1(패치 기준)·변경 01·02 구현 기록과 시도 과정은 git 기록에 남아 있다.
> 상태 표기: ✅ 완료 / ⚠️ 부분 완료 / ❌ 실패 / ⏸️ 보류

## 목차

- [1. 요약](#1-요약)
- [2. 기능별 결과](#2-기능별-결과)
  - [2-1. 공통 모듈](#2-1-공통-모듈)
  - [2-2. Riot 클라이언트](#2-2-riot-클라이언트)
  - [2-3. 변환](#2-3-변환)
  - [2-4. 수집 CLI](#2-4-수집-cli)
  - [2-5. 읽기 API](#2-5-읽기-api)
  - [2-6. 전적 검색 (변경 03)](#2-6-전적-검색-변경-03)
  - [2-7. 테스트](#2-7-테스트)
  - [2-8. 킬관여·라인전 15분 골드 (변경 04)](#2-8-킬관여라인전-15분-골드-변경-04)
  - [2-9. 게임 피드백 분석 API (변경 05)](#2-9-게임-피드백-분석-api-변경-05)
  - [2-10. 매치 상세 지표 (변경 06)](#2-10-매치-상세-지표-변경-06)
- [3. 사용자가 실행하는 명령](#3-사용자가-실행하는-명령)
- [4. 검증 결과](#4-검증-결과)
  - [4-1. 실제 소량 수집](#4-1-실제-소량-수집)
  - [4-2. Review 재확인](#4-2-review-재확인)
  - [4-3. 테스트 수집](#4-3-테스트-수집)
  - [4-4. 예약 작업](#4-4-예약-작업)
  - [4-5. 의존성](#4-5-의존성)
  - [4-6. 전적 검색 실제 Riot 호출 (변경 03)](#4-6-전적-검색-실제-riot-호출-변경-03)
  - [4-7. 킬관여·라인전 검증 (변경 04)](#4-7-킬관여라인전-검증-변경-04)
  - [4-8. 게임 피드백 분석 검증 (변경 05)](#4-8-게임-피드백-분석-검증-변경-05)
- [5. 계획과 다른 점](#5-계획과-다른-점)
- [6. 계약 변경 요청](#6-계약-변경-요청)
- [7. 남은 문제](#7-남은-문제)

---

## 1. 요약

> 요약: 계획서 2-1의 구조대로 API 서버와 수집 CLI가 동작한다. 최근 14일 창 수집기, 시험용 집계, API v3(통계 4개 + 전적 검색)이 들어가 있다. 변경 02의 내용은 그대로 유지된다. **변경 03**: `GET /api/v1/summoners/:region/:riotId`(전적 검색)을 새로 만들었다 — account-v1·summoner-v4·league-v4·match-v5를 호출해 프로필·랭크·최근 매치 20건을 주고, API 프로세스 메모리에 60초 캐시한다. 이 때문에 API 서버가 처음으로 `RIOT_API_KEY`를 읽는다(여전히 `collector/*`는 import하지 않음). 검사·테스트 모두 통과했고, 실제 테스트 계정(`너희는개다#KR1`)으로 호출해 20개 매치를 429 없이 받았다.
>
> **변경 04(킬관여·라인전 15분 골드)**: 2-5 각 매치에 `killParticipation`(정수 %, 추가 호출 0)을 합치고, 새 `GET /api/v1/matches/lane-gold`(2-6)를 만들었다. timeline에서 15분 골드만 뽑아 경기 ID별로 6시간 캐시(원본 미저장)하고, 제한기 대기가 1.5초를 넘으면 남은 ID를 `pending`(HTTP 200 + `retryAfterSec`)으로 남긴다. API 전용 제한기를 18/90으로 올렸다. 
>
> **변경 05(게임 피드백 분석 API, 2026-11-03 Build — Review 전)**: `POST /api/v1/matches/:matchId/feedback`(계약 v4 2-7)을 만들었다. Riot match·timeline 2회 → `!ai` 엔진·문장 파이프라인(import만) → 서버 메모리 캐시(LLM 7일·템플릿 10분), 진행 중 Promise 공유, 하루 상한 20(KST)·예산 $0.25 예약·동시 2+대기 4·30초 504·차단기 10분. 스위치 2개는 기본 꺼짐. 이번 Build의 **Anthropic 호출 0회**. 아래 표의 수치는 변경 05 기준이다.
>
> **변경 06(매치 상세 지표, 2026-11-03 Build)**: 2-5 `participants.team`/`enemy[]`에 10명 상세 지표 19개, 매치에 `teams` 팀 요약을 더했다(기존 필드 그대로, Riot 추가 호출 0). typecheck·lint 0, 단위 379/379. 응답 `matches` 부분 약 29 KB → 102 KB(압축 전, 20판).

| 항목 | 결과 |
|------|------|
| `npm run typecheck` (`tsc --noEmit`) | 오류 0 |
| `npm run lint` (eslint 9 + typescript-eslint 8) | 오류 0 |
| `npm test` (단위, DB·네트워크 없음) | **379개** 통과 / 실패 0 (변경 06 +6: `matchDetail` 6. 그 전 373, 변경 05 전 323 = 백엔드 164 + `!ai` 159, 변경 05 +49: `api/feedbackService` 26, `api/feedbackParts` 16, `api/feedbackRoute` 7) |
| `npm run test:integration` (실제 Supabase, 모두 ROLLBACK) | **17개** 통과 / 실패 0 (약 10초, 변경 03·04·05는 DB를 쓰지 않아 추가 없음). 끝난 뒤 테스트 데이터 0줄 |
| `npm audit` | 변경 05에서 `npm audit fix`(사용자 승인 F17) 실행: `package-lock.json`만 바뀜(typescript-eslint 8.71.2→8.72.1 등 개발 의존성 패치 범위). `body-parser`는 이미 2.4.0이라 high 경고 없음. **남은 것: moderate 11건**(eslint·typescript-eslint 쪽 `minimatch`, 개발 의존성만) — `--force`(호환 깨짐)가 필요해 하지 않음 |
| 빌드 | 해당 없음. `tsx`로 바로 실행하고 `tsc --noEmit`으로 검사하는 구조다 (결정 D1, `package.json`에 `build` 스크립트 없음). typecheck가 그 역할 |
| 전적 검색+라인전 실제 호출 (변경 04, 4-7) | 검색 1회 + lane-gold 10개 `200 OK`, `ready` 9 / `unavailable` 1 / `pending` 0, 같은 요청 재호출 **Riot 0회**(1.2ms), 오류 경로 확인. Riot 호출 약 38회, **429 0회** |
| 게임 피드백 분석 실제 호출 (변경 05, 4-8) | 기본 설정 503 `ANALYSIS_DISABLED`. `FEEDBACK_ENABLED=true`·LLM 끔: 템플릿 **200**(0.67초, Riot 2회, 다시 요청 1.6ms·Riot 0회), 70초 판 422 `too_short`, 남의 puuid 404 `participant`, 없는 판 404 `match`. Riot 약 29회, **429 0회, Anthropic 0회** |
| 패치 기준 이름 `grep` (계획 10-1) | `src`·`test`에 0건 |
| 비밀값 `grep` | `backend/`, 수집·API 로그(변경 03: `/tmp/tiergg-server.log`, 변경 04: 이번 시험 서버 로그 3개), `api_contract.md`, `.env.example`에 키·접속 문자열·비밀번호 값 0건 |
| `collector/*` import, `RIOT_API_KEY` 읽는 곳 `grep` | `src/api`·`src/server.ts`에 `collector/` import 0건. `RIOT_API_KEY`는 `src/server.ts`(변경 03, `loadRiotEnv()`)와 `src/cli/collect.ts`·`src/config/env.ts`·`src/lib/logger.ts`(가리기용)에서만 참조 |
| 테스트 수집 (`collection_logs` id 25, 기존) | 765명, **3,930게임**, Riot **8,722회**, **429 0회**, 약 3시간 |
| 예약 작업 `tiergg_daily_refresh` (기존) | 2026-10-14·10-15 20:00 UTC 두 번 성공 |
| 전적 검색 실제 호출 (`너희는개다#KR1`, 4-6) | **200 OK**, 매치 20건, Riot 호출 약 24회(account 1 + summoner 1 + league 1 + ids 1 + match 20), **429 0회**. 두 번째 호출은 1.1ms(캐시 적중) |

---

## 2. 기능별 결과

### 2-1. 공통 모듈

> 요약: 설정, DB, 로그 모듈. 두 진입점이 같이 쓴다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 환경 변수 | `src/config/env.ts`. `loadDbEnv`, `loadRiotEnv`(CLI만 부름), `loadApiPort`(기본 4000). 형식만 검사하고 값은 출력하지 않음. `RIOT_API_KEY`는 비어 있지 않은지만 본다 (형식을 엄격히 보면 잘못된 키 시험이 401까지 가지 못함) | ✅ |
| 수집 프리셋 | `src/config/collection.ts`. `test`(플래티넘·에메랄드·다이아 **250명**, 20게임, db 계약 v8과 맞춤, 변경 02-7), `main`(에메랄드·다이아 200명, 자리만). `windowDays 14`(= `WINDOW_DAYS`), `maxGamesPerWindow 25,000`, `keepDays 21`. `divisionQuota(250)` = 63/63/62/62. `windowStart(nowMs, days)` → `{ ms, sec }`. `--tiers`는 디비전 있는 티어만, `--players-per-tier` 1~1000 | ✅ |
| API 규칙 상수 | `src/config/api.ts`. 50판, 10%, `WINDOW_DAYS 14`, `STALE_AFTER_HOURS 26`, 상위 2개, max-age 600 | ✅ |
| DB 풀 | `src/db/pool.ts`. API `max 5`, CLI `max 2`. 유휴 연결 오류는 가린 뒤 로그. `isDbConnectionError`로 연결 오류 판별 | ✅ |
| 트랜잭션 | `src/db/tx.ts`. `Queryable` 타입, `withTransaction(pool, fn, logger?)`, `inTransaction(client, fn)`. `logger`를 넘기면 빌린 연결에 `'error'` 리스너를 붙여 로그만 남긴다 (변경 02-6, L5) | ✅ |
| 스냅숏 | `src/db/snapshot.ts` `readSnapshot(pool, fn, logger?)`: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` → `fn(client)` → `COMMIT` (예외면 `ROLLBACK`). BEGIN·ROLLBACK이 실패한 연결은 풀에 돌려주지 않고 버림. `logger`를 넘기면 빌린 연결에 `'error'` 리스너 (변경 02-6, L5) | ✅ |
| 로그·가리기 | `src/lib/logger.ts`. 한 줄 `시각 레벨 [영역] 메시지 key=value`. `DATABASE_URL` 전체·비밀번호(디코딩 포함, 잘못된 `%` 인코딩도 원문은 가림)·사용자·호스트, `RIOT_API_KEY`, `postgresql://…`·`RGAPI-…` 모양을 `***`로. puuid는 앞 8자만 | ✅ |

### 2-2. Riot 클라이언트

> 요약: 이중 창 제한기와 재시도·오류 분류. 응답 헤더로 직전 사용량까지 맞춘다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 제한기 | `src/riot/rateLimiter.ts`. 1초 19회 + 120초 98회, 모든 호출이 제한기 1개를 공유, 순서대로 처리. 시계(`now`, `sleep`) 주입 가능 | ✅ |
| 응답 헤더 반영 | `X-App-Rate-Limit-Count`가 우리 셈보다 크면 차이만큼 채움. `X-App-Rate-Limit`이 설정보다 작으면 서버 한도를 따름 | ✅ |
| 429 | `Retry-After`초(없으면 10초) 동안 제한기 전체를 막고 재시도, 최대 5번 | ✅ |
| 5xx·네트워크·10초 시간 초과 | 1·2·4초 재시도 3번, 그래도 실패면 `RiotRetryExhaustedError` | ✅ |
| 401/403 | `RiotKeyExpiredError`, 재시도 없음 | ✅ |
| 404 / 400 | `RiotNotFoundError` / `RiotBadRequestError` (그 게임·플레이어만 건너뜀) | ✅ |
| `startTime` | `getMatchIds(puuid, { queue, start, count, startTime })` → `&startTime={초}`. 10자리 정수가 아니면(ms, 소수) 호출 전에 `TypeError` | ✅ |
| 키 전달 | `X-Riot-Token` 헤더만. URL·로그에 없음 (단위 테스트로 확인). 오류 경로의 puuid는 앞 8자만 | ✅ |
| 사용량 로그 | 10분마다 `appCount`, `appLimit`, `methodCount` (첫 호출 때도 1번) | ✅ |

### 2-3. 변환

> 요약: `src/collector/transform.ts`. 계약 6·7장 규칙을 순수 함수로 옮겼다. 실제 게임 1번 참가자가 계약 예시 값과 정확히 같다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 미리 거르기 | `prefilterMatch`: match_id 형식 → `not_solo` → `too_short` → `not_10_players` → 패치 형식 → 시작 시각. 통과하면 `{ patch, gameStartAt }`. 타임라인 호출 전에 실행 | ✅ |
| 시작 시각 | `gameStartTimestamp` 없음·정수 아님·2020-01-01 이전 → `bad_format`, `< windowStartMs` → `out_of_window`, 통과하면 `game_start_at = new Date(…)` | ✅ |
| 패치 | `16.19.823.722` → `16.19`, `16.9.1` → `16.9` (`parsePatch`) | ✅ |
| 포지션 | `""`·없음 → NULL. 5개 밖의 값 → NULL + 경고 | ✅ |
| 밴 | `teams[].bans[]`를 `pickTurn → championId` 표로. `-1`·0 이하 → NULL. 짝 없음 → NULL + 경고 | ✅ |
| 룬 | `description`으로 핵심/보조를 찾고 없으면 `styles[0]`/`[1]`. 4개/2개가 아니면 `bad_format` | ✅ |
| 스펠·아이템 | `summoner1Id/2Id` 그대로 (`*Casts` 안 씀). `item0~5` 그대로, 빈 칸 0, `item6` 저장 안 함 | ✅ |
| `skill_order` | 타임라인 참가자를 puuid로 잇고, `SKILL_LEVEL_UP` + `NORMAL`만, `timestamp` 순, 1~4 → QWER, 그 밖의 slot은 버리고 경고. 이벤트 없으면 NULL | ✅ |
| 기타 검사 | puuid 중복·없음, 타임라인 matchId 불일치, 정수가 아닌 값 → `bad_format` | ✅ |

### 2-4. 수집 CLI

> 요약: `src/cli/collect.ts`, `src/collector/*`. `run / sample / matches / aggregate / purge` 5개 명령. 상태는 DB에만 둔다. 수집은 집계하지 않는다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 0 준비 | 잠금 전용 연결에서 `pg_try_advisory_lock(hashtext('tiergg:collector'))`. 실패하면 종료 코드 3. 남은 `running` → `failed`('비정상 종료로 남은 기록'), 새 `running` 1줄. 잠금 뒤 `windowStart(now, 14)`를 한 번 정해 `ctx.window`로 넘김 (②·③이 같은 값). `countMatchesSince(창 시작)` | ✅ |
| 잠금 연결 끊김 | `CollectorLock.acquire(pool, onLost?)`가 잠금 연결에 `'error'` 리스너를 붙여 `lost`로 표시하고 `onLost`를 1번 부름. CLI는 오류 로그(가림) + 지금 게임 뒤 멈춤 → `failed` "DB 연결 끊김 (수집 잠금 연결)", 종료 코드 1. 잃은 잠금의 `release()`는 unlock 없이 연결을 버림. `purge --yes`도 같은 리스너 (Review M1에서 고침) | ✅ |
| ① 표본 | 디비전마다 page 1에서 요청 티어·디비전과 같고 `inactive`가 아닌 사람만, 시드 있는 무작위(mulberry32). 시드 로그 (`--seed`로 재현). `ON CONFLICT (puuid) DO UPDATE`. 그 티어 표본이 `playersPerTier`명 이상이면 건너뜀, 적으면 **모자란 만큼만** 더 뽑음(`--resample`이면 전체를 다시 뽑아 더함, 변경 02-2, L1) | ✅ |
| ② 게임 ID | `queue=420&start=0&count=20&startTime={초}`. 메모리 `Map`(처음 찾은 puuid) → DB에 있는 ID 제거 → 숫자 내림차순. 400·404 플레이어는 건너뜀, ③~⑤와 같은 연속 20개 실패 상한을 공유(`riotCfg.maxConsecutiveMatchFailures`), 성공하면 리셋 (변경 02-4, L3) | ✅ |
| ③ 상세 | 미리 거르기. 창 안 게임 + 이번 저장 수 ≥ 25,000이면 ③ 전에 멈춤 (`window_full`, `done`). 걸리면 ④를 부르지 않음 | ✅ |
| ④ 타임라인 + ⑤ 저장 | 게임 1개 = 트랜잭션 1개. `INSERT … (match_id, puuid, patch, game_start_at)` `ON CONFLICT DO NOTHING` → 0줄이면 ROLLBACK(`duplicate`) → `match_players` 10줄 한 문장 INSERT → COMMIT | ✅ |
| 자동 집계 없음 | `run`·`matches`는 ①~⑤만. 끝에 로그 "집계는 매일 05:00 KST DB 예약 작업이 한다. 바로 보려면 … aggregate (시험용)" | ✅ |
| `aggregate` | `aggregateWindow(db, { days, until?, statementTimeout })`: 같은 연결에서 `SET statement_timeout '5min'` → `ANALYZE matches, match_players` → `refresh_window_stats($1)` (`until`은 통합 테스트 전용) → `RESET`. P0002면 `{ ok: false, warning }`, 종료 코드 1. 수집 잠금 안 잡음 | ✅ |
| `purge` | 미리보기(잠금 없이 읽기만): 전체 게임 수, 21일보다 오래된 게임 수, 가장 오래된·최근(`newestRemoveStartAt`) 시작 시각. `--yes`면 수집 잠금 → `SELECT purge_old_games(21)`. **`--yes`는 한 번도 실행하지 않았다** | ✅ |
| 오류 처리 | 401/403 → `key_expired`, 종료 코드 2. Ctrl+C → 지금 게임 뒤 멈춤, `failed`('사용자 중단'), 130 (두 번 누르면 바로 종료). 게임 하나의 오류(404, 400, 재시도 실패, DB 22xxx·23xxx)는 그 게임만 건너뜀, ③~⑤ 연속 20개면 `failed`. 그 밖의 오류는 가린 메시지(500자)로 `failed`, 1 | ✅ |
| 종료 기록 | `finished_at`, `players`(② 표본 수), `matches_saved`. 중간에 멈춰도 그때까지 저장한 수를 남김. `aggregate`·`purge`는 기록하지 않음 | ✅ |
| 진행·요약 로그 | 50게임마다 진행률. 끝에 2줄: 호출(수, 429, 재시도, 상태별, 제한기 대기)과 게임(`players`, `playersFailed`, `playersNoGames`, `inWindowBefore`, ID 수, 저장, 건너뜀 이유별, 경고, `stoppedBy`, 패치). `stoppedBy`의 기본값이 `'done'`으로 남아 있으면 `cli/collect.ts`의 catch 블록이 예외 종류에 따라 `'aborted'`(Ctrl+C) 또는 `'failed'`(그 밖)로 맞춘다. `collection_logs.status`는 원래부터 정확했다 (변경 02-3, L2) | ✅ |

### 2-5. 읽기 API

> 요약: `src/server.ts`, `src/api/*`. GET 4개. 통계 엔드포인트는 요청마다 스냅숏 1개로 읽는다. 숫자 변환과 반올림은 SQL에서 한다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `ApiDb`·앱 | `createApp(db, logger, { now })`. `ApiDb = Queryable + snapshot(fn)`. `server.ts`는 풀로(`readSnapshot`), 테스트는 롤백 연결로 만든다. SIGINT/SIGTERM 종료 | ✅ |
| `GET /api/v1/health` | 한 문장 `SELECT (SELECT aggregated_at FROM stats_window WHERE id = 1)` → `{status, db, stats: {state: fresh/stale/empty, aggregatedAt}}`. 항상 200, 실패하면 503 `DB_UNAVAILABLE`(응답은 그대로, catch에서 `logger.error('health DB 확인 실패', …)` 1줄을 남겨 서버 로그에서 원인을 구분할 수 있게 함, 변경 02-5, L4). `no-store` | ✅ |
| `GET /api/v1/meta` | `window`, `lastCollectedAt`(마지막 `done`), `positions`, `rules{minTierPick, secondaryPositionMinShare, windowDays, staleAfterHours}`. 스냅숏 1개 | ✅ |
| `GET /api/v1/champions` | `champion_tier_view`를 `tier NULLS LAST, tier_score DESC, champion_id`로 읽고, 주 포지션에 그 포지션이 있는 챔피언만. `positionShare`는 SQL 창 함수. 응답에 `window` | ✅ |
| `GET /api/v1/champions/:championId` | 주 포지션 탭, 선택 포지션 `stats`, 아이템 전체, 룬·스펠·스킬 상위 2개. 조합 승률 `win/pick`, 사용률 `pick/champion.pick` (SQL `round(…, 2)`). 응답에 `window` | ✅ |
| `window` 객체 | `src/api/window.ts`: `displayPatch`(메이저 + 10, 형식이 아니면 그대로 + 경고), `sharePercent`(소수 2자리), `isStale`(> 26시간), `statsState`, `windowDto`, `requireWindow`(없으면 503 `STATS_NOT_READY`) | ✅ |
| 스냅숏 읽기 | 통계 엔드포인트 3개의 모든 읽기를 `db.snapshot` 안에서 차례로 (`Promise.all` 없음). 첫 문장은 `readWindow`(`stats_window` + `stats_window_patch`를 `json_agg`로 한 문장) | ✅ |
| 오래됨 경고 | `createStaleWarner`: 요청 처리 중 `isStale`을 보면 1시간에 1번 `warn 집계가 26시간 넘게 갱신되지 않음 aggregatedAt=…` | ✅ |
| 주 포지션 | `mainPositions.ts`: pick 내림차순(같으면 이름 순) 최대 2개, 2순위는 `pick × 100 ≥ 10 × 전체`(정수 비교) | ✅ |
| 파라미터 검사 | `validate.ts`: 대문자 포지션 정확히, 챔피언 `^[1-9][0-9]{0,4}$`. 같은 이름 반복(배열)도 400. `patch` 쿼리는 읽지 않음(무시) | ✅ |
| 오류 | `{ error: { code, message, details? } }`. 400/404/503/500. `STATS_NOT_FOUND` `details`는 `{championId}` 또는 `{championId, position}`. 500은 내부 내용 없이 로그에만. GET·HEAD 외 메서드는 404 | ✅ |
| 캐시·헤더 | 성공 `public, max-age=600`, `health`·오류 `no-store` (`src/api/cache.ts`). ETag 끔, CORS 헤더 없음, `x-powered-by` 끔 | ✅ |
| 분리 | API 서버는 `collector/*`를 import하지 않음. (변경 03) `RIOT_API_KEY`는 읽는다 — 전적 검색 때문. 읽지 않던 전제는 바뀌었고 `back_overview.md` 2장이 이를 반영해야 함 | ✅ |

### 2-6. 전적 검색 (변경 03)

> 요약: `src/riot/client.ts`·`types.ts`에 메서드/필드 4개를 추가하고, `src/api/summonerCache.ts`·`summonerSearch.ts`·`routes/summoners.ts`를 새로 만들었다. `server.ts`가 `RIOT_API_KEY`를 읽어 API 전용 `RiotClient`+`RateLimiter`를 만들고 `createApp`에 주입한다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| Riot 클라이언트 확장 | `getAccountByRiotId`(account-v1, 실제 경로 `riot/account/v1/…`), `getSummonerByPuuid`(summoner-v4), `getLeagueEntriesByPuuid`(league-v4 by-puuid), `getRecentMatchIds`(match-v5 ids, 큐 필터 없음, 수집기 전용 `getMatchIds`와 별도). 기존 `getMatch` 재사용. `collector/*`는 import하지 않음 | ✅ |
| 타입 확장 | `types.ts`에 `AccountDto`, `SummonerDto`, `LeagueEntryByPuuidDto` 추가. `ParticipantDto`에 `kills/deaths/assists/totalMinionsKilled/neutralMinionsKilled/item6/individualPosition/champLevel/goldEarned/riotIdGameName/riotIdTagline/gameEndedInEarlySurrender`를 덧붙이고, 같은 팀/상대팀을 가르는 데 필요한 `teamId`도 추가(계획에 명시되지 않았지만 team/enemy 분리에 필수, 5장 참고). 수집기(`transform.ts`)는 이 필드들을 쓰지 않아 영향 없음 | ✅ |
| 캐시 | `src/api/summonerCache.ts`: Map 기반, TTL 60초, 키 `region:소문자gameName#소문자tagLine`, 최대 200개(지연 정리 + 넘치면 가장 오래 넣은 것부터 삭제), 실패 응답은 `set()`을 안 불러 캐시 안 됨 | ✅ |
| API 전용 제한기 | `config/summoner.ts` `API_RIOT_RATE_LIMIT`(1초 10회/2분 50회), 수집 CLI의 `RateLimiter`(19/98)와 별개 인스턴스. `server.ts`가 생성해 API 전용 `RiotClient`에 주입 | ✅ |
| `summonerSearch` | `src/api/summonerSearch.ts`: 캐시 조회 → account-v1 → `Promise.all([summoner-v4, league-v4])` → match-v5 ids(count 20) → 매치 상세 20건을 `Promise.all`(각 호출을 성공/실패로 감싸 전부 기다림)로 병렬 요청, 일부 실패는 그 매치만 빼고 나머지로 응답(20건 전부 실패해도 `matches: []`). 성공 시 캐시에 저장 | ✅ |
| 오류 매핑 | `RiotNotFoundError`(account-v1 404) → `ApiError(404, SUMMONER_NOT_FOUND)`. `RiotKeyExpiredError`(401/403) → `ApiError(503, RIOT_KEY_EXPIRED)` + 매 요청 로그(제한 없음). `RiotRetryExhaustedError`(429·5xx 소진) → `ApiError(502, RIOT_UNAVAILABLE)`. 그 밖(예: `RiotBadRequestError`)은 그대로 던져 오류 미들웨어가 500으로 처리 — 계획 표에는 없던 경로라 보수적으로 처리(5장) | ✅ |
| 라우트 | `src/api/routes/summoners.ts`: `GET /api/v1/summoners/:region/:riotId`. `validate.ts`의 `parseRegionParam`(`kr`만)·`parseRiotIdParam`(마지막 `-`로 분리, `tagLine` `^[0-9A-Za-z]{2,5}$`)으로 400 처리. 응답은 `no-store` | ✅ |
| DTO | `src/api/dto.ts`에 `matchListItem`(cs=분·정글 CS 합, items/trinket/keystone/summonerSpells, team/enemy 5명씩)과 `summonerSearchDto` 추가 | ✅ |
| `ApiDeps` 주입 | `app.ts`에 `summonerSearch` 필드 추가(`createApp(db, logger, { now, summonerSearch })`). 넘기지 않으면(기존 테스트) 호출 시 500 `INTERNAL_ERROR`를 주는 기본값으로 떨어져 기존 테스트가 그대로 통과 | ✅ |
| 키 없음·만료 시 서버 동작 | `server.ts`가 시작할 때 `loadRiotEnv()`가 실패하면(키 없음·공백 포함) 경고 로그만 남기고, 전적 검색 호출마다 503 `RIOT_KEY_EXPIRED`를 주는 함수로 대체한다. 챔피언 통계 API는 그대로 동작(계획에 명시된 동작은 아니지만, "이 요청만 실패하고 서버는 멈추지 않는다"는 W-5 원칙을 서버 시작 시점에도 지키려는 판단, 5장) | ✅ |

### 2-7. 테스트

> 요약: 단위 **117개**(변경 03에서 25개 추가), 통합 17개(변경 없음). 모두 고정 시각을 쓰고, 통합 테스트는 2021년 가짜 게임·가짜 패치 `0.8`·`0.9`, 가짜 ID `KR_90000000xx`, `TEST_…` puuid만 쓰며 모두 ROLLBACK한다.

| 파일 | 내용 | 상태 |
|------|------|------|
| `test/fixtures/KR_8408851980.*.json` | 실제 게임 1개. puuid → `TEST_PUUID_01…10`, `riotIdGameName`·`summonerName` → `Player01…`, `riotIdTagline` → `TEST`, `summonerId` → `TEST_SUMMONER_01…`. 타임라인은 `SKILL_LEVEL_UP`과 `info.participants`만 (570KB → 26KB). `gameStartTimestamp 1791263990514` | ✅ |
| `test/helpers/fixture.ts`, `db.ts` | 창 시작 `2026-09-30T00:00:00Z` 고정 / `fakeGames(n, { patch, startMs, firstId })`, `FAKE_UNTIL = 2021-01-15` | ✅ |
| `unit/transform.test.ts` (20) | 1번 참가자 = 계약 6-3 값 26개, `game_start_at`, 가공 입력, 시작 시각 경계(`bad_format`·`out_of_window`) | ✅ |
| `unit/rules.test.ts` (13) | 프리셋 250명 → 63/63/62/62, `divisionQuota(Math.max(0, 250-180)) = 70`(변경 02-2), 창 설정값, `windowStart().sec = 1790816400`, `mainPositions`, `validate`, 로그 가리기, v1 설정이 없음 | ✅ |
| `unit/sample.test.ts` (4, 신규) | `runSample` 가짜 riot·pool: have=180/playersPerTier=250 → 모자란 70명만, have=0 → 250명 전체, 이미 충분하면 건너뜀, `--resample`이면 전체를 다시 뽑음 (변경 02-2, L1) | ✅ |
| `unit/app.test.ts` (12) | 가짜 `ApiDb`: 집계 전 503 + `no-store`, `/health empty`, `?patch=` 무시, `snapshot` 1번·첫 쿼리 `stats_window`, 오류 형식, CORS 없음, **`/health` DB 오류 시 로그 1회**(변경 02-5, L4) | ✅ |
| `unit/client.test.ts` (11) | 401/403 재시도 없음, 429·503 재시도와 포기, 404/400, `startTime` URL·10자리 검사, 키가 URL에 없음 | ✅ |
| `unit/rateLimiter.test.ts` (7) | 창 대기, 300회 시험, 429 막기, 헤더 반영, 동시 호출 | ✅ |
| `unit/window.test.ts` (7) | `displayName`, `share` 39.98/60.02, 26시간 경계, 상태 3가지, 경고 1시간 1번 | ✅ |
| `unit/matches.test.ts` (6) | 창 상한 `window_full`, 창 밖 타임라인 0번, 집계·`ANALYZE`·`purge` SQL 없음, INSERT에 `game_start_at`, **② 연속 20개 5xx → `TooManyFailuresError`·20명만 호출, 중간에 1번 성공하면 카운터 리셋**(변경 02-4, L3) | ✅ |
| `unit/runLog.test.ts` (4) | 잠금 연결 끊김에 죽지 않고 `onLost` 1번, 잃은 잠금 release, 정상 release, 잠금 실패 시 연결 반환 | ✅ |
| `unit/db.test.ts` (4, 신규) | `withTransaction`·`readSnapshot`에 `logger`를 넘기면 빌린 연결의 `'error'` 이벤트가 로그로 남고, 안 넘기면 리스너를 붙이지 않음(기존과 같음) (변경 02-6, L5) | ✅ |
| `integration/repository.test.ts` (9) | 저장·duplicate, `countMatchesSince`, 창 집계(과거 `until`), P0002 + SAVEPOINT, purge 미리보기(`purge_old_games`는 실행 안 함), 스냅숏 `repeatable read`·`on`·쓰기 25006 거부·실패 뒤 재사용, `collection_logs` | ✅ |
| `integration/api.test.ts` (8) | 2021년 60게임(`0.8` 24, `0.9` 36) 집계 → `createApp(롤백 ApiDb, 고정 시계)`: `/health fresh`, `/meta window`, 목록·상세, `?patch=` 같은 응답, 404 2종, `aggregated_at − 27h` → `isStale`·`/health stale` | ✅ |
| ③~⑤ 연속 20개 실패 | 분류 함수와 흐름은 있으나 실제로 일으켜 시험하지 않음 (Riot 장애를 만들 수 없음). ②의 연속 실패는 가짜 riot로 시험함 (변경 02-4) | ⚠️ |
| `unit/summonerCache.test.ts` (5, 변경 03 신규) | TTL 안 적중/지나면 미스(지연 정리), 없는 키, 최대 크기 초과 시 가장 오래 넣은 것부터 삭제, 같은 키 갱신 시 순서 최신화, 실패 응답은 `set()` 안 부르면 캐시 안 됨 | ✅ |
| `unit/summonerSearch.test.ts` (9, 변경 03 신규) | 가짜 `RiotClient`로: 정상 흐름(DTO 형식, team/enemy 5명씩), 캐시 미스→적중, 캐시 키 정규화(대소문자), TTL 만료 뒤 재호출, account-v1 404→`SUMMONER_NOT_FOUND`(캐시 안 됨), 401/403→`RIOT_KEY_EXPIRED`, 429 소진→`RIOT_UNAVAILABLE`, 언랭크·최근 게임 없음은 오류 아님, 매치 상세 일부/전부 실패 시 응답 | ✅ |
| `unit/client.test.ts` (+5, 변경 03) | `getAccountByRiotId`(경로 인코딩 확인)·`getSummonerByPuuid`·`getLeagueEntriesByPuuid`·`getRecentMatchIds`의 URL·라우팅 확인, account-v1 404→`RiotNotFoundError` | ✅ |
| `unit/rules.test.ts` (+2, 변경 03) | `parseRegionParam`(`kr`만), `parseRiotIdParam`(마지막 `-`로 분리, gameName에 `-`가 있어도 안전, tagLine 2~5자 영숫자) | ✅ |
| `unit/app.test.ts` (+4, 변경 03) | `/summoners/:region/:riotId`: 가짜 `summonerSearch`로 파싱된 값 전달·`no-store` 확인, `region≠kr`→400(summonerSearch 호출 안 함), `riotId` 형식 오류→400, `summonerSearch`를 안 넘긴 `createApp`에서는 500(기존 테스트가 깨지지 않음을 함께 확인) | ✅ |

### 2-8. 킬관여·라인전 15분 골드 (변경 04)

> 요약: 2-5 매치마다 `killParticipation`을 더하고, `GET /api/v1/matches/lane-gold`를 새로 만들었다. DB·`collector/*`·`cli/collect.ts`·db 계약은 건드리지 않았다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 킬관여 | `api/dto.ts` `killParticipationPercent`: `challenges.killParticipation`(숫자) × 100 반올림, 없으면 `(kills+assists)÷팀 킬 합`, 팀 킬 합 0이면 `null`, 100 초과도 자르지 않음. `matchListItem`이 `killParticipation`으로 싣는다. `ParticipantDto.challenges?` 선택 필드 추가. 추가 Riot 호출 0 | ✅ |
| 타입 확장 | `riot/types.ts`: `ParticipantDto.challenges?`, `TimelineDto.frames[].participantFrames?`(선택 필드라 수집기 영향 없음) | ✅ |
| 경기 캐시 | `api/matchLaneCache.ts`: `{ durationSec, players[10]{participantId,puuid,teamId,position}, gold15? }`, TTL 6시간·최대 5,000개(기존 `createSummonerCache` 재사용). `gold15`는 숫자 맵 또는 `null`(계산 불가 기억). timeline 원본은 저장하지 않음 | ✅ |
| 검색 → 경기 캐시 | `summonerSearch`가 `laneCache`(선택 의존성)가 있으면 받은 매치 상세 20건의 최소 정보를 넣는다(이미 있는 항목은 덮어쓰지 않아 `gold15` 보존). 추가 호출 없음, 호출 수 24회 유지 | ✅ |
| 라인전 계산·서비스 | `api/laneGold.ts`: 순수 함수 `pairForLane`(적 팀 같은 포지션 정확히 1명), `extractGold15`(frames[15], 16프레임 미만이면 null), `gold15Result`(반올림, 0/0·값 없음 → null). 서비스 `createLaneGold`: 경기 캐시 → getMatch(없을 때만) → 호출 생략 규칙(900초 미만·포지션 없음·대상 아님) → timeline 1회 → `gold15` 저장. 진행 중 Promise 공유(getMatch·timeline 각각), 한 요청 안 5경기 병렬 | ✅ |
| 한도 정책 | `RiotClient.limiterWaitMs()`(제한기 `waitTime`을 0 이상으로)를 새 호출 시작 전에 본다. > 1.5초면 남은 새 호출은 `pending`, `retryAfterSec` = 올림(1~120). HTTP 200 | ✅ |
| 오류 매핑 | 401/403 → 503 `RIOT_KEY_EXPIRED`(매 요청 로그), 소진 → 502 `RIOT_UNAVAILABLE`, timeline/match 404 → `unavailable`(+`gold15=null` 캐시), 그 밖은 500 | ✅ |
| 라우트·검증 | `api/routes/matches.ts` `GET /matches/lane-gold`, `validate.ts` `parsePuuidParam`(`^[0-9A-Za-z_-]{1,100}$`), `parseMatchIdsParam`(1~10개 `^KR_[0-9]{1,15}$`). `no-store`. `app.ts`에 `ApiDeps.laneGold`·`opts.laneGold` 추가(안 넘기면 500, 기존 테스트 영향 없음) | ✅ |
| 조립 | `server.ts` `buildRiotServices()`가 하나의 `RiotClient`·`RateLimiter`·경기 캐시를 `summonerSearch`와 `laneGold`가 함께 쓰게 주입. 키가 없으면 두 함수 모두 503 `RIOT_KEY_EXPIRED` | ✅ |
| 제한기 값 | `config/summoner.ts` `API_RIOT_RATE_LIMIT` 10/50 → **18/90** (결정 X1). 라인전 상수 추가. 새 환경 변수 없음(`.env.example` 변경 없음) | ✅ |
| 요청 로그의 puuid | `app.ts` 요청 로그가 쿼리의 `puuid=` 값을 앞 8자로 줄임(계획에 없던 보강, 5장 20번) | ✅ |
| 운영 규칙 | 수집 CLI(19/98)와 API 서버(18/90)를 같은 키로 **동시에 돌리지 않는다**. `back_spec` 5-8·7-5에 명시 | ✅ |
| 문서·계약 | `back_spec.md`(임시 절을 5-8·7-5·9-2·10-7·12장 X1~X7·13장에 합침), `api_contract.md` 2-5 `killParticipation`·신규 2-6·3장 오류 표 문구·6장 변경 기록 1줄 | ✅ |

### 2-9. 게임 피드백 분석 API (변경 05)

> 요약: `POST /api/v1/matches/:matchId/feedback`. 새 코드는 `src/api/feedback/`(5개 파일)에 모았고, 기존 파일은 조립·라우팅·검증·오류·로그 가리기만 고쳤다. `backend/src/analysis/**`·`src/cli/**`·`test/unit/analysis/**`·`test/eval/**`는 **변경 0줄**(import만). DB·db 계약 영향 없음.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 서비스 흐름 | `api/feedback/service.ts` `createFeedbackService`: ③ 캐시(결과 → 템플릿 → 진행 중) → ④ 제한기 대기 > 5초면 503 busy → ⑤ getMatch → ⑥ 사전 검사 → ⑦ getTimeline → ⑧ 챔피언 데이터 → ⑨ `analyzeMatch` → ⑩ LLM 여부 → ⑪ 하루·예산·동시 실행 예약 → ⑫ `createFeedbackFromResult` → ⑬ 정산·DTO·캐시·로그 1줄 | ✅ |
| 사전 검사 | `precheck.ts` 순수 함수: 참가자(404 `participant`) → 큐 420·440 → 900초 이상 → 10명 포지션. 걸리면 timeline 호출 0 | ✅ |
| 오류 매핑 | getMatch 404 → 404 `match`, timeline 404·빈 프레임·`NO_FRAMES` → 422 `no_timeline`, `PLAYER_NOT_FOUND` → 404, `NO_POSITION` → 422, `MATCH_MISMATCH` → 500, 401/403 → 503 `RIOT_KEY_EXPIRED`, 재시도 소진 → 502 | ✅ |
| LLM 결과 처리 | LLM 끔·키 없음·상한 0 → 템플릿 `llm_off`(0원). auth·billing·model_not_found → 템플릿 `llm_error` + 차단기 10분(오류 로그 1번, 402는 "크레딧 소진"). rate·server·timeout·network·refusal·parse → 템플릿 `llm_error`. 첫 호출 전 `budget` → 429 | ✅ |
| 캐시·공유 | 결과 캐시 7일·500개, 템플릿 캐시 10분·200개(`createSummonerCache` 재사용). 키 `matchId|puuid|engine|prompt|knowledge(none)|model|effort`. LLM이 켜져 있으면 `llm_off` 템플릿 캐시 무시. 진행 중 Map은 리더 종료 시 삭제, 오류는 캐시 안 함 | ✅ |
| 비용 보호 | `limits.ts`: 하루 상한(KST 날짜 키, 예약 → 정산, 비용 0이면 반납, 장부로 재시작 복원), 예산(장부 합 + 예약 합 + 판당 최악 > 상한이면 429), 세마포어(2 + 대기 4, 넘치면 503 busy 15초), 차단기 | ✅ |
| 시간 제한 | 30초 넘으면 504 `ANALYSIS_TIMEOUT`(Retry-After 15). 분석 Promise는 계속 돌아 캐시에 들어가고 다시 누르면 진행 중 Promise에 붙거나 캐시 적중(추가 LLM 0). LLM 클라이언트 `timeoutMs 25,000`·`maxRetries 0` | ✅ |
| Data Dragon | `championData.ts` B안: `gameVersion` → `메이저.마이너` → `versions.json`(1시간) → `cdn/{ver}/data/ko_KR/champion.json`, 버전 최대 4개·진행 중 공유, 실패·3초 초과·버전 없음 → 스냅숏 `backend/data/ddragon/champion-tags.16.21.1.json`(fixture 복사본) + 경고 10분 1번 | ✅ |
| DTO | `dto.ts` `toFeedbackDto` 순수 함수. 금지 키(등급·점수·근거 ID·출처·모델·토큰·비용·puuid 등 18개) 재귀 검사 테스트. `keyMoments` 0~3개(엔진 index → 시각·방향) | ✅ |
| 라우트 | `routes/matches.ts` `POST /matches/:matchId/feedback`: ① 스위치(`FeedbackFn.unavailable`) → `express.json({limit:'2kb'})` → `parseMatchIdParam` → 본문 객체·`puuid` 검사 → `no-store`. `app.ts`: GET·HEAD + 이 경로의 POST만 통과, 그 밖 404. `ApiDeps.feedback`(안 넘기면 500) | ✅ |
| 오류 응답 | `errors.ts`: 새 코드 6개, `ApiError.retryAfterSec` → `Retry-After` 헤더, 본문 파싱 오류(`entity.*` 등) → 400 `details.param="body"`(값 없음) | ✅ |
| 설정 | `config/feedback.ts` 상수(계획 7-6), `config/env.ts` `loadFeedbackEnv()`(잘못된 값 → 기능 끔, 키는 "있음/없음"만 로그) | ✅ |
| 조립 | `server.ts` `buildFeedback()`: 꺼짐 → 503 함수, Riot 키 없음 → 503 함수, LLM 클라이언트는 스위치 + 키 + 가격표 모델 + 상한 > 0일 때만 생성. API 장부 `backend/logs/feedback-api-ledger.jsonl`(git 제외), 기존 API용 `RiotClient`·제한기 공유. 시작 로그 1줄 | ✅ |
| 비밀값 | `lib/logger.ts` `redact`에 `ANTHROPIC_API_KEY` 값과 `sk-ant-…` 모양 가리기 추가 | ✅ |
| 문서·계약 | `api_contract.md` v4(1장 메서드, 2장 표 7개, 2-7, 3장 오류 6개+Retry-After, 4장 캐시, 6장 기록), `.env.example` 변수 4개 + `FEEDBACK_BUDGET_USD`에 "CLI 전용", `back_spec.md` 임시 절을 5-9·6-4·7-6·9-5·10-8·11·12(F1~F21)·13장에 합침 | ✅ |
| 실제 LLM 1판 | ✅ 2026-11-03 메인 에이전트 확인: 포트 4100, `FEEDBACK_API_BUDGET_USD=0.50`(프로세스 환경만), `너희는개다#KR1` 솔랭 `KR_8444003131`(27.7분). 200 `mode:"llm"` 19.6초(1차 9/11 통과, 2칸 재시도 통과, 템플릿 0), 금지 필드 없음. 같은 요청 반복 2.8ms·Riot 0·LLM 0. 장부 2줄(1차+재시도) 합 $0.120055 = 로그 `costUsd`, `today=1/20`, 장부 git 제외 확인. Riot 3회(검색 1 + 분석 2). 실제 비용이 예상($0.07)보다 큰 것은 재시도 2칸 때문 | ✅ |
| 장부 복원 실패 대비 (Review L1) | `server.ts` `buildFeedback`: API 장부를 못 읽으면(깨진 줄 등) 서버 전체를 멈추지 않고 오류 로그 1줄 + 분석만 503 `ANALYSIS_DISABLED`. Review가 고침, typecheck·lint 0·단위 372/372·실제 서버로 확인 | ✅ |

### 2-10. 매치 상세 지표 (변경 06)

> 요약: `src/api/dto.ts`·`src/riot/types.ts`만 고쳤다. Riot 호출 수·캐시·2-0~2-4·2-6·2-7 응답은 바뀌지 않는다. `src/analysis/**`·피드백 파일 변경 0줄.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 참가자 상세 | `sideDto(p, myPuuid, participants)`에 `isMe`·`teamPosition`(없으면 null)·`champLevel`·`kills`·`deaths`·`assists`·`killParticipation`(기존 함수 재사용)·`damageTaken`·`goldEarned`·`cs`·`visionScore`·`wardsPlaced`·`wardsKilled`·`controlWardsPlaced`·`items`·`trinket`·`summonerSpells`·`keystone`·`subStyle`(없으면 null). 선택 지표가 빠지면 0 | ✅ |
| 팀 요약 | `teamSummary(teamId, match)` (export): `win`(teams[].win, 없으면 참가자 win), 킬·골드 합, objectives `tower`·`inhibitor`·`dragon`·`baron`·`riftHerald`·`horde`(없으면 0), `bans`(-1 제외). `matchListItem`에 `teams: { team, enemy }` | ✅ |
| 타입 | `ParticipantDto`에 선택 필드 5개, `TeamDto`에 `win?`·`objectives?`(`ObjectiveDto`). 수집기 영향 없음 | ✅ |
| 테스트 | `test/unit/matchDetail.test.ts` 6개: isMe 1명, 필드 매핑, subStyle null·누락 0, 팀 합계·objectives·방향, bans -1 제외, horde·objectives 없음 → 0 | ✅ |
| 응답 크기 | fixture 2판(KR_8408851980·KR_8437852704)을 번갈아 20판, `matchListItem`만 JSON 직렬화: **29,349 B → 102,359 B** (판당 1,467 → 5,118 B, 압축 전) | ✅ |
| 계약 | `api_contract.md` 2-5 예시·필드 표, 6장 기록 1줄(v4 작은 추가, 기존 관례) | ✅ |

---

## 3. 사용자가 실행하는 명령

> 요약: 모두 `backend/`에서 실행한다. 루트 `.env`를 `node --env-file=../.env`로 읽는다. 수집은 집계하지 않는다. 화면 숫자는 매일 05:00 KST에 바뀐다.

```bash
cd backend
npm install                         # 처음 한 번

# API 서버 (게임 분석: FEEDBACK_ENABLED=true FEEDBACK_LLM_ENABLED=false npm start 로 0원 템플릿 모드)
npm start                           # http://localhost:4000/api/v1/health (포트는 .env 의 API_PORT, 비우면 4000)
npm run dev                         # watch 모드

# 테스트 수집 (플래티넘·에메랄드·다이아, 최근 14일). 티어당 250명으로 약 3시간
npm run collect -- run --preset test --players-per-tier 250 2>&1 | tee logs/collect-$(date +%F).log

# 키 만료(로그 "Riot 키 만료(401/403)", 종료 코드 2) 뒤 이어서 모으기
#   1) https://developer.riotgames.com 에서 키 재발급 → 루트 .env 의 RIOT_API_KEY 교체
#   2) 같은 명령을 다시 실행 (저장한 게임·채워진 표본은 건너뜀)

# 바로 집계해서 보기 (시험용. 평소에는 05:00 KST 예약 작업)
npm run collect -- aggregate        # 창 안 게임 0개면 종료 코드 1, 기존 집계 유지

# 오래된 원본 정리
npm run collect -- purge            # 미리보기만 (21일보다 오래된 게임 수)
npm run collect -- purge --yes      # purge_old_games(21) 실제 삭제. 되돌릴 수 없음, 사용자 승인 뒤에만

# 검사
npm run typecheck
npm run lint
npm test                            # 단위 (DB·네트워크 없음)
npm run test:integration            # 실제 Supabase, 모두 ROLLBACK. 05:00 KST(20:00 UTC)에는 돌리지 않는다
```

| 그 밖의 명령·옵션 | 하는 일 |
|-------------------|---------|
| `sample --preset test [--resample] [--seed N]` | 표본만 (`--resample`은 다시 뽑아 더함) |
| `matches --preset test` | 저장된 표본으로 게임만 |
| 공통 옵션 | `--max-matches N`, `--players-per-tier N`, `--games-per-player N`, `--tiers EMERALD,DIAMOND`, `--seed N` |

- 종료 코드: 0 정상, 1 실패(`aggregate`의 P0002, 잠금 연결 끊김, ②~⑤ 연속 20개 실패 포함), 2 키 만료, 3 다른 수집이 실행 중, 130 사용자 중단(Ctrl+C).
- 표본이 모자란 티어는 모자란 만큼만 더 뽑는다 (변경 02-2). `--resample`을 주면 `--players-per-tier`명 전체를 다시 뽑아 더한다.

---

## 4. 검증 결과

> 요약: 실제 Riot API와 Supabase로 소량 수집, 이어 모으기, 잠금, 잘못된 키, Ctrl+C, 연결 끊김, 집계, API v2, 테스트 수집, 예약 작업까지 확인했다.

### 4-1. 실제 소량 수집

> 요약: Build가 에메랄드 15명으로 45게임을 모았다. 모든 게임이 창 안이고, `startTime`은 10자리 초로 나갔고, 수집은 집계를 부르지 않았다.

| 확인 | 결과 |
|------|------|
| 수집 | 에메랄드 표본 15명, **45게임** 저장(`match_players` 450줄, 10줄이 아닌 게임 0). 두 번째 실행에서 이미 저장한 15게임을 건너뜀. Riot 120회 + 잘못된 키 1회, 429 0회 |
| 창 | `startTime` 10자리 초. 모든 `game_start_at`이 `[실행 시작 − 14일, 실행 시작)` 안. `out_of_window` 0개 (v1 방식에서는 받은 게임 57%가 `old_patch`로 버려졌다) |
| 집계 전 API | `/health` 200 `stats.state = empty`, 나머지 3개 503 `STATS_NOT_READY` + `no-store` (실제 `readSnapshot` 경로) |
| `aggregate` | `ANALYZE` 26ms + `refresh_window_stats(14)` 191ms, `games 45` (16.20 36 / 16.19 9) |
| API v2 | 4개 엔드포인트 형식 일치, `displayName` 26.20·26.19, `share` 80 / 20, `isStale false`, `?patch=` 무시, 오류 400/404 `details`, 동시 20요청 정상, 서버 로그 `WARN`·`ERROR` 0 |
| `purge` 미리보기 | `totalGames=45 removeGames=0` (`--yes` 실행 안 함) |
| 잘못된 키 | `RIOT_API_KEY=invalid`(프로세스 환경에만) → Riot 1회 401 뒤 바로 멈춤, 종료 코드 2, `key_expired`, 원본 그대로 |

### 4-2. Review 재확인

> 요약: Review가 Build 기록을 믿지 않고 다시 확인했다. Riot 호출 10회, 429 0회.

| 확인 | 결과 |
|------|------|
| Riot 원본 대조 | 저장된 3게임을 다시 받아 백엔드 변환 코드 없이 따로 계산 → **30명 × 24컬럼 = 720개 값 모두 같음** (`EVOLVE` 빠짐, `-1` 밴 NULL 포함) |
| API 값 검사 | 목록 5개 + 상세 142개를 DB 값으로 따로 계산 → **8,929개 검사 통과** |
| 스냅숏 | 상세 150요청 동시 중 `pg_stat_activity` 262번 조회: 모든 통계 문장이 `REPEATABLE READ READ ONLY` 트랜잭션 안, 쓰기 없음 |
| 잠금 | 다른 연결이 잠금을 잡은 동안 `matches` → 종료 코드 3, 기록 없음 |
| Ctrl+C | 종료 코드 130, `failed` "사용자 중단", 반쪽 게임 없음 |
| 잠금 연결 끊김 | 수정 전 프로세스가 바로 죽음(M1) → 수정 후 `pg_terminate_backend`로 끊어도 종료 코드 1, `failed` "DB 연결 끊김 (수집 잠금 연결)", `running` 0줄, 원본 그대로 |
| DB 접속 불가 (시작 때) | 종료 코드 1, 호스트 `***` |

### 4-3. 테스트 수집

> 요약: 2026-10-14 15:53 ~ 18:51 UTC (`collection_logs` id 25). 로그 `backend/logs/collect-2026-10-15.log`.

| 값 | 수치 |
|----|------|
| 명령 | `run --preset test --players-per-tier 250` |
| 표본 | **765명** (플래티넘 250, 에메랄드 15 + 250, 다이아 250), seed `1211456601` |
| 게임 ID 0개 플레이어 | 370명 (약 48%) |
| ② HTTP 400으로 실패한 플레이어 | 15명 (원인 추정은 `back_overview.md` 해결되지 않은 점 1) |
| 찾은 ID / 새 ID | 4,042 / 4,015 |
| 저장 | **3,930게임** (창 안 기존 45 + 3,930) |
| 건너뜀 | `too_short` 80, `out_of_window` 5, 실패 0, 경고 0 |
| Riot 호출 | **8,722회** (200 8,707 / 400 15), **429 0회**, 재시도 0 |
| 시간 | 10,707초 (약 3시간), 그중 제한기 대기 8,433초 |
| 패치 | 16.20, 16.19 |
| 종료 | 코드 0, `done` |

### 4-4. 예약 작업

| 항목 | 값 |
|------|-----|
| 작업 | `tiergg_daily_refresh` (jobid 1), `0 20 * * *` (매일 05:00 KST): `SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);` |
| 실행 | 2026-10-14 20:00 UTC, 2026-10-15 20:00 UTC **두 번 성공** |
| 확인 방법 | `SELECT status, return_message, start_time FROM cron.job_run_details WHERE jobid = 1 ORDER BY start_time DESC LIMIT 1`, 그리고 `stats_window.aggregated_at` |

### 4-5. 의존성

| 패키지 | 버전 | 종류 |
|--------|------|------|
| `express` | 5.3.0 | 실행 |
| `pg` | 8.23.1 | 실행 |
| `typescript` | 5.9.3 | 개발 |
| `tsx` | 4.23.15 | 개발 |
| `@types/node` / `@types/express` / `@types/pg` | 24.19.2 / 5.0.6 / 8.23.1 | 개발 |
| `eslint` / `@eslint/js` | 9.39.5 | 개발 |
| `typescript-eslint` | 8.71.2 | 개발 |

- 계획서 8장에 없는 패키지는 없다. `npm audit`에 1건(아래 참고, 이번 변경과 무관).
- **`npm audit` 참고**: `body-parser`(express 2.x의 전이 의존성) DoS 권고 1건(high)이 있다. `package.json`·`package-lock.json`은 이번 변경에서 손대지 않았고(변경 03 작업 범위 밖), `npm audit fix --dry-run`으로 확인한 결과 `body-parser 2.3.0 → 2.4.0`·`qs`·`fsevents` 패치 범위 업데이트뿐이라 안전해 보인다. 실제 `npm audit fix` 실행은 범위 밖이라 하지 않았다 — 메인 에이전트/사용자 판단 필요 (7장).

### 4-6. 전적 검색 실제 Riot 호출 (변경 03)

> 요약: 루트 `.env`의 `RIOT_API_KEY`로 API 서버를 띄우고 테스트 계정 `너희는개다#KR1`(KR)로 실제 호출했다. 호출 수·429·오류 경로·캐시 동작을 모두 확인했다.

| 확인 | 결과 |
|------|------|
| 서버 기동 | `node --env-file=../.env --import tsx src/server.ts` → 경고 로그 없음(키 정상 로드), `RIOT_API_KEY 없음` 경고가 뜨지 않음 |
| `GET /api/v1/summoners/kr/너희는개다-KR1` (캐시 미스) | **200 OK**, 2598ms. `summoner`(gameName·tagLine·profileIconId·summonerLevel), `leagues`(`RANKED_SOLO_5x5` SILVER I, `RANKED_FLEX_SR` SILVER II 2개), `matches` **20건** |
| `matches[]` 형식 | 모든 매치에 `matchId/gameStartAt/gameDurationSec/win/championId/individualPosition/kills/deaths/assists/cs/goldEarned/items(6)/trinket/summonerSpells(2)/keystone/participants.team(5)/enemy(5)` — `api_contract.md` 2-5와 일치 |
| 같은 요청 재호출 (캐시 적중) | **1.1ms** (2번째), **1.0ms**(3번째). 서버 로그에 `소환사 검색 캐시 적중` 1줄, Riot 재호출 없음 |
| Riot 호출 수 | 캐시 미스 1건 = account 1 + summoner 1 + league 1 + ids 1 + match 20 = **24회**. 로그의 `Riot 사용량 appCount=1:120,1:1 calls=1`은 10분 주기 관찰 로그(첫 호출 시점 1번)로, 실제 24회는 서버 프로세스가 끝나기 전 요약을 따로 남기지 않아 호출 횟수 로그 자체로는 안 보임 — `matches.length === 20`과 `skipped=0` 로그로 24회가 모두 성공했음을 확인 |
| 429 | **0회** |
| `region≠kr` (`na`) | `400 INVALID_PARAMETER` |
| `riotId` 형식 오류(`noDash`) | `400 INVALID_PARAMETER` |
| 존재하지 않는 소환사 (`존재하마는이름일둥이#ZZ9`) | `404 SUMMONER_NOT_FOUND`, `details.gameName`·`details.tagLine` 포함 |
| 기존 엔드포인트 영향 확인 | `GET /api/v1/meta` 그대로 200, `window` 정상 — 전적 검색 추가가 기존 통계 API에 영향 없음 |
| 비밀값 | 서버 로그(`/tmp/tiergg-server.log`)에 `RGAPI-`·`postgresql://` 패턴 `grep` 0건 |

- Riot 호출은 이 확인 1회(캐시 미스 1건, 24회)뿐이다. 추가로 오류 경로 확인 3건은 모두 400/404라 Riot을 부르지 않거나(파라미터 오류) 캐시된 account-v1 404 결과(존재하지 않는 계정, 캐시 안 됨이라 매번 1회만 호출)라 Riot 호출 총량은 수십 회 이내다.

### 4-7. 킬관여·라인전 검증 (변경 04)

> 요약: 임시 포트 4100에 API 서버를 따로 띄워(기존 4000/3000 서버는 건드리지 않음) 실제 Riot으로 확인하고 종료했다. Riot 호출은 약 38회, 429는 0회.

| 확인 | 결과 |
|------|------|
| 검색 `GET /summoners/kr/너희는개다-KR1` (캐시 미스) | **200**, 2.8초, 매치 20건. 모든 매치에 `killParticipation`. 70초·251초 게임은 팀 킬 0이라 `null`, 나머지는 14~73 정수 (예 KR_8437852704 = 50). 호출 24회 |
| `GET /matches/lane-gold` 10개 (첫 호출) | **200**, 0.99초, `ready` 9 / `unavailable` 1(70초 게임, timeline 호출 생략) / `pending` 0, `retryAfterSec` null, `Cache-Control: no-store`. 로그 `riotCalls=9`(timeline 9, 검색이 경기 정보를 넣어 둬 getMatch 0) `cacheHits=1` |
| 손계산 | KR_8437852704(서폿): 내 3,958 : 상대 4,661 → `3958×100÷8619 = 45.9` → **46**. 계획 04-3의 15분 `totalGold` 예시(참가자 5 = 3958, 참가자 10 = 4661)와 일치 |
| 같은 요청 재호출 | **Riot 호출 0회** (`riotCalls=0 cacheHits=10`), 1.2ms, 응답 바이트 동일 |
| 서버 재시작 후 2개 요청 (경기 정보 캐시 없음) | 200, 469ms, `riotCalls=4`(getMatch 2 + timeline 2), 값은 위와 같음 (46, 53) |
| 입력 오류 | `matchIds=KR_1,NA_2` → 400, `matchIds` 누락 → 400 (`INVALID_PARAMETER`, details 포함) |
| 잘못된 키(`RIOT_API_KEY`를 프로세스 환경에만 바꿈, `.env`는 그대로) | 503 `RIOT_KEY_EXPIRED`, 서버는 계속 동작, 오류 로그 1줄 |
| 요청 로그 | `GET /api/v1/matches/lane-gold?puuid=8AcDYcY9…&matchIds=…` (puuid 앞 8자) |
| 비밀값 | 서버 로그 3개에 `RGAPI-` + 16진수 패턴 0건 |
| `pending` 경로 | 실제 Riot 한도를 일부러 넘길 수 없어 가짜 `limiterWaitMs`로만 확인(단위 테스트). 한도 18/90 아래의 실제 동작은 위 호출 규모에서는 대기가 없었다 |
| 서버 종료 | 시험한 서버는 모두 종료(4100 포트 비어 있음). 기존 4000/3000은 건드리지 않았다. **기존 4000 서버는 코드 변경 반영을 위해 재시작이 필요하다** |

### 4-8. 게임 피드백 분석 검증 (변경 05)

> 요약: 임시 포트 4100에 서버를 따로 띄워 확인하고 종료했다(4000은 떠 있지 않았고 건드리지 않음). LLM 스위치는 실행 환경 변수로 `FEEDBACK_LLM_ENABLED=false`를 명시했다. Riot 약 29회(검색 24 + 분석 5), 429 0회, **Anthropic 0회**. `.env`는 고치지 않았다.

| 확인 (완료 기준 10-8) | 결과 |
|------|------|
| #1 단위·라우트 | `npm test` **372/372** (기존 323 + 49) |
| #2 검사 | `typecheck` 0, `lint` 0, `test:integration` **17/17** |
| #3 `!ai` 경계 | `git diff --stat -- src/analysis src/cli test/unit/analysis test/eval` → 0줄 |
| #4 import·env | `@anthropic-ai/sdk` import는 `analysis/llm/client.ts`만(테스트 문자열 1건 제외). `process.env`는 `config/env.ts`·`cli/`와 기존 `lib/logger.ts`(비밀값 가리기용, 이번에 `ANTHROPIC_API_KEY` 1줄 추가)만 |
| #5 기본 설정 | `FEEDBACK_ENABLED` 비움 → 시작 로그 `enabled=false`, POST → **503 `ANALYSIS_DISABLED`**. 이 경우 `buildFeedback`이 LLM 클라이언트·장부를 만들기 전에 반환 |
| #6 템플릿 모드 실제 Riot | 시작 로그 `enabled=true llm=off(FEEDBACK_LLM_ENABLED=false) … budget=$0.25 spent=$0.0000 today=0/20 key=있음`. 검색 `너희는개다#KR1` 1회 뒤: `KR_8441587549`(솔랭 1754초) → **200** `mode:"template"`·`templateReason:"llm_off"`, 0.67초, `riotCalls=2`, Data Dragon 16.21.1(경고 없음). 같은 요청 → 200, 1.6ms, `cache=template_hit`, 바이트 동일. `KR_8437911448`(70초) → **422** `too_short`(Riot 1회, timeline 0). 남의 puuid → **404** `participant`(Riot 1회). `KR_1` → **404** `match`. 계약 2-7 모양과 일치. 자유/일반 판은 테스트 계정 최근 20판이 모두 420이라 실제로는 못 봤고 큐 422는 단위 테스트(450·400)로 확인 |
| #7 응답 금지 키 | DTO 재귀 테스트 + 실제 응답에 puuid 0건, 등급·점수·모델·토큰·비용 키 없음 |
| #9 비밀값 | 서버 로그 2개·응답·문서에 키 값 없음(`WARN`/`ERROR` 0줄). 로그 puuid는 `8AcDYcY9…`(앞 8자). LLM 꺼짐이라 API 장부 파일은 생기지 않음 |
| #10 문서 | 계약 v4, `.env.example` 4개, 이 문서 2-9 |
| #8 실제 LLM 1판 | ✅ 2026-11-03 메인 에이전트 확인: 포트 4100, `FEEDBACK_API_BUDGET_USD=0.50`(프로세스 환경만), `너희는개다#KR1` 솔랭 `KR_8444003131`(27.7분). 200 `mode:"llm"` 19.6초(1차 9/11 통과, 2칸 재시도 통과, 템플릿 0), 금지 필드 없음. 같은 요청 반복 2.8ms·Riot 0·LLM 0. 장부 2줄(1차+재시도) 합 $0.120055 = 로그 `costUsd`, `today=1/20`, 장부 git 제외 확인. Riot 3회(검색 1 + 분석 2). 실제 비용이 예상($0.07)보다 큰 것은 재시도 2칸 때문 |

실제 템플릿 응답 예 (줄임):

```json
{"matchId":"KR_8441587549","championId":62,"position":"JUNGLE","role":"JUNGLE_DAMAGE","win":true,"mode":"template","templateReason":"llm_off",
 "summary":{"text":"라인전은 비슷했고, 오브젝트 싸움은 보통이었고, 그 밖의 운영은 보통이었습니다. 23.5분 킬 5개가 난 싸움 뒤 골드 격차가 3,851 벌어졌습니다."},
 "sections":{"laning":{"good":[{"subjectId":"laning.kda","text":"…"}],"bad":[{"subjectId":"laning.gold","text":"15분 골드가 상대 자르반 4세보다 53 적었습니다."}],"note":null},
             "fight":{"good":[…2개],"bad":[],"note":null},"macro":{"good":[…2개],"bad":[{"subjectId":"macro.vision","text":"분당 시야 점수가 0.48로 낮았습니다."}],"note":null}},
 "keyMoments":[{"startSec":1407.1,"endSec":1440.5,"direction":"widened","text":"…"}, …3개],
 "meta":{"engineVersion":"2026-11-02.2","promptVersion":"2026-11-03.1","knowledgeVersion":null,"championDataVersion":"16.21.1","generatedAt":"2026-11-03T06:27:01.041Z"}}
```

### 4-9. 개인 키 전환과 전체 재수집 (2026-11-04, 코드 변경 없음)

> 요약: 개발 키(24시간 만료) → Riot 개인 키로 바꾸고, 옛 데이터를 모두 지운 뒤 다시 모았다. 로그 `backend/logs/collect-2026-11-04.log`.

- 이유: PUUID는 앱(키)마다 다르게 암호화된다. 개인 키(새 앱)로는 저장된 표본 PUUID가 `400 Exception decrypting`이라 표본부터 다시 뽑아야 했다. 옛 게임(9/30~10/14)은 14일 창 밖이라 통계에 쓰이지 않았다.
- 삭제(사용자 승인, 한 트랜잭션): `purge_old_games(14)` 3,975게임(match_players CASCADE), `DELETE FROM ranked_players` 765명. 집계 표는 남겨 두었다가 재집계로 교체.

| 값 | 수치 |
|----|------|
| 명령 | `caffeinate -i npm run collect -- run --preset test --players-per-tier 500` |
| 표본 | **1,500명** (플래티넘·에메랄드·다이아 각 500), seed `1883923805` |
| 게임 ID 0개 플레이어 | 825명 (55%) |
| 찾은 ID / 새 ID | 6,961 / 6,922 |
| 저장 | **6,800게임** (2026-10-20 ~ 11-03), 실패 0 |
| 건너뜀 | `too_short` 115, `out_of_window` 7, 경고 0 |
| Riot 호출 | **15,234회** (모두 200), 429 0회, 재시도 0 |
| 시간 | 18,734초 (약 5.2시간), 그중 제한기 대기 14,727초 |
| 패치 | 16.21, 16.20 |
| 집계 | `aggregate` 성공: 창 안 6,788게임(패치 16.21), 아이템 20,646 · 룬 4,480 · 스킬 3,830 · 주문 1,856행 |
| DB 크기 | 96MB(옛 데이터) → **103MB** |

---

## 5. 계획과 다른 점

> 요약: 1~14는 기존(변경 01·02)에서 Review가 받아들인 것들이다. 15~18은 변경 03에서 새로 생긴 것으로, **Review가 모두 타당하다고 확인했다**(`back_review.md` 4장, PASS with issues). 동작에 영향이 있는 것은 1번(표본 보충 방식)과 15·16·17(변경 03)이다. 19~23은 변경 04에서 새로 생긴 것이다. 24~30은 변경 05에서 새로 생긴 것으로 Review가 타당하다고 확인했고, 31은 Review가 고친 것이다.

| # | 계획 | 구현 | 이유 |
|---|------|------|------|
| 1 | 표본이 "있으면" ①을 건너뜀 | 그 티어 표본이 `playersPerTier`명 **이상**이면 건너뜀. 적으면 **모자란 만큼만** 더 뽑음(`--resample`이면 전체를 다시 뽑아 더함) | 검증용 몇 명만 남은 티어가 그 몇 명으로만 수집되는 것을 막으려고. 처음엔 "모자란 만큼"이 아니라 전원을 더해 에메랄드가 265명이 됐었는데(L1), 변경 02-2에서 고쳤다 |
| 2 | 건너뛰기 이유 5개 | `duplicate`(다른 실행이 먼저 저장)를 로그 집계에 추가 | ⑤의 ROLLBACK 경우를 셀 이름. DB 영향 없음 |
| 3 | 종료 코드 0/1/2/130 | 잠금 실패에 **3** 추가 | "다른 수집이 실행 중"을 실패와 구별 |
| 4 | `collection_logs`는 실행마다 | `run`, `sample`, `matches`만 기록 | `meta.lastCollectedAt`이 수집 시각만 뜻하게 |
| 5 | 폴더 구조 | `collector/context.ts`, `api/cache.ts`, `test/helpers/` 추가 | 같은 코드를 여러 곳에 두지 않으려고 |
| 6 | 제한기 | 429 처리에 더해 응답 헤더로 셈과 한도를 맞춤 | 직전 실행 사용량을 반영해 429를 막는다 |
| 7 | fixture는 puuid만 가짜 값 | riotId·소환사 이름·summonerId도 가짜 값 | 실제 사용자 식별 정보를 저장하지 않으려고 |
| 8 | 상세 404 | 포지션 줄이 없으면 `details.position` 포함, 챔피언 줄이 없으면 `{championId}`만 | 계약 2-4 오류 표 두 줄을 구분 |
| 9 | 오래됨 경고는 `server.ts` | `api/window.ts` `createStaleWarner`를 라우트가 부름 | "요청 처리 중 보면" 규칙을 지키고 단위 테스트하기 쉽게 |
| 10 | `createApp(db)` | `createApp(db, logger, { now })` | `isStale`을 고정 시계로 시험 |
| 11 | P0002 확인 | SAVEPOINT → `aggregateWindow` → `ROLLBACK TO SAVEPOINT` 뒤 비교 | P0002가 트랜잭션을 멈추므로 |
| 12 | `purge` 미리보기 항목 | `newestRemoveStartAt` 추가, 미리보기는 잠금 없이 | 삭제 범위 확인용, 수집 중에도 볼 수 있게 |
| 13 | `windowDays` | `config/api.ts` `WINDOW_DAYS`를 수집 설정과 `meta.rules`가 함께 씀 | 같은 값을 두 곳에 두지 않으려고 |
| 14 | 통합 테스트 | `countMatchesSince`, 스냅숏 쓰기 거부(25006)·실패 뒤 연결 재사용 시험 추가. `stats_window`를 직접 지우는 시험은 만들지 않음 | 창 상한 SQL과 ROLLBACK 경로 확인. 롤백이어도 `DELETE` 문을 쓰지 않으려고 |
| 15 (변경 03) | `ParticipantDto`에 추가할 필드 목록(kills·deaths 등 11개) | 목록에 없던 `teamId`도 함께 추가 | 같은 팀/상대팀을 가르는 데 꼭 필요하다(5명씩 team/enemy로 나누려면 팀 구분값이 있어야 함). 참가자 순서(0~4/5~9)로 추정하는 방법보다 실제 Riot 필드를 쓰는 쪽이 더 안전 |
| 16 (변경 03) | 오류 매핑 표에 없는 Riot 오류(예: `RiotBadRequestError`) | `summonerSearch`가 그대로 던져 오류 미들웨어가 500 `INTERNAL_ERROR`로 처리 | 계획 표(W-5)는 account-v1 404·401/403·429/5xx 소진만 다뤘다. 나머지는 "예상 못한 오류"로 보고 보수적으로 500 처리(서버가 죽지 않음) |
| 17 (변경 03) | 서버가 `RIOT_API_KEY` 없이 켜질 때의 동작 | 계획에 명시되지 않아, 경고 로그만 남기고 전적 검색만 503 `RIOT_KEY_EXPIRED`로 응답하는 함수로 대체(서버는 계속 켜짐) | W-5의 "이 요청만 실패하고 서버는 멈추지 않는다" 원칙을 시작 시점에도 지키려는 판단. 개발 키가 24시간마다 만료되므로, 키가 없다고 챔피언 통계 API까지 막히면 안 된다고 봤다. 계획과 다른 선택이라 Review 확인 필요 |
| 18 (변경 03) | account-v1 실제 경로 | `account/v1/…`가 아니라 **`riot/account/v1/…`** (Riot 실제 API 경로) | 계획 W-2 표의 경로 표기가 줄여 쓴 것으로 보여, 실제 Riot Account-V1 API 문서/호출 경로를 그대로 썼다. 실제 호출로 확인(4-6) |
| 19 (변경 04) | `RiotClient`에 getter 1개 | `limiterWaitMs()`는 제한기 `waitTime`이 대기가 없을 때 음수(`blockedUntil − now`)를 돌려주는 것을 0으로 올려 반환 | 단위 테스트에서 걸러진 값. 호출자는 `> 1500`만 본다 |
| 20 (변경 04) | 요청 로그 형식은 계획에 없음 | `app.ts` 요청 로그가 쿼리의 `puuid` 값을 앞 8자로 줄임 (결정 X7) | lane-gold는 puuid가 쿼리에 있어 기존 로그가 전체 puuid를 남겼다 (로그 규칙 위반) |
| 21 (변경 04) | 호출 생략 시 `gold15`를 캐시하는지 불명확 | 생략(포지션 없음·참가자 아님)일 때는 `gold15`를 **캐시하지 않고**, 프레임 부족·404일 때만 `null`로 캐시 | 같은 경기의 다른 참가자는 라인전 대상일 수 있다 |
| 22 (변경 04) | getMatch 404 처리 | 빈 정보 + `gold15=null`을 6시간 캐시 | 모르는 경기 ID를 반복 요청해도 Riot을 다시 부르지 않게 |
| 23 (변경 04) | `puuid` 길이 | 계약 초안(100자)을 따름 (계획 본문 78자와 불일치) | 계약 문구가 기준 |
| 24 (변경 05) | ① 스위치가 ② 입력 검사보다 먼저 | `FeedbackFn.unavailable` 속성으로 라우트가 본문 파싱 전에 503/500 응답 (F19) | 함수 하나 주입(W7) 구조를 지키면서 순서를 맞추려고 |
| 25 (변경 05) | "잘못된 값 → 기능을 끈다" | 분석 기능 전체를 끔(503). `FEEDBACK_DAILY_LIMIT=0`은 오류가 아니라 템플릿 `llm_off` (F20) | 보수적 해석. 0은 의도적 설정 |
| 26 (변경 05) | `keyMoments` 0~2개 | **0~3개** (F21, 메인 에이전트 확인) | 설계 최대 3개, 세나 판 3개. 구현은 엔진·LLM 결과를 그대로 옮긴다 |
| 27 (변경 05) | 최악 비용 계산식 미기재 | CLI `estimateCost`와 같은 식(재시도 입력 = 1차 입력 + 3,000 + 1,500). CLI 파일을 import하지 않고 같은 식을 서비스에 둠 | CLI 모듈 import를 피함(`cli/**` 경계). 세나 판 $0.216 |
| 28 (변경 05) | 응답 시간 상한의 가짜 시계 | 테스트는 `deadlineMs`를 20ms로 주입하고 LLM을 붙잡아 504를 만든다(가짜 시계 대신) | 실제 타이머로 더 단순·결정적 |
| 29 (변경 05) | 로그 | 분석 로그에 `outcome`(오류 코드)·`championDataSource` 추가 | 오류 원인·스냅숏 사용 여부를 로그로 보려고 |
| 30 (변경 05) | `package.json`·lock 변경 없음 | `npm audit fix`로 lock만 바뀜(F17) | 승인됨 |
| 31 (변경 05, Review) | 장부 읽기 실패 처리 없음 | 시작 때 장부 복원 실패 → 분석만 503 (Review L1) | 장부 한 줄이 깨지면 API 서버 전체가 켜지지 않았다 |

- `docs/contracts/db_contract.*`, `db/`는 수정하지 않았다. 변경 03·04는 새 환경 변수가 없었다. 변경 05는 `.env.example`에 `FEEDBACK_ENABLED`·`FEEDBACK_LLM_ENABLED`·`FEEDBACK_DAILY_LIMIT`·`FEEDBACK_API_BUDGET_USD`(값 없음)를 더했다.

---

## 6. 계약 변경 요청

> 요약: DB 계약 변경 요청 없음. v8의 `stats_window`, `stats_window_patch`, `champion_tier_view`, `refresh_window_stats`, `purge_old_games`, `patch_sort_key`만으로 구현했다. 경고 개수는 `collection_logs`에 컬럼이 없어 stdout 요약에만 남긴다. `api_contract.md`(백엔드가 쓰는 계약)의 2-4 문구와 6장 날짜 순서는 변경 02-8에서 고쳤다 (응답 필드·형식은 그대로). **변경 03**: `docs/contracts/api_contract.md`에 승인된 범위대로 2-5(전적 검색)를 추가하고 v3으로 올렸다(작성 영역 수정, 요청이 아님). DB 계약은 읽지도 쓰지도 않아 변경 요청 없음(W-6). **변경 05**: `api_contract.md`를 v4로 올렸다(2-7 POST, 1장 메서드 규칙, 오류 코드 6개). DB 계약·`!ai` 변경 요청 없음.

---

## 7. 남은 문제

> 요약: 동작을 막는 문제는 없다. 남은 문제는 모두 `back_overview.md`의 "해결되지 않은 점"에 번호로 정리돼 있다.

- 변경 02에서 L1~L5(표본 보충, 요약 로그 표기, ② 연속 실패 상한, `/health` 로그, 연결 오류 리스너), `test` 프리셋 250명, API 계약 문구 2건을 모두 고쳤다.
- 15명 400 플레이어: 원인을 조사해 "이전 만료 키 시기에 뽑히고 재확인 안 된 표본"으로 확인했고, 영향이 작아(② 호출 0.17%) 조치하지 않았다 (변경 02-1, 결정 V1).
- 이 문서에서 ⚠️인 항목: ③~⑤ 연속 20개 실패를 실제 Riot 장애로 시험하지 않음(가짜 riot로는 확인함).
- **(변경 05, Review 완료 — `back_review.md`, PASS with issues, 실제 LLM 1판 ⏸️)** Review가 L1(장부가 깨지면 서버가 안 켜짐)을 고쳤다. 실제 LLM 1판은 Riot 키 만료로 보류. 아래 1·5번과 Review의 L2~L4는 `back_overview.md` 10장으로 옮겼다.
- **(변경 05, Build 직후 기록)**
  1. **기본 예산 $0.25로는 실제 LLM 분석이 사실상 1번만 가능하다.** 판당 최악 비용을 약 $0.216 예약하므로, API 장부 합이 약 $0.034를 넘으면 다음 분석부터 429 `budget`이다(Review 1판 약 $0.07 뒤에는 모두 429). 화면 공개 전 `FEEDBACK_API_BUDGET_USD`를 올려야 한다(사용자 판단).
  2. 실제 LLM 경로(10-8 #8)는 Review에서 1판만 확인한다(승인 뒤). Build는 가짜 LLM으로만 시험했다.
  3. 자유랭크(440)·일반 판의 실제 422 `queue`는 테스트 계정 최근 20판이 모두 솔랭이라 실제로 보지 못했다(단위 테스트로 확인).
  4. 템플릿 문장에 조사 오류가 보인다(예 "3로", `!ai` 템플릿 몫). 문장 품질은 `!ai`가 별도로(F18).
  5. 504 뒤 백그라운드 분석은 하루 자리를 계속 쥐고 끝까지 돈다(`generateTexts`에 취소 신호 없음, 계획 5-9-9 참고 1).
  6. 프론트(타임아웃 35초, 버튼 표시 조건, 오류 문구)는 `!프론트` 몫이다.
- **(변경 04, Build 직후 — Review 전)**
  1. 수집 CLI(19/98)와 API 서버(18/90)를 **같은 키로 동시에 돌리면** Riot 실제 한도(20/100)를 넘는다. 운영 규칙(동시에 돌리지 않음)으로만 막고 코드로 막지 않는다 (X1). `back_overview.md` 해결되지 않은 점 1번과 같은 문제.
  2. `pending`(한도 초과) 경로와 Riot 429·5xx 소진 경로는 가짜 클라이언트로만 시험했다. 실제 한도를 일부러 넘기지 않았다.
  3. 검색의 `getMatch` 상세 캐시(24회 → 4회)는 하지 않았다(X4). 같은 소환사를 60초 뒤 다시 검색하면 24회가 다시 든다 (라인전은 0회).
  4. 기존에 떠 있는 4000 포트 API 서버는 이전 코드로 동작 중이다. 새 엔드포인트를 쓰려면 재시작이 필요하다.
  5. 프론트는 이번 Build에서 건드리지 않았다. `pending` 재시도(최대 3번)·10개씩 2번 요청은 `!프론트` 몫이다.
- **(변경 03, Review 확인 완료 — `back_review.md`, PASS with issues)**
  1. `npm audit` 1건(`body-parser` DoS, high). 이번 변경과 무관한 기존 전이 의존성 확인(Review도 재확인). `package.json`은 변경 03 작업 범위 밖이라 고치지 않았다. 사용자 승인 뒤 `npm audit fix` 실행을 권장한다.
  2. ③~⑤와 같이, 전적 검색의 Riot 오류 경로(429 소진, 5xx 소진, 매치 일부 실패)는 가짜 `RiotClient`로만 확인했다. 실제 Riot 429·5xx를 일부러 일으킬 수 없어서다.
  3. 계획(W-5)에 없던 두 가지 판단 — "`RIOT_API_KEY` 없이도 서버가 켜진다"(17번)와 "표에 없는 Riot 오류는 500으로 처리한다"(16번) — 를 Review가 타당하다고 확인했다(4장).
  4. **Review가 새로 찾은 것 (M1, L1, L2)**: API 전용 제한기(10/120s:50)와 수집 CLI 제한기(19/120s:98)를 더하면 Riot 실제 한도를 넘음(운영 판단 필요), `matchListItem`이 puuid를 못 찾으면 500(매치 일부 실패와 처리가 다름), 동시 요청 시 캐시 미스 구간 중복 호출. 자세한 내용과 권장 조치는 `back_review.md` 6·7장과 `back_overview.md` 10장 참고.
