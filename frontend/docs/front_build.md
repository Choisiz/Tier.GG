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
