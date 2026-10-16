# 프론트엔드 구현 기록 — 01 챔피언 화면

> 작성: Build 에이전트 / 기준 문서: `front_spec.md` (승인됨, 결정 사항 10개 모두 ★추천안)
> 작성일: 2026-10-12 / 확인 시점 Data Dragon 최신 버전 `16.20.1`, 챔피언 173개

---

## 1. 초기 세팅

> **쉬운 요약**: create-next-app으로 프로젝트를 만들고, 계획서의 캐싱 방식에 맞게 설정을 손봤다. 추가 의존성은 없다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 프로젝트 생성 | `npx create-next-app@latest frontend --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --turbopack --no-react-compiler --yes`. `frontend/docs/`는 그대로 보존됨 | ✅ |
| 버전 | `next` 16.4.0, `react`/`react-dom` 19.3.0, `tailwindcss` 4, Node v24.15.0 | ✅ |
| 의존성 | create-next-app 기본 구성 그대로. 추가 의존성 없음 | ✅ |
| `next.config.ts` | `images.remotePatterns`에 `https://ddragon.leagueoflegends.com/cdn/**` 추가. 템플릿 기본값 `cacheComponents: true`, `partialPrefetching: true`는 제거 (아래 "계획과 다른 점" 1 참고) | ✅ |
| `globals.css` | 다크 색상 토큰(CSS 변수 + `@theme inline`): 배경 `#0b1020`, 표면 `#141b2f`/`#1d2540`, 테두리 `#2a3456`, 텍스트 `#e7eaf3`, 보조 텍스트 `#a4adc6`, 포인트(골드) `#e3b456`. `color-scheme: dark`, 공통 `focus-visible` 링 | ✅ |
| `layout.tsx` | `<html lang="ko">`, title 템플릿 `%s \| Tier.GG`, 시스템 한글 글꼴 스택 (템플릿의 Geist 구글 폰트 제거) | ✅ |
| 샘플 정리 | 템플릿 `page.tsx` 샘플 콘텐츠, `public/*.svg` 5개 삭제 (`public/`은 비어서 제거됨). `favicon.ico`, `README.md`, `AGENTS.md`(create-next-app 생성물)는 유지 | ✅ |

## 2. Data Dragon 모듈 (`src/lib/ddragon/`)

> **쉬운 요약**: Data Dragon 호출, 타입, 이미지 URL, 가공 로직을 한 폴더에 모았다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `constants.ts` | `DDRAGON_BASE_URL`, `LOCALE = "ko_KR"`, `REVALIDATE_SECONDS = 3600` | ✅ |
| `types.ts` | 계획서 6-2 원본 타입 + 6-3 화면용 타입 (`any` 미사용) | ✅ |
| `images.ts` | 스퀘어/스플래시/로딩/스킬/패시브 URL 함수. 스킬·패시브·아이콘은 `image.full` 사용 | ✅ |
| `transform.ts` | 태그 한글 매핑, 가나다순 정렬(`localeCompare('ko')`), HTML 제거(`<br>`→줄바꿈, 태그 제거, 공백 정리, 기본 HTML 엔티티 6종 복원), 크로마(`parentSkin`) 제외 + `num` 오름차순, `default`→`기본` | ✅ |
| `api.ts` | `getLatestVersion()`(revalidate 3600), `getChampionList()`, `getChampionDetail(id)`(목록에 없으면 `null`, 버전 포함 URL은 `force-cache`). `res.ok`가 아니면 throw | ✅ |

## 3. 공통 레이아웃

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 헤더 | sticky, 높이 56px(`h-14`), 로고(`/` 링크), 메뉴 배열 기반 내비("챔피언") | ✅ |
| 현재 메뉴 표시 | `NavLink`(client)가 `usePathname`으로 하위 경로까지 판별, 강조 + `aria-current="page"` | ✅ |
| 본문 | `main#main-content`, `max-w-6xl`, 좌우 padding. "본문으로 건너뛰기" 링크(포커스 시에만 노출) | ✅ |
| 푸터 | 현재 패치 버전(`getLatestVersion()`), "데이터: Riot Data Dragon", 라이엇 법적 고지문 | ✅ |
| `/` 리다이렉트 | `redirect('/champions')` (307 확인) | ✅ |
| 전역 404 / 오류 | `app/not-found.tsx`(홈 링크), `app/error.tsx`(다시 시도 + 목록 링크) | ✅ |

## 4. 챔피언 리스트 (`/champions`)

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 렌더링 | Server `page.tsx` + `revalidate = 3600` → 빌드 결과 `○ /champions` (1h) | ✅ |
| 아이콘 그리드 | `ChampionCard`(카드 전체 `<Link>`), 4/6/8/10열(기본/sm/md/lg), `next/image` + `sizes` + 정사각 고정 비율 | ✅ |
| 정렬 | 한글 가나다순 (첫 항목: 가렌, 갈리오, 갱플랭크…) | ✅ |
| 검색 | 한글 이름·영문 id 부분 일치, 대소문자·공백 무시, 즉시 필터. `<label>`(sr-only) 연결 | ✅ |
| 역할군 필터 | 전체 + 6개 태그 단일 선택 토글, `<button aria-pressed>`. 모바일 가로 스크롤 한 줄, sm 이상 줄바꿈 | ✅ |
| 결과 개수 | `챔피언 (n)`, 개수 부분 `aria-live="polite"` | ✅ |
| 결과 없음 | "'{검색어}'에 해당하는 챔피언이 없습니다"(검색어 없으면 "조건에 해당하는 챔피언이 없습니다") + [필터 초기화] | ✅ |
| 로딩 / 오류 | `champions/loading.tsx`(검색창·필터·아이콘 스켈레톤), `champions/error.tsx`(다시 시도 + 목록 링크) | ✅ |

## 5. 챔피언 상세 (`/champions/[championId]`)

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 렌더링 | `generateStaticParams`로 173개 SSG(●) + `revalidate = 3600`, `dynamicParams` 기본값(true) | ✅ |
| 없는 챔피언 | 목록에 id가 없으면 `notFound()` → `[championId]/not-found.tsx` ("챔피언을 찾을 수 없습니다" + 목록 링크), `/champions/Foo` 404 확인 | ✅ |
| 메타데이터 | `generateMetadata`: "아트록스 - 다르킨의 검 \| Tier.GG" 확인 | ✅ |
| Hero | 기본 스킨 스플래시(`priority`, 장식용 `alt=""`), 아이콘, `h1` 이름, 칭호, 역할군 배지(한글), 난이도 막대 10칸 + `(n/10)`. 모바일은 스플래시 위·정보 아래, md 이상은 배경 위 오버레이 | ✅ |
| 목록 링크 | 상단 "← 챔피언 목록" | ✅ |
| 스킬 | 패시브 + Q/W/E/R, 아이콘(`image.full`)·키 라벨·이름(h3)·재사용 대기시간(`cooldownBurn`, 패시브 제외)·설명(`description`, HTML 제거, `whitespace-pre-line`). `dangerouslySetInnerHTML` 미사용 | ✅ |
| 스토리 | `lore` 텍스트 섹션 | ✅ |
| 미표시 항목 | `stats`, `allytips/enemytips`, `recommended` 표시 안 함 (결정 5-A) | ✅ |
| 로딩 | `[championId]/loading.tsx` (Hero + 스킬 5줄 스켈레톤) | ✅ |

## 6. 스킨 리스트 (상세 안 섹션)

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 대상 | `parentSkin` 없는 스킨만 (아트록스 13개 확인), 첫 스킨 "기본" | ✅ |
| 미리보기 | 상단 16:9 스플래시 + 스킨 이름(`figcaption`, `aria-live="polite"`), 기본 선택 `num 0` | ✅ |
| 그리드 | 로딩 이미지(308:560 고정 비율) + 이름, 3/4/5/6열, `<button aria-pressed>` + 선택 시 골드 테두리 | ✅ |
| 선택 | 클릭·Enter·Space(네이티브 button)로 미리보기 교체 (브라우저에서 "정의의 아트록스" 선택 확인) | ✅ |
| 이미지 실패 | `onError` 시 회색 플레이스홀더 + 이름 (고정 비율 유지) | ✅ |

## 7. 반응형·접근성

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 반응형 | 계획서 8장 표대로 열 수 지정. 360px에서 `/champions`(4열), `/champions/MonkeyKing` 가로 스크롤 없음 확인, 1024px 상세 가로 스크롤 없음 확인 | ✅ |
| 이미지 | 전부 `next/image` + `sizes` + 고정 비율 컨테이너, Hero 스플래시만 `priority` | ✅ |
| alt | 아이콘=챔피언 이름, 스킬=스킬 이름, 스킨=스킨 이름, Hero 배경=`alt=""`. 카드 링크·스킨 버튼은 이름 중복 낭독 방지를 위해 `aria-label`=이름 | ✅ |
| 키보드 | 모든 상호작용 요소가 네이티브 `a`/`button`/`input`, 공통 `focus-visible` 골드 링 | ✅ |
| 제목 구조 | 페이지당 `h1` 1개, 섹션 `h2`, 스킬명 `h3` | ✅ |
| 콘솔 | 리스트·상세(Aatrox, MonkeyKing) 브라우저 확인 시 콘솔 로그/에러 없음, 깨진 이미지 0개 | ✅ |

---

## 8. 자체 검증 결과

| 명령 / 확인 | 결과 |
|-------------|------|
| `npm run lint` | ✅ 오류 0, 경고 0 |
| `npx tsc --noEmit` | ✅ 오류 0 (`PageProps`/`LayoutProps` 전역 타입 생성을 위해 먼저 `npx next typegen` 실행 — `next build`/`next dev`도 자동 생성) |
| `npm run build` | ✅ 성공. `○ /`, `○ /champions`, `● /champions/[championId]` 173개(Garen, Galio, Gangplank +170), 모두 Revalidate 1h. 총 178 페이지 생성 |
| `next start` + curl | `/` → 307(`/champions`), `/champions` 200(챔피언 링크 173개), `/champions/Aatrox` 200, `/champions/MonkeyKing` 200(스킬 이미지 `MonkeyKingDoubleAttack.png` 등 `image.full` 사용), `/champions/Foo` 404, `/nope` 404 |
| 상세 HTML | 탭 제목 "아트록스 - 다르킨의 검 \| Tier.GG", `{{` 0건, 이스케이프된 HTML 태그 0건, 푸터 "패치 16.20.1", 스킨 버튼 13개(`aria-pressed="true"` 1개) |
| 브라우저 | 검색 "AATROX" → `챔피언 (1)` 아트록스, "zzzz" → 결과 없음 문구 + 초기화 버튼, 스킨 클릭 시 미리보기·`aria-pressed` 변경 |
| 서버 | 확인 후 `next start` 종료 (실행 중인 서버 없음) |

---

## 9. 계획과 다른 점 / 남은 문제

1. **`cacheComponents` 비활성화 (설정 차이)**: create-next-app 16.4 템플릿은 `cacheComponents: true`, `partialPrefetching: true`를 기본으로 넣는다. 이 모드에서는 계획서 4장의 `export const revalidate`, `dynamicParams`를 쓸 수 없고(문서상 미지원), 스트리밍 때문에 없는 챔피언이 404 대신 200이 될 수 있다. 계획서 캐싱 설계를 그대로 따르기 위해 두 옵션을 제거했다. 의존성 변화는 없다.
2. **Tailwind 연동 패키지 이름**: 계획서 2장 표에는 `@tailwindcss/postcss`로 적혀 있으나 현재 템플릿 기본값은 `@tailwindcss/turbopack`(+ `next.config.ts`의 `turbopack.rules`)이다. 템플릿 기본 그대로 사용했다(추가 의존성 아님).
3. **error.tsx의 `retry`**: Next 16.4의 error 컴포넌트 prop 이름이 `reset`이 아닌 `retry`라서 `retry()`로 구현했다. 동작(다시 시도)은 계획과 같다.
4. **푸터 버전 조회 실패 처리**: 푸터는 루트 레이아웃에 있어 `app/error.tsx`가 감싸지 못한다. 그래서 푸터만 실패 시 "패치 정보 없음"으로 표시하고 페이지는 정상 렌더링한다. 페이지 본문의 실패는 계획대로 error.tsx로 간다.
5. **⏸️ [알려진 문제] 대소문자 다른 URL로 인한 정적 캐시 덮어쓰기 (macOS 로컬 한정, 보류)**: `next start` 상태에서 `/champions/garen`(소문자)을 요청하면 `notFound()` 결과가 ISR 캐시 `.next/server/app/champions/garen.html`로 저장되는데, macOS 기본 파일시스템(대소문자 구분 안 함)에서는 이것이 `Garen.html`을 덮어써 이후 `/champions/Garen`도 404가 된다. 리눅스 등 대소문자를 구분하는 환경(일반적인 배포 환경)에서는 발생하지 않는다. 다시 `npm run build` 하면 복구된다. 해결하려면 계획 변경이 필요하다 — 예: (a) `dynamicParams = false`(새 챔피언은 재빌드 필요), (b) 대소문자 무시 매칭 후 정식 id로 리다이렉트, (c) Proxy에서 사전 차단. **Review 시 macOS에서 소문자 URL을 확인한 뒤에는 재빌드 후 다른 항목을 확인할 것.**
6. `npm install` 시 `npm audit`가 high 5건을 보고했다(템플릿 기본 의존성). 계획 범위 밖이라 조치하지 않았다.

> **결정 (2026-10-12, 사용자)**: 5번은 코드 수정 없이 **알려진 문제**로 기록만 한다. 개발 모드(`npm run dev`)와 대소문자를 구분하는 배포 환경에는 영향이 없다. 소문자 URL 지원이 필요해지면 별도 기능(Proxy에서 정식 id로 리다이렉트)으로 계획·승인 후 추가한다.

---

## 10. 추가 수정 — 스킬/스펠 이름 정리 (2026-10-12, 사용자 승인)

> **쉬운 요약**: 챔피언 스킬(Q/W/E/R)을 코드에서 `spell`로 부르던 이름을 `skill`로 바꿨다. 소환사 주문(스펠)과 헷갈리지 않게 하기 위함이며 동작은 그대로다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 타입 이름 | `types.ts`: `DDragonSpell` → `DDragonChampionSkill`. 원본 필드 `spells`는 Data Dragon 이름이라 유지하고 "챔피언 스킬" 주석 추가 | ✅ |
| 이미지 함수 | `images.ts`: `spellIconUrl()` → `skillIconUrl()`. 소환사 주문과 같은 `img/spell/` 폴더를 쓴다는 주석 추가 | ✅ |
| 가공 로직 | `transform.ts`: `SPELL_KEYS` → `SKILL_KEYS`, 변수 `spells`/`spell` → `skills`/`skill` | ✅ |
| 검증 | `npm run lint` 오류 0, `npx tsc --noEmit` 오류 0, `npm run build` 성공(챔피언 173개 SSG). 빌드된 Aatrox·MonkeyKing 페이지의 스킬 아이콘 URL 4개씩 정상 확인 | ✅ |

- 이후 소환사 주문을 추가할 때는 `DDragonSummonerSpell`, `summonerSpellIconUrl()`처럼 `summoner`를 붙여 구분한다.

---

## 11. 추가 수정 — lib/ddragon 주석 보강 (2026-10-12, 사용자 승인 A안)

> **쉬운 요약**: `src/lib/ddragon/`의 타입과 함수에 빠진 한국어 주석을 달았다. 이름 변경은 하지 않았고 동작도 그대로다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `types.ts` | 원본·화면용 타입 전체에 한 줄 설명 추가. 헷갈리기 쉬운 필드에 주의 주석: `title`(칭호, 페이지 제목 아님), `key`(숫자 ID, 매치 championId 대응), `tags`(역할군, 포지션 아님), `lore`(스토리), 스킨 `id`/`num` 규칙 | ✅ |
| `api.ts` | `fetchJson`, `getRawChampionList` 주석 추가 | ✅ |
| `transform.ts` | `CHAMPION_TAGS`, `SKILL_KEYS`, `HTML_ENTITIES`, `toChampionSummary`, `toChampionDetail` 주석 추가 | ✅ |
| `constants.ts`, `images.ts` | 기존 주석 충분, 변경 없음 | ✅ |
| 검증 | `npm run lint` 오류 0, `npx tsc --noEmit` 오류 0, `npm run build` 성공(178페이지) | ✅ |

- 검토했지만 보류한 이름 변경(사용자 결정): `ChampionAbility`/`AbilityKey`/`abilities` ↔ `skill` 용어 혼용, `IMMUTABLE` → `CACHE_FOREVER`.

---

## 변경 01 (2026-10-15): 백엔드 API 연결 (포지션·티어·추천 빌드)

> 작성: Build 에이전트 / 기준: `front_spec.md` 변경 01 (승인됨, D1~D9 추천안), `docs/contracts/api_contract.md` v2 (승인됨), `api.md`
> 확인 시점: Data Dragon `16.20.1`, API `window` 14일 · 3,952게임 · 26.20 66.8% / 26.19 33.2%, 집계 2026-10-14T18:52:26Z (10월 15일 03:52 KST)
> **쉬운 요약**: 챔피언 리스트를 포지션 탭 5개 + 티어 표로 바꾸고, 상세에 포지션 탭과 추천 룬·주문·스킬·아이템을 붙였다. 모든 통계 화면에 기간·패치 구성·집계 시각을 보여준다. 백엔드가 꺼져 있어도 빌드는 통과하고 안내가 들어간다. 새 의존성은 없다.

### 01-B1. API 클라이언트 (`src/lib/api/`)

> 요약: 계약 v2 타입을 옮기고, 오류를 화면이 쓰는 몇 가지 상태로 바꾼다. 모든 파일 첫 줄이 `import "server-only"`다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `config.ts` | `getApiBaseUrl()` (끝 `/` 제거, 값 없으면 `null` — 기본값 없음), `API_REVALIDATE_SECONDS = 3600`, `API_TIMEOUT_MS = 10000` | ✅ |
| `types.ts` | 계약 v2 그대로: `Position`, `Tier`(1~5 \| null), `WindowPatch`, `StatsWindow`, `MetaResponse`, `TierRow`, `TierListResponse`, `PositionSummary`, `StatsSummary`, `ItemBuild`, `RuneBuild`, `SpellBuild`, `SkillBuild`, `ChampionStatsResponse`, `ApiErrorBody` | ✅ |
| `client.ts` | `fetchApi<T>()`: `fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(10000) })`. 결과 `{ ok, data }` 또는 `kind`: `not_ready`(503 STATS_NOT_READY) / `not_found`(404 STATS_NOT_FOUND) / `invalid`(400 INVALID_PARAMETER, 404 NOT_FOUND → 서버 로그에 `code`) / `unavailable`(연결 실패·시간 초과·DB_UNAVAILABLE·500·JSON 아님·URL 없음). 분기는 `error.code`로만. 로그에 기본 URL을 쓰지 않음 | ✅ |
| `api.ts` | `getMeta()`, `getTierList(position)`, `getChampionStats(key, position?)` → `StatsState`(ok / not_ready / not_found / unavailable). `requireStats()`: 빌드 중이 아닐 때 `unavailable`이면 오류를 던짐 (D6) | ✅ |
| `positions.ts` | `POSITIONS`, 한글 이름(탑·정글·미드·원딜·서폿), 소문자 URL 조각 ↔ API 값, `tierListHref()` | ✅ |
| `buildPhase.ts` | `process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD` (`next/constants`). **정적 생성 작업 프로세스에서도 이 값이 보이는 것을 확인했다** — 백엔드를 끈 빌드가 오류 없이 안내 페이지를 만들었다 (01-B7) | ✅ |

### 01-B2. Data Dragon 추가 (`src/lib/ddragon/`)

> 요약: 아이템·소환사 주문·룬 파일을 버전 포함 주소(영구 캐시)로 불러 ID 찾기 표를 만든다. 아이템 거르기 규칙과 능력치 파편 표를 한 곳에 둔다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `types.ts` | `ChampionSummary.key` 추가. 원본 `DDragonItem`, `DDragonSummonerSpell`, `DDragonRuneTree`, 가공 `ItemInfo`, `IconInfo`, `RuneTreeInfo` | ✅ |
| `api.ts` | `getChampionKeyMap()`(key → 요약), `getItems(itemIds, patches)`(최신 버전 먼저, 못 찾은 것만 창 안 다른 패치 `{patch}.1`이 `versions.json`에 있으면 한 번 더), `getSummonerSpells()`, `getRuneTrees()`. 가공 결과는 버전별로 한 번만 만든다(실패하면 지우고 다시 시도). 모두 `force-cache` | ✅ |
| `images.ts` | `itemIconUrl`, `summonerSpellIconUrl`, `runeIconUrl`(`/cdn/img/{icon}`), `statShardIconUrl` | ✅ |
| `itemFilter.ts` | D3 규칙: ① Data Dragon에 없음 ② `Consumable`/`Trinket` ③ `from` 없고 `gold.total < 1000` → 제외, ④ `Boots` 태그 **또는 신발로 만드는 아이템(`builtFromBoots`, Review 수정)** → 신발, ⑤ `into` 있음 → 제외, ⑥ 나머지 → 핵심. `CORE_ITEM_COUNT = 3`, `BOOTS_MIN_PICK_RATE = 5` | ✅ (Review에서 ④ 보완) |
| `statShards.ts` | 공격(5008·5005·5007) / 유연(5008·5010·5001) / 방어(5011·5013·5001), 이름·아이콘 파일 | ✅ |

### 01-B3. 화면용 매핑 (`src/lib/view/`)

> 요약: API 숫자 ID를 이름·아이콘이 붙은 객체로 바꾸고, 숫자는 서버에서 글자로 만들어 클라이언트에 넘긴다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `format.ts` | `formatPercent`(소수 1자리 사사오입, 01-B8의 3번), `formatCount`(천 단위 쉼표), `formatKst`(`Asia/Seoul` 고정 "10월 15일 03:52"), `formatPatchMix`(1개면 "패치 26.20", 2개 이상 "26.20 67% / 26.19 33%", `displayName`만 사용), `toWindowInfoView` | ✅ |
| `tierList.ts` | `TierRow` + 챔피언 key 표 → 표 행 (순서는 API `rank` 그대로, 다른 주 포지션 이름). Data Dragon에 없는 `championId`는 "챔피언 #950"(링크·아이콘 없음) + 서버 경고 1줄 | ✅ |
| `builds.ts` | 룬: 핵심 트리 4줄 / 보조 트리 3줄(핵심 룬 줄 제외) / 파편 3줄, 고른 것만 `selected`, 못 찾은 ID는 "알 수 없는 룬 #id"·"알 수 없는 파편", 스크린리더 요약 글자. 주문: 이름·아이콘. 스킬: Q/W/E/R 줄 머리 + 11칸 순서. 아이템: `itemFilter`로 핵심 ≤3 + 신발(사용률 5% 이상, API 순서 첫 번째) | ✅ |

### 01-B4. 챔피언 리스트 (`/champions`, `/champions/lane/[position]`)

> 요약: 탑은 `/champions`, 나머지 4개는 `/champions/lane/{jungle|middle|bottom|utility}`. 모두 미리 만든 정적 페이지다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 라우트 | `/champions` = `TierListPage(TOP)`, SSG + `revalidate 3600`. `lane/[position]`: `generateStaticParams` + `dynamicParams = false` + `revalidate 3600` | ✅ |
| `top` → 308 | `lane/[position]` 페이지가 `top`이면 `permanentRedirect("/champions")`. 빌드 때 `top.meta`에 `status 308, location /champions`로 저장됨 (01-B8의 1번) | ✅ |
| 잘못된 조각 | `/champions/lane/TOP`, `/champions/lane/Jungle`, `/champions/lane/mid`, `/champions/lane` → 404 | ✅ |
| `PositionNav` | `<nav aria-label="포지션">` + `Link` 5개, 현재 탭 `aria-current="page"` + 강조, 모바일에서 탭 줄만 가로 스크롤 | ✅ |
| `TierTable` (client) | 검색(한글·영문 부분 일치, `rank` 유지, 결과 수 `aria-live`), `<table>` + `caption`(sr-only) + `th scope="col"`. 열: #·챔피언·티어·승률·픽률 / `sm` 이상 밴률·게임 / `md` 이상 "미드 겸용". 챔피언 이름 링크 1개, `after:inset-0`으로 행 전체 클릭. 결과 없음 → 문구 + [검색 지우기] | ✅ |
| `TierBadge` | 1~5티어(글자 + 색, 글자색 `zinc-950`) / `null` → 회색 "표본 부족" + `title`·sr 문구 "최근 14일 50게임 미만이라 티어를 매기지 않았습니다"(`/meta` `rules.minTierPick`, 없으면 50) | ✅ |
| 상태 | `champions: []` → "이 포지션의 최근 14일 통계가 아직 없습니다", `STATS_NOT_READY` → 집계 전 문구, 빌드 중 `unavailable` → "통계 서버에 연결하지 못했습니다", 서비스 중 `unavailable` → 오류(직전 페이지 유지 / `champions/error.tsx`) | ✅ |
| v1 정리 | `ChampionBrowser.tsx`, `ChampionCard.tsx` 삭제 (다른 곳에서 쓰지 않음 확인). 역할군 필터·가나다 정렬 없음 | ✅ |
| 로딩 | `champions/loading.tsx`를 제목 + 기간 줄 + 탭 5개 + 검색 + 10행 스켈레톤으로 교체 (`lane/[position]`에도 적용됨) | ✅ |

### 01-B5. 챔피언 상세 (`/champions/[championId]`)

> 요약: Hero 아래에 "포지션별 통계와 추천 빌드" 영역을 두고, 주 포지션 1~2개를 탭으로 보여준다. 스킬·스킨·스토리는 v1 그대로다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 호출 | 빌드 때 `position` 없이 1번 → `positions[]`. 2순위가 있으면 `?position=…` 1번 더. 2순위가 `STATS_NOT_FOUND`(또는 집계 전)면 그 탭만 뺀다. 두 응답의 `aggregatedAt`이 다르면 서버 경고 1줄, 1순위 기간 표시 | ✅ |
| `PositionTabs` (client) | `role="tablist"/"tab"/"tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`, 로빙 `tabIndex`, ←/→·Home/End, 숨은 패널 `hidden`. 두 패널 모두 정적 HTML에 있음. 탭 1개면 탭 줄 없이 제목("탑")만 | ✅ |
| 탭 글자 | "정글 · 2티어 · 86%", `tier null`이면 "탑 · 표본 부족 · 11%" (`positionShare` 정수 반올림) | ✅ |
| `PositionStatsPanel` | 요약 줄(티어 배지·승률·픽률·밴률·게임, `null`이면 "표본 부족 (50게임 미만)" + "표본이 적어 참고용입니다."), `lg` 이상 2열(왼쪽 룬 / 오른쪽 주문·스킬·아이템), 빈 영역 "표본이 부족해 추천이 없습니다" | ✅ |
| `RunePage` (client) | 1순위 전체 페이지(핵심 트리 4줄, 핵심 룬 줄은 크게 / 보조 트리 3줄 / 파편 3줄), 고르지 않은 룬은 흐리게 + `alt=""` + `aria-hidden`, 고른 룬만 `alt`=이름. 2개면 "1순위/2순위" 버튼(`aria-pressed`, 사용률·승률). sr-only 요약 "핵심 룬(정밀): …" | ✅ |
| `SummonerSpells` | 상위 2조합, 아이콘 2개 + "점멸 + 점화" + 사용·승률·게임 (API 순서) | ✅ |
| `SkillOrder` | `<table>` + `caption` "스킬 찍는 순서 1~11레벨", 줄 머리 `th scope="row"`(아이콘 + 글자 + sr 스킬 이름), 고른 칸에 글자 "Q" 표시, 칸 22px(`sm` 이상 28px). 2순위는 "Q E W Q Q R …" 한 줄 + 사용·승률 | ✅ |
| `CoreItems` | 핵심 3개 + "신발" 1개(5% 미만이면 칸 숨김), 제목 옆 "게임이 끝날 때 가지고 있던 아이템 기준 · 구매 순서 아님" | ✅ |
| 통계 없음 | `STATS_NOT_FOUND` → "최근 14일 통계가 없습니다.", `STATS_NOT_READY` → 집계 전 문구, 빌드 중 연결 실패 → "통계 서버에 연결하지 못했습니다." Hero·스킬·스킨·스토리는 정상 | ✅ |
| "← 목록" 링크 | 1순위 포지션 탭 주소 + 글자 "정글 티어 목록" (통계 없으면 `/champions`, "탑 티어 목록") | ✅ |
| 제목 구조 | `h1` 챔피언 이름(Hero), `h2` "포지션별 통계와 추천 빌드", 빌드 카드 `h3` | ✅ |
| D7 `generateMetadata` | `getChampionDetail`을 try/catch, 실패하면 `{ title: "챔피언" }` → "챔피언 \| Tier.GG" | ✅ |
| D4 LCP | Hero 스플래시 `priority` → `fetchPriority="high"` + `loading="eager"`. 리스트 아이콘 첫 10행 `loading="eager"`, 첫 1개 `fetchPriority="high"`. Lighthouse 측정은 Review가 한다 | ✅ |
| 로딩 | `[championId]/loading.tsx`에 통계 제목·기간 줄·탭 2개·요약 줄·빌드 카드 4개 스켈레톤 추가 | ✅ |

### 01-B6. 공통 (기간 줄, 지연 안내, 푸터, 환경 변수)

> 요약: 통계 화면 위에 기간 한 줄, 집계가 멈추면 노란 안내, 푸터는 공개 패치 이름. API 주소는 루트 `.env`에서 하나만 읽는다.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| `WindowInfo` | "최근 14일 · 3,952게임 · 26.20 67% / 26.19 33% · 10월 15일 03:52 집계", 좁은 화면에서 줄바꿈. `isStale`이면 `role="status"` 노란 상자 "통계 갱신이 지연되고 있습니다 (마지막 집계 …)" | ✅ |
| `StatsNotice` | 집계 전 / 통계 없음 / 연결 실패(`role="status"`) / 포지션 빈 목록 문구 | ✅ |
| D5 푸터 | `/meta`의 `window.patches[0].displayName` → "패치 26.20", 실패 시 "패치 정보 없음" (오류를 던지지 않음) | ✅ |
| D8 `next.config.ts` | 루트 `../.env`가 있으면 `node:fs` + `util.parseEnv`로 읽어 **`API_BASE_URL`만** `process.env`에 넣음. 이미 값이 있으면 덮어쓰지 않음. `env` 옵션 안 씀 | ✅ |
| `.env.example` | "백엔드 API 서버" 묶음 아래 `API_BASE_URL=` + 주석 2줄 (값 없음) | ✅ |
| 의존성 | 변경 없음 (`package.json`, `package-lock.json` diff 0). `server-only`는 Next 내장 처리라 설치 안 함 | ✅ |

### 01-B7. 자체 검증 결과

> 요약: 린트·타입·빌드 모두 통과. 백엔드를 켠 빌드와 끈 빌드 둘 다 성공했다. 리스트 5개 탭 262행이 API와 모두 같고, 상세 173개 전부 탭 수가 API와 같다.

**명령**

| 명령 / 확인 | 결과 |
|-------------|------|
| `npm run lint` | ✅ 오류 0, 경고 0 |
| `npx next typegen && npx tsc --noEmit` | ✅ 오류 0. `any` 0건 |
| `npm run build` (백엔드 켬) | ✅ 성공, 183페이지. `○ /champions`, `● /champions/lane/[position]` 5개(top은 308 저장, 01-B8의 1번), `● /champions/[championId]` 173개, 모두 Revalidate 1h. 빌드 로그의 `[api]`·`[view]`·`[stats]` 경고 0줄 |
| `npm run build` (백엔드 끔, `.next/cache/fetch-cache` 비움) | ✅ 성공, 같은 페이지 수. 경고 `[api] 통계 서버에 연결하지 못했습니다 (/meta, 연결 실패(TypeError)) …` 7줄 (작업 프로세스 7개마다 1줄, 01-B8의 2번) |
| 백엔드 끈 빌드 결과 HTML | `/champions`, `/champions/lane/jungle`: 탭 5개 + "통계 서버에 연결하지 못했습니다." + 푸터 "패치 정보 없음". `/champions/Aatrox`, `/champions/MonkeyKing`: Hero·스킬(P/Q/W/E/R)·스킨(13개/10개)·스토리 + 같은 안내 |
| `lib/api/` 밖 `fetch(` / `lib/ddragon/` 밖 Data Dragon 주소 | ✅ 0건 / 0건. `lib/api/*.ts` 6개 모두 `server-only` |
| 브라우저 번들 `.next/static` | ✅ `localhost:4000`·`/api/v1`·`NEXT_PUBLIC_`·`API_BASE_URL` 문자열 0건 |
| 마지막 상태 | 백엔드 켠 상태로 다시 빌드해 둠. 띄운 서버(백엔드 4000, `next start` 3100, `next dev` 3101, 가짜 API 4100) 모두 종료 |

**리스트 (백엔드 켬 + `next start`, HTML과 API 직접 비교)**

| 확인 | 결과 |
|------|------|
| 5개 탭 행 수 (HTML = API) | 탑 69 · 정글 53 · 미드 63 · 원딜 26 · 서폿 51 = **262행, 순위·이름·티어·승률·픽률·밴률·게임 불일치 0** |
| 티어 / 표본 부족 | 탑 47/22 · 정글 41/12 · 미드 42/21 · 원딜 24/2 · 서폿 32/19. 티어 오름차순, `null`은 모두 맨 뒤 "표본 부족" (예: 탑 69위 아크샨) |
| 현재 탭 | 각 페이지 포지션 nav의 `aria-current="page"`가 탑·정글·미드·원딜·서폿으로 맞음 |
| 기간 줄 | "최근 14일 · 3,952게임 · 26.20 67% / 26.19 33% · 10월 15일 03:52 집계" (`/meta`와 같음, KST) |
| 푸터 / 내부 버전 | "패치 26.20". 화면 글자에 `16.20` 0건 |
| 제목 | "탑 챔피언 티어 \| Tier.GG", "정글 챔피언 티어 \| Tier.GG" 등 |
| 주소 | `/champions/lane/top` → **308** `Location: /champions`, `/champions/lane/TOP`·`/lane/Jungle`·`/lane/mid`·`/champions/lane` → **404**, 그 뒤에도 `/champions`·`/lane/jungle` 200, `/lane/top` 308 그대로 |

**상세**

| 확인 | 결과 |
|------|------|
| 173명 전부 | 200, 탭 수가 API `positions[]`와 모두 같음(불일치 0), 핵심 아이템 3개 미만 0명, "알 수 없는 룬·주문·파편" 0건 |
| 아트록스 (탑 1개) | 탭 줄 없이 "탑", 2티어 290게임. 룬 정복자·승전보·전설: 가속·최후의 저항 + 뼈 방패·소생, 파편 적응형/적응형/체력 증가(레벨 비례). 핵심 쇼진의 창·월식·갈라진 하늘, 신발 판금 장화(70.3%). 롱소드·도란·충전형 물약·제어 와드 이미지 0개. 이미지 66개, 장식(`alt=""`) 29개. 스킬 1순위 `QEWQQRQEQER` 격자, 2순위 한 줄 |
| 오공 (정글 + 탑) | 탭 "정글 · 2티어 · 86%" / "탑 · 표본 부족 · 11%", 첫 탭 `aria-selected="true"`·`tabIndex 0`, 둘째 패널 `hidden`. 정글: 삼위일체·칠흑의 양날 도끼·죽음의 무도 + 헤르메스의 발걸음. 탑: 칠흑의 양날 도끼·삼위일체·월식 + 판금 장화. "← 정글 티어 목록" → `/champions/lane/jungle` |
| 카밀 (탑 + 서폿) | 탭 "탑 · 1티어 · 61%" / "서폿 · 5티어 · 37%", 두 패널 빌드 모두 API ID와 같은 이름 |
| 징크스 (원딜) | 신발 칸 **숨김** (상세의 신발 장화 0.16%, 탐욕의 군화 0.16%). 핵심 마법광학 장치 C44·루난의 허리케인·무한의 대검. "← 원딜 티어 목록" |
| 쓰레쉬·아리 | 핵심 솔라리·태양의 썰매·기사의 맹세 + 신속의 장화 / 악의·그림자불꽃·존야 + 주문투척자의 신발 |
| 이미지 | 상세 6명 + 리스트 2개의 Data Dragon 이미지 주소 334개(스플래시·로딩 제외) 모두 200. `/_next/image` 경유 파편 아이콘 200 `image/png` |
| LCP 속성 | 상세 HTML에 `fetchPriority="high"` 있음, `priority` 사용 0건 |
| 제목 | "아트록스 - 다르킨의 검 \| Tier.GG" |

**상태 (가짜 API 서버를 scratchpad에서 띄우고 `API_BASE_URL`만 바꾼 `next dev`로 확인, 프로젝트·DB 변경 없음)**

| 상황 | 결과 |
|------|------|
| `/meta`·탑 목록 503 STATS_NOT_READY | 탭 5개 + "아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다.", 푸터 "패치 정보 없음" |
| 정글 목록 `champions: []` + `isStale: true` + 패치 1개 | "최근 14일 · 2,481게임 · 패치 26.20 · 10월 13일 05:00 집계" + "통계 갱신이 지연되고 있습니다 (마지막 집계 10월 13일 05:00)" + "이 포지션의 최근 14일 통계가 아직 없습니다." |
| 미드 목록 500 (서비스 중) | `requireStats`가 오류를 던져 error 경계로 감 (서버 로그 `[api] … HTTP 500 INTERNAL_ERROR` 1줄) |
| 아트록스 404 STATS_NOT_FOUND / 쓰레쉬 503 | "최근 14일 통계가 없습니다." / 집계 전 문구, Hero·스킬·스킨·스토리 정상 |
| 징크스: tier null, 룬 ID·파편 ID 일부 없음, 아이템 없는 ID, 주문·스킬 `[]` | "표본 부족 (50게임 미만)" + "표본이 적어 참고용입니다.", "알 수 없는 룬 #1"·"알 수 없는 파편" 회색 칸, 주문·스킬·아이템 "표본이 부족해 추천이 없습니다", 서버 경고 `[view] Data Dragon에 없는 아이템 (Jinx BOTTOM): 999999` |

### 01-B8. 계획과 다른 점

1. **`/champions/lane/top` 308 방식**: 처음에 `next.config.ts`의 `redirects()`로 했으나 Next의 리다이렉트 경로 비교가 대소문자를 구분하지 않아 `/champions/lane/TOP`까지 308이 되었다 (완료 기준은 404). 그래서 `generateStaticParams`에 `top`을 넣고 페이지에서 `permanentRedirect("/champions")`를 부르도록 바꿨다. 빌드 표에 `● /champions/lane/top`이 보여 lane 경로가 **4개가 아니라 5개**로 나온다 (top은 HTML 대신 308 응답으로 저장). 동작은 계획과 같다.
2. **빌드 경고 줄 수**: 계획은 "경고 1줄(실패 수 합계)"이지만 정적 생성은 작업 프로세스 7개가 따로 돌아 합계를 모을 방법이 없다. 프로세스마다 첫 실패 1번만 경고해 **7줄**이 나온다.
3. **퍼센트 반올림**: `toFixed(1)`만 쓰면 이진 소수 오차로 `2.15 → "2.1"`처럼 내림이 되어 API 값과 비교할 때 262행 중 40행이 0.1 차이가 났다. 소수 2자리 값을 1/100 정수로 맞춘 뒤 반올림하도록 고쳐 불일치 0이 되었다.
4. **2순위 탭 제외 조건**: 계획은 2순위가 `STATS_NOT_FOUND`일 때 탭을 뺀다. 2순위만 `STATS_NOT_READY`이거나 빌드 중 연결 실패인 경우도 같이 뺀다 (서비스 중 연결 실패는 오류를 던짐).
5. **제목 구조**: 빌드 영역을 `h2` "포지션별 통계와 추천 빌드" 아래에 두고 카드 제목을 `h3`로 했다. 탭이 1개일 때 "탑" 제목은 제목 단계를 건너뛰지 않도록 일반 글자(`p`)로 했다.
6. `transform.ts`의 `CHAMPION_TAGS`는 더 이상 쓰는 곳이 없지만 요청 범위 밖이라 그대로 두었다 (`TAG_LABELS`는 Hero에서 계속 사용).

### 01-B9. 계약 변경 요청

- **없음.** 계약 v2로 모든 화면을 만들었다. 계획서 01-5의 참고 1·2(2-4 아이템 거르기 문구, 예시의 신발)만 그대로 유효하다 (API 응답 영향 없음).

### 01-B10. 남은 문제 (Review 확인 필요)

1. **브라우저 확인 안 함**: 탭 클릭·화살표 이동, 룬 1/2순위 전환, 검색 입력, 콘솔·수화 경고, 360/768/1280px 가로 스크롤, 대비 측정은 HTML 수준까지만 확인했다. Review가 브라우저로 확인한다.
2. **Lighthouse 미측정** (지시대로 Review가 career_log 11번과 같은 조건으로 측정).
3. **정적 HTML의 첫 내용**: v1부터 있는 `loading.tsx` 때문에 정적 HTML의 `<main>`에 먼저 스켈레톤이 있고 실제 내용은 같은 HTML 뒤쪽에 숨은 블록으로 들어 있다가 스크립트로 바뀐다 (Next 스트리밍 방식). 기능 문제는 아니지만 LCP 요소·측정값에 영향이 있을 수 있어 Review가 Lighthouse 때 함께 본다.
4. **서비스 중 API 다운 시 직전 페이지 유지**: 오류를 던지는 코드는 확인했지만(가짜 API 500), "재검증 시간이 지난 뒤에도 직전 정상 페이지가 계속 보이는지"는 `revalidate`를 줄인 복사본이 필요해 Review에 남긴다.
5. 백엔드 없이 빌드한 페이지는 첫 재검증(최대 1시간) 전까지 "연결 실패" 안내가 보인다 (계획 01-2-5의 알려진 한계).

### 01-B11. 로컬에서 실행하는 방법 (사용자 명령)

```bash
# 1) 백엔드 읽기 API (루트 .env의 DATABASE_URL 사용, 기본 포트 4000)
cd backend && npm start

# 2) 프론트 (다른 터미널). 루트 .env의 API_BASE_URL을 next.config.ts가 읽는다
cd frontend
npm run dev                      # 개발 모드: http://localhost:3000
# 또는 운영 모드 (백엔드를 켠 상태에서 빌드해야 통계가 들어간다)
npm run build && npm start       # http://localhost:3000
```

- 백엔드를 끈 채 `npm run build`해도 빌드는 성공하고, 통계 자리에 "통계 서버에 연결하지 못했습니다"가 들어간다. 통계를 보려면 백엔드를 켜고 다시 빌드한다.
- 이전 빌드의 API 응답은 `.next/cache/fetch-cache`에 최대 1시간 남는다. 백엔드 없이 빌드하는 상황을 일부러 확인하려면 이 폴더를 지우고 빌드한다.

### 01-B12. Review 수정 (2026-10-15, Review 에이전트)

> 요약: Review가 실제 데이터와 브라우저에서 찾은 결함 4개를 고쳤다. 자세한 근거는 `front_review.md` "변경 01 검토" 3장.

| 기능 | 구현 내용 | 상태 |
|------|-----------|------|
| 아이템 거르기 ④ | 건메탈 군화 `3172`(3단계 신발, 태그에 `Boots` 없음)가 핵심 아이템으로 나오던 문제. `ItemInfo.builtFromBoots`(재료에 `Boots` 아이템) 추가, 규칙 ④를 "`Boots` 태그 또는 `builtFromBoots`"로. 야스오·요네·가렌·트린다미어·아크샨 미드 5곳이 바뀜 (`types.ts`, `api.ts`, `itemFilter.ts`) | ✅ |
| 리스트 로딩 CLS | 정적 HTML에서도 스켈레톤이 먼저 보였다가 표로 바뀌는데, 스켈레톤이 화면보다 짧아 푸터가 밀려 CLS 0.044. `champions/loading.tsx` 바깥에 `min-h-screen` → CLS 0 | ✅ |
| 360px 티어 표 | `sm` 미만에서만 순위·티어·승률·픽률 열 폭과 칸 여백 축소, 아이콘 간격 2px 축소. 잘리는 이름 20/69 → 1/69 (`TierTable.tsx`) | ✅ |
| [검색 지우기] 포커스 | 버튼이 사라지며 포커스가 `body`로 가던 문제. 지운 뒤 검색창으로 포커스 (`TierTable.tsx`) | ✅ |

- 수정 후 `npm run lint` 0, `npx tsc --noEmit` 0, `npm run build` 성공(183페이지, 경고 0), 번들 검사 0건.
- 남은 문제(미수정): 룬 1/2순위가 같은 조합인 챔피언 71/173명 (보조 룬 순서만 다름, 백엔드 집계 단위 — 계약 변경 후보), `CHAMPION_TAGS` 미사용 코드.

