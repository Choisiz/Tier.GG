# 프론트엔드 계획서 — 01 챔피언 화면

> 작성: Plan 에이전트 / 상태: **승인됨 (2026-10-12, 결정 사항 10개 모두 ★추천안)**
> 대상 작업: ① 공통 화면 구성 ② 챔피언 리스트 ③ 챔피언 상세 ④ 상세 안의 스킨 리스트
>
> **변경 01 (2026-10-15, 승인됨)**: 백엔드 API v2 연결 — 포지션 탭·티어 정렬·추천 빌드(아이템·룬·주문·스킬)·통계 기간 표시. 문서 맨 아래 "변경 01" 참고. 1~11장(v1)은 기록으로 그대로 둔다.

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

---

## 변경 01 (2026-10-15): 백엔드 API 연결 (포지션·티어·추천 빌드)

> 작성: Plan 에이전트 / 상태: **승인됨 (2026-10-15, D1~D9 추천안)**
> 기준: `docs/contracts/api_contract.md` **v2 (승인됨)**, `api.md`(Data Dragon), v1 기록(`front_build.md`, `front_review.md`), `docs/career_log.md` 11번(Lighthouse 기준값)
> 요약: 챔피언 리스트를 "포지션 탭 + 티어 순 표"로 바꾸고, 상세에 포지션 탭과 추천 빌드(아이템·룬·소환사 주문·스킬)를 붙인다. 모든 통계 화면에 "최근 14일 · 패치 구성 · 집계 시각 · 지연 여부"를 보여준다. 기본 정보·스킬·스킨·스토리는 그대로 둔다.

### 01-0. 계획 전 확인한 사실

> 요약: 실제 API와 Data Dragon을 직접 불러 응답 모양과 숫자를 확인했다. 계획의 규칙은 이 결과를 근거로 정했다.

확인 시각: 2026-10-15 03:59 KST. 백엔드를 `npm start`로 잠시 띄워 GET만 호출하고 종료했다. DB·코드는 건드리지 않았다.

| 항목 | 결과 |
|------|------|
| `/health` | `stats.state = fresh`, `aggregatedAt 2026-10-14T18:52:26Z` (= 10월 15일 03:52 KST) |
| `/meta` `window` | 14일, **3,952게임**, `26.20` 66.8% (2,640) / `26.19` 33.2% (1,312), `isStale false` |
| 포지션별 목록 수 (티어 있음) | 탑 69 (47) · 정글 53 (41) · 미드 63 (42) · 원딜 26 (24) · 서폿 51 (32). 나머지는 `tier: null` |
| 목록에 나온 챔피언 | 5개 포지션 합쳐 **173명** (Data Dragon 173명과 같음). 주 포지션 2개인 챔피언 89명 |
| 상세 (173명 전부 호출) | 모두 200. `runes`·`spells`·`skills` 빈 배열 0건. 챔피언 pick 최소 18 / 중앙 143 / 최대 941 |
| 상세 `builds.items` | 아트록스 57개 (재료·소모품 포함, 계약대로 전체). 전체 고유 아이템 215개, **16.20.1 `item.json`에 없는 아이템 0개** |
| 오류 | `?position=top`(소문자) → `400 INVALID_PARAMETER`, `/champions/999` → `404 STATS_NOT_FOUND`, `/champions/abc` → 400. 성공 `Cache-Control: public, max-age=600`, 오류 `no-store` |
| 능력치 파편 | 실제 값 `5001 5005 5007 5008 5010 5011`. 이미지 `/cdn/img/perk-images/StatMods/StatMods*Icon.png` 7개 모두 200 |
| Data Dragon | 최신 `16.20.1`. `item.json` 약 733KB (Next 데이터 캐시 한도 2MB 이내), `summoner.json` 36KB, `runesReforged.json` 41KB |

**아이템 거르기에서 발견한 점 (계약 문구만 따르면 틀리는 경우):**

| 아이템 | Data Dragon | 계약 문구("`into` 있으면 뺀다")만 쓰면 |
|--------|-------------|------------------------------|
| 판금 장화 `3047` (아트록스 70%) | `into: [3174]` (3단계 신발로 업그레이드), 태그 `Boots` | **빠진다** (가장 많이 산 신발이 사라짐) |
| 도란의 방패 `1054`, 정글 펫 `1101~1103`, 서폿 시작템 `3865/3866` | `into` 없음, `from` 없음, 400~450골드 | **남는다** (시작 아이템이 "추천 완성 아이템"에 섞임) |
| 무라마나 `3042`, 대천사의 포옹 `3040`, 종말의 겨울 `3121`, 악곡의 왕관 `2530` | `into`·`from` 없음, 2,250~2,900골드, `inStore false` (변신 아이템) | 남는다 (맞음 — 완성 아이템) |
| 제어 와드 `2055`, 충전형 물약 `2031`, 장신구 `3340/3364` | 태그 `Consumable` / `Trinket` | 태그로 빼야 한다 |
| 징크스 신발 | 상세 아이템에 신발이 1개뿐(`탐욕의 군화` 0.16%) | 의미 없는 신발이 "추천"으로 나올 수 있음 |

→ 01-1-4의 아이템 규칙(결정 D3)으로 해결한다. 이 규칙으로 173명 모두 핵심 아이템 3개 이상이 나왔다 (예: 아트록스 쇼진의 창·월식·갈라진 하늘 + 판금 장화, 쓰레쉬 솔라리·태양의 썰매·기사의 맹세 + 신속의 장화).

---

### 01-1. 기능

> 요약: 리스트는 "포지션 탭 → 티어 순 표", 상세는 "포지션 탭 → 통계 요약 + 추천 빌드"다. 통계를 못 받아도 Data Dragon 부분은 항상 보인다.

#### 01-1-1. 공통: 통계 기간 표시 (`WindowInfo`)

> 요약: 통계가 있는 화면 위쪽에 "어느 기간, 몇 게임, 어떤 패치, 언제 집계"인지 한 줄로 보여준다.

```
최근 14일 · 3,952게임 · 26.20 67% / 26.19 33% · 10월 15일 03:52 집계
```

| 상황 | 표시 |
|------|------|
| 정상 | 위 한 줄 (작은 회색 글씨). 패치는 `window.patches[]` 순서(최신 먼저), `displayName` + `share` 정수 반올림 |
| 패치 1개 | `26.20 100%` 대신 `패치 26.20`만 |
| `isStale: true` | 위 줄 + 노란 안내 상자 "통계 갱신이 지연되고 있습니다 (마지막 집계 10월 15일 03:52)". 숫자는 그대로 보여준다. `role="status"` |
| 시각 | `aggregatedAt`을 **KST로 고정**해 `M월 D일 HH:mm` (`Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul' })`). 서버 컴포넌트에서 만들어 수화(hydration) 불일치 없음 |

- 화면에 패치를 적을 때는 `displayName`만 쓴다. 내부 값 `16.20`이나 Data Dragon 버전 `16.20.1`은 보여주지 않는다 (계약 1장·5장).
- `share` 반올림 합이 99/101%가 될 수 있다. 그대로 둔다 (계약 2-0).

#### 01-1-2. 챔피언 리스트 (`/champions`, `/champions/lane/[position]`)

> 요약: 포지션 탭 5개 중 하나를 고르면 그 포지션 챔피언을 티어 → 점수 순 표로 보여준다. 탭마다 주소가 따로 있고 모두 미리 만들어 둔다.

화면 예 (숫자는 예시):

```
챔피언 티어
최근 14일 · 3,952게임 · 26.20 67% / 26.19 33% · 10월 15일 03:52 집계

[탑] [정글] [미드] [원딜] [서폿]            ← 포지션 탭 (링크)
[🔍 챔피언 이름 검색 (한글/영문)        ]

 #  챔피언              티어     승률    픽률    밴률   게임
 1  [img] 다리우스       1티어   53.1%   8.2%   9.0%   325
 2  [img] 아트록스       2티어   52.8%   7.3%   3.8%   290
 …
48  [img] 퀸            표본 부족 55.3%   1.5%   2.4%    38
```

**포지션 탭과 URL (결정 D1)**

| 탭 | 표시 | URL | API |
|----|------|-----|-----|
| 탑 | 탑 | `/champions` (기본) | `position=TOP` |
| 정글 | 정글 | `/champions/lane/jungle` | `JUNGLE` |
| 미드 | 미드 | `/champions/lane/middle` | `MIDDLE` |
| 원딜 | 원딜 | `/champions/lane/bottom` | `BOTTOM` |
| 서폿 | 서폿 | `/champions/lane/utility` | `UTILITY` |

- 주소 조각은 API 값의 **소문자 그대로** (변환 표 1개, v1 결정 1과 같은 "1:1" 원칙).
- `/champions/lane/top`은 `/champions`로 영구 이동(308)해 같은 내용이 두 주소에 있지 않게 한다.
- `lane/[position]`은 `generateStaticParams`로 4개를 만들고 `dynamicParams = false` → 다른 값(`/champions/lane/TOP`, `/champions/lane/mid`)은 바로 404. 캐시 파일을 새로 만들지 않으므로 macOS 대소문자 문제(v1 build 9-5)가 생기지 않는다.
- `lane`은 고정 폴더라 `[championId]`보다 먼저 맞춰진다. 영문 챔피언 id에 `lane`은 없다.
- 탭은 `<nav aria-label="포지션">` 안의 `<Link>`이고 현재 탭은 `aria-current="page"` + 강조. 페이지 이동이지만 미리 만든 정적 페이지라 빠르다 (Link 미리 가져오기).

**표**

| 열 | 값 | 모바일(<640) |
|----|----|------|
| `#` | `rank` | 보임 |
| 챔피언 | 아이콘 + 한글 이름 (행 전체가 상세 링크) | 보임 |
| 티어 | `tier` 1~5 → "1티어"~"5티어" 배지(글자 + 색). `null` → 회색 "표본 부족" | 보임 |
| 승률 / 픽률 | `winRate`, `pickRate` (소수 1자리 %) | 보임 |
| 밴률 / 게임 | `banRate`, `pick` | 숨김 (`sm` 이상) |
| 주 포지션 | `mainPositions`가 2개면 다른 포지션을 작은 글씨로 (예: "미드 겸용") | 숨김 (`md` 이상) |

- **정렬:** API 순서(`rank`) 그대로. 프론트는 다시 정렬하지 않고, `tier`를 `tierScore`로 다시 계산하지 않는다 (계약 2-3).
- **검색:** 현재 탭 안에서 한글 이름·영문 id 부분 일치 (v1 규칙 재사용). 순위 번호(`rank`)는 걸러도 바뀌지 않는다. 결과 개수 `aria-live="polite"`.
- **v1 역할군(태그) 필터와 가나다 정렬은 없앤다.** 태그 한글 이름은 상세 Hero 배지에서 계속 쓴다.
- **목록에 없는 챔피언 (결정 D2):** API가 준 챔피언만 보여준다. 지금은 173명 모두 어느 포지션엔가 나온다. 통계가 아예 없는 새 챔피언은 리스트에 없고, 상세 주소(`/champions/{id}`)로는 계속 볼 수 있다.
- **Data Dragon에 없는 `championId`** (새 챔피언이 Data Dragon보다 먼저 나온 경우): "챔피언 #950" 글자 행, 링크 없음, 아이콘 자리 회색. 서버 로그에 경고 1줄.
- 표는 `<table>` + `<caption class="sr-only">` + `<th scope="col">`. 링크는 챔피언 이름 칸 1개만(행 전체 클릭은 CSS로 넓힘).

**리스트 상태**

| 상황 | 처리 |
|------|------|
| 로딩 | `champions/loading.tsx`를 표 모양 스켈레톤(탭 + 기간 줄 + 10행)으로 바꾼다 |
| 정상 | 위 표 |
| `champions: []` | 탭은 그대로, 표 대신 "이 포지션의 최근 14일 통계가 아직 없습니다" |
| 검색 결과 없음 | "'{검색어}'에 해당하는 챔피언이 없습니다" + [검색 지우기] |
| `tier: null` 행 | "표본 부족" 배지 + `title`/sr 문구 "최근 14일 50게임 미만이라 티어를 매기지 않았습니다" (`/meta`의 `rules.minTierPick` 값 사용, 없으면 50) |
| `503 STATS_NOT_READY` | 탭은 그대로, "아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다." (정상 상태로 취급, 캐시됨) |
| API 연결 실패·`DB_UNAVAILABLE`·500·시간 초과 | 01-2-5 규칙: **빌드 중**에는 "통계 서버에 연결하지 못했습니다" 안내로 페이지를 만들고, **실행 중 재생성**에서는 오류를 던져 직전 정상 페이지를 계속 보여준다 |
| `isStale` | 01-1-1 안내 상자 |
| Data Dragon 실패 | v1과 같이 `champions/error.tsx` (다시 시도) |

#### 01-1-3. 챔피언 상세 (`/champions/[championId]`)

> 요약: Hero 아래에 포지션 탭을 두고, 탭마다 통계 요약과 추천 룬·주문·스킬·아이템을 보여준다. 그 아래 스킬 설명·스킨·스토리는 v1 그대로다.

```
← 탑 티어 목록                              ← 1순위 포지션 탭으로 돌아감
┌ Hero (v1 그대로) ───────────────────────┐
│ [아이콘] 아트록스 · 다르킨의 검 · [전사] · 난이도 │
└───────────────────────────────────────┘
최근 14일 · 3,952게임 · 26.20 67% / 26.19 33% · 10월 15일 03:52 집계

[탑 2티어 · 90%] [미드 표본 부족 · 10%]        ← 포지션 탭 (주 포지션 1~2개)
┌ 탑 ────────────────────────────────────┐
│ 2티어 · 승률 52.8% · 픽률 7.3% · 밴률 3.8% · 290게임 │
│                                          │
│ 추천 룬          [1순위 48.0% | 2순위 …]     │
│  정밀 ●정복자 ○ ○ / ○●○ / ●○○ / ○○●  결의 …   │
│  능력치 파편 ● ● ●                         │
│ 소환사 주문  [점멸][점화] 58.3% · 승률 53.3%   │
│             [점멸][순간이동] 36.2% · 49.5%    │
│ 스킬 순서 (1~11레벨)                         │
│   1 2 3 4 5 6 7 8 9 10 11                 │
│ Q ■ . . ■ ■ . ■ . ■ .  .                  │
│ W . . ■ . . . . . . .  .                  │
│ E . ■ . . . . . ■ . .  ■                  │
│ R . . . . . ■ . . . ■  .                  │
│ 많이 완성한 아이템  [쇼진][월식][갈라진 하늘] 신발 [판금 장화] │
└──────────────────────────────────────────┘
스킬 (v1) · 스킨 (v1) · 스토리 (v1)
```

**포지션 탭 (결정 D1 상세 부분)**

- 탭 = API `positions[]` (주 포지션 1~2개, pick 많은 순). 각 탭 글자: "탑 · 2티어 · 90%" (`positionShare` 정수). `tier null`이면 "표본 부족".
- 빌드할 때 1번 호출(`position` 없이 → 1순위)로 `positions[]`를 받고, 2순위가 있으면 `?position=MIDDLE`로 1번 더 부른다. 두 탭 내용을 **모두 정적 HTML에 넣고** 클라이언트에서 보이기만 바꾼다 (v1 스킨 갤러리와 같은 방식). URL은 바꾸지 않는다 (결정 D1-b).
- WAI-ARIA 탭: `role="tablist"`/`tab`/`tabpanel`, `aria-selected`, `aria-controls`, 좌우 화살표·Home/End 이동, 숨은 패널은 `hidden`. 탭이 1개면 탭 줄 없이 제목("탑")만.
- 2순위 호출이 `STATS_NOT_FOUND`면 그 탭만 뺀다. 두 응답의 `window.aggregatedAt`이 다르면(05:00 집계 순간에 걸침) 1순위 `window`를 표시하고 서버 경고 1줄 — 다음 재생성 때 맞춰진다.
- 주 포지션이 아닌 포지션(`isMainPosition: false`)은 이번에 보여주지 않는다.
- "← 목록" 링크는 1순위 포지션 탭 주소로 간다 (`/champions` 또는 `/champions/lane/{slug}`).

**통계 요약 줄:** `stats.tier`(배지), `winRate`, `pickRate`, `banRate`, `pick`. `tier null`이면 "표본 부족 (50게임 미만)" 배지와 함께 숫자는 보여주되 "표본이 적어 참고용" 문구.

#### 01-1-4. 추천 빌드 (상세 탭 안)

> 요약: API의 숫자 ID를 Data Dragon으로 이름·아이콘으로 바꿔 보여준다. 아이템은 프론트가 완성 아이템만 골라낸다.

| 영역 | 보여줄 것 | Data Dragon 매핑 |
|------|-----------|------------------|
| **룬** | `runes[0]`을 **전체 페이지**로: 핵심 트리 4줄(각 줄의 모든 룬을 보이고 고른 것만 밝게), 보조 트리 3줄(고른 2개 밝게), 능력치 파편 3줄(공격/유연/방어, 고른 것 밝게). 위에 "1순위 / 2순위" 전환 버튼(`aria-pressed`, 2개일 때만), 각 버튼에 사용률·승률 | `runesReforged.json` 트리 `id` → `name`·`icon`, `slots[].runes[].id` → `name`·`icon`(`/cdn/img/{icon}`). 파편은 Data Dragon에 없어 **프론트 표**(아래) |
| **소환사 주문** | 상위 2개 조합, 각 줄: 아이콘 2개 + 이름 + 사용률 + 승률 (+ 게임 수 작은 글씨) | `summoner.json`에서 `key == String(spellId)` → `id`(이미지 `/cdn/{v}/img/spell/{image.full}`), `name`. D/F 위치 정보가 없으므로 순서는 API 순서 |
| **스킬 순서** | `skills[0]`을 11칸 × Q/W/E/R 격자(`<table>`, 칸 안에 글자 "Q" 등 표시 — 색만으로 구분하지 않음). 줄 머리에 스킬 아이콘·이름. 2순위는 아래 한 줄 글자(`Q E W Q Q R …`) + 사용률·승률 | 챔피언 상세 `spells[0..3]` (이미 v1에서 불러옴) |
| **아이템** | "많이 완성한 아이템" 핵심 **3개** + 신발 **1개**, 각 아이콘·이름·사용률·승률. 제목 옆 작은 글씨 "게임이 끝날 때 가지고 있던 아이템 기준 · 구매 순서 아님" | `item.json` `data[String(itemId)]` → `name`, 이미지 `/cdn/{v}/img/item/{itemId}.png` |

**아이템 거르기 규칙 (결정 D3, 01-0 근거)** — 위에서부터 차례로 판단한다.

| 순서 | 조건 | 결과 |
|------|------|------|
| 1 | Data Dragon에 없음 (최신 + `window.patches`의 다른 패치 `{patch}.1` 버전까지 찾아도) | 뺀다 (서버 경고 1줄) |
| 2 | `tags`에 `Consumable` 또는 `Trinket` | 뺀다 |
| 3 | `from`이 없고 `gold.total < 1000` (도란·정글 펫·서폿 시작템·비스킷) | 뺀다 (시작 아이템) |
| 4 | `tags`에 `Boots` (`1001 장화`는 3번에서 이미 빠짐) | **신발 후보** |
| 5 | `into`가 있음 (하위 재료) | 뺀다 |
| 6 | 나머지 | **핵심 아이템 후보** |

- 후보는 API 순서(pick 내림차순)를 유지하고 앞에서 3개(핵심) / 1개(신발)를 고른다.
- 신발은 사용률 **5% 미만이면 보이지 않는다** (징크스처럼 신발을 거의 안 사는 경우 "신발 없음" 대신 칸을 숨김).
- 규칙은 `lib/ddragon/itemFilter.ts` 한 곳에 두고, 01-0의 실제 아이템 ID로 Review가 확인한다.

**능력치 파편 표 (프론트 상수, `statShards.ts`)**

| 줄 | 선택지 (ID · 이름 · 아이콘 파일) |
|----|------|
| 공격 `offense` | 5008 적응형 능력치 `StatModsAdaptiveForceIcon` · 5005 공격 속도 `StatModsAttackSpeedIcon` · 5007 스킬 가속 `StatModsCDRScalingIcon` |
| 유연 `flex` | 5008 적응형 능력치 · 5010 이동 속도 `StatModsMovementSpeedIcon` · 5001 체력 증가(레벨 비례) `StatModsHealthScalingIcon` |
| 방어 `defense` | 5011 체력 `StatModsHealthPlusIcon` · 5013 강인함 및 둔화 저항 `StatModsTenacityIcon` · 5001 체력 증가(레벨 비례) |

- 이미지 주소: `/cdn/img/perk-images/StatMods/{파일}.png` (버전 없음, 7개 모두 200 확인). 표에 없는 ID가 오면 회색 칸 + "알 수 없는 파편".

**빌드 상태**

| 상황 | 처리 |
|------|------|
| `runes`/`spells`/`skills` 빈 배열 | 그 영역만 "표본이 부족해 추천이 없습니다" |
| 아이템 후보 0개 | 같은 문구 |
| 룬·주문 ID를 Data Dragon에서 못 찾음 | 회색 아이콘 + "알 수 없는 룬 #8xxx" (페이지는 정상) |
| 상세 `404 STATS_NOT_FOUND` (챔피언 통계 없음) | 포지션 탭·빌드 대신 "최근 14일 통계가 없습니다" 상자. Hero·스킬·스킨·스토리는 정상 (계약 2-4) |
| `503 STATS_NOT_READY` | 같은 자리 "아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다." |
| API 연결 실패 | 01-2-5 (빌드 중: 같은 자리 "통계 서버에 연결하지 못했습니다" / 실행 중 재생성: 오류를 던져 직전 페이지 유지) |
| 로딩 | `[championId]/loading.tsx`에 통계 요약·빌드 카드 스켈레톤 추가 |

#### 01-1-5. 반응형

> 요약: 휴대폰에서는 한 줄로 쌓고, 넓은 화면에서는 두 칸으로 나눈다. 360px에서 가로 스크롤이 없어야 한다.

| 요소 | 모바일(<640) | sm(≥640) | lg(≥1024) |
|------|------|------|------|
| 포지션 탭 (리스트) | 한 줄, 넘치면 탭 줄만 가로 스크롤 | 한 줄 | ← |
| 티어 표 | 5열(#·챔피언·티어·승률·픽률), 챔피언 이름 말줄임 | 7열 | 8열(주 포지션) |
| 기간 줄 | 두 줄로 줄바꿈 허용 | 한 줄 | ← |
| 상세 빌드 | 1열: 룬 → 주문 → 스킬 → 아이템 | 1열 | 2열: 왼쪽 룬 / 오른쪽 주문·스킬·아이템 |
| 스킬 격자 | 11칸 + 머리, 칸 최소 22px (360px 안에 들어감) | ← | ← |
| 룬 페이지 | 아이콘 28px, 트리 2개 세로 | 트리 2개 가로 | ← |

- 이미지는 v1처럼 `next/image` + `sizes` + 고정 크기 칸(CLS 0 유지). 아이템·룬·주문 아이콘은 작아서 `sizes`를 고정 px로 준다.

#### 01-1-6. 접근성

> 요약: 색만으로 뜻을 전하지 않고, 탭·표·버튼을 키보드와 스크린리더로 쓸 수 있게 한다.

- 티어 배지는 글자("2티어", "표본 부족")를 항상 포함한다. 색은 보조.
- 리스트 포지션 탭: `nav` + 링크 + `aria-current="page"`. 상세 포지션 탭: ARIA 탭 패턴(01-1-3).
- 표: `caption`(sr-only, 예: "탑 챔피언 티어 표"), `th scope="col"`.
- 룬 페이지: 고르지 않은 룬은 장식(`alt=""`, `aria-hidden`), 고른 룬만 `alt`=룬 이름. 영역 앞에 sr 문구 "핵심 룬: 정복자, 승전보, …".
- 스킬 격자: `<table>`, 칸에 글자, `caption` "스킬 찍는 순서 1~11레벨".
- 아이콘 `alt`: 아이템·주문·룬 이름. 지연 안내 `role="status"`. 페이지당 `h1` 1개, 빌드 영역 `h2`/`h3`.
- 텍스트 대비 4.5:1 (티어 배지 색 5개 포함 확인).

---

### 01-2. 구조

> 요약: API 코드는 `lib/api/`, Data Dragon 추가분은 `lib/ddragon/`, 둘을 합쳐 화면용 데이터로 바꾸는 코드는 `lib/view/`에 둔다. 통계 화면도 v1처럼 미리 만들고 1시간마다 갱신한다.

#### 01-2-1. 파일 목록

```
frontend/
├── next.config.ts                        # (변경) 루트 .env에서 API_BASE_URL만 읽기 (01-3)
└── src/
    ├── app/
    │   └── champions/
    │       ├── page.tsx                  # (변경) 탑 티어 표 = TierListPage(TOP)
    │       ├── loading.tsx               # (변경) 탭 + 표 스켈레톤
    │       ├── lane/[position]/page.tsx  # (새) jungle/middle/bottom/utility 정적 생성, top → /champions 308
    │       └── [championId]/
    │           ├── page.tsx              # (변경) 통계·빌드 추가, generateMetadata try/catch (D7)
    │           └── loading.tsx           # (변경) 통계·빌드 스켈레톤 추가
    ├── components/
    │   ├── layout/Footer.tsx             # (변경) 패치 표시를 displayName으로 (D5)
    │   ├── stats/                        # (새 폴더)
    │   │   ├── WindowInfo.tsx            # 기간·게임·패치 구성·집계 시각 + 지연 안내
    │   │   ├── TierBadge.tsx             # 1~5티어 / 표본 부족
    │   │   └── StatsNotice.tsx           # 집계 전 / 통계 없음 / 서버 연결 실패 안내 상자
    │   └── champions/
    │       ├── TierListPage.tsx          # (새, server) 한 포지션 리스트 화면 조립
    │       ├── PositionNav.tsx           # (새, server) 리스트 포지션 탭 링크 (aria-current는 props로)
    │       ├── TierTable.tsx             # (새, client) 검색 + 티어 표 (ChampionBrowser 대체)
    │       ├── ChampionBrowser.tsx       # (삭제) 태그 필터·그리드 → TierTable로 대체
    │       ├── ChampionCard.tsx          # (삭제 또는 미사용 확인 후 삭제)
    │       ├── ChampionHero.tsx          # (변경) priority → fetchPriority/loading (D4)
    │       ├── PositionTabs.tsx          # (새, client) 상세 ARIA 탭. 패널은 서버에서 만든 ReactNode를 받음
    │       ├── PositionStatsPanel.tsx    # (새, server) 한 포지션의 요약 + 빌드 4개 배치
    │       ├── RunePage.tsx              # (새, client) 1/2순위 전환 + 전체 룬 페이지
    │       ├── SummonerSpells.tsx        # (새, server)
    │       ├── SkillOrder.tsx            # (새, server)
    │       └── CoreItems.tsx             # (새, server)
    └── lib/
        ├── api/                          # (새) 백엔드 API — 서버 전용
        │   ├── config.ts                 # API_BASE_URL 읽기, API_REVALIDATE_SECONDS = 3600, 시간 초과 값
        │   ├── types.ts                  # 계약 v2 그대로의 응답·오류 타입
        │   ├── client.ts                 # fetchApi<T>(): 결과를 { ok, data } | { ok:false, kind } 로
        │   ├── api.ts                    # getMeta(), getTierList(position), getChampionStats(key, position?)
        │   ├── positions.ts              # POSITIONS, 한글 이름, URL 조각 ↔ API 값
        │   └── buildPhase.ts             # 빌드 중인지 판단 (01-2-5)
        ├── ddragon/
        │   ├── types.ts                  # (변경) 아이템·소환사 주문·룬 원본 타입, ChampionSummary에 key 추가
        │   ├── api.ts                    # (변경) getItems(versions), getSummonerSpells(), getRuneTrees(), getChampionKeyMap()
        │   ├── images.ts                 # (변경) itemIconUrl, summonerSpellIconUrl, runeIconUrl, statShardIconUrl
        │   ├── itemFilter.ts             # (새) 01-1-4 아이템 규칙 → 'core' | 'boots' | 'excluded'
        │   └── statShards.ts             # (새) 능력치 파편 표
        └── view/                         # (새) API + Data Dragon → 화면용 데이터
            ├── tierList.ts               # championId → 이름·아이콘·상세 링크
            ├── builds.ts                 # 룬 페이지·주문·스킬 격자·핵심 아이템 모델
            └── format.ts                 # 퍼센트, KST 날짜, 패치 구성 글자
```

- 백엔드 호출(`fetch`)은 `lib/api/` 밖에 두지 않는다. Data Dragon 호출은 v1처럼 `lib/ddragon/`에만.
- `lib/api/*`는 첫 줄에 `import "server-only"`를 둔다. Next 16은 이 import를 자체 처리하므로 **설치할 패키지가 없다** (Next 문서 "installing server-only is optional"). 클라이언트 컴포넌트가 실수로 가져오면 빌드가 실패한다.
- 클라이언트 컴포넌트는 `TierTable`, `PositionTabs`, `RunePage`(+ v1의 `SkinGallery`, `NavLink`, `error.tsx`)뿐이다. 클라이언트로는 화면용 가공 데이터만 넘긴다 (원본 `item.json` 733KB를 넘기지 않는다).
- 새 의존성 없음.

#### 01-2-2. API 클라이언트 (`lib/api/`)

> 요약: 계약 v2 타입을 그대로 옮기고, 오류를 화면이 쓰기 쉬운 4가지 종류로 바꾼다.

- `types.ts`: `Position`, `StatsWindow`, `WindowPatch`, `MetaResponse`, `TierListResponse`, `TierRow`, `ChampionStatsResponse`, `PositionSummary`, `StatsSummary`, `ItemBuild`, `RuneBuild`, `SpellBuild`, `SkillBuild`, `ApiErrorBody`. `tier`는 `1|2|3|4|5|null`. 계약에 없는 필드는 쓰지 않고, 모르는 필드는 무시한다.
- `client.ts` 결과:

| `kind` | 언제 | 화면 |
|--------|------|------|
| `ok` | 2xx | 정상 |
| `not_ready` | 503 `STATS_NOT_READY` | 집계 전 안내 (정상 상태로 캐시) |
| `not_found` | 404 `STATS_NOT_FOUND` | 상세 "통계 없음" / 2순위 탭 제외 |
| `unavailable` | 연결 실패, 시간 초과(10초), 503 `DB_UNAVAILABLE`, 500, JSON 아님, `API_BASE_URL` 없음 | 01-2-5 |
| `invalid` | 400 `INVALID_PARAMETER`, 404 `NOT_FOUND` | 프론트 버그 → `unavailable`과 같게 처리 + 서버 로그에 `code` |

- 분기는 `error.code`로만 한다 (`message`는 바뀔 수 있음, 계약 3장). 로그에는 경로·상태·`code`만 남기고 기본 URL은 남기지 않는다.
- `fetch(url, { next: { revalidate: 3600 } })` (계약 4장 권장값). 응답이 5KB 안팎이라 데이터 캐시 한도 문제 없음.

#### 01-2-3. Data Dragon 추가 (`lib/ddragon/`)

> 요약: 아이템·소환사 주문·룬 파일을 v1과 같은 방식(버전 포함 주소는 영구 캐시)으로 불러 ID 찾기 표로 만든다.

| 함수 | 파일 | 캐시 | 반환 |
|------|------|------|------|
| `getChampionKeyMap()` | `champion.json` (v1과 같은 요청, 메모이제이션) | force-cache | `key("266")` → `ChampionSummary` |
| `getItems(extraVersions)` | `item.json` 최신 + 필요할 때만 `window.patches`의 다른 패치 버전 | force-cache | `itemId` → `{ name, iconUrl, tags, into, from, goldTotal }` |
| `getSummonerSpells()` | `summoner.json` | force-cache | `key("4")` → `{ name, iconUrl }` |
| `getRuneTrees()` | `runesReforged.json` | force-cache | 트리 목록 + `perkId` → `{ name, iconUrl }` |

- 버전: 이름·이미지는 **최신 Data Dragon 버전**(v1 `getLatestVersion()`)을 쓴다. 아이템을 못 찾을 때만 다른 패치 `{patch}.1`을 `versions.json`에 있는지 확인한 뒤 한 번 더 본다 (계약 5장 권장). 지금은 못 찾는 아이템 0개라 실제로는 거의 호출되지 않는다.
- `displayName`(`26.20`)으로 Data Dragon을 찾지 않는다.

#### 01-2-4. 화면용 매핑 (`lib/view/`)

> 요약: 숫자 ID를 이름·아이콘 주소가 붙은 화면용 객체로 바꾼다. 컴포넌트는 매핑 결과만 받는다.

- `tierList.ts`: `TierRow` + `ChampionSummary` → `{ rank, championId, id?, name, iconUrl?, tier, winRate, pickRate, banRate, pick, otherMainPosition? }`.
- `builds.ts`: `RuneBuild` → 트리 2개의 줄별 `{ runes: [{ id, name, iconUrl, selected }] }` + 파편 3줄. `SpellBuild` → 주문 2개. `SkillBuild` → 11칸 격자 `{ level, key }[]` + 스킬 이름·아이콘. `ItemBuild[]` → `itemFilter`로 `{ core[≤3], boots? }`.
- `format.ts`: `formatPercent(52.76) → "52.8%"`, `formatKst(iso) → "10월 15일 03:52"`, `formatPatchMix(patches) → "26.20 67% / 26.19 33%"`. 서버에서만 호출.

#### 01-2-5. 렌더링과 캐시, API 없이 빌드할 때 (결정 D6)

> 요약: 페이지는 v1처럼 미리 만든다(SSG + 1시간 ISR). 빌드 때 API가 꺼져 있으면 "통계 연결 실패" 안내로 빌드를 통과시키고, 서비스 중에 API가 잠깐 죽으면 직전 정상 페이지를 계속 보여준다.

| 경로 | 렌더링 | 빌드 시 API 호출 |
|------|--------|------------------|
| `/champions` | SSG + `revalidate = 3600` (○) | `/champions?position=TOP` 1번 |
| `/champions/lane/[position]` | `generateStaticParams` 4개 + `dynamicParams = false` + `revalidate = 3600` (●) | 포지션마다 1번 |
| `/champions/[championId]` | v1 그대로 173개 SSG + ISR 3600, `dynamicParams` 기본값 | 챔피언마다 1~2번 (지금 173 + 89 = 262번) |
| 푸터 | 각 페이지와 같이 렌더 | `/meta` 1번 (데이터 캐시로 공유) |

- `revalidate = 3600`은 계약 4장 권장값이고, 백엔드 `max-age=600`보다 길다. 05:00 집계 뒤 최대 약 1시간 안에 새 숫자가 보인다. `aggregatedAt` 기반 빠른 재검증은 이번에 하지 않는다.
- **`searchParams`를 쓰지 않는다.** Next 16에서 `searchParams`를 읽으면 페이지가 요청마다 동적 렌더링된다 (Next 문서 page.md). 그래서 리스트 포지션은 경로 조각(D1)으로 한다.

**API가 응답하지 않을 때 (`unavailable`)**

| 시점 | 동작 | 이유 |
|------|------|------|
| `npm run build` 중 (`process.env.NEXT_PHASE === "phase-production-build"`) | 오류를 던지지 않고 통계 자리에 "통계 서버에 연결하지 못했습니다" 안내를 넣어 페이지를 만든다. 빌드 로그에 경고 1줄(호출 실패 수 합계). **빌드는 성공** | 백엔드 없이도 프론트 빌드·Data Dragon 화면 확인이 가능해야 한다 (개발 단계에서 백엔드는 수동 실행) |
| 서비스 중 ISR 재생성 | **오류를 던진다** → Next는 직전에 성공한 페이지를 계속 보여주고 다음 요청 때 다시 시도한다 (Next ISR 문서 "last successfully generated page will continue to show") | API가 잠깐 죽어도 정상 통계 페이지를 "연결 실패" 페이지로 1시간 덮어쓰지 않는다 |
| 서비스 중 처음 만드는 페이지 (새 챔피언 상세 등) | 오류를 던진다 → `champions/error.tsx` "데이터를 불러오지 못했습니다" + 다시 시도 | 보여줄 직전 페이지가 없다 |

- 한계: API 없이 빌드한 페이지는 첫 재검증(최대 1시간) 전까지 "연결 실패" 안내가 보인다. 운영 배포는 API를 켠 상태에서 빌드한다. Review는 두 경우를 모두 빌드해 본다.
- `STATS_NOT_READY`와 `STATS_NOT_FOUND`는 오류가 아니라 정상 상태로 그려서 캐시한다.
- `NEXT_PHASE` 값이 빌드 작업 프로세스에서 실제로 보이는지 Build가 먼저 확인한다. 안 보이면 `next/constants`의 `PHASE_PRODUCTION_BUILD`와 비교하는 다른 방법을 찾아 `front_build.md`에 적는다.

---

### 01-3. 환경 변수

> 요약: 새 변수 `API_BASE_URL` 1개를 루트 `.env`에 둔다. Next가 루트 `.env`를 직접 읽지 못하므로 `next.config.ts`가 **이 변수 하나만** 골라 읽는다. 서버 전용이다.

| 변수 | 예 | 용도 |
|------|-----|------|
| `API_BASE_URL` | `http://localhost:4000/api/v1` | 백엔드 읽기 API 기본 URL (`/api/v1`까지 포함, 끝 `/` 없음) |

- `NEXT_PUBLIC_`을 붙이지 않는다. 서버 컴포넌트만 API를 부르고(계약 1장: CORS 없음), 브라우저 번들에 주소가 들어가지 않는다. `next.config.ts`의 `env` 옵션도 쓰지 않는다 (값이 번들에 박힘).
- `.env.example`에 "백엔드 API 서버" 묶음 아래 `API_BASE_URL=` 한 줄과 주석을 추가한다 (CLAUDE.md 9장 규칙).

**프론트가 값을 받는 방법 (결정 D8)**

| 안 | 방법 | 장점 | 단점 |
|----|------|------|------|
| ★A | `next.config.ts`에서 `../.env`가 있으면 Node 기본 기능(`node:fs` + `util.parseEnv`)으로 읽어 **`API_BASE_URL`만** `process.env`에 넣는다. 이미 값이 있으면(배포 환경 변수) 덮어쓰지 않는다 | 루트 `.env` 하나 유지, 프론트 프로세스에 DB·Riot 키가 들어오지 않음, 새 의존성 없음 | 설정 파일에 코드 몇 줄 |
| B | npm 스크립트를 `node --env-file-if-exists=../.env …/next build`로 | 간단 | `DATABASE_URL`·`RIOT_API_KEY`까지 프론트 프로세스 환경에 들어감 |
| C | `frontend/.env.local`에 따로 둠 | Next 기본 방식 | CLAUDE.md "환경 변수는 루트 `.env`" 규칙과 어긋남, 값이 두 곳 |

- 값이 없으면 기본값을 넣지 않고 `unavailable`로 처리하며 서버 로그에 "API_BASE_URL이 설정되지 않았습니다" 1줄 (조용히 localhost로 붙지 않게).
- Build는 `next build` 작업 프로세스와 `next start`/`next dev`에서 값이 보이는지 확인한다. 값 자체는 문서·로그에 쓰지 않는다.
- `.env`(실제 값)에 `API_BASE_URL`을 넣는 것은 **사용자가 한다** (서브에이전트는 `.env`를 수정하지 않는다). 넣기 전에도 빌드는 01-2-5 규칙으로 통과한다.

---

### 01-4. 완료 기준 (Review 체크리스트)

> 요약: Review는 백엔드를 켠 상태와 끈 상태 모두에서 빌드·브라우저 확인을 한다. 숫자는 그 시점 API 응답과 비교한다 (집계가 매일 바뀌므로 고정 숫자를 쓰지 않는다).

#### 검증 명령
- [ ] `npm run lint` 오류 0, `npx next typegen && npx tsc --noEmit` 오류 0, `any` 0건
- [ ] 새 의존성 없음 (`package.json` dependencies·devDependencies 변경 없음)
- [ ] 백엔드 켬 + `npm run build` 성공: `○ /champions`, `● /champions/lane/[position]` 4개, `● /champions/[championId]` 173개, 모두 Revalidate 1h. 빌드 로그에 API 실패 경고 0
- [ ] 백엔드 끔 + `npm run build`도 성공, 경고 로그 1줄, 생성된 리스트·상세 HTML에 "통계 서버에 연결하지 못했습니다" 안내와 Data Dragon 정보(Hero·스킬·스킨)가 있음
- [ ] `fetch(`·백엔드 주소가 `lib/api/` 밖에 없음, Data Dragon 주소가 `lib/ddragon/` 밖에 없음, `lib/api/*`에 `server-only`
- [ ] 브라우저 번들(`.next/static`)에 `API_BASE_URL` 값·`localhost:4000`·`/api/v1` 문자열 0건. `NEXT_PUBLIC_` 0건

#### 리스트
- [ ] `/champions` = 탑, 탭 5개(탑·정글·미드·원딜·서폿), 현재 탭 `aria-current="page"`
- [ ] 각 탭의 행 수·순서·티어가 그 시점 `/api/v1/champions?position=…` 응답과 같음 (`rank` 순, `tier null`은 맨 뒤 "표본 부족")
- [ ] 승률·픽률·밴률·게임 수가 API 값과 같음 (소수 1자리 반올림)
- [ ] `/champions/lane/top` → 308 `/champions`, `/champions/lane/TOP`·`/champions/lane/mid` → 404, 그 뒤에도 정상 페이지 그대로
- [ ] 검색 "아트" → 탑 탭에 아트록스 1행, 순위 번호 유지, 결과 없음 문구 + [검색 지우기]
- [ ] 행 클릭 → `/champions/{id}`
- [ ] 역할군 필터·가나다 정렬이 더 이상 없음

#### 상세
- [ ] `/champions/Aatrox`: v1 Hero·스킬·스킨·스토리 그대로 + 포지션 탭(API `positions[]`와 같은 수·순서), 탭 글자에 티어와 비율
- [ ] 주 포지션 2개 챔피언 1명 이상에서 탭 전환(클릭, ←/→, Home/End), `aria-selected`·`hidden` 정상
- [ ] 룬 1순위 전체 페이지: 핵심 4개 + 보조 2개 + 파편 3개가 API ID와 같은 이름·아이콘, 2순위 전환 동작
- [ ] 소환사 주문 2조합, 스킬 격자 11칸이 `skillOrder` 글자와 같음
- [ ] 아이템: 아트록스 탑에 재료(`1036` 롱소드)·시작템(`1054`/`1055` 도란)·소모품(`2031`, `2055`)이 없고, 신발 칸에 `3047` 판금 장화가 있음. 징크스 원딜은 신발 칸이 숨겨짐(사용률 5% 미만)
- [ ] 이미지 깨짐 0 (아이템·룬·파편·주문 아이콘 포함), 콘솔 오류·hydration 경고 0
- [ ] "← 목록" 링크가 1순위 포지션 탭으로 감

#### 상태 (실제로 만들어 확인)
- [ ] 기간 줄: "최근 14일 · N게임 · 26.xx NN% / … · M월 D일 HH:mm 집계"가 `/meta`와 같고 시각이 KST. 화면 어디에도 `16.20`·`16.20.1`이 보이지 않음 (푸터 포함, D5 채택 시)
- [ ] `isStale` 안내: 응답을 바꿀 수 없으므로 `WindowInfo`에 `isStale: true` 데이터를 넣은 임시 확인(scratchpad 복사본 또는 단위 확인)으로 문구·`role="status"` 확인
- [ ] `STATS_NOT_READY`·`STATS_NOT_FOUND`·`unavailable`: 프로젝트를 건드리지 않는 방법(가짜 응답 서버를 scratchpad에서 띄우고 `API_BASE_URL`만 그쪽으로)으로 리스트·상세 안내 문구 확인. DB는 건드리지 않는다
- [ ] 서비스 중 API를 끈 뒤 재검증 시간이 지나도 직전 정상 페이지가 계속 보임 (`revalidate` 짧게 바꾼 scratchpad 복사본에서 확인 가능)
- [ ] 로딩 스켈레톤(개발 모드) 표시, 빈 빌드 영역 문구("표본이 부족해 추천이 없습니다")는 가짜 응답으로 확인

#### 반응형·접근성
- [ ] 360 / 768 / 1280px 가로 스크롤 없음, 표 열 수가 01-1-5 표와 같음, 스킬 격자가 360px에 들어감
- [ ] 키보드만으로 포지션 탭 이동·검색·상세 이동·상세 탭·룬 1/2순위 전환 가능, 포커스 링 보임
- [ ] 티어가 글자로도 보임, 표 `caption`/`th scope`, 고른 룬만 `alt`, 이미지 `alt` 누락 0, 대비 4.5:1 (티어 배지 5색 포함)
- [ ] Lighthouse 접근성 100 유지 (리스트·상세)

#### 성능 (D4 채택 시)
- [ ] Lighthouse를 **career_log 11번과 같은 조건**(13.5.0, 모바일, 시뮬레이션 제한, `next build` + `next start`, 로컬, 3회 중앙값, 이미지 캐시를 데운 뒤)으로 `/champions`·`/champions/Aatrox` 측정, 표에 이전 값(LCP 2.88s / 2.89s, 점수 95)과 나란히 기록. 백엔드는 켠 상태
- [ ] LCP 이미지에 `fetchpriority="high"` 적용 확인 (Lighthouse 진단 항목 사라짐). 리스트는 화면이 표로 바뀌어 LCP 요소가 달라질 수 있음 → 요소 이름도 함께 기록
- [ ] CLS 0 유지

---

### 01-5. 계약 변경 요청

> 요약: **없음.** 지금 계약 v2로 모든 화면을 만들 수 있다. 다음 백엔드 변경 때 문구만 다듬으면 좋은 점 2개를 참고로 적는다 (막는 문제 아님).

| # | 대상 | 내용 | 영향 |
|---|------|------|------|
| 참고 1 | `api_contract.md` 2-4 "아이템은 프론트가 거른다" | 문구가 "`into` 있으면 빼고 상위 2개"인데, 실제 Data Dragon에선 2단계 신발(`3047` 등)도 `into`가 있고 도란 같은 시작템은 `into`가 없다 (01-0). 프론트는 01-1-4 규칙(핵심 3 + 신발 1)을 쓴다. 이 문장은 프론트 동작 설명이라 API 응답은 바뀌지 않는다 | 없음 (문구 정리 제안) |
| 참고 2 | 2-4 예시 | 예시 `builds.items`에 신발 `3006`·`3046`이 섞여 있어 위 규칙 설명과 함께 보면 헷갈림 | 없음 |

---

### 01-6. 결정 필요 사항

> 요약: 사용자가 정해 주면 좋은 항목이다. 따로 지시가 없으면 ★추천안으로 진행한다.

| # | 항목 | 선택지 | 추천 |
|---|------|--------|------|
| D1 | 리스트 포지션 URL | A. 쿼리 `/champions?position=TOP` / B. 경로 `/champions` (탑) + `/champions/lane/{jungle…}` / C. 한 페이지에 5개 다 넣고 클라이언트 탭(URL 없음) | ★**B** — Next 16에서 `searchParams`를 읽으면 요청마다 동적 렌더링이 되어 SSG·ISR을 잃는다(A). C는 5배 HTML이 한 페이지에 들어가고 탭 주소를 공유할 수 없다. B는 5개 모두 정적, 주소 공유 가능, `dynamicParams=false`로 대소문자 캐시 문제도 없음 |
| D1-b | 상세 포지션 탭 | A. 두 포지션 모두 정적 HTML에 넣고 클라이언트 전환(URL 그대로) / B. `?position=` 동기화 | ★**A** — 주 포지션은 최대 2개라 HTML 증가가 작고, B는 상세 173개를 동적으로 만든다 |
| D2 | 포지션에 통계 없는 챔피언 표시 | A. API가 준 챔피언만 / B. 나머지 챔피언도 "통계 없음"으로 아래에 붙임 | ★**A** — 지금 173명 모두 어느 포지션엔가 나오고, B는 원딜 탭에 탑 챔피언 140여 명이 붙어 표가 무의미해진다. 상세 주소는 그대로 열림 |
| D3 | 아이템 거르기 | A. 계약 문구대로(`into` 있으면 제외 + 소모품·장신구 제외, 상위 2개) / B. 01-1-4 규칙(시작템 제외, 신발 따로, 핵심 3 + 신발 1, 신발 5% 미만 숨김) | ★**B** — A는 아트록스 70%가 산 판금 장화를 빼고 도란의 방패를 "완성 아이템"으로 보여준다 (01-0 실측). B로 173명 모두 핵심 3개 확보 |
| D4 | 미뤄 둔 LCP 개선 포함 | A. 포함: Hero 스플래시 `priority`(Next 16에서 사용 중단) → `fetchPriority="high"` + `loading="eager"`, 리스트 첫 화면 아이콘 `loading="eager"`(첫 1개 `fetchPriority="high"`), 같은 조건 Lighthouse 재측정 / B. 다음 단계로 | ★**A** — 어차피 Hero·리스트 파일을 고치고, `priority`는 Next 16 사용 중단 경고 대상이다. 다만 리스트 화면이 바뀌어 전후 비교는 "같은 페이지·같은 조건, 다른 화면"임을 기록 |
| D5 | 푸터 패치 표시 | A. `/meta`의 `patches[0].displayName` → "패치 26.20" (실패 시 "패치 정보 없음") / B. Data Dragon 버전 그대로 `16.20.1` / C. 프론트가 메이저 + 10 계산 | ★**A** — 계약 5장 "푸터 포함 `displayName`만" 규칙을 지킨다. C는 백엔드 규칙을 프론트에 복제하는 것이라 하지 않는다 |
| D6 | API 없이 빌드 | A. 빌드 실패 / B. 빌드 중엔 안내로 통과 + 서비스 중 재생성엔 오류를 던져 직전 페이지 유지 / C. 통계 부분만 동적 렌더링 | ★**B** — 개발 단계에서 백엔드는 수동 실행이라 A는 불편하고, C는 SSG 이점을 잃는다. B의 한계(최대 1시간 안내 노출)는 01-2-5에 적음 |
| D7 | v1 알려진 문제 같이 고치기 | ① 상세 `generateMetadata` Data Dragon 실패 시 빈 제목 → try/catch로 "챔피언 \| Tier.GG" / ② macOS 소문자 URL 캐시 덮어쓰기 / ③ 스킨 미리보기 `alt`·`figcaption` 중복 / ④ 하위 경로 `aria-current` | ★**①만 포함** — 같은 파일을 고치고 작다. ②는 사용자 결정(보류)대로 두되 새 `lane` 경로는 `dynamicParams=false`라 새로 생기지 않는다. ③④는 범위 밖, 다음에 |
| D8 | API 주소 받는 방법 | 01-3 표 A/B/C | ★**A** — 루트 `.env` 규칙을 지키면서 프론트 프로세스에 DB·Riot 비밀값을 넣지 않는다 |
| D9 | 아이템 표시 개수 | A. 핵심 3 + 신발 1 / B. 핵심 2 (계약 문구) / C. 핵심 6 | ★**A** — 완성 아이템 3개가 보통 "코어 빌드"로 읽힌다. 순서 정보가 없으므로 "구매 순서 아님"을 함께 적는다 |

---

### 01-7. 작업 범위 (단계별 수정 가능한 경로)

> 요약: Build는 `frontend/`와 기록 문서, 그리고 새 변수 때문에 `.env.example`만 고친다. Review는 검토 기록·수정·커리어 기록만 고친다.

| 단계 | 수정 가능 | 수정 금지 |
|------|-----------|-----------|
| Plan | `frontend/docs/front_spec.md` | 그 외 전부 |
| Build | `frontend/` 아래 프로젝트 파일(`src/`, `next.config.ts` 등, 01-2-1 목록), `frontend/docs/front_build.md`(아래에 "변경 01" 추가), 저장소 루트 `.env.example`(`API_BASE_URL` 1줄 + 주석만) | `frontend/docs/front_spec.md`, `frontend/docs/front_review.md`, `.env`, `docs/contracts/*`, `backend/`, `db/`, 그 밖의 `frontend/` 밖 전부 |
| Review | `frontend/docs/front_review.md`(아래에 "변경 01" 추가), 검토 중 고친 `frontend/` 코드와 `frontend/docs/front_build.md`의 해당 기록, `docs/career_log.md`(맨 아래 **추가만**) | `frontend/docs/front_spec.md`, `.env`, `.env.example`, `docs/contracts/*`, `backend/`, `db/` |

- Build·Review는 확인을 위해 `backend/`에서 `npm start`로 API를 띄우고 GET만 호출할 수 있다. 끝나면 종료한다. 수집(`collect`)·집계·DB 쓰기는 하지 않는다.
- 상태 확인용 가짜 응답 서버·복사본은 scratchpad에서만 만든다.
- `.env` 값은 읽기만 하고 문서·로그·응답에 쓰지 않는다. `.env`에 `API_BASE_URL`을 넣는 일은 사용자에게 요청한다.
- 계약을 바꿔야 할 일이 생기면 직접 고치지 않고 이 문서 01-5에 적어 메인 에이전트에게 보고한다.
