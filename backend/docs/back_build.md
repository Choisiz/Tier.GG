# 백엔드 구현 기록 — 수집 워커 + 챔피언 통계 API

> 기준: `backend/docs/back_spec.md` (승인됨, 변경 03 포함), `docs/contracts/api_contract.md` v3(전적 검색 추가, 2026-10-27), `docs/contracts/db_contract.md` v8
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
- [3. 사용자가 실행하는 명령](#3-사용자가-실행하는-명령)
- [4. 검증 결과](#4-검증-결과)
  - [4-1. 실제 소량 수집](#4-1-실제-소량-수집)
  - [4-2. Review 재확인](#4-2-review-재확인)
  - [4-3. 테스트 수집](#4-3-테스트-수집)
  - [4-4. 예약 작업](#4-4-예약-작업)
  - [4-5. 의존성](#4-5-의존성)
  - [4-6. 전적 검색 실제 Riot 호출 (변경 03)](#4-6-전적-검색-실제-riot-호출-변경-03)
- [5. 계획과 다른 점](#5-계획과-다른-점)
- [6. 계약 변경 요청](#6-계약-변경-요청)
- [7. 남은 문제](#7-남은-문제)

---

## 1. 요약

> 요약: 계획서 2-1의 구조대로 API 서버와 수집 CLI가 동작한다. 최근 14일 창 수집기, 시험용 집계, API v3(통계 4개 + 전적 검색)이 들어가 있다. 변경 02의 내용은 그대로 유지된다. **변경 03**: `GET /api/v1/summoners/:region/:riotId`(전적 검색)을 새로 만들었다 — account-v1·summoner-v4·league-v4·match-v5를 호출해 프로필·랭크·최근 매치 20건을 주고, API 프로세스 메모리에 60초 캐시한다. 이 때문에 API 서버가 처음으로 `RIOT_API_KEY`를 읽는다(여전히 `collector/*`는 import하지 않음). 검사·테스트 모두 통과했고, 실제 테스트 계정(`너희는개다#KR1`)으로 호출해 20개 매치를 429 없이 받았다.

| 항목 | 결과 |
|------|------|
| `npm run typecheck` (`tsc --noEmit`) | 오류 0 |
| `npm run lint` (eslint 9 + typescript-eslint 8) | 오류 0 |
| `npm test` (단위, DB·네트워크 없음) | **117개** 통과 / 실패 0 (변경 03: `summonerCache` 5, `summonerSearch` 9, `validate`(region·riotId) 2, `client`(신규 메서드) 5, `app`(`/summoners` 라우트) 4 추가) |
| `npm run test:integration` (실제 Supabase, 모두 ROLLBACK) | **17개** 통과 / 실패 0 (약 10초, 변경 03은 DB를 쓰지 않아 추가 없음). 끝난 뒤 테스트 데이터 0줄 |
| `npm audit` | **1건 발견(기존, 이 변경과 무관)**: `body-parser`(express 2.x 전이 의존성) DoS 권고. `package.json`·`package-lock.json`을 이번 변경에서 건드리지 않았고(계획 범위 밖), `npm audit fix --dry-run`으로 확인한 결과 수집 코드에 영향 없는 패치 범위 업데이트다. 조치는 메인 에이전트/사용자 판단에 맡김(4-6 참고) |
| 패치 기준 이름 `grep` (계획 10-1) | `src`·`test`에 0건 |
| 비밀값 `grep` | `backend/`, 수집·API 로그(`/tmp/tiergg-server.log` 포함), `api_contract.md`, `.env.example`에 키·접속 문자열·비밀번호 값 0건 |
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

---

## 3. 사용자가 실행하는 명령

> 요약: 모두 `backend/`에서 실행한다. 루트 `.env`를 `node --env-file=../.env`로 읽는다. 수집은 집계하지 않는다. 화면 숫자는 매일 05:00 KST에 바뀐다.

```bash
cd backend
npm install                         # 처음 한 번

# API 서버
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

---

## 5. 계획과 다른 점

> 요약: 1~14는 기존(변경 01·02)에서 Review가 받아들인 것들이다. 15~18은 변경 03에서 새로 생긴 것으로, **Review가 모두 타당하다고 확인했다**(`back_review.md` 4장, PASS with issues). 동작에 영향이 있는 것은 1번(표본 보충 방식)과 15·16·17(변경 03)이다.

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

- `docs/contracts/db_contract.*`, `db/`는 수정하지 않았다. `.env.example`에는 `API_PORT=`(값 없음, 비우면 4000)만 있다. 변경 03도 새 환경 변수가 없어 `.env.example`을 고치지 않았다.

---

## 6. 계약 변경 요청

> 요약: DB 계약 변경 요청 없음. v8의 `stats_window`, `stats_window_patch`, `champion_tier_view`, `refresh_window_stats`, `purge_old_games`, `patch_sort_key`만으로 구현했다. 경고 개수는 `collection_logs`에 컬럼이 없어 stdout 요약에만 남긴다. `api_contract.md`(백엔드가 쓰는 계약)의 2-4 문구와 6장 날짜 순서는 변경 02-8에서 고쳤다 (응답 필드·형식은 그대로). **변경 03**: `docs/contracts/api_contract.md`에 승인된 범위대로 2-5(전적 검색)를 추가하고 v3으로 올렸다(작성 영역 수정, 요청이 아님). DB 계약은 읽지도 쓰지도 않아 변경 요청 없음(W-6).

---

## 7. 남은 문제

> 요약: 동작을 막는 문제는 없다. 남은 문제는 모두 `back_overview.md`의 "해결되지 않은 점"에 번호로 정리돼 있다.

- 변경 02에서 L1~L5(표본 보충, 요약 로그 표기, ② 연속 실패 상한, `/health` 로그, 연결 오류 리스너), `test` 프리셋 250명, API 계약 문구 2건을 모두 고쳤다.
- 15명 400 플레이어: 원인을 조사해 "이전 만료 키 시기에 뽑히고 재확인 안 된 표본"으로 확인했고, 영향이 작아(② 호출 0.17%) 조치하지 않았다 (변경 02-1, 결정 V1).
- 이 문서에서 ⚠️인 항목: ③~⑤ 연속 20개 실패를 실제 Riot 장애로 시험하지 않음(가짜 riot로는 확인함).
- **(변경 03, Review 확인 완료 — `back_review.md`, PASS with issues)**
  1. `npm audit` 1건(`body-parser` DoS, high). 이번 변경과 무관한 기존 전이 의존성 확인(Review도 재확인). `package.json`은 변경 03 작업 범위 밖이라 고치지 않았다. 사용자 승인 뒤 `npm audit fix` 실행을 권장한다.
  2. ③~⑤와 같이, 전적 검색의 Riot 오류 경로(429 소진, 5xx 소진, 매치 일부 실패)는 가짜 `RiotClient`로만 확인했다. 실제 Riot 429·5xx를 일부러 일으킬 수 없어서다.
  3. 계획(W-5)에 없던 두 가지 판단 — "`RIOT_API_KEY` 없이도 서버가 켜진다"(17번)와 "표에 없는 Riot 오류는 500으로 처리한다"(16번) — 를 Review가 타당하다고 확인했다(4장).
  4. **Review가 새로 찾은 것 (M1, L1, L2)**: API 전용 제한기(10/120s:50)와 수집 CLI 제한기(19/120s:98)를 더하면 Riot 실제 한도를 넘음(운영 판단 필요), `matchListItem`이 puuid를 못 찾으면 500(매치 일부 실패와 처리가 다름), 동시 요청 시 캐시 미스 구간 중복 호출. 자세한 내용과 권장 조치는 `back_review.md` 6·7장과 `back_overview.md` 10장 참고.
