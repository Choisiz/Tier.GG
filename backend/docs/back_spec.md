# 백엔드 계획서 — 01 수집 워커 + 챔피언 통계 API

> 작성: Plan 에이전트 / 작성일: 2026-10-14 / 상태: **승인됨 (2026-10-14, D1~D10 추천안)**
> 읽는 계약: `docs/contracts/db_contract.md`, `docs/contracts/db_contract.dbml` (v6, 승인됨)
> 작성하는 계약: `docs/contracts/api_contract.md` (초안, 이 계획과 함께 승인받는다)
>
> **변경 01 (2026-10-15, 승인됨):** DB v7(최근 14일 기준)에 맞춘 수집기·API 변경은 문서 끝 [`## 변경 01`](#변경-01-날짜-2026-10-15-최근-14일-기준-대응)에 있다. 1~13장은 v1(패치 기준) 기록으로 남긴다. 둘이 다르면 변경 01이 우선이다.

---

## 1. 개요

> 요약: Riot API에서 솔로랭크 게임을 모아 DB에 넣는 **수집 명령어**와, 집계 결과를 프론트에 주는 **읽기 API**를 만든다.

### 1-1. 이번에 하는 것

| # | 항목 | 설명 |
|---|------|------|
| 1 | 수집 CLI | 표본 플레이어 → 게임 ID → 게임 상세·타임라인 → DB 저장 → `ANALYZE` → 집계. 명령어로 직접 실행 |
| 2 | Riot 클라이언트 | 1초 20회 + 2분 100회 이중 제한, 429 재시도, 401/403 즉시 중단 |
| 3 | 변환 | Riot JSON → `match_players` 10줄. 계약 6·7장 규칙 그대로 |
| 4 | 읽기 API | 메타(패치 정보), 포지션별 티어리스트, 챔피언 상세(포지션 + 빌드) |
| 5 | 테스트 | 변환·제한기 단위 테스트, Supabase 롤백 통합 테스트 |
| 6 | 계약 | `docs/contracts/api_contract.md` 초안 |

### 1-2. 이번에 하지 않는 것

| 항목 | 이유 |
|------|------|
| 본 수집 (에메랄드 이상 4:4:2, 패치당 2만 5천 게임) | 테스트 뒤 다시 정함. 설정값만 바꾸면 되게 구조만 준비 |
| 마스터 이상 리그 API (`masterleagues` 등) | 본 수집 범위. 테스트는 디비전이 있는 티어만 |
| 스케줄러(자동 수집) | 개발 키가 24시간마다 만료. 수동 실행 |
| 전적 검색, SSE 새로고침, AI 피드백 | 이후 단계 |
| HTTP로 수집 실행 | 예전 실수. 수집은 CLI로만 (API는 읽기 전용) |
| DB 스키마 변경 | `!db` 영역. 필요하면 11장 "계약 변경 요청"에 적는다 |
| 이름·이미지 | 백엔드는 숫자 ID만 준다. 이름·이미지는 프론트가 Data Dragon으로 |

### 1-3. 예전 백엔드에서 가져올 것과 버릴 것

> 요약: 이중 창 제한기 아이디어는 쓰고, GET으로 수집하기·전체 TRUNCATE·`spell1Casts` 오용은 다시 하지 않는다.

| 예전 코드 (`0234719`) | 이번 처리 |
|-----------------------|-----------|
| `rateLimiter.ts` 이중 창(1초·2분) | **가져옴.** 단 한도 20/100으로, 429 `Retry-After` 처리 추가 |
| `tsx`, `pg`, `express` | 가져옴 (8장) |
| `axios`, `dotenv`, `cors` | 버림. Node 24 내장 `fetch`, `--env-file`, 서버 간 호출이라 CORS 불필요 |
| HTTP GET이 수집을 실행 | 버림. 수집은 CLI만 |
| 실행마다 TRUNCATE | 버림. `ON CONFLICT DO NOTHING` + 패치 단위 집계 함수 |
| `spell1Casts`를 소환사 주문으로 사용 | 버림. `summoner1Id`/`summoner2Id` (계약 6-3) |

---

## 2. 구조

> 요약: 한 코드베이스에 실행 진입점 2개(API 서버, 수집 CLI)를 두고, 설정·DB·Riot·변환·저장소 모듈을 함께 쓴다.

### 2-1. 폴더 구조

```
backend/
├── docs/
│   ├── back_spec.md            # 이 문서
│   ├── back_build.md           # Build 기록
│   └── back_review.md          # Review 기록
├── package.json                # scripts: dev, start, collect, typecheck, lint, test, test:integration
├── tsconfig.json               # strict, module NodeNext, noEmit (tsx로 실행)
├── eslint.config.mjs           # @eslint/js + typescript-eslint 권장 규칙
├── src/
│   ├── server.ts               # 진입점 1: API 서버 (app.listen)
│   ├── cli/
│   │   └── collect.ts          # 진입점 2: 수집 CLI (하위 명령 run / sample / matches / aggregate / purge)
│   ├── config/
│   │   ├── env.ts              # 환경 변수 읽기·검사 (값은 출력하지 않음)
│   │   ├── collection.ts       # 수집 프리셋 (test, main) + CLI 덮어쓰기
│   │   └── api.ts              # API 규칙 상수 (최소 50판, 2순위 10%, 대체 기준 게임 수, 상세 상위 N)
│   ├── db/
│   │   ├── pool.ts             # pg Pool 1개, 오류 메시지 가리기
│   │   └── tx.ts               # withTransaction(client => …), Queryable 타입
│   ├── riot/
│   │   ├── rateLimiter.ts      # 이중 창 제한기 (시계 주입 가능)
│   │   ├── client.ts           # fetch + 제한기 + 재시도 + 오류 분류
│   │   ├── errors.ts           # RiotKeyExpiredError, RiotNotFoundError, RiotRetryExhaustedError
│   │   └── types.ts            # 사용하는 필드만 정의한 응답 타입
│   ├── collector/
│   │   ├── transform.ts        # 순수 함수: match + timeline → MatchRow + 10 PlayerRow (또는 건너뛸 이유)
│   │   ├── sample.ts           # ① 표본 플레이어
│   │   ├── matches.ts          # ②~⑤ 게임 ID, 상세, 타임라인, 저장
│   │   ├── aggregate.ts        # ⑥ ANALYZE + refresh_patch_stats, ⑦ purge
│   │   └── runLog.ts           # collection_logs 시작·종료 기록
│   ├── repositories/
│   │   ├── rawRepository.ts    # ranked_players upsert, matches/match_players 저장, 이미 있는 ID 조회
│   │   ├── logRepository.ts    # collection_logs
│   │   └── statsRepository.ts  # patch, champion_tier_view, champion_item/rune/spell/skill 읽기
│   ├── api/
│   │   ├── app.ts              # createApp(db) — 테스트에서 롤백 연결을 넣을 수 있게
│   │   ├── routes/meta.ts      # GET /api/v1/meta, /api/v1/health
│   │   ├── routes/champions.ts # GET /api/v1/champions, /api/v1/champions/:championId
│   │   ├── validate.ts         # 쿼리·경로 파라미터 검사 (직접 작성)
│   │   ├── errors.ts           # ApiError, 오류 응답 형식, 오류 미들웨어
│   │   ├── patchSelection.ts   # 표시 패치 결정 (직전 패치 대체 규칙)
│   │   ├── mainPositions.ts    # 주 포지션 최대 2개 규칙
│   │   └── dto.ts              # DB 줄 → 응답 DTO (숫자 변환, 비율 계산)
│   └── lib/
│       └── logger.ts           # 한 줄 로그 + 비밀값 가리기 (DATABASE_URL, RIOT_API_KEY)
└── test/
    ├── fixtures/
    │   ├── KR_8408851980.match.json     # 실제 게임 (puuid는 가짜 값으로 바꿔 저장)
    │   └── KR_8408851980.timeline.json  # 같은 게임 타임라인 (SKILL_LEVEL_UP 외 이벤트는 줄여 저장)
    ├── unit/                   # transform, rateLimiter, client(가짜 fetch), patchSelection, mainPositions, validate
    └── integration/            # 실제 Supabase, BEGIN … ROLLBACK
```

### 2-2. 진입점 2개

> 요약: API 서버와 수집 CLI는 따로 실행한다. 둘 다 루트 `.env`를 `node --env-file=../.env`로 읽는다.

| 진입점 | 명령 (backend/에서) | 하는 일 | DB |
|--------|---------------------|---------|-----|
| API 서버 | `npm run dev` (watch) / `npm start` | 읽기 API만. Riot 키를 쓰지 않음 | 읽기만 |
| 수집 CLI | `npm run collect -- <하위 명령> [옵션]` | Riot 호출, 저장, 집계 | 읽기·쓰기 |

- 스크립트 예: `"collect": "node --env-file=../.env --import tsx src/cli/collect.ts"`
- API 서버는 `RIOT_API_KEY`가 없어도 켜진다. 수집 CLI는 없으면 바로 종료한다.

### 2-3. 공유 모듈

> 요약: 두 진입점이 같은 설정·DB·저장소 코드를 쓴다. 저장소 함수는 연결(`Queryable`)을 인자로 받아 테스트에서 롤백할 수 있다.

| 모듈 | 핵심 규칙 |
|------|-----------|
| `config/env.ts` | `DATABASE_URL`, `RIOT_API_KEY`, `RIOT_PLATFORM_URL`, `RIOT_REGION_URL`, `API_PORT`(새 변수, 기본 4000)를 읽고 형식만 검사. 값은 절대 출력하지 않음 |
| `db/pool.ts` | `pg.Pool` 1개 (API `max 5`, CLI `max 2`). Session pooler 연결 수 한도를 넘지 않게. 오류는 `logger`가 가린 뒤 출력 |
| `db/tx.ts` | `withTransaction(pool, fn)`: `BEGIN` → fn → `COMMIT`, 예외 시 `ROLLBACK` |
| `riot/client.ts` | 헤더 `X-Riot-Token`으로 키 전달 (URL에 넣지 않음). 모든 호출이 제한기를 거침 |
| `collector/transform.ts` | DB·네트워크 없이 순수 함수. 단위 테스트의 중심 |
| `repositories/*` | SQL은 여기에만. `numeric`·`bigint`는 SQL에서 `::int`/`::float8`로 바꾸거나 `dto.ts`에서 `Number()` (pg는 문자열로 줌) |

---

## 3. 수집 워커

> 요약: ① 표본 → ② 게임 ID → ③ 상세 → ④ 타임라인 → ⑤ 한 게임씩 트랜잭션 저장 → ⑥ `ANALYZE` 후 집계. 다시 실행하면 이미 저장한 게임은 건너뛰어 이어서 모은다.

### 3-1. 하위 명령

> 요약: 보통은 `run` 하나만 쓰고, 나머지는 단계별로 따로 돌리거나 복구할 때 쓴다.

| 명령 | 단계 | 설명 |
|------|------|------|
| `run --preset test` | ①~⑥ | 기본 흐름. 표본이 이미 있으면 ①을 건너뜀 |
| `sample --preset test [--resample]` | ① | 표본만 새로 뽑기 |
| `matches --preset test` | ②~⑤ | 저장된 표본으로 게임만 모으기 (⑥ 없음) |
| `aggregate [--patch 16.19]` | ⑥ | `ANALYZE` + 집계만. 패치를 안 주면 `matches`에 있는 모든 패치 |
| `purge [--yes]` | ⑦ | 오래된 원본 삭제. `--yes` 없으면 지울 게임 수만 보여줌 (결정 D9) |

공통 옵션: `--max-matches <n>`(이번 실행에서 새로 저장할 최대 게임 수, Review 소량 수집용), `--players-per-tier`, `--games-per-player`, `--tiers PLATINUM,EMERALD`.

### 3-2. 단계별 흐름

> 요약: Riot 호출은 모두 제한기를 거치고, DB 쓰기는 ①의 upsert와 ⑤의 게임 단위 트랜잭션뿐이다.

| 단계 | 호출 | 하는 일 | 저장 |
|------|------|---------|------|
| 0 준비 | DB | 수집 잠금 `pg_try_advisory_lock(hashtext('tiergg:collector'))` (실패하면 "다른 수집이 실행 중" 후 종료). 남아 있는 `running` 기록은 `failed`(`error_message='비정상 종료로 남은 기록'`)로 닫음. 새 `collection_logs` 1줄 `running` | `collection_logs` |
| ① 표본 | `league-v4 /lol/league/v4/entries/RANKED_SOLO_5x5/{tier}/{division}?page=1` (`RIOT_PLATFORM_URL`) | 티어 3개 × 디비전 4개 = **12회**. 한 페이지 205명 중 `inactive=false`인 사람에서 무작위로 디비전당 12~13명 (I·II 13명, III·IV 12명 → 티어당 50명). 표본이 이미 있고 `--resample`이 없으면 건너뜀 | `ranked_players` upsert (`puuid`, `tier`, `rank`) |
| ② 게임 ID | `match-v5 /lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&start=0&count=20` (`RIOT_REGION_URL`) | 표본 150명 = **150회**. `Map<matchId, 처음 찾은 puuid>`로 메모리 중복 제거 → `SELECT match_id FROM matches WHERE match_id = ANY($1)`로 이미 저장된 ID 제거 → 숫자 내림차순(최신 게임 먼저) 정렬 | 없음 |
| ③ 상세 | `match-v5 /lol/match/v5/matches/{matchId}` | 먼저 거르기: `queueId ≠ 420`, `gameDuration < 300`, 참가자 ≠ 10명, 보관 패치 밖(3-4) → **④를 부르지 않고** 건너뜀 (호출 절약) | 없음 |
| ④ 타임라인 | `match-v5 /lol/match/v5/matches/{matchId}/timeline` | `SKILL_LEVEL_UP`으로 `skill_order` | 없음 |
| ⑤ 저장 | DB 트랜잭션 1개 | `transform` 결과로 `matches` 1줄 `ON CONFLICT (match_id) DO NOTHING` → 영향 0줄이면 `ROLLBACK`(다른 실행이 저장함) → `match_players` 10줄 한 문장 INSERT → `COMMIT` | `matches`, `match_players` |
| ⑥ 집계 | DB 연결 1개 | `SET statement_timeout = '5min'` → `ANALYZE matches, match_players` → 이번 실행에서 저장한 패치마다 `SELECT refresh_patch_stats($1)` (패치 순서대로). 반환 jsonb를 로그에 출력 | 집계 6개 |
| 종료 | DB | `collection_logs`를 `done`(또는 3-5의 상태)으로, `finished_at`, `players`(②에서 조회한 표본 수), `matches_saved` 기록. 잠금 해제 | `collection_logs` |

- 예상 호출 수(테스트): 12 + 150 + 약 2,700 × 2 ≈ **5,560회** → 2분 100회 기준 약 **1시간 50분**.
- ③의 참가자를 ①의 표본에 다시 넣지 않는다 (계약 5장).
- 표본 플레이어는 ①에서 `ranked_players`에 먼저 들어가므로 `matches.puuid` FK가 항상 맞는다.
- ⑥은 **게임 수와 관계없이 항상** `ANALYZE`를 먼저 한다 (계약 9-4, db_review L6: 5,000게임도 통계가 틀리면 2분 초과). `ANALYZE`와 `refresh_patch_stats`는 같은 연결에서 실행한다.
- 이번 실행에서 저장한 게임이 0개면 ⑥을 건너뛴다 (집계할 변화 없음). `refresh_patch_stats`가 "완료 게임 0개" 오류를 내면 그 패치만 경고로 남기고 기존 집계를 둔다.

### 3-3. 중복 제거와 이어서 모으기

> 요약: 따로 상태 파일을 두지 않고 DB를 상태로 쓴다. 같은 명령을 다시 실행하면 저장된 게임은 건너뛰고 남은 것만 모은다.

| 상태 | 어디에 | 다시 실행할 때 |
|------|--------|----------------|
| 표본 | `ranked_players` | 설정한 티어의 줄이 있으면 ①을 건너뛰고 그대로 사용 (`--resample`일 때만 다시 뽑음) |
| 저장한 게임 | `matches` (+ `match_players` 10줄) | ②에서 이미 있는 ID 제거. 저장은 게임 단위 트랜잭션이라 반쪽 게임이 없음 |
| 실패한 게임 | 저장 안 함 | 다음 실행에서 자연히 다시 시도 |
| 5분 미만·창 밖 게임 | 저장 안 함 (메모리에서만 건너뜀) | 다음 실행에서 ③을 다시 부름. 전체의 1~2% 정도라 감수 (한계) |
| 실행 기록 | `collection_logs` | 매 실행 새 줄 |

- 다시 실행해도 ②는 150회를 다시 부른다(약 3분). 대신 상태 파일이 없어 꼬일 일이 없다 (결정 D7).
- `--resample`은 `ranked_players`에 사람을 **더한다** (upsert, 삭제 없음). ②는 설정한 티어의 모든 표본을 쓴다. 표본 정리(삭제)는 이번 범위가 아니다 (db_review L3: 삭제하려면 `matches(puuid)` 인덱스가 먼저 필요).

### 3-4. 보관 패치 밖 게임

> 요약: 최신 2개 패치보다 오래된 게임은 저장하지 않는다 (계약 7장 권장).

- 기준 패치 집합 = `SELECT DISTINCT patch FROM matches` ∪ 이번 실행에서 ③으로 본 패치, `patch_sort_key` 방식으로 비교 (TS에서도 `[major, minor]` 숫자 비교, 문자열 비교 금지).
- 이 집합의 최신 2개보다 오래된 패치면 건너뛴다 (④ 호출 안 함).
- ②에서 게임 ID를 숫자 내림차순으로 처리하므로, 최신 패치가 먼저 보여 창이 실행 초반에 정해진다.
- 본 수집용 `maxGamesPerPatch`(25,000)도 설정에 둔다. 테스트 프리셋에선 의미 없음(약 2,700게임).

### 3-5. 오류·중단 처리 (요약, 자세한 표는 6장)

> 요약: 키 만료는 즉시 멈추고, 일시 오류는 재시도하고, 게임 하나의 오류는 그 게임만 건너뛴다.

| 상황 | 동작 | `collection_logs.status` | 종료 코드 |
|------|------|--------------------------|-----------|
| 정상 끝 | ⑥까지 | `done` | 0 |
| 401/403 | 진행 중 게임은 저장 안 함(트랜잭션 전이거나 `ROLLBACK`). 즉시 멈추고 ⑥ 건너뜀. 안내: "키를 재발급하고 같은 명령을 다시 실행" | `key_expired` | 2 |
| Ctrl+C (SIGINT) | 지금 게임의 트랜잭션을 끝낸 뒤 멈춤. ⑥ 건너뜀 | `failed` (`error_message='사용자 중단'`) | 130 |
| 게임 연속 20개 실패, DB 연결 끊김, 예상 못한 오류 | 멈춤 | `failed` (`error_message` = 가린 오류 문장, 500자 이하) | 1 |
| ⑥ 실패 | 원본은 남아 있음. `aggregate`로 다시 실행 가능 | `failed` | 1 |

### 3-6. 제한기 (rate limiter)

> 요약: 예전 이중 창 방식을 그대로 쓰되 한도를 계약 값에 맞추고, Riot이 429를 주면 그 지시를 따른다.

| 항목 | 값 |
|------|-----|
| 창 | 1초 20회, 120초 100회 (설정: 여유분으로 기본 19회 / 98회) |
| 범위 | 모든 Riot 호출이 **하나의 제한기**를 공유 (kr·asia 따로 세는 것보다 보수적. kr 호출은 12회뿐이라 손해 없음) |
| 동시성 | 한 번에 1개 요청 (순차). 지연 약 0.1~0.3초라 2분 100회를 순차로도 다 씀 |
| 429 | `Retry-After`초(없으면 10초) 기다리고 같은 요청 재시도, 최대 5번. 제한기 창도 그만큼 비움 |
| 관찰 | 응답의 `X-App-Rate-Limit-Count`를 10분마다 로그에 남김 (Review에서 실제 사용량 확인용) |
| 시계 | `now()`·`sleep()`을 주입 가능하게 만들어 단위 테스트에서 가짜 시계 사용 |

- 2026-10-14 실제 호출(league-v4 1회)로 응답 헤더 `x-app-rate-limit: 100:120,20:1`, `x-method-rate-limit: 50:10`을 확인했다. 계약 값과 같다.

### 3-7. 정리 정책 (`purge_old_patches`)

> 요약: 되돌릴 수 없는 삭제라 자동으로 돌리지 않고, `purge --yes`로만 실행한다.

- `purge` (옵션 없음): `matches`의 패치별 게임 수와, 지워질 패치·게임 수를 보여주고 끝냄 (읽기만).
- `purge --yes`: 지울 패치가 모두 `patch` 테이블에 집계돼 있는지 확인한 뒤(없으면 거부: "먼저 `aggregate --patch X`") `SELECT purge_old_patches(2)`.
- 순서는 항상 ⑥ 뒤 (계약 5장 ⑦). 테스트 수집은 패치 1~2개라 지울 것이 없다.

---

## 4. Riot → DB 변환 규칙

> 요약: 계약 6장(필드 위치)과 7장(저장 규칙)을 그대로 코드로 옮긴다. 규칙에 안 맞는 게임은 저장하지 않고 이유를 센다.

### 4-1. `ranked_players` (league-v4 entries)

| 컬럼 | 값 | 비고 |
|------|-----|------|
| `puuid` | `entries[].puuid` | 78자 |
| `tier` | `entries[].tier` | 요청한 티어와 같은지 확인. 허용 값(계약 1-1) 밖이면 건너뜀 |
| `rank` | `entries[].rank` | Riot 값 그대로 (`I`~`IV`) |

- upsert: `ON CONFLICT (puuid) DO UPDATE SET tier = EXCLUDED.tier, rank = EXCLUDED.rank`.

### 4-2. `matches` (getMatch)

| 컬럼 | 값 | 비고 |
|------|-----|------|
| `match_id` | `metadata.matchId` | `^KR_[0-9]+$` (DB CHECK) |
| `puuid` | ②에서 이 ID를 처음 찾은 표본 플레이어 | 이미 저장된 게임은 그대로 둠 (`DO NOTHING`) |
| `patch` | `info.gameVersion.split('.')`의 앞 두 개를 `.`으로 | `16.19.823.722` → `16.19`. `^[0-9]+\.[0-9]+$` 검사 |

### 4-3. `match_players` (getMatch `info.participants[]` + timeline)

| 컬럼 | 값 | 규칙 |
|------|-----|------|
| `match_id` | `metadata.matchId` | |
| `puuid` | `participants[].puuid` | |
| `champion_id` | `championId` | `> 0` |
| `team_position` | `teamPosition` | `""`·없음 → NULL. `TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY` 밖의 값도 NULL + 경고 (DB CHECK 보호) |
| `win` | `win` | boolean |
| `ban_champion_id` | `info.teams[].bans[]`를 모아 `pickTurn → championId` 표를 만들고, 그 참가자의 `participantId`로 찾음 | `-1`·`0` 이하 → NULL. 짝이 없으면 NULL + 경고 카운트 |
| `summoner1_id`, `summoner2_id` | `summoner1Id`, `summoner2Id` | 그대로 (정렬은 집계 함수가 함). `spell1Casts` 등 `*Casts` 필드는 쓰지 않음 |
| `primary_style` | `perks.styles[]` 중 `description = 'primaryStyle'`의 `style` | 없으면 `styles[0]` |
| `primary_perk1~4` | 그 스타일의 `selections[0..3].perk` | 4개가 아니면 게임 건너뜀 |
| `sub_style` | `description = 'subStyle'`의 `style` | 없으면 `styles[1]` |
| `sub_perk1~2` | `selections[0..1].perk` | 2개가 아니면 게임 건너뜀 |
| `stat_offense/flex/defense` | `perks.statPerks.offense/flex/defense` | |
| `item0~5` | `item0`~`item5` | 그대로. 빈 칸 `0` (NULL 아님). 같은 아이템 2개도 그대로. `item6`은 저장 안 함 |
| `skill_order` | timeline 아래 4-4 | |

### 4-4. `skill_order` 만들기

> 요약: 그 참가자의 `SKILL_LEVEL_UP` 중 `NORMAL`만 시간 순서로 Q/W/E/R로 이어 붙인다. 카이사 등의 `EVOLVE`는 뺀다.

1. timeline `info.participants[]`의 `{participantId, puuid}`로 참가자를 잇는다 (puuid로 확인, 번호만 믿지 않음).
2. `info.frames[].events[]` 중 `type = 'SKILL_LEVEL_UP'`, `participantId` 일치, `levelUpType = 'NORMAL'`.
3. `timestamp` 오름차순 (같으면 원래 순서 유지).
4. `skillSlot` 1→`Q`, 2→`W`, 3→`E`, 4→`R`. 그 밖의 값은 버리고 경고.
5. 이어 붙인 문자열 저장 (`^[QWER]*$`). 이벤트가 하나도 없으면 NULL. 11자 미만도 그대로 저장 (집계 함수가 거름).

### 4-5. 게임 건너뛰기 이유 (저장 안 함)

| 이유 코드 | 조건 |
|-----------|------|
| `not_solo` | `info.queueId ≠ 420` (요청에서 걸렀지만 한 번 더) |
| `too_short` | `info.gameDuration < 300` |
| `not_10_players` | 참가자 ≠ 10명 |
| `old_patch` | 보관 패치 밖 (3-4) |
| `bad_format` | 패치·match_id 형식 오류, 룬 개수 오류, 타임라인 참가자 매칭 실패 |

- 실행이 끝나면 이유별 개수와 경고 개수(밴 짝 없음, 이상한 포지션, 이상한 skillSlot)를 로그 요약에 출력한다.
- 실제 게임 `KR_8408851980` 1번 참가자로 계약 6-3 예시 값과 같은지 단위 테스트한다 (9장).

---

## 5. API 설계

> 요약: 읽기 전용 GET 엔드포인트 4개. 숫자 ID와 개수·비율만 주고, 자세한 형식은 `docs/contracts/api_contract.md`에 있다.

| 메서드·경로 | 화면 | 내용 |
|-------------|------|------|
| `GET /api/v1/health` | (운영) | 서버·DB 연결 확인 |
| `GET /api/v1/meta` | 공통 (푸터, 패치 선택) | 최신 패치, 기본 표시 패치, 패치 목록, 마지막 수집 시각, 규칙 값 |
| `GET /api/v1/champions?position=TOP[&patch=16.19]` | 챔피언 리스트(티어) | 그 포지션이 주 포지션인 챔피언, 티어 → 점수 순 |
| `GET /api/v1/champions/:championId[?position=&patch=]` | 챔피언 상세 | 주 포지션(최대 2개), 선택 포지션 통계, 아이템(전체)·룬·스펠·스킬(상위 2개) |

### 5-1. 공통 규칙

> 요약: 패치를 안 주면 백엔드가 표시 패치를 정하고, 어느 패치 데이터인지 응답에 적는다.

| 규칙 | 내용 |
|------|------|
| 표시 패치 | `patch`를 안 주면: 최신 패치(`patch` 테이블, `patch_sort_key` 최대)의 `games < 5,000`(설정)이고 직전 패치가 있고 직전 패치 게임 수가 더 많으면 **직전 패치**. 아니면 최신 패치 (결정 D3) |
| `patch`를 주면 | 그 패치 그대로 (대체 안 함). 없으면 404 |
| 티어 | `champion_tier_view.tier` 그대로 (NULL = 표본 부족). `tier_score`로 다시 계산하지 않음 (db_review L4) |
| 티어리스트 정렬 | `tier NULLS LAST, tier_score DESC, champion_id ASC` |
| 주 포지션 | 챔피언별 포지션 pick 내림차순(같으면 포지션 이름 순) 최대 2개. 2순위는 그 챔피언 전체 pick의 10% 이상일 때만 |
| 상세 비율 | 조합 승률 = `win / pick`, 사용률 = `pick / champion.pick` (계약 9-3). 백엔드 계산, 소수 2자리 |
| 비율 단위 | 퍼센트 숫자 (`52.31` = 52.31%) |
| 룬 식별 | `champion_rune.id`는 집계마다 바뀌므로 응답에 넣지 않음 |
| ID | 숫자 ID만. 이름·이미지는 프론트가 Data Dragon으로 |

### 5-2. 프론트 사용 방식에 맞춘 점

> 요약: 프론트는 Next.js 서버 컴포넌트에서 1시간 ISR로 부르므로, 서버 간 호출·한 화면 한 요청에 맞췄다.

- 상세는 숫자 `championId`(Data Dragon `champion.json`의 `key`)로 부른다. 프론트 라우트는 영문 id(`Aatrox`)이므로 프론트가 `key`로 바꿔 부른다.
- 상세 한 번 호출로 포지션 탭·빌드를 모두 받는다 (화면 기준 DTO).
- 아이템은 하위 재료를 프론트가 Data Dragon `into`로 거르므로 **모든 아이템**을 pick 순으로 준다 (상위 2개만 주면 재료를 거른 뒤 남는 것이 없음, 결정 D4).

---

## 6. 오류 처리·로깅

> 요약: 수집은 오류 종류별로 멈춤·재시도·건너뜀을 정하고, API는 한 가지 오류 형식을 쓴다. 비밀값은 어디에도 출력하지 않는다.

### 6-1. Riot 응답별 처리 (수집)

| 응답 | 분류 | 동작 |
|------|------|------|
| 200 | 성공 | |
| 401, 403 | 키 만료/잘못된 키 | `RiotKeyExpiredError` → 즉시 중단, `key_expired` |
| 404 (match, timeline) | 없음 | 그 게임 건너뜀 (경고) |
| 404 (by-puuid, entries) | 없음 | 그 플레이어/페이지 건너뜀 (경고) |
| 400 | 잘못된 요청 | 건너뜀 + 오류 로그 (코드 버그일 가능성) |
| 429 | 한도 초과 | `Retry-After` 기다려 재시도 (최대 5번) |
| 500, 502, 503, 504, 네트워크 오류, 10초 시간 초과 | 일시 오류 | 1초 → 2초 → 4초 재시도 (최대 3번). 그래도 실패면 그 게임 건너뜀 |
| 연속 20개 게임 실패 | 장애 | 중단, `failed` |

### 6-2. API 오류

| HTTP | `code` | 언제 |
|------|--------|------|
| 400 | `INVALID_PARAMETER` | 파라미터 형식 오류 |
| 404 | `PATCH_NOT_FOUND` | 준 `patch`가 `patch` 테이블에 없음 |
| 404 | `STATS_NOT_FOUND` | 그 챔피언(·포지션)의 통계가 그 패치에 없음 |
| 404 | `NOT_FOUND` | 없는 경로 |
| 503 | `STATS_NOT_READY` | 집계된 패치가 하나도 없음 |
| 503 | `DB_UNAVAILABLE` | DB 연결 실패 |
| 500 | `INTERNAL_ERROR` | 그 밖의 오류 (내부 내용은 응답에 넣지 않고 로그에만) |

- 형식: `{ "error": { "code": "...", "message": "...", "details": {...} } }` (api_contract 3장).

### 6-3. 로깅

| 항목 | 규칙 |
|------|------|
| 형식 | 한 줄 텍스트 `시각 레벨 [영역] 메시지 key=value` (stdout). 파일 저장은 필요하면 `| tee` (루트 `.gitignore`가 `*.log`를 이미 제외) |
| 수집 진행 | 50게임마다 진행률 (저장 n / 대상 m, 건너뜀 이유별 개수, 경과·예상 남은 시간) |
| 수집 요약 | 끝날 때 호출 수, 저장 게임 수, 건너뜀 이유별, 경고별, 집계 결과(jsonb) |
| API | 요청 1줄 (`메서드 경로 상태 ms`). 5xx는 오류 스택 |
| 비밀값 | `DATABASE_URL`(전체·비밀번호·사용자·호스트)과 `RIOT_API_KEY`를 모든 로그·오류 메시지에서 `***`로 가림. Riot 키는 헤더로만 보내 URL·로그에 안 나옴. 가리기 함수는 db_review L1 문제(`%` 인코딩 예외)를 피하게 작성 |
| puuid | 로그에 전체 puuid를 찍지 않음 (앞 8자만) |
| `collection_logs` | 상태·개수·`error_message`만. 경고 개수는 컬럼이 없어 stdout 요약에만 (계약 7장 "수집 로그에 경고"를 stdout 로그로 해석, 11장 참고) |

---

## 7. 설정값

> 요약: 비밀값·주소는 `.env`, 수집 범위는 프리셋 코드(`config/collection.ts`), API 규칙은 `config/api.ts`에 둔다. 본 수집 전환은 프리셋 값만 바꾼다.

### 7-1. 환경 변수 (루트 `.env`)

| 변수 | 기본 | 사용처 | 비고 |
|------|------|--------|------|
| `DATABASE_URL` | (필수) | API, CLI | 기존 |
| `RIOT_API_KEY` | (CLI 필수) | CLI | 기존. API 서버는 읽지 않음 |
| `RIOT_PLATFORM_URL` | `https://kr.api.riotgames.com` | CLI ① | 기존 |
| `RIOT_REGION_URL` | `https://asia.api.riotgames.com` | CLI ②~④ | 기존 |
| `API_PORT` | `4000` | API | **새 변수** → Build 때 `.env.example`에 추가 |

### 7-2. 수집 프리셋 (`config/collection.ts`)

| 설정 | `test` (이번) | `main` (나중, 자리만) | CLI 덮어쓰기 |
|------|---------------|------------------------|--------------|
| `tiers` | `PLATINUM, EMERALD, DIAMOND` | `EMERALD, DIAMOND` + 마스터 이상(나중) | `--tiers` |
| `playersPerTier` | 50 | 4 : 4 : 2 비율 (테스트 뒤 정함) | `--players-per-tier` |
| `divisions` | `I, II, III, IV` (I·II 13명, III·IV 12명) | 같음 | - |
| `sampling` | `random` (page 1, `inactive` 제외) | 같음 | - |
| `gamesPerPlayer` | 20 (`count=20`) | 20 | `--games-per-player` |
| `queue` | 420 | 420 | - |
| `minGameDurationSec` | 300 | 300 | - |
| `keepPatches` | 2 | 2 | - |
| `maxGamesPerPatch` | 25,000 | 25,000 | - |
| `maxMatchesPerRun` | 없음 | 없음 | `--max-matches` |

### 7-3. Riot 클라이언트

| 설정 | 기본 |
|------|------|
| `perSecondLimit` / `perWindowLimit` / `windowMs` | 19 / 98 / 120,000 |
| `requestTimeoutMs` | 10,000 |
| `retry5xx` | 3번 (1·2·4초) |
| `retry429` | 5번 (`Retry-After`, 없으면 10초) |
| `maxConsecutiveMatchFailures` | 20 |
| `aggregateStatementTimeout` | `5min` |

### 7-4. API 규칙 (`config/api.ts`)

| 설정 | 기본 | 근거 |
|------|------|------|
| `MIN_TIER_PICK` | 50 | 표시용(`meta.rules`). 실제 판정은 DB 뷰 |
| `SECONDARY_POSITION_MIN_SHARE` | 10 (%) | 계약 9-3 |
| `FALLBACK_MIN_GAMES` | 5,000 | 결정 D3 |
| `DETAIL_TOP_N` | 2 (룬·스펠·스킬) | 계약 10장 5번 |
| `CACHE_MAX_AGE_SEC` | 600 | 결정 D5 |

---

## 8. 의존성

> 요약: 실행 의존성은 `express`, `pg` 두 개뿐이다. 나머지는 Node 24 내장 기능으로 대신한다.

### 8-1. 추가하는 패키지

| 패키지 | 종류 | 목적 / 이유 |
|--------|------|-------------|
| `express` ^5 | 실행 | 프로젝트 스택(CLAUDE.md 2장). 5.x는 async 핸들러 오류를 자동으로 오류 미들웨어에 넘김 |
| `pg` ^8 | 실행 | Supabase Postgres 직접 접속 (`db/`와 같은 드라이버) |
| `typescript` ^5 | 개발 | 타입 검사 (`tsc --noEmit`) |
| `tsx` ^4 | 개발 | TS를 빌드 없이 실행 (`--import tsx`), `watch` 모드 |
| `@types/node`, `@types/express`, `@types/pg` | 개발 | 타입 정의 |
| `eslint` ^9, `@eslint/js`, `typescript-eslint` ^8 | 개발 | Review의 린트 검증 |

### 8-2. 넣지 않는 패키지

| 패키지 | 대신 |
|--------|------|
| `axios` | Node 내장 `fetch` + `AbortSignal.timeout` |
| `dotenv` | `node --env-file=../.env` (`db/`와 같은 방식) |
| `cors` | 서버 간 호출이라 불필요 (결정 D6) |
| `zod` 등 검증 | 파라미터 3종(패치, 포지션, 챔피언 ID)이라 직접 작성 |
| `vitest`/`jest`, `supertest` | `node:test` + `node:assert`, 통합 테스트는 `app.listen(0)` + `fetch` (결정 D2) |
| `pino` 등 로거 | 작은 `logger.ts` |
| Supabase JS 클라이언트 | `pg` 직접 접속 (사용자 결정) |

---

## 9. 테스트 전략

> 요약: 변환·제한기는 실제 게임 JSON으로 단위 테스트, DB·API는 실제 Supabase에서 트랜잭션을 롤백하는 통합 테스트, 마지막으로 Review가 수십 게임을 실제로 모은다.

### 9-1. 단위 테스트 (`npm test`, 네트워크·DB 없음)

| 대상 | 확인 |
|------|------|
| `transform` + 실제 게임 fixture | `KR_8408851980` → `matches` 1줄(`patch='16.19'`) + 10줄. 1번 참가자 = 계약 6-3 값 (`23, TOP, true, ban 64, 14/4, 8100(9923,8143,8140,8135), 8000(8299,9104), 5008/5008/5011, 1018,3074,3006,3046,1036,1036, 'EQQWQRQEQEREEW'`) |
| `transform` 가공 입력 | `teamPosition ''` → NULL, ban `-1` → NULL, 짝 없는 밴 → NULL + 경고, `EVOLVE` 제외, `skillSlot` 순서, `gameDuration 299` → `too_short`, `queueId 440` → `not_solo`, 참가자 9명 → `not_10_players`, `16.9.1` → `16.9` |
| `rateLimiter` (가짜 시계) | 1초 안 20번째까지 바로, 그다음은 대기. 120초 안 100번째 다음은 대기. 429 후 창 비우기 |
| `client` (가짜 fetch) | 401/403 → `RiotKeyExpiredError` (재시도 없음), 429 → `Retry-After` 대기 후 재시도, 503 → 3번 재시도 후 포기, 키가 URL에 없고 헤더에만 |
| `patchSelection` | 패치 0개 / 1개 / 최신 표본 부족 → 직전 / 직전이 더 적으면 최신 / `patch` 지정 |
| `mainPositions` | 2순위 9.9% → 1개, 10.0% → 2개, 3순위는 항상 제외, 동률 순서 |
| `validate` | 패치·포지션·챔피언 ID 경계값 |

- fixture는 Build가 키로 `KR_8408851980`의 match·timeline을 1번씩 받아 저장한다 (호출 2회). 저장 전에 puuid 10개를 가짜 값(`TEST_PUUID_01`…)으로 바꾸고, timeline은 `SKILL_LEVEL_UP` 이벤트와 `info.participants`만 남겨 줄인다. 키가 만료됐으면 계약 6-3 값으로 손으로 최소 fixture를 만든다.

### 9-2. 통합 테스트 (`npm run test:integration`, 실제 Supabase)

> 요약: 모든 테스트가 `BEGIN` 뒤 `ROLLBACK`으로 끝나 실제 데이터를 남기지 않는다.

| 대상 | 방법 |
|------|------|
| 저장소 | 트랜잭션 안에서 가짜 패치(`0.9`)의 fixture 게임 저장 → 10줄 확인 → 같은 게임 다시 저장 시 0줄(중복) |
| 집계 호출 순서 | 같은 연결에서 `ANALYZE` → `refresh_patch_stats('0.9')` 반환 jsonb 확인 |
| API | `createApp(트랜잭션 연결)`을 `listen(0)`으로 띄우고 `fetch`로 meta·list·detail 호출 → api_contract 형식·null 여부 확인 → `ROLLBACK` |
| 정리 확인 | 끝난 뒤 `matches`에 `0.9` 패치가 없는지 확인 |

- 실제 패치 데이터와 섞이지 않게 가짜 패치 `0.9`, 가짜 match_id `KR_9000000001`… 만 쓴다.
- 시퀀스(`collection_logs_id_seq` 등)는 롤백되지 않는다 (db_review I1, 동작 영향 없음).

### 9-3. Review 실제 소량 수집

| 단계 | 명령 | 확인 |
|------|------|------|
| 1 | `npm run collect -- run --preset test --max-matches 30` | 저장 30게임, `match_players` 300줄, 모든 게임 10줄, `collection_logs` `done` |
| 2 | 같은 명령 다시 | 이미 저장한 30게임은 건너뜀, 새 게임만 저장 |
| 3 | DB 조회 | 1번 참가자 몇 명의 값을 Riot 원본과 비교 (밴·포지션·스킬) |
| 4 | API 3개 호출 | api_contract와 형식 일치 (티어는 대부분 null = 표본 부족이 정상) |
| 5 | 잘못된 키로 실행 (`RIOT_API_KEY=invalid npm run collect …`) | 즉시 멈춤, `key_expired`, 종료 코드 2, 반쪽 게임 없음 |

- 전체 테스트 수집(약 2,700게임, 약 2시간)은 Review 범위가 아니라 사용자가 승인 후 직접 실행한다.

---

## 10. 완료 기준

> 요약: Review가 아래 항목을 하나씩 확인한다.

### 10-1. 코드·검증

- [ ] `npm run typecheck` 오류 0
- [ ] `npm run lint` 오류 0
- [ ] `npm test` 단위 테스트 모두 통과 (9-1 항목 전부)
- [ ] `npm run test:integration` 통과, 끝난 뒤 DB에 테스트 데이터 0줄
- [ ] 2-1 폴더 구조와 진입점 2개 (API 서버가 수집 코드를 실행하지 않음, Riot 키를 읽지 않음)

### 10-2. 수집

- [ ] ①: 티어당 50명, 디비전별 13/13/12/12, `inactive` 제외, `ranked_players` upsert
- [ ] ②: `queue=420&count=20`, 메모리·DB 중복 제거
- [ ] ③④: 5분 미만·큐·참가자 수·창 밖이면 타임라인을 부르지 않음
- [ ] ⑤: 게임 1개 = 트랜잭션 1개, `matches` 1줄 + `match_players` 10줄, 중복 `DO NOTHING`
- [ ] ⑥: 게임 수와 관계없이 `ANALYZE matches, match_players` → `refresh_patch_stats`가 같은 연결, `statement_timeout 5min`
- [ ] 변환 규칙 4장 전부 (특히 밴 `pickTurn`, `""` → NULL, `NORMAL`만, `summoner1Id/2Id`, 아이템 0)
- [ ] 제한기 1초 19회 / 2분 98회, 실제 소량 수집에서 429 0회 (또는 429를 재시도로 처리)
- [ ] 401/403: 즉시 멈춤, `key_expired`, `finished_at`, 종료 코드 2
- [ ] 다시 실행하면 이어서 모음 (9-3 2번)
- [ ] `purge`는 `--yes` 없이는 지우지 않음
- [ ] 동시에 두 번 실행하면 두 번째가 잠금으로 종료

### 10-3. API

- [ ] 엔드포인트 4개가 `api_contract.md`의 경로·파라미터·응답 필드·null 여부와 일치
- [ ] `tier`는 뷰 값 그대로, 정렬 `tier NULLS LAST, tier_score DESC, champion_id`
- [ ] 주 포지션 최대 2개, 2순위 10% 기준
- [ ] 직전 패치 대체 규칙과 `patch.isFallback` 표시
- [ ] 오류 형식·코드 (400, 404, 503), 5xx에 내부 오류 내용 없음
- [ ] 캐시 헤더 (성공 `public, max-age=600`, 오류 `no-store`)

### 10-4. 보안

- [ ] 로그·문서·응답·커밋에 `RIOT_API_KEY`, `DATABASE_URL` 값 없음 (grep 확인)
- [ ] `.env.example`에 `API_PORT`만 추가

---

## 11. 계약 변경 요청

> 요약: DB 계약을 바꿀 필요는 없다. 다음 `!db` 작업 때 참고할 문구 정리만 남긴다.

- **없음.** 이번 계획은 v6 테이블·함수·뷰만으로 구현할 수 있다.
- 참고 (변경 요청 아님, 다음 `!db` 계약 수정 때 문구만):
  1. 7장 "짝이 없으면 수집 로그에 경고": `collection_logs`에 경고 컬럼이 없어 stdout 로그로 처리한다. 계약에 "stdout 로그"라고 적으면 오해가 없다.
  2. 9-4 이유 칸에 "5,000게임도 통계가 틀리면 2분 초과 → `ANALYZE` 후 1.6초" 추가 (db_review L6). 이 계획은 이미 항상 `ANALYZE`한다.
  3. 표본 플레이어를 지우는 기능이 생기면 `matches(puuid)` 인덱스 필요 (db_review L3). 이번엔 삭제하지 않는다.
  4. db_review L2(Supabase 기본 권한)는 `!db` 영역. 백엔드는 새 DB 객체를 만들지 않으므로 영향 없음.

---

## 12. 결정 필요 사항

> 요약: 아래 9개를 정해 주면 Build를 시작한다. ★가 추천안이다.

| # | 항목 | 선택지 | 추천과 이유 |
|---|------|--------|-------------|
| D1 | TS 실행 방식 | A. `tsx`로 바로 실행 + `tsc --noEmit` 검사 / B. `tsc` 빌드 후 `node dist/` / C. Node 24 내장 타입 제거 | **★A.** 빌드 단계가 없어 단순하고 예전 코드도 썼다. 배포 단계에서 필요하면 B를 추가. C는 import 경로에 `.ts`를 붙여야 하고 일부 문법이 안 돼 아직 번거로움 |
| D2 | 테스트 도구 | A. `node:test` + `node:assert` / B. `vitest` | **★A.** 의존성 0. 필요한 것(비동기, 가짜 함수, describe)이 다 있다. 프론트도 테스트 도구가 없어 통일할 이유가 없음 |
| D3 | 직전 패치 대체 기준 | A. 최신 패치 `games < 5,000`이고 직전 패치가 더 많으면 직전 패치 (패치 단위) / B. 최신 게임 수가 직전의 n% 미만이면 / C. 챔피언×포지션마다 50판 미만인 줄만 직전 패치 | **★A.** 한 화면이 한 패치라 픽률·밴률 분모가 섞이지 않고 설명이 쉽다. 5,000게임이면 챔피언×포지션 평균 약 200판. C는 같은 표에 패치가 섞여 비교가 틀어짐. 기준값은 `config/api.ts`에서 바꿈 |
| D4 | 상세 아이템 개수 | A. 모든 아이템 pick 순 / B. 상위 20개 | **★A.** 프론트가 하위 재료를 거른 뒤 상위 2개를 고르므로 충분히 줘야 한다. 챔피언×포지션당 약 40~100줄, 약 5KB |
| D5 | 캐시 헤더 | A. 성공 `Cache-Control: public, max-age=600`, 오류 `no-store`, 서버 메모리 캐시 없음 / B. ETag + 304 / C. 캐시 없음 | **★A.** 데이터는 수동 수집 때만 바뀐다. Next.js는 자체 `revalidate: 3600`으로 캐시하므로 백엔드 헤더는 브라우저·프록시용 보조. 쿼리가 PK 범위라 서버 캐시도 불필요 |
| D6 | CORS | A. 켜지 않음 (서버 컴포넌트에서만 호출) / B. `cors` + 허용 출처 환경 변수 | **★A.** 프론트가 Next 서버에서 부르므로 브라우저 출처 검사가 없다. 브라우저에서 직접 부를 일이 생기면 그때 B |
| D7 | 수집 상태 위치 | A. DB만 (`ranked_players`·`matches`·`collection_logs`) / B. 로컬 JSON 상태 파일 / C. 새 DB 테이블 (계약 변경) | **★A.** 저장된 게임이 곧 진행 상태라 꼬일 일이 없다. 재실행 비용은 ② 150회(약 3분)뿐 |
| D8 | 플레이어당 게임 수·표본 선택 | 게임 수: A. 20 / B. 10 / 선택: 가. page 1에서 무작위 / 나. page 1 앞에서부터 | **★A + 가.** 20은 계약 권장값이고 예상 2,700게임과 맞는다. page 1 순서가 LP 등에 치우칠 수 있어 무작위가 고르다. 시드를 로그에 남겨 재현 가능 |
| D9 | `purge` 실행 시점 | A. `purge --yes`로만 수동 / B. `run` 끝에 자동 | **★A.** 되돌릴 수 없는 삭제라 CLAUDE.md 10장 정신(실행 전 승인)과 맞다. 테스트 수집은 패치 1~2개라 지울 것도 없음 |
| D10 | 키 만료 뒤 집계 | A. 집계 건너뜀, `aggregate`를 따로 실행 / B. 저장분까지 자동 집계 | **★A.** 계약 7장 "즉시 멈춤"을 그대로 따른다. 재발급 후 `run`을 다시 하면 이어서 모으고 마지막에 집계됨 |

---

## 13. 작업 범위

> 요약: 단계마다 고칠 수 있는 경로를 정한다. 이 밖은 수정하지 않고 메인 에이전트에게 보고한다.

| 단계 | 수정 가능 경로 | 비고 |
|------|----------------|------|
| Plan | `backend/docs/back_spec.md`, `docs/contracts/api_contract.md` | 이번 문서 |
| Build | `backend/` 전체 (`backend/docs/back_build.md` 포함) | 코드, 설정, 테스트, fixture |
| Build | `docs/contracts/api_contract.md` | 승인된 변경만 (상태를 `초안` → 구현 반영) |
| Build | `.env.example` | 새 변수 `API_PORT` 추가만 |
| Review | `backend/docs/back_review.md`, `backend/docs/back_build.md` | 검토 결과, 수정한 기능 반영 |
| Review | `backend/` 안의 수정 | 검토에서 찾은 문제 수정 |
| Review | `docs/career_log.md` | 아래에 추가만 (기존 기록 수정 금지) |

- 수정 금지: `db/`, `docs/contracts/db_contract.*`, `frontend/`, 루트 `.env`, `CLAUDE.md`.
- DB 쓰기: 통합 테스트는 롤백만. 실제 저장은 Review 소량 수집(9-3)뿐. `purge --yes`, 표본 삭제, 그 밖의 되돌릴 수 없는 SQL은 메인 에이전트를 통해 사용자 승인 후.
- Riot 호출: Build는 fixture용 2회와 개발 확인용 소량만. 전체 테스트 수집은 사용자가 직접 실행.

---

## 변경 01 (날짜: 2026-10-15): 최근 14일 기준 대응

- 상태: **승인됨 (2026-10-15, D11~D17 추천안)**
- 작성: Plan 서브에이전트 (2026-10-15)
- 읽는 계약: `docs/contracts/db_contract.md`, `db_contract.dbml` **v7** (승인됨, db_spec 변경 03)
- 작성하는 계약: `docs/contracts/api_contract.md` **v2 초안** (이 변경과 함께 승인받는다)
- 근거: db_spec 변경 03의 03-7(백엔드 영향 메모)·03-11(매일 집계), db_review "변경 03 검토"의 L7·L11, 이 문서 1~13장(v1), `back_build.md` 7장 남은 문제 1·3, 사용자 결정(아래 01-1)

### 01-1. 왜 바꾸나

> 요약: DB가 "패치 단위"에서 "최근 14일 창 1개"로 바뀌어 **지금 백엔드는 실제 DB에서 동작하지 않는다.** 수집기·집계 호출·API를 v7 계약에 맞춘다.

| 지금 깨진 곳 | 원인 (v7) |
|--------------|-----------|
| `rawRepository.insertMatch`가 `INSERT INTO matches (match_id, puuid, patch)` | `matches.game_start_at`이 NOT NULL → 모든 저장이 실패 |
| `aggregate.ts`가 `refresh_patch_stats`, `cli/collect.ts`가 `purge_old_patches` | 두 함수가 없어짐 |
| `statsRepository`가 `patch` 테이블, 뷰·상세의 `patch` 컬럼 | `patch` 테이블 → `stats_window`, 집계 5개·뷰에서 `patch` 컬럼 삭제 |

사용자 결정 (이번 변경의 전제):

| # | 결정 |
|---|------|
| U1 | 게임 ID 요청에 `startTime = 지금 − 14일`(**초**)을 넣는다. 받은 뒤 오래된 패치를 거르는 방식은 없앤다 |
| U2 | `game_start_at`을 저장한다 (`info.gameStartTimestamp`, ms) |
| U3 | 수집 뒤 자동 집계를 없앤다 (매일 05:00 KST pg_cron이 집계). `aggregate` 명령은 시험용으로 남긴다: `ANALYZE` → `refresh_window_stats` |
| U4 | `purge`는 `purge_old_games(21)`, 수동, `--yes` 필요 |
| U5 | 테스트 수집: 플래티넘·에메랄드·다이아 **티어당 100명**(모두 300명), 디비전 I~IV 고르게 |
| U6 | API에서 `patch` 파라미터와 직전 패치 대체 규칙을 없앤다. 응답에 창 정보(시작·끝, 게임 수, `aggregatedAt`, 패치 구성 + 비율)를 넣는다 |
| U7 | 모든 패치 값에 공개 이름 `displayName` = 메이저 + 10 (`16.20` → `26.20`, 옵션 A 승인) |
| U8 | 챔피언 리스트(포지션별, 티어 정렬, 주 포지션 최대 2개·10% 규칙, 50판 미만 `tier: null`)와 상세(아이템 전부, 룬·스펠·스킬 상위 2개)는 그대로 |
| U9 | pg_cron 기본 권한은 기본값 유지 (db_review L8). 백엔드가 할 일 없음 |

### 01-2. 바뀌지 않는 것

> 요약: 제한기, Riot 클라이언트의 오류 처리, 변환 규칙(밴·룬·스킬 등), 게임 단위 트랜잭션 저장, 잠금, 수집 기록, 주 포지션 규칙, 오류 형식, 캐시 헤더는 v1 그대로다.

- 3-3(DB가 곧 상태), 3-5(오류·중단, 단 ⑥ 관련 줄 제외), 3-6(제한기 19/98), 4장(변환, 단 4-2·4-5 일부), 5-1의 티어·정렬·주 포지션·상세 비율, 6장(로깅, 비밀값 가리기), 8장(의존성 추가 없음), 결정 D1·D2·D4~D8·D10.
- **새 의존성 없음.** 새 환경 변수 없음 (`.env.example`은 바꿀 것이 없을 것으로 본다. Build가 새 변수를 만들 때만 고친다).

### 01-3. 모듈·파일별 변경

> 요약: 패치 창 관련 코드(보관 패치, 패치당 상한, 직전 패치 대체)를 지우고, 시각 창(`startTime`, `game_start_at`, `stats_window`)으로 바꾼다. 새 파일은 2개(`api/window.ts`, `db/snapshot.ts`), 지우는 파일은 1개(`api/patchSelection.ts`)다.

| 파일 | 변경 |
|------|------|
| `src/config/collection.ts` | `keepPatches`, `maxGamesPerPatch` 삭제. `windowDays: 14`, `maxGamesPerWindow: 25_000`, `keepDays: 21` 추가. `test` 프리셋 `playersPerTier` 50 → **100** (`divisionQuota(100)` = 25/25/25/25). 함수 `windowStart(nowMs, days)` → `{ ms, sec }` 추가 (`sec = Math.floor(ms / 1000)`) |
| `src/config/api.ts` | `FALLBACK_MIN_GAMES` 삭제. `STALE_AFTER_HOURS = 26` 추가 (01-6-3) |
| `src/riot/client.ts` | `getMatchIds(puuid, { queue, start, count, startTime })` — URL에 `&startTime={초}` 추가. `startTime`이 정수가 아니거나 10자리(초)가 아니면 코드 오류로 던짐 (ms를 잘못 넣는 실수 방지) |
| `src/riot/types.ts` | `MatchDto.info.gameStartTimestamp: number` 추가 |
| `src/collector/transform.ts` | `MatchRow`에 `game_start_at: Date`. `PrefilterOptions`에 `windowStartMs`. `prefilterMatch`가 시작 시각 검사(01-4-2)를 하고 `{ patch, gameStartAt }`를 돌려줌. `SkipReason`의 `old_patch` → `out_of_window`. `comparePatch`, `latestPatches` 삭제 (쓰는 곳이 없어짐. `parsePatch`는 남김) |
| `src/collector/matches.ts` | ② `startTime` 전달. "보관 패치 창"(`seenPatches`, `latestPatches`, `old_patch`) 삭제. 패치당 상한(`patch_full`) 삭제 → 창 상한 `window_full`(01-4-3). `MatchSkip`에서 `patch_full` 삭제, `stoppedBy`에 `'window_full'` 추가. `savedPatches`는 요약 로그용으로 남김 |
| `src/collector/aggregate.ts` | 다시 씀: `aggregateWindow(db, { days, until?, statementTimeout })` = 같은 연결에서 `SET statement_timeout` → `ANALYZE matches, match_players` → `SELECT refresh_window_stats($1)` (`until`이 있으면 `($1, $2)`, **통합 테스트 전용**, CLI에는 없음) → `RESET`. P0002는 `{ ok: false, warning }`. `planPurge` → `planPurgeGames(db, keepDays)` (읽기만, 01-4-5) |
| `src/cli/collect.ts` | `run` = ①~⑤ (⑥ 삭제). `aggregate`의 `--patch` 삭제, `aggregatePatches` → `aggregateWindow`. `purge --yes` → `SELECT purge_old_games($1)` (`keepDays` 21), "집계 안 된 패치" 확인 삭제. USAGE 문구·요약 로그 수정. `parsePatchParam` import 삭제 |
| `src/repositories/rawRepository.ts` | `insertMatch`에 `game_start_at` (`$4::timestamptz`, `Date` 그대로 넘김). `matchCountsByPatch`, `distinctMatchPatches` 삭제. `countMatchesSince(db, since)` (창 상한용), `purgePreview(db, keepDays)` (지울 게임 수·가장 오래된·가장 최근 시작 시각) 추가 |
| `src/repositories/statsRepository.ts` | `listPatches`, `PatchRow` 삭제. `readWindow(db)` 추가: `stats_window` 1줄 + `stats_window_patch`(`ORDER BY patch_sort_key(patch) DESC`)를 **한 문장**으로 (없으면 `null`). `tierRowsForPatch` → `tierRows(db)`, `tierRowsForChampion(db, championId)`: `WHERE v.patch` 조건 삭제. 상세 4개의 `Key`에서 `patch` 삭제, `JOIN champion c ON c.champion_id = t.champion_id AND c.position = t.position` |
| `src/db/snapshot.ts` (새 파일) | `readSnapshot(pool, fn)`: 연결 1개 → `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` → `fn(client)` → `COMMIT` (예외면 `ROLLBACK`) → 반환. 01-6-4 |
| `src/api/app.ts` | `createApp(db: ApiDb)`. `ApiDb = { query(...)(health용), snapshot<T>(fn: (q: Queryable) => Promise<T>): Promise<T> }`. `server.ts`는 풀로 `ApiDb`를 만들고(`snapshot = fn => readSnapshot(pool, fn)`), 테스트는 롤백 연결로 만든다(`snapshot = fn => fn(client)`) |
| `src/api/window.ts` (새 파일) | `displayPatch('16.20')` → `'26.20'`, `windowDto(row, now)` → `{ days, start, end, games, aggregatedAt, isStale, patches[{ patch, displayName, games, share }] }`, `requireWindow(row)` (없으면 503 `STATS_NOT_READY`) |
| `src/api/patchSelection.ts` | **삭제** (직전 패치 대체 규칙 없음) |
| `src/api/routes/meta.ts` | `/meta` 응답을 v2로 (01-6). `/health`에 `stats` 추가 (01-6-3) |
| `src/api/routes/champions.ts` | `patch` 파라미터 읽기 삭제. 요청 하나의 모든 읽기를 `db.snapshot` 안에서 차례로 (`Promise.all` 삭제, 연결 1개라 어차피 차례 실행). `STATS_NOT_FOUND` `details.patch` 삭제. 응답 `patch` → `window` |
| `src/api/validate.ts` | `parsePatchParam` 삭제 (쓰는 곳이 없어짐) |
| `src/api/errors.ts` | `ErrorCode`에서 `PATCH_NOT_FOUND` 삭제 |
| `src/server.ts` | `ApiDb` 만들기 (위). 집계가 오래됐으면 1시간에 1번 경고 로그 (01-6-3) |
| `src/api/dto.ts`, `mainPositions.ts`, `cache.ts`, `riot/rateLimiter.ts`, `errors.ts`(riot), `collector/sample.ts`·`runLog.ts`·`context.ts`, `logRepository.ts`, `lib/logger.ts`, `db/pool.ts`·`tx.ts`, `config/env.ts` | 바꾸지 않음 (주석의 "패치" 문구만 고칠 수 있음) |
| `test/**` | 01-7 |
| `docs/contracts/api_contract.md` | v2 (Build가 구현 결과에 맞춰 상태를 `v2 승인됨 (구현 반영)`으로) |

### 01-4. 수집 흐름 (새)

> 요약: ① 표본 → ② `startTime`을 넣은 게임 ID → ③ 상세(시작 시각·창 상한 확인) → ④ 타임라인 → ⑤ 저장. **집계는 하지 않는다.** 창 시작 시각은 실행을 시작할 때 한 번 정해 모든 플레이어와 거르기에 같은 값을 쓴다.

#### 01-4-1. 단계

| 단계 | 호출 | 바뀐 점 |
|------|------|---------|
| 0 준비 | DB | v1과 같음 (잠금, 남은 `running` 닫기, `collection_logs` 시작). 추가: `runStartedAt = now`, `windowStartMs = runStartedAt − windowDays × 86,400,000`, `startTimeSec = floor(windowStartMs / 1000)`. 로그에 `windowStart`(ISO)와 `startTime`(초) 출력. `countMatchesSince(windowStart)`로 창 안에 이미 저장된 게임 수 |
| ① 표본 | `league-v4 entries/{tier}/{division}?page=1` × 12 | 티어당 100명 = 디비전당 25명 (inactive 제외, 무작위, 시드 로그). 그 밖은 v1과 같음 |
| ② 게임 ID | `…/by-puuid/{puuid}/ids?queue=420&start=0&count=20&startTime={startTimeSec}` × 표본 수 | `startTime` 추가 (**초**, 예: 실행 시작 `2026-10-15T01:00:00Z` → `startTime=1790816400`). 중복 제거·정렬은 v1과 같음 |
| ③ 상세 | `match-v5 matches/{id}` | 거르기 순서: `bad_format`(ID) → `not_solo` → `too_short` → `not_10_players` → `bad_format`(패치) → **시작 시각 검사(01-4-2)**. 걸리면 ④를 부르지 않음 |
| ④ 타임라인 | `…/timeline` | 같음 |
| ⑤ 저장 | 게임 1개 = 트랜잭션 1개 | `matches`에 `game_start_at` 추가. 그 밖은 같음 |
| ~~⑥ 집계~~ | - | **삭제.** `run`·`matches` 끝에 로그 1줄: "집계는 매일 05:00 KST DB 예약 작업이 한다. 바로 보려면 `aggregate`(시험용)" |
| 종료 | DB | 같음. `collection_logs.status`는 `done`(창 상한·`--max-matches`로 멈춰도 `done`) |

#### 01-4-2. 시작 시각 검사

| 조건 | 처리 |
|------|------|
| `info.gameStartTimestamp`가 없거나, 정수가 아니거나, `2020-01-01T00:00:00Z`(1,577,836,800,000ms)보다 이름 | `bad_format` (DB CHECK `matches_game_start_at_check` 보호) |
| `gameStartTimestamp < windowStartMs` | `out_of_window` (저장 안 함, 계약 7장 권장) |
| 그 밖 | 통과. `game_start_at = new Date(gameStartTimestamp)` |

- `startTime`으로 요청하므로 `out_of_window`는 경계 근처 몇 개뿐일 것으로 본다. Riot의 `startTime`은 게임 생성 시각(`gameCreation`, 시작보다 약 1분 이름) 기준일 수 있어, 경계의 게임 일부가 ID 목록에는 있고 검사에서 빠질 수 있다. 정상이다.
- v1 Build 실측(`back_build.md` 7장 1번): 받은 게임의 **57%가 `old_patch`** 로 버려졌다. 이번 변경으로 이 상세 호출 낭비가 사라진다.
- 미래 시각 검사는 하지 않는다 (집계 함수가 `p_until` 이후 게임을 빼므로).

#### 01-4-3. 패치에 기대던 v1 규칙을 다시 보기

> 요약: 패치 3개 규칙은 모두 없애고, 창 시작 시각과 창 상한 하나로 바꾼다.

| v1 규칙 | 무엇을 막았나 | v2 처리 |
|---------|---------------|---------|
| 보관 패치 2개 (`keepPatches`, `old_patch`, 3-4) | 집계에 안 쓰는 오래된 게임 저장 | **삭제.** `startTime`(②)과 시작 시각 검사 `out_of_window`(③)로 대체. 원본 보관 기간은 `purge_old_games(21)`이 맡는다 |
| 패치당 2만 5천 게임 (`maxGamesPerPatch`) | 한 패치 원본이 용량을 넘김 | **창 상한 `maxGamesPerWindow` 25,000** (계약 1-1 "14일 창 최대 25,000게임"). 0 준비 단계에서 센 창 안 게임 수 + 이번 실행에서 저장한 수 ≥ 25,000이면 ③을 부르기 **전에** 멈춤 (`stoppedBy: 'window_full'`, 결정 D15). 창 안 게임은 모두 같은 창이라 하나씩 건너뛸 이유가 없다 |
| `patch_full` 건너뛰기 | 위 상한을 넘은 패치의 게임 | **삭제** (위 멈춤으로 대체) |
| ⑥ "이번 실행에서 저장한 패치마다 집계" | 수집 직후 화면 갱신 | **삭제** (U3) |
| `purge`의 "집계된 패치인지 확인" | 집계 전 원본 삭제 | **삭제.** 21일보다 오래된 게임은 이미 14일 창 밖이라 집계에 쓰이지 않는다. `purge_old_games`가 `p_keep_days < 14`·현재 창보다 짧은 보관을 거부한다 |

- 테스트 수집(약 2,200~2,700게임)에서 창 상한은 걸리지 않는다. 본 수집용 안전장치다.
- 시간이 지나면 오래된 게임이 창 밖으로 나가 창 안 게임 수가 줄어든다. 다음 실행이 다시 채운다.

#### 01-4-4. 테스트 수집 예상 (300명, 14일 창)

> 요약: 호출 약 4,700~5,700회, 개발 키로 **약 1.6~2시간**. 상한(모두 20게임)이어도 약 11,100회·약 3.8시간으로 24시간 키 안에 끝난다.

| 항목 | 값 | 근거 |
|------|-----|------|
| ① | 12회 | 3티어 × 4디비전 |
| ② | 303회 | 새 표본 300명 + 남아 있는 에메랄드 3명 (결정 D16 A) |
| 게임 수 | 약 2,200~2,700 (상한 약 5,400) | 계약 1-3: 14일 안 플레이어당 평균 8~10게임(상한 20), 겹침 약 10% |
| ③④ | 게임당 2회 → 약 4,400~5,400회 (상한 약 10,800) | `old_patch` 낭비가 없어짐. `too_short` 1~2%는 ③만 |
| 합계 | **약 4,700~5,700회** (상한 약 11,100) | |
| 시간 | 98회 / 120초 = 시간당 약 2,940회 → **약 1.6~2시간** (상한 약 3.8시간) | 제한기 기본값 (7-3) |
| 용량 | 약 13MB (상한 약 25MB) | 계약 1-3 |
| 다시 실행 | ② 303회(약 6분) + 새 게임만 | 3-3과 같음 |

- 디비전당 25명은 league-v4 page 1(약 205명)에서 충분히 뽑힌다. 14일 동안 게임이 없는 플레이어는 ②가 빈 목록을 준다 (정상, 요약 로그에 0게임 플레이어 수를 추가).
- 이 실행은 사용자가 승인 후 직접 한다 (Review 범위 아님, 01-8).

#### 01-4-5. `aggregate`와 `purge`

| 명령 | 동작 |
|------|------|
| `aggregate` (시험용) | `--patch` 없음. 연결 1개에서 `SET statement_timeout = '5min'` → `ANALYZE matches, match_players` → `SELECT refresh_window_stats(14)` → `RESET statement_timeout`. 반환 jsonb(창, 게임 수, 패치 구성, 줄 수)와 시간을 로그에. **P0002**(창 안 완료 게임 0개)면 경고 "기존 집계 유지", 종료 코드 1. 수집 잠금은 잡지 않는다 (함수 안 advisory lock이 예약 작업과 차례로 돌리고, 수집 INSERT와는 MVCC라 막히지 않음) |
| `purge` (미리보기) | 읽기만: 전체 게임 수, `game_start_at < now() − 21일`인 게임 수, 가장 오래된·최근 시작 시각. "실제로 지우려면 `--yes`" |
| `purge --yes` | 수집 잠금을 잡고 `SELECT purge_old_games(21)` → 삭제한 게임 수 로그. 자동 실행 없음 (D9 유지) |

- 테스트 수집 직후 원본은 모두 14일 안이라 `purge`로 지울 것이 없다.

### 01-5. 설정 변경

> 요약: 수집 프리셋에서 패치 설정 2개를 지우고 창 설정 3개를 더한다. API 설정은 대체 기준을 지우고 "오래됨" 기준을 더한다. 환경 변수는 그대로다.

| 위치 | 설정 | v1 | v2 |
|------|------|----|----|
| `config/collection.ts` | `playersPerTier` (`test`) | 50 | **100** |
| | `keepPatches` | 2 | 삭제 |
| | `maxGamesPerPatch` | 25,000 | 삭제 |
| | `windowDays` | - | **14** (`startTime`, `out_of_window`, `aggregate`의 `p_days`) |
| | `maxGamesPerWindow` | - | **25,000** |
| | `keepDays` | - | **21** (`purge`) |
| | `gamesPerPlayer`, `queue`, `minGameDurationSec`, `maxMatchesPerRun` | 20, 420, 300, 없음 | 같음 |
| | `main` 프리셋 | 자리만 | 자리만 (같은 기본값 사용) |
| `config/api.ts` | `FALLBACK_MIN_GAMES` | 5,000 | 삭제 |
| | `STALE_AFTER_HOURS` | - | **26** |
| | `MIN_TIER_PICK`, `SECONDARY_POSITION_MIN_SHARE`, `DETAIL_TOP_N`, `CACHE_MAX_AGE_SEC` | 50, 10, 2, 600 | 같음 |
| CLI 옵션 | `--patch` | 있음 | 삭제 |
| 환경 변수 | `DATABASE_URL`, `RIOT_*`, `API_PORT` | - | 같음 (새 변수 없음) |

- `windowDays`를 CLI 옵션으로 열지 않는다. 바꾸려면 예약 작업(`!db`)과 함께 바꿔야 해서 코드 상수로 묶어 둔다.

### 01-6. API 변경

> 요약: `patch` 파라미터와 대체 규칙을 없애고, 모든 통계 응답의 `patch` 객체를 **`window` 객체**로 바꾼다. 패치마다 공개 이름 `displayName`과 비율 `share`를 붙이고, 집계가 오래됐는지 `isStale`로 보여 준다. 한 요청의 읽기는 한 스냅숏에서 한다. 자세한 형식은 `docs/contracts/api_contract.md` v2.

#### 01-6-1. 엔드포인트

| 경로 | v1 | v2 |
|------|----|----|
| `GET /api/v1/health` | `{status, db}` | `{status, db, stats: {state, aggregatedAt}}` (01-6-3) |
| `GET /api/v1/meta` | `latestPatch`, `defaultPatch`, `isFallback`, `patches[]`, `lastCollectedAt`, `positions`, `rules{…, fallbackMinGames}` | `window`, `lastCollectedAt`, `positions`, `rules{minTierPick, secondaryPositionMinShare, windowDays, staleAfterHours}` |
| `GET /api/v1/champions?position=` | `patch` 쿼리, 응답 `patch{}` | `patch` 쿼리 없음, 응답 `window{}`. 목록 규칙 그대로 (U8) |
| `GET /api/v1/champions/:championId?position=` | `patch` 쿼리, 응답 `patch{}` | `patch` 쿼리 없음, 응답 `window{}`. 상세 규칙 그대로 (U8) |

- 경로는 `/api/v1` 그대로 둔다 (결정 D14). 아직 이 API를 쓰는 화면이 없다 (프론트는 Data Dragon만 씀).
- 예전 `patch` 쿼리를 보내도 400을 주지 않고 **무시**한다 (모르는 쿼리는 무시, 계약 1장).

#### 01-6-2. `window` 객체

| 필드 | 출처 | 규칙 |
|------|------|------|
| `days` | `stats_window.days` | 14 |
| `start` / `end` | `window_start` / `window_end` | ISO 8601 UTC. `[start, end)` |
| `games` | `stats_window.games` | 픽률·밴률 분모 |
| `aggregatedAt` | `stats_window.aggregated_at` | ISO 8601 UTC |
| `isStale` | 백엔드 계산 | `지금 − aggregatedAt > 26시간` (01-6-3) |
| `patches[]` | `stats_window_patch` | `ORDER BY patch_sort_key(patch) DESC` (최신 먼저) |
| `patches[].patch` | `patch` | 내부 패치 (`16.20`). Data Dragon 버전에 쓴다 |
| `patches[].displayName` | 백엔드 계산 | `${major + 10}.${minor}` (`16.20` → `26.20`, `16.9` → `26.9`, `15.24` → `25.24`). 형식이 `^[0-9]+\.[0-9]+$`가 아니면(일어나지 않음, DB CHECK) 내부 값 그대로 + 경고 로그 |
| `patches[].games` | `games` | |
| `patches[].share` | 백엔드 계산 | `round(100 × games / window.games, 2)`. 합이 정확히 100.00이 아닐 수 있다 (결정 D17) |

- `displayName`은 패치가 나오는 모든 곳(지금은 `window.patches[]`뿐)에 붙인다. 내부 패치를 화면에 그대로 쓰지 않게 계약에 적는다.

#### 01-6-3. 집계 멈춤 표시 (db_review L7)

> 요약: 예약 작업이 실패해도 알림이 없으므로, **모든 통계 응답에 `aggregatedAt`과 `isStale`**을 싣고, `/health`에도 상태를 싣고, API 서버 로그에 경고를 남긴다 (결정 D12 A).

| 곳 | 내용 |
|----|------|
| `window.isStale` (`/meta`, `/champions`, 상세) | `now − aggregatedAt > 26h`이면 `true`. 26시간 = 하루 주기 24시간 + 여유 2시간 (집계는 수 초). 화면은 "통계 갱신이 지연되고 있습니다 (마지막 집계 …)"를 보여줄 수 있다 |
| `/health` `stats.state` | `fresh` / `stale` / `empty`(집계 전). HTTP는 **항상 200** (`/health`는 서버·DB 확인용. 나중에 외부 감시 도구가 `stats.state`를 볼 수 있다) |
| API 서버 로그 | 요청 처리 중 `isStale`을 보면 1시간에 1번 `warn 집계가 26시간 넘게 갱신되지 않음 aggregatedAt=…` |
| 경계 | 정확히 26시간이면 `false`, 26시간 + 1ms면 `true` (단위 테스트) |

- 캐시 때문에 `isStale` 변화가 최대 10분(`max-age=600`, Next.js는 `revalidate` 주기) 늦게 보일 수 있다. 하루 단위 판단이라 문제없다.
- 예약 작업 실패 원인은 여전히 `cron.job_run_details`에서 본다 (db_spec 03-11). 백엔드는 `cron` 스키마를 읽지 않는다.

#### 01-6-4. 한 요청 = 한 스냅숏 (db_review L11)

> 요약: 05:00 집계가 커밋되는 순간 `stats_window`(분모)와 `champion`(개수)을 다른 문장으로 읽으면 이전·새 스냅숏이 섞일 수 있다. 통계 엔드포인트 3개는 요청마다 **`REPEATABLE READ READ ONLY` 트랜잭션 1개** 안에서 모든 읽기를 한다 (결정 D11 B).

| 항목 | 규칙 |
|------|------|
| 대상 | `/meta`(창 + 마지막 수집 시각), `/champions`(창 + 뷰), 상세(창 + 뷰 + 상세 4개) |
| 방법 | `readSnapshot(pool, fn)`: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` → 첫 문장에서 스냅숏이 정해짐 → 같은 연결로 차례로 → `COMMIT`. 실패하면 `ROLLBACK` 후 v1과 같은 오류 처리 |
| 순서 | 첫 문장은 `readWindow` (0줄이면 503, 01-6-5) |
| 충돌 | 읽기 전용이라 직렬화 오류(40001)가 나지 않는다. `refresh_window_stats`의 `DELETE`·`INSERT`를 막지도 않는다 (MVCC) |
| 비용 | 요청마다 `BEGIN`·`COMMIT` 왕복 2번 추가 (서울 리전, 수 ms). 연결은 요청 동안 1개만 씀 (`max 5`) |
| `/health` | 한 문장 `SELECT (SELECT aggregated_at FROM stats_window) AS aggregated_at`이 DB 확인(`SELECT 1` 대신)과 상태를 함께 하므로 스냅숏 불필요 |
| 테스트 | 단위: 가짜 `ApiDb`로 통계 엔드포인트가 `snapshot`을 정확히 1번 부르고 모든 쿼리가 그 안에서 나가는지. 통합: 실제 풀의 `readSnapshot` 안에서 `SHOW transaction_isolation` = `repeatable read`, `SHOW transaction_read_only` = `on` |

#### 01-6-5. 집계 전 (`stats_window` 0줄)

> 요약: 첫 집계가 성공하기 전에는 통계 엔드포인트 3개가 v1처럼 **`503 STATS_NOT_READY`** 를 준다 (결정 D13 A).

| 경로 | 응답 |
|------|------|
| `/meta`, `/champions`, 상세 | `503 STATS_NOT_READY`, `Cache-Control: no-store`, message "아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다." |
| `/health` | `200`, `stats: { state: "empty", aggregatedAt: null }` |

- `no-store`라서 첫 집계가 끝나면 바로 정상 응답으로 바뀐다.
- 집계 함수는 0게임이면 오류로 기존 스냅숏을 지키므로, 한 번 생긴 `stats_window`는 다시 0줄이 되지 않는다 (예외: `!db`가 직접 지울 때).

#### 01-6-6. 오류 코드

| 코드 | v2 |
|------|----|
| `INVALID_PARAMETER` (400) | `position`, `championId`만 |
| `PATCH_NOT_FOUND` (404) | **삭제** |
| `STATS_NOT_FOUND` (404) | `details`: `championId`, (`position`). `patch` 삭제 |
| `STATS_NOT_READY` (503) | 뜻: "집계된 패치 없음" → "`stats_window`가 비어 있음" |
| `NOT_FOUND`, `DB_UNAVAILABLE`, `INTERNAL_ERROR` | 같음 |

### 01-7. 테스트 변경

> 요약: 패치 대체 테스트를 지우고, `startTime`·시작 시각 검사·창 집계·`window` 응답·스냅숏·오래됨 표시를 시험한다. 통합 테스트는 **2021년** 가짜 게임과 과거 `p_until`로 실제 데이터와 섞이지 않게 하고, 모두 ROLLBACK 한다.

#### 01-7-1. fixture

- `test/fixtures/KR_8408851980.match.json`에는 이미 `info.gameStartTimestamp: 1791263990514`(= `2026-10-06T05:19:50.514Z`, 계약 6-2 예시)가 있다. **파일은 바꾸지 않는다** (Riot 호출 불필요).
- `test/helpers/fixture.ts`의 `OPTS`에 고정 `windowStartMs = Date.parse('2026-09-30T00:00:00Z')`를 넣는다. 실제 시계를 쓰면 2026-10-20 뒤 fixture가 창 밖이 되어 테스트가 깨지므로 **모든 테스트는 고정 시각**을 쓴다.
- `test/helpers/db.ts` `fakeGames(n, { patch, startMs })`: 게임마다 `gameStartTimestamp = startMs + k × 60,000` (기본 `startMs = 2021-01-10T00:00:00Z`), 변환 `windowStartMs = 2021-01-01T00:00:00Z`. 가짜 ID `KR_90000000xx`, 가짜 puuid `TEST_…`, 가짜 패치 `0.8`·`0.9`는 그대로.

#### 01-7-2. 단위 테스트 (`npm test`)

| 대상 | 확인 |
|------|------|
| `transform` fixture | `matches` 줄 = `{ match_id, puuid, patch: '16.19', game_start_at: 2026-10-06T05:19:50.514Z }` (`getTime() === 1791263990514`). 참가자 10줄 값은 v1과 같음 |
| `transform` 시작 시각 | 없음 / 문자열 / 소수 / `1577836799999` → `bad_format`, `1577836800000`은 통과(창 시작을 그보다 이르게 둔 경우), `windowStartMs − 1` → `out_of_window`, 정확히 `windowStartMs` → 통과 |
| `config` | `test` 프리셋 100명 → 25/25/25/25, `keepPatches`·`maxGamesPerPatch` 없음, `windowStart(Date.parse('2026-10-15T01:00:00Z'), 14)` → `sec = 1790816400`, `ms` 끝 3자리 버림 확인 |
| `client` (가짜 fetch) | `getMatchIds` URL = `…/ids?queue=420&start=0&count=20&startTime=1790816400`. ms 값(13자리)을 넣으면 던짐. 키가 URL에 없는 것은 v1과 같음 |
| `matches` 창 상한 (가짜 riot·가짜 저장) | 창 안 게임 24,999 + 이번 1개 저장 → 다음 게임 전에 `window_full`로 멈추고 `getMatch`를 더 부르지 않음 |
| `window.ts` | `displayPatch`: `16.20`→`26.20`, `16.9`→`26.9`, `15.24`→`25.24`, `0.9`→`10.9`. `share`: 992/2481 → 39.98, 1489/2481 → 60.02. `isStale`: 26시간 정확히 `false`, +1ms `true` |
| `app` (가짜 `ApiDb`) | `stats_window` 없음 → `/meta`·`/champions`·상세 모두 `503 STATS_NOT_READY` + `no-store`, `/health` `stats.state = 'empty'`. `?patch=16.19` → 400 아님(무시). 통계 엔드포인트마다 `snapshot` 1번. 그 밖의 v1 오류 테스트 유지 |
| 삭제 | `patchSelection` 테스트 6개, `parsePatchParam`·`comparePatch` 테스트 |
| 유지 | `rateLimiter`, `mainPositions`, `validate`(position·championId), 표본, logger 가리기 |

#### 01-7-3. 통합 테스트 (`npm run test:integration`, 실제 Supabase, ROLLBACK)

| 대상 | 확인 |
|------|------|
| 저장 | fixture 게임 저장 → `matches.game_start_at` = 넣은 시각, 10줄, 다시 저장 → duplicate |
| 창 집계 | 2021년 가짜 게임 3개 → `aggregateWindow(c, { days: 14, until: '2021-01-15T00:00:00Z' })` → `games 3`, `patches [{0.9, 3}]`, `stats_window` 1줄, `statement_timeout` 원래대로 |
| 0게임 | `until: '2020-06-01T00:00:00Z'` → `ok: false`(P0002), 호출 전·후 `stats_window` 같음 |
| `purge` 미리보기 | 2021년 게임 1개 넣고 `planPurgeGames(c, 21)`가 그 게임을 지울 대상으로 셈. **`purge_old_games`는 실행하지 않는다** (실제 원본까지 지우는 문장이라 ROLLBACK이어도 시험하지 않음. DB Review R6이 확인함) |
| API | 2021년 가짜 게임 60개(`0.8` 24개, `0.9` 36개) → 창 집계 → `createApp(롤백 ApiDb)`: `/meta` `window` 형식(`patches = [{0.9, 10.9, 36, 60}, {0.8, 10.8, 24, 40}]`, `isStale`), `/champions?position=TOP`, 상세, 404 `details`에 `patch` 없음 |
| 오래됨 | 같은 트랜잭션에서 `UPDATE stats_window SET aggregated_at = now() − interval '27 hours'` → `window.isStale = true`, `/health` `stats.state = 'stale'` |
| 스냅숏 | 실제 풀 `readSnapshot` 안 `SHOW transaction_isolation` = `repeatable read`, `transaction_read_only` = `on` |
| 정리 확인 | 끝난 뒤 `matches`의 `KR_9000000%` 0줄, `stats_window_patch`에 `0.8`·`0.9` 0줄, `ranked_players`의 `TEST\_%` 0줄 |

- 통합 테스트는 실제 `stats_window`를 트랜잭션 안에서 지웠다가 되돌린다 (커밋 안 함). 05:00 KST(20:00 UTC)에 돌리면 예약 작업이 함수 잠금에서 테스트 끝까지 기다린다 → 그 시각을 피한다.

### 01-8. Review 실제 소량 수집

> 요약: 에메랄드 몇 명으로 수십 게임만 실제로 모아 `game_start_at`·`startTime`·창 집계·API v2를 확인한다. 전체 테스트 수집(300명)은 하지 않는다.

| 단계 | 명령 (backend/에서) | 확인 |
|------|---------------------|------|
| 1 | `npm run collect -- run --preset test --tiers EMERALD --players-per-tier 4 --max-matches 30` | 에메랄드 표본이 3 → 7명(디비전당 1명 추가). ② 요청 URL에 `startTime`(10자리 초)이 로그에 보임. 30게임 저장, 각 10줄, `collection_logs` `done`, **집계 호출 없음**. Riot 약 75회 |
| 2 | DB 조회 | 모든 `matches.game_start_at`이 `[실행 시작 − 14일, 실행 시작)` 안. `out_of_window` 개수(0 또는 몇 개). 1번 참가자 몇 명을 Riot 원본과 대조 (밴·포지션·스킬, v1 남은 문제 6) |
| 3 | 같은 명령 다시 | 저장한 30게임은 건너뜀 |
| 4 | `npm run collect -- aggregate` | `ANALYZE` → `refresh_window_stats(14)` 성공 jsonb (`games` = 30 근처, `patches` 구성). 실제 스냅숏이 만들어진다 (다음 05:00 예약 작업이 다시 만듦) |
| 5 | `npm start` 후 `/health`, `/meta`, `/champions?position=TOP`, `/champions/{저장된 챔피언}`, `?patch=16.19`, 없는 챔피언 | api_contract v2와 필드·null·정렬 일치. `displayName` = 메이저 + 10, `share` 합 ≈ 100, `isStale: false`, 티어는 대부분 `null`(정상) |
| 6 | `npm run collect -- purge` | 지울 게임 0 (미리보기만, `--yes` 쓰지 않음) |
| 7 | `RIOT_API_KEY=invalid npm run collect -- matches --preset test --tiers EMERALD --max-matches 5` | 즉시 멈춤, `key_expired`, 종료 코드 2, 반쪽 게임 없음 |
| 8 (가능하면) | 다음 05:00 KST 뒤 `cron.job_run_details` | `succeeded` (지금까지는 0게임이라 P0002 `failed`가 정상이었다). Review가 그 시각 뒤에 끝나면 기록, 아니면 남은 문제로 |

- 저장한 7명·30게임과 실제 스냅숏은 지우지 않고 남긴다 (14일 창에 맞는 실제 데이터라 전체 테스트 수집에 그대로 이어진다).
- v1 남은 문제 4·5(Ctrl+C, 연속 실패·DB 끊김)는 이번 Review에서 함께 확인한다 (코드가 바뀌지 않았지만 v1 Review가 없었으므로).

### 01-9. 완료 기준

> 요약: Review가 아래를 하나씩 확인한다. v1 10장 중 바뀌지 않은 항목(제한기, 401/403, 잠금, 오류 형식, 캐시, 보안)도 함께 본다.

#### 코드·검증

- [ ] `npm run typecheck`, `npm run lint` 오류 0
- [ ] `npm test` 통과 (01-7-2 전부), `npm run test:integration` 통과, 끝난 뒤 테스트 데이터 0줄
- [ ] 코드에 `refresh_patch_stats`, `purge_old_patches`, `FROM patch`, `keepPatches`, `maxGamesPerPatch`, `patch_full`, `old_patch`, `isFallback`, `PATCH_NOT_FOUND`, `selectPatch`가 없음 (`grep`)
- [ ] API 서버가 수집 코드를 실행하지 않고 Riot 키를 읽지 않음 (v1과 같음)

#### 수집

- [ ] ① `test` 프리셋 티어당 100명, 디비전당 25명
- [ ] ② `startTime` = 실행 시작 − 14일, **초**, 모든 플레이어에 같은 값
- [ ] ③ 시작 시각 없음·형식 오류 → `bad_format`, 창 밖 → `out_of_window`, 둘 다 ④ 호출 없음
- [ ] ⑤ `matches.game_start_at` = `new Date(gameStartTimestamp)`, 1게임 = 1트랜잭션
- [ ] `run`·`matches`가 집계 함수를 부르지 않음
- [ ] 창 상한 25,000에서 `window_full`로 멈춤 (단위 테스트)
- [ ] `aggregate`: 같은 연결 `ANALYZE` → `refresh_window_stats(14)`, `statement_timeout 5min`, P0002는 경고 + 종료 코드 1, `--patch` 없음
- [ ] `purge`는 미리보기만, `--yes`일 때만 `purge_old_games(21)`
- [ ] 실제 소량 수집 01-8 1~7

#### API

- [ ] 엔드포인트 4개가 `api_contract.md` v2의 경로·파라미터·필드·null 여부와 일치
- [ ] `window.patches[]` 최신 순, `displayName` = 메이저 + 10, `share` 소수 2자리
- [ ] `isStale` 26시간 경계, `/health` `stats.state` 3가지
- [ ] 통계 엔드포인트가 요청마다 `REPEATABLE READ READ ONLY` 트랜잭션 1개로 읽음
- [ ] `stats_window` 0줄 → 3개 엔드포인트 `503 STATS_NOT_READY` + `no-store`
- [ ] `patch` 쿼리를 보내도 무시 (400 아님), `PATCH_NOT_FOUND` 없음
- [ ] 티어·정렬·주 포지션·상세 개수 규칙이 v1과 같음 (U8)

#### 보안

- [ ] 로그·문서·응답에 `RIOT_API_KEY`, `DATABASE_URL` 값 없음 (`grep`)
- [ ] `.env.example` 변경 없음 (새 변수를 만들었다면 그 변수만 추가)

### 01-10. 계약 변경 요청 (DB 계약)

> 요약: **없음.** v7의 테이블·함수·뷰만으로 구현할 수 있다.

- 참고 (변경 요청 아님, 다음 `!db` 문구 수정 때):
  1. 계약 7장 "창 밖 게임": Riot `startTime`은 게임 생성 시각 기준일 수 있어 경계에서 몇 게임이 `out_of_window`로 빠진다. 문구에 "경계의 몇 게임은 정상"을 더하면 오해가 없다.
  2. `matches.game_start_at` 인덱스는 여전히 필요 없다 (창 상한·`purge` 미리보기 집계는 최대 약 3만 7천 줄 순차 스캔, D21과 같음).
  3. db_review L10(`ranked_players` 주석 "각 50명"), L12(`cron` 권한 문구)는 `!db` 영역. 백엔드 영향 없음.

### 01-11. 결정 필요 사항

> 요약: 아래 7개를 정해 주면 Build를 시작한다. ★가 추천안이다.

| # | 항목 | 선택지 | 추천과 이유 |
|---|------|--------|-------------|
| D11 | 한 요청 읽기 일관성 (L11) | A. 엔드포인트마다 SQL 한 문장(CTE + `json_agg`) / B. 요청마다 `REPEATABLE READ READ ONLY` 트랜잭션 | **★B.** 지금 쿼리를 거의 그대로 쓰고, 상세(쿼리 6개)를 한 문장으로 합치는 복잡한 SQL이 필요 없다. 비용은 왕복 2번 |
| D12 | 집계 멈춤 표시 (L7) | A. 모든 통계 응답 `window.isStale`(26시간) + `/health` `stats.state` + 서버 경고 로그 / B. A + 오래되면 `/health` 503 / C. `aggregatedAt`만 주고 판단은 프론트 | **★A.** 화면과 운영 둘 다 보인다. B는 DB가 멀쩡한데 health가 실패해 원인을 헷갈리게 한다. C는 기준이 화면마다 달라질 수 있다 |
| D13 | 집계 전 응답 | A. `/meta`·목록·상세 모두 `503 STATS_NOT_READY` / B. `/meta`만 `200 window: null` | **★A.** v1과 같아 단순하고 `no-store`라 첫 집계 직후 바로 바뀐다. 상태는 `/health`가 `empty`로 알려 준다 |
| D14 | API 경로·옛 파라미터 | A. `/api/v1` 유지, 계약 v2가 v1을 대체, `patch` 쿼리는 무시 / B. `/api/v2` 새 경로 | **★A.** 아직 이 API를 쓰는 화면이 없어 깨질 사용처가 없다. 두 버전을 함께 유지할 이유가 없다 |
| D15 | 창 상한 처리 | A. 창 안 25,000게임이면 실행을 멈춤(`window_full`) / B. v1처럼 게임마다 건너뜀 / C. 상한 없음 | **★A.** 창 안 게임은 모두 같은 창이라 건너뛰면 상세 호출만 낭비된다. C는 무료 용량 계산(계약 1-2)이 깨진다 |
| D16 | 남아 있는 에메랄드 표본 3명 | A. 그대로 둠 (에메랄드 103명) / B. 삭제 (되돌릴 수 없음, 사용자 승인 필요) | **★A.** 3%라 통계 영향이 작고, 삭제 승인·작업이 필요 없다. 정확히 100명이 필요하면 나중에 B |
| D17 | 패치 비율 `share` 자릿수 | A. 소수 2자리 (다른 비율과 같음) / B. 소수 1자리 (db_spec 03-7 메모) | **★A.** 계약 1장 "비율은 소수 2자리" 규칙 하나로 맞춘다. 화면에서 1자리로 줄이는 것은 프론트가 한다 |

### 01-12. 작업 범위

> 요약: Build는 `backend/`와 API 계약, Review는 검토 기록·수정·커리어 기록만 고친다.

| 단계 | 수정 가능 경로 | 비고 |
|------|----------------|------|
| Plan | `backend/docs/back_spec.md`, `docs/contracts/api_contract.md` | 이번 문서 (v2 초안) |
| Build | `backend/` (코드, 설정, 테스트, fixture 도우미) | 01-3 |
| Build | `backend/docs/back_build.md` | 아래에 "변경 01" 절 추가 (v1 기록은 남김) |
| Build | `docs/contracts/api_contract.md` | 승인된 v2만, 상태를 구현 반영으로 |
| Build | `.env.example` | 새 변수가 생길 때만 (예상: 변경 없음) |
| Review | `backend/docs/back_review.md`, `backend/docs/back_build.md` | 검토 결과, 고친 기능 반영 |
| Review | `backend/` 안의 수정 | 검토에서 찾은 문제 |
| Review | `docs/career_log.md` | 아래에 추가만 (기존 기록 수정 금지) |

- 수정 금지: `db/`, `docs/contracts/db_contract.*`, `frontend/`, 루트 `.env`, `CLAUDE.md`.
- DB 쓰기: 통합 테스트는 ROLLBACK만. 실제 저장은 Review 소량 수집(01-8)과 `aggregate` 1회뿐. `purge --yes`, 표본 삭제(D16 B), 그 밖의 되돌릴 수 없는 SQL은 메인 에이전트를 통해 사용자 승인 후.
- Riot 호출: Build는 개발 확인용 소량(수십 회)만. fixture는 이미 있어 새로 받지 않는다. 전체 테스트 수집(300명, 약 2시간)은 사용자가 직접 실행한다.
