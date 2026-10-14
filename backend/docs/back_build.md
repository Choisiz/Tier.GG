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
