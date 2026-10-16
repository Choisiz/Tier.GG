# 프론트엔드 계획서 — Tier.GG 챔피언 화면

> 상태: **현재 계획 (승인됨)**. v1(2026-10-12)과 변경 01(2026-10-15)을 합친 지금 사이트의 계획이다.
> 기준 문서: `docs/contracts/api_contract.md` v2, `api.md`(Data Dragon), `CLAUDE.md` 6장(영역 문서 관리)·10장(프론트 흐름)
> 이전 계획 원문은 git 커밋 `87cfc78`에 있다. 새 변경은 이 문서 맨 아래 `## 이번 변경 (승인 대기)`에 임시로 적고, Build가 본문에 합친다.

## 목차

- [1. 범위](#1-범위)
- [2. 기술 구성](#2-기술-구성)
- [3. 디렉토리 구조](#3-디렉토리-구조)
- [4. 라우트와 렌더링](#4-라우트와-렌더링)
- [5. 화면 구성](#5-화면-구성)
  - [5-1. 공통 레이아웃](#5-1-공통-레이아웃)
  - [5-2. 통계 기간 표시](#5-2-통계-기간-표시)
  - [5-3. 챔피언 티어 리스트](#5-3-챔피언-티어-리스트)
  - [5-4. 챔피언 상세](#5-4-챔피언-상세)
  - [5-5. 추천 빌드](#5-5-추천-빌드)
  - [5-6. 스킬 설명, 스킨, 스토리](#5-6-스킬-설명-스킨-스토리)
- [6. 데이터](#6-데이터)
- [7. 상태 처리](#7-상태-처리)
- [8. 환경 변수](#8-환경-변수)
- [9. 반응형과 접근성](#9-반응형과-접근성)
- [10. 완료 기준](#10-완료-기준)
- [11. 결정 사항](#11-결정-사항)
- [12. 계약 변경 요청](#12-계약-변경-요청)
- [13. 작업 범위](#13-작업-범위)

---

## 1. 범위

> **쉬운 요약**: 포지션별 챔피언 티어 표와 챔피언 상세(추천 빌드 + 스킬·스킨·스토리)를 만든다. 통계는 백엔드 API, 이름과 이미지는 Data Dragon에서 가져온다.

### 하는 것
- 공통 레이아웃: 헤더(로고, 내비게이션), 본문, 푸터(공개 패치 이름, 라이엇 고지문)
- 챔피언 티어 리스트: 포지션 탭 5개(탑·정글·미드·원딜·서폿), 티어 순 표, 이름 검색
- 챔피언 상세: Hero(이름·칭호·역할군·난이도), 주 포지션 탭, 통계 요약, 추천 빌드(룬·소환사 주문·스킬 순서·아이템), 스킬 설명, 스킨, 스토리
- 모든 통계 화면에 "최근 14일 · 게임 수 · 패치 구성 · 집계 시각 · 지연 여부" 표시
- 로딩 / 빈 결과 / 통계 없음 / 집계 전 / API 연결 실패 / 없는 챔피언 상태 처리
- 모바일·데스크톱 반응형, 기본 접근성

### 하지 않는 것
- 소환사(전적) 검색, 로그인, AI 피드백
- 라이트 테마와 테마 토글 (다크 고정)
- 다국어 전환 (`ko_KR` 고정)
- 크로마 스킨 표시 (Data Dragon에 이미지가 없음)
- 기본 능력치(`stats`), 플레이 팁(`allytips`/`enemytips`), `recommended` 표시
- 주 포지션이 아닌 포지션(`isMainPosition: false`)의 통계 표시
- 초성 검색
- 상태관리/데이터 패칭 라이브러리, UI 컴포넌트 라이브러리, 테스트 프레임워크 도입

---

## 2. 기술 구성

> **쉬운 요약**: create-next-app 기본 구성(Next.js + TS + Tailwind + ESLint)만 쓰고 추가 의존성은 없다.

| 패키지 | 목적 |
|--------|------|
| `next` 16.4, `react`/`react-dom` 19.3 | App Router, Server Component, 정적 생성(SSG/ISR), `next/image` |
| `typescript`, `@types/*` | Data Dragon·API 응답 타입 |
| `tailwindcss` 4, `@tailwindcss/turbopack` | 스타일 (템플릿 기본값. `next.config.ts`의 `turbopack.rules`와 함께 쓴다) |
| `eslint`, `eslint-config-next` | 린트 |

- **추가 의존성 없음.** `server-only`는 Next 16이 자체 처리하므로 설치하지 않는다. 새 의존성이 필요하면 목적과 이유를 적고 승인을 받는다.
- `next.config.ts`
  - `images.remotePatterns`: `https://ddragon.leagueoflegends.com/cdn/**`만 허용
  - `cacheComponents`, `partialPrefetching`은 쓰지 않는다 (켜면 `export const revalidate`·`dynamicParams`를 쓸 수 없고, 없는 챔피언이 404 대신 200이 될 수 있다)
  - 루트 `.env`에서 `API_BASE_URL`만 읽는다 (8장)
- Next 16 주의점: 동적 라우트 `params`는 `Promise`(`await params`). error 컴포넌트의 다시 시도 prop은 `retry`. 타입 검사 전에 `npx next typegen`이 필요하다.

---

## 3. 디렉토리 구조

> **쉬운 요약**: 라우트는 `app/`, 화면 조각은 `components/`, 백엔드 호출은 `lib/api/`, Data Dragon은 `lib/ddragon/`, 둘을 합친 화면용 데이터는 `lib/view/`에 둔다.

```
frontend/
├── next.config.ts                        # 이미지 허용 주소, Tailwind 로더, 루트 .env에서 API_BASE_URL만 읽기
└── src/
    ├── app/
    │   ├── layout.tsx                    # 공통 틀 (본문 건너뛰기, Header, main, Footer)
    │   ├── globals.css                   # Tailwind + 다크 테마 토큰
    │   ├── page.tsx                      # "/" → "/champions"
    │   ├── not-found.tsx, error.tsx      # 전역 404 / 전역 오류 (client)
    │   └── champions/
    │       ├── page.tsx                  # 탑 티어 표 = TierListPage(TOP)
    │       ├── loading.tsx               # 티어 표 스켈레톤
    │       ├── error.tsx                 # 오류 + 다시 시도 (client)
    │       ├── lane/[position]/page.tsx  # jungle/middle/bottom/utility, top → 308
    │       └── [championId]/
    │           ├── page.tsx              # 상세 (generateStaticParams, 1·2순위 통계)
    │           ├── loading.tsx           # 상세 스켈레톤
    │           └── not-found.tsx         # 없는 챔피언 안내
    ├── components/
    │   ├── layout/                       # Header, NavLink(client), Footer
    │   ├── stats/                        # WindowInfo, TierBadge, StatsNotice
    │   └── champions/
    │       ├── TierListPage.tsx          # (server) 한 포지션 리스트 화면 조립
    │       ├── PositionNav.tsx           # (server) 리스트 포지션 탭 링크
    │       ├── TierTable.tsx             # (client) 검색 + 티어 표
    │       ├── ChampionHero.tsx          # 상세 상단
    │       ├── PositionTabs.tsx          # (client) 상세 ARIA 탭
    │       ├── PositionStatsPanel.tsx    # (server) 한 포지션의 요약 + 빌드 4개
    │       ├── RunePage.tsx              # (client) 1/2순위 전환 + 전체 룬 페이지
    │       ├── SummonerSpells.tsx, SkillOrder.tsx, CoreItems.tsx
    │       ├── ChampionAbilities.tsx     # 패시브 + Q/W/E/R 설명
    │       ├── SkinGallery.tsx           # (client) 스킨 미리보기 + 목록
    │       └── ChampionLore.tsx          # 스토리
    └── lib/
        ├── api/                          # 백엔드 API, 모든 파일 첫 줄 import "server-only"
        │   ├── config.ts                 # API_BASE_URL, 재검증 3600초, 시간 제한 10초
        │   ├── types.ts                  # 계약 v2 응답·오류 타입
        │   ├── client.ts                 # fetchApi<T>() → { ok, data } | { ok:false, kind }
        │   ├── api.ts                    # getMeta, getTierList, getChampionStats, requireStats
        │   ├── positions.ts              # 포지션 순서, 한글 이름, URL 조각 ↔ API 값
        │   └── buildPhase.ts             # next build 중인지 판단
        ├── ddragon/
        │   ├── constants.ts, types.ts, images.ts
        │   ├── api.ts                    # 버전, 챔피언 목록·상세, key 표, 아이템·주문·룬 표
        │   ├── transform.ts              # 원본 → 화면용 챔피언 데이터
        │   ├── itemFilter.ts             # 아이템 거르기 규칙 (5-5)
        │   └── statShards.ts             # 능력치 파편 표
        └── view/
            ├── format.ts                 # 퍼센트, 쉼표, KST 날짜, 패치 구성 글자
            ├── tierList.ts               # API 행 → 표 행
            └── builds.ts                 # 룬·주문·스킬·아이템 → 화면용 모델
```

- 백엔드 호출(`fetch`)은 `lib/api/` 밖에 두지 않는다. Data Dragon 호출은 `lib/ddragon/` 밖에 두지 않는다.
- 클라이언트 컴포넌트는 `TierTable`, `PositionTabs`, `RunePage`, `SkinGallery`, `NavLink`, `error.tsx` 2개뿐이다. 클라이언트로는 화면용 가공 데이터만 넘긴다 (원본 `item.json` 약 733KB를 넘기지 않는다).

---

## 4. 라우트와 렌더링

> **쉬운 요약**: 모든 페이지를 빌드 때 미리 만들고(SSG), 1시간마다 다시 만든다(ISR 3600). 포지션은 쿼리가 아니라 경로로 나눈다.

| URL | 렌더링 | 빌드 시 API 호출 |
|-----|--------|------------------|
| `/` | `redirect('/champions')` (307) | 없음 |
| `/champions` (탑) | SSG + `revalidate = 3600` (○) | `/champions?position=TOP` 1번 + `/meta` |
| `/champions/lane/[position]` | `generateStaticParams`(top 포함 5개) + `dynamicParams = false` + `revalidate = 3600` (●) | 포지션마다 1번 |
| `/champions/[championId]` | 전 챔피언(현재 173개) SSG + `revalidate = 3600`, `dynamicParams` 기본값(true) | 챔피언마다 1~2번 (지금 173 + 89 = 262번) |
| 푸터 | 각 페이지와 함께 렌더 | `/meta` (데이터 캐시로 공유) |

### 포지션 URL
| 탭 | URL | API |
|----|-----|-----|
| 탑 | `/champions` (기본) | `TOP` |
| 정글 | `/champions/lane/jungle` | `JUNGLE` |
| 미드 | `/champions/lane/middle` | `MIDDLE` |
| 원딜 | `/champions/lane/bottom` | `BOTTOM` |
| 서폿 | `/champions/lane/utility` | `UTILITY` |

- 주소 조각은 API 값의 **소문자 그대로**다.
- `/champions/lane/top`은 페이지에서 `permanentRedirect("/champions")`로 308을 준다. `next.config.ts`의 `redirects()`는 경로 비교가 대소문자를 무시해 `/lane/TOP`까지 308이 되므로 쓰지 않는다. 그래서 빌드 표에 lane 경로가 5개로 보인다 (top은 HTML 대신 308로 저장).
- `dynamicParams = false`라 `/champions/lane/TOP`, `/lane/mid`, `/champions/lane`은 바로 404이고 캐시 파일을 새로 만들지 않는다.
- `lane`은 고정 폴더라 `[championId]`보다 먼저 맞춰진다. 영문 챔피언 id에 `lane`은 없다.

### 상세 URL
- `[championId]`는 `champion.json`의 영문 `id` 그대로 (예: `/champions/Aatrox`, `/champions/MonkeyKing`). Data Dragon 주소가 대소문자를 구분하므로(`aatrox.json` → 403) 변환하지 않는다.
- `dynamicParams` 기본값(true)을 둬서 새 패치 챔피언도 재빌드 없이 첫 요청 때 만든다.
- 없는 챔피언: Data Dragon은 404가 아니라 **403**을 준다. 그래서 먼저 `champion.json` 목록에 `id`가 있는지 보고 없으면 `notFound()`.
- 메타데이터: `generateMetadata`로 "{한글 이름} - {칭호}". Data Dragon 실패 시 try/catch로 "챔피언"을 준다.
- 상세 포지션 탭은 URL을 바꾸지 않는다. 두 포지션 내용을 모두 정적 HTML에 넣고 클라이언트에서 보이기만 바꾼다.

### 캐시
| 대상 | 설정 |
|------|------|
| 백엔드 API | `fetch(url, { next: { revalidate: 3600 } })` (계약 4장 권장값, 백엔드 `max-age=600`보다 길다) |
| Data Dragon `versions.json` | `revalidate: 3600` (새 패치 감지) |
| 버전 포함 주소 (`champion.json`, `champion/{id}.json`, `item.json`, `summoner.json`, `runesReforged.json`) | `cache: 'force-cache'` (버전별로 내용 불변). 가장 큰 `item.json` 약 733KB로 데이터 캐시 한도 2MB 이내 |
| 이미지 | `next/image` 최적화 |

- **`searchParams`를 쓰지 않는다.** 읽으면 페이지가 요청마다 동적 렌더링된다.
- 05:00 집계 뒤 최대 약 1시간 안에 새 숫자가 보인다. `aggregatedAt` 기반 빠른 재검증은 하지 않는다.
- API 응답이 없을 때의 동작은 7장 "API가 응답하지 않을 때".

---

## 5. 화면 구성

> **쉬운 요약**: 헤더 아래에 티어 표 또는 상세가 들어간다. 통계가 있는 화면은 맨 위에 기간 한 줄을 둔다.

### 5-1. 공통 레이아웃

> **쉬운 요약**: 모든 페이지에 같은 헤더와 푸터, 가운데 정렬된 본문 폭을 적용한다.

- 헤더: sticky, 높이 56px, 로고(`/` 링크), 메뉴 "챔피언"(`/champions`, 하위 경로 포함 현재 경로면 강조 + `aria-current="page"`). 메뉴는 배열이라 추가만 하면 된다.
- 본문: `main#main-content`, `max-w-6xl`. 첫 요소로 "본문으로 건너뛰기" 링크(포커스 시에만 보임).
- 푸터: `/meta`의 `window.patches[0].displayName` → "패치 26.20 · 데이터: Riot Data Dragon" + 라이엇 고지문. 실패하면 오류를 던지지 않고 "패치 정보 없음" (루트 레이아웃이라 error 경계가 감싸지 못한다).
- 다크 테마 고정. 색 토큰: 배경 `#0b1020`, 표면 `#141b2f`/`#1d2540`, 테두리 `#2a3456`, 글자 `#e7eaf3`, 보조 글자 `#a4adc6`, 포인트(골드) `#e3b456`. 텍스트 대비 4.5:1 이상.
- `<html lang="ko">`, 제목 템플릿 `%s | Tier.GG`, 시스템 한글 글꼴.

### 5-2. 통계 기간 표시

> **쉬운 요약**: 통계가 있는 화면 위쪽에 "어느 기간, 몇 게임, 어떤 패치, 언제 집계"인지 한 줄로 보여준다 (`WindowInfo`).

```
최근 14일 · 3,952게임 · 26.20 67% / 26.19 33% · 10월 15일 03:52 집계
```

| 상황 | 표시 |
|------|------|
| 정상 | 위 한 줄 (작은 회색 글씨). 패치는 `window.patches[]` 순서(최신 먼저), `displayName` + `share` 정수 반올림 |
| 패치 1개 | "패치 26.20" |
| `isStale: true` | 위 줄 + 노란 상자 "통계 갱신이 지연되고 있습니다 (마지막 집계 10월 15일 03:52)". 숫자는 그대로 보여준다. `role="status"` |
| 시각 | `aggregatedAt`을 **KST 고정** `M월 D일 HH:mm` (`timeZone: 'Asia/Seoul'`). 서버에서 만들어 수화 불일치가 없다 |

- 화면 어디에도(푸터 포함) 패치는 `displayName`(26.20)만 쓴다. 내부 값 `16.20`이나 Data Dragon 버전 `16.20.1`은 보여주지 않는다 (계약 1장·5장).
- `share` 반올림 합이 99/101%여도 그대로 둔다 (계약 2-0).

### 5-3. 챔피언 티어 리스트

> **쉬운 요약**: 포지션 탭 하나를 고르면 그 포지션 챔피언을 API 순서(티어 → 점수) 그대로 표로 보여준다. 이름 검색으로 걸러 볼 수 있다.

```
탑 챔피언 티어
최근 14일 · 3,952게임 · 26.20 67% / 26.19 33% · 10월 15일 03:52 집계
[탑] [정글] [미드] [원딜] [서폿]
[🔍 챔피언 이름 검색 (한글/영문)        ]
 #  챔피언              티어     승률    픽률    밴률   게임
 1  [img] 다리우스       1티어   53.1%   8.2%   9.0%   325
48  [img] 퀸            표본 부족 55.3%   1.5%   2.4%    38
```

- 포지션 탭: `<nav aria-label="포지션">` 안의 `<Link>` 5개, 현재 탭 `aria-current="page"` + 강조.
- 표 열

| 열 | 값 | 보이는 폭 |
|----|----|-----------|
| `#` | `rank` | 전부 |
| 챔피언 | 아이콘 + 한글 이름 (이름이 상세 링크) | 전부 |
| 티어 | `tier` 1~5 → "1티어"~"5티어" 배지(글자 + 색). `null` → 회색 "표본 부족" | 전부 |
| 승률 / 픽률 | 소수 1자리 % | 전부 |
| 밴률 / 게임 | `banRate`, `pick` | `sm` 이상 |
| 주 포지션 | `mainPositions`가 2개면 다른 포지션 (예: "미드 겸용") | `md` 이상 |

- **정렬:** API `rank` 그대로. 프론트는 다시 정렬하지 않고, `tier`를 다시 계산하지 않는다 (계약 2-3).
- **검색:** 현재 탭 안에서 한글 이름·영문 id 부분 일치, 대소문자·공백 무시, 즉시 필터. 순위 번호는 걸러도 바뀌지 않는다. 결과 개수 `aria-live="polite"`. 상태는 컴포넌트 state만 (URL 쿼리 동기화 없음).
- **목록에 없는 챔피언:** API가 준 챔피언만 보여준다. 통계가 없는 챔피언은 리스트에 없고 상세 주소로는 볼 수 있다.
- **Data Dragon에 없는 `championId`:** "챔피언 #950" 글자 행, 링크·아이콘 없음, 서버 경고 1줄.
- 행 전체 클릭: 링크는 이름 칸 1개, CSS(`<tr class="relative">` + 링크 `after:inset-0`)로 행 전체로 넓힌다.
- 첫 화면 아이콘 10행은 `loading="eager"`, 첫 1개 `fetchPriority="high"`.
- 페이지 제목: "{포지션} 챔피언 티어".

### 5-4. 챔피언 상세

> **쉬운 요약**: "← 목록" 링크, Hero, 포지션 탭(통계 요약 + 추천 빌드), 스킬 설명, 스킨, 스토리 순서다.

```
← 탑 티어 목록
┌ Hero ──────────────────────────────────┐
│ [아이콘] 아트록스 · 다르킨의 검 · [전사] · 난이도 │
└───────────────────────────────────────┘
최근 14일 · 3,952게임 · 26.20 67% / 26.19 33% · 10월 15일 03:52 집계
[정글 · 2티어 · 86%] [탑 · 표본 부족 · 11%]
  요약 줄 / 추천 룬 / 소환사 주문 / 스킬 순서 / 많이 완성한 아이템
스킬 · 스킨 · 스토리
```

- **"← 목록"**: 1순위 포지션 탭 주소와 글자("← 정글 티어 목록"). 통계가 없으면 `/champions`, "탑 티어 목록".
- **Hero**: 기본 스킨(`num 0`) 스플래시(장식 `alt=""`, `fetchPriority="high"` + `loading="eager"`. `priority`는 Next 16에서 사용 중단이라 쓰지 않는다), 스퀘어 아이콘, 이름(`h1`), 칭호, 역할군 배지(한글), 난이도(`info.difficulty` 0~10) 막대. 모바일은 스플래시 위·정보 아래, md 이상은 배경 위 오버레이.
- **포지션 탭**
  - 탭 = API `positions[]` (주 포지션 1~2개, pick 많은 순). 글자 "정글 · 2티어 · 86%" (`positionShare` 정수). `tier null`이면 "표본 부족".
  - 빌드 때 `position` 없이 1번 호출(1순위)하고, 2순위가 있으면 `?position=…`으로 1번 더 부른다.
  - 2순위가 `STATS_NOT_FOUND`, `STATS_NOT_READY`, 또는 빌드 중 연결 실패면 그 탭만 뺀다 (서비스 중 연결 실패는 오류를 던진다).
  - 두 응답의 `window.aggregatedAt`이 다르면 1순위 `window`를 표시하고 서버 경고 1줄.
  - WAI-ARIA 탭: `role="tablist"/"tab"/"tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`, 로빙 `tabIndex`, ←/→·Home/End, 숨은 패널 `hidden`. 탭이 1개면 탭 줄 없이 "탑" 글자(`p`)만.
- **통계 요약 줄**: 티어 배지, 승률, 픽률, 밴률, 게임 수. `tier null`이면 "표본 부족 (50게임 미만)" 배지 + "표본이 적어 참고용입니다."
- **제목 구조**: `h1` 챔피언 이름 → `h2` "포지션별 통계와 추천 빌드" → 빌드 카드 `h3` → `h2` 스킬·스킨·스토리.
- **레이아웃**: `lg` 이상 2열(왼쪽 룬 / 오른쪽 주문·스킬·아이템), 그 밑은 1열.

### 5-5. 추천 빌드

> **쉬운 요약**: API의 숫자 ID를 Data Dragon으로 이름·아이콘으로 바꿔 보여준다. 아이템은 프론트가 완성 아이템만 골라낸다.

| 영역 | 보여줄 것 | Data Dragon 매핑 |
|------|-----------|------------------|
| **룬** | `runes[0]`을 **전체 페이지**로: 핵심 트리 4줄(핵심 룬 줄은 크게), 보조 트리 3줄(핵심 룬 줄 제외), 능력치 파편 3줄. 각 줄의 모든 룬을 보이고 고른 것만 밝게. 룬이 2개면 "1순위 / 2순위" 버튼(`aria-pressed`, 사용률·승률) | `runesReforged.json` 트리·룬 `id` → `name`, 아이콘 `/cdn/img/{icon}`. 파편은 프론트 표(아래) |
| **소환사 주문** | 상위 2조합, 각 줄 아이콘 2개 + "점멸 + 점화" + 사용률·승률·게임. 순서는 API 순서 (D/F 위치 정보 없음) | `summoner.json`에서 `key == String(spellId)` → 이름, 이미지 `/cdn/{v}/img/spell/{image.full}` |
| **스킬 순서** | `skills[0]`을 Q/W/E/R × 11레벨 격자(`<table>`, 칸 안에 글자 "Q" 등). 줄 머리에 스킬 아이콘·글자·sr 이름. 2순위는 "Q E W Q Q R …" 한 줄 + 사용률·승률 | 챔피언 상세 `spells[0..3]` |
| **아이템** | "많이 완성한 아이템" 핵심 **3개** + 신발 **1개**, 각 아이콘·이름·사용률·승률. 제목 옆 "게임이 끝날 때 가지고 있던 아이템 기준 · 구매 순서 아님" | `item.json` `data[String(itemId)]` → 이름, 이미지 `/cdn/{v}/img/item/{itemId}.png` |

#### 아이템 거르기 규칙 (`lib/ddragon/itemFilter.ts`)

위에서부터 차례로 판단해 `core`(핵심) / `boots`(신발) / `excluded`(제외)로 나눈다.

| 순서 | 조건 | 결과 | 예 |
|------|------|------|-----|
| 1 | Data Dragon에 없음 (최신 + `window.patches`의 다른 패치 `{patch}.1` 버전까지 찾아도) | 제외 (서버 경고 1줄) | 사라진 아이템 |
| 2 | `tags`에 `Consumable` 또는 `Trinket` | 제외 | 충전형 물약 `2031`, 제어 와드 `2055`, 장신구 `3340`/`3364` |
| 3 | `from`이 없고 `gold.total < 1000` | 제외 (시작 아이템) | 도란 `1054`/`1055`, 정글 펫 `1101~1103`, 서폿 시작템 `3865`/`3866`, 장화 `1001` |
| 4 | `tags`에 `Boots`, **또는 재료에 `Boots` 아이템이 있음** (`builtFromBoots`) | 신발 후보 | 판금 장화 `3047`, 건메탈 군화 `3172`(태그에 `Boots`가 없음) |
| 5 | `into`가 있음 (하위 재료) | 제외 | 롱소드 `1036` |
| 6 | 나머지 | 핵심 후보 | 완성 아이템, 변신 아이템(무라마나 `3042` 등, `into`·`from` 없음), 서폿 퀘스트 최종 아이템 |

- 후보는 API 순서(pick 내림차순)를 지키고 앞에서 핵심 3개(`CORE_ITEM_COUNT = 3`), 신발 1개를 고른다.
- 신발은 사용률 **5% 미만이면 칸을 숨긴다** (`BOOTS_MIN_PICK_RATE = 5`). 원딜은 지금 대부분 숨겨진다.
- 계약 문구("`into` 있으면 뺀다")만 따르면 틀린다: 2단계 신발 `3047`은 `into`가 있어 빠지고, 도란처럼 `into` 없는 시작템이 남는다. 그래서 이 규칙을 쓴다 (D3).

#### 능력치 파편 표 (`lib/ddragon/statShards.ts`)

Data Dragon에 파편 정보가 없어 프론트가 표로 갖는다.

| 줄 | 선택지 (ID · 이름 · 아이콘 파일) |
|----|------|
| 공격 | 5008 적응형 능력치 `StatModsAdaptiveForceIcon` · 5005 공격 속도 `StatModsAttackSpeedIcon` · 5007 스킬 가속 `StatModsCDRScalingIcon` |
| 유연 | 5008 적응형 능력치 · 5010 이동 속도 `StatModsMovementSpeedIcon` · 5001 체력 증가(레벨 비례) `StatModsHealthScalingIcon` |
| 방어 | 5011 체력 `StatModsHealthPlusIcon` · 5013 강인함 및 둔화 저항 `StatModsTenacityIcon` · 5001 체력 증가(레벨 비례) |

- 이미지: `/cdn/img/perk-images/StatMods/{파일}.png` (버전 없음). 표에 없는 ID는 회색 칸 + "알 수 없는 파편".

### 5-6. 스킬 설명, 스킨, 스토리

> **쉬운 요약**: 상세 아래쪽에 패시브·스킬 설명, 스킨 갤러리, 스토리를 Data Dragon 데이터로 보여준다.

- **스킬**: 패시브 + Q/W/E/R (`spells` 순서 = Q,W,E,R). 아이콘(반드시 `image.full`. 예: 오공 Q `MonkeyKingDoubleAttack.png`), 키 라벨, 이름(`h3`), 재사용 대기시간(`cooldownBurn`, 패시브 제외), 설명.
  - 설명은 `description`을 쓴다 (`tooltip`은 `{{ }}` 변수가 남아 있다). `<br>`는 줄바꿈, 나머지 HTML 태그는 지우고 기본 HTML 엔티티 6종을 되돌린다. `dangerouslySetInnerHTML`을 쓰지 않는다. 화면은 `whitespace-pre-line`.
- **스킨**: `skins` 중 `parentSkin`이 **없는** 것만 (크로마 제외, 크로마 이미지는 403), `num` 오름차순. `num 0`의 이름 `"default"`는 "기본".
  - 상단 16:9 미리보기(스플래시 `splash/{id}_{num}.jpg`) + 스킨 이름(`figcaption`, `aria-live`). 기본 선택 `num 0`.
  - 아래 격자: 로딩 이미지(`loading/{id}_{num}.jpg`, 308:560 세로) + 이름. 카드는 `<button aria-pressed>`, 선택 시 골드 테두리. 누르면(Enter/Space 포함) 미리보기 교체. 모달은 만들지 않는다.
  - 이미지 실패 시 회색 플레이스홀더 + 이름 (고정 비율 유지).
- **스토리**: `lore` 텍스트.

---

## 6. 데이터

> **쉬운 요약**: 통계 숫자는 백엔드 API에서, 이름과 이미지는 Data Dragon에서 가져와 숫자 ID로 연결한다.

### 6-1. Data Dragon 주소 (`api.md` 기준)

| 용도 | URL | 캐시 |
|------|-----|------|
| 최신 버전 | `/api/versions.json` → `[0]` | revalidate 3600 |
| 챔피언 목록 | `/cdn/{v}/data/ko_KR/champion.json` | force-cache |
| 챔피언 상세 | `/cdn/{v}/data/ko_KR/champion/{id}.json` | force-cache |
| 아이템 / 소환사 주문 / 룬 | `/cdn/{v}/data/ko_KR/item.json`, `summoner.json`, `runesReforged.json` | force-cache |
| 스퀘어 / 스킬 / 패시브 / 아이템 / 주문 이미지 | `/cdn/{v}/img/champion|spell|passive|item|spell/…` | next/image |
| 스플래시 / 로딩 | `/cdn/img/champion/splash|loading/{id}_{num}.jpg` (버전 없음) | next/image |
| 룬 / 파편 이미지 | `/cdn/img/{icon}`, `/cdn/img/perk-images/StatMods/…` (버전 없음) | next/image |

- 기본 URL `https://ddragon.leagueoflegends.com`, 로케일 `ko_KR`.
- 이름·이미지는 **최신 Data Dragon 버전**을 쓴다. 아이템을 못 찾을 때만 `window.patches`의 다른 패치 `{patch}.1`이 `versions.json`에 있는지 보고 한 번 더 찾는다 (계약 5장). `displayName`(26.20)으로 Data Dragon을 찾지 않는다.
- 가공 결과(key 표, 아이템·주문·룬 표)는 버전마다 한 번만 만들고, 실패하면 지우고 다음에 다시 시도한다.
- 모든 fetch는 `res.ok`가 아니면 오류를 던진다. 같은 요청 안의 중복 호출은 Next fetch 메모이제이션으로 1번만 실행된다.

### 6-2. 백엔드 API 클라이언트 (`lib/api/`)

- 쓰는 엔드포인트: `GET /meta`, `GET /champions?position=`, `GET /champions/:key[?position=]` (계약 v2).
- `types.ts`는 계약 v2 그대로다. 계약에 없는 필드는 쓰지 않고, 모르는 필드는 무시한다. `tier`는 `1|2|3|4|5|null`.
- `fetchApi` 결과 분류 (시간 제한 10초)

| `kind` | 언제 | 화면 |
|--------|------|------|
| `ok` | 2xx | 정상 |
| `not_ready` | 503 `STATS_NOT_READY` | 집계 전 안내 (정상 상태로 캐시) |
| `not_found` | 404 `STATS_NOT_FOUND` | 상세 "통계 없음" / 2순위 탭 제외 |
| `unavailable` | 연결 실패, 시간 초과, 503 `DB_UNAVAILABLE`, 500, JSON 아님, `API_BASE_URL` 없음 | 7장 "API가 응답하지 않을 때" |
| `invalid` | 400 `INVALID_PARAMETER`, 404 `NOT_FOUND` | 프론트 버그로 보고 `unavailable`과 같게 처리 + 서버 로그에 `code` |

- 분기는 HTTP 상태와 `error.code`로만 한다 (`message`는 바뀔 수 있다). 로그에는 경로·상태·`code`만 남기고 기본 URL은 남기지 않는다.

### 6-3. 화면용 매핑 (`lib/view/`, `lib/ddragon/transform.ts`)

- `tierList.ts`: `TierRow` + 챔피언 key 표 → `{ rank, championId, id?, name, iconUrl?, tier, 승률·픽률·밴률·게임, 다른 주 포지션? }`.
- `builds.ts`: 룬 → 트리 줄별 `{ runes: [{ id, name, iconUrl, selected }] }` + 파편 3줄 + sr 요약. 못 찾은 ID는 "알 수 없는 룬 #id"/"알 수 없는 주문 #id". 스킬 → 11칸 격자. 아이템 → `itemFilter`로 `{ core[≤3], boots? }`.
- `format.ts` (서버에서만 호출)
  - `formatPercent(52.76) → "52.8%"`: 소수 1자리 사사오입. `toFixed(1)`만 쓰면 이진 소수 오차로 `2.15 → "2.1"`이 되므로 1/100 정수로 맞춘 뒤 반올림한다.
  - `formatCount` 천 단위 쉼표, `formatKst(iso) → "10월 15일 03:52"`, `formatPatchMix(patches)`.
- `transform.ts`: 태그 한글 매핑(`Fighter 전사 / Tank 탱커 / Mage 마법사 / Assassin 암살자 / Marksman 원거리 / Support 서포터`, Hero 배지용), HTML 제거, 크로마 제외, `default` → "기본". `Object.hasOwn` + `id` 일치로 `__proto__` 같은 키와 대소문자 다른 id를 거른다.
- 이름 규칙: 챔피언 Q/W/E/R은 코드에서 `skill`, 소환사 주문은 `summonerSpell`로 부른다 (Data Dragon 원본 필드 `spells`는 그대로).

---

## 7. 상태 처리

> **쉬운 요약**: 상황마다 정해진 문구를 보여준다. 통계를 못 받아도 Hero·스킬·스킨·스토리는 항상 보인다.

| 상황 | 티어 리스트 | 상세 |
|------|-------------|------|
| 로딩 (스트리밍) | `champions/loading.tsx`: 제목·기간 줄·탭 5개·검색·10행 스켈레톤, 바깥 `min-h-screen` (CLS 방지) | `[championId]/loading.tsx`: Hero·통계 제목·탭·요약·빌드 카드·스킬 스켈레톤 |
| 검색 결과 없음 | "'{검색어}'에 해당하는 챔피언이 없습니다" + [검색 지우기] (누르면 검색창으로 포커스) | — |
| `champions: []` | 탭은 그대로, "이 포지션의 최근 14일 통계가 아직 없습니다" | — |
| `503 STATS_NOT_READY` | "아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다." (정상 상태로 캐시) | 같은 문구 |
| `404 STATS_NOT_FOUND` | — | 포지션 탭·빌드 대신 "최근 14일 통계가 없습니다." (계약 2-4) |
| 티어 `null` | 회색 "표본 부족" + `title`·sr "최근 14일 50게임 미만이라 티어를 매기지 않았습니다" (`/meta` `rules.minTierPick`, 없으면 50) | "표본 부족 (50게임 미만)" + "표본이 적어 참고용입니다." |
| 빌드 항목 빈 배열 / 아이템 후보 0개 | — | 그 영역만 "표본이 부족해 추천이 없습니다" |
| 룬·주문·파편 ID 못 찾음 | — | 회색 칸 + "알 수 없는 …" (페이지는 정상) |
| `isStale` | 5-2 노란 상자 | 같음 |
| Data Dragon 실패 | `champions/error.tsx` "데이터를 불러오지 못했습니다" + [다시 시도] + [챔피언 목록으로] | 같음, 탭 제목 "챔피언 \| Tier.GG" |
| 없는 챔피언 `/champions/Foo` | — | 404 + "챔피언을 찾을 수 없습니다" + [챔피언 목록으로] |
| 그 밖의 없는 URL | 전역 404 + 홈 링크 | — |
| 개별 이미지 실패 | 고정 비율 회색 칸 | 같음 |

### API가 응답하지 않을 때 (`unavailable`, 결정 D6)

| 시점 | 동작 | 이유 |
|------|------|------|
| `npm run build` 중 (`process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD`, `next/constants`) | 오류를 던지지 않고 통계 자리에 "통계 서버에 연결하지 못했습니다"(`role="status"`)를 넣어 페이지를 만든다. **빌드는 성공**. 빌드 로그 경고는 작업 프로세스마다 첫 실패 1줄 (지금 7줄) | 개발 단계에서 백엔드는 수동 실행이라 백엔드 없이도 빌드·Data Dragon 화면 확인이 가능해야 한다 |
| 서비스 중 ISR 재생성 | `requireStats()`가 **오류를 던진다** → Next가 직전에 성공한 페이지를 계속 보여주고 다음 요청 때 다시 시도한다 | API가 잠깐 죽어도 정상 통계 페이지를 "연결 실패"로 1시간 덮어쓰지 않는다 |
| 서비스 중 처음 만드는 페이지 | 오류를 던진다 → `champions/error.tsx` (HTTP 500) | 보여줄 직전 페이지가 없다 |
| 푸터 | "패치 정보 없음" (오류 안 던짐) | 루트 레이아웃은 error 경계 밖 |

- `STATS_NOT_READY`와 `STATS_NOT_FOUND`는 오류가 아니라 정상 상태로 그려서 캐시한다.
- 한계: API 없이 빌드한 페이지는 첫 재검증(최대 1시간) 전까지 "연결 실패" 안내가 보인다. 운영 배포는 API를 켠 상태에서 빌드한다.
- 이전 빌드의 API 응답은 `.next/cache/fetch-cache`에 최대 1시간 남는다. API 없는 빌드를 일부러 확인하려면 이 폴더를 지우고 빌드한다.

---

## 8. 환경 변수

> **쉬운 요약**: 변수 `API_BASE_URL` 1개만 쓴다. 루트 `.env`에 두고 `next.config.ts`가 **이 변수 하나만** 골라 읽는다. 서버 전용이다.

| 변수 | 예 | 용도 |
|------|-----|------|
| `API_BASE_URL` | `http://localhost:4000/api/v1` | 백엔드 읽기 API 기본 URL (`/api/v1`까지 포함, 끝 `/` 없음) |

- 읽는 방법(결정 D8): `next.config.ts`가 `../.env`가 있으면 Node 기본 기능(`node:fs` + `util.parseEnv`)으로 읽어 **`API_BASE_URL`만** `process.env`에 넣는다. 이미 값이 있으면(배포 환경 변수) 덮어쓰지 않는다. 그래서 `DATABASE_URL`·`RIOT_API_KEY`는 프론트 프로세스에 들어오지 않는다.
- `NEXT_PUBLIC_`을 붙이지 않고 `next.config.ts`의 `env` 옵션도 쓰지 않는다 (값이 브라우저 번들에 박힌다). 서버 컴포넌트만 API를 부른다 (계약 1장: CORS 없음).
- 값이 없으면 기본값을 넣지 않고 `unavailable`로 처리하며 서버 로그에 "API_BASE_URL이 설정되지 않았습니다" 1줄 (조용히 localhost로 붙지 않게).
- `.env.example`에는 "백엔드 API 서버" 묶음 아래 `API_BASE_URL=`과 주석이 있다. `.env`에 실제 값을 넣는 일은 사용자가 한다. 값은 문서·로그에 쓰지 않는다.

---

## 9. 반응형과 접근성

> **쉬운 요약**: 360px 휴대폰에서도 가로 스크롤이 없고, 키보드·스크린리더로 모든 기능을 쓸 수 있게 한다.

### 반응형 (Tailwind 기본 breakpoint)

| 요소 | 모바일(<640) | sm(≥640) | md(≥768) | lg(≥1024) |
|------|------|------|------|------|
| 리스트 포지션 탭 | 한 줄, 넘치면 탭 줄만 가로 스크롤 | 한 줄 | ← | ← |
| 티어 표 | 5열(#·챔피언·티어·승률·픽률), 열 폭·여백 축소, 이름 말줄임 | 7열 | 8열(주 포지션) | ← |
| 기간 줄 | 줄바꿈 허용 | 한 줄 | ← | ← |
| 상세 Hero | 스플래시 위, 정보 아래 | ← | 스플래시 위 정보 오버레이 | ← |
| 상세 빌드 | 1열: 룬 → 주문 → 스킬 → 아이템 | 1열 | 1열 | 2열 |
| 스킬 격자 | 칸 22px (360px 안에 들어감) | 칸 28px | ← | ← |
| 룬 페이지 | 트리 2개 세로 | 트리 2개 가로 | ← | ← |
| 스킨 격자 | 3열 | 4열 | 5열 | 6열 |

- 최소 지원 폭 360px, 페이지 가로 스크롤 없음.
- 이미지는 `next/image` + `sizes` + 고정 비율·고정 크기 칸으로 CLS 0을 지킨다. 작은 아이콘은 `sizes`를 고정 px로.

### 접근성
- `<html lang="ko">`, 페이지당 `h1` 1개, 제목 단계를 건너뛰지 않는다.
- 이미지 `alt`: 챔피언 아이콘 = 이름, 스킬 = 스킬 이름, 스킨 = 스킨 이름, 아이템·주문·룬 = 이름, Hero 배경·고르지 않은 룬 = `alt=""`(룬은 `aria-hidden`도). 룬 영역 앞에 sr 요약 "핵심 룬(정밀): …".
- 티어 배지는 글자("2티어", "표본 부족")를 항상 포함한다. 색은 보조.
- 표: `<caption>`(sr-only, 예: "탑 챔피언 티어 표"), `th scope`. 스킬 격자 `caption` "스킬 찍는 순서 1~11레벨", 줄 머리 `th scope="row"`.
- 검색 입력에 `<label>`(sr-only), 결과 개수 `aria-live="polite"`.
- 리스트 탭 `nav` + `aria-current="page"`, 상세 탭 ARIA 탭 패턴, 룬·스킨 버튼 `aria-pressed`, 지연·연결 실패 안내 `role="status"`.
- 모든 상호작용 요소는 네이티브 `a`/`button`/`input`, 공통 `focus-visible` 골드 2px 링.
- 텍스트 대비 4.5:1 이상 (티어 배지 5색 포함). "본문으로 건너뛰기" 링크.

---

## 10. 완료 기준

> **쉬운 요약**: Review 에이전트가 아래 항목을 확인한다. 집계가 매일 바뀌므로 숫자는 고정값이 아니라 그 시점 API 응답과 비교한다. 백엔드를 켠 상태와 끈 상태 모두 빌드해 본다.

### 검증 명령
- [ ] `npm run lint` 오류 0, `npx next typegen && npx tsc --noEmit` 오류 0, `any` 0건
- [ ] 새 의존성 없음 (`package.json` dependencies·devDependencies 변경 없음)
- [ ] 백엔드 켬 + `npm run build` 성공: `○ /champions`, `● /champions/lane/[position]`(top 포함 5개), `● /champions/[championId]` 전 챔피언, 모두 Revalidate 1h. 빌드 로그에 `[api]`·`[view]`·`[stats]` 경고 0
- [ ] 백엔드 끔(`.next/cache/fetch-cache` 비움) + `npm run build`도 성공, 생성된 리스트·상세 HTML에 "통계 서버에 연결하지 못했습니다"와 Data Dragon 정보(Hero·스킬·스킨·스토리)가 있음
- [ ] `fetch(`·백엔드 주소는 `lib/api/`에만, Data Dragon 주소는 `lib/ddragon/`에만, `lib/api/*` 첫 줄 `server-only`, `dangerouslySetInnerHTML` 0건
- [ ] 브라우저 번들(`.next/static`)에 `API_BASE_URL` 값·`localhost:4000`·`/api/v1`·`NEXT_PUBLIC_` 문자열 0건

### 공통 레이아웃
- [ ] 모든 페이지에 헤더(로고, "챔피언" 메뉴, `aria-current`)와 푸터("패치 26.xx", 고지문)
- [ ] `/` → 307 `/champions`

### 리스트
- [ ] `/champions` = 탑, 탭 5개, 현재 탭 `aria-current="page"`
- [ ] 각 탭의 행 수·순서·티어·승률·픽률·밴률·게임이 그 시점 `/api/v1/champions?position=…` 응답과 같음 (`rank` 순, `tier null`은 맨 뒤 "표본 부족", 소수 1자리)
- [ ] `/champions/lane/top` → 308 `/champions`, `/lane/TOP`·`/lane/Jungle`·`/lane/mid`·`/champions/lane` → 404, 그 뒤에도 정상 페이지 그대로
- [ ] 검색 "아트" → 아트록스 1행, 순위 유지, 결과 없음 문구 + [검색 지우기] 후 검색창 포커스
- [ ] 행 어디를 눌러도 `/champions/{id}`

### 상세
- [ ] `/champions/Aatrox`: "아트록스", "다르킨의 검", "전사", 난이도, 탭 제목 "아트록스 - 다르킨의 검 | Tier.GG"
- [ ] 포지션 탭 수·순서가 API `positions[]`와 같고 탭 글자에 티어·비율. 주 포지션 2개 챔피언에서 클릭·←/→·Home/End, `aria-selected`·`hidden` 정상
- [ ] 룬 1순위 전체 페이지(핵심 4 + 보조 2 + 파편 3)가 API ID와 같은 이름·아이콘, 2순위 전환 동작
- [ ] 소환사 주문 2조합, 스킬 격자 11칸이 `skillOrder`와 같음
- [ ] 아이템: 아트록스 탑에 롱소드 `1036`·도란 `1054`/`1055`·`2031`·`2055`가 없고 신발 칸에 `3047`. 건메탈 군화 `3172`는 신발 칸에만. 징크스 원딜 신발 칸 숨김
- [ ] 패시브 + Q/W/E/R 5개, 설명에 HTML 태그·`{{ }}` 없음, `/champions/MonkeyKing` 스킬 아이콘 정상
- [ ] 스킨: 크로마 제외(아트록스 13개, 16.20.1), 첫 스킨 "기본", 클릭·키보드 선택 시 미리보기 교체 + `aria-pressed`
- [ ] 스토리 표시, "← 목록"이 1순위 포지션 탭으로
- [ ] `/champions/Foo` → 404 + 안내 + 목록 링크
- [ ] 이미지 깨짐 0, 콘솔 오류·수화 경고 0

### 상태 (실제로 만들어 확인)
- [ ] 기간 줄이 `/meta`와 같고 시각이 KST. 화면 어디에도 `16.20`·`16.20.1`이 보이지 않음
- [ ] `isStale`, `STATS_NOT_READY`, `STATS_NOT_FOUND`, 빈 목록, 표본 부족, 알 수 없는 ID, 빈 빌드 영역: scratchpad의 가짜 응답 서버 + `API_BASE_URL`만 바꾼 실행으로 확인 (프로젝트·DB 변경 없음)
- [ ] 서비스 중 API를 끈 뒤 재검증 시간이 지나도 직전 정상 페이지가 계속 보임, 처음 만드는 페이지는 error 화면 (`revalidate`를 줄인 scratchpad 복사본)
- [ ] 로딩 스켈레톤(개발 모드), Data Dragon 실패 시 error 화면 + [다시 시도]

### 반응형·접근성
- [ ] 360 / 768 / 1280px 가로 스크롤 없음, 열 수가 9장 표와 같음, 스킬 격자가 360px에 들어감
- [ ] 키보드만으로 포지션 탭·검색·상세 이동·상세 탭·룬 전환·스킨 선택 가능, 포커스 링 보임
- [ ] 티어 글자, 표 `caption`/`th scope`, 고른 룬만 `alt`, `alt` 누락 0, 대비 4.5:1 (티어 배지 5색 포함)

### 성능
- [ ] Lighthouse를 **같은 조건**으로 `/champions`·`/champions/Aatrox` 측정하고 이전 값과 나란히 기록한다
  - 조건: Lighthouse **13.5.0**(scratchpad에 설치), **모바일, 시뮬레이션 제한**, `next build` + `next start`, 로컬, 백엔드 켬, 이미지 캐시를 1회 실행으로 데운 뒤 **3회 중앙값**
  - 비교 기준값(변경 01 Review): `/champions` 성능 96 · LCP 2.77s · CLS 0, `/champions/Aatrox` 95 · 2.98s · 0. LCP 요소 이름도 함께 적는다
- [ ] LCP 이미지 `fetchpriority="high"`, CLS 0, Lighthouse 접근성 100 유지

---

## 11. 결정 사항

> **쉬운 요약**: 지금도 유효한 결정만 둔다. 바꾸려면 새 계획으로 승인을 받는다.

| # | 결정 | 이유 | 날짜 |
|---|------|------|------|
| v1-1 | 상세 URL은 영문 id 그대로 (`/champions/MonkeyKing`) | Data Dragon과 1:1, 변환 코드·버그 없음 | 2026-10-12 |
| v1-2 | 스킨 리스트는 상세 페이지 안 섹션 | 요구사항에 가장 직접적, 구현 단순 | 2026-10-12 |
| v1-3 | 스킨 크게 보기는 상단 미리보기 교체 (모달 없음) | 모달의 포커스 트랩·ESC 처리 없이 접근성 확보 | 2026-10-12 |
| v1-4 | 크로마 스킨 제외 | Data Dragon에 크로마 이미지가 없음(403) | 2026-10-12 |
| v1-5 | 상세는 기본정보 + 스킬 + 스킨 + 스토리 (+ 변경 01의 통계·빌드). `stats`·팁·`recommended`는 표시 안 함 | 범위 최소화 | 2026-10-12 |
| v1-6 | 검색 상태는 컴포넌트 state만 (URL 쿼리 동기화 없음) | 단순함. `searchParams`를 쓰면 정적 생성도 잃는다 | 2026-10-12 |
| v1-7 | 초성 검색 제외 | 범위 최소화, 이후 추가 쉬움 | 2026-10-12 |
| v1-8 | 이미지는 `next/image` 최적화 사용 | 스플래시를 기기 크기에 맞게 줄여 모바일 성능 향상. 배포 시 최적화 사용량 한도가 걱정되면 `unoptimized` 검토 | 2026-10-12 |
| v1-9 | `/`는 `/champions`로 리다이렉트 | 보여줄 홈 콘텐츠 없음 | 2026-10-12 |
| v1-10 | 다크 테마 고정 | 지침의 "다크 기본" 충족, 토글은 이후 | 2026-10-12 |
| v1-11 | `cacheComponents`·`partialPrefetching` 끔 | 켜면 `revalidate`·`dynamicParams`를 못 쓰고 없는 챔피언이 200이 될 수 있다 | 2026-10-12 |
| v1-12 | macOS 소문자 URL 캐시 덮어쓰기는 코드 수정 없이 알려진 문제로 둔다 | 대소문자를 구분하는 배포 환경과 `npm run dev`에는 영향 없음. 필요하면 Proxy에서 정식 id로 리다이렉트하는 기능을 따로 계획 (사용자 결정) | 2026-10-12 |
| v1-13 | 챔피언 Q/W/E/R은 `skill`, 소환사 주문은 `summonerSpell`로 이름 짓는다. `ChampionAbility`↔`skill` 혼용 정리, `IMMUTABLE`→`CACHE_FOREVER` 이름 변경은 하지 않는다 | 두 "spell"이 헷갈리지 않게. 나머지 이름 변경은 효과 대비 변경 범위가 큼 (사용자 결정) | 2026-10-12 |
| D1 | 리스트 포지션은 경로: `/champions`(탑) + `/champions/lane/{jungle,middle,bottom,utility}` | 쿼리는 요청마다 동적 렌더링이 되어 SSG·ISR을 잃는다. 한 페이지 클라이언트 탭은 HTML이 5배이고 주소 공유가 안 된다. 경로는 5개 모두 정적, `dynamicParams=false`로 대소문자 캐시 문제도 없음 | 2026-10-15 |
| D1-b | 상세 포지션 탭은 두 포지션 모두 정적 HTML에 넣고 클라이언트 전환 (URL 그대로) | 주 포지션은 최대 2개라 HTML 증가가 작다. `?position=` 동기화는 상세 173개를 동적으로 만든다 | 2026-10-15 |
| D2 | 리스트에는 API가 준 챔피언만 | 지금 173명 모두 어느 포지션엔가 나온다. 나머지를 붙이면 표가 무의미해진다. 상세 주소는 그대로 열림 | 2026-10-15 |
| D3 | 아이템은 5-5 규칙 (시작템 제외, 신발 따로, 신발 5% 미만 숨김) | 계약 문구대로면 아트록스 70%가 산 판금 장화가 빠지고 도란의 방패가 "완성 아이템"이 된다 (실측) | 2026-10-15 |
| D3-b | 규칙 4에 "신발로 만드는 아이템(`builtFromBoots`)" 추가 | 건메탈 군화 `3172`는 태그에 `Boots`가 없어 핵심 아이템으로 나왔다 (Review 발견, 야스오·요네 등 5곳) | 2026-10-15 |
| D4 | Hero 스플래시 `priority` → `fetchPriority="high"` + `loading="eager"`, 리스트 첫 10행 아이콘 eager | `priority`는 Next 16 사용 중단 대상. 같은 파일을 고치는 김에 포함 | 2026-10-15 |
| D5 | 푸터 패치는 `/meta`의 `patches[0].displayName` ("패치 26.20"), 실패 시 "패치 정보 없음" | 계약 5장 "푸터 포함 `displayName`만". 프론트가 메이저 + 10을 계산하면 백엔드 규칙을 복제하게 된다 | 2026-10-15 |
| D6 | API 없이 빌드하면 안내로 통과, 서비스 중 재생성엔 오류를 던져 직전 페이지 유지 | 개발 단계에서 백엔드는 수동 실행. 통계만 동적 렌더링하면 SSG 이점을 잃는다 | 2026-10-15 |
| D7 | v1 문제 중 상세 `generateMetadata` try/catch만 고친다. 스킨 `alt` 중복, 하위 경로 `aria-current`는 보류 | 같은 파일이고 작다. 나머지는 범위 밖 | 2026-10-15 |
| D8 | `next.config.ts`가 루트 `.env`에서 `API_BASE_URL`만 읽는다 | 루트 `.env` 규칙을 지키면서 프론트 프로세스에 DB·Riot 비밀값을 넣지 않는다. `--env-file`은 모든 비밀값이 들어오고, `frontend/.env.local`은 값이 두 곳이 된다 | 2026-10-15 |
| D9 | 아이템은 핵심 3 + 신발 1, "구매 순서 아님" 문구 | 완성 아이템 3개가 보통 "코어 빌드"로 읽힌다. 순서 정보가 없다 | 2026-10-15 |
| D10 | `/champions/lane/top` 308은 `redirects()`가 아니라 페이지의 `permanentRedirect` | `redirects()`는 대소문자를 무시해 `/lane/TOP`까지 308이 된다 (완료 기준은 404) | 2026-10-15 |
| D11 | 룬 1·2순위가 보조 룬 순서만 다른 같은 조합이어도 프론트에서 합치지 않는다 | 합치면 승률을 다시 계산해야 해 계약 "프론트는 다시 계산하지 않는다"와 어긋난다. 집계 쪽(`!db`)에서 고친다 | 2026-10-15 |

---

## 12. 계약 변경 요청

> **쉬운 요약**: 지금 막는 요청은 없다. 다음 백엔드 변경 때 다듬으면 좋은 문구 2개를 참고로 둔다.

| # | 대상 | 내용 | 영향 |
|---|------|------|------|
| 참고 1 | `api_contract.md` 2-4 "아이템은 프론트가 거른다" | 문구가 "`into` 있으면 빼고 상위 2개"인데 실제로는 2단계 신발도 `into`가 있고 도란 같은 시작템은 `into`가 없다. 프론트는 5-5 규칙을 쓴다 | 없음 (문구 정리 제안) |
| 참고 2 | 2-4 예시 | 예시 `builds.items`에 신발 `3006`·`3046`이 섞여 있어 규칙 설명과 함께 보면 헷갈림 | 없음 |

- 룬 1·2순위 중복(D11)은 `!db` 쪽 변경으로 다룬다 (`front_overview.md` "해결되지 않은 점").

---

## 13. 작업 범위

> **쉬운 요약**: 각 단계 서브에이전트가 고칠 수 있는 파일이다. 이 밖의 수정이 필요하면 메인 에이전트에게 보고한다. 문서는 현재본만 유지한다 (CLAUDE.md 6장).

| 단계 | 수정 가능 | 수정 금지 |
|------|-----------|-----------|
| Plan | `frontend/docs/front_spec.md` (맨 아래 `## 이번 변경 (승인 대기)` 절) | 그 외 전부 |
| Build | `frontend/` 아래 프로젝트 파일(`src/`, `next.config.ts` 등), `frontend/docs/front_build.md`(상태 갱신), `frontend/docs/front_spec.md`(승인된 이번 변경을 본문에 합치고 임시 절 삭제), 새 환경 변수가 있을 때만 루트 `.env.example` | `frontend/docs/front_review.md`, `front_overview.md`, `.env`, `docs/contracts/*`, `backend/`, `db/`, 그 밖의 `frontend/` 밖 전부 |
| Review | `frontend/docs/front_review.md`(이번 검토로 교체), `frontend/docs/front_overview.md`(덮어써 갱신 + 변경 이력 1줄), 검토 중 고친 `frontend/` 코드와 `front_build.md`의 해당 기록, `docs/career_log.md`(맨 아래 **추가만**) | `frontend/docs/front_spec.md`, `.env`, `.env.example`, `docs/contracts/*`, `backend/`, `db/` |

- 저장소 루트의 `CLAUDE.md`, `api.md`는 수정하지 않는다.
- Build·Review는 확인을 위해 `backend/`에서 `npm start`로 API를 띄우고 GET만 호출할 수 있다. 끝나면 종료한다. 수집(`collect`)·집계·DB 쓰기는 하지 않는다.
- 상태 확인용 가짜 응답 서버와 복사본은 scratchpad에서만 만든다.
- `.env` 값은 읽기만 하고 문서·로그·응답에 쓰지 않는다. `.env`에 값을 넣는 일은 사용자에게 요청한다.
- 계약을 바꿔야 하면 직접 고치지 않고 이 문서 12장에 적어 메인 에이전트에게 보고한다.
