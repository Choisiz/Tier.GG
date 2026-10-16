# DB 구현 상태 (`!db` Build)

- 기준: `db/docs/db_spec.md` (현재 계획), 계약 `docs/contracts/db_contract.md` / `db_contract.dbml` **v7**
- 대상 DB: Supabase PostgreSQL 17.11, Session pooler, 접속 계정 `postgres` (superuser 아님)
- 마지막 반영: 변경 03 Build·Review (2026-10-14), 운영 수치는 2026-10-16 현재 상태 문서 기준
- 이 문서는 **지금 구현 상태만** 둔다. 예전 시도·편차·측정 기록은 git 커밋 `87cfc78`의 `db/docs/db_build.md`에 있다.
- 상태 표기: ✅ 완료 / ⚠️ 부분 완료 / ❌ 실패 / ⏸️ 보류

## 목차

- [1. 마이그레이션 실행기](#1-마이그레이션-실행기)
- [2. 마이그레이션 파일](#2-마이그레이션-파일)
- [3. 테이블과 제약 조건](#3-테이블과-제약-조건)
- [4. 인덱스](#4-인덱스)
- [5. 보안](#5-보안)
- [6. 함수와 뷰](#6-함수와-뷰)
- [7. 매일 자동 집계](#7-매일-자동-집계)
- [8. 테스트](#8-테스트)
- [9. 계약 반영](#9-계약-반영)
- [10. 실행 명령](#10-실행-명령)
- [11. 현재 검증 결과](#11-현재-검증-결과)
- [12. 구현 세부 규칙](#12-구현-세부-규칙)
- [13. 남은 문제](#13-남은-문제)

---

## 1. 마이그레이션 실행기

> 요약: `db/scripts/`의 Node 실행기가 파일을 순서대로 적용하고 체크섬으로 적용된 파일의 수정을 막는다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 의존성 | `db/package.json`에 `pg` `^8.23.1` 하나 (`package-lock.json` 고정). `dotenv` 없이 `node --env-file=../.env` | ✅ |
| `up` | 이름 규칙 `^\d{3}_[a-z0-9_]+\.sql$`, 이름순, 기록에 없는 파일만. 파일 1개 = 트랜잭션 1개, 실패하면 ROLLBACK 후 멈춤. 파일마다 `SET LOCAL search_path = public, pg_catalog`. advisory lock으로 동시 실행 방지 | ✅ |
| `status` | 파일별 적용 시각, 체크섬 불일치, 기록에만 있는 파일 출력 | ✅ |
| 체크섬 검사 | sha256. 적용된 파일이 바뀌면 아무것도 적용하지 않고 exit 1 | ✅ |
| `fresh-check` | 임시 스키마 `migration_check`에 001부터 전부 적용(파일마다 SAVEPOINT), 항상 ROLLBACK, 끝난 뒤 스키마 잔존 확인 | ✅ |
| `schema_migrations` | `filename` PK, `checksum`, `applied_at`. RLS 켜짐, `anon`·`authenticated` 권한 회수 | ✅ |
| `MIGRATIONS_DIR` | 폴더를 바꿔 체크섬 검사를 복사본으로 시험 (운영에서 쓰지 않음) | ✅ |
| 비밀값 가리기 | `scripts/lib.mjs` `secretsToHide()`: 접속 문자열 전체, 비밀번호·사용자 이름(원문과 디코딩 형태), 호스트를 `***`로. 잘못된 `%` 인코딩이 있어도 나머지는 가려짐 | ✅ |
| `verify.mjs` | `db/tests/*.sql`을 파일마다 `BEGIN … ROLLBACK`. `TABLES` 11개(원본 3, 운영 1, 집계 7)의 전후 줄 수 비교. `--fresh`면 임시 스키마에 마이그레이션부터 적용 | ✅ |

---

## 2. 마이그레이션 파일

> 요약: 001~015가 실제 DB에 적용되어 있고 체크섬 불일치가 없다. 다음 파일은 016이다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `001_create_raw_tables.sql` | 원본 3개 + `collection_logs`, CHECK, Riot JSON 경로 주석 | ✅ |
| `002_create_aggregate_tables.sql` | 패치 기준 집계 6개 (012에서 삭제됨) | ✅ |
| `003_create_indexes.sql` | `match_players_champion_id_team_position_idx` | ✅ |
| `004_enable_rls.sql` | RLS 켜기, 테이블·시퀀스 권한 회수 | ✅ |
| `005_create_helper_functions.sql` | `patch_sort_key`, `tier_from_score` (+ 009에서 지운 옛 스킬 함수) | ✅ |
| `006_create_refresh_patch_stats.sql` | 패치 기준 집계 함수 (012에서 삭제됨) | ✅ |
| `007_create_purge_old_patches.sql` | 패치 기준 정리 함수 (012에서 삭제됨) | ✅ |
| `008_create_champion_tier_view.sql` | 패치 기준 티어 뷰 (012에서 삭제됨) | ✅ |
| `009_skill_order_prefix.sql` | 집계 줄이 있으면 멈추는 안전장치 → `champion_skill.skill_order` + `^[QWER]{11}$` CHECK, 스킬 집계 앞 11글자·상위 10개, 옛 스킬 함수 삭제 | ✅ |
| `010_ranked_players_platinum.sql` | `ranked_players_tier_check`를 같은 이름으로 다시 만들어 `PLATINUM` 허용 (`NOT VALID` 없음) | ✅ |
| `011_matches_game_start_at.sql` | 안전장치(`matches` 26줄 초과, 16.19·16.20 밖 패치, `match_players` 260줄 초과면 중단) → 테스트 26게임 삭제 → `game_start_at timestamptz NOT NULL` + `>= 2020-01-01` CHECK, 주석 | ✅ |
| `012_window_aggregate_tables.sql` | 안전장치(`sum(patch.games) > 26`이면 중단) → 옛 뷰·함수 2개·집계 6개 DROP → `stats_window`, `stats_window_patch`, 집계 5개 CREATE → RLS → 7개 테이블 + `champion_rune_id_seq` `REVOKE` | ✅ |
| `013_create_window_functions.sql` | `refresh_window_stats`, `purge_old_games`, 주석, `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` | ✅ |
| `014_create_champion_tier_view.sql` | `champion CROSS JOIN stats_window` 뷰, `security_invoker`, 주석, `REVOKE ALL` | ✅ |
| `015_schedule_daily_refresh.sql` | `CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog`, 같은 이름 작업 `unschedule` 뒤 `tiergg_daily_refresh` 등록 | ✅ |

- 011·012의 삭제와 015의 지속 설정은 사용자 승인(2026-10-14) 뒤 적용했다. 실제 DB에서 `purge_old_games`는 Build·Review가 실행한 적 없다.

---

## 3. 테이블과 제약 조건

> 요약: 테이블 11개 + `schema_migrations`가 계약 v7과 같다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 원본 3개 + 운영 1개 | `ranked_players`, `matches`(`game_start_at` 포함), `match_players`, `collection_logs`. 컬럼 이름·순서·타입·NULL이 dbml v7과 같음 | ✅ |
| 집계 7개 | `stats_window`(항상 0~1줄), `stats_window_patch`, `champion`, `champion_item`, `champion_rune`, `champion_spell`, `champion_skill`. 집계 5개에 `patch` 컬럼 없음 | ✅ |
| PK / 유니크 | 모든 테이블 PK, 유니크 `champion_rune_page_key` (`champion_id`, `position`, 룬 11개) | ✅ |
| FK와 삭제 동작 | `matches.puuid` → `ranked_players` SET NULL, `match_players.match_id` → `matches` CASCADE, 상세 4개 `(champion_id, position)` → `champion` CASCADE | ✅ |
| CHECK | 포지션, 티어(`PLATINUM`~`CHALLENGER`)·랭크, 패치 형식, `KR_` 게임 ID, `game_start_at >= 2020-01-01`, 원본 `skill_order ~ '^[QWER]*$'`, 아이템 ≥ 0, 밴 > 0, 개수(`pick > 0`, `0 ≤ win ≤ pick`), `spell1_id < spell2_id`, 집계 `skill_order ~ '^[QWER]{11}$'`, `stats_window`(id 1, days 1~60, 시작 < 끝, games > 0), `stats_window_patch`(형식, games > 0), `collection_logs` 상태·시각·개수 | ✅ |
| 주석 | 원본 컬럼에 Riot JSON 경로, 집계·뷰 컬럼 설명 | ⚠️ `ranked_players` 테이블 주석이 아직 "각 50명" (13장 1) |

---

## 4. 인덱스

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 일반 인덱스 | `match_players_champion_id_team_position_idx` 1개. 나머지는 PK·유니크. `matches.game_start_at` 인덱스 없음 (결정 D21) | ✅ |

---

## 5. 보안

> 요약: 브라우저용 역할(`anon`, `authenticated`)은 public의 어떤 객체도 읽거나 부를 수 없다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| RLS | public 테이블 12개(`schema_migrations` 포함) 켜짐, FORCE 아님, 정책 0개 | ✅ |
| 테이블·뷰 권한 | `anon`·`authenticated` 회수. `relacl`은 `postgres`, `service_role`만 | ✅ |
| 시퀀스 권한 | `collection_logs_id_seq`, `champion_rune_id_seq` 회수 | ✅ |
| 함수 권한 | 4개 모두 `proacl = {postgres=X, service_role=X}` (`PUBLIC`·`anon`·`authenticated` 없음) | ✅ |
| 뷰 | `security_invoker = true` | ✅ |
| 주인 | 모든 객체 `postgres` | ✅ |
| pg_cron 권한 | 확장 기본 `PUBLIC` EXECUTE(`cron.schedule`·`unschedule` 등)와 `cron.job` PUBLIC 읽기는 그대로 둠 (결정 사항). `anon`·`authenticated`는 `cron` 스키마 USAGE가 없어 호출·조회 모두 42501 | ✅ |

---

## 6. 함수와 뷰

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `refresh_window_stats(p_days integer DEFAULT 14, p_until timestamptz DEFAULT now()) → jsonb` | 인자 검사(22023) → advisory lock → 남은 임시 테이블 정리 → 창 안 10줄 게임 → 0개면 P0002 → `DELETE … WHERE true` 3개 → `stats_window`·`stats_window_patch`·집계 5개 INSERT → jsonb 반환 (`patches`는 `patch_sort_key` 내림차순) | ✅ |
| 집계 규칙 | 아이템 전부(한 줄 중복 1번), 룬·스펠·스킬 상위 10개(`pick DESC, win DESC, 키 ASC`), 스펠 같은 번호 줄 제외, 스킬 앞 11글자·11자 미만 제외, 밴은 게임당 1번(포지션 NULL 줄 포함) | ✅ |
| `purge_old_games(p_keep_days integer DEFAULT 21) → integer` | NULL·14 미만·현재 창보다 짧으면 22023, `game_start_at < now() − p_keep_days × 24시간` 삭제(CASCADE), 지운 수 반환 | ✅ |
| `patch_sort_key(text) → int[]` | SQL, IMMUTABLE | ✅ |
| `tier_from_score(numeric) → smallint` | SQL, IMMUTABLE. 53.0 / 51.5 / 50.0 / 48.5, NULL → NULL | ✅ |
| `champion_tier_view` | 컬럼 12개(`champion_id`, `position`, `pick`, `win`, `ban`, `games`, `win_rate`, `pick_rate`, `ban_rate`, `adjusted_win_rate`, `tier_score`, `tier`). 분모 `stats_window.games`, 티어는 반올림 전 점수, 50판 미만 NULL | ✅ |
| 공통 | 모두 `SECURITY INVOKER`, `search_path=public, pg_catalog` | ✅ |

---

## 7. 매일 자동 집계

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 확장 | `pg_cron` 1.6.4, 스키마 `pg_catalog` (작업 테이블은 `cron` 스키마). `cron.timezone = GMT` | ✅ |
| 작업 | `cron.job` 1줄: `tiergg_daily_refresh`, `0 20 * * *`(05:00 KST), `active`, `username postgres`, `database postgres` | ✅ |
| 명령 | `SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);` | ✅ |
| 실제 실행 | 2026-10-14 20:00 UTC 성공 3.3초, 2026-10-15 20:00 UTC 성공 3.6초 (약 3,800~3,950게임, `ANALYZE` 포함) | ✅ |
| 실패 알림 | 없음. `cron.job_run_details`와 `stats_window.aggregated_at`을 직접 봐야 함 | ⏸️ (계획 없음) |

---

## 8. 테스트

> 요약: 10개 파일이 실제 스키마(`verify`)와 임시 스키마(`verify:fresh`)에서 모두 통과한다. 모두 롤백된다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `001_storage_format.sql` | 실제 예시 1행, 거부 15건, 허용 값, SET NULL·CASCADE, `stats_window` 기본값. 실제 `KR_8408851980`이 있으면 `[건너뜀]` | ✅ |
| `002_helper_functions.sql` | `patch_sort_key`, `tier_from_score` 경계 | ✅ |
| `003_refresh_window_stats.sql` | 샘플 20게임(2021-01-10) 기대값, 멱등, P0002에 스냅숏 유지, 인자 오류 5건 | ✅ |
| `004_champion_tier_view.sql` | 손 계산값, `pick` 49 → NULL, `stats_window` 0줄 → 뷰 0줄 | ✅ |
| `006_security.sql` | 스키마 전체 자동 검사. 기대 개수 테이블 12, 뷰 1, 시퀀스 2, 함수 4 | ✅ |
| `007_skill_order.sql` | 앞 11글자, 상위 10개·동률, CHECK 거부, 구조 | ✅ |
| `008_ranked_players_tier.sql` | 허용 6, 거부 6, CHECK 정의, `PLATINUM` 표본 참조 | ✅ |
| `009_window_boundary.sql` | 창 경계 A~H, 패치 구성, 뷰 분모, `p_days = 1` 재집계 | ✅ |
| `010_purge_old_games.sql` | 21일 경계, CASCADE, 집계 유지, 인자 오류 3건, 두 번째 0 | ✅ |
| `011_daily_refresh_job.sql` | 확장, 작업 1개, 일정, 명령, 계정·DB, `cron` USAGE 없음, 직접 부여 없음(`PUBLIC`은 `[주의]` NOTICE) | ⚠️ 직접 부여 검사가 `schedule(text,text,text)`·`unschedule(bigint)` 2개만 봄 (13장 2) |

- 테스트 번호 005는 비어 있다 (옛 패치 정리 테스트를 지우고 010으로 대체).

---

## 9. 계약 반영

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `db_contract.md` v7 | 수집·보관(14일 창, 21일), 테이블 11개, ERD, 수집 흐름(pg_cron 집계, 수동 purge), 저장 규칙(`game_start_at`), 인덱스, 9장 함수·뷰·호출 규칙, 10장 확정 사항, 11장 기본 권한 문장 | ✅ |
| `db_contract.dbml` v7 | 테이블 11개, Ref 6개, TableGroup 원본 3·집계 7·운영 1. `@dbml/core`의 `dbmlv2` 파서로 파싱 확인 (예전 `dbml` 파서는 `TableGroup … [color]` 줄에서 오류) | ✅ |
| `.md` ↔ `.dbml` | 컬럼·타입·NOT NULL·기본값·PK·UNIQUE가 서로, 그리고 실제 DB와 같음 | ✅ |
| 남은 문구 | 테스트 인원 문구(100명)가 실제 수집(250명)과 다름, 11장에 pg_cron 권한 판단 없음, 9-4 `ANALYZE` 이유 칸에 5,000게임 근거 없음 | ⚠️ (13장) |

---

## 10. 실행 명령

> 요약: 모두 `db/` 폴더에서 실행한다. `.env`는 저장소 루트에 있다.

| 명령 | 동작 |
|------|------|
| `npm install` | `pg` 설치 |
| `npm run migrate` | 적용하지 않은 파일만 적용 |
| `npm run migrate:status` | 적용 여부·체크섬 확인 |
| `npm run migrate:fresh-check` | 임시 스키마에 001부터 적용해 보고 롤백 |
| `npm run verify` | 실제 스키마에서 테스트 (항상 롤백, 전후 줄 수 비교) |
| `npm run verify:fresh` | 임시 스키마에 마이그레이션 + 테스트 (항상 롤백). 실제 적용 전 확인용 |

- 새 마이그레이션 적용 순서: `migrate:fresh-check` → `verify:fresh` → (삭제·지속 설정이면 사용자 승인 확인) → `migrate` → `verify`.

---

## 11. 현재 검증 결과

> 요약: 마지막 Build·Review(2026-10-14) 결과와 2026-10-16 읽기 전용 조회 값이다.

| 항목 | 결과 |
|------|------|
| `migrate:status` | 001~015 적용됨 (011~015는 2026-10-14 11:24 UTC), 체크섬 불일치 없음 |
| `migrate:fresh-check` | 15개 파일 통과, 임시 스키마 테이블 11·뷰 1·함수 4, `migration_check` 남지 않음 |
| `verify` / `verify:fresh` | 10개 파일 모두 통과, 전후 줄 수 같음 |
| 함수·뷰 본문 | 실제 DB 본문 md5가 001~014 적용 결과와 같음 (Review 확인) |
| 동시 호출 | 두 연결에서 두 번째 `refresh_window_stats`가 advisory lock을 기다린 뒤 진행 (Review 확인) |
| 성능 (롤백, 5,000게임) | `ANALYZE` 0.35초 → 집계 1.14초 (아이템 줄 1.1만). 아이템 종류를 과장한 분포(10.6만 줄) 4.17초 |
| 실제 예약 작업 | 2026-10-14 3.3초, 2026-10-15 3.6초, 모두 성공 |
| 원본 (2026-10-16) | 표본 765명 (플래티넘 250, 에메랄드 265, 다이아 250), 게임 3,975개, 참가자 39,750줄 |
| 집계 (2026-10-16) | 창 2026-10-01 20:00 ~ 2026-10-15 20:00 UTC, 3,789게임 (16.20: 2,640 / 16.19: 1,149), `champion` 606줄 중 티어 있는 줄 187개 |
| DB 크기 | 90MB / 500MB (`match_players` 60MB, 그중 인덱스 51MB) |

---

## 12. 구현 세부 규칙

> 요약: 계획에 없던 세부 동작 중 지금도 코드에 남아 있고 다음 작업자가 알아야 할 것이다.

| # | 내용 | 이유 |
|---|------|------|
| 1 | 집계 함수의 인자 검사는 잠금보다 먼저 한다 | NULL 인자면 잠금 키 계산이 의미 없고, 검사는 DB를 읽지 않음 |
| 2 | 집계 함수 시작 때 `pg_temp.tmp_games`·`tmp_base`가 있으면 지운다 | `ON COMMIT DROP`이라 같은 트랜잭션에서 두 번 부르면 "이미 있음" 오류가 나므로 |
| 3 | 집계 `DELETE`는 `WHERE true`를 붙인다 | `safeupdate`가 켜진 연결에서도 막히지 않게 |
| 4 | 마이그레이션 머리 주석에 "함수 본문 안의 `DELETE`는 호출될 때만 실행"을 적는다 | 지우는 SQL을 `grep`으로 검사할 때 오해하지 않게 |
| 5 | 테스트 001은 실제 예시 게임 ID가 DB에 있으면 건너뛴다 | 키가 겹침. 그때는 `verify:fresh`로 같은 검사를 한다 |
| 6 | 테스트 011은 `PUBLIC`으로 온 cron EXECUTE를 실패가 아니라 `[주의]` NOTICE로 남긴다 | pg_cron 기본값이고 스키마 USAGE에서 막힘. USAGE나 직접 부여가 생기면 실패 |
| 7 | 성능 측정 스크립트는 scratchpad에만 둔다 | 저장소에 측정용 코드를 남기지 않음 |

---

## 13. 남은 문제

> 요약: 동작을 막는 문제는 없다. 전체 목록은 [`db_overview.md`](db_overview.md) "해결되지 않은 점"이 기준이다. 아래는 Build 산출물에 직접 걸린 것만이다.

| # | 내용 | 상태 |
|---|------|------|
| 1 | `ranked_players` 테이블 주석이 "각 50명"이다. 다음 마이그레이션(016~)에서 주석만 바꾼다 | ⏸️ |
| 2 | 테스트 011의 cron 직접 부여 검사를 `cron` 스키마 함수 전체로 넓힌다 | ⏸️ |
| 3 | 계약 문구 3건(테스트 인원, 11장 pg_cron 권한, 9-4 이유 칸)을 다음 계약 수정 때 고친다 | ⏸️ |
