# 프론트엔드 검토 — 변경 06 (전적 검색 MVP)

> 검토 대상: `front_spec.md` 5-7·11장(D28~D38), `front_build.md` 14장(변경 06). 커밋 전 작업 트리를 `git diff`/`git status`로 확인. 백엔드·DB·계약 문서는 이번 변경 범위 밖이며 수정되지 않았음을 확인했다.
> 검증 방식: 3장 "Review 적용 기준"에 따라 — 린트·타입·빌드는 Build 결과를 신뢰하되 1회 재실행으로 숫자만 재확인했고, 독립 검토는 diff 코드 리딩과 실제 브라우저+API 호출(운영 빌드 포함)에 집중했다.

## 목차

- [1. 판정](#1-판정)
- [2. 완료 기준 체크리스트](#2-완료-기준-체크리스트)
- [3. D37·D38 타당성 판단](#3-d37d38-타당성-판단)
- [4. 코드 리딩](#4-코드-리딩)
- [5. 실제 브라우저·API 검증](#5-실제-브라우저api-검증)
- [6. 회귀·보안·범위 확인](#6-회귀보안범위-확인)
- [7. 재실행한 명령](#7-재실행한-명령)
- [8. 발견한 문제](#8-발견한-문제)

---

## 1. 판정

**PASS with issues** (낮은 심각도 2건, 코드 수정 없음 — 둘 다 설계 변경이 아니라 "보고"로 남김).

완료 기준(front_spec.md 10장 "전적 검색" 절) 전 항목 충족. D37·D38 둘 다 운영 빌드로 직접 재현해 타당함을 확인했다. 기능 결함 0건, 기존 통계 화면 회귀 0건, 새 런타임 의존성 0건, 계약·백엔드·DB 미수정.

## 2. 완료 기준 체크리스트

| 항목 | 결과 |
|------|------|
| 헤더 검색창 `너희는개다#KR1` → `/summoners/kr/너희는개다-KR1` → 프로필·랭크·매치 20건 | ✅ 브라우저로 직접 확인(5장) |
| 랭크 없음(`leagues: []`)·매치 없음(`matches: []`) 문구 | ✅ `RankList.tsx`·`MatchList.tsx` 코드 확인(Build가 가짜 응답으로 실측, 13장에 기록된 대로 테스트 계정은 랭크 2개뿐이라 실측 불가 — 타당한 제약) |
| `이상한이름#0000` → 404 + 검색창 재포커스 | ✅ 브라우저로 직접 확인 |
| `region=na` → 404 | ✅ `page.tsx`가 호출 전에 `notFound()`로 막음(코드 확인) + curl로 백엔드 쪽도 400 확인 |
| `RIOT_UNAVAILABLE`(502)·`RIOT_KEY_EXPIRED`(503) 화면 | ✅ 운영 빌드(`next start`) + 가짜 백엔드로 502 직접 재현(5장), 503은 코드 리딩으로 분기 확인 |
| 아이템 빈 칸(`itemId: 0`)·참가자 10명·키스톤+트리 아이콘 | ✅ `toSlotView`/`toParticipantView`/`toKeystoneMap` 코드 확인 + 실제 매치 데이터로 화면 확인 |
| 360/768/1024px 가로 스크롤 없음, 키보드 검색·탐색, 대비 4.5:1 | ✅ 360px·1024px 직접 측정(5장), 대비 수치 재계산(6장) |
| 린트·타입·빌드 통과, 새 의존성 없음, 기존 `fetchApi` 캐시 동작 회귀 없음 | ✅ 재실행 확인(7장) |

## 3. D37·D38 타당성 판단

### D37 — Riot 502/503·연결 실패를 `error.tsx`가 아닌 `page.tsx`가 직접 그림

Build의 주장(운영 빌드에서 Next가 서버 컴포넌트 오류의 `message`를 클라이언트로 보내지 않는다)을 직접 재현했다. `frontend/src/app/summoners/[region]/[riotId]/page.tsx`는 `getSummoner()`의 `SummonerState.status`를 보고 `riot_unavailable`/`riot_key_expired`/`unavailable`일 때 `SummonerStatus` 컴포넌트를 바로 반환한다(오류를 던지지 않음, `error.tsx`로 넘어가지 않음). 가짜 502 백엔드를 세워 `npm run build && npm start`(운영 빌드)로 직접 호출하자 "라이엇 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." 문구가 HTTP 200으로 정상 렌더링됐다. `error.tsx`를 거치지 않으므로 message 은닉 문제 자체가 발생하지 않는 설계이고, 실제로 그렇게 동작함을 확인했다. **타당함.**

### D38 — `params.riotId` 자동 디코딩 안 됨, `decodeURIComponent` 추가

`SummonerSearchForm.tsx`가 `encodeURIComponent({gameName}-{tagLine})`로 한 번만 인코딩해 `router.push`하고, `page.tsx`가 `decodeRiotId()`(`decodeURIComponent`, 실패 시 원문 유지)로 한 번만 디코딩한다 — 인코딩·디코딩이 1:1로 대응해 이중 인코딩/디코딩이 없다. 운영 빌드로 `너희는개다#KR1` 검색을 처음부터 끝까지 실행해 프로필·랭크·매치가 정상 로드됨을 확인했다(5장). 하이픈(`-`)은 `encodeURIComponent`가 이스케이프하지 않는 문자라 경로 조각으로서의 "마지막 `-`에서 자른다"는 백엔드 규칙과도 어긋나지 않는다. **타당함.**

## 4. 코드 리딩

- **`lib/api/client.ts`**: `fetchApi<T>(path, options?)`로 시그니처가 확장됐다. `options?.cache === "no-store"`가 아닌 모든 경우(옵션 생략 포함) `{ next: { revalidate: API_REVALIDATE_SECONDS }, signal: ... }`로 — 변경 전 코드와 정확히 동일한 객체를 만든다. 기존 호출부(`getMeta`/`getTierList`/`getChampionStats`)는 전부 `fetchApi(path)` 형태로 두 번째 인자를 넘기지 않으므로 분기상 100% 기존 경로를 탄다. `classifyError`에 `SUMMONER_NOT_FOUND`(404→`not_found`, 기존 `STATS_NOT_FOUND`와 같은 kind로 묶임— 화면에서 재분기하므로 문제 없음), `RIOT_UNAVAILABLE`(502)·`RIOT_KEY_EXPIRED`(503)만 새로 추가. 기존 `ApiFailureKind` 분기(`not_ready`/`not_found`/`invalid`/`unavailable`)를 쓰는 기존 화면 코드는 신규 kind(`riot_unavailable`/`riot_key_expired`)를 모르면 `default` 분기(대개 `unavailable`류 처리)로 떨어지므로 하위 호환에 문제없다.
- **`lib/view/summoner.ts`**: 큐 한글화(`QUEUE_LABELS`)는 모르는 큐를 원문 그대로 반환해 정보 손실이 없다(D33). 티어 글자(`tierLabel`)는 마스터 이상에서 랭크(단계) 생략을 정확히 처리(`RANKLESS_TIERS`). 키스톤 평탄화(`toKeystoneMap`)는 트리의 0번 줄(핵심 룬 줄)만 모아 핵심 룬 id → 정보+소속 트리 매핑을 만드는데, 룬 id 충돌(다른 트리에 같은 id가 있을 가능성)은 룬 시스템상 id가 전역 고유라 문제되지 않는다. `toSlotView`가 `itemId === 0`일 때 `null`을 반환해 "빈 칸"을 표현하고, `ItemSlot`(`MatchRow.tsx`)이 `null`이면 `aria-hidden` 빈 칸을 렌더링 — 완료 기준의 "빈 아이템 칸" 요구와 일치.
- **`lib/view/format.ts`**: `formatRelativeKo`는 `Date.now()` 기준이라 `force-dynamic` 라우트에서만 쓰는 게 맞고(주석에도 명시) 실제로 `lib/view/summoner.ts`(동적 라우트 전용)에서만 호출된다. `formatKda`가 "4.00"처럼 소수 2자리를 주는데, 계획 문서의 와이어프레임 예시 텍스트는 "(4.0)"(1자리)였다 — 완료 기준에 소수 자릿수 규정은 없어 기준 위반은 아니지만 사소한 표기 불일치로 8장에 기록.
- **`SummonerSearchForm.tsx`**: `parseRiotIdInput`이 `lastIndexOf("#")` 기준으로 자르고 `tagLine`을 `^[0-9A-Za-z]{2,5}$`로 검사 — 계약 2-5의 `tagLine` 형식과 동일. 형식 오류 시 `router.push`를 호출하지 않아 서버 요청이 발생하지 않음(완료 기준 충족). `aria-describedby`/`role="alert"` 연결 정상.
- **라우트**: `region !== "kr"`이면 API를 부르기 전에 `notFound()` — 계약의 400 INVALID_PARAMETER를 프론트가 미리 막는 설계(D29)로 일관됨. `riotId` 파싱은 백엔드와 동일하게 "마지막 `-`에서 자른다"는 규칙을 공유하고, 프론트는 직접 자르지 않고 그대로 넘기기만 해 규칙 불일치 위험이 없다(실제 분리는 백엔드가 수행).

## 5. 실제 브라우저·API 검증

로컬 `backend-api`(포트 4000, `npm --prefix backend start`)와 `next dev`(포트 3000, 이미 떠 있던 세션 서버에 접속)로 확인.

- 헤더 검색창에 `너희는개다#KR1` 입력 → `/summoners/kr/너희는개다-KR1` 이동 → 프로필(아이콘·"너희는개다 #KR1"·레벨 629), 랭크 카드(자유랭크 실버2 52LP 31승40패 43.7%, 솔로/듀오 실버1 6LP 130승136패 48.9%), 매치 다건(아이템·소환사 주문·키스톤·팀/상대팀 아이콘) 확인 — 실제 API 응답(curl)과 화면이 일치.
- `이상한이름#0000` 검색 → "소환사를 찾을 수 없습니다" + "이름#태그를 확인해 주세요." 확인, `document.activeElement.id === "riotid-search"`로 포커스 복귀 확인.
- `region=na`(`na/foo-bar`) → 404 확인.
- 헤더 검색창에 형식 오류(`형식오류`, `#` 없음) 입력 후 Enter → 페이지 이동 없이 "이름#태그 형식으로 입력해 주세요" 인라인 오류 확인.
- 1024px(`lg` 경계): `grid-cols-[280px_1fr]` 2단(좌 랭크, 우 매치)과 `scrollWidth === clientWidth`(1024) 확인.
- 360px: `scrollWidth === clientWidth`(360), 1열(프로필→랭크→매치) 확인, 가로 스크롤 없음.
- 운영 빌드(`npm run build && PORT=3006 npm start`, 격리 포트) 재현: `너희는개다#KR1` 검색이 끝까지 정상 동작(D38 검증).
- 운영 빌드 + 가짜 502 백엔드(`API_BASE_URL` override, 격리 포트 3007): "라이엇 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." HTTP 200 정상 렌더링(D37 검증).
- 콘솔 오류 0건(`read_console_messages onlyErrors`, 전적 검색·챔피언 목록·상세 페이지 모두).

## 6. 회귀·보안·범위 확인

- **기존 통계 화면 회귀**: `/champions`, `/champions/Aatrox`를 `next dev`에서 직접 열어 정상 렌더링·콘솔 오류 0건 확인. `fetchApi` 호출부(`getMeta`/`getTierList`/`getChampionStats`)는 옵션을 넘기지 않아 분기상 변경 전과 동일 코드 경로(4장 참고).
- **보안**: `src/lib/api/config.ts`는 `API_BASE_URL`만 읽는다(기존 그대로). `RIOT_API_KEY`·`DATABASE_URL`은 프론트 프로세스에 들어오지 않음(`next.config.ts` 미수정, 이번 변경에서 읽는 변수 추가 없음). `grep -rl "RIOT_API_KEY\|localhost:4000\|/api/v1" .next/static` 0건.
- **범위**: `git status --short docs/ backend/ db/` 0건 — 계약 문서·백엔드·DB 미수정.
- **새 런타임 의존성**: `git diff -- frontend/package.json frontend/package-lock.json` 0줄.
- **`mockup-summoner-search.html` 삭제**: 작업 트리에 없음(확인됨) — 삭제 완료.
- **대비 재계산**: `--win`(`#5a9bff`)·`--lose`(`#f16565`)를 배경(`#0b1020`)·표면(`#141b2f`)에 대해 WCAG 공식으로 재계산 — 배경 6.82/6.12, 표면 6.16/5.53으로 Build 보고 수치와 정확히 일치, 모두 4.5:1 이상.

## 7. 재실행한 명령

| 명령 | 결과 |
|------|------|
| `npm run lint` | ✅ 오류·경고 0 (Build 보고와 일치) |
| `npx next typegen && npx tsc --noEmit` | ✅ 오류 0. `any` 0건(관련 신규 파일 grep으로 재확인) |
| `npm run build` (백엔드 켬) | ✅ 183정적 페이지 + `ƒ /summoners/[region]/[riotId]` 1개. 보안 업그레이드 안내가 1회차에 멈췄고 재시도로 통과 — Build 보고와 동일한 동작(13장 참고, 조치 안 함) |
| `PORT=3006 npm start`(운영) | ✅ `너희는개다#KR1` 정상 응답 |

## 8. 발견한 문제

코드 결함은 없어 수정한 파일은 없다. 아래 2건은 설계 변경이 필요 없는 수준이라 직접 고치지 않고 기록만 남긴다(메인 에이전트 보고용).

1. **(낮음, 정리 필요)** 작업 트리에 `frontend/mockup-current.html`(371줄, 챔피언 상세 페이지 레이아웃 정적 목업)이 커밋되지 않은 채 남아 있다. 이번 변경 06(전적 검색) 범위와 무관한 내용(소환사 검색이 아니라 챔피언 상세 Hero/스킬 레이아웃)이고 `front_build.md` 14장에도 언급이 없다 — 다른 작업(아마 세션 시작 전 "레이아웃 변경 시 HTML 목업" 규칙 도입과 관련된 별도 작업)이 남긴 임시 파일로 보인다. 저장소에 남겨둘 파일이 아니므로 메인 에이전트가 용도를 확인해 정리(삭제 또는 올바른 변경 번호로 커밋)하는 것이 좋다.
2. **(낮음, 문서 정합성)** `front_build.md` 8장("챔피언 상세")이 `ChampionHero`의 h1 이동·칭호 삭제, `PositionTabs`의 탭 1개 시 `sr-only` 처리, `PositionStatsPanel`의 카드 재구성(`text-accent`, `h3 sr-only`, 스킬 순서 좌측 카드로 합침), `ChampionAbilities`의 세로 카드 배치, `ChampionLore`의 제목 위치를 모두 "변경 06"으로 표기한다. 그런데 이 내용은 오늘 작업 트리의 diff에 없고(`git status`에 해당 컴포넌트 파일 변경 없음), 실제로는 커밋 `8771301`("변경 05" 커밋 메시지)에 이미 포함돼 있다(직접 diff로 확인). 즉 해당 UI 변경은 변경 06의 산출물이 아니라 이전에 이미 커밋된 것이며, `front_build.md`의 "변경 06" 라벨은 부정확하다(이 문구는 이번 세션 diff에 포함되지 않은, 이미 HEAD에 있던 문장이라 이번 Build가 새로 쓴 것은 아니다 — 이전 세션에서 변경 05 커밋과 변경 06 작업이 뒤섞여 기록된 것으로 보인다). 기능에는 영향이 없지만, 다음에 "변경 06이 챔피언 상세도 건드렸다"고 오해할 수 있어 메인 에이전트가 변경 번호 라벨을 바로잡는 것을 권장한다.

둘 다 전적 검색 기능 자체의 동작·완료 기준과는 무관해 PASS 판정에는 영향을 주지 않는다.
