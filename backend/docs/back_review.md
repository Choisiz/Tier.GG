# 백엔드 검토 기록 — 변경 01 (최근 14일 기준) 검토

> 검토일: 2026-10-15 (KST, 실제 확인 시각 2026-10-14 14:55~15:06 UTC)
> 기준: `CLAUDE.md` 백엔드 작업 흐름, `backend/docs/back_spec.md`, `docs/contracts/api_contract.md` v2, `docs/contracts/db_contract.md`·`.dbml` v7
> 방법: Build 기록을 믿지 않고 코드를 읽고, 검사를 다시 돌리고, 실제 Supabase와 Riot API로 다시 확인했다. v1(패치 기준) 코드는 따로 검토하지 않았고, 이번에 처음 함께 본 v1 공통 부분(제한기, 잠금, 오류 처리)은 아래에 들어 있다.
> 이 문서는 **가장 최근 검토만** 둔다. 해결되지 않은 문제는 `back_overview.md` "해결되지 않은 점"에 있다.
> 상태 표기: ✅ 통과 / ⚠️ 문제 있음 / ❌ 실패 / ⏸️ 확인 못 함

## 목차

- [1. 결론](#1-결론)
- [2. 검사 명령](#2-검사-명령)
- [3. 확인 목록](#3-확인-목록)
  - [3-1. DB 저장 규칙](#3-1-db-저장-규칙)
  - [3-2. Riot 원본 대조](#3-2-riot-원본-대조)
  - [3-3. API 계약 v2](#3-3-api-계약-v2)
  - [3-4. 한 요청 한 스냅숏](#3-4-한-요청-한-스냅숏)
  - [3-5. 수집기](#3-5-수집기)
  - [3-6. 예약 작업](#3-6-예약-작업)
- [4. 문제](#4-문제)
- [5. Review가 고친 것](#5-review가-고친-것)
- [6. 테스트 수집 인원 평가](#6-테스트-수집-인원-평가)
- [7. 코드 품질 메모](#7-코드-품질-메모)
- [8. 다음에 할 일](#8-다음에-할-일)

---

## 1. 결론

> 요약: **PASS with issues.** 계약과 완료 기준은 모두 맞는다. 실제로 재현한 결함 1개(수집 잠금 연결이 끊기면 프로세스가 바로 죽음)는 고쳤다. 사용자 결정 1개(테스트 수집 인원)는 이후 티어당 250명으로 정해 실행했다.

| 구분 | 결과 |
|------|------|
| 판정 | **PASS with issues** |
| High | 0 |
| Medium | 2 (M1 고침, M2 사용자 결정 → 250명으로 실행함) |
| Low | 8 (권장 조치만, 고치지 않음) |
| 고친 코드 | `src/collector/runLog.ts`, `src/cli/collect.ts`, 새 테스트 `test/unit/runLog.test.ts` (5장) |
| Riot 호출 (Review 전체) | **10회** (다시 받기 6, 잘못된 키 1, Ctrl+C 1, 연결 끊김 2). 429 0회 |
| 남긴 DB 변화 | `collection_logs` 줄 추가(id 20 `key_expired`, 21·22 `failed`), 실제 스냅숏 1번 다시 만듦(아래). 원본 `matches` 45 / `match_players` 450 그대로 |

- 검토 중 사고: 잠금 시험 명령 안에 실수로 `aggregate`가 들어가 실제 스냅숏을 1번 다시 만들었다 (2026-10-14T15:01Z). 같은 원본으로 다시 센 것이라 숫자가 모두 같고 `aggregated_at`·창 시각만 바뀌었다. 영향 없음. 그때 다른 연결이 수집 잠금을 잡고 있었는데 `aggregate`가 막히지 않아 "aggregate는 수집 잠금을 잡지 않음" 규칙이 맞다는 것도 확인됐다.

---

## 2. 검사 명령

> 요약: 타입 검사, 린트, 단위·통합 테스트, 취약점 검사 모두 통과. 통합 테스트 뒤 테스트 데이터는 0줄이다.

| 명령 | 결과 |
|------|------|
| `npm run typecheck` | 오류 0 (수정 전·후) |
| `npm run lint` | 오류 0 (수정 전·후) |
| `npm test` | 수정 전 76개, 수정 후 **80개** 통과 (새 `runLog.test.ts` 4개), 실패 0 |
| `npm run test:integration` | **17개** 통과, 실패 0 (약 3.6초). 수정 뒤에도 17개 통과 |
| `npm audit` | 취약점 0 |
| 통합 테스트 뒤 정리 | `KR_9000000%` 0, `TEST\_%` 0, 패치 `0.8`·`0.9` 0. 실제 데이터 개수 실행 전과 같음 |
| 패치 기준 이름 `grep` | `refresh_patch_stats`, `purge_old_patches`, `FROM patch`, `keepPatches`, `maxGamesPerPatch`, `patch_full`, `old_patch`, `isFallback`, `PATCH_NOT_FOUND`, `selectPatch`, `parsePatchParam`, `patchSelection`, `FALLBACK_MIN_GAMES`: `src`·`test`에 0건 (`rules.test.ts`의 "`keepPatches`가 없음" 확인 1줄만) |
| 비밀값 `grep` | 실제 `RIOT_API_KEY`·DB 비밀번호·접속 문자열 값이 `backend/`, `docs/`, `.env.example`, Review 로그에 0건. `RGAPI-0000…`, `RGAPI-1111…`은 테스트용 가짜 값 |
| `.env.example` | 변경 없음 |

---

## 3. 확인 목록

> 요약: 확인 항목별 근거와 수치다. 실제로 해 본 것과 코드만 본 것을 나눠 적었다.

### 3-1. DB 저장 규칙

| 항목 | 결과 | 근거 |
|------|------|------|
| 게임당 정확히 10줄 | ✅ | 45게임 중 10줄이 아닌 게임 0 |
| `game_start_at` | ✅ | 가장 이른 2026-10-01T05:16Z, 가장 늦은 2026-10-14T08:34Z. 창 시작보다 이른 게임 0 |
| 패치·ID 형식 | ✅ | 16.20 36 / 16.19 9. 형식 위반 0 |
| `matches.puuid` | ✅ | NULL 0, 모두 `ranked_players`에 있고 그 게임의 실제 참가자 |
| `team_position` | ✅ | 5개 포지션 각 90줄, NULL 0 (`""` 변환은 단위 테스트) |
| 밴 `-1` → NULL | ✅ | NULL 15줄, 0 이하 값 0. Riot 원본 `-1` 개수와 같음 |
| `skill_order` | ✅ | NULL 0, `^[QWER]*$` 위반 0, 길이 7~20, 11자 미만 46줄 (집계 함수가 거름) |
| 아이템·스펠 | ✅ | 음수·NULL 0, `item6` 저장 안 함, `summoner1_id = summoner2_id` 0 |
| 표본 | ✅ | 에메랄드 15명 (I 4, II 4, III 4, IV 3). 프리셋 100명 → 25×4는 단위 테스트 |

### 3-2. Riot 원본 대조

> 요약: 저장된 3게임을 Riot에서 다시 받아(호출 6회), 백엔드 변환 코드를 쓰지 않고 계약 6·7장대로 따로 계산해 DB와 비교했다. **30명 × 24컬럼 = 720개 값이 모두 같다.**

| 게임 | 패치 | 고른 이유 | `game_start_at` | 원본 `-1` 밴 | `EVOLVE` | 다른 값 |
|------|------|-----------|-----------------|--------------|----------|---------|
| `KR_8415426442` | 16.20 | 밴 NULL 2개 | ms까지 같음 | 2 | 0 | 0 |
| `KR_8402069772` | 16.19 | 이전 패치, 카이사 | ms까지 같음 | 1 | 3 (빠짐) | 0 |
| `KR_8418903090` | 16.20 | 최근 게임 | ms까지 같음 | 0 | 1 (빠짐) | 0 |

- 비교 컬럼: `champion_id`, `team_position`, `win`, `ban_champion_id`, `summoner1_id/2_id`, 룬 11개, `item0~5`, `skill_order`.
- puuid는 문서·로그에 쓰지 않았다 (스크립트 출력도 앞 8자만).

### 3-3. API 계약 v2

> 요약: 실제 DB로 `npm start` 후 4개 엔드포인트를 모두 불렀다. 목록 5개와 상세 142개(창의 모든 챔피언)를 DB 값으로 따로 계산해 **8,929개 검사가 모두 통과**했다.

| 항목 | 결과 | 근거 |
|------|------|------|
| `/health` | ✅ | 200 `no-store`, `stats.state fresh`. DB를 못 쓰면 503 `DB_UNAVAILABLE` |
| `/meta` | ✅ | 200 `public, max-age=600`. `window`, `lastCollectedAt`, `positions`, `rules{50, 10, 14, 26}`. 옛 필드 없음 |
| `window` 객체 | ✅ | `end − start` = 정확히 14일, `games` = 패치 합계, `patches` 최신 먼저, `displayName` 26.20·26.19, `share` 80 / 20 |
| 목록 | ✅ | 필드 12개 순서·이름 일치, `rank` 연속, 정렬 `tier NULLS LAST → tierScore DESC → championId`, 비율·`tierScore`(계약 9-3 공식, 0.0006 안)·`mainPositions` 따로 계산과 같음, 50판 미만 `tier: null` |
| 상세 | ✅ | 142개 모두 200. 기본 포지션 = 1순위 주 포지션, 아이템 전체·순서, 룬·스펠·스킬 2개 이하, 스펠 `[작은, 큰]`. 주 포지션이 아닌 포지션 → 200 `isMainPosition false` |
| 옛 `patch` 쿼리 | ✅ | `?patch=16.19`·`16.1`·`garbage` → 200, 응답이 바이트까지 같음 |
| 오류 | ✅ | `position` 없음·`top`·`MID`·반복·빈 값, `championId` `abc`·`023`·`0`·`100000`, 잘못된 % 인코딩 → 400 + `details`. `99999` → 404 `{championId}`, `39?position=JUNGLE` → 404 `{championId, position}`. 없는 경로·POST·DELETE → 404 `NOT_FOUND`. 모두 `no-store`, `details`에 `patch` 없음 |
| 헤더 | ✅ | ETag·CORS·`x-powered-by` 없음 |
| 서버 로그 | ✅ | 요청 475개, `WARN`·`ERROR` 0. DB 접속 실패 로그의 호스트는 `***` |
| 집계 전 503 | ✅ (코드·단위) | 실제 스냅숏이 이미 있어 다시 볼 수 없었다. 단위 테스트와 Build의 실제 확인, `requireWindow`가 모든 통계 엔드포인트의 첫 문장임을 확인 |
| 오래됨 | ✅ (통합) | `aggregated_at = now() − 27h` → `isStale true`, `/health stale`. 26시간 경계는 단위 테스트 |

### 3-4. 한 요청 한 스냅숏

> 요약: 상세 요청 150개를 동시에 보내며 `pg_stat_activity`를 262번 읽었다. 모든 통계 문장이 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` 트랜잭션 안에서 나갔고 쓰기가 없었다.

- 관찰된 순서: `BEGIN …` → `stats_window` → `champion_tier_view` → `champion_item` → `champion_rune` → `champion_spell` → `champion_skill` → `COMMIT`. 모두 `in_xact=true`, `backend_xid IS NULL`.
- 통합 테스트도 실제 풀의 `readSnapshot`에서 `repeatable read`, `read_only on`, 쓰기 25006 거부를 확인한다.

### 3-5. 수집기

| 항목 | 결과 | 근거 |
|------|------|------|
| `startTime` 초 | ✅ (실제) | 로그 `startTime` = `floor(창 시작 ms / 1000)`, 10자리. 요청 경로 `queue=420&start=0&count=20&startTime=…`. ms·소수·9자리는 호출 전에 던짐(단위) |
| 창 시작 고정 | ✅ (코드) | 잠금 뒤 한 번 정해 `ctx.window`로 ②·③이 같은 값 |
| `out_of_window` | ✅ (단위·실제) | 창 시작 − 1ms → `out_of_window`, 타임라인 0번. 실제 45게임 중 0개 |
| 자동 집계 없음 | ✅ (코드·단위) | `run`·`matches`에 집계 SQL 없음 (단위 테스트가 SQL 목록 확인) |
| 창 상한 | ✅ (단위) | 24,999 + 1 저장 → `window_full`, `getMatch` 1번 |
| `aggregate` | ✅ (실제) | 같은 연결 `SET statement_timeout` → `ANALYZE` 88ms → `refresh_window_stats(14)` 337ms → `RESET`. P0002 → 종료 코드 1은 통합 테스트와 코드 |
| `purge` 미리보기 | ✅ (실제) | `totalGames=45 removeGames=0`, 종료 코드 0. **`--yes`는 실행하지 않았다** |
| 키 만료 | ✅ (실제) | 프로세스 환경에만 `RIOT_API_KEY=invalid` (`.env` 수정 없음). Riot 1회 401 → 즉시 멈춤, **종료 코드 2**, `key_expired`, `finished_at`, 원본 그대로 |
| 잠금 | ✅ (실제) | 다른 연결이 잠금을 잡은 동안 → "다른 수집이 실행 중", **종료 코드 3**, 기록 없음 |
| Ctrl+C | ✅ (실제) | 진행 중 호출 1개를 마치고 멈춤, **종료 코드 130**, `failed` "사용자 중단", 반쪽 게임 없음. 게임 트랜잭션 중에는 `stop` 검사가 게임 사이에만 있어 끝까지 간다(코드) |
| DB 접속 불가 (시작 때) | ✅ (실제) | 종료 코드 1, 호스트 `***` |
| DB 연결 끊김 (실행 중) | ⚠️ → ✅ 고침 | 수정 전: 잠금 연결을 끊자 `Unhandled 'error' event`로 프로세스가 죽음 (M1). 수정 후: **종료 코드 1**, `failed` "DB 연결 끊김 (수집 잠금 연결)", `running` 남지 않음, 잠금 풀림 |
| 게임 연속 20개 실패 | ✅ (코드) | 재시도 실패·404·400·DB 22xxx/23xxx만 건너뜀, 연속 20이면 `failed`, 1. 실제로 일으키지 않음 |
| 이어서 모으기 | ✅ (코드·Build) | ② DB 중복 제거 + `ON CONFLICT DO NOTHING`. Build 2회차에 15개 건너뜀 기록 |
| 제한기 | ✅ (단위·Build) | 19/98, 429 `Retry-After` 5번, 5xx 1·2·4초 3번, 헤더 맞춤. 429는 일부러 일으키지 않았다 |
| 분리 | ✅ | `server.ts`·`src/api`가 `collector`·`riot`·`loadRiotEnv`를 import하지 않음 |

### 3-6. 예약 작업

> 요약: 검토 시점에는 첫 실행 전이라 기록이 0줄이었다. **이후 2026-10-14·10-15 20:00 UTC 두 번 성공했다** (검토 뒤 확인).

| 항목 | 값 |
|------|-----|
| `cron.job` | jobid 1, `0 20 * * *`, `SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);`, `active = true` |
| 검토 시점 `cron.job_run_details` | 0줄 (14:56 UTC) |
| 이후 | 두 번 `succeeded` |

---

## 4. 문제

> 요약: High 없음. Medium 2개 중 1개는 고쳤고 1개는 사용자가 정했다. Low는 권장만 했고, 아직 열린 것은 모두 `back_overview.md` "해결되지 않은 점"에 있다.

| # | 심각도 | 문제 | 영향 | 조치 | 지금 |
|---|--------|------|------|------|------|
| M1 | Medium | 수집 잠금 연결(실행 내내 빌려 둔 연결)에 오류 리스너가 없다. 그 연결이 끊기면 `'error'`가 처리되지 않아 **프로세스가 그 자리에서 죽는다.** `collection_logs`는 `running`으로 남는다 | 긴 수집 중 연결이 끊기면 갑자기 죽는다. 데이터 손상은 없음 | **고침** (5장) | 해결 |
| M2 | Medium (결정) | 14일 안 게임이 없는 표본이 많다 (에메랄드 15명 중 10명). 100명이면 계획 게임 수의 약 1/3 | 화면 숫자가 매우 작아짐 | 6장 추천 → 티어당 250명으로 실행 (3,930게임) | 해결. 계약 문구는 overview 2번 |
| L1 | Low | 표본이 모자라면 모자란 만큼이 아니라 `playersPerTier`명을 새로 더한다 (에메랄드 15 → 265) | 인원을 늘릴 때 예상보다 많아짐 | "목표 인원까지 채우기" 권장 | overview 4번 |
| L2 | Low | 중단·실패한 실행의 요약 로그가 `stoppedBy=done`으로 찍힌다 | 로그 읽을 때 헷갈림 | `stoppedBy`에 `aborted`/`failed` 추가 권장 | overview 5번 |
| L3 | Low | ②(게임 ID)에는 연속 실패 상한이 없다 | Riot 장애 때 플레이어마다 재시도로 시간 낭비 | ②에도 연속 실패 상한 권장 | overview 7번 |
| L4 | Low | `/health`가 모든 오류를 `DB_UNAVAILABLE`로 바꾸고 원인을 로그에 남기지 않는다 | 장애 원인 찾기 어려움 | `catch`에서 가린 오류를 `error` 로그로 | overview 6번 |
| L5 | Low | 스냅숏·게임 저장 연결도 문장 사이 짧은 순간에는 오류 리스너가 없다 (M1과 같은 원인, 확률 매우 낮음) | 이론상 서버·수집기가 죽을 수 있음 | `pool.on('connect', …)`로 기본 리스너 권장 | overview 8번 |
| L6 | Low | Supabase 세션 풀러가 `application_name`을 `Supavisor`로 바꾼다 | 연결을 이름으로 못 찾음 | 기록만 | overview 10번 |
| L7 | Low | DB 시계가 로컬보다 약 1.7~2초 빠르다 | 창 경계 몇 초 | 기록만 | overview 10번 |
| L8 | Low (문서) | `api_contract.md` 6장 변경 기록의 날짜 순서가 거꾸로다 | 읽는 사람이 헷갈림 | 다음 `!백엔드` Plan/Build가 고침 | overview 9번 |

---

## 5. Review가 고친 것

> 요약: M1 하나만 고쳤다. 계획·계약 규칙은 바꾸지 않고, "DB 연결 끊김이면 멈추고 `failed`, 1"을 실제로 지키게 했다.

| 파일 | 변경 |
|------|------|
| `src/collector/runLog.ts` | `CollectorLock.acquire(pool, onLost?)`: 잠금 연결에 `'error'` 리스너를 붙여 `lost = true`, `onLost` 1번. 잃은 잠금의 `release()`는 unlock 없이 연결을 버린다 |
| `src/cli/collect.ts` | `run`/`sample`/`matches`: `onLost`에서 가린 오류 로그 + `stop.requested = true` → 지금 게임 뒤 멈춤 → `failed` "DB 연결 끊김 (수집 잠금 연결)", 종료 코드 **1** (사용자 중단 130과 구별). `purge --yes`도 같은 리스너로 죽지 않음 |
| `test/unit/runLog.test.ts` (새) | 가짜 연결로 4개: 끊김에 죽지 않음·`onLost` 1번, 잃은 잠금 release, 정상 release, 잠금 실패 시 연결 반환 |

| 확인 | 결과 |
|------|------|
| 재현 (실제 풀 + `pg_terminate_backend`) | 수정 전 `Unhandled 'error' event`, 종료 1. 수정 후 `onLost` 1번, 5초 뒤에도 살아 있음 |
| 실제 CLI (`matches --tiers EMERALD`, ② 중 끊음) | Riot 2회, 종료 코드 1, id 22 `failed`, `running` 0줄, 원본 45/450, 잠금 다시 잡힘 |
| 검사 | typecheck·lint 0, 단위 80개, 통합 17개 |

---

## 6. 테스트 수집 인원 평가

> 요약: 검토 시점 비율(활동 33%, 활동한 사람당 약 9게임)로는 티어당 100명이면 약 850게임이었다. Review는 **티어당 250명**을 추천했고, 사용자가 그대로 실행했다.

| 방법 | 예상 게임 | 예상 시간 | 실제 |
|------|-----------|-----------|------|
| (a) 티어당 100명 (계약 그대로) | 약 850 (400~1,500) | 약 40분 | - |
| (b) 티어당 250명 (`--players-per-tier 250`) ★추천 | 약 2,100~2,300 (1,000~4,000) | 약 1.7~1.8시간 | **3,930게임, 약 3시간**, 0게임 표본 48% |

- 근거: 0게임 표본은 ② 호출 1번(약 1.2초)만 들어 인원을 늘리는 비용이 작다. "많이 뽑고 활동한 사람만 남기기"는 활동 확인이 결국 ② 호출이라 호출이 줄지 않는다. "목표 게임 수까지 표본을 점점 늘리기"는 본 수집 설계 때 검토할 만하다 (새 기능, Plan 필요).
- 계약 `db_contract.md` 1-3·10장과 `test` 프리셋은 아직 100명이다 (overview 2번).

---

## 7. 코드 품질 메모

> 요약: 구조와 오류 처리가 계획대로 깔끔하다. SQL은 모두 매개변수이고, 비밀값은 한 곳에서 가린다. v1 죽은 코드는 없다.

| 관점 | 판단 |
|------|------|
| 구조 | 진입점 2개 분리, SQL은 `repositories/`에만, 변환은 순수 함수, `Queryable`로 롤백 시험 가능 |
| 오류 처리 | Riot 응답별 분류, 게임 단위 트랜잭션, API 오류 형식 하나. M1 고친 뒤 DB 끊김도 계획대로. L3·L4·L5는 권장 |
| 비밀값 | 로그 한 곳(`createLogger`)에서 가린다. 키는 헤더로만. puuid는 앞 8자 |
| SQL 주입 | 모든 값이 `$n` 매개변수. 문자열로 붙이는 것은 상수, 영숫자만 남기는 `statement_timeout`, 열 이름 상수뿐 |
| 연결 풀 | API `max 5`(동시 150요청에도 경고 0), CLI `max 2`. 스냅숏은 BEGIN·ROLLBACK 실패 연결을 버림 |
| 테스트 | 단위 80개, 통합 17개(모두 ROLLBACK, 2021년 시각·가짜 패치). 고정 시각이라 날짜가 지나도 깨지지 않음 |

- Build가 적은 "계획과 다른 점"은 모두 받아들였다 (`back_build.md` 5장). 1번(표본 보충)만 L1을 함께 남긴다.

---

## 8. 다음에 할 일

| # | 할 일 | 누가 | 지금 |
|---|-------|------|------|
| 1 | 예약 작업 첫 실행 `succeeded` 확인 | 메인 에이전트 | 완료 (10-14·10-15 두 번 성공) |
| 2 | M2 테스트 수집 인원 결정 | 사용자 | 완료 (250명). 계약 문구는 남음 |
| 3 | L1~L5 반영 여부를 다음 `!백엔드` 변경 Plan에서 정함 | 메인 에이전트 | 남음 |
| 4 | L8 계약 변경 기록 날짜 정리 | 다음 `!백엔드` Plan/Build | 남음 |
