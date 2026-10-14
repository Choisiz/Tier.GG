# DB 마이그레이션 계획 (`!db`)

- 상태: **승인됨 (2026-10-13, D1=a DB 뷰, D2~D4·C1 추천안)**
- 작성: Plan 서브에이전트 (2026-10-13, v4 기준으로 재작성)
- 기준 계약: `docs/contracts/db_contract.dbml` (v4, 사용자 확정, 우선), `docs/contracts/db_contract.md` (초안 v4)
- 근거 데이터: 실제 솔로랭크 게임 `KR_8408851980` (패치 16.19, 1295초)
- 대상: Supabase 무료 플랜, PostgreSQL 17, Session pooler 접속

> **변경 01 (2026-10-13, 승인됨): 스킬 집계를 앞 11레벨 순서로.** 이 문서 맨 아래 "변경 01" 절을 본다. 승인되면 아래 기존 절의 `skill_priority`, `champion_skill`(4-7, 7-1, 7-3, 7-4, 8-5), D3 내용은 변경 01이 대신한다. 기존 절은 기록으로 그대로 둔다.

> **변경 02 (2026-10-14, 승인됨): 테스트 수집 범위(플래티넘~다이아)와 집계 전 ANALYZE.** 이 문서 맨 아래 "변경 02" 절을 본다. 승인되면 `ranked_players.tier` 허용 값(4-1)과 계약 1장 수집 범위·9장 호출 규칙은 변경 02가 대신한다.

> **변경 03 (2026-10-14, 승인됨): 패치 기준 → 최근 14일 기준.** 이 문서 맨 아래 "변경 03" 절을 본다. 승인되면 집계 테이블(4-5~4-7)의 `patch` 키, `patch` 테이블, `refresh_patch_stats`·`purge_old_patches`(7장), 티어 뷰(7-6), 원본 보관 규칙은 변경 03이 대신한다.

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

---

## 변경 03 (2026-10-14): 패치 기준 → 최근 14일 기준

- 상태: **승인됨 (2026-10-14, D13~D23 추천안, 되돌릴 수 없는 작업 1~4·6·7 승인)**
- 작성: Plan 서브에이전트 (2026-10-14)
- 근거: 사용자 결정 (통계를 패치 단위에서 "최근 14일" 이동 창으로 바꿈)
- 기준: 계약 v6 (`db_contract.md`, `db_contract.dbml`), 이 문서 1~10장·변경 01·변경 02, 적용된 마이그레이션 001~010, `db/tests/001~008`, 백엔드 Build 결과(`backend/docs/back_spec.md`, `back_build.md`, `docs/contracts/api_contract.md`, 아직 Review 전)

### 03-1. 무엇을 왜 바꾸나

> 요약: 통계 기준을 "패치"에서 "**최근 14일에 시작한 게임**"으로 바꾼다. 새 패치 직후 표본이 급감하는 문제와 복잡한 "직전 패치 대체" 규칙이 없어진다. 대신 패치가 바뀌는 시기에는 두 패치가 섞이므로, 창 안의 **패치 구성 비율**(예: 16.19 40% / 16.20 60%)을 DB가 함께 저장한다.

| # | 항목 | 지금 (v6) | 변경 후 (v7) |
|---|------|-----------|--------------|
| 1 | 통계 단위 | 패치 1개 (`patch` 키) | **최근 14일 창 1개** (현재 스냅숏 1개, 패치 키 없음) |
| 2 | 원본 시각 | 없음 | `matches.game_start_at timestamptz NOT NULL` (`info.gameStartTimestamp`, ms) |
| 3 | 분모 | `patch.games` | `stats_window.games` (창 안의 완료 게임 수) |
| 4 | 패치 구성 | 없음 | `stats_window_patch (patch, games)` — 창 안 패치별 게임 수 |
| 5 | 집계 함수 | `refresh_patch_stats(p_patch)` | `refresh_window_stats(p_days DEFAULT 14, p_until DEFAULT now())` |
| 6 | 원본 정리 | `purge_old_patches(p_keep DEFAULT 2)` (최신 2개 패치 보관) | `purge_old_games(p_keep_days DEFAULT 21)` (시작 시각이 21일보다 오래된 게임 삭제) |
| 6-1 | 집계 시점 | 수집이 끝날 때마다 백엔드가 호출 | **매일 05:00 KST(20:00 UTC) Supabase Cron(`pg_cron`) 작업**이 `ANALYZE` → `refresh_window_stats(14)` (03-11, D23 확정). 백엔드 `aggregate` 명령은 시험용으로 남김 |
| 7 | 수집 | 게임 ID 목록 + "보관 패치 밖" 거르기 | 게임 ID 목록에 `startTime = now − 14일` (백엔드) |
| 8 | 티어 뷰 | `champion JOIN patch`, `patch` 컬럼 | `champion CROSS JOIN stats_window`, `patch` 컬럼 없음 |

- 바꾸지 않는 것: 티어 최소 50판, 티어 공식·경계값(`tier_from_score`), 개수만 저장하고 비율·티어는 뷰에서 계산, 상위 N 규칙(룬·스펠·스킬 10개, 아이템 전부), 10줄 = 완료 게임, 원본 컬럼의 Riot 필드 이름, `matches.patch`(패치 구성 표시에 씀), `patch_sort_key`(구성 정렬에 계속 씀), RLS·`REVOKE`·CHECK 방식, 집계 전 `ANALYZE` 백엔드 규칙(9-4).
- 받아들인 한계 (사용자 결정): 패치 직후에는 두 패치가 섞이고, 변화가 14일에 걸쳐 서서히 나타난다. 화면에 패치 구성을 보여 주어 투명하게 한다.

### 03-2. 집계 구조 비교와 결정 (D13, 확정)

> 요약: 집계를 "현재 스냅숏 1개"로 두는 (a)로 **확정**했다 (사용자 승인 2026-10-14). 정확하고(상위 N을 창 전체에서 자름), 용량이 일정하고(시간이 지나도 늘지 않음), 가장 단순하다.

| 안 | 구조 | 정확도 | 용량 (500MB 무료) | 단순함 |
|----|------|--------|-------------------|--------|
| **★(a) 현재 스냅숏 1개** | 집계 테이블에서 `patch` 키를 빼고, 1줄짜리 `stats_window`(창 시작·끝·게임 수·집계 시각) + `stats_window_patch`(패치 구성) | ✅ 창 전체에서 한 번에 세고 상위 10개를 자름 | 집계 약 4~10MB로 **고정** (지금은 패치마다 4~10MB씩 누적, 1년 약 310~460MB) | ✅ 키가 줄고 조회에 패치 조건이 없음. 집계는 매번 통째로 다시 만듦 |
| (b) 스냅숏 키 `as_of date` | (a) + 모든 집계 테이블 PK에 `as_of`, 이력 보관 | ✅ | ❌ 매일 집계하면 하루 4~10MB × 365 = 1.5~3.6GB. 보관 개수를 정하는 정리 함수가 또 필요 | ⚠️ 키와 정리 규칙 추가 |
| (c) 일별 묶음, 조회 때 합산 | `day` 키로 하루씩 저장, API가 14일을 `SUM` | ❌ 하루마다 상위 10개를 자르면 14일 합산 순위가 틀림(날마다 11위인 조합이 빠짐). 정확하려면 모든 조합을 날마다 저장해야 함 | ❌ 룬 조합 전부 × 14일이면 (a)의 수 배 | ❌ 조회마다 합산·재정렬, 뷰 공식도 합산 뒤 계산 |

- (a)의 집계 방식: `refresh_window_stats`가 한 트랜잭션 안에서 기존 스냅숏을 `DELETE`하고 다시 넣는다. `TRUNCATE`가 아니라 `DELETE`라서 집계 중에도 API는 커밋 전 이전 스냅숏을 그대로 읽는다 (MVCC, 읽기 잠금 없음).
- 과거 스냅숏이 필요해지면(추세 그래프 등) 그때 별도 이력 테이블을 제안한다. 이번 범위가 아니다.

### 03-3. 계약 변경 (C6, v7)

> 요약: 계약을 v7로 올린다. 원본은 `matches.game_start_at` 1개 추가, 집계는 `patch` 테이블을 `stats_window`·`stats_window_patch`로 바꾸고 나머지 5개 테이블에서 `patch` 컬럼을 뺀다. 함수 2개를 새 이름으로 바꾸고 뷰를 다시 정의한다. `.md`와 `.dbml`은 서로 같아야 한다.

#### 03-3-1. 테이블 정의 (DB가 강제하는 형태)

```sql
-- 원본: matches에 1개 추가
game_start_at timestamptz NOT NULL
  CONSTRAINT matches_game_start_at_check CHECK (game_start_at >= timestamptz '2020-01-01 00:00:00+00')
  -- info.gameStartTimestamp(ms) → timestamptz. 초를 ms로 착각해 1970년이 되는 실수를 저장 단계에서 막는다

-- 집계: 창 정보 (항상 0줄 또는 1줄)
CREATE TABLE stats_window (
  id            smallint    NOT NULL DEFAULT 1,
  days          int         NOT NULL,
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  games         int         NOT NULL,
  aggregated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stats_window_pkey PRIMARY KEY (id),
  CONSTRAINT stats_window_id_check CHECK (id = 1),
  CONSTRAINT stats_window_days_check CHECK (days BETWEEN 1 AND 60),
  CONSTRAINT stats_window_range_check CHECK (window_start < window_end),
  CONSTRAINT stats_window_games_check CHECK (games > 0)
);

-- 집계: 창 안 패치 구성
CREATE TABLE stats_window_patch (
  patch text NOT NULL,
  games int  NOT NULL,
  CONSTRAINT stats_window_patch_pkey PRIMARY KEY (patch),
  CONSTRAINT stats_window_patch_patch_check CHECK (patch ~ '^[0-9]+\.[0-9]+$'),
  CONSTRAINT stats_window_patch_games_check CHECK (games > 0)
);

-- 집계 5개: 002와 같되 patch 컬럼이 없다
champion       PK (champion_id, position)                         + 002의 CHECK 그대로
champion_item  PK (champion_id, position, item_id)                FK (champion_id, position) → champion ON DELETE CASCADE
champion_rune  PK id (identity), UNIQUE (champion_id, position, 룬 11개)  FK 같음
champion_spell PK (champion_id, position, spell1_id, spell2_id)   FK 같음, CHECK spell1_id < spell2_id
champion_skill PK (champion_id, position, skill_order)            FK 같음, CHECK skill_order ~ '^[QWER]{11}$'
```

- `stats_window_patch`는 `stats_window`와 FK로 잇지 않는다. 둘 다 `refresh_window_stats`만 쓰고, 같은 트랜잭션에서 함께 지우고 넣는다. `sum(stats_window_patch.games) = stats_window.games`는 테스트로 확인한다 (CHECK로는 표현 불가).
- 구성 비율(%)은 저장하지 않는다 (개수만 저장 원칙). 백엔드가 `100 × games / stats_window.games`로 계산한다 (상세 테이블 비율과 같은 "단순 나눗셈" 규칙).
- `stats_window.window_end - window_start`가 `days`일인지는 CHECK로 걸지 않는다 (`timestamptz + interval`은 IMMUTABLE이 아님). 함수가 `p_days * interval '24 hours'`로 계산하고 테스트로 확인한다.

#### 03-3-2. `docs/contracts/db_contract.md`

| 위치 | 수정 |
|------|------|
| 머리말 상태 | `- 상태: **v7 승인됨 (2026-10-14, 변경 03)**` (Build가 승인 후 반영) |
| 머리말 기준 | `(v6, 2026-10-14 변경 02)` → `(v7, 2026-10-14 변경 03)` |
| 머리말 범위 | `범위: 챔피언 티어리스트 …` 끝에 ` 통계는 최근 14일 게임 기준.` 추가 |
| "v5 → v6 변경" 표 **위에** 새 표 | 아래 "v6 → v7 변경 표" |
| 1장 요약 | `> 요약: KR 서버 **솔로랭크**, **최근 14일에 시작한** 게임만 모은다. 원본은 **21일** 보관한다. 첫 실제 수집(**테스트**)은 **플래티넘·에메랄드·다이아 각 100명**, **본 수집**은 **에메랄드 이상**이다. 14일 창에 최대 **2만 5천 게임**이다.` |
| 1-1 표 "원본 보관" 줄 | `\| 원본 보관 \| **시작 시각 기준 최근 21일** (통계 창 14일 + 여유 7일) \| 무료 용량. 오래된 원본은 \`purge_old_games\`로 삭제 \|` |
| 1-1 표 "패치당 게임 수" 줄 | `\| 창당 게임 수 \| 최근 14일 최대 25,000게임 \| 아래 용량 계산 기준 \|` |
| 1-1 표 "집계 결과" 줄 | `\| 집계 결과 \| **현재 창 1개만** (집계할 때마다 통째로 다시 만듦) \| 약 4~10MB로 고정 \|` |
| 1-1 표에 줄 추가 | `\| 수집 기간 \| 게임 ID 목록을 \`startTime = 지금 − 14일\`(초)로 요청 \| 창 밖 게임은 처음부터 받지 않는다 \|` |
| 1-2 제목·표 교체 | 아래 03-5 "본 수집" 표 (제목 `### 1-2. 용량 계산 (14일 창 25,000게임, 원본 21일 보관)`) |
| 1-3 | "각 50명, 모두 150명" → "각 100명, 모두 300명", "디비전 I~IV에 12~13명씩" → "디비전 I~IV에 25명씩", 예상 규모 줄을 03-5 "테스트" 값으로 |
| 2장 표 | `matches` 설명 `게임 ID, 찾을 때 쓴 표본 플레이어, 패치` → `게임 ID, 찾을 때 쓴 표본 플레이어, 패치, 시작 시각`. `patch` 줄을 지우고 `\| 집계 \| \`stats_window\` \| 현재 창 1개 (0~1줄) \| 창 시작·끝, 전체 게임 수(픽률·밴률 분모), 집계 시각 \|`, `\| 집계 \| \`stats_window_patch\` \| 창 안 패치 1개 \| 패치별 게임 수 (패치 구성 표시) \|` 추가. `champion` 한 줄 의미 `패치 × 챔피언 × 포지션` → `챔피언 × 포지션`. 테이블 수 "10개" → "11개" |
| 3장 | 요약을 `… 집계는 \`champion\` → 상세 4개로 이어지고, \`stats_window\`·\`stats_window_patch\`는 따로 선다.` 로. 표의 `patch 1 : N champion` 줄 삭제, 상세 FK를 `(champion_id, position)`으로. 끝 문단 "`patch` 1줄을 지우면 …"을 "집계 함수는 `champion`을 지워(상세 4개 CASCADE) 다시 만든다"로 |
| 4장 ERD | `patch` 엔터티와 `patch ||--o{ champion` 줄 삭제, `stats_window`·`stats_window_patch` 엔터티 추가(관계 없음), `matches`에 `timestamptz game_start_at "info.gameStartTimestamp"`, 집계 5개에서 `text patch PK,FK` 삭제, 관계 라벨 `patch+champion_id+position` → `champion_id+position`. 요약 "dbml v6" → "dbml v7" |
| 5장 | ② 줄 SQL에 `&startTime={지금 − 14일, 초}` 추가. ③ 줄 하는 일 `패치, 참가자 10명, 밴` → `패치, 시작 시각, 참가자 10명, 밴`. ⑥ `SELECT refresh_patch_stats('16.19')` → `매일 05:00 KST pg_cron 작업 tiergg_daily_refresh: ANALYZE matches, match_players → SELECT refresh_window_stats(14)`, 하는 일 `최근 14일 완료 게임 전체를 처음부터 다시 셈. 수집과 따로 돈다 (9-4)`, 채우는 곳 `집계 7개`. ⑦ `SELECT purge_old_patches(2)` → `SELECT purge_old_games(21)`, 하는 일 `시작 시각이 21일보다 오래된 원본 삭제 (수동, 사용자 확인 뒤)`. 끝 문단 "⑥은 ⑦보다 먼저 한다. 원본을 지운 패치는 다시 집계할 수 없다." → "⑥은 ⑦보다 먼저 한다." |
| 6-2 표 | 줄 추가 `\| \`game_start_at\` \| \`info.gameStartTimestamp\` \| \`1760000000000\` (ms) \| ms → timestamptz (\`new Date(ms)\`). 값이 없으면 저장하지 않음 \|` (예시 값은 Build가 실제 fixture `KR_8408851980` 값으로 바꿈) |
| 7장 표 | "보관 패치 밖 게임" 줄 → `\| 창 밖 게임 \| \`startTime\`으로 요청하므로 보통 없다. \`gameStartTimestamp\`가 지금 − 14일보다 이르면 저장하지 않는다 (권장) \|`. 줄 추가 `\| 시작 시각 \| \`info.gameStartTimestamp\`(ms, UTC)를 그대로 timestamptz로. 2020-01-01 이전이면 CHECK 거부 \|`. "집계 호출" 줄 `refresh_patch_stats` → `refresh_window_stats` |
| 8장 | 집계 PK 줄 `(patch, champion_id, position, …)` → `(champion_id, position, …)`, 용도 `티어리스트, 챔피언 상세 조회`. `champion_rune` 유니크 `(champion_id, position, 룬 11개)`. `stats_window`·`stats_window_patch` PK 줄 추가. "만들지 않는 인덱스"에 `matches.game_start_at` 추가 (최대 약 3만 7천 줄이라 순차 스캔, D21) |
| 9장 요약 | `> 요약: 백엔드는 \`ANALYZE matches, match_players\` 뒤에 \`SELECT refresh_window_stats(14)\`로 최근 14일 집계를 통째로 다시 만들고, 사용자 확인 뒤 \`SELECT purge_old_games(21)\`로 오래된 원본을 지운다. 비율과 티어는 저장하지 않고 조회할 때 계산한다.` |
| 9-1 표 | 아래 "9-1 새 표" |
| 9-2 | 아래 "9-2 바뀌는 줄" |
| 9-3 | 뷰 줄 표에서 `patch` 컬럼 삭제, `games` 정의 `stats_window.games`, 픽률·밴률 공식 분모 `patch.games` → `stats_window.games`, 사용 예 `SELECT * FROM champion_tier_view WHERE position = $1 ORDER BY tier NULLS LAST, tier_score DESC`. "화면 패치 선택(새 패치 초반에 직전 패치 대체)…" 줄을 `- 패치 구성: \`SELECT patch, games FROM stats_window_patch ORDER BY patch_sort_key(patch) DESC\`. 비율은 백엔드가 \`100 × games / stats_window.games\`로 계산` 로 교체 |
| 9-4 | 요약을 `> 요약: 집계는 DB의 매일 예약 작업(pg_cron)이 한다. 통계 갱신 → 집계 순서는 예약 작업과 백엔드 시험 명령 모두 같다.` 로. 표 위에 03-11 "9-4 예약 작업 문구"를 넣는다. 표 2번 `SELECT refresh_patch_stats($1)` / "패치마다 1번…" → `SELECT refresh_window_stats(14)` / `하루 1번 예약 작업이 실행. 백엔드 aggregate 명령(시험용)도 같은 순서`. 3번 `SELECT purge_old_patches(2)` → `SELECT purge_old_games(21)` / `집계를 마친 뒤, 사용자 확인(\`--yes\`) 뒤에만` |
| 10장 | 4번 `새 패치 초반 표시` → `\| 4 \| 통계 기준 \| 최근 14일에 시작한 게임 (변경 03). 패치 대체 규칙 없음. 패치 구성을 함께 표시 \|`. 6번 → `\| 6 \| 원본 보관 \| 시작 시각 기준 21일 (변경 03) \|`. 7번 `dbml v6 (원본 3, 집계 6, 운영 1 …)` → `dbml v7 (원본 3, 집계 7, 운영 1)`. 2번 테스트 인원 `각 50명` → `각 100명`. 13번 추가 `\| 13 \| 집계 보관 \| 현재 14일 창 스냅숏 1개만 (D13) \|`. 14번 추가 `\| 14 \| 집계 시점 \| 매일 05:00 KST(20:00 UTC) pg_cron 작업 \`tiergg_daily_refresh\` (D23). 수집 뒤 자동 집계 없음 \|` |
| 11장 | 끝에 줄 추가: `- Supabase 기본 권한(\`pg_default_acl\`)이 새 객체에 \`anon\`·\`authenticated\` 권한을 주므로, 새 테이블·시퀀스·뷰·함수는 만들 때마다 이름을 적어 \`REVOKE\`한다. 보안 테스트는 스키마의 모든 객체를 자동으로 검사한다 (db_review L2).` |

v6 → v7 변경 표:

```markdown
### v6 → v7 변경 (변경 03, 2026-10-14)

| 변경 | 이유 |
|------|------|
| 통계 기준을 패치 → **최근 14일에 시작한 게임**으로. 집계는 현재 창 스냅숏 1개 (`patch` 테이블 → `stats_window`, 집계 5개에서 `patch` 컬럼 삭제) | 사용자 결정. 새 패치 직후 표본 급감과 직전 패치 대체 규칙을 없앰. 14일은 패치 주기(약 2주)와 비슷 |
| `matches.game_start_at` 추가 (`info.gameStartTimestamp`) | 창에 넣을지 판단하는 기준 |
| `stats_window_patch` 추가 (창 안 패치별 게임 수) | 두 패치가 섞이는 시기를 화면에 투명하게 보여줌 |
| `refresh_patch_stats` → `refresh_window_stats(p_days, p_until)`, `purge_old_patches` → `purge_old_games(p_keep_days)` (원본 21일 보관) | 패치 대신 시각 기준 |
| 테스트 수집 인원 티어당 50명 → 100명 | 14일 창 안 게임만 받으므로 플레이어당 게임 수가 줄어듦 |
```

9-1 새 표:

```markdown
| 함수 | 반환 | 하는 일 |
|------|------|---------|
| `refresh_window_stats(p_days int DEFAULT 14, p_until timestamptz DEFAULT now())` | jsonb `{window_start, window_end, days, games, patches: [{patch, games}], champion_rows, item_rows, rune_rows, spell_rows, skill_rows}` | `[p_until − p_days일, p_until)`에 시작한 완료 게임(10줄)으로 집계 7개를 한 트랜잭션 안에서 지우고 다시 센다. 완료 게임이 0개면 **오류**(기존 집계 보존). 백엔드는 인자 없이 `refresh_window_stats(14)`만 쓴다 (`p_until`은 테스트·재현용) |
| `purge_old_games(p_keep_days int DEFAULT 21)` | int (삭제한 게임 수) | `game_start_at < now() − p_keep_days일`인 `matches` 삭제(`match_players` CASCADE). 집계는 남김. `p_keep_days`가 14 미만이거나 현재 창의 `days`보다 작으면 오류 |
| `patch_sort_key(p_patch text)` | int[] | `'16.9'` → `{16,9}`. 패치 구성 정렬에 쓴다 |
| `tier_from_score(p_score numeric)` | smallint | 점수로 1~5티어 (9-3) |
```

9-2 바뀌는 줄:

```markdown
| 대상 게임 | `matches.game_start_at >= p_until − p_days × 24시간` 이고 `< p_until` (시작 포함, 끝 제외)이며 `match_players`가 정확히 10줄인 게임. `p_until`보다 늦은(미래) 게임은 빠진다 |
| `stats_window` | 1줄: `days = p_days`, `window_start`, `window_end = p_until`, `games` = 대상 게임 수, `aggregated_at = now()` |
| `stats_window_patch` | 대상 게임을 `matches.patch`로 묶은 게임 수. 합계 = `stats_window.games` |
```

- 9-2의 나머지 줄(`champion`, `champion_item`, `champion_rune`, `champion_spell`, `champion_skill`, 상위 N 정렬)은 `patch` 말만 빼고 그대로 둔다. "`patch.games`와 `ban`에는 포함된다" → "`stats_window.games`와 `ban`에는 포함된다".

#### 03-3-3. `docs/contracts/db_contract.dbml`

```dbml
// v7 (2026-10-14) - 변경 03: 패치 기준 → 최근 14일 창. game_start_at, stats_window, stats_window_patch   ← 머리 주석 2번째 줄 교체

TableGroup "원본" [color: #0F6E56, note: 'Riot API에서 받은 값 그대로. 시작 시각 기준 최근 21일만 보관'] { … 그대로 }

TableGroup "집계" [color: #534AB7, note: '최근 14일 원본을 챔피언 x 포지션으로 묶어 센 결과. 현재 창 1개만 보관 (집계할 때마다 통째로 다시 만듦)'] {
  stats_window
  stats_window_patch
  champion
  champion_item
  champion_rune
  champion_spell
  champion_skill
}

// matches: note의 출처 줄에 "(게임 ID 목록은 &startTime=지금-14일)" 추가, 컬럼 1개 추가
  game_start_at timestamptz [not null, note: '게임 시작 시각. info.gameStartTimestamp (ms → timestamptz). CHECK >= 2020-01-01']

// patch 테이블 블록 전체 삭제 → 아래 2개로 교체
Table stats_window [headercolor: #534AB7, note: '''
현재 집계 창 1개 = 1줄 (집계 전에는 0줄)
- 픽률, 밴률의 분모(창 안의 전체 게임 수)를 보관한다
- 대상: window_start <= game_start_at < window_end 이고 match_players 10줄인 게임
'''] {
  id smallint [pk, default: 1, note: '항상 1. CHECK id = 1']
  days int [not null, note: '창 길이(일). 기본 14. CHECK 1~60']
  window_start timestamptz [not null, note: '창 시작 (포함) = window_end - days x 24시간']
  window_end timestamptz [not null, note: '창 끝 (제외). 보통 집계한 시각']
  games int [not null, note: '창 안의 완료 게임 수 (픽률·밴률 분모)']
  aggregated_at timestamptz [not null, default: `now()`, note: '집계한 시각']
}

Table stats_window_patch [headercolor: #534AB7, note: '''
창 안의 패치 1개 = 1줄. 화면의 패치 구성 (예: 16.19 40% / 16.20 60%)
- 비율은 저장하지 않는다. 백엔드가 games / stats_window.games 로 계산
- games 합계 = stats_window.games
'''] {
  patch text [pk, note: '패치 (예: 16.20). matches.patch 값']
  games int [not null, note: '창 안에서 이 패치의 완료 게임 수']
}

// champion, champion_item, champion_rune, champion_spell, champion_skill:
//   각 블록에서 `patch text [not null]` 줄 삭제, indexes의 첫 키 `patch,` 삭제,
//   note의 "패치 x 챔피언 x 포지션" → "챔피언 x 포지션", "patch.games" → "stats_window.games"

// 뷰 메모 교체
// champion_tier_view (변경 03, 마이그레이션 014)
//   champion CROSS JOIN stats_window. 컬럼: champion_id, position, pick, win, ban, games,
//   win_rate, pick_rate, ban_rate, adjusted_win_rate, tier_score, tier
//   (공식·경계값은 v6과 같음, 분모만 stats_window.games)

// 집계 호출 규칙 메모 교체
// 백엔드는 refresh_window_stats(14) 직전에 같은 연결에서 ANALYZE matches, match_players 를 실행한다 (9-4)
// purge_old_games(21)은 집계 뒤, 사용자 확인(--yes) 뒤에만 실행한다

// 관계: 집계 줄 교체
Ref: champion_item.(champion_id, position) > champion.(champion_id, position) [delete: cascade]
Ref: champion_rune.(champion_id, position) > champion.(champion_id, position) [delete: cascade]
Ref: champion_spell.(champion_id, position) > champion.(champion_id, position) [delete: cascade]
Ref: champion_skill.(champion_id, position) > champion.(champion_id, position) [delete: cascade]
// (Ref: champion.patch > patch.patch 삭제)
```

- `ranked_players` note의 "각 50명" → "각 100명" (테스트 인원, D22).

### 03-4. 마이그레이션 011~015

> 요약: 새 파일 4개로 바꾼다. 011은 테스트 게임 26개를 지우고 `game_start_at`을 NOT NULL로 더한다. 012는 옛 집계 구조(뷰·함수·테이블)를 지우고 새 집계 테이블을 만든다. 013은 새 함수 2개, 014는 새 뷰다. **001~010은 고치지 않는다.** 삭제가 있는 단계는 모두 안전장치(조건이 다르면 멈춤)를 먼저 둔다.

| 순서 | 파일 | 하는 일 | 되돌릴 수 없는 작업 |
|------|------|---------|---------------------|
| 1 | `011_matches_game_start_at.sql` | ① 안전장치: `matches`가 **26줄 초과**이거나 `16.19`·`16.20` 밖 패치가 있으면 `RAISE EXCEPTION` (예상한 테스트 게임만 지움) ② `DELETE FROM matches` (26게임, `match_players` 260줄 CASCADE) ③ `ALTER TABLE matches ADD COLUMN game_start_at timestamptz NOT NULL` + `matches_game_start_at_check` ④ `COMMENT ON COLUMN` (JSON 경로 `info.gameStartTimestamp`) | **원본 26게임 삭제 (D14, 승인 필요)** |
| 2 | `012_window_aggregate_tables.sql` | ① 안전장치: `(SELECT coalesce(sum(games),0) FROM patch) > 26`이면 멈춤 (테스트 집계만 지움) ② `DROP VIEW champion_tier_view` ③ `DROP FUNCTION refresh_patch_stats(text)`, `DROP FUNCTION purge_old_patches(int)` ④ `DROP TABLE champion_skill, champion_spell, champion_rune, champion_item, champion, patch` ⑤ 03-3-1의 `stats_window`, `stats_window_patch`, 집계 5개 `CREATE` (002의 CHECK·주석을 `patch`만 빼고 그대로) ⑥ 7개 테이블 `ENABLE ROW LEVEL SECURITY` ⑦ `REVOKE ALL … FROM anon, authenticated` (7개 테이블 + `champion_rune_id_seq`) | **뷰 1·함수 2·집계 테이블 6개 DROP (D18, 승인 필요)**. 지워지는 집계는 26게임에서 나온 파생값이라 다시 셀 수 있다 |
| 3 | `013_create_window_functions.sql` | `refresh_window_stats(int, timestamptz)`, `purge_old_games(int)` 만들기 (아래), `COMMENT ON FUNCTION`, `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (2개) | 없음 (함수 본문의 `DELETE`는 호출될 때만 실행) |
| 4 | `014_create_champion_tier_view.sql` | 새 `champion_tier_view` (아래), `COMMENT`, `REVOKE ALL ON champion_tier_view FROM anon, authenticated` | 없음 |
| 5 | `015_schedule_daily_refresh.sql` | `pg_cron` 확장 켜기 + 매일 집계 작업 `tiergg_daily_refresh` 등록 (03-11) | **확장 켜기, 예약 작업 등록 (지속 설정, D23 승인 필요)** |

- 순서 이유: 뷰가 `champion`·`patch`에 의존하므로 012에서 뷰를 먼저 지운다. 옛 함수는 PL/pgSQL이라 의존성이 잡히지 않지만, 남겨 두면 없는 테이블을 가리키므로 함께 지운다. `patch_sort_key`, `tier_from_score`는 남긴다.
- 파일 1개 = 트랜잭션 1개. 011이나 012의 안전장치가 걸리면 그 파일 전체가 롤백되고 실행기가 멈춘다 (데이터 변화 없음). 그때는 메인 에이전트에게 보고한다.
- `ALTER TABLE … ADD COLUMN … NOT NULL`은 0줄일 때만 성공한다. 011의 ② 덕분에 성공하고, 안전장치가 없더라도 줄이 남아 있으면 PostgreSQL이 스스로 거부한다.
- 이름 규칙: 테이블·제약 이름은 002와 같은 형식(`champion_pkey`, `champion_item_champion_fkey` …)으로 다시 만든다. 상세 FK 이름은 그대로 `…_champion_fkey`.
- 시퀀스: `champion_rune_id_seq`는 테이블과 함께 지워지고 새로 만들어진다 (1부터). 새 시퀀스도 `REVOKE`한다 (L2).
- 적용 순서: `migrate:fresh-check`(임시 스키마 001~015, 0줄이라 안전장치 통과. 015의 작업 등록도 함께 롤백) → `verify:fresh` → **사용자 승인 확인** → 실제 DB `migrate` → `verify`.
- 기본 권한(L2): `ALTER DEFAULT PRIVILEGES`는 지속 설정 변경이라 이번에도 하지 않는다. 대신 모든 새 객체에 이름을 적어 `REVOKE`하고, 보안 테스트(006)를 스키마 전체 검사로 바꾼다 (03-6, D19).

#### 26게임 처리 (D14)

| 안 | 방법 | 장단점 |
|----|------|--------|
| **★(a) 지우고 다시 수집** | 011에서 안전장치 뒤 삭제, `NOT NULL`로 바로 추가. 백엔드 Review가 새 수집기로 수십 게임을 다시 모음 | 계약이 처음부터 깔끔(`NOT NULL`), 마이그레이션 1단계. 26게임은 흐름 시험용이라 잃는 것이 없고, 백엔드 Review는 어차피 "소량 실제 수집"을 다시 한다. 패치 16.19 게임은 14일 창 밖일 가능성도 크다 |
| (b) 다시 받아 채우기 | 011은 nullable로 추가 → `!백엔드`가 26게임 상세를 다시 받아(26회 호출) `game_start_at` 채움 → 015에서 `NULL` 없음 확인 뒤 `SET NOT NULL` | 데이터는 남지만 순서가 `!db` → `!백엔드` → `!db`로 꼬이고, 그동안 계약이 "임시로 NULL 가능" 상태 |
| (c) 계속 NULL 허용 | nullable로 두고 집계에서 NULL 제외 | 저장 실수를 DB가 막지 못함 |

- (a)에서 `ranked_players`(표본)와 `collection_logs`(실행 기록)는 지우지 않는다. `matches.puuid` FK는 `matches` 쪽만 지우므로 영향이 없다.
- 011~014 적용 뒤부터 백엔드 변경 전까지는 지금 백엔드 수집기가 `game_start_at` 없이 INSERT하므로 **실패한다** (나쁜 데이터를 저장하지 않고 멈춤). API도 `patch` 테이블이 없어 오류를 낸다. `!백엔드` 변경 전에는 수집·API를 실행하지 않는다.

#### 013 함수 (요지)

```sql
CREATE OR REPLACE FUNCTION refresh_window_stats(p_days int DEFAULT 14, p_until timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path FROM CURRENT AS $$
DECLARE v_start timestamptz; v_games int; v_patches jsonb; v_champion int; v_item int; v_rune int; v_spell int; v_skill int;
BEGIN
  -- 1. 인자 검사 (잠금보다 먼저)
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'refresh_window_stats: p_days는 1~60이어야 합니다: %', coalesce(p_days::text, 'NULL') USING ERRCODE = '22023';
  END IF;
  IF p_until IS NULL OR p_until > now() THEN
    RAISE EXCEPTION 'refresh_window_stats: p_until은 지금 이전이어야 합니다: %', coalesce(p_until::text, 'NULL') USING ERRCODE = '22023';
  END IF;
  v_start := p_until - p_days * interval '24 hours';

  -- 2. 스냅숏이 1개뿐이므로 잠금도 1개
  PERFORM pg_advisory_xact_lock(hashtext('refresh_window_stats'));
  (009와 같이 pg_temp.tmp_games / tmp_base 가 있으면 DROP)

  -- 3. 대상 게임: 창 안에서 시작했고 10줄인 게임 (패치도 함께)
  CREATE TEMP TABLE tmp_games ON COMMIT DROP AS
  SELECT m.match_id, m.patch
  FROM matches m JOIN match_players mp ON mp.match_id = m.match_id
  WHERE m.game_start_at >= v_start AND m.game_start_at < p_until
  GROUP BY m.match_id, m.patch
  HAVING count(*) = 10;

  SELECT count(*) INTO v_games FROM tmp_games;
  IF v_games = 0 THEN
    RAISE EXCEPTION 'refresh_window_stats: % ~ % 에 완료된 게임(10줄)이 없습니다. 기존 집계를 그대로 둡니다.', v_start, p_until USING ERRCODE = 'P0002';
  END IF;

  -- 4. tmp_base: 009와 같음
  -- 5. 기존 스냅숏 삭제 (DELETE라서 커밋 전까지 읽는 쪽은 이전 스냅숏을 본다)
  DELETE FROM champion WHERE true;            -- 상세 4개 CASCADE
  DELETE FROM stats_window_patch WHERE true;
  DELETE FROM stats_window WHERE true;
  -- 6. 창 정보와 패치 구성
  INSERT INTO stats_window (id, days, window_start, window_end, games) VALUES (1, p_days, v_start, p_until, v_games);
  INSERT INTO stats_window_patch (patch, games) SELECT patch, count(*) FROM tmp_games GROUP BY patch;
  -- 7. champion, champion_item/rune/spell/skill: 009의 6, 7-1~7-4와 같고 SELECT·INSERT 목록에서 p_patch만 뺌
  -- 8. 반환
  SELECT jsonb_agg(jsonb_build_object('patch', patch, 'games', games) ORDER BY patch_sort_key(patch) DESC)
    INTO v_patches FROM stats_window_patch;
  RETURN jsonb_build_object('window_start', v_start, 'window_end', p_until, 'days', p_days, 'games', v_games,
    'patches', v_patches, 'champion_rows', v_champion, 'item_rows', v_item, 'rune_rows', v_rune,
    'spell_rows', v_spell, 'skill_rows', v_skill);
END $$;

CREATE OR REPLACE FUNCTION purge_old_games(p_keep_days int DEFAULT 21)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path FROM CURRENT AS $$
DECLARE v_deleted int;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 14 THEN
    RAISE EXCEPTION 'purge_old_games: p_keep_days는 14 이상이어야 합니다: %', coalesce(p_keep_days::text, 'NULL') USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM stats_window WHERE days > p_keep_days) THEN
    RAISE EXCEPTION 'purge_old_games: 현재 창(%일)보다 짧게 보관할 수 없습니다', (SELECT days FROM stats_window) USING ERRCODE = '22023';
  END IF;
  DELETE FROM matches WHERE game_start_at < now() - p_keep_days * interval '24 hours';   -- match_players CASCADE
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;
```

- `WHERE true`: Supabase의 `safeupdate`가 켜진 연결에서도 `WHERE` 없는 `DELETE`로 막히지 않게 한다 (동작은 같음).
- `p_days * interval '24 hours'`: 세션 시간대와 무관하게 정확히 14 × 24시간 (KST는 서머타임이 없어 결과는 같지만 명확하게).
- `p_until > now()`이면 오류: 미래 끝으로 집계해 "아직 오지 않은 창"이 저장되는 것을 막는다. 테스트는 과거 `p_until`(2021-01-15)로 실제 데이터와 섞이지 않게 한다.
- `purge_old_games`는 `now()` 기준만 받는다 (시각 인자를 두지 않음). 잘못된 시각으로 대량 삭제할 길을 없앤다. 실행은 지금처럼 백엔드 `purge --yes`로만, 사용자가 직접 한다.
- 성능: 대상 게임 고르기만 바뀌고 집계 본문은 같으므로 25,000게임 기준 `ANALYZE` 뒤 5~7초(변경 02 R4)와 비슷할 것으로 본다. Review가 롤백 안에서 5,000게임 1회만 잰다 (죽은 줄 용량, C7).

#### 014 뷰

```sql
CREATE VIEW champion_tier_view WITH (security_invoker = true) AS
SELECT c.champion_id, c.position, c.pick, c.win, c.ban, w.games,
       round(100.0 * c.win / c.pick, 2)                AS win_rate,
       round(100.0 * c.pick / w.games, 2)              AS pick_rate,
       round(100.0 * c.ban / w.games, 2)               AS ban_rate,
       round(100.0 * (c.win + 50) / (c.pick + 100), 2) AS adjusted_win_rate,
       round(s.score, 3)                               AS tier_score,
       CASE WHEN c.pick < 50 THEN NULL ELSE tier_from_score(s.score) END AS tier
FROM champion c
CROSS JOIN stats_window w
CROSS JOIN LATERAL (
  SELECT 100.0 * (c.win + 50) / (c.pick + 100)
         + 0.10 * least(100.0 * c.pick / w.games, 20)
         + 0.03 * least(100.0 * c.ban / w.games, 30) AS score
) s;
```

- 컬럼 주석은 008과 같은 문구(`games`만 "stats_window.games")로 단다. `stats_window`가 0줄이면 뷰도 0줄이다.
- 컬럼을 빼야 하므로 `CREATE OR REPLACE`로는 안 되고, 012에서 지운 뒤 014에서 새로 만든다.

### 03-5. 용량 다시 계산

> 요약: 테스트(300명)는 **약 13MB**, 본 수집(14일 2만 5천 게임, 원본 21일)은 **약 165~180MB**다. 집계가 1개 창만 남으므로 **시간이 지나도 늘지 않는다** (v6은 1년 뒤 310~460MB).

테스트 수집 (플래티넘·에메랄드·다이아 각 100명):

| 항목 | 계산 | 값 |
|------|------|-----|
| 표본 | 3티어 × 100명 (디비전마다 25명) | 300명 |
| 게임 | 14일 안 게임만 받으므로 플레이어당 평균 약 8~10게임(상한 20) × 300 − 겹침 약 10% | **약 2,200~2,700게임** (상한 약 5,400) |
| Riot 호출 | 리그 12 + 게임 ID 300 + 2 × 2,700 | 약 5,700회, 약 2시간 |
| `match_players` | 27,000줄 × 약 400B | 약 11MB |
| `matches` | 2,700줄 × 약 190B (`game_start_at` 8B 추가) | 약 0.5MB |
| `ranked_players` | 300줄 × 150B | 약 0.05MB |
| 집계 7개 | 창 1개 | 약 1MB 이하 |
| **합계** | | **약 13MB / 500MB** (상한 5,400게임이면 약 25MB) |

- 챔피언 × 포지션 평균 약 30판이라 티어는 대부분 NULL이다 (지금과 같음).

본 수집 (14일 창 최대 25,000게임, 원본 21일 보관):

| 테이블 | 줄 수 | 1줄 크기 | 용량 |
|--------|-------|----------|------|
| `match_players` | 21일 = 약 37,500게임 × 10 = 37.5만 | 약 400B | 약 150MB |
| `matches` | 약 3만 7,500 | 약 190B | 약 7MB |
| `ranked_players` | 약 5천 | 약 150B | 약 1MB |
| 집계 7개 | 창 1개, 약 3만 줄 | 약 120B | 약 4~10MB (db_review M2: 아이템 줄 수에 따라) |
| 집계 다시 만들 때 죽은 줄 | 이전 스냅숏 | - | 일시적으로 +4~10MB (autovacuum이 재사용) |
| **합계** | | | **약 165~180MB / 500MB, 계속 같음** |

- 원본을 14일만 보관하면(D15 (b)) 약 115~130MB. 21일을 추천하는 이유는 D15.
- 수집 속도: 14일에 25,000게임 = 하루 약 1,800게임 = 하루 약 3,600회 호출, 개발 키로 하루 약 1.2시간.
- `purge_old_games`를 오래 안 돌리면 원본이 계속 는다. 21일을 넘긴 만큼 하루 약 1,800게임(약 7MB)씩 커진다.

### 03-6. 테스트 (모두 ROLLBACK)

> 요약: 시각이 들어가므로 테스트 샘플은 모두 **2021년 1월** 시각을 쓰고 `refresh_window_stats(14, '2021-01-15 00:00:00+00')`로 불러 실제 데이터(2026년)와 섞이지 않게 한다. 창 경계, 미래 게임, 패치 구성, 나이로 지우기를 새로 확인한다.

| 파일 | 변경 | 확인 |
|------|------|------|
| `001_storage_format.sql` | 수정 | 모든 `matches` INSERT에 `game_start_at` 추가. 새 거부: `game_start_at` NULL → 23502, `'1970-01-21'`(초를 ms로 착각) → 23514. 집계 테이블 형식 검사를 `patch` → `stats_window`(`id = 2` 거부, `days = 0` 거부, `window_start >= window_end` 거부, `games = 0` 거부), `stats_window_patch`(`'16.19.1'` 거부, `games = 0` 거부)로 |
| `002_helper_functions.sql` | 그대로 | `patch_sort_key`, `tier_from_score` |
| `003_refresh_patch_stats.sql` | **`003_refresh_window_stats.sql`로 바꿔 씀** (옛 파일 삭제) | 샘플 20게임을 모두 `2021-01-10`에 두고 `refresh_window_stats(14, '2021-01-15+00')`. 기존 기대값(챔피언·아이템·룬·스펠·스킬 개수, 밴 중복, 포지션 NULL, 9줄 게임 제외)을 그대로 확인. 다른 패치 게임 `KR_9000000022`는 시작 시각을 `2020-12-01`(창 밖)로 두어 기존 기대값(games 20)을 그대로 쓴다. 패치 구성은 009에서 확인. 두 번 호출 결과 같음(멱등). 인자 오류: `p_days` 0·61·NULL, `p_until` NULL·`now() + 1시간` → 22023. 창 안 게임 0개 → P0002이고 기존 스냅숏이 그대로 |
| `004_champion_tier_view.sql` | 수정 | `patch` 대신 `stats_window`(games 1000) 1줄 + `champion` 6줄을 직접 넣고 같은 손 계산값 확인. `stats_window` 0줄이면 뷰 0줄. 뷰에 `patch` 컬럼이 없음 |
| `005_purge_old_patches.sql` | **삭제 → `010_purge_old_games.sql` 새 파일** | 아래 |
| `006_security.sql` | **수정 (L2 ①, D19)** | 손으로 적은 목록 대신 `current_schema()`의 모든 테이블·뷰·시퀀스(`pg_class` `relkind IN ('r','v','S')`)와 모든 함수(`pg_proc`, 확장 소속 제외)를 돌며: 테이블 RLS 켜짐·FORCE 아님·정책 0개, `anon`·`authenticated`에 테이블·뷰 권한 없음, 시퀀스 USAGE 없음, 함수 EXECUTE 없음, `PUBLIC` EXECUTE 없음. 뷰 `security_invoker=true`. 검사한 객체 개수를 NOTICE로 남김 (지금 기대: 테이블 11 + `schema_migrations`, 뷰 1, 시퀀스 2, 함수 4) |
| `007_skill_order.sql` | 수정 | 샘플 `matches`에 `game_start_at`(2021-01-10), 호출을 `refresh_window_stats(14, '2021-01-15+00')`로. 기대값 그대로 |
| `008_ranked_players_tier.sql` | 수정 | `matches` INSERT에 `game_start_at` 추가만 |
| **`009_window_boundary.sql` (새 파일)** | 새 | 아래 |
| **`010_purge_old_games.sql` (새 파일)** | 새 | 아래 |
| **`011_daily_refresh_job.sql` (새 파일)** | 새 | 03-11 "테스트" (작업 등록 확인, 실행하지 않음) |

`009_window_boundary.sql` — `p_until = '2021-01-15 00:00:00+00'`, `p_days = 14` (창 `[2021-01-01 00:00, 2021-01-15 00:00)`), 게임마다 10줄:

| 게임 | `game_start_at` | 패치 | 기대 |
|------|-----------------|------|------|
| A | `2021-01-01 00:00:00+00` (정확히 14일 전) | 0.5 | **포함** (시작 포함) |
| B | `2020-12-31 23:59:59.999999+00` (14일 + 1µs 전) | 0.5 | 제외 |
| C | `2021-01-14 23:59:59+00` | 0.6 | 포함 |
| D | `2021-01-15 00:00:00+00` (정확히 끝) | 0.6 | 제외 (끝 제외) |
| E | `2021-01-20 00:00:00+00` (끝보다 미래) | 0.6 | 제외 |
| F, G | `2021-01-10` | 0.6 | 포함 |
| H | `2021-01-10`, `match_players` 9줄 | 0.6 | 제외 (미완료) |

- 기대: `stats_window` = `days 14, window_start 2021-01-01 00:00+00, window_end 2021-01-15 00:00+00, games 4` (A, C, F, G). `window_end - window_start = 14 × 24시간`.
- 패치 구성: `stats_window_patch` = `0.5 → 1`, `0.6 → 3`, 합계 4 = `games`. 반환 jsonb `patches`가 `patch_sort_key` 내림차순 `[{0.6, 3}, {0.5, 1}]`. 비율 계산 예시를 NOTICE로 남김: `100 × 3 / 4 = 75.0`, `25.0` (백엔드 공식 기준값).
- 뷰: `champion_tier_view.games = 4`, 픽률 분모가 4.
- `p_days = 1`로 다시 부르면 창 `[2021-01-14, 2021-01-15)` → C만 → games 1, 구성 `0.6 → 1`만 (이전 스냅숏의 `0.5` 줄이 남지 않음).
- NULL 시작 시각: 컬럼이 `NOT NULL`이라 저장 불가 → 001에서 확인 (집계 쪽 별도 처리 없음).
- 집계 시각: `aggregated_at = now()` (트랜잭션 시작 시각).

`010_purge_old_games.sql` — 시각은 `now()` 기준:

| 게임 | `game_start_at` | 기대 (`purge_old_games(21)`) |
|------|-----------------|------------------------------|
| P1 | `now() - 30일` | 삭제 |
| P2 | `now() - 21일 - 1초` | 삭제 |
| P3 | `now() - 21일` (정확히 경계) | **남음** (`<` 비교) |
| P4 | `now() - 15일` | 남음 |
| P5 | `now() - 1일` | 남음 |

- 반환값 = 호출 전에 같은 트랜잭션에서 센 `count(*) FROM matches WHERE game_start_at < now() - 21 × 24시간` (실제 데이터 중 21일보다 오래된 게임도 함께 세므로 고정값으로 비교하지 않음). P1·P2의 `match_players` CASCADE 삭제, P3~P5와 10줄씩 남음.
- 집계는 남는다: 먼저 2021년 샘플로 `refresh_window_stats(14, '2021-01-15+00')`를 만든 뒤 purge → `stats_window`·`champion` 줄 수가 그대로.
- 인자 오류: `purge_old_games(13)`, `purge_old_games(NULL)` → 22023. `stats_window.days = 30`인 스냅숏이 있을 때 `purge_old_games(21)` → 22023 (현재 창보다 짧게 보관 불가).
- 두 번 부르면 두 번째는 0.

- 실행: `npm run verify`(실제 스키마), `npm run verify:fresh`(임시 스키마) 둘 다 통과. 실제 데이터가 있어도 샘플 시각(2021년)·ID(`KR_9…`)가 겹치지 않아 건너뛰는 테스트가 없다. 단, `refresh_window_stats` 테스트는 롤백 안에서 실제 스냅숏을 지웠다가 되돌리므로 본 수집 규모에서는 실행마다 수 MB의 죽은 줄이 생긴다 (autovacuum이 정리).
- **`db/scripts/verify.mjs`의 `TABLES` 목록**(검증 전후 줄 수 비교)에 `patch`가 있고 `stats_window`·`stats_window_patch`가 없다. 없는 테이블은 `-`로 나와 실패하지는 않지만 새 테이블의 샘플 잔존을 검사하지 못한다. `db/scripts/`는 범위 밖이라 **이 한 줄 목록 수정만 승인을 받는다 (D20)**.

### 03-7. 백엔드에 주는 영향 (`!백엔드` 변경용 메모, 이번에 고치지 않음)

> 요약: 백엔드는 수집 기간(`startTime`), 시작 시각 저장, 집계·정리 호출, API의 `patch` 파라미터와 대체 규칙을 바꿔야 한다. 계약 v7 승인 뒤 `!백엔드` Plan → Build → Review로 한다. 이 절은 메모일 뿐 백엔드 파일은 고치지 않는다.

| 영역 | 지금 (back_spec / 코드) | 바꿀 것 |
|------|-------------------------|---------|
| ① 표본 | `test` 프리셋 티어당 50명 (`divisionQuota(50)` = 13/13/12/12) | 티어당 100명 (`divisionQuota(100)` = 25/25/25/25) |
| ② 게임 ID | `…/ids?queue=420&start=0&count=20` | `&startTime={floor((now − 14일)/1000)}` 추가 (**초 단위**). `count`는 플레이어당 상한(20) 그대로. 실행 시작 시각 하나로 고정해 모든 플레이어에 같은 값 |
| ③ 거르기 | "보관 패치 밖"(3-4, `patch_sort_key` 비교, `old_patch`), `maxGamesPerPatch` | 3-4 삭제. 대신 `info.gameStartTimestamp`가 없거나 숫자가 아니면 `bad_format`, `now − 14일`보다 이르면 `out_of_window`로 건너뜀. `maxGamesPerPatch` → `maxGamesPerWindow`(25,000) |
| ⑤ 저장 | `INSERT INTO matches (match_id, puuid, patch)` (`rawRepository.ts`) | `game_start_at` 추가: `new Date(info.gameStartTimestamp)` (ms, UTC). `transform` fixture `KR_8408851980` 기대값에 시작 시각 추가 |
| ⑥ 집계 | `collect run`이 끝나면 `ANALYZE` → 패치마다 `refresh_patch_stats($1)` (`aggregate.ts`), `aggregate --patch` | **`collect run`의 자동 집계(⑥) 삭제** — 집계는 DB 예약 작업이 매일 05:00 KST에 한다 (D23). `aggregate` 명령은 **시험용으로 남김**: `ANALYZE matches, match_players` → `SELECT refresh_window_stats(14)` 1번 (같은 연결, `statement_timeout 5min`). `--patch` 옵션 삭제. P0002면 경고만 남기고 기존 스냅숏 유지. 예약 작업과 겹치면 advisory lock으로 차례로 실행된다 |
| 상태 표시 (선택) | - | `/health` 또는 `/meta`에 `window.aggregatedAt`을 보여 집계가 하루 넘게 멈췄는지 알 수 있게 (예약 작업 실패 확인은 03-11) |
| ⑦ 정리 | `purge` / `purge --yes` → `purge_old_patches(2)`, "지울 패치가 집계됐는지" 확인 | `purge`(읽기만): `game_start_at < now() − 21일`인 게임 수 표시. `purge --yes` → `SELECT purge_old_games(21)`. 집계 확인 단계는 필요 없음(지우는 게임은 이미 창 밖). 자동 실행 금지는 그대로 |
| 읽기 | `statsRepository.ts`: `patch` 테이블, 뷰·상세를 `patch`로 거름 | `stats_window` 1줄 + `stats_window_patch`(`ORDER BY patch_sort_key(patch) DESC`) 읽기. 뷰·상세 조회에서 `patch` 조건 삭제. `stats_window`가 0줄이면 `503 STATS_NOT_READY` |
| API 파라미터 | `patch` 쿼리 (`/champions`, `/champions/:id`), 400/404 `PATCH_NOT_FOUND` | `patch` 파라미터·`PATCH_NOT_FOUND` 삭제. `STATS_NOT_FOUND`의 `details.patch` 삭제 |
| API 응답 | `patch {data, latest, requested, isFallback, games}`, `/meta`의 `patches[]`, `defaultPatch`, `rules.fallbackMinGames` | `window {start, end, days, games, aggregatedAt, patches: [{patch, games, share}]}`로 교체 (`share` = 소수 1자리 %, 백엔드 계산, 합이 100.0이 아닐 수 있음을 계약에 명시). `/meta`도 같은 `window`. 대체 규칙(2-0, `patchSelection.ts`, 결정 D3, `fallbackMinGames`) 삭제 |
| 캐시 | (api_contract 4장) | 캐시 기준을 `window.aggregatedAt`으로 (스냅숏이 바뀌면 값이 바뀜) |
| Data Dragon (프론트 메모) | `{patch.data}.1` 버전 | `window.patches`의 최신 패치 기준으로 |
| 26게임 | DB에 저장됨 | D14 (a)면 011이 지움. 백엔드 Review가 새 수집기로 수십 게임을 다시 모아 계약대로 저장되는지 확인 |
| 순서 | - | 011~014 적용 뒤 백엔드가 바뀌기 전까지 수집·API를 실행하지 않는다 (INSERT 실패, `patch` 테이블 없음) |

### 03-8. 완료 기준 (Review)

> 요약: Review가 실제 DB를 직접 조회해 하나씩 확인할 수 있는 목록이다.

- [ ] 실제 DB 적용 전에 사용자 승인(03-10의 되돌릴 수 없는 작업)이 기록돼 있음 (`db_build.md`)
- [ ] `migrate:status`에서 001~015 적용됨, 체크섬 불일치 없음. 001~010 파일이 바뀌지 않음 (`git diff` 없음)
- [ ] `migrate:fresh-check` 통과 (001~015), `migration_check` 스키마 남지 않음
- [ ] `matches.game_start_at` = `timestamptz NOT NULL`, `matches_game_start_at_check` (`>= 2020-01-01`), 주석에 `info.gameStartTimestamp`
- [ ] 011 뒤 `matches` 0줄·`match_players` 0줄 (D14 (a)), `ranked_players`·`collection_logs` 줄 수는 적용 전과 같음
- [ ] 테이블이 계약 v7과 같음: `patch` 없음, `stats_window`·`stats_window_patch` 있음, 집계 5개에 `patch` 컬럼 없음. 컬럼·타입·NOT NULL·기본값·PK·FK(`(champion_id, position)` CASCADE)·유니크·CHECK가 03-3-1과 같음 (`information_schema`, `pg_constraint`로)
- [ ] 함수: `refresh_patch_stats`·`purge_old_patches` 없음, `refresh_window_stats(integer, timestamp with time zone)`·`purge_old_games(integer)` 있음, 기본값 14·now()·21, `search_path` 고정, `SECURITY INVOKER`. `patch_sort_key`·`tier_from_score` 그대로
- [ ] 직접 시험(롤백): 창 경계 4개(정확히 14일 전 포함, 1µs 더 이전 제외, 끝 제외, 미래 제외), 패치 구성 합계 = games, `p_until` 미래 거부, 0게임 오류에 기존 스냅숏 보존, 동시 호출 잠금(두 연결에서 두 번째가 기다림)
- [ ] 직접 시험(롤백): `purge_old_games` 경계(정확히 21일은 남음), 13 거부, 집계 남음
- [ ] `champion_tier_view`: `patch` 컬럼 없음, `security_invoker=true`, 004 손 계산값과 같음, 분모 = `stats_window.games`
- [ ] 보안: 모든 테이블 RLS 켜짐·정책 0개, `anon`·`authenticated`에 새 테이블·시퀀스·뷰·함수 권한 없음, `PUBLIC` EXECUTE 없음. 006이 스키마 전체를 자동 검사하도록 바뀌었고 개수가 기대와 같음 (L2)
- [ ] `npm run verify`, `verify:fresh` 모두 통과 (001~004, 006~011), 검증 후 모든 테이블 줄 수가 검증 전과 같음 (D20 승인 시 새 테이블 포함)
- [ ] (권장) 롤백 안에서 5,000게임 1회: `ANALYZE` → `refresh_window_stats(14, 과거 시각)` 시간 기록, 변경 02 R4(1.64초)와 비교. 큰 측정은 1~2회만 (C7)
- [ ] 계약 v7: `.md`·`.dbml`이 03-3대로 바뀌고 서로 같음 (1장 수집·보관, 2·3·4장 테이블, 5장 ②⑥⑦, 6-2, 7장, 8장, 9장 전체, 10장, 11장 L2 문장)
- [ ] 예약 작업 (03-11): `pg_cron` 켜짐, `cron.job`에 `tiergg_daily_refresh` 1개, `schedule = '0 20 * * *'`, `command`가 03-11 문구와 같음, `active = true`, `username`·`database`가 백엔드 계정·`postgres`. `anon`·`authenticated`에 `cron` 스키마 USAGE 없음. (권장) 같은 명령을 롤백 트랜잭션 안에서 1회 실행해 결과(성공 jsonb 또는 P0002) 기록. 첫 05:00 실행 뒤 `cron.job_run_details`의 `status`·`return_message` 확인 (Review 시점에 실행이 아직 없으면 ⚠️로 남기고 다음 확인 시점을 적음)
- [ ] `db_build.md`에 변경 03 결과(기능 / 구현 내용 / 상태)와 계약 반영 여부 기록, 검토 뒤 `docs/career_log.md`에 판단 기록 추가 (예: 패치 단위 → 이동 창 전환, 스냅숏 1개 선택과 버린 안, 안전장치 방식)

### 03-9. 작업 범위

> 요약: Build는 새 마이그레이션 011~, 테스트, 구현 기록, 승인된 계약 수정만 고친다. Review는 검토 기록, 구현 기록, 새 번호 마이그레이션, 커리어 기록만 고친다.

| 단계 | 수정 가능 경로 | 비고 |
|------|----------------|------|
| Build | `db/migrations/011_*.sql` 이상 | 새 파일만 (011~015). **001~010 수정 금지** |
| Build | `db/tests/` | 03-6대로 수정·추가·삭제 (`003`·`005` 교체, `009`·`010`·`011` 추가) |
| Build | `db/docs/db_build.md` | 아래에 "변경 03" 절 추가 |
| Build | `docs/contracts/db_contract.md`, `docs/contracts/db_contract.dbml` | 03-3의 승인된 수정만 |
| Build (D20 승인 시) | `db/scripts/verify.mjs` | `TABLES` 배열 한 줄만 (`patch` → `stats_window`, `stats_window_patch`) |
| Review | `db/docs/db_review.md` | 아래에 "변경 03 검토" 절 추가 |
| Review | `db/docs/db_build.md` | 수정한 기능 반영 |
| Review | `db/migrations/` | 새 번호 파일(016~)만 |
| Review | `docs/career_log.md` | 아래에 추가만 |

- 범위 밖: `backend/`, `frontend/`, `docs/contracts/api_contract.md`(백엔드 영역), `db/scripts/`(D20 한 줄 제외), `db/package*.json`, 루트 `.env`(읽기만, 값 출력 금지), `.env.example`, `CLAUDE.md`, 이 문서의 기존 절.
- 011·012 밖의 삭제 SQL이 필요해지면 실행 전에 메인 에이전트를 통해 사용자 승인을 받는다. 실제 DB에서 `purge_old_games` 실행도 같다.

### 03-10. 결정 필요 사항

> 요약: 추천안대로 진행해도 되는지 확인만 받으면 된다.

| # | 결정 | 선택지 | ★추천 |
|---|------|--------|-------|
| D13 | 집계 구조 | (a) 현재 스냅숏 1개 / (b) `as_of` 이력 / (c) 일별 묶음 | **확정 (a)** (사용자 승인 2026-10-14). 상위 N이 정확하고 용량이 고정되며 가장 단순 (03-2) |
| D14 | 26게임과 `game_start_at` | (a) 지우고 `NOT NULL`, 다시 수집 / (b) nullable → 백엔드가 26회 다시 받아 채움 → `NOT NULL` / (c) 계속 nullable | **★(a)**. 흐름 시험용 데이터라 잃는 것이 없고, 순서가 `!db` → `!백엔드` 그대로 |
| D15 | 원본 보관 기간 | (a) 21일 (창 + 7일 여유) / (b) 14일 | **★(a) 21일**. 집계를 하루 이틀 늦게 돌리거나 과거 시각으로 다시 집계·비교할 여유, 나중에 창을 21일로 늘려도 다시 수집할 필요 없음. 본 수집 약 150MB로 v6의 2개 패치(약 200MB)보다 작음 |
| D16 | 패치 구성 저장 | (a) `stats_window_patch` 테이블 / (b) `stats_window.patches jsonb` / (c) 조회 때 `matches`에서 계산 | **★(a)**. 스냅숏과 같은 순간의 값(c는 집계 뒤 수집된 게임이 섞임), 배열·JSON 없는 단순 컬럼 원칙 |
| D17 | 집계 함수 인자 | (a) `refresh_window_stats(p_days DEFAULT 14, p_until DEFAULT now())` / (b) `p_days`만, 항상 `now()` | **★(a)**. 경계 테스트를 실제 데이터와 섞지 않고 정확한 시각으로 할 수 있다. 미래 `p_until`은 거부 |
| D18 | 옛 집계 테이블 | (a) `DROP` 후 새로 `CREATE` / (b) `ALTER`로 `patch` 컬럼·PK·FK 바꾸기 | **★(a)**. 파생값 26게임분이라 다시 셀 수 있고, 새 정의가 한 파일에 그대로 보인다. (b)는 기존 줄이 패치 없이 겹쳐 PK가 깨지므로 어차피 비워야 함 |
| D19 | L2 대응 | (a) 006을 스키마 전체 자동 검사로 + 새 객체마다 `REVOKE` / (b) `ALTER DEFAULT PRIVILEGES` | **★(a)**. (b)는 지속 설정 변경이라 승인 대상이고 이번 범위와 무관. 새 객체가 7개라 자동 검사의 효과가 큼 |
| D20 | `verify.mjs` `TABLES` 한 줄 | 고침 / 그대로 | **★고침**. 새 테이블의 샘플 잔존 검사. `db/scripts/` 범위 밖이라 이 한 줄만 승인 |
| D21 | `matches.game_start_at` 인덱스 | 없음 / 만듦 | **★없음**. 최대 약 3만 7천 줄이라 순차 스캔이 빠르다 (`matches.patch`와 같은 판단). 실제 수집 뒤 느리면 새 마이그레이션 |
| D23 | 매일 자동 집계 (방향은 **확정**: 매일 05:00 KST, pg_cron) — 세부안 | (a) 새 파일 015에서 확장 켜기 + 작업 등록 / (b) 013에 합침 | **★(a) 015 따로**. 확장 켜기는 따로 승인할 지속 설정이고, 실패해도 011~014(구조 변경)는 이미 끝나 있다. 작업은 이름으로 지우고 다시 등록해 몇 번 적용해도 1개. 시간 제한 5분, 실패는 `cron.job_run_details` (03-11) |
| D22 | 테스트 인원 | 티어당 100명(300명) / 50명 유지 | **★100명**. 14일 안 게임만 받아 플레이어당 게임 수가 줄어서. 인원은 백엔드 설정이고 DB는 계약 문구만 바꾼다 |

- 되돌릴 수 없는 작업 (실제 DB 적용 전 사용자 승인 필요):
  1. 011: `DELETE FROM matches` — 테스트 26게임과 `match_players` 260줄 (안전장치: 26줄 초과이거나 16.19·16.20 밖 패치면 멈춤)
  2. 012: `DROP VIEW champion_tier_view` (014에서 새로 만듦)
  3. 012: `DROP FUNCTION refresh_patch_stats(text)`, `DROP FUNCTION purge_old_patches(integer)`
  4. 012: `DROP TABLE champion_skill, champion_spell, champion_rune, champion_item, champion, patch` — 26게임에서 나온 집계(다시 셀 수 있음) (안전장치: `sum(patch.games) > 26`이면 멈춤)
  5. (나중, 운영) 실제 DB에서 `purge_old_games(21)` 실행 — 지금처럼 백엔드 `purge --yes`로 사용자가 직접
  6. 015: `CREATE EXTENSION pg_cron` — DB에 `cron` 스키마와 백그라운드 작업자가 생기는 지속 설정 (승인 필요. 끄려면 `DROP EXTENSION pg_cron`, 작업 기록도 함께 사라짐)
  7. 015: 예약 작업 `tiergg_daily_refresh` 등록 — 매일 05:00 KST에 집계를 지우고 다시 만드는 지속 설정 (승인 필요. 멈추려면 `SELECT cron.unschedule('tiergg_daily_refresh')`)

### 03-11. 매일 자동 집계 (Supabase Cron, D23)

> 요약: 집계는 수집이 끝날 때가 아니라 **매일 05:00 KST(20:00 UTC)** 에 DB 안의 예약 작업이 한다. 마이그레이션 015에서 `pg_cron`을 켜고 작업 `tiergg_daily_refresh`를 등록한다. 작업은 통계 갱신(`ANALYZE`) 뒤 `refresh_window_stats(14)`를 부르고, 창 끝은 실행 시각이다. 실패하면 `cron.job_run_details`에 남고 기존 집계는 그대로다.

#### 015 SQL

```sql
-- 015: 매일 05:00 KST(20:00 UTC) 집계 예약 작업 (db_spec 변경 03, 03-11, D23)
-- Supabase 안내대로 pg_catalog 스키마에 켠다 (작업 테이블·함수는 cron 스키마에 생김)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- 같은 이름의 작업이 있으면 지우고 다시 등록 (몇 번 적용해도 1개)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'tiergg_daily_refresh';

SELECT cron.schedule(
  'tiergg_daily_refresh',
  '0 20 * * *',   -- pg_cron은 UTC(GMT) 기준. 20:00 UTC = 다음 날 05:00 KST
  $cmd$SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);$cmd$
);
```

- **한 명령에 `ANALYZE`와 함수 호출을 같이 넣을 수 있다.** `ANALYZE`는 함수(PL/pgSQL) 안에서는 못 쓰지만, 예약 작업의 명령 문자열은 일반 SQL 여러 문장으로 실행된다. 여러 문장 명령은 묵시적 트랜잭션 1개로 돌고, `ANALYZE`는 `VACUUM`과 달리 트랜잭션 안에서도 된다 (계약 9-4와 같은 순서, 같은 연결).
- `refresh_window_stats(14)`의 `p_until` 기본값 `now()` = 실행 시각이라 창은 `[실행 시각 − 14일, 실행 시각)`이다.
- 함수 이름은 스키마 없이 적는다. 작업은 등록한 계정(백엔드와 같은 테이블 주인 `postgres`)과 `postgres` DB에서 기본 `search_path`(`public`)로 돈다. 마이그레이션 규칙("`public.` 접두사 금지")과도 맞다.
- **시간 제한:** 명령 맨 앞 `SET statement_timeout = '5min'` (계약 9-4의 백엔드 규칙과 같음). 25,000게임 집계는 `ANALYZE` 뒤 수 초라 여유가 크다. Supabase 기본 제한(2분)에 맡기지 않는다.
- **동시 실행:** 백엔드 시험용 `aggregate` 명령과 겹쳐도 함수 안 advisory lock으로 차례로 돈다. 수집(INSERT)과 겹쳐도 MVCC라 막히지 않고, 그 순간까지 커밋된 게임만 센다.
- **`fresh-check`:** 임시 스키마에서 015도 실행되지만 트랜잭션 전체가 롤백되므로 실제 작업은 바뀌지 않는다 (작업 지우기·등록 모두 롤백). 이미 켜진 확장은 `IF NOT EXISTS`로 건너뛴다.
- **확장을 켤 수 없을 때:** 접속 계정 권한 때문에 `CREATE EXTENSION`이 실패하면 015 전체가 롤백되고 실행기가 멈춘다. 이때 Build는 메인 에이전트에게 보고하고, 사용자가 대시보드(Integrations → Cron)에서 켠 뒤 같은 015를 다시 적용한다 (`IF NOT EXISTS`라 그대로 통과).

#### 실패와 0게임

| 상황 | 결과 |
|------|------|
| 창 안 완료 게임 0개 | `refresh_window_stats`가 P0002 오류 → 명령의 트랜잭션 전체 롤백 → **기존 집계(`stats_window` 포함) 그대로**. `cron.job_run_details`에 `status = 'failed'`, `return_message`에 오류 문장 |
| 5분 초과 | `statement_timeout` 오류, 위와 같이 롤백·기록 |
| 프로젝트 일시정지 중 | 작업이 돌지 않는다. 다시 켜면 다음 20:00 UTC부터 돈다 (지난 실행을 몰아서 하지 않음) |

- 실패 확인: `SELECT status, return_message, start_time, end_time FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'tiergg_daily_refresh') ORDER BY start_time DESC LIMIT 7;`
- 화면 쪽에서는 `stats_window.aggregated_at`이 하루를 크게 넘으면 집계가 멈춘 것이다 (백엔드가 `window.aggregatedAt`으로 내보냄, 03-7).
- `cron.job_run_details`는 하루 1줄이라 1년 약 365줄로 용량 영향이 없다. 지우는 작업은 만들지 않는다.

#### 보안 (L2)

- 015는 public에 테이블·뷰·함수·시퀀스를 만들지 않는다. 새 객체는 확장 소속인 `cron` 스키마뿐이다.
- `cron` 객체는 확장(Supabase 관리 계정) 소속이라 마이그레이션에서 권한을 바꾸지 않는다. 대신 테스트·Review가 `anon`·`authenticated`에 `cron` 스키마 USAGE와 `cron.schedule`·`cron.unschedule` EXECUTE가 **없음**을 확인한다. 있으면 고치지 않고 메인 에이전트에게 보고한다 (다른 객체 권한 변경은 승인 대상).
- `cron`은 PostgREST 노출 스키마(기본 `public`, `graphql_public`)가 아니므로 브라우저 키로 작업을 볼 수 없다. Review가 노출 스키마 설정을 대시보드에서 바꾸지 않았는지만 확인한다.
- 006 보안 테스트의 "확장 소속 함수 제외" 규칙 때문에 `pg_catalog`에 생기는 `pg_cron` 함수는 006에서 빠진다. `cron` 확인은 011 테스트가 한다.

#### 계약 v7 문구 (03-3-2 표에 더함)

9-4 표 위에 넣는 "9-4 예약 작업 문구":

```markdown
- **집계는 DB 예약 작업이 한다.** Supabase Cron(`pg_cron`) 작업 `tiergg_daily_refresh`가 **매일 05:00 KST(20:00 UTC)** 에 아래 명령을 실행한다 (마이그레이션 `015_schedule_daily_refresh.sql`).
  `SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);`
- 창은 `[실행 시각 − 14일, 실행 시각)`. 백엔드 수집은 끝난 뒤 집계를 부르지 않는다. 백엔드 `aggregate` 명령은 시험용으로 같은 순서를 쓴다.
- 실패(창 안 게임 0개, 시간 초과)하면 기존 집계를 그대로 두고 `cron.job_run_details`에 `failed`로 남는다. 집계가 멈췄는지는 `stats_window.aggregated_at`으로 안다.
- 작업 시각·명령을 바꿀 때는 `!db`가 새 마이그레이션으로 같은 이름을 지우고 다시 등록한다.
```

- 10장 14번 줄(03-3-2)과 5장 ⑥ 줄(03-3-2)은 이미 위 내용으로 바꿔 두었다.
- dbml: 집계 호출 규칙 메모에 `// 집계: pg_cron 작업 tiergg_daily_refresh, 매일 20:00 UTC(05:00 KST): ANALYZE matches, match_players; SELECT refresh_window_stats(14)` 한 줄 추가.

#### 테스트 `011_daily_refresh_job.sql` (ROLLBACK, 실행하지 않음)

| 확인 | 기대값 |
|------|--------|
| 확장 | `pg_extension`에 `pg_cron` 있음 (없으면 실패. fresh 모드에서도 015가 켬) |
| 작업 1개 | `cron.job`에 `jobname = 'tiergg_daily_refresh'` 정확히 1줄 |
| 일정 | `schedule = '0 20 * * *'`, `active = true` |
| 명령 | `command`가 015 문구와 같음 (`statement_timeout = '5min'`, `ANALYZE matches, match_players`, `refresh_window_stats(14)` 순서) |
| 실행 계정 | `username = current_user`, `database = current_database()` |
| 권한 | `has_schema_privilege('anon'/'authenticated', 'cron', 'USAGE')` = false, `cron.schedule(text,text,text)` EXECUTE 없음 |

- 명령을 실제로 실행하지는 않는다 (실제 스냅숏을 지웠다가 되돌려 죽은 줄이 생기므로). **Review가 1회만** 롤백 트랜잭션 안에서 같은 세 문장을 실행해 결과(성공 jsonb 또는 P0002)를 기록한다 (완료 기준 03-8).

#### 무료 플랜 주의

- Supabase 무료 플랜은 **7일 동안 활동이 없으면 프로젝트를 일시정지**한다. 일시정지 중에는 예약 작업도 돌지 않는다.
- **DB 안의 예약 작업 실행이 "활동"으로 쳐져 일시정지를 막는지는 확실하지 않다.** 막아 준다고 가정하지 않는다. 개발 중에는 사용자가 수집·대시보드 접속을 주 1회 이상 하고, 일시정지되면 대시보드에서 다시 켠다 (계약 1-4 그대로).
- `pg_cron`은 무료 플랜에서 쓸 수 있는 확장이다. 하루 1회 수 초 실행이라 CPU·용량 영향은 작다.
