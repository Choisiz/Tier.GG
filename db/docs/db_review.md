# DB 검토 (변경 05. RAG 벡터 저장소 `rag_chunk`)

- 검토일: 2026-11-04, 독립 Review (Build와 분리). 판정: **PASS with issues** (결함 없음, Low 3)
- 범위: `db/migrations/017_create_rag_chunk.sql`, `db/tests/013_rag_chunk.sql`, `db/tests/006_security.sql`, 계약 v9(`db_contract.md`, `.dbml`), `db_spec.md` 변경 05

## 목차

- [확인한 명령](#확인한-명령)
- [독립 확인 결과](#독립-확인-결과)
- [판단](#판단)
- [이슈](#이슈)

## 확인한 명령

| 명령 (`db/`) | 결과 |
|------|------|
| `npm run migrate:status` | 001~017 모두 적용됨 |
| `npm run migrate:fresh-check` | 17개 파일 통과, 임시 스키마 테이블 12·뷰 1·함수 5, ROLLBACK, 스키마 남지 않음 |
| `npm run verify` | 12개 파일 모두 통과 (013 포함), 전후 줄 수 동일, 샘플 데이터 남지 않음 |

## 독립 확인 결과

Build 테스트와 별개로 실제 Supabase에 직접 조회·롤백 트랜잭션 샘플(손으로 만든 1,024차원 벡터 7행)로 확인했다.

1. 구조: 컬럼 14개 타입·NULL·기본값(`updated_at now()`)이 계약 v9와 같다. CHECK 13개, 인덱스는 `rag_chunk_pkey (id)`와 `rag_chunk_area_role_idx (area, role)` btree 2개뿐 (벡터 인덱스 없음). `vector` 확장은 `extensions` 스키마.
2. 보안: RLS 켜짐·FORCE 아님·정책 0. `SET LOCAL ROLE anon`으로 조회하면 42501. `anon`·`authenticated`의 테이블 권한 없음. `search_rag_chunks` ACL은 `postgres`, `service_role`만 (PUBLIC·anon·authenticated 없음).
3. 필터 의미: 유형 `ALL`, 포지션 `ALL`, 영역 `general`, 과목 NULL, 방향 `any` 조각이 포함되고, 다른 유형·과목·방향(`bad`)은 빠졌다. 챔피언 조각은 `champion_id`가 같을 때만 나오고 `p_champion_id`가 NULL이면 없다. `p_subjects`가 NULL이면 과목 필터가 없고, 빈 배열이면 과목 NULL 조각만 남는다.
4. 정렬: 코사인 거리 오름차순 (`b2 0.0050 → b3 0.0199 → b1 0.0447`, 직접 계산한 1 − cos θ와 일치). `p_limit` 2 적용. `p_limit` 0·21·NULL은 모두 22023.
5. 기존 객체: 기존 마이그레이션 파일 변경 없음 (`git status`에서 017만 새 파일). 계약 diff에서 삭제된 줄은 버전·개수·문구 갱신뿐이고 기존 정의는 바뀌지 않았다. 테스트 006(스키마 전체 자동 검사)이 테이블 12·함수 5로 통과.

## 판단

- **05-A (`extensions.` 접두사)**: 타당하다. 실행기 search_path(`public, pg_catalog` / fresh는 `migration_check, pg_catalog`)를 건드리지 않고 실제·임시 스키마 양쪽에서 통과했다. 함수의 `SET search_path FROM CURRENT`도 `public, pg_catalog`로 고정되어 있어 연산자는 `OPERATOR(extensions.<=>)`로 명시된 덕에 문제없다. 대가는 호출자가 벡터 리터럴에 `::extensions.vector`를 붙여야 한다는 것(계약 12-1에 적혀 있음).
- **함수 안전성**: `SECURITY INVOKER`라 권한 상승이 없고, `STABLE`은 테이블만 읽으므로 맞다. search_path가 고정되어 있어 경로 가로채기 위험이 없다. `#variable_conflict use_column`으로 출력 컬럼명(id 등)과의 충돌을 막았다.
- **벡터 인덱스 없음(05-B)**: 1,000행 필터 검색 0.41ms, 전체 정렬 5.7ms로 근거가 있다.

## 이슈

| 번호 | 등급 | 내용 | 조치 |
|------|------|------|------|
| L1 | Low | `db/scripts/verify.mjs`의 `TABLES`(줄 수 전후 비교)에 `rag_chunk`가 없다. 013이 시작 때 `rag_chunk`를 비우고 롤백하므로 영향은 없으나, 롤백이 새더라도 감지되지 않는다. | 수정하지 않음 (db_overview 해결되지 않은 점 14). 다음 `db/scripts` 수정 때 추가 |
| L2 | Low | 013이 `DELETE FROM rag_chunk`로 시작한다. `verify`는 항상 ROLLBACK이라 안전하지만, 이 파일을 트랜잭션 밖에서 직접 실행하면 실제 조각이 지워진다. | 문서화만. 파일 머리에 "항상 ROLLBACK" 주석이 이미 있음 |
| L3 | Low | 현재 `rag_chunk`가 0줄이라 실제 임베딩(Voyage)으로 만든 벡터와 실제 적재는 검증하지 못했다. | 적재기 구현 후 `!ai` Build가 확인 |

수정한 파일 없음 (신규 마이그레이션 018 없음).
