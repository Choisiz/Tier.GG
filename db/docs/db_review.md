# DB 검토 기록 (`!db` Review)

- 이 문서는 **가장 최근 검토만** 둔다. 지금은 **변경 04 검토 (2026-10-16): 보조 룬 정렬, 계약 v7 → v8**이다.
- 이전 검토(변경 03까지)는 git 기록에 있다 (변경 03 검토는 커밋 `93e4461`의 이 파일). 아직 해결되지 않은 문제는 [`db_overview.md`](db_overview.md) "해결되지 않은 점"에 옮겨 두었다.
- 작성: Review 서브에이전트 (2026-10-16 14:40 UTC 무렵). Build 보고를 믿지 않고 실제 DB를 직접 조회·실행해 확인했다.
- 기준: 승인된 변경 04 계획(04-1~04-12, 결정 04-A~G, 완료 기준 04-10, 작업 범위 04-11), `db/docs/db_build.md`, 계약 v8 (`db_contract.md`, `db_contract.dbml`)
- 대상: Supabase PostgreSQL 17.11, Session pooler, 접속 계정 `postgres`(superuser 아님)
- **샘플·측정은 모두 ROLLBACK 되는 트랜잭션 안에서만 했다.** 검토 전·후 `matches` 3,975, `match_players` 39,750, `champion_rune` 3,943, `stats_window.aggregated_at` 2026-10-16 11:13:44 UTC 그대로.
- 검토용 스크립트는 scratchpad에만 두었다 (저장소에 넣지 않음).

## 목차

- [1. 종합 판정](#1-종합-판정)
- [2. 완료 기준 체크리스트](#2-완료-기준-체크리스트)
- [3. 원본에서 따로 계산한 값과 비교](#3-원본에서-따로-계산한-값과-비교)
- [4. 함수 본문 비교](#4-함수-본문-비교)
- [5. 성능과 동시 호출](#5-성능과-동시-호출)
- [6. 예약 작업](#6-예약-작업)
- [7. 문서와 범위](#7-문서와-범위)
- [8. 발견한 문제](#8-발견한-문제)
- [9. Review에서 고친 것](#9-review에서-고친-것)

---

## 1. 종합 판정

> 요약: **PASS with issues.** 실제 DB와 계약 v8이 같고, 원본에서 JS로 따로 다시 센 집계 5종이 한 줄도 다르지 않다. 순서만 다른 룬 쌍은 0이다. 남은 것은 결함이 아니라 **확인 대기 1건**(016 이후 첫 05:00 예약 작업)과 프론트 전달 1건이다.

| 구분 | 결과 |
|------|------|
| 판정 | **PASS with issues** |
| Critical / High / Medium | 0 / 0 / 0 |
| Low | 3 (8장) |
| 새 마이그레이션 필요 | 없음 (017 만들지 않음) |

---

## 2. 완료 기준 체크리스트

> 요약: 04-10의 13개 항목 중 12개 통과, 1개(다음 예약 작업)는 아직 실행 전이라 확인 대기.

| # | 기준 (04-10) | 결과 |
|---|--------------|------|
| 1 | 016만 새로 생김, 001~015 변경 없음, 체크섬 불일치 없음 | ✅ `git diff db/migrations/` 비어 있음, `migrate:status` 001~016 적용(016 = 2026-10-16 11:13:44 UTC), 불일치 없음 |
| 2 | 인자·기본값·반환·`SECURITY INVOKER`·`search_path`가 013과 같고 본문 차이는 룬 블록·주석뿐 | ✅ 4장 |
| 3 | `proacl`이 `postgres`, `service_role`만, 006 기대 개수 그대로 | ✅ `{postgres=X/postgres,service_role=X/postgres}`, 006: 테이블 12·뷰 1·시퀀스 2·함수 4 |
| 4 | `champion_rune_sub_perk_order_check` 있음, `convalidated = true` | ✅ `CHECK ((sub_perk1 < sub_perk2))`, 검증 안 된 제약 0개 (public 전체 63개) |
| 5 | 1순위 = 2순위 0, 순서만 다른 쌍 0, `sub_perk1 > sub_perk2` 0 | ✅ 0 / 0 / 0 (`>=`로 세도 0) |
| 6 | 아트록스 TOP 1순위 118판 55승, `rune_rows` 3,943, 창·`games`·`champion` 줄 수 그대로 | ✅ `(8453, 8473)` 118/55, 2순위 `(8444, 8453)` 32/19. 창 2026-10-01 20:00:00.173 ~ 10-15 20:00:00.173 UTC, `days` 14, `games` 3,789 (16.20: 2,640 / 16.19: 1,149), `champion` 606 |
| 7 | `match_players` 줄 수·값 그대로 | ✅ 39,750줄, 보조 룬 순서 분포 `<` 18,383 / `>` 21,367 / `=` 0 (계획 시점 값과 같음 → 원본은 정렬되지 않음) |
| 8 | 테스트 012 통과, 003·011 포함 전체 `verify`·`verify:fresh` 통과 | ✅ 둘 다 11개 파일 통과, 전후 줄 수 같음. `verify:fresh`에서 012 실제 데이터 부분은 `[건너뜀]` |
| 9 | `migrate:fresh-check` 통과 | ✅ 16개 파일, 임시 스키마 테이블 11·뷰 1·함수 4, `migration_check` 남지 않음 |
| 10 | 5,000게임 롤백 측정 약 1.1초 수준 | ✅ (조건부) 5장. 룬 블록만 떼어 같은 데이터로 재면 016식이 013식보다 느리지 않다. 전체 시간은 분포가 달라 1.1초와 직접 비교 불가 |
| 11 | DB 주석이 04-5와 같음, "각 50명" 없음 | ✅ 주석 7개(테이블 2, 컬럼 4, 함수 1) 문구 일치, `pg_description`에 "각 50명" 0건 |
| 12 | 계약 `.md`·`.dbml` v8, 04-4 반영, 티어 기준값 변경 없음 | ✅ 7장 |
| 13 | 다음 05:00 KST 예약 작업 성공, 그 뒤 중복 0 | ⏸️ **확인 대기.** 016 적용(11:13 UTC) 뒤 실행 기록 없음. 마지막 기록은 2026-10-15 20:00 UTC 성공 3.56초. 다음 실행 2026-10-16 20:00 UTC |

보안 (CLAUDE.md 8장):

| 항목 | 결과 |
|------|------|
| RLS | public 테이블 12개 모두 켜짐, 정책 0개 |
| 테이블·뷰·시퀀스 `relacl` | `anon`·`authenticated` 없음 |
| `SET ROLE` 직접 시험 (롤백) | `anon`·`authenticated` 각각 `SELECT champion_rune`, `SELECT refresh_window_stats(14)`, `SELECT cron.job` → 모두 42501 |
| `refresh_window_stats` EXECUTE | `anon` false, `authenticated` false, `service_role` true, `postgres` true |
| pg_cron | `cron` 함수 7개에 직접 부여 0개 (011 확장 검사 통과). `PUBLIC` 기본값은 `[주의]`로 5개 표시 (`job_cache_invalidate`, `schedule` 2개, `unschedule` 2개) |

구조 (계약 dbml ↔ 실제 DB, 스크립트로 자동 비교):

| 항목 | 결과 |
|------|------|
| 테이블·컬럼 | dbml 11개 테이블, 85개 컬럼의 이름·순서·타입·NOT NULL이 실제 DB와 **차이 0** |
| 제약 | PK 12, FK 6 (삭제 동작 SET NULL 1, CASCADE 5), UNIQUE 1 (`champion_rune_page_key`), CHECK 44 |
| 인덱스 | 14개 = PK·유니크 13 + `match_players_champion_id_team_position_idx` 1 (계획 5장과 같음) |

---

## 3. 원본에서 따로 계산한 값과 비교

> 요약: 테스트 012는 SQL로 같은 규칙을 다시 쓴 것이라, Review는 원본 37,890줄을 Node로 읽어 **JS에서** 다시 셌다. 모든 집계가 실제 스냅숏과 줄·값 모두 같다.

- 방법: `REPEATABLE READ READ ONLY` 트랜잭션에서 `stats_window` 창 안 10줄 게임(3,789개)의 `match_players` 37,890줄을 읽고, 정렬·상위 10개·동률 규칙(`pick DESC, win DESC, 키 ASC`)을 JS로 구현해 비교.

| 집계 | 기대 줄 | 실제 줄 | 없음 / 남음 / 값 다름 |
|------|---------|---------|-----------------------|
| `champion_rune` (보조 룬 정렬, 상위 10) | 3,943 | 3,943 | 0 / 0 / 0 |
| `champion` pick·win | 606 | 606 | 0 / 0 / 0 |
| `champion.ban` (게임당 1번) | 606 | 606 | 다름 0 |
| `champion_spell` (상위 10) | 1,555 | 1,555 | 0 / 0 / 0 |
| `champion_skill` (앞 11글자, 상위 10) | 3,349 | 3,349 | 0 / 0 / 0 |
| `champion_item` (전부) | 17,094 | 17,094 | 0 / 0 / 0 |

- 다른 집계(아이템·스펠·스킬·`champion`·패치 구성)는 016 전 Build 기록 줄 수와 같고, 원본에서 다시 센 값과도 같다 → 016은 룬만 바꿨다.
- 룬 줄이 10개가 안 되는 챔피언 × 포지션은 606개 중 323개다. 같은 페이지가 합쳐져 서로 다른 조합 수가 줄었기 때문이며 정상이다 (3,993 → 3,943줄).

---

## 4. 함수 본문 비교

> 요약: 013과 016의 함수 본문을 직접 `diff`했다. 차이는 룬 블록 4곳뿐이고, `GROUP BY`는 원본 컬럼이 아니라 `least`/`greatest` 식으로 묶는다.

`diff 013 016` (함수 본문만):

| 위치 | 차이 |
|------|------|
| 7-2 주석 | 2줄 추가 (보조 룬 정렬, 같은 번호 제외 이유) |
| 안쪽 `SELECT` | `sub_perk1, sub_perk2` → `least(sub_perk1, sub_perk2) AS sub_perk1, greatest(sub_perk1, sub_perk2) AS sub_perk2` |
| `WHERE` | `AND sub_perk1 <> sub_perk2` 추가 |
| `GROUP BY` | `sub_perk1, sub_perk2` → `least(sub_perk1, sub_perk2), greatest(sub_perk1, sub_perk2)` ✅ 식 그대로 |

- 다른 블록(창 계산, 잠금, champion, item, spell, skill, 반환 jsonb)은 한 글자도 같다.
- 실제 DB의 `prosrc`는 016 파일 본문과 같다 (맨 앞 줄바꿈 1개만 다름. `AS $$` 뒤 줄바꿈이라 정상).
- 머리: `p_days integer DEFAULT 14, p_until timestamptz DEFAULT now()` → `jsonb`, `VOLATILE`, `SECURITY INVOKER`, `search_path=public, pg_catalog` (013과 같음).

---

## 5. 성능과 동시 호출

> 요약: 룬 블록만 떼어 같은 데이터로 재면 016식이 013식보다 오히려 조금 빠르다. 전체 5,000게임 측정은 Review가 만든 분포가 이전 측정보다 무거워 2.4~3.1초였다. 두 연결 동시 호출은 advisory lock으로 차례로 실행된다.

5,000게임 전체 측정 (롤백 2회, 2021년 창, `ANALYZE` 뒤):

| 실행 | 삽입 | `ANALYZE` | 집계 | 아이템 줄 | 룬 줄 | 스킬 줄 | 순서만 다른 룬 쌍 |
|------|------|-----------|------|-----------|-------|---------|-------------------|
| 1 | 5.7초 | 0.62초 | 3.07초 | 25,496 | 8,500 | 8,500 | 0 |
| 2 | 5.5초 | 0.54초 | 2.44초 | 25,500 | 8,500 | 8,500 | 0 |

- 기준 1.1초(변경 03 Review)는 아이템 줄 약 1.1만의 분포였다. 이번 분포는 아이템 줄이 2.3배이고 룬·스킬이 모든 챔피언 × 포지션에서 10줄을 채워 더 무겁다. 계약·운영 문서에 적힌 대로 집계 시간은 아이템 줄 수에 크게 좌우되므로 전체 시간끼리는 직접 비교할 수 없다.
- 그래서 **룬 블록만** 같은 데이터에서 013식과 016식으로 4번씩 쟀다:

| 데이터 | 013식 (ms) | 016식 (ms) |
|--------|-----------|-----------|
| 합성 5,000게임 (50,000줄) | 248 / 231 / 216 / 222 | 175 / 189 / 176 / 167 |
| 실제 창 (37,890줄) | 84 / 85 / 86 / 91 | 80 / 81 / 83 / 83 |

- 결론: `least`/`greatest` 추가로 느려지지 않는다 (묶이는 그룹이 줄어 약간 빠름). 실제 창 전체 재집계는 롤백 안에서 2.28초, 실제 예약 작업 기준(3.3~3.6초, `ANALYZE` 포함)과 같은 수준이다. 5분 제한까지 여유가 크다.

두 연결 동시 호출 (실제 창, 둘 다 롤백):

| 단계 | 결과 |
|------|------|
| A: `BEGIN` → `refresh_window_stats(14, window_end)` | 2.28초에 끝남, 커밋 전 대기 |
| B: 같은 호출 | 1.5초 뒤 `pg_stat_activity` = `Lock / advisory / active` (기다림) |
| A `ROLLBACK` | B가 이어서 진행, 총 3.31초, `games` 3,789, `rune_rows` 3,943 |
| B `ROLLBACK` 뒤 | `champion_rune` 3,943, `aggregated_at` 그대로 |

---

## 6. 예약 작업

> 요약: 016 뒤 아직 한 번도 돌지 않았다. 지금 스냅숏은 016 안의 재집계가 만든 것이다.

| 항목 | 값 |
|------|----|
| 작업 | jobid 1, `0 20 * * *`, active, 명령 `SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);` |
| 실행 기록 | 2026-10-14 20:00 UTC 성공 3.30초, 2026-10-15 20:00 UTC 성공 3.56초. **016 적용(2026-10-16 11:13 UTC) 뒤 기록 없음** |
| 다음 실행 | 2026-10-16 20:00 UTC (10-17 05:00 KST) |
| 확인할 것 | `cron.job_run_details` 성공, `stats_window.window_end` ≈ 2026-10-16 20:00, `champion_rune`에서 `sub_perk1 >= sub_perk2` 0줄·순서만 다른 쌍 0 (CHECK가 있어 어기면 작업 자체가 실패로 남는다) |

---

## 7. 문서와 범위

> 요약: spec 병합·결정 표·계약 문구가 계획과 맞다. 범위 밖 파일 수정은 없다.

| 항목 | 결과 |
|------|------|
| `db_spec.md` | `## 이번 변경 (승인 대기)` 절 없음(머리말·11·13장의 일반 안내 문구만 남음). 3장에 016 줄 추가, "다음 파일 017". 결정 표에 04-A~G 7줄(2026-10-16) |
| `db_build.md` | 016·테스트 012·011 확장·계약 v8 반영, 상태 표기 ✅/⏸️. 성능·동시 호출은 "Review가 다시 잼"으로 표시되어 있어 이번 검토 값으로 갱신 (9장) |
| 계약 `db_contract.md` v8 | 머리말 v8, "v7 → v8" 표, 1장·1-1 **티어당 250명**, 1-1 `MASTER`~`CHALLENGER` 허용 유지(04-C), 1-2 "상한 계산", 1-3 실제 규모, 2장·5장 ① 문구, ERD `sub_perk1 < sub_perk2`, 7장 룬 저장 규칙, 9-2 정렬·CHECK, 9-4 `ANALYZE` 5,000게임 근거, 10장 #2 수정·#15 추가, 11장 pg_cron 권한 문장. 본문에 **4 : 4 : 2·각 100명 문구 없음**(변경 기록 표에만). 티어 기준값 그대로 |
| 계약 `db_contract.dbml` v8 | 머리 주석, `ranked_players` note, `champion_rune` note·컬럼 note, `match_players.sub_perk1·2` note, `ANALYZE` 규칙 주석. 구조 변경 없음 (실제 DB와 자동 비교 차이 0) |
| 영역 문서 목차 | `db_spec`·`db_build`·`db_review`·`db_overview` 모두 상단 목차 있음. 계약 `db_contract.md`에는 목차가 없다 (L3) |
| 범위 밖 수정 | 없음. `git status`의 변경은 016, 테스트 011·012, 계약 2개, `db_spec`·`db_build`뿐. `db/scripts/`, `backend/`, `frontend/`, `api_contract.md` 변경 없음 |

---

## 8. 발견한 문제

> 요약: 결함은 없다. 확인 대기와 다른 영역 전달 사항이다.

| # | 등급 | 내용 | 권고 | 상태 |
|---|------|------|------|------|
| L1 | Low | 016 이후 예약 작업이 아직 돌지 않아 "05:00 작업 성공 + 그 뒤 중복 0"을 확인하지 못했다 | 2026-10-16 20:00 UTC 뒤 6장 쿼리로 확인 | 열림 (overview 2) |
| L2 | Low | 보조 룬 2개가 이제 번호순으로 온다(04-E). 프론트 룬 격자(`toRuneTree`)는 선택 표시라 영향 없지만, 요약 문장(`frontend/src/lib/view/builds.ts` `chosenNames`)은 API 순서대로 이름을 이어 붙여 룬 줄 순서와 다를 수 있다 | `!프론트`가 Data Dragon `runesReforged.json` 줄 순서로 정렬 | 열림, 메인 에이전트 전달 (overview 1) |
| L3 | Low | `docs/contracts/db_contract.md`에 상단 목차가 없다 (v7 때부터). CLAUDE.md 6장의 "영역 문서"에 계약을 포함하는지는 애매하다 | 다음 `!db` 계약 수정 때 목차 추가 | 열림 (overview 12) |

- 참고 (문제 아님): DB 크기 90MB → 95MB. 016 재집계와 검증·측정 재집계가 남긴 죽은 줄(`champion_item` 7.5 → 12MB)이며 autovacuum이 재사용한다.

---

## 9. Review에서 고친 것

> 요약: 코드·마이그레이션·테스트는 고치지 않았다. 문서만 갱신했다.

| 파일 | 내용 |
|------|------|
| `db/docs/db_build.md` | 11장 동시 호출·성능·예약 작업·DB 크기를 이번 검토 값으로, 13장 남은 문제 갱신, 12장 번호 순서 정리 |
| `db/docs/db_review.md` | 이번 검토로 교체 |
| `db/docs/db_overview.md` | 현재 상태로 덮어씀, 변경 이력 1줄, 해결되지 않은 점 정리 |
| `docs/career_log.md` | 판단 기록 2개 추가 (28, 29) |
