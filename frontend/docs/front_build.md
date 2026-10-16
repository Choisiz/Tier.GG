# 프론트엔드 구현 상태 — Tier.GG 챔피언 화면

> 기준: `front_spec.md` (현재 계획), `docs/contracts/api_contract.md` v2. 코드 상태: 변경 03 Build 반영 후 (2026-10-17).
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
| `Header` / `NavLink` | sticky 56px, 로고, 메뉴 "챔피언". `NavLink`(client)가 `usePathname`으로 하위 경로까지 강조 + `aria-current="page"` | ✅ |
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
| `ChampionHero` (client, 변경 03) | 아이콘, `h1`, 칭호, 스킨 이름/순서 줄(`aria-live="polite"`), 역할군 배지, 난이도 10칸 + `(n/10)`. `HeroSkinSwitcher`를 스플래시 자리에 렌더링하고 `onChange`로 선택 상태를 받아 캡션에 표시. 모바일 세로, md 이상 오버레이. `splashUrl` prop 제거, `skins` prop 추가 | ✅ |
| `HeroSkinSwitcher` (client, 신규, 변경 03) | Hero 스플래시(`fetchPriority="high"` + `loading="eager"`, `alt=""`) + 좌우 화살표(`aria-label="이전/다음 스킨"`, 네이티브 `<button>`), `useState`로 선택 스킨 관리, 양 끝에서 순환. 스킨 1개면 화살표 숨김 | ✅ |
| "← 목록" | 1순위 포지션 탭 주소 + "정글 티어 목록" (통계 없으면 `/champions`, "탑 티어 목록") | ✅ |
| `PositionTabs` (client) | `role="tablist"/"tab"/"tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`, 로빙 `tabIndex`, ←/→·Home/End(끝에서 처음으로 순환), 숨은 패널 `hidden`. 두 패널 모두 정적 HTML. 탭 1개면 "탑" 글자(`p`)만 | ✅ |
| 탭 글자 | "정글 · 2티어 · 86%", `null`이면 "탑 · 표본 부족 · 11%" | ✅ |
| `PositionStatsPanel` (변경 03) | 요약 줄(배지·승률·픽률·밴률·게임, `null`이면 "표본 부족 (50게임 미만)" + "표본이 적어 참고용입니다."). `lg` 이상 1행: 룬(좌) + 주문·스킬(우, `space-y-4`로 2개만 쌓음) 2단 그리드. 2행: "많이 완성한 아이템"을 그리드 밖 전체 폭으로 따로. `lg` 미만은 룬→주문→스킬→아이템 1열. 빈 영역 "표본이 부족해 추천이 없습니다" | ✅ |
| `RunePage` (client, 변경 03) | 1순위 전체 페이지를 핵심 트리 → "사용 …% · 승률 …% · …게임" → 보조 트리 → 능력치 파편 순으로 세로 배치(가로 2단 그리드 제거). 안 고른 룬 흐리게 + `alt=""` + `aria-hidden`, 고른 룬만 `alt`. 2개면 맨 위에 "1순위/2순위" 버튼(`aria-pressed`, 사용률·승률), 전환 시 핵심 트리 아래 줄도 선택된 조합을 따라감. sr 요약 "핵심 룬(정밀): …". 룬 칸(`RuneIcon`)에 `Tooltip` 적용(`shortDesc`) | ✅ (1·2순위가 같은 조합인 챔피언이 많음, 13장) |
| `SummonerSpells` (변경 03) | 상위 2조합, 아이콘 2개 + "점멸 + 점화" + 사용률·승률·게임. 아이콘에 `Tooltip` 적용(`description`) | ✅ |
| `SkillOrder` (변경 03) | `<table>` + `caption` "스킬 찍는 순서 1~11레벨". 머리글 = "레벨" + Q/W/E/R(4열, 각 `Tooltip` 적용), 본문 = 레벨 1~11(11행) × Q/W/E/R 4칸. 칸 `h-7 w-7 sm:h-8 sm:w-8`. 2순위 한 줄 + 사용률·승률 | ✅ |
| `CoreItems` (변경 03) | 핵심 3개 + "신발" 1개(5% 미만 숨김), "게임이 끝날 때 가지고 있던 아이템 기준 · 구매 순서 아님". 아이콘에 `Tooltip` 적용(`description`) | ✅ |
| `Tooltip` (client, 신규, 변경 03) | 호버(`onMouseEnter`/`onMouseLeave`)·포커스(`onFocus`/`onBlur`)·탭(`onClick` 토글 + 바깥 탭 시 `document` 클릭 리스너로 닫힘) 공용. `role="tooltip"` + `aria-describedby`. `content`가 없으면 트리거만 그대로 렌더링(툴팁 없음). 패널은 `w-max max-w-64`(Build 중 발견: `max-w-*`만 쓰면 `<span>`이 비치환 inline이라 폭이 거의 0으로 찌그러지는 버그가 있어 `w-max` 추가로 수정) | ✅ |
| 통계 없음 상태 | `STATS_NOT_FOUND` "최근 14일 통계가 없습니다.", 집계 전 문구, 빌드 중 연결 실패 문구. Hero·스킬·스토리는 정상 | ✅ |
| `ChampionAbilities` | 패시브 + Q/W/E/R, 아이콘(`image.full`)·키·이름(`h3`)·재사용 대기시간(패시브 제외)·설명(`description`, HTML 제거, `whitespace-pre-line`). `dangerouslySetInnerHTML` 없음 | ✅ |
| `ChampionLore` | `lore` 텍스트 | ✅ |
| 미표시 | `stats`, `allytips/enemytips`, `recommended` 표시 안 함 | ✅ |
| 제목 구조 | `h1` 이름 → `h2` "포지션별 통계와 추천 빌드" → 카드 `h3` → `h2` 스킬·스킨·스토리 | ✅ |
| `[championId]/loading.tsx` | Hero·통계 제목·기간 줄·탭 2개·요약 줄·빌드 카드 4개·스킬 스켈레톤 | ✅ |

## 9. 반응형과 접근성

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 반응형 | 360 / 768 / 1280px 가로 스크롤 없음. 표 5 / 8 / 8열, 상세 빌드 1 / 1 / 2열(변경 03: `lg` 이상 룬 좌 + 주문·스킬 우 2단, 아이템 전체 폭 별도 행). 스킬 격자(변경 03: 레벨 11행 × Q/W/E/R 4열, 칸 `h-7 w-7 sm:h-8 sm:w-8`)가 360px에서도 여유 있게 들어감 | ✅ |
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

> **쉬운 요약**: 린트·타입·빌드 통과. 백엔드를 켠 빌드와 끈 빌드 모두 성공했다. 리스트 전 행과 상세 173명이 API와 맞았다. (2026-10-15, Build 확인 + Review 수정 후 재확인). 변경 03도 린트·타입·빌드 통과 + 브라우저로 레이아웃·스킨 전환·툴팁·룬 통계를 직접 확인했다. Review가 모바일 탭 첫 번째 터치에서 툴팁이 안 열리는 결함을 찾아 `Tooltip.tsx`를 직접 수정했다(PASS with issues, 아래 "변경 03 Review 수정" 참고).

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

변경 02에서 해결: `CHAMPION_TAGS` 삭제, `TierBadge` 대비 주석 수정, `layout.tsx` description 갱신.
