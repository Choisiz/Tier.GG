# 프론트엔드 검토 기록 — 01 챔피언 화면

> 작성: Review 에이전트 (Build와 별도) / 기준 문서: `front_spec.md` (승인됨, 결정 사항 10개 모두 ★추천안), `front_build.md`
> 검토일: 2026-10-12 / Data Dragon 최신 버전 `16.20.1`, 챔피언 173개

---

## 0. 쉬운 요약

> **결론: 통과.** 계획서 9장 체크리스트 25개 항목이 모두 통과했다. 린트·타입 검사·빌드 모두 오류 없이 끝났고, 실제 브라우저에서 "목록 → 검색/필터 → 챔피언 클릭 → 상세 → 스킨 선택", 404, 로딩, 빈 결과, 오류(Data Dragon 연결 실패) 화면을 모두 확인했다.
>
> - 꼭 고쳐야 하는 버그는 없어서 **코드는 수정하지 않았다** (`front_build.md` 변경 없음).
> - 작은 개선점 4개(모두 낮음)와 기존에 알려진 문제 1개(macOS 소문자 URL, 사용자 결정으로 기록만)가 남아 있다. 아래 3장 참고.

---

## 1. 체크리스트 (계획서 9장)

> **쉬운 요약**: 계획서에 적힌 완료 기준을 하나씩 직접 확인한 결과다.

### 세팅·검증

| 항목 | 결과 | 근거 |
|------|------|------|
| `frontend/`에 Next.js(App Router) + TS + Tailwind, `docs/` 보존 | ✅ | `src/app/` App Router 구조, `tsconfig.json`, `globals.css`의 `@import "tailwindcss"`. `docs/front_spec.md`·`front_build.md` 존재 |
| 추가 의존성 없음 | ✅ | `package.json`: `next`, `react`, `react-dom` + dev(`@tailwindcss/turbopack`, `@types/*`, `eslint`, `eslint-config-next`, `tailwindcss`, `typescript`) — 모두 create-next-app 16.4 템플릿 기본값 (`@tailwindcss/turbopack`은 승인된 차이) |
| `npm run lint` 오류 0 | ✅ | 종료 코드 0, 출력 없음 |
| `npx tsc --noEmit` 오류 0 | ✅ | `npx next typegen` 후 실행, 종료 코드 0 |
| `npm run build` 성공, 상세 SSG(●) 전 챔피언 | ✅ | `● /champions/[championId]` Garen, Galio, Gangplank +170 = 173개, 총 178 페이지. `.next/server/app/champions/*.html` 173개 |
| Data Dragon 호출 코드가 `lib/ddragon/` 밖에 없음, `any` 미사용 | ✅ | `grep` 결과 `ddragon.leagueoflegends`·`fetch(`는 `src/lib/ddragon/`에만 있음. 단어 `any` 0건, `dangerouslySetInnerHTML` 0건 |

### 공통 레이아웃

| 항목 | 결과 | 근거 |
|------|------|------|
| 모든 페이지에 헤더(로고, "챔피언")와 푸터(패치 버전, 고지문) | ✅ | 목록·상세·챔피언 404·전역 404 모두 헤더/푸터 표시, 푸터 "패치 16.20.1 · 데이터: Riot Data Dragon" + 고지문 |
| `/` → `/champions` | ✅ | `curl` 307 → `/champions`, 브라우저에서도 이동 확인 |
| 현재 메뉴 강조 + `aria-current="page"` | ✅ | `/champions`·상세에서 `aria-current="page"` + 골드 강조, `/nope`에서는 없음 |

### 챔피언 리스트

| 항목 | 결과 | 근거 |
|------|------|------|
| 전체 173개, 가나다순 | ✅ | 카드 173개, 첫 5개 가렌·갈리오·갱플랭크·그라가스·그레이브즈, `localeCompare('ko')` 순서 검사 통과 |
| "아트", "aatrox", "AATROX" → 아트록스 | ✅ | 실제 키보드 입력으로 세 가지 모두 `챔피언 (1)` 아트록스 |
| 역할군 필터, 검색과 AND, 개수 갱신 | ✅ | "아트"+전사 → 1, "아트"+마법사 → 0, 검색 지우고 마법사 → 75 (Data Dragon 원본의 Mage 수 75와 일치). 같은 버튼 재클릭 시 해제, `aria-pressed` 정상 |
| 결과 없음 문구 + 초기화 버튼 | ✅ | "'아트'에 해당하는 챔피언이 없습니다" + [필터 초기화] 클릭 → 검색어 빈 값, "전체" 선택, `챔피언 (173)` |
| 카드 클릭 → `/champions/{id}` | ✅ | 아트록스 카드 클릭 → `/champions/Aatrox` 클라이언트 이동 |

### 챔피언 상세

| 항목 | 결과 | 근거 |
|------|------|------|
| `/champions/Aatrox`: 아트록스 / 다르킨의 검 / 전사 / 난이도 | ✅ | Hero 텍스트 "아트록스 · 다르킨의 검 · 전사 · 난이도 (4/10)" + 점 10개 중 4개 강조 |
| 패시브 + Q/W/E/R, HTML·`{{ }}` 없음 | ✅ | 5개 항목 아이콘 모두 로드, 이름·설명·재사용 대기시간(Q 14/12/10/8/6초 등, 패시브 제외). 빌드된 173개 상세 HTML 전체에서 `{{`·이스케이프된 태그(`&lt;tag`)·이중 이스케이프 엔티티 0건 |
| `/champions/MonkeyKing` 스킬 아이콘 정상 | ✅ | `MonkeyKingStoneSkin/DoubleAttack/Decoy/Nimbus/SpinToWin.png` 5개 모두 로드(`naturalWidth > 0`) |
| 스토리 표시, 탭 제목 | ✅ | "한때는 공허에 맞서 싸웠던 …", 탭 제목 "아트록스 - 다르킨의 검 \| Tier.GG" |
| `/champions/Foo` → 404 + 안내 + 목록 링크 | ✅ | `curl` 404, "챔피언을 찾을 수 없습니다" + [챔피언 목록으로], 탭 제목 "챔피언을 찾을 수 없습니다 \| Tier.GG" |

### 스킨 리스트

| 항목 | 결과 | 근거 |
|------|------|------|
| 크로마 제외, 깨진 이미지 없음 (아트록스 13개) | ✅ | 스킨 버튼 13개, 페이지 끝까지 스크롤 후 이미지 21개 모두 로드, 깨진 이미지·플레이스홀더 0 |
| 첫 스킨 "기본" | ✅ | 첫 버튼 이름 "기본", 기본 선택 상태 |
| 클릭/키보드 선택 → 미리보기 교체, `aria-pressed` | ✅ | Tab으로 "정의의 아트록스" 이동 후 Enter → 캡션·`aria-pressed` 변경, 다음 Tab + Space → "메카 아트록스", 미리보기 이미지 `Aatrox_2.jpg` 로드 |

### 상태·반응형·접근성

| 항목 | 결과 | 근거 |
|------|------|------|
| 로딩 스켈레톤, 오류 화면(다시 시도) 존재 및 동작 | ✅ | 개발 모드에서 `/champions`, `/champions/Ahri` 응답에 스켈레톤 문구("…불러오는 중입니다") 스트리밍 확인. Data Dragon 연결 실패 모의(아래 4장) 시 목록·상세 모두 "데이터를 불러오지 못했습니다" + [다시 시도] + [챔피언 목록으로], [다시 시도] 클릭 시 서버 재요청 발생 |
| 360/768/1280px 가로 스크롤 없음, 열 수 일치 | ✅ | 목록 그리드 4/8/10열, 스킨 그리드 3/5/6열, `scrollWidth`가 화면 폭과 같음(360·768·1280). 360px 역할군 필터는 가로 스크롤(508/360), 768px부터 줄바꿈. 상세 Hero: 360px 스플래시 위·정보 아래, 768px 오버레이. 긴 이름(누누와 윌럼프)도 360px에서 넘침 없음 |
| 키보드만으로 검색·필터·상세 이동·스킨 선택, 포커스 링 | ✅ | 첫 Tab = "본문으로 건너뛰기"(포커스 시 표시), Tab으로 검색창 → 입력, 필터 Space 선택, 스킨 Enter/Space 선택. `focus-visible` 골드(`#e3b456`) 2px 외곽선 확인 |
| 이미지 `alt`, 콘솔 에러/경고 없음 | ✅ | `alt` 없는 이미지 0개(Hero 배경만 `alt=""`). 정상 페이지(목록·Aatrox·MonkeyKing) 콘솔 로그 없음. 콘솔의 404/500 로드 오류는 의도적으로 연 `/champions/Foo`, `/nope`, 오류 모의 페이지에서만 발생 |

---

## 2. 승인된 계획 대비 확인

> **쉬운 요약**: 결정 사항 10개와 화면·데이터 규칙이 계획대로 구현됐다.

- 결정 1~10 모두 ★안대로 구현됨: 영문 id URL, 상세 안 스킨 섹션, 상단 미리보기 교체, 크로마 제외, 기본정보+스킬+스킨+스토리만 표시(`stats`·팁·`recommended` 미표시), 필터는 컴포넌트 state, 초성 검색 없음, `next/image` 최적화 사용, `/` 리다이렉트, 다크 고정.
- 캐싱: `versions.json` revalidate 3600, 버전 포함 URL `force-cache`, 페이지 `revalidate = 3600`, `dynamicParams` 기본값 — 계획 4장과 일치.
- 없는 챔피언은 목록에서 먼저 확인 후 `notFound()` (403 회피) — 계획대로.
- 승인된 차이(재론하지 않음): `cacheComponents` 제거, `@tailwindcss/turbopack`, error 컴포넌트 `retry` prop, 푸터 "패치 정보 없음".

---

## 3. 발견한 문제

> **쉬운 요약**: 완료 기준을 깨는 문제는 없다. 아래는 사용 경험이나 정확성을 조금 더 좋게 할 수 있는 낮은 우선순위 항목이다. 모두 계획 범위 밖이거나 판단이 필요한 것이라 수정하지 않았다.

| # | 심각도 | 위치 | 내용 | 수정 여부 |
|---|--------|------|------|-----------|
| 1 | 낮음 | `src/app/champions/[championId]/page.tsx` `generateMetadata` | Data Dragon 실패로 상세 페이지가 오류 화면이 될 때 `generateMetadata`도 예외를 던져 탭 제목이 비어 있다(브라우저가 URL을 제목으로 표시). 오류 화면 자체는 정상 표시됨. `try/catch`로 기본 제목을 주면 해결 | 미수정 (계획에 없는 동작, 선택 사항) |
| 2 | 낮음 (개발 모드 한정) | 상세 라우트 + `next dev` | Data Dragon 연결 실패 시 개발 모드에서는 개발 서버가 요청마다 `generateStaticParams`를 실행해 그 단계에서 실패하므로, `error.tsx` 대신 Next 기본 500 화면이 나온다. 프로덕션(`next build` + `next start`)에서는 `champions/error.tsx`가 정상 표시됨을 확인 | 미수정 (프로덕션 영향 없음) |
| 3 | 낮음 (접근성) | `src/components/champions/SkinGallery.tsx` 미리보기 | 미리보기 이미지 `alt`와 `figcaption`이 같은 스킨 이름이라 스크린리더가 이름을 두 번 읽을 수 있다. 계획서는 "스킨 = 스킨 이름 alt"로 정해 두어 현재 구현이 계획과 일치함 | 미수정 (계획 변경 필요) |
| 4 | 정보 | `src/components/layout/NavLink.tsx` | 상세 페이지(`/champions/Aatrox`)에서도 "챔피언" 메뉴에 `aria-current="page"`가 붙는다. 하위 경로 강조는 의도된 설계이나, 엄밀히는 하위 경로에서 `aria-current="true"`(또는 `"location"`)가 더 정확함 | 미수정 (계획 문구 "현재 경로면 aria-current=page"와 충돌하지 않음) |
| 5 | 보류 (알려진 문제) | ISR 캐시 + macOS | `front_build.md` 9-5: 소문자 URL(`/champions/garen`) 요청 시 macOS에서 정적 페이지 덮어쓰기. 사용자 결정에 따라 기록만 유지. 이번 검토에서는 소문자 URL을 요청하지 않았고, 검토 후에도 `Garen.html` 정상 | 미수정 (사용자 결정) |

참고(문제 아님): `/champions/Foo`처럼 미리 생성되지 않은 경로의 첫 요청에서는 스트리밍 때문에 상세 로딩 스켈레톤이 잠깐 보인 뒤 404 화면으로 바뀐다. 상태 코드는 404로 정상이다.

### 코드 품질 메모
- 구조가 계획서 3장과 같고, Data Dragon 관련 코드가 `lib/ddragon/`(상수·타입·API·이미지 URL·가공)에 깔끔히 나뉘어 있다.
- `Object.hasOwn` + `id` 일치 확인으로 `__proto__` 같은 키나 대소문자 다른 id를 걸러낸다.
- 클라이언트 컴포넌트는 계획대로 `ChampionBrowser`, `SkinGallery`, `NavLink`, `error.tsx` 2개뿐이다.
- 두 `error.tsx`(전역/목록)는 내용이 같다. 지금은 문제없지만, 문구를 바꿀 때 두 곳을 함께 고쳐야 한다.

---

## 4. 검증 명령과 결과

> **쉬운 요약**: 린트·타입·빌드는 모두 통과했고, 실제 서버를 띄워 상태 코드와 화면을 확인했다.

| 명령 / 확인 | 결과 |
|-------------|------|
| `npm run lint` | ✅ 종료 코드 0, 경고·오류 없음 |
| `npx next typegen` → `npx tsc --noEmit` | ✅ 종료 코드 0, 오류 없음 |
| `npm run build` | ✅ 성공. `○ /`, `○ /_not-found`, `○ /champions`, `● /champions/[championId]` 173개, 모두 Revalidate 1h, 총 178 페이지 |
| `next start -p 3100` + `curl` | `/` 307 → `/champions`, `/champions` 200, `/champions/Aatrox` 200, `/champions/MonkeyKing` 200, `/champions/Foo` 404, `/nope` 404 |
| 빌드 HTML 전수 검사 (173개) | `{{` 0건, 이스케이프된 HTML 태그 0건, 이중 이스케이프 엔티티 0건 |
| 브라우저 (내장 브라우저, 1280·768·360px) | 1장 체크리스트 근거 참고. 확인 후 뷰포트를 desktop으로 되돌림 |
| 오류 상태 모의 | 프로젝트를 건드리지 않도록 `src/`와 설정을 scratchpad로 복사해, 프록시를 닫힌 포트(`127.0.0.1:9`)로 지정해 Data Dragon 연결을 실패시킴. 프로덕션 빌드 + `next start`(데이터 캐시 삭제)에서 목록·상세 모두 오류 화면 + [다시 시도], 푸터 "패치 정보 없음", 상세 응답 500. 개발 모드 결과는 3장 #2 |
| 서버 정리 | 검토용 서버(3100, 3101) 모두 종료. 3000번의 `next dev`(PID 17639)는 검토 전부터 실행 중이던 사용자 서버라 건드리지 않음 |
| git 상태 | 검토 전후 `frontend/` 변경 없음 (이 문서만 추가) |
| `npm audit` | 범위 밖 (확인하지 않음) |

---

## 5. 수정한 파일

없음. 완료 기준을 깨는 버그가 없어 `frontend/src/`와 `front_build.md`는 수정하지 않았다.
