# 프론트엔드 구현 상태 — Tier.GG 챔피언 화면

> 기준: `front_spec.md` (현재 계획), `docs/contracts/api_contract.md` v3. 코드 상태: 변경 09 Build 반영 후 (2026-10-30).
> 이 문서는 **지금 구현 상태**만 적는다. 이전 시도와 과정 기록은 git 커밋 `87cfc78`에 있다.
> 상태 표기: ✅ 완료 / ⚠️ 부분 완료 / ❌ 실패 / ⏸️ 보류

## 목차

- [1. 기술 구성](#1-기술-구성)
- [2. 라우트](#2-라우트)
- [3. 백엔드 API 모듈](#3-백엔드-api-모듈)
- [4. Data Dragon 모듈](#4-data-dragon-모듈)
- [5. 화면용 매핑](#5-화면용-매핑)
- [6. 공통 레이아웃과 환경 변수](#6-공통-레이아웃과-환경-변수)
- [7. 챔피언 티어 리스트](#7-챔피언-티어-리스트)
- [8. 챔피언 상세](#8-챔피언-상세)
- [9. 반응형과 접근성](#9-반응형과-접근성)
- [10. 계획과 다르게 구현한 점](#10-계획과-다르게-구현한-점)
- [11. 최신 검증 결과](#11-최신-검증-결과)
- [12. 실행 방법](#12-실행-방법)
- [13. 남은 문제](#13-남은-문제)
- [14. 전적 검색 (변경 06)](#14-전적-검색-변경-06)
- [15. 최근 게임 요약 카드 (변경 07)](#15-최근-게임-요약-카드-변경-07)
- [16. 킬관여·라인전 15분 골드 (변경 08)](#16-킬관여라인전-15분-골드-변경-08)
- [17. 전적 화면 상단 보강 (변경 09)](#17-전적-화면-상단-보강-변경-09)

---

## 1. 기술 구성

> **쉬운 요약**: create-next-app 16.4 기본 구성 그대로이고 추가 의존성은 없다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 버전 | `next` 16.4.0, `react`/`react-dom` 19.3.0, `tailwindcss` 4(`@tailwindcss/turbopack`), Node v24.15.0 | ✅ |
| 의존성 | dependencies는 `next`, `react`, `react-dom`만. `server-only`는 Next 내장 처리라 설치 안 함 | ✅ |
| `next.config.ts` | 이미지 `remotePatterns` `https://ddragon.leagueoflegends.com/cdn/**`, Tailwind `turbopack.rules`, 루트 `.env`에서 `API_BASE_URL`만 읽기. `cacheComponents`·`partialPrefetching` 없음 | ✅ |
| `globals.css` | 다크 색상 토큰(CSS 변수 + `@theme inline`): 배경 `#0b1020`, 표면 `#141b2f`/`#1d2540`, 테두리 `#2a3456`, 글자 `#e7eaf3`, 보조 `#a4adc6`, 골드 `#e3b456`. `color-scheme: dark`, 공통 `focus-visible` 링 | ✅ |
| `layout.tsx` | `<html lang="ko">`, 제목 템플릿 `%s \| Tier.GG`, 시스템 한글 글꼴, 본문 건너뛰기 링크, `metadata.description`에 티어·빌드 언급 추가(변경 02) | ✅ |
| 템플릿 정리 | 샘플 콘텐츠·`public/*.svg` 삭제. `favicon.ico`, `README.md`, `AGENTS.md` 유지 | ✅ |

## 2. 라우트

> **쉬운 요약**: 탑은 `/champions`, 나머지 4개는 `/champions/lane/{포지션}`, 상세는 `/champions/{영문 id}`. 모두 미리 만든 정적 페이지이고 1시간마다 갱신한다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `/` | `app/page.tsx` `redirect('/champions')` → 307 | ✅ |
| `/champions` | `TierListPage(TOP)`, SSG + `revalidate = 3600` (○) | ✅ |
| `/champions/lane/[position]` | `generateStaticParams`(top 포함 5개) + `dynamicParams = false` + `revalidate = 3600`. `top`이면 `permanentRedirect("/champions")` → 빌드 때 `top.meta`에 308 저장 | ✅ |
| 잘못된 lane 조각 | `/lane/TOP`, `/lane/Jungle`, `/lane/mid`, `/champions/lane` → 404 | ✅ |
| `/champions/[championId]` | `generateStaticParams` 173개 SSG + `revalidate = 3600`, `dynamicParams` 기본값(true) | ✅ |
| 없는 챔피언 | 목록에 id가 없으면 `notFound()` → `[championId]/not-found.tsx` | ✅ |
| `generateMetadata` | "아트록스 - 다르킨의 검 \| Tier.GG". Data Dragon 실패 시 try/catch로 "챔피언 \| Tier.GG" | ✅ |
| 전역 404 / 오류 | `app/not-found.tsx`(홈 링크), `app/error.tsx`·`champions/error.tsx`(`retry()` 다시 시도 + 목록 링크) | ✅ |
| `/api/lane-gold` (변경 08) | Route Handler(GET), `dynamic = "force-dynamic"`, 응답 `Cache-Control: no-store`. 라인전 프록시 (16장) | ✅ |
| 소문자 상세 주소 (macOS 로컬) | `next start`에서 `/champions/garen` 요청 시 404 결과가 `Garen.html`을 덮어쓴다. 사용자 결정으로 코드 수정 없이 보류 (13장) | ⏸️ |

## 3. 백엔드 API 모듈

> **쉬운 요약**: `src/lib/api/` 6개 파일 모두 첫 줄이 `import "server-only"`다. 오류를 화면이 쓰는 몇 가지 상태로 바꾼다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `config.ts` | `getApiBaseUrl()` (끝 `/` 제거, 값 없으면 `null` — 기본값 없음 + 서버 로그 1줄), `API_REVALIDATE_SECONDS = 3600`, `API_TIMEOUT_MS = 10000` | ✅ |
| `types.ts` | 계약 v2 그대로: `Position`, `Tier`(1~5 \| null), `WindowPatch`, `StatsWindow`, `MetaResponse`, `TierRow`, `TierListResponse`, `PositionSummary`, `StatsSummary`, `ItemBuild`, `RuneBuild`, `SpellBuild`, `SkillBuild`, `ChampionStatsResponse`, `ApiErrorBody` | ✅ |
| `client.ts` | `fetchApi<T>()`: `fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(10000) })`. 결과 `ok` / `not_ready` / `not_found` / `invalid`(로그에 `code`) / `unavailable`. 분기는 상태 + `error.code`로만. 로그에 기본 URL 없음 | ✅ |
| `api.ts` | `getMeta()`, `getTierList(position)`, `getChampionStats(key, position?)` → `StatsState`. `requireStats()`: 빌드 중이 아닐 때 `unavailable`이면 오류를 던짐 | ✅ |
| `positions.ts` | `POSITIONS`, 한글 이름(탑·정글·미드·원딜·서폿), 소문자 URL 조각 ↔ API 값, `tierListHref()` | ✅ |
| `buildPhase.ts` | `process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD` (`next/constants`). 정적 생성 작업 프로세스에서도 값이 보이는 것을 확인함 (백엔드 끈 빌드 성공) | ✅ |

## 4. Data Dragon 모듈

> **쉬운 요약**: `src/lib/ddragon/`에 호출·타입·이미지 주소·가공·아이템 규칙·파편 표를 모았다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `constants.ts` | `DDRAGON_BASE_URL`, `LOCALE = "ko_KR"`, `REVALIDATE_SECONDS = 3600` | ✅ |
| `types.ts` | 챔피언 원본·화면용 타입(`ChampionSummary.key` 포함), `DDragonItem`(+ `description`), `DDragonSummonerSpell`(+ `description`), `DDragonRuneTree`(룬 `shortDesc` 포함), `ItemInfo`(`builtFromBoots`·`description?` 포함), `IconInfo`(`description?` 포함), `RuneTreeInfo`(셀에 `description?`). 헷갈리는 필드(`title`, `key`, `tags`, `lore`, 스킨 `id`/`num`)에 주석. `any` 없음 | ✅ |
| `api.ts` | `getLatestVersion()`(revalidate 3600), `getChampionList()`, `getChampionDetail(id)`(목록에 없으면 `null`), `getChampionKeyMap()`, `getItems(itemIds, patches)`(최신 먼저, 못 찾은 것만 창 안 다른 패치 `{patch}.1`), `getSummonerSpells()`, `getRuneTrees()`. 버전 포함 주소는 `force-cache`. 가공 결과는 버전별 1번, 실패하면 지우고 재시도. `res.ok` 아니면 throw. 아이템·주문·룬 맵을 만들 때 설명 필드(`description`/`shortDesc`)를 함께 읽어 `transform.ts`의 `stripHtml`로 가공(변경 03) | ✅ |
| `images.ts` | 스퀘어·스플래시·로딩·`skillIconUrl`·패시브·`itemIconUrl`·`summonerSpellIconUrl`·`runeIconUrl`(`/cdn/img/{icon}`)·`statShardIconUrl`. 스킬은 `image.full` 사용 | ✅ |
| `transform.ts` | 태그 한글 매핑(`TAG_LABELS`), HTML 제거(`<br>`→줄바꿈, 태그 제거, 공백 정리, 엔티티 6종 복원), 크로마 제외 + `num` 오름차순, `default`→"기본", `Object.hasOwn` + id 일치 확인. 미사용 `CHAMPION_TAGS` 삭제(변경 02) | ✅ |
| `itemFilter.ts` | ① Data Dragon에 없음 ② `Consumable`/`Trinket` ③ `from` 없고 `gold.total < 1000` → 제외, ④ `Boots` 태그 **또는 `builtFromBoots`** → 신발, ⑤ `into` 있음 → 제외, ⑥ 나머지 → 핵심. `CORE_ITEM_COUNT = 3`, `BOOTS_MIN_PICK_RATE = 5` | ✅ |
| `statShards.ts` | 공격(5008·5005·5007) / 유연(5008·5010·5001) / 방어(5011·5013·5001), 이름·아이콘 파일 | ✅ |

## 5. 화면용 매핑

> **쉬운 요약**: `src/lib/view/`가 API 숫자 ID에 이름·아이콘을 붙이고, 숫자를 서버에서 글자로 만들어 클라이언트에 넘긴다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `format.ts` | `formatPercent`(1/100 정수로 맞춘 뒤 소수 1자리 사사오입), `formatCount`(천 단위 쉼표), `formatKst`(`Asia/Seoul` "10월 15일 03:52"), `formatPatchMix`(1개 "패치 26.20", 2개 이상 "26.20 67% / 26.19 33%"), `toWindowInfoView` | ✅ |
| `tierList.ts` | API `rank` 순서 그대로 표 행으로. 다른 주 포지션 이름. Data Dragon에 없는 `championId`는 "챔피언 #950"(링크·아이콘 없음) + 서버 경고 | ✅ |
| `builds.ts` | 룬: 핵심 4줄 / 보조 3줄(핵심 룬 줄 제외) / 파편 3줄, `selected`, "알 수 없는 룬 #id"·"알 수 없는 파편", sr 요약. 주문 이름·아이콘. 스킬 Q/W/E/R 머리 + 11칸. 아이템 핵심 ≤3 + 신발(5% 이상, API 순서 첫 번째). `chosenNames`는 sr 요약의 룬 이름을 API `perks` 순서 대신 트리 `rows` 순서로 모은다(변경 02, `!db` 변경 04로 `subPerks` 순서가 바뀌어도 화면 격자 순서와 항상 같게). 룬 셀·주문·아이템 뷰에 `description?: string`을 함께 담아 화면으로 넘긴다(변경 03, 툴팁용) | ✅ |

## 6. 공통 레이아웃과 환경 변수

> **쉬운 요약**: 헤더·푸터·기간 줄·안내 상자를 공통으로 쓰고, API 주소는 루트 `.env`에서 하나만 읽는다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `Header` / `NavLink` | (변경 09) `sm`+ sticky 64px·한 줄, 모바일 2줄·sticky 없음(17장). 로고, 메뉴 "챔피언". `NavLink`(client)가 `usePathname`으로 하위 경로까지 강조 + `aria-current="page"` | ✅ |
| `Footer` | `/meta`의 `patches[0].displayName` → "패치 26.20 · 데이터: Riot Data Dragon" + 고지문. 실패 시 "패치 정보 없음" (오류 안 던짐) | ✅ |
| `WindowInfo` | 기간 줄 (좁은 화면 줄바꿈), `isStale`이면 `role="status"` 노란 상자 | ✅ |
| `TierBadge` | 1~5티어(글자 + 색, 글자색 `zinc-950`) / `null` → 회색 "표본 부족" + `title`·sr 설명(`rules.minTierPick`, 없으면 50). 대비 주석을 실측값(최소 6.89:1)에 맞게 수정(변경 02) | ✅ |
| `StatsNotice` | 집계 전 / 통계 없음 / 연결 실패(`role="status"`) / 빈 목록 문구 | ✅ |
| 환경 변수 | `next.config.ts`가 `../.env`가 있으면 `node:fs` + `util.parseEnv`로 읽어 **`API_BASE_URL`만** `process.env`에 넣음. 이미 값이 있으면 덮어쓰지 않음. `env` 옵션·`NEXT_PUBLIC_` 없음 | ✅ |
| `.env.example` | "백엔드 API 서버" 묶음 아래 `API_BASE_URL=` + 주석 2줄 (값 없음) | ✅ |

## 7. 챔피언 티어 리스트

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `TierListPage` (server) | 한 포지션의 데이터 호출 + 상태 분기 + 제목("탑 챔피언 티어") | ✅ |
| `PositionNav` (server) | `<nav aria-label="포지션">` + `Link` 5개, 현재 탭 `aria-current="page"` + 강조, 모바일은 탭 줄만 가로 스크롤 | ✅ |
| `TierTable` (client) | 검색(한글·영문 부분 일치, `rank` 유지, 결과 수 `aria-live`), `<table>` + `caption`(sr-only) + `th scope="col"`. 열 #·챔피언·티어·승률·픽률 / `sm` 밴률·게임 / `md` "미드 겸용". 이름 링크 1개 + `after:inset-0`로 행 전체 클릭 | ✅ |
| 모바일 열 폭 | `sm` 미만에서만 순위·티어·승률·픽률 열 폭과 칸 여백 축소, 아이콘 간격 2px 축소. 360px에서 잘리는 이름 1/69(아우렐리온 솔) | ✅ |
| [검색 지우기] | 결과 없음 문구 + 버튼. 누른 뒤 포커스를 검색창으로 옮김 | ✅ |
| 상태 | 빈 목록 / 집계 전 / 빌드 중 연결 실패 안내, 서비스 중 연결 실패는 오류(직전 페이지 유지 또는 `champions/error.tsx`) | ✅ |
| LCP | 첫 10행 아이콘 `loading="eager"`, 첫 1개 `fetchPriority="high"` | ✅ |
| `champions/loading.tsx` | 제목·기간 줄·탭 5개·검색·10행 스켈레톤. 바깥 `min-h-screen`으로 CLS 0 (lane 경로에도 적용) | ✅ |

## 8. 챔피언 상세

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 통계 호출 | `position` 없이 1번 → `positions[]`. 2순위가 있으면 `?position=…` 1번 더. 2순위가 `STATS_NOT_FOUND`·집계 전·빌드 중 연결 실패면 그 탭만 뺀다. 두 응답 `aggregatedAt`이 다르면 서버 경고 + 1순위 기간 표시 | ✅ |
| `ChampionHero` (client, 변경 03) | `h1`을 프로필 아이콘 위(상단)로 이동하고 칭호(부제목, 예: "나주마의 긍지") 줄은 삭제(변경 06; `<title>`·메타 설명의 칭호는 유지), 그 아래 아이콘 + 스킨 이름/순서 줄(`aria-live="polite"`), 패시브·Q·W·E·R 아이콘 줄(난이도 위, 호버·포커스·탭 시 `AbilityTipContent` 툴팁, 히어로 `overflow-hidden`에 잘리지 않게 `Tooltip placement="top"`), 역할군 배지, 난이도 10칸 + `(n/10)`. `HeroSkinSwitcher`를 스플래시 자리에 렌더링하고 `onChange`로 선택 상태를 받아 캡션에 표시. 모바일 세로, md 이상 오버레이. `splashUrl` prop 제거, `skins` prop 추가 | ✅ |
| `HeroSkinSwitcher` (client, 신규, 변경 03) | Hero 스플래시(`fetchPriority="high"` + `loading="eager"`, `alt=""`) + 좌우 화살표(`aria-label="이전/다음 스킨"`, 네이티브 `<button>`), `useState`로 선택 스킨 관리, 양 끝에서 순환. 스킨 1개면 화살표 숨김 | ✅ |
| "← 목록" | 1순위 포지션 탭 주소 + "정글 티어 목록" (통계 없으면 `/champions`, "탑 티어 목록") | ✅ |
| `PositionTabs` (client) | `role="tablist"/"tab"/"tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`, 로빙 `tabIndex`, ←/→·Home/End(끝에서 처음으로 순환), 숨은 패널 `hidden`. 두 패널 모두 정적 HTML. 탭 1개면 포지션 이름("탑") 글자(`p`)를 화면에서 숨김(`sr-only`, 변경 06) | ✅ |
| 탭 글자 | "정글 · 2티어 · 86%", `null`이면 "탑 · 표본 부족 · 11%" | ✅ |
| `PositionStatsPanel` (변경 05) | 요약 줄(배지·승률·픽률·밴률·게임, 수치 글자는 난이도 점과 같은 포인트 골드 `text-accent`(변경 06), `null`이면 "표본 부족 (50게임 미만)" + "표본이 적어 참고용입니다."). `lg` 이상 2단 그리드: 좌 "룬 · 스킬" 카드(h3는 화면에서 숨김 `sr-only`, 변경 06) 안에 `BuildSubsection`(h4) 위 "추천 룬" → 구분선 → 아래 "스킬 순서"(note "1~11레벨"), 우 "주문 · 아이템" 카드(h3는 화면에서 숨김 `sr-only`, 변경 06) 안에 "소환사 주문", "많이 완성한 아이템"(note·empty 문구 그대로, D24). 우측 카드에 비해 좌측 룬 카드 아래가 비어 보여 스킬 순서를 전체 폭 카드에서 좌측 카드 안으로 합침(변경 06). 전체 폭 `BuildCard`는 더 없음. `lg` 미만은 룬·스킬→주문·아이템 1열. 빈 영역 "표본이 부족해 추천이 없습니다"(섹션 단위로 개별 적용) | ✅ |
| `RunePage` (client, 변경 04) | 1순위 전체 페이지를 핵심 트리 → 보조 트리 → 능력치 파편 순으로. `lg`(1024px) 이상은 세 블록을 가로 3단(`grid-cols-[2fr_1.5fr_1fr] gap-3`)으로 나란히, 그 미만은 변경 03의 세로 1단 유지(D21). "사용 …% · 승률 …% · …게임"(D17)은 가로 배치에서도 핵심 트리 칸 **안**에 그대로 둠(핵심 트리 아래 줄). 안 고른 룬 흐리게 + `alt=""` + `aria-hidden`, 고른 룬만 `alt`. 2개면 맨 위에 "1순위/2순위" 버튼(`aria-pressed`, 사용률·승률, 버튼 안 주요·보조 트리 아이콘 20px → 28px로 확대, 변경 06), 전환 시 핵심 트리 아래 줄도 선택된 조합을 따라감. sr 요약 "핵심 룬(정밀): …". 룬 칸(`RuneIcon`)·`RuneTree` 컴포넌트는 손대지 않음(배치만 변경). `lg` 이상에서 보조 트리를 `lg:mt-12`(48px = 핵심 룬 줄 40px + 간격 8px)로 내려 보조 1행이 핵심 트리 2행과 같은 높이에서 시작(고정값이라 룬 크기를 바꾸면 함께 조정). 능력치 파편은 제목(`text-sm` 20px + 간격 8px)이 있어 `lg:mt-5`(20px)로 내려, 파편 첫 줄이 보조 1행과 같은 높이(48px)에서 시작 | ✅ (1·2순위가 같은 조합인 챔피언이 많음, 13장) |
| `SummonerSpells` (위치만 변경 05) | 상위 2조합, 아이콘 2개 + "점멸 + 점화" + 사용률·승률·게임. 아이콘에 `Tooltip` 적용(`description`). 컴포넌트 자체는 수정하지 않음 — 변경 05에서 "주문 · 아이템" 카드 안 `BuildSubsection`("소환사 주문")으로 이동 | ✅ |
| `SkillOrder` (변경 05) | 표(`<table>`)를 없애고 op.gg 스타일 "스킬 트랙"으로 교체(D25): `<ol aria-label="스킬 찍는 순서 1~11레벨">` + `<li>` 11개, 각 칸에 그 레벨에 찍은 스킬 아이콘 1개(`Tooltip` 유지, `content`는 `head.description`) + 호버 툴팁은 스킬 카드와 같은 내용(키·이름 / 재사용 대기시간 / 설명, 변경 06; `Tooltip`의 `content`를 `ReactNode`로 넓히고 `toSkillOrders` heads에 `cooldown` 추가). 아이콘 아래 스킬 키 글자 Q/W/E/R(`text-xs font-bold`) + 작은 레벨 숫자(둘 다 `aria-hidden`). 칸 안 `span.sr-only`에 "N레벨: 스킬 이름"을 넣어 레벨·스킬을 스크린리더로 전달. 아이콘 크기 `size-6 sm:size-8`(D25, D16의 `h-7/h-8`보다 축소). `overflow-x-auto` 래퍼는 absolute 툴팁 패널을 잘라 설명이 안 보여서 제거하고, 좁은 화면에서 11칸이 다 안 들어가면 `flex-wrap`으로 줄바꿈(결정 5 변경). 7레벨 이후 칸은 툴팁을 `align="right"`로 열어 오른쪽 끝에서 잘리지 않게 함. 2순위 한 줄 표기(`second.order.join(" ")`)는 삭제(D26, `set.builds[1]`은 여전히 받아오지만 컴포넌트가 `set.builds[0]`만 읽음) | ✅ (360px 실측: 트랙 wrapper `scrollWidth 304 / clientWidth 294` = 약 10px만 트랙 내부에서 스크롤, 페이지 전체 가로 스크롤 아님. 768px·1280px는 스크롤 없이 들어감) |
| `CoreItems` (변경 03, 위치만 변경 05) | 핵심 3개 + "신발" 1개(5% 미만 숨김), 아이콘에 `Tooltip` 적용(`description`). 컴포넌트 자체는 수정하지 않음 — 변경 05에서 렌더링 위치만 `PositionStatsPanel`의 "주문 · 아이템" 카드 안 `BuildSubsection`("많이 완성한 아이템", note "게임이 끝날 때 가지고 있던 아이템 기준 · 구매 순서 아님")으로 이동 | ✅ |
| `Tooltip` (client, 신규, 변경 03) | 호버(`onMouseEnter`/`onMouseLeave`)·포커스(`onFocus`/`onBlur`)·탭(`onClick` 토글 + 바깥 탭 시 `document` 클릭 리스너로 닫힘) 공용. `role="tooltip"` + `aria-describedby`. `content`가 없으면 트리거만 그대로 렌더링(툴팁 없음). 패널은 `w-max max-w-64`(Build 중 발견: `max-w-*`만 쓰면 `<span>`이 비치환 inline이라 폭이 거의 0으로 찌그러지는 버그가 있어 `w-max` 추가로 수정) | ✅ |
| 통계 없음 상태 | `STATS_NOT_FOUND` "최근 14일 통계가 없습니다.", 집계 전 문구, 빌드 중 연결 실패 문구. Hero·스킬·스토리는 정상 | ✅ |
| `ChampionAbilities` (변경 06: 상세 페이지에서 렌더링 제거, 파일은 미사용으로 남김) | 패시브 + Q/W/E/R, 아이콘(`image.full`)·키·이름(`h3`)·재사용 대기시간(패시브 제외)·설명(`description`, HTML 제거, `whitespace-pre-line`). `dangerouslySetInnerHTML` 없음. 카드 5개를 가로 한 줄(`flex`, 줄바꿈 없음)로 늘어놓아 폭이 넘치던 배치를 세로 1열(`space-y-3`)로 바꾸고, 각 카드는 왼쪽 아이콘 + 오른쪽(이름·재사용 대기시간·설명)으로 정리(변경 06). 13장의 360px 가로 스크롤 문제도 이 배치 변경으로 해소될 것으로 예상(미확인) | ✅ |
| `ChampionLore` | `lore` 텍스트. "스토리" 제목(`h2`)을 카드 안으로 이동(변경 06) | ✅ |
| 미표시 | `stats`, `allytips/enemytips`, `recommended` 표시 안 함 | ✅ |
| 제목 구조 | `h1` 이름 → `h2` "포지션별 통계와 추천 빌드" → 카드 `h3` → `h2` 스킬·스킨·스토리 | ✅ |
| `[championId]/loading.tsx` | Hero·통계 제목·기간 줄·탭 2개·요약 줄·빌드 카드 4개·스킬 스켈레톤 | ✅ |

## 9. 반응형과 접근성

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 반응형 | 360 / 768 / 1280px 페이지 가로 스크롤 없음. 표 5 / 8 / 8열, 상세 빌드 1 / 1 / 2열(변경 05: `lg` 이상 룬 좌 + "주문·아이템" 우 2단 → 스킬 트랙 전체 폭). 룬(변경 04: `lg` 이상 핵심\|보조\|파편 가로 3단, 미만은 세로 1단)과 스킬 트랙(변경 05: 레벨 1~11 가로 1줄, 칸 `size-6 sm:size-8`, 360px에서는 트랙 자체 `overflow-x-auto`로 약 10px만 내부 스크롤되고 페이지 전체 스크롤은 없음)이 360px에서도 가로 스크롤 없이 들어감 | ✅ |
| 이미지 | 전부 `next/image` + `sizes` + 고정 비율 칸. `priority` 사용 0건 | ✅ |
| alt | 아이콘·스킬·스킨·아이템·주문·룬 = 이름, 장식·안 고른 룬 = `alt=""`. 누락 0 | ✅ |
| 키보드 | 네이티브 `a`/`button`/`input`, 상세 탭 화살표 이동, 금색 2px `focus-visible` 링 | ✅ |
| 대비 | 1~5티어 배지 6.89 / 8.37 / 12.64 / 11.18 / 9.13, "표본 부족" 6.74, 지연 안내 13.7·12.07, 보조 글자 8.45, 현재 탭 9.54 (모두 4.5:1 이상) | ✅ |
| 랜드마크 | `header`·`main`(1개)·`footer`·`nav`, 페이지당 `h1` 1개 | ✅ |

## 10. 계획과 다르게 구현한 점

> **쉬운 요약**: 아래는 계획 문구와 다르지만 승인된 현재 구현이다. 다음 작업에서 "고칠 것"으로 오해하지 않도록 남긴다.

1. **lane 경로가 5개로 보인다.** top 308을 `redirects()`가 아닌 페이지의 `permanentRedirect`로 해서, 빌드 표에 `● /champions/lane/top`이 함께 나온다 (HTML 대신 308 저장).
2. **API 없는 빌드 경고가 7줄이다.** 정적 생성 작업 프로세스(7개)마다 첫 실패 1줄. 합계를 모을 방법이 없다.
3. **2순위 탭 제외 조건이 넓다.** `STATS_NOT_FOUND`뿐 아니라 2순위만 집계 전이거나 빌드 중 연결 실패여도 뺀다.
4. **탭 1개일 때 "탑" 제목은 `p`다.** 제목 단계를 건너뛰지 않기 위해서다.
5. **Tailwind 연동은 `@tailwindcss/turbopack`**, error 컴포넌트 prop은 `retry` (Next 16.4 템플릿·API 기준).
6. **푸터만 실패해도 페이지는 정상이다.** 루트 레이아웃이라 error 경계 밖이므로 "패치 정보 없음"을 쓴다.
7. **`ChampionHero`가 client 컴포넌트가 됐다 (변경 03).** 계획은 `ChampionHero.tsx` 수정만 언급하고 "use client" 전환은 명시하지 않았다. 스킨 이름/순서 캡션(D14)을 스플래시 위가 아니라 고정 배경의 정보 영역에 둬야 대비를 보장할 수 있는데, 그 상태는 `HeroSkinSwitcher`(client)만 갖고 있다. 서버 컴포넌트인 `ChampionHero`는 클라이언트 상태를 직접 읽을 수 없어, `HeroSkinSwitcher`가 `onChange` 콜백으로 선택을 알리고 `ChampionHero`도 그 상태를 `useState`로 받아 캡션에 표시하도록 했다 (D14에 이유 기록).
8. **`Tooltip` 패널에 `w-max`를 추가했다.** 계획 03-6은 `max-w-64`만 언급했지만, 패널 요소가 `<span>`(비치환 inline)이라 `max-width`만으로는 폭이 거의 0으로 찌그러지는 버그가 있었다(브라우저 확인). `w-max`를 더해 내용 기준 너비로 고쳤다.

## 11. 최신 검증 결과

> **쉬운 요약**: 린트·타입·빌드 통과. 백엔드를 켠 빌드와 끈 빌드 모두 성공했다. 리스트 전 행과 상세 173명이 API와 맞았다. (2026-10-15, Build 확인 + Review 수정 후 재확인). 변경 03도 린트·타입·빌드 통과 + 브라우저로 레이아웃·스킨 전환·툴팁·룬 통계를 직접 확인했다. Review가 모바일 탭 첫 번째 터치에서 툴팁이 안 열리는 결함을 찾아 `Tooltip.tsx`를 직접 수정했다(PASS with issues, "변경 03 Review 수정" 참고). 변경 04(룬 가로 3단, 스킬 표 축 전환)도 린트·타입·빌드 통과 + 브라우저로 1280px(룬 좌 가로 3단 + 주문 우, 스킬 표 전체 폭)·360px(룬 세로, 스킬 표 가로 스크롤 없이 들어감)를 직접 확인했다. 변경 05(아이템을 주문 카드로 합치기, 스킬을 op.gg 스타일 가로 트랙으로 교체)도 린트·타입·빌드 통과 + 브라우저로 1280px·360px·768px 확인, `skillOrder` 레벨별 1:1 대조 통과.

### 변경 05 Build 검증 (2026-10-17)

- 수정 파일: `frontend/src/components/champions/SkillOrder.tsx`(전면 재작성: 표 → 가로 트랙), `frontend/src/components/champions/PositionStatsPanel.tsx`(`BuildSubsection` 추가, "주문 · 아이템" 카드로 합치고 아이템 전체 폭 카드 삭제). `CoreItems.tsx`·`SummonerSpells.tsx`·`lib/view/builds.ts`·`lib/api/types.ts`는 계획대로 수정하지 않음(렌더링 위치만 이동)
- `npm run lint`: 오류·경고 0
- `npx next typegen && npx tsc --noEmit`: 오류 0
- `npm run build` (백엔드 켬, 로컬 `http://localhost:4000` 응답 확인): 183페이지 성공, 경고 0줄
- 브라우저 확인: 이미 떠 있던 `next dev`(포트 3000, 다른 세션이 띄워 둔 서버, HMR로 수정 사항 반영)에 접속해 확인. 자체 `preview_start`는 "이미 다른 next dev가 실행 중"이라는 오류로 새로 못 띄워 기존 서버에 그대로 접속했다(백엔드는 `backend-api`(4000)에 접속 확인, 별도로 새로 띄우지 않음)
  - **1280px (`/champions/Aatrox`)**: 룬 카드(좌, 가로 3단 그대로) + "주문 · 아이템" 카드(우)가 2단 그리드로 보임. 우측 카드 안에 h4 "소환사 주문"(상위 2조합) → 구분선 → h4 "많이 완성한 아이템"(핵심 3개 + 신발, note 문구 "게임이 끝날 때 가지고 있던 아이템 기준 · 구매 순서 아님" 그대로) 2섹션 확인. 그 아래 "스킬 순서" 카드가 전체 폭 1행, 레벨 1~11 가로 트랙(아이콘 + 레벨 숫자)으로 보임. 별도 "많이 완성한 아이템" 전체 폭 카드는 더는 없음
  - **`skillOrder` 대조**: 아트록스 `QEWQQRQEQER`를 각 칸의 sr-only 텍스트("N레벨: 스킬 이름")로 추출해 1:1 대조 — 1=Q(다르킨의 검) 2=E(파멸의 돌진) 3=W(지옥사슬) 4=Q 5=Q 6=R(세계의 종결자) 7=Q 8=E 9=Q 10=E 11=R, 전부 일치. 징크스(`QWEQQRQWQWW`)도 sr-only 텍스트로 추출해 Q/W/E/R 라벨이 섞이지 않고 순서대로 나옴을 확인
  - **2순위 삭제 확인**: "2순위" 한 줄 표기(`second.order.join(" ")`)가 화면 어디에도 없음(페이지 텍스트 검색 0건). `SkillOrder.tsx`는 `set.builds[0]`만 읽고, `lib/view/builds.ts`·`toSkillOrders`는 수정하지 않아 2순위 데이터는 계속 받아옴(D26)
  - **툴팁**: 스킬 트랙 1레벨 칸을 프로그램적 `click()`으로 토글 — `document.querySelectorAll('[role="tooltip"]').length`가 0→1로 바뀌고 내용이 "아트록스가 대검을 내리쳐 물리 피해를 줍니다…"로 Q 설명과 일치함을 확인. (참고: 이 브라우저 패널의 `computer` 좌표 클릭/호버 액션은 이 세션에서 포커스·클릭 이벤트가 기대대로 전달되지 않아 — `Tooltip.tsx` 자체는 변경 05에서 손대지 않았고 변경 04에서 이미 호버·포커스·탭 전부 검증됨 — DOM에 직접 `click()`을 디스패치해 같은 핸들러가 정상 동작함을 확인했다. 수동 UI 조작으로 호버/포커스까지 재확인하지는 못했다. 13장 참고)
  - **징크스(`/champions/Jinx`, 원딜) 신발 숨김**: "주문·아이템" 카드의 "많이 완성한 아이템" 섹션에 "신발" 소제목이 없음(사용률 5% 미만이라 숨김, D9 그대로 유지) 확인
  - **360px (`/champions/Aatrox`)**: 신선한 네비게이션 직후 `document.documentElement.scrollWidth === clientWidth`(360) 확인(페이지 가로 스크롤 없음). "주문·아이템" 카드가 세로 1단으로 소환사 주문 → 구분선 → 많이 완성한 아이템 순서로 쌓임. 스킬 트랙은 `overflow-x-auto` wrapper 기준 `scrollWidth 304 / clientWidth 294`로 약 10px만 트랙 자체 내부에서 스크롤되고(결정 5(b)로 자연히 보강됨, 11칸이 `size-6`+`gap-1`로는 294px 안에 다 안 들어감), 페이지 전체 스크롤로는 번지지 않음을 확인
    - **범위 밖 발견(수정하지 않음)**: 360px에서 실제 스크롤(가짜 `scrollIntoView`가 아니라 `computer scroll` 액션)로 "스킬"(패시브+Q/W/E/R 설명, `ChampionAbilities.tsx`) 섹션까지 내려가면 그 섹션의 `<ul class="flex space-x-3">`(줄바꿈 없음)가 넓어져 페이지 전체 `scrollWidth`가 779px까지 늘어나는 가로 스크롤이 있음. `ChampionAbilities.tsx`는 이번 변경 05 작업 범위에 없고, 세션 시작 시점 `git status`에 이미 수정됨(M)으로 떠 있던 파일이라 내가 만든 변경이 아니다(변경 05는 `PositionStatsPanel.tsx`·`SkillOrder.tsx`만 수정). 메인 에이전트에게 보고 필요(13장에 기록)
  - **768px**: 스킬 트랙 wrapper `scrollWidth === clientWidth`(686), 스크롤 없이 들어감
  - 콘솔 오류 0건(`read_console_messages onlyErrors`)
- `chosenNames`(변경 02) 등 `lib/view/builds.ts` 로직은 이번 변경에서 건드리지 않아 그대로 유효

### 변경 04 Build 검증 (2026-10-17)

- `npm run lint`: 오류·경고 0
- `npx next typegen && npx tsc --noEmit`: 오류 0
- `npm run build` (백엔드 켬, 로컬 `http://localhost:4000` 응답 확인): 183페이지 성공, `[api]`·`[view]`·`[stats]` 경고 0줄
- 브라우저 확인 (`http://localhost:3000/champions/Aatrox`, 떠 있던 `next dev`에 접속)
  - **1280px**: 룬 카드(좌, 핵심 "정밀" | 보조 "결의" | 능력치 파편 가로 3단, "사용 42.8% · 승률 46.6% · 118게임"이 핵심 트리 칸 안) + 소환사 주문(우) 2단 그리드 확인. 그 아래 "스킬 순서" 카드가 전체 폭 1행, Q/W/E/R 4행 × 레벨 1~11 11열로 나오고 `skillOrder`(`QEWQQRQEQER`)와 일치(Q행: 1·4·5·7·9레벨, W행: 3레벨, E행: 2·8·10레벨, R행: 6·11레벨 칸 강조 확인). 그 아래 "많이 완성한 아이템" 전체 폭
  - **768px**: 룬 세로 1단, 스킬 표 그대로 1열. `document.documentElement.scrollWidth === clientWidth`(768) 확인, 가로 스크롤 없음
  - **360px**: 룬 세로 1단(정밀→결의→능력치 파편), 스킬 표가 셀 크기(`h-7 w-7`) 그대로에도 실측상 11열이 들어가 가로 스크롤이 실제로는 발생하지 않음(`overflow-x-auto` 래퍼의 `scrollWidth === clientWidth` 확인). `document.documentElement.scrollWidth === clientWidth`(360) 확인, 페이지 가로 스크롤 없음
  - **툴팁**: 스킬 표 행 머리(Q) 탭 시 "아트록스가 대검을 내리쳐…" 설명 패널이 열림을 확인(레이아웃만 바뀌고 `Tooltip` 연결은 그대로)
  - 콘솔: `next dev`의 HMR 웹소켓 오류·Next 내부 `performance.measure` 경고가 보였으나, 다른 세션이 이미 띄워둔 `next dev` 프로세스와 겹쳐 발생한 것으로 이번 3개 파일 변경과 무관(운영 빌드 `npm run build`는 경고 0줄로 통과)
- `chosenNames`(변경 02) 등 `lib/view/builds.ts` 로직은 이번 변경에서 건드리지 않아 그대로 유효

### 변경 03 Build 검증 (2026-10-17)

- `npm run lint`: 오류·경고 0
- `npx next typegen && npx tsc --noEmit`: 오류 0
- `npm run build` (백엔드 켬, 로컬 `http://localhost:4000` 응답 확인): 183페이지 성공, `[api]`·`[view]`·`[stats]` 경고 0줄
- 브라우저 확인 (`http://localhost:3000/champions/Aatrox`, 이미 떠 있던 `next dev`에 접속)
  - **레이아웃**: `lg` 폭에서 룬 카드(좌, 전체) + 소환사 주문(우상)·스킬 순서(우하) 2단, "많이 완성한 아이템"이 그 아래 전체 폭 카드로 분리됨을 확인. 360px·768px에서는 룬 → 주문 → 스킬 → 아이템 1열, 가로 스크롤 없음
  - **룬 화면**: 핵심 트리(크게) → "사용 42.8% · 승률 46.6% · 118게임" → 보조 트리 → 능력치 파편 순 세로 배치 확인 (가로 2단 그리드 없음)
  - **스킬 격자**: 머리글 "레벨/Q/W/E/R", 본문 11행 × 4열로 전환됨을 확인. 1레벨 Q, 6레벨 R 등 `skillOrder`(`QEWQQRQEQER`)와 일치
  - **스킨 전환**: Hero 스플래시 위 ‹ › 버튼 클릭 시 스플래시와 "스킨: {이름} ({n}/13)" 캡션이 함께 바뀜 (기본 → 정의의 아트록스 확인)
  - **툴팁**: 룬·스킬 머리글·아이템 아이콘에 마우스 호버 시 설명 패널이 뜸 (예: 정복자 룬 "적 챔피언 공격 시 적응형 능력치 중첩 획득…", Q 스킬 "아트록스가 대검을 내리쳐…", 쇼진의 창 "공격력 45 체력 450…"). 360px에서 탭으로 토글 + 바깥 탭으로 닫힘 확인
    - **발견한 문제(그 자리에서 수정)**: 툴팁 패널이 `max-w-64`만으로는 폭이 한 글자 수준으로 찌그러짐(`<span>`은 비치환 inline이라 `max-width`가 적용되지 않음). `Tooltip.tsx`에 `w-max`를 추가해 수정, 재확인 통과 (10장 8번)
  - 768px(tablet)에서도 1열 유지·가로 스크롤 없음 확인
- `chosenNames` 단위 확인(변경 02)은 그대로 유효 (이번 변경에서 `builds.ts`의 해당 로직은 건드리지 않음)

### 변경 03 Review 수정 (2026-10-17)

- Review가 모바일(터치) 첫 탭에서 툴팁이 열리지 않는 결함을 발견: `onFocus`가 연 직후 바로 뒤따르는 `onClick`이 토글해 다시 닫혀, 첫 탭은 닫힌 채로 끝나고 두 번째 탭부터 열렸다. `Tooltip.tsx`에 `openedByFocusRef`를 추가해 같은 탭 안에서 포커스가 막 연 경우 뒤따르는 클릭이 다시 토글하지 않도록 수정(설계 변경 없음). 수정 후 린트·타입·`npm run build`(183페이지) 재확인 통과, 모바일 뷰포트(375px, 터치 에뮬레이션)에서 첫 탭 열림 → 재탭 닫힘 → 바깥 탭 닫힘 모두 재확인(`front_review.md` 2-1)
- Lighthouse 재측정(운영 빌드, 백엔드 켬): `/champions` 96 · 2.78s · CLS 0, `/champions/Aatrox` 94 · 3.15s · CLS 0, 접근성 둘 다 100 (`front_review.md` 4장)

### 변경 02 Build 검증 (2026-10-17)

- `npm run lint`: 오류·경고 0
- `npx next typegen && npx tsc --noEmit`: 오류 0
- `npm run build` (백엔드 켬, 로컬 `http://localhost:4000` 응답 확인): 183페이지 성공 (`○ /`, `/champions`, `● /champions/[championId]` 173개, `● /champions/lane/[position]` 5개, 모두 Revalidate 1h). `[api]`·`[view]`·`[stats]` 경고 0줄
- `chosenNames` 단위 확인: 프로젝트에 테스트 프레임워크가 없다(v1 범위 결정 "테스트 프레임워크 도입 안 함"). scratchpad에서 `tsc`로 `lib/view/builds.ts`와 의존 모듈만 CommonJS로 컴파일해 Node로 직접 실행하는 임시 스크립트로 확인했다(저장소에 파일 추가 없음):
  - 보조 룬 2개가 서로 다른 트리 줄에 있고, API가 준 `subPerks` 순서가 그 줄 순서와 반대인 가짜 데이터를 넣었을 때, `summary`의 보조 룬 이름 순서가 **트리 줄 순서**(화면 격자 순서)로 나오는지 확인 → 통과
  - 트리에서 못 찾은 룬 ID가 여전히 "알 수 없는 룬 #id"로 뒤에 붙는지 확인 → 통과
  - 룬 격자(`primary.rows`/`secondary.rows`)의 `selected` 표시와 칸 위치가 변경 전후 그대로인지 확인 → 통과 (애초에 `toRuneTree`는 손대지 않았다)
- 빌드된 HTML에서 실제 챔피언(아트록스) sr 요약 확인: `보조 룬(결의): 뼈 방패, 소생` 등 트리 줄 순서로 출력됨

### 명령

| 명령 / 확인 | 결과 |
|-------------|------|
| `npm run lint` | ✅ 오류 0, 경고 0 |
| `npx next typegen && npx tsc --noEmit` | ✅ 오류 0, `any` 0건 |
| `npm run build` (백엔드 켬) | ✅ 183페이지. `○ /champions`, `● /champions/lane/[position]` 5개(top은 308), `● /champions/[championId]` 173개, 모두 Revalidate 1h. `[api]`·`[view]`·`[stats]` 경고 0줄 |
| `npm run build` (백엔드 끔, `.next/cache/fetch-cache` 비움) | ✅ 성공, 같은 페이지 수. 경고 `[api] 통계 서버에 연결하지 못했습니다 (/meta, 연결 실패(TypeError)) …` 7줄 |
| 백엔드 끈 빌드 HTML | `/champions`, `/lane/jungle`: 탭 5개 + "통계 서버에 연결하지 못했습니다." + 푸터 "패치 정보 없음". `/champions/Aatrox`, `/MonkeyKing`: Hero·스킬(P/Q/W/E/R)·스킨(13개/10개)·스토리 + 같은 안내 |
| 코드 위치 | `lib/api/` 밖 `fetch(` 0건, `lib/ddragon/` 밖 Data Dragon 주소 0건, `lib/api/*.ts` 6개 모두 `server-only` |
| 브라우저 번들 `.next/static` | `localhost:4000`·`/api/v1`·`NEXT_PUBLIC_`·`API_BASE_URL` 0건 (Review 수정 후 빌드에서도 0건) |
| 의존성 | `git diff -- package.json package-lock.json` 0줄 |
| 저장소 `.next` | Review가 백엔드를 켠 상태로 마지막 빌드 (3,949게임 스냅숏) |

### 데이터 비교 (백엔드 켬 + `next start`, HTML ↔ API)

| 확인 | 결과 |
|------|------|
| 리스트 5개 탭 (3,952게임 스냅숏) | 탑 69 · 정글 53 · 미드 63 · 원딜 26 · 서폿 51 = **262행, 순위·이름·티어·승률·픽률·밴률·게임 불일치 0** |
| 리스트 (Review 마지막 빌드, 3,949게임 스냅숏) | **261행 불일치 0** |
| 티어 / 표본 부족 (3,952 기준) | 탑 47/22 · 정글 41/12 · 미드 42/21 · 원딜 24/2 · 서폿 32/19. `null`은 모두 맨 뒤 |
| 기간 줄 / 푸터 | "최근 14일 · 3,952게임 · 26.20 67% / 26.19 33% · 10월 15일 03:52 집계" (KST), "패치 26.20", 화면에 `16.20` 0건 |
| 주소 | `/lane/top` 308 → `/champions`, `/lane/TOP`·`/lane/Jungle`·`/lane/mid`·`/champions/lane` 404, 그 뒤에도 정상 페이지 그대로 |
| 상세 173명 | 모두 200, 탭 수가 API `positions[]`와 같음, 핵심 아이템 3개 미만 0명, "알 수 없는 룬·주문·파편" 0건 |
| 아트록스 (탑) | 2티어 290게임. 룬 정복자·승전보·전설: 가속·최후의 저항 + 뼈 방패·소생. 핵심 쇼진의 창·월식·갈라진 하늘 + 판금 장화(70.3%). 롱소드·도란·물약·제어 와드 없음. 스킬 `QEWQQRQEQER` |
| 오공 (정글 + 탑) | "정글 · 2티어 · 86%" / "탑 · 표본 부족 · 11%", 탭별 빌드 다름, "← 정글 티어 목록" |
| 징크스 (원딜) | 신발 칸 숨김 (신발 사용률 0.16%) |
| 야스오 미드 (건메탈 군화 수정 후) | 불멸의 철갑궁·몰락한 왕의 검·무한의 대검 + 신발 건메탈 군화. 영향 5곳(야스오·요네·가렌·트린다미어·아크샨 미드) HTML 확인 |
| 이미지 | Data Dragon 이미지 주소 334개(스플래시·로딩 제외) 모두 200. 아트록스 66개·카밀 105개 이미지 깨짐 0 |
| 텍스트 | 상세 173개 HTML에 `{{` 0건, 이스케이프된 HTML 태그 0건 |

### 상태 (scratchpad 가짜 API + `API_BASE_URL`만 바꾼 실행, 프로젝트·DB 변경 없음)

| 상황 | 결과 |
|------|------|
| 집계 전 / 빈 목록 + `isStale` + 패치 1개 | 집계 전 문구 / "패치 26.20" + 지연 안내 + 빈 목록 문구 |
| 아트록스 `STATS_NOT_FOUND` / 쓰레쉬 집계 전 | 각 문구, Hero·스킬·스킨·스토리 정상 |
| 징크스 표본 부족 + 알 수 없는 ID + 빈 빌드 | "표본 부족 (50게임 미만)", "알 수 없는 룬 #1"·"알 수 없는 파편", 빈 영역 3개 문구, 서버 경고 1줄 |
| 서비스 중 500 | error 경계 화면 |
| 서비스 중 백엔드 다운 (재검증 20초 복사본) | 25·30·55초 뒤에도 직전 페이지 유지(`STALE`→`HIT`), 처음 만드는 페이지는 HTTP 500 + `champions/error.tsx` |

### 성능 (Review 측정, 조건은 `front_review.md` 4장)

| 페이지 | 성능 | LCP | CLS | 접근성 |
|--------|------|-----|-----|--------|
| `/champions` | 96 | 2.78s | 0 | 100 |
| `/champions/Aatrox` | 94 | 3.15s | 0 | 100 |

## 12. 실행 방법

```bash
# 1) 백엔드 읽기 API (루트 .env의 DATABASE_URL 사용, 포트 4000)
npm --prefix backend start

# 2) 프론트 (다른 터미널). 루트 .env의 API_BASE_URL을 next.config.ts가 읽는다
cd frontend
npm run dev                            # 개발 모드: http://localhost:3000
npm run build && npm start             # 운영 모드: 백엔드를 켠 상태에서 빌드해야 통계가 들어간다
npm run lint                           # 린트
npx next typegen && npx tsc --noEmit   # 타입 검사
```

- 백엔드를 끈 채 빌드해도 성공하고 통계 자리에 "통계 서버에 연결하지 못했습니다"가 들어간다. 통계를 보려면 백엔드를 켜고 다시 빌드한다.
- 이전 빌드의 API 응답은 `.next/cache/fetch-cache`에 최대 1시간 남는다. API 없는 빌드를 일부러 확인하려면 이 폴더를 지우고 빌드한다.
- macOS에서 소문자 상세 주소(`/champions/garen`)를 열어 본 뒤에는 다시 빌드한다 (13장).

## 13. 남은 문제

> 자세한 목록은 `front_overview.md` "해결되지 않은 점"에 있다. 구현 상태와 직접 관련된 것만 적는다.

| 항목 | 내용 | 상태 |
|------|------|------|
| 소문자 상세 주소 | macOS 로컬 `next start`에서 정적 페이지 덮어쓰기. 사용자 결정으로 보류 | ⏸️ |
| 룬 1·2순위 중복 | 71/173명이 같은 조합(보조 룬 순서만 다름). 백엔드 집계 쪽에서 고칠 일 | ⏸️ |
| `npm audit` | high 5건 (`eslint-config-next` → `fast-glob` 등 개발 의존성, 2026-10-16 확인). 조치하지 않음 | ⏸️ |
| **(범위 밖, 메인 에이전트 보고)** `ChampionAbilities.tsx`(스킬/패시브 설명 카드) `<ul class="flex space-x-3">`에 줄바꿈이 없어 360px에서 그 섹션까지 스크롤하면 페이지 전체 가로 스크롤이 생김(`scrollWidth` 360→779). 변경 05(`PositionStatsPanel.tsx`·`SkillOrder.tsx`만 수정)가 만든 문제가 아니며, 세션 시작 시점 `git status`에 `ChampionAbilities.tsx`가 이미 수정(M) 상태였다 — 다른 작업이 진행 중인 것으로 보인다. 변경 05 작업 범위 밖이라 고치지 않았다 | ⚠️ 미보고 발견 |
| **(메인 에이전트 보고, 변경 06)** `npm run build`가 "Your version of Next.js is affected by a known security vulnerability"라며 한 번 멈추고, `next upgrade --agent=security`로 별도 Git worktree에서 업그레이드를 실행할지 사용자에게 물어보라고 안내한다(재시도하면 경고만 남기고 빌드는 계속 진행됨). 이번 변경 범위(새 의존성 금지, Next.js 버전 변경 없음)에서 처리할 일이 아니라 조치하지 않았다. 다음 의존성 점검 때 함께 본다 | ⚠️ 미보고 발견 |
| 전적 검색 랭크 없음(`leagues: []`) 상태 | 테스트 계정(`너희는개다#KR1`)이 항상 랭크 2개를 갖고 있어 실제 계정으로는 못 봤다. scratchpad 가짜 응답 서버(`leagues: []`)로 "랭크 정보가 없습니다" 카드를 확인했다(14장) | ✅ (가짜 데이터로 확인) |

변경 02에서 해결: `CHAMPION_TAGS` 삭제, `TierBadge` 대비 주석 수정, `layout.tsx` description 갱신.

---

## 14. 전적 검색 (변경 06)

> 기준: `front_spec.md` 5-7·11장 D28~D38, `docs/contracts/api_contract.md` v3 2-5. "이름#태그" 검색 → 프로필·랭크·최근 매치 20건.

### 14-1. 신규/수정 파일

| 파일 | 변경 내용 | 상태 |
|------|-----------|------|
| `src/lib/api/client.ts` | `fetchApi<T>(path, options?)`로 확장, `options.cache === "no-store"`면 `revalidate` 대신 `cache: "no-store"`. `classifyError`에 `SUMMONER_NOT_FOUND`(404)→`not_found`, `RIOT_UNAVAILABLE`(502)→`riot_unavailable`, `RIOT_KEY_EXPIRED`(503)→`riot_key_expired` 추가 | ✅ |
| `src/lib/api/types.ts` | 계약 2-5 타입(`SummonerProfile`, `League`, `MatchParticipant`, `MatchSummary`, `SummonerResponse`) 추가 | ✅ |
| `src/lib/api/api.ts` | `SummonerState`, `getSummoner(region, riotId)` 추가 (`StatsState`와 분리 — `window`가 없어 `requireStats`/빌드 중 판단이 맞지 않음) | ✅ |
| `src/lib/ddragon/images.ts` | `profileIconUrl(version, profileIconId)` 추가 | ✅ |
| `src/lib/view/summoner.ts` (신규) | 큐 한글화(D33), 티어+단계 글자(D34), 승률 계산, `toKeystoneMap`(룬 트리 평탄화, D32), 상대 시각·게임 길이·KDA·분당 CS, 아이템/주문/키스톤/참가자 뷰 변환 | ✅ |
| `src/lib/view/format.ts` | `formatRelativeKo`(상대 시각), `formatDuration`, `formatKda`, `formatCsPerMinute` 추가 | ✅ |
| `src/app/globals.css` | `--win`(`#5a9bff`)·`--lose`(`#f16565`) 토큰 + `@theme inline` 등록 (D35) | ✅ |
| `src/components/layout/SummonerSearchForm.tsx` (신규, client) | 헤더 전역 검색 폼. "이름#태그" 파싱(`parseRiotIdInput`), 형식 오류 시 서버 요청 없이 안내, `router.push("/summoners/kr/{riotId}")`. "#" 없이 이름만 입력하면 `tagLine`을 기본값 `KR1`로 채움(2026-10-27 사용자 요청, 작은 수정이라 Review 생략·`lint`+`tsc`+실제 브라우저 검색으로 직접 검증: "너희는개다" → `/summoners/kr/너희는개다-KR1` 정상 이동, 매치 20건 표시 확인) | ✅ |
| `src/components/layout/Header.tsx` | `SummonerSearchForm` 추가, 로고·nav에 `shrink-0`. (변경 09) 높이 `sm:h-16`·`sm:sticky`, 모바일 `flex-wrap` 2줄 | ✅ |
| `src/components/summoners/ProfileHeader.tsx` (신규) | 프로필 아이콘·이름#태그·레벨. 재검색 폼 없음(2026-10-27 사용자 교정). (변경 09) 레벨 배지·티어 줄·갱신하기로 확장(17장) | ✅ |
| `src/components/summoners/RankList.tsx` (신규) | 랭크 카드. 2026-10-27: 자유랭크 카드 삭제(솔로/듀오만), D34 뒤집어 엠블럼 이미지 10개(`public/rank-emblems/*.png`, 로컬 정적 파일) 사용·없는 티어는 글자 배지로 대체. **(변경 09, 2026-10-30) 자유랭크 카드를 되살려 항상 2장(솔로/듀오 → 자유랭크), 기록 없으면 Unranked 카드(17장)** | ✅ |
| `src/components/summoners/MatchList.tsx`, `MatchRow.tsx` (신규) | 매치 20건 목록 / 매치 1건(챔피언·시간·KDA·CS·주문·키스톤·아이템·참가자). 아이템·주문·키스톤 아이콘에 기존 `Tooltip` 재사용. 2026-10-27 사용자 피드백 7건으로 열 순서·배치를 교정: ① "op.gg와 정보 배치/순서가 다르다" → 소환사 주문·키스톤 룬을 챔피언 아이콘 바로 옆으로(그전엔 CS 뒤 별도 칸), 결과·포지션·경과시간·게임길이를 한 칸에 모음 ② "아이템은 챔피언 초상화 아래" → 아이템을 챔피언+주문+룬 묶음 바로 아래로 이동 ③ "아이템은 6칸이고 한 줄" → 아이템 줄의 `flex-wrap`을 빼고 컨테이너 고정폭(`w-32`)도 없애 6개+장신구 7칸이 줄바꿈 없이 한 줄로 들어가게 함(컨테이너가 내용 폭만큼 자동으로 넓어짐) ④ "참가자는 한 줄이 아니라 왼쪽(5)-오른쪽(5)" → `ParticipantIcons`를 가로 1줄에서 세로 1열(5칸)로 바꾸고, 같은 팀 열과 상대 팀 열을 나란히 둠(가운데 "vs"는 세로 중앙 정렬) ⑤ "주요룬·보조룬 이미지·위치를 스펠처럼" → 원형+겹친 작은 트리 배지였던 `KeystoneSlot`을 없애고, 스펠과 같은 모양(사각 `size-6`)의 `RuneSlot`으로 바꿈. 처음엔 스펠 2칸과 룬 2칸을 한 열에 전부 쌓았다가, 이어진 피드백("좌 스펠 - 우 룬")으로 좌(스펠 2칸 세로)/우(룬 2칸 세로) 두 작은 열로 나란히 배치 ⑥ "참가자 옆 닉네임" → 백엔드가 `matches[].participants.team/enemy`에 `gameName`/`tagLine`을 추가 노출(Riot match-v5 응답에 이미 있던 `riotIdGameName`/`riotIdTagline`, 추가 호출 없음)한 것을 받아 `ParticipantIcons`가 아이콘 옆에 표시(없으면 생략). 처음엔 "이름#태그"였다가 이어진 피드백("리스트에선 태그 빼고 아이디만")으로 `tagLine`은 빼고 `gameName`만 표시(최대 폭 넘으면 말줄임) ⑦ "승리/포지션/시간 칸이 가운데" → 아이템 줄 때문에 행이 높아지며 `items-center`로 세로 가운데 정렬되던 문제라 그 칸만 `self-start`로 위쪽 고정. ⑧ "그래도 op.gg와 다르다. 결과·포지션·시간 칸은 챔피언 초상화보다 왼쪽" → 결과·시간 칸을 챔피언+주문·룬 묶음 **앞**(JSX 순서상 가장 왼쪽)으로 옮김 ⑨ "챔피언 초상화 오른쪽에 레벨도 표시" → 백엔드가 `matches[].champLevel`(그 게임 도달 레벨, `ParticipantDto.champLevel`을 노출, 추가 호출 없음)을 추가로 줘서, 챔피언 아이콘 우하단에 겹친 작은 배지로 표시(기존 상세 페이지 스킬 아이콘의 "Q/W/E/R" 배지와 같은 자리·스타일). ⑩ "각 참가자 초상화·이름 아래 얇은 딜량 막대그래프, 왼쪽 파랑·오른쪽 빨강" → 백엔드가 `matches[].participants.team/enemy[].damage`(챔피언 대상 딜량, 추가 호출 없음)를 추가로 줘서, `toMatchView`가 그 매치 10명 중 최댓값 대비 비율(`damagePercent`)을 계산. `ParticipantIcons`가 아이콘+이름 아래 `h-1` 막대그래프를 추가, 같은 팀은 `bg-win`(파랑), 상대 팀은 `bg-lose`(빨강) ⑪ "왼쪽 챔피언 초상화·아이템·룬·스펠 크기를 리스트 안에서 조금 늘리기" → 챔피언 아이콘 `size-10`(40px)→`size-12`(48px), 아이템·스펠·룬 아이콘 `size-6`(24px)→`size-7`(28px) ⑫ "그래프 얇게, 리스트 모든 콘텐츠는 높이가 일정해야" → 딜량 막대를 `h-1`(4px)→`h-0.5`(2px)로. 행 안 칸들이 일부는 `items-center`(세로 가운데, KDA·CS)·일부는 `self-start`(결과·시간)로 섞여 있어 참가자 칸(5줄+막대, 가장 긺)을 기준으로 다른 칸이 제각각 다른 높이에서 시작하던 문제라, 행 컨테이너를 `items-center`→`items-start`로 통일(개별 `self-start`는 더 필요 없어져 제거). 모든 칸이 같은 위쪽 기준선에서 시작해 높이가 가지런해짐(행 전체 높이 자체는 모든 매치에서 항상 동일했음 — 칸 사이 정렬 일관성 문제였음). ⑬ "딜량 바를 닉네임 하단에, 참가자 아이콘 높이 = 닉네임+딜량바" → `ParticipantIcons` 구조를 바꿔 아이콘은 `self-stretch`(고정 높이 없이 `items-stretch`인 부모 행의 높이를 그대로 따름)로, 이름+막대는 아이콘 오른쪽 세로 묶음으로 분리. 막대가 아이콘 밑이 아니라 이름 칸 바로 아래에만 위치하고, 아이콘 높이가 "이름+막대" 묶음 높이와 정확히 같아짐(실측 18.7px로 동일) ⑭ "아이템 줄 위 빈 공간(아이템 3개 분량)에 KDA 이동" → 챔피언+주문·룬 줄(약 124px)이 아이템 줄(7칸, 약 208px)보다 좁아 생기던 빈 공간에 KDA를 넣음. 그 뒤에 있던 별도 KDA 칸은 삭제, CS 칸만 챔피언 묶음 다음에 남음. ⑮ "챔피언 초상화·아이템·스펠·룬 크기 더 키우기" → 챔피언 아이콘 `size-12`(48px)→`size-14`(56px), 아이템·스펠·룬 아이콘 `size-7`(28px)→`size-8`(32px) ⑯ "승리 하단에 솔랭으로 변경" → 백엔드가 `matches[].queueId`(Riot 큐 ID, 추가 호출 없음)를 새로 줘서, `queueIdLabel()`로 "솔랭"/"자유랭크"/"칼바람" 등 짧은 한글 이름으로 바꿔 결과 칸의 둘째 줄(기존 포지션 라벨 자리)에 표시. 모르는 큐 ID는 숨기지 않고 "기타"로 표시(D33과 같은 원칙). 포지션 라벨(`individualPosition` → "원딜" 등)은 이 자리에서 빠짐(다른 곳에 쓰이지 않아 `MatchView.positionLabel` 필드 삭제). ⑰ "리스트 가장 오른쪽에 수직형 아코디언(펼친 데이터는 아직 구현 X)" → 신규 `components/summoners/MatchExpandToggle.tsx`(client, `useState`로 펼침 상태만 토글, 화살표 아이콘 180도 회전). 행 전체를 client로 만들지 않으려고 이 버튼만 작은 client 컴포넌트로 분리해 `MatchRow`(서버 컴포넌트) 맨 끝에 둠. 펼쳤을 때 보여줄 상세 정보 패널은 이번 범위 밖(다음 변경에서 추가), `aria-expanded`만 토글. 최종 순서: 결과·큐종류·시간(맨 왼쪽) → [챔피언(+레벨 배지)+주문·룬(4칸)+KDA / 그 아래 아이템 한 줄] → CS → [같은 팀 5열(아이콘+이름+딜량 막대) · vs · 상대 팀 5열] → 아코디언 토글(맨 오른쪽), 전부 위쪽 정렬. 모두 작은 수정이라 Review 생략, lint/tsc + 실제 브라우저(데스크톱·360px)로 직접 검증, 20개 행 모두 독립적으로 토글되는 것 확인 | ✅ |
| `src/components/summoners/SummonerStatus.tsx`, `RetryButton.tsx` (신규) | Riot 502/503·백엔드 연결 실패 안내(서버) + [다시 시도] 새로고침 버튼(client) | ✅ |
| `src/app/summoners/[region]/[riotId]/page.tsx` (신규) | `dynamic = "force-dynamic"`, `region !== "kr"` → `notFound()`, `riotId` 디코딩(D38), 상태별 분기(404/Riot 오류/정상), Data Dragon 병렬 호출 | ✅ |
| `src/app/summoners/[region]/[riotId]/loading.tsx` (신규) | 프로필·랭크·매치 스켈레톤 | ✅ |
| `src/app/summoners/[region]/[riotId]/not-found.tsx` (신규, client) | "소환사를 찾을 수 없습니다" + 헤더 검색창(`#riotid-search`) 재포커스 | ✅ |
| `src/app/summoners/[region]/[riotId]/error.tsx` (신규, client) | 예상 밖 오류(Data Dragon 실패 등)만 처리. Riot 502/503은 `page.tsx`가 `SummonerStatus`로 직접 그림(D37) | ✅ |
| `frontend/mockup-summoner-search.html` | 목적 달성(승인용 목업)으로 삭제 | ✅ |

### 14-2. 계획과 다르게 구현한 점

1. **D37 — Riot 502/503·연결 실패를 `error.tsx`로 던지지 않고 `page.tsx`가 직접 그린다.** 처음엔 `Error.message`에 상태 코드(`"RIOT_UNAVAILABLE"` 등)를 담아 던지고 `error.tsx`가 그 값으로 문구를 고르게 만들었다. 운영 빌드(`next build && next start`)로 실제 확인하니 메시지가 항상 기본 문구("데이터를 불러오지 못했습니다…")로만 나왔다 — Next가 **production 빌드에서 서버 컴포넌트가 던진 오류의 `message`를 클라이언트로 보내지 않고 가리기 때문**(보안 동작, 의도된 것으로 Next 문서에 설명됨)이다. 그래서 설계를 바꿔 `page.tsx`가 상태별로 `SummonerStatus` 컴포넌트를 직접 반환하게 했고, `error.tsx`는 Data Dragon 실패 같은 예상 밖 오류만 잡는 안전망으로 남겼다.
2. **D38 — 동적 라우트 `params.riotId`는 자동 디코딩되지 않는다.** 계획 당시엔 Next가 `params`를 디코딩해 줄 것으로 가정했으나, 운영 빌드로 직접 확인한 결과 URL 인코딩된 문자열 그대로 온다(Next 16.4). 처음 구현은 이미 인코딩된 값을 다시 `encodeURIComponent`로 감싸 이중 인코딩하는 버그가 있었고, 실제 테스트 계정으로 검색하면 항상 `SUMMONER_NOT_FOUND`가 나왔다. `decodeRiotId()`(디코딩 실패 시 원문 그대로)를 추가해 고쳤다.
3. 계획 문서의 "결정이 필요한 사항" 표는 Plan 단계에서 ★ 추천안으로 전부 승인됐으므로, Build에서는 추천안 그대로 구현했다(계획과 다른 점 아님).

### 14-3. 검증 결과 (2026-10-27)

- `npm run lint`: 오류·경고 0
- `npx next typegen && npx tsc --noEmit`: 오류 0
- 새 런타임 의존성: `git diff -- frontend/package.json frontend/package-lock.json` 0줄
- `npm run build` (백엔드 켬, 로컬 `http://localhost:4000`): **183정적 페이지 + 신규 동적 라우트 1개(`ƒ /summoners/[region]/[riotId]`)** 성공, `[api]`/`[view]`/`[stats]` 경고 0줄 (Next.js 보안 업그레이드 안내가 한 번 빌드를 멈췄으나 재시도로 통과 — 13장 참고, 조치 안 함)
- **기존 통계 화면 회귀 확인**: `rm -rf .next/cache/fetch-cache` 후 백엔드를 끄고 다시 빌드 → 183페이지 그대로 성공, `[api] 통계 서버에 연결하지 못했습니다` 경고 7줄(변경 06 이전과 동일한 줄 수) — 기존 `fetchApi` 호출의 기본 캐시 동작(`revalidate: 3600`)이 이번 `options` 파라미터 추가로 바뀌지 않았음을 확인
- **실제 API 검증** (운영 빌드, 백엔드 켬, 격리된 포트 3002에서 `next start`로 확인 — 이미 다른 세션이 포트 3000의 `next dev`를 쓰고 있어 간섭하지 않으려고 별도 포트 사용):
  - 헤더 검색창에 `너희는개다#KR1` 입력 → `/summoners/kr/너희는개다-KR1` 이동, 프로필(소환사 아이콘·"너희는개다 #KR1"·레벨 629), 랭크 카드(자유랭크 실버2 52LP 31승40패 43.7%, 솔로/듀오 실버1 6LP 130승136패 48.9%), 매치 20건 모두 확인. `read_page` 접근성 트리로 `listitem` 20개, 각 행 아이템 6~7칸(빈 칸 포함)·소환사 주문 2개·키스톤·같은 팀/상대팀 5+5명 alt 텍스트 확인
  - 존재하지 않는 `이상한이름#0000` 검색 → "소환사를 찾을 수 없습니다" + "이름#태그를 확인해 주세요." 확인, 검색창에 포커스 링이 다시 생김(`not-found.tsx`의 `#riotid-search` 포커스 확인)
  - 형식 오류(`형식오류`, `#` 없음) 검색 → 서버 요청 없이 "이름#태그 형식으로 입력해 주세요" 안내, 페이지 이동 없음
  - `region=na` → 404
  - scratchpad 가짜 백엔드(`/private/tmp/.../scratchpad/fake-summoner-api.js`, 포트 4099)로 `API_BASE_URL`만 바꿔 별도 포트(3005)에서 확인: `502 RIOT_UNAVAILABLE` → "라이엇 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." + [다시 시도], `503 RIOT_KEY_EXPIRED` → "지금은 전적을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요."(버튼 없음, 개발 키 안내 없음), `leagues: []`/`matches: []` → "랭크 정보가 없습니다"/"최근 플레이한 게임이 없습니다"
  - 360px: `document.documentElement.scrollWidth === clientWidth`(360) 확인, 1열(랭크→매치), 헤더 검색창도 겹침 없이 줄어듦
  - 768px: `scrollWidth === clientWidth`(768), 1열 유지
  - 1024px: `scrollWidth === clientWidth`(1024), `grid-cols-[280px_1fr]` 2단(좌 랭크, 우 매치) 확인
  - 콘솔 오류 0건(`read_console_messages onlyErrors`)
  - 승/패 색 대비: `#5a9bff`(승)·`#f16565`(패)를 배경(`#0b1020`)·표면(`#141b2f`) 각각에 대해 WCAG 상대 휘도 공식으로 계산 — 배경 6.82/6.12, 표면 6.16/5.53으로 모두 4.5:1 이상 (스크립트로 계산, globals.css 주석에 수치 반영)
- 사용한 테스트 계정은 항상 랭크 2개를 갖고 있어, 랭크 없음(`leagues: []`)은 실제 계정이 아니라 가짜 응답으로만 확인했다(13장에 기록).

### 14-4. 사용한 scratchpad 보조 파일 (저장소에 포함되지 않음)

- `fake-summoner-api.js`: 포트 4099에서 `SUMMONER_NOT_FOUND`/`RIOT_UNAVAILABLE`/`RIOT_KEY_EXPIRED`/빈 랭크·매치 응답을 주는 최소 Node `http` 서버. 확인 후 종료, 프로젝트·DB 변경 없음.

---

## 15. 최근 게임 요약 카드 (변경 07)

> 기준: `front_spec.md` 5-8·11장 D39~D44. 매치 목록 위에 "최근 N게임 요약" 카드. API·백엔드·DB·계약 변경 없음, 새 의존성 없음.

### 15-1. 구현

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 집계 함수 | `src/lib/view/summoner.ts`에 `toMatchSummary(matches, champions)`, `MatchSummaryView`, `MostChampionView` 추가. `gameDurationSec >= 300`만 집계(D39), 승/패/승률 `round(100×승/N)`, 평균 K/D/A 합÷N 소수 1자리, KDA `formatKda(ΣK,ΣD,ΣA)`(데스 0은 1로 나눔), 모스트 3 = 게임 수 → 승 수 → 최근 플레이(안정 정렬 + Map 삽입 순서), `excludedCount`. `SummonerPageView.summary` 추가 | ✅ |
| 카드 컴포넌트 | `src/components/summoners/MatchSummary.tsx`(신규, 서버). 전적 `N전 W승 L패`(글자+색), 승률 글자 + `role="img"` 승/패 막대(D41), 평균 K/D/A·KDA, 모스트 3(초상화·승률·KDA·게임 수, D42). 이름은 기존 `Tooltip` + 이미지 `alt`. 모스트 1~2종은 왼쪽 정렬(칸 `max-w-24`), 0종이면 블록 숨김. 집계 게임 0이면 "요약할 게임이 없습니다". 모바일 `전적 | KDA` 2열 + 구분선 + 모스트 가로 3등분, `sm` 이상 3열 | ✅ |
| 페이지 배치 | `page.tsx`: "최근 매치" 제목 아래, `MatchList` 위에 렌더. 매치가 0건이면 카드를 그리지 않아 기존 빈 문구만 보임. sticky 아님(D40), 처음 받은 20게임 기준(D44) | ✅ |
| `format.ts` | 변경 없음(기존 `formatKda` 재사용) | ✅ |
| 하지 않은 것 | 킬관여, 평균 티어, 모스트 10, 과거 시즌 티어. 코드·화면에 빈 자리도 없음 | ✅ |

### 15-2. 계획과 다르게 구현한 점

- 매치가 0건일 때는 카드 대신 기존 "최근 플레이한 게임이 없습니다"만 보이게 했다(카드의 "요약할 게임이 없습니다"는 매치는 있으나 전부 5분 미만일 때 나타남). 계획의 "기존 빈 화면 흐름과 충돌하지 않게"를 따른 것.
- 카드 높이: 계획의 "360px 약 150px"과 달리 실측 약 244px(데스크톱 폭 약 192px). 목업 구조(기준 줄 + 2열 + 모스트 라벨 + 아이콘/승률/KDA/게임 수 4줄)를 그대로 옮긴 결과로, 150px 추정은 목업에서 측정하지 않은 값이었다. 높이를 줄이려면 모스트 4줄 중 줄이는 별도 결정이 필요해 손대지 않았다.

### 15-3. 검증 결과 (2026-10-29)

| 항목 | 결과 |
|------|------|
| `npm run lint` | 통과 (오류·경고 0) |
| `npx tsc --noEmit` | 통과 (오류 0) |
| `npm run build` | 통과 (183 정적 페이지 + 동적 라우트 1개). 첫 시도는 Next.js 보안 업그레이드 안내로 멈췄고 재시도로 통과(업그레이드는 하지 않음) |
| 집계 함수 경계 케이스 | 함수를 임시 스크립트로 추출해 `node --experimental-strip-types`로 실행(저장소 밖 scratchpad, 확인 후 파일 미포함): 매치 0, 전부 5분 미만(`count 0, excludedCount 2`), 데스 0(KDA 10.00), 모스트 동률(게임 수 → 승 수 → 최근 순서 3종 모두 기대대로), 299초 제외, 챔피언 1~2종 확인 |
| 화면(데스크톱 1280) | scratchpad 가짜 API(`API_BASE_URL`만 바꿔 `next start` 포트 3999). 20게임 카드: 20전 12승 8패, 승률 60%, 6.0/3.5/7.5, 3.84 KDA, 모스트 3(86%·7게임 / 20%·5게임 / 100%·4게임). 가로 스크롤 없음, 카드 높이 약 192px |
| 화면(360px) | 가로 스크롤 없음(scrollWidth 360), 모스트 3 가로 3등분, 카드 높이 약 244px(15-2 참고) |
| 상태(가짜 API) | 3게임+5분 미만 1(`최근 3게임 기준 · 5분 미만 1게임 제외`, 손 계산과 일치: 4.3/3.3/4.0, 2.50 KDA, 아트록스 100%·5.00·2게임), 모스트 1종, 전부 5분 미만("요약할 게임이 없습니다"), 매치 0건(카드 없음) |

못 한 확인:
- 실제 백엔드·Riot 계정(`너희는개다#KR1`)으로는 확인하지 않았다. 가짜 API(실제 Data Dragon 이미지 사용)로만 확인했다. 실제 소환사 2~3명 표본 대조는 Review 몫이다.
- 모스트 아이콘 툴팁(호버/탭)은 기존 `Tooltip` 컴포넌트를 그대로 써서 직접 동작을 확인하지 않았다. 768/1024px 폭도 확인하지 않았다.
- 승률 막대·승/패 글자 대비는 기존 `--win`/`--lose` 토큰 재사용(변경 06에서 4.5:1 이상 계산)이며 새로 측정하지 않았다.
- 서버(가짜 API, `next start`)는 모두 종료했다.

### 15-4. Review 결과 반영 (2026-10-29)

- Review가 실제 백엔드·계정 `너희는개다#KR1`로 카드 값(19전 11승 8패, 4.5/5.7/12.8, 3.04 KDA, 모스트 3)을 독립 계산과 대조해 모두 일치함을 확인했다. 위 "못 한 확인"의 실제 계정 대조는 1명 기준으로 해소됐다(`front_review.md` 4장). 코드는 고치지 않았고 상태 표기는 변경 없음(✅).
- Review에서 새로 찾은 것: `sm` 이상에서 모스트 칸이 약 48px로 좁아져 KDA가 두 줄로 꺾인다(낮음, 미수정). 카드 높이 360px 243px 판단은 사용자 결정 대기(`front_review.md` 6·8장).

### 15-4. 후속 작은 수정 (2026-10-29, Review 생략, 파일: `MatchSummary.tsx`만)

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 모스트 칸 줄바꿈 | `li`에 `max-w-28`, `sm:min-w-[5.5rem]`, 승률/KDA 줄에 `whitespace-nowrap`. `sm` 이상에서 "KDA"가 두 줄로 꺾여 칸 높이가 어긋나던 문제 수정 | ✅ |
| 카드 높이 A안 | 승률과 게임 수를 한 줄로 합침("63% · 8게임", 게임 수는 `text-muted`). 칸이 4줄에서 3줄(이미지·승률/게임 수·KDA)로 줄어듦 | ✅ |
| 매치 영역 제목 숨김 | `page.tsx`의 "최근 매치 (최대 20건)" 제목을 `sr-only` "최근 매치"로 변경. 사용자 요청(화면에서 불필요). `aria-labelledby` 영역 이름은 유지. 요약 카드가 "최근 N게임 기준"을 이미 표시 | ✅ |

검증: `npm run lint` 통과, `npx tsc --noEmit` 통과, `npm run build` 통과(첫 시도 보안 업그레이드 안내로 멈춤, 재시도 통과, 업그레이드 안 함). 실제 계정 `너희는개다#KR1`(백엔드 4000·dev 3000, 이미 떠 있던 서버 사용):
- 1280px: 카드 높이 160px(이전 가짜 API 기준 약 192px, 데이터가 달라 직접 비교는 아님), 모스트 세 칸 폭 88px·높이 81.75px로 동일, 텍스트 잘림 없음, 가로 스크롤 없음.
- 360px: 카드 높이 225.75px(이전 243.5px, 목표 약 228px 달성), 세 칸 폭 95px·높이 77.75px 동일, 잘림·가로 스크롤 없음.
- 못 한 확인: 모스트 1~2종 변형 재확인과 768/1024px는 하지 않았다(칸 최대 폭만 24→28rem 단위로 키움). 서버는 내가 띄운 것이 없어 종료할 것 없음, 뷰포트는 데스크톱으로 복원.

### 15-5. 후속 작은 수정: 도넛 차트 + 카드 배경 (2026-10-29, Review 생략, 파일: `MatchSummary.tsx`만)

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 승률 도넛 | `WinRateDonut`(SVG `stroke-dasharray`, 둘레 100, 12시 시계 방향, 색 `var(--win)`/`var(--lose)`). 모바일 48px / `sm` 이상 64px, 가운데 승률 %. 막대와 "승률 N%" 줄 삭제. 래퍼 `role="img"` + `aria-label="20전 12승 8패, 승률 60%"`(실제 값), SVG·가운데 글자 `aria-hidden`, `N전 W승 L패` 글자 병기 | ✅ |
| 카드 배경 | `CARD_CLASS` 상수: `bg-surface-2` + 테두리 + `border-t-4 border-t-accent`(D50 C안). 모스트 초상화 자리 `bg-background`. 집계 0게임 안내 카드는 기존 모양 유지 | ✅ |
| 경계 | 0%는 승 호 미렌더, 100%는 `100 0`, 집계 0게임은 도넛 없음 | ✅ |

검증: `npm run lint` 통과, `npx tsc --noEmit` 통과, `npm run build` 통과(첫 시도 보안 업그레이드 안내로 멈춤, 재시도 통과, 업그레이드 안 함). 실제 계정 `너희는개다#KR1`(이미 떠 있던 백엔드 4000·dev 3000 사용):

| 폭 | 카드 높이 전 → 후 | 도넛 | 모스트 세 칸 | 잘림·가로 스크롤 |
|----|-------------------|------|--------------|------------------|
| 1280px | 160px → 163.25px | 64px | 높이 81.75px로 동일 | 없음 |
| 360px | 225.75px → 228.75px | 48px, 가운데 "53%" 읽힘 | 높이 77.75px로 동일 | 없음 |

가짜 API(scratchpad, `API_BASE_URL`만 바꿔 `next start` 포트 3999)로 HTML의 도넛 속성 확인: 60%(`60 40`), 67%, 50%, 100%(`100 0`), 0%(승 호 없음, 패 원만), 1게임 100%·0%, 모스트 1~2종, 전부 5분 미만("요약할 게임이 없습니다", 도넛 없음), 매치 0건(카드 없음) 모두 기대대로. aria-label은 모든 경우 실제 값.

눈으로 본 느낌: 카드가 매치 행(`surface`, 왼쪽 승/패 띠)과 확실히 구분된다. 금색 띠는 눈에 띄지만 거슬리는 정도는 아니었고, 튀면 `CARD_CLASS`의 `border-t-4`만 바꾸면 된다. 도넛 안 퍼센트는 48px에서도 읽힌다.

못 한 확인: 768/1024px, 도넛 호 색을 눈으로 본 것은 실제 계정(53%) 1건과 가짜 API 100% 화면 일부뿐(0%·60% 등은 SVG 속성으로만 확인), 새 배경 위 글자 대비는 Plan의 계산값을 재사용하고 다시 재지 않음. 내가 띄운 가짜 API와 `next start`는 종료했다.

### 15-6. 후속 작은 수정 2: 기준 문구 삭제, 도넛·초상화 확대, 초상화 옆 KDA (2026-10-29, Review 생략, 파일: `MatchSummary.tsx`만)

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 기준 문구 삭제(D54) | 화면 글자 삭제. `sr-only` 문구와 `N전`의 `title`("모든 큐 기준 · 5분 미만 N게임 제외", 제외 0건이면 "모든 큐 기준") | ✅ |
| 도넛 확대(D55) | 모바일 64px / `sm` 이상 88px, 가운데 글자 `text-base`/`sm:text-lg`. 88px로 좁아진 열에서 "10승 9패"가 두 줄로 꺾여 `whitespace-nowrap` 추가 | ✅ |
| 모스트 초상화·배치(D56~D58) | 초상화 48/56px. 칸을 그리드로 바꿔 데스크톱 A(초상화 \| KDA 굵게 / 승률·게임), 모바일 M3(초상화 \| KDA 두 줄, 아래 승률·게임). M2로 후퇴하지 않음 | ✅ |

검증: `npm run lint` 통과, `npx tsc --noEmit` 통과, `npm run build` 통과(빌드 안내 없이 통과). 실제 계정 `너희는개다#KR1`(이미 떠 있던 백엔드 4000·dev 3000):

| 폭 | 카드 높이 전 → 후 | 도넛 | 초상화 | 모스트 세 칸 | 잘림·가로 스크롤 |
|----|-------------------|------|--------|--------------|------------------|
| 1280px | 163.25 → 125px | 88px | 56px | 높이 56px로 동일 | 없음 |
| 360px | 228.75 → 207px | 64px | 48px | 높이 68.5px로 동일, 폭 98px | 없음 |

화면에 기준 문구 글자 없음(DOM에는 `sr-only`와 `title`만 존재, 내용 확인). 가짜 API(scratchpad, `API_BASE_URL`만 바꿔 `next start` 포트 3999): 360px에서 모스트 1종(`11.00 KDA`, `50% · 2게임`)과 `100% · 4게임`, `4.07 KDA`가 칸 안에 들어가고 넘침 없음, 1280px 모스트 2종(제외 있음, 카드 125px) 정상. 360px에서 가장 오른쪽 초상화 호버 시 툴팁 패널("징크스")이 화면 안(240~289px / 폭 360)에 열림. 눈으로 본 느낌: 3칸이 균형 있고 KDA가 초상화 옆에 읽히며, 카드가 더 낮아져 목록이 위로 올라온다.

못 한 확인: 768/1024px, 0게임 상태의 재확인(이번 변경이 건드리지 않은 분기라 생략), 도넛 가운데 글자 대비 재측정. 모스트 1종은 모바일에서 칸이 왼쪽에 붙는다(빈 칸 없음, 의도). 가짜 API와 `next start`는 종료했다.

## 16. 킬관여·라인전 15분 골드 (변경 08)

> 기준: `front_spec.md` 5-7·11장 D59~D65, `docs/contracts/api_contract.md` 2-5(`matches[].killParticipation`)·2-6(`GET /matches/lane-gold`). 매치 행 CS 칸에 킬관여(서버 값)와 라인전 15분 골드(화면 뒤 지연 로딩)를 더한다. 새 의존성·새 환경 변수 없음.

### 16-1. 구현

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 타입·API | `types.ts`: `MatchSummary.killParticipation: number \| null`, `LaneGoldItem`·`LaneGoldResponse`. `api.ts`: `getLaneGold(puuid, matchIds)`(`server-only`, `cache: "no-store"`, `ApiResult` 그대로 반환). `client.ts`: 로그 경로의 `puuid` 값을 `***`로 가리는 `redactPath`만 추가 | ✅ |
| 프록시 | `src/app/api/lane-gold/route.ts`(신규, GET). `puuid`(`^[0-9A-Za-z_-]{1,100}$`)·`matchIds`(1~10개, 각 `^KR_[0-9]{1,15}$`) 형식 검사 후 `getLaneGold`. 틀리면 400 `INVALID_PARAMETER`(백엔드 미호출), 성공이면 백엔드 JSON 그대로, `riot_unavailable`→502, `riot_key_expired`→503, 그 밖→500(`{ error: { code } }`). 모든 응답 `Cache-Control: no-store` | ✅ |
| 순수 함수 | `src/lib/view/laneGold.ts`(신규, import 없음): 형식 검사, `chunkIds`(10개씩), `normalizeRetrySec`(1~120 아니면 2초, 30초 상한), `laneTone`(52↑/48~51/47↓), `formatLanePercent`, `formatKillParticipation`, `resolveLaneBatch`(묶음 처리·재시도·취소, `fetch`·`sleep`을 주입받아 테스트 가능) | ✅ |
| 지연 로딩 | `LaneGoldProvider.tsx`(client): 마운트 뒤 10개씩 묶어 동시 요청, 결과를 `matchId`별로 보관, 언마운트 시 `AbortController`로 요청·대기 취소. 마운트 전(서버 렌더)은 `useSyncExternalStore`로 알아내 `-`를 그린다. `MatchList.tsx`가 `key={puuid}`로 감싼다 | ✅ |
| 라인전 칸 | `LaneGoldCell.tsx`(client): 로딩=라벨 `라인전` + 회색 막대(`animate-pulse`, `motion-reduce`면 정지), ready=`45:55`(내 쪽 먼저, `tabular-nums`, 색 규칙 `text-win`/본문/`text-lose`), 없음=`-`. 값·`-`는 공용 `Tooltip`, 읽어주는 글은 `sr-only` 한 줄(`aria-live` 없음) | ✅ |
| 킬관여 | `summoner.ts` `MatchView.killParticipation`(`"62%"` 또는 `"-"`). 서버 렌더 HTML에 이미 포함. `Tooltip` 설명 | ✅ |
| 행 구성 | `MatchRow.tsx` CS 칸 `w-24` 유지, 4줄(킬관여 16px / 라인전 16px / CS 20px / 분당 CS 16px, 줄 높이 고정 = 합 68px). 1280·768·360px 모두 행 높이 증가 0px라 계획의 "3줄로 합치기"·`w-28` 확대는 쓰지 않았다 | ✅ |
| 하지 않은 것 | 평균 티어, 골드 실수치 표시, 오류 시 자동 재시도·수동 버튼, 요약 카드 변경 | ✅ |

### 16-2. 계획과 다르게 구현한 점

1. 모바일(360px)의 "3줄 합침" 기본안은 쓰지 않았다. 4줄 구성이 데스크톱·모바일 모두 행 높이를 키우지 않아(아래 측정) 한 가지 모양으로 통일했다.
2. `client.ts`에 계획에 없던 `redactPath`(로그의 `puuid` 가리기)를 넣었다. 계획 "프록시는 `puuid`를 로그에 남기지 않는다"를 지키려면 `fetchApi`의 오류 로그가 경로를 찍는 부분을 고쳐야 했다. 기존 통계 호출의 로그는 `puuid`가 없어 동일하다.
3. 계약 2-5·2-6은 계획의 "계약 의존 값"과 어긋난 곳이 없었다(필드명, `state` 값, `retryAfterSec` 1~120/null, 오류 코드 모두 동일).

### 16-3. 검증 결과 (2026-10-30)

| 명령 | 결과 |
|------|------|
| `npx tsc --noEmit` (`next typegen` 뒤) | 통과 (오류 0) |
| `npx eslint .` | 통과 (오류·경고 0) |
| `next build` (`API_BASE_URL`=임시 백엔드) | 통과. 정적 183페이지 + 동적 `ƒ /api/lane-gold`, `ƒ /summoners/[region]/[riotId]`. 의존성 변화 없음 |
| 순수 함수 (scratchpad 스크립트, `node --experimental-strip-types`) | 통과. 묶음 나누기, 재시도 대기 보정(2초 기본/30초 상한), 색 경계(47/48/51/52), 형식 검사, `pending→pending→ready`는 해당 ID만 재요청, 계속 `pending`이면 처음 1 + 재시도 3번 뒤 `-`, 요청 실패 시 전부 `-`·재시도 없음, 이상한 값(101, 소수) `-`, 취소 시 알림 없음 |

화면 확인 (프로덕션 빌드 `next start`, 임시 백엔드 4100·프론트 3100, 실제 계정 `너희는개다#KR1`, 20게임):

| 항목 | 결과 |
|------|------|
| 킬관여가 첫 HTML에 있음 | `curl`로 행 20개의 킬관여 값이 서버 HTML에 있고, API `killParticipation`과 일치(null 2건은 `-`) |
| 첫 렌더에 라인전 요청 없음 | 서버 HTML에 라인전 값 없음. 마운트 뒤 `/api/lane-gold` 2번(각 10 ID)만 발생. 웜 TTFB 8~13ms |
| 브라우저가 백엔드를 직접 부르지 않음 | 네트워크에 `:4100`·`:4000` 요청 없음, HTML·`.next/static`에 `API_BASE_URL`·`localhost:4100` 없음, 백엔드는 CORS 헤더 없음 |
| 값 일치 | 20게임 전부 백엔드 `GET /matches/lane-gold` 직접 호출 결과와 `myPercent:(100-myPercent)` 일치. 짧은 게임·포지션 없음 `-` 2건 |
| 행 높이 | 1280px 133.32px → 133.32px, 768px 133.32px, 360px 359.32px → 359.32px (모든 행 동일, 증가 0). 채워지는 동안에도 변화 없음 |
| CS 칸 폭 | `w-24`(96px) 그대로. `킬관여 100%`·`라인전 100:0`는 글자 폭 약 69px로 줄바꿈 없음 |
| 레이아웃 이동 | 행 CLS 0 (로딩→값 교체 중 `layout-shift` 없음). 페이지 전체 0.112는 변경 전(3000 포트 이전 코드)에도 똑같이 있는 `loading.tsx` → 본문 교체 때 푸터 이동이라 이번 변경과 무관 |
| 360px | 가로 스크롤 없음(`scrollWidth` 360) |
| 대비 | `--win` on 표면 6.16, `--lose` on 표면 5.53, 본문색 14.22, 보조색 7.63 (모두 4.5 이상). 값 옆에 숫자를 항상 병기 |
| 가짜 서버 `pending` | scratchpad 가짜 백엔드: 묶음1 `ready 3 + pending 6`, 재요청 6·6·3개(해당 ID만, 간격 약 3.5초 = 응답 1.5초 + 대기 2초), 3번째 재요청에서 3개 `ready`, 나머지 3개는 총 4번 요청 뒤 `-` |
| 가짜 서버 오류 | 묶음2가 502면 그 10칸만 `-`, 묶음1·킬관여·CS 정상, 재요청 없음. 프록시 직접 호출: 503(`RIOT_KEY_EXPIRED`)→503, 비JSON 500→500, 백엔드 없음→500, 형식 오류 5종·11개→400(백엔드 미호출), POST→405 |
| 페이지 이탈 취소 | 헤더 링크로 이동(재시도 대기 중) 뒤 추가 요청 0건, 콘솔 오류 0 |
| 새로고침 | 백엔드 로그 `riotCalls=0 cacheHits=10` (백엔드 캐시 그대로 사용) |
| 툴팁 | 킬관여·라인전 값 모두 포커스 이벤트로 열림(문구는 계획과 같음) |
| `puuid` 로그 | 프론트·백엔드 로그에 전체 `puuid` 없음 |

못 본 것: 실제 키보드 Tab 조작(브라우저 창에 포커스가 없어 `focusin` 이벤트를 직접 보내 확인), Lighthouse(CLS·접근성 점수), 정글·서폿 등 `unavailable`이 될 다양한 포지션(짧은 게임 1건만 실제 확인).

---

## 17. 전적 화면 상단 보강 (변경 09)

> 기준: `front_spec.md` 5-7 "변경 09"·11장 D66~D71, 목업 `frontend/docs/mockups/change09.html`. 백엔드·계약 변경 없음, 새 의존성·환경 변수 없음. 중간 변경이라 Review 대상(3장).

### 17-1. 구현

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 화면용 매핑 | `src/lib/view/summoner.ts`: `LeagueView.hotStreak` 추가. `toSummonerPageView`가 `leagues` 대신 `soloLeague`·`flexLeague`(`queueType`으로 찾음, 없으면 `null`)와 `headline`(솔로 → 자유랭크 → `null`, `isFlex`)을 돌려준다. 솔로만 남기던 필터 제거 | ✅ |
| 자유랭크 카드 | `RankList.tsx`: `solo`·`flex` props, 항상 2장. 기록 없으면 점선 원 `?` + "Unranked / 이번 시즌 기록 없음". 마스터 이상은 단계 없는 "마스터"·"그랜드마스터"(기존 규칙) | ✅ |
| 프로필 줄 | `ProfileHeader.tsx`(server): 아이콘 72px(모바일)/96px(데스크톱)+`Lv.N` 배지, 이름 `text-xl`/`sm:text-2xl`, 티어 줄(엠블럼 28px·단계·LP·승패·승률, 자유랭크 기준이면 "자유랭크" 접두, `hotStreak`면 "연승 중" 알약), "KR" 표기 제거. CSS grid로 모바일 3줄/데스크톱 3열 배치 | ✅ |
| 갱신하기 | `RefreshButton.tsx`(신규, client): `fetchedAt` 기준 60초 쿨다운, `useTransition`+`router.refresh()`, `useSyncExternalStore`(1초 구독, 서버 스냅샷=`fetchedAt`)로 시각 처리, "방금 전/N분 전/N시간 전 조회", 갱신 중 스피너·`aria-busy`, `aria-describedby` → sr-only `role="status"`(상태 전환 때만 문구 변경) | ✅ |
| 렌더 시각 | `page.tsx`: 정상 응답 분기에서 `fetchedAt = new Date().toISOString()`을 만들어 `ProfileHeader`에 전달, `RankList`에 새 props | ✅ |
| 검색바·헤더 | `Header.tsx`: `sm:sticky sm:top-0 sm:h-16`, 안쪽 `flex-wrap gap-y-3 py-3 sm:flex-nowrap sm:py-0`. `SummonerSearchForm.tsx`: 폼 `order-last w-full sm:order-none sm:ml-auto sm:max-w-[560px] sm:flex-1`, 입력·버튼 `h-11 text-base rounded-lg`. 동작·`id`·aria 그대로 | ✅ |
| 하지 않은 것 | 백엔드 캐시 우회, 승급전 표시, 이름 복사 버튼, 지난 시즌 티어·조회수·즐겨찾기(API 없음) | ✅ |

### 17-2. 계획과 다르게 구현한 점

1. 360px에서 검색 **폼은 전체 너비 328px**이지만 **입력은 252px**(옆에 검색 버튼 68px+간격 8px)이다. 목업도 입력+버튼 한 줄 구성이라 같은 모양이다. 계획 완료 기준 2의 "입력 폭 328px 이상"은 "폼(입력+버튼) 328px"로 읽고 구현했다(변경 전 입력 159px → 252px). 입력 플레이스홀더("이름#태그 (예: 너희는개다#KR1)")가 252px에서 끝이 잘려 보인다.
2. 모바일 헤더 높이는 109px(목업 설명 "약 100px"보다 약간 큼: 윗줄 로고 줄 + 검색창 44px + 위아래 여백).
3. `RefreshButton`은 계획의 "마운트 때만 `setInterval`" 대신 `useSyncExternalStore`로 1초 구독한다(린트 규칙 `react-hooks/set-state-in-effect`를 피하고 하이드레이션 출력을 서버와 같게 하기 위해, D71).
4. 쿨다운 길이와 상태 문구 외에 계획에 없던 것은 없다. 작업 범위 밖 파일 수정 없음.

### 17-3. 검증 결과 (2026-10-30)

| 명령 | 결과 |
|------|------|
| `npx tsc --noEmit` | 통과 (오류 0) |
| `npx eslint src` | 통과 (오류·경고 0) |
| `next build` (scratchpad 복사본, `API_BASE_URL`=임시 프록시) | 통과. 정적 183페이지 + 동적 `ƒ /api/lane-gold`, `ƒ /summoners/[region]/[riotId]`. 의존성 변화 없음 |
| 순수 함수 (scratchpad `refresh_logic.mts`, `node`) | 통과. `cooldownLeft`(60/59/1/0 경계, 0 아래로 안 내려감), `fetchedLabel`(방금 전/59분/1시간, 시계가 앞서도 0으로 보정) |

환경: 새 코드의 백엔드를 임시 포트 4100(키는 `.env` 자동 로드), 프론트는 scratchpad 복사본 `next dev -p 3100`(이후 프로덕션 빌드 `next start -p 3101`). 기존 3000·4000 서버는 건드리지 않았고 임시 서버는 모두 종료했다. 실제 계정 `너희는개다#KR1`(응답이 자유랭크 먼저 → 큐로 찾는 것도 확인). 내장 브라우저 확인.

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| 검색 폼 1280px | 320x34 (입력 264x34, 버튼 48x32) | **560x44** (입력 484x44, 버튼 68x44) |
| 헤더 높이 1280px | 56 | **64** (sticky 유지 확인) |
| 프로필 카드 1280px | 1104x106 | 1104x138 |
| 360px 폼 | 약 215x34 (입력 159) | **328x44** (입력 252x44, 버튼 68x44) |
| 헤더 높이 360px | 56 | **109** (2줄, `position: static`) |
| 프로필 카드 360px | 369x98 (401px 뷰포트) | 328x219 |

| 항목 | 결과 |
|------|------|
| 자유랭크 카드 | 1280·360px 모두 솔로/듀오(실버 3 89LP 132승 143패 48.0%) → 자유랭크(실버 2 52LP 31승 40패 43.7%) 순 2장, API 값과 일치. 헤더 티어 줄도 솔로 기준 같은 값 |
| 가짜 응답(scratchpad 프록시가 실제 응답의 `leagues`만 바꿈) | 자유 없음 → 자유 카드 Unranked, 솔로 없음 → 솔로 카드 Unranked + 헤더 "자유랭크 실버 2 52 LP", 둘 다 없음 → 카드 2장 Unranked + 헤더 "Unranked", 마스터 이상 → "마스터 231 LP"·"그랜드마스터 500 LP"(단계 없음) + 헤더 "연승 중" 알약. 순서·텍스트 모두 확인 |
| 갱신하기 쿨다운 | 첫 렌더 직후 비활성 "갱신하기 (59초 후)"→카운트다운, `aria-describedby`=`refresh-status`(`role="status"` "다시 갱신하려면 60초를 기다려야 합니다"). **쿨다운 중 실제 클릭 → 백엔드 `GET /summoners` 로그 수 변화 0** |
| 갱신 동작 | 쿨다운 종료 뒤 클릭 → 즉시 "갱신 중…"(`aria-busy=true`, `disabled`, status "전적을 갱신하는 중입니다") → 약 4초 뒤 "방금 전 조회"·"갱신하기 (56초 후)"로 쿨다운 재시작. **백엔드 요청 정확히 1건**, 로그 `소환사 검색 캐시 미스`(=캐시 만료 상태에서 새로 받아옴) |
| 오류 문구 | `abc#` 제출 시 1280px(헤더 아래로 6px 넘침)·360px(2줄 헤더 아래로 7px 넘침) 모두 보이고 가려지지 않음 |
| 모바일 sticky | 360px `position: static`, 1280px `sticky` |
| 가로 스크롤 | 360px `scrollWidth` 360 = `clientWidth` 360 |
| 회귀 | 360px 매치 행 359px(20행 모두), 요약 카드 207px. 1280px 매치 행 133px. 라인전·킬관여 칸 표시 정상. 통계 화면(`/champions`) 헤더는 새 크기로 정상 표시, 본문 영향 없음 |
| 콘솔 | 프로덕션 빌드(`next start`) 페이지 콘솔 메시지 0건. (개발 서버 때는 내가 서버를 껐다 켠 탓의 HMR WebSocket 오류만 있었고 앱 오류는 없음) |

못 본 것 / 못 한 것:

- 실제 계정으로 자유랭크 없는 Unranked 케이스: 테스트 계정이 항상 2개 큐를 가져 가짜 응답(프록시)으로만 확인했다.
- 갱신 후 새 경기가 생겼을 때 `LaneGoldProvider`가 새 `matchIds`를 받는 동작: 같은 경기 목록이라 재요청이 없는 것만 확인했다(코드상 effect 키 `idsKey`). 새 경기 반영과 라인전 재조회는 측정하지 못했다.
- 키보드 Tab으로 버튼 포커스 이동·포커스 링 육안 확인, 스크린리더 실제 낭독, Lighthouse.
- 768px 중간 폭의 헤더·프로필 줄 모양.
- 개발 서버의 하이드레이션 경고 전용 확인(경고 없음으로 보이나 별도 측정 안 함).

보고 사항: `next dev`·`next build` 출력에 "Next.js 보안 취약점 → `next upgrade --agent=security`로 업그레이드하라"는 안내가 한 번 나오며 명령이 멈춘다(재실행하면 계속됨). 이미 남은 문제(13장)에 있는 건이며, 이번에도 따르지 않았다.
