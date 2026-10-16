# 프론트엔드 현재 상태 — Tier.GG

> 이 문서는 프론트엔드의 **지금 모습**만 적는다. 작업 과정과 이력은 `front_spec.md`(계획), `front_build.md`(구현), `front_review.md`(검토)에 있다.
> 기준: 변경 01 Review 반영 후 코드 (2026-10-16 확인). 이후 Review 에이전트가 이 문서를 최신 상태로 덮어쓴다.

---

## 1. 한눈에 보기

요약: 포지션별 챔피언 티어 표와 챔피언 상세(추천 빌드 + 스킬·스킨·스토리)를 보여주는 Next.js 사이트다.

- **티어 표**: 탑·정글·미드·원딜·서폿 5개 탭. 티어, 승률, 픽률, 밴률, 게임 수를 보여준다.
- **챔피언 상세**: 주 포지션 1~2개 탭. 탭마다 추천 룬, 소환사 주문, 스킬 순서, 핵심 아이템을 보여준다. 아래에 스킬 설명, 스킨, 스토리가 있다.
- **통계 기준**: 최근 14일 게임. 백엔드가 매일 05:00(KST)에 다시 집계한다.
- 로그인, 전적 검색, AI 피드백은 아직 없다.

| 항목 | 값 |
|------|-----|
| 스택 | Next.js 16.4 (App Router, Turbopack), React 19.3, TypeScript, Tailwind CSS 4 |
| 추가 런타임 의존성 | 없음 (`next`, `react`, `react-dom`만) |
| 테마 | 다크 고정, 한국어(`lang="ko"`, Data Dragon `ko_KR`) |
| 빌드 페이지 수 | 183개 (상세 173개 + 리스트 5개 + `/`·404 등) |
| 챔피언 수 | 173명 (Data Dragon `16.20.1` 기준) |
| 클라이언트 컴포넌트 | `TierTable`, `PositionTabs`, `RunePage`, `SkinGallery`, `NavLink`, `error.tsx` 2개 |

---

## 2. 화면과 주소

요약: 탑 티어는 `/champions`, 나머지 포지션은 `/champions/lane/{포지션}`, 상세는 `/champions/{영문 id}`다.

| 주소 | 응답 | 보여주는 것 |
|------|------|-------------|
| `/` | 307 → `/champions` | 없음 (바로 이동) |
| `/champions` | 200 | **탑** 티어 표. 제목 "탑 챔피언 티어 \| Tier.GG" |
| `/champions/lane/jungle` · `middle` · `bottom` · `utility` | 200 | 정글 · 미드 · 원딜 · 서폿 티어 표 |
| `/champions/lane/top` | **308** → `/champions` | 같은 내용이 두 주소에 있지 않게 한다 |
| `/champions/lane/TOP`, `/lane/Jungle`, `/lane/mid`, `/champions/lane` | 404 | 정확한 소문자 5개만 허용 (`dynamicParams = false`) |
| `/champions/[championId]` | 200 | 상세. 영문 id를 쓴다 (예: `Aatrox`, `MonkeyKing`). 제목 "아트록스 - 다르킨의 검 \| Tier.GG" |
| `/champions/Foo` (없는 챔피언) | 404 | "챔피언을 찾을 수 없습니다" + [챔피언 목록으로] |
| 그 밖의 주소 (`/nope`) | 404 | "페이지를 찾을 수 없습니다" + [홈으로] |

### 티어 표 화면

요약: 제목, 기간 줄, 포지션 탭, 검색창, 표 순서다.

| 요소 | 내용 |
|------|------|
| 기간 줄 | "최근 14일 · 3,952게임 · 26.20 67% / 26.19 33% · 10월 15일 03:52 집계" |
| 포지션 탭 | 링크 5개 (`<nav aria-label="포지션">`), 현재 탭 `aria-current="page"` |
| 검색 | 한글 이름·영문 id 부분 일치, 대소문자·공백 무시. 순위는 그대로 둔다. 결과 수를 `aria-live`로 알린다 |
| 표 열 | 모든 폭: #·챔피언·티어·승률·픽률 / `sm`(640px) 이상: + 밴률·게임 / `md`(768px) 이상: + "미드 겸용" 같은 주 포지션 |
| 순서 | API의 `rank` 그대로. 티어가 `null`인 챔피언은 끝에 "표본 부족"으로 나온다 |
| 행 클릭 | 행 어디를 눌러도 상세로 간다 (이름 링크 1개 + `after:inset-0`) |
| 결과 없음 | "'…'에 해당하는 챔피언이 없습니다" + [검색 지우기] (누르면 검색창으로 포커스) |

### 챔피언 상세 화면

요약: "← 목록" 링크, Hero, 포지션별 통계·빌드, 스킬, 스킨, 스토리 순서다.

| 영역 | 내용 |
|------|------|
| "← 목록" | 1순위 포지션의 티어 표로 간다 (예: "← 정글 티어 목록"). 통계가 없으면 탑 |
| Hero | 스플래시(LCP 이미지, `fetchPriority="high"`), 이름(`h1`), 칭호, 역할군, 난이도 |
| 포지션 탭 | 주 포지션이 2개면 탭 2개 ("정글 · 2티어 · 86%"). ←/→, Home/End로 이동. 1개면 탭 줄 없이 "탑" 글자만 |
| 요약 줄 | 티어 배지, 승률, 픽률, 밴률, 게임 수 |
| 룬 | 1순위 룬 페이지 전체 (핵심 트리 4줄 / 보조 트리 3줄 / 파편 3줄). 고른 룬만 밝게. 2개면 [1순위]/[2순위] 버튼 |
| 소환사 주문 | 상위 2조합 ("점멸 + 점화"), 사용률·승률·게임 |
| 스킬 순서 | 1순위는 Q/W/E/R × 11레벨 격자, 2순위는 "Q E W Q Q R …" 한 줄 |
| 아이템 | 핵심 3개 + 신발 1개. "게임이 끝날 때 가지고 있던 아이템 기준 · 구매 순서 아님" |
| 레이아웃 | `lg`(1024px) 이상 2열 (왼쪽 룬 / 오른쪽 주문·스킬·아이템) |
| 아래 영역 | 스킬 설명(P/Q/W/E/R), 스킨(크로마 제외, 누르면 위 미리보기 교체), 스토리 |

---

## 3. 데이터 출처

요약: 통계 숫자는 백엔드 API, 이름과 이미지는 Data Dragon에서 가져온다. 둘은 숫자 ID로 연결한다.

| 출처 | 가져오는 것 | 호출 코드 | 비고 |
|------|-------------|-----------|------|
| 백엔드 API (`docs/contracts/api_contract.md` v2) | 티어, 승률·픽률·밴률, 게임 수, 기간(`window`), 추천 빌드의 숫자 ID | `src/lib/api/` | **서버에서만** 호출. 모든 파일 첫 줄이 `import "server-only"` |
| Data Dragon (`api.md`) | 챔피언 이름·이미지·스킬·스킨·스토리, 아이템, 룬, 소환사 주문 | `src/lib/ddragon/` | API 키 없음. 버전은 `versions.json`의 최신 값 |

### 백엔드 API

요약: `API_BASE_URL` 하나만 쓰고, 브라우저에는 주소가 나가지 않는다.

| 항목 | 내용 |
|------|------|
| 주소 | 환경 변수 `API_BASE_URL` (예: `http://localhost:4000/api/v1`). 값이 없으면 "연결 실패"로 처리한다 (localhost로 조용히 붙지 않음) |
| 값 읽기 | `next.config.ts`가 루트 `.env`에서 **`API_BASE_URL`만** 읽어 넣는다. DB·Riot 키는 프론트 프로세스에 들어가지 않는다. `NEXT_PUBLIC_`과 `env` 옵션은 쓰지 않는다 |
| 쓰는 엔드포인트 | `GET /meta` (기간·표본 기준·푸터 패치), `GET /champions?position=` (티어 표), `GET /champions/:key[?position=]` (상세) |
| 시간 제한 | 10초 (`API_TIMEOUT_MS`) |
| 오류 분기 | HTTP 상태 + `error.code`로만 나눈다 (`lib/api/client.ts`) |

### ID → 이름 매핑

요약: API는 숫자만 주고, 프론트가 Data Dragon 표로 이름과 아이콘을 붙인다.

| API 값 | Data Dragon | 찾는 방법 | 못 찾으면 |
|--------|-------------|-----------|-----------|
| `championId` (예: 266) | `champion.json` | `key` == "266" → 영문 `id`, 이름, 아이콘 | "챔피언 #950" (링크·아이콘 없음) + 서버 경고 |
| `itemId` | `item.json` | 최신 버전 먼저, 없으면 창 안 다른 패치 `{patch}.1` 버전에서 한 번 더 | 목록에서 빼고 서버 경고 |
| `spellIds` | `summoner.json` | `key` == "4" → 점멸 | "알 수 없는 주문 #id" |
| 룬 트리·룬 ID | `runesReforged.json` | `id`, 아이콘 `/cdn/img/{icon}` | "알 수 없는 룬 #id" (회색 칸) |
| 능력치 파편 (5008 등) | **없음** | 프론트의 작은 표 `lib/ddragon/statShards.ts` | "알 수 없는 파편" |
| `skillOrder` "QEWQ…" | `champion/{id}.json` | `spells[0..3]` → Q/W/E/R 이름·아이콘 | 글자만 표시 |

- Data Dragon 가공 결과(아이템·주문·룬 표)는 버전마다 한 번만 만든다. 실패하면 지우고 다음에 다시 시도한다.

---

## 4. 렌더링과 캐시

요약: 모든 페이지를 빌드 때 미리 만들고(SSG), 1시간마다 다시 만든다(ISR 3600).

| 경로 | 렌더링 | 빌드 때 API 호출 |
|------|--------|------------------|
| `/champions` | SSG + `revalidate = 3600` | 탑 1번 + `/meta` |
| `/champions/lane/[position]` | 5개 미리 생성(top은 308로 저장) + `dynamicParams = false` + `revalidate = 3600` | 포지션마다 1번 |
| `/champions/[championId]` | 173개 SSG + `revalidate = 3600`, `dynamicParams` 기본값(true) | 챔피언마다 1~2번 (2순위 포지션이 있으면 2번) |
| 푸터 | 각 페이지와 함께 렌더 | `/meta` (데이터 캐시로 공유) |

| 캐시 | 설정 |
|------|------|
| 백엔드 API fetch | `next: { revalidate: 3600 }` |
| Data Dragon `versions.json` | `revalidate: 3600` (새 패치 확인) |
| Data Dragon 버전 포함 주소 (`champion.json`, `item.json` 등) | `cache: "force-cache"` (내용이 안 바뀜) |
| 이미지 | `next/image` 최적화, `ddragon.leagueoflegends.com/cdn/**`만 허용 |

- 05:00 집계 뒤 최대 약 1시간 안에 새 숫자가 보인다. `aggregatedAt`을 보고 더 빨리 다시 만드는 기능은 없다.
- `searchParams`는 쓰지 않는다 (쓰면 요청마다 동적 렌더링이 된다). 그래서 포지션은 경로로 나눈다.
- Cache Components(`cacheComponents`)는 쓰지 않는다.

### API가 응답하지 않을 때

요약: 빌드는 안내 문구로 통과하고, 서비스 중에는 직전 정상 페이지를 계속 보여준다.

| 시점 | 동작 |
|------|------|
| `npm run build` 중 | 오류 없이 통계 자리에 "통계 서버에 연결하지 못했습니다"를 넣어 페이지를 만든다. 빌드 로그 경고는 작업 프로세스마다 1줄(약 7줄). `NEXT_PHASE`로 빌드 중인지 판단한다 (`lib/api/buildPhase.ts`) |
| 서비스 중 다시 만들 때 | `requireStats()`가 오류를 던진다 → Next가 **직전 정상 페이지를 계속 보여주고** 다음 요청 때 다시 시도한다 |
| 서비스 중 처음 만드는 페이지 | 보여줄 직전 페이지가 없어 `champions/error.tsx` "데이터를 불러오지 못했습니다" + [다시 시도] (HTTP 500) |
| 푸터 | 실패해도 오류를 던지지 않고 "패치 정보 없음" (루트 레이아웃이라 error 경계가 감싸지 못함) |

- 이전 빌드의 API 응답은 `.next/cache/fetch-cache`에 최대 1시간 남는다. "API 없이 빌드"를 일부러 확인하려면 이 폴더를 지우고 빌드한다.

---

## 5. 화면 상태

요약: 상황마다 정해진 문구가 있고, 통계가 없어도 Hero·스킬·스킨·스토리는 항상 보인다.

| 상황 | 티어 표 | 상세 |
|------|---------|------|
| 로딩 (스트리밍) | 제목·기간 줄·탭 5개·검색·10행 스켈레톤 (`min-h-screen`) | 통계 제목·탭·요약 줄·빌드 카드 스켈레톤 |
| `STATS_NOT_READY` (첫 집계 전) | "아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다." | 같은 문구 |
| `STATS_NOT_FOUND` | — | "최근 14일 통계가 없습니다." |
| 포지션 목록이 비었음 | "이 포지션의 최근 14일 통계가 아직 없습니다." | — |
| 빌드 중 API 꺼짐 | "통계 서버에 연결하지 못했습니다." (`role="status"`) | 같은 문구 |
| 서비스 중 API 꺼짐 | 직전 페이지 유지, 없으면 error 화면 | 같음 |
| `isStale` (집계 지연) | 기간 줄 아래 노란 상자 "통계 갱신이 지연되고 있습니다 (마지막 집계 …)" (`role="status"`) | 같음 |
| 티어 `null` | 회색 "표본 부족" 배지 + 설명 "최근 14일 50게임 미만이라 티어를 매기지 않았습니다" | "표본 부족 (50게임 미만)" + "표본이 적어 참고용입니다.", 탭 글자 "탑 · 표본 부족 · 11%" |
| 빌드 항목이 빔 | — | 룬·주문·스킬·아이템 각각 "표본이 부족해 추천이 없습니다" |
| 2순위 포지션만 실패 | — | 그 탭만 빼고 1순위만 보여준다 (서비스 중 연결 실패는 오류) |
| 두 응답 집계 시각이 다름 | — | 1순위 기간을 표시하고 서버 경고 1줄 |
| Data Dragon 실패 | error 화면 "데이터를 불러오지 못했습니다" + [다시 시도] + [챔피언 목록으로] | 같음. 탭 제목은 "챔피언 \| Tier.GG" |

- 표본 부족 기준(50게임)은 `/meta`의 `rules.minTierPick`에서 받는다. 못 받으면 50을 쓴다.

---

## 6. 주요 규칙

요약: 아이템은 완성 아이템만 고르고, 패치는 공개 이름(26.x)으로, 퍼센트는 소수 1자리로 보여준다.

### 아이템 거르기 (`lib/ddragon/itemFilter.ts`)

요약: 위에서부터 차례로 판단해 "핵심", "신발", "제외"로 나눈다.

| 순서 | 조건 | 결과 | 예 |
|------|------|------|-----|
| 1 | Data Dragon에 없음 | 제외 | 사라진 아이템 |
| 2 | 태그 `Consumable` 또는 `Trinket` | 제외 | 물약, 제어 와드, 장신구 |
| 3 | 재료 없음 + 가격 1000골드 미만 | 제외 | 도란 아이템, 정글·서폿 시작템, 장화(1001) |
| 4 | 태그 `Boots` **또는 신발로 만드는 아이템** | 신발 | 판금 장화, 건메탈 군화(3172, 태그에 `Boots`가 없어 이 규칙으로 잡음) |
| 5 | 상위 아이템이 있음(`into`) | 제외 | 롱소드 같은 하위 재료 |
| 6 | 나머지 | 핵심 | 완성 아이템, 서폿 퀘스트 최종 아이템 |

- **핵심 3개**: API 순서(많이 산 순)대로 처음 3개.
- **신발 1개**: 신발 중 API 순서 첫 번째. **사용률 5% 미만이면 칸을 숨긴다** (원딜은 지금 대부분 숨겨진다).

### 숫자와 글자

| 항목 | 규칙 |
|------|------|
| 퍼센트 | 소수 1자리 사사오입 ("52.8%"). 이진 소수 오차를 피하려고 1/100 정수로 맞춘 뒤 반올림 (`formatPercent`) |
| 탭·패치 비율 | 정수 반올림 ("86%", "26.20 67%"). 합이 99·101%여도 그대로 |
| 게임 수 | 천 단위 쉼표 ("3,952") |
| 시각 | KST 고정 "10월 15일 03:52" (서버에서 만들어 수화 불일치 없음) |
| 패치 이름 | 화면에는 `displayName`(**26.20**)만 쓴다. 내부 값(16.20)은 Data Dragon 버전 찾기에만 쓴다. 패치가 1개면 "패치 26.20", 2개 이상이면 "26.20 67% / 26.19 33%" |
| 푸터 | "패치 26.20 · 데이터: Riot Data Dragon" + Riot 고지문 |
| 다시 계산하지 않음 | 승률·티어·순서는 API 값을 그대로 쓴다 (계약 규칙) |

---

## 7. 폴더와 컴포넌트 구조

요약: `app/`은 주소, `components/`는 화면 조각, `lib/`는 데이터 호출과 가공이다.

```
frontend/
├─ next.config.ts          루트 .env에서 API_BASE_URL만 읽기, 이미지 허용 주소, Tailwind 로더
├─ package.json            dev / build / start / lint
└─ src/
   ├─ app/                 라우트
   ├─ components/
   │  ├─ layout/           헤더·푸터·메뉴
   │  ├─ champions/        티어 표·상세 화면 조각
   │  └─ stats/            통계 공통 조각 (기간 줄, 배지, 안내)
   └─ lib/
      ├─ api/              백엔드 호출 (server-only)
      ├─ ddragon/          Data Dragon 호출과 가공
      └─ view/             API + Data Dragon → 화면용 데이터
```

### `src/app/`

| 파일 | 역할 |
|------|------|
| `layout.tsx` | 공통 틀 (본문 건너뛰기 링크, 헤더, `main`, 푸터), 제목 템플릿 "%s \| Tier.GG" |
| `page.tsx` | `/` → `/champions` 이동 |
| `not-found.tsx` / `error.tsx` | 전역 404 / 전역 오류 화면 |
| `champions/page.tsx` | 탑 티어 표 |
| `champions/lane/[position]/page.tsx` | 나머지 4개 포지션, `top`은 308, 그 밖은 404 |
| `champions/loading.tsx` / `error.tsx` | 티어 표 스켈레톤 / 오류 화면 |
| `champions/[championId]/page.tsx` | 상세. 1·2순위 통계 호출, 패널 데이터 만들기, 메타데이터 |
| `champions/[championId]/loading.tsx` / `not-found.tsx` | 상세 스켈레톤 / 챔피언 404 |

### `src/components/`

| 파일 | 역할 |
|------|------|
| `layout/Header.tsx`, `NavLink.tsx` | 로고 + "챔피언" 메뉴, 현재 경로 강조 |
| `layout/Footer.tsx` | 공개 패치 이름 + 고지문 |
| `champions/TierListPage.tsx` | 티어 표 페이지 한 개 (데이터 호출 + 상태 분기) |
| `champions/PositionNav.tsx` | 포지션 탭 링크 5개 |
| `champions/TierTable.tsx` | 검색 + 티어 표 (client) |
| `champions/ChampionHero.tsx` | 상세 상단 스플래시와 기본 정보 |
| `champions/PositionTabs.tsx` | 상세 포지션 탭 (client, WAI-ARIA tabs) |
| `champions/PositionStatsPanel.tsx` | 탭 한 개 내용 (요약 줄 + 빌드 카드) |
| `champions/RunePage.tsx` | 룬 페이지와 1/2순위 전환 (client) |
| `champions/SummonerSpells.tsx` | 소환사 주문 조합 |
| `champions/SkillOrder.tsx` | 스킬 11레벨 격자 |
| `champions/CoreItems.tsx` | 핵심 아이템 3개 + 신발 |
| `champions/ChampionAbilities.tsx` | 패시브·스킬 설명 |
| `champions/SkinGallery.tsx` | 스킨 미리보기와 목록 (client) |
| `champions/ChampionLore.tsx` | 스토리 |
| `stats/WindowInfo.tsx` | 기간 줄 + 지연 안내 |
| `stats/TierBadge.tsx` | 1~5티어 / 표본 부족 배지 |
| `stats/StatsNotice.tsx` | 집계 전·통계 없음·연결 실패·빈 목록 안내 |

### `src/lib/`

| 파일 | 역할 |
|------|------|
| `api/config.ts` | 기본 URL, 재검증 3600초, 시간 제한 10초 |
| `api/client.ts` | `fetchApi()`: 호출하고 결과를 `not_ready`·`not_found`·`invalid`·`unavailable`로 분류. 로그에 기본 URL을 남기지 않음 |
| `api/api.ts` | `getMeta`, `getTierList`, `getChampionStats`, `requireStats`(서비스 중 연결 실패면 오류) |
| `api/types.ts` | 계약 v2 응답 타입 |
| `api/positions.ts` | 포지션 순서·한글 이름·URL 조각, `tierListHref()` |
| `api/buildPhase.ts` | `next build` 중인지 판단 |
| `ddragon/api.ts` | 버전, 챔피언 목록·상세, key 표, 아이템·주문·룬 표 |
| `ddragon/transform.ts` | 원본 → 화면용 챔피언 데이터 (HTML 제거, 크로마 제외) |
| `ddragon/images.ts` | 이미지 주소 만들기 |
| `ddragon/itemFilter.ts` | 아이템 거르기 규칙 (6장) |
| `ddragon/statShards.ts` | 능력치 파편 표 |
| `ddragon/constants.ts`, `types.ts` | 기본 주소·로케일, 타입 |
| `view/format.ts` | 퍼센트·쉼표·KST·패치 구성 글자 |
| `view/tierList.ts` | API 행 → 표 행 |
| `view/builds.ts` | 룬·주문·스킬·아이템 → 화면용 데이터 |

---

## 8. 접근성·반응형·성능

요약: 360·768·1280px에서 가로 스크롤이 없고, Lighthouse 접근성은 100이다.

### 접근성

| 항목 | 상태 |
|------|------|
| 키보드 | 본문 건너뛰기, 검색, 포지션 탭(←/→/Home/End), 룬 전환, 스킨 선택 모두 키보드로 가능. 금색 2px `focus-visible` 링 |
| 표 | `caption`(sr-only), `th scope` |
| 이미지 | `alt` 누락 0. 고르지 않은 룬과 장식 이미지는 `alt=""` |
| 티어 | 색만이 아니라 글자("1티어")가 항상 함께 보인다 |
| 대비 | 측정값 최소 6.74:1 (기준 4.5:1). 1~5티어 배지 6.89 / 8.37 / 12.64 / 11.18 / 9.13 |
| 제목 구조 | 리스트 `h1` 1개. 상세 `h1` → `h2` → `h3` (건너뛰지 않음) |

### 반응형

| 폭 | 모습 |
|----|------|
| 360px | 표 5열, 포지션 탭은 가로 스크롤, 상세 빌드 1열 |
| 768px | 표 8열, 상세 빌드 1열 |
| 1280px | 표 8열, 상세 빌드 2열 |

### 성능 (Lighthouse 13.5, 모바일, 로컬 운영 빌드, 3회 중앙값)

| 페이지 | 성능 | LCP | CLS | 전송량 | 접근성 | LCP 요소 |
|--------|------|-----|-----|--------|--------|----------|
| `/champions` | 96 | 2.77s | 0 | 473KB (이미지 106 / JS 155) | 100 | 검색창 안내 글자 |
| `/champions/Aatrox` | 95 | 2.98s | 0 | 407KB (이미지 199 / JS 155) | 100 | Hero 스플래시 |

- 권장사항·SEO도 100이다. LCP는 둘 다 "좋음" 기준(2.5s)을 조금 넘는다 (11장 2번).

---

## 9. 실행 방법

요약: 백엔드(4000)를 먼저 켜고 프론트(3000)를 켠다.

```bash
# 1) 백엔드 읽기 API (저장소 루트에서)
npm --prefix backend start        # http://localhost:4000

# 2) 프론트 (다른 터미널)
cd frontend
npm run dev                       # 개발 모드: http://localhost:3000
npm run build && npm start        # 운영 모드: 백엔드를 켠 상태로 빌드해야 통계가 들어간다
npm run lint                      # 린트
npx next typegen && npx tsc --noEmit   # 타입 검사
```

- 루트 `.env`에 `API_BASE_URL`이 있어야 한다 (예시는 `.env.example`).
- Claude Code 미리보기 설정 `.claude/launch.json`:

| 이름 | 명령 | 포트 |
|------|------|------|
| `backend-api` | `npm --prefix backend start` | 4000 |
| `frontend` | `npm --prefix frontend run dev` | 3000 |

---

## 10. 관련 문서

요약: 계약 두 개와 프론트 과정 기록 세 개를 함께 본다.

| 문서 | 내용 |
|------|------|
| [`docs/contracts/api_contract.md`](../../docs/contracts/api_contract.md) | 백엔드 API 계약 v2 (프론트가 읽는 계약) |
| [`api.md`](../../api.md) | Data Dragon 주소 목록 |
| [`front_spec.md`](./front_spec.md) | 계획 (v1, 변경 01) |
| [`front_build.md`](./front_build.md) | 구현 기록 |
| [`front_review.md`](./front_review.md) | 검토 기록 (Lighthouse 측정 포함) |
| [`CLAUDE.md`](../../CLAUDE.md) | 작업 규칙 (3장 공통, 7장 프론트 흐름, 9장 계약) |

---

## 11. 해결되지 않은 점

요약: 기능을 막는 문제는 없다. 아래는 남은 개선 거리와 확인 못 한 점이다.

1. **같은 룬 페이지가 두 번 나온다.** 173명 중 71명(41%)은 룬 1순위와 2순위가 같은 그림이다. 백엔드가 보조 룬 순서만 다른 조합을 따로 세기 때문이며, 프론트가 아니라 `!db` 변경 04(보조 룬을 정렬해 묶기)로 고칠 계획이다.
2. **상세 페이지 LCP가 줄지 않았다.** 스플래시에 `fetchPriority="high"`를 넣었지만 2.89s → 2.98s로 그대로다. 대부분이 "요소 렌더 지연"이라 다음 성능 작업에서 JS(155KB)와 렌더 지연을 따로 본다.
3. **API 없이 빌드하면 최대 1시간 동안 안내가 보인다.** 백엔드를 끈 채 빌드한 페이지는 첫 재검증 전까지 "통계 서버에 연결하지 못했습니다"가 나온다. 운영 배포는 백엔드를 켠 상태에서 빌드하는 것으로 피한다.
4. **소문자 상세 주소가 정적 페이지를 덮어쓸 수 있다 (macOS 로컬).** `next start`에서 `/champions/garen`을 열면 404 결과가 `Garen.html`을 덮어써 `/champions/Garen`도 404가 된다. 사용자 결정으로 기록만 하며, 필요해지면 정식 id로 리다이렉트하는 기능을 따로 계획한다.
5. **스킨 이름을 두 번 읽을 수 있다.** 스킨 미리보기 이미지 `alt`와 아래 `figcaption`이 같은 이름이라 스크린리더가 두 번 읽는다. 계획 규칙("스킨 = 이름 alt")을 바꿔야 해서 그대로 두었다.
6. **쓰지 않는 코드 `CHAMPION_TAGS`가 남아 있다.** `lib/ddragon/transform.ts`의 이 상수는 역할군 필터를 뺀 뒤 쓰는 곳이 없다. 다음 정리 작업에서 지운다.
7. **`TierBadge` 대비 주석이 부정확하다.** 주석은 "대비 7:1 이상"이지만 1티어(빨강)는 6.89:1이다. 기준 4.5:1은 넘으므로 주석만 고치면 된다.
8. **Safari에서 행 전체 클릭을 확인하지 않았다.** 티어 표 행 클릭은 `<tr class="relative">` + 링크 `after:inset-0`에 기대며 Chrome에서만 확인했다. Safari 확인이 필요하다.
9. **360px에서 "아우렐리온 솔" 이름이 잘린다.** 표 이름 칸이 좁아 69명 중 1명만 말줄임으로 보인다. 지금은 받아들인 상태이며, 표를 다시 다듬을 때 함께 본다.
10. **헤더 "챔피언" 메뉴가 상세에서도 `aria-current="page"`다.** 하위 경로에서는 `aria-current="true"`가 더 정확하다. 정보 수준이라 그대로 두었다.
11. **개발 모드에서 Data Dragon이 실패하면 Next 기본 500 화면이 나온다.** `next dev`가 요청마다 `generateStaticParams`를 실행해 그 단계에서 실패하기 때문이다. 운영 빌드에서는 `error.tsx`가 정상으로 나온다.
12. **오류 화면 두 개가 같은 코드다.** `app/error.tsx`와 `app/champions/error.tsx`의 내용이 같아 문구를 바꿀 때 두 곳을 고쳐야 한다. 정리 시 공통 컴포넌트로 묶을 수 있다.
13. **사이트 설명 문구가 옛 내용이다.** `layout.tsx`의 기본 `description`이 "챔피언 정보와 스킨"만 말하고 티어·빌드를 말하지 않는다. 다음 프론트 작업에서 고친다.
