# DB 계획 (`!db`)

- 상태: **현재 계획** (계약 v7, 마이그레이션 001~015 적용됨, 2026-10-14 승인분까지 반영)
- 기준 계약: `docs/contracts/db_contract.dbml` (우선), `docs/contracts/db_contract.md`
- 대상: Supabase 무료 플랜, PostgreSQL 17, Session pooler 접속
- 이 문서는 **지금 유효한 계획만** 둔다. 바뀐 계획은 덮어쓴다. v1과 변경 01~03의 원문은 git 커밋 `87cfc78`의 `db/docs/db_spec.md`에 있다 (CLAUDE.md 6장 "영역 문서 관리").
- 다음 변경은 이 문서 맨 아래에 `## 이번 변경 (승인 대기)` 절을 임시로 쓰고, Build가 끝나면 본문에 합친 뒤 지운다.

## 목차

- [1. 개요](#1-개요)
- [2. 마이그레이션 방식](#2-마이그레이션-방식)
- [3. 마이그레이션 파일 목록](#3-마이그레이션-파일-목록)
- [4. 테이블](#4-테이블)
- [5. 인덱스](#5-인덱스)
- [6. RLS와 권한](#6-rls와-권한)
- [7. 집계 SQL 함수와 뷰](#7-집계-sql-함수와-뷰)
- [8. 매일 자동 집계 (pg_cron)](#8-매일-자동-집계-pg_cron)
- [9. 수집 범위와 용량](#9-수집-범위와-용량)
- [10. 테스트](#10-테스트)
- [11. 완료 기준](#11-완료-기준)
- [12. 결정 사항](#12-결정-사항)
- [13. 작업 범위](#13-작업-범위)
- [14. 알려진 한계](#14-알려진-한계)

---

## 1. 개요

> 요약: Riot 게임 원본을 쌓고, 매일 한 번 **최근 14일에 시작한 게임**으로 챔피언 통계를 통째로 다시 만든다. 집계는 현재 창 스냅숏 1개만 둔다. 비율과 티어는 저장하지 않고 뷰에서 계산한다.

### 포함 (`!db` 담당)

| 항목 | 내용 |
|------|------|
| 테이블 | 원본 3 (`ranked_players`, `matches`, `match_players`), 집계 7 (`stats_window`, `stats_window_patch`, `champion`, `champion_item`, `champion_rune`, `champion_spell`, `champion_skill`), 운영 1 (`collection_logs`) + 실행기 메타 `schema_migrations` |
| 제약 조건 | PK, FK(삭제 동작 포함), 유니크, NOT NULL, 기본값, CHECK(허용 값, 범위, 형식) |
| 인덱스 | PK·유니크 + `match_players (champion_id, team_position)` 1개 |
| 보안 | 모든 테이블 RLS 켜기, 정책 없음, `anon`·`authenticated` 권한 회수 |
| 함수 | `refresh_window_stats`, `purge_old_games`, 보조 `patch_sort_key`, `tier_from_score` |
| 뷰 | `champion_tier_view` |
| 예약 작업 | `pg_cron` 작업 `tiergg_daily_refresh` (매일 05:00 KST) |
| 도구 | Node 마이그레이션 실행기, 롤백되는 검증 SQL |

### 포함하지 않음

| 항목 | 담당 |
|------|------|
| Riot API 수집 워커, timeline → `skill_order` 변환, 밴 매핑, 표본 인원 설정 | `!백엔드` (계약 7장) |
| `purge_old_games` 실행 (사용자 확인 뒤), 시험용 `aggregate` 명령, 읽기 API | `!백엔드` |
| 상세 조합 비율, 패치 구성 비율(%) 계산, 주 포지션 규칙 | `!백엔드` |
| 이름·이미지, 하위 재료 아이템 거르기 | `!프론트` (Data Dragon) |

---

## 2. 마이그레이션 방식

> 요약: `pg` 패키지 하나만 쓰는 작은 Node 실행기로 SQL 파일을 순서대로 적용하고, 적용한 파일과 체크섬을 `schema_migrations`에 기록한다.

### 2-1. 도구

- Node v24 (`--env-file` 기본 지원). `psql`, Supabase CLI는 쓰지 않는다 (설치되어 있지 않음, 폴더 규칙이 다름).
- 의존성은 **`pg`** (node-postgres 8.x) 하나. `package-lock.json`으로 고정. `dotenv` 없이 `node --env-file=../.env`로 루트 `.env`를 읽는다.
- `DATABASE_URL` 값은 로그·문서·오류 메시지에 출력하지 않는다. 실행기가 오류 메시지의 접속 문자열·비밀번호·사용자·호스트를 `***`로 가린다 (`scripts/lib.mjs`).
- SSL: 접속 문자열 그대로 쓴다. 인증서 문제로 실패하면 검증을 끄지 말고 메인 에이전트에게 보고한다.

### 2-2. 파일과 명령

| 경로 | 내용 |
|------|------|
| `db/package.json` | `"type": "module"`, 의존성 `pg`, npm 스크립트 |
| `db/scripts/lib.mjs` | 접속, 비밀값 가리기 (공통) |
| `db/scripts/migrate.mjs` | 실행기 (`up`, `status`, `fresh-check`) |
| `db/scripts/verify.mjs` | `db/tests/*.sql`을 파일마다 `BEGIN … ROLLBACK` 안에서 실행, 전후 줄 수 비교 (`TABLES` 목록). `--fresh`면 임시 스키마에 마이그레이션부터 적용 |
| `db/migrations/NNN_설명.sql` | 마이그레이션 |
| `db/tests/NNN_설명.sql` | 샘플 데이터 + 기대값 검사 (틀리면 `RAISE EXCEPTION`) |

| npm 스크립트 (`db/`에서) | 동작 |
|--------------------------|------|
| `npm run migrate` | 아직 적용하지 않은 파일만 순서대로 적용 |
| `npm run migrate:status` | 파일별 적용 여부, 체크섬 불일치 출력 |
| `npm run migrate:fresh-check` | 임시 스키마에 001부터 전부 적용해 보고 **항상 롤백** |
| `npm run verify` | 실제 스키마에서 검증 SQL 실행 (항상 롤백) |
| `npm run verify:fresh` | 임시 스키마에 마이그레이션을 적용한 뒤 검증 SQL 실행 (항상 롤백) |

### 2-3. 실행기 규칙

- `schema_migrations`: `filename text PK`, `checksum text NOT NULL`(sha256), `applied_at timestamptz NOT NULL DEFAULT now()`. RLS 켜짐, `anon`·`authenticated` 권한 회수.
- 파일 이름 규칙 `^\d{3}_[a-z0-9_]+\.sql$`. 이름 오름차순으로, 기록에 없는 파일만 적용한다. **새 파일 번호는 항상 마지막 번호보다 크게** 붙인다 (실행기는 작은 번호의 새 파일도 경고 없이 적용한다).
- 파일 1개 = 트랜잭션 1개 (`BEGIN` → 실행 → 기록 → `COMMIT`). 실패하면 `ROLLBACK` 후 멈춘다. advisory lock으로 실행기 동시 실행을 막는다.
- `up`은 파일마다 `SET LOCAL search_path = public, pg_catalog`를 먼저 실행한다. 그래서 함수의 `SET search_path FROM CURRENT`가 `public, pg_catalog`로 고정된다.
- **적용된 파일은 절대 고치지 않는다.** 체크섬이 달라지면 실행기가 아무것도 적용하지 않고 오류로 멈춘다. 변경은 항상 새 번호 파일로 한다 (함수·뷰는 새 파일에서 `CREATE OR REPLACE`, 컬럼이 바뀌는 뷰는 지우고 다시 만듦).
- `fresh-check`: 트랜잭션 1개 안에서 `CREATE SCHEMA migration_check` → `SET LOCAL search_path = migration_check, pg_catalog` → 파일마다 SAVEPOINT를 두고 전체 실행 → 항상 `ROLLBACK`.
  - 그래서 마이그레이션 SQL에는 **`public.` 접두사를 쓰지 않는다.** 함수는 `SET search_path FROM CURRENT`로 만든다.
  - `ON ALL TABLES IN SCHEMA public` 같은 스키마 전체 명령은 쓰지 않는다 (실제 스키마를 건드리므로). 객체 이름을 하나씩 적는다.
- `MIGRATIONS_DIR` 환경 변수로 폴더를 바꿀 수 있다. 체크섬 검사 시험용이며 운영에서는 쓰지 않는다.

### 2-4. 되돌릴 수 없는 SQL

- 테이블 삭제, 데이터 삭제(`DELETE`, `TRUNCATE`, `DROP TABLE`, `DROP FUNCTION` 등), 확장 켜기·예약 작업 등록 같은 지속 설정은 **실행 전에 메인 에이전트를 통해 사용자 승인**을 받는다.
- 삭제가 있는 마이그레이션은 **안전장치를 먼저 둔다**: 지울 대상이 계획한 조건(줄 수, 값 범위)과 다르면 `RAISE EXCEPTION`으로 파일 전체를 멈춘다 (예: 011의 "26줄 초과면 중단").
- 실제 DB에서 `purge_old_games`를 실행하는 것도 삭제다. Build·Review는 롤백 트랜잭션 안에서만 부른다.

---

## 3. 마이그레이션 파일 목록

> 요약: 001~015가 적용되어 있다. 앞 파일 중 일부(002, 005~008)가 만든 객체는 뒤 파일(009, 012)이 바꾸거나 지웠다. 지금 DB의 모양은 4~8장이 기준이다.

| 파일 | 하는 일 | 지금 남은 결과 |
|------|---------|----------------|
| `001_create_raw_tables.sql` | 원본 3개 + `collection_logs`, CHECK, Riot JSON 경로 주석 | 그대로 (뒤 파일이 CHECK·컬럼 추가) |
| `002_create_aggregate_tables.sql` | 패치 기준 집계 테이블 6개 | 012가 모두 지움 |
| `003_create_indexes.sql` | `match_players_champion_id_team_position_idx` | 그대로 |
| `004_enable_rls.sql` | RLS 켜기, 테이블·시퀀스 권한 회수 | 원본·운영 테이블에 그대로 |
| `005_create_helper_functions.sql` | `patch_sort_key`, `tier_from_score` (+ 옛 스킬 함수) | 보조 함수 2개 그대로 |
| `006_create_refresh_patch_stats.sql` | 패치 기준 집계 함수 | 012가 지움 |
| `007_create_purge_old_patches.sql` | 패치 기준 정리 함수 | 012가 지움 |
| `008_create_champion_tier_view.sql` | 패치 기준 티어 뷰 | 012가 지움 |
| `009_skill_order_prefix.sql` | 스킬 집계를 앞 11레벨로, 옛 스킬 함수 삭제 | 규칙은 013에 이어짐 |
| `010_ranked_players_platinum.sql` | `ranked_players.tier`에 `PLATINUM` 허용 | 그대로 |
| `011_matches_game_start_at.sql` | 테스트 26게임 삭제(안전장치) 뒤 `matches.game_start_at NOT NULL` 추가 | 그대로 |
| `012_window_aggregate_tables.sql` | 옛 뷰·함수·집계 테이블 삭제(안전장치), `stats_window`·`stats_window_patch`·집계 5개 생성, RLS, `REVOKE` | 그대로 |
| `013_create_window_functions.sql` | `refresh_window_stats`, `purge_old_games`, `REVOKE EXECUTE` | 그대로 |
| `014_create_champion_tier_view.sql` | 14일 창 기준 `champion_tier_view`, `REVOKE` | 그대로 |
| `015_schedule_daily_refresh.sql` | `pg_cron` 켜기, 작업 `tiergg_daily_refresh` 등록 | 그대로 |

- 다음 파일은 `016_….sql`이다.
- 테이블·컬럼에 `COMMENT ON`을 단다. 원본 컬럼 주석에는 Riot JSON 경로를 적는다 (계약 6장).

---

## 4. 테이블

> 요약: 원본은 Riot 값 그대로, 집계는 원본을 센 개수만, 운영은 수집 기록이다. 이름·순서는 dbml v7과 같고, CHECK는 dbml 메모의 허용 값을 DB가 강제하도록 단 것이다.

### 4-1. 공통 규칙

| 이름 | 허용 값 |
|------|---------|
| 포지션 | `TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM`, `UTILITY` |
| 패치 형식 | `^[0-9]+\.[0-9]+$` (예: `16.19`) |
| 개수 컬럼 (`pick`, `win`) | `pick > 0`, `0 ≤ win ≤ pick` |
| 자동 번호 | `bigint GENERATED ALWAYS AS IDENTITY` |

### 4-2. 원본과 운영

| 테이블 | 컬럼 (요지) | 키와 제약 |
|--------|-------------|-----------|
| `ranked_players` | `puuid`, `tier`, `rank` (모두 text NOT NULL) | PK `puuid`. `tier` CHECK in (`PLATINUM`, `EMERALD`, `DIAMOND`, `MASTER`, `GRANDMASTER`, `CHALLENGER`) (`ranked_players_tier_check`). `rank` CHECK in (`I`~`IV`) |
| `matches` | `match_id`, `puuid`(NULL 가능), `patch`, `game_start_at timestamptz NOT NULL` | PK `match_id` CHECK `^KR_[0-9]+$`. FK `puuid` → `ranked_players` **ON DELETE SET NULL**. `patch` 형식 CHECK. `matches_game_start_at_check`: `>= 2020-01-01 00:00:00+00` (초를 ms로 착각한 1970년 값 거부) |
| `match_players` | `match_id`, `puuid`, `champion_id`, `team_position`, `win`, `ban_champion_id`, `summoner1_id`, `summoner2_id`, 룬 11개(`primary_style`, `primary_perk1`~`4`, `sub_style`, `sub_perk1`·`2`, `stat_offense`·`flex`·`defense`), `item0`~`item5`, `skill_order` | PK `(match_id, puuid)`. FK `match_id` → `matches` **ON DELETE CASCADE**. `champion_id > 0`. `team_position` 포지션 또는 NULL (빈 문자열 거부 → 백엔드가 NULL로). `ban_champion_id > 0` 또는 NULL (`-1` 거부). 스펠 `> 0`. 아이템 `≥ 0` (빈 칸 0). `skill_order ~ '^[QWER]*$'` |
| `collection_logs` | `id` identity, `started_at DEFAULT now()`, `finished_at`, `status`, `players`, `matches_saved`, `error_message` | PK `id`. `status` in (`running`, `done`, `key_expired`, `failed`). `finished_at IS NULL OR finished_at >= started_at`. 개수 `≥ 0` |

- 게임 완료 기준: `match_players`가 정확히 **10줄**인 게임만 집계한다.
- 실제 예시 1행 (테스트 001 샘플): `KR_8408851980` 참가자 1 — `champion_id 23, TOP, win true, ban 64, spell 14/4, primary 8100 (9923, 8143, 8140, 8135), sub 8000 (8299, 9104), stat 5008/5008/5011, item 1018, 3074, 3006, 3046, 1036, 1036, skill_order EQQWQRQEQEREEW`, `gameStartTimestamp 1791263990514` (= `2026-10-06 05:19:50.514+00`).

### 4-3. 집계

| 테이블 | 컬럼 | 키와 제약 |
|--------|------|-----------|
| `stats_window` | `id smallint DEFAULT 1`, `days int`, `window_start`, `window_end`, `games int`, `aggregated_at DEFAULT now()` (모두 NOT NULL) | PK `id`. CHECK `id = 1`(항상 0~1줄), `days BETWEEN 1 AND 60`, `window_start < window_end`, `games > 0` |
| `stats_window_patch` | `patch text`, `games int` (NOT NULL) | PK `patch`. 패치 형식 CHECK, `games > 0` |
| `champion` | `champion_id`, `position`, `pick`, `win`, `ban` | PK `(champion_id, position)`. `champion_id > 0`, 포지션 CHECK, 개수 CHECK, `ban ≥ 0` |
| `champion_item` | `champion_id`, `position`, `item_id`, `pick`, `win` | PK `(champion_id, position, item_id)`, `item_id > 0` |
| `champion_rune` | `id` identity, `champion_id`, `position`, 룬 11개, `pick`, `win` | PK `id`, UNIQUE `champion_rune_page_key (champion_id, position, 룬 11개)` (자동 이름은 63자를 넘어 직접 지정) |
| `champion_spell` | `champion_id`, `position`, `spell1_id`, `spell2_id`, `pick`, `win` | PK `(champion_id, position, spell1_id, spell2_id)`, `spell1_id < spell2_id` |
| `champion_skill` | `champion_id`, `position`, `skill_order`, `pick`, `win` | PK `(champion_id, position, skill_order)`, `champion_skill_skill_order_check`: `skill_order ~ '^[QWER]{11}$'` |

- 상세 4개는 FK `(champion_id, position)` → `champion` **ON DELETE CASCADE**. 상세 4개의 `pick`, `win`은 공통 개수 CHECK.
- `stats_window_patch`와 `stats_window`는 FK로 잇지 않는다. 둘 다 집계 함수만 쓰고 같은 트랜잭션에서 함께 지우고 넣는다. `sum(stats_window_patch.games) = stats_window.games`는 테스트로 확인한다.
- `window_end − window_start = days × 24시간`은 CHECK로 걸지 않는다 (`timestamptz + interval`이 IMMUTABLE이 아님). 함수가 계산하고 테스트로 확인한다.
- 원본과 집계는 FK로 잇지 않는다. 비율(%)은 저장하지 않는다.

---

## 5. 인덱스

> 요약: PK·유니크 말고는 1개만 있다. 테이블이 작아 순차 스캔으로 충분하다.

| 인덱스 | 이유 |
|--------|------|
| `match_players_champion_id_team_position_idx (champion_id, team_position)` | dbml 확정. 지금 집계 함수는 거의 쓰지 않는다. 본 수집 뒤에도 안 쓰이면 새 마이그레이션으로 삭제를 제안한다 |

| 만들지 않는 인덱스 | 이유 |
|--------------------|------|
| `matches (game_start_at)` | 최대 약 3만 7천 줄이라 순차 스캔이 빠르다 (실제 수집 뒤 느리면 새 마이그레이션) |
| `matches (patch)` | 같은 이유 |
| `matches (puuid)` | `ranked_players` 삭제 기능이 없다. 그 기능을 만들면 추가 (FK 삭제 때 순차 스캔 방지) |
| `match_players (puuid)` | 전적 검색을 만들 때 추가 |

---

## 6. RLS와 권한

> 요약: 모든 테이블의 RLS를 켜고 정책은 만들지 않는다. 브라우저용 키로는 아무것도 못 읽고, 백엔드는 테이블 주인 계정으로 접속하므로 막히지 않는다. **새 객체는 만들 때마다 `REVOKE`한다.**

| 항목 | 규칙 |
|------|------|
| RLS | 모든 public 테이블(`schema_migrations` 포함) `ENABLE ROW LEVEL SECURITY` |
| 정책 | 만들지 않음 → `anon`, `authenticated`는 0줄로 보이고 쓰기도 막힘 |
| `FORCE ROW LEVEL SECURITY` | 쓰지 않음 (테이블 주인인 백엔드까지 막히므로) |
| 테이블·뷰 권한 | `REVOKE ALL ON <이름> FROM anon, authenticated` |
| 시퀀스 | `REVOKE ALL ON <시퀀스> FROM anon, authenticated` |
| 함수 권한 | `REVOKE EXECUTE ON FUNCTION <함수> FROM PUBLIC, anon, authenticated` (Supabase는 public 함수를 `/rest/v1/rpc/…`로 노출) |
| 함수 실행 모드 | `SECURITY INVOKER` (기본값), `SET search_path FROM CURRENT` |
| 뷰 | `WITH (security_invoker = true)` (RLS를 우회하지 않게) |
| 주인 | 백엔드와 마이그레이션 모두 `DATABASE_URL`(`postgres` 역할)로 접속하므로 모든 객체의 주인이 같다 |

- **Supabase 기본 권한(`pg_default_acl`)이 public 새 객체에 `anon`·`authenticated` 권한을 자동으로 준다.** 그래서 새 테이블·뷰·시퀀스·함수는 마이그레이션에서 이름을 적어 하나씩 `REVOKE`한다. `ALTER DEFAULT PRIVILEGES`는 지속 설정 변경이라 쓰지 않고, 대신 테스트 006이 스키마 전체를 자동 검사한다 (결정 사항 표).
- **pg_cron 권한:** 확장이 `cron.schedule`·`cron.unschedule` 등에 `PUBLIC` EXECUTE를, `cron.job`·`cron.job_run_details`에 `PUBLIC` 읽기를 기본으로 준다. 하지만 `anon`·`authenticated`는 `cron` 스키마 USAGE가 없어 실제로 부를 수도 볼 수도 없다 (42501). 확장 주인(`supabase_admin`)이 준 권한이라 `postgres`로 회수도 안 될 가능성이 크다. **기본값을 유지**하고 마이그레이션에서 `cron` 권한을 바꾸지 않는다. 테스트 011이 `cron` 스키마 USAGE나 직접 부여가 생기면 실패한다. 이상이 보이면 고치지 말고 메인 에이전트에게 보고한다.
- `cron`은 PostgREST 노출 스키마가 아니다. 대시보드에서 노출 스키마 설정을 바꾸지 않는다.

---

## 7. 집계 SQL 함수와 뷰

> 요약: 예약 작업(또는 백엔드 시험 명령)이 `ANALYZE matches, match_players` 뒤에 `SELECT refresh_window_stats(14)`를 부르면, 최근 14일 집계 7개가 한 트랜잭션 안에서 새로 세어진다. 오래된 원본은 사용자 확인 뒤 `purge_old_games(21)`로 지운다.

### 7-1. 함수 목록

| 함수 | 반환 | 종류 | 역할 |
|------|------|------|------|
| `refresh_window_stats(p_days int DEFAULT 14, p_until timestamptz DEFAULT now())` | jsonb | PL/pgSQL, VOLATILE | 창 `[p_until − p_days × 24시간, p_until)`의 완료 게임으로 집계 7개를 다시 만듦 |
| `purge_old_games(p_keep_days int DEFAULT 21)` | int | PL/pgSQL, VOLATILE | `game_start_at < now() − p_keep_days × 24시간`인 게임 삭제, 지운 게임 수 반환 |
| `patch_sort_key(p_patch text)` | int[] | SQL, IMMUTABLE | `'16.9'` → `{16,9}`. 패치를 숫자 순으로 정렬 |
| `tier_from_score(p_score numeric)` | smallint | SQL, IMMUTABLE | 점수 → 1~5티어 (7-5) |

### 7-2. `refresh_window_stats` 처리 순서

| 단계 | 내용 |
|------|------|
| 1 | 인자 검사 (잠금보다 먼저): `p_days`가 NULL이거나 1~60 밖이면, `p_until`이 NULL이거나 `now()`보다 미래면 오류 22023 |
| 2 | `pg_advisory_xact_lock(hashtext('refresh_window_stats'))` — 스냅숏이 1개라 잠금도 1개. 동시 호출은 차례로 실행 |
| 3 | 같은 트랜잭션에 남은 `pg_temp.tmp_games`·`tmp_base`가 있으면 지움 (`ON COMMIT DROP`이라 두 번 부를 때 대비) |
| 4 | `tmp_games` = 창 안에서 시작했고 `match_players`가 정확히 10줄인 게임과 패치. **0개면 오류 P0002** (기존 집계 보존) |
| 5 | `tmp_base` = 대상 게임의 `match_players` 전체 줄 |
| 6 | `DELETE FROM champion WHERE true` (상세 4개 CASCADE), `stats_window_patch`, `stats_window` 삭제. `WHERE true`는 `safeupdate`가 켜진 연결 대비 |
| 7 | `stats_window` 1줄 (`days`, `window_start`, `window_end = p_until`, `games`), `stats_window_patch` (패치별 게임 수) |
| 8 | `champion`, 상세 4개 INSERT (7-3) |
| 9 | jsonb 반환 `{window_start, window_end, days, games, patches: [{patch, games}] (patch_sort_key 내림차순), champion_rows, item_rows, rune_rows, spell_rows, skill_rows}` |

- 함수 1번 호출 = 트랜잭션 1개. 중간에 실패하면 이전 스냅숏이 그대로 남는다.
- `TRUNCATE`가 아니라 `DELETE`라서 집계 중에도 읽는 쪽은 커밋 전 이전 스냅숏을 본다 (MVCC).
- 같은 창으로 몇 번 다시 불러도 결과가 같다.
- `p_until`은 테스트·재현용이다. 운영은 `refresh_window_stats(14)`만 쓴다.
- **`ANALYZE`는 함수 안에 넣지 않는다.** 함수 바깥(예약 작업 명령, 백엔드 시험 명령)에서 집계 직전에 같은 연결로 실행한다. 원본 통계가 틀리면 플래너가 원본을 1줄로 보고 Nested Loop를 골라 5,000게임도 2분, 2만 5천 게임은 3~5분을 넘긴다. `ANALYZE` 뒤에는 수 초다. 함수 안의 임시 테이블만 `ANALYZE`하는 방식은 효과가 없었다.

### 7-3. 테이블별 계산

| 테이블 | 대상 줄 | 묶는 키 | 저장 개수 |
|--------|---------|---------|-----------|
| `champion` | `team_position IS NOT NULL` | `champion_id`, `team_position` | 전부 |
| `champion_item` | 위 + 아이템 `> 0` | `item_id` (한 줄 안 중복은 1번) | **전부** |
| `champion_rune` | 위 | 룬 11개 컬럼 | **상위 10개** |
| `champion_spell` | 위 + `summoner1_id <> summoner2_id` | `least(s1, s2)`, `greatest(s1, s2)` | **상위 10개** |
| `champion_skill` | 위 + `length(skill_order) >= 11` (NULL·빈 문자열·10자 이하 제외) | `left(skill_order, 11)` | **상위 10개** |

- `champion.ban`: `tmp_base` 전체(포지션 NULL 줄 포함)에서 챔피언별 `count(DISTINCT match_id)`. 양 팀이 같은 챔피언을 밴해도 그 게임은 1번. 같은 챔피언의 모든 포지션 줄에 같은 값. `champion` 줄에 LEFT JOIN, 없으면 0.
- 포지션 NULL 줄은 `pick`에서 빠지고 `stats_window.games`·`ban`에는 포함된다.
- 상위 N개: `row_number() OVER (PARTITION BY champion_id, team_position ORDER BY pick DESC, win DESC, 키 ASC) <= 10`. 키를 마지막 정렬에 넣어 결과가 매번 같다.
- 스펠이 같은 번호인 줄은 게임에서 나올 수 없지만, 들어오면 `spell1_id < spell2_id` CHECK 때문에 집계 전체가 실패하므로 뺀다.
- `champion_rune.id`는 재집계마다 새 번호를 받는다. 백엔드는 `id`를 고정 키로 쓰지 않는다.

| 저장 개수 | 이유 |
|-----------|------|
| 아이템 전부 | 하위 재료(롱소드 `1036` 등)가 상위권을 차지한다. 자르면 프론트가 재료를 거른 뒤 완성 아이템이 모자랄 수 있다 |
| 룬 상위 10개 | 조합이 챔피언 × 포지션마다 수백 개가 나올 수 있고 화면은 2개만 쓴다 |
| 스펠 상위 10개 | 실제 조합은 보통 5~15개라 거의 전부다 |
| 스킬 상위 10개 | 앞 11레벨 문자열은 긴 꼬리 조합이 많다. 화면은 2개만 쓴다 |

### 7-4. `purge_old_games`

| 단계 | 내용 |
|------|------|
| 1 | `p_keep_days`가 NULL이거나 14 미만이면 오류 22023 |
| 2 | 현재 `stats_window.days`보다 짧으면 오류 22023 (현재 창보다 짧게 보관 불가) |
| 3 | `DELETE FROM matches WHERE game_start_at < now() − p_keep_days × 24시간` (`match_players` CASCADE) |
| 4 | 지운 게임 수 반환 |

- `now()` 기준만 받는다. 시각 인자를 두지 않아 잘못된 시각으로 대량 삭제할 길을 없앤다.
- 집계 테이블, `ranked_players`, `collection_logs`는 지우지 않는다. 지운 공간은 autovacuum이 재사용한다 (`VACUUM FULL`은 잠금 때문에 쓰지 않음).
- **실제 데이터에 실행하면 되돌릴 수 없다.** 집계를 마친 뒤, 백엔드 `npm run collect -- purge --yes`로 사용자가 확인하고 실행한다. 자동 실행하지 않는다.

### 7-5. `champion_tier_view`

`champion CROSS JOIN stats_window`. `stats_window`가 0줄이면 뷰도 0줄이다.

| 컬럼 | 정의 |
|------|------|
| `champion_id`, `position`, `pick`, `win`, `ban` | `champion` |
| `games` | `stats_window.games` |
| `win_rate` | `round(100.0 × win / pick, 2)` |
| `pick_rate` | `round(100.0 × pick / games, 2)` |
| `ban_rate` | `round(100.0 × ban / games, 2)` |
| `adjusted_win_rate` | `round(100.0 × (win + 50) / (pick + 100), 2)` — 50% 가상 게임 100판 |
| `tier_score` | `round(보정 승률 + 0.10 × least(픽률, 20) + 0.03 × least(밴률, 30), 3)` — **반올림 전 비율로** 계산 |
| `tier` | `pick < 50`이면 NULL("표본 부족"), 아니면 `tier_from_score(반올림 전 점수)` |

| 티어 | `tier_from_score` 조건 |
|------|------------------------|
| 1 | `≥ 53.0` |
| 2 | `51.5 ≤ score < 53.0` |
| 3 | `50.0 ≤ score < 51.5` |
| 4 | `48.5 ≤ score < 50.0` |
| 5 | `< 48.5` |

- 점수의 뜻: 승률이 중심이고, 많이 쓰이는(최대 +2.0) 챔피언과 많이 밴되는(최대 +0.9) 챔피언에 작은 가산점. 상한이 있어 인기만으로 1티어가 되지 않는다.
- `tier_score`는 반올림해 보여 주고 `tier`는 반올림 전 점수로 정하므로, 점수가 `53.000`으로 보여도 2티어일 수 있다. 백엔드·프론트는 `tier`를 그대로 쓴다.
- 기준값(50판, 100판, 0.10, 0.03, 경계값)은 뷰와 `tier_from_score`에만 둔다. 바꿀 때는 새 마이그레이션으로 바꾼다. 개수만 저장하므로 다시 집계할 필요는 없다.
- 백엔드 사용 예: `SELECT * FROM champion_tier_view WHERE position = $1 ORDER BY tier NULLS LAST, tier_score DESC`.
- 패치 구성: `SELECT patch, games FROM stats_window_patch ORDER BY patch_sort_key(patch) DESC`. 비율은 백엔드가 `100 × games / stats_window.games`로 계산한다.

---

## 8. 매일 자동 집계 (pg_cron)

> 요약: 집계는 수집이 끝날 때가 아니라 **매일 05:00 KST(20:00 UTC)** 에 DB 안의 예약 작업이 한다. 실패하면 기존 집계가 그대로 남는다.

### 8-1. 작업 정의 (015)

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'tiergg_daily_refresh';  -- 몇 번 적용해도 1개
SELECT cron.schedule(
  'tiergg_daily_refresh',
  '0 20 * * *',   -- pg_cron은 UTC 기준. 20:00 UTC = 05:00 KST
  $cmd$SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);$cmd$
);
```

- 여러 문장 명령은 묵시적 트랜잭션 1개로 돈다. `ANALYZE`는 트랜잭션 안에서도 된다.
- 창은 `[실행 시각 − 14일, 실행 시각)`.
- 함수 이름은 스키마 없이 적는다. 작업은 등록한 계정(`postgres`)과 `postgres` DB에서 기본 `search_path`로 돈다.
- 시간 제한은 명령 맨 앞 `SET statement_timeout = '5min'`. Supabase 기본 제한(2분)에 맡기지 않는다.
- 백엔드 시험용 `aggregate` 명령과 겹쳐도 advisory lock으로 차례로 돈다. 수집(INSERT)과 겹쳐도 그 순간까지 커밋된 게임만 센다.
- 시각·명령을 바꿀 때는 새 마이그레이션에서 같은 이름을 지우고 다시 등록한다. 멈추려면 `SELECT cron.unschedule('tiergg_daily_refresh');` (사용자 승인).

### 8-2. 실패와 확인

| 상황 | 결과 |
|------|------|
| 창 안 완료 게임 0개 | P0002 → 명령 전체 롤백 → **기존 집계 그대로**. `cron.job_run_details`에 `failed` |
| 5분 초과 | `statement_timeout` 오류, 위와 같이 롤백·기록 |
| 프로젝트 일시정지 중 | 돌지 않는다. 다시 켜면 다음 20:00 UTC부터 (지난 실행을 몰아서 하지 않음) |

```sql
SELECT status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'tiergg_daily_refresh')
ORDER BY start_time DESC LIMIT 7;
```

- `stats_window.aggregated_at`이 하루를 크게 넘으면 집계가 멈춘 것이다. 알림은 없다.
- `cron.job_run_details`는 하루 1줄이라 지우는 작업을 만들지 않는다.
- Supabase 무료 플랜은 7일 동안 활동이 없으면 일시정지된다. **예약 작업이 일시정지를 막는다고 가정하지 않는다.**

---

## 9. 수집 범위와 용량

> 요약: KR 솔로랭크, 최근 14일에 시작한 게임만 받고 원본은 21일 보관한다. 본 수집 규모에서도 약 165~180MB로 무료 한도 500MB 안이며, 집계는 창 1개라 시간이 지나도 늘지 않는다.

| 구분 | 내용 |
|------|------|
| 테스트 수집 | 플래티넘·에메랄드·다이아. 계약 문구는 티어당 100명이지만, 실제 테스트 수집은 사용자 결정으로 티어당 약 250명(765명)으로 했다. 인원·디비전 배분·플레이어당 게임 수는 백엔드 수집기 설정이고 DB는 허용 값만 강제한다 |
| 본 수집 | 에메랄드 이상 (에메랄드 : 다이아 : 마스터 이상 = 4 : 4 : 2), 테스트 뒤 다시 정함. 마스터 이상은 디비전이 없어 별도 리그 API가 필요 |
| 수집 기간 | 게임 ID 목록을 `startTime = 지금 − 14일`(초)로 요청. 창 밖 게임은 받지 않음 |

본 수집 예상 (14일 창 최대 25,000게임, 원본 21일):

| 테이블 | 줄 수 | 용량 |
|--------|-------|------|
| `match_players` | 약 37.5만 (1줄 약 400B, 인덱스 포함) | 약 150MB |
| `matches` | 약 3만 7,500 | 약 7MB |
| `ranked_players` | 약 5천 | 약 1MB |
| 집계 7개 | 창 1개, 약 3만 줄 | 약 4~10MB (아이템 줄 수에 따라) |
| 재집계 때 죽은 줄 | 이전 스냅숏 | 일시적으로 +4~10MB |
| **합계** | | **약 165~180MB / 500MB** |

- `purge_old_games`를 오래 안 돌리면 원본이 하루 약 1,800게임(약 7MB)씩 는다.
- 집계 시간은 `champion_item` 줄 수에 가장 크게 좌우된다. 25,000게임에서도 `ANALYZE` 뒤 5~7초 수준으로 5분 제한까지 여유가 크다.

---

## 10. 테스트

> 요약: `db/tests/*.sql`은 모두 롤백되는 트랜잭션 안에서만 돈다. 샘플은 **2021년 시각**과 `KR_9…` ID를 써서 실제 데이터(2026년)와 섞이지 않는다.

| 파일 | 확인 |
|------|------|
| `001_storage_format.sql` | 실제 예시 1행이 모든 CHECK 통과. 거부 15건 (`team_position ''`, 밴 `-1`, `item0 -1`, `'QX'`, 패치 `16.19.823`, `NA1_1`, 스펠 14/4, `game_start_at` NULL·1970년, `stats_window` id 2·days 0·start = end·games 0, `stats_window_patch` `16.19.1`·games 0). 허용 값, SET NULL·CASCADE. 실제 `KR_8408851980`이 있으면 건너뜀 |
| `002_helper_functions.sql` | `patch_sort_key`, `tier_from_score` 경계값 (53.0 → 1, 52.999 → 2, 48.5 → 4, 48.499 → 5, NULL) |
| `003_refresh_window_stats.sql` | 샘플 20게임 집계 기대값(챔피언·아이템·룬·스펠·스킬, 밴 중복, 포지션 NULL, 9줄 게임 제외), 멱등, 0게임 P0002에 기존 스냅숏 유지, 인자 오류 22023 |
| `004_champion_tier_view.sql` | `stats_window`(games 1000) + `champion` 6줄로 비율·보정 승률·점수·티어 손 계산값, `pick` 49 → NULL, `stats_window` 0줄 → 뷰 0줄 |
| `006_security.sql` | `current_schema()`의 모든 테이블·뷰·시퀀스·함수(확장 소속 제외)를 자동 검사: RLS 켜짐·FORCE 아님·정책 0·주인, `anon`·`authenticated` 권한 없음, `PUBLIC` EXECUTE 없음, 뷰 `security_invoker`. 지금 기대 개수: 테이블 12, 뷰 1, 시퀀스 2, 함수 4 |
| `007_skill_order.sql` | 앞 11글자 묶기, 10자·`''`·NULL·포지션 NULL 제외, 상위 10개·동률 순서, CHECK 거부, 컬럼·PK 구조 |
| `008_ranked_players_tier.sql` | 허용 6개, 거부 6개(`IRON`~`GOLD`, `platinum`, `''`), CHECK 정의 |
| `009_window_boundary.sql` | 창 경계 (정확히 14일 전 포함, 1µs 더 이전 제외, 끝 제외, 미래 제외, 9줄 제외), 패치 구성 합계 = games, 반환 `patches` 순서, `p_days = 1` 재집계 |
| `010_purge_old_games.sql` | 정확히 21일은 남음, 21일 + 1초 삭제, CASCADE, 집계 유지, 인자 오류(13, NULL, 현재 창보다 짧음), 두 번째 호출 0 |
| `011_daily_refresh_job.sql` | `pg_cron` 있음, 작업 1개, 일정 `0 20 * * *`·`active`, 명령 문자열, 실행 계정·DB, `anon`·`authenticated`의 `cron` 스키마 USAGE·직접 부여 없음 (`PUBLIC` 기본값은 `[주의]` NOTICE). 작업을 실행하지 않는다 |

- 새 테스트는 번호를 붙여 넣기만 하면 `verify.mjs`가 이름순으로 돈다. 새 테이블을 만들면 `verify.mjs`의 `TABLES` 목록(전후 줄 수 비교)에도 넣어야 한다 (`db/scripts/` 수정이라 승인 필요).
- `refresh_window_stats`를 부르는 테스트는 롤백 안에서 실제 스냅숏을 지웠다 되돌리므로 실행마다 죽은 줄이 생긴다 (autovacuum이 정리).
- 큰 성능 측정(수천~수만 게임 롤백)은 한 번에 1~2회만 하고, autovacuum이 정리한 뒤 다음을 잰다. 1회에 수십 MB의 죽은 줄이 생긴다.
- 집계 함수의 성능을 잴 때는 계약 순서대로 `ANALYZE`를 먼저 한다.

---

## 11. 완료 기준

> 요약: 다음 변경의 Review가 실제 DB를 직접 조회해 확인할 공통 목록이다. 변경마다 "이번 변경" 절에 고유 기준을 더한다. 샘플 검사는 모두 롤백 트랜잭션 안에서 한다.

### 11-1. 구조

- [ ] `npm run migrate:status`에서 모든 파일이 적용됨, 체크섬 불일치 없음. 적용된 파일이 바뀌지 않음 (`git diff db/migrations/`에 기존 파일 변경 없음)
- [ ] 테이블·컬럼 이름·순서·타입·NOT NULL·기본값·PK·FK(`ON DELETE`)·유니크·CHECK가 계약 `db_contract.dbml`과 같음 (`information_schema`, `pg_constraint`)
- [ ] 인덱스가 5장과 같음 (`pg_indexes`)
- [ ] 함수 인자·반환·기본값이 7-1과 같음, 모두 `SECURITY INVOKER`·`search_path=public, pg_catalog`. 함수·뷰 본문 md5가 마이그레이션 적용 결과와 같음
- [ ] 원본 컬럼 `COMMENT`에 Riot JSON 경로가 있음

### 11-2. 보안

- [ ] 모든 public 테이블 `relrowsecurity = true`, `relforcerowsecurity = false`, 정책 0개
- [ ] `anon`·`authenticated`에 테이블·뷰·시퀀스 권한 없음, 함수 EXECUTE 없음, `PUBLIC` EXECUTE 없음 (`SET ROLE`로 직접 시험하면 42501)
- [ ] 뷰 `reloptions`에 `security_invoker=true`
- [ ] 테스트 006의 자동 검사 개수가 기대값과 같음
- [ ] `anon`·`authenticated`에 `cron` 스키마 USAGE 없음

### 11-3. 재적용

- [ ] `npm run migrate:fresh-check` 통과, `migration_check` 스키마가 남지 않고 실제 스키마가 바뀌지 않음
- [ ] `npm run migrate`를 다시 실행하면 "적용할 파일 없음"
- [ ] 적용된 파일을 바꾸면 실행기가 멈춤 (`MIGRATIONS_DIR`로 복사본에서 시험)

### 11-4. 함수 결과 (롤백)

- [ ] `npm run verify`, `npm run verify:fresh` 모두 통과, 검증 전후 모든 테이블 줄 수가 같음
- [ ] Build 테스트와 다른 값으로 직접 만든 시나리오: 창 경계, 패치 구성 합계, 상위 N·동률, 밴 중복, 0게임 오류에 기존 스냅숏 보존, purge 경계
- [ ] 두 연결에서 `refresh_window_stats`를 동시에 부르면 두 번째가 advisory lock을 기다림
- [ ] 집계 함수를 바꿨다면: 롤백 안에서 5,000게임 1회 `ANALYZE` → 집계 시간 기록 (지금 기준 약 1.1초)

### 11-5. 예약 작업

- [ ] `cron.job`에 `tiergg_daily_refresh` 1개, `schedule = '0 20 * * *'`, 명령이 8-1과 같음, `active = true`
- [ ] 최근 `cron.job_run_details`의 `status`·`return_message`·실행 시간 확인

### 11-6. 기록

- [ ] `db_build.md` 기능별 상태 갱신, 계약 반영 여부 기록
- [ ] 계약 `.md`·`.dbml`이 서로 같음
- [ ] Review가 `db_review.md`를 이번 검토로 교체, `db_overview.md` 갱신(변경 이력 1줄 추가), `docs/career_log.md`에 판단 기록 추가

---

## 12. 결정 사항

> 요약: 지금도 유효한 결정만 둔다. 나중에 바뀐 결정(패치 단위 집계, 옛 스킬 우선순위 방식, 최근 2개 패치 보관 등)은 지웠다.

| 결정 | 이유 | 날짜 |
|------|------|------|
| 마이그레이션은 Node 실행기 + `pg` 하나 (Supabase CLI, SQL Editor 아님) | 이미 있는 Node만 사용, 체크섬·재적용 검사·롤백 검증을 스크립트로 반복 가능 | 2026-10-13 |
| CHECK로 허용 값·범위·형식을 DB가 강제 (C1) | dbml 메모의 허용 값을 저장 단계에서 막음. 구조 변경은 아님 | 2026-10-13 |
| 비율·티어는 저장하지 않고 DB 뷰 `champion_tier_view` + `tier_from_score`에서 계산 (D1) | 티어 공식은 집계 규칙이라 `!db` 담당. Review가 롤백 SQL로 공식을 검증할 수 있고, 기준값 변경이 체크섬 붙은 마이그레이션으로 남음 | 2026-10-13 |
| 티어 공식: 보정 사전 100판(50%), 점수 = 보정 승률 + 0.10 × least(픽률, 20) + 0.03 × least(밴률, 30), 경계 53.0 / 51.5 / 50.0 / 48.5, 50판 미만 NULL | 승률 중심 + 인기·밴 작은 가산점, 상한으로 인기만으로 1티어 방지 | 2026-10-13 |
| 아이템은 전부 저장 (D2) | 하위 재료가 상위권을 차지해 자르면 완성 아이템이 모자랄 수 있음 | 2026-10-13 |
| 한 줄 안의 같은 아이템은 1번 (D4) | `pick`의 뜻이 "이 아이템을 가지고 끝난 게임 수". 2번 세면 승률·사용률이 틀어짐 | 2026-10-13 |
| 룬·스펠 상위 10개 저장 | 화면은 2개만 쓰고, 10개면 프론트 조정 여유가 충분 | 2026-10-13 |
| 스펠 집계에서 두 주문이 같은 줄은 뺌 (C4) | 나올 수 없는 값 1줄 때문에 집계 전체가 CHECK로 실패하지 않게 | 2026-10-13 |
| 스킬 집계 = `skill_order` 앞 11글자, 11자 미만 제외, 상위 10개. 컬럼 이름 `skill_order` (D5, D7) | 전체 문자열은 너무 잘게 나뉘고, 11레벨이면 조합이 모이면서 실제 찍는 순서를 보여 줌. 원본과 같은 형식 | 2026-10-13 |
| 쓰지 않는 함수는 남기지 않음 (옛 스킬 함수 삭제, D6) | 계약·테스트·권한 검사에 쓰지 않는 객체가 남지 않게 | 2026-10-13 |
| `ranked_players.tier`에 `PLATINUM` 허용, `IRON`~`GOLD`는 거부 (D11) | 테스트 수집 범위(플래티넘~다이아). CHECK가 실제 수집 범위를 보여 주고 실수로 섞인 낮은 티어를 막음 | 2026-10-14 |
| 표본 인원·배분은 백엔드 설정, DB는 허용 값만 강제 (D22) | 인원 조정 때 DB 변경이 필요 없게 | 2026-10-14 |
| 테스트(플래티넘) 데이터 처리는 본 수집 전환 때 다시 결정 (D12) | 지우려면 삭제 SQL이라 승인 대상. `PLATINUM`을 허용 값에서 빼려면 그 줄을 먼저 처리해야 CHECK 변경이 성공 | 2026-10-14 |
| 집계 전 `ANALYZE matches, match_players`는 함수 밖(예약 작업 명령·백엔드 시험 명령)에서 (D10) | 원본 통계가 틀리면 집계가 분 단위로 늘어남. 함수 본문을 다시 쓰지 않고, 모든 테스트 호출에 시간이 붙지 않음 | 2026-10-14 |
| 통계 기준은 패치가 아니라 **최근 14일에 시작한 게임** | 새 패치 직후 표본 급감과 직전 패치 대체 규칙을 없앰. 14일은 패치 주기와 비슷 | 2026-10-14 |
| 집계는 **현재 창 스냅숏 1개**만 둔다 (D13) | 상위 N을 창 전체에서 정확히 자르고, 용량이 고정되며 가장 단순. 이력(`as_of`)·일별 묶음 안은 용량·정확도 문제로 버림 | 2026-10-14 |
| 창 안 패치 구성은 `stats_window_patch` 테이블 (D16) | 스냅숏과 같은 순간의 값, 배열·JSON 없는 단순 컬럼 | 2026-10-14 |
| `refresh_window_stats(p_days, p_until)` 인자, 미래 `p_until` 거부 (D17) | 경계 테스트를 실제 데이터와 섞지 않고 정확한 시각으로 할 수 있음 | 2026-10-14 |
| 원본 **21일** 보관 (창 14일 + 여유 7일) (D15) | 집계를 늦게 돌리거나 과거 시각으로 다시 집계할 여유, 창을 늘려도 재수집 불필요 | 2026-10-14 |
| `purge_old_games`는 `now()` 기준만, 14일 미만·현재 창보다 짧으면 거부, 수동 실행만 | 잘못된 시각·값으로 대량 삭제할 길을 없앰 | 2026-10-14 |
| `matches.game_start_at` NOT NULL, `>= 2020-01-01` CHECK | 초/ms 착각 같은 저장 실수를 DB가 막음 | 2026-10-14 |
| `matches.game_start_at` 인덱스 없음 (D21) | 최대 약 3만 7천 줄이라 순차 스캔으로 충분 | 2026-10-14 |
| 기본 권한 대응: 새 객체마다 `REVOKE` + 테스트 006 스키마 전체 자동 검사. `ALTER DEFAULT PRIVILEGES`는 하지 않음 (D19) | 지속 설정 변경을 피하고, 빠뜨린 `REVOKE`를 테스트가 잡음 | 2026-10-14 |
| 집계는 **매일 05:00 KST(20:00 UTC)** pg_cron 작업 `tiergg_daily_refresh`, 별도 마이그레이션 015 (D23) | 수집과 집계를 분리. 확장 켜기는 따로 승인할 지속 설정이고, 실패해도 구조 변경은 이미 끝나 있음 | 2026-10-14 |
| 예약 작업 시간 제한 5분 (`SET statement_timeout`) | Supabase 기본 2분에 맡기지 않음. 실제 집계는 수 초 | 2026-10-14 |
| pg_cron 기본 `PUBLIC` 권한은 **그대로 둔다** | `anon`·`authenticated`는 `cron` 스키마 USAGE가 없어 실제로 못 씀(42501 확인). 확장 주인 권한이라 회수도 안 될 가능성이 큼. 테스트 011이 USAGE 생기면 실패 | 2026-10-14 |

---

## 13. 작업 범위

> 요약: 다음 `!db` 변경의 기본 범위다. "이번 변경" 절에서 더 좁히거나 넓힐 수 있다.

| 단계 | 수정 가능 경로 | 비고 |
|------|----------------|------|
| Plan | `db/docs/db_spec.md` | 맨 아래 `## 이번 변경 (승인 대기)` 절만 |
| Build | `db/migrations/` | **새 번호 파일만** (016~). 적용된 001~015 수정 금지 |
| Build | `db/tests/` | 검증 SQL 수정·추가 |
| Build | `db/docs/db_build.md` | 기능별 상태 갱신 |
| Build | `db/docs/db_spec.md` | 구현 뒤 이번 변경을 본문에 합치고 임시 절 삭제, 결정 사항 표 갱신 |
| Build | `docs/contracts/db_contract.md`, `docs/contracts/db_contract.dbml` | **승인된 변경만** |
| Review | `db/docs/db_review.md` | 이번 검토로 교체 |
| Review | `db/docs/db_build.md` | 수정한 기능 반영 |
| Review | `db/docs/db_overview.md` | 덮어써서 갱신, 변경 이력 1줄 추가, 해결되지 않은 점 갱신 |
| Review | `db/migrations/` | 수정은 새 번호 파일로만 |
| Review | `docs/career_log.md` | 아래에 추가만 (기존 기록 수정 금지) |

- 범위 밖: `backend/`, `frontend/`, `docs/contracts/api_contract.md`(백엔드 영역), `db/scripts/`·`db/package*.json`(필요하면 승인), 루트 `.env`(읽기만, 값 출력 금지), `.env.example`, `CLAUDE.md`.
- 되돌릴 수 없는 SQL(2-4)은 실행 전에 메인 에이전트를 통해 사용자 승인을 받는다.
- 범위 밖 수정이 필요하면 메인 에이전트에게 보고한다.

---

## 14. 알려진 한계

> 요약: 설계상 받아들인 한계다. 고칠 계획이 아니라 알고 쓰는 것이다.

- 패치 직후에는 14일 창에 두 패치가 섞이고, 변화가 14일에 걸쳐 서서히 나타난다. 패치 구성을 함께 보여 투명하게 한다.
- 밴 ↔ 참가자 연결(`pickTurn = participantId`)은 관찰된 규칙이다 (계약 7장). 밴만 되고 픽이 없는 챔피언은 `champion` 줄이 없어 밴률이 보이지 않는다.
- 11레벨 전에 끝난 게임(이른 항복, 레벨이 낮은 서포터)은 스킬 집계에서 빠진다.
- 우디르, 니달리·제이스·엘리스처럼 스킬 구조가 다른 챔피언도 같은 규칙으로 센다.
- `matches.puuid`는 "처음 찾은 표본 1명"이라, 다른 티어 표본이 같은 게임에 나오면 먼저 찾은 쪽만 남는다.
- 시퀀스는 롤백되지 않아 검증 실행마다 `collection_logs_id_seq`, `champion_rune_id_seq`가 올라간다. 백엔드는 id를 순서 번호로 가정하지 않는다.
