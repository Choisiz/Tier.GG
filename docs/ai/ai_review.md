# AI 영역 검토 기록 — B4 4단계 RAG 붙이기

> 가장 최근 검토만 둔다. 검토일 2026-11-04, 검토자 독립 Review 에이전트. 계획 [`ai_spec.md`](./ai_spec.md) B4절 · 구현 [`ai_build.md`](./ai_build.md) 19장.

## 목차

1. 판정
2. 확인한 것과 결과
3. 발견 사항
4. 실행한 명령

## 1. 판정

**PASS with issues** (결함으로 고친 것 없음, 작은 개선점 4건). 완료 기준 B4-7 1~5 충족. 사용자 채점(근거 없는 주장·조언 구체성)이 남아 RAG를 기본으로 켤지는 아직 판단할 수 없다.

## 2. 확인한 것과 결과

| 항목 | 결과 |
|------|------|
| typecheck · lint · test | 오류 0, 443개 통과 (Build 보고와 같음) |
| `rag ingest` 미리보기 | 조각 81개, 새 0 · 본문 바뀜 0 · 메타 0 · 그대로 81 · 문서에 없음 0. `knowledgeVersion` `d8a341175b64`. 임베딩·쓰기 없음 (`--yes` 안 씀) |
| `rag eval --check` | 20문항·조각 81개 검사 통과 (네트워크 없음) |
| 실제 Voyage 1회 `rag search` | ADC·교전 딜·부족 질의에 `fight.damage.ALL.bad.01` → `ADC.bad.01` → `ADC.bad.02` 순 반환. 실제 검색 정상 |
| `feedback --replay --rag` / `--replay` | 둘 다 호출 0·0원, 요청 불일치 0. RAG 5판은 1차 51/54·재시도 3·템플릿 1·최종 0/0/0, RAG 없음은 52/54·재시도 2·템플릿 1·최종 0/0/0 (Q1과 같음) |
| RAG 꺼짐 = Q1 요청과 바이트 동일 | 위 `--replay`(Q1 녹화본)가 불일치 0 + 단위 테스트(Q1 5판 요청 해시 일치)로 확인. `promptVersionFor(false)` = `2026-11-04.1`, API 캐시 키도 RAG 꺼짐이면 옛 키 |
| 숫자는 facts에서만 | 지식 문서 숫자 검사: 소제목·meta 줄 밖 숫자 0. 최장 본문 213자(≤600). 표본 조각(유틸서폿 6개 전부 + 파일 목록)이 모두 "~일 수 있다"·"볼 수 있다" 완곡체, 다음 판 조언 포함. `chunks.ts`가 숫자 포함을 오류로 막음. 검증기의 숫자·방향·단위·금지어 규칙은 diff에서 삭제된 줄 없음(조각 ID 검사 추가만) |
| chunkIds·chunkUse 검증 | 준 조각 밖 ID, 조각 없이 ID → `shape`(재시도 대상). `chunkUse`의 없는 칸 → extras. 조각을 준 요청에서 안 적은 칸 → 빈 배열. 단위 테스트 있음 |
| API 연결 | `FEEDBACK_RAG_ENABLED` 기본 false(`FEEDBACK_ENV_DEFAULTS.ragEnabled`). 검색 3초 상한(`withTimeout` + Voyage `timeoutMs`), 실패 시 경고 로그만 남기고 RAG 없이 진행, 그 결과는 10분 템플릿 캐시에 넣음. 키 없음·문서 오류면 RAG 끔. `meta.knowledgeVersion`은 조각을 실제로 준 판만 채움 |
| 키 노출 | 로그에는 `voyageKey=있음`만. Voyage 오류 메시지에 키·본문 없음(`HTTP <상태>` 등). `.env.example`에 값 없이 추가 |
| `process.env` 위치 | `src/cli/*`·`config/env.ts`·`server.ts`·기존 `lib/logger.ts`(마스킹)뿐. `analysis/rag/**`·`api/**`에는 없음 |
| SQL | 검색 `search_rag_chunks($1::extensions.vector, $2 …)`, 적재 `$10::extensions.vector`, 모두 매개변수 방식. 문자열 이어 붙이기 없음 |
| ingest 지우기 | `--prune --yes`일 때만 `DELETE`(기본 미리보기·`--yes`만으로는 지우지 않음). 임베딩은 트랜잭션 밖에서 먼저 |
| 장부 산수 | 장부 23줄 합 **$1.3429**, 프롬프트 `2026-11-04.2` 줄 합 **$0.5020**. 실패 1회차(400 문법 크기) 줄은 $0. 비교표 합계($0.5020)와 일치. 상한 $1.50 안 |
| 계약·DB·프론트 | 수정 없음 (git 상태 확인) |

## 3. 발견 사항

심각도 순. 결함(고쳐야 할 것)은 없고 모두 개선 후보다.

1. (낮음) **`--replay --rag` 결과 파일의 비용 표시가 녹화본 비용 $0.5020**이다. 호출 0·0원인 것은 맞지만 출력만 보면 돈을 쓴 것처럼 읽힌다. 재생 모드에서는 "녹화 비용(재생이라 0원)"으로 표기하면 혼동이 줄어든다. 재생 때마다 결과·채점표 파일이 `results/`에 쌓이는 점도 같다(이번 검토에서 만든 6개는 지움).
2. (낮음) **API 검색 시간 초과 때 DB 질의는 중단되지 않는다.** `withTimeout`은 기다림만 끝내고, 풀의 쿼리는 끝까지 돈다. 지금은 질의가 짧고 풀이 있어 영향이 작지만, 동시 분석이 늘면 커넥션을 붙잡을 수 있다. 서비스로 켜기 전 `statement_timeout`이나 풀 크기를 정한다.
3. (낮음) **`chunkUse`에서 같은 칸에 같은 조각 ID가 두 번 오면 중복으로 이어 붙는다**(`verify.ts`). 틀린 ID는 아니라 검증은 통과한다. 사용 조각 수 통계가 약간 부풀 수 있다. 중복 제거 한 줄이면 된다.
4. (정보) **효과는 아직 입증되지 않았다.** 5판에서 1차 통과 52→51, 재시도 2→3, 비용 +27%(입력 +21%, 출력 +32%), 시간 +32%. 조각을 쓴 칸은 28/54. 조언이 더 구체적인지·근거 없는 주장이 줄었는지는 사용자 채점표로만 판단된다. 검색 평가 100%는 필터가 거의 정한 결과라(Build 19-2에 이미 적힘) 벡터 검색 품질의 증거로는 약하다.

Build가 보고한 계획과 다른 점은 모두 타당하다: `chunkUse` 하나로 바꾼 것(문법 크기 400, 근거 확인됨, 계획 결정 표에 기록), 1회차 $0 시도(장부에 $0으로 남음), CLI 전용 Voyage 429 재시도(API는 기본 0이라 3초 상한 유지), `env.ts`·`server.ts`·`service.ts` 수정(B4-4 범위, 꺼짐이면 `buildRag`가 null).

## 4. 실행한 명령

`npm run typecheck`, `npm run lint`, `npm test`, `npm run rag -- ingest`(미리보기), `npm run rag -- eval --check`, `npm run rag -- search …`(Voyage 1회, 무료), `npm run feedback -- --set test/eval/set5 --replay test/eval/recordings [--rag]`(각 2회). Anthropic 호출·`--yes`·`.env` 값 출력 없음. 재생이 만든 결과 파일은 지웠고 장부는 그대로다.
