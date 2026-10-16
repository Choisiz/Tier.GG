# 백엔드 계획서 — 수집 워커 + 챔피언 통계 API

> 상태: **승인됨** (v1 2026-10-14, 변경 01 2026-10-15, 변경 02 2026-10-16)
> 읽는 계약: `docs/contracts/db_contract.md`, `docs/contracts/db_contract.dbml` **v8** (최근 14일 기준, 변경 04: 룬 보조 정렬·수집 범위 티어당 250명)
> 작성하는 계약: `docs/contracts/api_contract.md` **v2** (문구 정정 2026-10-16)
> 이 문서는 **지금 계획만** 적는다. 패치 기준이던 v1 계획과 변경 01·02 원문은 git 기록(`87cfc78`, 변경 02는 이 Build 커밋 이전)에 남아 있다.

## 목차

- [1. 개요](#1-개요)
  - [1-1. 하는 것](#1-1-하는-것)
  - [1-2. 하지 않는 것](#1-2-하지-않는-것)
- [2. 구조](#2-구조)
  - [2-1. 폴더 구조](#2-1-폴더-구조)
  - [2-2. 진입점 2개](#2-2-진입점-2개)
  - [2-3. 공유 모듈](#2-3-공유-모듈)
- [3. 수집 워커](#3-수집-워커)
  - [3-1. 하위 명령](#3-1-하위-명령)
  - [3-2. 단계별 흐름](#3-2-단계별-흐름)
  - [3-3. 창 시작 시각과 시작 시각 검사](#3-3-창-시작-시각과-시작-시각-검사)
  - [3-4. 창 상한](#3-4-창-상한)
  - [3-5. 중복 제거와 이어서 모으기](#3-5-중복-제거와-이어서-모으기)
  - [3-6. 오류와 중단 처리](#3-6-오류와-중단-처리)
  - [3-7. 제한기](#3-7-제한기)
  - [3-8. aggregate와 purge](#3-8-aggregate와-purge)
  - [3-9. 테스트 수집 규모](#3-9-테스트-수집-규모)
- [4. Riot에서 DB로 변환 규칙](#4-riot에서-db로-변환-규칙)
- [5. API 설계](#5-api-설계)
  - [5-1. 공통 규칙](#5-1-공통-규칙)
  - [5-2. window 객체](#5-2-window-객체)
  - [5-3. 집계 멈춤 표시](#5-3-집계-멈춤-표시)
  - [5-4. 한 요청은 한 스냅숏](#5-4-한-요청은-한-스냅숏)
  - [5-5. 집계 전 응답](#5-5-집계-전-응답)
  - [5-6. 프론트 사용 방식에 맞춘 점](#5-6-프론트-사용-방식에-맞춘-점)
- [6. 오류 처리와 로깅](#6-오류-처리와-로깅)
- [7. 설정값](#7-설정값)
- [8. 의존성](#8-의존성)
- [9. 테스트 전략](#9-테스트-전략)
- [10. 완료 기준](#10-완료-기준)
  - [10-5. 변경 02 (L1~L5, 계약 문구, 프리셋)](#10-5-변경-02-l1l5-계약-문구-프리셋)
- [11. 계약 변경 요청](#11-계약-변경-요청)
- [12. 결정 사항](#12-결정-사항)
- [13. 작업 범위](#13-작업-범위)

---

## 1. 개요

> 요약: Riot API에서 최근 14일 솔로랭크 게임을 모아 DB에 넣는 **수집 명령어**와, DB가 집계한 결과를 프론트에 주는 **읽기 API**를 만든다. 집계는 DB 예약 작업이 한다.

### 1-1. 하는 것

| # | 항목 | 설명 |
|---|------|------|
| 1 | 수집 CLI | 표본 플레이어 → 게임 ID(최근 14일) → 게임 상세·타임라인 → DB 저장. 명령어로 직접 실행 |
| 2 | Riot 클라이언트 | 1초 20회 + 2분 100회 이중 제한, 429 재시도, 401/403 즉시 중단 |
| 3 | 변환 | Riot JSON → `matches` 1줄 + `match_players` 10줄. 계약 6·7장 규칙 그대로 |
| 4 | 시험용 집계 | `aggregate`: `ANALYZE` → `refresh_window_stats(14)`. 평소에는 DB 예약 작업이 매일 05:00 KST에 한다 |
| 5 | 원본 정리 | `purge`: 미리보기, `--yes`일 때만 `purge_old_games(21)` |
| 6 | 읽기 API | 상태 확인, 메타(창 정보), 포지션별 티어리스트, 챔피언 상세(포지션 + 빌드) |
| 7 | 테스트 | 변환·제한기·규칙 단위 테스트, 실제 Supabase에서 ROLLBACK하는 통합 테스트 |
| 8 | 계약 | `docs/contracts/api_contract.md` v2 |

### 1-2. 하지 않는 것

| 항목 | 이유 |
|------|------|
| 수집 뒤 자동 집계 | DB 예약 작업 `tiergg_daily_refresh`가 매일 05:00 KST에 집계한다 (결정 U3) |
| 본 수집 (에메랄드 이상, 14일 창 최대 25,000게임) | 테스트 뒤 다시 정한다. `main` 프리셋은 자리만 있다 |
| 마스터 이상 리그 API (`masterleagues` 등) | 본 수집 범위. 테스트는 디비전이 있는 티어만 |
| 스케줄러(자동 수집) | 개발 키가 24시간마다 만료된다. 수집은 사람이 직접 실행한다 |
| HTTP로 수집 실행 | 예전 실수. 수집은 CLI로만 하고, API는 읽기 전용이다 |
| 전적 검색, SSE 새로고침, AI 피드백 | 이후 단계 |
| DB 스키마 변경 | `!db` 영역. 필요하면 11장 "계약 변경 요청"에 적는다 |
| 이름·이미지 | 백엔드는 숫자 ID만 준다. 이름·이미지는 프론트가 Data Dragon으로 |
| 예전 코드의 GET 수집, 실행마다 TRUNCATE, `spell1Casts`를 소환사 주문으로 쓰기 | 예전 백엔드(`0234719`)의 실수. 다시 하지 않는다. 이중 창 제한기 아이디어만 가져왔다 |

---

## 2. 구조

> 요약: 한 코드베이스에 실행 진입점 2개(API 서버, 수집 CLI)를 두고, 설정·DB·저장소 모듈을 함께 쓴다.

### 2-1. 폴더 구조

```
backend/
├── docs/                       # back_spec(계획), back_build(구현), back_review(검토), back_overview(현재 상태)
├── logs/                       # 사용자가 남긴 수집 로그 (*.log는 git 제외)
├── package.json                # scripts: dev, start, collect, typecheck, lint, test, test:integration
├── tsconfig.json               # strict, module NodeNext, noEmit (tsx로 실행)
├── eslint.config.mjs           # @eslint/js + typescript-eslint 권장 규칙
├── src/
│   ├── server.ts               # 진입점 1: API 서버. 풀로 ApiDb를 만든다
│   ├── cli/collect.ts          # 진입점 2: 수집 CLI (run / sample / matches / aggregate / purge)
│   ├── config/
│   │   ├── env.ts              # 환경 변수 읽기·검사 (값은 출력하지 않음)
│   │   ├── collection.ts       # 수집 프리셋(test, main), Riot 클라이언트 설정, windowStart()
│   │   └── api.ts              # API 규칙 상수 (WINDOW_DAYS, STALE_AFTER_HOURS 등)
│   ├── db/
│   │   ├── pool.ts             # pg Pool, 연결 오류 판별, 오류 메시지 가리기
│   │   ├── tx.ts               # withTransaction, inTransaction, Queryable 타입
│   │   └── snapshot.ts         # readSnapshot: REPEATABLE READ READ ONLY 트랜잭션 1개
│   ├── riot/
│   │   ├── rateLimiter.ts      # 이중 창 제한기 (시계 주입 가능)
│   │   ├── client.ts           # fetch + 제한기 + 재시도 + 오류 분류
│   │   ├── errors.ts           # RiotKeyExpiredError, RiotNotFoundError, RiotBadRequestError, RiotRetryExhaustedError
│   │   └── types.ts            # 사용하는 필드만 정의한 응답 타입
│   ├── collector/
│   │   ├── transform.ts        # 순수 함수: match + timeline → MatchRow + 10 PlayerRow (또는 건너뛸 이유)
│   │   ├── sample.ts           # ① 표본 플레이어
│   │   ├── matches.ts          # ②~⑤ 게임 ID, 상세, 타임라인, 저장, 창 상한
│   │   ├── aggregate.ts        # aggregateWindow (시험용), planPurgeGames (미리보기)
│   │   ├── runLog.ts           # 수집 잠금(CollectorLock), collection_logs 시작·종료
│   │   └── context.ts          # 단계들이 함께 쓰는 실행 문맥, 중단 오류
│   ├── repositories/
│   │   ├── rawRepository.ts    # ranked_players upsert, matches/match_players 저장, 이미 있는 ID, countMatchesSince, purgePreview
│   │   ├── logRepository.ts    # collection_logs
│   │   └── statsRepository.ts  # readWindow, tierRows, tierRowsForChampion, champion_item/rune/spell/skill 읽기
│   ├── api/
│   │   ├── app.ts              # createApp(db, logger, { now }) — 테스트에서 롤백 연결·고정 시계를 넣을 수 있게
│   │   ├── routes/meta.ts      # GET /api/v1/health, /api/v1/meta
│   │   ├── routes/champions.ts # GET /api/v1/champions, /api/v1/champions/:championId
│   │   ├── window.ts           # window 객체, displayName, share, isStale, 503, 오래됨 경고
│   │   ├── validate.ts         # position, championId 검사 (직접 작성)
│   │   ├── errors.ts           # ApiError, 오류 응답 형식, 오류 미들웨어
│   │   ├── mainPositions.ts    # 주 포지션 최대 2개 규칙
│   │   ├── cache.ts            # Cache-Control 헤더 한 곳
│   │   └── dto.ts              # DB 줄 → 응답 DTO
│   └── lib/logger.ts           # 한 줄 로그 + 비밀값 가리기, puuid 앞 8자
└── test/
    ├── fixtures/               # KR_8408851980.match.json / .timeline.json (실제 게임, 개인 정보는 가짜 값)
    ├── helpers/                # fixture.ts(고정 창 시작), db.ts(fakeGames, 2021년 가짜 게임)
    ├── unit/                   # 네트워크·DB 없음
    └── integration/            # 실제 Supabase, 모두 ROLLBACK
```

### 2-2. 진입점 2개

> 요약: API 서버와 수집 CLI는 따로 실행한다. 둘 다 루트 `.env`를 `node --env-file=../.env`로 읽는다.

| 진입점 | 명령 (backend/에서) | 하는 일 | DB |
|--------|---------------------|---------|-----|
| API 서버 | `npm run dev` (watch) / `npm start` | 읽기 API만. Riot 키를 읽지 않고 수집 코드를 import하지 않는다 | 읽기만 |
| 수집 CLI | `npm run collect -- <하위 명령> [옵션]` | Riot 호출, 저장, 시험용 집계, 정리 | 읽기·쓰기 |

- API 서버는 `RIOT_API_KEY`가 없어도 켜진다. 수집 CLI는 없으면 바로 종료한다.

### 2-3. 공유 모듈

> 요약: 두 진입점이 같은 설정·DB·저장소 코드를 쓴다. 저장소 함수는 연결(`Queryable`)을 인자로 받아 테스트에서 롤백할 수 있다.

| 모듈 | 핵심 규칙 |
|------|-----------|
| `config/env.ts` | `DATABASE_URL`, `RIOT_API_KEY`, `RIOT_PLATFORM_URL`, `RIOT_REGION_URL`, `API_PORT`(기본 4000)를 읽고 형식만 검사한다. 값은 절대 출력하지 않는다 |
| `db/pool.ts` | `pg.Pool` 1개 (API `max 5`, CLI `max 2` = 잠금 1 + 저장 1). Session pooler 연결 수 한도를 넘지 않게 한다 |
| `db/tx.ts` | `withTransaction(pool, fn)`: `BEGIN` → fn → `COMMIT`, 예외면 `ROLLBACK` |
| `db/snapshot.ts` | `readSnapshot(pool, fn)`: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` → fn → `COMMIT`. BEGIN·ROLLBACK이 실패한 연결은 풀에 돌려주지 않고 버린다 |
| `api/app.ts` | `ApiDb = Queryable + snapshot(fn)`. 서버는 `snapshot = fn => readSnapshot(pool, fn)`, 테스트는 롤백 연결로 `snapshot = fn => fn(client)` |
| `riot/client.ts` | 키는 `X-Riot-Token` 헤더로만 보낸다 (URL에 넣지 않음). 모든 호출이 제한기를 거친다 |
| `collector/transform.ts` | DB·네트워크 없는 순수 함수. 단위 테스트의 중심 |
| `repositories/*` | SQL은 여기에만 둔다. 모든 값은 `$n` 매개변수. `numeric`·`bigint`는 SQL에서 `::int`/`::float8`로 바꾸거나 `dto.ts`에서 `Number()` |

---

## 3. 수집 워커

> 요약: ① 표본 → ② 최근 14일 게임 ID → ③ 상세 → ④ 타임라인 → ⑤ 한 게임씩 트랜잭션 저장. **집계는 하지 않는다.** 다시 실행하면 이미 저장한 게임은 건너뛰고 이어서 모은다.

### 3-1. 하위 명령

> 요약: 보통은 `run` 하나만 쓰고, 나머지는 단계별로 돌리거나 시험·정리할 때 쓴다.

| 명령 | 단계 | 설명 |
|------|------|------|
| `run --preset test` | ①~⑤ | 기본 흐름. 표본이 충분하면 ①을 건너뜀 |
| `sample --preset test [--resample] [--seed N]` | ① | 표본만 새로 뽑기 |
| `matches --preset test` | ②~⑤ | 저장된 표본으로 게임만 모으기 |
| `aggregate` | 시험용 집계 | `ANALYZE` → `refresh_window_stats(14)` (3-8) |
| `purge [--yes]` | 정리 | `--yes`가 없으면 미리보기만. `--yes`면 `purge_old_games(21)` (3-8) |

공통 옵션: `--max-matches N`(이번 실행에서 새로 저장할 최대 게임 수), `--players-per-tier N`(1~1000), `--games-per-player N`(1~100), `--tiers PLATINUM,EMERALD,DIAMOND`(디비전 있는 티어만), `--seed N`.

### 3-2. 단계별 흐름

> 요약: Riot 호출은 모두 제한기를 거치고, DB 쓰기는 ①의 upsert와 ⑤의 게임 단위 트랜잭션, 그리고 `collection_logs`뿐이다.

| 단계 | 호출 | 하는 일 | 저장 |
|------|------|---------|------|
| 0 준비 | DB | 수집 잠금 `pg_try_advisory_lock(hashtext('tiergg:collector'))` (실패하면 "다른 수집이 실행 중", 종료 코드 3). 남은 `running` 기록은 `failed`(`'비정상 종료로 남은 기록'`)로 닫고, 새 `running` 1줄. 창 시작을 **한 번만** 정한다 (3-3). `countMatchesSince(창 시작)`로 창 안 기존 게임 수를 센다 | `collection_logs` |
| ① 표본 | `league-v4 /lol/league/v4/entries/RANKED_SOLO_5x5/{tier}/{division}?page=1` (`RIOT_PLATFORM_URL`) | 티어 × 디비전 I~IV. 한 페이지(약 205명) 중 요청 티어·디비전과 같고 `inactive`가 아닌 사람에서 시드 있는 무작위로 뽑는다 (`divisionQuota`: 250명 → 63/63/62/62, 나머지는 앞 디비전부터). 시드를 로그에 남긴다. 그 티어 표본이 이미 `playersPerTier`명 이상이면 건너뜀. 모자라면 **모자란 만큼만** 더 뽑는다(`--resample`이면 전체를 다시 뽑아 더함, 3-5) | `ranked_players` upsert |
| ② 게임 ID | `match-v5 /lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&start=0&count=20&startTime={초}` (`RIOT_REGION_URL`) | 그 티어들의 모든 표본. `Map<matchId, 처음 찾은 puuid>`로 메모리 중복 제거 → `matches`에 이미 있는 ID 제거 → 숫자 내림차순(최신 먼저). ③~⑤와 같은 연속 실패 상한(20)을 공유한다 (3-6, 변경 02) | 없음 |
| ③ 상세 | `match-v5 /lol/match/v5/matches/{matchId}` | 거르기 순서: `bad_format`(ID) → `not_solo` → `too_short` → `not_10_players` → `bad_format`(패치) → 시작 시각 검사(3-3). 걸리면 **④를 부르지 않는다**. 창 상한(3-4)은 ③을 부르기 전에 본다 | 없음 |
| ④ 타임라인 | `match-v5 /lol/match/v5/matches/{matchId}/timeline` | `SKILL_LEVEL_UP`으로 `skill_order` (4-4) | 없음 |
| ⑤ 저장 | DB 트랜잭션 1개 | `matches` 1줄 `ON CONFLICT (match_id) DO NOTHING` → 영향 0줄이면 `ROLLBACK`(`duplicate`, 다른 실행이 저장함) → `match_players` 10줄 한 문장 INSERT → `COMMIT` | `matches`, `match_players` |
| 종료 | DB | `collection_logs`를 `done`(또는 3-6의 상태)으로, `finished_at`, `players`(②에서 쓴 표본 수), `matches_saved`. 잠금 해제. 로그 "집계는 매일 05:00 KST DB 예약 작업이 한다. 바로 보려면 `aggregate`(시험용)" | `collection_logs` |

- ③의 참가자를 ①의 표본에 다시 넣지 않는다 (계약 5장).
- 표본 플레이어는 ①에서 `ranked_players`에 먼저 들어가므로 `matches.puuid` FK가 항상 맞는다.
- `collection_logs`는 `run`, `sample`, `matches`만 남긴다. `aggregate`, `purge`는 남기지 않는다 (`meta.lastCollectedAt`이 수집 시각만 뜻하게).

### 3-3. 창 시작 시각과 시작 시각 검사

> 요약: 실행을 시작할 때 "지금 − 14일"을 한 번 정해, 모든 플레이어의 `startTime`과 ③ 거르기에 같은 값을 쓴다. 오래된 게임은 요청 단계에서 받지 않는다.

- `windowStart(nowMs, 14)` → `{ ms, sec }`, `sec = Math.floor(ms / 1000)`. 로그에 `windowStart`(ISO)와 `startTime`(초)을 남긴다.
- `startTime`은 **초(10자리 정수)**다. 정수가 아니거나 10자리가 아니면(ms를 잘못 넣는 실수) `getMatchIds`가 호출 전에 던진다.
- ③ 시작 시각 검사:

| 조건 | 처리 |
|------|------|
| `info.gameStartTimestamp`가 없음, 정수가 아님, `2020-01-01T00:00:00Z`(1,577,836,800,000ms)보다 이름 | `bad_format` (DB CHECK `matches_game_start_at_check` 보호) |
| `gameStartTimestamp < windowStartMs` | `out_of_window` (저장 안 함) |
| 그 밖 | 통과. `game_start_at = new Date(gameStartTimestamp)` |

- Riot `startTime`은 게임 생성 시각(`gameCreation`, 시작보다 약 1분 이름) 기준일 수 있어, 경계의 몇 게임은 ID 목록에 있고 검사에서 빠진다. 정상이다 (테스트 수집 4,015게임 중 5개).
- 미래 시각 검사는 하지 않는다 (집계 함수가 `p_until` 이후 게임을 뺀다).
- 수집의 창 시작은 로컬 시계, 집계 창은 DB `now()`다. 몇 초 차이는 무시한다.

### 3-4. 창 상한

> 요약: 14일 창 안 게임이 25,000개(계약 1-1)에 닿으면 ③을 부르기 전에 실행을 멈춘다. 본 수집용 안전장치다.

- 0 준비에서 센 창 안 게임 수 + 이번 실행에서 저장한 수 ≥ `maxGamesPerWindow`(25,000)이면 멈춘다 (`stoppedBy: 'window_full'`, `collection_logs`는 `done`).
- 창 안 게임은 모두 같은 창이라 하나씩 건너뛸 이유가 없다 (결정 D15).
- 시간이 지나면 오래된 게임이 창 밖으로 나가 창 안 게임 수가 줄고, 다음 실행이 다시 채운다.

### 3-5. 중복 제거와 이어서 모으기

> 요약: 상태 파일 없이 DB를 상태로 쓴다. 같은 명령을 다시 실행하면 저장된 게임은 건너뛰고 남은 것만 모은다.

| 상태 | 어디에 | 다시 실행할 때 |
|------|--------|----------------|
| 표본 | `ranked_players` | 그 티어 표본이 `playersPerTier`명 이상이면 ①을 건너뛴다. 적으면 **모자란 만큼만** 더 뽑는다 (upsert, 삭제 없음, 변경 02). `--resample`이면 항상 `playersPerTier`명 전체를 다시 뽑아 더한다 |
| 저장한 게임 | `matches` (+ `match_players` 10줄) | ②에서 이미 있는 ID 제거. 저장은 게임 단위 트랜잭션이라 반쪽 게임이 없다 |
| 실패한 게임 | 저장 안 함 | 다음 실행에서 다시 시도 |
| 5분 미만·창 밖 게임 | 저장 안 함 (메모리에서만 건너뜀) | 다음 실행에서 ③을 다시 부른다. 수가 적어 감수한다 |
| 실행 기록 | `collection_logs` | 매 실행 새 줄 |

- 다시 실행해도 ②는 모든 표본에 다시 부른다. 대신 상태 파일이 없어 꼬일 일이 없다 (결정 D7).
- 표본 삭제는 이번 범위가 아니다. 지우려면 `matches(puuid)` 인덱스가 먼저 필요하고(db_review L3), 사용자 승인이 필요하다.
- 이전 만료 키 시기에 뽑히고 한 번도 다시 확인되지 않은 puuid가 ②에서 400을 계속 받는 경우가 있다 (변경 02-1에서 조사, 15명/0.17%). 저장 실패로 이어지지 않아 조치하지 않는다.

### 3-6. 오류와 중단 처리

> 요약: 키 만료는 즉시 멈추고, 일시 오류는 재시도하고, 게임 하나의 오류는 그 게임만 건너뛴다. 자세한 Riot 응답별 처리는 6-1.

| 상황 | 동작 | `collection_logs.status` | 종료 코드 |
|------|------|--------------------------|-----------|
| 정상 끝 (창 상한·`--max-matches`로 멈춘 경우 포함) | - | `done` | 0 |
| 401/403 | 진행 중 게임은 저장하지 않고(트랜잭션 전이거나 `ROLLBACK`) **즉시 멈춤**. 안내: "키를 재발급하고 같은 명령을 다시 실행" | `key_expired` | 2 |
| 다른 수집이 실행 중 | 잠금을 못 잡으면 바로 끝 | 기록 없음 | 3 |
| Ctrl+C (SIGINT) | 지금 게임의 트랜잭션을 끝낸 뒤 멈춤. 두 번 누르면 바로 종료 | `failed` (`'사용자 중단'`) | 130 |
| 수집 잠금 연결 끊김 | 연결의 `'error'`를 받아 오류 로그(가림), 지금 게임 뒤 멈춤 (프로세스가 죽지 않게) | `failed` (`'DB 연결 끊김 (수집 잠금 연결)'`) | 1 |
| ②~⑤ 게임(또는 플레이어) 연속 20개 실패, 그 밖의 예상 못한 오류 | 멈춤 | `failed` (`error_message` = 가린 오류 문장, 500자 이하) | 1 |
| `aggregate`의 P0002 (창 안 완료 게임 0개) | 기존 집계를 둔다 | 기록 없음 | 1 |

- 요약 로그(stdout) 2번째 줄의 `stoppedBy`는 정상 끝이 아니면 `aborted`(Ctrl+C) 또는 `failed`(그 밖)로 남는다. `collection_logs.status`는 원래부터 정확했고, 이건 stdout 표시만 고친 것이다 (변경 02-3, L2).
- `withTransaction`(⑤ 저장)·`readSnapshot`(API 스냅숏)로 빌린 연결에도 수집 잠금과 같은 이유로 `'error'` 리스너를 붙인다(선택적 `logger` 매개변수). 로그만 남기고 멈추지 않는다 — 쿼리 자체는 이미 실패해 호출자가 오류 경로를 탄다 (변경 02-6, L5).

### 3-7. 제한기

> 요약: 이중 창(1초·2분) 방식을 쓰되 한도보다 조금 낮게 잡고, Riot이 429를 주면 그 지시를 따르고, 응답 헤더로 실제 사용량을 맞춘다.

| 항목 | 값 |
|------|-----|
| 창 | Riot 한도 1초 20회, 120초 100회. 설정은 여유분을 둔 **19회 / 98회** |
| 범위 | 모든 Riot 호출이 **하나의 제한기**를 공유 (kr·asia 따로 세는 것보다 보수적) |
| 동시성 | 한 번에 1개 요청 (순차) |
| 헤더 맞춤 | `X-App-Rate-Limit-Count`가 우리 셈보다 크면 그 차이를 채운다 (직전 실행·다른 프로세스 사용량 반영). `X-App-Rate-Limit`이 설정보다 작으면 서버 한도를 따른다 |
| 429 | `Retry-After`초(없으면 10초) 동안 제한기 전체를 막고 같은 요청 재시도, 최대 5번 |
| 관찰 | `X-App-Rate-Limit-Count` 등을 10분마다 로그에 남긴다 (첫 호출 때도 1번) |
| 시계 | `now()`·`sleep()`을 주입할 수 있어 단위 테스트에서 가짜 시계를 쓴다 |

- 2026-10-14 실제 응답 헤더 `x-app-rate-limit: 100:120,20:1`, `x-method-rate-limit: 50:10`을 확인했다. 계약 값과 같다.

### 3-8. aggregate와 purge

> 요약: `aggregate`는 시험용이고, `purge`는 되돌릴 수 없는 삭제라 `--yes`로만 실행한다. 둘 다 자동으로 돌지 않는다.

| 명령 | 동작 |
|------|------|
| `aggregate` (시험용) | 연결 1개에서 `SET statement_timeout = '5min'` → `ANALYZE matches, match_players` → `SELECT refresh_window_stats(14)` → `RESET statement_timeout`. 반환 jsonb와 시간을 로그에. P0002면 경고 "기존 집계 유지", 종료 코드 1. **수집 잠금을 잡지 않는다** (함수 안 advisory lock이 예약 작업과 차례로 돌리고, 수집 INSERT와는 MVCC라 막히지 않음) |
| `purge` (미리보기) | 읽기만, 잠금 없음: 전체 게임 수, `game_start_at < now() − 21일`인 게임 수, 지울 게임 중 가장 오래된·가장 최근 시작 시각. "실제로 지우려면 `--yes`" |
| `purge --yes` | 수집 잠금을 잡고 `SELECT purge_old_games(21)` → 삭제한 게임 수 로그. **사용자 승인 없이 실행하지 않는다** (결정 D9) |

- `ANALYZE`는 게임 수와 관계없이 항상 먼저 한다 (계약 9-4, db_review L6). `ANALYZE`와 집계 함수는 같은 연결에서 실행한다.
- `aggregate(until)`의 `p_until` 인자는 **통합 테스트 전용**이다. CLI에는 없다.
- `purge_old_games`는 `p_keep_days < 14`처럼 현재 창보다 짧은 보관을 거부한다. 21일보다 오래된 게임은 이미 14일 창 밖이라 집계에 쓰이지 않는다.
- 실패한 예약 작업의 원인은 `cron.job_run_details`에서 본다. 백엔드는 `cron` 스키마를 읽지 않는다.

### 3-9. 테스트 수집 규모

> 요약: `db_contract.md` v8(변경 04)이 "플래티넘·에메랄드·다이아 티어당 250명"을 확정했고, `test` 프리셋 기본값도 250으로 맞췄다 (변경 02).

| 항목 | 값 |
|------|-----|
| 계약 (`db_contract.md` v8, 1-3·10장) | 플래티넘·에메랄드·다이아 티어당 250명 |
| `test` 프리셋 기본값 | 250명 (63/63/62/62) |
| 실제 실행 (2026-10-15 KST) | `run --preset test --players-per-tier 250` → 표본 765명 (에메랄드는 기존 15 + 250) |
| 250명으로 한 이유 | 소량 수집에서 14일 안 게임이 있는 표본이 33%뿐이라, 100명이면 약 850게임으로 예상(2,200~2,700)의 1/3이었다. 0게임 표본은 ② 호출 1번만 들어 인원을 늘리는 비용이 작다 (back_review M2) |
| 결과 | 3,930게임 저장, Riot 8,722회, 429 0회, 약 3시간 (`back_build.md` 4-3) |

- 시간 계산: 98회 / 120초 = 시간당 약 2,940회. 24시간 키 안에 끝나야 한다.
- 전체 테스트 수집은 Review 범위가 아니다. 사용자가 승인 후 직접 실행한다.

---

## 4. Riot에서 DB로 변환 규칙

> 요약: 계약 6장(필드 위치)과 7장(저장 규칙)을 그대로 코드로 옮긴다. 규칙에 안 맞는 게임은 저장하지 않고 이유를 센다.

### 4-1. ranked_players (league-v4 entries)

| 컬럼 | 값 | 비고 |
|------|-----|------|
| `puuid` | `entries[].puuid` | 78자 |
| `tier` | `entries[].tier` | 요청한 티어와 같은지 확인. 허용 값(계약 1-1) 밖이면 건너뜀 |
| `rank` | `entries[].rank` | Riot 값 그대로 (`I`~`IV`) |

- upsert: `ON CONFLICT (puuid) DO UPDATE SET tier = EXCLUDED.tier, rank = EXCLUDED.rank`.

### 4-2. matches (getMatch)

| 컬럼 | 값 | 비고 |
|------|-----|------|
| `match_id` | `metadata.matchId` | `^KR_[0-9]+$` (DB CHECK) |
| `puuid` | ②에서 이 ID를 처음 찾은 표본 플레이어 | 이미 저장된 게임은 그대로 둠 (`DO NOTHING`) |
| `patch` | `info.gameVersion`의 앞 두 부분 | `16.19.823.722` → `16.19`, `16.9.1` → `16.9`. `^[0-9]+\.[0-9]+$` 검사 |
| `game_start_at` | `new Date(info.gameStartTimestamp)` | `$4::timestamptz`. 검사는 3-3 |

### 4-3. match_players (getMatch participants + timeline)

| 컬럼 | 값 | 규칙 |
|------|-----|------|
| `match_id` | `metadata.matchId` | |
| `puuid` | `participants[].puuid` | 중복·없음이면 `bad_format` |
| `champion_id` | `championId` | `> 0` |
| `team_position` | `teamPosition` | `""`·없음 → NULL. `TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY` 밖의 값도 NULL + 경고 |
| `win` | `win` | boolean |
| `ban_champion_id` | `info.teams[].bans[]`로 `pickTurn → championId` 표를 만들고 참가자의 `participantId`로 찾음 | `-1`·0 이하 → NULL. 짝이 없으면 NULL + 경고 |
| `summoner1_id`, `summoner2_id` | `summoner1Id`, `summoner2Id` | 그대로 (정렬은 집계 함수가 함). `*Casts` 필드는 쓰지 않음 |
| `primary_style` | `perks.styles[]` 중 `description = 'primaryStyle'`의 `style` | 없으면 `styles[0]` |
| `primary_perk1~4` | 그 스타일의 `selections[0..3].perk` | 4개가 아니면 `bad_format` |
| `sub_style` | `description = 'subStyle'`의 `style` | 없으면 `styles[1]` |
| `sub_perk1~2` | `selections[0..1].perk` | 2개가 아니면 `bad_format` |
| `stat_offense/flex/defense` | `perks.statPerks.offense/flex/defense` | |
| `item0~5` | `item0`~`item5` | 그대로. 빈 칸 `0`(NULL 아님). 같은 아이템 2개도 그대로. `item6`은 저장 안 함 |
| `skill_order` | timeline (4-4) | |

- 정수가 아닌 값, 타임라인 matchId 불일치도 `bad_format`이다 (DB CHECK 위반을 미리 막음).

### 4-4. skill_order 만들기

> 요약: 그 참가자의 `SKILL_LEVEL_UP` 중 `NORMAL`만 시간 순서로 Q/W/E/R로 이어 붙인다. 카이사 등의 `EVOLVE`는 뺀다.

1. timeline `info.participants[]`의 `{participantId, puuid}`로 참가자를 잇는다 (puuid로 확인, 번호만 믿지 않음).
2. `info.frames[].events[]` 중 `type = 'SKILL_LEVEL_UP'`, `participantId` 일치, `levelUpType = 'NORMAL'`.
3. `timestamp` 오름차순 (같으면 원래 순서).
4. `skillSlot` 1→`Q`, 2→`W`, 3→`E`, 4→`R`. 그 밖의 값은 버리고 경고.
5. 이어 붙인 문자열 저장 (`^[QWER]*$`). 이벤트가 없으면 NULL. 11자 미만도 그대로 저장한다 (집계 함수가 거름).

### 4-5. 게임 건너뛰기 이유

| 이유 코드 | 조건 |
|-----------|------|
| `not_solo` | `info.queueId ≠ 420` (요청에서 걸렀지만 한 번 더) |
| `too_short` | `info.gameDuration < 300` |
| `not_10_players` | 참가자 ≠ 10명 |
| `out_of_window` | 시작 시각이 창 시작보다 이름 (3-3) |
| `bad_format` | ID·패치·시작 시각 형식 오류, 룬 개수 오류, 타임라인 참가자 매칭 실패 등 |
| `duplicate` | ⑤에서 다른 실행이 먼저 저장함 (로그 집계용, DB 영향 없음) |

- 실행이 끝나면 이유별 개수와 경고 개수(밴 짝 없음, 이상한 포지션, 이상한 skillSlot)를 로그 요약에 낸다. 경고는 `collection_logs`에 컬럼이 없어 stdout에만 남긴다.

---

## 5. API 설계

> 요약: 읽기 전용 GET 엔드포인트 4개. 숫자 ID와 개수·비율, 그리고 어느 14일 창의 통계인지(`window`)를 준다. 자세한 형식은 `docs/contracts/api_contract.md` v2.

| 메서드·경로 | 화면 | 내용 |
|-------------|------|------|
| `GET /api/v1/health` | (운영) | 서버·DB 확인 + `stats: { state, aggregatedAt }` |
| `GET /api/v1/meta` | 공통 (푸터 등) | `window`, `lastCollectedAt`(마지막 `done` 수집), `positions`, `rules{minTierPick, secondaryPositionMinShare, windowDays, staleAfterHours}` |
| `GET /api/v1/champions?position=TOP` | 챔피언 리스트(티어) | 그 포지션이 주 포지션인 챔피언, 티어 → 점수 순, `window` |
| `GET /api/v1/champions/:championId[?position=]` | 챔피언 상세 | 주 포지션(최대 2개), 선택 포지션 통계, 아이템(전체)·룬·스펠·스킬(상위 2개), `window` |

- 경로는 `/api/v1` 그대로다 (결정 D14). 예전 `patch` 쿼리와 모르는 쿼리는 400을 주지 않고 **무시**한다.

### 5-1. 공통 규칙

| 규칙 | 내용 |
|------|------|
| 통계 기준 | 최근 14일 창 하나 (`stats_window`). 패치 선택·직전 패치 대체 규칙은 없다 |
| 티어 | `champion_tier_view.tier` 그대로 (NULL = 50판 미만, 표본 부족). `tier_score`로 다시 계산하지 않음 (db_review L4) |
| 티어리스트 정렬 | `tier NULLS LAST, tier_score DESC, champion_id ASC` |
| 주 포지션 | 챔피언별 포지션 pick 내림차순(같으면 포지션 이름 순) 최대 2개. 2순위는 그 챔피언 전체 pick의 10% 이상일 때만 (`pick × 100 ≥ 10 × 전체`, 정수 비교) |
| 상세 기본 포지션 | `position`을 안 주면 1순위 주 포지션. 주 포지션이 아닌 포지션을 주면 200 + `isMainPosition: false` |
| 상세 비율 | 조합 승률 = `win / pick`, 사용률 = `pick / champion.pick` (계약 9-3). SQL `round(…, 2)` |
| 비율 단위 | 퍼센트 숫자 (`52.31` = 52.31%), 소수 2자리 |
| 룬 식별 | `champion_rune.id`는 집계마다 바뀌어 응답에 넣지 않음 |
| ID | 숫자 ID만. 이름·이미지는 프론트가 Data Dragon으로 |
| 캐시 | 성공 `Cache-Control: public, max-age=600`, `/health`·오류 `no-store`. ETag 끔, 서버 메모리 캐시 없음 (결정 D5) |
| 헤더 | CORS 헤더 없음 (결정 D6), `x-powered-by` 끔. GET·HEAD 외 메서드는 404 |

### 5-2. window 객체

| 필드 | 출처 | 규칙 |
|------|------|------|
| `days` | `stats_window.days` | 14 |
| `start` / `end` | `window_start` / `window_end` | ISO 8601 UTC. `[start, end)` |
| `games` | `stats_window.games` | 픽률·밴률 분모 |
| `aggregatedAt` | `stats_window.aggregated_at` | ISO 8601 UTC |
| `isStale` | 백엔드 계산 | `지금 − aggregatedAt > 26시간` (5-3) |
| `patches[]` | `stats_window_patch` | `ORDER BY patch_sort_key(patch) DESC` (최신 먼저) |
| `patches[].patch` | `patch` | 내부 패치 (`16.20`). Data Dragon 버전에 쓴다 |
| `patches[].displayName` | 백엔드 계산 | `${major + 10}.${minor}` (`16.20` → `26.20`, `15.24` → `25.24`). 형식이 아니면 내부 값 그대로 + 경고 로그. 화면에는 이 값을 쓴다 |
| `patches[].games` | `games` | |
| `patches[].share` | 백엔드 계산 | `round(100 × games / window.games, 2)`. 합이 정확히 100.00이 아닐 수 있다 (결정 D17) |

### 5-3. 집계 멈춤 표시

> 요약: 예약 작업이 실패해도 알림이 없으므로, 모든 통계 응답에 `aggregatedAt`과 `isStale`을 싣고, `/health`에도 상태를 싣고, API 서버 로그에 경고를 남긴다 (결정 D12, db_review L7).

| 곳 | 내용 |
|----|------|
| `window.isStale` | `now − aggregatedAt > 26h`이면 `true`. 26시간 = 하루 주기 24시간 + 여유 2시간. 정확히 26시간이면 `false`, +1ms면 `true` |
| `/health` `stats.state` | `fresh` / `stale` / `empty`(집계 전). HTTP는 **항상 200**. DB를 못 쓰면 503 `DB_UNAVAILABLE`(응답은 그대로, 서버 로그에는 `error.message` 1줄을 남겨 원인을 구분할 수 있게 한다, 변경 02-5·L4) |
| API 서버 로그 | 요청 처리 중 `isStale`을 보면 1시간에 1번 `warn 집계가 26시간 넘게 갱신되지 않음 aggregatedAt=…` |

- 캐시 때문에 `isStale` 변화가 최대 10분 늦게 보일 수 있다. 하루 단위 판단이라 문제없다.

### 5-4. 한 요청은 한 스냅숏

> 요약: 05:00 집계가 커밋되는 순간 분모(`stats_window`)와 개수(`champion`)를 다른 스냅숏에서 읽지 않도록, 통계 엔드포인트 3개는 요청마다 **`REPEATABLE READ READ ONLY` 트랜잭션 1개** 안에서 모든 읽기를 한다 (결정 D11, db_review L11).

| 항목 | 규칙 |
|------|------|
| 대상 | `/meta`(창 + 마지막 수집 시각), `/champions`(창 + 뷰), 상세(창 + 뷰 + 상세 4개) |
| 방법 | `db.snapshot(fn)` 안에서 같은 연결로 차례로 읽는다 (`Promise.all` 쓰지 않음) |
| 첫 문장 | 항상 `readWindow` (`stats_window` 1줄 + `stats_window_patch`를 한 문장으로). 0줄이면 503 (5-5) |
| 충돌 | 읽기 전용이라 직렬화 오류가 나지 않고, 집계 함수의 `DELETE`·`INSERT`를 막지 않는다 (MVCC) |
| 비용 | 요청마다 `BEGIN`·`COMMIT` 왕복 2번 추가. 연결은 요청 동안 1개 |
| `/health` | `SELECT (SELECT aggregated_at FROM stats_window WHERE id = 1)` 한 문장이라 스냅숏 없이 풀에 바로 묻는다 |

### 5-5. 집계 전 응답

> 요약: 첫 집계가 성공하기 전에는 통계 엔드포인트 3개가 `503 STATS_NOT_READY`를 준다 (결정 D13).

| 경로 | 응답 |
|------|------|
| `/meta`, `/champions`, 상세 | `503 STATS_NOT_READY`, `no-store`, message "아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다." |
| `/health` | `200`, `stats: { state: "empty", aggregatedAt: null }` |

- 집계 함수는 0게임이면 오류로 기존 스냅숏을 지키므로, 한 번 생긴 `stats_window`는 다시 0줄이 되지 않는다 (`!db`가 직접 지울 때만 예외).

### 5-6. 프론트 사용 방식에 맞춘 점

> 요약: 프론트는 Next.js 서버 컴포넌트에서 부르므로 서버 간 호출, 한 화면 한 요청에 맞췄다.

- 상세는 숫자 `championId`(Data Dragon `champion.json`의 `key`)로 부른다. 프론트가 영문 id를 `key`로 바꿔 부른다.
- 상세 한 번 호출로 포지션 탭·빌드를 모두 받는다.
- 아이템은 프론트가 Data Dragon으로 거르므로 **모든 아이템**을 pick 순으로 준다 (결정 D4).

---

## 6. 오류 처리와 로깅

> 요약: 수집은 오류 종류별로 멈춤·재시도·건너뜀을 정하고, API는 한 가지 오류 형식을 쓴다. 비밀값은 어디에도 출력하지 않는다.

### 6-1. Riot 응답별 처리 (수집)

| 응답 | 분류 | 동작 |
|------|------|------|
| 200 | 성공 | |
| 401, 403 | 키 만료·잘못된 키 | `RiotKeyExpiredError` → 재시도 없이 **즉시 중단**, `key_expired`, 종료 코드 2 |
| 404 (match, timeline) | 없음 | 그 게임 건너뜀 (경고) |
| 404 (by-puuid, entries) | 없음 | 그 플레이어·페이지 건너뜀 (경고) |
| 400 | 잘못된 요청 | 그 게임·플레이어 건너뜀 + 오류 로그 |
| 429 | 한도 초과 | `Retry-After` 기다려 재시도 (최대 5번) |
| 500, 502, 503, 504, 네트워크 오류, 10초 시간 초과 | 일시 오류 | 1초 → 2초 → 4초 재시도 (최대 3번). 그래도 실패면 그 게임 건너뜀 |
| ③~⑤ 연속 20개 게임 실패 | 장애 | 중단, `failed` |

- DB 22xxx·23xxx 오류도 그 게임만 건너뛴다 (연속 실패에 셈).

### 6-2. API 오류

| HTTP | `code` | 언제 |
|------|--------|------|
| 400 | `INVALID_PARAMETER` | `position`(대문자 5개 중 하나, 반복·빈 값 불가), `championId`(`^[1-9][0-9]{0,4}$`) 형식 오류, 잘못된 % 인코딩 |
| 404 | `STATS_NOT_FOUND` | 그 챔피언(·포지션) 통계가 창 안에 없음. `details`: `{championId}` 또는 `{championId, position}` |
| 404 | `NOT_FOUND` | 없는 경로, GET·HEAD 외 메서드 |
| 503 | `STATS_NOT_READY` | `stats_window`가 비어 있음 |
| 503 | `DB_UNAVAILABLE` | DB 연결 실패 |
| 500 | `INTERNAL_ERROR` | 그 밖 (내부 내용은 응답에 넣지 않고 로그에만) |

- 형식: `{ "error": { "code": "...", "message": "...", "details": {...} } }`, `no-store`.

### 6-3. 로깅

| 항목 | 규칙 |
|------|------|
| 형식 | 한 줄 텍스트 `시각 레벨 [영역] 메시지 key=value` (stdout). 파일로 남기려면 `| tee logs/…` (`*.log`는 git 제외) |
| 수집 진행 | 50게임마다 진행률 (저장/목표, 건너뜀 이유별, 경과, 예상 남은 시간, 호출 수) |
| 수집 요약 | 끝날 때 2줄: 호출(호출 수, 429, 재시도, 상태별, 제한기 대기)과 게임(표본, 실패 표본, 0게임 표본 `playersNoGames`, 창 안 기존 `inWindowBefore`, 저장, 건너뜀, 경고, `stoppedBy`, 패치) |
| API | 요청 1줄 (`메서드 경로 상태 ms`). 5xx는 오류 스택(가림) |
| 비밀값 | `DATABASE_URL`(전체·비밀번호(디코딩 포함)·사용자·호스트)과 `RIOT_API_KEY`, 그리고 `postgresql://…`·`RGAPI-…` 모양을 모든 로그·오류 메시지에서 `***`로 가린다. 잘못된 `%` 인코딩에서도 원문을 가린다 (db_review L1) |
| puuid | 로그·문서에 전체 puuid를 쓰지 않는다 (앞 8자만). Riot 오류 경로의 puuid도 앞 8자 |
| `collection_logs` | 상태·개수·`error_message`만. 경고 개수는 stdout 요약에만 |

---

## 7. 설정값

> 요약: 비밀값·주소는 `.env`, 수집 범위는 `config/collection.ts`, API 규칙은 `config/api.ts`. 본 수집 전환은 프리셋 값만 바꾼다.

### 7-1. 환경 변수 (루트 .env)

| 변수 | 기본 | 사용처 |
|------|------|--------|
| `DATABASE_URL` | (필수) | API, CLI |
| `RIOT_API_KEY` | (CLI 필수) | CLI만. API 서버는 읽지 않음 |
| `RIOT_PLATFORM_URL` | `https://kr.api.riotgames.com` | CLI ① |
| `RIOT_REGION_URL` | `https://asia.api.riotgames.com` | CLI ②~④ |
| `API_PORT` | `4000` | API |

- 새 변수를 만들면 `.env.example`도 함께 고친다.

### 7-2. 수집 프리셋 (config/collection.ts)

| 설정 | `test` | `main` (자리만) | CLI 덮어쓰기 |
|------|--------|-----------------|--------------|
| `tiers` | `PLATINUM, EMERALD, DIAMOND` | `EMERALD, DIAMOND` (+ 마스터 이상은 나중) | `--tiers` |
| `playersPerTier` | 250 (3-9, db 계약 v8과 맞춤) | 200 (비율은 테스트 뒤 정함) | `--players-per-tier` |
| `divisions` | `I, II, III, IV` 고르게 | 같음 | - |
| `sampling` | page 1 무작위, `inactive` 제외, 시드 | 같음 | `--seed` |
| `gamesPerPlayer` | 20 (`count=20`) | 20 | `--games-per-player` |
| `queue` | 420 | 420 | - |
| `minGameDurationSec` | 300 | 300 | - |
| `windowDays` | 14 (`config/api.ts` `WINDOW_DAYS`를 함께 씀) | 14 | 없음 (예약 작업과 함께 바꿔야 해서 상수로 묶음) |
| `maxGamesPerWindow` | 25,000 | 25,000 | - |
| `keepDays` | 21 | 21 | - |
| `maxMatchesPerRun` | 없음 | 없음 | `--max-matches` |

### 7-3. Riot 클라이언트

| 설정 | 기본 |
|------|------|
| `perSecondLimit` / `perWindowLimit` / `windowMs` | 19 / 98 / 120,000 |
| `requestTimeoutMs` | 10,000 |
| `retry5xx` | 3번 (1·2·4초) |
| `retry429` / `default429WaitSec` | 5번 / 10초 |
| `maxConsecutiveMatchFailures` | 20 |
| `aggregateStatementTimeout` | `5min` |

### 7-4. API 규칙 (config/api.ts)

| 설정 | 기본 | 근거 |
|------|------|------|
| `MIN_TIER_PICK` | 50 | 표시용(`meta.rules`). 실제 판정은 DB 뷰 |
| `SECONDARY_POSITION_MIN_SHARE` | 10 (%) | 계약 9-3 |
| `WINDOW_DAYS` | 14 | `rules.windowDays`, 수집 `windowDays` |
| `STALE_AFTER_HOURS` | 26 | 5-3 |
| `DETAIL_TOP_N` | 2 (룬·스펠·스킬) | 계약 10장 |
| `CACHE_MAX_AGE_SEC` | 600 | 결정 D5 |

---

## 8. 의존성

> 요약: 실행 의존성은 `express`, `pg` 두 개뿐이다. 나머지는 Node 24 내장 기능으로 대신한다.

| 패키지 | 종류 | 목적 |
|--------|------|------|
| `express` ^5 | 실행 | 프로젝트 스택. 5.x는 async 핸들러 오류를 오류 미들웨어로 넘김 |
| `pg` ^8 | 실행 | Supabase Postgres 직접 접속 |
| `typescript` ^5, `tsx` ^4 | 개발 | 타입 검사(`tsc --noEmit`), 빌드 없이 실행 (결정 D1) |
| `@types/node`, `@types/express`, `@types/pg` | 개발 | 타입 정의 |
| `eslint` ^9, `@eslint/js`, `typescript-eslint` ^8 | 개발 | 린트 |

| 넣지 않는 패키지 | 대신 |
|------------------|------|
| `axios` | 내장 `fetch` + `AbortSignal.timeout` |
| `dotenv` | `node --env-file=../.env` |
| `cors` | 서버 간 호출이라 불필요 (결정 D6) |
| `zod` 등 검증 | 파라미터가 2종이라 직접 작성 |
| `vitest`/`jest`, `supertest` | `node:test` + `node:assert`, 통합 테스트는 `app.listen(0)` + `fetch` (결정 D2) |
| `pino` 등 로거 | 작은 `logger.ts` |
| Supabase JS 클라이언트 | `pg` 직접 접속 (사용자 결정) |

---

## 9. 테스트 전략

> 요약: 변환·제한기·규칙은 단위 테스트, DB·API는 실제 Supabase에서 ROLLBACK하는 통합 테스트, 마지막으로 Review가 수십 게임을 실제로 모은다. 모든 테스트는 고정 시각을 쓴다.

### 9-1. fixture와 시험 데이터

- `test/fixtures/KR_8408851980.{match,timeline}.json`: 실제 게임 1개. puuid 10개 → `TEST_PUUID_01…10`, `riotIdGameName`·`summonerName` → `Player01…`, `riotIdTagline` → `TEST`, `summonerId` → `TEST_SUMMONER_01…`. 타임라인은 `SKILL_LEVEL_UP`과 `info.participants`만 남겼다. `gameStartTimestamp = 1791263990514` (2026-10-06T05:19:50.514Z). **새로 받지 않는다.**
- `test/helpers/fixture.ts`: 창 시작을 `2026-09-30T00:00:00Z`로 고정. 실제 시계를 쓰면 날짜가 지나 fixture가 창 밖이 되어 테스트가 깨진다.
- `test/helpers/db.ts` `fakeGames(n, { patch, startMs, firstId })`: 시작 시각 `2021-01-10 + k분`, 변환 창 시작 `2021-01-01`, `FAKE_UNTIL = 2021-01-15`. 가짜 ID `KR_90000000xx`, 가짜 puuid `TEST_…`, 가짜 패치 `0.8`·`0.9`만 쓴다.

### 9-2. 단위 테스트 (npm test, 네트워크와 DB 없음)

| 대상 | 확인 |
|------|------|
| `transform` fixture | `matches` 줄(`patch '16.19'`, `game_start_at`) + 10줄. 1번 참가자 = 계약 6-3 값 (`23, TOP, true, ban 64, 14/4, 8100(9923,8143,8140,8135), 8000(8299,9104), 5008/5008/5011, 1018,3074,3006,3046,1036,1036, 'EQQWQRQEQEREEW'`) |
| `transform` 가공 입력 | `teamPosition ''` → NULL, ban `-1` → NULL, 짝 없는 밴 → NULL + 경고, `EVOLVE` 제외, `skillSlot` 순서, 299초 → `too_short`, 440 → `not_solo`, 9명 → `not_10_players`, 시작 시각 없음·문자열·소수·2020년 이전 → `bad_format`, 창 시작 − 1ms → `out_of_window`, 정확히 창 시작은 통과 |
| `rateLimiter` (가짜 시계) | 1초·120초 창 대기, 19/98로 300회 돌려 어느 창도 넘지 않음, 429 막기, 헤더 맞춤, 동시 호출 |
| `client` (가짜 fetch) | 401/403 재시도 없음, 429 `Retry-After`·기본 10초·6번째 포기, 503 1·2·4초 뒤 포기, 404/400, 키가 URL에 없음, `startTime` URL과 10자리 검사 |
| `rules` | 프리셋·디비전 나누기, `windowStart(2026-10-15T01:00:00Z, 14).sec = 1790816400`, `mainPositions` 9.9%/10.0%/3순위/동률, `validate` 경계값, 로그 가리기 |
| `matches` (가짜 riot·풀) | 창 상한 `window_full`, 창 밖 타임라인 0번, 집계·`purge` SQL을 부르지 않음, INSERT에 `game_start_at` |
| `window` | `displayName`, `share`, 26시간 경계, `fresh/stale/empty`, 경고 1시간 1번 |
| `app` (가짜 `ApiDb`) | 집계 전 3개 503 + `no-store`, `/health empty`, `?patch=` 무시, 통계 엔드포인트마다 `snapshot` 정확히 1번·첫 쿼리 `stats_window`, 오류 형식, 500에 내부 내용 없음, CORS 없음 |
| `runLog` | 잠금 연결 끊김에 죽지 않고 `onLost` 1번, 잃은 잠금 release는 unlock 없이 버림 |

### 9-3. 통합 테스트 (npm run test:integration, 실제 Supabase)

> 요약: 모든 테스트가 `BEGIN` 뒤 `ROLLBACK`으로 끝나 실제 데이터를 남기지 않는다. 2021년 가짜 게임과 과거 `p_until`로 실제 데이터와 섞이지 않게 한다.

| 대상 | 확인 |
|------|------|
| 저장 | fixture 게임 저장 → `game_start_at`, 10줄 → 다시 저장 시 `duplicate`. `countMatchesSince` |
| 창 집계 | 2021년 가짜 게임 → `aggregateWindow(until 2021-01-15)` → `games`, `patches`, `stats_window` 1줄, `statement_timeout` 원래대로 |
| 0게임 | `until 2020-06-01` → `ok: false`(P0002). SAVEPOINT로 되살린 뒤 `stats_window`가 호출 전과 같음 |
| `purge` 미리보기 | 2021년 게임을 지울 대상으로 셈. **`purge_old_games`는 실행하지 않는다** (실제 원본까지 지우는 문장이라 ROLLBACK이어도 시험하지 않음) |
| API | 가짜 60게임 집계 → `createApp(롤백 ApiDb, 고정 시계)` → `/health`, `/meta` `window`, 목록·상세 값, 404 2종 |
| 오래됨 | SAVEPOINT 안에서 `aggregated_at = now() − 27h` → `isStale true`, `/health stale` |
| 스냅숏 | 실제 풀 `readSnapshot` 안 `repeatable read`, `read_only on`, 쓰기 25006 거부, 실패 뒤 연결 재사용 |
| 정리 확인 | 끝난 뒤 `KR_9000000%`, `TEST\_%`, 패치 `0.8`·`0.9` 0줄 |

- 시퀀스(`collection_logs_id_seq` 등)는 롤백되지 않는다 (동작 영향 없음).
- 통합 테스트는 실제 `stats_window`를 트랜잭션 안에서 바꿨다가 되돌린다. **05:00 KST(20:00 UTC)에는 돌리지 않는다** (예약 작업이 함수 잠금에서 기다림).

### 9-4. Review 실제 소량 수집

| 단계 | 명령 (backend/에서) | 확인 |
|------|---------------------|------|
| 1 | `npm run collect -- run --preset test --tiers EMERALD --players-per-tier 4 --max-matches 30` | 로그의 `startTime`이 10자리 초, 수십 게임 저장, 각 10줄, `done`, **집계 호출 없음** |
| 2 | DB 조회 | 모든 `game_start_at`이 `[실행 시작 − 14일, 실행 시작)` 안. 몇 게임을 Riot에서 다시 받아 참가자 값을 따로 계산해 대조 |
| 3 | 같은 명령 다시 | 저장한 게임은 건너뜀 |
| 4 | `npm run collect -- aggregate` | `ANALYZE` → `refresh_window_stats(14)` 성공 jsonb |
| 5 | `npm start` 후 4개 엔드포인트, `?patch=16.19`, 없는 챔피언 | `api_contract.md` v2와 필드·null·정렬 일치 |
| 6 | `npm run collect -- purge` | 미리보기만 (**`--yes` 쓰지 않음**) |
| 7 | `RIOT_API_KEY=invalid npm run collect -- matches --preset test --tiers EMERALD --max-matches 5` (프로세스 환경에만, `.env`는 고치지 않음) | 즉시 멈춤, `key_expired`, 종료 코드 2, 반쪽 게임 없음 |
| 8 | Ctrl+C, 잠금 충돌, 잠금 연결 끊김 | 130 / 3 / 1, `running`이 남지 않음 |

- Review는 Riot 호출을 수십 회 안으로 쓴다. 남긴 실제 데이터는 지우지 않는다 (14일 창에 맞는 실제 데이터).

---

## 10. 완료 기준

> 요약: Review가 아래 항목을 하나씩 확인한다.

### 10-1. 코드와 검증

- `npm run typecheck`, `npm run lint` 오류 0, `npm audit` 취약점 0
- `npm test` 통과 (9-2 전부), `npm run test:integration` 통과, 끝난 뒤 테스트 데이터 0줄
- 코드에 패치 기준 이름이 없음 (`grep`): `refresh_patch_stats`, `purge_old_patches`, `FROM patch`, `keepPatches`, `maxGamesPerPatch`, `patch_full`, `old_patch`, `isFallback`, `PATCH_NOT_FOUND`, `selectPatch`, `parsePatchParam`, `patchSelection`, `FALLBACK_MIN_GAMES`
- 진입점 2개 분리 (API 서버가 수집 코드를 import하지 않고 Riot 키를 읽지 않음)

### 10-2. 수집

- ① 디비전별 고른 무작위 표본, `inactive` 제외, `ranked_players` upsert, 시드 로그
- ② `queue=420&count=20&startTime={초}`, 모든 플레이어에 같은 값, 메모리·DB 중복 제거
- ③ 큐·5분·10명·형식·창 밖이면 타임라인을 부르지 않음
- ⑤ 게임 1개 = 트랜잭션 1개, `matches` 1줄(`game_start_at` 포함) + `match_players` 10줄, 중복 `DO NOTHING`
- `run`·`matches`가 집계 함수를 부르지 않음, 창 상한 25,000에서 `window_full`
- 변환 규칙 4장 전부 (밴 `pickTurn`, `""` → NULL, `NORMAL`만, `summoner1Id/2Id`, 아이템 0)
- 제한기 19/98, 실제 수집에서 429 0회 (또는 429를 재시도로 처리)
- 401/403: 즉시 멈춤, `key_expired`, `finished_at`, 종료 코드 2
- 다시 실행하면 이어서 모음, 동시에 두 번 실행하면 두 번째가 잠금으로 종료(3)
- Ctrl+C 130, 잠금 연결 끊김 1, 둘 다 `failed`이고 `running`이 남지 않음
- `aggregate`: 같은 연결 `ANALYZE` → `refresh_window_stats(14)`, `statement_timeout 5min`, P0002는 경고 + 1
- `purge`는 미리보기만, `--yes`일 때만 `purge_old_games(21)`

### 10-3. API

- 엔드포인트 4개가 `api_contract.md` v2의 경로·파라미터·응답 필드·null 여부와 일치
- `tier`는 뷰 값 그대로, 정렬 `tier NULLS LAST, tier_score DESC, champion_id`
- 주 포지션 최대 2개, 2순위 10% 기준
- `window.patches[]` 최신 순, `displayName` = 메이저 + 10, `share` 소수 2자리
- `isStale` 26시간 경계, `/health` `stats.state` 3가지
- 통계 엔드포인트가 요청마다 `REPEATABLE READ READ ONLY` 트랜잭션 1개로 읽음
- `stats_window` 0줄 → 3개 엔드포인트 `503 STATS_NOT_READY` + `no-store`
- `patch` 쿼리는 무시 (400 아님)
- 오류 형식·코드, 5xx에 내부 내용 없음, 캐시 헤더 (성공 `public, max-age=600`, 오류 `no-store`)

### 10-4. 보안

- 로그·문서·응답·커밋에 `RIOT_API_KEY`, `DATABASE_URL` 값 없음 (`grep`)
- 문서·로그에 전체 puuid 없음 (앞 8자만)
- `.env.example`은 새 변수가 생길 때만 그 변수를 추가

### 10-5. 변경 02 (L1~L5, 계약 문구, 프리셋)

- 표본 보충은 모자란 만큼만 더하고, `--resample`이면 전체를 다시 뽑는다 (02-2)
- 중단·실패로 끝난 실행의 요약 로그 `stoppedBy`가 `aborted`/`failed`로 남는다 (02-3)
- ② 게임 ID 조회에도 연속 20개 실패 상한이 있다 (02-4)
- `/health` DB 오류가 서버 로그에 남는다 (응답은 `DB_UNAVAILABLE` 그대로, 02-5)
- `withTransaction`·`readSnapshot`이 빌린 연결에 `logger`를 넘기면 `'error'` 리스너를 붙인다 (02-6)
- `config/collection.ts`의 `test.playersPerTier === 250` (02-7)
- `docs/contracts/api_contract.md` 2-4 문구·6장 날짜 순서가 고쳐졌다. 응답 필드·형식은 그대로다 (02-8)
- 15명 400은 조치 없이 `back_overview.md` 10장에서 "조사 완료"로 닫힌다 (02-1, V1)

---

## 11. 계약 변경 요청

> 요약: DB 계약을 바꿀 필요는 없다. v8의 테이블·함수·뷰만으로 구현했다. 다음 `!db` 작업 때 맞출 문구만 남긴다.

- **DB 계약 변경 요청: 없음.** (db 계약 v8, 변경 04가 테스트 수집 인원을 "티어당 250명"으로 이미 확정해 1번 항목은 해소됐다)
- 다음 `!db` 문구 수정 때 참고 (변경 요청 아님):
  1. 계약 7장 "창 밖 게임": Riot `startTime`이 게임 생성 시각 기준일 수 있어 경계의 몇 게임이 `out_of_window`로 빠진다. "경계의 몇 게임은 정상"을 더하면 오해가 없다.
  2. 계약 7장 "짝이 없으면 수집 로그에 경고": `collection_logs`에 경고 컬럼이 없어 stdout 로그로 처리한다.
  3. `matches.game_start_at` 인덱스는 필요 없다 (창 상한·`purge` 미리보기는 최대 약 3만 7천 줄 순차 스캔).
  4. 표본 삭제 기능이 생기면 `matches(puuid)` 인덱스가 필요하다 (db_review L3).
- API 계약(백엔드가 작성 영역) 문구 2건은 변경 02에서 고쳤다 (2-4 아이템 거르기 설명, 6장 변경 기록 날짜 순서).

---

## 12. 결정 사항

> 요약: 지금 유효한 결정만 둔다. 나중에 바뀐 결정(패치 기준 대체 규칙 D3, 수집 뒤 자동 집계 D10 등)은 git 기록에만 있다.

| # | 결정 | 이유 | 날짜 |
|---|------|------|------|
| D1 | TS는 `tsx`로 바로 실행하고 `tsc --noEmit`으로 검사한다 | 빌드 단계가 없어 단순하다. 배포 단계에서 필요하면 `tsc` 빌드를 더한다 | 2026-10-14 |
| D2 | 테스트는 `node:test` + `node:assert` | 의존성 0. 비동기·가짜 함수·describe가 다 있다 | 2026-10-14 |
| D4 | 상세 아이템은 전부 pick 순으로 준다 | 프론트가 하위 재료를 거른 뒤 고르므로 충분히 줘야 한다. 챔피언×포지션당 약 5KB | 2026-10-14 |
| D5 | 성공 `public, max-age=600`, 오류 `no-store`, ETag·서버 메모리 캐시 없음 | 데이터는 하루 1번 집계 때만 바뀐다. Next.js가 자체 캐시한다 | 2026-10-14 |
| D6 | CORS를 켜지 않는다 | 프론트가 Next 서버에서 부르므로 브라우저 출처 검사가 없다. 브라우저에서 직접 부를 일이 생기면 그때 켠다 | 2026-10-14 |
| D7 | 수집 상태는 DB에만 둔다 (`ranked_players`·`matches`·`collection_logs`) | 저장된 게임이 곧 진행 상태라 꼬일 일이 없다 | 2026-10-14 |
| D8 | 플레이어당 20게임, 표본은 page 1에서 시드 있는 무작위 | 20은 계약 권장값. page 1 순서가 LP 등에 치우칠 수 있어 무작위가 고르다. 시드를 로그에 남겨 재현 가능 | 2026-10-14 |
| D9 | `purge`는 `--yes`로만 수동 실행한다. 사용자 승인 없이 `--yes`를 쓰지 않는다 | 되돌릴 수 없는 삭제라 실행 전 승인 규칙과 맞다 | 2026-10-14 |
| B1 | 잠금 실패는 종료 코드 3, `aggregate`·`purge`는 `collection_logs`에 남기지 않는다 | "다른 수집이 실행 중"을 실패(1)와 구별. `lastCollectedAt`이 수집 시각만 뜻하게 | 2026-10-14 |
| B2 | 제한기가 응답 헤더(`X-App-Rate-Limit-Count`)로 사용량을 맞춘다 | 새 실행은 직전 실행 사용량을 모른다. 실제로 재실행 때 429 없이 기다렸다 | 2026-10-14 |
| B3 | fixture의 puuid·riotId·소환사 이름을 가짜 값으로 바꾼다 | 실제 사용자 식별 정보를 저장하지 않으려고 | 2026-10-14 |
| U1 | 게임 ID 요청에 `startTime = 지금 − 14일`(초)을 넣는다 | 받은 뒤 오래된 패치를 거르면 상세 호출의 57%가 낭비됐다 | 2026-10-15 |
| U2 | `matches.game_start_at`을 저장한다 (`gameStartTimestamp`) | DB v7 창 집계의 기준 | 2026-10-15 |
| U3 | 수집 뒤 자동 집계를 하지 않는다. 집계는 매일 05:00 KST pg_cron, `aggregate`는 시험용 | 집계 시점을 하나로 모아 수집과 분리한다 | 2026-10-15 |
| U4 | 원본 정리는 `purge_old_games(21)`, 수동, `--yes` 필요 | 14일 창 + 여유 7일. 되돌릴 수 없는 삭제 | 2026-10-15 |
| U6 | API에서 `patch` 파라미터와 직전 패치 대체를 없애고 `window` 객체를 준다 | DB가 패치 단위가 아니라 14일 창 하나가 됐다 | 2026-10-15 |
| U7 | 패치 공개 이름 `displayName` = 메이저 + 10 (`16.20` → `26.20`) | 공개 패치 이름과 맞춘다 (사용자 결정, 옵션 A). 내부 값은 Data Dragon 버전에 계속 쓴다 | 2026-10-15 |
| U9 | pg_cron 기본 권한은 기본값 유지 | `!db` 영역 판단 (db_review L8). 백엔드가 할 일 없음 | 2026-10-15 |
| D11 | 한 요청의 읽기는 `REPEATABLE READ READ ONLY` 트랜잭션 1개 | 기존 쿼리를 거의 그대로 쓰고, 복잡한 한 문장 SQL이 필요 없다. 비용은 왕복 2번 | 2026-10-15 |
| D12 | 집계 멈춤은 `window.isStale`(26시간) + `/health` `stats.state` + 서버 경고 로그로 보인다 | 화면과 운영 둘 다 보인다. 오래됐다고 `/health`를 503으로 하면 원인을 헷갈린다 | 2026-10-15 |
| D13 | 집계 전에는 `/meta`·목록·상세 모두 `503 STATS_NOT_READY` | 단순하고 `no-store`라 첫 집계 직후 바로 바뀐다 | 2026-10-15 |
| D14 | 경로는 `/api/v1` 유지, 계약 v2가 v1을 대체, 옛 `patch` 쿼리는 무시 | 바꿀 당시 이 API를 쓰는 화면이 없었다 | 2026-10-15 |
| D15 | 창 안 25,000게임이면 실행을 멈춘다 (`window_full`) | 창 안 게임은 모두 같은 창이라 하나씩 건너뛰면 호출만 낭비된다 | 2026-10-15 |
| D16 | 남아 있던 에메랄드 표본을 지우지 않는다 | 삭제는 되돌릴 수 없고 승인이 필요하다. 통계 영향이 작다 | 2026-10-15 |
| D17 | 패치 비율 `share`는 소수 2자리 | 계약 "비율은 소수 2자리" 규칙 하나로 맞춘다 | 2026-10-15 |
| R1 | 테스트 수집은 `--players-per-tier 250`으로 실행한다 | 14일 안 게임이 있는 표본이 33%뿐이라 100명이면 게임 수가 예상의 1/3이었다. 0게임 표본 비용이 작다 | 2026-10-15 |
| V1 | 15명 400은 조치하지 않는다 (원인: 이전 만료 키 시기에 뽑히고 재확인 안 된 표본) | 영향이 ② 호출 15회/8,722회(0.17%)뿐이고 저장 실패로 이어지지 않는다. `ranked_players` DELETE는 되돌릴 수 없다 | 2026-10-16 |
| V2 | 표본 보충은 모자란 만큼만 더한다 (`--resample`은 전체를 다시 뽑아 더함) | 매번 전체를 더하면 표본이 계속 불어난다 (에메랄드가 265명이 된 사례) | 2026-10-16 |
| V3 | 요약 로그 `stoppedBy`에 `aborted`·`failed`를 더한다 | `collection_logs.status`는 정확했지만 stdout 요약만 보면 헷갈렸다 | 2026-10-16 |
| V4 | ② 게임 ID 연속 실패 상한은 ③~⑤와 같은 값(20)을 재사용한다 | 둘 다 "Riot 쪽 장애"의 신호라 같은 기준이면 충분하고, 설정값이 늘지 않는다 | 2026-10-16 |
| V5 | `/health` 오류를 서버 로그에 1줄 남긴다 (응답은 `DB_UNAVAILABLE` 그대로) | 로그가 없으면 연결 거부·타임아웃·권한 등 실제 원인을 구분할 수 없다 | 2026-10-16 |
| V6 | `withTransaction`·`readSnapshot`에 선택적 `logger` 매개변수로 연결 오류 리스너를 더한다 | `CollectorLock`과 같은 이론적 위험(처리되지 않은 `'error'`로 프로세스가 죽음)을 줄인다. 로그만 남기고 멈추지 않는다 | 2026-10-16 |
| V7 | `test` 프리셋 기본값을 250으로 맞춘다 | db 계약 v8(변경 04)과 실제 운영값(R1)에 맞춘다 | 2026-10-16 |
| V8 | `api_contract.md` 2-4 문구와 6장 날짜 순서를 고친다 (응답 필드는 안 바꿈) | 프론트 실제 동작·시간 순서와 맞춘다 | 2026-10-16 |

- D 번호는 계획의 결정 항목, B는 Build가 정하고 Review가 받아들인 것, U는 변경 01의 사용자 결정, R은 Review 추천을 사용자가 고른 것, V는 변경 02에서 사용자가 승인한 결정(02-9)이다.

---

## 13. 작업 범위

> 요약: 단계마다 고칠 수 있는 경로를 정한다. 이 밖은 수정하지 않고 메인 에이전트에게 보고한다.

| 단계 | 수정 가능 경로 | 비고 |
|------|----------------|------|
| Plan | `backend/docs/back_spec.md`, `docs/contracts/api_contract.md` | 계획과 API 계약 초안 |
| Build | `backend/` (코드, 설정, 테스트, fixture 도우미), `backend/docs/back_build.md` | |
| Build | `docs/contracts/api_contract.md` | 승인된 변경만 |
| Build | `.env.example` | 새 변수가 생길 때만 |
| Review | `backend/docs/back_review.md`, `backend/docs/back_build.md`, `backend/docs/back_overview.md` | 검토 결과, 고친 기능 반영, 현재 상태 덮어쓰기 |
| Review | `backend/` 안의 수정 | 검토에서 찾은 문제 |
| Review | `docs/career_log.md` | 아래에 추가만 (기존 기록 수정 금지) |

- 수정 금지: `db/`, `docs/contracts/db_contract.*`, `frontend/`, 루트 `.env`, `CLAUDE.md`.
- 변경 02(15명 400 조사, L1~L5, 프리셋 250, 계약 문구 2건)도 위 표와 같은 경로를 쓴다. 조사(02-1)는 읽기만(`SELECT`, 로그 읽기), 결정 1번이 "삭제"면 `ranked_players` DELETE는 사용자 승인 후에만.
- DB 쓰기: 통합 테스트는 ROLLBACK만. 실제 저장은 Review 소량 수집과 `aggregate` 시험뿐. **`purge --yes`, 표본 삭제, 그 밖의 되돌릴 수 없는 SQL은 메인 에이전트를 통해 사용자 승인 후에만.**
- Riot 호출: Build·Review는 확인용 소량(수십 회)만. fixture는 이미 있어 새로 받지 않는다. 전체 테스트 수집은 사용자가 직접 실행한다.
- 비밀값: `.env` 값은 읽어 써도 되지만 문서·로그·커밋·응답에 출력하지 않는다. 잘못된 키 시험은 프로세스 환경에만 넣고 `.env`를 고치지 않는다.

