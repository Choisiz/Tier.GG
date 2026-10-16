# DB 검토 기록 (`!db` Review)

- 이 문서는 **가장 최근 검토만** 둔다. 지금은 **변경 03 검토 (2026-10-14): 패치 기준 → 최근 14일 기준**이다.
- 이전 검토(v1, 변경 01, 변경 02)는 git 커밋 `87cfc78`의 `db/docs/db_review.md`에 있다. 아직 해결되지 않은 문제는 [`db_overview.md`](db_overview.md) "해결되지 않은 점"에 옮겨 두었다.
- 작성: Review 서브에이전트 (2026-10-14). Build 보고를 믿지 않고 실제 DB를 직접 조회·실행해 확인했다.
- 기준: `db/docs/db_spec.md` 변경 03 (승인됨, D13~D23, 되돌릴 수 없는 작업 1~4·6·7), `db/docs/db_build.md` 변경 03, 계약 v7 (`db_contract.md`, `db_contract.dbml`)
- 대상: Supabase PostgreSQL 17.11, Session pooler, 접속 계정 `postgres`(superuser 아님)
- **모든 샘플은 ROLLBACK 되는 트랜잭션 안에서만 실행했다.** 검토 전·후 줄 수 `matches` 0, `match_players` 0, `ranked_players` 3, `collection_logs` 3, 집계 7개 0. `cron.job` 1줄(jobid 1) 그대로.
- 검토용 스크립트는 scratchpad에만 두었다 (저장소에 넣지 않음).

## 목차

- [1. 종합 판정](#1-종합-판정)
- [2. 체크리스트](#2-체크리스트)
- [3. 직접 만든 롤백 시나리오](#3-직접-만든-롤백-시나리오)
- [4. 성능](#4-성능)
- [5. 예약 작업과 권한](#5-예약-작업과-권한)
- [6. 발견한 문제](#6-발견한-문제)
- [7. Review에서 고친 것](#7-review에서-고친-것)

---

## 1. 종합 판정

> 요약: **PASS.** 실제 DB 구조·함수·뷰·권한·예약 작업이 계약 v7·마이그레이션 파일과 같고, 직접 만든 롤백 시험 6개와 두 연결 잠금 시험이 모두 기대대로 나왔다. 정확성 결함이 없어 016은 만들지 않았다. pg_cron 기본 `PUBLIC` 권한은 `anon`·`authenticated`가 실제로 호출·조회할 수 없음을 `SET ROLE`로 확인했고, **기본값 유지**를 권했다.

| 구분 | 결과 |
|------|------|
| 판정 | **PASS** |
| Critical / High / Medium | 0 / 0 / 0 |
| Low | 6 (6장) |
| Review에서 고친 것 | 계약 `.md` 9장 요약 문구 1줄 (7장). 마이그레이션 016 만들지 않음 |
| 예약 작업 첫 실행 | 검토 시각(2026-10-14 11:36 UTC)에는 아직 없었다 (⚠️). **이후 확인:** 백엔드 수집 뒤 2026-10-14 20:00 UTC 3.3초, 2026-10-15 20:00 UTC 3.6초 모두 성공 (`db_overview.md`) |

---

## 2. 체크리스트

> 요약: spec 변경 03 완료 기준을 하나씩 직접 확인했다. 숫자는 모두 검토 때 조회·실행한 값이다.

| 항목 | 결과 | 근거 |
|------|------|------|
| 사용자 승인 기록 | ✅ | Build 기록에 되돌릴 수 없는 작업 1~4·6·7 승인, 5번(purge 실행) 하지 않음 |
| `migrate:status` | ✅ | 001~015 "적용됨" (011~015 2026-10-14 11:24 UTC), 체크섬 불일치 없음. `git diff db/migrations/` 출력 없음 (001~010 안 바뀜) |
| `migrate:fresh-check` | ✅ | 15개 파일 통과, 임시 스키마 테이블 11·뷰 1·함수 4, `migration_check` 남지 않음 |
| `verify` / `verify:fresh` | ✅ | 둘 다 10개 파일 통과 (001~004, 006~011). 검증 전·후 11개 테이블 줄 수 같음 |
| `matches.game_start_at` | ✅ | `timestamp with time zone`, NOT NULL, 기본값 없음. `matches_game_start_at_check` = `>= '2020-01-01 00:00:00+00'`. 주석에 `info.gameStartTimestamp` |
| 옛 객체 없음 | ✅ | `patch` 테이블, `refresh_patch_stats(text)`, `purge_old_patches(integer)` 모두 없음. public 함수는 4개뿐 |
| `stats_window` | ✅ | `id smallint DEFAULT 1`, `days int`, `window_start`·`window_end timestamptz`, `games int`, `aggregated_at DEFAULT now()`, 모두 NOT NULL. PK `(id)`, CHECK `id = 1`, `days 1~60`, `window_start < window_end`, `games > 0` |
| `stats_window_patch` | ✅ | `patch text`, `games int` NOT NULL, PK `(patch)`, CHECK `^[0-9]+\.[0-9]+$`, `games > 0` |
| 집계 5개 | ✅ | `patch` 컬럼 없음. PK·`champion_rune_page_key` UNIQUE 13개 컬럼·상세 4개 FK `(champion_id, position) → champion ON DELETE CASCADE`. CHECK 21개가 002·009와 같음 |
| 인덱스 | ✅ | PK·UNIQUE + `match_players_champion_id_team_position_idx`만. `matches.game_start_at` 인덱스 없음 (D21) |
| 함수 본문 md5 | ✅ | 롤백 트랜잭션 안 임시 스키마에 001~014를 적용해 비교. `refresh_window_stats`, `purge_old_games`, `patch_sort_key`, `tier_from_score` 4개 모두 실제 DB와 같음 |
| 함수 시그니처 | ✅ | `refresh_window_stats(p_days integer DEFAULT 14, p_until timestamptz DEFAULT now()) → jsonb`, `purge_old_games(p_keep_days integer DEFAULT 21) → integer`. 모두 `prosecdef = false`, `search_path=public, pg_catalog`, VOLATILE |
| 뷰 | ✅ | `pg_get_viewdef` md5가 014 적용 결과와 같음, `security_invoker=true`, 컬럼 12개(`patch` 없음) |
| RLS | ✅ | public 테이블 12개 켜짐, FORCE 아님, 정책 0개 |
| 권한 | ✅ | 테이블·뷰·시퀀스 `relacl` = `postgres`, `service_role`만. 함수 4개 `proacl` = `{postgres=X, service_role=X}`. `SET ROLE anon/authenticated`로 `stats_window`·뷰 SELECT, 함수 호출 모두 42501 |
| 006 자동 검사 | ✅ | NOTICE "테이블 12, 뷰 1, 시퀀스 2, 함수 4" = 기대값. `current_schema()` 전체 순회 |
| 직접 시험 | ✅ | 3장 R1~R7 |
| 5,000게임 측정 | ✅ | 4장 |
| 예약 작업 | ✅ / ⚠️ | 5장. 첫 실행 기록은 검토 뒤 확인 (1장) |
| 계약 v7 | ✅ | `.dbml`이 `dbmlv2`로 파싱됨: 테이블 11, Ref 6, TableGroup 원본 3·집계 7·운영 1. 실제 DB와 같음. `.md`에 옛 함수 이름·"각 50명"이 변경표 밖에 남지 않음. 9장 요약 1줄만 고침 (7장) |

---

## 3. 직접 만든 롤백 시나리오

> 요약: Build 테스트와 다른 시각·값으로 창 경계, 패치 구성, 상위 N, 밴, 0게임, 재집계, purge, 동시 호출을 다시 확인했다. 모두 기대대로다.

- 방법: 시나리오마다 `BEGIN` → 임시 함수 `pg_temp.add_game`(게임 1개 + 참가자 N줄) → 확인 → `ROLLBACK`. 샘플 시각은 2021년(R6만 `now()` 기준), ID는 `KR_97…`.

| # | 시나리오 | 결과 |
|---|----------|------|
| R1 | `p_until = 2021-03-01 12:00+00`, 14일. 시작 정확히 / 시작 − 1µs / 끝 − 1µs / 끝 정확히 / 미래 / 9줄 | ✅ 시작 정확히·끝 − 1µs만 포함, games 2. `p_days` 0·61·NULL, `p_until` NULL·`now() + 1µs` → 22023. `p_days = 60` 허용. 인자 오류 뒤 기존 스냅숏 그대로 |
| R2 | 패치 `16.10` 5게임, `16.9` 3, `15.24` 2 + 창 밖·8줄 게임 | ✅ 구성 합계 10 = `stats_window.games`. 반환 `patches`가 숫자 순(`16.10` > `16.9`) |
| R3 | 챔피언 900 TOP 30게임, 변형 12개 | ✅ 룬·스펠·스킬 각 10개, 동률은 승 → 키 오름차순. 스킬 14자 → 앞 11자. 아이템 전부, 한 줄 안 중복은 1번 |
| R4 | 같은 게임 두 명 밴 / 한 명 밴 / 창 밖 / 9줄 | ✅ `ban = 2`. 픽 없이 밴만 된 챔피언은 `champion` 줄 없음 (알려진 한계). 뷰 `ban_rate` 66.67 |
| R5 | 스냅숏을 만든 뒤 0게임 창 / 다른 창으로 재집계 | ✅ 0게임 → P0002, 스냅숏 전체 그대로. 재집계 뒤 7개 테이블 모두 교체 |
| R6 | `now() − 21일` 정확히 / `− 21일 − 1µs` / `− 14일` / 2021년 | ✅ `purge_old_games(21)` = 2, 정확히 21일은 남음, CASCADE, 집계·`ranked_players`·`collection_logs` 그대로, 두 번째 0. 13·NULL → 22023, 현재 창보다 짧으면 22023 |
| R7 | 두 연결: A가 집계 뒤 커밋 전 / B가 같은 함수 호출 | ✅ B는 `wait_event = advisory`로 기다리고, A `ROLLBACK` 뒤 진행. 차례 실행 확인 |

- 참고: 롤백해도 `champion_rune_id_seq`는 되돌아가지 않는다. bigint라 문제없다.

---

## 4. 성능

> 요약: 계약 순서(`ANALYZE` → 집계)로 5,000게임 집계가 **1.14초**였다. 창 거르기 추가로 느려지지 않았다.

- 데이터: 창 안 5,000게임(패치 0.8 40% / 0.9 60%) + 창 밖 500게임, 참가자 5만 5천 줄, 챔피언 160 × 포지션 5. 실행 계획: `tmp_games`는 Hash Join + HashAggregate, Nested Loop 아님.

| # | 아이템 분포 | `ANALYZE` | `refresh_window_stats(14, '2021-01-15+00')` | 결과 줄 수 |
|---|-------------|-----------|---------------------------------------------|-----------|
| 1 | 칸마다 150종 무작위 (과장) | 0.43초 | **4.17초** (같은 트랜잭션 재집계 4.49초) | item 106,329 |
| 2 | 챔피언마다 약 12종 (현실적) | 0.35초 | **1.14초** | item 11,200 |

- 시간은 아이템 줄 수에 가장 크게 좌우된다. 25,000게임에서도 5분 제한까지 여유가 크다.
- 죽은 줄: 측정 전 70MB → 트랜잭션 안 최대 116MB → 롤백 2회 뒤 108MB → autovacuum 뒤 77MB. 큰 측정은 2회로 끝냈다.

---

## 5. 예약 작업과 권한

> 요약: 작업 행은 spec 그대로다. `anon`·`authenticated`는 `cron` 스키마 USAGE가 없어 `cron.schedule`·`unschedule` 호출과 `cron.job` 조회가 모두 42501로 막힌다. `PUBLIC` EXECUTE는 실제로 쓸 수 없는 권한이고 `postgres`가 회수할 수도 없어 **기본값 유지**를 권했다.

| 항목 | 값 |
|------|----|
| `cron.job` | 1줄: `tiergg_daily_refresh`, `0 20 * * *`, `active = true`, `username postgres`, `database postgres` |
| `command` | `SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);` (015와 같음) |
| 설정 | `cron.timezone = GMT`, `cron.log_run = on`, launcher 실행 중 |
| 롤백 1회 실행 | 같은 명령을 `BEGIN` 안에서 실행 → 당시 원본 0게임이라 **P0002**. `ROLLBACK` 뒤 `stats_window` 0줄, `statement_timeout` 원래 값 |

실패가 보이는 곳:

- `cron.job_run_details`: 실행마다 1줄, `status`와 `return_message`. 대시보드 Integrations → Cron에서도 볼 수 있다.
- `stats_window.aggregated_at`: 성공한 마지막 집계 시각.
- **알림은 없다** (L7).
- 실패하면 명령 전체가 롤백되어 기존 스냅숏이 남는다 (R5와 롤백 실행으로 확인).

`PUBLIC` 권한 판단:

| 확인 | 결과 |
|------|------|
| 카탈로그 | `cron.schedule` 2종, `unschedule` 2종, `job_cache_invalidate()`에 `PUBLIC` EXECUTE(grantor `supabase_admin`). `cron.job`·`cron.job_run_details` PUBLIC 읽기 |
| 스키마 | `cron` ACL = `{supabase_admin=UC, postgres=U*}`. `anon`·`authenticated`·`authenticator`·`service_role` 모두 USAGE 없음 |
| `SET ROLE anon` / `authenticated` | `cron.schedule`·`unschedule`·`cron.job`·`cron.job_run_details` 6개 모두 42501 |
| 2중 방어 | `cron.job`·`cron.job_run_details`에 RLS(`username = CURRENT_USER`) |
| 회수 가능 여부 (실행하지 않음) | grantor가 확장 주인이라 `postgres`의 `REVOKE … FROM PUBLIC`은 효과가 없을 것으로 본다 |

- **권고: 기본값 유지, REVOKE 마이그레이션은 만들지 않는다.** 진짜 위험은 누군가 `cron` 스키마 USAGE를 주는 것인데, 테스트 011이 그 경우 실패한다.

---

## 6. 발견한 문제

> 요약: Low 6건. "지금 상태" 칸은 2026-10-16 기준이다. 열린 문제는 `db_overview.md` "해결되지 않은 점"에도 있다.

| # | 심각도 | 내용 | 권고 | 지금 상태 |
|---|--------|------|------|-----------|
| L7 | Low | 예약 작업 실패에 알림이 없다 | 백엔드 `/health`·`/meta`에 `aggregatedAt` 노출 | 열림. 백엔드 API가 `aggregatedAt`·`isStale`을 내보냄, 알림은 계획 없음 (overview 4) |
| L8 | Low | pg_cron 기본 `PUBLIC` EXECUTE·읽기 권한 | 기본값 유지 | 결정됨: 기본값 유지 (`db_spec.md` 결정 사항) |
| L9 | Low | 테스트 011의 직접 부여 검사가 `schedule(text,text,text)`·`unschedule(bigint)` 2개만 본다. 스키마 USAGE 검사가 막고 있어 지금 위험은 없다 | 다음 테스트 수정 때 `cron` 함수 전체로 | 열림 (overview 11) |
| L10 | Low | DB의 `ranked_players` 테이블 주석이 "각 50명"이다 | 다음 마이그레이션에서 주석만 | 열림 (overview 3) |
| L11 | Low | 백엔드가 `stats_window`와 집계를 다른 문장으로 읽으면 05:00 커밋 순간에 스냅숏이 섞일 수 있다 | 한 요청의 읽기를 `REPEATABLE READ` 트랜잭션 등으로 묶기 | 해결: 백엔드가 `REPEATABLE READ READ ONLY` 트랜잭션 하나로 읽음 (`backend/src/db/snapshot.ts`) |
| L12 | Low | 계약 11장 보안에 `cron` 스키마 권한 판단이 없다 | 다음 계약 수정 때 한 줄 추가 | 열림 (overview 10) |
| 참고 | - | 집계 시간은 아이템 줄 수에 비례한다 | 본 수집 뒤 `item_rows`와 `cron.job_run_details` 실행 시간 확인 | 지금 3.3~3.6초 |

---

## 7. Review에서 고친 것

| 파일 | 내용 | 이유 |
|------|------|------|
| `docs/contracts/db_contract.md` 9장 요약 (문구만) | "백엔드는 … 다시 만들고" → "매일 DB 예약 작업(pg_cron, 9-4)이 `ANALYZE` 뒤에 `refresh_window_stats(14)`로 … 다시 만든다 (백엔드 `aggregate`는 시험용으로 같은 순서). 백엔드는 사용자 확인 뒤 `purge_old_games(21)`…" | 같은 장 9-4·10장 14번("수집 뒤 자동 집계 없음")과 어긋나 백엔드가 수집 뒤 집계를 다시 넣을 수 있었다. 규칙·값은 바꾸지 않았다 |

- 마이그레이션·함수·테스트는 고치지 않았다. 016 없음.
