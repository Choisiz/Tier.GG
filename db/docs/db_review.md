# DB 검토 기록 (`!db` Review)

- 작성: Review 서브에이전트 (2026-10-13). Build와 별도로, Build 보고를 믿지 않고 실제 DB를 직접 조회해 확인했다.
- 기준: `docs/contracts/db_contract.dbml` v4 (우선), `docs/contracts/db_contract.md`, `db/docs/db_spec.md` (승인됨, D1 = (a) 뷰, D2 아이템 전부, D3 5레벨 2개 이상, D4 중복 1번, C1 CHECK), `db/docs/db_build.md`
- 대상: Supabase PostgreSQL 17.11, Session pooler, 역할 `postgres`
- 방법: `pg`로 카탈로그(`information_schema`, `pg_constraint`, `pg_indexes`, `pg_class`, `pg_proc`, `pg_default_acl`)를 직접 조회. 함수 검증은 Build 테스트와 별개로 직접 만든 시나리오 55건. **모든 샘플은 ROLLBACK 되는 트랜잭션 안에서만 실행했다.**

---

## 1. 종합 판정

> 요약: **PASS with issues.** 구조, 보안, 함수 결과, 재적용 모두 계약과 같다. 막는 문제는 없다. 실제 수집 규모(패치당 2만 5천 게임)에서의 집계 시간 여유와 용량 추정은 첫 실제 수집 뒤 다시 확인해야 한다.

| 구분 | 결과 |
|------|------|
| 판정 | **PASS with issues** |
| Critical / High | 0 / 0 |
| Medium | 2 (집계 시간 여유, 집계 테이블 용량 추정) |
| Low | 4 |
| 참고 | 3 |
| Review에서 고친 것 | 없음 (새 마이그레이션 009 만들지 않음, 코드 수정 없음) |
| 실제 데이터 | 검토 전·후 모든 테이블 0줄, `schema_migrations` 8줄 그대로 |

---

## 2. 체크리스트

> 요약: CLAUDE.md 10장과 db_spec 8장의 항목을 하나씩 확인한 결과다. 숫자는 모두 이번 검토에서 직접 조회하거나 실행한 값이다.

### 2-1. 구조 (db_spec 8-1)

| 항목 | 결과 | 근거 |
|------|------|------|
| 마이그레이션 적용 | ✅ | `migrate:status` 001~008 모두 "적용됨", 체크섬 불일치 0 |
| 컬럼 이름·순서·타입·NOT NULL·기본값 | ✅ | `information_schema.columns` 99줄 (테이블 11 + 뷰). dbml v4와 한 줄씩 비교해 모두 같음. `match_players` 26개 컬럼 순서 같음, `collection_logs.started_at` 기본값 `now()`, `id` 2개 `GENERATED ALWAYS` identity |
| PK | ✅ | 11개 (계약 10 + `schema_migrations`). `match_players (match_id, puuid)`, 집계 5개 `(patch, champion_id, position, …)` |
| FK와 ON DELETE | ✅ | 7개. `matches.puuid` SET NULL, `match_players.match_id` CASCADE, `champion.patch` CASCADE, 상세 4개 `(patch, champion_id, position)` CASCADE |
| 유니크 | ✅ | `champion_rune_page_key` 1개, 14개 컬럼 |
| CHECK (C1) | ✅ | 38개. spec 4장 표와 하나씩 같음 |
| 인덱스 | ✅ | 13개 = PK 11 + 유니크 1 + `match_players_champion_id_team_position_idx` 1 |
| 함수 5개, 인자·반환 | ✅ | `patch_sort_key(text) → int[]`, `skill_priority(text) → text`, `tier_from_score(numeric) → smallint`, `refresh_patch_stats(text) → jsonb`, `purge_old_patches(int) → int`. 모두 `search_path=public, pg_catalog`, SECURITY INVOKER |
| 실제 함수 본문 = 파일 | ✅ | `pg_proc.prosrc` md5와 마이그레이션 파일의 `$$ … $$` md5가 5개 모두 같음 (적용 후 DB에서 따로 바뀐 것 없음) |
| 뷰 | ✅ | `champion_tier_view` 13개 컬럼, 계약 9-3 표와 같음 |
| v3 전용 객체 | ✅ | 컬럼 0개, 테이블 0개 (`match_bans`, `patch_stats`, `champion_tiers` 등) |
| 원본 컬럼 주석 | ✅ | 32개 (원본 3개 테이블 컬럼 수와 같음) |

### 2-2. 보안 (db_spec 8-2)

| 항목 | 결과 | 근거 |
|------|------|------|
| RLS | ✅ | 11개 테이블 `relrowsecurity = true`, `relforcerowsecurity = false` |
| 정책 | ✅ | `pg_policies` public 스키마 0개 |
| 테이블·뷰 권한 | ✅ | `anon`, `authenticated`의 SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 모두 false (12개 객체 × 2역할 × 7권한). 컬럼 권한 0개. ACL에는 `postgres`, `service_role`만 있음 |
| 시퀀스 권한 | ✅ | 2개 시퀀스 × 2역할 USAGE/SELECT/UPDATE 모두 false |
| 함수 권한 | ✅ | 5개 함수 `proacl = {postgres=X, service_role=X}`, PUBLIC 항목 없음, `anon`·`authenticated` EXECUTE false |
| 뷰 security_invoker | ✅ | `reloptions = {security_invoker=true}` |
| 주인 | ✅ | 테이블·뷰·시퀀스·함수 모두 `postgres` |
| **실제 역할로 실행** | ✅ | 롤백 트랜잭션 안에서 `SET LOCAL ROLE anon` / `authenticated`로 22개 문장(테이블 11개 + 뷰 SELECT, INSERT/UPDATE/DELETE, 함수 5개 호출, `nextval`)을 실행 → **44건 모두 42501(권한 없음)으로 거부**, 허용 0건 |

- publishable(anon) 키는 `.env`에 없어 HTTP 호출은 하지 않았다. PostgREST가 쓰는 역할로 직접 실행한 위 시험이 같은 확인이다.

### 2-3. 재적용 (db_spec 8-3)

| 항목 | 결과 | 근거 |
|------|------|------|
| `npm run migrate:fresh-check` | ✅ | 8개 파일 통과, 임시 스키마에 테이블 10 · 뷰 1 · 함수 5, ROLLBACK 뒤 `migration_check` 남지 않음, 실제 스키마 변화 없음 (약 1.1초) |
| `npm run migrate:status` | ✅ | 8개 적용됨 |
| `npm run migrate` 다시 실행 | ✅ | "적용할 파일 없음", exit 0 |
| 체크섬 검사 (직접 시험) | ✅ | scratchpad 복사본에서 `005`에 줄바꿈 1개 추가 + 실패하도록 만든 대기 파일 `009`(`SELECT 1/0`) → "체크섬 불일치: 005", **009도 적용하지 않음**, exit 1. `status`도 "체크섬 불일치", exit 1 |
| 파일 삭제 검사 | ✅ | 복사본에서 `008` 삭제 → "기록에는 있으나 파일 없음", 아무것도 적용 안 함, exit 1 |
| 파일 이름 규칙 | ✅ | `9_bad_name.sql` → "파일 이름 규칙 위반", exit 1 |
| Build의 `npm run verify` | ✅ | 6개 파일 모두 통과, 10개 테이블 0 → 0 |
| Build의 `npm run verify:fresh` | ✅ | 6개 파일 모두 통과, 0 → 0, 임시 스키마 남지 않음 |

### 2-4. 함수 결과 — 직접 만든 시나리오 (db_spec 8-4, 8-5)

> Build 테스트와 다른 데이터로 직접 설계하고, 기대값은 실행 전에 손으로 계산했다. 55건 모두 통과. 트랜잭션 1개 안에서 실행하고 ROLLBACK 했다.

| 영역 | 확인한 내용 (손 계산 기대값 = 실제값) | 결과 |
|------|----------------------------------------|------|
| `patch_sort_key` | `16.9 < 16.10`, `9.24 < 10.1`, `[0.9, 0.10, 0.19, 1.2, 0.11]` 내림차순 = `1.2, 0.19, 0.11, 0.10, 0.9` | ✅ |
| `skill_priority` 16건 | `QWQWQWQWQW` → `Q>W>E` (Q 5번째 = 9번째 글자), `WEWEWEWEWER` → `W>E>Q`, `RQQQQQRWWWWWR` → `Q>W>E` (R 무시), 세 스킬 모두 5 도달 `QQQQQEEEEEWWWWW` → `Q>E>W`, 4·4·4 `QWEQWEQWEQWE` → NULL, `EEEEE`(1개만) → NULL, `''`·NULL → NULL | ✅ |
| `tier_from_score` 12건 | 100 → 1, 53.0 → 1, 52.9999 → 2, 51.5 → 2, 51.4999 → 3, 50.0 → 3, 49.9999 → 4, 48.5 → 4, 48.4999 → 5, 0·-5 → 5, NULL → NULL | ✅ |
| CHECK 거부 12건 | 티어 `GOLD`, `KR_`, 패치 `16`, 상태 `ok`, 끝난 시각 < 시작 시각, `players -1`, `games 0`, `win > pick`, 포지션 `ADC`, 스펠 `4/4`, 스킬 `Q>Q>E`, `item_id 0` → 모두 23514 | ✅ |
| 대상 게임 | 패치 `0.10`에 10줄 4게임 + **8줄 게임**(10명 미만) + **11줄 게임** + 다른 패치(`0.9`) 10줄 게임 → `games = 4` | ✅ |
| 반환값 | `{games 4, champion_rows 12, item_rows 12, rune_rows 13, spell_rows 12, skill_rows 5}` | ✅ |
| `champion` pick/win/ban | `10 TOP 2/1/1`, `10 MIDDLE 1/0/1` (같은 챔피언 두 포지션 같은 ban), `20 TOP 4/2/0`, `30 UTILITY 3/2/0` (**포지션 NULL 줄은 pick에서 빠짐**), `99 TOP 1/1/2` (**G1에서 양 팀이 99를 밴해도 1번** + G4 1번 = 2, 제외된 게임 3개의 99 밴은 안 셈) | ✅ |
| 밴만 된 챔피언 | 50, 60(양 팀 밴)은 `champion` 줄 없음 (계약의 알려진 한계 그대로) | ✅ |
| `champion_item` | `10 TOP 1036 1/1` (**한 줄의 1036 두 개 → 1번**), `10 TOP 3031 2/1` (G2 `3031, 3031` → 1번), 0과 **NULL 아이템** 제외, 포지션 NULL 줄 제외 | ✅ |
| `champion_spell` | `14/4`와 `4/14` → `(4, 14)` 한 줄, `summoner1 = summoner2` 줄(4/4)은 제외되어 `210 UTILITY 4/7 3/2` | ✅ |
| 스펠 상위 10개 + 동률 | 12조합 각 1판 (짝수 승리) → 승리 6개(1/2~1/12) 뒤에 패배 중 작은 번호 4개(1/3~1/9), `1/11`, `1/13` 제외 | ✅ |
| `champion_rune` | 파편(`stat_defense`)만 다른 페이지는 다른 줄: `20 TOP 8021/5011 3/1`, `8021/5001 1/1` | ✅ |
| `champion_skill` | `20 TOP W>Q>E 2/0`, `W>E>Q 1/1`. 빈 문자열·NULL·스킬 1개만 5 도달 줄은 제외 | ✅ |
| 다른 패치 보존 | `0.10` 집계가 먼저 만든 `0.11` 집계(games 12, champion 10줄)를 건드리지 않음 | ✅ |
| 다시 집계 | 게임 1개 삭제 뒤 재집계 → `games 3`, 사라진 `10 MIDDLE` 줄 없어짐, `99` ban 2 → 1 | ✅ |
| 오류 | NULL 패치, `'0.10 '`(공백) → 22023, 게임 없는 패치 → P0002 | ✅ |
| `champion_tier_view` | 아래 표 7줄 모두 손 계산과 같음 | ✅ |
| 뷰 정렬 | 문서의 `ORDER BY tier NULLS LAST, tier_score DESC` → `3, 2, 4, 1` (pick 49인 1번이 마지막) | ✅ |
| FK 동작 | `ranked_players` 삭제 → `matches.puuid` NULL 6줄, `patch` 삭제 → `champion`·상세 CASCADE 0줄, 그 뒤 재집계 정상 | ✅ |
| `purge_old_patches` | 패치 5개(`0.9` 1, `0.10` 5, `0.11` 12, `0.19` 1, `1.2` 2 = 21게임) → `purge(2) = 18`, **남은 패치 `0.19, 1.2`** (문자열 정렬이었다면 `0.9`가 남았을 것), `match_players` 9줄만 남음 (CASCADE), 집계 5개 패치 그대로. `purge(10) = 0`, `purge() = 0`, `purge(1) = 1`, `purge(0)`·`purge(NULL)` → 22023, 빈 `matches` → 0 | ✅ |

티어 뷰 손 계산 (패치 `0.50` games 200, `0.51` games 1000):

| 챔피언 | pick / win / ban | 승률 | 픽률 | 밴률 | 보정 승률 | 점수 | 티어 |
|--------|------------------|------|------|------|-----------|------|------|
| 1 | 49 / 30 / 0 | 61.22 | 24.50 | 0.00 | 53.69 | 53.691 + 2.0 = 55.691 | NULL (49판) |
| 2 | 50 / 25 / 10 | 50.00 | 25.00 | 5.00 | 50.00 | 50 + 2.0 + 0.15 = 52.150 | 2 |
| 3 | 50 / 31 / 0 | 62.00 | 25.00 | 0.00 | 54.00 | 56.000 | 1 (50판) |
| 4 | 100 / 40 / 80 | 40.00 | 50.00 | 40.00 | 45.00 | 45 + 2.0(상한 20) + 0.9(상한 30) = 47.900 | 5 |
| 5 | 100 / 48 / 0 | 48.00 | 10.00 | 0.00 | 49.00 | 50.000 (경계 정확히) | 3 |
| 6 | 100 / 47 / 0 | 47.00 | 10.00 | 0.00 | 48.50 | 49.500 | 4 |
| 7 | 100 / 45 / 0 | 45.00 | 10.00 | 0.00 | 47.50 | 48.500 (경계 정확히) | 4 |

### 2-5. 성능·용량 (추가 확인, 롤백)

| 항목 | 결과 | 근거 |
|------|------|------|
| `refresh_patch_stats` 5,000게임 (5만 줄, 챔피언당 아이템 약 40종) | ⚠️ | **8.6초**. 그중 `skill_priority`가 약 4.0초 (skill_order를 NULL로 바꾸면 4.6초) |
| 2만 5천 게임 추정 | ⚠️ | 선형으로 약 **43초**. 이 연결의 `statement_timeout`은 **2분** → 여유 약 2.8배 (이슈 M1) |
| `skill_priority` 단독 | ⚠️ | 25만 번 호출 17.7초 (1번 약 70µs). 같은 판정을 `regexp_instr(x, 'Q', 1, 5)`로 하면 2.2초 (약 8배 빠름) |
| 티어 뷰 조회 | ✅ | 패치 1개 × 포지션 1개 (170줄) 4ms |
| `match_players` 1줄 크기 | ✅ | 5만 줄 = 12MB (본문 8.4MB). puuid가 15자인 샘플 기준 약 250B, 실제 78자면 약 375B → 계약 추정 400B와 맞음 |
| 집계 테이블 용량 | ⚠️ | 집계 줄 평균 약 120B (인덱스 포함). 실제 아이템 줄 수는 첫 수집 전에는 알 수 없음 (이슈 M2) |
| 샘플 잔존 | ✅ | 모든 시험 후 10개 테이블 0줄, `migration_check` 스키마 없음 |

- 롤백한 대량 샘플 때문에 DB 크기가 13MB → 61MB까지 늘었다가 autovacuum으로 36MB까지 줄었다. 롤백된 줄의 빈 공간이며 실제 데이터는 없다. autovacuum이 계속 정리한다.
- 시퀀스는 롤백되지 않는다. 검증 실행으로 `collection_logs_id_seq`가 3, `champion_rune_id_seq`가 25,644까지 올라갔다. 동작에는 영향이 없다 (참고 I1).

### 2-6. 코드 품질 (실행기)

| 항목 | 결과 | 근거 |
|------|------|------|
| 파일 1개 = 트랜잭션 1개, 실패 시 ROLLBACK 후 멈춤 | ✅ | `cmdUp` 코드 확인 |
| 동시 실행 방지 | ✅ | `pg_advisory_lock` (Session pooler라 세션 잠금 유지됨), `finally`에서 해제 |
| 체크섬 가드 | ✅ | 2-3 직접 시험 |
| 비밀값 출력 | ⚠️ | 정상 URL에서 존재하지 않는 호스트 → `getaddrinfo ENOTFOUND ***` (가려짐). `DATABASE_URL` 비었을 때 안내만 출력. 단, 비밀번호에 인코딩 안 된 `%`가 있으면 호스트가 가려지지 않음 (이슈 L1) |
| 의존성 | ✅ | `pg@8.23.1` 1개, `npm audit` 취약점 0, `db/node_modules`·`.env`·`docs/career_log.md` 모두 `.gitignore` |
| 문서·코드에 비밀값 | ✅ | `db/`, `docs/contracts/`에 접속 문자열 없음 |

---

## 3. 발견한 문제 (심각도 순)

> 요약: 지금 막는 문제는 없다. Medium 2개는 실제 수집 규모에서 생길 수 있는 위험이라 백엔드 전체 수집 전에 판단이 필요하다.

| # | 심각도 | 내용 | 권장 조치 |
|---|--------|------|-----------|
| M1 | Medium | **집계 시간 여유가 크지 않다.** 5,000게임 집계 8.6초 → 2만 5천 게임 약 43초 추정. Supabase 기본 `statement_timeout` 2분에 걸리면 집계 전체가 롤백된다 (기존 집계는 남음). 무료 플랜은 CPU를 공유해 시간이 흔들릴 수 있다. 시간의 약 절반이 `skill_priority`다 (`generate_series` + 창 함수 3번, 1번 약 70µs) | 백엔드 전체 수집 전에 둘 중 하나: ① 새 마이그레이션 `009`에서 `skill_priority`를 `regexp_instr(p_order, 'Q', 1, 5)` 방식으로 `CREATE OR REPLACE` (결과 같음, 약 8배 빠름, 기존 16건 시험으로 같은 결과 확인 필요) ② 백엔드가 집계 호출 전에 `SET statement_timeout = '5min'`. 결과가 틀린 것은 아니라 Review에서 바꾸지 않았다 |
| M2 | Medium | **집계 테이블 용량 추정이 낙관적일 수 있다.** 계약은 패치당 약 4MB, 1년 약 310MB로 잡았다. `champion_item`은 D2에 따라 모든 아이템을 저장하는데, 샘플(챔피언당 아이템 약 40종, 5,000게임)에서 이미 5만 1,650줄이 나왔다. 줄당 약 120B라 실제 아이템 종류 수에 따라 패치당 5~10MB, 1년 360~460MB가 될 수 있다 | 첫 실제 수집(수백~수천 게임) 뒤 `pg_total_relation_size`로 패치당 집계 크기를 재고 계약 1-2를 다시 계산. 크면 오래된 패치의 긴 꼬리 아이템(예: 그 챔피언 pick의 1% 미만) 정리를 사용자에게 제안 (D2를 다시 정하는 일이라 승인 필요) |
| L1 | Low | `scripts/lib.mjs` `secretsToHide()`: 비밀번호에 인코딩 안 된 `%`가 있으면 `decodeURIComponent`가 예외를 던져, 같은 `try` 안의 사용자 이름·호스트가 가림 목록에 들어가지 않는다. 시험: `Fa%zzPw999` → `ENOTFOUND nonexistent-host.invalid`가 그대로 출력. 비밀번호 자체는 pg 오류 메시지에 나오지 않고 전체 URL은 가려진다 | `decodeURIComponent`만 따로 `try`로 감싸고 `u.password`, `u.username`, `u.hostname`은 먼저 넣는다. `scripts/`는 Review 수정 범위 밖이라 고치지 않았다 |
| L2 | Low | Supabase 기본 권한(`pg_default_acl`)이 아직 public 새 테이블·함수·시퀀스에 `anon`·`authenticated` 전체 권한을 준다 (조회로 확인). 지금 객체는 모두 회수됐지만, 앞으로 마이그레이션에서 `REVOKE`를 빠뜨리면 바로 노출된다. 보안 테스트(`tests/006`)는 객체 목록을 손으로 적어 새 객체를 자동으로 검사하지 못한다 | ① `tests/006`을 `pg_class`·`pg_proc` 전체를 도는 방식으로 바꾸기 (public의 모든 테이블·뷰·함수·시퀀스) ② 또는 `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL … FROM anon, authenticated` 마이그레이션 (지속 설정 변경이라 사용자 승인 필요) |
| L3 | Low | `matches.puuid` FK에 인덱스가 없다. `ranked_players`를 지우면 지운 줄마다 `matches`(최대 5만 줄)를 순차 스캔한다. 계약상 지금은 upsert만 하므로 문제가 없다 | 백엔드가 표본 플레이어를 지우는 기능을 만들면 그때 `matches (puuid)` 인덱스 추가 (약 5MB) |
| L4 | Low | 뷰의 `tier_score`는 소수 3자리로 반올림해 보여주고 `tier`는 반올림 전 점수로 정한다. 그래서 점수가 `53.000`으로 보여도 티어가 2일 수 있다 (예: 52.9996). 계약 9-3 정의 그대로다 | 백엔드·프론트는 `tier_score`로 티어를 다시 계산하지 말고 `tier`를 그대로 쓴다. `api_contract.md` 작성 때 한 줄 명시 |
| I1 | 참고 | 시퀀스는 롤백되지 않아 검증 실행마다 `collection_logs_id_seq`, `champion_rune_id_seq`가 올라간다 (지금 3, 25,644). 첫 실제 수집 기록 id가 1이 아니다 | 조치 없음. 백엔드는 id를 순서 번호로 가정하지 않는다 |
| I2 | 참고 | `match_players_champion_id_team_position_idx`는 집계 함수가 쓰지 않는다 (실제 규모 약 15MB). Build 남은 문제 3과 같음 | 실제 수집 뒤 `pg_stat_user_indexes.idx_scan`이 0이면 새 마이그레이션으로 삭제 제안 |
| I3 | 참고 | 실행기는 이미 적용된 마지막 번호보다 작은 번호의 새 파일(예: 008 적용 후 새 `004_x.sql`)을 경고 없이 마지막에 적용한다 | 번호는 항상 마지막보다 크게 붙인다. 필요하면 실행기에 경고 추가 |

---

## 4. Build의 계획과 다른 점에 대한 판단

> 요약: 9개 모두 받아들일 수 있다. 동작 규칙을 바꾼 것은 없고, 대부분 계획의 빈틈을 안전한 쪽으로 메운 것이다.

| # | Build 내용 | 판단 | 이유 |
|---|-----------|------|------|
| 1 | `scripts/lib.mjs` 추가 | ✅ 수용 | 중복 제거. 단 L1 수정이 필요 |
| 2 | `verify:fresh`, `--fresh`, `MIGRATIONS_DIR` 추가 | ✅ 수용 | 실제 파일을 고치지 않고 체크섬 검사를 시험할 수 있다. Review도 이 기능으로 체크섬 가드를 직접 시험했다. `MIGRATIONS_DIR`은 운영에서 쓰면 안 된다 (문서에 명시됨) |
| 3 | `up`이 파일마다 `SET LOCAL search_path = public, pg_catalog` | ✅ 수용 | 함수 5개의 `proconfig`가 `public, pg_catalog`로 고정된 것을 확인. Supabase 기본값(`"$user", public, extensions`)을 잡았다면 `extensions` 스키마 객체에 영향받을 수 있었다 |
| 4 | 패치 형식 검사를 잠금보다 먼저 | ✅ 수용 | NULL 잠금 키 문제를 피함. 형식 검사는 DB를 읽지 않으므로 순서를 바꿔도 동시성 영향 없음 |
| 5 | 시작할 때 기존 `tmp_games`·`tmp_base` 삭제 | ✅ 수용 | `pg_temp.` 접두사로 임시 테이블만 지움. 같은 트랜잭션에서 2번 부르는 시나리오(재집계 시험)가 실제로 통과 |
| 6 | `summoner1_id = summoner2_id` 줄은 스펠 집계에서 제외 | ✅ 수용 | 시험에서 4/4 줄이 빠지고 나머지 집계는 정상. 없으면 잘못된 원본 1줄 때문에 패치 전체 집계가 실패한다. 계약 9-2에 이 제외 규칙이 적혀 있지 않으니 다음 계약 수정 때 한 줄 추가 권장 |
| 7 | `fresh-check` 파일마다 SAVEPOINT | ✅ 수용 | 마지막에 전체 ROLLBACK은 같음, 실패 파일을 정확히 보여줌 |
| 8 | 실제 데이터가 있으면 테스트 001, 005 건너뜀 | ✅ 수용 | 실제 데이터에서 `purge_old_patches`를 실행하지 않는 안전장치. 실제 수집 뒤에는 `verify:fresh`로 같은 검사를 하면 된다 |
| 9 | "반올림 전 점수로 티어"를 함수 값으로 확인 | ✅ 수용 | 뷰 코드가 반올림 전 `s.score`를 `tier_from_score`에 넘기는 것을 확인. Review도 경계값(정확히 50.0, 48.5)을 뷰로 따로 확인 |

---

## 5. 계획 대비 빠진 것

> 요약: db_spec 8장 완료 기준은 모두 충족했다. 계획과 다른 문서 표현 1건만 있다.

| 항목 | 내용 |
|------|------|
| 완료 기준 8-1 ~ 8-6 | 모두 충족 (2장) |
| spec 7-6 표현 | spec 7-6 표는 `tier = tier_from_score(tier_score)`로 적혀 있어 반올림 값을 넘기는 것처럼 읽힌다. 같은 표의 `tier_score` 설명과 계약 9-3은 "반올림 전 점수"이고, 구현은 계약을 따랐다. 계약이 우선이므로 구현은 맞다 (L4 참고) |
| 계약 9-2 | 스펠 같은 번호 줄 제외(Build 다른 점 6)가 계약에 없다. 다음 계약 수정 때 반영 권장 |

---

## 6. Review에서 고친 것

- 없음. 결과가 틀린 결함은 찾지 못했다. M1(성능)은 결과가 맞고 지금 규모에서 동작하므로, 새 마이그레이션 `009`를 만들지 않고 권장 조치로 남겼다. L1은 `scripts/`가 Review 수정 범위 밖이라 고치지 않았다.
- `db/docs/db_build.md`는 고친 기능이 없어 수정하지 않았다.

---

## 변경 01 검토 (2026-10-14): 스킬 집계를 앞 11레벨 순서로

- 작성: Review 서브에이전트 (2026-10-14). Build 보고를 믿지 않고 실제 DB를 직접 조회·실행해 확인했다.
- 기준: `db/docs/db_spec.md` 변경 01 (승인됨, D5 `skill_order`, D6 삭제, D7 상위 10개, D8 `RENAME`, D9 L1 포함, C4), `db/docs/db_build.md` 변경 01, 계약 v5 (`db_contract.md`, `db_contract.dbml`)
- 대상: Supabase PostgreSQL 17.11, Session pooler
- **모든 샘플은 ROLLBACK 되는 트랜잭션 안에서만 실행했다.** 검토 전·후 테이블 10개 모두 0줄.

### C1. 종합 판정

> 요약: **PASS with issues.** 구조·보안·함수 결과·재적용 모두 승인안·계약과 같다. 스킬 규칙에서 결함은 없다. 남은 문제는 006부터 있던 "통계 없는 원본에서 집계가 수 분 걸리는" 실행 계획 문제이고, 원인을 재현으로 확인했다. 해결은 백엔드가 집계 전에 `ANALYZE`를 실행하는 것(선택지 a)을 권장한다.

| 구분 | 결과 |
|------|------|
| 판정 | **PASS with issues** |
| Critical / High | 0 / 0 |
| Medium | 1 (M2: 통계가 틀린 원본에서 집계 시간 초과) |
| Low | 1 (L5: 계약에 `champion_skill` CHECK 형식이 없음) |
| Review에서 고친 것 | 계약 `.md` 문구 2줄 (C6). 마이그레이션 010 만들지 않음 |
| 실제 데이터 | 검토 전·후 모든 테이블 0줄, `schema_migrations` 9줄 그대로 |

### C2. 체크리스트

> 요약: spec 01-6 완료 기준을 하나씩 직접 확인했다. 숫자는 모두 이번 검토에서 조회·실행한 값이다.

| 항목 | 결과 | 근거 |
|------|------|------|
| `migrate:status` | ✅ | 001~009 "적용됨", 체크섬 불일치 0 (001~008 파일이 바뀌지 않음) |
| `migrate:fresh-check` | ✅ | 9개 파일 통과, 임시 스키마 테이블 10 · 뷰 1 · 함수 4, `migration_check` 남지 않음 |
| `champion_skill` 컬럼 | ✅ | `patch text`, `champion_id integer`, `position text`, `skill_order text`, `pick integer`, `win integer` 순서, 모두 NOT NULL. `skill_priority` 컬럼 없음 |
| 제약 | ✅ | `champion_skill_pkey` = `(patch, champion_id, "position", skill_order)`, FK `(patch, champion_id, position)` → `champion` ON DELETE CASCADE, `champion_skill_skill_order_check` = `skill_order ~ '^[QWER]{11}$'`, `pick_check`, `win_check`. 예전 `skill_priority_check` 없음 |
| 주석 | ✅ | 테이블·`skill_order` 주석이 "앞 11레벨" 뜻으로 바뀜 |
| `skill_priority` 함수 (D6) | ✅ | `to_regprocedure('public.skill_priority(text)') IS NULL`. `pg_proc.prosrc`·`pg_views.definition`에 `skill_priority` 문자열 0건 |
| `refresh_patch_stats` 본문 = 009 | ✅ | `md5(prosrc)` = 009 파일의 `$$ … $$` 본문 md5 = `c4740067177eeb20705db20dd308ed07` |
| 006과의 차이 | ✅ | 두 파일의 함수 본문을 `diff`: 다른 곳은 7-4 블록(스킬)뿐. 대상 게임, 원본 복사, champion, 아이템, 룬, 스펠(`summoner1_id <> summoner2_id` 포함), 반환 jsonb 키, 잠금, 오류 코드는 같다. 함수 머리(`SECURITY INVOKER`, `SET search_path FROM CURRENT`), `COMMENT`, `REVOKE` 줄도 같다 |
| RLS | ✅ | 테이블 11개(`schema_migrations` 포함) 모두 RLS 켜짐, 정책 0개 |
| 테이블·뷰 권한 | ✅ | `anon`·`authenticated` 모두 테이블 11개 + `champion_tier_view`에 SELECT/INSERT/UPDATE/DELETE 없음 (`has_table_privilege`) |
| 함수 권한 | ✅ | 함수 4개 모두 `proacl` = `{postgres=X/postgres, service_role=X/postgres}` (PUBLIC 없음), `anon`·`authenticated` EXECUTE false |
| `npm run verify` | ✅ | 7개 파일 통과, 테이블 10개 0 → 0, 샘플 남지 않음 |
| `npm run verify:fresh` | ✅ | 7개 파일 통과, 0 → 0 |
| 직접 만든 시나리오 (C3) | ✅ | 아래 표, 기대값과 모두 같음 |
| 성능 5,000게임 6초 이하 | ✅ | 1.84초 / 1.86초 (통계 정상) |
| 성능 2만 5천 게임 40초 이하 | ⚠️ | 통계 정상 5.1~7.1초 (4회). 통계가 틀리면 3~5분 시간 초과 (3회 모두 재현) → M2 |
| L1 | ✅ | 가짜 URL 4개로 확인 (C5) |
| 계약 `.md`·`.dbml` | ✅ | 서로 같고 DB와 같음. 낡은 "dbml v4" 문구 2줄 고침 (C6) |
| `db_build.md` 기록 | ✅ | 변경 01 절에 기능 / 구현 내용 / 상태, 계약 반영 여부 있음 |
| 검토 후 줄 수 | ✅ | 테이블 10개 모두 0, DB 크기 83MB (측정 중 최대 355MB였다가 autovacuum이 정리) |

### C3. 직접 만든 시나리오 (패치 `0.7`·`0.8`, ROLLBACK)

> 요약: Build 테스트(003, 007)와 다른 문자열·다른 동률 구조로 직접 짰다. 기대값은 실행 전에 손으로 적었고 결과가 모두 같았다.

- 샘플: 패치 `0.7`에 완료 게임 17개(g1~17), 9명만 있는 게임 3개(g18~20), 패치 `0.8`에 완료 게임 1개(g21). A팀 승리 = g 짝수.

| 확인 | 입력 | 기대 | 결과 |
|------|------|------|------|
| 앞 11글자 묶기 | 챔피언 41 TOP: `QWEQQRQWQWR`(11자) g1, `…WWEE`(15자) g2, `…EEWWRWW`(18자) g3, `…Q`(12자) g5 | `QWEQQRQWQWR` 1줄, pick 4 / win 1 | ✅ 4/1 |
| 10자 경계 | 41 TOP g4 `QWEQQRQWQW` | 제외 | ✅ |
| 빈 값·짧은 값 | 41 TOP g6 `''`, g7 `Q`. 챔피언 42 MIDDLE: NULL, `''`, `QWE`, 10자만 | 제외. 42는 `champion` 줄(17판)은 있고 `champion_skill` 0줄 | ✅ |
| 포지션 NULL | 챔피언 44, 포지션 NULL, 11자 문자열 | `champion_skill` 줄 없음 | ✅ |
| 상위 10개·동률 | 챔피언 43 JUNGLE: 서로 다른 앞 11글자 13개 (`EEEEEQQQQ` + 2글자). `RR` 3판(1승), `EW`·`QW` 2판씩(각 1승), 1판짜리 10개(승 5, 패 5). 일부는 뒤에 글자를 더 붙임 | 1 `RR` 3/1 → 2 `EW` 2/1 → 3 `QW` 2/1 (pick·win 같으면 문자열 순) → 4~8 승리 `ER, QQ, RQ, WQ, WW` → 9~10 패배 `EE, EQ`. `QE, RE, WE` 제외 | ✅ 순서까지 같음 |
| 제외 게임 | 9명 게임 3개에서 43 JUNGLE `EEEEEQQQQWR` 모두 승리 (세면 2위가 됨) | `0.7`에 `…WR` 없음, `patch.games` = 17 | ✅ |
| 다른 패치 | `0.8` 게임의 43 JUNGLE `EEEEEQQQQWR` | `0.7`에 없음. `refresh_patch_stats('0.8')`에서만 pick 1 | ✅ |
| 반환값 | - | `0.7` `skill_rows` = 11 (41: 1 + 43: 10) | ✅ |

- 11자보다 긴 원본은 `^[QWER]*$` CHECK 때문에 Q/W/E/R만 있으므로 `left(…, 11)`은 항상 새 CHECK(`^[QWER]{11}$`)를 통과한다. 집계가 CHECK 오류로 실패할 경우는 없다.
- 동률 마지막 키 `skill_order` 정렬은 Q/W/E/R 대문자 4개뿐이라 정렬 규칙(collation)에 따라 바뀌지 않는다.

### C4. 성능: 집계 시간이 크게 흔들리는 원인 (M2)

> 요약: 원인은 **원본 테이블의 통계가 "페이지는 있는데 줄은 0개"로 틀려 있을 때** 플래너가 `matches`·`match_players`를 1줄로 보고 나쁜 Nested Loop를 고르는 것이다. 느린 문장은 함수 맨 앞의 `tmp_games` 만들기(원본 두 테이블 조인)다. 집계 전에 `ANALYZE matches, match_players`를 하면 3회 모두 5.1~7.1초로 안정됐다. 함수 안 임시 테이블만 `ANALYZE`하는 선택지 (b)는 이 문장보다 뒤에 있어서 **고쳐지지 않는다** (직접 시험).

#### 측정 방법

- 스크립트는 scratch 폴더에만 두었다 (저장소에 넣지 않음). 매 실행이 트랜잭션 1개: `BEGIN` → `SET LOCAL statement_timeout` → 샘플 넣기 → (선택) `ANALYZE` → `refresh_patch_stats` → `ROLLBACK`.
- 샘플: 게임당 10줄, 챔피언 160 × 포지션 5, 아이템 70종 + `3340`, 스킬 문자열 14~18자 (80% 실제형 6개, 20% 변형). 2만 5천 게임 결과: `champion_rows` 800, `item_rows` 25,440, `rune_rows` 2,400, `spell_rows` 800, `skill_rows` 2,486. (Build 샘플보다 아이템 조합이 적어 Build 수치보다 조금 빠르다.)
- "나쁜 통계" 재현: 같은 트랜잭션 안에서 `SAVEPOINT` → 2만 5천 게임 넣기 → `ROLLBACK TO SAVEPOINT` → `ANALYZE matches, match_players` (살아 있는 줄 0, 페이지는 있음 → `reltuples = 0`, `relpages > 0`) → 다시 넣기.

#### 결과 (2만 5천 게임, 25만 줄)

| # | 상태 | 집계 직전 `match_players` 통계 | `tmp_games` 실행 계획 | `refresh_patch_stats` |
|---|------|-------------------------------|------------------------|------------------------|
| 1 | 그대로 (자연 발생) | `relpages=6109, reltuples=0` | Nested Loop, `rows=1`, 안쪽 `match_players_pkey` 전체 Index Only Scan (조인 조건이 Join Filter) | **5분 시간 초과** (`tmp_games`와 같은 쿼리에서) |
| 2 | 나쁜 통계 | `relpages=20382, reltuples=0` | 위와 같음 | **3분 시간 초과** |
| 3 | 나쁜 통계 + 선택지 (b) 모의 | `relpages=30572, reltuples=0` | 위와 같음 | **3분 시간 초과**. 오류 위치 = `CREATE TEMP TABLE tmp_games …` (ANALYZE 넣은 곳보다 앞) |
| 4 | 나쁜 통계 + `ANALYZE matches, match_players` (0.45~3.3초) | `reltuples=250000` | Hash Join, `rows=250000` | **7.05초** |
| 5 | 위와 같음 (반복) | `reltuples=250000` | Hash Join | **5.63초** |
| 6 | 그대로 + `ANALYZE` | `reltuples=250000` | Hash Join | **5.10초** |
| 7 | 그대로 (바로 앞 6의 통계가 남음) | `relpages=5096, reltuples=250000` | Hash Join | **5.81초** |

- 5,000게임: 그대로 1.84초, `ANALYZE` 후 1.86초 (`ANALYZE` 0.35초).
- 선택지 (b) 모의 방법: 실제 함수를 바꾸지 않고, 같은 트랜잭션 안에서 `pg_get_functiondef`로 복사본 `pg_temp.refresh_patch_stats_b`를 만들어 `tmp_games`·`tmp_base` 생성 직후에 `ANALYZE`를 넣었다. 트랜잭션과 함께 롤백됐고 남은 함수 0개를 확인했다.

#### 원인 정리

- PostgreSQL은 테이블 줄 수를 `pg_class.reltuples / relpages × 지금 페이지 수`로 어림한다. `reltuples = 0`인데 `relpages > 0`이면 밀도가 0이 되어 1줄로 본다. `relpages = 0`이면 줄 너비로 어림해서 대체로 괜찮다.
- 1번은 자연스럽게 생겼다: 앞선 롤백이 남긴 죽은 줄 때문에 autovacuum이 **내 트랜잭션이 넣는 도중에** 돌아, 아직 커밋 안 된 줄은 세지 않고 페이지만 셌다 (`reltuples=0`, `relpages=6109`). Build가 본 "7초 ~ 5분 초과"의 흔들림이 이것으로 설명된다. 어느 쪽이 나올지는 autovacuum 시점에 달려 있다.
- 실제 운영에서도 같은 상태가 생길 수 있다: `purge_old_patches`로 많이 지운 뒤 vacuum이 줄 수만 줄이고 페이지는 남길 때, 또는 대량 수집 직후 autoanalyze가 아직 돌지 않았을 때. 커밋된 줄만 있으면 위험은 작지만 0은 아니다.
- 측정에서 알게 된 점: 트랜잭션 안의 `ANALYZE`는 `pg_statistic`은 롤백되지만 `pg_class.reltuples`·`relpages`는 롤백되지 않는다 (제자리 갱신). 그래서 7번은 앞 실행의 통계가 남아 빨랐다. 데이터는 바뀌지 않고, 테이블이 비면 다음 vacuum이 0으로 되돌린다 (검토 끝에 `relpages=0, reltuples=0` 확인).

#### 권장 (사용자 결정 필요)

| 선택지 | 효과 | 판단 |
|--------|------|------|
| **★(a) 백엔드가 집계 직전에 `ANALYZE matches, match_players` 실행** | 시험 4·5·6에서 나쁜 통계도 바로잡음. 비용 0.35~3.3초 | **추천.** 원인(원본 통계)을 직접 고친다. 수집을 마친 백엔드가 "대량으로 넣었다"는 것을 알고 있다. `!백엔드` 범위이며, 백엔드가 읽는 DB 계약 9장에 "집계 전에 `ANALYZE matches, match_players`" 규칙을 적어야 하므로 다음 `!db` 변경으로 계약에 한 줄 추가를 제안 |
| (b) 새 마이그레이션에서 함수 안 `tmp_games`·`tmp_base` 생성 뒤 `ANALYZE` | 시험 3에서 **효과 없음**. 느린 문장이 `tmp_games` 생성 자체(원본 조인)이기 때문 | 비추천 (적용하지 않음) |
| (b') 새 마이그레이션에서 함수 맨 앞에 `ANALYZE matches, match_players` | (a)와 같은 효과가 예상됨. 모든 집계 호출마다 0.35~3.3초 추가. 함수는 `SECURITY INVOKER`라 호출 역할이 테이블 주인이어야 함 | 백엔드를 믿지 않고 DB 안에서 보장하고 싶을 때의 대안. 적용하지 않음 (사용자 승인 필요) |

- 덧붙여 백엔드는 지난 M1 권장대로 집계 호출 연결에 `SET statement_timeout`을 넉넉히(예: 5분) 둔다. 통계가 맞으면 2만 5천 게임 약 5~7초라 2분 기본값으로도 여유가 17배 이상이다.

### C5. L1 확인 (가짜 URL만 사용)

> 요약: 4가지 가짜 URL에서 사용자 이름·비밀번호(원문·디코딩 형태)·호스트가 모두 `***`로 가려졌다. 실제 `DATABASE_URL`은 쓰지 않았다 (`env -u DATABASE_URL`로 지우고 가짜 값만 넣음).

| 가짜 URL 형태 | 결과 |
|---------------|------|
| 비밀번호에 잘못된 `%` (`tester` / `Fa%zzPw999` / `nonexistent-host.invalid`) | 사용자 이름·비밀번호·호스트 `***`. 실제 `connect()` 오류도 `getaddrinfo ENOTFOUND ***` |
| 사용자 이름에 잘못된 `%`, 비밀번호 정상 인코딩 (`us%zzer` / `Pw%40good99`) | 사용자 이름, 비밀번호 원문·디코딩(`Pw@good99`), 호스트 모두 `***` |
| 둘 다 정상 인코딩 (`us%40er` / `p%40ssword9`) | 원문·디코딩 4개와 호스트 `***` |
| URL이 아닌 문자열 | 문자열 전체만 가림, 다른 글자는 그대로 (오류 없음) |

- 다른 URL의 값은 가려지지 않는 것을 같이 확인해, 가림이 그 URL의 값에만 맞춰 동작함을 봤다.

### C6. 계약 일치와 Review가 고친 것

> 요약: `.md`와 `.dbml`의 `champion_skill`(컬럼·PK·설명·상위 10개)이 서로 같고 실제 DB와 같다. Build가 남긴 낡은 "dbml v4" 문구 2줄은 v5 내용을 가리키는 줄이라 고쳤다 (문구만, 규칙 변화 없음).

| 위치 | 판단 | 수정 |
|------|------|------|
| 4장 요약 "dbml v4를 Mermaid로 옮긴 그림" | ERD 그림은 이미 v5(`skill_order`)라 문구가 틀림 | "dbml v5를 Mermaid로 옮긴 그림"으로 고침 |
| 10장 7번 "스키마: dbml v4 (원본 3, 집계 6, 운영 1)" | 지금 기준은 v5. 테이블 구성은 같음 | "dbml v5 (원본 3, 집계 6, 운영 1. 테이블 구성은 v4와 같음)"으로 고침 |
| 머리말 "v3 → v4 변경 요약" 표의 "dbml v4" | 지난 변경 기록 | 그대로 둠 |

- 계약 일치 확인: dbml `champion_skill` 블록 = 컬럼 6개, `skill_order text [not null]`, PK `(patch, champion_id, position, skill_order)`, Ref CASCADE. `.md` 2장·4장 ERD·9-2·10장 11번과 같고, 실제 DB(C2)와 같다. 9-1 함수 목록에 `skill_priority` 없음, 실제 DB 함수 4개와 같다. 9-2 `champion_spell`에 같은 번호 제외(C4) 문구 있음.
- 마이그레이션 010: 결과가 틀린 결함이 없어 만들지 않았다.

### C7. 이슈

| # | 등급 | 내용 | 권장 |
|---|------|------|------|
| M2 | Medium | 원본 통계가 `reltuples=0, relpages>0`이면 `tmp_games` 단계가 Nested Loop가 되어 2만 5천 게임 집계가 3~5분을 넘긴다 (3회 모두 재현). 006부터 있던 문제이고 009와 무관. 운영에서는 대량 삭제·수집 직후에 생길 수 있다 | (a) 백엔드가 집계 전에 `ANALYZE matches, match_players`. 다음 `!db` 변경으로 계약 9장에 이 규칙 추가 (사용자 승인 필요). (b)는 효과 없음 |
| L5 | Low | 계약 `.md`·`.dbml`에 `champion_skill.skill_order`의 CHECK(`^[QWER]{11}$`)가 직접 적혀 있지 않다 ("앞 11레벨", 예시로만 설명). 집계 함수만 쓰는 테이블이라 백엔드 동작에는 영향 없음 | 다음 계약 수정 때 9-2 또는 2장에 형식 한 줄 추가 |
| 참고 | - | 알려진 한계(spec 01-8): 11레벨 전에 끝난 게임은 스킬 집계에서 빠진다. 첫 실제 수집 뒤 포지션별 `length(skill_order) < 11` 비율을 잰다 | 그대로 |
| 참고 | - | 2만 5천 게임 롤백 측정은 1회에 약 40MB(나쁜 통계 재현은 약 80MB)의 죽은 줄을 남긴다. 이번 검토 중 DB가 최대 355MB(무료 플랜 500MB)까지 올라갔다가 autovacuum 뒤 83MB가 됐다 | 큰 측정은 한 번에 1~2회만 하고 autovacuum이 정리한 뒤 다음을 잰다 |

### C8. Build 기록 반영

- 함수·테스트·스크립트는 고친 것이 없다. 계약 문구 2줄을 고친 것만 `db_build.md` 변경 01-6 남은 문제 2에 "Review에서 반영"으로 적었다.

---

## 변경 02 검토 (2026-10-14): 테스트 수집 범위(플래티넘~다이아)와 집계 전 ANALYZE

- 작성: Review 서브에이전트 (2026-10-14). Build 보고를 믿지 않고 실제 DB를 직접 조회·실행해 확인했다.
- 기준: `db/docs/db_spec.md` 변경 02 (승인됨, D10 = (a) 백엔드 `ANALYZE`, D11 아이언~골드 제외, D12 전환 때 결정), `db/docs/db_build.md` 변경 02, 계약 v6 (`db_contract.md`, `db_contract.dbml`)
- 대상: Supabase PostgreSQL 17, Session pooler
- **모든 샘플은 ROLLBACK 되는 트랜잭션 안에서만 실행했다.** 검토 전·후 테이블 10개 모두 0줄, `schema_migrations` 10줄, DB 크기 83MB.

### R1. 종합 판정

> 요약: **PASS.** 010은 승인안 그대로이고 실제 DB의 CHECK·주석·함수·보안이 계약 v6과 같다. 결함은 없다. 5,000게임에서도 나쁜 통계면 집계가 2분을 넘는 것을 새로 확인해, 9-4 규칙이 테스트 수집 규모에서도 꼭 필요하다는 점을 Low로 남긴다.

| 구분 | 결과 |
|------|------|
| 판정 | **PASS** |
| Critical / High / Medium | 0 / 0 / 0 |
| Low | 1 (L6: 9-4 규칙이 2만 5천 게임 수치만 들고 있어 테스트 규모에서는 생략해도 되는 것처럼 읽힐 수 있음) |
| Review에서 고친 것 | 계약 `.md` 문구 2줄 (R5). 마이그레이션 011 만들지 않음 |
| 실제 데이터 | 검토 전·후 모든 테이블 0줄 |

### R2. 체크리스트

> 요약: spec 02-6 완료 기준을 하나씩 직접 확인했다. 숫자는 모두 이번 검토에서 조회·실행한 값이다.

| 항목 | 결과 | 근거 |
|------|------|------|
| `migrate:status` | ✅ | 001~010 "적용됨", 체크섬 불일치 없음. 파일 sha256 앞 16자리가 `schema_migrations.checksum`과 10개 모두 같음 (001~009 파일 바뀌지 않음) |
| `migrate:fresh-check` | ✅ | 10개 파일 통과, 임시 스키마 테이블 10 · 뷰 1 · 함수 4, `migration_check` 남지 않음 |
| `ranked_players_tier_check` | ✅ | `CHECK ((tier = ANY (ARRAY['PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'])))`, `convalidated = true`. 같은 테이블 CHECK는 `rank_check`·`tier_check` 2개뿐 |
| 주석 | ✅ | `obj_description`·`col_description(tier)`이 010 파일의 두 문구와 문자열 비교로 정확히 같음 |
| 직접 시험 (R3) | ✅ | 허용 6개 저장, 대소문자 섞인 값·공백·낮은 티어 등 16개 거부 |
| 기존 줄이 있을 때 교체 (R3) | ✅ | 실제 테이블 dry run과 임시 스키마 모두 `convalidated = true` |
| `refresh_patch_stats` md5 (D10 = (a)) | ✅ | `md5(prosrc)` = `c4740067177eeb20705db20dd308ed07` (변경 01 검토 값과 같음). 다른 함수 3개 md5도 변경 01 때와 같은 본문 |
| RLS | ✅ | 테이블 11개(`schema_migrations` 포함) 모두 RLS 켜짐, FORCE 아님, 정책 0개 |
| 테이블·뷰 권한 | ✅ | `relacl` = `{postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres}` 12개 모두. `anon`·`authenticated` SELECT/INSERT/UPDATE/DELETE false |
| 함수 권한 | ✅ | 함수 4개 `proacl` = `{postgres=X/postgres, service_role=X/postgres}`, `anon`·`authenticated` EXECUTE false. `SECURITY INVOKER`, `search_path=public, pg_catalog` |
| 기본 권한 (L2) | - | `pg_default_acl`은 변경 01 때와 같음 (L2 그대로, 010은 새 객체를 만들지 않아 영향 없음) |
| `npm run verify` | ✅ | 8개 파일 통과 (008 38ms), 테이블 10개 0 → 0, 샘플 남지 않음 |
| `npm run verify:fresh` | ✅ | 8개 파일 통과 (008 211ms), 0 → 0 |
| 5,000게임 재현 (권장, R4) | ✅ | 나쁜 통계 + `ANALYZE` → 집계 1.64초. 대조(`ANALYZE` 없음)는 2분 시간 초과 |
| 계약 `.md`·`.dbml`·DB (R5) | ✅ | 02-3 표 항목 모두 반영. dbml 컬럼 93개(이름·타입·NOT NULL)와 PK 10개가 실제 DB와 같음, FK 7개 = Ref 7개. 낡은 "dbml v5" 문구 2줄 고침 |
| dbml 파싱 | ✅ | `@dbml/core` 10.3.1 `dbmlv2` 파서: 테이블 10, Ref 7, 그룹 3. `skill_order` 메모가 `CHECK skill_order ~ '^[QWER]{11}$'`로 나옴 |
| `db_build.md` 기록 | ✅ | 변경 02 절에 기능 / 구현 내용 / 상태, 계약 반영 여부 있음. Review 반영 2줄 추가 (R7) |
| 검토 후 줄 수 | ✅ | 테이블 10개 모두 0, DB 83MB (측정 직후 115MB였다가 autovacuum이 정리) |

### R3. 직접 만든 시험 (모두 ROLLBACK)

> 요약: 008 테스트와 다른 값으로 허용·거부를 확인했다. 기존 줄이 있는 상태에서 010을 다시 실행해도 CHECK가 검증된 상태로 만들어지고, 허용 밖 줄이 있으면 010 전체가 실패해 예전 CHECK가 남는 것도 확인했다.

#### 허용·거부 (실제 `ranked_players`, 줄마다 SAVEPOINT)

| 값 | 결과 |
|----|------|
| `PLATINUM`, `EMERALD`, `DIAMOND`, `MASTER`, `GRANDMASTER`, `CHALLENGER` | 저장 (6개) |
| 대소문자 섞임: `Platinum`, `PlAtInUm`, `platinum`, `emerald`, `Diamond`, `master` | 23514 거부 (6개) |
| 앞·뒤 공백, 줄바꿈: `' PLATINUM'`, `'PLATINUM '`, `'PLATINUM\n'` | 23514 거부 (3개) |
| 비슷한 글자 `PLATlNUM`(소문자 L), `UNRANKED`, `''` | 23514 거부 (3개) |
| `IRON`, `BRONZE`, `SILVER`, `GOLD` (D11) | 23514 거부 (4개) |
| `NULL` | 23502 거부 (NOT NULL) |
| `PLATINUM` + `rank` `V` / `iv` | 23514 거부 (`rank_check`는 그대로) |

- CHECK는 정확한 문자열 비교라 대소문자·공백을 고쳐 주지 않는다. Riot 응답은 대문자이므로 백엔드는 값을 그대로 넣으면 되고, 직접 바꾸지 않아야 한다.

#### 기존 줄이 있을 때 010 교체

| 시나리오 | 결과 |
|----------|------|
| 실제 테이블 dry run: `EMERALD`·`MASTER`·`PLATINUM` 3줄 + `PLATINUM` 표본을 참조하는 `matches` 1줄을 넣고 010 파일 전체 다시 실행 | 성공. `tier_check` `convalidated = true`, CHECK 2개, 3줄 그대로. ROLLBACK 후 0줄 |
| 임시 스키마 `rv02_check`에 001 적용 (예전 CHECK) + `EMERALD`·`CHALLENGER` 2줄 | 예전 CHECK에서 `PLATINUM` 23514 거부 |
| 같은 스키마에 010 적용 | 성공, `convalidated = true`. 그 뒤 `PLATINUM` 저장, `GOLD` 거부 |
| 허용 밖 줄(`GOLD`)이 이미 있는 상태에서 010 실행 | 23514로 010 실패. SAVEPOINT 롤백 뒤 예전 CHECK가 그대로 남음 (DROP만 되고 끝나는 일 없음) |
| 정리 | `rv02_check` 스키마 남지 않음, 실제 `ranked_players` 0줄 |

- 허용 값을 늘리는 변경이라 기존 줄은 항상 통과한다. 반대로 나중에 허용 값을 줄이는 마이그레이션(예: 본 수집 전환 때 `PLATINUM` 빼기)은 `PLATINUM` 줄이 남아 있으면 실패한다. D12 결정 때 이 순서(데이터 처리 → CHECK 변경)를 같이 정해야 한다.

### R4. 5,000게임 재현: 나쁜 통계 → ANALYZE → 집계 (ROLLBACK 1회 + 대조 1회)

> 요약: 계약 9-4 순서대로 하면 5,000게임 집계가 1.64초다. 같은 나쁜 통계에서 `ANALYZE`를 빼면 **5,000게임에서도 2분 시간 초과**였다. 즉 테스트 수집(약 2,700게임) 규모에서도 9-4 규칙을 빼면 안 된다.

- 방법: 변경 01 검토(C4)와 같은 scratch 스크립트. 트랜잭션 1개 안에서 5,000게임 넣기 → `SAVEPOINT` 롤백 → `ANALYZE` (페이지는 있고 줄은 0) → 다시 5,000게임 넣기 → (9-4) `ANALYZE matches, match_players` → `refresh_patch_stats('0.9')` → `ROLLBACK`.

| # | 집계 직전 `match_players` 통계 | `tmp_games` 실행 계획 | `ANALYZE` | `refresh_patch_stats` |
|---|-------------------------------|------------------------|-----------|------------------------|
| 1 (9-4대로) | 나쁜 상태 `relpages=1014, reltuples=0` → `ANALYZE` 후 `relpages=2027, reltuples=50000` | Hash Join, `rows=50000` | 0.34초 | **1.64초**. `games` 5,000, `champion_rows` 800, `item_rows` 25,440, `rune_rows` 2,400, `spell_rows` 800, `skill_rows` 2,486 |
| 2 (대조, `ANALYZE` 없음) | `relpages=3040, reltuples=0` | Nested Loop, `rows=1`, 안쪽 `match_players_pkey` Index Only Scan, 조인 조건이 Join Filter | - | **120초 시간 초과** (`CREATE TEMP TABLE tmp_games …`에서) |

- 결과는 변경 01 검토의 5,000게임 수치(통계 정상 1.84초, `ANALYZE` 0.35초)와 같은 범위다. 함수가 바뀌지 않았다는 md5 결과와도 맞다.
- 측정 뒤: 두 실행 모두 ROLLBACK, 줄 수 0. 죽은 줄 `match_players` 20만·`matches` 1만이 남아 DB가 115MB까지 올랐고, 약 3분 뒤 autovacuum이 정리해 `relpages=0, reltuples=0`, 83MB로 돌아왔다.
- 관찰: 측정 직후 실제 DB가 3분 동안 정확히 "페이지는 있는데 줄은 0개" 상태로 남아 있었다. 운영에서도 대량 삭제(`purge_old_patches`)나 롤백 직후 이 상태가 저절로 생긴다는 근거가 하나 더 생겼다.

### R5. 계약 일치와 Review가 고친 것

> 요약: `.md`·`.dbml`·실제 DB가 서로 같다. Build가 남긴 낡은 "dbml v5" 문구 2줄을 v6으로 고쳤다 (문구만, 규칙 변화 없음).

| 확인 | 결과 |
|------|------|
| 테스트 / 본 수집 구분 | `.md` 1장 요약, 1-1 "티어" 줄, 1-3, 2장, 5장 ①, 10장 2번과 `.dbml` `ranked_players` 메모가 같은 내용: 테스트 = 플래티넘·에메랄드·다이아 각 50명(디비전 I~IV 고르게), 본 수집 = 에메랄드 이상 4 : 4 : 2 (테스트 뒤 다시 정함) |
| `tier` 허용 값 | `.md` 1-1 아래 줄·4장 ERD `PLATINUM ~ CHALLENGER`, `.dbml` `tier` 메모 6개, 실제 CHECK 6개가 같음 |
| 9-4 `ANALYZE` 규칙 | `.md` 머리말 v5 → v6 표, 5장 ⑥, 7장 "집계 호출" 줄, 9장 요약, 9-4 표, 10장 12번, `.dbml` 집계 호출 규칙 주석이 같은 순서(`ANALYZE matches, match_players` → `refresh_patch_stats`)를 말함. 9-4 메모의 "트랜잭션 안에서 가능"은 R4 1번에서 실제로 맞음 (같은 트랜잭션에서 아직 커밋하지 않은 줄도 세어 `reltuples=50000`) |
| L5 CHECK 문구 | `.md` 9-2 `champion_skill_skill_order_check`: `skill_order ~ '^[QWER]{11}$'`, 4장 ERD `"^[QWER]{11}$, EQQWQRQEQER"`, `.dbml` 메모, 실제 DB `CHECK ((skill_order ~ '^[QWER]{11}$'::text))`가 같음 |
| dbml ↔ DB | 컬럼 93개 이름·타입·NOT NULL, PK 10개 일치 (`int` = `integer`). FK 7개 = Ref 7개 |

| 위치 | 판단 | 수정 |
|------|------|------|
| `.md` 4장 요약 "dbml v5를 Mermaid로 옮긴 그림이다." | ERD 그림은 이미 v6(`PLATINUM ~ CHALLENGER`, `skill_order` CHECK) | "dbml v6을 Mermaid로 옮긴 그림이다."로 고침 |
| `.md` 10장 7번 "dbml v5 (원본 3, 집계 6, 운영 1. 테이블 구성은 v4와 같음)" | 지금 기준은 v6. 테이블 구성은 v4·v5와 같음 | "dbml v6 (원본 3, 집계 6, 운영 1. 테이블 구성은 v4·v5와 같음)"으로 고침 |
| `.md` 머리말 "v3 → v4 변경" 표의 "dbml v4" | 지난 변경 기록 | 그대로 둠 |

- 마이그레이션 011: 결과가 틀린 결함이 없어 만들지 않았다.

### R6. 이슈 (심각도 순)

| # | 등급 | 내용 | 권장 |
|---|------|------|------|
| L6 | Low | 계약 9-4는 "2만 5천 게임에서 3~5분"만 근거로 들어, 테스트 수집(약 2,700게임)에서는 `ANALYZE`를 빼도 되는 것처럼 읽힐 수 있다. R4에서 5,000게임도 나쁜 통계면 2분을 넘겼다. 규칙 자체(항상 `ANALYZE` 먼저)는 맞으므로 동작 문제는 아니다 | `!백엔드` Plan에서 게임 수와 관계없이 집계 전 `ANALYZE`를 항상 실행하도록 정한다. 다음 계약 수정 때 9-4 이유 칸에 "5,000게임도 2분 초과 → 1.6초" 한 줄 추가 (이번 Review 수정 범위 밖이라 고치지 않음) |
| 참고 | - | L2(기본 권한)는 그대로다. 010은 새 객체가 없어 영향이 없다 | 변경 없음 |
| 참고 | - | D12: 본 수집 전환 때 `PLATINUM`을 허용 값에서 빼려면 `PLATINUM` 줄을 먼저 처리해야 CHECK 변경이 성공한다 (R3). 처리는 삭제 SQL이라 사용자 승인 대상 | D12 결정 때 순서를 같이 정한다 |
| 참고 | - | 롤백 측정 1회(5,000게임 × 2번 넣기)는 약 30MB의 죽은 줄을 남기고, autovacuum이 약 3분 뒤 정리했다 | 큰 측정은 그대로 1~2회만 |

### R7. Build 기록 반영

- 함수·테스트·마이그레이션은 고친 것이 없다. `db_build.md` 변경 02의 02-5 남은 문제 1(계약 문구 v5)과 3(5,000게임 재현)에 "Review에서 반영"을 적었다.

## 변경 03 검토 (2026-10-14): 패치 기준 → 최근 14일 기준

- 작성: Review 서브에이전트 (2026-10-14). Build 보고를 믿지 않고 실제 DB를 직접 조회·실행해 확인했다.
- 기준: `db/docs/db_spec.md` 변경 03 (승인됨, D13~D23, 되돌릴 수 없는 작업 1~4·6·7), `db/docs/db_build.md` 변경 03 (편차 1 포함), 계약 v7 (`db_contract.md`, `db_contract.dbml`)
- 대상: Supabase PostgreSQL 17.11, Session pooler, 접속 계정 `postgres`(superuser 아님)
- **모든 샘플은 ROLLBACK 되는 트랜잭션 안에서만 실행했다.** 검토 전·후 줄 수 `matches` 0, `match_players` 0, `ranked_players` 3, `collection_logs` 3, 집계 7개 0. `cron.job` 1줄(jobid 1) 그대로.
- 검토용 스크립트는 scratchpad에만 두었다 (저장소에 넣지 않음).

### 03R-1. 종합 판정

> 요약: **PASS.** 실제 DB 구조·함수·뷰·권한·예약 작업이 계약 v7·마이그레이션 파일과 같고, 직접 만든 롤백 시험 6개와 두 연결 잠금 시험이 모두 기대대로 나왔다. 정확성 결함이 없어 016은 만들지 않았다. 편차 1(pg_cron 기본 `PUBLIC` 권한)은 `anon`·`authenticated`가 실제로 호출·조회할 수 없음을 `SET ROLE`로 확인했고, **기본값 유지**를 권한다.

| 구분 | 결과 |
|------|------|
| 판정 | **PASS** |
| Critical / High / Medium | 0 / 0 / 0 |
| Low | 6 (03R-6) |
| Review에서 고친 것 | 계약 `.md` 9장 요약 문구 1줄 (03R-7). 마이그레이션 016 만들지 않음 |
| 예약 작업 첫 실행 | ⚠️ 아직 없음 (검토 시각 2026-10-14 11:36 UTC). 다음 확인: 2026-10-14 20:00 UTC 뒤 `cron.job_run_details` (P0002 `failed`가 정상) |

### 03R-2. 체크리스트

> 요약: spec 03-8 완료 기준을 하나씩 직접 확인했다. 숫자는 모두 이번 검토에서 조회·실행한 값이다.

| 항목 | 결과 | 근거 |
|------|------|------|
| 사용자 승인 기록 | ✅ | `db_build.md` 변경 03 머리말에 1~4·6·7 승인, 5번(purge 실행) 하지 않음 |
| `migrate:status` | ✅ | 001~015 "적용됨" (011~015 2026-10-14 11:24 UTC), 체크섬 불일치 없음. `git diff db/migrations/` 출력 없음 (001~010 안 바뀜) |
| `migrate:fresh-check` | ✅ | 15개 파일 통과, 임시 스키마 테이블 11·뷰 1·함수 4, `migration_check` 남지 않음 |
| `verify` / `verify:fresh` | ✅ | 둘 다 10개 파일 통과 (001~004, 006~011). 검증 전·후 11개 테이블 줄 수 같음, 샘플 남지 않음 |
| 줄 수 | ✅ | `matches` 0, `match_players` 0, `ranked_players` 3, `collection_logs` 3, `stats_window`·`stats_window_patch`·집계 5개 0 |
| `matches.game_start_at` | ✅ | `timestamp with time zone`, NOT NULL, 기본값 없음. `matches_game_start_at_check` = `CHECK ((game_start_at >= '2020-01-01 00:00:00+00'::timestamp with time zone))`. 주석에 `info.gameStartTimestamp` |
| 옛 객체 없음 | ✅ | `to_regclass('public.patch')`, `to_regprocedure('refresh_patch_stats(text)')`, `to_regprocedure('purge_old_patches(integer)')` 모두 NULL. public 함수는 4개뿐 |
| `stats_window` | ✅ | `id smallint DEFAULT 1`, `days int`, `window_start`·`window_end timestamptz`, `games int`, `aggregated_at timestamptz DEFAULT now()`, 모두 NOT NULL. PK `(id)`, CHECK `id = 1`, `days 1~60`, `window_start < window_end`, `games > 0` (이름 03-3-1과 같음) |
| `stats_window_patch` | ✅ | `patch text`, `games int` NOT NULL, PK `(patch)`, CHECK `^[0-9]+\.[0-9]+$`, `games > 0` |
| 집계 5개 | ✅ | `patch` 컬럼 없음. PK `champion (champion_id, position)`, `champion_item (…, item_id)`, `champion_spell (…, spell1_id, spell2_id)`, `champion_skill (…, skill_order)`, `champion_rune (id)` identity ALWAYS + `champion_rune_page_key` UNIQUE 13개 컬럼. 상세 4개 FK `(champion_id, position) → champion ON DELETE CASCADE`. CHECK 21개가 002·009와 같음 |
| 인덱스 | ✅ | PK·UNIQUE 인덱스 + `match_players_champion_id_team_position_idx`만. `matches.game_start_at` 인덱스 없음 (D21, 계약 8장과 같음) |
| 함수 본문 md5 | ✅ | 롤백 트랜잭션 안 임시 스키마에 001~014를 적용해 비교. `refresh_window_stats` `baec482d…`, `purge_old_games` `6e63b2ad…`, `patch_sort_key` `b98dc8d6…`, `tier_from_score` `b6079ba3…` 4개 모두 실제 DB와 같음 |
| 함수 시그니처 | ✅ | `refresh_window_stats(p_days integer DEFAULT 14, p_until timestamp with time zone DEFAULT now()) → jsonb`, `purge_old_games(p_keep_days integer DEFAULT 21) → integer`. 모두 `prosecdef = false`, `search_path=public, pg_catalog`, VOLATILE |
| 뷰 | ✅ | `pg_get_viewdef` md5가 014 적용 결과와 같음 (`f1920fa1…`), `reloptions = {security_invoker=true}`, 컬럼 12개(`patch` 없음). 분모는 R1·R4에서 확인 |
| RLS | ✅ | public 테이블 12개(`schema_migrations` 포함) RLS 켜짐, FORCE 아님, `pg_policies` public 0개 |
| 권한 | ✅ | 테이블·뷰 `relacl` = `{postgres=…, service_role=…}`, 시퀀스 2개 같음, 함수 4개 `proacl` = `{postgres=X, service_role=X}` (`PUBLIC`·`anon`·`authenticated` 없음). `SET ROLE anon/authenticated`로 `stats_window`·뷰 SELECT, 함수 3개 호출 모두 42501 |
| 006 자동 검사 | ✅ | NOTICE "테이블 12, 뷰 1, 시퀀스 2, 함수 4" = spec 기대값. 손 목록이 아닌 `current_schema()` 전체 순회 |
| 직접 시험 (03R-3) | ✅ | R1~R6 모두 통과 |
| 두 연결 잠금 | ✅ | 03R-3 R7 |
| 5,000게임 측정 | ✅ | 03R-4 |
| 예약 작업 | ✅ / ⚠️ | 03R-5. 첫 실행 기록은 아직 없음 |
| 계약 v7 | ✅ | `.dbml`이 `dbmlv2`로 파싱됨: 테이블 11, Ref 6(상세 4개는 `(champion_id, position)` cascade), TableGroup 원본 3·집계 7·운영 1. 컬럼·타입·NOT NULL·기본값·PK·UNIQUE가 실제 DB와 같음. `.md`에 `refresh_patch_stats`·`purge_old_patches`·"각 50명"이 v6→v7 변경표 밖에 남지 않음. 9장 요약 문구 1줄만 고침 (03R-7) |

### 03R-3. 직접 만든 롤백 시나리오

> 요약: Build 테스트와 다른 시각·값으로 창 경계, 패치 구성, 상위 N, 밴, 0게임, 재집계, purge를 다시 확인했다. 모두 기대대로다.

- 방법: 시나리오마다 `BEGIN` → 임시 함수 `pg_temp.add_game`(게임 1개 + 참가자 N줄) → 확인 → `ROLLBACK`. 샘플 시각은 2021년(R6만 `now()` 기준), ID는 `KR_97…`.

| # | 시나리오 | 결과 |
|---|----------|------|
| R1 | `p_until = 2021-03-01 12:00+00`, 14일 → 창 `[2021-02-15 12:00, 2021-03-01 12:00)`. 시작 정확히 / 시작 − 1µs / 끝 − 1µs / 끝 정확히 / 미래 / 9줄 | ✅ 시작 정확히·끝 − 1µs만 포함, games 2. `p_days` 0·61·NULL, `p_until` NULL·`now() + 1µs` → 22023. `p_days = 60` 허용(games 3). `p_until = now()` 허용(실데이터 0게임 → P0002). 인자 오류 뒤 기존 스냅숏 그대로 |
| R2 | 패치 `16.10` 5게임, `16.9` 3, `15.24` 2 + 창 밖 `16.11`, 8줄 `16.12` | ✅ 구성 `16.10:5, 16.9:3, 15.24:2`, 합계 10 = `stats_window.games`. 반환 `patches`가 숫자 순(`16.10` > `16.9`) |
| R3 | 챔피언 900 TOP 30게임, 변형 12개(1~6은 3판, 7~12는 2판, 짝수 게임 승) | ✅ 룬·스펠·스킬 각 10개. 2판 동률은 승 많은 8·10·12 → 그다음 조합 키 오름차순(룬·스펠은 7, 스킬은 문자열이 가장 작은 `…EE`). 스킬은 14자 → 앞 11자. 아이템 13줄(전부), 한 줄 안 2번 나온 3100은 pick 30·win 15 (1번만 셈) |
| R4 | 챔피언 41: 게임 1에서 두 명이 밴, 게임 2에서 한 명, 창 밖 게임에서 10명, 9줄 게임에서 1명 | ✅ `ban = 2`. 픽 없이 밴만 된 999는 `champion` 줄 없음(계약 9-2 한계와 같음). 뷰 `ban_rate` 66.67 = 2/3 |
| R5 | 스냅숏(11.1·11.2) 만든 뒤 0게임 창 / 다른 창(11.3)으로 다시 집계 | ✅ 0게임 → P0002, `stats_window` 행 전체·구성·`champion`이 그대로. 재집계 뒤 7개 테이블 모두 교체(11.3만, 이전 챔피언 상세 0줄) |
| R6 | `now() − 21일` 정확히 / `− 21일 − 1µs` / `− 14일` / 2021년 | ✅ `purge_old_games(21)` = 2 (= 호출 전 같은 트랜잭션에서 센 수), 정확히 21일은 남음, CASCADE, 집계·`ranked_players`·`collection_logs` 그대로, 두 번째 0. 13·NULL → 22023, `stats_window.days = 20`일 때 19 → 22023. `purge_old_games(14)`도 허용되고 정확히 14일 게임은 남음 |
| R7 | 두 연결: A가 `refresh_window_stats`를 마치고 커밋 전 / B가 같은 함수 호출 | ✅ 1.5초 뒤 B는 `wait_event = advisory`, `pg_locks` advisory `ExclusiveLock granted = false`. A `ROLLBACK` 직후 B가 진행해 P0002(A의 샘플이 롤백돼 0게임). 차례 실행 확인 |

- 참고: 롤백해도 `champion_rune_id_seq`는 되돌아가지 않는다 (검토 뒤 `last_value` 5067). bigint라 문제없다.

### 03R-4. 성능: 5,000게임 (ROLLBACK 2회)

> 요약: 9-4 순서(`ANALYZE` → 집계)로 5,000게임 집계가 **1.14초**(아이템 줄 1만 1천)였다. 변경 02 R4의 1.64초, 변경 01의 1.84초와 같은 범위이고, 창 거르기 추가로 느려지지 않았다. 아이템 종류를 일부러 크게 늘린 시험(아이템 줄 10만)은 4.2초였다.

- 데이터: 창 안 5,000게임(2021-01-01부터 241초 간격, 패치 0.8 40% / 0.9 60%) + 창 밖 500게임, 참가자 5만 5천 줄, 챔피언 160 × 포지션 5. 실행 계획: `tmp_games`는 Hash Join + HashAggregate (`rows=49510`), Nested Loop 아님.

| # | 아이템 분포 | `ANALYZE` | `refresh_window_stats(14, '2021-01-15+00')` | 결과 줄 수 |
|---|-------------|-----------|---------------------------------------------|-----------|
| 1 | 칸마다 150종 무작위 (과장) | 0.43초 | **4.17초**, 같은 트랜잭션 재집계 4.49초 | champion 800, item 106,329, rune 1,600, spell 800, skill 1,600 |
| 2 | 챔피언마다 약 12종 (현실적, 변경 02 R4의 25,440줄보다 적음) | 0.35초 | **1.14초** | champion 800, item 11,200, rune 1,600, spell 800, skill 1,600 |

- 두 실행 모두 `stats_window_patch` 합계 = games 5,000, 구성 `0.9:3000, 0.8:2000`, 챔피언 × 포지션당 룬 줄 최대 2 (변형 수만큼).
- 시간은 아이템 줄 수에 가장 크게 좌우된다 (db_review M2와 같은 관찰). 25,000게임에서도 5분 시간 제한까지 여유가 크다.
- 죽은 줄과 용량: 측정 전 70MB → 트랜잭션 안 최대 116MB → 1회 ROLLBACK 뒤 98MB(죽은 줄 `match_players` 5.5만, `champion_item` 21만, `matches` 5,500 등), 2회 뒤 108MB → 약 2분 뒤 autovacuum 정리로 **77MB**. 무료 플랜 500MB에 영향 없음. 큰 측정은 2회로 끝냈다 (C7).

### 03R-5. 예약 작업과 권한 (편차 1 판단)

> 요약: 작업 행은 spec 그대로다. `anon`·`authenticated`는 `cron` 스키마 USAGE가 없어 `cron.schedule`·`unschedule` 호출과 `cron.job` 조회가 모두 42501로 막힌다. `PUBLIC` EXECUTE는 실제로 쓸 수 없는 권한이고, `postgres`가 회수할 수도 없어 **기본값 유지**를 권한다.

작업 상태:

| 항목 | 값 |
|------|----|
| `cron.job` | 1줄: jobid 1, `tiergg_daily_refresh`, `0 20 * * *`, `active = true`, `username postgres`, `database postgres`, `nodename localhost` |
| `command` | `SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);` (015와 같음) |
| 설정 | `cron.timezone = GMT`, `cron.use_background_workers = off`(localhost 접속), `cron.log_run = on`, `pg_cron launcher` 프로세스 실행 중 |
| 롤백 1회 실행 | 같은 명령을 `BEGIN` 안에서 실행 → **P0002** (`2026-09-30 11:35:57 ~ 2026-10-14 11:35:57 에 완료된 게임(10줄)이 없습니다`). `ROLLBACK` 뒤 `stats_window` 0줄, `statement_timeout`도 원래 값(2min)으로 돌아옴 |
| `cron.job_run_details` | 0줄 (첫 실행 2026-10-14 20:00 UTC 전) |

실패가 보이는 곳:

- `cron.job_run_details`: 실행마다 1줄, `status`(`succeeded`/`failed`)와 `return_message`(오류 문장). 확인 SQL은 spec 03-11 "실패 확인". Supabase 대시보드 Integrations → Cron에서도 같은 기록을 본다.
- `stats_window.aggregated_at`: 성공한 마지막 집계 시각. 하루를 크게 넘으면 멈춘 것이다 (백엔드가 `window.aggregatedAt`으로 내보낼 예정, spec 03-7).
- **알림은 없다.** 누군가 위 두 곳을 봐야 안다 (L7).
- 실패하면 명령 전체가 한 트랜잭션으로 롤백되어 기존 스냅숏이 남는다 (R5와 롤백 실행으로 확인).

편차 1 독립 판단:

| 확인 | 결과 |
|------|------|
| 카탈로그 | `cron.schedule(text,text)`, `schedule(text,text,text)`, `unschedule(bigint)`, `unschedule(text)`, `job_cache_invalidate()`의 `proacl`에 `=X/supabase_admin`(PUBLIC). `alter_job`, `schedule_in_database`는 PUBLIC 없음. `cron.job` `=r`, `cron.job_run_details` `=rd`(PUBLIC 읽기·삭제). 시퀀스 2개 `=r` |
| 스키마 | `cron` ACL = `{supabase_admin=UC, postgres=U*}`. `has_schema_privilege('anon'/'authenticated'/'authenticator'/'service_role', 'cron', 'USAGE')` 모두 false |
| `SET ROLE anon` / `authenticated` (각각 롤백) | `cron.schedule` 2종, `cron.unschedule` 2종, `SELECT FROM cron.job`, `SELECT FROM cron.job_run_details` 6개 모두 **42501 permission denied for schema cron**. 검토 뒤 `cron.job` 1줄 그대로 |
| 2중 방어 | `cron.job`·`cron.job_run_details`에 RLS가 켜져 있고 정책이 `username = CURRENT_USER`. USAGE가 생겨도 남의 작업은 보이지 않는다 |
| PostgREST | DB 안에서 노출 스키마 설정은 조회되지 않는다 (`pgrst.db_schemas` 설정 없음, `authenticator` 역할 설정에도 없음). `.env`에 anon 키가 없어 HTTP로도 시험하지 않았다. 확인할 수 있는 것: 노출에 필요한 `cron` USAGE가 `anon`·`authenticated`에 없으므로, 대시보드에서 `cron`을 노출해도 42501로 막힌다 |
| 회수 가능 여부 (실행하지 않음) | `PUBLIC` 권한의 grantor는 `supabase_admin`(확장 주인)이다. PostgreSQL에서 주인이 아닌 역할의 `REVOKE`는 자기가 준 권한만 회수하므로 `postgres`의 `REVOKE … FROM PUBLIC`은 경고만 내고 아무것도 바꾸지 않을 것으로 본다 |

- **권고: 기본값 유지, 016 REVOKE 마이그레이션은 만들지 않는다.** (1) 실제 호출·조회 경로가 스키마 USAGE에서 막히는 것을 직접 확인했다. (2) 회수가 효과 없을 가능성이 크고, 효과가 있더라도 Supabase 관리 확장 객체를 건드리는 지속 변경이다. (3) 진짜 위험은 누군가 `cron` 스키마 USAGE를 `anon`·`authenticated`에 주는 것인데, 테스트 011이 그 경우 실패한다. 테스트 011의 완화(직접 부여·USAGE면 실패, PUBLIC은 `[주의]`)는 적절하다.

### 03R-6. 발견한 문제 (심각도 순)

| # | 심각도 | 내용 | 권고 |
|---|--------|------|------|
| L7 | Low | 예약 작업 실패에 알림이 없다. `cron.job_run_details`나 `stats_window.aggregated_at`을 누가 봐야 안다. 백엔드 변경 전까지는 매일 P0002로 실패하는 것이 정상이라 더 놓치기 쉽다 | `!백엔드` 변경에서 `/health` 또는 `/meta`에 `window.aggregatedAt`을 꼭 넣는다 (spec 03-7 "선택" → 권장) |
| L8 | Low | 편차 1: `cron.schedule`·`unschedule`에 pg_cron 기본 `PUBLIC` EXECUTE, `cron.job` PUBLIC 읽기. 스키마 USAGE가 없어 실제로는 쓸 수 없다 (03R-5) | 기본값 유지. 사용자 결정으로 확정 |
| L9 | Low | 테스트 011의 직접 부여 검사는 `schedule(text,text,text)`·`unschedule(bigint)` 2개만 본다. `schedule(text,text)`, `unschedule(text)`, `alter_job`, `schedule_in_database`는 빠진다. 스키마 USAGE 검사가 모두를 막으므로 지금 위험은 없다 | 다음 테스트 수정 때 `cron` 스키마 함수 전체로 넓힌다 |
| L10 | Low | DB의 `ranked_players` 테이블 주석이 아직 "각 50명"(010)이다 (Build 남은 문제 4). 계약은 100명 | 동작 영향 없음. 다음 `!db` 변경 마이그레이션에서 주석만 바꾼다. 이번에는 016을 정확성 결함에만 쓰므로 만들지 않음 |
| L11 | Low | 05:00 집계 커밋 순간에 백엔드가 `stats_window`와 집계 테이블을 **다른 문장**으로 읽으면(READ COMMITTED) 이전·새 스냅숏이 섞일 수 있다 | `!백엔드` Plan 메모: 한 요청의 읽기를 한 문장(JOIN)이나 `REPEATABLE READ` 트랜잭션으로 묶는다 |
| L12 | Low | 계약 11장 보안에 `cron` 스키마 권한(USAGE 없음, PUBLIC 기본값 유지 판단)이 없다 | 다음 계약 수정 때 한 줄 추가 (문구 추가라 이번 수정 범위 밖) |
| 참고 | - | 집계 시간은 아이템 줄 수에 비례해 커진다 (03R-4: 1.1만 줄 1.14초, 10.6만 줄 4.2초) | 본 수집 뒤 `item_rows`와 실행 시간을 `cron.job_run_details`(`end_time − start_time`)로 확인 |

### 03R-7. Review에서 고친 것

| 파일 | 내용 | 이유 |
|------|------|------|
| `docs/contracts/db_contract.md` 9장 요약 (문구만) | "백엔드는 `ANALYZE` 뒤에 `refresh_window_stats(14)`로 … 다시 만들고" → "매일 DB 예약 작업(pg_cron, 9-4)이 `ANALYZE` 뒤에 `refresh_window_stats(14)`로 … 다시 만든다 (백엔드 `aggregate`는 시험용으로 같은 순서). 백엔드는 사용자 확인 뒤 `purge_old_games(21)`…" | spec 03-3-2 문구를 그대로 옮긴 것이지만, 같은 장 9-4·10장 14번("수집 뒤 자동 집계 없음")과 어긋나 백엔드 Plan이 수집 뒤 집계를 다시 넣을 수 있다. 규칙·값은 바꾸지 않았다 |

- 마이그레이션·함수·테스트는 고치지 않았다. 016 없음.
- `db_build.md` 변경 03 03-7 남은 문제 2·3·5에 Review 결과를 적었다.
