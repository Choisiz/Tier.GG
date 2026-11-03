# AI 영역 계획 (`!ai`) — 기능 1: 게임 피드백 (LLM + RAG)

> 이 문서는 `!ai` 영역의 **현재 계획**만 둔다. 평가 기준 자체는 [`feedback_design.md`](./feedback_design.md), 쓸 수 있는 Riot 필드는 [`feedback_metrics.md`](./feedback_metrics.md)에 있다.
> 상태: **로드맵(A)과 1단계(B) 승인 (2026-11-02), 1단계 Build 완료 · Review 통과 (2026-11-02). 2단계(B2) 승인 (2026-11-03), Build 완료 (2026-11-03, 세나 판 1회 + 5판 기준선 1회, 장부 $0.4461), Review 조건부 통과 (2026-11-03, 사용자 채점·결정 대기)**. 구현 결과는 [`ai_build.md`](./ai_build.md), 검토 결과는 [`ai_review.md`](./ai_review.md). 3단계 이후(5장 C~L)는 단계마다 Plan에서 다시 승인받는다.

## 목차

- [1. 한눈에 보기](#1-한눈에-보기)
- [2. 이미 합의된 방향](#2-이미-합의된-방향)
- [3. 결정 사항](#3-결정-사항)
- [4. 로드맵과 1단계 (승인)](#4-로드맵과-1단계-승인)
  - [A. 단계 로드맵](#a-단계-로드맵)
  - [B. 1단계 상세: 판정 엔진 (LLM·RAG 없음)](#b-1단계-상세-판정-엔진-llmrag-없음)
  - [B2. 2단계 상세: LLM 문장 + 숫자 검증 + 템플릿 (RAG 없음, 승인 2026-11-03)](#b2-2단계-상세-llm-문장--숫자-검증--템플릿-rag-없음-승인-2026-11-03)
- [5. 다음 단계 계획 (미승인)](#5-다음-단계-계획-미승인)
  - [C. 전체 구조](#c-전체-구조)
  - [D. 분석 API 초안 (→ `api_contract.md` 변경 필요)](#d-분석-api-초안--api_contractmd-변경-필요)
  - [E. DB 변경 요청 (→ `db_contract.md`)](#e-db-변경-요청--db_contractmd)
  - [F. RAG: 지식 문서 작성·조각내기·임베딩·검색](#f-rag-지식-문서-작성조각내기임베딩검색)
  - [G. LLM: 프롬프트와 출력 JSON](#g-llm-프롬프트와-출력-json)
  - [H. 숫자·판정 검증](#h-숫자판정-검증)
  - [I. 캐시·비용·호출 한도](#i-캐시비용호출-한도)
  - [J. 오류 처리와 대체 출력](#j-오류-처리와-대체-출력)
  - [K. 평가 계획 (수치로 재기)](#k-평가-계획-수치로-재기)
  - [L. 새 의존성·외부 서비스와 환경 변수](#l-새-의존성외부-서비스와-환경-변수)
- [6. CLAUDE.md 반영](#6-claudemd-반영)
- [7. 사용자가 정해야 할 것](#7-사용자가-정해야-할-것)

---

## 1. 한눈에 보기

- 요약: 전적 검색의 **한 판**을 골라 "라인전·교전·운영의 좋은 점/부족한 점 + 결정적 장면 + 요약"을 한국어 문장으로 돌려주는 기능이다. **판단은 코드, 해석 자료는 RAG, 문장은 LLM**이 맡는다.

```
[전적 검색 매치 행] → "분석" 버튼
   → 백엔드: Riot match + timeline (1회)
   → ① 판정 엔진(코드): 지표 계산, 등급, 말할 순서, 결정적 장면, 요약 판정  ← 1단계
   → ② RAG 검색: 유형·과목에 맞는 관점 문서 + 챔피언 정보 + 빌드 통계      ← 4단계
   → ③ LLM(Claude): ①의 판정과 숫자, ②의 문서로 문장만 작성                ← 2단계(RAG 없이) → 4단계(RAG 붙임)
   → ④ 검증(코드): 문장 속 숫자·방향이 ①과 같은지. 틀리면 재시도 → 그래도 틀리면 템플릿 문장
   → 캐시(matchId + puuid) → 화면
```

| 용어 | 쉬운 뜻 |
|------|---------|
| LLM | 글을 쓰는 AI 모델. 여기서는 Anthropic의 Claude |
| RAG | "검색해서 찾은 자료를 LLM에게 같이 건네주는 방식". LLM이 아는 척 지어내지 않고, 우리가 쓴 해석 문서를 근거로 쓰게 한다 |
| 임베딩 | 글을 숫자 목록(벡터)으로 바꾼 것. 뜻이 비슷한 글은 숫자도 비슷해서 "뜻으로 찾기"가 된다 |
| 벡터 검색 | 질문의 임베딩과 가장 가까운 문서 조각을 찾는 것. Supabase의 `pgvector` 확장으로 한다 |
| 하이브리드 검색 | 먼저 "딜서폿·교전·딜" 같은 **조건(메타데이터)으로 거르고**, 남은 것 중에서 **뜻이 가까운 순**으로 고르는 것 |
| 조각(chunk) | 문서를 검색 단위로 자른 한 토막 |

## 2. 이미 합의된 방향

- 요약: 사용자와 메인 에이전트가 대화로 정한 것. 이 계획은 이 틀 안에서만 설계한다.

| # | 방향 |
|---|------|
| 1 | 판단(지표 계산, 등급, 반영 비율 순서, 결정적 장면 선택, 요약 판정)은 **코드**가 한다. LLM은 결과·근거 숫자·RAG 문서로 **문장만** 쓴다. 백엔드가 LLM 답의 숫자를 계산값과 대조해 검증한다 |
| 2 | RAG 지식 창고 = ① 포지션·유형별 관점·해석 문서(사용자 롤 지식 기반) ② Data Dragon 챔피언·아이템 정보 ③ 기존 DB의 챔피언별 빌드 통계. 저장은 Supabase pgvector, 하이브리드 검색 |
| 3 | 분석 대상은 전적 검색의 한 판. 분석 요청 때만 timeline 1회 호출. 결과는 matchId(+puuid) 기준 캐시 |
| 4 | **성적 지표를 DB에 쌓지 않는다** (사용자 결정). 패치노트 원문은 넣지 않는다 |
| 5 | LLM은 Claude(Anthropic API). 임베딩은 Claude에 없어 별도 서비스가 필요하다 |
| 6 | 최종 목표는 **RAG와 LLM을 반드시 쓰는 AX 프로젝트**. 다만 한 번에 만들지 않고 단계마다 검증한다 (CLAUDE.md 1장) |

## 3. 결정 사항

- 요약: 확정된 결정만 둔다. 새 단계에서 제안하는 결정은 그 단계의 `## 이번 변경 (승인 대기)`에 두고, 승인되면 이 표로 옮긴다.

| 결정 | 이유 | 날짜 |
|------|------|------|
| 판단은 코드, 문장은 LLM, 숫자는 코드가 검증 | LLM이 숫자를 지어내거나 판정을 바꾸는 것을 막기 위해 | 2026-11-01 |
| RAG 저장소는 Supabase pgvector, 하이브리드 검색(메타데이터 필터 + 벡터) | 이미 쓰는 DB 하나로 끝내고, 포지션·유형이 맞는 조각만 나오게 하려고 | 2026-11-01 |
| 분석 요청 때만 timeline 1회 호출, 결과는 matchId(+puuid) 캐시 | Riot 호출 한도(1초 20회, 2분 100회) 안에서 동작하게 | 2026-11-01 |
| 성적 지표를 DB에 쌓지 않음, 패치노트 원문 제외 | 사용자 결정 | 2026-11-01 |
| LLM = Claude(Anthropic API), 임베딩은 별도 서비스 | Claude에는 임베딩 API가 없음 | 2026-11-01 |
| AI 계획 문서 위치 = `docs/ai/ai_spec.md` | 기준 문서(`feedback_design.md` 등)와 같은 폴더 | 2026-11-01 |
| 7단계 로드맵: 엔진 → LLM(RAG 없이) → `!db` 벡터 → RAG → `!백엔드` API → `!프론트` 화면 → 평가·보정 | 작은 단위로 검증, 계약 순서 유지, RAG 효과를 기준선과 비교 | 2026-11-02 |
| 1단계는 LLM·RAG·DB·네트워크 없는 순수 함수 판정 엔진 + 세나 판 재현 테스트 | 가장 작고 숫자로 바로 검증 가능. 이후 모든 단계의 기반 | 2026-11-02 |
| AI 코드 위치 `backend/src/analysis/`, 기존 백엔드 파일은 수정하지 않음 | 같은 Node 프로세스에서 쓰되 영역 경계를 지킴 | 2026-11-02 |
| 경계값·비율은 `rules.ts` 한 곳에만. RAG 문서에는 숫자 경계를 쓰지 않음 | 숫자 출처를 하나로 해 LLM이 문서 숫자를 섞지 못하게 | 2026-11-02 |
| 엔진이 차이·합 같은 파생 숫자를 미리 계산해 `facts`로 넘기고, 검증기는 `facts`와만 대조 | LLM 계산 실수와 검증기의 추측을 없앰 | 2026-11-02 |
| LLM 실패·거절·키 문제는 오류 대신 템플릿 문장(200 `mode: "template"`) | 분석 결과(판정)는 항상 줄 수 있음 | 2026-11-02 |
| 빌드 통계는 임베딩하지 않고 기존 집계 표에서 조회 | 매일 바뀌는 숫자이고 정확 조회가 맞음 | 2026-11-02 |
| 관점 문서는 `###` 단위로 자르고(고정 길이 자르기 안 함), 바뀐 조각만 다시 임베딩 | 관점 하나 = 조각 하나라 뜻이 안 깨지고 비용이 적음 | 2026-11-02 |
| 유료 API를 부르는 평가·재적재는 예상 비용을 보여 주고 승인 뒤 실행 | 비용 통제 | 2026-11-02 |
| 좋은 점/부족한 점 분류: 라인전 +1 좋은 점·−1 부족한 점, 교전·운영 A·B 좋은 점·D·E 부족한 점·C 말하지 않음 | 사용자 결정 (N절 7번) | 2026-11-02 |
| 세나 판 원본을 fixture로 저장소에 넣음. 모든 참가자의 puuid·riotId·소환사 이름·summonerId·`metadata.participants`와 그 밖 계정 식별 값을 가림 (participantId·포지션·챔피언·수치는 유지) | 사용자 결정 (N절 13번) | 2026-11-02 |
| 유형 덮어쓰기 목록은 Build가 초안을 만들고 사용자가 검토. 검토 전에는 Data Dragon 첫 태그 규칙만 적용 | 사용자 결정 (N절 14번) | 2026-11-02 |
| 유형 덮어쓰기 적용: 서폿 카르마 → 유틸서폿, 모르가나 → 딜서폿, 라칸 → 탱서폿. 세트(서폿)는 보류 | 초안 검토 결과 (사용자 결정, `ai_build.md` 8장) | 2026-11-02 |
| 딜 비중은 반올림하지 않은 값으로 판정 (세나 판 교전 총점 25). `feedback_design.md` 9장을 엔진 결과로 고침 | 규칙 그대로 적용 (사용자 결정, N절 16번 ①) | 2026-11-02 |
| 결정적 장면: 격차 3,000 이상 후보를 격차 순 → 남은 자리는 킬 5개 이상 후보를 킬 수 순, 최대 3개. 설계 2-1 문구 수정 | 사용자 결정 (N절 16번 ②) | 2026-11-02 |
| 영혼 용 = 팀의 4번째 용. 경계 재계산: 정글 오브젝트 82/42/22/10, 교전 이득 78/64/40/24 (`ENGINE_VERSION` 2026-11-02.2) | 검산 스크립트의 영혼 용 판정 오류 수정 (사용자 결정, N절 16번 ③) | 2026-11-02 |
| 기본 LLM = `claude-opus-5-5`(개발·기준선), `FEEDBACK_LLM_MODEL`로 교체 가능. 7단계에서 `claude-sonnet-5-5`·`claude-haiku-5-5`와 같은 판 세트로 비교 후 서비스 모델 결정 | 사용자 결정. 5장 G-1의 Sonnet 기본 초안을 대체 | 2026-11-03 |
| Anthropic 인증은 API 키(`ANTHROPIC_API_KEY`) 방식. ID 페더레이션 안 씀 | 사용자 결정 | 2026-11-03 |
| Anthropic 크레딧 총 $5. 2단계 $1.00 상한(Build $0.80 + Review $0.20), 배분 2단계 $1 · 4단계 $0.75 · 5단계 $0.25 · 7단계 $2 · 예비 $1. CLI 기본 미리보기 + `--yes` + 장부·예산 상한(`FEEDBACK_BUDGET_USD`) | 사용자 조건. 예산을 넘기 전에 코드가 멈추게 (B2 2-10, 2-15 질문 1) | 2026-11-03 |
| 반복 개발은 가짜 클라이언트·녹화본 재생(0원). 실제 호출은 세나 판 1~2회 → 5판 기준선 1회. 20판은 7단계 | 비용 최소화 (2-15 질문 2) | 2026-11-03 |
| effort `low`부터, thinking 필드 생략, 구조화 출력(zod 없이 JSON 스키마), `max_tokens` 1차 4,000·재시도 2,000 | 토큰·비용 최소, Opus 5.5 제약(thinking 끌 수 없음) (2-15 질문 4) | 2026-11-03 |
| `max_tokens`를 1차 3,000·재시도 1,500으로 낮춤 | 세나 판 실측 출력 1,477토큰. 판당 최악 비용을 줄임 (사용자 승인, `ai_build.md` 16장 2번) | 2026-11-03 |
| 1단계 `invariants.test.ts` 엔진 import 검사의 대상에서 `analysis/llm/**`·`analysis/feedback.ts`를 뺌 | 계획대로 둔 2단계 코드(SDK·파일 import)가 엔진 검사에 걸림. 엔진 단언은 유지, 새 코드 경계는 `llm/misc.test.ts` (사용자 승인, `ai_build.md` 16장 1번) | 2026-11-03 |
| 서버측 fallback 2단계 미사용(거절은 템플릿), facts는 엔진 밖 `llm/facts.ts`, 재시도는 고칠 문장만 받는 작은 스키마 | 기준선·예산을 흐리지 않고 엔진을 고치지 않기 위해 (2-15 질문 5·6·7) | 2026-11-03 |
| 근거 없는 주장 비율은 사용자가 5판 문장을 직접 채점(LLM 채점기는 7단계), 챔피언 한국어 이름(내 챔피언·상대 라이너) 허용, 장부·녹화본 git 커밋, 콘솔 월 한도는 사용자가 설정 | 사용자 결정 (2-15 질문 8~11) | 2026-11-03 |
| `feedback_design.md` 9장 요약 예문 "3,900 넘게" → "약 3,900" | 실제 3,895라 검증기 어림 규칙상 틀린 표기 (2-15 질문 12) | 2026-11-03 |

---

## 4. 로드맵과 1단계 (승인)

- 요약: 2026-11-02 사용자가 로드맵(A)과 1단계 상세(B)를 승인했다. 1단계 구현 결과·설계와 다른 점은 [`ai_build.md`](./ai_build.md)에 있다.

### A. 단계 로드맵

- 요약: 7단계로 나눈다. **1단계는 LLM·RAG 없이** 판정 엔진만 만든다(가장 작고, 숫자로 맞는지 바로 확인 가능). **LLM은 2단계**, **RAG는 3~4단계**에 들어온다. 계약 순서 `!db` → `!백엔드` → `!프론트`는 3단계(`!db`) → 5단계(`!백엔드`) → 6단계(`!프론트`)로 지킨다.

| 단계 | 영역 | 만드는 것 | 완료 기준 (요약) | Review 수준 (CLAUDE.md 3장) | RAG·LLM |
|------|------|-----------|------------------|-----------------------------|---------|
| **1** | `!ai` | **판정 엔진**: match + timeline → 라인전·교전·운영 판정, 등급, 말할 순서, 결정적 장면, 요약 판정 JSON. 순수 함수 + 단위 테스트 | 세나 판 `KR_8437852704`의 설계 문서 9장 값 재현, 경계 사례 테스트 통과, typecheck·lint·test 0 오류 | 중간~큰 변경 → Plan·Build·**Review** (diff 검토 + 세나 판 표본 확인) | 없음 |
| **2** | `!ai` | **LLM 문장 생성 + 숫자 검증기 + 템플릿 대체 문장** (RAG 없이). 로컬 CLI로 고정 판 몇 개를 돌림. 첫 Claude 호출 | 고정 판 5개에서 최종 문장의 근거 없는 숫자 0개, 방향(좋음/부족) 불일치 0개. 판당 토큰·비용·시간 기록 | 중간~큰 → Review (diff + 실제 LLM 출력 표본) | **LLM 시작** |
| **3** | `!db` | `vector` 확장, RAG 조각 테이블, 검색 SQL 함수, RLS·권한 회수 (`db_contract.md` v9) | 계약과 실제 DB 일치, RLS 켜짐·정책 0, 샘플 조각으로 검색 함수 결과 확인, 마이그레이션 재적용 OK | DB → **항상 전체 독립 Review** | RAG 저장소 |
| **4** | `!ai` | **RAG**: 관점 문서 작성(사용자 검수) → 조각내기 → 임베딩 → 적재 CLI → 하이브리드 검색 → 2단계 생성기에 붙임. 챔피언 정보(Data Dragon), 빌드 통계 조회 | 검색 평가 세트에서 유형 일치율 100%, Recall@4 ≥ 0.8. RAG 켬/끔 비교 결과 기록 | 중간~큰 → Review. 임베딩 모델을 바꾸거나 전체 재적재하면 전체 Review | **RAG 시작** |
| **5** | `!백엔드` | **분석 API** `POST /api/v1/matches/:matchId/feedback` (Riot 호출, 캐시, 하루 상한, 오류 매핑), `api_contract.md` v4 | 계약대로 응답, 키 만료·LLM 실패·상한 초과 처리, 실제 Riot 판 몇 개 확인 | 외부 유료 호출·계약 변경 → **전체 독립 Review** | 연결 |
| **6** | `!프론트` | 매치 행의 "분석" 버튼과 피드백 화면. **정적 HTML 목업 먼저 승인** (CLAUDE.md 10장) | 목업대로 구현, 로딩(수 초)·대체 출력·오류 상태, 모바일·데스크톱 | 새 기능 → Review | 화면 |
| **7** | `!ai` | **평가·보정**: 고정 판 20개 평가 자동화, 총점 경계(70·40)·등급 경계 재보정, 프롬프트·검색 개선, 모델 비교(Opus 5.5 기준선 vs Sonnet 5.5·Haiku 5.5) | K절 지표 표를 채우고 목표 충족. 바뀐 경계는 `feedback_design.md` 결정 사항에 기록 | 경계·프롬프트 변경 → Review | 품질 |

- 2단계를 RAG보다 먼저 두는 이유: ① LLM 연결·검증기가 DB 없이 바로 검증된다. ② **RAG 없이 만든 결과가 기준선(baseline)**이 되어, 4단계에서 "RAG를 붙였더니 근거 없는 주장이 몇 % 줄었다"를 수치로 말할 수 있다 (커리어 기록에도 쓸 수 있는 근거).
- 3단계(`!db`)는 2단계와 순서상 겹쳐도 된다(서로 의존하지 않음). 다만 **임베딩 서비스와 벡터 차원 수가 정해져야** 테이블을 만들 수 있으므로 N절 질문 1번이 먼저 답해져야 한다.
- 각 단계는 끝날 때마다 사용자 승인 뒤 다음 단계 Plan을 시작한다. 로드맵 전체와 **1단계 상세**(2026-11-02), **2단계 상세 B2**(2026-11-03)가 승인되었다. 3단계부터도 단계마다 이 문서에 `## 이번 변경 (승인 대기)`를 새로 쓴다.

### B. 1단계 상세: 판정 엔진 (LLM·RAG 없음)

- 요약: `feedback_design.md`의 규칙을 그대로 코드로 옮긴다. 입력은 Riot JSON 두 개와 "누구를 분석할지"(puuid), 출력은 판정 JSON 하나다. 네트워크·DB·LLM을 전혀 쓰지 않는 순수 함수라서 테스트로 끝까지 확인할 수 있다.

#### B-1. 입력과 출력

| 구분 | 내용 |
|------|------|
| 입력 | `match`(match-v5 상세), `timeline`(match-v5 timeline), `puuid`, `championTags`(Data Dragon 챔피언 태그 표. 엔진은 받기만 하고 내려받지 않는다) |
| 출력 | `AnalysisResult` (아래). 화면용 문장은 없다. 숫자·판정·순서만 있다 |
| 버전 | `ENGINE_VERSION` 상수 (예: `"2026-11-01.1"`). 규칙·경계값이 바뀌면 올린다. 5단계 캐시 키에 들어간다 |

```jsonc
// AnalysisResult 초안 (필드 이름은 Build에서 다듬을 수 있다).
// participantId·초 단위 시각은 모양을 보여 주는 예시 값이다. 실제 기대값은 B-3 표(설계 9장)를 따른다.
{
  "engineVersion": "2026-11-01.1",
  "matchId": "KR_8437852704",
  "player": { "participantId": 9, "championId": 235, "position": "UTILITY", "role": "SUPPORT_DAMAGE", "win": false, "durationSec": 1380 },
  "laning": {
    "referenceSec": 900, "referenceReason": "15분 (바텀 1차 포탑 15.9분보다 빠름)",
    "opponent": { "participantId": 4, "championId": 22 },
    "items": [
      { "id": "laning.gold",  "me": 3958, "enemy": 4661, "point": -1 },
      { "id": "laning.level", "me": 8,    "enemy": 8,    "point": 0 },
      { "id": "laning.kda",   "me": 1,    "enemy": 5,    "point": -1, "detail": { "me": [0,2,3], "enemy": [2,1,4] } }
    ],
    "sum": -2, "verdict": "열세"
  },
  "fight": {
    "weights": { "advantage": 5, "damage": 60, "vision": 30, "objective": 5 },
    "subjects": [
      { "id": "fight.damage", "grade": "D", "score": 15, "maxScore": 60, "facts": { "share0_15": 15, "expected0_15": 18, "share15_30": 13, "expected15_30": 16 } },
      { "id": "fight.vision", "grade": "E", "score": 0, "maxScore": 30, "facts": { "perObjective": 0.5, "objectives": 4, "points": 2 } }
      // advantage, objective …  (매길 수 없는 과목은 "grade": null, 남은 비율로 100점 환산)
    ],
    "total": 17.5, "verdict": "부족"
  },
  "macro":  { "subjects": [ /* 운영 이득, 단독 킬·데스, 사이드 압박, 중후반 파밍, 평소 시야 */ ], "total": 16.25, "verdict": "부족" },
  "keyMoments": [
    { "startSec": 906, "endSec": 936, "kills": 5, "playerDied": true, "goldDiffBefore": -3324, "goldDiffAfter": -7219, "change": 3895, "direction": "widened", "after": ["BOTTOM 1차 포탑 파괴"] }
  ],
  "summary": { "laning": "열세", "fight": "부족", "macro": "부족", "keyMomentIndex": 0 },
  "speakOrder": {          // 반영 비율 × 등급으로 정한 "말할 순서" (점수를 많이 깎은/올린 순)
    "good": [ ],
    "bad":  [ "fight.damage", "fight.vision", "macro.vision", "macro.advantage", "laning.gold" ]
  },
  "notes": [ { "id": "fight.firstDeath", "kind": "interpretation", "text": "딜러가 먼저 죽고 패배" } ]  // 5-4-1: 점수에 안 넣는 추정
}
```

- 좋은 점/부족한 점 분류 규칙(**사용자 승인 2026-11-02**, N절 7번): 라인전 +1 = 좋은 점, −1 = 부족한 점. 교전·운영 과목은 **A·B = 좋은 점, D·E = 부족한 점, C = 말하지 않음**. 순서는 "그 과목이 총점에서 올리거나 깎은 점수"(반영 비율 × 등급 점수와 50%의 차이)가 큰 순, 같으면 반영 비율 큰 순.
- Build에서 다듬은 출력 모양: `speakOrder`는 영역별 `{ laning, fight, macro }`마다 `{ good, bad }`. 과목에 `impact`(말할 순서 근거)·`reason`(매기지 않은 이유), 결정적 장면에 `swing`(우리 팀 기준 뒤 − 앞)·`gapChange`(|뒤| − |앞|)·`selectedBy`·`followUps`, 라인전에 `deathsBeforeReferenceSec`, 맨 끝에 `warnings`. 실제 `ENGINE_VERSION`은 `"2026-11-02.2"`. 실제 출력 예는 `ai_build.md` 4장.
- 화면에 점수·등급을 보여주지 않는 결정(2026-10-31)은 그대로다. 등급·총점은 이 JSON 안에서 **근거와 순서**로만 쓴다.

#### B-2. 코드 위치 (모두 새 파일)

| 파일 | 내용 |
|------|------|
| `backend/src/analysis/types.ts` | 엔진 입력·출력 타입. 엔진이 쓰는 timeline 필드 타입도 여기 둔다 (기존 `riot/types.ts`는 수정하지 않는다) |
| `backend/src/analysis/rules.ts` | `feedback_design.md`의 모든 표(반영 비율, 딜 기대 비중, 등급 경계, 오브젝트 점수, 킬 점수, 시야 점수, 창 길이 40초·60초, 싸움 20초 묶음)를 상수로. **표 하나 = 상수 하나**, 각 상수 위에 설계 문서 절 번호 주석 |
| `backend/src/analysis/role.ts` | 유형 10개 판정 (Data Dragon 첫 태그 + 서폿 3종 + **덮어쓰기 목록**: 카르마·모르가나·라칸 적용, 세트 보류. N절 14번, `ai_build.md` 8장) |
| `backend/src/analysis/timeline.ts` | 참가자 매핑, 분 스냅샷 읽기, 팀 골드 차, 이벤트 거르기 도우미 |
| `backend/src/analysis/fights.ts` | 싸움 묶기(20초), 오브젝트 창(처치 앞뒤 40초, 겹치면 합침), 창 안/밖 분류 |
| `backend/src/analysis/laning.ts` | 3장: 기준 시점(min(15분, 그 라인 1차 포탑), 최소 10분, 서폿=바텀, 정글=15분), 골드·레벨·KDA·CS |
| `backend/src/analysis/fight.ts` | 5장: 딜(구간별 기대 비중), 오브젝트(막타), 이득 여부(우리 팀 몫), 시야(직전 60초) |
| `backend/src/analysis/macro.ts` | 6장: 운영 이득, 단독 킬·데스, 사이드 압박, 중후반 파밍, 평소 시야 |
| `backend/src/analysis/keyMoments.ts` | 2-1: 격차 변화 3,000 이상 또는 킬 5개 이상, 정렬, 최대 3개, 좁혀짐/벌어짐 |
| `backend/src/analysis/summary.ts` | 2-2: 라인전 우세/열세/비슷, 총점 70·40 경계, 말할 순서 |
| `backend/src/analysis/score.ts` | 4장 공통: 등급 → 점수, 매길 수 없는 과목 제외 후 100점 환산 (Build에서 추가) |
| `backend/src/analysis/index.ts` | `analyzeMatch(input): AnalysisResult` 하나만 밖으로 낸다 |
| `backend/src/cli/analyze.ts` + `package.json` 스크립트 `analyze` | **로컬 JSON 파일만** 읽어 결과를 출력하는 개발용 명령 (`npm run analyze -- --match <파일> --timeline <파일> --puuid <값>`). Riot·DB를 부르지 않는다 |
| `backend/test/unit/analysis/*.test.ts` | 단위 테스트 (B-3) |
| `backend/test/fixtures/KR_8437852704.{match,timeline}.json` | 세나 판 원본. **모든 참가자의 닉네임·태그·puuid·summonerId·`metadata.participants`와 계정을 좁힐 수 있는 값(프로필 아이콘·소환사 레벨)을 가려** 저장 (기존 fixture 관례, N절 13번) |
| `backend/test/fixtures/ddragon/champion-tags.json` | 테스트용 Data Dragon 챔피언 태그 스냅숏 (판의 패치 버전 기록) |

- 세나 판 원본은 메인 에이전트가 이미 받아 둔 파일을 썼다(1단계 Build는 Riot API를 부르지 않았다). 참고: Python `urllib` 기본 User-Agent는 Riot 방화벽에서 403(error code 1010)으로 막힌다. 판을 더 받을 때는 Node 클라이언트를 쓴다.

#### B-3. 테스트

| 묶음 | 확인 내용 |
|------|-----------|
| 세나 판 재현 (핵심) | 라인전: 기준 15분, 골드 3,958:4,661(−1), 레벨 8:8(0), (K+A)−D 1:5(−1), 합 −2 → 열세. 교전: 딜 C(반올림 전 15.25%·12.54% vs 18·16 → −2.75%p C·−3.46%p D, 평균 37.5% → C 22.5점. 2026-11-02 사용자 결정 N절 16번 ①로 D·17.5에서 고침), 시야 E(0.5), 이득 E(4.5%), 오브젝트 C, 총점 25 → 부족. 운영: 운영 이득 E(25%), 단독 킬·데스 C(0), 사이드 압박 B(87), 평소 시야 E(0.91), 총점 16.25 → 부족. 결정적 장면 3개의 시각·킬 수·격차 변화(+3,895 / +3,887 / −465)·방향 |
| 규칙 단위 | 등급 경계값 바로 위·아래, 반영 비율 합 100, 매길 수 없는 과목 제외 후 100점 환산, 딜 구간 3분 미만 제외, 20분 미만 게임 중후반 파밍 제외, 서폿 파밍 비율 0 |
| 경계 사례 (가짜 timeline) | 정글 15분 고정, 10분 전 포탑 파괴 → 10분, 같은 포지션 상대가 0명·2명 → 라인전 판정 불가, 오브젝트 싸움에 한 번도 안 낌 → 이득 여부 제외, 영혼 용·장로용 점수, 오브젝트가 한 번도 안 나온 판, 15분 미만 게임 |
| 두 번째 판 | 기존 fixture `KR_8408851980`: 10명 모두 오류 없이 돌고, 총점이 0~100 안, 반영 비율 합 100 (불변 조건) |
| 유형 | 대표 챔피언 표(설계 7장 예시: 알리스타·오른·세나·룰루 등)가 맞는 유형으로 나옴 |

- **설계 문서 숫자와 코드 결과가 다르면 테스트를 코드에 맞춰 고치지 않는다.** 어느 쪽이 맞는지(설계 9장의 손계산 vs 코드)를 원인과 함께 메인 에이전트에게 보고하고, 사용자가 정한 쪽으로 맞춘다. 사용자가 정하기 전까지 설계 값 단언은 `todo` 테스트로 둔다 (1단계 Build의 딜 todo 3개는 사용자 결정 뒤 정식 테스트로 바꿈).

#### B-4. 1단계 완료 기준

1. `analyzeMatch`가 세나 판에서 B-3 "세나 판 재현" 값을 **모두** 낸다 (총점은 소수 둘째 자리까지 같음).
2. 규칙·경계 사례·두 번째 판·유형 테스트가 모두 통과한다. 기존 단위 테스트 164개도 그대로 통과한다.
3. `npm run typecheck`, `npm run lint`, `npm test` 오류 0.
4. 엔진은 네트워크·DB·환경 변수를 쓰지 않는다 (import 검사로 확인: `analysis/`가 `riot/`·`db/`·`repositories/`를 import하지 않음).
5. `npm run analyze`로 세나 판 결과 JSON을 사람이 읽을 수 있게 출력한다.
6. `docs/ai/ai_build.md`에 기능별 상태(✅ ⚠️ ❌ ⏸️)와 검증 결과를 기록한다.

- 1단계 Build 결과 (2026-11-02): 1~6 충족. 딜 1과목이 설계 9장과 달랐던 점(9장의 반올림 비교)은 사용자 결정으로 반올림 전 값을 유지하고 9장을 엔진 결과로 고쳤다 (교전 총점 25, `ai_build.md` 4~6장).

#### B-5. 1단계 작업 범위 (수정 가능한 경로)

| 단계 | 경로 |
|------|------|
| Build | `backend/src/analysis/**`(신규), `backend/src/cli/analyze.ts`(신규), `backend/package.json`(`scripts.analyze` 한 줄만), `backend/test/unit/analysis/**`(신규), `backend/test/fixtures/KR_8437852704.*.json`(신규), `backend/test/fixtures/ddragon/**`(신규), `docs/ai/ai_spec.md`(이번 변경 합치기), `docs/ai/ai_build.md`(신규) |
| Review | `docs/ai/ai_review.md`(신규), `docs/ai/ai_overview.md`(신규), `docs/career_log.md`(추가만), 문제 수정 시 위 Build 경로 |
| 수정 금지 | 그 밖의 `backend/src/**`(API·수집기·Riot 클라이언트), 계약 문서 2개, `frontend/`, `db/`, `CLAUDE.md`, `.env`·`.env.example` |

- 1단계는 새 의존성이 없다.

### B2. 2단계 상세: LLM 문장 + 숫자 검증 + 템플릿 (RAG 없음, 승인 2026-11-03)

- 요약: 2026-11-02 Plan, **2026-11-03 사용자 승인**(2-15 질문 12개 모두 추천대로). 1단계 엔진 결과로 facts를 만들고 → Claude가 문장만 쓰고 → 코드가 숫자·방향·금지어·길이·이름을 검사해 → 틀린 칸만 1번 다시 쓰게 하고 → 그래도 틀리면 그 칸만 템플릿으로 바꾼다. 크레딧 제약(**총 $5**, 사용자 조건)에 맞춰 반복 시험은 가짜 클라이언트·녹화본으로 0원, 실제 호출은 장부·예산 상한으로 묶는다.
- 구현 결과·실측(토큰·비용·통과율)·설계와 다른 점은 [`ai_build.md`](./ai_build.md) 11~17장.
- 2단계 유료 실행 승인 범위 (사용자 2026-11-03): 세나 판 1회 → (프롬프트를 고친 경우만) 세나 판 1회 더 → 5판 기준선 1회. Build는 장부 누적 **$0.80**에서 스스로 멈춘다(가드 상한 `FEEDBACK_BUDGET_USD` 기본 $1.00, Build 실행은 `FEEDBACK_BUDGET_USD=0.80`). 실행마다 미리보기 예상·최악 비용과 실제 비용을 장부와 `ai_build.md`에 남긴다.

#### 2-0. 한눈에 보기

- 요약: 1단계 엔진 결과(`AnalysisResult`)를 받아 → 코드가 **쓸 수 있는 숫자 목록(facts)**을 만들고 → Claude(`claude-opus-5-5`, effort `low`)가 정해진 JSON 모양으로 **문장만** 쓰고 → 코드가 숫자·방향·금지어·길이를 검사해 → 틀린 문장만 1번 다시 쓰게 하고 → 그래도 틀리면 그 문장만 **템플릿 문장**으로 바꾼다. 판단은 여전히 코드다.
- 개발 중 반복 시험은 **가짜 클라이언트와 녹화본(저장한 실제 응답)**으로 0원에 한다. 실제 호출은 세나 판 1~2회 → 5판 기준선 1회만, 매번 예상 비용을 보여 주고 승인받는다. CLI에 **누적 비용 장부와 예산 상한**을 둬서 상한을 넘기 전에 스스로 멈춘다.

```
AnalysisResult ─▶ facts.ts (숫자 목록 + 허용 표기) ─▶ prompt.ts (고정 시스템 + 판정 JSON)
   ─▶ client.ts (Claude 1회, 구조화 출력) ─▶ verify.ts ─┬─ 통과 ─────────────────────▶ 결과 (mode "llm")
                                                        └─ 실패 문장 ─▶ 재시도 1회 (고칠 문장만) ─▶ verify
                                                                         └─ 또 실패 ─▶ template.ts 문장으로 교체
   오류·거절·키 없음·예산 초과 ─▶ 전체 템플릿 (mode "template")
```

#### 2-1. 범위와 파일

- 요약: 새 파일은 `backend/src/analysis/llm/**`, `backend/src/analysis/feedback.ts`, `backend/src/cli/feedback.ts`, 테스트·평가 폴더뿐이다. **1단계 엔진 파일은 고치지 않는다**(`ENGINE_VERSION` 그대로). 기존 백엔드 파일·계약 문서도 고치지 않는다.

| 파일 (모두 새 파일) | 내용 |
|------|------|
| `backend/src/analysis/llm/facts.ts` | `buildFacts(result, championNames)`: 엔진 결과를 **평평한 숫자 목록**으로. 차이·절댓값·분 단위 시각 같은 파생값을 미리 계산하고, 값마다 허용 표기를 만든다 (2-4). 등급·점수·총점·반영 비율은 넣지 않는다 |
| `backend/src/analysis/llm/labels.ts` | 과목·fact ID → 한국어 이름(예: `fight.vision` → "오브젝트 전 시야"), 판정어 표(우세/열세/비슷, 잘함/보통/부족), 방향 단어 표 |
| `backend/src/analysis/llm/prompt.ts` | `PROMPT_VERSION`, 고정 시스템 프롬프트, 판마다 바뀌는 사용자 메시지 만들기, 재시도 메시지 만들기 (2-5) |
| `backend/src/analysis/llm/schema.ts` | 출력 JSON 스키마 2개(첫 답용, 재시도용)와 응답 모양 검사 함수(스키마 검사를 코드로 한 번 더) |
| `backend/src/analysis/llm/client.ts` | `LlmClient` 인터페이스 + Anthropic 구현(`@anthropic-ai/sdk`). **이 파일만 SDK를 import**한다. 오류를 우리 종류(`auth`/`billing`/`rate`/`server`/`timeout`/`bad_request`/`refusal`/`max_tokens`/`parse`)로 바꿔 돌려준다 |
| `backend/src/analysis/llm/fakeClient.ts` | 단위 테스트용 가짜 클라이언트(정해 둔 응답·오류를 순서대로 돌려줌)와 **녹화본 재생 클라이언트** (2-7) |
| `backend/src/analysis/llm/verify.ts` | 검증기: 모양·방향·숫자·금지어·길이·챔피언 이름 (2-6) |
| `backend/src/analysis/llm/template.ts` | 과목 × 방향 템플릿 문장, 요약·결정적 장면 템플릿 |
| `backend/src/analysis/llm/pricing.ts` | 모델별 가격표(참고값, 날짜 주석)와 `usage` → 비용(USD) 계산, 호출 전 최악 비용 계산 |
| `backend/src/analysis/llm/ledger.ts` | 사용량 장부(JSONL) 읽기·쓰기, 누적 비용, 예산 검사 (2-8) |
| `backend/src/analysis/llm/generate.ts` | 1차 호출 → 검증 → 재시도 1회 → 템플릿 교체를 묶는 함수 |
| `backend/src/analysis/feedback.ts` | `createFeedback(deps)(input): Promise<FeedbackResult>`. 엔진 → facts → 생성 → 검증 → 대체를 잇는 함수. `deps`로 클라이언트·장부·시계를 받아 테스트에서 바꿔 끼운다. 5단계 `!백엔드`는 이 함수 하나만 부른다 |
| `backend/src/cli/feedback.ts` | 로컬 파일로 실행. **기본은 예상 비용만 출력(네트워크 없음)**, `--yes`일 때만 호출, `--replay`는 녹화본으로 0원 실행 (2-8) |
| `backend/test/unit/analysis/llm/*.test.ts` | facts·verify·template·schema·generate(가짜 클라이언트)·ledger·pricing·CLI 미리보기 테스트 |
| `backend/test/eval/set5/` | 기준선 평가 판 5개(가림)와 `set.json`(판마다 분석할 participantId) (2-9) |
| `backend/test/eval/fetchSet.ts` | 평가 판 받기 스크립트 (DB 표본에서 matchId 고르기 → 기존 Node Riot 클라이언트로 match·timeline 받기 → 가림 → 저장). 기존 `src/riot`·`src/db`는 **import만** 한다 |
| `backend/test/eval/recordings/` | 실제 호출 녹화본 (2-7) |
| `backend/test/eval/usage-ledger.jsonl` | 유료 호출 장부 (2-8) |
| `backend/test/eval/results/` | 평가 실행 결과 JSON (지표 계산 근거) |

- 출력 `FeedbackResult` (5단계 API 응답 D-2의 재료. 계약은 `!백엔드`가 정한다):

```jsonc
{
  "mode": "llm",                     // "llm" = LLM 답을 썼음(일부 문장이 템플릿일 수 있음) | "template" = LLM 답을 전혀 못 씀
  "summary": { "text": "…", "source": "llm" },          // source: "llm" | "llm_retry" | "template"
  "sections": {
    "laning": { "good": [], "bad": [ { "subjectId": "laning.gold", "text": "…", "factIds": ["laning.gold.me", "laning.gold.enemy", "laning.gold.diffAbs"], "source": "llm" } ] },
    "fight":  { "good": [], "bad": [ … ] },
    "macro":  { "good": [ … ], "bad": [ … ] }
  },
  "keyMoments": [ { "index": 0, "text": "…", "factIds": [ … ], "source": "llm" } ],
  "meta": {
    "engineVersion": "2026-11-02.2", "promptVersion": "2026-11-02.1",
    "model": "claude-opus-5-5", "effort": "low",
    "attempts": 2,                    // 1 = 재시도 없음
    "verification": { "firstPass": 9, "firstTotal": 11, "retried": 2, "templated": 0, "failures": [ { "slot": "fight.bad.0", "rule": "number", "detail": "800 (facts에 없음)" } ] },
    "usage": { "input": 0, "cacheWrite": 0, "cacheRead": 0, "output": 0 }, "costUsd": 0, "durationMs": 0,
    "fallbackReason": null            // mode "template"일 때: "no_key" | "auth" | "billing" | "refusal" | "budget" | "timeout" | …
  }
}
```

- 말할 과목은 엔진 `speakOrder`에서 영역마다 좋은 점·부족한 점 **각각 최대 2개**(5장 F-5 1번과 같은 규칙). 라인전이 `null`이면 라인전 칸은 비우고 템플릿 한 줄("이 판은 라인전 상대를 비교할 수 없었습니다")만 둔다.

#### 2-2. 새 의존성과 환경 변수

- 요약: 새 의존성은 `@anthropic-ai/sdk` 하나. 구조화 출력은 **zod 없이** 원시 JSON 스키마로 보내고, 응답 검사는 우리 검증기가 한다(의존성 1개로 끝냄).

| 무엇 | 목적 | 왜 이것 | 버전 확인 방법 |
|------|------|---------|----------------|
| `@anthropic-ai/sdk` (dependencies) | Claude 호출 | 공식 SDK. 오류 종류별 클래스(`AuthenticationError`, `RateLimitError` 등), 재시도·시간 제한 옵션, `usage` 타입을 직접 만들 필요가 없다 | Build가 `npm view @anthropic-ai/sdk version`으로 최신 안정판 확인 후 `npm install @anthropic-ai/sdk@<그 버전>` (Plan 시점 2026-11-02 조회: `1.3.0`, **Build 2026-11-03 조회 `1.4.0`으로 고정**). `zod`는 선택 peer라 설치하지 않는다 |
| (안 넣음) `zod` | - | `messages.parse` + `zodOutputFormat`도 가능하지만, 스키마 검사는 어차피 검증기가 하므로 의존성을 늘리지 않는다. `messages.create` + `output_config.format: { type: "json_schema", schema }` 사용 | - |

`.env.example`에 추가할 변수 (Build가 함께 추가. 값은 쓰지 않는다. `ANTHROPIC_API_KEY`는 사용자가 이미 `.env`에 넣었다):

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `ANTHROPIC_API_KEY` | (없음) | Claude API 키. 서버·CLI 전용. 없으면 CLI `--yes`는 거절하고, `createFeedback`은 템플릿(`fallbackReason: "no_key"`) |
| `FEEDBACK_LLM_MODEL` | `claude-opus-5-5` | 문장 생성 모델. 7단계에서 `claude-sonnet-5-5`·`claude-haiku-5-5` 비교 |
| `FEEDBACK_LLM_EFFORT` | `low` | `low`/`medium`/`high`. 2단계는 `low` 고정 시험 |
| `FEEDBACK_BUDGET_USD` | `1.00` | **장부 누적 비용 상한**. 이 값을 넘을 수 있는 호출은 하지 않는다 (2-8) |

- `package.json`: `dependencies`에 SDK 한 줄, `scripts.feedback = "node --env-file=../.env --import tsx src/cli/feedback.ts"` 한 줄. (`--env-file`은 키를 읽기 위해 필요. CLI는 키 값을 출력하지 않고 "키 있음/없음"만 말한다.)
- 인증은 API 키 방식(`ANTHROPIC_API_KEY`)만. `ANTHROPIC_AUTH_TOKEN`이 같이 있으면 SDK가 두 헤더를 보내 401이 나므로(스킬 `error-codes.md` 401), 클라이언트는 `new Anthropic({ apiKey })`로 키를 명시해 만든다.

#### 2-3. 호출 설계 (Claude API)

- 요약: 근거는 Claude API 스킬 문서(`typescript/claude-api/README.md`, `tool-use.md` 구조화 출력, `shared/prompt-caching.md`, `shared/error-codes.md`, `shared/model-migration.md` "Migrating to Claude Opus 5.5"). 토큰을 줄이는 설정을 먼저 고른다.

| 항목 | 설계 | 근거·이유 |
|------|------|-----------|
| 모델 | `FEEDBACK_LLM_MODEL` (기본 `claude-opus-5-5`) | 사용자 결정. 가격 $4/$20 per 1M, 캐시 읽기 $0.20, 5분 캐시 쓰기 $5 (스킬 문서 값, 실행 전 재확인) |
| thinking | **보내지 않음**(생략 = adaptive). `{type:"disabled"}`·`budget_tokens`는 Opus 5.5에서 400 | Opus 5.5는 thinking을 끌 수 없고 effort로 조절. thinking 토큰은 **출력 요금**으로 과금되고 `max_tokens`에 포함된다 |
| effort | `output_config.effort: "low"` 명시 (모델 기본은 `medium`) | 문장 쓰기는 깊은 추론이 필요 없음. 스킬 문서: "lower effort before adding 'think less' prompts". 품질이 부족할 때만 세나 판 1회로 `medium` 비교(예산 안에서, 승인 후) |
| 구조화 출력 | `output_config.format: { type: "json_schema", schema }` (`additionalProperties: false`, 모든 필드 required) | 파싱 가능한 JSON 보장. `minLength`·`maximum`·배열 길이 제약은 지원되지 않으므로 **길이·개수는 검증기**가 본다. 응답은 `content`를 `type`으로 골라 `text` 블록만 JSON.parse (앞에 `thinking` 블록이 올 수 있음) |
| 거절 | `stop_reason === "refusal"`이면 내용 읽기 전에 처리 → 그 호출은 실패, 재시도하지 않고 템플릿 (`fallbackReason: "refusal"`, `stop_details.category` 로그) | 거절 응답은 스키마를 따르지 않을 수 있음. LoL 피드백 문장이라 거절 가능성은 낮다 |
| 서버측 fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) | **2단계는 쓰지 않음** (제안, 2-15 질문 5) | 스킬 문서는 Opus 5.5에 "첫날부터 opt-in"을 권한다. 그러나 ① 이 기능은 거절 시 다른 모델(Opus 5·4.8)이 **다른 요금**으로 다시 돌아 2단계 기준선(모델 1개의 품질·비용)을 흐리고 $5 예산 계산을 어렵게 한다 ② 거절 시 이미 템플릿 대체가 있어 "장애"가 되지 않는다 ③ 문장에 생물·사이버 주제가 없다. 5단계(서비스 연결) Plan에서 거절률 실측을 보고 다시 정한다 |
| 프롬프트 캐시 | 시스템 프롬프트 블록 하나에 `cache_control: { type: "ephemeral" }` (5분). 판마다 바뀌는 판정은 그 뒤 사용자 메시지. 시스템 프롬프트에 날짜·ID 등 바뀌는 값 금지 | Opus 5.5 최소 캐시 길이 512토큰 → 시스템 약 1,800토큰이면 캐시됨. 연속 실행(5분 안)에서 2번째 판부터 시스템 부분이 0.05배. 첫 호출은 1.25배 쓰기. `usage.cache_read_input_tokens`로 실제 적중 확인 |
| `max_tokens` | 1차 **4,000**, 재시도 **2,000** (세나 판 실측 후 조정 → **Build에서 1차 3,000·재시도 1,500으로 낮춤**, 3장 결정) | thinking + JSON 문장(약 1,500토큰 예상)을 담는 크기. 동시에 **한 호출의 최악 비용 상한**이 된다(4,000 × $20/1M = $0.08). `stop_reason: "max_tokens"`면 JSON이 잘렸을 수 있으므로 그 호출은 실패로 처리 |
| 쓰지 않는 파라미터 | `temperature`·`top_p`·`top_k`, `thinking.disabled`, `budget_tokens`, assistant prefill, 강제 `tool_choice`(`any`/`tool`) | Opus 5.5에서 400이거나 제거됨. 도구는 쓰지 않는다 |
| 생각 공개 요구 금지 | 프롬프트에 "추론 과정을 답에 써라"를 넣지 않는다 | `reasoning_extraction` 거절 원인 (스킬 문서). 근거는 `factIds`로만 받는다 |
| 시간 제한 | 요청당 `timeout: 60_000` (CLI·2단계). 5단계 API는 전체 30초 안으로 다시 정한다 | Opus `low` 응답 시간을 2단계에서 처음 잰다 |
| SDK 재시도 | `maxRetries: 1` (기본 2에서 줄임) | 429·5xx·연결 오류만 자동 재시도. 예산이 작아 반복 호출을 줄인다 |
| 재시도(검증 실패) 대화 | 1차 요청 메시지 + **1차 응답 `content` 그대로(thinking 블록 포함, 수정 금지)** + 새 사용자 메시지("이 문장들을 이유에 맞게 고쳐라") 를 **덧붙여서** 보낸다. 출력 스키마는 "고칠 문장만" 작은 스키마 | Opus 5.5 preserved thinking: 앞 메시지를 고치면 thinking 블록이 무효·400이 될 수 있어 **덧붙이기만** 한다. 고칠 문장만 받으면 재시도 출력이 약 300~1,000토큰으로 줄어든다. 스키마가 바뀌면 캐시가 깨질 수 있다(확인 필요, `usage`로 실측) — 그래도 출력이 줄어 더 싸다고 본다 |

오류 처리 (SDK 클래스 기준, 문자열 비교 금지):

| 오류 | SDK 클래스 / 상태 | `createFeedback` 처리 | CLI `--set` 처리 |
|------|------------------|-----------------------|------------------|
| 키 없음 | (호출 전 확인) | 템플릿, `no_key` | 시작 전 거절 |
| 401 인증 / 403 권한 | `AuthenticationError` / `PermissionDeniedError` | 템플릿, `auth` | **세트 전체 중단** |
| 402 결제(크레딧 소진) | `APIError` `status === 402` (`billing_error`) | 템플릿, `billing` | **세트 전체 중단** (크레딧 $5라 실제로 일어날 수 있음) |
| 404 모델 없음 | `NotFoundError` | 템플릿, `model_not_found` | 세트 전체 중단 |
| 400 요청 오류 | `BadRequestError` | 템플릿, `bad_request` (코드 버그. 로그에 메시지) | 세트 전체 중단 |
| 429 / 500 / 529 | `RateLimitError` / `InternalServerError` / `APIError` 529 | SDK 1회 재시도 후 템플릿, `rate`/`server` | 그 판만 템플릿, 다음 판 진행 |
| 시간 초과·연결 | `APIConnectionTimeoutError` / `APIConnectionError` | 템플릿, `timeout`/`network` | 그 판만 |
| 거절 | `stop_reason: "refusal"` | 템플릿, `refusal` (재시도 안 함) | 그 판만 |
| 잘림 | `stop_reason: "max_tokens"` | 1차면 템플릿 `max_tokens`, 재시도면 그 문장들만 템플릿 | 그 판만 |
| JSON 파싱·모양 실패 | (우리 검사) | 1차면 재시도 1회(전체를 다시) → 또 실패면 템플릿 `parse` | 그 판만 |

- 모든 호출(실패 포함, `usage`가 있으면)은 장부에 남긴다.

#### 2-4. facts: LLM이 쓸 수 있는 숫자 목록

- 요약: 3장 결정("엔진이 파생 숫자를 미리 계산해 `facts`로 넘기고, 검증기는 `facts`와만 대조")을 **엔진을 고치지 않고** `llm/facts.ts`에서 지킨다. 엔진 결과만 입력으로 하는 순수 함수라 원칙은 같고, `ENGINE_VERSION`·1단계 테스트가 그대로다 (2-15 질문 6).

```jsonc
// Fact 한 개
{ "id": "laning.gold.diffAbs", "label": "15분 골드 차이", "value": 703, "unit": "골드",
  "display": ["703"], "approx": { "step": 100 } }        // approx: "약 700" 같은 어림 표기를 허용할 때 단위
{ "id": "keyMoment.0.gapChangeAbs", "label": "싸움 뒤 골드 격차 변화", "value": 3895, "unit": "골드",
  "display": ["3,895", "3895"], "approx": { "step": 100 } }
{ "id": "keyMoment.0.startMin", "label": "싸움 시작", "value": 15.1, "unit": "분", "display": ["15.1분", "15분"] }
{ "id": "fight.damage.diff1Abs", "label": "15분 이후 딜 비중이 기대보다 낮은 정도", "value": 3.46, "unit": "%p", "display": ["3.46%p", "3.5%p"] }
```

| 묶음 | 넣는 숫자 (예) | 넣지 않는 것 |
|------|----------------|--------------|
| 라인전 | 기준 시점(분), 항목별 나·상대 값, 차이의 절댓값, KDA 세부(K·D·A), 기준 전 데스 수·시각(분) | `point`(+1/−1), `sum` |
| 교전·운영 과목 | 말할 과목의 `facts` 숫자 전부(평평하게: `fight.damage.share0` 등)와 미리 계산한 차이 절댓값 | `grade`, `gradePoint`, `score`, `impact`, `weight`, `total` (등급·점수·총점 숫자 금지) |
| 결정적 장면 | 시작·끝(분), 킬 수(전체·우리·상대), 앞·뒤 격차 절댓값, 격차 변화 절댓값, 이어진 일(포탑·오브젝트 이름은 문자열 label) | `selectedBy` |
| 이름 | 내 챔피언·상대 라이너 챔피언 한국어 이름(Data Dragon `ko_KR` 스냅숏 `name`), 유형 이름(`ROLE_LABEL`) | 그 판의 다른 8명 이름(문장에 쓸 일이 없음) |

- 부호는 숫자에 넣지 않고 **방향 단어**로 쓰게 한다(예: "703 적었습니다", "3,895 벌어졌습니다"). 그래서 차이값은 절댓값 fact로 준다.
- 표기 규칙(`display`를 만드는 규칙, `facts.ts` 한 곳에):
  - 정수: 그대로, 천 단위 쉼표 있는/없는 형태.
  - 소수(%·%p·분당): 원래 값(소수 둘째 자리까지)과 소수 첫째 자리 반올림. **정수로 반올림한 %p는 허용하지 않는다** (−2.75%p를 "3%p 낮음"이라 쓰면 "3%p 이상 낮으면 못함" 경계와 섞여 오해됨, `ai_build.md` 6-1).
  - 시각: 초 → "N분"(정수 분일 때), "N.N분"(소수 첫째 자리).
  - 어림(`approx`가 있는 골드·격차만): "약 N" = 값을 step으로 반올림한 N. "N 넘게"는 값 > N, "N 가까이"는 값 < N이고 차이가 step 이하일 때만. (설계 9장 예문 "3,900 넘게"는 실제 3,895라 **틀린 표기**다 → 2-15 질문 12)

#### 2-5. 프롬프트와 출력 JSON 스키마

- 요약: 시스템 프롬프트(고정, 캐시)에 규칙·문체·짧은 예시를, 사용자 메시지(판마다)에 판정과 facts를 넣는다. 출력은 `feedback_design.md` 2장 구성(요약 / 라인전·교전·운영 좋은 점·부족한 점 / 결정적 장면) 그대로다.

| 순서 | 블록 | 내용 | 바뀌는 빈도 |
|------|------|------|-------------|
| 1 | 시스템 (캐시) | 역할: "LoL 코치의 판정을 한국어 문장으로 옮기는 작성자. 판정은 이미 정해졌다." 규칙: ① 판정·방향을 바꾸지 않는다(좋은 점 칸에는 좋은 점만) ② **숫자는 사용자 메시지 `facts`의 `display` 표기만**, 아라비아 숫자로 ③ 등급 글자(A~E)·점수·총점·반영 비율을 쓰지 않는다 ④ 데이터가 직접 말하지 않는 해석(이니시, 버스, 무리한 진입 등)은 "~것으로 보입니다"로 끝맺고 근거 fact를 붙인다 ⑤ 주어진 챔피언 이름 외 다른 챔피언·아이템·룬을 말하지 않는다 ⑥ 존댓말(~습니다), 문장 하나 80자 안팎, 칸마다 1~2문장 ⑦ 문장마다 쓴 숫자의 fact ID를 `factIds`에 적는다 ⑧ 요약은 세 영역 판정 → 결정적 장면 1개 순서, 1~2문장 (설계 2-2). 좋은 예 1개·나쁜 예 1개(숫자 지어냄/방향 바꿈). | `PROMPT_VERSION`을 올릴 때만 |
| 2 | 사용자 (판마다) | 플레이어(챔피언·포지션·유형·승패·게임 시간), 요약 판정 3개 + 결정적 장면 index, 쓸 칸 목록(`slots`: `laning.bad.0 = laning.gold` …), 칸마다 쓸 수 있는 fact 목록, 결정적 장면과 이어진 일, 해석 노트(`notes`, "추정"으로 표시). JSON 한 덩어리 | 판마다 |
| 3 | 재시도 (덧붙임) | 실패한 칸, 실패 이유(예: "800은 facts에 없음. 쓸 수 있는 값: 703"), "이 칸들만 고쳐 다시 써라" | 재시도 때만 |

- `PROMPT_VERSION` 상수(Build 값 `"2026-11-03.1"`). 시스템 프롬프트·스키마·facts 표기 규칙이 바뀌면 올린다. 녹화본 파일 이름과 평가 기록에 들어간다.

첫 답 스키마 (요지. 실제는 JSON Schema, 모든 object `additionalProperties: false`, 모든 필드 required):

```jsonc
{
  "summary":  { "text": "string", "factIds": ["string"] },
  "sections": {
    "laning": { "good": [Item], "bad": [Item] },
    "fight":  { "good": [Item], "bad": [Item] },
    "macro":  { "good": [Item], "bad": [Item] }
  },
  "keyMoments": [ { "index": "integer", "text": "string", "factIds": ["string"] } ]
}
// Item = { "subjectId": "string", "text": "string", "factIds": ["string"] }
```

재시도 스키마: `{ "fixes": [ { "slot": "string", "text": "string", "factIds": ["string"] } ] }` (`slot` 예: `summary`, `fight.bad.0`, `keyMoment.1`).

- 스키마는 판마다 바뀌지 않는 **고정 모양**이다(과목 enum을 판마다 넣으면 스키마 컴파일·캐시가 매번 새로 됨). 어떤 과목·칸이 맞는지는 검증기가 본다.
- 4단계(RAG)에서 `Item`에 `chunkIds`를 더하고 `PROMPT_VERSION`을 올린다. 2단계 스키마에는 없다.

#### 2-6. 검증기, 재시도, 템플릿

- 요약: 문장마다 6가지를 검사한다. 실패한 문장만 이유와 함께 1번 다시 쓰게 하고, 그래도 실패하면 그 문장만 템플릿으로 바꾼다.

| # | 검사 | 규칙 | 실패 예 |
|---|------|------|---------|
| 1 | 모양 | JSON 파싱, 필드 모양, 칸 구성이 `slots`와 같음(빠진 칸·없는 칸·엔진이 안 고른 `subjectId` 없음), `factIds`가 모두 존재하는 ID, `keyMoments.index`가 엔진 결과 범위 | 엔진이 안 고른 과목을 씀 |
| 2 | 방향 | 좋은 점/부족한 점 칸이 엔진과 같음(1번에서 칸으로 보장). 요약에 세 영역 판정어(또는 허용 동의어, `labels.ts` 표)가 있고 **반대 방향 단어가 없음**. 결정적 장면은 `widened` ↔ "벌어/커지/기울", `narrowed` ↔ "좁혀/줄어/따라잡" | 열세인데 "비슷했습니다", 좁혀졌는데 "벌어졌습니다" |
| 3 | 숫자 | 문장의 숫자를 모두 뽑는다(쉼표 숫자, 소수, `%`·`%p`·`분`·`초`·`골드`·`킬`·`개`·`번` 등 단위 포함, "약/넘게/가까이" 어림 표현 포함). 한글 수사+단위("두 번", "세 명")도 숫자로 본다. 각 숫자가 **그 문장의 `factIds` 중 하나의 `display`/어림 규칙**과 맞아야 통과. 예외: "1차/2차/3차 포탑" 같은 이름 속 숫자(목록으로 관리) | "골드 800 뒤짐"(실제 703), "3,900 넘게"(실제 3,895), factIds에 없는 fact의 숫자 |
| 4 | 금지어 | 등급 표현(`[A-E]\s*등급`, `등급\s*[A-E]`, 단독 `A`~`E` 등급 문맥), "총점", "점수", "\d+점", 반영 비율 언급. 해석어(이니시, 버스, 캐리, 무리, 던지 등 `labels.ts` 목록)가 있으면 "것으로 보입니다"가 있어야 함 | "교전 총점 25점", "이니시를 잘 걸었습니다"(단정) |
| 5 | 길이 | 문장(칸) 하나 ≤ 120자·≤ 2문장, 요약 ≤ 2문장·≤ 200자 (세나 판 실측 후 조정) | 한 칸에 4문장 |
| 6 | 이름 | 문장에 나온 챔피언 이름이 입력 이름(내 챔피언·상대 라이너)뿐인지 (Data Dragon 이름 173개 목록으로 탐지) | 판에 없는 "이즈리얼" 언급 |

- 재시도: 1차 답에서 실패한 칸만 모아 재시도 메시지 1번 (2-3 "재시도 대화"). 1차에서 통과한 칸은 그대로 둔다. 재시도 답도 같은 검증기를 통과해야 쓰고, 실패하면 그 칸만 템플릿.
- 템플릿 (`template.ts`): 과목 × 방향마다 1개. 숫자는 facts `display[0]`을 그대로 넣어 **검증이 필요 없게** 만든다. 테스트로 "모든 템플릿 문장이 검증기를 통과"를 확인한다.

| 묶음 | 개수 | 예 |
|------|------|----|
| 라인전 (골드·레벨·KDA·CS × 좋음/부족) | 8 | "{기준}분 골드가 상대 {상대챔피언}보다 {diffAbs} 적었습니다." |
| 교전 (이득 여부·딜·시야·오브젝트 × 2) | 8 | "오브젝트 싸움 전 60초 동안 시야 점수가 오브젝트당 {perObjective}로 낮았습니다." |
| 운영 (운영 이득·단독 킬·데스·사이드 압박·중후반 파밍·평소 시야 × 2) | 10 | "사이드 포탑 피해가 분당 {perMinute}로 높았습니다." |
| 요약 | 1 | "라인전은 {판정어}, 오브젝트 싸움은 {판정어}, 그 밖의 운영은 {판정어}였습니다. {시작}분 싸움에서 골드 격차가 {gapChangeAbs} {벌어졌/좁혀졌}습니다." |
| 결정적 장면 (벌어짐/좁혀짐) | 2 | "{시작}분 킬 {kills}개가 난 싸움 뒤 골드 격차가 {gapChangeAbs} {방향}습니다." |
| 라인전 비교 불가 | 1 | "이 판은 라인전 상대를 비교할 수 없었습니다." |

- `mode`: LLM 답을 하나라도 썼으면 `"llm"`(문장별 `source`로 템플릿 여부 표시), 오류·거절·키 없음·예산 초과로 LLM 답을 못 쓰면 `"template"` (3장 결정 "LLM 실패는 200 `mode: "template"`"과 같음).

#### 2-7. 0원 개발 방법: 가짜 클라이언트와 녹화본

- 요약: 프롬프트·검증기를 다듬는 반복은 거의 다 돈이 안 든다. 실제 응답을 한 번 받으면 **녹화본으로 저장**해 두고, 검증기·템플릿·facts 표기를 고칠 때는 그 녹화본을 다시 돌린다.

| 방법 | 쓰는 곳 | 비용 |
|------|---------|------|
| 가짜 클라이언트 (`fakeClient.ts`) | 단위 테스트 전부. 손으로 쓴 응답 JSON: 전부 통과 / 일부 숫자 틀림 → 재시도 통과 / 재시도도 틀림 → 템플릿 / 거절 / `max_tokens` 잘림 / 파싱 불가 / 401·402·429·529·시간 초과 | 0원 |
| 녹화본 (`backend/test/eval/recordings/<matchId>.p<참가자>.<PROMPT_VERSION>.<model>.<effort>.json`) | `--yes` 실제 호출이 **자동으로 저장**: 요청 해시, 응답 `content`·`stop_reason`·`usage`, 걸린 시간. 1차·재시도 응답 모두 | 받을 때 1번만 |
| 녹화본 재생 (`--replay`) | 검증기 규칙·허용 표기·템플릿·facts 라벨을 고친 뒤 같은 응답으로 다시 검증·지표 계산. 단위 테스트의 "실제 응답 회귀 테스트"로도 씀 | 0원 |
| 프롬프트 미리보기 (기본 실행) | 실제로 보낼 시스템·사용자 메시지와 예상 토큰·최악 비용 출력 → 사람이 읽고 다듬기 | 0원 |

- 녹화본으로 **할 수 없는 것**: 프롬프트(시스템·사용자 메시지·스키마) 자체를 바꾼 효과 확인. 그래서 프롬프트 수정은 **모아서 한 번에** 하고, 실제 재호출은 세나 판 1회로만 확인한다.
- 녹화본에는 키·puuid를 넣지 않는다(입력은 이미 가린 fixture, 요청 헤더는 저장하지 않음).

#### 2-8. CLI와 예산 장치

- 요약: `npm run feedback`은 기본이 "예상 비용만 출력"이다. `--yes`를 줘야 돈이 드는 호출을 하고, 호출할 때마다 장부에 비용을 적으며, **장부 누적 + 이번 호출 최악 비용 > `FEEDBACK_BUDGET_USD`**이면 호출하지 않고 멈춘다.

```
npm run feedback -- --match <match.json> --timeline <timeline.json> (--participant N | --puuid P)   # 미리보기(0원)
npm run feedback -- … --yes                         # 실제 호출 1판
npm run feedback -- --set test/eval/set5            # 세트 미리보기: 판 수, 판당·합계 예상/최악 비용, 장부 잔액
npm run feedback -- --set test/eval/set5 --yes      # 세트 실행 (판마다 예산 검사, 상한이면 그 자리에서 멈춤)
npm run feedback -- … --replay <녹화본|폴더>        # 녹화본으로 0원 재검증
옵션: --effort low|medium|high (기본 FEEDBACK_LLM_EFFORT), --show-prompt, --compact
```

| 장치 | 동작 |
|------|------|
| 기본 미리보기 | 네트워크·키를 쓰지 않는다(클라이언트를 만들지 않음, 테스트로 확인). 출력: 모델·effort, 예상 입력 토큰(글자 수 기반 보수 추정, 실측 장부가 있으면 그 평균으로 보정), 예상 출력, **예상 비용과 최악 비용**(입력 + `max_tokens` 전부 + 재시도 최악), 장부 누적·남은 예산 |
| `--yes` | 키 있음 확인 → 예산 검사 → 호출 → 검증 → (필요하면 재시도, 재시도 전에도 예산 검사) → 결과 JSON·검증 요약·`usage`·비용·시간 출력 → 녹화본 저장 → 장부 기록 |
| 장부 `backend/test/eval/usage-ledger.jsonl` | 한 줄 = 호출 1번: 시각, matchId, participantId, model, effort, promptVersion, attempt(1/2), 입력·캐시쓰기·캐시읽기·출력 토큰, `stop_reason`, 비용(USD, `pricing.ts` 계산), 걸린 시간, 녹화본 파일. 키·puuid 없음. git에 커밋해 세션이 바뀌어도 누적이 남는다 (2-15 질문 10) |
| 예산 상한 `FEEDBACK_BUDGET_USD` | 기본 `1.00`(2단계 예산). 4·7단계는 그 단계 승인 때 값을 올린다. 상한에 걸리면 `예산 초과: 누적 $0.81 + 이번 최악 $0.16 > $1.00` 출력 후 종료 코드 3 |
| 크레딧 소진(402) | 즉시 중단, 장부에 기록, "콘솔에서 잔액 확인 필요" 출력 |
| 바깥 안전망 (사용자 작업) | Anthropic 콘솔에서 월 지출 한도를 직접 설정해 두기를 권한다(설정 변경은 사용자만 한다) |

- **가격 단가는 `pricing.ts`의 참고값**이다(스킬 문서 기준: Opus 5.5 입력 $4·출력 $20·캐시 쓰기 5분 $5·캐시 읽기 $0.20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 — 2026-10-06 캐시 기준 참고값과 같음). 실제 청구와 다를 수 있어, 첫 실제 호출 뒤 사용자가 콘솔 사용량과 장부를 한 번 대조한다.

#### 2-9. 평가(기준선) 계획과 평가 판 세트

- 요약: 2단계는 **세나 판 1~2회 → 5판 기준선 1회**로 끝낸다. 20판은 예산상 7단계로 미룬다(같은 5판을 포함하게 늘림). 로드맵 A의 2단계 완료 기준("고정 판 5개")과 같다.

실행 순서 (각 단계 앞에서 메인 에이전트가 예상 비용을 보여 주고 사용자 승인):

| 순서 | 실행 | 목적 | 실제 호출 |
|------|------|------|-----------|
| 0 | 단위 테스트, 미리보기, 손으로 쓴 응답 | 흐름·검증기·템플릿 완성 | 0 |
| 1 | 세나 판 1회 (`--yes`) | 실제 응답 모양·토큰·시간·캐시·1차 통과율 첫 측정, 녹화 | 1~2 (재시도 포함) |
| 1' | (필요할 때만) 녹화본으로 검증기 다듬기 → 프롬프트를 고쳤다면 세나 판 1회 더 | 프롬프트 수정 확인 | 0 / 1~2 |
| 2 | 5판 기준선 1회 (`--set test/eval/set5 --yes`) | 기준선 지표 (4단계 RAG 비교의 기준) | 5~10 |
| 3 | 사람 채점 | 근거 없는 주장 비율 | 0 |

지표 (5장 K-2 중 2단계 해당분):

| 지표 | 재는 방법 | 2단계 목표 |
|------|-----------|------------|
| 숫자 1차 통과율 | 1차 답에서 검사 3(숫자)을 통과한 칸 ÷ 전체 칸. 검사 전체 1차 통과율도 함께 | 기록만 (목표 ≥ 90%는 7단계에서 확정) |
| 최종 틀린 숫자 | 최종 결과 문장을 검증기로 다시 돌려 숫자 실패 수 + 사람 채점에서 찾은 틀린 숫자 | **0** |
| 방향 불일치 | 최종 결과의 칸·판정어·결정적 장면 방향 실패 수 + 사람 채점 | **0** |
| 금지어 | 최종 결과의 등급·총점 표현 | **0** |
| 근거 없는 주장 비율 | 5판 최종 문장 전부(약 50~70개)를 사용자가 채점: 문장마다 **근거 있음 / 근거 없는 주장 있음 / 해석인데 "보입니다" 없음** 3칸. 메인 에이전트가 채점표(문장, 입력 facts·판정, 칸)를 `backend/test/eval/results/`에 만들어 주고 사용자가 표시. LLM 채점기는 비용 때문에 7단계로 미룸 | 기록만 (목표 ≤ 5%는 7단계) |
| 대체 비율 | `mode: "template"` 판 수, 템플릿으로 바뀐 칸 비율 | 기록 |
| 토큰·비용·시간 | 판당 입력·캐시쓰기·캐시읽기·출력 토큰, 비용, 걸린 시간(1차·재시도·합계) | 실측표를 `ai_build.md`에 |

평가 판 5개 마련:

| 항목 | 방법 |
|------|------|
| 구성 | 포지션 5개 × 1판. **세나 판(UTILITY, 딜서폿) 재사용** + 새로 4판(TOP·JUNGLE·MIDDLE·BOTTOM). 가능하면 승·패 섞기, 탱·딜 유형 섞기, 20분 미만 또는 30분 이상 1판 |
| 고르기 | `fetchSet.ts`가 DB `match_players`에서 최근 판 중 포지션·챔피언(→ 유형) 조건에 맞는 `match_id`·참가자를 고른다(DB 읽기만) |
| 받기 | 기존 Node `RiotClient`(`getMatch`, `getTimeline`)를 import해 판당 2회. Python `urllib`은 쓰지 않는다(Riot 방화벽 403, B-2 참고). 개발 키가 유효해야 함(24시간 만료, 사용자 재발급) |
| Riot 호출 횟수 | 4판 × 2 = **8회**, 판이 조건에 안 맞을 때 예비 최대 4회 → **최대 12회** (한도 1초 20회·2분 100회 안. 기존 제한기 사용) |
| 가림 | 세나 fixture 관례 그대로(`ai_build.md` 9장): 10명 puuid·riotId·소환사 이름·summonerId·`metadata.participants`·profileIcon·summonerLevel. 저장 뒤 원래 식별 문자열이 안 남았는지 검사 |
| 저장 | `backend/test/eval/set5/<matchId>.{match,timeline}.json` + `set.json`(`[{ matchId, participantId, position, role, note }]`). 세나 판은 fixture 경로를 `set.json`에서 가리킨다(복사 안 함). timeline이 판당 약 0.6MB라 4판 약 2.5MB |
| 20판 (7단계) | 같은 방법으로 15판 더(Riot 30회 + 예비). 2단계에서는 하지 않는다 |

#### 2-10. 예상 비용과 예산 배분

- 요약: 2단계 실제 호출 예상은 **약 $0.4~0.7**, 장치가 허용하는 최대는 **$1.00**(2단계 예산 상한). 크레딧 $5 중 $1을 2단계, 나머지를 4·7단계와 예비로 남긴다.

가정 (Opus 5.5, effort `low`, 참고 가격 $4/$20 per 1M, 캐시 쓰기 $5, 캐시 읽기 $0.20. **thinking 토큰은 출력 요금**):

| 호출 | 입력 토큰 | 출력 토큰 (thinking 포함) | 비용 |
|------|-----------|---------------------------|------|
| 1차 | 약 3,500 (시스템 약 1,800 캐시 대상 + 판정·facts 약 1,700) | 약 1,500~3,000 (문장 JSON 약 1,500 + thinking 0~1,500) | 약 $0.05~0.08 |
| 재시도 (고칠 문장만) | 약 5,500 (캐시 안 된다고 가정) | 약 300~1,500 | 약 $0.03~0.05 |
| **판당 최악** (장치 기준) | 1차 3,500 + 재시도 5,500 | 1차 `max_tokens` 4,000 + 재시도 2,000 전부 | **약 $0.16** |

- 연속 실행 때 시스템 부분이 캐시 읽기(0.05배)가 되면 판당 약 $0.006 줄어든다(작음. 실측으로 확인).
- 한국어는 토큰이 많이 나오는 편이라 입력·출력 추정은 세나 판 실측으로 바로 고친다.

| 실행 | 판 수 | 예상 비용 | 최악 (장치가 막는 상한) | 승인 |
|------|-------|-----------|--------------------------|------|
| 단위 테스트·미리보기·녹화본 재생 | - | **$0** | $0 | 필요 없음 |
| 세나 판 1회 | 1 | $0.05~0.13 | $0.16 | 실행 전 승인 |
| 세나 판 2회째 (프롬프트를 고쳤을 때만) | 1 | $0.05~0.13 | $0.16 | 실행 전 승인 |
| 5판 기준선 1회 | 5 | $0.25~0.65 | $0.80 | 실행 전 승인 |
| Review 확인 (필요할 때만, 세나 판 1회) | 1 | $0.05~0.13 | $0.16 | 실행 전 승인 |
| **2단계 합계** | | **약 $0.35~0.80** | 장부 상한 **$1.00**에서 멈춤 | |
| (참고) 20판 1회 | 20 | $1.0~2.6 | $3.2 | **2단계에서 하지 않음** (7단계, 필요하면 Batches API 50% 할인 검토) |
| (참고) effort `medium` 세나 1회 | 1 | 약 $0.08~0.20 | max_tokens에 따름 | 품질 부족 때만 제안 |

- 실행할 때마다 승인 절차: ① Build(또는 Review)가 미리보기 출력(예상·최악 비용, 장부 누적·잔액)을 메인 에이전트에게 보고 ② 메인 에이전트가 사용자에게 "무엇을, 몇 판, 예상 $x, 최악 $y, 누적 뒤 잔액 $z"로 묻는다 ③ 사용자 승인 뒤 `--yes`로 1번만 실행 ④ 실제 비용을 장부와 `ai_build.md`에 기록. 승인은 그 실행 1번에만 유효하다.

크레딧 $5 배분 (제안):

| 단계 | 예산 | 쓰는 곳 |
|------|------|---------|
| 2단계 (이번) | **$1.00** (Build $0.80 + Review $0.20) | 세나 판 1~2회, 5판 기준선 1회, Review 표본 |
| 4단계 RAG | $0.75 | 같은 5판 RAG 켬 1회 + 세나 판 시험 1~2회 (임베딩 비용은 별도 서비스) |
| 5단계 API 연결 확인 | $0.25 | 실제 판 몇 개로 API 경로 확인 |
| 7단계 평가·보정 | $2.00 | 20판(또는 Batches) 기준선, Sonnet 5.5·Haiku 5.5 비교(Opus보다 싸다), LLM 채점기 |
| 예비 | $1.00 | 재실행·실수 대비 |
| 합계 | $5.00 | |

#### 2-11. 완료 기준

1. 단위 테스트(가짜 클라이언트, 네트워크 없음): facts(세나 판 값·표기·등급/점수 제외), 검증기(숫자 추출 사례 — 쉼표·소수·%p·분·한글 수사·"약/넘게/가까이", "3,900 넘게" 거부 —, 방향·금지어·길이·이름), 템플릿(26 + 요약·장면·비교 불가 모두 검증기 통과), 생성 흐름(통과 / 재시도 통과 / 재시도 실패→그 칸만 템플릿 / 거절 / 잘림 / 파싱 실패 / 401·402·429·시간 초과 → 템플릿), 예산 장치(상한이면 호출 안 함), 장부, 비용 계산, CLI 미리보기가 클라이언트를 만들지 않음.
2. `npm run typecheck`, `npm run lint`, `npm test` 오류 0. 기존 246개 테스트 그대로 통과. 1단계 엔진 파일 변경 없음(`ENGINE_VERSION` 그대로).
3. import 검사: `@anthropic-ai/sdk`는 `llm/client.ts`만 import. `process.env`는 `cli/feedback.ts`에서만 읽고 `createFeedback`에는 설정값으로 넘긴다. `src/analysis/**`가 `riot/`·`db/`·`repositories/`를 import하지 않음(평가 스크립트 `test/eval/fetchSet.ts`는 예외).
4. 실제 호출(승인받은 실행만): 세나 판과 5판 기준선에서 **최종 틀린 숫자 0, 방향 불일치 0, 금지어 0**. 1차 통과율·재시도율·대체 비율·판당 토큰·비용·시간을 `ai_build.md` 실측표에 기록.
5. 장부 누적 비용 ≤ **$1.00**. 모든 실제 응답이 녹화본으로 저장되고, `--replay`가 같은 검증 결과를 0원으로 재현.
6. 근거 없는 주장 채점표(5판)를 만들어 사용자 채점 결과를 기록(목표 확정은 7단계).
7. `.env.example`에 변수 4개, `package.json`에 의존성·스크립트 각 1줄. `ai_build.md`에 기능별 상태(✅ ⚠️ ❌ ⏸️)와 위 결과.

#### 2-12. Review 수준

- 요약: **항상 전체 독립 Review**. CLAUDE.md 12장 표에서 프롬프트·검증기 추가는 "중간~큰 변경"이고, 이번은 **외부 유료 서비스(Anthropic API) 첫 추가**라 "항상 전체 독립 Review"에 해당한다.
- Review는 Build의 typecheck·lint·test 결과를 재실행 없이 신뢰하고(3장), ① diff(특히 검증기 숫자 추출·방향 규칙, 예산 장치, 오류 처리, 키·puuid가 로그·장부·녹화본에 안 남는지) ② **녹화본 재생(0원)**으로 세나·5판 결과와 지표 재현 ③ 가짜 클라이언트로 오류 경로 표본 ④ 장부 합계와 콘솔 사용량 대조(사용자 확인)를 본다.
- Review의 실제 호출은 원칙적으로 하지 않는다. 꼭 필요하면 세나 판 1회(최악 $0.16)를 메인 에이전트를 통해 승인받는다(2단계 예산 안).

#### 2-13. 작업 범위 (수정 가능한 경로)

| 단계 | 경로 |
|------|------|
| Build | `backend/src/analysis/llm/**`(신규), `backend/src/analysis/feedback.ts`(신규), `backend/src/cli/feedback.ts`(신규), `backend/test/unit/analysis/llm/**`(신규), `backend/test/eval/**`(신규: `set5/`, `fetchSet.ts`, `recordings/`, `results/`, `usage-ledger.jsonl`), `backend/package.json`(SDK 의존성·`scripts.feedback`만), `backend/package-lock.json`(설치 결과), `.env.example`(변수 4개 추가만), `docs/ai/ai_spec.md`(이번 변경 합치기·결정 표·로드맵 7단계 줄), `docs/ai/ai_build.md`, `docs/ai/feedback_design.md`(9장 요약 예문 "3,900 넘게" 정정만, 질문 12 승인 시) |
| Review | `docs/ai/ai_review.md`, `docs/ai/ai_overview.md`, `docs/career_log.md`(추가만), 문제 수정 시 위 Build 경로 |
| 수정 금지 | 1단계 엔진 파일(`backend/src/analysis/*.ts` 기존 12개), `backend/src/cli/analyze.ts`, 그 밖의 `backend/src/**`(API·수집기·Riot 클라이언트·DB — import만 허용), 계약 문서 2개, `frontend/`, `db/`, `CLAUDE.md`, `.env`, `docs/ai/README.md`(메인 에이전트 담당) |

#### 2-15. 사용자 결정 질문 (답함 2026-11-03: 모두 추천대로)

| # | 질문 (쉽게) | 추천 |
|---|-------------|------|
| 1 | **2단계 유료 호출 예산을 $1.00(Build $0.80 + Review $0.20)으로, $5 배분을 2단계 $1 · 4단계 $0.75 · 5단계 $0.25 · 7단계 $2 · 예비 $1로** 할까요? | 예 |
| 2 | 기준선은 **5판(포지션별 1판, 세나 판 포함)**으로 하고 20판은 7단계로 미룰까요? | 예 (20판은 최악 $3.2로 2단계 예산 초과) |
| 3 | 평가용 4판을 Build 중에 Riot에서 받아도 될까요? (DB 표본에서 고르고, 최대 12회 호출, 닉네임·계정 식별 값 가림, `backend/test/eval/set5/`에 약 2.5MB 커밋. 개발 키 재발급 필요할 수 있음) | 예 |
| 4 | effort는 `low`로 고정해 시험하고, 품질이 부족할 때만 세나 판 1회로 `medium`을 비교할까요? | 예 |
| 5 | 서버측 fallback(거절되면 다른 모델로 자동 재실행)은 2단계에서 쓰지 않고 거절은 템플릿으로 처리할까요? 5단계에서 거절률을 보고 다시 정합니다 | 예 (스킬 문서 권장과 다르지만 기준선·예산을 위해) |
| 6 | facts(쓸 수 있는 숫자 목록)를 엔진 출력에 넣지 않고 `llm/facts.ts`가 엔진 결과로 만들게 할까요? (엔진·`ENGINE_VERSION`·1단계 테스트 그대로) | 예 |
| 7 | 검증 실패 재시도는 "고칠 문장만" 받는 작은 스키마로 할까요? (출력 토큰이 줄어 더 쌈) | 예 |
| 8 | 근거 없는 주장 비율은 2단계에서 **사용자가 5판 문장(약 50~70개)을 직접 채점**하고, LLM 채점기는 7단계로 미룰까요? | 예 |
| 9 | 문장에 내 챔피언과 상대 라이너의 한국어 이름(예: "상대 애쉬")을 써도 될까요? (Data Dragon `ko_KR` 스냅숏 이름 사용) | 예 |
| 10 | 사용량 장부(`usage-ledger.jsonl`)와 녹화본을 git에 커밋할까요? (키·puuid 없음. 세션이 바뀌어도 누적 비용이 남음) | 예 |
| 11 | Anthropic 콘솔에서 월 지출 한도를 직접 설정해 두시겠어요? (코드 장치의 바깥 안전망. 설정은 사용자만) | 예 |
| 12 | 설계 9장 요약 예문 "3,900 넘게 벌어지며"는 실제 3,895라 검증기가 틀린 표기로 봅니다. "약 3,900"으로 고칠까요? | 예 (Build가 `feedback_design.md` 9장 한 곳만 고침) |

## 5. 다음 단계 계획 (미승인)

- 요약: 3단계 이후의 계획 초안이다(G·H와 I·J·K·L의 2단계 부분은 B2로 옮겼다). 로드맵(A)만 승인되었고 아래 내용은 **단계마다 그 단계 Plan에서 다시 다듬어 승인**받는다. 계약 문서 변경이 필요한 부분(D·E)은 이 문서의 "계약 변경 요청"으로 본다 (CLAUDE.md 7장).

### C. 전체 구조

- 요약: AI 코드는 전부 `backend/src/analysis/` 아래에 둔다(백엔드와 같은 Node 프로세스). 판정 엔진·LLM·RAG를 폴더로 나누고, Express 라우트(5단계)는 `!백엔드`가 이 폴더의 함수 하나만 부른다.

```
backend/src/analysis/
├─ (1단계) types.ts rules.ts role.ts timeline.ts fights.ts laning.ts fight.ts macro.ts keyMoments.ts summary.ts index.ts
├─ llm/        (2단계) prompt.ts  generate.ts  schema.ts  verify.ts  template.ts  client.ts
├─ rag/        (4단계) embed.ts  search.ts  buildStats.ts  ddragon.ts
└─ feedback.ts (2·4단계) createFeedback(deps)(input) — 엔진 → 검색 → LLM → 검증 → 대체 문장을 잇는 함수
backend/src/cli/
├─ analyze.ts      (1단계) 로컬 파일로 엔진만
├─ feedback.ts     (2단계) 로컬 파일로 엔진 + LLM (유료 호출, 실행 전 확인)
└─ rag.ts          (4단계) 지식 문서 조각내기·임베딩·적재 (ingest), 검색 시험 (search)
docs/ai/knowledge/ (4단계) RAG 관점 문서 원본 (Markdown, git으로 관리)
backend/test/eval/ (2·7단계) 고정 판 세트와 평가 스크립트
```

| 영역 경계 (제안) | 담당 |
|------------------|------|
| `!ai` | `backend/src/analysis/**`, `backend/src/cli/{analyze,feedback,rag}.ts`, `backend/test/{unit/analysis,eval}/**`, `docs/ai/**` (지식 문서 포함) |
| `!백엔드` | 분석 API 라우트·Riot 호출·캐시·한도·오류 매핑(`src/api/**`), `api_contract.md` |
| `!db` | `vector` 확장, RAG 테이블, 검색 SQL 함수, `db_contract.md` |
| `!프론트` | 분석 버튼·피드백 화면 |

- `!ai`는 백엔드 폴더 안에 코드를 두지만, 기존 백엔드 파일은 고치지 않는다. 기존 파일을 고쳐야 하면(예: 공용 캐시 재사용) 메인 에이전트에게 보고하고 `!백엔드` 작업으로 넘긴다.

### D. 분석 API 초안 (→ `api_contract.md` 변경 필요)

- 요약: 5단계에서 `!백엔드`가 계약에 넣을 초안이다. **계약 문서는 `!백엔드`만 수정한다** — 여기서는 "이런 모양이 필요하다"는 요청이다.

#### D-1. 요청

```http
POST /api/v1/matches/KR_8437852704/feedback
Content-Type: application/json

{ "puuid": "abcd1234…" }
```

| 이름 | 위치 | 검사 |
|------|------|------|
| `matchId` | 경로 | `^KR_[0-9]{1,15}$` (2-6과 같음) |
| `puuid` | 본문 | 2-6과 같음. 그 판의 참가자가 아니면 404 |

- **POST 제안 이유**: 이 요청은 LLM 비용이 들고 캐시를 만든다(부작용). GET이면 링크 미리 가져오기·크롤러·브라우저 자동 재시도로 의도하지 않은 유료 호출이 생길 수 있다. 계약 1장 "메서드 GET만" 규칙을 "GET + 분석 POST 1개"로 바꿔야 한다 (N절 8번).

#### D-2. 응답 (200)

```jsonc
{
  "matchId": "KR_8437852704",
  "championId": 235, "position": "UTILITY", "role": "SUPPORT_DAMAGE",
  "mode": "llm",                       // "llm" | "template" (LLM 실패·상한 초과 때 코드 문장)
  "summary": "라인전에서 밀렸고, 오브젝트 싸움과 그 밖의 운영 모두 부족했습니다. 15분 바텀 싸움에서 골드 격차가 3,895 벌어지며 승부가 기울었습니다.",
  "sections": {
    "laning": { "good": [], "bad": [ { "text": "15분 골드가 상대 애쉬보다 703 적었습니다…", "basis": ["laning.gold"] } ] },
    "fight":  { "good": [], "bad": [ … ] },
    "macro":  { "good": [], "bad": [ … ] }
  },
  "keyMoments": [ { "startSec": 906, "endSec": 936, "kills": 5, "direction": "widened", "goldChange": 3895, "text": "…" } ],
  "meta": { "engineVersion": "…", "promptVersion": "…", "knowledgeVersion": "…", "generatedAt": "2026-…Z" }
}
```

- `basis`는 그 문장이 기대는 판정 항목 ID다. 화면은 쓰지 않아도 되고, 디버깅·평가용이다.
- 점수·등급 숫자는 응답에 넣지 않는다(화면에 보이지 않는다는 결정과 맞춤). 모델 이름·토큰 수는 서버 로그에만 남긴다.
- `Cache-Control: no-store` (서버가 캐시).

#### D-3. 오류 (3장 형식 그대로)

| HTTP | `code` | 언제 | 새 코드? |
|------|--------|------|----------|
| 400 | `INVALID_PARAMETER` | `matchId`·`puuid` 형식 | 기존 |
| 404 | `MATCH_NOT_FOUND` | Riot에 그 판이 없음, 또는 `puuid`가 참가자가 아님 | **새 코드** |
| 422 | `ANALYSIS_UNSUPPORTED` | 분석하지 않는 판 (포지션 없는 모드, 15분 미만 등 — N절 4번) | **새 코드** |
| 429 | `ANALYSIS_LIMIT_REACHED` | 하루 분석 상한 초과이면서 캐시도 없음 (템플릿 문장으로 줄지 이 오류로 줄지 N절 6번) | **새 코드** |
| 502 | `RIOT_UNAVAILABLE` | Riot 재시도 소진 | 기존 |
| 503 | `RIOT_KEY_EXPIRED` | Riot 키 만료 | 기존 |

- **LLM 실패는 오류가 아니다**: 200 + `mode: "template"`로 코드가 만든 문장을 준다 (J절).

#### D-4. 응답 시간

- Riot 2회(약 1초) + 검색(약 0.5초, 확인 필요) + LLM(수 초~20초, 확인 필요) + 검증 재시도 1회 가능. **동기 응답, 서버 제한 30초**를 제안한다. 프론트의 기본 10초 시간 제한(`API_TIMEOUT_MS`)은 이 엔드포인트만 늘려야 한다 (6단계, N절 12번).

### E. DB 변경 요청 (→ `db_contract.md`)

- 요약: 3단계에서 `!db`가 만들 것. **성적 지표는 저장하지 않고**, RAG 조각(우리가 쓴 문서·Data Dragon 설명)만 저장한다. 계약 문서는 `!db`만 수정한다.

| # | 요청 | 내용 | 이유 |
|---|------|------|------|
| E1 | `vector` 확장 | `create extension vector` (Supabase 제공, 버전 확인 필요) | 임베딩 저장·거리 계산 |
| E2 | 테이블 `rag_chunk` | `id`(text, 예: `fight.damage.SUPPORT_DAMAGE.bad.01`), `source`(`perspective`/`champion`/`item`), `position`(5개 또는 `ALL`), `role`(유형 10개 또는 `ALL`), `area`(`laning`/`fight`/`macro`/`general`), `subject`(예: `damage`, null 가능), `polarity`(`good`/`bad`/`any`), `champion_id`(int, null 가능), `patch`(text, null 가능), `content`(text), `content_hash`(text), `embedding`(vector(N), N은 임베딩 모델에 따름), `embedding_model`(text), `updated_at` | 메타데이터 필터 + 벡터 검색. `content_hash`로 바뀐 조각만 다시 임베딩 |
| E3 | 인덱스 | `(source, role, area)` B-tree, `embedding`에 HNSW(코사인). 조각이 수천 개 이하라 HNSW 없이 순차 검색도 충분할 수 있음 — `!db` Plan에서 측정 후 결정 | 검색 속도 |
| E4 | 검색 함수 `search_rag_chunks(p_embedding, p_role, p_position, p_area, p_subjects, p_polarity, p_champion_id, p_limit)` | 필터로 거른 뒤 코사인 거리 순 상위 N개 | 백엔드가 SQL을 직접 짜지 않게 (기존 집계 함수 방식과 같음) |
| E5 | 보안 | RLS 켜고 정책 0, `anon`·`authenticated` 권한 회수, 함수 실행 권한 회수 (계약 11장 그대로) | 기존 규칙 |
| E6 | 용량 | 조각 약 1,000개 × 1,024차원 × 4바이트 ≈ 4MB + 인덱스. 500MB 한도에 영향 작음 (모델에 따라 다시 계산) | 무료 플랜 |

- **분석 결과 캐시는 1차로 DB에 두지 않는다**(메모리 캐시, I절). DB 캐시가 필요해지면(서버 재시작 때마다 LLM 비용이 다시 듦) 그때 "결과 문장 JSON만, N일 보관" 테이블을 따로 요청한다 — 이것이 "성적 지표를 쌓지 않는다"와 충돌하는지 사용자 판단이 필요하다 (N절 3번).
- 빌드 통계는 **새 테이블이 필요 없다**. 이미 있는 `champion_item`·`champion_rune` 등 집계를 백엔드의 기존 읽기 경로로 조회한다 (F-4).

### F. RAG: 지식 문서 작성·조각내기·임베딩·검색

- 요약: 사용자의 롤 지식을 **짧은 관점 조각**으로 써서 git에 두고, 명령 하나로 임베딩해 DB에 넣는다. 검색은 "유형·과목·좋음/부족으로 먼저 거르고 → 뜻이 가까운 순"이다. 숫자가 매일 바뀌는 빌드 통계는 임베딩하지 않고 그때그때 표에서 꺼낸다.

#### F-1. 지식 문서 형식 (`docs/ai/knowledge/`)

- 파일 하나 = 유형 하나(예: `support_damage.md`) + 공통 파일(`common.md`). 조각 하나 = `###` 소제목 하나.
- 조각 바로 아래 한 줄에 메타데이터를 쓴다. 본문은 2~5문장(약 100~400자). **한 조각에는 한 가지 관점만** 쓴다.

```markdown
### fight.damage.SUPPORT_DAMAGE.bad.01 딜서폿의 교전 딜이 낮을 때
- meta: role=SUPPORT_DAMAGE, area=fight, subject=damage, polarity=bad
딜서폿은 오브젝트 싸움에서 원딜과 함께 딜을 나눠 맡는 역할이다. 교전 딜 비중이 기대보다 낮으면
싸움 전에 이미 체력이 깎였거나, 사거리 밖에서만 맴돌았을 가능성이 있다. 다만 데스가 먼저 나왔다면
딜이 낮은 이유는 포지셔닝 문제로 보는 편이 맞다.
```

- 작성 방식(제안): Claude가 `feedback_design.md`를 바탕으로 초안을 쓰고 → **사용자가 롤 지식으로 고치고 승인** → 적재. 첫 묶음은 유형 10개 × 자주 나오는 과목의 좋음/부족 해석 ≈ **50~80조각** (N절 9번).
- 조각 안에는 **숫자 경계값을 쓰지 않는다**(경계는 코드 `rules.ts`가 유일한 출처). 문서에 숫자가 있으면 LLM이 그 숫자를 문장에 섞을 수 있어서다. 적재 명령이 조각 속 숫자를 경고한다.

#### F-2. 조각내기·임베딩·적재

| 단계 | 방법 |
|------|------|
| 조각내기 | `###` 기준으로 자른다(고정 길이 자르기 안 함). 관점 하나가 이미 한 조각이라 자르면 뜻이 깨진다. 메타데이터 줄을 읽어 칼럼으로, 소제목+본문을 `content`로 |
| 검사 | ID 중복, 필수 메타데이터 누락, 허용되지 않은 값(유형 10개·과목 이름은 `rules.ts`와 같은 목록), 길이(600자 초과 경고), 숫자 포함 경고 |
| 임베딩 | `content_hash`가 바뀐 조각만 임베딩 서비스로 보낸다(묶음 요청). 비용·시간 절약 |
| 적재 | `npm run rag -- ingest` : upsert. 문서에서 지워진 조각은 `--prune`을 줄 때만 DB에서 지움(미리보기 먼저, 사용자 확인) |
| 버전 | 조각 전체의 해시 = `knowledgeVersion`. 문서가 바뀌면 캐시 키가 바뀌어 새로 생성됨 |

#### F-3. Data Dragon 챔피언·아이템

- 챔피언(1차): `ko_KR` `championFull`에서 이름, 태그, 패시브·스킬 **짧은 요약**을 조각 1개로 (약 170조각). `source=champion`, `champion_id`로 필터해 **분석한 챔피언과 상대 라이너 조각만** 꺼낸다 — 사실상 벡터 검색이 아니라 ID 조회다.
- 아이템(보류 제안): 설계에 아이템 평가가 없어서 1차에서는 넣지 않는다 (N절 11번).
- 패치가 바뀌면 다시 적재한다(`patch` 칼럼). Riot 공개 데이터라 저장해도 된다.

#### F-4. 빌드 통계 (임베딩하지 않음)

- 기존 DB 집계 `champion_item` 등에서 **그 챔피언 × 포지션의 상위 핵심 아이템·룬**을 조회해, 프롬프트에 "참고 문맥" 표로 붙인다. 이유: 숫자가 매일 05:00에 바뀌고, "이 챔피언의 1순위 아이템"은 뜻으로 찾을 일이 아니라 정확히 조회할 일이라서다.
- 설계 문서에 빌드 판정 블록이 없으므로 **판정을 만들지 않는다**. LLM에게 "빌드에 대해 평가하지 말고, 해석에 필요할 때만 참고"라고 지시한다. 아예 넣지 않을지 사용자 결정 (N절 10번).

#### F-5. 검색 (하이브리드)

1. 엔진 결과의 `speakOrder`에서 말할 과목을 고른다(영역마다 좋은 점·부족한 점 최대 2개씩).
2. 과목마다 **필터**: `role ∈ {그 유형, ALL}` AND `area` = 그 영역 AND `subject` = 그 과목 AND `polarity ∈ {그 방향, any}`.
3. 필터 안에서 **벡터 순위**: 질의 문장 = "딜서폿 교전 딜 부족, 데스 먼저, 패배" 처럼 판정·노트로 만든 짧은 문장. 과목당 상위 2개.
4. 전체 상한 8조각(토큰 비용 상한). 같은 조각은 한 번만.
5. 필터에 맞는 조각이 0개면 `role=ALL` 조각으로 넓힌다. 그래도 없으면 RAG 없이 쓴다(그 사실을 로그에 남김).

- 이렇게 하면 "포지션이 다른 조각이 섞이는 문제"는 필터가 막고, 벡터는 **같은 과목 안에서 지금 상황에 더 맞는 조각**을 고르는 역할만 한다.

### G. LLM: 프롬프트와 출력 JSON

- 요약: 2단계 상세로 옮겼다 ([B2 2-3·2-5](#2-3-호출-설계-claude-api)). 4단계에서 RAG 조각 블록과 `chunkIds`를 더한다.

### H. 숫자·판정 검증

- 요약: 2단계 상세로 옮겼다 ([B2 2-4·2-6](#2-4-facts-llm이-쓸-수-있는-숫자-목록)).

### I. 캐시·비용·호출 한도

- 요약: 한 판의 결과는 한 번만 만들고 재사용한다. 하루 분석 횟수 상한과 동시 실행 수 상한으로 비용이 튀지 않게 한다.

| 항목 | 제안 |
|------|------|
| 캐시 키 | `matchId + puuid + engineVersion + promptVersion + knowledgeVersion + model` (규칙·프롬프트·문서가 바뀌면 자연히 새로 생성) |
| 캐시 위치 | 1차: API 프로세스 **메모리** (기존 `summonerCache` 방식, 최대 500개, TTL 7일 — 끝난 게임은 안 바뀜). 재시작하면 사라짐. DB 캐시는 N절 3번 |
| 진행 중 공유 | 같은 키 요청이 동시에 오면 LLM을 1번만 부른다 (lane-gold의 "진행 중 호출 공유"와 같은 방식) |
| Riot | 판당 match 1 + timeline 1 = 2회. 기존 API 전용 제한기(1초 18회/120초 90회)를 공유. 전적 검색이 이미 받은 match 상세가 캐시에 있으면 재사용 |
| LLM 동시 실행 | 최대 2개. 넘치면 대기(최대 5초) 후 429 대신 대기열 |
| 하루 상한 | `FEEDBACK_DAILY_LIMIT`(예: 100회, KST 자정 초기화, 캐시 적중은 세지 않음). 넘으면 템플릿 또는 429 (N절 6번) |
| 끄는 스위치 | `FEEDBACK_ENABLED=false`면 LLM을 부르지 않고 템플릿만 |
| 판당 비용 추정 | 2단계(RAG 없음, Opus 5.5 `low`) 추정은 [B2 2-10](#2-10-예상-비용과-예산-배분). 4단계는 조각 8개(약 2.5천 토큰)가 입력에 더해진다. 2단계 실측으로 다시 잰다 |
| 임베딩 비용 | 적재: 조각 약 1,000개 × 200토큰 ≈ 20만 토큰(1회). 질의: 판당 질의 문장 약 6개. 서비스별 가격 확인 필요 |
| 로그 | 판마다 모델, 입력·출력·캐시 토큰, 걸린 시간, 검증 결과, 사용 조각 ID. puuid는 앞 8자만 (기존 규칙) |

### J. 오류 처리와 대체 출력

- 요약: Riot 키 문제는 오류로 알리고, **LLM·검색 문제는 오류 대신 코드가 만든 템플릿 문장**으로 답한다. 사용자는 문장이 조금 딱딱할 뿐 분석 결과는 항상 받는다.

| 상황 | 처리 | 응답 |
|------|------|------|
| Riot 키 만료(401/403) | 그 요청만 실패 | 503 `RIOT_KEY_EXPIRED` |
| Riot 429·5xx 재시도 소진 | 그 요청만 실패 | 502 `RIOT_UNAVAILABLE` |
| 판이 없음 / 참가자 아님 | - | 404 `MATCH_NOT_FOUND` |
| 분석하지 않는 판 | 엔진이 "판정 불가" 반환 | 422 `ANALYSIS_UNSUPPORTED` |
| Anthropic 키 없음·만료(401/403) | LLM 끄고 템플릿. 서버 로그 오류 1회/시간 | 200 `mode: "template"` |
| Anthropic 429·5xx·시간 초과·거절 | SDK 재시도 후 템플릿 | 200 `mode: "template"` |
| 검증 2회 실패 | 실패한 문장만 템플릿 | 200 `mode: "llm"` (일부 템플릿, 로그에 표시) |
| 임베딩·벡터 검색 실패 | RAG 없이 LLM | 200 `mode: "llm"` (로그에 `rag=off`) |
| 하루 상한 초과 | 템플릿 또는 429 | N절 6번 |

- **템플릿 문장**은 2단계에서 만든다([B2 2-6](#2-6-검증기-재시도-템플릿)). 템플릿 결과 캐시는 짧게(10분) 두어 LLM이 회복되면 다시 만든다(5단계).

### K. 평가 계획 (수치로 재기)

- 요약: "좋아졌다"를 감이 아니라 숫자로 말하기 위해, 고정된 판 세트로 매번 같은 지표를 잰다. 유료 호출이 드는 평가는 실행 전 사용자 승인을 받는다.

#### K-1. 고정 판 세트

| 세트 | 구성 | 쓰는 단계 |
|------|------|-----------|
| 엔진 기준 판 | 세나 판 1개(손계산 완료) + 사용자가 손검산할 판 2~4개 | 1단계~ |
| 생성 평가 세트 | **20판**: 포지션 5개 × 4판, 유형 10개가 최소 1번씩, 승/패 반반, 짧은(20분 미만)·긴(30분 이상) 게임 포함. 닉네임 가림 후 `backend/test/eval/`에 저장 | 2·4·7단계 |
| 검색 평가 세트 | 질의 **40개**(유형 × 과목 × 방향). 각 질의에 "나와야 할 조각 ID"를 사람이 라벨 | 4·7단계 |

#### K-2. 지표

| # | 지표 | 재는 방법 | 목표 (초안) |
|---|------|-----------|-------------|
| 1 | 엔진 일치율 | 기준 판의 손계산 값과 엔진 출력 비교 | 100% |
| 2 | 숫자 1차 통과율 | LLM 첫 답에서 H-1 검사를 통과한 문장 ÷ 전체 문장 | ≥ 90% (2단계에서 실측 후 조정) |
| 3 | 최종 근거 없는 숫자 | 최종 응답에서 `facts`와 안 맞는 숫자 수 | **0** (검증기가 보장) |
| 4 | 방향 불일치 | 최종 응답에서 판정과 다른 칸·판정어 | **0** |
| 5 | 근거 없는 주장 비율 | 문장마다 "입력 판정·숫자·조각으로 뒷받침되나?"를 채점. 1차: 사용자가 50문장 직접 채점 → 같은 기준으로 LLM 채점기(Claude, 별도 프롬프트)를 맞춘 뒤 20판 전체 자동 채점. 채점기-사람 일치율도 기록 | ≤ 5% |
| 6 | 해석 표기 준수 | 추정 해석 문장 중 "~것으로 보입니다" + 근거 숫자가 있는 비율 | 100% |
| 7 | 검색 유형 일치율 | 꺼낸 조각 중 `role`이 그 유형 또는 `ALL`인 비율 | 100% (필터가 보장) |
| 8 | 검색 Recall@4 · MRR | 검색 평가 세트에서 정답 조각이 상위 4개 안에 든 비율, 첫 정답 순위의 역수 평균 | Recall@4 ≥ 0.8 |
| 9 | RAG 효과 | 같은 20판을 RAG 끔/켬으로 생성 → 지표 5·6, 해석 문장 수, 사용자 블라인드 선호(어느 쪽이 나은지) | RAG 켬이 같거나 좋음 |
| 10 | 비용·시간 | 판당 입력·출력·캐시 토큰, 추정 비용, p50/p95 응답 시간 | p95 ≤ 20초, 판당 비용은 2단계 실측 후 상한 확정 |
| 11 | 대체 비율 | `mode: "template"` 응답 비율, 템플릿으로 바뀐 문장 비율 | ≤ 5% |

- 결과는 단계마다 `docs/ai/ai_build.md`(실측 표)와 `ai_review.md`에 남기고, 의미 있는 판단은 `docs/career_log.md`에 기록한다.
- 평가 실행 명령과 2단계 지표·판 세트(5판)는 [B2 2-8·2-9](#2-8-cli와-예산-장치)로 옮겼다. 20판 세트는 7단계에서 같은 방법으로 늘린다(크레딧 $5 제약).

### L. 새 의존성·외부 서비스와 환경 변수

- 요약: 1단계는 새 의존성이 없다. 2단계에 Anthropic SDK, 4단계에 임베딩 서비스가 들어온다.

#### L-1. 의존성·서비스

| 무엇 | 단계 | 목적 | 왜 이것 | 대안 |
|------|------|------|---------|------|
| `@anthropic-ai/sdk` (npm) | 2 | Claude 호출 | **2단계에서 추가 (`1.4.0` 고정, B2 2-2)** | - |
| Anthropic API (유료) | 2 | 문장 생성 | 합의된 방향 | - |
| 임베딩 서비스 (유료 또는 로컬) | 4 | 조각·질의를 벡터로 | Claude에 임베딩이 없음 | 아래 표 |
| Supabase `vector` 확장 | 3 | 벡터 저장·검색 | 이미 쓰는 DB, 추가 서비스 없음 | 별도 벡터 DB(Pinecone 등) — 서비스가 하나 늘어 제외 |

| 임베딩 후보 | 장점 | 단점 | 차원 수 |
|-------------|------|------|---------|
| **Voyage AI** (`voyage-3.5` 계열, 추천) | Anthropic 문서가 권하는 임베딩. 다국어(한국어) 지원, 검색용 질의/문서 구분 입력 | 계정·키가 하나 늘어남. 가격·무료 제공량 **확인 필요** | 모델·설정에 따라 (예: 1,024) **확인 필요** |
| OpenAI `text-embedding-3-small` | 싸고 많이 쓰임, 자료 많음 | 공급자가 하나 더 늘어남(LLM과 다른 회사) | 1,536 (확인 필요) |
| 로컬 모델 (예: `multilingual-e5-small`, transformers.js) | 무료, 외부 전송 없음 | 첫 실행 때 모델 파일 내려받기, 서버 메모리·CPU 사용, 품질은 평가 필요 | 384 (확인 필요) |
| Supabase 내장 `gte-small` | 추가 계정 없음 | 영어 중심이라 한국어 품질이 약할 가능성 | 384 |

- 임베딩 서비스가 정해지면 차원 수가 정해지고, 그 값으로 3단계 테이블을 만든다. **나중에 모델을 바꾸면 전체 재적재**가 필요하다(조각이 1,000개 수준이라 부담은 작음).

#### L-2. `.env.example`에 추가할 변수 (이름만, 값은 쓰지 않음)

| 변수 | 단계 | 용도 |
|------|------|------|
| `ANTHROPIC_API_KEY`, `FEEDBACK_LLM_MODEL`, `FEEDBACK_LLM_EFFORT`, `FEEDBACK_BUDGET_USD` | 2 | **2단계 Build에서 `.env.example`에 추가함** ([B2 2-2](#2-2-새-의존성과-환경-변수)) |
| `FEEDBACK_ENABLED` | 5 | `false`면 LLM 없이 템플릿만 |
| `FEEDBACK_DAILY_LIMIT` | 5 | 하루 LLM 분석 상한 (캐시 적중 제외) |
| `EMBEDDING_PROVIDER` | 4 | `voyage` 등 (N절 1번 결과) |
| `EMBEDDING_MODEL` | 4 | 임베딩 모델 ID |
| `VOYAGE_API_KEY` | 4 | Voyage를 고를 때만 |

- `.env.example` 수정은 그 변수를 처음 쓰는 단계의 Build가 함께 한다 (CLAUDE.md 3장).

## 6. CLAUDE.md 반영

- 요약: 이 계획이 제안한 CLAUDE.md 변경 중 ① 7장 영역 경계 표의 `!ai` 줄과 ② 새 12장 "AI 작업 흐름"은 메인 에이전트가 반영했다 (2026-11-02). ③ 2장 스택 표의 `AI | 미정` → `AI | Claude(Anthropic API), 임베딩(선택 후 기재), Supabase pgvector`는 임베딩 서비스(N절 1번)가 정해진 뒤 반영한다.

## 7. 사용자가 정해야 할 것

### N. 사용자가 정해야 할 것

- 요약: 번호 순서가 대략 필요한 시점 순서다. 1단계에 필요했던 **7·13·14번은 2026-11-02에 답했다**(3장 결정 사항). 나머지는 해당 단계 Plan 전까지 정한다.

| # | 질문 (쉽게) | 선택지 / 제안 | 필요 시점 |
|---|-------------|---------------|-----------|
| 1 | **임베딩 서비스를 무엇으로 할까요?** | ① Voyage AI (추천, 한국어 지원·Anthropic 권장) ② OpenAI ③ 로컬 무료 모델 ④ Supabase 내장 | 3단계 전 (테이블 차원 수) |
| 2 | 기본 LLM 모델은? | **답함 (2026-11-02): `claude-opus-5-5`(개발·기준선), 7단계에서 Sonnet 5.5·Haiku 5.5와 비교. API 키 방식** (3장 결정 사항) | 2단계 전 |
| 3 | 분석 결과 캐시를 어디에 둘까요? 메모리는 서버를 끄면 사라져 같은 판에 비용이 다시 듭니다. DB에 "결과 문장만, N일 보관"하면 이것이 "성적 지표를 쌓지 않는다"와 충돌하나요? | ① 메모리만 (제안, 1차) ② DB에 결과 JSON만 7일 보관 | 5단계 전 |
| 4 | 어떤 판을 분석할까요? | 큐: 솔로랭크만 / 자유랭크 포함 / 일반 포함. 길이: 15분 미만 제외(제안). 칼바람·URF 등 포지션 없는 모드는 제외 | 5단계 전 |
| 5 | 피드백을 화면 어디에 보일까요? | ① 매치 행 아코디언 안 "AI 분석" 탭 ② 별도 페이지 `/matches/{matchId}` ③ 모달. 6단계 목업으로 확인 | 6단계 전 |
| 6 | 비용 상한은? 상한을 넘으면 템플릿 문장을 줄까요, "오늘은 분석이 끝났습니다"(429)를 줄까요? | 하루 N회(예: 100), 월 예산(예: $10). 넘으면 템플릿(제안) | 5단계 전 |
| 7 | 등급을 좋은 점/부족한 점으로 나누는 규칙: **A·B = 좋은 점, D·E = 부족한 점, C = 말하지 않음**으로 할까요? | **답함 (2026-11-02): 예** | 1단계 전 |
| 8 | 분석 API를 POST로 해도 될까요? (계약의 "GET만" 규칙이 바뀜) | 제안: POST (실수로 비용이 드는 호출 방지) | 5단계 전 |
| 9 | RAG 관점 문서는 Claude가 초안을 쓰고 사용자가 고치는 방식으로 할까요? 첫 묶음 50~80조각이면 될까요? | 제안: 예 | 4단계 전 |
| 10 | DB 빌드 통계를 피드백에 쓸까요? | ① 판정 없이 해석 참고로만 (제안) ② 쓰지 않음 ③ "빌드" 블록을 새로 만들기(설계 변경 필요) | 4단계 전 |
| 11 | Data Dragon은 챔피언만 넣고 아이템은 나중에 할까요? | 제안: 챔피언만 | 4단계 전 |
| 12 | 분석은 몇 초 걸려도 그 자리에서 기다리게 할까요? | ① 동기, 최대 30초 (제안) ② 작업 번호를 받고 나중에 다시 묻기(폴링) | 5단계 전 |
| 13 | 세나 판 원본(match·timeline)을 닉네임만 가려 테스트 파일로 저장소에 넣어도 될까요? | **답함 (2026-11-02): 예. 닉네임과 계정 식별자를 모두 가림** | 1단계 전 |
| 14 | 유형 덮어쓰기 목록(예: 모르가나 `[Support, Mage]` → 유틸서폿? 딜서폿?)을 Build가 초안을 만들면 검토해 주시겠어요? 검토 전에는 Data Dragon 첫 태그 규칙 그대로 씁니다 | **답함 (2026-11-02): 카르마·모르가나·라칸 적용, 세트(서폿) 보류** (`ai_build.md` 8장) | 1단계 중 |
| 15 | 다른 참가자(같은 판의 10명 누구나)를 분석할 수 있게 할까요, 검색한 소환사 본인만 할까요? | 제안: 1차는 검색한 소환사만 | 6단계 전 |
| 16 | 1단계 Build에서 나온 설계와 다른 점: ① 딜 비중을 반올림 전/후 어느 값으로 비교할지 ② 결정적 장면 고르는 순서 ③ 영혼 용 버그로 어긋난 정글 오브젝트·교전 이득 경계 재보정 여부 | **답함 (2026-11-02): ① 반올림 전 유지 ② 지금 구현 유지 ③ 재계산 값 적용** (3장 결정 사항) | 1단계 중 |
