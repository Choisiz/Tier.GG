# DB 구현 기록 (`!db` Build)

- 작성: Build 서브에이전트 (2026-10-13)
- 기준: `db/docs/db_spec.md` (승인됨, D1 = (a), D2~D4·C1 추천안), `docs/contracts/db_contract.dbml` v4
- 대상 DB: Supabase PostgreSQL 17.11, Session pooler, 역할 `postgres`
- 적용 전 상태: public 테이블 0, 뷰 0, 함수 0 (빈 DB 확인 후 적용)

---

## 1. 기능별 결과

> 요약: 계획의 8개 마이그레이션을 모두 실제 DB에 적용했고, 롤백되는 샘플 검증 6개 파일이 모두 통과했다. 샘플 데이터는 남지 않았다.

### 1-1. 마이그레이션 실행기

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 의존성 | `db/package.json`에 `pg` 1개만 (`^8.23.1`, `package-lock.json`으로 고정, `npm audit` 취약점 0). `dotenv` 없이 `node --env-file=../.env` | ✅ |
| `up` | 파일 이름 규칙 `^\d{3}_[a-z0-9_]+\.sql$`, 이름순, 기록에 없는 파일만. 파일 1개 = 트랜잭션 1개, 실패하면 ROLLBACK 후 멈춤. advisory lock으로 동시 실행 방지 | ✅ |
| `status` | 파일별 적용 시각, 체크섬 불일치, 기록에만 있는 파일 출력 | ✅ |
| 체크섬 검사 | sha256. 적용된 파일이 바뀌면 아무것도 적용하지 않고 오류(exit 1) | ✅ |
| `fresh-check` | 트랜잭션 1개 안에서 `CREATE SCHEMA migration_check` → `SET LOCAL search_path = migration_check, pg_catalog` → 전체 파일 → 항상 ROLLBACK. 끝난 뒤 스키마가 남지 않았는지 확인 | ✅ |
| `schema_migrations` | `filename` PK, `checksum`, `applied_at`. RLS 켜기, `anon`·`authenticated` 권한 회수 | ✅ |
| 비밀값 | `DATABASE_URL`은 `process.env`로만 읽음. 오류 메시지에서 접속 문자열·비밀번호·사용자·호스트를 `***`로 가림 (`scripts/lib.mjs`) | ✅ |

### 1-2. 테이블과 제약 조건

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 원본 테이블 3개 + 운영 1개 | `ranked_players`, `matches`, `match_players`, `collection_logs` (001). 컬럼 이름·순서·타입·NULL 여부가 dbml v4와 같음 | ✅ |
| 집계 테이블 6개 | `patch`, `champion`, `champion_item`, `champion_rune`, `champion_spell`, `champion_skill` (002) | ✅ |
| PK / 유니크 | PK 11개(`schema_migrations` 포함), 유니크 `champion_rune_page_key` 1개 | ✅ |
| FK와 삭제 동작 | 7개. `matches.puuid` SET NULL, `match_players` CASCADE, `champion.patch` CASCADE, 상세 4개 `(patch, champion_id, position)` CASCADE | ✅ |
| CHECK (C1) | 38개. 포지션, 티어·랭크, 패치 형식, `KR_` 게임 ID, `skill_order ~ '^[QWER]*$'`, 아이템 ≥ 0, 밴 > 0, `pick > 0`, `0 ≤ win ≤ pick`, `spell1_id < spell2_id`, `skill_priority` 6개 값, `collection_logs` 상태·시각·개수 | ✅ |
| 컬럼 주석 | 원본 3개 테이블 컬럼 32개 모두 Riot JSON 경로 `COMMENT` | ✅ |

### 1-3. 인덱스

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 일반 인덱스 | `match_players_champion_id_team_position_idx (champion_id, team_position)` 1개 (003). 나머지는 PK·유니크만 | ✅ |

### 1-4. 보안

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| RLS | 11개 테이블 `ENABLE ROW LEVEL SECURITY`, FORCE 아님, 정책 0개 (004) | ✅ |
| 테이블·뷰 권한 | `REVOKE ALL … FROM anon, authenticated` (테이블 10개 + `schema_migrations` + 뷰) | ✅ |
| 시퀀스 권한 | `collection_logs_id_seq`, `champion_rune_id_seq` `REVOKE ALL … FROM anon, authenticated` | ✅ |
| 함수 권한 | 함수 5개 `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` | ✅ |
| 뷰 | `WITH (security_invoker = true)` | ✅ |
| 주인 | 모든 테이블·뷰·시퀀스·인덱스 주인 `postgres` (실행 역할) | ✅ |

### 1-5. 함수와 뷰

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `patch_sort_key(text) → int[]` | SQL, IMMUTABLE (005) | ✅ |
| `skill_priority(text) → text` | SQL, IMMUTABLE. Q/W/E 5번째 위치, 2개 미만이면 NULL (D3) (005) | ✅ |
| `tier_from_score(numeric) → smallint` | SQL, IMMUTABLE. 53.0 / 51.5 / 50.0 / 48.5, NULL → NULL (005) | ✅ |
| `refresh_patch_stats(text) → jsonb` | PL/pgSQL. 형식 검사 → advisory lock → `tmp_games`(10줄 게임) → 0개면 오류 → `tmp_base` → `patch` 삭제(CASCADE) → 6개 INSERT → jsonb 반환. 아이템 전부(D2), 한 줄 중복 1번(D4), 룬·스펠 상위 10개 (006) | ✅ |
| `purge_old_patches(int DEFAULT 2) → int` | PL/pgSQL. `p_keep < 1` 오류, `patch_sort_key` 내림차순 상위 `p_keep`개 보관, 나머지 `matches` 삭제(`match_players` CASCADE), 삭제 게임 수 반환 (007) | ✅ |
| `champion_tier_view` | `champion` JOIN `patch`. 승률·픽률·밴률·보정 승률·점수(반올림 전 값으로 계산)·티어(`pick < 50` NULL) (008, D1 = (a)) | ✅ |
| `search_path` | 모든 함수 `SET search_path FROM CURRENT` → 실제 DB에서 `public, pg_catalog`로 고정됨 | ✅ |

### 1-6. 계약 문서 반영 (C2)

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `db_contract.md` 9-3 | "계산 위치 결정 대기" 문장을 `champion_tier_view` 컬럼 표(이름·타입·정의)와 사용 예로 바꿈 | ✅ |
| `db_contract.dbml` | 뷰를 설명하는 주석 블록 추가 (DBML은 뷰를 표현하지 못함). 테이블·컬럼·관계는 바꾸지 않음 | ✅ |
| C1 (CHECK) | 계약 7장 저장 규칙에 이미 같은 허용 값이 있어 문서 변경 없음 | ✅ |

---

## 2. 파일 목록

> 요약: 실행기 3개, 마이그레이션 8개, 검증 SQL 6개를 만들었다.

| 경로 | 내용 |
|------|------|
| `db/package.json`, `db/package-lock.json` | `pg` 의존성, npm 스크립트 |
| `db/scripts/lib.mjs` | 접속, 비밀값 가리기 (공통) |
| `db/scripts/migrate.mjs` | `up`, `status`, `fresh-check` |
| `db/scripts/verify.mjs` | `db/tests/*.sql`을 파일마다 BEGIN … ROLLBACK, 전후 줄 수 비교. `--fresh`면 임시 스키마에 마이그레이션부터 적용 |
| `db/migrations/001_create_raw_tables.sql` | 원본 3 + `collection_logs`, CHECK, 주석 |
| `db/migrations/002_create_aggregate_tables.sql` | 집계 6, CHECK, `champion_rune_page_key` |
| `db/migrations/003_create_indexes.sql` | 인덱스 1개 |
| `db/migrations/004_enable_rls.sql` | RLS, 테이블·시퀀스 권한 회수 |
| `db/migrations/005_create_helper_functions.sql` | `patch_sort_key`, `skill_priority`, `tier_from_score` |
| `db/migrations/006_create_refresh_patch_stats.sql` | `refresh_patch_stats` |
| `db/migrations/007_create_purge_old_patches.sql` | `purge_old_patches` |
| `db/migrations/008_create_champion_tier_view.sql` | `champion_tier_view` |
| `db/tests/001_storage_format.sql` | 실제 예시 1행, 거부 7건, 허용 값, FK 삭제 동작 |
| `db/tests/002_helper_functions.sql` | 보조 함수 3개 |
| `db/tests/003_refresh_patch_stats.sql` | 샘플 패치 `0.1` (22게임) 집계 |
| `db/tests/004_champion_tier_view.sql` | 샘플 패치 `0.3` 비율·티어 |
| `db/tests/005_purge_old_patches.sql` | 패치 `0.9`, `0.10`, `0.2` 삭제 |
| `db/tests/006_security.sql` | RLS, 정책, 권한, 뷰 옵션, 주인 |

- `db/node_modules`는 루트 `.gitignore`의 `node_modules/`, `**/node_modules/`로 제외됨 (`git check-ignore` 확인).

---

## 3. 실행 명령

> 요약: 모두 `db/` 폴더에서 실행한다.

| 명령 | 동작 |
|------|------|
| `npm install` | `pg` 설치 |
| `npm run migrate` | 적용하지 않은 파일만 적용 |
| `npm run migrate:status` | 적용 여부·체크섬 확인 |
| `npm run migrate:fresh-check` | 임시 스키마에 처음부터 적용해 보고 롤백 |
| `npm run verify` | 실제 스키마에서 샘플 검증 (항상 롤백) |
| `npm run verify:fresh` | 임시 스키마에 마이그레이션 + 샘플 검증 (항상 롤백). 실제 적용 전 확인용 |

---

## 4. 검증 결과

> 요약: 실제 적용 전에 임시 스키마에서 먼저 검증하고, 적용 뒤 실제 스키마에서 다시 검증했다. 모두 통과했고 샘플은 0줄 남았다.

### 4-1. 진행 순서

| 순서 | 명령 | 결과 |
|------|------|------|
| 1 | `migrate:fresh-check` (적용 전) | 8개 파일 통과, 임시 스키마에 테이블 10 · 뷰 1 · 함수 5, ROLLBACK 후 스키마 남지 않음 |
| 2 | `verify:fresh` (적용 전) | 처음 실행에서 테스트 SQL 쪽 실수 3건(별칭 충돌, 내 손 계산 오류 1건, 배열 연결 타입) 발견 → 테스트만 고침. 006 함수의 `pg_temp` 안내 메시지를 없애도록 수정 (실제 적용 전이라 파일 수정 가능). 다시 실행해 6개 모두 통과 |
| 3 | 빈 DB 확인 | public 테이블 0, 뷰 0, 함수 0 |
| 4 | `migrate:fresh-check` → `migrate` | 001~008 적용 (8개) |
| 5 | `migrate:status` / `migrate` 재실행 | 8개 모두 적용됨 / "적용할 파일 없음" |
| 6 | `verify` (실제 스키마) | 6개 파일 모두 통과, 테이블 10개 전후 줄 수 모두 0 → 0 |
| 7 | `migrate:fresh-check` (적용 후) | 통과, 실제 스키마 변화 없음 |
| 8 | 체크섬 검사 | 마이그레이션을 scratchpad에 복사해 `003`에 공백 1글자 추가, `MIGRATIONS_DIR`로 실행 → "체크섬 불일치: 003_create_indexes.sql", 아무것도 적용하지 않고 exit 1. 실제 파일은 건드리지 않음 |

### 4-2. 구조 (실제 DB 조회)

| 항목 | 결과 |
|------|------|
| 테이블 | 11개 (계약 10 + `schema_migrations`). 컬럼 이름·순서·타입·NOT NULL이 dbml v4와 일치 |
| 제약 조건 | PK 11, FK 7, 유니크 1, CHECK 38 |
| 인덱스 | PK 11 + 유니크 1 + `match_players_champion_id_team_position_idx` 1 |
| 함수 | 5개, 인자·반환 타입이 spec 7-1과 일치, 모두 `search_path=public, pg_catalog` |
| v3 전용 객체 | 0개 (`collect_status`, `queue_id`, `match_bans`, `patch_stats`, `champion_tiers` 등) |
| 원본 컬럼 주석 | 32개 |

### 4-3. 샘플 검증 (`npm run verify`, 모두 롤백)

| 파일 | 확인한 내용과 수치 | 결과 |
|------|--------------------|------|
| 001 저장 형식 | 실제 예시 1행(`KR_8408851980`, 23 TOP …) 저장. 거부 7/7 (`''`, 밴 `-1`, `item0 = -1`, `'QX'`, `16.19.823`, `NA1_1`, 스펠 14/4). 허용: 포지션 NULL, 밴 NULL, `item0 = 0`, 빈 `skill_order`. SET NULL·CASCADE 동작 | ✅ |
| 002 보조 함수 | `{16,9} < {16,19}`. `skill_priority` 8건 (`EQQWQRQEQEREEW` → `Q>E>W`, 5레벨 1개 → NULL, `''`·NULL → NULL). `tier_from_score` 경계 11건 (53.0 → 1, 52.999 → 2, 48.5 → 4, 48.499 → 5, NULL → NULL) | ✅ |
| 003 집계 | 반환 `{games 20, champion_rows 11, item_rows 5, rune_rows 20, spell_rows 11, skill_rows 2}`. 9줄 게임·다른 패치 제외. 23 TOP pick 20 / win 12 / ban 3 (포지션 NULL 줄의 밴 포함). 64 JUNGLE 14/12/20, 64 MIDDLE 6/0/20 (양 팀 같은 밴 1번, 모든 포지션 같은 값). 99 MIDDLE 17/9 (NULL 3줄 제외). 아이템 5줄, `1036` pick 10 (중복 1번), 0 제외. 스펠 (4, 14) 1줄 20/12. 룬 12개 → 10개 (동률 정렬 고정, 9019·9020 제외). 스킬 `Q>E>W 15/12`, `W>E>Q 2/0` | ✅ |
| 003 재집계·오류 | 2번 집계해도 반환값·집계 49줄 동일. 원본 없는 패치 `0.7` → 오류. 원본을 지운 `0.1` 재집계 → 오류, 기존 집계(games 20, champion 11줄) 유지. `16.19.1` → 거부 | ✅ |
| 004 티어 뷰 | games 1000. pick 49 → tier NULL (점수 54.181), pick 50 → 53.833 → 1. 픽률 30·밴률 40 상한 → 52.900 → 2. 51.000 → 3, 49.500 → 4, 46.030 → 5. 승률·픽률·밴률·보정 승률 모두 손 계산과 일치 | ✅ |
| 005 삭제 | 0.9 (2게임), 0.10 (3게임), 0.2 (4게임) → `purge_old_patches(2) = 4`, 0.10·0.9 보관, `match_players` 90 → 50줄, 0.2 집계 유지 (games 4, champion 10줄). 다시 호출하면 0. `p_keep = 0` 거부 | ✅ |
| 006 보안 | 11개 테이블 RLS 켜짐·FORCE 아님·정책 0·주인 `postgres`. `anon`·`authenticated` 테이블·뷰 SELECT/INSERT/UPDATE/DELETE 없음, 함수 EXECUTE 없음, 시퀀스 USAGE 없음. PUBLIC 함수 EXECUTE 없음. 뷰 `{security_invoker=true}` | ✅ |
| 샘플 잔존 | 테이블 10개 모두 검증 전 0 → 후 0, `migration_check` 스키마 없음 | ✅ |

---

## 5. 계획과 다른 점

> 요약: 동작 규칙은 계획 그대로이고, 아래는 구현하면서 정한 세부 사항이다.

| # | 내용 | 이유 |
|---|------|------|
| 1 | `scripts/lib.mjs` 추가 | 접속과 비밀값 가리기를 `migrate.mjs`, `verify.mjs`가 함께 씀 |
| 2 | npm 스크립트 `verify:fresh`, `verify.mjs --fresh`, 실행기 `MIGRATIONS_DIR` 환경 변수 추가 | 실제 적용 전에 함수 결과를 임시 스키마에서 확인하고, 체크섬 검사를 실제 파일을 고치지 않고 시험하기 위해 |
| 3 | `up`이 파일마다 `SET LOCAL search_path = public, pg_catalog` 실행 | `SET search_path FROM CURRENT`가 Supabase 기본값(`"$user", public, extensions`) 대신 고정된 값을 잡게 |
| 4 | `refresh_patch_stats`: 패치 형식 검사를 advisory lock보다 먼저 | NULL 패치면 잠금 키가 NULL이 되어 잠금이 걸리지 않으므로 |
| 5 | `refresh_patch_stats`: 시작할 때 이미 있는 `tmp_games`·`tmp_base` 임시 테이블을 지움 | `ON COMMIT DROP`이라 같은 트랜잭션에서 두 번 부르면 "이미 있음" 오류가 나기 때문. 임시 테이블만 지우고 실제 데이터와 무관 |
| 6 | `champion_spell` 집계에서 `summoner1_id = summoner2_id`인 줄 제외 | 게임에서 나올 수 없는 값이지만, 들어오면 `spell1_id < spell2_id` CHECK 때문에 집계 전체가 실패하므로 |
| 7 | `fresh-check`가 파일마다 SAVEPOINT | 어느 파일에서 실패했는지 정확히 보여주기 위해. 마지막에 전체 ROLLBACK은 같음 |
| 8 | 테스트 001(실제 예시 게임 ID가 이미 있을 때), 005(`matches`에 실제 데이터가 있을 때)는 건너뜀 | 실제 수집 후에는 기대값 비교가 무의미하거나 키가 겹침. 건너뛰면 `[건너뜀]` 안내를 출력 |
| 9 | "반올림 전 점수로 티어" 검사는 뷰가 아니라 `tier_from_score(52.9996) = 2`와 `round = 53.000`으로 확인 | 정수 pick/win으로 경계 바로 아래 점수를 만들기 어려움. 뷰는 코드상 반올림 전 `s.score`를 `tier_from_score`에 넘김 |

---

## 6. 남은 문제

> 요약: 막힌 것은 없다. 아래는 다음 단계에서 알아둘 점이다.

| # | 내용 |
|---|------|
| 1 | Supabase는 public 새 객체에 `anon`·`authenticated` 기본 권한을 계속 준다. 앞으로 추가하는 마이그레이션도 객체마다 `REVOKE`를 넣어야 한다 |
| 2 | 실제 수집 뒤에는 테스트 001·005가 건너뛰어진다. 그때는 `npm run verify:fresh`(빈 임시 스키마)로 같은 검사를 할 수 있다 |
| 3 | `match_players_champion_id_team_position_idx`는 집계 함수가 거의 쓰지 않는다 (spec 5장 참고). 실제 수집 뒤 사용 여부를 보고 판단 |
| 4 | `champion_rune.id`는 재집계마다 새 번호를 받는다 (지우고 다시 넣음). bigint라 문제는 없지만 백엔드가 `id`를 고정 키로 쓰면 안 된다 |
| 5 | 티어 기준값은 샘플로만 확인했다. 첫 실제 수집 뒤 분포를 보고 새 마이그레이션으로 조정 (spec 7-6) |
| 6 | 알려진 한계 그대로: 밴만 되고 픽이 없는 챔피언은 `champion` 줄이 없음, 우디르·니달리 등은 스킬 순서 의미가 다름 |

---

## 변경 01 (2026-10-13): 스킬 집계를 앞 11레벨 순서로

- 작성: Build 서브에이전트 (2026-10-13)
- 기준: `db/docs/db_spec.md` 변경 01 (승인됨, D5~D9·C4 추천안). D6 = (a) `DROP FUNCTION skill_priority(text)` 사용자 승인
- 대상 DB: 위와 같은 Supabase (Session pooler)

### 01-1. 기능별 결과

> 요약: 마이그레이션 009를 실제 DB에 적용했다. 테스트 7개 파일이 실제 스키마와 임시 스키마에서 모두 통과했고, 5,000게임 2.4~3.0초, 2만 5천 게임 7.0~11.9초로 목표 안이다. 다만 2만 5천 게임 측정 중 2번은 5분을 넘겨 시간 초과가 났다 (01-6 남은 문제 1).

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 009 안전장치 | `champion_skill`에 줄이 있으면 `RAISE EXCEPTION`으로 멈춤 (데이터를 지우지 않음). 적용 때 0줄이라 통과 | ✅ |
| 컬럼·CHECK 변경 (D5, D8) | `DROP CONSTRAINT champion_skill_skill_priority_check` → `RENAME COLUMN skill_priority TO skill_order` → `champion_skill_skill_order_check CHECK (skill_order ~ '^[QWER]{11}$')`. 테이블은 그대로라 PK 인덱스·FK·RLS·`REVOKE`가 유지됨 | ✅ |
| PK | `champion_skill_pkey` 이름 그대로, 컬럼 `(patch, champion_id, position, skill_order)` (실제 DB 확인) | ✅ |
| 주석 | 테이블·`skill_order`·`pick`·`win` 주석 다시 적음 ("앞 11레벨", 예: `EQQWQRQEQEREEW → EQQWQRQEQER`) | ✅ |
| `refresh_patch_stats` (D7) | 006 본문을 그대로 복사하고 7-4만 교체: `team_position IS NOT NULL AND length(skill_order) >= 11`, `left(skill_order, 11)`로 묶고, `row_number() OVER (PARTITION BY champion_id, team_position ORDER BY pick DESC, win DESC, skill_order)` 상위 10개. 006과의 차이는 7-4 블록뿐 (`diff`로 확인). 실제 DB `md5(prosrc)` = 파일 본문 md5 (`c4740067…`) | ✅ |
| 권한 | `COMMENT ON FUNCTION`(006과 같음), `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` 다시 적음. 실제 DB `proacl`에 PUBLIC 없음 | ✅ |
| 함수 삭제 (D6) | `DROP FUNCTION skill_priority(text)`. 실제 DB `to_regprocedure('skill_priority(text)') IS NULL`. 다른 함수·뷰가 쓰지 않음 (fresh-check 임시 스키마 함수 4개) | ✅ |
| 지우는 SQL 확인 | 009에 `DELETE`, `TRUNCATE`, `DROP TABLE` 문장 없음. 함수 본문 안의 `DELETE FROM patch`, `DROP TABLE pg_temp.tmp_*`는 006과 같은 집계 동작이고 마이그레이션 적용 때 실행되지 않음 (파일 머리 주석에 적음) | ✅ |
| L1 (D9) | `scripts/lib.mjs`의 `secretsToHide()`만 수정. 비밀번호·사용자 이름의 `decodeURIComponent`를 각각 따로 `try`로 감쌈 (사용자 이름의 디코딩 형태도 가림 목록에 추가) | ✅ |
| 테스트 002 | `skill_priority` 8건 블록 삭제. 머리 주석에 이유 적음 | ✅ |
| 테스트 003 | s1 스킬 샘플: g1~15 `EQQWQRQEQEREEW`, g16~17 `QWEQWE`, g18 `WEWEWEWEWE`(10자), g19 `WEWEWEWEWER`(11자), g20 `WEWEWEWEWERQQ`(13자). 기대값 `EQQWQRQEQER 15/12, WEWEWEWEWER 2/0`, `skill_rows = 2`. 다른 집계 5개 기대값은 바꾸지 않았고 그대로 통과 | ✅ |
| 테스트 006 | `v_funcs`에서 `skill_priority(text)` 제거, 함수 4개 권한 검사 | ✅ |
| 테스트 007 (새 파일) | 패치 `0.3`, 12게임. 상위 10개·동률(아래 표), 같은 앞 11글자 묶기(14·13·11자 → pick 3 win 1), 10자·`''`·NULL·포지션 NULL 제외, CHECK 거부 4건(23514) + 11자 허용 1건, 컬럼 6개 순서·타입·NOT NULL, PK 4개 컬럼, 예전 CHECK 없음, 함수 삭제 | ✅ |
| 계약 `.md` (C3, C4) | 01-2 표대로 반영 (01-3) | ✅ |
| 계약 `.dbml` | 머리 주석 2번째 줄, `champion_skill` 블록 교체. `@dbml/core` 10.2.0(`dbmlv2` 파서, scratch 폴더에 설치)으로 파싱 성공: 테이블 10, Ref 7, `champion_skill` 컬럼·PK 확인 | ✅ |
| 성능 (01-5) | 5,000게임 6초 이하, 2만 5천 게임 40초 이하 목표는 측정 대부분 충족. 2만 5천 게임 2회와 1만 게임 1회는 같은 데이터로 시간 초과 (01-6 남은 문제 1) | ⚠️ |

#### 007 상위 10개 손 계산 (실행 전에 적은 값)

| 순위 | 문자열 (`QQQQQEEEE` + 2글자) | pick/win | 이유 |
|------|------------------------------|----------|------|
| 1~6 | EQ, EW, QE, QW, RR, RW | 1/1 | 승리(짝수 게임) → 문자열 오름차순 |
| 7~10 | EE, ER, QQ, QR | 1/0 | 패배 중 문자열 오름차순 앞 4개 |
| 제외 | RE, RQ | 1/0 | 11·12위 |

- 패배 게임(홀수)은 문자열 뒤에 `WQ`를 붙여 13자로 넣었고, 저장값은 앞 11자다.

### 01-2. 검증 결과

| 검증 | 결과 | 비고 |
|------|------|------|
| `npm run migrate:fresh-check` | ✅ | 001~009 통과, 임시 스키마 테이블 10 · 뷰 1 · 함수 4, `migration_check` 남지 않음 |
| `npm run verify:fresh` (적용 전·후 2번) | ✅ | 7개 파일 모두 통과, 샘플 데이터 남지 않음 |
| `npm run migrate` | ✅ | `009_skill_order_prefix.sql` 1개 적용 |
| `npm run migrate:status` | ✅ | 001~009 적용됨, 체크섬 불일치 없음 (001~008 파일이 바뀌지 않았다는 확인. `db/`는 아직 git에 없어 `git diff`로는 확인 불가) |
| `npm run verify` | ✅ | 7개 파일 모두 통과. 테이블 10개 줄 수 검증 전후 모두 0 → 0 |
| 실제 DB 구조 | ✅ | 제약: FK CASCADE, `pick_check`, `pkey (patch, champion_id, "position", skill_order)`, `skill_order_check ^[QWER]{11}$`, `win_check`. 예전 CHECK 없음 |
| L1 가짜 URL | ✅ | `postgresql://tester:Fa%zzPw999@nonexistent-host.invalid:5432/db` → `ENOTFOUND nonexistent-host.invalid tester Fa%zzPw999`가 `ENOTFOUND *** *** ***`. 정상 인코딩 `us%40er` / `p%40ssword9` → 원문·디코딩 형태 5개 모두 `***`. 실제 `DATABASE_URL`은 쓰지 않음 |
| 측정 뒤 테이블 줄 수 | ✅ | `matches`, `match_players`, `patch`, `champion_skill` 모두 0 (성능 측정은 모두 ROLLBACK) |

### 01-3. 성능 (롤백 트랜잭션, 생성 샘플)

> 요약: 정상일 때 5,000게임 약 2.4~3.0초(목표 6초), 2만 5천 게임 약 7~12초(목표 40초)다. `skill_priority`가 빠져 Review 측정(8.6초)보다 약 3배 빨라졌다.

- 샘플: 게임당 10줄, 챔피언 160종 × 포지션 5 = 800조합, 아이템은 한 줄에 5칸 + `3340`(3게임 중 2게임), 아이템 종류 70개 (5,000게임에서 `champion_item` 54,351줄로 Review 샘플 51,650줄과 비슷), 스킬 문자열 14~18자 (80%는 실제형 순서 6개, 20%는 무작위). 측정 스크립트는 scratch 폴더에 두고 저장소에 넣지 않았다. `SET LOCAL statement_timeout`으로 측정 상한을 정함.

| 규모 | 측정 | 목표 | 결과 |
|------|------|------|------|
| 5,000게임 (5만 줄) | 2.96초 / 2.42초 / 2.44초 (3회) | 6초 이하 | ✅ `skill_rows` 6,986 (조합당 최대 10줄 확인) |
| 8,000게임 | 4.84초 (1회) | - | 참고 |
| 1만 게임 | 3.87초 (1회) / 시간 초과 1회 (5분 초과) | - | 참고 |
| 2만 5천 게임 (25만 줄) | 7.75초 / 7.29초 / 7.00초 / 11.86초 (4회) | 40초 이하 | ✅ |
| 2만 5천 게임 | 시간 초과 2회 (5분 초과, 같은 샘플) | 40초 이하 | ❌ (01-6 남은 문제 1) |

- 시간 초과가 난 1만 게임 데이터로 함수 본문 문장을 하나씩 따로 실행하면 모두 합해 약 5초였다 (대상 게임 0.4초, 원본 복사 0.2초, champion 0.3초, 아이템 2.7초, 룬 0.6초, 스펠 0.2초, 스킬 0.5초). 즉 계산량 문제가 아니라 실행 계획 문제로 보인다.
- 실행 계획: 이번에 넣은 원본 줄은 아직 통계가 없어서 플래너가 `matches`·`match_players`를 1줄 정도로 추정했다 (`EXPLAIN` 결과 `rows=1`, Nested Loop). 앞선 롤백으로 남은 빈 페이지 상태(`relpages`, `reltuples`)에 따라 계획이 바뀌어, 어떤 때는 수 초, 어떤 때는 수 분이 걸린 것으로 판단한다. 시간 초과 중 정확히 어느 문장이 느렸는지는 `auto_explain`을 쓸 수 없어(Supabase에서 `LOAD` 권한 없음) 확인하지 못했다.
- 이 동작은 006부터 있던 것이고 009가 바꾼 스킬 부분(0.5초)과는 관계없다.

### 01-4. 계약 반영

| 위치 | 반영 |
|------|------|
| `db_contract.md` 머리말 | `v5 승인됨 (2026-10-13, 변경 01)`, 기준 dbml `v5`. "v4 → v5 변경" 표 추가 (컬럼 이름, 11자 미만 제외, 상위 10개, `skill_priority` 삭제) |
| 2장 테이블 목록 | `champion_skill`: "스킬 찍은 순서 앞 11레벨 1개 / `EQQWQRQEQER` 형식. **상세 화면**" |
| 4장 ERD | `champion_skill · 스킬 앞 11레벨 순서`, `text skill_order PK "EQQWQRQEQER"` |
| 9-1 함수 목록 | `skill_priority` 줄 삭제 |
| 9-2 `champion_skill` | 11자 이상인 줄만, `left(skill_order, 11)`, 상위 10개. v4 규칙(D3)을 대체한다는 기록을 같은 줄에 남김 |
| 9-2 `champion_spell` (C4) | "두 주문이 같은 줄(`summoner1_id = summoner2_id`)은 뺀다" 추가 |
| 10장 확정 사항 | 11번 "스킬 집계: 원본 스킬 순서 앞 11레벨, 11자 미만 제외, 챔피언 × 포지션당 상위 10개 (변경 01)" |
| `db_contract.dbml` | 머리 주석 `// v5 (2026-10-13) - 변경 01: …`, `champion_skill` 블록을 01-2 그대로 교체 |

- `.md`와 `.dbml`의 `champion_skill` 컬럼·PK·설명이 서로 같다. 함수 목록은 `.md`에만 있다.

### 01-5. 계획과 다른 점

| # | 내용 | 이유 |
|---|------|------|
| 1 | L1 수정에서 사용자 이름의 디코딩 형태도 가림 목록에 넣음 | spec 01-4 코드 그대로다 (기존 코드는 사용자 이름 디코딩이 없었음) |
| 2 | 009 머리 주석에 "함수 본문 안의 `DELETE`·`DROP TABLE pg_temp.*`는 006과 같은 집계 동작"이라고 적음 | 지우는 SQL 검사(`grep`)에서 오해하지 않게 |
| 3 | 009의 `champion_skill.win` 주석도 다시 적음 | spec은 `pick`만 적었지만 값이 같은 주석이라 함께 적어 한 곳에서 보이게 |
| 4 | dbml 파싱은 `@dbml/core`의 `dbmlv2` 파서로 함 | 예전 `dbml` 파서(3.14.1, 10.2.0)는 기존 `TableGroup … [color: …]` 줄(17행, 이번에 바꾸지 않은 부분)에서 문법 오류. 새 파서는 통과 |

### 01-6. 남은 문제

| # | 내용 |
|---|------|
| 1 | **통계가 없는 원본에서 집계 시간이 크게 흔들린다.** 2만 5천 게임 6회 중 2회, 1만 게임 2회 중 1회가 5분을 넘겼다 (나머지는 7~12초). 갓 넣은 원본 줄을 플래너가 1줄로 추정해 생기는 것으로 보이며 006부터 있던 동작이다. 실제 운영에서 커밋된 원본은 autovacuum이 `ANALYZE`하지만, 첫 대량 수집 직후처럼 통계가 늦으면 같은 일이 생길 수 있다. 권장: Review가 재현을 확인하고, (a) 백엔드가 대량 수집 뒤 집계 전에 `ANALYZE matches, match_players` 실행(`!백엔드` 범위), 또는 (b) 새 마이그레이션에서 함수 안 `tmp_games`·`tmp_base`를 만든 뒤 `ANALYZE` 추가 중 하나를 사용자에게 제안. Build는 승인된 범위(스킬 부분만 교체)를 넘으므로 함수를 더 바꾸지 않았다 |
| 2 | `db_contract.md` 4장 요약 "dbml v4를 Mermaid로 옮긴 그림"과 10장 7번 "dbml v4 (…)"는 01-2 수정 목록에 없어 그대로 두었다. 4장 요약은 이제 v5 그림이라 문구를 맞출지 결정 필요. → **Review에서 반영 (2026-10-14)**: 두 줄을 "dbml v5"로 고침 (문구만, `db_review.md` 변경 01 검토 C6) |
| 3 | 알려진 한계 (spec 01-8): 11레벨 전에 끝난 게임은 스킬 집계에서 빠진다. 첫 실제 수집 뒤 포지션별 `length(skill_order) < 11` 비율을 잰다 |
| 4 | 성능 측정을 여러 번 롤백해서 `matches`·`match_players`에 죽은 줄이 쌓였다 (측정 직후 `n_dead_tup` 35,000 / 350,000, 그 뒤에도 측정). autovacuum이 정리하며, 줄 수는 모두 0이다 |

---

## 변경 02 (2026-10-14): 테스트 수집 범위(플래티넘~다이아)와 집계 전 ANALYZE

- 작성: Build 서브에이전트 (2026-10-14)
- 기준: `db/docs/db_spec.md` 변경 02 (승인됨). D10 = (a) 백엔드가 집계 직전 `ANALYZE`, D11 = 아이언~골드 제외 유지, D12 = 본 수집 전환 때 결정
- 대상 DB: 위와 같은 Supabase (Session pooler)

### 02-1. 기능별 결과

> 요약: 마이그레이션 010으로 `ranked_players.tier`에 `PLATINUM`을 허용했다. 함수는 바꾸지 않았다(D10 = (a)). 테스트 8개 파일이 실제 스키마와 임시 스키마에서 모두 통과했고, 계약을 v6으로 올렸다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 010 CHECK 교체 | `DROP CONSTRAINT ranked_players_tier_check` → 같은 이름으로 `CHECK (tier IN ('PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'))` 다시 추가. `NOT VALID` 없음. 실제 DB `convalidated = true` | ✅ |
| 010 주석 | 테이블·`tier` 주석을 spec 02-4 문구 그대로 다시 적음. 실제 DB `obj_description`·`col_description`이 파일 문구와 같음 | ✅ |
| 지우는 SQL 확인 | 010에 `DELETE`, `TRUNCATE`, `DROP TABLE` 없음 (`grep` 확인). `DROP CONSTRAINT`는 같은 트랜잭션에서 바로 다시 만드는 구조 변경 | ✅ |
| 함수 변경 없음 (D10 = (a)) | 010은 `refresh_patch_stats`를 건드리지 않음. 실제 DB `md5(prosrc)` 적용 전·후 모두 `c4740067177eeb20705db20dd308ed07` | ✅ |
| 보안 | 새 객체 없음. `ranked_players` RLS 켜짐, public 정책 0개. 006 보안 테스트 통과 | ✅ |
| 테스트 008 (새 파일) | `db/tests/008_ranked_players_tier.sql`. 허용 6개 INSERT, 거부 6개(`IRON`, `BRONZE`, `SILVER`, `GOLD`, `platinum`, `''`)를 하위 블록에서 23514로 확인, `pg_get_constraintdef`에 `'PLATINUM'`·`convalidated = true`, CHECK가 `rank_check`·`tier_check` 2개뿐, `PLATINUM` 표본을 참조하는 `matches` 1줄(`KR_9000000001`, 패치 `0.4`). puuid는 `test-008-…` | ✅ |
| 기존 테스트 001~007 | 고치지 않음. 모두 그대로 통과 (001의 `EMERALD` 샘플 포함) | ✅ |
| 계약 `.md` (C5) | 02-3 표대로 반영 (02-3) | ✅ |
| 계약 `.dbml` | 머리 주석 2번째 줄, `ranked_players` 메모·`tier` 메모, `champion_skill.skill_order` 메모, 뷰 메모 아래 집계 호출 규칙. `@dbml/core` 10.3.1 `dbmlv2` 파서(scratch 폴더에 설치)로 파싱 성공 | ✅ |
| 성능 다시 재기 | 함수가 바뀌지 않아 하지 않음 (spec 02-5). "나쁜 통계 → `ANALYZE` → 집계" 재현은 완료 기준에서 Review 권장 항목. Review가 5,000게임 1회 측정: 1.64초 (db_review 변경 02 검토 R4) | ✅ |

### 02-2. 검증 결과

| 순서 | 명령 | 결과 |
|------|------|------|
| 1 | 적용 전 조회 | 테이블 10개 모두 0줄, `md5(prosrc)` = `c4740067…`, `tier_check`에 `PLATINUM` 없음, `migrate:status` 010 대기 |
| 2 | `npm run migrate:fresh-check` | 001~010 10개 파일 통과. 임시 스키마 결과 테이블 10, 뷰 1, 함수 4. `migration_check` 남지 않음 |
| 3 | `npm run verify:fresh` | 8개 파일 모두 통과 (008 182ms). 줄 수 전·후 모두 0, 샘플 데이터 남지 않음 |
| 4 | `npm run migrate` | `010_ranked_players_platinum.sql` 1개 적용 |
| 5 | `npm run migrate:status` | 001~010 모두 적용됨, 체크섬 불일치 없음 (010 적용 2026-10-14) |
| 6 | `npm run verify` (실제 스키마) | 8개 파일 모두 통과 (008 33ms). 줄 수 전·후 모두 0, 샘플 데이터 남지 않음 |
| 7 | 적용 후 조회 | `ranked_players_tier_check` = `CHECK ((tier = ANY (ARRAY['PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'])))`, `convalidated = true`. 같은 테이블 CHECK는 `rank_check`·`tier_check` 2개. `md5(prosrc)` = `c4740067177eeb20705db20dd308ed07` (변화 없음). 테이블 10개 모두 0줄 |

- 001~009 파일은 고치지 않았다. `db/`가 아직 git에 올라가지 않아 `git diff`로는 확인할 수 없고, `migrate:status`의 체크섬 비교(불일치 없음)로 확인했다.

### 02-3. 계약 반영 (v6)

| 위치 | 반영 |
|------|------|
| `db_contract.md` 머리말 | 상태 `v6 승인됨 (2026-10-14, 변경 02)`, 기준 `(v6, 2026-10-14 변경 02)`. "v4 → v5 변경" 표 위에 "v5 → v6 변경" 표 추가 |
| 1장 요약 | 테스트(플래티넘·에메랄드·다이아 각 50명)와 본 수집(에메랄드 이상) 구분 |
| 1-1 | "티어" 줄 교체, 표 아래 `ranked_players.tier` 허용 값 한 줄 추가 (`IRON`~`GOLD` 저장 불가) |
| 1-3 | 제목 "개발 단계 운영 (테스트 수집)", 내용을 spec 02-3 "1-3 새 내용"으로 교체 |
| 2장 | `ranked_players`: "수집 대상 표본(테스트: 플래티넘~다이아, 본 수집: 에메랄드 이상)" |
| 4장 ERD | `tier "PLATINUM ~ CHALLENGER"`, `skill_order PK "^[QWER]{11}$, EQQWQRQEQER"` |
| 5장 ①·⑥ | ① 티어 문구와 "티어·디비전별 인원은 백엔드 수집기 설정 (1-1, 1-3)", ⑥ `ANALYZE matches, match_players` → `refresh_patch_stats` (9-4) |
| 6-1 `tier` | JSON 경로 뒤에 ". 허용 값은 1-1" |
| 7장 | 마지막 줄 "집계 호출" 추가 (9-4 안내) |
| 9장 요약 | "다시 만들기 전에 `ANALYZE matches, match_players`를 먼저 실행하고," |
| 9-2 `champion_skill` | 줄 끝에 CHECK `champion_skill_skill_order_check` 문구 (L5) |
| 9-4 (새 절) | "백엔드 호출 규칙" 표(ANALYZE → refresh → purge)와 메모 4줄 |
| 10장 | 2번 교체, 12번 "집계 전 통계" 추가 |
| `db_contract.dbml` | 머리 주석 v6, `ranked_players` 메모(테스트/본 수집 두 줄), `tier` 메모(`PLATINUM` 포함, CHECK 이름), `skill_order` 메모(`CHECK skill_order ~ '^[QWER]{11}$'`), 뷰 메모 아래 "집계 호출 규칙" 주석 2줄 |

- `.md`와 `.dbml`의 `tier` 허용 값, 수집 범위, `skill_order` CHECK, 집계 전 `ANALYZE` 규칙이 서로 같다.
- `.dbml`의 `skill_order` 메모는 spec 그대로 작은따옴표 이스케이프(`\'`)를 썼다. 파서 결과 메모가 `CHECK skill_order ~ '^[QWER]{11}$'`로 바르게 나온다.

### 02-4. 계획과 다른 점

| # | 내용 | 이유 |
|---|------|------|
| 1 | spec의 "9-1 요약" 수정은 9장 맨 위 요약(`> 요약: 백엔드는 …`)에 반영함 | 9-1 절에는 요약 줄이 없고, 바꿀 문구 `… 다시 만들고,`는 9장 요약에만 있다 |
| 2 | 010 머리 주석에 D10 = (a)라 함수를 바꾸지 않는다는 줄과 `public.` 접두사 주의 줄을 더 적음 | 001~009와 같은 주석 방식. 동작에는 영향 없음 |

### 02-5. 남은 문제

| # | 내용 |
|---|------|
| 1 | `db_contract.md` 4장 요약 "dbml v5를 Mermaid로 옮긴 그림"과 10장 7번 "dbml v5 (…)"는 02-3 수정 목록에 없어 그대로 두었다. 테이블 구성은 v5와 같지만 문구를 v6으로 맞출지 Review가 결정. **Review에서 반영 (2026-10-14):** 두 줄을 "dbml v6"으로 고침 (문구만, db_review 변경 02 검토 R5) |
| 2 | 계약 9-4 `ANALYZE` 규칙은 DB가 강제하지 않는다 (D10 = (a)). `!백엔드` Plan·Review에서 지켜지는지 확인해야 하고, 안 지켜지면 새 마이그레이션으로 (b')를 넣는다 (spec D10) |
| 3 | "나쁜 통계 → `ANALYZE` → 집계" 5,000게임 재현(완료 기준 권장 항목)은 Build에서 하지 않음. Review가 1~2회만 측정 (죽은 줄 용량 주의). **Review에서 반영 (2026-10-14):** 9-4대로 1.64초, `ANALYZE` 없이 120초 시간 초과 (db_review 변경 02 검토 R4) |
| 4 | D12: 본 수집 전환 때 플래티넘 테스트 게임을 어떻게 할지 다시 결정. 지울 경우 삭제 SQL이라 사용자 승인 대상 |
