# 백엔드 검토 기록 — 01 수집 워커 + 챔피언 통계 API (v1 + 변경 01)

> 작성: Review 에이전트 / 검토일: 2026-10-15 (KST, 실제 확인 시각 2026-10-14 14:55~15:06 UTC)
> 기준: `CLAUDE.md` 8·9·11장, `backend/docs/back_spec.md` 1~13장 + `## 변경 01` (둘이 다르면 변경 01), `docs/contracts/api_contract.md` v2, `docs/contracts/db_contract.md`·`.dbml` v7
> 방법: Build 기록을 믿지 않고 코드를 읽고, 검사를 다시 돌리고, 실제 Supabase와 Riot API로 다시 확인했다. v1은 이번이 첫 검토다.
> 상태 표기: ✅ 통과 / ⚠️ 문제 있음(아래 기록) / ❌ 실패 / ⏸️ 확인 못 함

---

## 1. 결론

> 요약: **PASS with issues.** 계약과 완료 기준은 모두 맞는다. 실제로 재현한 결함 1개(수집 잠금 연결이 끊기면 프로세스가 바로 죽음)는 고쳤다. 남은 것은 사용자 결정 1개(테스트 수집 게임 수가 예상보다 적을 수 있음)와 예약 작업 첫 실행 확인(아직 실행 시각 전)이다.

| 구분 | 결과 |
|------|------|
| 판정 | **PASS with issues** |
| High | 0 |
| Medium | 2 (M1 고침, M2 사용자 결정 필요) |
| Low | 8 (권장 조치만, 고치지 않음) |
| 고친 코드 | `src/collector/runLog.ts`, `src/cli/collect.ts`, 새 테스트 `test/unit/runLog.test.ts` (5장) |
| Riot 호출 (Review 전체) | **10회** (다시 받기 6, 잘못된 키 1, Ctrl+C 1, 연결 끊김 2). 429 0회 |
| 남긴 DB 변화 | `collection_logs` 4줄 추가(id 20 `key_expired`, 21·22 `failed`, 18·19는 통합 테스트 시퀀스), 실제 스냅숏 1번 다시 만듦(6장 사고 기록). 원본 `matches` 45 / `match_players` 450 그대로 |

---

## 2. 검사 명령

> 요약: 타입 검사, 린트, 단위·통합 테스트, 취약점 검사 모두 통과. 통합 테스트 뒤 테스트 데이터는 0줄이다.

| 명령 | 결과 |
|------|------|
| `npm run typecheck` | 오류 0 (수정 전·후 모두) |
| `npm run lint` | 오류 0 (수정 전·후 모두) |
| `npm test` | 수정 전 76개 통과, 수정 후 **80개** 통과 (새 `runLog.test.ts` 4개), 실패 0 |
| `npm run test:integration` | 17개 통과, 실패 0 (약 3.6초). 수정 뒤 다시 돌려도 17개 통과 |
| `npm audit` | 취약점 0 |
| 통합 테스트 뒤 정리 | `matches` `KR_9000000%` 0, `match_players`·`ranked_players` `TEST\_%` 0, `stats_window_patch`·`matches`의 `0.8`·`0.9` 0. 실제 데이터 개수(45 / 450 / 15 / 197) 실행 전과 같음 |
| 금지어 `grep` (01-9) | `refresh_patch_stats`, `purge_old_patches`, `FROM patch`, `keepPatches`, `maxGamesPerPatch`, `patch_full`, `old_patch`, `isFallback`, `PATCH_NOT_FOUND`, `selectPatch`, `parsePatchParam`, `patchSelection`, `FALLBACK_MIN_GAMES`: `src`·`test`에 0건 (`rules.test.ts`의 "`keepPatches`가 없음" 확인 1줄만) |
| 비밀값 `grep` | 실제 `RIOT_API_KEY`·DB 비밀번호·접속 문자열 값이 `backend/`, `docs/`, `.env.example`, Review 로그에 0건. `RGAPI-0000…`, `RGAPI-1111…`은 테스트용 가짜 값 |
| `.env.example` | 변경 없음 (`git diff` 0줄) |

---

## 3. 확인 목록

> 요약: 확인 항목별 근거와 수치다. 실제로 해 본 것과 코드만 본 것을 나눠 적었다.

### 3-1. DB 계약 (저장 규칙)

| 항목 | 결과 | 근거 |
|------|------|------|
| 게임당 정확히 10줄 | ✅ | 45게임 중 10줄이 아닌 게임 0 |
| `game_start_at` | ✅ | 가장 이른 2026-10-01T05:16Z, 가장 늦은 2026-10-14T08:34Z. 1회차 창 시작(2026-09-30T14:47Z)보다 이른 게임 0 |
| 패치 | ✅ | 16.20 36 / 16.19 9. `^[0-9]+\.[0-9]+$` 위반 0, `match_id` 형식 위반 0 |
| `matches.puuid` | ✅ | NULL 0, 모두 `ranked_players`에 있음, 45게임 모두 그 표본 플레이어가 실제 참가자 |
| `team_position` | ✅ | 5개 포지션 각 90줄, NULL 0 (이번 데이터에 `""` 없음, 변환은 단위 테스트로 확인) |
| 밴 `-1` → NULL | ✅ | `ban_champion_id` NULL 15줄, 0 이하 값 0줄. Riot 원본의 `-1` 개수와 같음 (3-2) |
| `skill_order` | ✅ | NULL 0, `^[QWER]*$` 위반 0, 길이 7~20, 11자 미만 46줄 (짧은 게임, 집계 함수가 거름) |
| 아이템 | ✅ | 음수 0, NULL 0, 6칸 모두 0인 줄 0. `item6`은 저장 안 함 |
| 스펠 | ✅ | `summoner1_id = summoner2_id` 0, Riot 위치 그대로 (3-2) |
| 표본 | ✅ | 에메랄드 15명 (I 4, II 4, III 4, IV 3). `test` 프리셋 100명 → 25/25/25/25는 단위 테스트 |

### 3-2. Riot 원본 다시 받아 비교 (처음 하는 확인)

> 요약: 저장된 3게임을 Riot에서 다시 받아(호출 6회), 백엔드 변환 코드를 쓰지 않고 계약 6·7장대로 따로 계산해 DB 줄과 비교했다. **30명 × 24컬럼 = 720개 값이 모두 같다.**

| 게임 | 패치 | 고른 이유 | `game_start_at` | 행 | 원본 `-1` 밴 | `EVOLVE` 이벤트 | 다른 값 |
|------|------|-----------|-----------------|----|--------------|-----------------|---------|
| `KR_8415426442` | 16.20 | 밴 NULL 2개 | ms까지 같음 (`1791700972721`) | 10 | 2 | 0 | 0 |
| `KR_8402069772` | 16.19 | 이전 패치, 카이사 있음 | ms까지 같음 (`1790833655069`) | 10 | 1 | 3 (빠짐 확인) | 0 |
| `KR_8418903090` | 16.20 | 최근 게임 | ms까지 같음 (`1791966847784`) | 10 | 0 | 1 (빠짐 확인) | 0 |

- 비교한 컬럼: `champion_id`, `team_position`, `win`, `ban_champion_id`(`pickTurn = participantId`), `summoner1_id/2_id`, 룬 11개(`description`으로 핵심·보조 찾음), `item0~5`, `skill_order`(타임라인 참가자를 puuid로 잇고 `NORMAL`만, `timestamp` 순).
- 세 게임 모두 `queueId 420`, 5분 이상(913~2369초), 참가자 10명, 패치 앞 두 부분이 같다. 표본 플레이어가 참가자에 있다.
- puuid는 문서·로그에 쓰지 않았다 (스크립트 출력도 앞 8자만).

### 3-3. API 계약 v2

> 요약: 실제 DB로 `npm start` 후 엔드포인트 4개를 모두 불렀다. 목록 5개와 상세 142개(창의 모든 챔피언) 응답을 DB 값으로 따로 계산해 **8,929개 검사가 모두 통과**했다.

| 항목 | 결과 | 근거 |
|------|------|------|
| `/health` | ✅ | 200 `no-store`, `{status, db, stats:{state:"fresh", aggregatedAt}}`. DB를 못 쓰면 503 `DB_UNAVAILABLE` (따로 띄운 서버로 확인) |
| `/meta` | ✅ | 200 `public, max-age=600`, `application/json; charset=utf-8`. `window`, `lastCollectedAt`, `positions`, `rules{minTierPick 50, secondaryPositionMinShare 10, windowDays 14, staleAfterHours 26}`. 옛 필드 없음 |
| `window` 객체 | ✅ | `days 14`, `start`/`end`/`aggregatedAt` = `stats_window` 값(ISO, ms 포함), `end − start` = 정확히 14일, `games` = 패치 합계, `isStale false`. `patches` 최신 먼저, `displayName` 16.20→26.20·16.19→26.19, `share` 80 / 20 (소수 2자리 이내, 오차 0.005 이하) |
| 목록 | ✅ | 포지션별 TOP 44, JUNGLE 44, MIDDLE 36, BOTTOM 26, UTILITY 40. 필드 12개 순서·이름 일치. `rank` 1부터 연속, 정렬 `tier NULLS LAST → tierScore DESC → championId`. `pick/win/ban` = `champion` 테이블, `winRate`·`pickRate`·`banRate`·`positionShare` 따로 계산한 값과 같음. `tierScore`를 계약 9-3 공식으로 따로 계산해 0.0006 안에서 같음. `mainPositions`(최대 2개, 10%)를 따로 계산해 같음. 50판 미만은 모두 `tier: null` |
| 상세 | ✅ | 142개 모두 200. 기본 포지션 = 1순위 주 포지션, `isMainPosition true`, `positions` 탭 = 주 포지션. `stats` = `champion` 값. 아이템 개수·순서·값 = `champion_item` 전체, `pickRate = pick / stats.pick`. 룬·스펠·스킬 2개 이하, 룬 개수 = min(2, DB 줄 수), 스펠 `[작은, 큰]`, 스킬 `^[QWER]{11}$`. 주 포지션이 아닌 포지션(54 JUNGLE) → 200, `isMainPosition false` |
| 옛 `patch` 쿼리 | ✅ | `?patch=16.19`, `?patch=16.1`, `?patch=garbage` → 200, 응답이 쿼리 없을 때와 바이트까지 같음 |
| 오류 | ✅ | `position` 없음·`top`·`MID`·반복(`position=TOP&position=JUNGLE`, 배열)·빈 값 → 400 `INVALID_PARAMETER` + `details{param, value}`. `championId` `abc`·`023`·`0`·`100000` → 400. `99999` → 404 `STATS_NOT_FOUND {championId}`. `39?position=JUNGLE` → 404 `{championId, position}`. `/nope`·`/champions/39/extra`·POST·DELETE → 404 `NOT_FOUND`. 잘못된 % 인코딩 → 400. 모두 `no-store`, `details`에 `patch` 없음 |
| 헤더 | ✅ | ETag 없음, CORS 헤더 없음, `x-powered-by` 없음 |
| 서버 로그 | ✅ | 요청 475개, `WARN`·`ERROR` 0. DB 접속 실패 로그의 호스트는 `***`로 가려짐 |
| 집계 전 503 | ✅ (코드·단위) | 지금은 실제 스냅숏이 있어 실제로 다시 볼 수 없다. 단위 테스트(가짜 `ApiDb`)와 Build의 실제 확인, 코드(`requireWindow`가 모든 통계 엔드포인트의 첫 문장) 확인 |
| 오래됨 | ✅ (통합) | 통합 테스트가 같은 트랜잭션에서 `aggregated_at = now() − 27h` → `isStale true`, `/health stale`. 26시간 경계는 단위 테스트 |

### 3-4. 한 요청 = 한 스냅숏 (`REPEATABLE READ READ ONLY`)

> 요약: 상세 요청 150개를 동시에 보내며 DB 쪽 `pg_stat_activity`를 262번 읽었다. 백엔드 연결의 모든 통계 문장이 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`로 연 트랜잭션 안(`xact_start` 있음)에서 나갔고, 트랜잭션 ID가 생기지 않았다(쓰기 없음).

- 관찰된 문장: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` → `stats_window` → `champion_tier_view` → `champion_item` → `champion_rune` → `champion_spell` → `champion_skill` → `COMMIT`. 모두 `in_xact=true`, `backend_xid IS NULL`.
- 통합 테스트도 실제 풀의 `readSnapshot` 안에서 `transaction_isolation = repeatable read`, `transaction_read_only = on`, 쓰기 25006 거부를 확인한다. 코드: `server.ts`가 `snapshot = fn => readSnapshot(pool, fn)`, 라우트 3개가 모든 읽기를 그 안에서 차례로 한다.
- 참고: Supabase 세션 풀러가 `application_name`을 `Supavisor`로 바꿔, 연결을 이름으로 구분할 수 없었다 (L7).

### 3-5. 수집기

| 항목 | 결과 | 근거 |
|------|------|------|
| `startTime` 초 | ✅ (실제) | 실행 로그 `windowStart=2026-09-30T15:01:41.951Z startTime=1790780501` = `floor(창 시작 ms / 1000)`, 10자리. 요청 경로에 `queue=420&start=0&count=20&startTime=…`. ms·소수·9자리는 호출 전에 던짐(단위) |
| 창 시작 고정 | ✅ (코드) | 잠금 뒤 한 번 `windowStart(now, 14)`, `ctx.window`로 ②와 ③이 같은 값 |
| `out_of_window` | ✅ (단위·실제) | 단위: 창 시작 − 1ms → `out_of_window`, 타임라인 0번. 실제 45게임 중 0개(0%) |
| 자동 집계 없음 | ✅ (코드·단위) | `run`·`matches`에 집계 SQL 없음(단위 테스트가 SQL 목록 확인), 끝에 안내 로그 |
| 창 상한 | ✅ (단위) | 24,999 + 1 저장 → `window_full`, `getMatch` 1번. 25,000이면 0번 |
| `aggregate` | ✅ (실제, 6장) | 같은 연결에서 `SET statement_timeout '5min'` → `ANALYZE` 88ms → `refresh_window_stats(14)` 337ms → `RESET`. 결과 `games 45`, 줄 수 같음. P0002 → 종료 코드 1은 통합 테스트(`ok:false`)와 코드 |
| `purge` 미리보기 | ✅ (실제) | `totalGames=45 removeGames=0`, 종료 코드 0, "실제로 지우려면 --yes". `--yes`는 실행하지 않았다 |
| 키 만료 | ✅ (실제) | 프로세스 환경에만 `RIOT_API_KEY=invalid`(`.env` 수정 없음). Riot 1회 401 → 즉시 멈춤, **종료 코드 2**, `collection_logs` id 20 `key_expired` "Riot 키 만료 (HTTP 401)", `finished_at` 기록, 원본 45 그대로 |
| 잠금 | ✅ (실제) | 다른 연결이 `pg_try_advisory_lock(hashtext('tiergg:collector'))`을 잡은 동안 `matches` → "다른 수집이 실행 중", **종료 코드 3**, `collection_logs` 줄 안 생김 |
| Ctrl+C | ✅ (실제) | ② 시작 직후 `SIGINT` → 진행 중이던 호출 1개를 마치고 멈춤, **종료 코드 130**, id 21 `failed` "사용자 중단", 반쪽 게임 없음(45/450). ③~⑤ 중간 중단은 같은 `stop` 검사가 게임 사이에만 있어 지금 게임의 트랜잭션은 끝까지 간다(코드) |
| DB 접속 불가 (시작 때) | ✅ (실제) | 잘못된 `DATABASE_URL` → "실패", 종료 코드 1, 호스트 `***` |
| DB 연결 끊김 (실행 중) | ⚠️ → ✅ 고침 | **수정 전**: 잠금 연결을 `pg_terminate_backend`로 끊자 `Unhandled 'error' event`로 프로세스가 바로 죽음 (M1). **수정 후**: 실제 `matches` 실행 중 끊음 → "DB 연결 끊김" 로그, 지금 단계 뒤 멈춤, **종료 코드 1**, id 22 `failed` "DB 연결 끊김 (수집 잠금 연결)", `running` 남지 않음, 잠금 풀림 |
| 게임 연속 20개 실패 | ✅ (코드) | 재시도 실패·404·400·DB 22xxx/23xxx만 그 게임 건너뜀, 연속 20이면 `TooManyFailuresError` → `failed`, 1. 실제로 일으키지 않음(Riot 장애를 만들 수 없음) |
| 이어서 모으기 | ✅ (코드·Build) | ②에서 `matches`에 있는 ID 제거, 저장은 `ON CONFLICT DO NOTHING` + 0줄이면 ROLLBACK. Review는 호출 예산(20회) 때문에 다시 돌리지 않았다 (② 15회 필요). Build 2회차에 15개 건너뜀 기록 |
| 제한기 | ✅ (단위·Build) | 19/98, 429 `Retry-After`(없으면 10초) 5번, 5xx 1·2·4초 3번, 응답 헤더로 사용량 맞춤. 단위 테스트 12개. Review 호출 10회 모두 200·401, 429 0. 429는 일부러 일으키지 않았다 |
| 분리 | ✅ | `server.ts`·`src/api`가 `collector`·`riot`·`loadRiotEnv`를 import하지 않음. `RIOT_API_KEY`는 `config/env.ts`(CLI 전용 함수)와 가리기 함수에서만 읽음 |

### 3-6. 예약 작업 (`tiergg_daily_refresh`)

> 요약: 작업은 등록돼 있고 켜져 있다. **첫 실행 시각(2026-10-14 20:00 UTC = 10-15 05:00 KST)이 아직 안 와서 실행 기록이 0줄이다.**

| 항목 | 값 |
|------|-----|
| `cron.job` | jobid 1, `0 20 * * *`, `SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);`, `active = true` |
| `cron.job_run_details` | **0줄** (14:56 UTC 조회). 실패(P0002) 기록도 아직 없다 |
| 다음 실행 | **2026-10-14T20:00:00Z (2026-10-15 05:00 KST)** |
| 예상 | 창 안에 45게임이 있으므로 `succeeded`여야 한다 |
| 확인 방법 | 그 뒤 `SELECT status, return_message, start_time FROM cron.job_run_details WHERE jobid = 1 ORDER BY start_time DESC LIMIT 1` 과 `stats_window.aggregated_at`이 20:00Z 근처로 바뀌었는지 |

---

## 4. 문제 (심각도 순)

> 요약: High 없음. Medium 2개 중 1개는 고쳤고 1개는 사용자 결정이다. Low는 권장만 한다.

| # | 심각도 | 문제 | 영향 | 조치 |
|---|--------|------|------|------|
| M1 | Medium | 수집 잠금 연결(실행 내내 빌려 둔 연결)에 오류 리스너가 없다. pg-pool은 빌려 간 연결의 리스너를 떼므로, 그 연결이 끊기면(DB 재시작·풀러 재시작·네트워크) `'error'` 이벤트가 처리되지 않아 **프로세스가 그 자리에서 죽는다.** 로그는 가리기 함수를 거치지 않은 Node 스택이고, `collection_logs`는 `running`으로 남고, 잠금은 서버에서 이미 풀린다. 계획 3-5 "DB 연결 끊김 → 멈춤, `failed`, 1"과 다름 | 2시간 수집 중 연결이 한 번 끊기면 갑자기 죽는다. 저장은 게임 단위라 데이터 손상은 없음 | **고침** (5장). 실제 실행에서 재현·확인 |
| M2 | Medium (결정) | 14일 안 솔로랭크 게임이 없는 표본이 많다: 에메랄드 15명 중 10명 0게임, 활동한 5명은 4·6·7·8·20게임(평균 9). 300명 테스트 수집이 계획(2,200~2,700게임)의 약 1/3일 수 있다 | 화면 숫자가 매우 작아진다. 호출·시간은 줄어든다 | 사용자 결정. 7장 추정과 추천 |
| L1 | Low | 표본 보충 방식: 그 티어 표본이 `playersPerTier`보다 적으면 모자란 만큼이 아니라 **`playersPerTier`명을 새로 더한다** (에메랄드 15 → 약 115. 나중에 `--players-per-tier 250`을 주면 100 → 약 350) | 인원을 늘릴 때 예상보다 많아진다 | 다음 변경에서 "목표 인원까지 채우기"로 바꾸기 권장. 그 전에는 원하는 총 인원 − 지금 인원을 생각해 옵션을 준다 |
| L2 | Low | 중단·실패한 실행의 요약 로그가 `stoppedBy=done`으로 찍힌다 | 로그 읽을 때 헷갈림 (기록 `status`는 맞음) | `stoppedBy`에 `aborted`/`failed` 추가 권장 |
| L3 | Low | ②(게임 ID)에는 연속 실패 상한이 없다. Riot이 계속 5xx면 플레이어마다 1+2+4초를 기다려 300명이면 약 35분 뒤에야 ③에서 멈춘다 | 장애 때 시간 낭비 | ②에도 연속 실패 상한(예: 20) 권장 |
| L4 | Low | `/health`가 모든 오류를 `DB_UNAVAILABLE`로 바꾸고 원인을 로그에 남기지 않는다 | 장애 원인 찾기 어려움 | `catch`에서 가린 오류를 `error` 로그로 |
| L5 | Low | 스냅숏·게임 저장 연결도 문장 사이의 아주 짧은 순간에는 오류 리스너가 없다 (M1과 같은 원인, 확률 매우 낮음). API 서버도 해당 | 이론상 서버·수집기가 죽을 수 있음 | `pool.on('connect', c => c.on('error', 로그))`로 모든 연결에 기본 리스너 권장. 이번엔 재현이 안 돼 고치지 않음 |
| L6 | Low | Supabase 세션 풀러가 `application_name`을 `Supavisor`로 바꾼다 | `pg_stat_activity`에서 백엔드 연결을 이름으로 못 찾음 | 기록만 |
| L7 | Low | DB 시계가 로컬보다 약 1.7~2초 빠르다 (`aggregate` 로그 15:01:12.69, DB `window_end` 15:01:14.41). Build 남은 문제 3과 같음 | 창 경계 몇 초 | 기록만 |
| L8 | Low (문서) | `api_contract.md` 6장 변경 기록이 날짜 순서가 거꾸로다 (v2 초안 2026-10-15 다음 줄이 v2 구현 반영 2026-10-14). Build 날짜(10-14)와 계획 날짜(10-15)가 다르게 적힌 탓 | 읽는 사람이 헷갈림 | 다음 `!백엔드` Plan/Build가 고친다 (Review는 계약 수정 범위 밖) |

---

## 5. Review가 고친 것

> 요약: M1 하나만 고쳤다. 동작 규칙(계획·계약)은 바꾸지 않고, "DB 연결 끊김이면 멈추고 `failed`, 1"을 실제로 지키게 했다.

| 파일 | 변경 |
|------|------|
| `src/collector/runLog.ts` | `CollectorLock.acquire(pool, onLost?)`: 잠금을 잡은 연결에 `'error'` 리스너를 붙여 `lost = true`로 표시하고 `onLost`를 1번 부른다. `release()`는 잃은 잠금이면 unlock 쿼리 없이 연결을 오류와 함께 버린다 |
| `src/cli/collect.ts` | `run`/`sample`/`matches`: `onLost`에서 "DB 연결 끊김" 오류 로그(가림) + `stop.requested = true` → 지금 게임 뒤 멈춤. 멈춘 이유가 잠금 손실이면 `failed` "DB 연결 끊김 (수집 잠금 연결)", 종료 코드 **1** (사용자 중단 130과 구별). `purge --yes`도 같은 리스너로 죽지 않음 |
| `test/unit/runLog.test.ts` (새) | 가짜 연결로 4개: `error` 이벤트에 죽지 않고 `lost`·`onLost` 1번, 잃은 잠금 release는 unlock 없이 버림, 정상 release, 잠금 실패 시 연결 반환 |

| 확인 | 결과 |
|------|------|
| 재현 도구 (실제 풀 + `CollectorLock` + `pg_terminate_backend`) | 수정 전: `Unhandled 'error' event`, 종료 1. 수정 후: `onLost` 1번, 5초 뒤에도 살아 있음, 종료 0 |
| 실제 CLI (`matches --tiers EMERALD`, ② 중 잠금 연결 끊음) | Riot 2회, 종료 코드 1, id 22 `failed` "DB 연결 끊김 (수집 잠금 연결)", `running` 0줄, 원본 45/450, 잠금 다시 잡힘 |
| 검사 | typecheck·lint 0, 단위 80개, 통합 17개 통과 |

---

## 6. 검토 중 사고 기록

> 요약: Review가 명령 한 줄에 실수로 `aggregate`를 넣어 실제 스냅숏을 1번 다시 만들었다. 같은 원본으로 다시 센 것이라 숫자는 같고, 원본은 바뀌지 않았다.

- 언제: 2026-10-14T15:01:12Z, 잠금 시험 명령 안에서 `npm run collect -- aggregate`가 백그라운드로 실행됨 (실행하지 않으려던 명령).
- 결과: `ANALYZE` 88ms → `refresh_window_stats(14)` 337ms, `games 45`, 패치 16.20 36 / 16.19 9, 줄 수 `champion 197`, `item 1671`, `rune 372`, `spell 254`, `skill 290` — Build 집계와 **모두 같음**. 바뀐 것은 `aggregated_at`·`window_start/end`(14:50:32Z → 15:01:14Z)뿐. `matches`·`match_players` 변화 없음.
- 영향: 없음 (계획 01-8 4번 `aggregate`와 같은 동작이고, 다음 05:00 KST 예약 작업이 다시 만든다).
- 덤으로 확인된 것: 그때 다른 연결이 수집 잠금을 잡고 있었는데 `aggregate`가 막히지 않았다 → 계획 01-4-5 "aggregate는 수집 잠금을 잡지 않음"과 맞다.

---

## 7. 남은 문제 1 평가: 테스트 수집(300명) 게임 수

> 요약: 지금 비율(활동 33%, 활동한 사람당 약 9게임)이면 **300명으로 약 850게임**(넓게 보면 약 400~1,500)이다. 계획의 2,200~2,700게임에 맞추려면 티어당 약 250명이 필요하다. 0게임 표본은 ② 호출 1번(약 1.2초)만 들어 인원을 늘리는 비용이 작다.

### 7-1. 근거

| 값 | 수치 | 비고 |
|----|------|------|
| 표본 | 에메랄드 15명 | 플래티넘·다이아는 아직 없음 |
| 14일 안 게임이 있는 표본 | 5명 (33%) | 표본이 작아 95% 범위 약 15~58% (Wilson) |
| 활동한 사람당 게임 | 4, 6, 7, 8, 20 → 평균 9 | 상한 20 |
| 표본끼리 같은 게임 | 0 | 45게임을 5명이 각각 찾음 (계약 가정은 겹침 약 10%) |
| `out_of_window` | 0% | `startTime`이 잘 걸러 줌 |

### 7-2. 추정 (게임 수 ≈ 인원 × 활동 비율 × 9 × 0.9~1.0)

| 방법 | 표본 | 예상 게임 | Riot 호출 | 시간 (시간당 약 2,940회) | 비고 |
|------|------|-----------|-----------|--------------------------|------|
| (a) 그대로 (`--preset test`) | 약 315명 (에메랄드 15 + 100 더함, L1) | **약 850** (400~1,500) | 약 2,000 | 약 40분 | 계약 1-3(티어당 100명) 그대로 |
| (b) 티어당 250명 (`--players-per-tier 250`) | 약 765명 | **약 2,100~2,300** (1,000~4,000) | 약 5,000~5,400 | 약 1.7~1.8시간 | 계획 예상 게임 수·시간과 비슷. page 1(약 205명) × 4디비전에서 디비전당 63명이라 충분 |
| (c) 많이 뽑고 활동한 사람만 남김 | 원하는 만큼 | (b)와 같은 수준 | (b)와 거의 같음 | (b)와 같음 | 활동 확인이 결국 ② 호출이라 호출이 줄지 않는다. 코드·계획 변경 필요 |
| (d) 목표 게임 수까지 표본을 점점 늘림 | 자동 | 목표에 맞춤 | 필요한 만큼 | - | 가장 정확하지만 새 기능 (Plan 승인 필요) |

### 7-3. 추천 (사용자 결정, Review는 설정을 바꾸지 않았다)

1. **(b) 티어당 250명으로 한 번에 실행**을 추천한다. 코드 변경 없이 CLI 옵션 하나(`npm run collect -- run --preset test --players-per-tier 250`)로 계획한 규모(약 2,200게임, 약 2시간, 24시간 키 안)에 가장 가깝다. 0게임 표본은 ② 1번만 들어 손해가 작다.
   - 계약 `db_contract.md` 1-3·10장 2번과 계획 U5는 "티어당 100명"이다. 250명으로 하면 그 문구와 달라지므로, 사용자가 정하고 다음 `!db`·`!백엔드` 문서 수정 때 반영한다 (DB 스키마·CHECK 영향 없음, `ranked_players` 약 765줄).
   - L1 때문에 에메랄드는 15 + 250 = 약 265명이 된다 (다른 티어 250). 비중 차이가 신경 쓰이면 L1을 먼저 고친다.
2. 계약대로 가고 싶으면 **(a)로 먼저 돌리고** 요약 로그의 `playersNoGames`로 세 티어의 실제 활동 비율을 본 뒤, 모자라면 더 뽑는다. 다만 지금 코드는 두 번째 실행에서 `--players-per-tier 250`을 주면 250명을 새로 더하므로(L1) 총 인원을 계산해서 옵션을 준다.
3. (c)·(d)는 이번 테스트 단계에서는 권하지 않는다. 호출 절약이 없고, 계획 변경이 필요하다. 본 수집(에메랄드 이상) 설계 때 (d)를 검토할 만하다.

---

## 8. Build 계획과 다른 점 판단

> 요약: Build가 적은 다른 점 18개를 모두 받아들인다. v1 1번(표본 건너뛰기 기준)만 L1의 보충 방식 문제를 함께 남긴다.

| Build 기록 | 판단 | 이유 |
|------------|------|------|
| v1-1 표본이 `playersPerTier` 이상일 때만 건너뜀 | 받아들임 (L1 함께) | 계획대로면 검증용 몇 명이 남은 티어가 그 몇 명으로만 수집된다. 다만 모자라면 전원을 새로 더하는 점은 L1 |
| v1-2 건너뜀 이유 `duplicate` 추가 (`patch_full`은 변경 01에서 삭제) | 받아들임 | 로그만, DB 영향 없음 |
| v1-3 잠금 실패 종료 코드 3 | 받아들임 | 실제 확인, 실패(1)와 구별돼 쓸모 있음 |
| v1-4 `aggregate`·`purge`는 `collection_logs`에 안 남김 | 받아들임 | `lastCollectedAt`이 수집 시각을 뜻하게 유지 |
| v1-5 `context.ts`, `cache.ts`, `test/helpers` 추가 | 받아들임 | 중복 제거 |
| v1-6 응답 헤더로 제한기 맞춤 | 받아들임 | 직전 실행 사용량을 반영해 429를 막는다 (Build 4-3에서 119초 대기). 보수적이라 최대 2분 더 기다릴 수 있음 |
| v1-7 fixture의 riotId·소환사 이름도 가짜 값 | 받아들임 | 개인 정보 보호 |
| v1-8 가짜 패치 여러 개 | 받아들임 | 지금은 `0.8`·`0.9`, 끝난 뒤 0줄 확인 |
| v1-9 404 `details` 두 가지 | 받아들임 | 계약 2-4 오류 표와 같음 |
| 01-1 실제 수집 2회 (15명, 45게임) | 받아들임 | 이어서 모으기 확인을 겸함. M2의 근거가 됨 |
| 01-2 오래됨 경고를 라우트에서 | 받아들임 | 규칙 "요청 처리 중 보면"에 더 맞고 단위 테스트됨 |
| 01-3 `createApp(db, logger, { now })` | 받아들임 | 시계 주입으로 경계 시험 |
| 01-4 SAVEPOINT로 P0002 뒤 비교 | 받아들임 | 올바른 방법 |
| 01-5 집계 전 503을 실제 DB로 확인, 통합 테스트에서 `DELETE` 안 씀 | 받아들임 | 롤백이어도 삭제 문을 피한 것은 규칙과 맞다 |
| 01-6 미리보기는 잠금 없이 | 받아들임 | 읽기만 |
| 01-7 `newestRemoveStartAt` 추가 | 받아들임 | 삭제 범위 확인에 도움 |
| 01-8 `WINDOW_DAYS` 한 곳 | 받아들임 | 값이 두 곳에 갈라지지 않음 |
| 01-9 통합 테스트 추가 (`countMatchesSince`, 스냅숏 쓰기 거부) | 받아들임 | 창 상한 SQL과 ROLLBACK 경로를 실제로 시험 |

---

## 9. 코드 품질 메모

> 요약: 구조와 오류 처리가 계획대로 깔끔하다. SQL은 모두 매개변수이고, 비밀값은 한 곳에서 가린다. v1 죽은 코드는 없다.

| 관점 | 판단 |
|------|------|
| 구조 | 진입점 2개 분리, SQL은 `repositories/`에만, 변환은 순수 함수, `Queryable`로 롤백 시험 가능 |
| 오류 처리 | Riot 응답별 분류(401/403 즉시, 404·400 건너뜀, 429·5xx 재시도), 게임 단위 트랜잭션, API 오류 형식 하나. M1 고친 뒤 DB 끊김도 계획대로. L3·L4·L5는 권장 |
| 비밀값 | 로그 한 곳(`createLogger`)에서 `DATABASE_URL` 전체·비밀번호·사용자·호스트·키·`postgresql://`·`RGAPI-` 모양을 가림. 키는 헤더로만. puuid는 앞 8자. 실제 로그에서 호스트가 `***`로 나옴 |
| SQL 주입 | 모든 값이 `$n` 매개변수. 문자열로 붙이는 것은 상수(`LOCK_SQL_KEY`), 영숫자만 남기는 `statement_timeout`, 열 이름 상수뿐 |
| 연결 풀 | API `max 5`(동시 150요청에도 경고 0), CLI `max 2`(잠금 1 + 저장 1). 스냅숏은 BEGIN·ROLLBACK 실패 연결을 버림 |
| 죽은 코드 | v1 이름 0건. `inTransaction`·`usage()`·`seededRandom` 등은 모두 쓰임 |
| 테스트 | 단위 80개(실제 게임 fixture, 가짜 시계·fetch·풀), 통합 17개(실제 Supabase, 모두 ROLLBACK, 2021년 시각·가짜 패치로 실제 데이터와 안 섞임). 고정 시각을 써서 날짜가 지나도 깨지지 않음 |

---

## 10. 다음에 할 일

| # | 할 일 | 누가 |
|---|-------|------|
| 1 | 2026-10-14 20:00 UTC(10-15 05:00 KST) 뒤 `cron.job_run_details` `succeeded`와 `stats_window.aggregated_at` 갱신 확인 | 메인 에이전트 / 사용자 |
| 2 | M2: 테스트 수집 인원 결정 (추천: 티어당 250명), 계약 문구 반영 여부 | 사용자 |
| 3 | L1~L5 반영 여부를 다음 `!백엔드` 변경 Plan에서 정함 | 메인 에이전트 |
| 4 | L8 계약 변경 기록 날짜 정리 | 다음 `!백엔드` Plan/Build |
