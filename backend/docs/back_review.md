# 백엔드 검토 기록 — 변경 05 (게임 피드백 분석 API) 검토

> 검토일: 2026-11-03 (KST)
> 기준: `CLAUDE.md` 3·9·11·12장, `backend/docs/back_spec.md`(5-9, 6-4, 7-6, 9-5, 10-8, 결정 F1~F21), `backend/docs/back_build.md`(2-9, 4-8, 5장 24~30, 7장), `docs/contracts/api_contract.md` v4(1장, 2-7, 3장)
> 방법: 계약이 바뀌고(1장 "GET만" → POST 1개) 사용자 요청이 유료 외부 호출로 이어지는 첫 경로라 **전체 독립 Review**를 했다. 3장 기준에 따라 Build의 typecheck·lint·test 결과는 신뢰하고, diff를 읽어 로직·설계 결함을 찾고 임시 포트 4100에 서버를 띄워 표본 확인했다. 작은 결함 1건을 고친 뒤에는 typecheck·lint·test를 다시 돌렸다. 임시 서버는 모두 종료했다.
> 이 문서는 **가장 최근 검토만** 둔다. 해결되지 않은 문제는 `back_overview.md` 10장에 있다.
> 상태 표기: ✅ 통과 / ⚠️ 문제 있음 / ❌ 실패 / ⏸️ 확인 못 함

## 목차

- [1. 결론](#1-결론)
- [2. 검사·테스트](#2-검사테스트)
- [3. 계약 v4와 구현 대조](#3-계약-v4와-구현-대조)
- [4. 비용 보호](#4-비용-보호)
- [5. 처리 순서와 Riot 오류](#5-처리-순서와-riot-오류)
- [6. Data Dragon](#6-data-dragon)
- [7. 보안·로그](#7-보안로그)
- [8. 경계 (`!ai` 코드)](#8-경계-ai-코드)
- [9. 실제 확인](#9-실제-확인)
- [10. 발견 사항 (심각도순)](#10-발견-사항-심각도순)
- [11. 고친 것](#11-고친-것)

---

## 1. 결론

> 요약: **코드는 PASS with issues, 실제 확인은 일부 보류.** 치명·중요 결함은 없다. 비용 보호(스위치 → 하루 상한 예약 → 예산 예약 → 동시 실행)와 처리 순서가 계획·계약대로 짜여 있고 단위 테스트가 경쟁 상황까지 다룬다. 다만 검토 시점에 **Riot 개발 키가 만료**(401/403)되어 있어, 실제 Riot 데이터를 쓰는 템플릿 1판과 **사용자 승인된 실제 LLM 1판은 하지 못했다**(Anthropic 호출 0회, 비용 $0). 키 재발급 뒤 LLM 1판만 다시 확인하면 된다.

| 구분 | 결과 |
|------|------|
| 판정 | **PASS with issues — 실제 LLM 1판 ⏸️** (치명 0, 중요 0, 경미 4, 정보 3, 사용자 결정 1) |
| 고친 것 | L1 장부 파일이 깨지면 API 서버 전체가 켜지지 않던 문제 → 분석 기능만 끄도록 (`server.ts`) |
| 프론트 Plan 착수 | 막는 것 없음. 계약 v4 2-7 그대로 쓰면 된다 |
| 공개 전 필수 | 사용자 결정 1: API 예산 상한 $0.25로는 실제 LLM 분석이 사실상 1번뿐 (10장 D1) |

---

## 2. 검사·테스트

| 항목 | 결과 |
|------|------|
| Build 결과(신뢰) | typecheck 0, lint 0, 단위 372/372, 통합 17/17 (`back_build.md` 4-8) |
| 고친 뒤 재실행 | ✅ `typecheck` 0, ✅ `lint` 0, ✅ `npm test` **372/372** |
| 테스트 범위 확인 | 사전 검사 순서, 금지 키 재귀 검사, KST 자정, 장부 복원(어제·retry·비용 0 제외), 예산 예약 경쟁(동시 2요청), 세마포어 2+4, 같은 키 동시 3요청 → Riot 2·LLM 1·하루 1, 21번째 429·캐시 적중은 200, auth → 자리 반납 + 차단기, 402 로그, 504 뒤 백그라운드 완료·추가 LLM 0, Riot 대기 6초 → 503 busy, 꺼짐이면 본문 검사 전 503 — 모두 테스트 이름과 본문으로 확인 |

---

## 3. 계약 v4와 구현 대조

| 항목 | 결과 | 근거 |
|------|------|------|
| 요청 검사 | ✅ | `matchId` `^KR_[0-9]{1,15}$`, 본문 2KB·`application/json`·객체·`puuid` 형식. `puuid`·본문 값은 `details`에 없음 (실측 9건, 9장) |
| 메서드 | ✅ | 이 경로 POST만 통과. 같은 경로 GET·PUT·OPTIONS, 다른 경로 POST → 404 `NOT_FOUND` (실측) |
| 응답 필드 | ✅ | `dto.ts`가 계약 표의 필드만 만든다. 금지 키 18개 재귀 테스트. `templateReason`은 `mode="llm"`이면 null |
| `keyMoments` | ✅ | 엔진 index → 시각·방향, 0~3개(F21). 엔진에 없는 index는 버림 |
| 오류 코드·reason | ✅ | 404 `match`/`participant`, 422 `queue`/`too_short`/`no_position`/`no_timeline`, 429 `daily`(limit·resetAt)/`budget`, 502, 503 `RIOT_KEY_EXPIRED`/`ANALYSIS_DISABLED`/`ANALYSIS_BUSY`, 504, 500 |
| `Retry-After` | ✅ | 429 daily(자정까지 초)·503 busy·504에 헤더. 429 `budget`은 헤더 없음(언제 풀릴지 모름 — 계약 문구와 일치) |
| `Cache-Control` | ✅ | 성공·오류 모두 `no-store` |
| CORS | ✅ | `Origin` 붙인 OPTIONS → 404, `Access-Control-*` 헤더 없음 |

---

## 4. 비용 보호

> 요약: 네 겹 모두 코드로 확인했다. 꺼짐이면 LLM 클라이언트·장부를 만들기 전에 반환하고, 예약은 "먼저 잡고 끝나면 정산" 순서이며 모든 실패 경로가 `finally`에서 반납한다.

| 항목 | 결과 | 확인 내용 |
|------|------|-----------|
| 스위치 순서 | ✅ | `buildFeedback`: 설정 오류·`FEEDBACK_ENABLED≠true` → `createAnthropicClient`·`fileLedger` 전에 503 함수 반환. 라우트는 `feedback.unavailable`이면 `express.json` 전에 503 (실측: 깨진 본문도 503) |
| LLM 스위치 | ✅ | 클라이언트는 `FEEDBACK_LLM_ENABLED=true` + 키 + 가격표 모델 + 하루 상한 > 0일 때만 생성. 시작 로그 `llm=off(FEEDBACK_LLM_ENABLED=false) … key=있음` (값 없음) |
| 하루 상한 | ✅ | `tryReserve`(used+reserved < limit) → `settle(비용>0)`. 비용 0이면 반납. KST 날짜 키로 초기화. 재시작 시 API 장부의 오늘 `kind="first"`·`costUsd>0` 줄 수로 복원 |
| 예산 예약 | ✅ | `장부 합 + 진행 중 예약 합 + 이번 판 최악 > 상한`이면 429 `budget`. 최악 = 1차 max_tokens 전부 + 재시도 최악. `generateTexts`의 `assertBudget`도 그대로 동작(이중 장치) |
| 동시 실행 | ✅ | 세마포어 2 + 대기 4, 넘치면 503 busy(15초). 자리는 분석 종료 때 반환(504로 끊긴 요청도 분석이 끝날 때) |
| 같은 키 공유 | ✅ | `flights` Map. 리더만 Riot·LLM·하루 셈. 성공·실패 모두 끝나면 삭제, 실패 Promise는 `.catch`로 처리되지 않은 거절이 남지 않음 |
| 504 뒤 | ✅ | `Promise.race`만 끊고 분석은 계속, 끝나면 캐시. 타이머는 `finally`에서 정리 |
| 401·402 차단 | ✅ | `auth`·`billing`·`model_not_found` → 차단기 10분, 오류 로그 1번(402는 "크레딧 소진") |
| 장부 위치 | ✅ | `backend/logs/feedback-api-ledger.jsonl`, `git check-ignore` → 루트 `.gitignore:38 logs/`. CLI 평가 장부와 분리. 검토 뒤에도 파일 없음(호출 0) |

---

## 5. 처리 순서와 Riot 오류

| 항목 | 결과 | 확인 내용 |
|------|------|-----------|
| 싼 검사 먼저 | ✅ | 캐시 → 제한기 대기 → getMatch → 참가자 → 큐 → 길이 → 10명 포지션 → (여기까지 통과해야) getTimeline → Data Dragon → 엔진 → LLM. 참가자 검사가 엔진보다 먼저라 404가 NO_POSITION보다 먼저 |
| Riot 대기 | ✅ | 리더만 `limiterWaitMs() > 5,000`이면 503 busy(`retryAfterSec` 1~60), Riot 0회 |
| 오류 매핑 | ✅ | getMatch 404 → 404 `match`, timeline 404·빈 프레임·`NO_FRAMES` → 422 `no_timeline`, 401/403 → 503 (실측: `riotCalls=1`, timeline 안 부름), 재시도 소진 → 502, `MATCH_MISMATCH` → 500. 오류는 캐시하지 않음 |

---

## 6. Data Dragon

| 항목 | 결과 | 확인 내용 |
|------|------|-----------|
| 패치별 받기 | ✅ | `gameVersion` → `메이저.마이너`(정규식) → `versions.json`(1시간) → 접두어 첫 버전 → `champion.json`. 버전 최대 4개, 진행 중 공유 |
| 실패 대비 | ✅ | 받기 실패·형식 다름·버전 없음 → 스냅숏 16.21.1 + 경고 10분 1번. 분석은 계속 |
| 시간 제한 | ✅ | `AbortSignal.timeout(3,000)` (본문 읽기까지 포함) |
| 경로 조작 | ✅ | 요청 값은 `gameVersion`의 숫자 접두어만 쓰고, URL에 넣는 버전은 Data Dragon 목록에서 고른 값을 `encodeURIComponent`로 넣는다. 사용자 입력이 경로에 들어가지 않는다 (I1 참고) |

---

## 7. 보안·로그

| 항목 | 결과 | 확인 내용 |
|------|------|-----------|
| puuid | ✅ | 본문에만 → 요청 로그(`originalUrl`)에 없음. 분석 로그는 앞 8자(`AAAAbbbb…`). 실측 서버 로그에서 보낸 puuid 원문·잘못된 puuid 문자열 **0건** |
| 키 | ✅ | `redact`에 `ANTHROPIC_API_KEY` 값과 `sk-ant-…` 모양 추가. 시작 로그는 `key=있음`만. 이번 검토의 서버 로그 4개에 키 값 없음 |
| 본문 크기 | ✅ | 라우트 전용 `express.json({limit:'2kb'})`. 3KB → 400 `body` (실측) |
| POST 범위 | ✅ | `FEEDBACK_PATH_RE` 한 경로만. 그 밖 404 |
| `.env` | ✅ | 읽지도 고치지도 않음. 스위치는 프로세스 환경 변수로만 줌 |

---

## 8. 경계 (`!ai` 코드)

| 항목 | 결과 |
|------|------|
| `src/analysis/**`, `src/cli/**`, `test/unit/analysis/**`, `test/eval/**` | ✅ `git status` 변경 0 (import만) |
| `@anthropic-ai/sdk` import | ✅ `analysis/llm/client.ts`만 (백엔드는 `createAnthropicClient` 호출) |
| `db/`, db 계약, `frontend/` | ✅ 이번 변경 없음 (`frontend/docs/*`의 수정은 다른 작업) |

---

## 9. 실제 확인

> 요약: 임시 포트 4100에서 세 번 띄워 확인하고 모두 종료했다. 4000 포트는 떠 있지 않았고 건드리지 않았다. **Riot 키가 만료되어** 실제 경기 분석(템플릿 1판, LLM 1판)은 하지 못했다. Riot 호출 **2회**(둘 다 401/403), Anthropic **0회**, 비용 **$0**.

| # | 설정 | 확인 | 결과 |
|---|------|------|------|
| 1 | 기본(새 변수 없음) | 시작 로그 `enabled=false`, POST → 503 `ANALYSIS_DISABLED`, 깨진 본문도 503 | ✅ |
| 2 | `FEEDBACK_ENABLED=true FEEDBACK_LLM_ENABLED=false` | 시작 로그 `llm=off(FEEDBACK_LLM_ENABLED=false) … budget=$0.25 spent=$0.0000 today=0/20 key=있음` | ✅ |
| 3 | 같은 서버 | GET·PUT·OPTIONS(Origin 붙임)·다른 경로 POST → 404 `NOT_FOUND`, CORS 헤더 없음 | ✅ |
| 4 | 같은 서버 | `NA_1` → 400 `matchId`(value 포함), 깨진 JSON·배열·`text/plain`·3KB → 400 `body`(값 없음), `"a b<script>"` → 400 `puuid`(값 없음) | ✅ |
| 5 | 같은 서버 | 검색 `너희는개다-KR1` → **503 `RIOT_KEY_EXPIRED`** (Riot 1회). 분석 `KR_8441587549` → **503 `RIOT_KEY_EXPIRED`**, 로그 `riotCalls=1 outcome="503 RIOT_KEY_EXPIRED" costUsd=0 today=0/20` (timeline·LLM 안 부름) | ✅ (키 만료 경로) |
| 6 | 장부에 깨진 줄을 임시로 둠 | 고친 뒤: 오류 로그 1줄 + 서버는 켜짐 + POST → 503 `ANALYSIS_DISABLED`. 확인 후 임시 장부 삭제 | ✅ (L1 수정 확인) |
| 7 | **실제 LLM 1판** (`FEEDBACK_LLM_ENABLED=true`) | 검색이 401/403이라 puuid·경기를 얻을 수 없음 → **하지 않음** | ⏸️ |

- 실제 Riot 템플릿 경로(200 `llm_off`, 반복 시 `template_hit`, 422 `too_short`, 404 `participant`/`match`)는 Build가 키가 살아 있을 때 확인했다(`back_build.md` 4-8 #6).
- **다음에 할 일**: 사용자가 Riot 키를 재발급하면 같은 절차(포트 4100, 프로세스 환경 변수만)로 LLM 1판(재시도 포함 최대 2회 호출, 예상 약 $0.07·최악 약 $0.22)을 돌려 `mode:"llm"`·30초 안·금지 필드 없음·반복 시 Riot 0·LLM 0·장부 1줄·하루 +1·장부 비용 = 로그 비용을 확인한다.

---

## 10. 발견 사항 (심각도순)

| # | 심각도 | 내용 | 조치 |
|---|--------|------|------|
| D1 | **사용자 결정** | 기본 예산 $0.25에서 판당 최악 약 $0.216을 예약하므로 장부 합이 약 $0.034를 넘으면 그 뒤 모든 LLM 분석이 **429 `budget`**(템플릿도 아님)이다. 첫 실제 1판(약 $0.07) 뒤 곧바로 막힌다. 동시 2개도 예산상 1개만 통과한다. 누적 상한이라 날이 바뀌어도 풀리지 않는다 | 보고만. 화면 공개 전 `FEEDBACK_API_BUDGET_USD` 상향(예: 하루 20판 × 약 $0.07 ≈ $1.4/일 기준으로 정함) 또는 월 단위 장부(F11) 결정 필요 |
| L1 | 경미 (고침) | API 장부에 깨진 줄(쓰는 도중 종료 등)이 있으면 시작 때 `JSON.parse` 예외로 **API 서버 전체가 켜지지 않았다**(챔피언 통계까지 중단) | `server.ts`에서 복원 실패 시 오류 로그 + 분석만 503. 요청 중 장부 읽기 실패는 500(돈이 나가지 않는 쪽)으로 그대로 둠 |
| L2 | 경미 | 진행 중 분석이 KST 자정을 넘겨 끝나면 그 1회가 **새 날**의 사용 수로 들어간다(`settle`이 날짜를 넘긴 뒤 `used++`) | 보고만. 하루 1회 오차, 영향 작음 |
| L3 | 경미 | Data Dragon이 내려가 있으면 실패를 기억하지 않아 분석마다 `versions.json`을 다시 시도해 최대 3초씩 늦어진다(경고 로그는 10분 1번) | 보고만. 30초 상한 안이고 드묾 |
| L4 | 경미 | 템플릿 경로(LLM 끔)와 422·404 경로는 하루 상한·속도 제한이 없어, 같은 요청을 반복하면 Riot 1~2회씩 쓴다(캐시되지 않는 오류). API 제한기(18/90)가 상한 역할 | 보고만. 계획의 "사용자별 속도 제한 안 함"과 같음 (overview 10-1과 같은 계열) |
| I1 | 정보 | Data Dragon 버전 문자열을 `^\d+\.\d+\.\d+$`로 따로 검사하지 않는다. 신뢰하는 CDN 값이고 `encodeURIComponent`로 넣어 경로 조작은 안 되지만, 엄격 검사를 더하면 더 안전 | 다음에 이 파일을 고칠 때 |
| I2 | 정보 | 504 뒤에도 분석이 끝까지 돌며 하루 자리·동시 실행 자리를 쥔다(`generateTexts`에 취소 신호 없음) | 계획 5-9-9 참고 1과 같음 |
| I3 | 정보 | 시간 초과·네트워크 오류로 끝난 LLM 호출은 장부 `costUsd=0`이지만 실제로는 일부 청구됐을 수 있다 → 그 판은 하루 상한에도 안 셈 | 계획 5-9-9 참고 2와 같음. 콘솔 대조 |

---

## 11. 고친 것

| 파일 | 내용 | 재검증 |
|------|------|--------|
| `backend/src/server.ts` | `buildFeedback`에서 장부 복원(`countTodayFromLedger(ledger.entries())`)을 `try`로 감싸, 실패하면 `logger.error` 1줄 + `unavailableFeedback(503 ANALYSIS_DISABLED)` | typecheck 0, lint 0, 단위 372/372, 실제 서버(9장 #6) |
