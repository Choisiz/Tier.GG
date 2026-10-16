# 백엔드 현재 상태 (Overview)

> 이 문서는 백엔드의 **지금 상태만** 적는다. 진행 기록(계획·구현·검토)은 `back_spec.md`, `back_build.md`, `back_review.md`에 있다.
> 기준: 코드(`backend/src`, `test`, `package.json`), `docs/contracts/api_contract.md` **v2(문구 정정 2026-10-16)**, `docs/contracts/db_contract.md` **v8**, 수집 로그 `backend/logs/collect-2026-10-15.log`.
> 최종 확인: 2026-10-17. 다음 Review 에이전트가 덮어써서 최신으로 유지한다.

## 목차

- [1. 한눈에 보기](#1-한눈에-보기)
  - [최근 테스트 수집](#최근-테스트-수집)
  - [예약 집계 상태](#예약-집계-상태)
- [2. 폴더와 모듈 구조](#2-폴더와-모듈-구조)
- [3. 수집기](#3-수집기)
  - [3-1. 흐름](#3-1-흐름)
  - [3-2. Riot 호출 규칙](#3-2-riot-호출-규칙)
  - [3-3. 잠금, 중단, 이어서 모으기](#3-3-잠금-중단-이어서-모으기)
  - [3-4. aggregate와 purge](#3-4-aggregate와-purge)
- [4. 명령어](#4-명령어)
- [5. API](#5-api)
  - [5-1. 엔드포인트](#5-1-엔드포인트)
  - [5-2. 오류](#5-2-오류)
  - [5-3. 창과 오래됨 신호](#5-3-창과-오래됨-신호)
  - [5-4. 한 요청 = 한 스냅숏](#5-4-한-요청--한-스냅숏)
- [6. 설정값과 환경 변수](#6-설정값과-환경-변수)
- [7. 테스트](#7-테스트)
- [8. 관련 문서](#8-관련-문서)
- [9. 변경 이력](#9-변경-이력)
- [10. 해결되지 않은 점](#10-해결되지-않은-점)

---

## 1. 한눈에 보기

요약: Riot API로 KR 솔로랭크 게임을 모아 Supabase에 저장하고, 집계된 챔피언 통계를 읽기 전용 API로 준다.

| 항목 | 내용 |
|------|------|
| 역할 | ① 수집기: Riot API → 원본 테이블(`ranked_players`, `matches`, `match_players`, `collection_logs`) 저장. ② API 서버: 집계 테이블을 읽어 프론트에 JSON으로 준다 |
| 집계 | 백엔드가 하지 않는다. DB 예약 작업 `tiergg_daily_refresh`가 **매일 05:00 KST(20:00 UTC)** 에 `refresh_window_stats(14)`를 실행한다 |
| 통계 기준 | **최근 14일에 시작한 게임** 하나의 창 (패치 단위 아님) |
| 스택 | Node.js 24, TypeScript, Express 5, `pg` (ORM 없음), `tsx`로 실행 |
| 진입점 1 | API 서버 `src/server.ts` (`npm start`). Riot 키를 읽지 않고 수집 코드를 import하지 않는다 |
| 진입점 2 | 수집 CLI `src/cli/collect.ts` (`npm run collect -- <명령>`) |

### 최근 테스트 수집

요약: 2026-10-14 15:53 ~ 18:51 UTC (`collection_logs` id 25). 티어당 250명으로 약 3시간 동안 3,930게임을 저장했다. 429는 한 번도 없었다.

| 값 | 수치 |
|----|------|
| 명령 | `run --preset test --players-per-tier 250` |
| 표본 플레이어 | **765명** (플래티넘 250, 에메랄드 15 + 250, 다이아 250) |
| 게임 ID가 0개인 플레이어 | 370명 (약 48%) |
| HTTP 400으로 실패한 플레이어 | **15명** (조사 완료, 조치 없음 — `back_spec.md` 12장 V1) |
| 찾은 게임 ID / 새 게임 | 4,042 / 4,015 |
| 저장한 게임 | **3,930** (창 안 기존 45 + 3,930) |
| 건너뛴 게임 | 5분 미만 80, 창 밖 5, 실패 0 |
| Riot 호출 | **8,722회** (200 8,707 / 400 15), **429 0회**, 재시도 0 |
| 걸린 시간 | 10,707초 (**약 3시간**), 그중 제한기 대기 8,433초 |
| 패치 | 16.20, 16.19 |
| 종료 코드 | 0 |

### 예약 집계 상태

요약: DB 예약 작업이 지금까지 두 번 모두 성공했다. 화면 통계는 이 작업이 매일 새로 만든다.

| 항목 | 값 |
|------|-----|
| 작업 | `tiergg_daily_refresh` (jobid 1), `0 20 * * *` = 매일 05:00 KST. `ANALYZE` → `refresh_window_stats(14)` |
| 실행 기록 | 2026-10-14 20:00 UTC **성공**, 2026-10-15 20:00 UTC **성공** |
| 확인 방법 | `cron.job_run_details`(jobid 1)의 최근 `status`, `stats_window.aggregated_at`. API에서는 `/health`의 `stats.state`(`fresh`/`stale`/`empty`) |

---

## 2. 폴더와 모듈 구조

요약: SQL은 `repositories/`에만 있고, Riot JSON 변환은 순수 함수다. API와 수집기는 `config`·`db`·`lib`·`repositories`만 함께 쓴다.

| 경로 | 역할 |
|------|------|
| `src/server.ts` | API 서버 진입점. 풀(`max 5`) 생성, 요청마다 스냅숏 읽기, SIGINT/SIGTERM 종료 |
| `src/cli/collect.ts` | 수집 CLI 진입점. 명령 파싱, 잠금, `collection_logs`, 종료 코드 |
| `src/api/app.ts` | Express 앱 조립 (`createApp(db, logger, { now })`). GET/HEAD만, ETag·`x-powered-by` 끔 |
| `src/api/routes/meta.ts` | `/health`, `/meta` |
| `src/api/routes/champions.ts` | `/champions`, `/champions/:championId` |
| `src/api/window.ts` | `window` 객체, `displayName`(메이저 + 10), `share`, `isStale`(26시간), 503 `STATS_NOT_READY`, 오래됨 경고(1시간 1번) |
| `src/api/mainPositions.ts` | 주 포지션 최대 2개 (2순위는 10% 이상) |
| `src/api/dto.ts` | DB 줄 → 응답 필드 |
| `src/api/validate.ts` | `position`, `championId` 검사 |
| `src/api/errors.ts` | 오류 형식, 404·오류 미들웨어 |
| `src/api/cache.ts` | 성공 응답 `Cache-Control` |
| `src/collector/sample.ts` | ① 표본 뽑기 (시드 난수, page 1에서 무작위) |
| `src/collector/matches.ts` | ②~⑤ 게임 ID → 상세 → 타임라인 → 저장 |
| `src/collector/transform.ts` | Riot JSON → DB 줄 (순수 함수), 건너뛰기 판단, 스킬 순서 |
| `src/collector/runLog.ts` | 수집 잠금(`pg_try_advisory_lock`), `collection_logs` 시작·종료 |
| `src/collector/aggregate.ts` | 시험용 집계, `purge` 미리보기 |
| `src/collector/context.ts` | 단계들이 함께 쓰는 실행 문맥, 중단 오류 |
| `src/riot/client.ts` | Riot 호출 (`X-Riot-Token` 헤더), 재시도, 응답별 오류 분류 |
| `src/riot/rateLimiter.ts` | 1초·120초 이중 창 제한기 |
| `src/riot/errors.ts`, `types.ts` | Riot 오류 클래스, 응답 타입 |
| `src/repositories/rawRepository.ts` | 원본 테이블 읽기·쓰기 |
| `src/repositories/statsRepository.ts` | 집계 테이블·뷰 읽기 (`stats_window`, `champion_tier_view`, `champion_item/rune/spell/skill`) |
| `src/repositories/logRepository.ts` | `collection_logs` |
| `src/db/pool.ts` | `pg.Pool` 생성, DB 연결 오류 판단 |
| `src/db/snapshot.ts` | `REPEATABLE READ READ ONLY` 트랜잭션 1개로 읽기 |
| `src/db/tx.ts` | 트랜잭션 도우미, `Queryable` 타입 |
| `src/config/env.ts` | 환경 변수 읽기·검사 (값은 출력하지 않음) |
| `src/config/collection.ts` | 수집 프리셋, Riot 클라이언트 설정, 창 시작 계산 |
| `src/config/api.ts` | API 규칙 상수 |
| `src/lib/logger.ts` | 한 줄 로그 + 비밀값 가리기, puuid 앞 8자 |
| `test/unit`, `test/integration`, `test/fixtures`, `test/helpers` | 7장 |
| `logs/` | 사용자가 남긴 수집 로그 |

---

## 3. 수집기

요약: 표본을 뽑고, 최근 14일 게임만 받아, 게임 하나씩 트랜잭션으로 저장한다. 집계는 하지 않는다.

### 3-1. 흐름

| 단계 | 하는 일 | Riot API |
|------|---------|----------|
| 0 준비 | 수집 잠금을 잡고, 남은 `running` 기록을 `failed`로 닫고, 새 `running` 1줄. 창 시작 = 지금 − 14일을 **한 번만** 정한다. 창 안 기존 게임 수를 센다 | - |
| ① 표본 | 티어마다 디비전 I~IV의 page 1(약 205명)에서 `inactive`가 아닌 사람을 무작위로 뽑아 `ranked_players`에 upsert (더하기만). 그 티어 표본이 이미 `playersPerTier`명 이상이면 건너뜀 (`--resample`이면 다시 뽑음) | `league-v4 entries/RANKED_SOLO_5x5/{tier}/{division}?page=1` |
| ② 게임 ID | 표본 전원에게 `queue=420&start=0&count=20&startTime=<창 시작, 초>`. 이미 `matches`에 있는 ID는 뺀다. 남은 ID를 최신 먼저 정렬 | `match-v5 by-puuid/{puuid}/ids` |
| ③ 상세 | `getMatch`. 솔로랭크가 아님·5분 미만·10명 아님·창 밖·형식 오류면 건너뜀 (타임라인을 부르지 않음) | `match-v5 matches/{id}` |
| ④ 타임라인 | `getTimeline`으로 스킬 순서를 만든다 (`SKILL_LEVEL_UP`의 `NORMAL`만) | `match-v5 matches/{id}/timeline` |
| ⑤ 저장 | 게임 1개 = 트랜잭션 1개 (`matches` 1줄 + `match_players` 10줄). 이미 있으면 ROLLBACK (`duplicate`) | - |

- 끝나면 요약 로그 2줄(호출, 게임)과 "집계는 매일 05:00 KST" 안내를 남긴다.
- 창 상한: 창 안 게임이 **25,000**개에 닿으면 ③ 전에 멈춘다 (`window_full`, 기록은 `done`).

### 3-2. Riot 호출 규칙

| 항목 | 값 |
|------|-----|
| 제한기 | 1초 **19회**, 120초 **98회** (Riot 한도 20 / 100에서 여유). 모든 호출이 제한기 하나를 공유 |
| 응답 헤더 맞춤 | `X-App-Rate-Limit-Count`가 우리 셈보다 크면 그만큼 채운다 (직전 실행 사용량 반영) |
| 429 | `Retry-After`만큼(없으면 10초) 모든 호출을 멈추고 재시도, 최대 5번 |
| 5xx·네트워크 | 1·2·4초 뒤 재시도, 최대 3번. 요청 시간 초과 10초 |
| 401/403 | **키 만료로 보고 바로 멈춤** (종료 코드 2, `key_expired`) |
| 404·400 | 그 플레이어·게임만 건너뜀 |
| 연속 실패 | ②~⑤ 모두 **연속 20개** 실패하면 멈춤 (`failed`, `TooManyFailuresError`). 같은 상수(`maxConsecutiveMatchFailures`)를 공유하고, 성공하면 카운터 리셋 (변경 02) |

### 3-3. 잠금, 중단, 이어서 모으기

| 상황 | 동작 | 종료 코드 / 기록 |
|------|------|------------------|
| 정상 끝 (창 상한·`--max-matches` 포함) | - | 0 / `done` |
| 다른 수집이 실행 중 | 잠금(`hashtext('tiergg:collector')`)을 못 잡으면 바로 끝 | 3 / 기록 없음 |
| 키 만료 | 그 자리에서 멈춤. 저장한 게임은 남음 | 2 / `key_expired` |
| Ctrl+C 1번 | 지금 게임을 마치고 멈춤 (2번이면 바로 종료) | 130 / `failed` "사용자 중단", 요약 로그 `stoppedBy=aborted` |
| 잠금 연결 끊김 | 오류 로그, 지금 게임 뒤 멈춤 | 1 / `failed` "DB 연결 끊김 (수집 잠금 연결)" |
| 그 밖의 실패 (②~⑤ 연속 20개 실패 포함) | - | 1 / `failed`, 요약 로그 `stoppedBy=failed` |

- **이어서 모으기:** 같은 명령을 다시 실행하면 된다. 표본은 이미 있으면 건너뛰고, ②에서 저장된 게임을 빼고, 저장도 `ON CONFLICT`로 중복을 막는다.
- **자동 집계 없음:** 수집 결과는 다음 05:00 KST 예약 작업부터 통계에 들어간다. 바로 보려면 `aggregate`(시험용).
- **연결 오류 리스너:** `withTransaction`·`readSnapshot`에 `logger`를 넘기면(API 서버·⑤ 저장 모두 실제로 넘김) 빌린 연결의 `'error'` 이벤트를 로그로만 남겨, 문장 사이 짧은 순간 연결이 끊겨도 프로세스가 죽지 않는다 (변경 02).

### 3-4. `aggregate`와 `purge`

| 명령 | 동작 |
|------|------|
| `aggregate` | 같은 연결에서 `SET statement_timeout '5min'` → `ANALYZE matches, match_players` → `refresh_window_stats(14)` → `RESET`. 수집 잠금은 잡지 않는다. 창 안 게임이 0개(P0002)면 기존 집계를 두고 종료 코드 1 |
| `purge` | **미리보기만** (전체 게임 수, 21일보다 오래된 게임 수, 시각). 읽기만 한다 |
| `purge --yes` | 수집 잠금을 잡고 `purge_old_games(21)` 실행. **되돌릴 수 없다** |

- `aggregate`·`purge`는 `collection_logs`에 남지 않는다 (`lastCollectedAt`이 수집 시각만 뜻하게).

---

## 4. 명령어

요약: 모두 `backend/`에서 실행한다. 루트 `.env`를 `--env-file=../.env`로 읽는다.

```bash
cd backend

# 테스트 수집 (플래티넘·에메랄드·다이아 티어당 250명, 최근 14일). 약 3시간
npm run collect -- run --preset test --players-per-tier 250 2>&1 | tee logs/collect-$(date +%F).log

# 키 만료(종료 코드 2) 뒤 이어서 모으기
#   1) https://developer.riotgames.com 에서 키 재발급 → 루트 .env 의 RIOT_API_KEY 교체
#   2) 같은 명령을 다시 실행 (저장한 게임·채워진 표본은 건너뜀)
npm run collect -- run --preset test --players-per-tier 250

# 바로 집계 (시험용. 평소에는 05:00 KST 예약 작업)
npm run collect -- aggregate

# 오래된 원본 정리
npm run collect -- purge          # 미리보기만
npm run collect -- purge --yes    # 실제 삭제. 되돌릴 수 없음, 사용자 확인 뒤에만

# API 서버
npm start                         # http://localhost:4000/api/v1/health
npm run dev                       # watch 모드

# 검사
npm run typecheck
npm run lint
npm test                          # 단위 테스트 (네트워크·DB 없음)
npm run test:integration          # 통합 테스트 (실제 Supabase, 모두 ROLLBACK)
```

| 그 밖의 명령·옵션 | 하는 일 |
|-------------------|---------|
| `sample [--resample] [--seed N]` | ① 표본만 |
| `matches` | ②~⑤ 저장된 표본으로 게임만 |
| `--preset test\|main` | `test`: 플래티넘·에메랄드·다이아 **250명**. `main`: 에메랄드·다이아 200명 (자리만) |
| `--players-per-tier N` (1~1000), `--games-per-player N` (1~100), `--max-matches N`, `--tiers EMERALD,DIAMOND` | 덮어쓰기. `--tiers`는 플래티넘·에메랄드·다이아만 |

- 표본을 늘릴 때: 표본이 모자란 티어는 **모자란 만큼만** 더 뽑는다. `--resample`을 주면 `playersPerTier`명 전체를 다시 뽑아 더한다 (변경 02).

---

## 5. API

요약: GET 4개, 기본 URL `http://localhost:4000/api/v1`. 자세한 필드는 [`api_contract.md`](../../docs/contracts/api_contract.md) v2를 본다.

### 5-1. 엔드포인트

| 경로 | 하는 일 | 캐시 |
|------|---------|------|
| `GET /health` | DB 확인 + 집계 상태 `stats.state` (`fresh`/`stale`/`empty`). 집계가 오래돼도 200 | `no-store` |
| `GET /meta` | `window`, `lastCollectedAt`(마지막 `done` 수집), `positions`, `rules` | `public, max-age=600` |
| `GET /champions?position=TOP` | 그 포지션이 주 포지션인 챔피언 목록. 정렬 `tier`(null 뒤) → `tierScore` 내림 → `championId` | `public, max-age=600` |
| `GET /champions/:championId[?position=]` | 주 포지션 탭, 선택 포지션 통계, 빌드(아이템 전체, 룬·스펠·스킬 상위 2개) | `public, max-age=600` |

- 옛 `patch` 쿼리와 모르는 쿼리는 무시한다. CORS 헤더·ETag는 없다.

### 5-2. 오류

| HTTP | `code` | 언제 |
|------|--------|------|
| 400 | `INVALID_PARAMETER` | `position`이 대문자 5개 중 하나가 아님, `championId`가 `^[1-9][0-9]{0,4}$`가 아님, 잘못된 % 인코딩 |
| 404 | `STATS_NOT_FOUND` | 그 챔피언(·포지션) 통계가 창 안에 없음 |
| 404 | `NOT_FOUND` | 없는 경로, GET/HEAD 외 메서드 |
| 503 | `STATS_NOT_READY` | `stats_window`가 비어 있음 (첫 집계 전) |
| 503 | `DB_UNAVAILABLE` | DB 연결 실패 (`/health`는 모든 오류를 이 코드로 바꿈, 응답은 그대로. 서버 로그에는 `logger.error`로 원인이 남는다, 변경 02) |
| 500 | `INTERNAL_ERROR` | 그 밖. 내부 내용은 로그에만 |

- 모든 오류는 `{ error: { code, message, details? } }`, `no-store`.

### 5-3. 창과 오래됨 신호

| 신호 | 뜻 |
|------|-----|
| `window` | `days`, `start`(포함), `end`(제외), `games`, `aggregatedAt`, `isStale`, `patches[]`(최신 먼저, `displayName` = 메이저 + 10, `share` 소수 2자리) |
| `window.isStale` | 지금 − `aggregatedAt` > **26시간**이면 `true` |
| `/health` `stats.state` | `fresh` / `stale` / `empty` |
| 서버 로그 | 오래된 집계를 보면 1시간에 1번 경고 |

### 5-4. 한 요청 = 한 스냅숏

- `/meta`와 챔피언 엔드포인트는 연결 1개에서 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`를 열고 모든 읽기를 차례로 한다. 05:00 집계가 커밋되는 순간에도 분모와 개수가 섞이지 않는다.
- 첫 문장은 항상 `stats_window` 읽기다. BEGIN·ROLLBACK이 실패한 연결은 풀에 돌려주지 않고 버린다.
- `/health`는 한 문장이라 풀에 바로 묻는다.

---

## 6. 설정값과 환경 변수

요약: 환경 변수는 루트 `.env` (목록은 `.env.example`). 나머지는 코드 상수다. 값은 로그에 나오지 않는다.

### 6-1. 환경 변수

| 이름 | 기본값 | 누가 | 뜻 |
|------|--------|------|-----|
| `DATABASE_URL` | 없음 (필수) | 둘 다 | Supabase Session pooler 접속 문자열 (`postgres(ql)://`) |
| `RIOT_API_KEY` | 없음 (수집에 필수) | 수집기만 | Riot 개발 키 (24시간마다 재발급) |
| `RIOT_PLATFORM_URL` | `https://kr.api.riotgames.com` | 수집기 | league-v4 (https만) |
| `RIOT_REGION_URL` | `https://asia.api.riotgames.com` | 수집기 | match-v5 (https만) |
| `API_PORT` | `4000` | API 서버 | 1~65535 |

- `API_BASE_URL`도 `.env.example`에 있지만 프론트가 읽는 값이다 (백엔드는 쓰지 않음).

### 6-2. 수집 (`src/config/collection.ts`)

| 이름 | 값 | 뜻 |
|------|-----|-----|
| `test` 프리셋 | 플래티넘·에메랄드·다이아, 티어당 **250명** | 디비전 I~IV 63/63/62/62 (db 계약 v8과 맞춤, 변경 02) |
| `main` 프리셋 | 에메랄드·다이아, 200명 | 자리만 (본 수집 비율은 아직 안 정함) |
| `gamesPerPlayer` | 20 | ② `count` |
| `queue` | 420 | 솔로랭크 |
| `minGameDurationSec` | 300 | 5분 미만 건너뜀 |
| `windowDays` | 14 | 통계 창. DB 예약 작업과 함께 바꿔야 해서 CLI 옵션 없음 |
| `maxGamesPerWindow` | 25,000 | 창 상한 |
| `keepDays` | 21 | `purge` 기준 |
| `perSecondLimit` / `perWindowLimit` | 19 / 98 (120초) | 제한기 |
| `requestTimeoutMs` | 10,000 | 요청 시간 초과 |
| `retry5xx` / `retry429` / `default429WaitSec` | 3 / 5 / 10 | 재시도 |
| `maxConsecutiveMatchFailures` | 20 | ②~⑤ 연속 실패 상한 (변경 02에서 ②도 공유) |
| `aggregateStatementTimeout` | `5min` | `aggregate` |
| DB 풀 | 수집 CLI `max 2` (잠금 1 + 저장 1) | |

### 6-3. API (`src/config/api.ts`)

| 이름 | 값 | 뜻 |
|------|-----|-----|
| `MIN_TIER_PICK` | 50 | 표시용. 실제 티어 판정은 DB 뷰 |
| `SECONDARY_POSITION_MIN_SHARE` | 10 (%) | 2순위 주 포지션 |
| `WINDOW_DAYS` | 14 | `rules.windowDays` |
| `STALE_AFTER_HOURS` | 26 | `isStale` |
| `DETAIL_TOP_N` | 2 | 룬·스펠·스킬 개수 |
| `CACHE_MAX_AGE_SEC` | 600 | 성공 응답 캐시 |
| DB 풀 | API `max 5` | |

---

## 7. 테스트

요약: 단위 **92개**, 통합 17개. 통합 테스트는 실제 Supabase에 쓰지만 모두 ROLLBACK한다.

| 종류 | 파일 (개수) | 다루는 것 |
|------|-------------|-----------|
| 단위 | `transform.test.ts` (20) | 실제 게임 fixture 변환, 건너뛰기 이유, 밴 `-1` → NULL, 스킬 순서, 창 밖 판단 |
| 단위 | `rules.test.ts` (13) | 프리셋 250명(63/63/62/62), `divisionQuota(250-180)=70`(변경 02), `windowStart`(초), v1 규칙이 없음 |
| 단위 | `sample.test.ts` (4, 변경 02 신규) | `runSample`: 모자란 만큼만 더함, 이미 충분하면 건너뜀, `--resample`이면 전체 재샘플 |
| 단위 | `app.test.ts` (12) | 가짜 DB로 API 응답·오류·캐시 헤더·503, `/health` DB 오류 시 서버 로그 1건(변경 02) |
| 단위 | `client.test.ts` (11) | Riot 응답별 분류, 재시도, `startTime` 10자리 검사 (가짜 fetch) |
| 단위 | `rateLimiter.test.ts` (7) | 이중 창, 헤더 맞춤, 429 막기 (가짜 시계) |
| 단위 | `window.test.ts` (7) | `displayName`, `share`, 26시간 경계 |
| 단위 | `matches.test.ts` (6) | 창 상한, 창 밖, 집계 SQL을 부르지 않음, ② 연속 20개 실패→멈춤·중간 성공 시 리셋(변경 02) |
| 단위 | `runLog.test.ts` (4) | 잠금 연결 끊김에 죽지 않음, 잃은 잠금 release |
| 단위 | `db.test.ts` (4, 변경 02 신규) | `withTransaction`·`readSnapshot`: `logger` 넘기면 연결 오류가 로그로, 안 넘기면 리스너 없음 |
| 통합 | `repository.test.ts` (9) | 저장, 창 집계(과거 `p_until`), purge 미리보기, 스냅숏 읽기 전용, 수집 기록 |
| 통합 | `api.test.ts` (8) | 실제 DB + `createApp`으로 응답, `isStale`, `/health stale` |
| fixture | `test/fixtures/KR_8408851980.{match,timeline}.json` | 실제 게임 1개 (riotId·소환사 이름은 가짜 값) |

- 통합 테스트 데이터는 2021년 시각과 가짜 패치 `0.8`·`0.9`를 써서 실제 데이터와 섞이지 않는다. 05:00 KST(20:00 UTC)에는 돌리지 않는다.
- 숫자 개수는 `test(`/`it(` 수로 센 값이다.

---

## 8. 관련 문서

| 문서 | 내용 |
|------|------|
| [`docs/contracts/api_contract.md`](../../docs/contracts/api_contract.md) | API 계약 v2, 문구 정정 2026-10-16 (이 백엔드가 작성) |
| [`docs/contracts/db_contract.md`](../../docs/contracts/db_contract.md), [`.dbml`](../../docs/contracts/db_contract.dbml) | DB 계약 v8 (이 백엔드가 읽음) |
| [`back_spec.md`](./back_spec.md) | 현재 계획 (결정 사항 표 D·R·V 포함) |
| [`back_build.md`](./back_build.md) | 현재 구현 상태 |
| [`back_review.md`](./back_review.md) | 가장 최근 검토 (변경 02, PASS) |
| [`../logs/collect-2026-10-15.log`](../logs/collect-2026-10-15.log) | 최근 테스트 수집 로그 |
| [`CLAUDE.md`](../../CLAUDE.md) | 작업 규칙 (3·6·9·11장) |

- 정리 전 과정 기록(v1 계획·구현 원문, 변경 01·02 원문)은 git 기록(`87cfc78` 등)에 있다.

---

## 9. 변경 이력

요약: 1건 1줄. 자세한 내용은 git 기록(`git show 87cfc78:backend/docs/back_spec.md` 등)에 있다.

| 변경 | 날짜 | 무엇을 | 왜 | 결과 |
|------|------|--------|-----|------|
| v1 | 2026-10-14 | Riot 수집 CLI(표본 → 게임 ID → 상세·타임라인 → 게임 단위 저장 → `ANALYZE` + 패치별 집계)와 읽기 API 4개(패치 기준, 직전 패치 대체 규칙)를 처음 만듦 | DB 계약 v6에 맞춘 첫 백엔드. 예전 코드의 GET 수집·TRUNCATE·`spell1Casts` 오용을 버림 | 단위 59·통합 14 통과, 실제 3명 26게임 저장, 429 0회. 받은 게임의 57%가 보관 패치 밖이라 버려짐. 따로 Review 없이 변경 01로 넘어감 (커밋 `f62d425`) |
| 01 | 2026-10-15 | 최근 14일 창으로 전환: `startTime` 요청, `game_start_at` 저장, 수집 뒤 자동 집계 삭제(05:00 KST 예약 작업), `purge_old_games(21)`, API v2(`window`·`displayName`·`isStale`·요청당 `REPEATABLE READ` 스냅숏), `patch` 파라미터·대체 규칙 삭제 | DB v7이 패치 단위에서 14일 창 하나로 바뀌어 v1이 실제 DB에서 동작하지 않았다. 오래된 게임 상세 호출 낭비도 없애려고 | Review PASS with issues (M1 잠금 연결 끊김 고침). 단위 80·통합 17. 창 밖 버림 57% → 0%. 티어당 250명 테스트 수집 3,930게임·429 0회, 예약 작업 2회 성공 (커밋 `5c039fe`) |
| 02 | 2026-10-16 | 15명 400 원인 조사(조치 없음, V1), 표본 보충을 모자란 만큼만으로 고침(L1), 요약 로그 `stoppedBy`에 `aborted`/`failed` 추가(L2), ② 게임 ID에도 ③~⑤와 같은 연속 20개 실패 상한 공유(L3), `/health` DB 오류를 서버 로그에 남김(L4), `withTransaction`·`readSnapshot`에 선택적 `logger`로 연결 오류 리스너(L5), `test` 프리셋을 250명으로(db 계약 v8과 맞춤), `api_contract.md` 2-4 문구·6장 날짜 순서 정정 | 변경 01 Review가 남긴 L1~L5·문구 문제를 정리하고, db 계약 v8(변경 04)이 확정한 "티어당 250명"에 코드를 맞추려고 | Review PASS (문제 없음). 단위 92·통합 17, 모두 통과. DB에 쓰기 없이 읽기로만 재확인(에메랄드 265명·400 15명 그대로, V1·V2와 일치) |

---

## 10. 해결되지 않은 점

요약: 동작을 막는 문제는 없다. 변경 02에서 15명 400 조사·L1~L5·프리셋 250·계약 문구 2건을 모두 처리했다. 남은 것은 실제로 장애를 일으켜 보지 못한 시험 1건과 영향이 작은 운영 메모뿐이다.

1. **③~⑤ 게임 연속 20개 실패는 실제 Riot 장애로 시험하지 못했다.** 코드·분류 함수로만 확인했고, Riot 장애를 일부러 만들 수 없어서다. (②의 연속 실패는 가짜 Riot 클라이언트로 실제로 함수를 돌려 확인했다 — `matches.test.ts`.) 가짜 클라이언트로 ③~⑤ 쪽도 단위 테스트를 더하는 것을 권장한다.
2. **`aggregate`(시험용) 명령의 연결에는 오류 리스너가 없다.** `withTransaction`·`readSnapshot`에는 변경 02에서 리스너를 붙였지만, `collector/aggregate.ts`의 `aggregateWindowOnPool`은 여전히 `pool.connect()`를 직접 쓴다. 사람이 직접 실행하는 짧은 명령이라 위험은 작다(자동 집계는 DB 예약 작업이 SQL로 직접 함). 다음에 연결 안전성을 더 손대게 되면 같이 본다.
3. **기록만 해 둔 운영 메모.** Supabase 풀러가 `application_name`을 `Supavisor`로 바꿔 연결을 이름으로 찾을 수 없고, DB 시계가 로컬보다 약 2초 빠르다. 영향이 작아 조치 계획은 없다.
