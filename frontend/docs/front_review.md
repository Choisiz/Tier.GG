# 프론트엔드 검토 기록 — 변경 02 (sr-only 요약 순서 + 사소한 정리)

> 이 문서는 **가장 최근 검토**만 둔다. 변경 01 검토 원문은 git 기록에 있고(`front_build.md`가 가리키는 커밋), 아직 남은 문제는 `front_overview.md` "해결되지 않은 점"에 있다.
> 작성: Review 에이전트 (Build와 별도) / 검토일: 2026-10-17
> 기준: `front_spec.md`(변경 02, D12), `front_build.md`, `docs/contracts/api_contract.md` v2
> 검토 환경: 실제 백엔드(이미 떠 있던 `backend` 4000) + 운영 빌드(`npm run build` + `npm start -p 3000`), 내장 브라우저. 저장소의 `backend/`·`db/`·계약 문서는 건드리지 않았다.

## 목차

- [0. 결론](#0-결론)
- [1. 항목별 결과](#1-항목별-결과)
- [2. `chosenNames` 로직 확인](#2-chosennames-로직-확인)
- [3. 발견한 문제](#3-발견한-문제)
- [4. 브라우저 확인](#4-브라우저-확인)
- [5. 명령 검증](#5-명령-검증)
- [6. 범위 확인](#6-범위-확인)
- [7. 수정한 파일](#7-수정한-파일)

---

## 0. 결론

**PASS.** 변경 02의 완료 기준(D12: sr-only 요약 순서를 트리 줄 순서로)을 포함해 Build가 보고한 4가지 수정(`chosenNames`, `CHAMPION_TAGS` 삭제, `TierBadge` 주석, `layout.tsx` description) 모두 코드와 일치했다. 린트·타입·빌드 통과, 브라우저 확인(룬 격자·1/2순위 전환·sr-only 요약·404·360px/1280px) 모두 정상. 발견한 문제 없음, 수정한 파일 없음.

## 1. 항목별 결과

| 확인 항목 | 결과 |
|---|---|
| 승인된 요구사항(D1~D3 추천안, 즉 D12 설계) 충족 | ✅ |
| `chosenNames` 코드 오류·유지보수 문제 | ✅ 문제 없음 (2장) |
| `toRunePage` 호출부 인자 제거 | ✅ 호출부(`app/champions/[championId]/page.tsx:80`)는 애초에 `(rune, runeTrees)`만 넘겼고 `toRunePage` 자체 시그니처는 안 바뀌어 영향 없음 |
| `CHAMPION_TAGS` 다른 곳 미사용 | ✅ `grep -rn "CHAMPION_TAGS" src/` 0건 |
| `TierBadge` 주석과 실제 대비값 | ✅ 브라우저에서 실측 (4장) |
| `layout.tsx` description | ✅ 적절한 길이(37자)와 내용. 단, 상세 페이지 등 개별 라우트가 자체 `description`을 두고 있어 이 기본값은 메타데이터를 안 정한 라우트(404 등)에서만 보인다. 확인함 |
| 브라우저 동작(룬 격자, 1/2순위, 티어 표, 포지션 탭) | ✅ 4장 |
| sr-only 요약이 트리 줄 순서 | ✅ 4장 |
| 로딩/빈 결과/오류 상태 | ✅ 존재하지 않는 챔피언 404, "← 목록" 동작 확인 |
| 모바일/데스크톱 (360px·1280px 수준) | ✅ 375px·1280px에서 가로 스크롤 없음 |
| 기본 접근성 (sr-only 요약) | ✅ 4장 |
| 타입 검사·린트·빌드 | ✅ 5장 |
| 범위 (계약·백엔드·DB 미수정) | ✅ 6장 |
| scratchpad 임시 파일 잔존 여부 | ✅ 저장소에 스크래치 파일 없음 (`git status` 깨끗) |

## 2. `chosenNames` 로직 확인

`frontend/src/lib/view/builds.ts`를 직접 읽고 확인했다.

```ts
function chosenNames(tree: RuneTreeView): string[] {
  return tree.rows.flatMap((row) => row.filter((cell) => cell.selected).map((cell) => cell.name));
}
```

- `tree.rows`는 `toRuneTree`가 만든 트리 줄(화면 격자와 같은 순서)이고, 못 찾은 룬은 `toRuneTree`가 이미 맨 아래에 별도 줄로 붙여 둔다(58~78번 줄). 그래서 `chosenNames`는 **API `perks` 순서를 전혀 참조하지 않고도** 트리 순서 + 못 찾은 룬 뒤처리가 자동으로 유지된다. 설계가 단순하고 올바르다.
- 호출부(117~118번 줄)에서 `chosenNames(primary)` / `chosenNames(secondary)`로 바뀌어 더 이상 `build.primaryPerks`/`build.subPerks`를 넘기지 않는다 — 안 쓰는 인자가 남지 않았다.
- 핵심 룬 결과가 실제로 바뀌지 않는지: 핵심 트리(`primary`)는 `rowStart=0`이라 트리 전체 줄을 쓰고, 보조 트리는 `rowStart=1`(핵심 룬 줄 제외)이라 집합이 다르다. 두 결과 모두 이전 로직(`perks.map(id => byId.get(id))`)과 동일한 "고른 룬들의 이름 집합"을 만들되 순서만 트리 순서로 바뀐다 — 핵심 룬처럼 API 순서와 트리 순서가 같은 경우 결과가 그대로이고(아래 4장에서 실측), 보조 룬처럼 `!db` 변경 04 이후 API 순서가 바뀐 경우에만 순서가 달라진다는 설계 의도와 일치한다.
- `byId`(Map) 방식을 버리고 `rows`를 직접 순회하므로 "트리에서 못 찾은 룬"과 "트리에는 있지만 고르지 않은 룬"을 혼동할 여지가 없다 (`cell.selected`로만 판단).

## 3. 발견한 문제

없음.

## 4. 브라우저 확인

`npm run build`(백엔드 켬) 성공 후 `npm start`로 운영 빌드를 띄워 확인했다.

- **아트록스 상세, 1순위 룬**: sr-only 요약 `핵심 룬(정밀): 정복자, 승전보, 전설: 가속, 최후의 저항. 보조 룬(결의): 뼈 방패, 소생. 능력치 파편: …`. 접근성 트리와 화면에서 강조된 칸을 줄 순서로 짚어보면 정확히 이 순서(1줄 "정복자" → 2줄 "승전보" → 3줄 "전설: 가속" → 4줄 "최후의 저항", 보조는 2줄 "뼈 방패" → 3줄 "소생")로 나왔다 — 트리 줄 순서와 일치.
- **2순위로 전환**: 버튼 클릭으로 핵심 룬(공통 "정복자")은 그대로, 보조 룬 강조 칸만 바뀌는 것을 스크린샷으로 확인.
- **룬 격자 자체**: 변경 02가 `toRuneTree`를 건드리지 않아 강조 표시·칸 배치가 변경 전과 같다 (코드 diff로도 확인).
- **404**: `/champions/NoSuchChampion` → "챔피언을 찾을 수 없습니다" + [챔피언 목록으로], `document.title` "챔피언을 찾을 수 없습니다 | Tier.GG", `meta[name=description]`이 새 기본값("리그 오브 레전드 챔피언 티어와 추천 빌드, 스킨을 한눈에 볼 수 있는 Tier.GG")으로 떨어지는 것 확인 — `layout.tsx` 변경이 실제로 반영됨.
- **티어 표** (`/champions`, 1280px): 1~2티어 배지, 포지션 탭 5개, 정상 렌더.
- **대비값 실측**: 브라우저에서 `bg-{red,orange,yellow,green,sky}-400` + `text-zinc-950` 배지를 실제로 렌더해 캔버스로 sRGB 변환 후 WCAG 공식으로 계산 → `6.89 / 8.37 / 12.64 / 11.18 / 9.13`. `TierBadge.tsx`의 새 주석 "대비 최소 6.89:1, 기준 4.5:1 이상"과 정확히 일치 (1티어 red-400이 최소값).
- **360px급(375px)·1280px**: `document.documentElement.scrollWidth === window.innerWidth`로 상세·목록 페이지 모두 확인, 가로 스크롤 없음.

## 5. 명령 검증

| 명령 | 결과 |
|---|---|
| `npm run lint` | 오류·경고 0 |
| `npx next typegen && npx tsc --noEmit` | 오류 0 |
| `npm run build` (백엔드 켬, `http://localhost:4000` 응답) | 183페이지 성공 (`○ /`, `/champions`, `●` 상세 173 + 레인 5), 경고 없음 |

## 6. 범위 확인

- `git diff --stat -- docs/contracts backend db` 결과 없음 — 계약 문서·백엔드·DB 코드 미수정.
- Build 보고의 "scratchpad 임시 스크립트로 검증, 저장소에 파일 추가 없음"은 `git status`가 깨끗한 것으로 확인됨.

## 7. 수정한 파일

없음 (결함을 찾지 못해 수정할 것이 없었다).
