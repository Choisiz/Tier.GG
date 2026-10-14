# DB 마이그레이션 계획 (`!db`)

- 상태: **승인됨 (2026-10-13, D1=a DB 뷰, D2~D4·C1 추천안)**
- 작성: Plan 서브에이전트 (2026-10-13, v4 기준으로 재작성)
- 기준 계약: `docs/contracts/db_contract.dbml` (v4, 사용자 확정, 우선), `docs/contracts/db_contract.md` (초안 v4)
- 근거 데이터: 실제 솔로랭크 게임 `KR_8408851980` (패치 16.19, 1295초)
- 대상: Supabase 무료 플랜, PostgreSQL 17, Session pooler 접속

> **변경 01 (2026-10-13, 승인됨): 스킬 집계를 앞 11레벨 순서로.** 이 문서 맨 아래 "변경 01" 절을 본다. 승인되면 아래 기존 절의 `skill_priority`, `champion_skill`(4-7, 7-1, 7-3, 7-4, 8-5), D3 내용은 변경 01이 대신한다. 기존 절은 기록으로 그대로 둔다.

> **변경 02 (2026-10-14, 승인됨): 테스트 수집 범위(플래티넘~다이아)와 집계 전 ANALYZE.** 이 문서 맨 아래 "변경 02" 절을 본다. 승인되면 `ranked_players.tier` 허용 값(4-1)과 계약 1장 수집 범위·9장 호출 규칙은 변경 02가 대신한다.

### v3 계획 → v4 계획 변경

| 변경 | 이유 |
|------|------|
| 테이블을 dbml v4 그대로 (원본 3, 집계 6, 운영 1) | 사용자 간소화안 확정 |
| `refresh_patch_stats`를 개수만 세는 함수로 다시 설계, 인자는 `p_patch` 하나 | 비율·티어를 저장하지 않으므로 기준값 인자가 필요 없음 |
| 게임 완료 기준을 `collect_status` 대신 "`match_players` 10줄" | `collect_status` 컬럼 삭제 |
| 비율·티어 계산 위치를 새 결정으로 (D1) | 저장하지 않으므로 어디서 계산할지 정해야 함 |
| 보조 함수 `sort_int_array` 삭제, `skill_max_order` → `skill_priority` | 배열 컬럼 없음, 컬럼 이름에 맞춤 |

---

## 1. 개요

> 요약: dbml v4의 테이블 10개를 실제 DB에 만들고, 원본을 세어 집계를 만드는 함수, 오래된 원본을 지우는 함수, (D1 승인 시) 티어를 계산하는 뷰까지 만든다. Riot 수집 코드와 API는 만들지 않는다.

### 포함

| 항목 | 내용 |
|------|------|
| 테이블 | 원본 3 (`ranked_players`, `matches`, `match_players`), 집계 6 (`patch`, `champion`, `champion_item`, `champion_rune`, `champion_spell`, `champion_skill`), 운영 1 (`collection_logs`) + 실행기 메타 `schema_migrations` |
| 제약 조건 | PK, FK(삭제 동작 포함), 유니크, NOT NULL, 기본값, CHECK(허용 값, 범위, 형식) |
| 인덱스 | dbml의 1개 (`match_players (champion_id, team_position)`) |
| 보안 | RLS 켜기, 정책 없음, `anon`·`authenticated` 권한 회수 |
| 함수 | `refresh_patch_stats`, `purge_old_patches`, 보조 `patch_sort_key`, `skill_priority`, `tier_from_score` |
| 뷰 | `champion_tier_view` (D1이 (a)로 승인될 때만) |
| 도구 | Node 마이그레이션 실행기, 롤백되는 샘플 검증 SQL |

### 포함하지 않음

| 항목 | 담당 |
|------|------|
| Riot API 수집 워커, timeline → `skill_order` 변환, 밴 매핑 | `!백엔드` (계약 7장) |
| 집계·삭제 함수 호출 시점, 읽기 API | `!백엔드` |
| 주 포지션 2개 규칙(10%), 화면 패치 선택(직전 패치 대체), 상세 조합 비율 | `!백엔드` |
| 이름·이미지, 하위 재료 아이템 거르기 | `!프론트` (Data Dragon) |

---

## 2. 마이그레이션 방식

> 요약: `pg` 패키지 하나만 쓰는 작은 Node 실행기로 SQL 파일을 순서대로 적용하고, 적용한 파일과 체크섬을 `schema_migrations`에 기록한다.

### 2-1. 전제 조건 (확인됨)

| 항목 | 상태 |
|------|------|
| `psql`, Supabase CLI | 설치되어 있지 않음 |
| Node | v24 (`--env-file` 기본 지원) |
| `DATABASE_URL` | 루트 `.env`, Session pooler, PostgreSQL 17, 접속 확인 완료 |

### 2-2. 방식 비교와 결정

| 방식 | 장점 | 단점 |
|------|------|------|
| **★A. Node 실행기 + `pg`** | 이미 있는 Node만 사용, 의존성 1개. 적용 기록·체크섬·재적용 검사·샘플 검증을 스크립트로 반복 가능 | 실행기 코드를 직접 작성 (약 150줄) |
| B. Supabase CLI | 공식 도구 | 새 도구 설치·로그인·link 필요, 폴더 규칙이 `db/migrations`와 다름 |
| C. 대시보드 SQL Editor | 설치 없음 | 에이전트가 적용·검증할 수 없음, 기록이 남지 않음 |

- 새 의존성 **`pg`** (node-postgres 8.x, `package-lock.json`으로 고정)
  - 목적: Node에서 PostgreSQL에 접속해 SQL을 실행. 가장 널리 쓰이는 드라이버이고 하위 의존성이 적다. `!백엔드`도 같은 드라이버를 쓸 수 있다.
- `dotenv`는 쓰지 않는다. `node --env-file=../.env`로 루트 `.env`를 읽는다.
- `DATABASE_URL` 값은 로그·문서·오류 메시지에 출력하지 않는다.
- SSL: 접속 문자열 그대로 먼저 시도한다. 인증서 검증 문제로 실패하면 임의로 검증을 끄지 말고 메인 에이전트에게 보고한다.

### 2-3. 파일과 명령

| 경로 | 내용 |
|------|------|
| `db/package.json` | `"type": "module"`, 의존성 `pg`, 아래 npm 스크립트 |
| `db/scripts/migrate.mjs` | 실행기 (`up`, `status`, `fresh-check`) |
| `db/scripts/verify.mjs` | `db/tests/*.sql`을 파일마다 `BEGIN … ROLLBACK` 안에서 실행 |
| `db/migrations/NNN_설명.sql` | 마이그레이션 |
| `db/tests/NNN_설명.sql` | 샘플 데이터 + 기대값 검사 (틀리면 `RAISE EXCEPTION`) |

| npm 스크립트 | 실제 명령 | 동작 |
|--------------|-----------|------|
| `npm run migrate` | `node --env-file=../.env scripts/migrate.mjs up` | 아직 적용하지 않은 파일만 순서대로 적용 |
| `npm run migrate:status` | `… migrate.mjs status` | 파일별 적용 여부, 체크섬 불일치 출력 |
| `npm run migrate:fresh-check` | `… migrate.mjs fresh-check` | 임시 스키마에 전체 파일을 처음부터 적용해 보고 **롤백** |
| `npm run verify` | `node --env-file=../.env scripts/verify.mjs` | 샘플 검증 (항상 롤백) |

### 2-4. 실행기 규칙

- 시작할 때 `schema_migrations`가 없으면 만든다: `filename text PK`, `checksum text NOT NULL`(sha256), `applied_at timestamptz NOT NULL DEFAULT now()`. RLS 켜기, `anon`·`authenticated` 권한 회수.
- 파일 이름 규칙 `^\d{3}_[a-z0-9_]+\.sql$`, 이름 오름차순으로 기록에 없는 파일만 적용한다.
- 파일 1개 = 트랜잭션 1개 (`BEGIN` → 실행 → 기록 → `COMMIT`). 실패하면 `ROLLBACK` 후 멈춘다.
- 이미 적용한 파일의 체크섬이 달라졌으면 **아무것도 적용하지 않고 오류로 멈춘다** (적용된 파일 수정 금지 규칙을 코드로 강제).
- 변경은 항상 새 파일로 한다. 함수·뷰 변경은 새 파일에서 `CREATE OR REPLACE`.
- `fresh-check`: 트랜잭션 1개 안에서 `CREATE SCHEMA migration_check` → `SET LOCAL search_path = migration_check, pg_catalog` → 전체 파일 실행 → 항상 `ROLLBACK`.
  - 그래서 마이그레이션 SQL에는 **`public.` 접두사를 쓰지 않고**, 함수는 `SET search_path FROM CURRENT`로 만든다.
  - `ON ALL TABLES IN SCHEMA public` 같은 스키마 전체 명령은 쓰지 않는다 (실제 스키마를 건드리므로). 객체 이름을 하나씩 적는다.
- 테이블 삭제, 데이터 삭제 SQL을 실제 DB에 커밋하는 일은 이번 계획에 없다. 필요해지면 실행 전에 메인 에이전트를 통해 사용자 승인을 받는다.

---

## 3. 마이그레이션 파일 목록

> 요약: FK 순서대로 원본 → 집계 → 인덱스 → 보안 → 함수 → 뷰 순으로 8개 파일을 만든다.

| 순서 | 파일 | 만드는 것 |
|------|------|-----------|
| 1 | `001_create_raw_tables.sql` | `ranked_players`, `matches`(FK → `ranked_players`), `match_players`(FK → `matches`), `collection_logs` |
| 2 | `002_create_aggregate_tables.sql` | `patch`, `champion`(FK → `patch`), `champion_item`, `champion_rune`, `champion_spell`, `champion_skill`(FK → `champion`) |
| 3 | `003_create_indexes.sql` | `match_players_champion_id_team_position_idx` |
| 4 | `004_enable_rls.sql` | 10개 테이블 RLS 켜기, `anon`·`authenticated` 권한 회수 |
| 5 | `005_create_helper_functions.sql` | `patch_sort_key`, `skill_priority`, `tier_from_score` + `EXECUTE` 회수 |
| 6 | `006_create_refresh_patch_stats.sql` | `refresh_patch_stats` + `EXECUTE` 회수 |
| 7 | `007_create_purge_old_patches.sql` | `purge_old_patches` + `EXECUTE` 회수 |
| 8 | `008_create_champion_tier_view.sql` | `champion_tier_view` + 권한 회수 (**D1이 (a)일 때만**. (b)면 이 파일은 만들지 않고 `tier_from_score`도 5번에서 뺀다) |

- 테이블·컬럼에 `COMMENT ON`을 단다. 원본 컬럼 주석에는 Riot JSON 경로를 적는다(계약 6장). 예: `COMMENT ON COLUMN match_players.primary_perk1 IS 'perks.styles[0].selections[0].perk'`.

---

## 4. 테이블 상세

> 요약: 10개 테이블의 타입, NOT NULL, 기본값, 키, CHECK다. 테이블·컬럼 이름과 순서는 dbml v4와 같고, CHECK는 dbml 메모의 허용 값을 DB가 강제하도록 추가한 것이다.

### 공통 규칙

| 이름 | 허용 값 |
|------|---------|
| 포지션 | `TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM`, `UTILITY` |
| 패치 형식 | `^[0-9]+\.[0-9]+$` (예: `16.19`) |
| 개수 컬럼 (`pick`, `win`) | `pick > 0`, `0 ≤ win ≤ pick` |
| 자동 번호 | `bigint GENERATED ALWAYS AS IDENTITY` |

### 4-1. `ranked_players`

| 컬럼 | 타입 | NULL | 기본값 | 제약 |
|------|------|------|--------|------|
| `puuid` | text | NOT NULL | | **PK** |
| `tier` | text | NOT NULL | | CHECK in (`EMERALD`, `DIAMOND`, `MASTER`, `GRANDMASTER`, `CHALLENGER`) |
| `rank` | text | NOT NULL | | CHECK in (`I`, `II`, `III`, `IV`) |

### 4-2. `matches`

| 컬럼 | 타입 | NULL | 기본값 | 제약 |
|------|------|------|--------|------|
| `match_id` | text | NOT NULL | | **PK**, CHECK `~ '^KR_[0-9]+$'` |
| `puuid` | text | NULL | | FK → `ranked_players.puuid` **ON DELETE SET NULL** |
| `patch` | text | NOT NULL | | CHECK 패치 형식 |

### 4-3. `match_players`

| 컬럼 | 타입 | NULL | 제약 |
|------|------|------|------|
| `match_id` | text | NOT NULL | **PK①**, FK → `matches.match_id` **ON DELETE CASCADE** |
| `puuid` | text | NOT NULL | **PK②** |
| `champion_id` | int | NOT NULL | CHECK > 0 |
| `team_position` | text | NULL | CHECK 포지션 (빈 문자열은 거부 → 백엔드가 NULL로) |
| `win` | boolean | NOT NULL | |
| `ban_champion_id` | int | NULL | CHECK > 0 (`-1` 거부 → 백엔드가 NULL로) |
| `summoner1_id`, `summoner2_id` | int | NOT NULL | CHECK > 0 |
| `primary_style`, `primary_perk1`~`4` | int | NOT NULL | |
| `sub_style`, `sub_perk1`, `sub_perk2` | int | NOT NULL | |
| `stat_offense`, `stat_flex`, `stat_defense` | int | NOT NULL | |
| `item0` ~ `item5` | int | NULL | CHECK ≥ 0 (빈 칸 0) |
| `skill_order` | text | NULL | CHECK `~ '^[QWER]*$'` |

- 실제 예시 1행 (`db/tests` 샘플로 사용): `KR_8408851980`, 참가자 1 — `champion_id 23, TOP, win true, ban 64, spell 14/4, primary 8100 (9923, 8143, 8140, 8135), sub 8000 (8299, 9104), stat 5008/5008/5011, item 1018, 3074, 3006, 3046, 1036, 1036, skill_order EQQWQRQEQEREEW`.

### 4-4. `collection_logs`

| 컬럼 | 타입 | NULL | 기본값 | 제약 |
|------|------|------|--------|------|
| `id` | bigint | NOT NULL | identity | **PK** |
| `started_at` | timestamptz | NOT NULL | `now()` | |
| `finished_at` | timestamptz | NULL | | CHECK `finished_at IS NULL OR finished_at >= started_at` |
| `status` | text | NOT NULL | (없음, dbml 그대로) | CHECK in (`running`, `done`, `key_expired`, `failed`) |
| `players` | int | NULL | | CHECK ≥ 0 |
| `matches_saved` | int | NULL | | CHECK ≥ 0 |
| `error_message` | text | NULL | | |

### 4-5. `patch`

| 컬럼 | 타입 | NULL | 제약 |
|------|------|------|------|
| `patch` | text | NOT NULL | **PK**, CHECK 패치 형식 |
| `games` | int | NOT NULL | CHECK > 0 (게임이 0개면 집계 함수가 오류로 멈추므로) |

### 4-6. `champion`

| 컬럼 | 타입 | NULL | 제약 |
|------|------|------|------|
| `patch` | text | NOT NULL | **PK①**, FK → `patch.patch` **ON DELETE CASCADE** |
| `champion_id` | int | NOT NULL | **PK②**, CHECK > 0 |
| `position` | text | NOT NULL | **PK③**, CHECK 포지션 |
| `pick` | int | NOT NULL | CHECK > 0 |
| `win` | int | NOT NULL | CHECK `0 ≤ win ≤ pick` |
| `ban` | int | NOT NULL | CHECK ≥ 0 |

### 4-7. 상세 집계 4개

- 공통: `patch` text, `champion_id` int, `position` text — 모두 NOT NULL. FK `(patch, champion_id, position)` → `champion` **ON DELETE CASCADE**. `pick` int NOT NULL CHECK > 0, `win` int NOT NULL CHECK `0 ≤ win ≤ pick`.

| 테이블 | 나머지 컬럼 | 키 | 추가 CHECK |
|--------|-------------|----|------------|
| `champion_item` | `item_id` int NOT NULL | PK `(patch, champion_id, position, item_id)` | `item_id > 0` |
| `champion_rune` | `id` bigint identity, `primary_style`, `primary_perk1`~`4`, `sub_style`, `sub_perk1`, `sub_perk2`, `stat_offense`, `stat_flex`, `stat_defense` (모두 int NOT NULL) | PK `id`, UNIQUE `(patch, champion_id, position, 룬 11개)` | |
| `champion_spell` | `spell1_id`, `spell2_id` int NOT NULL | PK `(patch, champion_id, position, spell1_id, spell2_id)` | `spell1_id < spell2_id` |
| `champion_skill` | `skill_priority` text NOT NULL | PK `(patch, champion_id, position, skill_priority)` | in (`Q>W>E`, `Q>E>W`, `W>Q>E`, `W>E>Q`, `E>Q>W`, `E>W>Q`) |

- `champion_rune`의 유니크 키 이름은 `champion_rune_page_key`로 명시한다 (자동 이름은 63자를 넘어 잘림).

---

## 5. 인덱스

> 요약: dbml의 인덱스 1개만 만든다. 나머지 조회는 PK가 대신하거나 테이블이 작아 순차 스캔으로 충분하다.

| 테이블 | 인덱스 | 이유 |
|--------|--------|------|
| `match_players` | `match_players_champion_id_team_position_idx (champion_id, team_position)` | dbml 확정. 챔피언 × 포지션 단위 조회 |

| PK·유니크가 대신하는 조회 | 사용처 |
|---------------------------|--------|
| `match_players (match_id, puuid)` 앞부분 `match_id` | 집계 함수의 게임별 10줄 확인, `matches` 조인 |
| 집계 5개의 `(patch, champion_id, position, …)` | 패치별 티어리스트, 챔피언 상세 |

| 만들지 않는 인덱스 | 이유 |
|--------------------|------|
| `matches (patch)` | 최대 5만 줄(약 9MB). 집계·삭제는 패치당 1번이라 순차 스캔으로 충분 |
| `matches (puuid)` | `ranked_players` 삭제는 이번 범위에서 일어나지 않음. 플레이어당 20게임 제한은 백엔드가 수집 중 메모리로 셀 수 있음 |
| `match_players (puuid)` | 약 40MB. 전적 검색을 만들 때 추가 |

- 참고: 집계 함수는 패치 전체를 읽으므로 `(champion_id, team_position)` 인덱스를 거의 쓰지 않는다(약 15MB). 확정 사항이라 만들고, 나중에 쓰이지 않으면 새 마이그레이션으로 지울 수 있다.

---

## 6. RLS / 권한

> 요약: 모든 테이블의 RLS를 켜고 정책은 하나도 만들지 않는다. 브라우저용 키로는 아무것도 못 읽고, 백엔드는 테이블 주인 계정으로 접속하므로 막히지 않는다.

| 항목 | 내용 |
|------|------|
| RLS | 10개 테이블 + `schema_migrations` 모두 `ENABLE ROW LEVEL SECURITY` |
| 정책 | 만들지 않음 → `anon`, `authenticated`는 0줄로 보이고 쓰기도 막힘 |
| `FORCE ROW LEVEL SECURITY` | 쓰지 않음 (테이블 주인인 백엔드까지 막히므로) |
| 테이블·뷰 권한 | `REVOKE ALL ON <이름> FROM anon, authenticated` (Supabase가 public 새 객체에 기본 권한을 자동 부여하므로 2중 방어) |
| 함수 권한 | `REVOKE EXECUTE ON FUNCTION <함수> FROM PUBLIC, anon, authenticated` (Supabase는 public 함수를 `/rest/v1/rpc/…`로 노출) |
| 함수 실행 모드 | `SECURITY INVOKER` (기본값) |
| 뷰 | `WITH (security_invoker = true)` — 뷰 주인 권한으로 RLS를 우회하지 않게 |
| identity 시퀀스 | `anon`, `authenticated`의 `USAGE` 회수 |

- 백엔드와 마이그레이션 모두 `DATABASE_URL`(Session pooler, `postgres` 역할)로 접속하므로 이 역할이 모든 객체의 주인이 되고, 주인에게는 RLS가 적용되지 않는다.
- publishable(anon) 키가 유출되더라도 읽기·쓰기·RPC 호출이 모두 막힌다.

---

## 7. 집계 SQL 함수

> 요약: 백엔드가 `SELECT refresh_patch_stats('16.19')` 한 줄만 부르면 그 패치의 집계 6개가 한 트랜잭션 안에서 새로 세어진다. 오래된 원본은 `purge_old_patches()`로 지운다.

### 7-1. 함수 목록

| 함수 | 반환 | 종류 | 역할 |
|------|------|------|------|
| `patch_sort_key(p_patch text)` | int[] | SQL, IMMUTABLE | `string_to_array(p_patch, '.')::int[]`. `'16.9'` → `{16,9}` |
| `skill_priority(p_order text)` | text | SQL, IMMUTABLE | `'EQQWQRQEQEREEW'` → `'Q>E>W'` (7-4) |
| `tier_from_score(p_score numeric)` | smallint | SQL, IMMUTABLE | 1~5 (7-6, D1이 (a)일 때만) |
| `refresh_patch_stats(p_patch text)` | jsonb | PL/pgSQL | 패치 1개 집계 재계산 |
| `purge_old_patches(p_keep int DEFAULT 2)` | int | PL/pgSQL | 오래된 패치 원본 삭제, 삭제한 게임 수 반환 |

- 모든 함수는 `SET search_path FROM CURRENT`로 만든다.

### 7-2. `refresh_patch_stats(p_patch text)` 처리 순서

| 단계 | 내용 |
|------|------|
| 0 | `pg_advisory_xact_lock(hashtext('refresh_patch_stats:' \|\| p_patch))` — 같은 패치를 동시에 두 번 집계하지 않게 |
| 1 | 패치 형식 검사. 아니면 `RAISE EXCEPTION` |
| 2 | 임시 테이블 `tmp_games`(ON COMMIT DROP) = `matches.patch = p_patch`이고 `match_players`가 정확히 10줄인 `match_id`. **0개면 오류로 중단** (원본이 이미 지워진 패치를 집계해 기존 집계를 지우는 사고 방지) |
| 3 | 임시 테이블 `tmp_base` = `tmp_games`의 `match_players` 전체 줄. 이후 INSERT들이 재사용 |
| 4 | `DELETE FROM patch WHERE patch = p_patch` → `champion`과 상세 4개는 CASCADE로 함께 삭제 |
| 5 | `INSERT INTO patch (patch, games)` = (`p_patch`, `tmp_games` 수) |
| 6 | `champion` INSERT (7-3) |
| 7 | 상세 4개 INSERT (7-3). 모두 `team_position IS NOT NULL`인 줄만 |
| 8 | jsonb 반환 `{patch, games, champion_rows, item_rows, rune_rows, spell_rows, skill_rows}` |

- 함수 1번 호출 = 문장 1개 = 트랜잭션 1개. 중간에 실패하면 이전 집계가 그대로 남는다.
- 같은 패치를 몇 번 다시 불러도 결과가 같다 (지우고 다시 넣으므로).

### 7-3. 테이블별 계산

| 테이블 | 대상 줄 | 묶는 키 | 저장 개수 |
|--------|---------|---------|-----------|
| `champion` | `team_position IS NOT NULL` | `champion_id`, `team_position` | 전부 |
| `champion_item` | 위 + 아이템 `> 0` | `item_id` (한 줄 안 중복은 1번) | **전부** |
| `champion_rune` | 위 | 룬 11개 컬럼 | **상위 10개** |
| `champion_spell` | 위 | `least(s1, s2)`, `greatest(s1, s2)` | **상위 10개** |
| `champion_skill` | 위 + `skill_priority(skill_order) IS NOT NULL` | `skill_priority` | **전부 (최대 6개)** |

- `champion.ban`: `tmp_base` 전체(포지션 NULL 줄 포함)에서 챔피언별 `count(DISTINCT match_id) FILTER (WHERE ban_champion_id = 챔피언)`. `champion` 줄에 LEFT JOIN, 없으면 0.

```sql
-- 밴: 챔피언별 밴된 게임 수 (포지션과 무관)
SELECT ban_champion_id AS champion_id, count(DISTINCT match_id) AS ban
FROM tmp_base
WHERE ban_champion_id IS NOT NULL
GROUP BY ban_champion_id;

-- 아이템: 한 줄 안의 같은 아이템은 1번 (1036, 1036 → 1036 한 번)
SELECT b.champion_id, b.team_position, i.item_id,
       count(*) AS pick, count(*) FILTER (WHERE b.win) AS win
FROM tmp_base b
CROSS JOIN LATERAL (
  SELECT DISTINCT x AS item_id
  FROM unnest(ARRAY[b.item0, b.item1, b.item2, b.item3, b.item4, b.item5]) AS x
  WHERE x > 0
) i
WHERE b.team_position IS NOT NULL
GROUP BY 1, 2, 3;
```

- 상위 N개는 `row_number() OVER (PARTITION BY champion_id, team_position ORDER BY pick DESC, win DESC, 키 ASC) <= 10`. 키를 마지막 정렬에 넣어 결과가 매번 같게 한다.

#### 저장 개수를 정한 이유

| 테이블 | 결정 | 이유 |
|--------|------|------|
| 룬 | 상위 10개 | dbml 확정. 룬 페이지 조합은 챔피언 × 포지션마다 수백 개가 나올 수 있고, 화면은 2개만 쓴다. 10개면 프론트 조정 여유가 충분하다 |
| 아이템 | **전부** | 하위 재료(롱소드 `1036` 등)가 상위권을 차지한다. 상위 N개로 자르면 프론트가 재료를 거른 뒤 완성 아이템이 모자랄 수 있다. 한 챔피언 × 포지션에 아이템은 보통 30~80개라 패치당 약 2~3만 줄(약 2.5MB)로 작다 |
| 스펠 | 상위 10개 | 실제 조합은 보통 5~15개라 10개면 거의 전부다. 드문 장난 조합(1~2판)만 잘린다 |
| 스킬 | 전부 | 가능한 값이 6개(`Q>W>E` 등)뿐이라 자를 이유가 없다 |

### 7-4. `skill_priority(p_order text)`

- Q, W, E 각각 **5번째로 찍은 위치**를 구한다. R은 제외한다.
- 5번째에 도달한 스킬이 **2개 미만이면 NULL** (순서가 정해지지 않음 → 집계에서 빠짐).
- 2개 이상이면 도달 위치가 빠른 순으로 잇고, 도달하지 못한 스킬을 마지막에 둔다. 남는 스킬은 항상 1개 이하라 순서가 하나로 정해진다.
- 실제 예: `EQQWQRQEQEREEW` → Q의 5번째 = 9번째 글자, E의 5번째 = 13번째 글자, W는 2번 → `Q>E>W`.
- 2개 기준을 고른 이유: 15레벨 이상 같은 기준을 쓰면 짧은 게임이 빠진다. 실제 예시(21분)가 14레벨에서 끝났지만 두 스킬이 이미 5레벨이라 순서가 확정된다.
- 한계: 우디르, 니달리·제이스·엘리스처럼 R 구조가 다른 챔피언은 의미가 다르다. 같은 규칙을 적용하고 한계로 남긴다.

```sql
SELECT CASE WHEN count(fifth) >= 2
            THEN string_agg(skill, '>' ORDER BY fifth NULLS LAST, ord) END
FROM (
  SELECT v.skill, v.ord,
         (SELECT i FROM (
            SELECT i, row_number() OVER (ORDER BY i) AS c
            FROM generate_series(1, length(p_order)) AS i
            WHERE substr(p_order, i, 1) = v.skill) t
          WHERE t.c = 5) AS fifth
  FROM (VALUES ('Q', 1), ('W', 2), ('E', 3)) AS v(skill, ord)
) s;
```

### 7-5. `purge_old_patches(p_keep int DEFAULT 2)`

| 단계 | 내용 |
|------|------|
| 1 | `p_keep < 1`이면 오류 |
| 2 | `matches`의 서로 다른 `patch`를 `patch_sort_key` 내림차순으로 정렬해 앞 `p_keep`개를 보관 |
| 3 | `DELETE FROM matches WHERE patch NOT IN (보관 패치)` → `match_players`는 CASCADE 삭제 |
| 4 | 삭제한 게임 수 반환 |

- 집계 테이블, `ranked_players`, `collection_logs`는 지우지 않는다.
- 지운 공간은 autovacuum이 재사용한다. `VACUUM FULL`은 테이블을 잠그므로 쓰지 않는다.
- **실제 데이터에 실행하면 되돌릴 수 없는 삭제**다. Build·Review는 `db/tests`의 롤백 트랜잭션 안에서만 실행한다. 운영 호출 시점은 `!백엔드`가 정한다 (반드시 `refresh_patch_stats` 뒤).

### 7-6. 비율과 티어 계산 (D1 ★(a)일 때: `champion_tier_view`)

| 컬럼 | 정의 |
|------|------|
| `patch`, `champion_id`, `position`, `pick`, `win`, `ban`, `games` | `champion` JOIN `patch` |
| `win_rate` | `round(100.0 × win / pick, 2)` |
| `pick_rate` | `round(100.0 × pick / games, 2)` |
| `ban_rate` | `round(100.0 × ban / games, 2)` |
| `adjusted_win_rate` | `round(100.0 × (win + 50) / (pick + 100), 2)` — 50% 가상 게임 100판 |
| `tier_score` | `round(보정 승률 + 0.10 × least(픽률, 20) + 0.03 × least(밴률, 30), 3)` — **반올림 전 값**으로 계산 |
| `tier` | `pick < 50`이면 NULL, 아니면 `tier_from_score(tier_score)` |

| 티어 | `tier_from_score` 조건 | 예시 |
|------|------------------------|------|
| 1 | `≥ 53.0` | 보정 승률 52%, 픽률 12%, 밴률 20% → 53.8 |
| 2 | `51.5 ≤ score < 53.0` | 보정 승률 51%, 픽률 6% → 51.6 |
| 3 | `50.0 ≤ score < 51.5` | 보정 승률 50%, 픽률 4%, 밴률 2% → 50.46 |
| 4 | `48.5 ≤ score < 50.0` | 보정 승률 49%, 픽률 3% → 49.3 |
| 5 | `< 48.5` | 보정 승률 47.5%, 픽률 2% → 47.7 |

- 점수의 뜻: 승률이 중심이고, 많이 쓰이는(최대 +2.0) 챔피언과 많이 밴되는(최대 +0.9) 챔피언에 작은 가산점. 상한을 둬서 인기만으로 1티어가 되지 않게 한다.
- 기준값(50판, 100판, 0.10, 0.03, 경계값)은 뷰와 `tier_from_score`에만 둔다. 첫 실제 수집 뒤 분포를 보고 새 마이그레이션(`CREATE OR REPLACE VIEW`)으로 조정한다.
- 백엔드 사용 예: `SELECT * FROM champion_tier_view WHERE patch = $1 AND position = $2 ORDER BY tier NULLS LAST, tier_score DESC`.
- 상세 테이블 비율(조합 승률, 조합 사용률 = `pick / champion.pick`)은 공식 정책이 없는 단순 나눗셈이라 백엔드가 계산한다.

---

## 8. 완료 기준

> 요약: Review 에이전트가 실제 DB에 쿼리해서 하나씩 확인할 수 있는 목록이다. 샘플 데이터 검사는 **모두 롤백 트랜잭션 안에서** 하므로 실제 데이터에 영향이 없다.

### 8-1. 구조

- [ ] `npm run migrate:status`에서 001~008(D1이 (b)면 001~007)이 모두 적용됨, 체크섬 불일치 없음
- [ ] `information_schema.columns` 기준으로 10개 테이블의 컬럼 이름·순서·타입·NULL 여부가 dbml v4와 일치
- [ ] v3 전용 객체가 없음: `collect_status`, `queue_id`, `game_duration`, `start_items`, `core_items`, `boots_id`, `match_bans`, `patch_stats`, `champion_tiers`
- [ ] PK, FK(대상과 `ON DELETE`: `matches.puuid` SET NULL, `match_players` CASCADE, `champion.patch` CASCADE, 상세 4개 CASCADE), 유니크 `champion_rune_page_key`, CHECK가 4장과 일치 (`pg_constraint` 조회)
- [ ] 인덱스가 5장과 일치 (`pg_indexes`: PK·유니크 + `match_players_champion_id_team_position_idx` 1개)
- [ ] 함수 5개(D1 (b)면 4개)와 인자·반환 타입이 7-1과 일치, 뷰 `champion_tier_view` 존재(D1 (a))
- [ ] 원본 컬럼 `COMMENT`에 Riot JSON 경로가 있음

### 8-2. 보안

- [ ] 11개 테이블(`schema_migrations` 포함) 모두 `relrowsecurity = true`, `relforcerowsecurity = false`
- [ ] `pg_policies`에 이 테이블들의 정책이 0개
- [ ] `anon`, `authenticated`의 `has_table_privilege(…, 'SELECT')`·`INSERT` 모두 false (테이블과 뷰)
- [ ] `anon`, `authenticated`, `PUBLIC`의 함수 `EXECUTE` 권한 없음 (`has_function_privilege` = false)
- [ ] 뷰의 `reloptions`에 `security_invoker=true`
- [ ] 모든 객체 주인이 마이그레이션 실행 역할

### 8-3. 재적용

- [ ] `npm run migrate:fresh-check`가 오류 없이 끝나고, 실행 후 `migration_check` 스키마가 남아 있지 않으며 실제 스키마가 바뀌지 않음
- [ ] `npm run migrate`를 한 번 더 실행하면 "적용할 파일 없음"
- [ ] 적용된 파일을 1글자 바꾸면 실행기가 오류로 멈춤 (확인 후 원복)

### 8-4. 저장 형식 (롤백)

- [ ] 4-3의 실제 예시 1행이 모든 CHECK를 통과
- [ ] 각각 거부됨: `team_position = ''`, `ban_champion_id = -1`, `item0 = -1`, `skill_order = 'QX'`, `patch = '16.19.823'`, `match_id = 'NA1_1'`, `champion_spell`의 `spell1_id = 14, spell2_id = 4`
- [ ] 각각 허용됨: `team_position NULL`, `ban_champion_id NULL`, `item0 = 0`

### 8-5. 함수 결과 (`npm run verify`, 모두 롤백)

- [ ] 보조 함수: `patch_sort_key('16.9') < patch_sort_key('16.19')`; `skill_priority('EQQWQRQEQEREEW') = 'Q>E>W'`; 5레벨 1개뿐인 순서 → NULL; 빈 문자열·NULL → NULL; `tier_from_score` 경계값 53.0 → 1, 52.999 → 2, 48.5 → 4, 48.499 → 5
- [ ] 샘플 패치(예: `0.1`)에 게임 수십 개를 넣고 `refresh_patch_stats('0.1')` → 손으로 계산한 기대값과 일치
  - `patch.games` = 10줄인 게임 수 (9줄짜리 게임은 제외됨)
  - 특정 챔피언 × 포지션의 `pick`, `win`, `ban`
  - 같은 게임에서 양 팀이 같은 챔피언을 밴하면 `ban`에 1번만
  - 같은 챔피언의 모든 포지션 줄에 같은 `ban`
  - 포지션 NULL 줄은 `pick`에 빠지고 `games`·`ban`에는 포함
  - `item0~5`의 `0`은 세지 않고, 한 줄의 `1036, 1036`은 1번
  - 스펠 `14/4`와 `4/14`가 `(4, 14)` 한 조합으로 묶임
  - 룬 조합 11개 이상 → 상위 10개만, 동률일 때 순서가 매번 같음
  - `skill_priority`가 NULL인 줄은 `champion_skill`에서 빠짐
- [ ] (D1 (a)) `champion_tier_view`의 비율·보정 승률·점수가 손 계산과 일치, `pick` 49 → `tier IS NULL`, 50 → 기대 티어
- [ ] 같은 패치를 두 번 집계해도 결과가 같고 중복 오류가 없음
- [ ] 원본이 없는 패치를 집계하면 오류가 나고 기존 집계는 그대로 남음
- [ ] 패치 3개(`0.9`, `0.10`, `0.2`) 샘플에 `purge_old_patches(2)` → `0.2` 원본만 삭제(`0.10`이 최신), `match_players` CASCADE 삭제, 집계 테이블은 남음, 반환값 = 삭제한 게임 수
- [ ] 검증 후 샘플 데이터가 DB에 남아 있지 않음 (테이블별 `count(*)`가 검증 전과 같음)

> 주의: `purge_old_patches` 검증은 반드시 롤백 트랜잭션 안에서 한다. 실제 수집 데이터가 있는 상태에서 커밋하면 실제 원본이 지워진다.

### 8-6. 기록

- [ ] `db/docs/db_build.md`에 기능 / 구현 내용 / 상태 기록, 계약 문서 반영 여부 기록
- [ ] D1 결정 결과가 계약 `db_contract.md` 9-3에 반영됨

---

## 9. 계약 변경 요청 / 결정 필요 사항

> 요약: dbml v4의 테이블·컬럼은 바꾸지 않는다. 사용자가 정할 것은 D1(비율·티어 계산 위치) 하나이고, D2~D4는 추천안대로 진행해도 되는지 확인만 받는다.

### 9-1. 계약 변경 요청

| # | 내용 | 상태 |
|---|------|------|
| - | 테이블·컬럼 변경 없음. dbml 오타 수정 없음 (발견하지 못함) | - |
| C1 | CHECK 추가 (4장). dbml 메모의 허용 값을 DB가 강제하는 것이라 구조 변경은 아님 | 계획 승인 시 확정 |
| C2 | D1이 (a)면 계약 9-3에 `champion_tier_view` 컬럼 확정, dbml에 뷰 메모 추가 | D1 승인 후 Build가 반영 |

### 9-2. 결정 필요 사항

| # | 결정 | 선택지 | ★추천안과 이유 |
|---|------|--------|----------------|
| D1 | 비율·티어(1~5)를 어디서 계산하나 | **(a)** DB 뷰 `champion_tier_view` + `tier_from_score` (7-6) / (b) 백엔드가 TypeScript로 계산 | **★(a).** ① CLAUDE.md 9장에서 집계 SQL 함수는 `!db` 담당이고, 티어 공식은 집계 규칙이다. 공식이 계약과 같은 곳에 있어야 `!백엔드`가 "따르기만" 하면 된다. ② Review가 실제 DB에서 롤백 SQL로 공식을 검증할 수 있다(8-5). (b)면 공식 검증이 백엔드 Review로 넘어가고 DB 계약에는 문장만 남는다. ③ 백엔드는 `SELECT … ORDER BY tier, tier_score DESC`만 하면 되고, 나중에 AI 피드백 등 다른 소비자도 같은 값을 쓴다. ④ 기준값 조정이 체크섬 붙은 마이그레이션으로 남아 언제 무엇을 바꿨는지 추적된다. 단점: 기준값을 바꾸려면 새 마이그레이션이 필요하다(인자로 바꿀 수 없음). 400줄 남짓이라 뷰 계산 비용은 무시할 수준이다. 주 포지션 10% 규칙과 직전 패치 대체는 화면 정책이라 그대로 백엔드에 둔다 |
| D2 | 아이템 저장 개수 | ★전부 / 상위 N개 | **★전부.** 7-3 이유 참고 (재료가 상위권을 차지, 용량 작음) |
| D3 | 스킬 집계 대상 | ★5레벨 도달 2개 이상 / 15레벨 이상 / 전부 | **★2개 이상.** 순서가 확정되는 최소 조건, 짧은 게임도 포함 (7-4) |
| D4 | 한 줄 안의 같은 아이템 (`1036, 1036`) | ★1번 / 2번 | **★1번.** `pick`의 뜻이 "이 아이템을 가지고 끝난 게임 수"(dbml)라서. 2번 세면 `pick`이 게임 수보다 커져 승률·사용률이 틀어진다 |

### 9-3. 확정 사항 (참고)

| 항목 | 내용 |
|------|------|
| 마이그레이션 방식 | Node 실행기 + `pg` |
| 티어 공식 | 보정 사전 100판(50%), 점수 = 보정 승률 + 0.10 × least(픽률, 20) + 0.03 × least(밴률, 30), 경계 53.0 / 51.5 / 50.0 / 48.5, 50판 미만 NULL |
| 룬 저장 개수 | 상위 10개 (dbml) |
| 원본 보관 | 최근 2개 패치 |

- 알려진 한계: 밴 ↔ 참가자 연결(`pickTurn = participantId`)은 관찰된 규칙이다(계약 7장). 밴만 되고 픽이 없는 챔피언은 `champion` 줄이 없어 밴률이 보이지 않는다.

---

## 10. 작업 범위 (단계별 수정 가능한 경로)

> 요약: Build는 `db/`와 구현 기록, 승인된 계약 변경만 고친다. Review는 검토 기록, 구현 기록, 새 수정 마이그레이션, 커리어 기록만 고친다.

| 단계 | 수정 가능 경로 | 비고 |
|------|----------------|------|
| Build | `db/package.json`, `db/package-lock.json` | 의존성 `pg`만 |
| Build | `db/scripts/` | `migrate.mjs`, `verify.mjs` |
| Build | `db/migrations/` | 001~008 |
| Build | `db/tests/` | 샘플 검증 SQL |
| Build | `db/docs/db_build.md` | 기능 / 구현 내용 / 상태 |
| Build | `docs/contracts/db_contract.md`, `docs/contracts/db_contract.dbml` | **승인된 변경만** (C1, C2) |
| Review | `db/docs/db_review.md` | 검토 결과 |
| Review | `db/docs/db_build.md` | 수정한 기능 반영 |
| Review | `db/migrations/` | 수정은 **새 번호 파일로만** (기존 파일 수정 금지) |
| Review | `docs/career_log.md` | 아래에 추가만 (기존 기록 수정 금지) |

- 범위 밖: `backend/`, `frontend/`, 루트 `.env`(읽기만, 값 출력 금지), `.env.example`(새 변수 없음), `CLAUDE.md`.
- `db/tests/` 보강이 Review에 필요하면 메인 에이전트에게 보고 후 진행한다.
- 테이블·데이터 삭제 SQL을 실제 DB에 커밋해야 하는 상황이 생기면 실행 전에 메인 에이전트를 통해 사용자 승인을 받는다.

---

## 변경 01 (2026-10-13): 스킬 집계를 앞 11레벨 순서로

- 상태: **승인됨 (2026-10-13, D5~D9·C4 추천안)**
- 작성: Plan 서브에이전트 (2026-10-13)
- 근거: 사용자 결정 (선택지 C), `db/docs/db_review.md` M1·L1
- 기준: 승인된 v4 계약과 이 문서 1~10장, 적용된 마이그레이션 001~008

### 01-1. 무엇을 왜 바꾸나

> 요약: `champion_skill`을 "스킬 마스터 순서(Q>E>W)" 대신 "원본 스킬 문자열의 앞 11글자"로 센다. 11글자보다 짧은 줄은 뺀다. 느린 `skill_priority` 호출이 사라져 M1(집계 시간)도 풀린다.

| 항목 | 지금 (v4) | 변경 후 |
|------|-----------|---------|
| 묶는 값 | `skill_priority(skill_order)` → `Q>E>W` 등 6개 | `left(skill_order, 11)` → 예: `EQQWQRQEQEREEW` → `EQQWQRQEQER` |
| 대상 줄 | 포지션 있음 + 5레벨 도달 2개 이상 | 포지션 있음 + `length(skill_order) >= 11` (NULL·빈 문자열·10자 이하 제외) |
| 저장 개수 | 전부 (최대 6개) | **상위 10개** (D7) |
| 원본 `match_players.skill_order` | 그대로 | **그대로** (바꾸지 않음) |

- 이유 (사용자 결정): 전체 문자열은 게임 길이마다 달라 조합이 너무 잘게 나뉜다. 앞 11레벨로 고정하면 조합이 모이면서도 실제 레벨별 찍는 순서를 보여준다.
- 부수 효과: 집계 시간의 약 절반(5,000게임 기준 약 4.0초)을 차지하던 `skill_priority` 호출이 없어진다 (M1 해결).
- 범위 밖: 원본 테이블, 다른 집계 테이블, 티어 뷰, `purge_old_patches`는 바꾸지 않는다. 백엔드·API 계약은 아직 없으므로 영향 받는 코드가 없다.

### 01-2. 계약 변경 (C3)

> 요약: `champion_skill`의 컬럼 이름·뜻·CHECK를 바꾼다. 컬럼 이름은 `skill_order`(뜻: 앞 11레벨)를 추천한다. PK 구성은 같고 컬럼 이름만 따라 바뀐다.

| 항목 | 지금 | 변경 후 |
|------|------|---------|
| 컬럼 | `skill_priority text NOT NULL` | **`skill_order text NOT NULL`** — "스킬 찍은 순서 앞 11레벨 (예: `EQQWQRQEQER`)" |
| CHECK | `champion_skill_skill_priority_check`: 6개 값 중 하나 | **`champion_skill_skill_order_check`: `skill_order ~ '^[QWER]{11}$'`** |
| PK | `(patch, champion_id, position, skill_priority)` | `(patch, champion_id, position, skill_order)` (제약 이름 `champion_skill_pkey` 그대로) |
| FK, RLS, 권한 | - | 그대로 |

- 이름 추천 이유: 원본 컬럼 `match_players.skill_order`와 같은 형식(Q/W/E/R 문자열)이라 백엔드·프론트가 같은 방식으로 읽는다. 뜻이 "앞 11레벨"이라는 점은 컬럼 주석·계약에 적는다. 다른 후보: `skill_order_11`(뜻이 이름에 드러나지만 길다), `skill_build`.
- 용량: 챔피언 × 포지션당 최대 6줄 → 최대 10줄. 패치당 약 1,600줄 증가, 약 0.2MB로 무시할 수준 (계약 1-2 숫자는 바꾸지 않음).

#### `docs/contracts/db_contract.md` 수정 내용 (Build가 승인 후 반영)

| 위치 | 수정 |
|------|------|
| 머리말 상태 | `v4 승인됨` → `v5 승인됨 (2026-10-13, 변경 01)`. 바로 아래에 "v4 → v5 변경" 표 추가: "`champion_skill`을 앞 11레벨 순서로 (컬럼 `skill_priority` → `skill_order`, 11자 미만 제외, 상위 10개), `skill_priority` 함수 삭제(D6 ★)" |
| 2장 테이블 목록 `champion_skill` 줄 | "스킬 마스터 순서 1개 / `Q>E>W` 형식" → "스킬 찍은 순서 앞 11레벨 1개 / `EQQWQRQEQER` 형식. **상세 화면**" |
| 4장 ERD | `champion_skill["champion_skill · 스킬 앞 11레벨 순서"]`, `text skill_order PK "EQQWQRQEQER"` |
| 9-1 함수 목록 | `skill_priority` 줄 삭제 (D6이 "남김"이면 "집계에서 쓰지 않음"으로 표시) |
| 9-2 `champion_skill` 줄 | "`skill_order`가 11자 이상인 줄만(NULL·빈 문자열·10자 이하 제외), `left(skill_order, 11)`로 묶는다. **상위 10개**" |
| 9-2 `champion_spell` 줄 (선택, C4) | "두 주문이 같은 줄(`summoner1_id = summoner2_id`)은 뺀다" 추가 — 이미 구현된 동작을 문서에 맞추는 것 (Review 5장 권장) |
| 10장 확정 사항 | 11번 추가: "스킬 집계: 원본 스킬 순서 앞 11레벨, 11자 미만 제외, 챔피언 × 포지션당 상위 10개 (변경 01)" |

#### `docs/contracts/db_contract.dbml` 수정 내용

```dbml
// v5 (2026-10-13) - 변경 01: champion_skill을 앞 11레벨 순서로   ← 머리 주석 2번째 줄 교체

Table champion_skill [headercolor: #534AB7, note: '''
챔피언 x 포지션별 스킬 찍은 순서 (앞 11레벨). 상세 화면
- match_players.skill_order 의 앞 11글자로 묶는다 (11글자 미만인 줄은 제외)
- 예: EQQWQRQEQEREEW → EQQWQRQEQER
- 챔피언 x 포지션마다 상위 10개
'''] {
  patch text [not null]
  champion_id int [not null]
  position text [not null]
  skill_order text [not null, note: '스킬 찍은 순서 앞 11레벨 (예: EQQWQRQEQER)']
  pick int [not null, note: '이 순서로 찍은 게임 수']
  win int [not null, note: '그중 이긴 게임 수']

  indexes {
    (patch, champion_id, position, skill_order) [pk]
  }
}
```

#### D3과 `skill_priority` 함수

| 대상 | 처리 |
|------|------|
| D3 (스킬 집계 대상: 5레벨 도달 2개 이상) | **변경 01로 대체.** 새 규칙: "11자 이상인 줄만, 앞 11글자". 기존 9-2 표의 D3 줄은 기록으로 남긴다 |
| `skill_priority(text)` 함수 | 선택지: (a) **삭제** (b) 쓰지 않고 남김 (c) 나중 "선마" 표시용으로 남기되 빠른 `regexp_instr` 버전으로 교체. **★(a) 삭제** — 집계에서 쓰는 곳이 없어지고, 남기면 계약·테스트·권한 검사에 쓰지 않는 함수가 계속 남는다. 나중에 선마 표시가 필요하면 그때 새 마이그레이션으로 빠른 버전을 만들면 된다 (Review가 확인한 `regexp_instr(p_order, 'Q', 1, 5)` 방식). 앞 11레벨 문자열만으로도 화면에서 선마를 대부분 읽을 수 있다(보통 9레벨에 첫 스킬 5레벨). **`DROP FUNCTION`은 사용자 승인 필요** (데이터 삭제는 아님) |

### 01-3. 마이그레이션 009

> 요약: 새 파일 `db/migrations/009_skill_order_prefix.sql` 하나로 컬럼 이름을 바꾸고(`RENAME`), CHECK를 바꾸고, 집계 함수를 새 규칙으로 다시 만든다. 테이블을 지우거나 다시 만들지 않으므로 데이터가 지워지지 않는다. 001~008은 고치지 않는다.

#### 방식 비교

| 방식 | 내용 | 판단 |
|------|------|------|
| **★A. `ALTER TABLE … RENAME COLUMN` + CHECK 교체** | 테이블은 그대로. PK 인덱스·FK·RLS·`REVOKE`·테이블 주석이 그대로 유지됨 | **추천.** 지우는 SQL이 없고, 004의 보안 설정을 다시 할 필요가 없다 |
| B. `DROP TABLE` 후 `CREATE TABLE` | 깨끗하지만 RLS·`REVOKE`·FK·주석을 다시 만들어야 함 | 되돌릴 수 없는 SQL이라 승인이 필요하고 얻는 것이 없다 |

#### 009 내용 (순서대로, 파일 1개 = 트랜잭션 1개)

```sql
-- 009: champion_skill을 앞 11레벨 순서로 (db_spec 변경 01)
-- 데이터를 지우지 않는다. 집계 줄이 있으면 멈춘다 (예전 형식 값은 새 CHECK를 통과하지 못하므로).

-- 1. 안전장치: 집계 줄이 있으면 중단 (지금은 0줄)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM champion_skill) THEN
    RAISE EXCEPTION '009: champion_skill에 기존 형식 줄이 있어 중단합니다. 데이터는 지우지 않았습니다.';
  END IF;
END $$;

-- 2. 컬럼·CHECK 변경 (PK는 컬럼 이름을 따라감)
ALTER TABLE champion_skill DROP CONSTRAINT champion_skill_skill_priority_check;
ALTER TABLE champion_skill RENAME COLUMN skill_priority TO skill_order;
ALTER TABLE champion_skill ADD CONSTRAINT champion_skill_skill_order_check
  CHECK (skill_order ~ '^[QWER]{11}$');

COMMENT ON TABLE champion_skill IS '챔피언 x 포지션별 스킬 찍은 순서 앞 11레벨. skill_order가 11자 이상인 줄만 앞 11글자로 센다. 상위 10개만 저장';
COMMENT ON COLUMN champion_skill.skill_order IS '스킬 찍은 순서 앞 11레벨 (예: EQQWQRQEQEREEW → EQQWQRQEQER)';
COMMENT ON COLUMN champion_skill.pick IS '이 순서로 찍은 게임 수';   -- 그대로 다시 적음

-- 3. refresh_patch_stats 다시 만들기: 006 본문 그대로, 7-4 부분만 아래로 교체
--    (인자·반환 jsonb 키·잠금·오류 코드 모두 같음. skill_rows 키 유지)
CREATE OR REPLACE FUNCTION refresh_patch_stats(p_patch text) ... ;   -- 전체 본문을 다시 적는다
COMMENT ON FUNCTION refresh_patch_stats(text) IS '… (006과 같음)';
REVOKE EXECUTE ON FUNCTION refresh_patch_stats(text) FROM PUBLIC, anon, authenticated;

-- 4. (D6 = (a) 승인 시에만) 쓰지 않는 함수 삭제 — 사용자 승인 필요
DROP FUNCTION skill_priority(text);
```

- 새 7-4 부분 (상위 10개 규칙은 룬·스펠과 같음: `pick` 내림 → `win` 내림 → 키 오름):

```sql
  -- 7-4. champion_skill: skill_order 11자 이상인 줄만 앞 11글자로, 상위 10개
  INSERT INTO champion_skill (patch, champion_id, position, skill_order, pick, win)
  SELECT p_patch, k.champion_id, k.team_position, k.skill_order, k.pick, k.win
  FROM (
    SELECT g.*,
           row_number() OVER (
             PARTITION BY g.champion_id, g.team_position
             ORDER BY g.pick DESC, g.win DESC, g.skill_order
           ) AS rn
    FROM (
      SELECT champion_id, team_position,
             left(skill_order, 11) AS skill_order,
             count(*) AS pick,
             count(*) FILTER (WHERE win) AS win
      FROM tmp_base
      WHERE team_position IS NOT NULL
        AND length(skill_order) >= 11          -- NULL·빈 문자열·10자 이하 제외
      GROUP BY champion_id, team_position, left(skill_order, 11)
    ) g
  ) k
  WHERE k.rn <= 10;
  GET DIAGNOSTICS v_skill = ROW_COUNT;
```

- 데이터 삭제 확인: 009에는 `DELETE`, `TRUNCATE`, `DROP TABLE`이 없다. `DROP CONSTRAINT`(CHECK)와 `DROP FUNCTION`(D6)은 구조만 지운다. 집계 테이블은 지금 0줄이고, 줄이 있으면 1번 안전장치가 멈춘다.
- 권한: `CREATE OR REPLACE`는 기존 권한을 유지하지만 004·006과 같은 방식으로 `REVOKE`를 다시 적는다. 테이블은 `RENAME`이라 004의 `REVOKE`·RLS가 그대로 남는다. 새 객체를 만들지 않으므로 L2(기본 권한) 위험이 없다.
- 함수 본문은 실행기가 정한 `search_path`로 `SET search_path FROM CURRENT`를 그대로 쓴다 (005·006과 같음).
- 적용 순서: `migrate:fresh-check`(임시 스키마 001~009) 통과 → `verify:fresh` 통과 → 실제 DB `migrate` → `verify`.

### 01-4. L1 수정: `db/scripts/lib.mjs` (승인 필요)

> 요약: 비밀번호에 잘못된 `%`가 있어도 사용자 이름·호스트가 가려지도록, `decodeURIComponent`만 따로 `try`로 감싼다.

- 지금: `decodeURIComponent(u.password)`가 예외를 던지면 같은 `try` 안의 `u.username`, `u.hostname`이 가림 목록에 들어가지 않는다.
- 수정 (`secretsToHide()`만):

```js
try {
  const u = new URL(url);
  if (u.password) {
    out.push(u.password);
    try { out.push(decodeURIComponent(u.password)); } catch { /* 잘못된 % 인코딩: 원문만 가린다 */ }
  }
  if (u.username) {
    out.push(u.username);
    try { out.push(decodeURIComponent(u.username)); } catch { /* 위와 같음 */ }
  }
  if (u.hostname) out.push(u.hostname);
} catch {
  /* 형식이 이상해도 전체 문자열은 가린다 */
}
```

- 확인 (가짜 값만 사용, 실제 `.env` 읽지 않음): `DATABASE_URL='postgresql://tester:Fa%zzPw999@nonexistent-host.invalid:5432/db' node -e "import('./scripts/lib.mjs').then(m => console.log(m.redact('ENOTFOUND nonexistent-host.invalid tester Fa%zzPw999')))"` → `ENOTFOUND *** *** ***`. 정상 인코딩 비밀번호(`p%40ss` → `p@ss`)도 두 형태 모두 가려지는지 확인.

### 01-5. 테스트 (모두 ROLLBACK)

> 요약: 기존 테스트 3개를 새 규칙에 맞게 고치고, 스킬 전용 테스트 1개를 추가한다. 5,000게임과 2만 5천 게임을 실제로 재서 집계 시간을 다시 확인한다.

| 파일 | 수정 |
|------|------|
| `db/tests/002_helper_functions.sql` | `skill_priority` 8건 블록 삭제 (D6 = (a)). (b)·(c)면 그대로 둠 |
| `db/tests/003_refresh_patch_stats.sql` | s1의 스킬 샘플을 바꾸고 기대값을 고친다 (아래) |
| `db/tests/006_security.sql` | `v_funcs`에서 `skill_priority(text)` 제거 (D6 = (a)). 남은 함수 4개 권한 검사 |
| **`db/tests/007_skill_order.sql` (새 파일)** | 앞 11글자 규칙, 상위 10개, CHECK, 함수 삭제 확인 (아래) |

#### 003 샘플 변경 (s1 = 챔피언 23 TOP, A팀 승리 = g ≤ 12)

| 게임 | `skill_order` | 길이 | 결과 |
|------|---------------|------|------|
| g 1~15 | `EQQWQRQEQEREEW` | 14 | `EQQWQRQEQER`로 묶임 |
| g 16~17 | `QWEQWE` | 6 | 제외 |
| g 18 | `WEWEWEWEWE` | 10 (경계) | **제외** |
| g 19 | `WEWEWEWEWER` | 11 (경계) | 포함, 그대로 |
| g 20 | `WEWEWEWEWERQQ` | 13 | `WEWEWEWEWER`로 묶임 |
| s2~s10 | NULL | - | 제외 |

- 기대값: `champion_skill` (0.1, 23, TOP) = **`EQQWQRQEQER 15/12, WEWEWEWEWER 2/0`**, 반환 jsonb `skill_rows = 2` (나머지 키 그대로). 검사 쿼리의 `skill_priority`는 `skill_order`로 바꾼다.

#### 007 새 테스트 (패치 `0.3`, 10줄 게임)

| 확인 | 기대값 |
|------|--------|
| 상위 10개 + 동률 | 한 챔피언 × 포지션에 서로 다른 11자 문자열 12개를 1판씩 (짝수 게임 승리) → 승리 6개(문자열 오름차순) + 패배 중 문자열 오름차순 4개 = 10줄, 나머지 2개 제외. 기대 문자열 목록은 Build가 실행 전에 손으로 적는다 |
| 같은 앞 11글자 묶기 | `EQQWQRQEQEREEW`, `EQQWQRQEQERWW`, `EQQWQRQEQER` → 한 줄 pick 3 |
| 경계 | 10자 `EQQWQRQEQE` 제외, NULL·`''` 제외, 포지션 NULL 줄 제외 |
| CHECK 거부 (23514) | `champion_skill.skill_order` = `'Q>E>W'`, `'EQQWQRQEQE'`(10자), `'EQQWQRQEQERE'`(12자), `'EQQWQRQEQEX'` |
| 구조 | `champion_skill`에 `skill_priority` 컬럼 없음, `skill_order` 컬럼 있음, PK 4개 컬럼 = `(patch, champion_id, position, skill_order)` |
| 함수 삭제 (D6 = (a)) | `to_regprocedure('skill_priority(text)') IS NULL` |

- 테스트는 `verify.mjs`가 파일 이름순으로 돌리므로 `007_…`을 넣기만 하면 된다. 실제 데이터가 있으면 건너뛰는 규칙(Build 다른 점 8)은 쓰지 않아도 된다 (`purge`를 부르지 않음).

#### 성능 다시 재기 (롤백)

| 규모 | 지금 (Review 측정) | 목표 | 예상 |
|------|--------------------|------|------|
| 5,000게임 (5만 줄, 챔피언당 아이템 약 40종, 실제 같은 14~18자 스킬 문자열) | 8.6초 | **6초 이하** | 약 4.6~5초 (Review의 `skill_order` NULL 측정 4.6초 + `left()` 묶기) |
| 2만 5천 게임 (25만 줄) | 약 43초 (선형 추정) | **직접 측정해 40초 이하** (`statement_timeout` 2분 대비 3배 이상 여유) | 약 25초 |

- 2만 5천 게임은 추정이 아니라 롤백 트랜잭션 안에서 1번 직접 잰다. 롤백한 줄의 빈 공간은 autovacuum이 정리한다 (무료 플랜 500MB 안에서 일시적으로 수십 MB).
- 목표를 넘으면 Build는 멈추고 측정값을 보고한다 (백엔드 `SET statement_timeout` 등은 `!백엔드` 범위).

### 01-6. 완료 기준 (Review)

> 요약: Review가 실제 DB를 직접 조회해 하나씩 확인할 수 있는 목록이다.

- [ ] `migrate:status`에서 001~009 적용됨, 체크섬 불일치 없음. 001~008 파일이 바뀌지 않음 (`git diff` 없음)
- [ ] `migrate:fresh-check` 통과 (001~009), `migration_check` 스키마 남지 않음
- [ ] `champion_skill` 컬럼 = `patch, champion_id, position, skill_order, pick, win` (순서·타입·NOT NULL), `skill_priority` 컬럼 없음
- [ ] PK `champion_skill_pkey` = `(patch, champion_id, position, skill_order)`, FK CASCADE 그대로, CHECK `champion_skill_skill_order_check` = `^[QWER]{11}$`, 예전 CHECK 없음
- [ ] RLS 켜짐·정책 0개, `anon`·`authenticated` 테이블 권한 없음, `refresh_patch_stats` EXECUTE 회수 (`proacl`에 PUBLIC 없음)
- [ ] (D6 = (a)) `skill_priority(text)` 없음. 다른 함수·뷰가 이 함수를 쓰지 않음
- [ ] `pg_proc.prosrc`의 `refresh_patch_stats` 본문 = 009 파일 본문 (md5)
- [ ] 직접 만든 시나리오: `EQQWQRQEQEREEW` → `EQQWQRQEQER`, 10자 제외, 11자 정확히 포함, 상위 10개·동률 순서, 다른 집계 5개 결과가 009 전과 같음 (Build 003 샘플의 champion/item/rune/spell 줄 비교)
- [ ] `npm run verify`, `verify:fresh` 모두 통과, 검증 후 모든 테이블 줄 수가 검증 전과 같음
- [ ] 성능: 5,000게임 6초 이하, 2만 5천 게임 직접 측정 40초 이하
- [ ] L1: 잘못된 `%` 비밀번호 가짜 URL에서 사용자 이름·호스트·비밀번호가 `***`로 가려짐
- [ ] 계약 `.md`·`.dbml`이 01-2 표대로 바뀌고 서로 같음 (`champion_skill` 컬럼·CHECK·PK·설명, 함수 목록)
- [ ] `db_build.md`에 변경 01 결과(기능 / 구현 내용 / 상태)와 계약 반영 여부 기록

### 01-7. 작업 범위

> 요약: Build는 새 마이그레이션 009, 테스트, `lib.mjs`, 구현 기록, 승인된 계약 수정만 고친다. Review는 검토 기록, 구현 기록, 새 번호 마이그레이션, 커리어 기록만 고친다.

| 단계 | 수정 가능 경로 | 비고 |
|------|----------------|------|
| Build | `db/migrations/009_skill_order_prefix.sql` | 새 파일만. **001~008 수정 금지** |
| Build | `db/tests/` | 002, 003, 006 수정, 007 추가 |
| Build | `db/scripts/lib.mjs` | L1 (`secretsToHide()`만) |
| Build | `db/docs/db_build.md` | 아래에 "변경 01" 절 추가 |
| Build | `docs/contracts/db_contract.md`, `docs/contracts/db_contract.dbml` | 01-2의 승인된 수정만 |
| Review | `db/docs/db_review.md` | 아래에 "변경 01 검토" 절 추가 |
| Review | `db/docs/db_build.md` | 수정한 기능 반영 |
| Review | `db/migrations/` | 새 번호 파일(010~)만 |
| Review | `docs/career_log.md` | 아래에 추가만 |

- 범위 밖: `backend/`, `frontend/`, `db/scripts/migrate.mjs`·`verify.mjs`, `db/package*.json`, 루트 `.env`(읽기만, 값 출력 금지), `.env.example`, `CLAUDE.md`, 이 문서의 기존 절.
- `DROP FUNCTION skill_priority(text)`는 D6 승인이 있을 때만 009에 넣는다. 그 밖의 삭제 SQL이 필요해지면 실행 전에 메인 에이전트를 통해 사용자 승인을 받는다.

### 01-8. 결정 필요 사항

> 요약: 아래 추천안대로 진행해도 되는지 확인만 받으면 된다.

| # | 결정 | 선택지 | ★추천 |
|---|------|--------|-------|
| D5 | 새 컬럼 이름 | `skill_order` / `skill_order_11` / `skill_build` | **★`skill_order`** (원본과 같은 형식, 뜻 "앞 11레벨"은 주석·계약에 적음) |
| D6 | `skill_priority` 함수 | (a) 삭제 / (b) 쓰지 않고 남김 / (c) 선마 표시용으로 빠른 버전 교체 | **★(a) 삭제** (`DROP FUNCTION` 승인 필요, 데이터 삭제 아님). 필요하면 나중에 새 마이그레이션 |
| D7 | 스킬 저장 개수 | 상위 10개 / 상위 20개 / 전부 | **★상위 10개** (룬·스펠과 같은 규칙, 긴 꼬리 조합이 많아 전부는 낭비, 화면은 2개) |
| D8 | 009 방식 | `RENAME` + CHECK 교체 / `DROP TABLE` 후 다시 생성 | **★`RENAME`** (지우는 SQL 없음, 보안 설정 유지) |
| D9 | L1 수정을 이번에 포함 | 포함 / 다음에 | **★포함** (`lib.mjs` 몇 줄) |
| C4 | 계약 9-2에 스펠 같은 번호 제외 문구 추가 | 함께 / 다음에 | **★함께** (문서만, 동작 변화 없음) |

- 알려진 한계: 11레벨 전에 끝난 게임(이른 항복, 레벨이 낮은 서포터)은 스킬 집계에서 빠진다. 첫 실제 수집 뒤 포지션별 제외 비율(`length(skill_order) < 11`)을 재서 크면 사용자에게 알린다.

---

## 변경 02 (2026-10-14): 테스트 수집 범위(플래티넘~다이아)와 집계 전 ANALYZE

- 상태: **승인됨 (2026-10-14, D10=a 백엔드 ANALYZE, D11 아이언~골드 제외, D12 전환 시 결정)**
- 작성: Plan 서브에이전트 (2026-10-14)
- 근거: 사용자 결정 (테스트 수집 범위), `db/docs/db_review.md` "변경 01 검토" M2·L5
- 기준: 계약 v5 (`db_contract.md`, `db_contract.dbml`), 이 문서 1~10장과 변경 01, 적용된 마이그레이션 001~009

### 02-1. 무엇을 왜 바꾸나

> 요약: 세 가지를 바꾼다. ① 첫 실제 수집(테스트)을 플래티넘·에메랄드·다이아 각 50명으로 하려고 `ranked_players.tier`에 `PLATINUM`을 허용한다. ② 집계가 수 분 걸리는 문제(M2)를 막으려고 "집계 직전에 `ANALYZE`" 규칙을 계약에 적는다. ③ `champion_skill.skill_order`의 CHECK 형식을 계약에 직접 적는다(L5).

| # | 항목 | 지금 (v5) | 변경 후 (v6) |
|---|------|-----------|--------------|
| 1 | 수집 범위 | 에메랄드 이상 4 : 4 : 2 하나뿐 | **테스트 수집**과 **본 수집**을 나눠 적는다. 테스트 = 플래티넘·에메랄드·다이아 각 50명(150명), 본 수집 = 지금 그대로(에메랄드 이상 4 : 4 : 2, 테스트 뒤 다시 정함) |
| 2 | `ranked_players.tier` 허용 값 | `EMERALD`, `DIAMOND`, `MASTER`, `GRANDMASTER`, `CHALLENGER` | **`PLATINUM`** 추가. 마스터 이상은 나중 본 수집을 위해 그대로 둔다 |
| 3 | 집계 호출 순서 | `refresh_patch_stats` 바로 호출 | 바로 앞에 **`ANALYZE matches, match_players`** (백엔드 규칙, D10 ★(a)) |
| 4 | `champion_skill.skill_order` 형식 | "앞 11레벨"과 예시만 | **CHECK `^[QWER]{11}$`** 를 `.md`·`.dbml`에 적음 (DB는 009부터 이미 강제, 동작 변화 없음) |

- 테스트를 플래티넘~다이아로 하는 이유 (사용자 결정): 마스터·그랜드마스터·챌린저는 디비전이 없어서 `league-v4 entries/{tier}/{division}`으로 디비전마다 고르게 뽑을 수 없다. 이 셋은 별도 리그 API(`masterleagues` 등)가 필요하므로 테스트에서는 뺀다.
- 바꾸지 않는 것: 테이블 구성, 다른 CHECK, 집계 함수 본문(D10 = (a)일 때), 티어 뷰, `purge_old_patches`, 보안 설정.

### 02-2. 테스트 수집 규모 다시 계산

> 요약: 150명 × 최대 20게임에서 겹치는 게임을 빼면 **약 2,700게임**이다. 개발 키로 **약 2시간**, 용량은 **약 12MB**다. 화면 흐름 검증용이고, 티어를 믿을 만한 표본은 아니다.

| 항목 | 계산 | 값 |
|------|------|-----|
| 표본 플레이어 | 3티어 × 50명, 디비전 I~IV에 12~13명씩 (예: I·II 13명, III·IV 12명) | 150명 |
| 게임 ID | 150명 × 최대 20게임 = 3,000. 같은 게임에 표본 2명 이상이 나오는 겹침 약 10% 제외 | **약 2,700게임** |
| Riot 호출 | 리그 목록 12회(3티어 × 4디비전) + 게임 ID 목록 150회 + 게임당 2회(`getMatch`, `timeline`) × 2,700 = 5,400 | 약 5,560회 |
| 시간 | 2분 100회 제한 = 시간당 약 3,000회 | **약 1.9시간 (약 2시간)** |
| `match_players` | 27,000줄 × 약 400B | 약 11MB |
| `matches`, `ranked_players` | 2,700줄 × 180B + 150줄 × 150B | 약 0.5MB |
| 집계 6개 | 패치 1~2개, 25,000게임 기준 패치당 약 4MB보다 조합이 적음 | 약 1MB 이하 |
| **합계** | | **약 12MB / 500MB** |

- 챔피언 × 포지션 1개에 평균 약 30판이다(27,000줄 ÷ 약 800조합). 티어 최소 표본 50판(계약 10장 3번)을 못 넘는 조합이 많아 **대부분 티어가 NULL**로 나온다. 테스트의 목적은 수집 → 저장 → `ANALYZE` → 집계 → API 흐름 검증이다.
- 최근 20게임이 패치 2개에 걸칠 수 있다. 저장 규칙(최근 2개 패치)은 그대로 적용한다.
- 키가 24시간에 만료되므로 2시간 수집은 한 번에 끝낼 수 있다. 만료되면 기존 규칙대로 `key_expired`로 멈춘다.
- **티어·디비전별 인원, 디비전 안에서 고르는 방법(페이지·무작위 등), 플레이어당 게임 수는 백엔드 수집기 설정이다.** DB는 `tier`·`rank` 허용 값만 강제하고 비율은 확인하지 않는다.

### 02-3. 계약 변경 (C5, Build가 승인 후 반영)

> 요약: 계약을 v6으로 올리고, 아래 표의 위치만 정확히 바꾼다. `.md`와 `.dbml`은 서로 같아야 한다.

#### `docs/contracts/db_contract.md`

| 위치 | 수정 (정확한 문구) |
|------|--------------------|
| 머리말 상태 (5행) | `- 상태: **v6 승인됨 (2026-10-14, 변경 02)**` |
| 머리말 기준 (6행) | `(v5, 2026-10-13 사용자 확정)` → `(v6, 2026-10-14 변경 02)` |
| "v4 → v5 변경" 표 **위에** 새 표 추가 | 아래 "v5 → v6 변경 표" |
| 1장 요약 | `> 요약: KR 서버 **솔로랭크**, **최근 2개 패치**의 게임만 모은다. 첫 실제 수집(**테스트**)은 **플래티넘·에메랄드·다이아 각 50명**, **본 수집**은 **에메랄드 이상**이다. 패치당 최대 **2만 5천 게임**이다.` |
| 1-1 표 "티어" 줄 | `\| 티어 \| 테스트: 플래티넘·에메랄드·다이아 각 50명 (1-3). 본 수집: 에메랄드 이상 (에메랄드 : 다이아 : 마스터 이상 = 4 : 4 : 2, 테스트 뒤 다시 정함) \| 표본 품질. 한 티어에 몰리지 않게 비율 고정 \|` |
| 1-1 표 아래 한 줄 추가 | `- \`ranked_players.tier\` 허용 값: \`PLATINUM\`, \`EMERALD\`, \`DIAMOND\`, \`MASTER\`, \`GRANDMASTER\`, \`CHALLENGER\` (CHECK \`ranked_players_tier_check\`). \`IRON\`~\`GOLD\`는 저장할 수 없다.` |
| 1-3 제목·내용 교체 | 아래 "1-3 새 내용" |
| 2장 `ranked_players` 줄 | `수집 대상 표본(에메랄드 이상)` → `수집 대상 표본(테스트: 플래티넘~다이아, 본 수집: 에메랄드 이상)` |
| 4장 ERD `ranked_players.tier` | `text tier "EMERALD ~ CHALLENGER"` → `text tier "PLATINUM ~ CHALLENGER"` |
| 4장 ERD `champion_skill.skill_order` | `text skill_order PK "EQQWQRQEQER"` → `text skill_order PK "^[QWER]{11}$, EQQWQRQEQER"` |
| 5장 ① 줄 | `(에메랄드·다이아)` → `(테스트: 플래티넘·에메랄드·다이아, 본 수집: 에메랄드·다이아)`, `4 : 4 : 2 비율로 표본 선정` → `티어·디비전별 인원은 백엔드 수집기 설정 (1-1, 1-3)` |
| 5장 ⑥ 줄 | `\| ⑥ \| \`ANALYZE matches, match_players\` → \`SELECT refresh_patch_stats('16.19')\` \| 원본 통계를 새로 고친 뒤 패치 전체를 처음부터 다시 셈 (9-4) \| 집계 6개 \|` |
| 6-1 `tier` 줄 | 예시 값 `EMERALD` 그대로, JSON 경로 뒤에 `. 허용 값은 1-1` 추가 |
| 7장 표 마지막에 줄 추가 | `\| 집계 호출 \| \`refresh_patch_stats\` 직전에 같은 연결에서 \`ANALYZE matches, match_players\`를 실행한다 (9-4) \|` |
| 9-1 요약 | `… 다시 만들고,` → `… 다시 만들기 전에 \`ANALYZE matches, match_players\`를 먼저 실행하고,` |
| 9-2 `champion_skill` 줄 끝 | `저장 형식은 CHECK \`champion_skill_skill_order_check\`: \`skill_order ~ '^[QWER]{11}$'\` (Q·W·E·R 정확히 11자).` 추가 (L5) |
| 9-3 다음에 새 9-4 추가 | 아래 "9-4 새 내용" |
| 10장 2번 | `\| 2 \| 수집 티어 \| 테스트: 플래티넘·에메랄드·다이아 각 50명, 디비전 I~IV 고르게 (변경 02). 본 수집: 에메랄드 이상 4 : 4 : 2 (테스트 뒤 다시 정함) \|` |
| 10장 12번 추가 | `\| 12 \| 집계 전 통계 \| 백엔드가 \`refresh_patch_stats\` 직전에 \`ANALYZE matches, match_players\` (변경 02, M2) \|` |

v5 → v6 변경 표:

```markdown
### v5 → v6 변경 (변경 02, 2026-10-14)

| 변경 | 이유 |
|------|------|
| 수집 범위를 테스트(플래티넘·에메랄드·다이아 각 50명)와 본 수집(에메랄드 이상 4 : 4 : 2)으로 나눔. `ranked_players.tier`에 `PLATINUM` 허용 (마이그레이션 `010_ranked_players_platinum.sql`) | 사용자 결정. 마스터 이상은 디비전이 없어 `entries/{tier}/{division}`으로 고르게 뽑을 수 없으므로 테스트에서 뺌 |
| 집계 직전 `ANALYZE matches, match_players` 규칙 (9-4) | 원본 통계가 틀리면 2만 5천 게임 집계가 3~5분을 넘김. `ANALYZE` 후 5~7초 (db_review M2) |
| `champion_skill.skill_order` CHECK `^[QWER]{11}$`를 문서에 적음 | DB는 v5부터 강제. 문서에 빠져 있었음 (db_review L5) |
```

1-3 새 내용:

```markdown
### 1-3. 개발 단계 운영 (테스트 수집)

- 첫 실제 수집은 **테스트 수집**으로 수집 → 저장 → 집계 → 화면 흐름을 검증한다.
- 표본: **플래티넘·에메랄드·다이아 각 50명, 모두 150명.** 각 티어에서 디비전 I~IV에 12~13명씩 고르게 고른다. `league-v4` `/lol/league/v4/entries/RANKED_SOLO_5x5/{tier}/{division}`만 쓴다.
- 마스터·그랜드마스터·챌린저는 디비전이 없어 같은 방식으로 고르게 뽑을 수 없으므로 테스트에서 뺀다. 본 수집 때 별도 리그 API로 다시 정한다.
- 예상 규모: 약 2,700게임 (150명 × 최대 20게임, 겹침 제외), 개발 키로 약 2시간, 약 12MB. 챔피언 × 포지션당 평균 약 30판이라 티어는 대부분 NULL("표본 부족")이다.
- 티어·디비전별 인원, 디비전 안에서 고르는 방법, 플레이어당 게임 수는 **백엔드 수집기 설정**이다. DB는 허용 값(1-1)만 확인한다.
- 개발 키(24시간 만료)를 사용자가 매일 직접 발급해 `.env`에 넣고, 수집은 명령어로 직접 실행한다.
- 키가 만료되면(401/403) 수집을 멈추고 `collection_logs.status = 'key_expired'`로 기록한다.
```

9-4 새 내용:

```markdown
### 9-4. 백엔드 호출 규칙

> 요약: 집계 직전에 원본 두 테이블의 통계를 새로 고친다. 통계가 틀리면 같은 집계가 5초에서 5분 이상으로 늘어난다.

| 순서 | SQL | 이유 |
|------|-----|------|
| 1 | `ANALYZE matches, match_players` | 대량 수집·삭제 직후 통계가 "페이지는 있는데 줄은 0개"로 남으면 플래너가 원본을 1줄로 보고 느린 Nested Loop를 고른다. 2만 5천 게임에서 집계가 3~5분을 넘겼고, `ANALYZE` 후 5~7초였다 (db_review M2). `ANALYZE` 자체는 0.35~3.3초 |
| 2 | `SELECT refresh_patch_stats($1)` | 패치마다 1번. 여러 패치면 1번의 `ANALYZE` 뒤에 차례로 |
| 3 | `SELECT purge_old_patches(2)` | 집계를 마친 뒤 (5장 ⑦) |

- 1과 2는 같은 연결에서 실행한다. 트랜잭션 안이어도 된다 (`ANALYZE`는 `VACUUM`과 달리 트랜잭션 안에서 실행 가능).
- `ANALYZE`는 테이블 주인(또는 `MAINTAIN` 권한) 역할만 실행할 수 있다. 백엔드는 테이블 주인 계정으로 접속하므로 그대로 쓴다 (11장).
- 집계 호출 연결은 `SET statement_timeout`을 넉넉히(예: 5분) 둔다.
- 함수 안의 임시 테이블만 `ANALYZE`하는 방식은 효과가 없었다 (느린 문장이 원본 조인 자체이기 때문).
```

#### `docs/contracts/db_contract.dbml`

```dbml
// v6 (2026-10-14) - 변경 02: 테스트 수집 범위(플래티넘~다이아), 집계 전 ANALYZE, skill_order CHECK 명시   ← 머리 주석 2번째 줄 교체

Table ranked_players [headercolor: #0F6E56, note: '''
① 수집 대상 플레이어 (표본)
- 출처: league-v4 /lol/league/v4/entries/{queue}/{tier}/{division}
- 테스트 수집: 플래티넘 · 에메랄드 · 다이아 각 50명, 디비전 I~IV 고르게 (티어별 인원은 백엔드 수집기 설정)
- 본 수집: 에메랄드 이상, 에메랄드 : 다이아 : 마스터 이상 = 4 : 4 : 2 (테스트 뒤 다시 정함)
- 이 사람들의 puuid로 게임 ID를 찾는다
'''] {
  puuid text [pk, note: '플레이어 고유 ID. 응답의 puuid']
  tier text [not null, note: '티어. 응답의 tier (PLATINUM | EMERALD | DIAMOND | MASTER | GRANDMASTER | CHALLENGER). CHECK ranked_players_tier_check']
  rank text [not null, note: '티어 안의 단계. 응답의 rank (I | II | III | IV)']
}
```

- `champion_skill` 블록의 `skill_order` 줄만 교체:

```dbml
  skill_order text [not null, note: '스킬 찍은 순서 앞 11레벨 (예: EQQWQRQEQER). CHECK skill_order ~ \'^[QWER]{11}$\'']
```

- 뷰 메모 아래에 집계 호출 메모 추가:

```dbml
// ───────────── 집계 호출 규칙 (db_contract.md 9-4) ─────────────
// 백엔드는 refresh_patch_stats 직전에 같은 연결에서 ANALYZE matches, match_players 를 실행한다 (변경 02, M2)
```

- DBML의 `checks` 문법은 dbdiagram 버전에 따라 지원이 달라서 쓰지 않고 `note`에 적는다 (기존 방식과 같음).
- 작은따옴표 이스케이프가 dbdiagram에서 깨지면 `note: "…"`(큰따옴표)로 바꿔도 된다. 뜻만 같으면 Build가 고른다.

### 02-4. 마이그레이션 010

> 요약: 새 파일 `db/migrations/010_ranked_players_platinum.sql` 하나로 `ranked_players`의 티어 CHECK를 지우고 `PLATINUM`을 더한 CHECK로 다시 만든다. 데이터는 지우지 않는다. D10이 (a)면 010은 이것뿐이다.

```sql
-- 010: ranked_players.tier에 PLATINUM 허용 (db_spec 변경 02)
-- 데이터를 지우지 않는다. 지금 0줄이지만 ADD CONSTRAINT는 NOT VALID 없이 기존 줄을 검사한다.

ALTER TABLE ranked_players DROP CONSTRAINT ranked_players_tier_check;
ALTER TABLE ranked_players ADD CONSTRAINT ranked_players_tier_check
  CHECK (tier IN ('PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'));

COMMENT ON TABLE ranked_players IS '① 수집 대상 플레이어 (표본). 출처: league-v4 /lol/league/v4/entries/{queue}/{tier}/{division}, 마스터 이상은 masterleagues 등. 테스트 수집: 플래티넘~다이아 각 50명, 본 수집: 에메랄드 이상';
COMMENT ON COLUMN ranked_players.tier IS 'tier (마스터 이상은 리스트 최상위 tier). PLATINUM | EMERALD | DIAMOND | MASTER | GRANDMASTER | CHALLENGER';
```

- 제약 이름은 001과 같은 `ranked_players_tier_check`를 쓴다 (테스트·계약에서 이름으로 찾음).
- `NOT VALID`를 쓰지 않는다. 0줄이라 검사 비용이 없고, 나중에 줄이 있어도 허용 값을 늘리기만 하므로 기존 줄은 모두 통과한다.
- 데이터 삭제 확인: `DELETE`, `TRUNCATE`, `DROP TABLE`이 없다. `DROP CONSTRAINT`는 같은 트랜잭션에서 바로 다시 만드는 구조 변경이다 (009와 같은 판단). 파일 1개 = 트랜잭션 1개라 중간에 실패하면 001의 CHECK가 그대로 남는다.
- 새 객체가 없으므로 RLS·`REVOKE`·기본 권한(L2)에 영향이 없다.
- **D10 = (b')일 때만** 010에 덧붙인다: `refresh_patch_stats`를 009 본문 그대로 `CREATE OR REPLACE`하되 1번 잠금(`pg_advisory_xact_lock`) 바로 뒤에 `ANALYZE matches, match_players;`를 넣고, `COMMENT ON FUNCTION`·`REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`를 다시 적는다. 계약 9-4는 "함수가 직접 실행하므로 백엔드는 따로 하지 않아도 된다"로 바뀐다.
- 적용 순서: `migrate:fresh-check`(임시 스키마 001~010) 통과 → `verify:fresh` 통과 → 실제 DB `migrate` → `verify`.

### 02-5. 테스트 (모두 ROLLBACK)

> 요약: 새 테스트 파일 1개로 허용 값과 거부 값을 확인한다. 기존 테스트는 고치지 않는다.

| 파일 | 내용 |
|------|------|
| **`db/tests/008_ranked_players_tier.sql` (새 파일)** | 아래 표 |
| 기존 001~007 | 고치지 않음. 001의 `EMERALD` 샘플은 그대로 통과해야 함 |

| 확인 | 기대값 |
|------|--------|
| 허용 | `PLATINUM`, `EMERALD`, `DIAMOND`, `MASTER`, `GRANDMASTER`, `CHALLENGER` 6개 모두 INSERT 성공 (puuid는 `test-008-…`처럼 다른 테스트와 겹치지 않게) |
| 거부 (23514 `check_violation`) | `IRON`, `BRONZE`, `SILVER`, `GOLD` (D11 = 제외 유지), 소문자 `platinum`, 빈 문자열 `''`. 각각 하위 블록에서 시도해 거부 개수 6개 확인 |
| 구조 | `pg_get_constraintdef`에 `PLATINUM`이 있고 `convalidated = true`. `ranked_players`의 CHECK가 `tier_check`·`rank_check` 2개뿐 (예전 CHECK가 남지 않음) |
| 함께 쓰는 FK | `PLATINUM` 플레이어를 `matches.puuid`로 참조하는 1줄 INSERT 성공 (패치 `0.4`, `KR_9000000001` 같은 테스트 값) |
| (D10 = (b')일 때만) | `pg_proc.prosrc`에 `ANALYZE matches, match_players`가 있고, 003 테스트 기대값이 그대로 |

- `verify.mjs`가 파일 이름순으로 돌리므로 `008_…`을 넣기만 하면 된다. 실제 데이터가 있어도 테스트 puuid가 겹치지 않으면 건너뛸 필요가 없다.
- 성능 다시 재기는 하지 않는다 (함수가 바뀌지 않음). D10 = (b')일 때만 5,000게임 1회를 재서 변경 01 수치(약 1.9초)와 비교한다.

### 02-6. 완료 기준 (Review)

> 요약: Review가 실제 DB를 직접 조회해 하나씩 확인할 수 있는 목록이다.

- [ ] `migrate:status`에서 001~010 적용됨, 체크섬 불일치 없음. 001~009 파일이 바뀌지 않음 (`git diff` 없음)
- [ ] `migrate:fresh-check` 통과 (001~010), `migration_check` 스키마 남지 않음
- [ ] `ranked_players_tier_check` = `tier IN ('PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER')`, `convalidated = true`, 같은 테이블에 다른 티어 CHECK 없음
- [ ] 직접 시험(롤백): `PLATINUM`·`MASTER` 저장 성공, `GOLD`·`BRONZE`·`platinum` 거부
- [ ] `ranked_players` 테이블·`tier` 주석이 010 문구와 같음
- [ ] RLS 켜짐·정책 0개, `anon`·`authenticated` 권한 없음 (006 보안 테스트 통과)
- [ ] D10 = (a): `refresh_patch_stats`의 `md5(prosrc)`가 변경 01 검토 값 `c4740067177eeb20705db20dd308ed07`와 같음 (함수가 바뀌지 않음). D10 = (b')면 새 본문 md5 = 010 파일 본문, `ANALYZE` 위치가 잠금 뒤·`tmp_games` 앞
- [ ] 계약 v6: `.md`·`.dbml`이 02-3 표대로 바뀌고 서로 같음 (수집 범위 테스트/본 수집 구분, `tier` 허용 값, 9-4 `ANALYZE` 규칙, 5장 ⑥, 7장 줄, `skill_order` CHECK 문구)
- [ ] (권장) 계약 9-4 규칙대로 "나쁜 통계 → `ANALYZE` → 집계"를 롤백 안에서 5,000게임 1회 재현해 시간 기록. 큰 측정은 1~2회만 (db_review C7 참고: 죽은 줄 용량)
- [ ] `npm run verify`, `verify:fresh` 모두 통과 (008 포함), 검증 후 모든 테이블 줄 수가 검증 전과 같음
- [ ] `db_build.md`에 변경 02 결과(기능 / 구현 내용 / 상태)와 계약 반영 여부 기록

### 02-7. 작업 범위

> 요약: Build는 새 마이그레이션 010, 테스트, 구현 기록, 승인된 계약 수정만 고친다. Review는 검토 기록, 구현 기록, 새 번호 마이그레이션, 커리어 기록만 고친다.

| 단계 | 수정 가능 경로 | 비고 |
|------|----------------|------|
| Build | `db/migrations/010_*.sql` | 새 파일만 (`010_ranked_players_platinum.sql`). **001~009 수정 금지** |
| Build | `db/tests/` | `008_ranked_players_tier.sql` 추가. D10 = (b')면 기존 테스트에 `ANALYZE` 확인 추가 가능 |
| Build | `db/docs/db_build.md` | 아래에 "변경 02" 절 추가 |
| Build | `docs/contracts/db_contract.md`, `docs/contracts/db_contract.dbml` | 02-3의 승인된 수정만 |
| Review | `db/docs/db_review.md` | 아래에 "변경 02 검토" 절 추가 |
| Review | `db/docs/db_build.md` | 수정한 기능 반영 |
| Review | `db/migrations/` | 새 번호 파일(011~)만 |
| Review | `docs/career_log.md` | 아래에 추가만 |

- 범위 밖: `backend/`, `frontend/`, `db/scripts/`, `db/package*.json`, 루트 `.env`(읽기만, 값 출력 금지), `.env.example`, `CLAUDE.md`, 이 문서의 기존 절.
- 010 밖의 삭제 SQL이 필요해지면 실행 전에 메인 에이전트를 통해 사용자 승인을 받는다.
- 백엔드 수집기의 티어·디비전별 인원 설정과 `ANALYZE` 호출 구현은 `!백엔드` Plan에서 이 계약 v6을 읽고 정한다.

### 02-8. 결정 필요 사항

> 요약: 아래 추천안대로 진행해도 되는지 확인만 받으면 된다.

| # | 결정 | 선택지 | ★추천 |
|---|------|--------|-------|
| D10 | M2: 집계 전 `ANALYZE`를 어디서 하나 | (a) 백엔드가 집계 직전에 실행 (계약 9-4 규칙) / (b') 010에서 `refresh_patch_stats` 맨 앞에 `ANALYZE` 추가 | **★(a)**. Review가 시험으로 확인한 방식이고, 백엔드는 "방금 대량으로 넣었다"를 알고 있다. 010이 CHECK 교체 한 가지로 작아지고 180줄 함수 본문을 다시 적지 않는다. (b')는 DB 안에서 보장되는 장점이 있지만 모든 집계·테스트 호출마다 0.35~3.3초가 붙는다. 백엔드 Review에서 규칙이 지켜지지 않으면 그때 새 마이그레이션으로 (b')를 넣는다. (참고: 임시 테이블만 `ANALYZE`하는 (b)는 효과가 없어 후보에서 뺌) |
| D11 | `IRON`~`GOLD` 허용 여부 | 제외 유지 / 10개 티어 모두 허용 | **★제외 유지**. CHECK가 실제 수집 범위를 문서처럼 보여 주고, 실수로 낮은 티어가 섞이면 저장 단계에서 막는다. 필요해지면 010과 같은 한 줄 마이그레이션으로 늘린다 |
| D12 | 테스트 데이터를 본 수집 전에 어떻게 하나 | 본 수집 전환 때 다시 결정 / 지금 규칙 정함 | **★전환 때 다시 결정**. 같은 패치에서 본 수집을 시작하면 플래티넘 게임이 집계에 섞인다. 지우려면 `ranked_players.tier = 'PLATINUM'`인 표본으로 찾은 `matches`를 지우는 삭제 SQL이 필요하고 사용자 승인 대상이다. 지금은 계약 1-3에 "테스트"라고만 적는다 |

- 알려진 한계: `matches.puuid`는 "처음 찾은 표본 1명"이라, 플래티넘 표본과 에메랄드 표본이 같은 게임에 나오면 어느 티어 표본의 게임인지는 먼저 찾은 쪽만 남는다. 테스트 목적(흐름 검증)에는 영향이 없다.
