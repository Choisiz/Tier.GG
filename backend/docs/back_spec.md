# 백엔드 계획서 — 수집 워커 + 챔피언 통계 API

> 상태: **승인됨** (v1 2026-10-14, 변경 01 2026-10-15, 변경 02 2026-10-16, 변경 03 2026-10-27, 변경 04 2026-10-30, 변경 05 2026-11-03)
> 읽는 계약: `docs/contracts/db_contract.md`, `docs/contracts/db_contract.dbml` **v8** (최근 14일 기준, 변경 04: 룬 보조 정렬·수집 범위 티어당 250명)
> 작성하는 계약: `docs/contracts/api_contract.md` **v4** (전적 검색 추가 2026-10-27, 킬관여·라인전 15분 골드 추가 2026-10-30, 게임 피드백 분석 POST 추가 2026-11-03)
> 이 문서는 **지금 계획만** 적는다. 패치 기준이던 v1 계획과 변경 01·02·03·04·05 원문(04의 설계 비교·실측 근거, 05의 사용자 결정 질문 포함)은 git 기록(`87cfc78`, 변경 02~04는 각 Build 커밋 이전)에 남아 있다.

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
  - [5-7. 전적 검색 (변경 03)](#5-7-전적-검색-변경-03)
  - [5-8. 킬관여·라인전 15분 골드 (변경 04)](#5-8-킬관여라인전-15분-골드-변경-04)
  - [5-9. 게임 피드백 분석 (변경 05)](#5-9-게임-피드백-분석-변경-05)
  - [5-10. 매치 상세 지표 (변경 06)](#5-10-매치-상세-지표-변경-06)
- [6. 오류 처리와 로깅](#6-오류-처리와-로깅)
  - [6-4. 게임 피드백 분석 로그와 비밀값 (변경 05)](#6-4-게임-피드백-분석-로그와-비밀값-변경-05)
- [7. 설정값](#7-설정값)
  - [7-6. 게임 피드백 분석 (config/feedback.ts, 변경 05)](#7-6-게임-피드백-분석-configfeedbackts-변경-05)
- [8. 의존성](#8-의존성)
- [9. 테스트 전략](#9-테스트-전략)
  - [9-5. 게임 피드백 분석 테스트와 비용 (변경 05)](#9-5-게임-피드백-분석-테스트와-비용-변경-05)
- [10. 완료 기준](#10-완료-기준)
  - [10-5. 변경 02 (L1~L5, 계약 문구, 프리셋)](#10-5-변경-02-l1l5-계약-문구-프리셋)
  - [10-6. 변경 03 (전적 검색)](#10-6-변경-03-전적-검색)
  - [10-7. 변경 04 (킬관여·라인전 15분 골드)](#10-7-변경-04-킬관여라인전-15분-골드)
  - [10-8. 변경 05 (게임 피드백 분석)](#10-8-변경-05-게임-피드백-분석)
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
| 8 | 계약 | `docs/contracts/api_contract.md` v3 |
| 9 | 전적 검색 (변경 03) | `GET /api/v1/summoners/kr/:riotId`: account-v1 → summoner-v4 + league-v4(병렬) → match-v5 ids → 상세 20건(병렬, 일부 실패 허용). DB 저장 없음, API 프로세스 메모리에 60초 캐시 |
| 10 | 킬관여·라인전 (변경 04) | 2-5 각 매치에 `killParticipation`(추가 호출 없음) + `GET /api/v1/matches/lane-gold`(timeline에서 15분 골드 격차, 경기 ID별 6시간 캐시, 한도가 모자라면 `pending`). 5-8 참고 |

### 1-2. 하지 않는 것

| 항목 | 이유 |
|------|------|
| 수집 뒤 자동 집계 | DB 예약 작업 `tiergg_daily_refresh`가 매일 05:00 KST에 집계한다 (결정 U3) |
| 본 수집 (에메랄드 이상, 14일 창 최대 25,000게임) | 테스트 뒤 다시 정한다. `main` 프리셋은 자리만 있다 |
| 마스터 이상 리그 API (`masterleagues` 등) | 본 수집 범위. 테스트는 디비전이 있는 티어만 |
| 스케줄러(자동 수집) | 개발 키가 24시간마다 만료된다. 수집은 사람이 직접 실행한다 |
| HTTP로 수집 실행 | 예전 실수. 수집은 CLI로만 하고, API는 읽기 전용이다 |
| SSE 새로고침, AI 피드백 | 이후 단계 |
| 전적 검색의 챔피언별 통계·플레이 스타일·숙련도 탭, 과거 매치 더보기, 스킬 순서(타임라인) | 변경 03 1차 범위 밖(검색→프로필→최근 매치 20건까지). 다음 단계 |
| 전적 검색 결과의 DB 영구 저장 | 사용자가 검색한 임의의 소환사를 표본 수집(공정한 티어별 통계용) 테이블에 끼워 넣으면 표본이 편향된다. 메모리 캐시로 충분 (변경 03 W-6) |
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
│   │   ├── env.ts              # 환경 변수 읽기·검사 (값은 출력하지 않음). loadRiotEnv()는 수집 CLI와 API 서버(변경 03)가 함께 쓴다
│   │   ├── collection.ts       # 수집 프리셋(test, main), Riot 클라이언트 설정, windowStart()
│   │   ├── api.ts              # API 규칙 상수 (WINDOW_DAYS, STALE_AFTER_HOURS 등)
│   │   └── summoner.ts         # 전적 검색 설정: 캐시 TTL·크기, API 전용 Riot 제한기(변경 03, 18/90으로 변경 04), 라인전 상수(변경 04)
│   ├── db/
│   │   ├── pool.ts             # pg Pool, 연결 오류 판별, 오류 메시지 가리기
│   │   ├── tx.ts               # withTransaction, inTransaction, Queryable 타입
│   │   └── snapshot.ts         # readSnapshot: REPEATABLE READ READ ONLY 트랜잭션 1개
│   ├── riot/
│   │   ├── rateLimiter.ts      # 이중 창 제한기 (시계 주입 가능)
│   │   ├── client.ts           # fetch + 제한기 + 재시도 + 오류 분류, limiterWaitMs()(변경 04)
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
│   │   ├── app.ts              # createApp(db, logger, { now, summonerSearch, laneGold }) — 테스트에서 롤백 연결·고정 시계·가짜 함수를 넣을 수 있게
│   │   ├── routes/meta.ts      # GET /api/v1/health, /api/v1/meta
│   │   ├── routes/champions.ts # GET /api/v1/champions, /api/v1/champions/:championId
│   │   ├── routes/summoners.ts # GET /api/v1/summoners/:region/:riotId (변경 03, window 없음)
│   │   ├── routes/matches.ts   # GET /api/v1/matches/lane-gold (변경 04, window 없음)
│   │   ├── laneGold.ts         # 라인전 계산 순수 함수 + 서비스(캐시·진행 중 공유·한도·오류 매핑) (변경 04)
│   │   ├── matchLaneCache.ts   # 경기 캐시: 경기 길이·참가자 10명 정보·gold15, TTL 6시간·5,000개 (변경 04)
│   │   ├── summonerSearch.ts   # account-v1→summoner-v4+league-v4(병렬)→match-v5 ids→상세, 캐시, 오류 매핑 (변경 03)
│   │   ├── summonerCache.ts    # Map 기반 TTL 캐시, 최대 200개 (변경 03)
│   │   ├── window.ts           # window 객체, displayName, share, isStale, 503, 오래됨 경고
│   │   ├── validate.ts         # position, championId, region, riotId, puuid, matchIds 검사 (직접 작성)
│   │   ├── errors.ts           # ApiError, 오류 응답 형식, 오류 미들웨어
│   │   ├── mainPositions.ts    # 주 포지션 최대 2개 규칙
│   │   ├── cache.ts            # Cache-Control 헤더 한 곳
│   │   └── dto.ts              # DB 줄 → 응답 DTO, 소환사 검색 DTO(변경 03), killParticipationPercent(변경 04)
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
| API 서버 | `npm run dev` (watch) / `npm start` | 읽기 API + 전적 검색(변경 03, Riot을 직접 호출). `collector/*`는 import하지 않는다 | 읽기만 |
| 수집 CLI | `npm run collect -- <하위 명령> [옵션]` | Riot 호출, 저장, 시험용 집계, 정리 | 읽기·쓰기 |

- **(변경 03) API 서버가 `RIOT_API_KEY`를 읽는다** — 전적 검색(소환사 상세)이 Riot을 직접 불러야 해서다. 예전 전제("API 서버는 Riot 키를 읽지 않는다")는 더 이상 맞지 않는다. 단, `collector/*`는 여전히 import하지 않는다(경계는 "Riot 키를 읽느냐"가 아니라 "수집 코드를 쓰느냐"로 바뀜).
- 키가 없거나 형식이 잘못돼도 API 서버는 계속 켜진다. 전적 검색만 모든 요청에서 503 `RIOT_KEY_EXPIRED`를 준다 (개발 키가 24시간마다 만료되므로 그 때문에 챔피언 통계까지 막히면 안 됨).
- 수집 CLI는 `RIOT_API_KEY`가 없으면 바로 종료한다 (기존과 동일).
- API 서버와 수집 CLI는 각자 `RateLimiter` 인스턴스를 따로 둔다 (다른 프로세스라 메모리 제한기를 공유할 수 없음). API 전용 한도는 Riot 실제 한도의 절반(1초 10회, 2분 50회) — 수집 CLI가 동시에 돌 수 있어 여유를 둔다.

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

> 요약: 읽기 전용 GET 엔드포인트 5개. 통계 4개는 숫자 ID와 개수·비율, 그리고 어느 14일 창의 통계인지(`window`)를 준다. 전적 검색(변경 03)은 `window`가 없고 Riot을 그 자리에서 중계한다. 자세한 형식은 `docs/contracts/api_contract.md` v3.

| 메서드·경로 | 화면 | 내용 |
|-------------|------|------|
| `GET /api/v1/health` | (운영) | 서버·DB 확인 + `stats: { state, aggregatedAt }` |
| `GET /api/v1/meta` | 공통 (푸터 등) | `window`, `lastCollectedAt`(마지막 `done` 수집), `positions`, `rules{minTierPick, secondaryPositionMinShare, windowDays, staleAfterHours}` |
| `GET /api/v1/champions?position=TOP` | 챔피언 리스트(티어) | 그 포지션이 주 포지션인 챔피언, 티어 → 점수 순, `window` |
| `GET /api/v1/champions/:championId[?position=]` | 챔피언 상세 | 주 포지션(최대 2개), 선택 포지션 통계, 아이템(전체)·룬·스펠·스킬(상위 2개), `window` |
| `GET /api/v1/summoners/kr/:riotId` (변경 03) | 전적 검색 | 프로필, 랭크 전체, 최근 매치 20건(큐 필터 없음). `window` 없음, 캐시 `no-store` (5-7) |

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

### 5-7. 전적 검색 (변경 03)

> 요약: `riotId`(`gameName-tagLine`)로 소환사를 찾아 프로필·랭크·최근 매치 20건을 Riot에서 그 자리에서 받아 돌려준다. DB에 저장하지 않고 60초만 메모리에 캐시한다. `window`가 없는 유일한 엔드포인트다.

| 항목 | 규칙 |
|------|------|
| 경로 | `GET /api/v1/summoners/:region/:riotId`. `region`은 `kr`만 허용(그 밖은 400, 결정 S1) |
| `riotId` 파싱 | 마지막 `-`에서 `gameName`/`tagLine`으로 자른다 (결정 S2). `tagLine`은 `^[0-9A-Za-z]{2,5}$` |
| Riot 호출 순서 | account-v1(지역) → summoner-v4 + league-v4 by-puuid(플랫폼, **병렬**) → match-v5 ids(지역, 큐 필터 없음 count=20) → match-v5 상세 × 최대 20(지역, **병렬**, 일부 실패는 그 매치만 빼고 응답) |
| 새 클라이언트 메서드 | `getAccountByRiotId`, `getSummonerByPuuid`, `getLeagueEntriesByPuuid`, `getRecentMatchIds` (수집기 전용 `getMatchIds`와 별도). `getMatch`는 기존 메서드 재사용 |
| 타임라인 | 검색 안에서는 부르지 않는다. 룬·스펠·아이템·KDA·CS·킬관여는 `getMatch` 응답에 다 있다. 스킬 순서는 범위 밖. 라인전용 timeline은 5-8의 별도 엔드포인트가 부른다 (변경 04) |
| 캐시 | `src/api/summonerCache.ts`, Map 기반, 키 `region:소문자gameName#소문자tagLine`, TTL **60초**(결정 S4), 최대 **200개**(넘치면 가장 오래 넣은 것부터 지움), 실패 응답은 캐시하지 않음 |
| API 전용 제한기 | 1초 18회, 2분 90회 (변경 04 결정 X1로 10/50에서 올림). 수집 CLI와 공유하지 않는다 (다른 프로세스). **운영 규칙: 수집 CLI와 API 서버를 같은 키로 동시에 돌리지 않는다** (합이 Riot 실제 한도 20/100을 넘는다) |
| `ApiDeps` 주입 | `summonerSearch(region, gameName, tagLine)` 함수 하나로 감싼다 (결정 S7). 라우트는 `RiotClient` 세부사항(캐시, 오류 매핑)을 모른다 |
| 오류 매핑 | account-v1 404 → 404 `SUMMONER_NOT_FOUND`. 401/403 → 503 `RIOT_KEY_EXPIRED`(이 요청만 실패, 서버는 멈추지 않음, 매 요청 로그 — 결정 S5). 429·5xx 재시도 소진 → 502 `RIOT_UNAVAILABLE`. league 빈 배열·match ids 빈 배열은 오류 아님 |
| 캐시 적중 표시 | 응답에 표시하지 않는다 (결정 S6). 서버 로그(캐시 적중/미스 1줄)로만 확인 |
| 캐시 헤더 | `no-store` (검색 결과는 거의 실시간이어야 함. 통계 4개의 `public, max-age=600`과 다름) |
| DB 영향 | 없음. 표본 수집 테이블(`ranked_players` 등)에 끼워 넣지 않는다 (W-6, 계약 변경 요청 없음) |

### 5-8. 킬관여·라인전 15분 골드 (변경 04)

> 요약: 매치 행에 **킬관여 %**와 `45:55` 같은 **라인전 점수**를 보여주기 위한 데이터다. 킬관여는 match-v5 상세에 이미 있어 2-5 응답에 그대로 합친다(추가 호출 0). 15분 골드는 timeline에만 있어 호출량이 커서 **별도 지연 로딩 엔드포인트**로 나눴다(첫 화면을 지킨다). DB·수집 워커·db 계약은 건드리지 않는다.

**(1) 킬관여: `matches[].killParticipation`**

| 항목 | 규칙 |
|------|------|
| 값 | 정수 %, `Math.round(비율 × 100)` |
| 우선 출처 | `participants[].challenges.killParticipation`(0~1). 숫자면 그대로. 100 초과도 자르지 않는다 |
| 대체 계산 | 필드가 없거나 숫자가 아니면 `(내 kills + assists) ÷ 내 팀 5명 kills 합` |
| `null` | 대체 계산에서 팀 킬 합이 0 |
| 호출 | 추가 Riot 호출 0회. `ParticipantDto.challenges?`를 선택 필드로 추가, `dto.ts`의 `killParticipationPercent`에서 계산 |

**(2) 라인전: `GET /api/v1/matches/lane-gold?puuid=&matchIds=` (api_contract 2-6)**

| 항목 | 규칙 |
|------|------|
| 값 | `myPercent = Math.round(내 totalGold × 100 ÷ (내 + 상대))`, `myGold`·`enemyGold`도 함께. 둘 다 0이면 `unavailable` |
| 골드 출처 | timeline `info.frames[15].participantFrames["<participantId>"].totalGold` (프레임은 매분, index 15 = 15:00 근처). `participantId`는 match-v5 상세의 값으로 찾는다 |
| 상대 | 내 `individualPosition`과 같은 값을 가진 **적 팀 참가자 정확히 1명**. 정글·서폿 포함 |
| `unavailable` | ① `frames.length ≤ 15` ② 포지션이 비었음/`Invalid`/5개 밖 ③ 적 팀 같은 포지션이 0명 또는 2명 이상 ④ 내/상대 `totalGold` 없음 ⑤ timeline·match 404 ⑥ `puuid`가 참가자가 아님. 다시 요청해도 같으므로 프론트는 `-` |
| 호출 생략 | `gameDuration < 900`이거나 ②·③·⑥이면 **timeline을 부르지 않고** 바로 `unavailable` (이 경우 `gold15`를 캐시하지 않는다: 같은 경기의 다른 참가자는 대상일 수 있다) |
| 호출 순서 | 경기 캐시 → 없으면 getMatch 1회(검색이 넣어 둔 게 보통 있음) → 생략 규칙 → timeline 1회 → `gold15`(참가자별 숫자 최대 10개)만 저장. timeline 원본(약 0.6MB)은 저장하지 않는다 |
| 경기 캐시 | `matchLaneCache.ts`. 키 `matchId`, 값 `{ durationSec, players[10]{participantId, puuid, teamId, position}, gold15? }`. TTL **6시간**, 최대 **5,000개**, 넘치면 가장 오래 넣은 것부터 지움. `gold15 = null`은 "계산 불가(프레임 부족/404)"를 기억해 다시 부르지 않음. `summonerSearch`가 매치 상세 20건을 받을 때 같은 값을 추가 호출 없이 넣어 두되, 이미 `gold15`가 있는 항목은 덮어쓰지 않는다 |
| 소환사 캐시와 관계 | 기존 60초 소환사 캐시는 그대로. 라인전 값은 소환사 캐시에 넣지 않는다(60초 후 사라져 재호출되는 것을 막으려고) |
| 입력 | `puuid` `^[0-9A-Za-z_-]{1,100}$`, `matchIds` 쉼표 구분 1~**10**개 각 `^KR_[0-9]{1,15}$`. 11개 이상·빈 항목·배열 쿼리는 400 `INVALID_PARAMETER`. 20게임이면 프론트가 10개씩 2번. Riot에 보내는 ID는 `encodeURIComponent`(기존 클라이언트) |
| 중복 방지 | 같은 `matchId`를 동시에 두 요청이 가져가면 "진행 중 Promise"를 공유해 Riot을 한 번만 부른다(getMatch·timeline 각각) |
| 한 요청 안 동시성 | 경기 5개씩 병렬 |
| 한도 정책 | 새 Riot 호출을 시작하기 전 `RiotClient.limiterWaitMs()`(제한기 `waitTime`, 0 이상)를 본다. **대기 > 1.5초**면 그 호출부터 남은 ID는 `pending`(캐시로 되는 ID는 그대로 `ready`). 응답 `retryAfterSec` = 본 대기시간 중 최댓값을 올림(1~120). **HTTP는 200**(429를 프론트에 넘기지 않는다). 검색이 먼저 줄 서도록 라인전은 한도에 여유가 있을 때만 쓴다 |
| 프론트 재시도 | `pending`은 `retryAfterSec` 뒤 그 ID만 다시, 최대 3번 (계약에 명시, 구현은 `!프론트` 몫) |
| Riot 오류 | 401/403 → 503 `RIOT_KEY_EXPIRED`(이 요청만 실패, 서버는 계속 동작, 매 요청 로그). 429·5xx 재시도 소진 → 502 `RIOT_UNAVAILABLE`(이미 채운 결과는 캐시에 남음). timeline 404 → 그 게임 `unavailable`+`gold15=null` 캐시. getMatch 404 → `unavailable`(빈 정보 `gold15=null`로 캐시). 그 밖(`RiotBadRequestError` 등)은 500 |
| 로그 | 요청 1줄: `ready/unavailable/pending` 수, `riotCalls`, `cacheHits`, puuid 앞 8자. 요청 로그(`app.ts`)도 쿼리의 `puuid`를 앞 8자로 줄인다 |
| 캐시 헤더 | `no-store` (서버가 경기별로 6시간 캐시. pending 섞인 응답을 HTTP 캐시가 붙잡지 않게) |
| 새 Riot 메서드 | 없음 (`getMatch`, `getTimeline` 재사용). 제한기 대기시간 getter `limiterWaitMs()` 1개만 `client.ts`에 추가. `TimelineDto.frames[].participantFrames?`는 선택 필드라 수집기는 영향 없음 |

**호출량 (참고, 실측은 back_build 4-7)**: 검색 1회(캐시 미스) 24회 그대로. 라인전은 신규 경기당 최대 +1(timeline), 20게임이면 최대 +20. 짧은 게임·포지션 없는 게임(칼바람 등)은 호출이 줄어든다. 제한기는 18/90이라 신규 검색 1회(최대 44회) 뒤 같은 2분 안의 두 번째 소환사까지 무대기로 가능(88 ≤ 90). 같은 소환사 재검색은 라인전 0회.

**하지 않기로 한 것**: (a) 라인전을 2-5 응답에 합치기(A안): 첫 화면이 약 2배 느려지고 한도를 즉시 소진한다. (b) 검색의 `getMatch` 상세를 경기 캐시에 통째로 넣어 24회를 4회로 줄이기: 상세 1개가 수십~백 KB라 메모리가 커지고 라인전과 별개의 최적화라 다음 변경으로 미룬다. (c) timeline 원본 캐시: 0.6MB라 5,000개면 3GB.

### 5-9. 게임 피드백 분석 (변경 05)

> 요약: 매치 행을 펼친 안쪽 "AI 분석" 버튼이 부르는 `POST /api/v1/matches/:matchId/feedback`(api_contract v4 2-7). Riot match·timeline 2회 → `!ai` 판정 엔진 → LLM 문장 → 숫자 검증 → 템플릿 대체를 그대로 호출하고 서버 메모리에 캐시한다. DB는 쓰지 않는다. 코드는 `src/api/feedback/`.

#### 5-9-0. 한눈에 보기와 사용자 결정

요약: 매치 행 안의 "AI 분석" 버튼을 누르면 프론트(Next 서버)가 `POST /api/v1/matches/:matchId/feedback`을 부른다. 백엔드는 Riot에서 그 판의 match·timeline을 받아(2회) `!ai` 2단계 파이프라인(엔진 → LLM 문장 → 숫자 검증 → 재시도 → 템플릿)을 **그대로 호출**하고, 결과를 서버 메모리에 캐시한다. DB는 쓰지 않는다. 계약 1장 "GET만" 규칙이 바뀌므로 **전체 독립 Review** 대상이다.

| # | 사용자 결정 (2026-11-03, 추천대로 승인, 12장 F1~F7) | 반영한 곳 |
|---|------|------|
| 1 | 화면 위치: 매치 행을 펼친 안쪽 (프론트 몫) | 5-9-11 |
| 2 | 분석 대상: **검색한 소환사 본인만** (요청 `puuid`가 그 판 참가자여야 함) | 5-9-1, 5-9-4 ③ |
| 3 | 분석할 판: **솔로랭크(420)·자유랭크(440), 15분(900초) 이상**. 그 밖은 422 | 5-9-4 ④⑤ |
| 4 | 하루 분석 상한 **20회**: 실제 LLM 호출이 일어난 분석만 셈, 캐시 적중 제외, KST 자정 초기화 | 5-9-8 |
| 5 | 상한 초과 시 템플릿 대신 **"오늘 분석 한도 초과" 오류(429)** | 5-9-3 |
| 6 | 결과 저장: **서버 메모리 캐시**(재시작하면 사라짐). DB 테이블 없음 | 5-9-7 |
| 7 | 버튼을 눌렀을 때만 분석 (자동 분석 없음) | 5-9-11 |

- RAG는 3·4단계 뒤에 붙는다. 지금은 RAG 없는 2단계 파이프라인을 쓰고, 응답에 `meta.knowledgeVersion: null` 자리를 미리 둬서 **RAG를 붙여도 응답 모양이 바뀌지 않게** 한다(캐시 키에도 미리 넣는다).
- 하지 않는 것: DB 저장, 자동 분석, 다른 참가자 분석, 비동기 작업 번호(폴링), 사용자별 속도 제한, 스트리밍(SSE), `!ai` 코드 수정.

#### 5-9-1. 엔드포인트와 요청 검증

요약: 비용이 드는 요청이라 **POST**로 연다. `puuid`는 본문(JSON)에 넣어 요청 로그·URL에 남지 않게 한다.

```http
POST /api/v1/matches/KR_8437852704/feedback
Content-Type: application/json

{ "puuid": "abcd1234…" }
```

| 이름 | 위치 | 검사 (기존 `validate.ts` 재사용) | 실패 |
|------|------|------|------|
| `matchId` | 경로 | `^KR_[0-9]{1,15}$` (2-6과 같음) | 400 `INVALID_PARAMETER` `details.param="matchId"` |
| `puuid` | 본문 | `parsePuuidParam`과 같은 규칙(영숫자·`-`·`_`, 1~100자) | 400 `details.param="puuid"` |
| 본문 | - | `Content-Type: application/json`, 크기 **2KB 이하**, JSON 객체. 모르는 필드는 무시 | 깨진 JSON·너무 큼·객체 아님·Content-Type 다름 → 400 `details.param="body"` |

**POST로 하는 이유 (계약 1장 "GET만" 변경)**

| 이유 | 설명 |
|------|------|
| 부작용이 있다 | LLM 비용이 들고, 하루 상한을 쓰고, 캐시를 만든다. HTTP 의미상 GET(안전·멱등)이 아니다 |
| 실수 호출 방지 | GET이면 링크 미리 가져오기·크롤러·브라우저 자동 재시도·Next의 GET 캐시/프리페치가 의도치 않게 유료 호출을 만들 수 있다 |
| puuid 노출 줄이기 | 본문에 두면 URL·요청 로그·프록시 로그에 남지 않는다 (lane-gold는 쿼리라 로그에서 잘라야 했다, X7) |

- 바뀌는 규칙: "메서드: GET만" → "**GET(조회) + 이 POST 1개(분석)**". 다른 경로의 POST·그 밖의 메서드는 지금처럼 404 `NOT_FOUND`. 이 경로의 GET도 404.
- CORS는 그대로 켜지 않는다 (D6). 프론트는 Next 서버(Route Handler 또는 Server Action)에서 부른다. 브라우저에서 직접 부르지 않는다.
- 같은 요청을 다시 보내도 캐시로 같은 결과가 오므로 실질적으로 멱등이다(첫 호출만 비용).

#### 5-9-2. 응답 모양

요약: `!ai`의 `FeedbackResult`에서 **화면에 필요한 것만** 골라 준다. 등급·총점·점수·가중치·모델 이름·토큰·비용은 넣지 않는다(서버 로그에만).

```jsonc
// 200 OK, Cache-Control: no-store
{
  "matchId": "KR_8437852704",
  "championId": 235,
  "position": "UTILITY",              // TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY
  "role": "SUPPORT_DAMAGE",           // 엔진 유형 10개 중 하나 (프론트가 한글 이름표로)
  "win": false,
  "mode": "llm",                      // "llm" | "template"
  "templateReason": null,             // mode가 "template"일 때만: "llm_off" | "llm_error"
  "summary": { "text": "라인전에서 밀렸고, … 승부가 기울었습니다." },
  "sections": {
    "laning": { "good": [], "bad": [ { "subjectId": "laning.gold", "text": "15분 골드가 상대 애쉬보다 약 700 적었습니다." } ], "note": null },
    "fight":  { "good": [], "bad": [ { "subjectId": "fight.damage", "text": "…" } ], "note": null },
    "macro":  { "good": [ { "subjectId": "macro.vision", "text": "…" } ], "bad": [], "note": null }
  },
  "keyMoments": [
    { "startSec": 906, "endSec": 936, "direction": "widened", "text": "15분 바텀 싸움에서 …" }
  ],
  "meta": {
    "engineVersion": "2026-11-02.2",
    "promptVersion": "2026-11-03.1",
    "knowledgeVersion": null,          // RAG(4단계) 뒤 문자열. 지금은 항상 null
    "championDataVersion": "16.21.1",  // 유형 판정에 쓴 Data Dragon 버전 (5-9-5)
    "generatedAt": "2026-11-03T12:00:00.000Z"
  }
}
```

| 필드 | 출처 | 규칙 |
|------|------|------|
| `championId`·`position`·`role`·`win` | `AnalysisResult.player` | 그대로 |
| `mode` | `FeedbackResult.mode` | `"llm"` = LLM 답을 썼다(일부 문장은 템플릿일 수 있음). `"template"` = LLM 답을 전혀 못 씀 |
| `templateReason` | 백엔드 | `mode="llm"`이면 `null`. `"llm_off"` = LLM을 끈 설정(7-6)·키 없음, `"llm_error"` = LLM 오류·거절·잘림·시간 초과·크레딧 문제 등. 세부 원인(`fallbackReason`)은 로그에만 |
| `summary.text` | `FeedbackResult.summary.text` | 1~2문장, 최대 200자 |
| `sections.<영역>.good[]`/`bad[]` | `FeedbackResult.sections` | 각 최대 2개. `{subjectId, text}`만. 문장 1개 최대 120자·2문장 (`!ai` 검증기 규칙) |
| `sections.<영역>.note` | `FeedbackResult.sections.<영역>.note` | 라인전 비교 불가일 때 템플릿 한 줄("이 판은 라인전 상대를 비교할 수 없었습니다"), 그 밖은 `null` |
| `keyMoments[]` | `FeedbackResult.keyMoments[i].index` → `AnalysisResult.keyMoments[index]` | `startSec`·`endSec`·`direction`(`widened`/`narrowed`)·`text`. **0~3개** (feedback_design 2-1 최대 3개, 세나 판 3개) |
| `meta.*` | 버전들 + 만든 시각 | 캐시 적중이면 `generatedAt`은 처음 만든 시각 (캐시 적중 표시는 따로 하지 않음, W6과 같은 판단) |

- **넣지 않는 것**: `grade`·`gradePoint`·`score`·`total`·`weight`·`impact`·영역 `verdict`, `factIds`·`source`, `model`·`effort`·`usage`·`costUsd`·`durationMs`·`verification`·`fallbackReason`, `puuid`. (영역 판정어 `잘함/보통/부족`은 등급처럼 보일 수 있어 이번엔 넣지 않는다. 필요하면 나중에 필드 추가로 가능)
- RAG 뒤에도 같은 모양: 문장 출처 조각을 보여 주게 되면 항목에 `sources?` 같은 **필드를 더하는** 방식(계약 1장 "필드 추가는 같은 버전")으로 한다.
- DTO 변환은 순수 함수 `toFeedbackDto(result, feedback, meta)`로 두고, **응답 JSON 키 전체를 재귀로 훑어 금지 키가 없음을 단위 테스트로 확인**한다.

#### 5-9-3. 오류 코드

요약: Riot·입력 문제와 "분석하지 않는 판", "한도 초과"는 오류로 알린다. **LLM 문제는 오류가 아니라 200 + 템플릿 문장**이다(사용자는 항상 결과를 받는다). 단, 하루 상한·예산 초과는 사용자 결정 5에 따라 **429 오류**다.

| HTTP | `code` | 언제 | `details` | 새 코드 |
|------|--------|------|-----------|---------|
| 400 | `INVALID_PARAMETER` | `matchId`·`puuid`·본문 형식 | `{param, value?}` (`puuid`·본문 값은 넣지 않음) | 기존 |
| 404 | `MATCH_NOT_FOUND` | Riot에 그 판이 없음(getMatch 404) / `puuid`가 그 판 참가자가 아님 | `{reason: "match" \| "participant"}` | **새** |
| 422 | `ANALYSIS_UNSUPPORTED` | 분석하지 않는 판 | `{reason: "queue" \| "too_short" \| "no_position" \| "no_timeline"}` | **새** |
| 429 | `ANALYSIS_LIMIT_REACHED` | 오늘 분석 상한 도달 / 누적 예산 도달 (그리고 캐시에 결과가 없음) | `{reason: "daily", limit: 20, resetAt: "…Z"}` 또는 `{reason: "budget"}` | **새** |
| 502 | `RIOT_UNAVAILABLE` | Riot 429·5xx 재시도 소진 | - | 기존 |
| 503 | `RIOT_KEY_EXPIRED` | Riot 401/403 (이 요청만 실패) | - | 기존 |
| 503 | `ANALYSIS_DISABLED` | 분석 기능이 꺼져 있음 (`FEEDBACK_ENABLED=false`) | - | **새** |
| 503 | `ANALYSIS_BUSY` | 동시 분석이 꽉 참 / Riot 호출 한도 대기가 김 | `{retryAfterSec}` (1~60) | **새** |
| 504 | `ANALYSIS_TIMEOUT` | 30초 안에 못 끝냄. **서버는 분석을 계속해 캐시에 넣는다** → 다시 누르면 결과가 나올 수 있음 | `{retryAfterSec: 15}` | **새** |
| 500 | `INTERNAL_ERROR` | 그 밖 (`MATCH_MISMATCH` 등) | - | 기존 |

- 422 `reason` 뜻: `queue` = 420·440이 아님(일반·칼바람·URF 등), `too_short` = 900초 미만(다시하기 포함), `no_position` = 10명 중 `teamPosition`이 빈 참가자가 있음, `no_timeline` = timeline이 404이거나 프레임이 없음(`NO_FRAMES`).
- 429·503·504에는 `Retry-After` 헤더도 함께 준다(`retryAfterSec` 또는 `resetAt`까지 초). 프론트는 `details`만 봐도 된다.

**LLM 쪽 상황별 처리 (오류 아님)**

| 상황 (`fallbackReason`) | 응답 | 하루 상한에 셈 | 캐시 | 그 밖 |
|------|------|------|------|------|
| `FEEDBACK_LLM_ENABLED=false` 또는 `ANTHROPIC_API_KEY` 없음 | 200 `mode:"template"`, `templateReason:"llm_off"` | 안 셈 | 템플릿 캐시(10분) | 0원. 프론트 개발용 |
| `auth`(401/403), `billing`(402 크레딧 부족), `model_not_found` | 200 template `llm_error` | 안 셈(비용 0) | 템플릿 캐시(10분) | **차단기**: 10분 동안 LLM을 부르지 않음, `logger.error` 1회(402면 "크레딧 소진, 콘솔 확인") |
| `rate`(429)·`server`(5xx/529)·`timeout`·`network` | 200 template `llm_error` | 비용이 기록됐으면 셈 | 템플릿 캐시(10분) | SDK 재시도 0회(시간 제한 때문, 5-9-8) |
| `refusal`·`max_tokens`·`parse` | 200 template `llm_error` | 셈(토큰을 썼음) | 템플릿 캐시(10분) | 거절률은 로그로 본다 |
| 칸 일부만 검증 실패 → 그 칸만 템플릿 | 200 `mode:"llm"` | 셈 | 정상 캐시(7일) | 로그에 `templated=N` |
| `budget` (pre-check 뒤 재시도 단계에서만 날 수 있음) | 첫 호출이면 429 `budget`, 재시도면 그 칸만 템플릿 | - | - | 5-9-8 예약으로 거의 안 생김 |

#### 5-9-4. 처리 흐름 (파이프라인)

요약: 싼 검사부터 하고, 비싼 일(timeline, LLM)은 마지막에 한다. "참가자인가"를 엔진보다 먼저 직접 확인해 **NO_POSITION보다 404가 먼저** 나오게 한다(`ai_overview` 해결되지 않은 점).

| 단계 | 하는 일 | Riot | 실패 |
|------|---------|------|------|
| ① 스위치 | `FEEDBACK_ENABLED=false`면 즉시 | 0 | 503 `ANALYSIS_DISABLED` |
| ② 입력 | `matchId`·본문 검사 | 0 | 400 |
| ③ 캐시 | 결과 캐시 → 템플릿 캐시 → 진행 중 Promise 순서로 찾음 (5-9-7). 있으면 바로 반환 | 0 | - |
| ④ Riot 대기 확인 | `riot.limiterWaitMs() > 5,000`이면 시작하지 않음 (lane-gold의 pending과 같은 생각, 기다리는 상한만 다름) | 0 | 503 `ANALYSIS_BUSY` |
| ⑤ match | `getMatch(matchId)` 1회 | 1 | 404→`MATCH_NOT_FOUND(match)`, 401/403→503, 429·5xx 소진→502 |
| ⑥ 사전 검사 | **참가자**(`participants[].puuid === puuid`, 아니면 404 `participant`) → **큐**(`queueId` 420·440) → **길이**(`gameDuration ≥ 900`) → **포지션**(10명 모두 `teamPosition`이 5개 중 하나). 이 검사에서 걸리면 timeline을 부르지 않는다 | 0 | 404 / 422 |
| ⑦ timeline | `getTimeline(matchId)` 1회 | 1 | 404→422 `no_timeline`, 그 밖은 ⑤와 같음 |
| ⑧ 챔피언 데이터 | 판의 `gameVersion`에 맞는 태그·한국어 이름 (5-9-5) | 0 | 실패해도 스냅숏으로 계속 |
| ⑨ 엔진 | `analyzeMatch({match, timeline, puuid, championTags})` (순수 함수, 수 ms) | 0 | `AnalysisError`: `PLAYER_NOT_FOUND`→404, `NO_POSITION`→422, `NO_FRAMES`→422 `no_timeline`, `MATCH_MISMATCH`→500 |
| ⑩ LLM 여부 | LLM 끔·키 없음·차단기 열림 → 템플릿 경로(`client: null`)로 ⑫ | 0 | - |
| ⑪ 한도 예약 | 하루 상한 자리 1개 + 예산(최악 비용) 예약, 동시 실행 자리 얻기 (5-9-8) | 0 | 429 / 503 `ANALYSIS_BUSY` |
| ⑫ 문장 | `createFeedbackFromResult(deps)(result)` — LLM 1~2회 → 검증 → 템플릿 | 0 | LLM 문제는 200 template |
| ⑬ 정리 | 실제 비용이 0이면 하루 상한 자리 반환. 예산 예약 해제. DTO 변환, 캐시 저장, 로그 1줄 | 0 | - |

- **Riot 호출 수**: 캐시 미스 판당 **2회**(match + timeline), 사전 검사에서 걸리면 1회, 캐시 적중이면 0회. 기존 API 전용 제한기(1초 18회/120초 90회)를 공유한다.
- **전적 검색 캐시의 match 재사용 여부: 하지 않는다.** 소환사 캐시(60초)는 화면용 DTO만, 경기 캐시(`matchLaneCache`)는 참가자 10명의 포지션·`gold15` 숫자만 가진다. 엔진은 match 원본(참가자 전체 필드)이 필요해 둘 다 쓸 수 없다. 원본을 캐시에 넣는 것은 X4에서 "메모리가 커져 미룸"으로 정했고, 분석은 버튼을 눌러야만 하니 +1회는 감당할 만하다. (⑥ 사전 검사만 `matchLaneCache`로 먼저 해 Riot 0회로 404·422를 줄 수도 있지만, 큐 ID·길이가 그 캐시에 없어 이번에는 하지 않는다.)
- 타입: `riot/types.ts`의 `MatchDto`·`TimelineDto`를 엔진 입력 타입(`AnalysisMatch`·`AnalysisTimeline`)으로 넘긴다. 구조가 같지만 선택 필드 차이로 타입이 안 맞으면 `api/feedback/` 안의 작은 변환 함수에서 맞춘다(`riot/types.ts`에 엔진용 필드를 선택 필드로 더하는 것도 허용 — 수집기 영향 없음, 변경 04와 같은 방식).
- **puuid 키 주의**: Riot puuid는 API 키(앱)마다 다르게 암호화될 수 있다(`ai_overview` 8번). 개발 키를 재발급한 뒤 프론트가 예전 검색 결과의 puuid를 보내면 ⑥에서 404 `participant`가 날 수 있다 → 프론트는 "다시 검색해 주세요"로 안내(5-9-11).

#### 5-9-5. Data Dragon 챔피언 태그 공급

요약: 엔진은 챔피언 태그(유형 판정)와 한국어 이름(문장)을 받는다. 지금은 테스트 fixture(16.21.1) 하나에 고정돼 있다. **판의 패치에 맞는 Data Dragon을 처음 필요할 때 받아 메모리에 두고, 실패하면 저장소 스냅숏을 쓰는** 방식으로 정했다(12장 F13).

| 안 | 방법 | 장점 | 단점 |
|----|------|------|------|
| A. 스냅숏만 | fixture를 `backend/data/ddragon/champion-tags.16.21.1.json`으로 복사해 서버 시작 때 읽음 | 네트워크 0, 단순 | 새 챔피언이 나오면 태그 없음(엔진이 빈 태그로 판정하고 경고). 사람이 파일을 갱신해야 함 |
| **B. 패치별 지연 로딩 + A 대비 (채택)** | 판의 `info.gameVersion`(`16.21.534.1234`) → `메이저.마이너` → Data Dragon `versions.json`에서 그 접두어의 첫 버전(`16.21.1`) → `cdn/{ver}/data/ko_KR/champion.json`을 받아 태그·이름 표를 만듦. 버전별로 메모리에 최대 4개. 받기 실패·시간 초과(3초)면 A 스냅숏 사용 + 경고 로그(10분 1번) | 판의 패치와 맞음, 새 챔피언 자동 반영, 키 없음·무료 | 새 외부 호출(Data Dragon CDN, 버전당 1번 약 150KB). 첫 분석이 최대 3초 느려질 수 있음 |
| C. 서버 시작 때 최신 1개만 | 시작 때 최신 버전 받음 | 단순 | 옛 패치 판도 최신 태그 (태그는 거의 안 바뀌어 실제 차이 작음) |

- B의 세부: `versions.json`은 1시간 캐시. 같은 버전을 동시에 받으면 진행 중 Promise 공유. `championTagsFromJson`·`championNamesFromJson`(`!ai` 공개 함수)이 `{data:{…}}` 형식을 이미 읽으므로 변환 코드 불필요. 응답 `meta.championDataVersion`과 캐시 키에 실제로 쓴 버전을 넣는다.
- 새 의존성 없음(Node 내장 `fetch`). 단위 테스트는 가짜 fetch.
- 엔진의 덮어쓰기 목록(`ROLE_OVERRIDES`)은 그대로 `!ai` 코드에 있다.

#### 5-9-6. 의존성 조립 (server.ts)

요약: 무거운 것(Anthropic SDK 클라이언트, 장부, 캐시)은 **서버 시작 때 1번** 만들고 `createApp`에 함수 하나(`feedback`)로 주입한다. 기존 `summonerSearch`·`laneGold`와 같은 방식(W7).

```
server.ts
 ├ loadFeedbackEnv()            // config/env.ts: FEEDBACK_* , ANTHROPIC_API_KEY (값은 로그에 안 남김, "있음/없음"만)
 ├ FEEDBACK_ENABLED=false → feedback = 항상 503 ANALYSIS_DISABLED
 ├ Riot 키 없음            → feedback = 항상 503 RIOT_KEY_EXPIRED (기존 keyMissing과 같음)
 ├ llmClient = (FEEDBACK_LLM_ENABLED && 키 있음) ? createAnthropicClient({ apiKey, timeoutMs: 25_000, maxRetries: 0 }) : null
 ├ ledger    = fileLedger(backend/logs/feedback-api-ledger.jsonl)   // API 전용 장부 (5-9-8)
 ├ champData = createChampionData({ fetch, snapshotPath, logger })  // 5-9-5
 └ feedback  = createFeedbackService({ riot(기존 API용 RiotClient 공유), llmClient, ledger, champData, caches, limits, now, logger })
createApp(db, undefined, { summonerSearch, laneGold, feedback })
```

- 시작 로그 1줄: `피드백 API enabled=true llm=on|off(이유) model=… effort=… dailyLimit=20 budget=$0.25 spent=$0.0000 today=0/20`. 키 값은 절대 출력하지 않는다.
- `createApp`의 `feedback` 기본값은 기존처럼 "설정 안 됨 → 500" 함수(기존 테스트가 영향받지 않게).
- `@anthropic-ai/sdk`는 계속 `analysis/llm/client.ts`만 import한다(`!ai` 규칙). 백엔드는 `createAnthropicClient`를 부를 뿐이다.

#### 5-9-7. 캐시와 진행 중 요청 공유

요약: 끝난 게임은 안 바뀌므로 한 번 만든 결과를 재사용한다. 같은 판을 동시에 눌러도 LLM은 1번만 부른다.

| 항목 | 값 |
|------|-----|
| 캐시 키 | `matchId | puuid | engineVersion | promptVersion | knowledgeVersion(지금 "none") | model | effort | championDataVersion`. 규칙·프롬프트·모델·태그가 바뀌면 자연히 새로 만든다 |
| 키 계산 시점 | `championDataVersion`은 match를 받아야 알 수 있다 → 먼저 **앞 부분 키**(`matchId|puuid|engine|prompt|knowledge|model|effort`)로 찾고, 값 안의 `championDataVersion`은 응답에만 쓴다 (같은 판의 패치는 바뀌지 않으므로 앞 부분 키로 충분). |
| 결과 캐시 | `createSummonerCache<FeedbackDto>` 재사용(Map, TTL, 최대 개수, 넣은 순서로 삭제). **TTL 7일, 최대 500개**(결과 1개 약 3~6KB → 최대 약 3MB). `mode="llm"`만 |
| 템플릿 캐시 | 같은 구현, **TTL 10분, 최대 200개**. `mode="template"`(LLM 끔·오류). LLM이 회복되면 10분 뒤 다시 만든다 |
| 찾는 순서 | 결과 캐시 → 템플릿 캐시 → 진행 중 Promise. 단, `FEEDBACK_LLM_ENABLED`가 켜져 있고 차단기가 닫혀 있으면 템플릿 캐시 중 `llm_off`는 무시(설정을 켠 뒤 바로 LLM이 돌게) |
| 진행 중 공유 | `Map<앞 부분 키, Promise<FeedbackDto>>`. 첫 요청(리더)만 Riot·LLM을 부르고, 같은 키 요청은 같은 Promise를 기다린다. 리더가 끝나면(성공·실패 모두) 지운다. 하루 상한은 **리더만** 센다 |
| 실패 캐시 | 오류(404·422·502·503)는 캐시하지 않는다. 422는 다시 눌러도 같지만 Riot 1~2회라 감당 가능 (프론트가 버튼을 숨겨 줄인다, 5-9-11) |
| 재시작 | 사라진다(사용자 결정 6). 같은 판을 다시 분석하면 비용이 다시 든다 |

#### 5-9-8. 하루 상한, 예산, 동시 실행, 시간 제한

요약: 돈이 새지 않게 네 겹으로 막는다 — ① 하루 20회 ② 누적 예산(장부) ③ 동시 실행 2개 ④ 응답 30초. 동시 요청에서도 상한을 넘지 않도록 "**먼저 예약하고, 끝나면 정산**"한다.

**① 하루 상한 (`FEEDBACK_DAILY_LIMIT`, 기본 20)**

| 항목 | 규칙 |
|------|------|
| 세는 것 | 실제 LLM 비용이 생긴 분석(장부에 `costUsd > 0`인 호출이 1개 이상)만. 캐시 적중·진행 중 공유·템플릿(`llm_off`)·비용 0 오류(401/402 등)는 안 셈 |
| 예약 | ⑪에서 `used + reserved < limit`이면 자리 1개 예약, 아니면 429 `daily`. 끝나고 실제 비용이 0이면 반납 |
| 초기화 | **KST 자정**(UTC 15:00). 날짜 키 `YYYY-MM-DD`(KST)가 바뀌면 0 |
| 재시작 | 시작 때 API 장부에서 **오늘(KST) 날짜의 `kind="first"`·`costUsd>0` 줄 수**로 복원한다(재시작으로 상한이 풀리지 않게). 장부에는 puuid가 없고 matchId·participantId만 있다 |
| 응답 | `429 ANALYSIS_LIMIT_REACHED {reason:"daily", limit, resetAt}`, `Retry-After`=자정까지 초 |

**② 예산 (`FEEDBACK_API_BUDGET_USD`, 기본 0.25)**

| 항목 | 규칙 |
|------|------|
| 장부 | **API 전용 파일** `backend/logs/feedback-api-ledger.jsonl` (루트 `.gitignore`의 `logs/`로 git 제외). `!ai`의 `fileLedger`를 그대로 쓰고, `generateTexts`가 호출마다 줄을 더한다. CLI 평가 장부(`test/eval/usage-ledger.jsonl`, git 커밋)와 섞지 않는다 — 평가 기록이 사용자 트래픽으로 더러워지지 않고, 예산을 따로 정할 수 있다 |
| 상한 뜻 | API 장부 **누적** 합. 5단계 배분($0.25)을 기본값으로 하고, 공개 운영 때 사용자가 올린다. (월 단위로 바꾸려면 장부를 이번 달 줄만 보는 감싼 `Ledger`로 넘기면 된다 — 12장 F11) |
| 예약 | ⑪에서 `장부 합 + 진행 중 예약 합 + 이번 판 최악 비용 > 상한`이면 시작하지 않고 429 `budget`. 최악 비용 = `worstCallCost(1차 입력 어림, 3000) + worstCallCost(재시도 입력 어림, 1500)` (`!ai`의 `pricing`·`prompt` 공개 함수로 계산, 약 $0.22). 끝나면 예약 해제 |
| 이중 장치 | `generateTexts` 안의 `assertBudget`(호출마다 장부 + 최악 ≤ 상한)도 그대로 동작한다. 동시 2개가 같은 순간 통과해 상한을 넘는 문제는 위 예약으로 막는다 |
| 입력 어림 보정 | 장부 실측으로 계수 계산(`calibration`). API 장부에 같은 모델·프롬프트 실측이 없으면 2단계 실측 계수 **1.64**를 상수로 쓴다 (평가 장부 파일을 서버가 읽지 않게) |
| 바깥 안전망 | Anthropic 콘솔 월 지출 한도(사용자 설정, `!ai` 질문 11) |

**③ 동시 실행**

| 항목 | 값 |
|------|-----|
| LLM 동시 실행 | 최대 **2개** (세마포어). 대기열 최대 **4개**, 대기 중에도 ④ 시간 제한이 흐른다 |
| 꽉 참 | 대기열도 꽉 차면 바로 503 `ANALYSIS_BUSY {retryAfterSec: 15}` |
| Riot 대기 | ④ 단계 `limiterWaitMs() > 5초`면 503 `ANALYSIS_BUSY {retryAfterSec: ceil(대기)}` (최대 60). 5초 이하면 제한기에서 기다린다 |

**④ 응답 시간 (동기, 30초)**

| 항목 | 값 | 이유 |
|------|-----|------|
| 서버 응답 상한 | **30초** (`FEEDBACK_DEADLINE_MS`). 넘으면 504 `ANALYSIS_TIMEOUT {retryAfterSec:15}` | 2단계 실측 판당 평균 13.7초(재시도 포함). 재시도 있는 판도 대부분 30초 안 |
| 상한을 넘겨도 | 분석 Promise는 **계속 돌고 끝나면 캐시에 넣는다**(진행 중 Map에도 남음). 사용자가 다시 누르면 진행 중 Promise에 붙거나 캐시 적중 → **추가 비용 0** | LLM 호출을 중간에 끊을 수 없다(`generateTexts`에 취소 신호 없음). 이미 낸 비용을 버리지 않는다 |
| LLM 호출 1번 상한 | SDK `timeoutMs: 25,000`, `maxRetries: 0` (CLI 기본 60초·1회 재시도보다 짧게) | 1차 + 재시도 최악이 50초로 묶인다. 시간 초과는 템플릿 |
| Riot | 기존 클라이언트 그대로 (요청 10초, 429·5xx 재시도) | |

- 프론트 타임아웃: 이 엔드포인트만 **35초**(서버 30초 + 여유). 기본 10초(`API_TIMEOUT_MS`)는 그대로.

#### 5-9-9. 기존 코드와의 경계 (ai 쪽 변경 요청)

요약: `backend/src/analysis/**`·`backend/src/cli/{analyze,feedback}.ts`는 **고치지 않고 import만** 한다. 필요한 공개 함수가 이미 다 있어 **ai 쪽 변경 요청은 없다**.

| 쓰는 `!ai` 공개 함수 | 용도 |
|------|------|
| `analyzeMatch`, `AnalysisError`, `championTagsFromJson`, `ENGINE_VERSION` (`analysis/index.ts`) | 엔진, 오류 매핑, 태그 |
| `createFeedbackFromResult`, `championNamesFromJson`, `FeedbackResult` (`analysis/feedback.ts`) | 문장 생성(엔진 결과를 받아 `keyMoments` 시각과 `player`를 함께 쓰려고 `createFeedback` 대신 이것을 씀) |
| `createAnthropicClient`, `LlmClient` (`llm/client.ts`), `fileLedger`·`calibration`·`Ledger` (`llm/ledger.ts`), `worstCallCost`·`estimateTokens`·`priceOf` (`llm/pricing.ts`), `MAX_TOKENS` (`llm/generate.ts`), `PROMPT_VERSION`·`SYSTEM_PROMPT`·`buildUserMessage` (`llm/prompt.ts`), `buildFacts` (`llm/facts.ts`), `FakeLlmClient` (테스트) | 클라이언트, 장부, 예산 예약 계산, 가짜 클라이언트 |

**참고로 `!ai`에 전할 것 (변경 요청 아님, 메인 에이전트 판단)**

1. `generateTexts`에 취소 신호(AbortSignal)가 없어 504 뒤에도 LLM이 끝까지 돈다. 지금 설계(끝까지 돌려 캐시)로 충분하지만, 나중에 필요하면 `!ai` 변경으로.
2. LLM 호출이 시간 초과·네트워크 오류로 끝나면 장부 `costUsd`가 0으로 남지만, 실제로는 Anthropic이 일부를 청구했을 수 있다. 콘솔 대조 때 참고(`ai_overview` 7번과 함께).
3. `ai_overview`의 문장 품질 문제(2~6번: 역전 장면 표현, "5데스" 단위, 칸 안 방향어 등)는 그대로 API 응답에도 나온다. 화면 공개 전에 다음 `PROMPT_VERSION`으로 고치는 것을 권장한다(`!ai` 작업).

#### 5-9-10. 파일 목록

요약: 새 코드는 `src/api/feedback/` 폴더에 모으고, 기존 파일은 조립·라우팅·검증·로그 가리기만 조금 고친다.

| 파일 | 신규/수정 | 내용 |
|------|-----------|------|
| `src/api/feedback/service.ts` | 신규 | `createFeedbackService(deps)` → `FeedbackFn(matchId, puuid)`: 5-9-4 흐름, 진행 중 공유, 시간 제한, 오류 매핑 |
| `src/api/feedback/precheck.ts` | 신규 | 순수 함수 `precheckMatch(match, puuid)` → `ok | {status, code, reason}` (참가자 → 큐 → 길이 → 포지션 순서) |
| `src/api/feedback/limits.ts` | 신규 | 하루 상한(KST 날짜·예약·반납·장부 복원), 예산 예약, 세마포어(2 + 대기 4), 차단기(10분) |
| `src/api/feedback/championData.ts` | 신규 | 5-9-5 B안(버전 매칭, 지연 로딩, 진행 중 공유, 스냅숏 대비) |
| `src/api/feedback/dto.ts` | 신규 | `toFeedbackDto` 순수 함수, 응답 타입 |
| `src/api/routes/matches.ts` | 수정 | `POST /matches/:matchId/feedback` 추가 (라우트 전용 `express.json({ limit: '2kb' })`) |
| `src/api/app.ts` | 수정 | 메서드 검사: GET·HEAD + **이 경로의 POST만** 통과. `ApiDeps.feedback` 주입 |
| `src/api/errors.ts` | 수정 | 본문 파싱 오류(`entity.parse.failed`·`entity.too.large`·Content-Type) → 400, `Retry-After` 헤더 지원 |
| `src/api/validate.ts` | 수정 | `parseMatchIdParam`(단일 ID) 추가 (기존 정규식 재사용) |
| `src/config/feedback.ts` | 신규 | 7-6 상수 |
| `src/config/env.ts` | 수정 | `loadFeedbackEnv()` (불리언·정수·숫자 검사, 키는 "있음/없음") |
| `src/lib/logger.ts` | 수정 | `sk-ant-` 가리기 |
| `src/riot/types.ts` | 수정(필요할 때만) | 엔진 입력에 필요한 선택 필드 |
| `src/server.ts` | 수정 | 5-9-6 조립 |
| `backend/data/ddragon/champion-tags.16.21.1.json` | 신규 | fixture 복사본 (스냅숏, 5-9-5 A) |
| `test/unit/api/feedback*.test.ts` 등 | 신규 | 9-5 |
| `.env.example` | 수정 | 7-6 새 변수 4개 |
| `docs/contracts/api_contract.md` | 수정 | api_contract 2-7 |

- 수정 금지(이번 변경): `backend/src/analysis/**`, `backend/src/cli/**`, `backend/test/unit/analysis/**`, `backend/test/eval/**`, `backend/src/collector/*`, `db/`, `docs/contracts/db_contract.*`, `frontend/`, 루트 `.env`, `CLAUDE.md`, `docs/ai/**`.

#### 5-9-11. 프론트에 전할 사항

요약: 오래 걸리는 버튼 하나다. 타임아웃을 늘리고, 누를 수 없는 판에는 버튼을 안 보이게 하고, 오류마다 쉬운 문구를 준다. (`!프론트` 6단계, 목업 먼저)

| 항목 | 내용 |
|------|------|
| 호출 위치 | Next 서버(Route Handler 또는 Server Action)에서 `POST`. 브라우저 직접 호출 없음(CORS 없음). `puuid`는 2-5의 `summoner.puuid`를 본문으로 |
| 타임아웃 | 이 요청만 **35초**. 기본 10초 그대로 |
| 버튼 표시 | `queueId`가 420·440이고 `gameDurationSec ≥ 900`인 매치 행에만 보인다(2-5에 이미 있는 값). 422를 미리 줄인다 |
| 버튼 상태 | 대기 → 누름 → **분석 중**(버튼 비활성, "AI가 분석 중입니다 · 보통 10~20초") → 결과 / 오류. 결과는 그 페이지에 기억(다시 펼쳐도 다시 부르지 않음). 서버 캐시가 있어 다시 눌러도 비용은 없음 |
| `mode:"template"` | 문장은 그대로 보여 주고 작은 표시: `llm_off` "간단 분석"(개발 중), `llm_error` "AI 문장 생성에 실패해 기본 문장으로 보여 드려요" |
| 오류 문구 | 400 → "요청이 잘못됐습니다" / 404 `match` "경기 정보를 찾을 수 없어요" / 404 `participant` "검색 결과가 오래됐어요. 다시 검색해 주세요" / 422 "솔로·자유랭크 15분 이상 경기만 분석할 수 있어요" / 429 `daily` "오늘 분석 한도를 모두 썼어요. 자정(한국 시간)에 다시 열려요" / 429 `budget` "지금은 분석을 쓸 수 없어요" / 502 "Riot 서버가 바빠요. 잠시 후 다시" / 503 `RIOT_KEY_EXPIRED` "지금은 분석할 수 없어요" / 503 `ANALYSIS_DISABLED` 버튼 숨김 또는 "준비 중" / 503 `ANALYSIS_BUSY`·504 "조금 뒤(`retryAfterSec`초) 다시 눌러 주세요" (504는 다시 누르면 보통 바로 결과) |
| 자동 재시도 | 하지 않는다(사용자가 다시 누름). 504·busy만 "다시 시도" 버튼 |
| 등급 | 응답에 없다. 화면에 등급·점수를 만들지 않는다 |

#### 5-9-12. Build 구현 메모 (2026-11-03)

- `FeedbackFn`에 `unavailable` 속성(ApiError)을 둬, 꺼짐(503 `ANALYSIS_DISABLED`)·Riot 키 없음(503)·미설정(500)이면 라우트가 **본문 파싱 전에** 바로 응답한다(5-9-4 ① 순서). 
- 하루 상한 `FEEDBACK_DAILY_LIMIT=0`이면 LLM 클라이언트를 만들지 않고 템플릿 `llm_off`로 준다(429가 아님).
- 환경 변수 값이 잘못되면(불리언·정수·숫자·effort) 경고 후 **분석 기능 전체를 끈다**(503 `ANALYSIS_DISABLED`, 서버는 켜짐). 가격표에 없는 모델은 LLM만 끈다.
- 판당 최악 비용은 CLI 예상 비용과 같은 계산(1차 max_tokens 3,000 전부 + 재시도 입력 = 1차 입력 + 3,000 + 1,500, max_tokens 1,500)이고 세나 판 기준 약 **$0.216**이다. 기본 예산 $0.25에서는 장부 합이 약 $0.034를 넘으면 다음 LLM 분석부터 429 `budget`이 된다(공개 운영 전 상한을 올려야 함).
- 로그: 분석 1건 = `[feedback] 분석 …` 1줄(`cache=hit|template_hit|shared|miss`, `outcome`, Data Dragon `championDataSource=ddragon|snapshot` 포함).

### 5-10. 매치 상세 지표 (변경 06)

> 요약: 매치를 펼쳤을 때 10명 상세 표와 팀 요약을 보여 주려고, 이미 받는 match-v5 상세에서 값을 더 꺼내 2-5 응답에 **더하기만** 한다. Riot 추가 호출·캐시·다른 응답은 그대로 (사용자 승인 2026-11-03).

- `participants.team[]`/`enemy[]`에 추가: `isMe`(검색한 소환사만 true), `teamPosition`, `champLevel`, `kills`, `deaths`, `assists`, `killParticipation`(`killParticipationPercent` 재사용), `damageTaken`(`totalDamageTaken`), `goldEarned`, `cs`(라인+정글), `visionScore`, `wardsPlaced`, `wardsKilled`, `controlWardsPlaced`(`detectorWardsPlaced`), `items`(6칸), `trinket`, `summonerSpells`(2), `keystone`, `subStyle`(`perks.styles[1].style`, 없으면 null). 기존 필드는 그대로.
- 매치에 `teams: { team, enemy }` 추가. `TeamSummary` = `win`, `kills`(참가자 킬 합), `gold`(`goldEarned` 합), `towers`, `inhibitors`, `dragons`, `barons`, `heralds`(`riftHerald`), `grubs`(`horde`), `bans`(championId, -1 제외). `info.teams[].objectives`에서 읽고 값이 없으면 0.
- 구현: `src/api/dto.ts` `sideDto`·`teamSummary`, `src/riot/types.ts` 선택 필드. 테스트 `test/unit/matchDetail.test.ts`.
- 응답 크기(fixture 2판을 번갈아 20판, `matches` 부분, 압축 전): 약 29 KB → 약 102 KB (판당 1.5 KB → 5.1 KB). `no-store` 그대로.

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
| 404 | `SUMMONER_NOT_FOUND` | 전적 검색(변경 03): account-v1에 없는 소환사 |
| 502 | `RIOT_UNAVAILABLE` | 전적 검색(변경 03): Riot 429·5xx 재시도 소진 |
| 503 | `RIOT_KEY_EXPIRED` | 전적 검색(변경 03): Riot 401/403. **이 요청만** 실패, 서버는 계속 응답 |

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

### 6-4. 게임 피드백 분석 로그와 비밀값 (변경 05)

요약: 분석 1건 = 로그 1줄. 토큰·비용·시간은 로그에만, puuid는 앞 8자만, 키는 어디에도 없다.

| 로그 | 내용 |
|------|------|
| 요청 1줄 (기존 `app.ts`) | `POST /api/v1/matches/KR_…/feedback 200 13521.4ms`. puuid는 본문이라 URL에 없다 |
| 분석 1줄 (`[feedback]`) | `matchId`, `puuid=앞8자`, `cache=hit|template_hit|shared|miss`, `riotCalls`, `mode`, `fallbackReason`, `attempts`, `firstPass/firstTotal`, `retried`, `templated`, 토큰 `in/cw/cr/out`, `costUsd`, `llmMs`, `totalMs`, `today=N/20`, `spent=$x/$y`, `championDataVersion` |
| 경고·오류 | 차단기 열림(오류 1회/10분, 402면 "크레딧 소진"), 예산 429(경고), Data Dragon 실패(경고 10분 1번), 504(경고, 계속 진행 중임을 표시), 엔진 `warnings` 개수 |
| 비밀값 | `lib/logger.ts`의 `redact`에 **`sk-ant-…` 모양과 `ANTHROPIC_API_KEY` 값 가리기를 추가**한다 (지금은 `RGAPI-`·DB URL만 가림). SDK 오류 메시지도 `redact`를 거친다 |
| 응답 | 오류 응답에 SDK 원문 메시지·스택·puuid를 넣지 않는다 |
| 장부 | `!ai` 장부 형식 그대로(키·puuid 없음, matchId·participantId 있음). git 제외 폴더 |

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

### 7-5. 전적 검색 (config/summoner.ts, 변경 03)

| 설정 | 기본 | 근거 |
|------|------|------|
| `SUMMONER_CACHE_TTL_MS` | 60,000 (60초) | 결정 S4 |
| `SUMMONER_CACHE_MAX` | 200 | 메모리 무한 증가 방지 (개발 단계 동시 사용자 적음) |
| `RECENT_MATCH_COUNT` | 20 | match-v5 ids `count` |
| `API_RIOT_RATE_LIMIT` | 1초 **18**회, 2분 **90**회 | 변경 04 결정 X1 (변경 03은 10/50이었음). 신규 검색 1회 최대 44회라 2회 연속(88) 가능 |
| `MATCH_LANE_CACHE_TTL_MS` | 21,600,000 (6시간) | 끝난 게임은 불변 (X2) |
| `MATCH_LANE_CACHE_MAX` | 5,000 | 약 5MB 이내 (X2) |
| `LANE_GOLD_MAX_IDS` | 10 | 요청 하나가 제한기 줄을 오래 점유하지 않게 (X3) |
| `LANE_GOLD_MAX_WAIT_MS` | 1,500 | 이보다 오래 기다려야 하면 `pending` (X3) |
| `LANE_GOLD_RETRY_MAX_SEC` | 120 | `retryAfterSec` 상한 (2분 창) |
| `LANE_GOLD_FRAME_INDEX` | 15 | frames[15] = 15:00 근처 |
| `LANE_GOLD_MIN_DURATION_SEC` | 900 | 이보다 짧은 게임은 timeline 생략 |
| `LANE_GOLD_CONCURRENCY` | 5 | 한 요청 안의 병렬 경기 수 |

- 수집 CLI의 `RateLimiter`(19/98)와는 **별개 인스턴스**다 (API 서버·수집 CLI가 다른 프로세스). 그래서 **같은 키로 둘을 동시에 돌리지 않는다**(18+19 > 20/초, 90+98 > 100/120초). 새 환경 변수는 없다.

### 7-6. 게임 피드백 분석 (config/feedback.ts, 변경 05)

요약: 켜고 끄는 스위치 2개와 상한 2개만 환경 변수로 둔다. **기본은 모두 꺼짐/보수적**이라 `.env`를 안 고치면 유료 호출이 일어나지 않는다.

`.env.example`에 추가 (값은 비워 둠):

| 변수 | 기본값 | 뜻 |
|------|--------|-----|
| `FEEDBACK_ENABLED` | `false` | 분석 API 자체를 켬. `false`면 503 `ANALYSIS_DISABLED` |
| `FEEDBACK_LLM_ENABLED` | `false` | 실제 LLM 호출을 켬. `false`면 **0원 템플릿 문장**(`templateReason:"llm_off"`). 프론트 개발은 이 상태로 한다 (`.env`에 `ANTHROPIC_API_KEY`가 이미 있어도 실수로 비용이 나지 않게 스위치를 따로 둠) |
| `FEEDBACK_DAILY_LIMIT` | `20` | 하루(KST) 분석 상한. 0이면 LLM 분석 없음(캐시·템플릿만) |
| `FEEDBACK_API_BUDGET_USD` | `0.25` | API 장부 누적 비용 상한 |

- 그대로 재사용: `ANTHROPIC_API_KEY`, `FEEDBACK_LLM_MODEL`(기본 `claude-opus-5-5`, `priceOf`로 검사 — 가격표에 없으면 시작 때 LLM 끔 + 오류 로그), `FEEDBACK_LLM_EFFORT`(기본 `low`). `FEEDBACK_BUDGET_USD`는 **CLI 평가 장부 전용**으로 그대로 둔다(설명 문구에 "CLI"를 덧붙임).
- 잘못된 값(불리언이 `true/false` 아님, 음수 등)은 시작 때 경고 후 **분석 기능 전체를 끈다**(503 `ANALYSIS_DISABLED`, 서버는 켜짐, W9와 같은 생각). `FEEDBACK_DAILY_LIMIT=0`은 잘못된 값이 아니라 "LLM 없이 템플릿만"(`llm_off`).

`src/config/feedback.ts` 상수:

| 이름 | 값 |
|------|-----|
| `FEEDBACK_QUEUES` | `[420, 440]` |
| `FEEDBACK_MIN_DURATION_SEC` | `900` |
| `FEEDBACK_DEADLINE_MS` | `30_000` |
| `FEEDBACK_LLM_TIMEOUT_MS` / `FEEDBACK_LLM_MAX_RETRIES` | `25_000` / `0` |
| `FEEDBACK_CONCURRENCY` / `FEEDBACK_QUEUE_MAX` | `2` / `4` |
| `FEEDBACK_RIOT_MAX_WAIT_MS` | `5_000` |
| `FEEDBACK_CACHE_TTL_MS` / `FEEDBACK_CACHE_MAX` | 7일 / `500` |
| `FEEDBACK_TEMPLATE_CACHE_TTL_MS` / `FEEDBACK_TEMPLATE_CACHE_MAX` | 10분 / `200` |
| `FEEDBACK_BREAKER_MS` | 10분 |
| `FEEDBACK_DEFAULT_INPUT_FACTOR` | `1.64` (2단계 실측) |
| `FEEDBACK_LEDGER_PATH` | `backend/logs/feedback-api-ledger.jsonl` |
| `DDRAGON_BASE_URL` / `DDRAGON_TIMEOUT_MS` / `DDRAGON_CACHE_VERSIONS` / `DDRAGON_VERSIONS_TTL_MS` | `https://ddragon.leagueoflegends.com` / `3_000` / `4` / 1시간 |
| `DDRAGON_SNAPSHOT_PATH` | `backend/data/ddragon/champion-tags.16.21.1.json` |
| `FEEDBACK_BODY_LIMIT` | `'2kb'` |
| `FEEDBACK_RETRY_AFTER_SEC` / `FEEDBACK_BUSY_RETRY_MAX_SEC` | `15` / `60` (Build) |
| `FEEDBACK_RETRY_MSG_TOKENS` | `1500` (CLI와 같은 재시도 메시지 어림, Build) |
| `FEEDBACK_KNOWLEDGE_VERSION` | `null` (캐시 키에는 `"none"`) |
| `DDRAGON_WARN_INTERVAL_MS` | 10분 (Build) |

---

## 8. 의존성

> 요약: 실행 의존성은 `express`, `pg` 두 개뿐이다. 나머지는 Node 24 내장 기능으로 대신한다.

| 패키지 | 종류 | 목적 |
|--------|------|------|
| `express` ^5 | 실행 | 프로젝트 스택. 5.x는 async 핸들러 오류를 오류 미들웨어로 넘김 |
| `pg` ^8 | 실행 | Supabase Postgres 직접 접속 |
| `@anthropic-ai/sdk` | 실행 | `!ai` 2단계가 도입(`analysis/llm/client.ts`만 import). 변경 05 API는 `createAnthropicClient`를 부를 뿐 새 의존성 없음 |
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
| `killParticipationPercent` (변경 04) | `challenges` 값 사용(0.1667→17, 0.5833→58), 우선순위, 필드 없음/숫자 아님→직접 계산, 팀 킬 합 0→`null`, 100 초과 안 자름, fixture 실제 게임 10명 전원에서 challenges 값과 직접 계산이 같은 정수 % |
| `laneGold` 순수 함수·서비스 (변경 04, 가짜 `getMatch`/`getTimeline`/`limiterWaitMs`) | 정상(5396:4939→52), 프레임 ≤15→`unavailable`+`gold15=null`, 포지션 Invalid/빈 값, 적 같은 포지션 0명·2명, `totalGold` 없음, 정글·서폿, 반올림 경계, 호출 생략(899초 vs 900초, 포지션 없음, 참가자 아님 → timeline 0회), 재요청 0회, 동시 2요청 1회, TTL 6시간 후 재호출, 404 처리, 캐시에 `frames` 없음, `pending`/`retryAfterSec`(올림, 상한 120, 1.5초 경계), 401/403→503, 소진→502 |
| `matchLaneCache` (변경 04) | TTL 경계, 최대 5,000개(시험은 작은 값) 초과 시 오래된 것부터 삭제, 저장 값에 참가자 10명 최소 정보만 |
| `app` lane-gold 라우트 (변경 04) | 파싱 값 전달·`no-store`·200+`pending`, 400(11개·형식·누락·빈 항목·배열·길이), 503/502 형식, 안 넘긴 `createApp`은 500, 요청 로그의 puuid 앞 8자 |

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

### 9-5. 게임 피드백 분석 테스트와 비용 (변경 05)

요약: 단위·라우트 테스트는 **가짜 Riot·가짜 LLM(`FakeLlmClient`)·가짜 fetch·가짜 시계**로 0원. 실제 LLM 호출은 **Review 때 1판 1회**만(약 $0.07, 최악 $0.22).

**단위 (`npm test`, 네트워크 없음)**

| 묶음 | 확인 |
|------|------|
| `precheck` | 참가자 아님 → 404 `participant`가 **포지션 없음보다 먼저**, 큐 450·400 → 422 `queue`, 899초 → `too_short`, 900초 통과, 포지션 빈 참가자 → `no_position`, 정상 |
| 서비스 흐름 (세나 fixture `KR_8437852704`) | 정상 → 200 `mode:"llm"`, Riot 2회·LLM 1회 / 사전 검사 실패 시 timeline 0회 / getMatch 404 → 404 `match` / timeline 404 → 422 `no_timeline` / 401·403 → 503 / 429·5xx 소진 → 502 / `MATCH_MISMATCH` → 500 |
| 캐시 | 두 번째 요청 Riot 0·LLM 0, 7일 뒤 다시 생성, 500개 초과 시 오래된 것 삭제, 템플릿 10분 뒤 다시 생성, LLM을 켠 뒤 `llm_off` 템플릿 캐시 무시 |
| 진행 중 공유 | 같은 키 동시 3요청 → Riot 2회·LLM 1회·하루 셈 1 |
| 하루 상한 | 20번째 통과·21번째 429(`resetAt` = 다음 KST 자정), 상한이어도 캐시 적중은 200, 비용 0 오류는 반납, KST 자정 지나면 초기화(가짜 시계, UTC 14:59→15:00 경계), 장부로 오늘 수 복원(어제 줄·`retry` 줄·비용 0 줄 제외) |
| 예산 | 장부 + 예약 + 최악 > 상한 → 429 `budget`(LLM 0회), 동시 2요청이 같이 통과해 넘지 않음 |
| LLM 처리 | `FEEDBACK_LLM_ENABLED=false`·키 없음 → template `llm_off`, LLM 0회, 셈 0 / auth·402 → template `llm_error` + 차단기 10분(그동안 LLM 0회) / 429·5xx·timeout·refusal·parse → template / 칸 일부 템플릿 → `mode:"llm"` |
| 시간 제한·동시 실행 | 느린 가짜 LLM(40초, 가짜 시계) → 504, 뒤 요청은 진행 중 Promise에 붙어 결과 받음(추가 LLM 0) / 동시 2 + 대기 4 초과 → 503 `ANALYSIS_BUSY` / `limiterWaitMs` 6초 → 503 busy, Riot 0회 |
| Data Dragon | `16.21.534.1234` → `16.21.1` 선택, 버전별 1번만 받기·동시 공유, 실패·3초 초과 → 스냅숏 + 경고, 4개 넘으면 오래된 것 삭제 |
| DTO | 응답 키 전체에 `grade`·`score`·`total`·`weight`·`impact`·`verdict`·`factIds`·`source`·`usage`·`costUsd`·`model`·`puuid`가 **없음**(재귀 검사), `keyMoments` 시각 매핑, `note`, `meta.knowledgeVersion=null` |
| 라우트 (`app.test.ts`) | POST 200, 같은 경로 GET 404, 다른 경로 POST 404, 깨진 JSON·3KB 본문·`text/plain`·배열 본문·`puuid` 누락 → 400, 오류에 `no-store`·`Retry-After`, `feedback` 미주입 → 500 |
| 로그·비밀값 | 분석 로그에 puuid 앞 8자만, `sk-ant-` 모양이 `***`로 가려짐, 응답·로그에 키 값 없음 |
| 환경 변수 | 기본값 전부 꺼짐/20/0.25, 잘못된 값 → 기능 끔 |

- 통합 테스트(`test:integration`)는 DB를 안 쓰므로 추가 없음. 기존 17개 통과만 확인.
- `!ai` 단위 테스트 159개 포함 기존 테스트는 그대로 통과해야 한다.

**실제 호출 계획과 예상 비용**

| 단계 | Riot | Anthropic | 예상 비용 |
|------|------|-----------|-----------|
| Build | 확인용 소량: `FEEDBACK_LLM_ENABLED=false`로 서버를 띄워 테스트 계정 검색 1회(≤24회) + 분석 POST 1~2회(2~4회) → 템플릿 응답·422·404 경로 확인 | **0회** | **$0** |
| Review | 검색 1회(≤24) + 분석 POST(2회) | `FEEDBACK_LLM_ENABLED=true`로 **1판 1번**(1~2회 호출) + 같은 POST 반복(캐시 적중 0원) + 동시 2요청(공유, 추가 0원) | **약 $0.07** (재시도 있으면 약 $0.10, 장치 기준 최악 $0.22) |
| 합계 | 수십 회 | 1~2회 | 5단계 배분 $0.25 안. 남은 크레딧 약 $4.55 → 약 $4.48 |

- 실제 LLM 호출은 메인 에이전트를 통해 예상 비용을 보여 주고 승인받은 뒤에만 한다(CLAUDE.md 12장 비용 규칙). 테스트 계정·판은 Review가 고르되, 가능하면 기준선 5판에 없는 솔로/자유랭크 판 1개로 해 실제 경로를 본다.

---

## 10. 완료 기준

> 요약: Review가 아래 항목을 하나씩 확인한다.

### 10-1. 코드와 검증

- `npm run typecheck`, `npm run lint` 오류 0, `npm audit` 취약점 0
- `npm test` 통과 (9-2 전부), `npm run test:integration` 통과, 끝난 뒤 테스트 데이터 0줄
- 코드에 패치 기준 이름이 없음 (`grep`): `refresh_patch_stats`, `purge_old_patches`, `FROM patch`, `keepPatches`, `maxGamesPerPatch`, `patch_full`, `old_patch`, `isFallback`, `PATCH_NOT_FOUND`, `selectPatch`, `parsePatchParam`, `patchSelection`, `FALLBACK_MIN_GAMES`
- 진입점 2개 분리 (API 서버가 `collector/*`를 import하지 않음). **(변경 03) API 서버도 `RIOT_API_KEY`를 읽는다** — 전적 검색 때문이며, 더 이상 "Riot 키를 읽지 않음"은 기준이 아니다

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

- 엔드포인트 5개(통계 4개 + 전적 검색)가 `api_contract.md` v3의 경로·파라미터·응답 필드·null 여부와 일치
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

### 10-6. 변경 03 (전적 검색)

- `GET /api/v1/summoners/:region/:riotId`: `region=kr`만 허용, 다르면 400. `riotId`는 마지막 `-`로 `gameName`/`tagLine` 분리
- Riot 호출 순서 account-v1 → summoner-v4+league-v4(병렬) → match-v5 ids → 상세(병렬, 일부 실패 허용), 캐시 미스 1건 최대 24회
- 응답에 `window` 없음, `Cache-Control: no-store`, 캐시 적중 여부 비표시
- 캐시: Map TTL 60초, 최대 200개, 실패 응답 캐시 안 함, 가장 오래 넣은 것부터 지움
- API 전용 `RateLimiter`(1초 10회/2분 50회)가 수집 CLI와 별도 인스턴스
- 오류: 404 `SUMMONER_NOT_FOUND`, 503 `RIOT_KEY_EXPIRED`(이 요청만 실패, 서버는 안 멈춤), 502 `RIOT_UNAVAILABLE`
- `collector/*` import 없음, `RIOT_API_KEY`는 `server.ts`에서만 읽음 (`grep`)
- 비밀값(`RIOT_API_KEY`)이 로그·응답에 그대로 나오지 않음. puuid는 응답 필드라 그대로 주는 게 맞음(서버 로그만 가림 규칙 적용)
- 실제 테스트 계정(`너희는개다#KR1`)으로 최소 1회 실제 호출 확인 (호출 수·429 0회·형식이 `api_contract.md` 2-5와 일치)

### 10-7. 변경 04 (킬관여·라인전 15분 골드)

| # | 기준 | 확인 |
|---|------|------|
| 1 | 라인전 계산 순수 함수 단위 테스트(정상, ≤15프레임, 포지션 Invalid/빈 값, 적 0명·2명, `totalGold` 없음, 반올림 5396:4939→52, 정글·서폿) | `npm test` |
| 2 | 호출 생략: 15분 미만 또는 포지션 없음이면 timeline 호출 0회 | 단위 테스트 |
| 3 | 캐시: 재요청 0회, 동시 2요청 1회, TTL 6시간 후 재호출, `gold15=null`도 재호출 안 함, 최대 5,000개 초과 시 오래된 것부터 삭제 | 단위 테스트 |
| 4 | 한도: 대기 > 1.5초면 남은 ID `pending`, `retryAfterSec`, HTTP 200 | 단위 테스트 |
| 5 | 오류 매핑: 401/403→503, 429·5xx 소진→502, timeline 404→`unavailable`, 참가자 아님→`unavailable`, 11개→400 | 단위 + 라우트 테스트 |
| 6 | 2-5는 `killParticipation` 추가 외 변하지 않음, 검색 1회 호출 수 24회 유지 | 기존 테스트 + 호출 수 단언 |
| 6b | 킬관여: `challenges` 값, 필드 없음→직접 계산, 팀 킬 합 0→`null`, 반올림, fixture 실제 값 일치 | `npm test` |
| 7 | 캐시 항목에 `frames` 없음(`gold15` 숫자만) | 단위 테스트 |
| 8 | 실제 Riot 소량(수십 회): 검색 1회 + lane-gold, 값이 손계산과 일치, 429 0회, 같은 요청 재호출 시 Riot 호출 0회 | Build·Review 실호출 |
| 9 | `typecheck`·`lint` 오류 0, `npm test` 전부 통과, `test:integration` 기존 17개 통과 | Build 기록 |
| 10 | 비밀값·`.env` 값이 로그·응답에 없음, 요청 로그의 puuid는 앞 8자 | `grep` + 로그 확인 |

- DB 계약 영향 없음, DB 쓰기 없음. 계약 버전은 v3의 "작은 추가".

### 10-8. 변경 05 (게임 피드백 분석)

| # | 기준 | 확인 |
|---|------|------|
| 1 | 9-5 단위·라우트 테스트 모두 통과, 기존 테스트(현재 323개) 그대로 통과 | `npm test` |
| 2 | `typecheck`·`lint` 오류 0, `test:integration` 17개 통과 | Build 기록 |
| 3 | `backend/src/analysis/**`·`cli/**`·`test/unit/analysis/**`·`test/eval/**` 변경 0줄 | `git diff --stat` |
| 4 | `@anthropic-ai/sdk` import는 여전히 `analysis/llm/client.ts`만, `process.env`는 `config/env.ts`(와 기존 CLI)만 읽음 | `grep` |
| 5 | 기본 설정(`.env`에 새 변수 없음)으로 서버를 켜면 503 `ANALYSIS_DISABLED`, LLM 클라이언트를 만들지 않음 | Build 실행 |
| 6 | `FEEDBACK_ENABLED=true`, LLM 끔: 실제 Riot으로 템플릿 200(모양이 계약 2-7과 일치), 자유/일반 판 422, 남의 puuid 404, Anthropic 호출 0 | Build 실행 |
| 7 | 응답에 등급·점수·총점·모델·토큰·비용·puuid가 없음 | DTO 테스트 + 실제 응답 확인 |
| 8 | (Review, 승인 뒤) LLM 켜고 1판: 200 `mode:"llm"`, 최종 숫자·방향·금지어 0(`!ai` 검증기로 재확인), 30초 안, 반복 요청 Riot 0·LLM 0, 장부·하루 수 1 증가, 장부 합이 로그 비용과 일치 | Review 실호출 |
| 9 | 키·`.env` 값이 로그·응답·장부·문서에 없음, 로그 puuid는 앞 8자 | `grep` + 로그 |
| 10 | `api_contract.md` v4(1장 메서드, 2장 표, 2-7, 3장 오류 6개, 4장 캐시, 6장 기록)가 계획대로이고, `.env.example`에 변수 4개, `back_build.md`에 기능별 상태 | 문서 대조 |

**Review 수준**

요약: **전체 독립 Review** (CLAUDE.md 3장 표 3번째 줄). 계약 문서의 규칙(1장 GET만)과 오류 코드가 바뀌고, 사용자 요청이 유료 외부 서비스 호출로 이어지는 첫 경로라서다.

- Review는 Build의 typecheck·lint·test 결과를 재실행 없이 믿고(3장), ① diff(예약·정산 경쟁 조건, 진행 중 Map 정리, 504 뒤 백그라운드 완료·캐시, 차단기, 오류 매핑, 비밀값 가림) ② 계약 2-7과 실제 응답 대조 ③ 실제 Riot + LLM 1판 (9-5, 승인 뒤) ④ 가짜 클라이언트로 429·504·busy 표본을 본다.
- Review 뒤 `back_review.md`, `back_overview.md`(덮어쓰기, 5장 API·6장 설정·변경 이력 1줄·해결되지 않은 점), `docs/career_log.md`(추가만)를 쓴다. AI 로드맵 5단계 상태는 메인 에이전트가 `docs/ai/` 쪽에 알린다(`!백엔드`는 `docs/ai/**`를 고치지 않음).

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
- 변경 05(게임 피드백 분석)도 DB 계약 변경 요청 없음(DB를 읽지도 쓰지도 않는다). API 계약(작성 영역)은 **v4**: 2-7 신규, 1장 메서드 규칙(GET + 분석 POST 1개), 3장 오류 코드 6개, 4장 캐시 줄, 6장 변경 기록. `!ai` 쪽 변경 요청도 없다(5-9-9).
- 변경 04(킬관여·라인전)도 DB 계약 변경 요청 없음. 읽지도 쓰지도 않는다. API 계약(작성 영역)은 2-5에 `killParticipation` 1개, 2-6 신규, 6장 변경 기록 1줄을 더했다(오류 코드 추가 없음).
- 변경 03(전적 검색)도 DB 계약 변경 요청 없음. `ranked_players`·`matches`·`match_players` 등 표본 수집 테이블을 읽지도 쓰지도 않는다 (W-6). `api_contract.md`에는 2-5를 새로 추가했다(승인된 범위, 작성 영역이라 요청이 아님).

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
| W1 | `region` 경로 값은 `kr`만 허용, 다르면 400 | `RIOT_PLATFORM_URL`/`RIOT_REGION_URL`이 단일 지역이다. 다지역은 범위 밖 | 2026-10-27 |
| W2 | `riotId`는 마지막 `-`에서 자른다 (`gameName-tagLine`) | tagLine은 짧은 영숫자로 고정, gameName은 자유 문자(하이픈 포함)라 마지막 `-`가 안전하다 | 2026-10-27 |
| W3 | API 전용 제한기는 Riot 실제 한도의 절반(1초 10회, 2분 50회) | 수집 CLI가 같은 키로 동시에 돌 수 있어 여유를 둔다. 429가 나도 재시도로 흡수돼 느려지기만 함 | 2026-10-27 |
| W4 | 캐시 TTL 60초 | "같은 소환사 반복 조회"를 줄이는 목적에 충분히 짧다 | 2026-10-27 |
| W5 | 401/403 로그는 매번 남긴다(제한 없음) | 검색 API 호출 빈도가 낮은 개발 단계라 스팸 위험이 작다 | 2026-10-27 |
| W6 | 캐시 적중 여부를 응답에 표시하지 않는다 | 계약을 단순하게 유지. 운영 확인은 서버 로그로 충분 | 2026-10-27 |
| W7 | Riot 클라이언트를 `summonerSearch` 함수로 감싸 `ApiDeps`에 주입한다 | 라우트가 Riot 세부사항을 몰라도 되고, 테스트에서 가짜 함수로 바꿔 끼우기 쉽다 | 2026-10-27 |
| W8 | `api_contract.md`에 2-5로 추가한다(새 장으로 빼지 않음) | 기존 번호 체계 유지. `window`가 없는 유일한 엔드포인트임을 문서에 명시 | 2026-10-27 |
| W9 | API 서버는 `RIOT_API_KEY`가 없거나 잘못돼도 계속 켜지고, 전적 검색만 503 `RIOT_KEY_EXPIRED`를 준다 | 개발 키가 24시간마다 만료된다. 키 문제로 챔피언 통계 API까지 막히면 안 된다 | 2026-10-27 |

| X1 | API 전용 제한기를 18/초·90/120초로 올린다. 수집 CLI와 API 서버를 같은 키로 동시에 돌리지 않는 것을 운영 규칙으로 문서화 | 라인전 timeline이 더해져 신규 검색 1회가 최대 44회. 10/50이면 같은 2분 안의 두 번째 소환사가 약 100초 대기한다. 상수 1곳이라 되돌리기 쉽다 | 2026-10-30 |
| X2 | 경기 캐시 TTL 6시간, 최대 5,000개. 저장 값은 경기 정보 + `gold15` 숫자뿐 | 끝난 게임은 불변. timeline 원본 0.6MB는 저장하지 않는다(메모리 ~100B/게임 수준) | 2026-10-30 |
| X3 | lane-gold 한 번에 최대 10개 ID, 제한기 대기 1.5초 초과분은 `pending` | 요청 하나가 줄을 오래 점유하지 않게. 첫 검색 응답이 먼저 나가도록 라인전은 한도에 여유가 있을 때만 쓴다 | 2026-10-30 |
| X4 | 검색의 `getMatch` 상세를 경기 캐시에 통째로 넣지 않는다 | 상세 1개 수십~백 KB로 메모리가 커지고 라인전과 별개의 최적화. 다음 변경 후보 | 2026-10-30 |
| X5 | `pending`일 때 HTTP 200 + `retryAfterSec` (429 아님) | 프론트가 429 처리를 따로 짜지 않아도 된다 | 2026-10-30 |
| X6 | 킬관여는 2-5에 합침(추가 호출 0), 라인전만 별도 엔드포인트(B안) | 킬관여는 match-v5 상세에 있고, 라인전(timeline)은 첫 화면을 약 2배 느리게 하고 한도를 즉시 소진한다 | 2026-10-30 |
| F1 | 화면 위치는 매치 행을 펼친 안쪽 (프론트 몫) | 사용자 결정 5-9-0 #1 | 2026-11-03 |
| F2 | 분석 대상은 검색한 소환사 본인만 (`puuid`가 참가자) | 사용자 결정 5-9-0 #2 | 2026-11-03 |
| F3 | 솔로랭크(420)·자유랭크(440), 900초 이상만. 그 밖 422 | 사용자 결정 5-9-0 #3. 엔진 규칙이 랭크 5인 포지션 판 기준 | 2026-11-03 |
| F4 | 하루 LLM 분석 상한 20회(비용이 든 분석만, 캐시 제외, KST 자정 초기화) | 사용자 결정 5-9-0 #4. 비용 보호 | 2026-11-03 |
| F5 | 상한 초과는 템플릿이 아니라 429 `ANALYSIS_LIMIT_REACHED` | 사용자 결정 5-9-0 #5 | 2026-11-03 |
| F6 | 결과는 서버 메모리 캐시(재시작 시 사라짐), DB 테이블 없음 | 사용자 결정 5-9-0 #6. DB 계약 변경 없이 시작 | 2026-11-03 |
| F7 | 버튼을 눌렀을 때만 분석 (자동 분석 없음) | 사용자 결정 5-9-0 #7. 비용 | 2026-11-03 |
| F8 | 분석은 POST(계약 1장 "GET만" 변경), `puuid`는 본문 | 부작용(비용·상한·캐시)이 있어 GET 의미에 맞지 않고, 프리페치·크롤러의 실수 호출을 막고, puuid가 URL·로그에 남지 않는다 | 2026-11-03 |
| F9 | 스위치 2개(`FEEDBACK_ENABLED`, `FEEDBACK_LLM_ENABLED`) 기본 꺼짐 | 12장 F9~F18 Q1. `.env`에 Claude 키가 있어도 켜기 전에는 0원 | 2026-11-03 |
| F10 | LLM 실패는 200 + 템플릿(상한·예산 초과만 429) | 12장 F9~F18 Q2. 사용자는 항상 결과를 받는다(`!ai` J절과 같음) | 2026-11-03 |
| F11 | API 전용 장부(`backend/logs/feedback-api-ledger.jsonl`, git 제외), 누적 상한 $0.25 | 12장 F9~F18 Q3. 평가 장부와 섞지 않고 예산을 따로 정한다 | 2026-11-03 |
| F12 | 응답 30초 상한, 넘으면 504이고 서버는 분석을 끝내 캐시 | 12장 F9~F18 Q4. 이미 낸 비용을 버리지 않고 다시 누르면 비용 0 | 2026-11-03 |
| F13 | Data Dragon B안: 판 패치별로 처음 필요할 때 받고 실패 시 스냅숏(16.21.1) | 12장 F9~F18 Q5. 판의 패치와 맞고 새 챔피언 자동 반영. 무료·키 없음 | 2026-11-03 |
| F14 | LLM 동시 실행 2, 대기 4, 넘치면 503 `ANALYSIS_BUSY` | 12장 F9~F18 Q6 | 2026-11-03 |
| F15 | 재시작 시 장부로 오늘(KST) 사용 수 복원 | 12장 F9~F18 Q7. 재시작으로 상한이 풀리지 않게 | 2026-11-03 |
| F16 | 응답에 판정어·근거 ID·출처를 넣지 않고 `mode`·`templateReason`만 | 12장 F9~F18 Q8. 등급처럼 보이는 값 배제. 나중에 필드 추가로 가능 | 2026-11-03 |
| F17 | `npm audit fix`(lock만) 함께 | 12장 F9~F18 Q9. 결과: typescript-eslint 8.71.2→8.72.1 등 개발 의존성 패치, body-parser는 이미 2.4.0. 남은 moderate 11건(eslint 쪽 minimatch)은 `--force`(호환 깨짐)가 필요해 하지 않음 | 2026-11-03 |
| F18 | 실제 LLM 1판 호출은 Review에서만(Build 0원), 문장 품질은 `!ai`가 별도로 | 12장 F9~F18 Q10·Q11 | 2026-11-03 |
| F19 | 꺼짐·미설정 오류를 `FeedbackFn.unavailable`로 표시해 본문 파싱 전에 응답 | 5-9-4 ① "스위치가 입력 검사보다 먼저"를 지키려고 (Build가 보탠 결정) | 2026-11-03 |
| F20 | 잘못된 환경 변수 값은 분석 기능 전체를 끈다, `FEEDBACK_DAILY_LIMIT=0`은 템플릿 `llm_off` | 보수적으로 끄고 서버는 켠다(W9). 0은 의도적인 설정이라 오류가 아니라 LLM 끔으로 본다 (Build) | 2026-11-03 |
| F21 | `keyMoments`는 0~3개 | 설계(feedback_design 2-1 최대 3개)와 실제 엔진·LLM 결과(세나 판 3개)에 맞춤. 계획 초안의 "0~2개"를 고침 (메인 에이전트 확인) | 2026-11-03 |
| X7 | 요청 로그의 `puuid` 쿼리 값을 앞 8자로 줄인다 | lane-gold는 puuid가 쿼리에 있어 기존 요청 로그가 전체 puuid를 남긴다. 로그 규칙(puuid 앞 8자)을 지킨다 (Build가 보탠 결정) | 2026-10-30 |
| G1 | 매치 상세 지표는 2-5에 필드를 더하는 방식(새 엔드포인트·Riot 추가 호출 없음), 다른 참가자는 `isMe`로만 구분 | 이미 받는 match-v5 상세에 값이 다 있다. 펼침 때 다시 부르지 않아 화면이 바로 열린다. 대가로 응답이 약 3.5배(29→102 KB, 압축 전) (변경 06, 사용자 승인) | 2026-11-03 |

- D 번호는 계획의 결정 항목, B는 Build가 정하고 Review가 받아들인 것, U는 변경 01의 사용자 결정, R은 Review 추천을 사용자가 고른 것, V는 변경 02에서 사용자가 승인한 결정(02-9)이다. W는 변경 03(전적 검색)에서 사용자가 승인한 추천안(결정 S1~S8, Build가 보탠 W9)이다. X는 변경 04(킬관여·라인전)에서 사용자가 승인한 추천값(X1~X6)과 Build가 보탠 X7이다. F는 변경 05(게임 피드백 분석)의 사용자 결정(F1~F7: 5-9-0, F8~F18: 계획과 사용자 결정 질문 11개 승인)과 Build가 보탠 F19~F21이다. G는 변경 06(매치 상세 지표)이다.

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

- 수정 금지: `db/`, `docs/contracts/db_contract.*`, `frontend/`, 루트 `.env`, `CLAUDE.md`, `backend/src/collector/*`, `backend/src/cli/collect.ts`.
- 변경 02(15명 400 조사, L1~L5, 프리셋 250, 계약 문구 2건)도 위 표와 같은 경로를 쓴다. 조사(02-1)는 읽기만(`SELECT`, 로그 읽기), 결정 1번이 "삭제"면 `ranked_players` DELETE는 사용자 승인 후에만.
- 변경 05(게임 피드백 분석): 아래 표.

| 단계 | 수정 가능 경로 |
|------|----------------|
| Plan | `backend/docs/back_spec.md` (이 절) |
| Build | `backend/src/api/**`, `backend/src/config/{env,feedback}.ts`, `backend/src/lib/logger.ts`, `backend/src/riot/types.ts`(선택 필드만), `backend/src/server.ts`, `backend/data/ddragon/`(신규), `backend/test/unit/**`(단 `test/unit/analysis/**` 제외), `backend/docs/back_build.md`, `backend/docs/back_spec.md`(이 절 합치기), `docs/contracts/api_contract.md`(api_contract 2-7만), `.env.example`(7-6 4개 + `FEEDBACK_BUDGET_USD` 설명 문구) |
| Review | `backend/docs/back_review.md`, `back_build.md`, `back_overview.md`, 문제 수정 시 Build 경로, `docs/career_log.md`(추가만) |
| 금지 | 5-9-10 "수정 금지" 목록. `package.json`·`package-lock.json`은 고치지 않는다(새 의존성 없음) — 단 `npm audit fix` 결과(lock)만 (12장 F17, 승인됨) |

- Riot: 확인용 소량(수십 회), 429가 나면 즉시 멈추고 보고. Anthropic: Build 0회, Review 승인된 1판만.
- 비밀값: `.env` 값은 읽어 써도 되지만 출력하지 않는다. 스위치를 켠 실행은 프로세스 환경 변수로만 하고 `.env`를 고치지 않는다.

- 변경 04(킬관여·라인전)도 위 표와 같은 경로를 쓴다. 범위는 `backend/src/riot/types.ts`, `backend/src/riot/client.ts`(제한기 대기시간 getter만), `backend/src/api/*`, `backend/src/config/summoner.ts`, `backend/src/server.ts`, `backend/test/*`이고, `docs/contracts/api_contract.md`는 2-5의 `killParticipation`·2-6·6장 변경 기록만 고친다. 금지 경로는 위 "수정 금지"와 같다.
- 변경 03(전적 검색)도 위 표와 같은 경로를 쓴다. 범위는 `backend/src/riot/*`, `backend/src/api/*`, `backend/src/config/*`, `backend/src/server.ts`, `backend/test/*`이고, `docs/contracts/api_contract.md`는 승인된 2-5만 고친다. `collector/*`·`cli/collect.ts`는 수정하지 않는다.
- DB 쓰기: 통합 테스트는 ROLLBACK만. 실제 저장은 Review 소량 수집과 `aggregate` 시험뿐. **`purge --yes`, 표본 삭제, 그 밖의 되돌릴 수 없는 SQL은 메인 에이전트를 통해 사용자 승인 후에만.**
- Riot 호출: Build·Review는 확인용 소량(수십 회)만. fixture는 이미 있어 새로 받지 않는다. 전체 테스트 수집은 사용자가 직접 실행한다. 전적 검색도 테스트 계정으로 소량만 부른다. 429가 나면 즉시 멈추고 보고.
- 비밀값: `.env` 값은 읽어 써도 되지만 문서·로그·커밋·응답에 출력하지 않는다. 잘못된 키 시험은 프로세스 환경에만 넣고 `.env`를 고치지 않는다.
