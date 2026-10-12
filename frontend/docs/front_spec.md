# 프론트엔드 계획서 — 01 챔피언 화면

> 작성: Plan 에이전트 / 상태: **승인됨 (2026-10-12, 결정 사항 10개 모두 ★추천안)**
> 대상 작업: ① 공통 화면 구성 ② 챔피언 리스트 ③ 챔피언 상세 ④ 상세 안의 스킨 리스트

---

## 1. 범위

> **쉬운 요약**: 이번 단계는 Data Dragon 데이터만으로 "챔피언 목록 → 챔피언 상세(스킬·스킨)" 화면을 만든다. 백엔드, 티어 통계, 전적 검색은 하지 않는다.

### 이번 단계에서 하는 것
- `frontend/`에 Next.js(App Router) + TypeScript + Tailwind CSS 프로젝트 초기 세팅
- 공통 레이아웃: 헤더(로고, 내비게이션), 본문 컨테이너, 푸터(패치 버전, 라이엇 고지문)
- 챔피언 리스트: 전체 챔피언 아이콘 그리드, 이름 검색, 역할군(태그) 필터
- 챔피언 상세: 기본 정보(이름, 칭호, 역할군, 난이도), 패시브·스킬(Q/W/E/R), 스토리
- 스킨 리스트: 상세 페이지 안 섹션으로 스킨 그리드 + 선택한 스킨 크게 보기
- 로딩 / 빈 결과 / 오류(존재하지 않는 챔피언 포함) 상태 처리
- 모바일·데스크톱 반응형, 기본 접근성
- Data Dragon 호출 로직을 `src/lib/ddragon/`에 모음

### 이번 단계에서 하지 않는 것
- 백엔드(Express), DB(Supabase) 연동, 티어/승률/픽률 등 통계
- 소환사(전적) 검색, 아이템·룬·소환사 주문 화면
- 라이트 테마 및 테마 토글 (다크 테마 고정)
- 다국어 전환 (`ko_KR` 고정)
- 크로마 스킨 표시 (이미지가 없음 — 6장 참고)
- 상태관리/데이터 패칭 라이브러리, UI 컴포넌트 라이브러리, 테스트 프레임워크 도입

---

## 2. 초기 세팅

> **쉬운 요약**: `create-next-app` 기본 구성(Next.js + TS + Tailwind + ESLint)만 사용하고, 추가 의존성은 넣지 않는다.

### 생성 명령
`frontend/`에는 이미 `docs/`가 있다. `create-next-app`은 `docs` 폴더가 있는 디렉토리를 허용하므로 그대로 생성한다. (만약 충돌 오류가 나면 임시 폴더에 생성 후 파일을 `frontend/`로 옮기고, `docs/`는 건드리지 않는다.)

```bash
# 저장소 루트에서 실행
npx create-next-app@latest frontend \
  --ts --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-npm
# 대화형 질문이 추가로 나오면: Turbopack = Yes(기본값), React Compiler = No
```

- 확인 시점 최신 버전: `next` 16.4.0, `tailwindcss` 4.3.3, 로컬 Node v24.15.0
- Next.js 16 기준 주의점: 동적 라우트의 `params`는 `Promise`이므로 `await params`로 사용한다.

### 의존성과 목적
| 패키지 | 출처 | 목적 / 이유 |
|--------|------|-------------|
| `next`, `react`, `react-dom` | 기본 | App Router, Server Component, 정적 생성(SSG/ISR), `next/image` |
| `typescript`, `@types/*` | 기본 | Data Dragon 응답 타입 정의로 필드 오타·누락 방지 |
| `tailwindcss`, `@tailwindcss/postcss` | 기본 | 프로젝트 스택(CLAUDE.md 2장). 반응형·다크 스타일을 유틸리티 클래스로 작성 |
| `eslint`, `eslint-config-next` | 기본 | Review 단계의 린트 검증 |

- **추가 의존성 없음.** 검색·필터는 React state로 충분하고, 데이터는 Server Component의 `fetch` 캐싱으로 처리하므로 SWR/React Query, clsx, UI 라이브러리가 필요 없다.

### 설정 변경
- `next.config.ts`: `images.remotePatterns`에 `https://ddragon.leagueoflegends.com/cdn/**` 추가 (`next/image`로 외부 이미지 사용 허용)
- `src/app/globals.css`: 다크 색상 토큰(배경/표면/텍스트/포인트 색)을 CSS 변수 + Tailwind `@theme`으로 정의
- `src/app/layout.tsx`: `<html lang="ko">`, 기본 메타데이터(title 템플릿 `%s | Tier.GG`)
- 기본 템플릿의 샘플 콘텐츠·불필요한 public SVG는 제거

---

## 3. 디렉토리 구조

> **쉬운 요약**: 라우트는 `app/`, 화면 조각은 `components/`, Data Dragon 관련 코드는 전부 `lib/ddragon/`에 둔다.

```
frontend/
├── docs/                                  # 기존 문서 (수정 X, front_build/review만 추가)
├── next.config.ts                         # remotePatterns 설정
├── src/
│   ├── app/
│   │   ├── layout.tsx                     # 공통 레이아웃 (Header + main + Footer)
│   │   ├── globals.css                    # Tailwind + 다크 테마 토큰
│   │   ├── page.tsx                       # "/" → "/champions" 리다이렉트
│   │   ├── not-found.tsx                  # 전역 404
│   │   ├── error.tsx                      # 전역 오류 (client)
│   │   └── champions/
│   │       ├── page.tsx                   # 챔피언 리스트 (Server)
│   │       ├── loading.tsx                # 리스트 스켈레톤
│   │       ├── error.tsx                  # 리스트 오류 + 다시 시도 (client)
│   │       └── [championId]/
│   │           ├── page.tsx               # 챔피언 상세 (Server, generateStaticParams)
│   │           ├── loading.tsx            # 상세 스켈레톤
│   │           └── not-found.tsx          # 없는 챔피언 안내
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx                 # 로고 + 내비 (활성 메뉴 표시용 NavLink는 client)
│   │   │   ├── NavLink.tsx                # usePathname으로 aria-current 처리 (client)
│   │   │   └── Footer.tsx                 # 패치 버전, 라이엇 고지문
│   │   └── champions/
│   │       ├── ChampionBrowser.tsx        # 검색 + 태그 필터 + 그리드 (client)
│   │       ├── ChampionCard.tsx           # 아이콘 + 이름 링크
│   │       ├── ChampionHero.tsx           # 상세 상단: 스플래시 배경, 이름, 칭호, 태그, 난이도
│   │       ├── ChampionAbilities.tsx      # 패시브 + Q/W/E/R
│   │       ├── ChampionLore.tsx           # 스토리 (lore)
│   │       └── SkinGallery.tsx            # 스킨 그리드 + 선택 스킨 크게 보기 (client)
│   └── lib/
│       └── ddragon/
│           ├── constants.ts               # BASE_URL, LOCALE, REVALIDATE 값
│           ├── types.ts                   # 원본 응답 타입 + 화면용 가공 타입
│           ├── api.ts                     # getLatestVersion, getChampionList, getChampionDetail
│           ├── images.ts                  # 이미지 URL 생성 함수
│           └── transform.ts               # 응답 → 화면용 데이터 가공 (태그 한글화, HTML 태그 제거, 크로마 제외)
```

- `components/`는 Server Component가 기본이며, 상호작용이 필요한 `ChampionBrowser`, `SkinGallery`, `NavLink`, `error.tsx`만 `"use client"`.

---

## 4. 라우트 설계

> **쉬운 요약**: 데이터가 패치 단위로만 바뀌므로 모든 페이지를 미리 만들어 두고(정적 생성), 1시간마다 새 패치 여부를 확인해 갱신한다.

| URL | 파일 | 렌더링 | 이유 |
|-----|------|--------|------|
| `/` | `app/page.tsx` | `redirect('/champions')` | 이번 단계에는 홈 콘텐츠가 없음 |
| `/champions` | `app/champions/page.tsx` | SSG + ISR (`revalidate = 3600`) | 전 사용자 동일 데이터, 패치(약 2주) 단위 변경 → 정적이 가장 빠름 |
| `/champions/[championId]` | `app/champions/[championId]/page.tsx` | `generateStaticParams`로 전 챔피언(현재 173개) 빌드 시 생성 + ISR (`revalidate = 3600`) | 상세도 정적 데이터. 미리 생성하면 첫 방문도 즉시 표시 |

### 세부 규칙
- **`[championId]`**: `champion.json`의 영문 `id` 그대로 사용 (예: `/champions/Aatrox`, `/champions/MonkeyKing`). Data Dragon URL이 대소문자를 구분하므로(`aatrox.json` → 403) 변환 없이 쓰는 것이 가장 안전하다. → 결정 사항 1 참고
- **`dynamicParams`**: 기본값(`true`) 유지. 새 패치로 추가된 챔피언도 재빌드 없이 첫 요청 때 생성되도록 한다.
- **없는 챔피언 판별**: Data Dragon은 없는 챔피언 요청 시 404가 아니라 **403**을 반환한다. 따라서 상세 페이지는 먼저 `champion.json` 목록에 `id`가 있는지 확인하고, 없으면 `notFound()`를 호출한다.
- **캐싱**:
  - `versions.json` → `fetch(..., { next: { revalidate: 3600 } })` (새 패치 감지)
  - 버전이 URL에 포함된 `champion.json`, `champion/{id}.json` → `{ cache: 'force-cache' }` (버전별로 내용 불변)
  - `champion.json`은 약 214KB로 Next 데이터 캐시 한도(2MB) 이내
- **메타데이터**: 상세 페이지는 `generateMetadata`로 `"{한글 이름} - {칭호}"` 제목 설정.

---

## 5. 화면 구성

> **쉬운 요약**: 상단 헤더 아래에 리스트(아이콘 격자) 또는 상세(큰 배경 이미지 + 스킬 + 스킨) 화면이 들어간다.

### 5-1. 공통 레이아웃
> **쉬운 요약**: 모든 페이지에 같은 헤더와 푸터, 가운데 정렬된 본문 폭을 적용한다.

```
┌──────────────────────────────────────────────┐
│ [Tier.GG]   챔피언                            │  ← Header (sticky, 높이 56px)
├──────────────────────────────────────────────┤
│                                              │
│          main (max-w-6xl, 좌우 padding)        │
│                                              │
├──────────────────────────────────────────────┤
│ 패치 16.20.1 · 데이터: Riot Data Dragon        │  ← Footer
│ Tier.GG는 Riot Games의 보증을 받지 않았으며…     │
└──────────────────────────────────────────────┘
```
- 헤더: 로고(`/` 링크), 내비 메뉴 "챔피언"(`/champions`, 현재 경로면 강조 + `aria-current="page"`). 이번 단계엔 메뉴 1개이며, 이후 메뉴는 추가만 하면 되는 구조로 둔다.
- 본문 첫 요소로 "본문으로 건너뛰기" 링크 (키보드 사용자용, 포커스 시에만 노출)
- 푸터: 현재 패치 버전(`getLatestVersion()`), 라이엇 법적 고지문 1줄
- 다크 테마 고정: 배경 짙은 남색/회색 계열, 포인트 색 1개(예: 청록 또는 골드). 구체 색상값은 Build 에이전트가 정하되 텍스트 대비 4.5:1 이상.

### 5-2. 챔피언 리스트 (`/champions`)
> **쉬운 요약**: 챔피언 아이콘을 격자로 보여주고, 이름 검색과 역할군 버튼으로 걸러 볼 수 있다. 아이콘을 누르면 상세로 이동한다.

```
챔피언 (173)
[🔍 챔피언 이름 검색 (한글/영문)      ]
[전체] [전사] [탱커] [마법사] [암살자] [원거리] [서포터]

┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐
│ img││ img││ img││ img││ img││ img││ img││ img│
│가렌 ││갈리오││갱플랭크││그라가스│ ...
└────┘└────┘└────┘└────┘└────┘└────┘└────┘└────┘
```
- 표시 정보: 스퀘어 이미지, 한글 이름. (카드 `title`/툴팁 불필요)
- 정렬: 한글 이름 가나다순 (`localeCompare('ko')`)
- 검색: 한글 이름 또는 영문 id 부분 일치, 대소문자·공백 무시. 입력 즉시 필터(디바운스 불필요, 173개).
- 역할군 필터: 단일 선택 토글 버튼. `tags` 배열에 포함되면 표시 (챔피언은 태그가 여러 개일 수 있음).
- 검색 + 필터는 AND 조건. 결과 개수 표시 (`챔피언 (n)`).
- 카드 전체가 `<Link href="/champions/{id}">`.
- 데이터 흐름: `page.tsx`(Server)에서 가공된 `ChampionSummary[]`를 받아 `ChampionBrowser`(client)에 props로 전달.
- 필터 상태는 컴포넌트 state로만 관리(URL 쿼리 동기화 안 함). → 결정 사항 6 참고

### 5-3. 챔피언 상세 (`/champions/[championId]`)
> **쉬운 요약**: 위쪽에 큰 스플래시 이미지와 이름·역할군·난이도를, 아래로 스킬, 스킨, 스토리를 차례로 보여준다.

```
← 챔피언 목록
┌──────────────────────────────────────────────┐
│ (기본 스킨 스플래시 배경, 하단 어두운 그라데이션)   │
│ [아이콘] 아트록스                               │
│          다르킨의 검                            │
│          [전사]  난이도 ●●●●○○○○○○ (4/10)        │
└──────────────────────────────────────────────┘

스킬
[P] 사신 태세      설명...
[Q] 다르킨의 검    재사용 대기시간 14/12/10/8/6초 · 설명...
[W] 지옥사슬       ...
[E] 파멸의 돌진    ...
[R] 세계의 종결자  ...

스킨 (13)          ← 5-4
...

스토리
한때는 공허에 맞서 싸웠던 ...
```
- 상단(Hero): 기본 스킨(`num 0`) 스플래시, 스퀘어 아이콘, 이름(`h1`), 칭호, 역할군 배지(한글), 난이도(`info.difficulty`, 0~10) 막대
- "← 챔피언 목록" 링크
- 스킬: 패시브 + Q/W/E/R (`spells` 배열 순서 = Q,W,E,R). 각 항목에 아이콘, 키 라벨, 이름, 설명, 재사용 대기시간(`cooldownBurn`, 패시브 제외)
  - 설명은 `description` 사용(`tooltip`은 `{{ }}` 변수가 남아 있어 사용하지 않음). `<br>`는 줄바꿈으로, 그 외 HTML 태그는 제거한 순수 텍스트로 렌더링 (`dangerouslySetInnerHTML` 사용 안 함)
- 스토리: `lore` 텍스트
- 표시하지 않는 것: `stats`(기본 능력치), `allytips/enemytips`, `recommended` → 결정 사항 5 참고

### 5-4. 스킨 리스트 (상세 페이지 안 섹션)
> **쉬운 요약**: 스킨들을 세로형 카드 격자로 보여주고, 하나를 누르면 위쪽 큰 미리보기가 그 스킨의 스플래시로 바뀐다.

```
스킨 (13)
┌──────────────────────────────────────────────┐
│     선택한 스킨 스플래시 (16:9 크게)              │
│     "정의의 아트록스"                            │
└──────────────────────────────────────────────┘
┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐
│로딩││로딩││로딩││로딩││로딩││로딩│   ← 로딩 화면 이미지(세로형)
│이미││이미││    ││    ││    ││    │
│지  ││지  ││    ││    ││    ││    │
└───┘└───┘└───┘└───┘└───┘└───┘
 기본   정의의  메카 ...
```
- 대상: `skins` 중 `parentSkin` 필드가 **없는** 항목만 (크로마 제외. 크로마는 스플래시·로딩 이미지가 403)
- 이름: `num 0`의 `name`이 `"default"`이므로 `"기본"`으로 표시
- 그리드 카드: 로딩 이미지(`loading/{id}_{num}.jpg`, 308×560 세로형) + 스킨 이름
- 카드 클릭(또는 Enter/Space) 시 상단 미리보기를 해당 스플래시(`splash/{id}_{num}.jpg`)로 교체. 기본 선택은 `num 0`.
- 카드는 `<button aria-pressed>`로 구현, 선택된 카드는 테두리 강조.
- 이미지 로드 실패 시 회색 플레이스홀더 + 이름만 표시 (`onError`).
- 모달/라이트박스는 이번 단계에서 만들지 않음 → 결정 사항 3 참고

---

## 6. 데이터

> **쉬운 요약**: 최신 버전 → 챔피언 목록 → 챔피언 상세 순으로 Data Dragon을 호출하고, 화면에 필요한 필드만 골라 타입이 있는 객체로 바꾼다.

### 6-1. 사용할 URL (`api.md` 기준)
| 용도 | URL | 캐싱 |
|------|-----|------|
| 최신 버전 | `/api/versions.json` → `[0]` | revalidate 3600 |
| 챔피언 목록 | `/cdn/{version}/data/ko_KR/champion.json` | force-cache |
| 챔피언 상세 | `/cdn/{version}/data/ko_KR/champion/{id}.json` | force-cache |
| 스퀘어 이미지 | `/cdn/{version}/img/champion/{image.full}` | next/image |
| 스플래시 | `/cdn/img/champion/splash/{id}_{num}.jpg` (버전 없음) | next/image |
| 로딩 이미지 | `/cdn/img/champion/loading/{id}_{num}.jpg` (버전 없음) | next/image |
| 스킬 이미지 | `/cdn/{version}/img/spell/{spell.image.full}` | next/image |
| 패시브 이미지 | `/cdn/{version}/img/passive/{passive.image.full}` | next/image |

- 기본 URL `https://ddragon.leagueoflegends.com`, 로케일 `ko_KR` (constants.ts)
- 실제 확인 결과(2026-10-12): 최신 버전 `16.20.1`, 챔피언 173개
- 스킬 이미지 파일명은 `spell.id`와 다를 수 있으므로(예: 오공 Q `MonkeyKingDoubleAttack.png`) 반드시 `image.full`을 사용

### 6-2. 원본 응답 타입 (types.ts, 사용하는 필드만)
```ts
type DDragonImage = { full: string };

type DDragonChampionListResponse = {
  version: string;
  data: Record<string, DDragonChampionSummary>;
};
type DDragonChampionSummary = {
  id: string;        // "Aatrox" (URL·이미지용)
  key: string;       // "266" (이번 단계 미사용, 이후 매치 데이터 매핑용)
  name: string;      // "아트록스"
  title: string;     // "다르킨의 검"
  tags: ChampionTag[];
  info: { attack: number; defense: number; magic: number; difficulty: number };
  image: DDragonImage;
};

type DDragonChampionDetailResponse = {
  version: string;
  data: Record<string, DDragonChampionDetail>;  // 키 = id 1개
};
type DDragonChampionDetail = DDragonChampionSummary & {
  lore: string;
  skins: { id: string; num: number; name: string; chromas: boolean; parentSkin?: number }[];
  passive: { name: string; description: string; image: DDragonImage };
  spells: { id: string; name: string; description: string; cooldownBurn: string; image: DDragonImage }[];
};

type ChampionTag = 'Fighter' | 'Tank' | 'Mage' | 'Assassin' | 'Marksman' | 'Support';
```

### 6-3. 화면용 가공 타입과 가공 규칙 (transform.ts)
```ts
type ChampionSummary = {
  id: string; name: string; title: string;
  tags: ChampionTag[];
  iconUrl: string;
};

type ChampionAbility = {
  key: 'P' | 'Q' | 'W' | 'E' | 'R';
  name: string;
  description: string;   // HTML 제거된 텍스트
  cooldown?: string;     // "14/12/10/8/6" (패시브는 없음)
  iconUrl: string;
};

type ChampionSkin = {
  num: number;
  name: string;          // "default" → "기본"
  splashUrl: string;
  loadingUrl: string;
};

type ChampionDetail = ChampionSummary & {
  difficulty: number;    // 0~10
  lore: string;
  abilities: ChampionAbility[];  // [P, Q, W, E, R]
  skins: ChampionSkin[];         // parentSkin 없는 것만, num 오름차순
};
```
- 태그 한글 매핑: `Fighter 전사 / Tank 탱커 / Mage 마법사 / Assassin 암살자 / Marksman 원거리 / Support 서포터`
- 목록 정렬: `name.localeCompare(b.name, 'ko')`
- HTML 제거: `<br>`·`<br />` → `\n`, 나머지 `<...>` 제거, 연속 공백 정리 (화면은 `whitespace-pre-line`)

### 6-4. api.ts 함수
| 함수 | 반환 | 비고 |
|------|------|------|
| `getLatestVersion()` | `string` | 실패 시 throw → error.tsx |
| `getChampionList()` | `ChampionSummary[]` | 내부에서 버전 조회 |
| `getChampionDetail(id)` | `ChampionDetail \| null` | 목록에 `id`가 없으면 `null` (페이지에서 `notFound()`) |

- 모든 fetch는 `res.ok`가 아니면 에러를 던진다(상세의 403도 목록 확인 이후라면 "오류"로 취급).
- 같은 요청 내 중복 호출은 Next의 fetch 메모이제이션으로 1회만 실행되므로 레이아웃(푸터)과 페이지가 각각 `getLatestVersion()`을 호출해도 된다.

---

## 7. 상태 처리

> **쉬운 요약**: 불러오는 중에는 뼈대(스켈레톤)를, 검색 결과가 없으면 안내 문구를, 없는 챔피언이나 네트워크 오류에는 안내 페이지와 이동 버튼을 보여준다.

| 상황 | 처리 | 파일 |
|------|------|------|
| 리스트 로딩 | 검색창 + 회색 아이콘 칸 스켈레톤 | `champions/loading.tsx` |
| 상세 로딩 | Hero 영역 + 스킬 줄 스켈레톤 | `[championId]/loading.tsx` |
| 검색/필터 결과 없음 | "'{검색어}'에 해당하는 챔피언이 없습니다" + [필터 초기화] 버튼 | `ChampionBrowser` |
| 존재하지 않는 챔피언 (`/champions/Foo`) | 404 상태 + "챔피언을 찾을 수 없습니다" + [챔피언 목록으로] 링크 | `[championId]/not-found.tsx` |
| 그 외 없는 URL | 전역 404 + 홈 링크 | `app/not-found.tsx` |
| Data Dragon 호출 실패 | "데이터를 불러오지 못했습니다" + [다시 시도](`reset()`) + 목록 링크 | `champions/error.tsx`, `app/error.tsx` |
| 개별 이미지 실패 | 회색 플레이스홀더 (레이아웃 깨짐 없도록 고정 비율) | `SkinGallery` 등 |

- 페이지가 정적으로 생성되므로 로딩 화면은 ISR 최초 생성/개발 모드에서 주로 보인다. 그래도 파일은 둔다.

---

## 8. 반응형과 접근성

> **쉬운 요약**: 휴대폰에서도 가로 스크롤 없이 보이도록 열 개수만 바꾸고, 키보드·스크린리더로도 모든 기능을 쓸 수 있게 한다.

### 반응형 (Tailwind 기본 breakpoint)
| 요소 | 모바일(<640) | sm(≥640) | md(≥768) | lg(≥1024) |
|------|------|------|------|------|
| 챔피언 그리드 | 4열 | 6열 | 8열 | 10열 |
| 역할군 필터 | 가로 스크롤 가능한 한 줄 | 줄바꿈 | ← | ← |
| 상세 Hero | 스플래시 위, 정보 아래 세로 배치 | ← | 스플래시 배경 위 정보 오버레이 | ← |
| 스킬 목록 | 1열 | 1열 | 1열 | 1열(아이콘 좌, 텍스트 우) |
| 스킨 그리드 | 3열 | 4열 | 5열 | 6열 |

- 최소 지원 폭 360px, 페이지 가로 스크롤 없음
- 이미지는 `next/image` + `sizes` 지정, 고정 비율 컨테이너로 레이아웃 이동(CLS) 방지. 상세 Hero 스플래시만 `priority`.

### 접근성 기준
- `<html lang="ko">`, 페이지당 `h1` 1개, 제목 순서(h1→h2) 유지
- 모든 이미지 `alt`: 챔피언 아이콘 = 챔피언 이름, 스킬 = 스킬 이름, 스킨 = 스킨 이름, 장식용 배경은 `alt=""`
- 검색 입력에 `<label>`(시각적으로 숨김 가능), 결과 개수는 `aria-live="polite"`로 알림
- 필터·스킨 선택 버튼은 `<button>` + `aria-pressed`
- 모든 상호작용 요소 키보드 조작 가능, `focus-visible` 링 표시
- 텍스트 대비 4.5:1 이상 (다크 배경 기준)
- 헤더 현재 메뉴 `aria-current="page"`, "본문으로 건너뛰기" 링크

---

## 9. 완료 기준 (Review 체크리스트)

> **쉬운 요약**: Review 에이전트가 아래 항목을 하나씩 확인해 모두 통과하면 이번 단계 완료다.

### 세팅·검증
- [ ] `frontend/`에 Next.js(App Router) + TS + Tailwind 프로젝트가 있고 `frontend/docs/`가 보존됨
- [ ] 추가 의존성 없음 (`package.json`이 create-next-app 기본 구성)
- [ ] `npm run lint` 오류 0
- [ ] `npx tsc --noEmit` 오류 0
- [ ] `npm run build` 성공, `/champions/[championId]`가 SSG(●)로 전 챔피언 생성됨
- [ ] Data Dragon 호출 코드가 `src/lib/ddragon/` 밖에 없음, `any` 타입 미사용

### 공통 레이아웃
- [ ] 모든 페이지에 헤더(로고, "챔피언" 메뉴)와 푸터(패치 버전, 고지문) 표시
- [ ] `/` 접속 시 `/champions`로 이동
- [ ] 현재 메뉴 강조 및 `aria-current="page"`

### 챔피언 리스트
- [ ] 최신 버전 기준 전체 챔피언(현재 173개)이 가나다순으로 표시
- [ ] "아트", "aatrox", "AATROX" 검색 시 아트록스 표시
- [ ] 역할군 필터 동작, 검색과 함께 AND 적용, 결과 개수 갱신
- [ ] 결과 없음 문구 + 초기화 버튼 동작
- [ ] 카드 클릭 시 `/champions/{id}`로 이동

### 챔피언 상세
- [ ] `/champions/Aatrox`: 이름 "아트록스", 칭호 "다르킨의 검", 역할군 "전사", 난이도 표시
- [ ] 패시브 + Q/W/E/R 5개 아이콘·이름·설명 표시, 설명에 HTML 태그나 `{{ }}`가 보이지 않음
- [ ] `/champions/MonkeyKing`(오공) 스킬 아이콘이 모두 정상 로드
- [ ] 스토리 표시, 탭 제목이 "아트록스 - 다르킨의 검 | Tier.GG"
- [ ] `/champions/Foo` → 404 상태 코드 + 안내 + 목록 링크

### 스킨 리스트
- [ ] 크로마(`parentSkin` 있는 스킨) 제외, 깨진 이미지 없음 (아트록스 기준 13개, 16.20.1)
- [ ] 첫 스킨 이름이 "기본"으로 표시
- [ ] 스킨 클릭/키보드 선택 시 상단 미리보기가 해당 스플래시로 변경, 선택 표시(`aria-pressed`)

### 상태·반응형·접근성
- [ ] 로딩 스켈레톤, 오류 화면(다시 시도) 파일 존재 및 동작
- [ ] 360px / 768px / 1280px에서 가로 스크롤 없고 그리드 열 수가 8장 표와 일치
- [ ] 키보드(Tab/Enter/Space)만으로 검색·필터·상세 이동·스킨 선택 가능, 포커스 링 보임
- [ ] 모든 의미 있는 이미지에 `alt`, 콘솔 에러/경고(이미지 403, hydration 등) 없음

---

## 10. 결정이 필요한 사항

> **쉬운 요약**: 아래 항목은 사용자가 정해 주면 좋다. 별도 지시가 없으면 ★추천안으로 진행한다.

| # | 항목 | 선택지 | 추천 |
|---|------|--------|------|
| 1 | 상세 URL 형식 | A. 영문 id 그대로 `/champions/MonkeyKing` / B. 소문자 `/champions/monkeyking` (내부 매핑 필요) / C. 숫자 key `/champions/62` | ★A — Data Dragon과 1:1, 변환 코드·버그 없음 |
| 2 | 스킨 리스트 위치 | A. 상세 페이지 안 섹션 / B. 상세 내 탭(스킬·스킨·스토리) / C. 별도 URL `/champions/[id]/skins` | ★A — 요구사항("상세 안의 스킨 리스트")에 가장 직접적, 구현 단순 |
| 3 | 스킨 크게 보기 방식 | A. 상단 미리보기 영역 교체 / B. 클릭 시 모달(라이트박스) / C. 그리드만 | ★A — 모달의 포커스 트랩·ESC 처리 없이 접근성 확보가 쉬움 |
| 4 | 크로마 스킨 | A. 제외 / B. 부모 스킨 아래 이름만 표시 | ★A — Data Dragon에 크로마 이미지가 없음(403) |
| 5 | 상세 정보 표시 범위 | A. 기본정보 + 스킬 + 스킨 + 스토리 / B. A + 기본 능력치(stats) 표 / C. B + 플레이 팁(allytips/enemytips) | ★A — 이번 범위에 충분, 능력치·팁은 이후 통계 화면과 함께 검토 |
| 6 | 리스트 검색·필터 상태 | A. 컴포넌트 state만 / B. URL 쿼리(`?q=&tag=`) 동기화 | ★A — 단순. 뒤로가기 시 필터 유지가 필요하면 B |
| 7 | 초성 검색(예: "ㅇㅌㄹㅅ") | A. 이번엔 제외 / B. 포함 | ★A — 범위 최소화, 이후 추가 쉬움 |
| 8 | 이미지 최적화 | A. `next/image` 최적화 사용 / B. `next/image` + `unoptimized`(원본 그대로) | ★A — 스플래시(약 200KB)를 기기 크기에 맞게 줄여 모바일 성능 향상. 배포(Vercel 등) 시 이미지 최적화 사용량 한도가 걱정되면 B |
| 9 | `/` 홈 | A. `/champions`로 리다이렉트 / B. 간단한 랜딩 페이지 | ★A — 이번 단계엔 보여줄 홈 콘텐츠 없음 |
| 10 | 테마 | A. 다크 고정 / B. 다크 기본 + 라이트 토글 | ★A — 지침의 "다크 테마 기본" 충족, 토글은 이후 |

---

## 11. 작업 범위 (단계별 수정 가능한 경로)

> **쉬운 요약**: 각 서브에이전트가 고칠 수 있는 파일을 정한다. 이 밖의 수정이 필요하면 메인 에이전트에게 보고한다.

| 단계 | 수정 가능 | 수정 금지 |
|------|-----------|-----------|
| Plan | `frontend/docs/front_spec.md` | 그 외 전부 |
| Build | `frontend/` 아래 프로젝트 파일 (create-next-app 생성물, `src/`, `public/`, 설정 파일), `frontend/docs/front_build.md` | `frontend/docs/front_spec.md`, `frontend/docs/front_review.md`, `frontend/` 밖 전부 |
| Review | `frontend/docs/front_review.md`, 검토 중 수정한 코드(`frontend/src/` 등)와 `frontend/docs/front_build.md`의 해당 기능 기록 | `frontend/docs/front_spec.md`, `frontend/` 밖 전부 |

- 저장소 루트의 `CLAUDE.md`, `api.md`, `backend/`, `airflow/`는 이번 작업에서 수정하지 않는다.
