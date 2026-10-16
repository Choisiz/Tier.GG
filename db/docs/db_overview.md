# DB 현재 상태 (`!db`)

- 기준 시각: 2026-10-16 14:40 UTC (변경 04 Review가 실제 DB를 직접 조회)
- 계약: `docs/contracts/db_contract.md` / `db_contract.dbml` **v8**
- 마이그레이션: `001` ~ `016` 적용됨 (다음 파일은 `017`)
- 이 문서는 **지금 상태**만 적는다. 현재 계획은 `db_spec.md`, 구현 상태는 `db_build.md`, 최근 검토는 `db_review.md`에 있다. 지난 과정 기록은 git에 있다 (정리 전 전체는 커밋 `87cfc78`). DB Review가 끝날 때마다 이 문서를 덮어쓴다 (CLAUDE.md 6장 "영역 문서 관리", 8장).

## 목차

- [1. 한눈에 보기](#1-한눈에-보기)
- [2. 테이블 구성](#2-테이블-구성)
- [3. 데이터 흐름과 일정](#3-데이터-흐름과-일정)
- [4. 함수와 뷰](#4-함수와-뷰)
- [5. 보안](#5-보안)
- [6. 운영 방법](#6-운영-방법)
- [7. 용량과 성능](#7-용량과-성능)
- [8. 관련 문서](#8-관련-문서)
- [9. 변경 이력](#9-변경-이력)
- [10. 해결되지 않은 점](#10-해결되지-않은-점)

---

## 1. 한눈에 보기

요약: Riot 게임 원본을 쌓아 두고, 매일 한 번 최근 14일 게임으로 챔피언 통계를 다시 만든다.

```
백엔드 수집기 → 원본 3개 (ranked_players → matches → match_players)
            → [매일 05:00 KST pg_cron] ANALYZE → refresh_window_stats(14)
            → 집계 7개 + champion_tier_view → 백엔드 읽기 API → 프론트
```

| 항목 | 값 |
|------|----|
| DB | Supabase 무료 플랜, PostgreSQL 17.11, 용량 한도 500MB |
| 테이블 | 11개 (원본 3, 집계 7, 운영 1) + 메타 `schema_migrations` |
| 뷰 / 함수 | 뷰 1개, 함수 4개 |
| 원본 | 표본 플레이어 765명 (플래티넘 250, 에메랄드 265, 다이아 250), 게임 3,975개, 참가자 39,750줄. 마지막 게임 2026-10-14 15:40 UTC |
| 현재 집계 창 | 2026-10-01 20:00 ~ 2026-10-15 20:00 UTC, **3,789게임** (패치 16.20: 2,640 / 16.19: 1,149) |
| 집계 결과 | 챔피언 × 포지션 606줄 (챔피언 173명), 그중 티어가 나온 줄 187개 (나머지는 50판 미만 "표본 부족"). 룬 3,943줄 |
| DB 크기 | 95MB (public 테이블 합계 81MB) |
| 마지막 집계 | 2026-10-16 11:13 UTC, 마이그레이션 016이 **같은 창**으로 다시 집계 (창은 그대로, 룬만 새 규칙). 마지막 예약 작업은 2026-10-15 20:00 UTC 성공 3.6초 |

---

## 2. 테이블 구성

요약: 원본은 Riot 값 그대로, 집계는 원본을 센 개수만, 운영은 수집 기록이다. 컬럼은 계약 문서를 본다.

| 묶음 | 테이블 | 역할 | 지금 줄 수 |
|------|--------|------|-----------|
| 원본 | `ranked_players` | 수집 대상 표본 플레이어 1명 = 1줄 | 765 |
| 원본 | `matches` | 게임 1개 (패치, 시작 시각, 처음 찾은 표본) | 3,975 |
| 원본 | `match_players` | 게임 속 플레이어 1명. 게임당 10줄. 챔피언·포지션·승패·밴·스펠·룬·아이템·스킬 순서. 보조 룬 2개는 **누른 순서 그대로** | 39,750 |
| 집계 | `stats_window` | 현재 창 1줄 (시작·끝, 게임 수, 집계 시각) | 1 |
| 집계 | `stats_window_patch` | 창 안 패치별 게임 수 | 2 |
| 집계 | `champion` | 챔피언 × 포지션의 pick·win·ban. 티어리스트 | 606 |
| 집계 | `champion_item` | 아이템별 개수 (모든 아이템) | 17,094 |
| 집계 | `champion_rune` | 룬 페이지 조합, 상위 10개. 보조 룬 2개는 **작은 번호, 큰 번호**로 정렬해 묶음 (CHECK `sub_perk1 < sub_perk2`) | 3,943 |
| 집계 | `champion_spell` | 소환사 주문 조합 (작은 번호, 큰 번호), 상위 10개 | 1,555 |
| 집계 | `champion_skill` | 스킬 앞 11레벨 순서, 상위 10개 | 3,349 |
| 운영 | `collection_logs` | 수집 실행 1회 = 1줄 (`running` / `done` / `key_expired` / `failed`) | 10 |

- 컬럼, 타입, PK·FK, CHECK: [`db_contract.md`](../../docs/contracts/db_contract.md) 2~4장, [`db_contract.dbml`](../../docs/contracts/db_contract.dbml)
- 백엔드 저장 규칙 (5분 미만 제외, 한 게임 = 한 트랜잭션 등): 계약 7장
- 원본과 집계는 FK로 잇지 않는다. 집계 함수가 원본을 읽어 집계를 통째로 다시 만든다.
- 이름·이미지·룬 줄 구조는 저장하지 않는다. ID는 모두 Data Dragon 값이다. 보조 룬을 화면에 룬 줄 순서로 보이려면 프론트가 Data Dragon으로 정렬한다.
- 룬 줄이 10개가 안 되는 챔피언 × 포지션은 606개 중 323개다 (같은 페이지가 합쳐져 조합 수가 줄었음).

---

## 3. 데이터 흐름과 일정

요약: 백엔드가 원본을 넣고, DB 예약 작업이 매일 집계한다. 오래된 원본 삭제는 사람이 직접 한다.

| 단계 | 누가 | 언제 | 하는 일 |
|------|------|------|---------|
| 수집 | 백엔드 (`npm run collect -- run …`) | 사용자가 직접 실행 (개발 키 24시간) | 최근 14일 솔로랭크 게임만 받아 `matches` 1줄 + `match_players` 10줄을 한 트랜잭션으로 저장 |
| 집계 | pg_cron 작업 `tiergg_daily_refresh` | **매일 05:00 KST (20:00 UTC)** | `SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);` |
| 정리 | 백엔드 (`npm run collect -- purge --yes`) | 수동, 사용자 확인 뒤 | `purge_old_games(21)`: 시작 시각이 21일 넘은 게임 삭제 |

- **14일 창:** 집계 시각 기준 `[지금 − 14일, 지금)`에 시작한 완료 게임(10줄)만 센다.
- **21일 보관:** 원본은 창 14일 + 여유 7일만 둔다. 집계 전에 지우지 않는다 (집계 → 정리 순서).
- 지금 21일 넘은 게임은 0개다. 가장 오래된 게임(2026-09-30)이 2026-10-21에 21일을 넘는다.
- 수집이 끝나도 바로 집계하지 않는다. 다음 05:00에 반영된다. 바로 보려면 백엔드 `npm run collect -- aggregate`(같은 순서)를 쓴다.
- 집계가 실패하면(창 안 게임 0개, 시간 초과) 전체가 롤백되어 **이전 집계가 그대로 남는다.**

---

## 4. 함수와 뷰

요약: 집계 함수 2개, 보조 함수 2개, 티어 계산 뷰 1개다. 모두 DB 주인 계정(백엔드)만 쓸 수 있다.

| 이름 | 하는 일 | 부르는 법 |
|------|---------|-----------|
| `refresh_window_stats(p_days int = 14, p_until timestamptz = now())` | 창 안 완료 게임으로 집계 7개를 지우고 다시 센다. 결과 요약 jsonb 반환. 게임 0개면 오류 P0002 (기존 집계 유지). 동시 호출은 advisory lock으로 차례로. 룬은 보조 2개를 `least`/`greatest`로 정렬해 묶고 두 보조 룬이 같은 줄은 뺀다 (016) | `ANALYZE matches, match_players;` 뒤에 `SELECT refresh_window_stats(14);` (`p_until`은 테스트용) |
| `purge_old_games(p_keep_days int = 21)` | `game_start_at < now() − p_keep_days일`인 게임 삭제 (`match_players` 함께). 지운 게임 수 반환. 14 미만이거나 현재 창보다 짧으면 오류 | `SELECT purge_old_games(21);` |
| `patch_sort_key(text)` | `'16.9'` → `{16,9}`. 패치를 숫자 순으로 정렬 | `ORDER BY patch_sort_key(patch) DESC` |
| `tier_from_score(numeric)` | 티어 점수 → 1~5티어 | 뷰 안에서 사용 |
| `champion_tier_view` | `champion` + `stats_window`로 승률·픽률·밴률·보정 승률·티어 점수·티어 계산. 50판 미만은 티어 NULL | `SELECT * FROM champion_tier_view WHERE position = $1 ORDER BY tier NULLS LAST, tier_score DESC` |

- 공식과 기준값: 계약 9-2, 9-3. 기준값을 바꿀 때는 `!db`가 새 마이그레이션으로 바꾼다.
- 집계는 개수만 저장한다. 비율과 티어는 조회할 때 계산하므로 공식을 바꿔도 다시 집계할 필요가 없다.
- 핵심 룬 4개와 능력치 파편 3개는 칸마다 뜻이 정해져 있어 정렬하지 않는다. 보조 룬만 정렬한다.

---

## 5. 보안

요약: 브라우저용 키로는 아무것도 읽거나 부를 수 없다. 백엔드만 서버용 접속 정보로 쓴다.

| 항목 | 현재 상태 |
|------|-----------|
| RLS | public 테이블 12개(`schema_migrations` 포함) 모두 켜짐, 정책 0개 |
| 테이블·뷰 권한 | `anon`·`authenticated` 권한 회수 (`REVOKE ALL`). `SET ROLE`로 읽으면 42501 |
| 함수 권한 | 4개 모두 `postgres`, `service_role`만 실행. `PUBLIC`·`anon`·`authenticated` 회수 |
| 뷰 | `security_invoker = true` (RLS를 우회하지 않음) |
| Supabase 기본 권한 | `pg_default_acl`이 새 객체에 `anon`·`authenticated` 권한을 준다. 그래서 새 객체는 만들 때마다 `REVOKE`하고, 테스트 `006`이 스키마 전체를 자동 검사한다 |
| pg_cron 권한 | `cron` 함수 5개에 확장 기본값 `PUBLIC` EXECUTE가 있다. 하지만 `anon`·`authenticated`는 `cron` 스키마 USAGE가 없어 실제로 부를 수 없다 (42501). **기본값 유지** (계약 11장). 테스트 `011`이 USAGE나 `cron` 함수 7개 중 어디든 직접 부여가 생기면 실패한다 |
| 비밀값 | `DATABASE_URL`은 루트 `.env`에만. 문서·로그·커밋에 출력하지 않는다 |

---

## 6. 운영 방법

요약: 마이그레이션과 검증은 `db/`에서 npm 명령으로 한다. 적용된 SQL 파일은 절대 고치지 않는다.

`db/` 폴더에서 실행 (`.env`는 저장소 루트):

| 명령 | 하는 일 |
|------|---------|
| `npm run migrate` | 아직 적용하지 않은 파일만 순서대로 적용 (파일 1개 = 트랜잭션 1개, 실패하면 멈춤) |
| `npm run migrate:status` | 파일별 적용 여부, 체크섬 불일치 표시 |
| `npm run migrate:fresh-check` | 임시 스키마에 001부터 전부 적용해 보고 항상 ROLLBACK |
| `npm run verify` | 실제 스키마에서 `db/tests/*.sql` 실행 (항상 ROLLBACK, 전후 줄 수 비교). 테스트 11개 |
| `npm run verify:fresh` | 임시 스키마에 마이그레이션을 적용한 뒤 테스트 실행 |

예약 작업 결과 확인:

```sql
SELECT status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'tiergg_daily_refresh')
ORDER BY start_time DESC LIMIT 7;

SELECT aggregated_at, window_end, games FROM stats_window;  -- 하루를 크게 넘었으면 집계가 멈춘 것
SELECT count(*) FROM champion_rune WHERE sub_perk1 >= sub_perk2;  -- 0이어야 함 (CHECK가 막음)
```

- Supabase 대시보드 Integrations → Cron에서도 같은 기록을 볼 수 있다.
- 작업 멈추기: `SELECT cron.unschedule('tiergg_daily_refresh');` (시각·명령 변경은 새 마이그레이션으로)

새 마이그레이션 추가:

1. `db/migrations/`에 마지막 번호보다 큰 번호로 새 파일을 만든다 (다음은 `017_….sql`).
2. 적용된 파일(001~016)은 고치지 않는다. 고치면 체크섬 불일치로 실행기가 멈춘다. 함수를 바꿀 때는 016처럼 새 파일에서 `CREATE OR REPLACE`한다.
3. 새 테이블·뷰·함수·시퀀스는 RLS를 켜고 `anon`·`authenticated`에서 `REVOKE`한다.
4. 삭제처럼 되돌릴 수 없는 SQL은 실행 전에 사용자 승인을 받는다.
5. `migrate:fresh-check` → `verify:fresh` → `migrate` → `verify` 순서로 확인한다.

---

## 7. 용량과 성능

요약: 지금 95MB이고, 상한 규모에서도 약 180MB 안으로 예상한다. 실제 집계는 3~4초다.

| 항목 | 값 |
|------|----|
| 지금 DB 크기 | 95MB / 500MB (016 전 90MB. 재집계·검증이 남긴 죽은 줄 포함) |
| 가장 큰 테이블 | `match_players` 60MB (본문 9MB + 인덱스 51MB) |
| 집계 테이블 7개 합계 | 약 17MB (`champion_item` 12MB가 대부분, 죽은 줄 포함) |
| 상한 계산 | 14일 창 최대 25,000게임, 원본 21일 약 37,500게임 → 합계 약 165~180MB (계약 1-2) |
| 실제 예약 작업 시간 | 2026-10-14 3.3초, 2026-10-15 3.6초 (`ANALYZE` 포함) |
| 실제 창 재집계 (롤백) | 2.3초 (변경 04 Review) |
| 시험 측정 (롤백, 5,000게임) | 아이템 줄 1.1만 분포 1.1초(변경 03), 아이템 줄 2.55만 분포 2.4~3.1초(변경 04). 룬 정렬(016)은 시간을 늘리지 않음 |

- `match_players` 인덱스(51MB)는 39,750줄치고 크다. 예전 대량 롤백 시험이 남긴 빈 공간으로 보인다.
- 집계 직전 `ANALYZE`는 꼭 필요하다. 원본 통계가 틀리면 5,000게임도 2분을 넘긴다 (계약 9-4).
- 집계 시간은 `champion_item` 줄 수에 가장 크게 좌우된다.

---

## 8. 관련 문서

요약: 규칙은 계약, 현재 계획·구현·검토는 spec·build·review에 있다. 지난 과정은 git에 있다.

| 문서 | 내용 |
|------|------|
| [`docs/contracts/db_contract.md`](../../docs/contracts/db_contract.md) | DB ↔ 백엔드 계약 v8 (수집 범위, 테이블, 저장 규칙, 집계 함수, 보안) |
| [`docs/contracts/db_contract.dbml`](../../docs/contracts/db_contract.dbml) | 스키마 원본. `.md`와 다르면 dbml이 우선 |
| [`db/docs/db_spec.md`](db_spec.md) | 현재 계획 (테이블, 함수, 예약 작업, 테스트, 완료 기준, 결정 사항 표, 작업 범위) |
| [`db/docs/db_build.md`](db_build.md) | 현재 구현 상태 (기능별 ✅ ⚠️ ❌ ⏸️, 명령, 최신 검증 결과) |
| [`db/docs/db_review.md`](db_review.md) | 가장 최근 검토 (변경 04, 이슈 번호 L1~L3) |
| git 커밋 `87cfc78` | 정리 전 문서 전체 (v1·변경 01~03 계획 원문, 이전 검토, 성능 측정 기록) |
| `db/migrations/`, `db/tests/`, `db/scripts/` | 마이그레이션 SQL, 검증 SQL, 실행기 |

---

## 9. 변경 이력

요약: `!db` 변경 1건 = 1줄. 자세한 원문은 git 기록에 있다.

| 변경 | 날짜 | 무엇을 | 왜 | 결과 |
|------|------|--------|-----|------|
| v1 | 2026-10-13 | 첫 스키마 구축: 테이블 10개(원본 3, 패치 기준 집계 6, 운영 1), 집계·정리 함수, 티어 뷰, RLS, Node 실행기 (마이그레이션 001~008, 계약 v4) | dbml v4 확정안을 실제 DB로. 비율·티어는 DB 뷰에서 계산 (D1) | 적용, Review PASS with issues (집계 시간 여유·용량 추정 Medium 2, 비밀값 가리기·기본 권한 등 Low 4) |
| 01 | 2026-10-14 | 스킬 집계를 "마스터 순서" 대신 `skill_order` 앞 11레벨로, 상위 10개. 옛 스킬 함수 삭제, 비밀값 가리기 수정 (009, 계약 v5) | 사용자 결정. 실제 찍는 순서를 보여 주고, 느린 함수를 없애 집계 시간 문제(M1) 해결 | 적용, Review PASS with issues. 5,000게임 2.4~3.0초로 빨라짐. 통계가 틀린 원본에서 집계가 분 단위로 느려지는 문제(M2) 발견 |
| 02 | 2026-10-14 | `ranked_players.tier`에 `PLATINUM` 허용, 집계 직전 `ANALYZE` 규칙, `skill_order` CHECK 문서화 (010, 계약 v6) | 테스트 수집을 플래티넘~다이아로(마스터 이상은 디비전이 없음), M2 해결 | 적용, Review PASS. `ANALYZE` 뒤 5,000게임 1.64초 (없으면 120초 초과) |
| 03 | 2026-10-14 | 통계 기준을 패치 → 최근 14일 창 스냅숏 1개로. `game_start_at`, `stats_window`·`stats_window_patch`, 새 함수·뷰, 원본 21일 보관, 매일 05:00 KST pg_cron 집계 (011~015, 계약 v7) | 사용자 결정. 새 패치 직후 표본 급감과 직전 패치 대체 규칙을 없애고, 수집과 집계를 분리 | 적용, Review PASS (Low 6). 5,000게임 1.14초, 실제 예약 작업 3.3~3.6초 성공 |
| 04 | 2026-10-16 | 룬 집계에서 보조 룬 2개를 `least`/`greatest`로 정렬해 묶고 CHECK `sub_perk1 < sub_perk2` 추가, 같은 창 즉시 재집계, 오래된 주석 수정, 테스트 012 추가·011 확장, 계약 문구(티어당 250명, 4 : 4 : 2 삭제, pg_cron 권한, `ANALYZE` 이유) (016, 계약 v8) | Riot은 보조 룬을 누른 순서로 줘서 같은 페이지가 두 줄로 세어져 1순위 = 2순위인 챔피언 × 포지션이 106개였다. 계약 문구도 실제 수집과 달랐다 | 적용, Review PASS with issues (Low 3). 1순위 = 2순위 106 → 0, 룬 3,993 → 3,943줄, 다른 집계·원본 그대로(원본에서 JS로 다시 센 값과 전부 일치). 016 뒤 첫 예약 작업은 확인 대기 |

---

## 10. 해결되지 않은 점

요약: 동작을 막는 문제는 없다. 다른 영역에 전할 것, 다음 예약 작업 확인, 운영에서 챙길 것들이다.

1. **프론트 보조 룬 순서.** 이제 API의 보조 룬 2개가 번호순으로 온다. 룬 격자 화면은 영향이 없지만, 요약 문장(`frontend/src/lib/view/builds.ts`의 `chosenNames`)은 이 순서대로 이름을 붙인다. `!프론트`가 Data Dragon 룬 줄 순서로 정렬하면 된다 (결정 04-E, API 계약 변경 없음).
2. **016 뒤 첫 예약 작업을 아직 확인하지 못했다.** 2026-10-16 20:00 UTC(10-17 05:00 KST) 실행 뒤 `cron.job_run_details` 성공과 `champion_rune`의 `sub_perk1 >= sub_perk2` 0줄을 확인한다 (6장 쿼리).
3. **예약 작업이 실패해도 알림이 없다.** `cron.job_run_details`나 `stats_window.aggregated_at`을 누가 봐야 안다. 백엔드 API의 `aggregatedAt`·`isStale`로 확인하고, 알림은 아직 계획이 없다.
4. **무료 플랜은 7일 동안 쓰지 않으면 일시정지된다.** 일시정지 중에는 예약 작업도 돌지 않는다. 대시보드에서 다시 켜야 한다.
5. **새 수집이 없으면 집계 창이 비어 간다.** 마지막 게임이 2026-10-14 15:40 UTC라, 수집 없이 2026-10-28 20:00 UTC(10-29 05:00 KST) 집계부터는 0게임(P0002) 실패가 나고 이전 집계가 계속 보인다. 수집은 지금 사람이 직접 돌린다.
6. **오래된 원본 삭제가 수동이다.** 2026-10-21부터 21일 넘은 게임이 생긴다. 백엔드 `purge --yes`를 사용자가 확인하고 실행해야 한다.
7. **안 쓰는 인덱스가 있다.** `match_players (champion_id, team_position)` 인덱스(10MB)는 집계가 쓰지 않는다. 수집 규모를 키운 뒤에도 안 쓰이면 새 마이그레이션으로 삭제를 제안한다 (삭제라 승인 필요).
8. **`match_players` 인덱스에 빈 공간이 많다.** 인덱스 51MB가 본문 9MB보다 훨씬 크다. 지금 용량에는 문제없고, 필요하면 `REINDEX`를 사용자 승인 뒤 검토한다.
9. **티어 기준값과 스킬 11레벨 제외 비율을 실제 분포로 다시 보지 않았다.** 기준값(50판, 경계 53.0 등)은 사용자 결정으로 유지 중이다. 표본이 늘면 티어 분포와 `length(skill_order) < 11` 비율을 재고, 바꿀 때는 새 마이그레이션으로 한다.
10. **`matches.puuid` FK에 인덱스가 없다.** 지금은 표본을 지우는 기능이 없어 문제없다. 그 기능을 만들면 `matches (puuid)` 인덱스를 함께 추가한다.
11. **실행기는 마지막보다 작은 번호의 새 파일도 경고 없이 적용한다.** 결정 04-G로 고치지 않았다. 새 파일 번호는 항상 마지막보다 크게 붙인다 (다음은 017).
12. **계약 `db_contract.md`에 상단 목차가 없다.** 다음 `!db` 계약 수정 때 넣는다.
