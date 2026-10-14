# Tier.GG API 계약 (백엔드 ↔ 프론트)

> 이 문서는 `!백엔드`가 작성하고 `!프론트`가 읽는 계약 문서다. 엔드포인트, 파라미터, 응답 형식, 오류 형식을 정한다. (CLAUDE.md 9장)

- 상태: **승인됨 (2026-10-14)** — `backend/docs/back_spec.md`와 함께 승인
- 근거: `docs/contracts/db_contract.md` v6 (집계 테이블, `champion_tier_view`)
- 범위: 챔피언 티어리스트(포지션별) + 챔피언 상세(포지션, 빌드). 전적 검색·SSE는 포함하지 않는다.

---

## 1. 기본 규칙

> 요약: 읽기 전용 GET만 있고, JSON으로 답한다. 숫자 ID만 주므로 이름·이미지는 프론트가 Data Dragon으로 붙인다.

| 항목 | 규칙 |
|------|------|
| 기본 URL | 개발: `http://localhost:4000/api/v1` (`API_PORT`, 기본 4000). 프론트는 서버 환경 변수로 기본 URL을 받는다 |
| 버전 | 경로 앞 `/api/v1`. 호환이 깨지는 변경은 `/api/v2`로. 필드 추가는 같은 버전에서 할 수 있으므로 프론트는 모르는 필드를 무시한다 |
| 메서드 | `GET`만 |
| 형식 | `Content-Type: application/json; charset=utf-8`. 필드 이름은 camelCase |
| 인증 | 없음 (공개 통계). Riot 키·DB 정보는 백엔드에만 있다 |
| 호출 위치 | Next.js 서버 컴포넌트에서 호출 (서버 간). CORS 헤더는 주지 않는다 |
| 비율 | 퍼센트 숫자, 소수 2자리 (`52.31` = 52.31%) |
| 패치 | `"16.19"` 형식 문자열 (`^[0-9]+\.[0-9]+$`). 순서는 숫자 비교 (`16.9` < `16.19`) |
| 포지션 | `TOP` `JUNGLE` `MIDDLE` `BOTTOM` `UTILITY` (대문자만) |
| 날짜 | ISO 8601 UTC (`2026-10-14T09:12:33.000Z`) |

---

## 2. 엔드포인트

> 요약: 4개다. 화면마다 한 번 호출로 필요한 데이터를 다 받는다.

| 메서드·경로 | 화면 |
|-------------|------|
| `GET /api/v1/health` | (운영 확인) |
| `GET /api/v1/meta` | 공통 (패치 표시, 패치 선택) |
| `GET /api/v1/champions` | 챔피언 리스트 (포지션별 티어) |
| `GET /api/v1/champions/:championId` | 챔피언 상세 (포지션 + 빌드) |

### 2-0. 표시 패치 규칙 (모든 통계 엔드포인트 공통)

> 요약: `patch`를 안 주면 백엔드가 고른다. 새 패치 초반에 표본이 적으면 직전 패치를 보여주고 `isFallback: true`로 알린다.

1. `patch`를 주면 그 패치를 쓴다 (대체 없음). 없으면 `404 PATCH_NOT_FOUND`.
2. `patch`를 안 주면:
   - 최신 패치 = 집계된 패치 중 가장 높은 패치.
   - 최신 패치의 `games`가 **5,000 미만**이고, 직전 패치가 있고, 직전 패치의 `games`가 더 많으면 → **직전 패치**.
   - 아니면 최신 패치.
3. 집계된 패치가 하나도 없으면 `503 STATS_NOT_READY`.

모든 통계 응답에 들어가는 `patch` 객체:

| 필드 | 타입 | null | 의미 |
|------|------|------|------|
| `patch.data` | string | 아니오 | 이 응답의 숫자가 나온 패치 |
| `patch.latest` | string | 아니오 | 집계된 최신 패치 |
| `patch.requested` | string | 예 | 요청에 준 `patch` (안 줬으면 `null`) |
| `patch.isFallback` | boolean | 아니오 | 최신 패치 대신 직전 패치를 보여주면 `true` |
| `patch.games` | int | 아니오 | `patch.data`의 전체 게임 수 (픽률·밴률 분모) |

- 화면 표시 예: `isFallback`이면 "16.20 패치 표본이 부족해 16.19 패치 통계를 보여줍니다".

---

### 2-1. `GET /api/v1/health`

> 요약: 서버와 DB가 살아 있는지 확인한다. 화면에서는 쓰지 않는다.

- 파라미터 없음.

```http
GET /api/v1/health
```

```json
{ "status": "ok", "db": "ok" }
```

| 필드 | 타입 | 의미 |
|------|------|------|
| `status` | `"ok"` | 서버 응답 |
| `db` | `"ok"` | `SELECT 1` 성공. 실패하면 `503 DB_UNAVAILABLE` |

- 캐시: `no-store`.

---

### 2-2. `GET /api/v1/meta`

> 요약: 지금 보여줄 패치, 패치 목록, 마지막 수집 시각, 화면에 적을 규칙 값을 준다.

- 파라미터 없음.

```http
GET /api/v1/meta
```

```json
{
  "latestPatch": "16.20",
  "defaultPatch": "16.19",
  "isFallback": true,
  "patches": [
    { "patch": "16.20", "games": 812 },
    { "patch": "16.19", "games": 2712 }
  ],
  "lastCollectedAt": "2026-10-14T09:12:33.000Z",
  "positions": ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"],
  "rules": {
    "minTierPick": 50,
    "secondaryPositionMinShare": 10,
    "fallbackMinGames": 5000
  }
}
```

| 필드 | 타입 | null | 의미 |
|------|------|------|------|
| `latestPatch` | string | 아니오 | 집계된 최신 패치 |
| `defaultPatch` | string | 아니오 | `patch`를 안 주면 통계 엔드포인트가 쓰는 패치 (2-0) |
| `isFallback` | boolean | 아니오 | `defaultPatch ≠ latestPatch`이면 `true` |
| `patches[]` | array | 아니오 | 집계된 모든 패치, 최신 순. 원본을 지운 오래된 패치도 집계는 남아 있어 목록에 있다 |
| `patches[].patch` | string | 아니오 | 패치 |
| `patches[].games` | int | 아니오 | 그 패치의 전체 게임 수 |
| `lastCollectedAt` | string | 예 | 마지막으로 `done`으로 끝난 수집의 끝난 시각. 없으면 `null` |
| `positions` | string[] | 아니오 | 포지션 순서 (탭 순서로 사용) |
| `rules.minTierPick` | int | 아니오 | 이 판 수 미만이면 `tier`가 `null` ("표본 부족") |
| `rules.secondaryPositionMinShare` | number | 아니오 | 2순위 포지션 최소 비율(%) |
| `rules.fallbackMinGames` | int | 아니오 | 직전 패치 대체 기준 게임 수 |

- 집계된 패치가 없으면 `503 STATS_NOT_READY`.

---

### 2-3. `GET /api/v1/champions` — 포지션별 티어리스트

> 요약: 그 포지션을 주 포지션으로 쓰는 챔피언을 티어(1→5) → 점수 순으로 준다. 표본이 부족한 챔피언은 `tier: null`로 맨 뒤에 온다.

#### 파라미터 (쿼리)

| 이름 | 필수 | 형식 | 검사 | 예 |
|------|------|------|------|-----|
| `position` | 예 | `TOP` `JUNGLE` `MIDDLE` `BOTTOM` `UTILITY` | 대문자 정확히 일치. 없거나 다르면 400 | `TOP` |
| `patch` | 아니오 | `^[0-9]+\.[0-9]+$`, 10자 이하 | 형식이 틀리면 400, 없는 패치면 404 | `16.19` |

```http
GET /api/v1/champions?position=TOP
```

```json
{
  "patch": {
    "data": "16.19",
    "latest": "16.20",
    "requested": null,
    "isFallback": true,
    "games": 2712
  },
  "position": "TOP",
  "champions": [
    {
      "rank": 1,
      "championId": 266,
      "tier": 1,
      "tierScore": 53.355,
      "winRate": 52.82,
      "pickRate": 9.14,
      "banRate": 14.31,
      "pick": 248,
      "win": 131,
      "ban": 388,
      "positionShare": 97.25,
      "mainPositions": ["TOP"]
    },
    {
      "rank": 2,
      "championId": 23,
      "tier": 2,
      "tierScore": 51.793,
      "winRate": 53.01,
      "pickRate": 3.06,
      "banRate": 4.02,
      "pick": 83,
      "win": 44,
      "ban": 109,
      "positionShare": 86.46,
      "mainPositions": ["TOP", "MIDDLE"]
    },
    {
      "rank": 38,
      "championId": 164,
      "tier": null,
      "tierScore": 51.655,
      "winRate": 55.26,
      "pickRate": 1.40,
      "banRate": 2.18,
      "pick": 38,
      "win": 21,
      "ban": 59,
      "positionShare": 100.00,
      "mainPositions": ["TOP"]
    }
  ]
}
```

| 필드 | 타입 | null | 의미 |
|------|------|------|------|
| `patch` | object | 아니오 | 2-0 |
| `position` | string | 아니오 | 요청한 포지션 |
| `champions[]` | array | 아니오 | 정렬된 목록. 비어 있을 수 있음 (`[]`) |
| `rank` | int | 아니오 | 1부터 시작하는 표시 순서 (`tier: null` 포함) |
| `championId` | int | 아니오 | Data Dragon `champion.json`의 `key` (예: 266 = Aatrox) |
| `tier` | int (1~5) | **예** | 티어. `null` = 표본 부족 (pick 50 미만). DB 값 그대로 |
| `tierScore` | number | 아니오 | 티어 점수 (소수 3자리, 정렬용 표시값) |
| `winRate` | number | 아니오 | 승률 % |
| `pickRate` | number | 아니오 | 픽률 % (`pick / games`) |
| `banRate` | number | 아니오 | 밴률 % (포지션과 무관, 같은 챔피언은 모든 포지션에서 같은 값) |
| `pick` / `win` / `ban` | int | 아니오 | 이 포지션의 게임 수 / 승리 수 / 밴된 게임 수 |
| `positionShare` | number | 아니오 | 이 챔피언 전체 pick 중 이 포지션의 비율 % |
| `mainPositions` | string[] | 아니오 | 그 챔피언의 주 포지션 1~2개, 많은 순 |

- **목록에 들어가는 챔피언:** 그 포지션이 `mainPositions`에 들어 있는 챔피언만. 주 포지션 = 챔피언별 pick 많은 순 최대 2개, 2순위는 그 챔피언 전체 pick의 10% 이상일 때만.
- **정렬:** `tier` 오름차순(`null`은 맨 뒤) → `tierScore` 내림차순 → `championId` 오름차순.
- **`tier`를 `tierScore`로 다시 계산하지 않는다.** 표시 점수는 반올림 값이고 티어는 반올림 전 점수로 정해져, 경계(예: `53.000`)에서 결과가 다를 수 있다 (db_review L4).
- 테스트 수집(약 2,700게임) 단계에서는 대부분 `tier: null`이 정상이다.

---

### 2-4. `GET /api/v1/champions/:championId` — 챔피언 상세

> 요약: 한 챔피언의 주 포지션(최대 2개)과, 고른 포지션의 통계와 빌드(아이템 전체, 룬·스펠·스킬 상위 2개)를 준다.

#### 파라미터

| 이름 | 위치 | 필수 | 형식 | 검사 | 예 |
|------|------|------|------|------|-----|
| `championId` | 경로 | 예 | 숫자 (Data Dragon `key`) | `^[1-9][0-9]{0,4}$`. 아니면 400 | `23` |
| `position` | 쿼리 | 아니오 | 1장의 포지션 | 대문자 정확히 일치. 안 주면 1순위 주 포지션 | `TOP` |
| `patch` | 쿼리 | 아니오 | 패치 | 2-3과 같음 | `16.19` |

- 프론트 라우트는 영문 id(`/champions/Tryndamere`)이므로 `champion.json`에서 `key`(`"23"`)를 찾아 부른다.
- `position`을 주면 주 포지션이 아니어도 그 포지션 통계가 있으면 준다 (`isMainPosition: false`).

```http
GET /api/v1/champions/23?position=TOP
```

```json
{
  "patch": {
    "data": "16.19",
    "latest": "16.20",
    "requested": null,
    "isFallback": true,
    "games": 2712
  },
  "championId": 23,
  "position": "TOP",
  "isMainPosition": true,
  "positions": [
    {
      "position": "TOP",
      "pick": 83,
      "positionShare": 86.46,
      "tier": 2,
      "tierScore": 51.793,
      "winRate": 53.01,
      "pickRate": 3.06
    },
    {
      "position": "MIDDLE",
      "pick": 11,
      "positionShare": 11.46,
      "tier": null,
      "tierScore": 49.711,
      "winRate": 45.45,
      "pickRate": 0.41
    }
  ],
  "stats": {
    "tier": 2,
    "tierScore": 51.793,
    "winRate": 53.01,
    "pickRate": 3.06,
    "banRate": 4.02,
    "pick": 83,
    "win": 44,
    "ban": 109
  },
  "builds": {
    "items": [
      { "itemId": 3006, "pick": 61, "win": 34, "winRate": 55.74, "pickRate": 73.49 },
      { "itemId": 3046, "pick": 55, "win": 31, "winRate": 56.36, "pickRate": 66.27 },
      { "itemId": 1036, "pick": 40, "win": 19, "winRate": 47.50, "pickRate": 48.19 },
      { "itemId": 3031, "pick": 37, "win": 22, "winRate": 59.46, "pickRate": 44.58 },
      { "itemId": 1018, "pick": 30, "win": 14, "winRate": 46.67, "pickRate": 36.14 },
      { "itemId": 3074, "pick": 18, "win": 11, "winRate": 61.11, "pickRate": 21.69 }
    ],
    "runes": [
      {
        "primaryStyle": 8100,
        "primaryPerks": [9923, 8143, 8140, 8135],
        "subStyle": 8000,
        "subPerks": [8299, 9104],
        "statPerks": { "offense": 5008, "flex": 5008, "defense": 5011 },
        "pick": 29, "win": 16, "winRate": 55.17, "pickRate": 34.94
      },
      {
        "primaryStyle": 8000,
        "primaryPerks": [8010, 9111, 9104, 8299],
        "subStyle": 8400,
        "subPerks": [8444, 8242],
        "statPerks": { "offense": 5005, "flex": 5008, "defense": 5011 },
        "pick": 21, "win": 11, "winRate": 52.38, "pickRate": 25.30
      }
    ],
    "spells": [
      { "spellIds": [4, 14], "pick": 52, "win": 28, "winRate": 53.85, "pickRate": 62.65 },
      { "spellIds": [4, 6], "pick": 19, "win": 10, "winRate": 52.63, "pickRate": 22.89 }
    ],
    "skills": [
      { "skillOrder": "QEWQQRQEQER", "pick": 24, "win": 13, "winRate": 54.17, "pickRate": 28.92 },
      { "skillOrder": "EQWQQRQEQER", "pick": 15, "win": 8, "winRate": 53.33, "pickRate": 18.07 }
    ]
  }
}
```

#### 필드

| 필드 | 타입 | null | 의미 |
|------|------|------|------|
| `patch` | object | 아니오 | 2-0 |
| `championId` | int | 아니오 | 요청한 챔피언 |
| `position` | string | 아니오 | 이 응답의 `stats`·`builds`가 속한 포지션 |
| `isMainPosition` | boolean | 아니오 | `position`이 `positions[]`에 있으면 `true` |
| `positions[]` | array | 아니오 | 주 포지션 1~2개, pick 많은 순 (포지션 탭) |
| `positions[].position` | string | 아니오 | 포지션 |
| `positions[].pick` | int | 아니오 | 그 포지션 게임 수 |
| `positions[].positionShare` | number | 아니오 | 그 챔피언 전체 pick 중 비율 % |
| `positions[].tier` | int (1~5) | **예** | `null` = 표본 부족 |
| `positions[].tierScore`, `winRate`, `pickRate` | number | 아니오 | 2-3과 같은 뜻 |
| `stats` | object | 아니오 | 선택 포지션의 요약. 필드 뜻은 2-3과 같음 (`tier`만 null 가능) |
| `builds.items[]` | array | 아니오 | 그 아이템을 **가지고 끝난** 게임 수 기준, **모든 아이템**, pick 내림차순. 하위 재료 포함 |
| `builds.items[].itemId` | int | 아니오 | Data Dragon `item.json`의 키 |
| `builds.runes[]` | array | 아니오 | 룬 페이지 전체 조합, 상위 2개 |
| `builds.runes[].primaryStyle` / `subStyle` | int | 아니오 | 핵심 / 보조 룬 트리 (`runesReforged.json`의 `id`) |
| `builds.runes[].primaryPerks` | int[4] | 아니오 | 핵심 룬 4개, 순서대로 (0번이 핵심 룬) |
| `builds.runes[].subPerks` | int[2] | 아니오 | 보조 룬 2개 |
| `builds.runes[].statPerks` | object | 아니오 | 능력치 파편 `offense` / `flex` / `defense` (Data Dragon에 없음, 5장) |
| `builds.spells[]` | array | 아니오 | 소환사 주문 조합, 상위 2개 |
| `builds.spells[].spellIds` | int[2] | 아니오 | `[작은 번호, 큰 번호]`. D/F 위치 정보는 없다 |
| `builds.skills[]` | array | 아니오 | 스킬 찍는 순서 앞 11레벨, 상위 2개 |
| `builds.skills[].skillOrder` | string | 아니오 | `^[QWER]{11}$`, 1번째 글자 = 1레벨 |
| 각 빌드 `pick` / `win` | int | 아니오 | 그 조합의 게임 수 / 승리 수 |
| 각 빌드 `winRate` | number | 아니오 | `win / pick` % |
| 각 빌드 `pickRate` | number | 아니오 | 사용률 = `pick / stats.pick` % |

- 빈 배열 가능: 표본이 아주 적으면 `runes`·`spells`·`skills`가 `[]`일 수 있다 (`skills`는 11레벨 미만 게임이 빠짐).
- `runes`·`spells`·`skills`는 DB에 상위 10개만 있어 `pickRate` 합이 100%가 아니다.
- **아이템은 프론트가 거른다:** Data Dragon `item.json`에서 `into`가 있는 아이템(하위 재료)과 장신구·소모품을 빼고 상위 2개를 보여준다. 그래서 백엔드는 전체를 준다.
- `stats.banRate`는 포지션과 무관하다.

#### 오류

| 상황 | 응답 |
|------|------|
| `championId` 형식 오류, `position` 오류, `patch` 형식 오류 | `400 INVALID_PARAMETER` |
| 준 `patch`가 없음 | `404 PATCH_NOT_FOUND` |
| 그 패치에 이 챔피언 통계가 없음 (새 챔피언, 한 번도 안 나옴) | `404 STATS_NOT_FOUND` — 프론트는 Data Dragon 정보만으로 상세를 그리고 "통계 없음" 표시 |
| `position`을 줬는데 그 포지션 통계가 없음 | `404 STATS_NOT_FOUND` (`details.position` 포함) |

---

## 3. 오류 형식

> 요약: 모든 오류는 같은 모양의 JSON이다. `code`로 분기하고, `message`는 사람이 읽는 한국어 설명이다.

```json
{
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "position은 TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY 중 하나여야 합니다.",
    "details": { "param": "position", "value": "top" }
  }
}
```

| 필드 | 타입 | null | 의미 |
|------|------|------|------|
| `error.code` | string | 아니오 | 아래 표의 코드 |
| `error.message` | string | 아니오 | 설명 (바뀔 수 있으니 분기에 쓰지 않음) |
| `error.details` | object | 예 (없으면 필드 생략) | 문제 파라미터 등 |

| HTTP | `code` | 의미 |
|------|--------|------|
| 400 | `INVALID_PARAMETER` | 파라미터 형식 오류 (`details.param`, `details.value`) |
| 404 | `PATCH_NOT_FOUND` | 요청한 패치의 집계가 없음 (`details.patch`) |
| 404 | `STATS_NOT_FOUND` | 그 챔피언(·포지션) 통계가 그 패치에 없음 (`details.championId`, `details.position`, `details.patch`) |
| 404 | `NOT_FOUND` | 없는 경로 |
| 503 | `STATS_NOT_READY` | 집계된 패치가 하나도 없음 (첫 수집 전) |
| 503 | `DB_UNAVAILABLE` | DB 연결 실패 |
| 500 | `INTERNAL_ERROR` | 그 밖의 서버 오류. 내부 내용은 응답에 넣지 않음 |

---

## 4. 캐시

> 요약: 데이터는 수동 수집 때만 바뀐다. 성공 응답은 10분 캐시를 허용하고, 실제 캐시는 Next.js의 `revalidate: 3600`이 맡는다.

| 응답 | 헤더 |
|------|------|
| 성공 (`meta`, `champions`, 상세) | `Cache-Control: public, max-age=600` |
| `health`, 모든 오류 | `Cache-Control: no-store` |

- 프론트 권장: `fetch(url, { next: { revalidate: 3600 } })` (Data Dragon 버전 확인 주기와 같음). Next.js는 이 응답 헤더가 아니라 `revalidate` 값으로 캐시한다.
- 수집·집계 직후 바로 보고 싶으면 프론트에서 재검증(태그·경로 revalidate)으로 처리한다 (프론트 범위).
- ETag·304는 이번 버전에 없다.

---

## 5. Data Dragon 매핑 (프론트가 붙이는 것)

> 요약: 백엔드는 숫자 ID만 준다. 아래 표대로 Data Dragon에서 이름·이미지를 찾는다.

| 응답 필드 | Data Dragon 파일 | 찾는 방법 | 비고 |
|-----------|------------------|-----------|------|
| `championId` | `champion.json` | `data[*].key == String(championId)` → 영문 `id`(이미지·라우트), `name` | 예: `23` → `Tryndamere` |
| `builds.items[].itemId` | `item.json` | `data[String(itemId)]` → `name`, `into`(하위 재료 거르기), 이미지 `img/item/{itemId}.png` | 새 패치에서 없어진 아이템은 없을 수 있음 → 아래 버전 참고 |
| `builds.spells[].spellIds[]` | `summoner.json` | `data[*].key == String(spellId)` → 문자열 `id`(`SummonerFlash`), `name` | 예: `4` 점멸, `14` 점화, `6` 유체화, `12` 순간이동, `11` 강타 |
| `builds.runes[].primaryStyle`, `subStyle` | `runesReforged.json` | 최상위 `[].id` | 예: `8000` 정밀, `8100` 지배, `8400` 결의 |
| `builds.runes[].primaryPerks[]`, `subPerks[]` | `runesReforged.json` | `[].slots[].runes[].id` → `name`, `icon` (`/cdn/img/{icon}`) | |
| `builds.runes[].statPerks.*` | **없음** | Data Dragon에 능력치 파편이 없다. 프론트가 작은 표를 둔다 | 예: `5008` 적응형 능력치, `5005` 공격 속도, `5007` 스킬 가속, `5010` 이동 속도, `5011` 체력, `5013` 강인함, `5001` 체력 증가 |
| `builds.skills[].skillOrder` | `champion/{id}.json` | 글자 `Q/W/E/R` → `spells[0..3]` (이름·아이콘) | |

- **버전:** 통계 패치 `16.19`의 Data Dragon 버전은 보통 `16.19.1`이다. 이름·이미지는 최신 버전을 써도 되지만, 그 패치에만 있던 아이템을 찾을 수 없으면 `{patch.data}.1` 버전의 `item.json`을 한 번 더 보는 것을 권장한다.
- 백엔드는 Data Dragon을 부르지 않는다.

---

## 6. 변경 기록

| 날짜 | 버전 | 내용 |
|------|------|------|
| 2026-10-14 | 초안 | 엔드포인트 4개 (`health`, `meta`, `champions`, `champions/:championId`) |
