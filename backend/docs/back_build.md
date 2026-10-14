# 백엔드 구현 기록 — 01 수집 워커 + 챔피언 통계 API

> 작성: Build 에이전트 / 작성일: 2026-10-14
> 기준: `backend/docs/back_spec.md` (승인됨, D1~D10 추천안), `docs/contracts/api_contract.md` (승인됨), `docs/contracts/db_contract.md` v6
> 상태 표기: ✅ 완료 / ⚠️ 부분 완료 / ❌ 실패 / ⏸️ 보류

---

## 1. 요약

> 요약: 계획서 2-1의 구조대로 API 서버와 수집 CLI를 만들었다. 단위 테스트 59개, 통합 테스트 14개, 타입 검사, 린트 모두 통과했다. 실제 수집(3명, 26게임)과 API 확인까지 마쳤다.

| 항목 | 결과 |
|------|------|
| `npm run typecheck` (`tsc --noEmit`) | 오류 0 |
| `npm run lint` (eslint 9 + typescript-eslint 8) | 오류 0 |
| `npm test` (단위, DB·네트워크 없음) | 59개 통과 / 실패 0 (약 0.4초) |
| `npm run test:integration` (실제 Supabase, 모두 ROLLBACK) | 14개 통과 / 실패 0 (약 3.4초). 끝난 뒤 테스트 데이터 0줄 확인 |
| `npm audit` | 취약점 0 |
| 실제 소량 수집 | 에메랄드 3명, 26게임 저장, `match_players` 260줄, Riot 호출 92회, 429 0회, 23초 |
| API 확인 | 엔드포인트 4개 모두 `api_contract.md`와 형식 일치 |
| 비밀값 검사 | `backend/` 전체, 수집 로그, `.env.example`, `api_contract.md`에서 `RIOT_API_KEY`, `DATABASE_URL`, 비밀번호 값 0건 |

---

## 2. 기능별 결과

### 2-1. 공통 모듈

> 요약: 설정, DB, 로그 모듈. 두 진입점이 같이 쓴다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 환경 변수 | `src/config/env.ts`. `loadDbEnv`, `loadRiotEnv`(CLI만 부름), `loadApiPort`(기본 4000). 형식만 검사하고 값은 출력하지 않음. `RIOT_API_KEY`는 비어 있지 않은지만 확인 (형식을 엄격히 보면 잘못된 키 테스트가 401까지 가지 못함) | ✅ |
| 수집 프리셋 | `src/config/collection.ts`. `test`(플래티넘·에메랄드·다이아 50명, 20게임), `main`(자리만). `--tiers`는 디비전 있는 티어만 허용. `divisionQuota(50)` = 13/13/12/12 | ✅ |
| API 규칙 상수 | `src/config/api.ts`. 50판, 10%, 5,000게임, 상위 2개, max-age 600 | ✅ |
| DB 풀 | `src/db/pool.ts`. API `max 5`, CLI `max 2`. 유휴 연결 오류는 가린 뒤 로그. `isDbConnectionError`로 연결 오류 판별 | ✅ |
| 트랜잭션 | `src/db/tx.ts`. `Queryable` 타입, `withTransaction(pool, fn)`, `inTransaction(client, fn)` | ✅ |
| 로그·가리기 | `src/lib/logger.ts`. 한 줄 `시각 레벨 [영역] 메시지 key=value`. `DATABASE_URL` 전체·비밀번호(디코딩 포함, 잘못된 `%` 인코딩도 원문은 가림)·사용자·호스트, `RIOT_API_KEY`, `postgresql://…`·`RGAPI-…` 모양을 `***`로. puuid는 앞 8자만 | ✅ |

### 2-2. Riot 클라이언트

> 요약: 이중 창 제한기와 재시도·오류 분류. 응답 헤더로 직전 사용량까지 맞춘다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 제한기 | `src/riot/rateLimiter.ts`. 1초 19회 + 120초 98회, 모든 호출이 제한기 1개를 공유, 순서대로 처리. 시계(`now`, `sleep`) 주입 가능 | ✅ |
| 응답 헤더 반영 | `X-App-Rate-Limit-Count`가 우리 셈보다 크면 차이만큼 채움 (직전 실행·다른 프로세스 사용량). `X-App-Rate-Limit`이 설정보다 작으면 서버 한도를 따름 | ✅ |
| 429 | `Retry-After`초(없으면 10초) 동안 제한기 전체를 막고 재시도, 최대 5번 | ✅ |
| 5xx·네트워크·10초 시간 초과 | 1·2·4초 재시도 3번, 그래도 실패면 `RiotRetryExhaustedError` | ✅ |
| 401/403 | `RiotKeyExpiredError`, 재시도 없음 | ✅ |
| 404 / 400 | `RiotNotFoundError` / `RiotBadRequestError` (그 게임·플레이어만 건너뜀) | ✅ |
| 키 전달 | `X-Riot-Token` 헤더만. URL·로그에 없음 (단위 테스트로 확인). 오류 path의 puuid는 앞 8자만 | ✅ |
| 사용량 로그 | 10분마다 `appCount`, `appLimit`, `methodCount` (첫 호출 때도 1번) | ✅ |

### 2-3. 변환 (`src/collector/transform.ts`)

> 요약: 계약 6·7장 규칙을 순수 함수로 옮겼다. 실제 게임 1번 참가자가 계약 예시 값과 정확히 같다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 미리 거르기 | `prefilterMatch`: match_id 형식, `queueId ≠ 420` → `not_solo`, `gameDuration < 300` → `too_short`, 참가자 ≠ 10 → `not_10_players`, 패치 형식 → `bad_format`. 타임라인 호출 전에 실행 | ✅ |
| 패치 | `16.19.823.722` → `16.19`, `16.9.1` → `16.9`. 비교는 `[major, minor]` 숫자 | ✅ |
| 포지션 | `""`·없음 → NULL. 5개 밖의 값 → NULL + 경고 | ✅ |
| 밴 | `teams[].bans[]`를 `pickTurn → championId` 표로. `-1`·0 이하 → NULL. 짝 없음 → NULL + 경고 | ✅ |
| 룬 | `description`으로 핵심/보조 찾고 없으면 `styles[0]`/`[1]`. 4개/2개가 아니면 `bad_format` | ✅ |
| 스펠·아이템 | `summoner1Id/2Id` 그대로 (`*Casts` 안 씀). `item0~5` 그대로, 빈 칸 0, `item6` 저장 안 함 | ✅ |
| `skill_order` | 타임라인 참가자를 puuid로 잇고, `SKILL_LEVEL_UP` + `NORMAL`만, `timestamp` 순(같으면 원래 순서), 1~4 → QWER, 그 밖의 slot은 버리고 경고. 이벤트 없으면 NULL | ✅ |
| 기타 검사 | puuid 중복·없음, 타임라인 matchId 불일치, 정수가 아닌 값 → `bad_format` (DB CHECK 위반을 미리 막음) | ✅ |

### 2-4. 수집 CLI (`src/cli/collect.ts`, `src/collector/*`)

> 요약: `run / sample / matches / aggregate / purge` 5개 명령. 상태는 DB에만 둔다 (D7).

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 0 준비 | 잠금 전용 연결에서 `pg_try_advisory_lock(hashtext('tiergg:collector'))`. 실패하면 종료 코드 3. 남은 `running` → `failed`('비정상 종료로 남은 기록'), 새 `running` 1줄 | ✅ |
| ① 표본 | 디비전마다 page 1에서 요청 티어·디비전과 같고 `inactive`가 아닌 사람만, 시드 있는 무작위(mulberry32)로 13/13/12/12명. 시드를 로그에 남김 (`--seed`로 재현). `ON CONFLICT (puuid) DO UPDATE` | ✅ |
| ② 게임 ID | `queue=420&start=0&count=20`. 메모리 `Map`(처음 찾은 puuid) → DB에 있는 ID 제거 → 숫자 내림차순 | ✅ |
| ③ 상세 | 미리 거르기, 보관 패치 창(`matches` 패치 ∪ 이번에 본 패치 중 최신 2개) 밖이면 `old_patch`, 패치당 25,000게임이면 `patch_full`. 걸리면 ④를 부르지 않음 | ✅ |
| ④ 타임라인 + ⑤ 저장 | 게임 1개 = 트랜잭션 1개. `matches` `ON CONFLICT DO NOTHING` → 0줄이면 ROLLBACK(`duplicate`) → `match_players` 10줄 한 문장 INSERT → COMMIT | ✅ |
| ⑥ 집계 | 연결 1개에서 `SET statement_timeout = '5min'` → `ANALYZE matches, match_players` → 이번에 저장한 패치마다 패치 순서대로 `SELECT refresh_patch_stats($1)` → `RESET`. 저장 0개면 건너뜀. `P0002`(완료 게임 0개)는 그 패치만 경고 | ✅ |
| ⑦ purge | `--yes` 없으면 패치별 게임 수와 지울 대상만 보여줌. `--yes`면 지울 패치가 모두 `patch`에 집계돼 있는지 확인 뒤 `purge_old_patches(2)`. **실행하지 않음** (미리보기만 확인) | ✅ |
| 오류 처리 | 401/403 → `key_expired`, 집계 건너뜀, 종료 코드 2. Ctrl+C → 지금 게임 뒤 멈춤, `failed`('사용자 중단'), 130 (두 번 누르면 바로 종료). 게임 하나의 오류(404, 400, 재시도 실패, DB 22xxx·23xxx)는 그 게임만 건너뜀, 연속 20개면 `failed`. 그 밖의 오류는 가린 메시지(500자)로 `failed`, 1 | ✅ |
| 종료 기록 | `finished_at`, `players`(② 표본 수), `matches_saved`. 중간에 멈춰도 그때까지 저장한 수를 남김 | ✅ |
| 진행·요약 로그 | 50게임마다 진행률(저장/목표, 건너뜀 이유별, 경과, 예상 남은 시간, 호출 수). 끝에 호출 수·429·재시도·상태별 개수·제한기 대기 시간·건너뜀·경고·집계 jsonb | ✅ |

### 2-5. 읽기 API (`src/server.ts`, `src/api/*`)

> 요약: GET 4개. 숫자 변환과 반올림은 SQL에서 하고, 표시 패치·주 포지션 규칙은 순수 함수로 분리했다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `GET /api/v1/health` | `SELECT 1`, 실패하면 503 `DB_UNAVAILABLE`. `no-store` | ✅ |
| `GET /api/v1/meta` | 최신·기본 패치, `isFallback`, 패치 목록(최신 순), `lastCollectedAt`(마지막 `done`), 포지션 순서, 규칙 값 | ✅ |
| `GET /api/v1/champions` | `champion_tier_view`를 `tier NULLS LAST, tier_score DESC, champion_id`로 읽고, 주 포지션에 그 포지션이 있는 챔피언만. `positionShare`는 SQL 창 함수 | ✅ |
| `GET /api/v1/champions/:championId` | 주 포지션 탭, 선택 포지션 `stats`, 아이템 전체, 룬·스펠·스킬 상위 2개. 조합 승률 `win/pick`, 사용률 `pick/champion.pick` (SQL `round(…, 2)`) | ✅ |
| 표시 패치 | `patchSelection.ts`: 최신 `games < 5000`이고 직전이 더 많으면 직전 패치. 지정하면 그대로, 없으면 404 | ✅ |
| 주 포지션 | `mainPositions.ts`: pick 내림차순(같으면 이름 순) 최대 2개, 2순위는 `pick × 100 ≥ 10 × 전체`(정수 비교로 10.0% 경계 정확) | ✅ |
| 파라미터 검사 | `validate.ts`: 대문자 포지션 정확히, 패치 `^[0-9]+\.[0-9]+$` 10자 이하, 챔피언 `^[1-9][0-9]{0,4}$`. 같은 이름 반복(배열)도 400 | ✅ |
| 오류 | `{ error: { code, message, details? } }`. 400/404/503/500. 500은 내부 내용 없이 로그에만 (스택도 가림). GET·HEAD 외 메서드는 404 | ✅ |
| 캐시 | 성공 `public, max-age=600`, `health`·오류 `no-store`. ETag 끔 (계약 4장 "ETag·304 없음") | ✅ |
| CORS | 헤더 없음 (D6). `x-powered-by` 끔 | ✅ |
| 분리 | API 서버는 `RIOT_API_KEY`를 읽지 않고 수집 코드를 import하지 않음 | ✅ |

### 2-6. 테스트

> 요약: 계획서 9-1, 9-2 항목을 모두 만들었다. 통합 테스트는 가짜 패치 `0.9`·`0.7`·`0.99`, 가짜 ID `KR_90000000xx`, `TEST_…` puuid만 쓰고 모두 ROLLBACK한다.

| 파일 | 내용 | 상태 |
|------|------|------|
| `test/fixtures/KR_8408851980.*.json` | 실제 게임을 Riot에서 1번 받음(호출 2회). puuid 10개 → `TEST_PUUID_01…10`, `riotIdGameName`·`summonerName` → `Player01…`, `riotIdTagline` → `TEST`, `summonerId` → `TEST_SUMMONER_01…`. 타임라인은 `SKILL_LEVEL_UP`과 `info.participants`만 (570KB → 26KB). 저장 전 원본 puuid가 남지 않았는지 검사 | ✅ |
| `unit/transform.test.ts` | 1번 참가자 = 계약 6-3 값 26개 전부, 가공 입력 13가지 | ✅ |
| `unit/rateLimiter.test.ts` | 20번째까지 바로·21번째 1초 대기, 100번째 뒤 120초 대기, 19/98로 300회 돌려 어느 창도 넘지 않음, 429 block, 헤더 반영, 동시 호출 | ✅ |
| `unit/client.test.ts` | 401/403 재시도 없음, 429 `Retry-After`·기본 10초·6번째 포기, 503 1·2·4초 후 포기, 네트워크 오류 재시도, 404/400, 키가 URL에 없음 | ✅ |
| `unit/rules.test.ts` | patchSelection 6가지, mainPositions 9.9%/10.0%/3순위/동률, validate 경계값, 표본 도우미, 로그 가리기 | ✅ |
| `unit/app.test.ts` | 가짜 db로 503 `STATS_NOT_READY`, 400 `details`, 404, 503 `DB_UNAVAILABLE`, 500에 내부 내용 없음, CORS 없음 | ✅ |
| `integration/repository.test.ts` | 저장 → 10줄 → 다시 저장 시 `duplicate`, DB 1번 참가자 값, upsert, `ANALYZE` → `refresh_patch_stats('0.9')` jsonb, `P0002` 경고, purge 미리보기, `collection_logs`, 끝난 뒤 0줄 | ✅ |
| `integration/api.test.ts` | 가짜 60게임 집계(pick 60 → tier 값 있음) 후 `createApp(트랜잭션 연결)` + `listen(0)`. 4개 엔드포인트 필드 이름·값·정렬·캐시 헤더, 404 2종, 끝난 뒤 0줄 | ✅ |

---

## 3. 사용자가 실행하는 명령

> 요약: 모두 `backend/`에서 실행한다. 루트 `.env`를 `node --env-file=../.env`로 읽는다.

### 3-1. 처음 한 번

```bash
cd backend
npm install
```

### 3-2. API 서버

```bash
npm run dev     # watch 모드 (코드 바꾸면 다시 시작)
npm start       # 일반 실행
# http://localhost:4000/api/v1/health  (포트는 .env의 API_PORT, 비우면 4000)
```

### 3-3. 테스트 수집 (전체, 약 2시간)

```bash
npm run collect -- run --preset test
```

- 플래티넘·에메랄드·다이아 각 50명을 뽑고(이미 50명 이상 있으면 건너뜀), 1명당 최근 솔로랭크 20게임을 모아 저장한 뒤 집계한다.
- 로그를 파일로도 남기려면 `npm run collect -- run --preset test 2>&1 | tee collect.log` (`*.log`는 git 제외).
- 지금 DB에는 검증용 에메랄드 3명이 있다. 50명보다 적어서 `run`을 실행하면 에메랄드도 50명을 새로 뽑아 더한다 (모두 53명, 5장 참고).

### 3-4. 키 만료 후 이어서 모으기

1. 로그에 `Riot 키 만료(401/403)`가 나오고 종료 코드가 2다 (`collection_logs.status = 'key_expired'`).
2. https://developer.riotgames.com 에서 키를 재발급해 루트 `.env`의 `RIOT_API_KEY`를 바꾼다.
3. **같은 명령**을 다시 실행한다: `npm run collect -- run --preset test`
   - 저장한 게임은 건너뛰고 남은 것만 모은 뒤 마지막에 집계한다.
   - 지금까지 모은 것만 먼저 집계하려면: `npm run collect -- aggregate`

### 3-5. 그 밖의 명령

| 명령 | 하는 일 |
|------|---------|
| `npm run collect -- sample --preset test [--resample] [--seed N]` | 표본만 (`--resample`은 다시 뽑아 더함) |
| `npm run collect -- matches --preset test` | 저장된 표본으로 게임만 (집계 없음) |
| `npm run collect -- aggregate [--patch 16.19]` | `ANALYZE` + 집계만 |
| `npm run collect -- purge` | 지울 원본 미리보기 (읽기만) |
| `npm run collect -- purge --yes` | 오래된 패치 원본 삭제 (되돌릴 수 없음) |
| 공통 옵션 | `--max-matches N`, `--players-per-tier N`, `--games-per-player N`, `--tiers EMERALD,DIAMOND`, `--seed N` |

- 종료 코드: 0 정상, 1 실패, 2 키 만료, 3 다른 수집이 실행 중, 130 사용자 중단(Ctrl+C).

### 3-6. 검증 명령

```bash
npm run typecheck
npm run lint
npm test                   # 단위 (DB·네트워크 없음)
npm run test:integration   # 실제 Supabase, 모두 ROLLBACK
```

---

## 4. 검증 결과

> 요약: 실제 Riot API와 Supabase로 소량 수집, 이어 모으기, 잠금, 잘못된 키, API를 확인했다.

### 4-1. Riot 호출 합계 (Build 전체)

| 용도 | 호출 |
|------|------|
| fixture (match + timeline) | 2 |
| 소량 수집 1회차 | 92 |
| 소량 수집 2회차 (이어 모으기) | 37 |
| 잘못된 키 확인 (`RIOT_API_KEY=invalid`, 401) | 1 |
| **합계** | **132** (429 0회) |

### 4-2. 소량 수집 1회차

```bash
npm run collect -- run --preset test --tiers EMERALD --players-per-tier 3 --max-matches 30
```

| 항목 | 값 |
|------|-----|
| 표본 | 에메랄드 I·II·III 각 1명 (각 페이지 205명, `inactive` 0명), seed `211684010` |
| 게임 ID | 60개 (겹침 0) |
| 처리 | 60게임 상세 조회, **저장 26**, `old_patch` 34, 실패 0, 경고 0 |
| Riot 호출 | 92회 (리그 3 + ID 3 + 상세 60 + 타임라인 26), 전부 200, 429 0, 재시도 0 |
| 시간 | 23초 (제한기 대기 0초). 끝날 때 `x-app-rate-limit-count` = `89:120,1:1` |
| `ANALYZE` | 18ms |
| 집계 16.19 | 91ms, `{games 20, champion_rows 114, item_rows 849, rune_rows 176, spell_rows 130, skill_rows 147}` |
| 집계 16.20 | 38ms, `{games 6, champion_rows 50, item_rows 280, rune_rows 58, spell_rows 53, skill_rows 42}` |
| DB | `matches` 26 (16.19: 20, 16.20: 6), `match_players` 260, 10줄이 아닌 게임 0, `team_position` NULL 0, `ban_champion_id` NULL 10, `skill_order` NULL 0, 11자 미만 29줄 |
| `collection_logs` | `done`, players 3, matches_saved 26 |

- 목표 30게임보다 적은 26게임에서 끝난 이유: 3명의 최근 20게임 중 34게임(57%)이 16.18 이하라 보관 창(16.20, 16.19) 밖이었다. 5장·7장 참고.

### 4-3. 같은 명령 다시 실행 (이어 모으기)

| 항목 | 값 |
|------|-----|
| ① | "표본이 이미 있어 건너뜀" (3명) |
| ② | 60개 중 이미 저장 26, 남은 34 |
| ③ | 34개 모두 `old_patch`, 저장 0 → ⑥ 집계 건너뜀 |
| Riot 호출 | 37회, 429 0 |
| 시간 | 124초. 그중 제한기 대기 119초: 첫 응답의 `x-app-rate-limit-count`가 1회차 사용량(약 93/100)을 보여줘 2분 창이 빌 때까지 기다림 (헤더 반영이 429를 막은 사례) |
| `collection_logs` | `done`, players 3, matches_saved 0 |

### 4-4. 잠금, 잘못된 키, purge 미리보기

| 확인 | 결과 |
|------|------|
| 다른 연결이 수집 잠금을 잡은 동안 `aggregate` | "다른 수집이 실행 중입니다", 종료 코드 3 |
| `RIOT_API_KEY=invalid npm run collect -- run …` | 첫 호출(②) 401 → 즉시 멈춤, 종료 코드 2, `key_expired`, `finished_at` 기록, 반쪽 게임 0, 집계 건너뜀 |
| `purge` (`--yes` 없음) | 패치 16.20(6), 16.19(20) 보관, 지울 원본 0. 삭제하지 않음 |

### 4-5. API (실제 데이터, `npm start`)

| 요청 | 상태 | 확인 |
|------|------|------|
| `GET /health` | 200 | `{"status":"ok","db":"ok"}`, `no-store` |
| `GET /meta` | 200 | `public, max-age=600`, `application/json; charset=utf-8` |
| `GET /champions?position=TOP~UTILITY` | 200 | 16.19(대체) 기준 24/25/27/18/20개, 모두 `tier: null`(표본 부족, 정상) |
| `GET /champions/777` (포지션 2개) | 200 | `positions` TOP 71.43% + MIDDLE 28.57%, 아이템 14개, 룬·스펠·스킬 상위 2개 |
| `GET /champions/157?patch=16.20` | 200 | 지정 패치 그대로 (`isFallback: false`), 동률 포지션은 이름 순 (MIDDLE, TOP) |
| `/champions/23?position=JUNGLE&patch=16.19` | 404 | `STATS_NOT_FOUND` |
| `/champions/99999` | 404 | `STATS_NOT_FOUND` |
| `/champions?position=TOP&patch=16.1` | 404 | `PATCH_NOT_FOUND`, `details.patch` |
| `/champions?position=top`, `/champions/abc` | 400 | `INVALID_PARAMETER`, `details.param/value` |
| `/nope` | 404 | `NOT_FOUND` |

`GET /meta` 응답 (그대로):

```json
{"latestPatch":"16.20","defaultPatch":"16.19","isFallback":true,
 "patches":[{"patch":"16.20","games":6},{"patch":"16.19","games":20}],
 "lastCollectedAt":"2026-10-14T10:13:04.404Z",
 "positions":["TOP","JUNGLE","MIDDLE","BOTTOM","UTILITY"],
 "rules":{"minTierPick":50,"secondaryPositionMinShare":10,"fallbackMinGames":5000}}
```

`GET /champions?position=TOP` (앞 2개만):

```json
{"patch":{"data":"16.19","latest":"16.20","requested":null,"isFallback":true,"games":20},
 "position":"TOP",
 "champions":[
  {"rank":1,"championId":157,"tier":null,"tierScore":53.226,"winRate":60,"pickRate":25,"banRate":25,
   "pick":5,"win":3,"ban":5,"positionShare":100,"mainPositions":["TOP"]},
  {"rank":2,"championId":164,"tier":null,"tierScore":51.985,"winRate":66.67,"pickRate":15,"banRate":0,
   "pick":3,"win":2,"ban":0,"positionShare":100,"mainPositions":["TOP"]}]}
```

`GET /champions/777` (줄임):

```json
{"patch":{"data":"16.19","latest":"16.20","requested":null,"isFallback":true,"games":20},
 "championId":777,"position":"TOP","isMainPosition":true,
 "positions":[{"position":"TOP","pick":5,"positionShare":71.43,"tier":null,"tierScore":51.674,"winRate":40,"pickRate":25},
              {"position":"MIDDLE","pick":2,"positionShare":28.57,"tier":null,"tierScore":50.17,"winRate":0,"pickRate":10}],
 "stats":{"tier":null,"tierScore":51.674,"winRate":40,"pickRate":25,"banRate":5,"pick":5,"win":2,"ban":1},
 "builds":{
  "items":[{"itemId":3006,"pick":5,"win":2,"winRate":40,"pickRate":100}, "… 14개"],
  "runes":[{"primaryStyle":8000,"primaryPerks":[8008,9101,9104,8299],"subStyle":8400,"subPerks":[8444,8451],
            "statPerks":{"offense":5005,"flex":5008,"defense":5001},"pick":2,"win":1,"winRate":50,"pickRate":40}, "…"],
  "spells":[{"spellIds":[3,4],"pick":3,"win":0,"winRate":0,"pickRate":60},{"spellIds":[4,14],"pick":2,"win":2,"winRate":100,"pickRate":40}],
  "skills":[{"skillOrder":"QWEQQRQEQER","pick":3,"win":1,"winRate":33.33,"pickRate":60},{"skillOrder":"QEEWQRQQQER","pick":1,"win":1,"winRate":100,"pickRate":20}]}}
```

### 4-6. 의존성 (`backend/package.json`)

| 패키지 | 버전 | 종류 | 계획서 8-1 |
|--------|------|------|------------|
| `express` | 5.3.0 | 실행 | ✅ |
| `pg` | 8.23.1 | 실행 | ✅ |
| `typescript` | 5.9.3 | 개발 | ✅ |
| `tsx` | 4.23.15 | 개발 | ✅ |
| `@types/node` | 24.19.2 | 개발 | ✅ |
| `@types/express` | 5.0.6 | 개발 | ✅ |
| `@types/pg` | 8.23.1 | 개발 | ✅ |
| `eslint` / `@eslint/js` | 9.39.5 | 개발 | ✅ |
| `typescript-eslint` | 8.71.2 | 개발 | ✅ |

- 계획서에 없는 패키지는 넣지 않았다. `npm audit`: 취약점 0.

---

## 5. 계획과 다른 점

> 요약: 동작에 영향이 있는 것은 1번(표본 건너뛰기 기준)뿐이다. 나머지는 작은 보충이다.

| # | 계획 | 구현 | 이유 |
|---|------|------|------|
| 1 | 3-3 "설정한 티어의 줄이 **있으면** ①을 건너뜀" | 그 티어 줄이 **`playersPerTier`명 이상**이면 건너뜀. 적으면 그 티어를 다시 뽑아 더함 (upsert) | 검증용 3명이 남아 있으면, 계획대로라면 전체 테스트 수집이 에메랄드를 3명으로만 진행한다. 지금 기준이면 에메랄드는 3 + 50 = 약 53명이 된다 (`--resample`처럼 더하기만 하고 삭제 없음, ②는 그 티어 모두 사용). |
| 2 | 건너뛰기 이유 5개 | `patch_full`(패치당 25,000게임 도달), `duplicate`(다른 실행이 먼저 저장)를 로그 집계에 추가 | 계획 3-4의 `maxGamesPerPatch`와 3-2 ⑤의 ROLLBACK 경우를 셀 이름이 필요했다. DB에는 영향 없음 |
| 3 | 종료 코드 0/1/2/130 | 잠금 실패에 **3**을 추가 | "다른 수집이 실행 중"을 실패(1)와 구별 |
| 4 | `collection_logs`는 "수집 실행 1회마다" | `run`, `sample`, `matches`만 기록. `aggregate`, `purge`는 기록하지 않음 | Riot을 부르지 않는 명령이 `done`을 남기면 `meta.lastCollectedAt`이 수집 시각이 아니게 된다 |
| 5 | 2-1 폴더 구조 | 파일 2개 추가: `src/collector/context.ts`(공통 실행 문맥, 중단 오류), `src/api/cache.ts`(캐시 헤더 1곳). 테스트 도우미 `test/helpers/` | 같은 코드를 여러 곳에 두지 않으려고 |
| 6 | 3-6 제한기 | 429·`Retry-After`에 더해, 응답 헤더 `X-App-Rate-Limit-Count`·`X-App-Rate-Limit`로 셈과 한도를 맞춤 | 새 실행은 직전 실행의 사용량을 모른다. 4-3에서 실제로 1회차 직후 재실행이 429 없이 119초를 기다렸다 |
| 7 | 9-1 fixture "puuid만 가짜 값" | puuid에 더해 `riotIdGameName`, `riotIdTagline`, `summonerName`, `summonerId`도 가짜 값 | 실제 사용자 식별 정보를 저장하지 않으려고 (메인 에이전트 지시) |
| 8 | 9-2 가짜 패치 `0.9`만 | `0.7`(purge 미리보기), `0.99`(완료 게임 0개)도 사용 | 각 경우를 따로 시험. 모두 ROLLBACK, 끝난 뒤 0줄 확인 |
| 9 | API 상세 `position`을 주면 | 그 포지션 줄이 없으면 404 `STATS_NOT_FOUND`에 `details.position` 포함, 챔피언 줄이 아예 없으면 `details.position` 없이 `{championId, patch}` | 계약 2-4 오류 표 두 줄을 그대로 구분 |

- `docs/contracts/api_contract.md`: **수정하지 않았다.** 구현이 계약과 일치해 바꿀 필요가 없었다.
- `docs/contracts/db_contract.*`, `db/`: 수정하지 않았다. DB 스키마 변경 없음.
- `.env.example`: `API_PORT=` (값 없음, 비우면 4000)와 설명 주석만 추가.

---

## 6. 계약 변경 요청

> 요약: 없음.

- DB 계약 v6의 테이블·함수·뷰만으로 구현했다.
- 계획서 11장의 참고 사항 그대로: 밴 짝 없음 등 경고는 `collection_logs`에 컬럼이 없어 stdout 요약에만 남긴다.

---

## 7. 남은 문제

> 요약: 가장 큰 것은 보관 패치 밖 게임 비율이 예상(1~2%)보다 훨씬 커서(57%) 전체 테스트 수집의 게임 수가 예상보다 적고 호출이 낭비될 수 있다는 점이다.

| # | 문제 | 영향 | 제안 |
|---|------|------|------|
| 1 | 보관 창 밖(`old_patch`) 게임이 60개 중 34개(57%). 계획 3-3은 1~2%로 봤다. 16.20이 막 나온 시점이고, 플레이어당 최근 20게임이 2개 패치보다 넓게 퍼져 있다 | 전체 테스트 수집(150명)이 예상 약 2,700게임보다 크게 적을 수 있다 (같은 비율이면 약 1,200게임). 거른 게임마다 상세 1회가 들고, 재실행 때마다 다시 부른다 | 결정 필요. (a) 그대로 둠 (b) ② 요청에 `startTime`(보관 패치 시작 시각)을 넣어 오래된 ID를 받지 않음. 패치 시작 시각을 어디서 정할지(설정값 또는 이미 저장한 게임의 `gameStartTimestamp`, DB에 없음)는 계약 영향 검토 필요. 이번엔 구현하지 않음 |
| 2 | 지금 최신 패치 16.20이 6게임뿐이라 API는 16.19로 대체(`isFallback: true`) 중 | 의도된 동작. 전체 수집 뒤에도 16.20이 5,000게임 미만이면 계속 16.19를 보여준다 | 없음 |
| 3 | 검증 데이터(에메랄드 3명, 26게임, 16.19·16.20 집계, `collection_logs` 3줄: id 8 done 26, id 9 done 0, id 10 key_expired. id 1~7은 통합 테스트가 쓴 시퀀스 값이라 줄 없음)가 DB에 남아 있다 | 지시대로 남김. 전체 수집 시 에메랄드 표본이 약 53명이 된다 (5장 1번) | 정확히 50명을 원하면 `!db`/사용자 승인 하에 정리 필요 (삭제는 이번 범위 밖) |
| 4 | Ctrl+C(SIGINT) 중단은 코드와 흐름만 만들고 실제로 눌러 보지는 않았다 | 낮음 | Review에서 `matches` 중 Ctrl+C로 `failed`('사용자 중단'), 130, 반쪽 게임 0 확인 |
| 5 | 연속 20개 게임 실패, DB 연결 끊김 중단은 실제로 일으켜 보지 않았다 (분류 함수와 흐름만) | 낮음 | Review에서 확인 |
| 6 | 실제 수집 데이터의 1번 참가자 값을 Riot 원본과 대조하는 것(계획 9-3 3번)은 fixture 게임으로만 했다 | 낮음 | Review 9-3 3번 |
| 7 | `collection_logs.players`는 ②에서 조회한 표본 수. `sample` 명령은 그 티어들의 표본 수를 기록 | 의미 차이 작음 | 없음 |

---

## 변경 01 (날짜: 2026-10-14): 최근 14일 기준 대응

> 작성: Build 에이전트 / 기준: `back_spec.md` "변경 01" (승인됨, D11~D17 추천안), `docs/contracts/api_contract.md` v2 (승인됨), `docs/contracts/db_contract.md` v7 (마이그레이션 001~015 적용됨)
> 요약: 수집기를 시각 창(`startTime`, `game_start_at`, `out_of_window`, 창 상한)으로 바꾸고, 수집 뒤 자동 집계를 없앴다. API는 `window` 객체·`isStale`·`/health` `stats`·요청당 스냅숏 1개로 바꿨다. 단위 76개, 통합 17개 통과. 실제 소량 수집 45게임, 집계 1회, API v2 확인까지 마쳤다.

### 01-1. 요약

> 요약: 검사·테스트·실제 확인 모두 통과. 실제 수집에서 `out_of_window`는 0%, 14일 안 게임이 없는 플레이어가 67%로 많았다 (01-8 남은 문제 1).

| 항목 | 결과 |
|------|------|
| `npm run typecheck` | 오류 0 |
| `npm run lint` | 오류 0 |
| `npm test` (단위) | **76개 통과** / 실패 0 (약 0.4초) |
| `npm run test:integration` (실제 Supabase, 모두 ROLLBACK) | **17개 통과** / 실패 0 (약 4.0초). 끝난 뒤 `KR_9000000%`·`0.8`·`0.9`·`TEST_%` 0줄 |
| `npm audit` | 취약점 0 |
| 금지어 `grep` (01-9) | `refresh_patch_stats`, `purge_old_patches`, `FROM patch`, `keepPatches`, `maxGamesPerPatch`, `patch_full`, `old_patch`, `isFallback`, `PATCH_NOT_FOUND`, `selectPatch`: `src`·`test`에 0건 (테스트의 "`keepPatches`가 없음" 검사 1줄만) |
| 실제 소량 수집 | 에메랄드 15명, **45게임** 저장(450줄), Riot 호출 120회 + 잘못된 키 1회, 429 0회, `out_of_window` 0개 |
| `aggregate` 1회 | `ANALYZE` 26ms + `refresh_window_stats(14)` 191ms, `games 45`, 16.20 36 / 16.19 9 |
| API | 4개 엔드포인트 v2 형식 일치, 집계 전 503·집계 후 200 모두 실제 DB로 확인 |
| 비밀값 검사 | `backend/` 전체, 수집·API 로그, `api_contract.md`에서 키·접속 문자열·비밀번호 값 0건 (`.env.example`의 기존 예시 주석에 공용 풀러 호스트 이름만 있음, 비밀값 아님, 변경 없음) |

### 01-2. 기능별 결과

> 요약: 계획 01-3 표의 파일을 모두 바꿨다. 새 파일 2개(`api/window.ts`, `db/snapshot.ts`), 지운 파일 1개(`api/patchSelection.ts`).

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 수집 설정 | `config/collection.ts`: `keepPatches`·`maxGamesPerPatch` 삭제, `windowDays 14`·`maxGamesPerWindow 25,000`·`keepDays 21` 추가, `test` 프리셋 100명(25/25/25/25), `windowStart(nowMs, days)` → `{ ms, sec }` | ✅ |
| API 설정 | `config/api.ts`: `FALLBACK_MIN_GAMES` 삭제, `STALE_AFTER_HOURS 26`, `WINDOW_DAYS 14` (수집 설정의 `windowDays`가 이 값을 씀) | ✅ |
| ② `startTime` | `riot/client.ts` `getMatchIds(…, { startTime })` → URL `&startTime={초}`. 10자리 정수가 아니면(ms, 소수) 호출 전에 `TypeError` (재시도 없이 실행 실패) | ✅ |
| 창 시작 고정 | `cli/collect.ts`가 잠금을 잡은 뒤 한 번 `windowStart(now, 14)`를 정해 `ctx.window`로 넘김. ②의 모든 플레이어와 ③ 거르기가 같은 값. 로그 `창 windowStart=… startTime=…`, `② 게임 ID 시작 path=…&startTime=1790779662` | ✅ |
| ③ 시작 시각 검사 | `transform.ts` `prefilterMatch`: 패치 검사 다음에 `gameStartTimestamp`가 없음·정수 아님·2020-01-01 이전 → `bad_format`, `< windowStartMs` → `out_of_window`. 통과하면 `{ patch, gameStartAt }`. `comparePatch`·`latestPatches` 삭제 | ✅ |
| ⑤ `game_start_at` | `rawRepository.insertMatch`: `INSERT … (match_id, puuid, patch, game_start_at) VALUES ($1, $2, $3, $4::timestamptz)` (`Date` 그대로) | ✅ |
| 창 상한 | `matches.ts`: 0 준비에서 `countMatchesSince(창 시작)`. 창 안 게임 + 이번 저장 수 ≥ 25,000이면 ③ 전에 멈춤 `stoppedBy: 'window_full'` (`collection_logs`는 `done`). 보관 패치 창·`patch_full` 삭제 | ✅ |
| 자동 집계 없음 | `run`은 ①~⑤만. 끝에 로그 "집계는 매일 05:00 KST DB 예약 작업이 한다. 바로 보려면 … aggregate (시험용)" | ✅ |
| 요약 로그 | `playersNoGames`(14일 안 게임 0개 플레이어), `inWindowBefore` 추가. 건너뜀 이유 `out_of_window` | ✅ |
| `aggregate` | `aggregate.ts` `aggregateWindow(db, { days, until?, statementTimeout })`: 같은 연결에서 `SET statement_timeout '5min'` → `ANALYZE matches, match_players` → `refresh_window_stats($1)` (`until`은 통합 테스트 전용) → `RESET`. `P0002`면 `{ ok: false, warning }`, CLI 종료 코드 1. `--patch` 삭제, 수집 잠금 안 잡음 | ✅ |
| `purge` | 미리보기(읽기만): 전체 게임 수, 21일보다 오래된 게임 수, 가장 오래된·최근 시작 시각. `--yes`면 수집 잠금 → `SELECT purge_old_games(21)`. **`--yes`는 실행하지 않음** | ✅ |
| 스냅숏 | `db/snapshot.ts` `readSnapshot(pool, fn)`: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` → `fn(client)` → `COMMIT` (예외면 `ROLLBACK`). BEGIN·ROLLBACK이 실패한 연결은 풀에 돌려주지 않고 버림 | ✅ |
| `ApiDb` | `api/app.ts`: `ApiDb = Queryable + snapshot(fn)`. `server.ts`는 풀로(`readSnapshot`), 테스트는 롤백 연결로(`fn(client)`) 만든다. `createApp(db, logger, { now })` (시계 주입) | ✅ |
| `window` 객체 | `api/window.ts`: `displayPatch`(메이저 + 10, 형식이 아니면 그대로 + 경고), `sharePercent`(소수 2자리), `isStale`(> 26시간), `statsState`, `windowDto`, `requireWindow`(없으면 503) | ✅ |
| `readWindow` | `statsRepository.ts`: `stats_window` 1줄 + `stats_window_patch`(`ORDER BY patch_sort_key(patch) DESC`, `json_agg`)를 한 문장으로. 스냅숏의 첫 문장 | ✅ |
| 통계 읽기 | `tierRows(db)`, `tierRowsForChampion(db, id)`, 상세 4개에서 `patch` 조건 삭제, `JOIN champion c ON champion_id·position` | ✅ |
| `/health` | 한 문장 `SELECT (SELECT aggregated_at FROM stats_window WHERE id = 1)`로 DB 확인 + `stats: { state: fresh/stale/empty, aggregatedAt }`. 항상 200, 실패하면 503 `DB_UNAVAILABLE` | ✅ |
| `/meta` | `window`, `lastCollectedAt`, `positions`, `rules{minTierPick, secondaryPositionMinShare, windowDays, staleAfterHours}`. 스냅숏 1개 | ✅ |
| `/champions`, 상세 | `patch` 쿼리 읽지 않음(무시). 응답 `patch` → `window`. 읽기는 스냅숏 안에서 차례로 (`Promise.all` 삭제). `STATS_NOT_FOUND` `details`는 `{championId}` 또는 `{championId, position}` | ✅ |
| 오류 코드 | `PATCH_NOT_FOUND` 삭제, `parsePatchParam` 삭제. `STATS_NOT_READY` 메시지 "아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다." | ✅ |
| 오래됨 경고 | `createStaleWarner`: 요청 처리 중 `isStale`을 보면 1시간에 1번 `warn 집계가 26시간 넘게 갱신되지 않음 aggregatedAt=…` | ✅ |
| `patchSelection.ts` | 삭제 (직전 패치 대체 규칙 없음) | ✅ |
| `.env.example` | 변경 없음 (새 환경 변수 없음) | ✅ |
| `api_contract.md` | 내용 변경 없음. 상태 줄을 `v2 승인됨 (구현 반영)`으로, 변경 기록에 1줄 추가 (계획 01-3 마지막 줄) | ✅ |

### 01-3. 테스트

> 요약: 패치 대체 테스트를 지우고, 시작 시각·`startTime`·창 상한·`window`·스냅숏·오래됨을 시험한다. 모든 테스트는 고정 시각을 쓴다.

| 파일 | 내용 | 상태 |
|------|------|------|
| `helpers/fixture.ts` | `OPTS.windowStartMs = 2026-09-30T00:00:00Z` 고정, `FIXTURE_START_MS` | ✅ |
| `helpers/db.ts` | `fakeGames(n, { patch, startMs, firstId })`: 시작 시각 `2021-01-10 + k분`, 변환 창 시작 `2021-01-01`, `FAKE_UNTIL = 2021-01-15` | ✅ |
| `unit/transform.test.ts` | fixture `game_start_at = 2026-10-06T05:19:50.514Z`(`1791263990514`), 시작 시각 없음·문자열·소수·`1577836799999` → `bad_format`, `1577836800000` 통과, 창 시작 − 1ms → `out_of_window`, 정확히 창 시작 통과, 패치 검사가 먼저 | ✅ |
| `unit/client.test.ts` | URL `…&startTime=1790816400`, ms·소수·9자리 → 호출 없이 던짐 | ✅ |
| `unit/rules.test.ts` | 100명 → 25×4, `windowDays 14`·`maxGamesPerWindow 25000`·`keepDays 21`, `keepPatches`·`maxGamesPerPatch` 없음, `windowStart(2026-10-15T01:00:00Z, 14).sec = 1790816400`, ms 끝 3자리 버림. patchSelection 6개·`parsePatchParam` 테스트 삭제 | ✅ |
| `unit/matches.test.ts` (새) | 가짜 riot·가짜 풀: 창 안 24,999 + 1개 저장 → `window_full`, `getMatch` 1번만. 25,000이면 ③ 0번. `startTime`이 창 시작(초), 집계·`ANALYZE`·`purge` SQL 없음, INSERT에 `game_start_at`. 창 밖 → `out_of_window`, 타임라인 0번 | ✅ |
| `unit/window.test.ts` (새) | `16.20→26.20`, `16.9→26.9`, `15.24→25.24`, `0.9→10.9`, 형식 오류 경고. `share` 39.98/60.02. 26시간 `false`, +1ms `true`, `fresh/stale/empty`. 계약 2-0 예시와 같은 `windowDto`. 경고 1시간 1번 | ✅ |
| `unit/app.test.ts` | 가짜 `ApiDb`: `stats_window` 없음 → 3개 503 + `no-store` + 메시지, `/health` `empty`. `?patch=` 무시(400 아님). 통계 엔드포인트마다 `snapshot` 정확히 1번, 쿼리가 모두 그 안, 첫 쿼리 `stats_window`. `/health`는 스냅숏 없이 한 문장. `/meta` 키·`rules`, 404 `details`에 `patch` 없음. v1 오류 테스트 유지 | ✅ |
| `integration/repository.test.ts` | 저장 → `game_start_at` = 넣은 시각, 10줄, duplicate. `countMatchesSince`. 2021년 3게임 → `aggregateWindow(until 2021-01-15)` → `games 3`, `patches [{0.9, 3}]`, `stats_window` 1줄(창 2021-01-01~15), `statement_timeout` 원래대로. `until 2020-06-01` → `ok:false`(P0002), SAVEPOINT로 되살린 뒤 `stats_window` 호출 전과 같음. purge 미리보기가 2021년 게임을 지울 대상으로 셈 (`purge_old_games`는 실행 안 함). 실제 풀 `readSnapshot`: `repeatable read`·`on`, 쓰기는 25006으로 거부, 실패 뒤 연결 재사용 정상 | ✅ |
| `integration/api.test.ts` | 2021년 60게임(`0.8` 24, `0.9` 36) → 창 집계 → `createApp(롤백 ApiDb, 고정 시계 = 집계 시각 + 1시간)`. `/health` `fresh`, `/meta` `window` = `[{0.9, 10.9, 36, 60}, {0.8, 10.8, 24, 40}]`, 목록·상세 값, `?patch=16.19` 응답 같음, 404 2종. SAVEPOINT 안에서 `aggregated_at = now() − 27h` → `isStale true`, `/health` `stale` → 되돌림 | ✅ |

### 01-4. 사용자가 실행하는 명령

> 요약: 모두 `backend/`에서 실행한다. 수집은 집계하지 않는다. 화면 숫자는 매일 05:00 KST에 바뀐다 (바로 보려면 `aggregate`).

```bash
cd backend

# API 서버
npm start            # http://localhost:4000/api/v1/health  (npm run dev 는 watch 모드)

# 테스트 수집 (플래티넘·에메랄드·다이아 티어당 100명, 최근 14일 게임). 약 1.6~2시간 예상 (01-8 남은 문제 1 참고)
npm run collect -- run --preset test 2>&1 | tee collect.log

# 키 만료(로그 "Riot 키 만료(401/403)", 종료 코드 2) 뒤 이어서 모으기
#   1) https://developer.riotgames.com 에서 키 재발급 → 루트 .env 의 RIOT_API_KEY 교체
#   2) 같은 명령을 다시 실행 (저장한 게임은 건너뜀, 표본도 이미 있으면 건너뜀)
npm run collect -- run --preset test

# 바로 집계해서 보기 (시험용. 평소에는 매일 05:00 KST DB 예약 작업이 같은 순서로 집계)
npm run collect -- aggregate        # ANALYZE → refresh_window_stats(14). 창 안 게임 0개면 종료 코드 1, 기존 집계 유지

# 오래된 원본 정리
npm run collect -- purge            # 미리보기만 (21일보다 오래된 게임 수)
npm run collect -- purge --yes      # purge_old_games(21) 실제 삭제. 되돌릴 수 없음, 사용자 확인 뒤에만
```

| 그 밖의 명령 | 하는 일 |
|------|---------|
| `npm run collect -- sample --preset test [--resample] [--seed N]` | 표본만 |
| `npm run collect -- matches --preset test` | 저장된 표본으로 게임만 (`run`과 같이 집계 없음) |
| 공통 옵션 | `--max-matches N`, `--players-per-tier N`, `--games-per-player N`, `--tiers EMERALD,DIAMOND`, `--seed N` (`--patch`는 삭제) |

- 종료 코드: 0 정상, 1 실패(`aggregate`의 P0002 포함), 2 키 만료, 3 다른 수집이 실행 중, 130 사용자 중단.
- 지금 DB의 에메랄드 표본은 15명이다 (01-5). `--preset test`는 100명보다 적으면 그 티어를 다시 뽑아 더하므로 에메랄드는 약 115명이 된다 (D16 A와 같은 방식, 삭제 없음).

### 01-5. 실제 소량 수집 검증 (실제 Riot API + Supabase)

> 요약: 2회 수집해 45게임을 저장했다. 모든 게임이 창 안이고, `startTime`이 10자리 초로 나갔고, 수집은 집계를 부르지 않았다. 집계 전 503과 집계 후 200을 실제 DB에서 모두 확인했다.

#### 수집

| 단계 | 명령 / 확인 | 결과 |
|------|-------------|------|
| 집계 전 API | `npm start` 후 `/health`, `/meta`, `/champions?position=TOP`, `/champions/23`, `?patch=16.19` | `/health` 200 `stats {state: "empty", aggregatedAt: null}`. 나머지 4개 **503 `STATS_NOT_READY`** + `no-store` + 계약 메시지 (실제 `readSnapshot` 경로) |
| 1회차 | `run --preset test --tiers EMERALD --players-per-tier 4 --max-matches 30` | 표본 3 → 7명(디비전당 1명, 4회). `startTime=1790779662`(10자리 초, `windowStart=2026-09-30T14:47:42.756Z`). 7명 중 **5명이 14일 안 게임 0개**, ID 15개 → **15게임 저장**. Riot 41회, 10초, `done` |
| 2회차 | `--players-per-tier 8`로 다시 (30게임 근처를 채우려고, 01-6 1번) | 표본 15명. `inWindow=15`(창 안 기존 게임). ID 45개 중 **15개는 이미 저장돼 건너뜀**, 30게임 저장. Riot 79회, 124초 (2분 창 98회를 지키려 제한기가 105초 대기), 429 0회, `done` |
| DB | `matches` 45, `match_players` 450, 10줄이 아닌 게임 0 | 모든 `game_start_at`이 `[실행 시작 − 14일, 실행 시작)` 안 (가장 이른 2026-10-01T05:16Z, 가장 늦은 2026-10-14T08:34Z). 패치 16.20 36 / 16.19 9. `stats_window` 0줄 그대로 (**집계 호출 없음**) |
| `out_of_window` | 요약 로그 `skipped` | **0 / 45 (0%)**. `bad_format`·`too_short` 등도 0. v1의 `old_patch` 57%와 비교해 상세 호출 낭비가 없어졌다 |
| `aggregate` | `npm run collect -- aggregate` | 0.29초 (`ANALYZE` 26ms, 집계 191ms). `{"days":14,"games":45,"patches":[{"games":36,"patch":"16.20"},{"games":9,"patch":"16.19"}],"champion_rows":197,"item_rows":1671,"rune_rows":372,"spell_rows":254,"skill_rows":290}` |
| `purge` 미리보기 | `npm run collect -- purge` | `totalGames=45 removeGames=0`, 종료 코드 0 (`--yes` 실행 안 함) |
| 잘못된 키 | `RIOT_API_KEY=invalid npm run collect -- matches --preset test --tiers EMERALD --max-matches 5` | Riot 1회(401) 뒤 바로 멈춤, 종료 코드 **2**, `collection_logs` id 17 `key_expired` "Riot 키 만료 (HTTP 401)", `matches` 45 그대로 (반쪽 게임 없음) |

- Riot 호출 합계: 41 + 79 + 1 = **121회**, 429 0회. 표본 puuid는 로그에 앞 8자만 나온다.
- 남긴 실제 데이터: 에메랄드 표본 15명, 45게임, 실제 스냅숏 1개(`stats_window`, 다음 05:00 KST 예약 작업이 다시 만듦), `collection_logs` id 15·16 `done`, 17 `key_expired`. 지시대로 지우지 않았다.

#### API (실제 데이터, 응답 일부)

```text
GET /health → 200 no-store
{"status":"ok","db":"ok","stats":{"state":"fresh","aggregatedAt":"2026-10-14T14:50:32.893Z"}}

GET /meta → 200 public, max-age=600, application/json; charset=utf-8
{"window":{"days":14,"start":"2026-09-30T14:50:32.893Z","end":"2026-10-14T14:50:32.893Z","games":45,
  "aggregatedAt":"2026-10-14T14:50:32.893Z","isStale":false,
  "patches":[{"patch":"16.20","displayName":"26.20","games":36,"share":80},
             {"patch":"16.19","displayName":"26.19","games":9,"share":20}]},
 "lastCollectedAt":"2026-10-14T14:50:10.518Z","positions":["TOP","JUNGLE","MIDDLE","BOTTOM","UTILITY"],
 "rules":{"minTierPick":50,"secondaryPositionMinShare":10,"windowDays":14,"staleAfterHours":26}}

GET /champions?position=TOP → 200, 44개, 모두 tier null (표본 부족, 정상)
{"rank":1,"championId":39,"tier":null,"tierScore":52.856,"winRate":100,"pickRate":6.67,"banRate":24.44,
 "pick":3,"win":3,"ban":11,"positionShare":75,"mainPositions":["TOP","MIDDLE"]}

GET /champions/39 → 200 (position 생략 → TOP, isMainPosition true)
positions: TOP pick 3 (75%), MIDDLE pick 1 (25%) / items 11개 pick 내림차순 / runes 2 / spells [4,14] 2·[3,4] 1 / skills 2
```

| 확인 | 결과 |
|------|------|
| `window.start`/`end` | `end − start` = 14일, `end = aggregatedAt` (DB `now()`) |
| `patches[]` | 최신 먼저, `displayName` = 메이저 + 10, `share` 합 100 |
| `isStale` | `false`, `/health` `fresh` |
| 정렬·규칙 | `rank` 1부터 연속, `tier NULLS LAST → tierScore DESC → championId` 순, 목록 챔피언은 모두 `mainPositions`에 그 포지션 포함. 포지션별 TOP 44, JUNGLE 44, MIDDLE 36, BOTTOM 26, UTILITY 40 |
| 옛 `patch` 쿼리 | `/champions/39?patch=16.19` 200 (무시) |
| 오류 | `?position=JUNGLE` → 404 `STATS_NOT_FOUND` `{championId:39, position:"JUNGLE"}` / `/champions/99999` → 404 `{championId:99999}` / `position=top`, 없음, `MID`, `Aatrox`, `023` → 400 `INVALID_PARAMETER` + `details` / `/nope` → 404 `NOT_FOUND`. 모두 `no-store` |
| 동시 요청 | `/champions/39` 20개 동시 → 모두 200, 뒤이은 `/meta` 200 (풀 `max 5`에서 연결 반환 정상) |
| 서버 로그 | 요청 58개, `WARN`·`ERROR` 0 |

### 01-6. 계획과 다른 점

> 요약: 동작에 영향이 있는 것은 없다. 실제 수집을 2회 했고, 시계 주입·SAVEPOINT 같은 시험용 보충이 있다.

| # | 계획 | 구현 | 이유 |
|---|------|------|------|
| 1 | 01-8: 에메랄드 4명, 약 30게임 1회 | `--players-per-tier 4`로 15게임, `8`로 다시 30게임 → 모두 15명·45게임 | 4명 기준 7명 중 5명이 14일 안 게임이 없어 15게임뿐이었다. 2회차는 "같은 명령 다시 → 저장한 게임 건너뜀"(01-8 3번) 확인도 겸했다 |
| 2 | 01-3: `server.ts`가 1시간에 1번 경고 | 경고는 `api/window.ts` `createStaleWarner`, `createApp`이 만들어 라우트가 부름. `server.ts`는 `ApiDb`만 만듦 | 01-6-3 "요청 처리 중 `isStale`을 보면" 규칙을 라우트 안에서 지키고 단위 테스트하기 쉽게 |
| 3 | `createApp(db: ApiDb)` | `createApp(db, logger, { now })` | `isStale`을 고정 시계로 시험 (통합 테스트는 집계 시각 + 1시간) |
| 4 | 01-7-3 0게임 `ok:false` 확인 | `SAVEPOINT` → `aggregateWindow` → `ROLLBACK TO SAVEPOINT` 뒤 `stats_window` 비교 | P0002가 트랜잭션을 멈추므로 되살려야 다시 읽을 수 있다 |
| 5 | 집계 전 503 (01-7-2 단위, 01-8은 언급 없음) | 단위(가짜 `ApiDb`) + **실제 DB에서 첫 집계 전에 확인**. 통합 테스트에서 `stats_window`를 직접 지우는 시험은 만들지 않음 | 지금 실제 `stats_window`가 비어 있어 실제로 확인할 수 있었다. 롤백되더라도 `DELETE` 문을 쓰지 않으려고 |
| 6 | `purge` | 미리보기는 잠금 없이 읽기만, `--yes`만 수집 잠금 | 01-4-5 표대로. 수집 중에도 미리보기를 볼 수 있다 |
| 7 | 미리보기 항목 | `newestRemoveStartAt`(지울 게임 중 가장 최근 시작) 추가 | 지울 범위 확인용 |
| 8 | `windowDays: 14` | `config/api.ts` `WINDOW_DAYS`를 수집 설정과 `meta.rules`가 함께 씀 | 같은 값을 두 곳에 두지 않으려고 |
| 9 | 통합 테스트 | `countMatchesSince` 시험, 스냅숏에서 쓰기 거부(25006)·실패 뒤 연결 재사용 시험 추가 | 창 상한 SQL과 `readSnapshot`의 ROLLBACK 경로 확인 |

- `docs/contracts/api_contract.md`: 상태 줄과 변경 기록 1줄만 고쳤다 (계획 01-3 마지막 줄 지시). 엔드포인트·필드·오류 내용은 그대로다.
- `docs/contracts/db_contract.*`, `db/`: 수정하지 않았다. `.env.example`: 변경 없음.

### 01-7. 계약 변경 요청

> 요약: 없음. v7의 `stats_window`, `stats_window_patch`, `champion_tier_view`, `refresh_window_stats`, `purge_old_games`, `patch_sort_key`만으로 구현했다.

### 01-8. 남은 문제

> 요약: 가장 큰 것은 14일 안 게임이 없는 표본 플레이어가 많아(67%) 300명 테스트 수집의 게임 수가 계획 예상보다 크게 적을 수 있다는 점이다.

| # | 문제 | 영향 | 제안 |
|---|------|------|------|
| 1 | 에메랄드 표본 15명 중 **10명(67%)이 14일 안 솔로랭크 게임 0개**, 플레이어당 평균 3게임 (계획 01-4-4는 8~10게임) | 300명 테스트 수집이 예상 2,200~2,700게임보다 적을 수 있다 (같은 비율이면 약 900~1,000게임). 호출·시간은 그만큼 줄어든다 | 결정 필요 (메인 에이전트·사용자). (a) 그대로 수집하고 실제 수를 본다 (b) 티어당 인원을 늘린다 (c) league-v4 page 1 대신 최근 활동이 많은 사람을 고르는 방법 검토. 15명은 표본이 작아 비율이 크게 흔들릴 수 있다 |
| 2 | 실제 스냅숏(45게임)이 생겼다. 예약 작업 `tiergg_daily_refresh`가 처음으로 성공해야 한다 (지금까지는 0게임이라 P0002 `failed`) | 다음 05:00 KST(2026-10-14T20:00Z) 실행 결과를 아직 보지 못했다 | Review 01-8 8번: 그 시각 뒤 `cron.job_run_details` `succeeded` 확인 |
| 3 | 수집의 창 시작은 로컬 시계, 집계 창은 DB `now()`. 이번에 DB 시계가 로컬보다 약 2초 앞섰다 (`window_end` 14:50:32.89, 로컬 로그 14:50:31.0) | 창 경계의 몇 초 차이라 영향 거의 없음. `isStale` 26시간 판단에도 영향 없음 | 없음 (기록만) |
| 4 | Ctrl+C, 연속 20개 실패, DB 끊김 중단은 이번에도 실제로 일으켜 보지 않았다 (v1 남은 문제 4·5, 코드 변경 없음) | 낮음 | Review 01-8 |
| 5 | 실제 수집 게임의 참가자 값을 Riot 원본과 대조(01-8 2번)는 하지 않았다. fixture 게임으로만 확인 | 낮음 | Review 01-8 2번 |
| 6 | 에메랄드 표본이 15명이라 `--preset test`를 실행하면 약 115명이 된다 (D16 A는 103명 가정) | 에메랄드 비중이 조금 커짐 (약 37%) | 정확히 100명이 필요하면 D16 B(삭제, 사용자 승인) |

---

## Review 반영 (2026-10-15)

> 작성: Review 에이전트 / 근거: `backend/docs/back_review.md` (판정 PASS with issues)
> 요약: Review가 실제로 재현한 결함 1개(M1)를 고쳤다. 계획·계약 규칙은 바꾸지 않았다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| DB 연결 끊김 중단 (계획 3-5) | **문제:** 수집 잠금 연결(실행 내내 빌려 둔 연결)에 오류 리스너가 없어, 연결이 끊기면 `Unhandled 'error' event`로 프로세스가 바로 죽었다 (`collection_logs`는 `running`으로 남음). **수정:** `src/collector/runLog.ts` `CollectorLock.acquire(pool, onLost?)`가 그 연결에 `'error'` 리스너를 붙여 `lost`로 표시하고 `onLost`를 1번 부름, 잃은 잠금의 `release()`는 unlock 없이 연결을 버림. `src/cli/collect.ts`는 `onLost`에서 오류 로그 + 지금 게임 뒤 멈춤, `failed` "DB 연결 끊김 (수집 잠금 연결)", 종료 코드 1 | ✅ |
| 테스트 | `test/unit/runLog.test.ts` 새로 4개 (끊김에 죽지 않음·`onLost` 1번, 잃은 잠금 release, 정상 release, 잠금 실패). 단위 76 → **80개** 통과, 통합 17개 통과, typecheck·lint 0 | ✅ |
| 실제 확인 | `matches --tiers EMERALD` 실행 중 잠금 연결을 `pg_terminate_backend`로 끊음 → Riot 2회, 종료 코드 1, `collection_logs` id 22 `failed`, `running` 0줄, 원본 45 / 450 그대로 | ✅ |

- 위 "변경 01 / 01-8 남은 문제" 4번(Ctrl+C, DB 끊김)과 5번(Riot 원본 대조)은 Review가 실제로 확인했다 (Ctrl+C 종료 코드 130 `failed` "사용자 중단", 3게임 720개 값 일치). 연속 20개 실패는 코드로만 확인했다.
- 남은 문제 1(14일 안 게임이 없는 표본)은 Review 7장에 추정과 추천(티어당 250명)을 적었다. 설정은 바꾸지 않았다 (사용자 결정).
- 남은 문제 2(예약 작업 첫 실행)는 아직 실행 시각(2026-10-14T20:00Z) 전이라 확인하지 못했다.
