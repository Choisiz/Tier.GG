# Tier.GG API 계약 (백엔드 ↔ 프론트)

> 이 문서는 `!백엔드`가 작성하고 `!프론트`가 읽는 계약 문서다. 엔드포인트, 파라미터, 응답 형식, 오류 형식을 정한다. (CLAUDE.md 9장)

- 상태: **v3 (구현 반영)** — `backend/docs/back_spec.md` "변경 03"과 함께 승인 (2026-10-27). 2-5 전적 검색 추가. 나머지(1~4·6장, 2-0~2-4)는 v2(변경 02)와 같다.
- 근거: `docs/contracts/db_contract.md` **v8**. 2-5(전적 검색)는 DB를 쓰지 않고 Riot API를 그대로 중계한다 (back_spec 변경 03 W-6, 계약 변경 요청 없음).
- 범위: 챔피언 티어리스트(포지션별) + 챔피언 상세(포지션, 빌드) + **전적 검색**(프로필·랭크·최근 매치 20건, 2-5). 통계(2-0~2-4)는 **최근 14일에 시작한 게임** 기준. SSE·과거 매치 더보기·스킬 순서(전적 검색)는 포함하지 않는다.

### v1 → v2 변경 (2026-10-15, 백엔드 변경 01)

| 변경 | v1 | v2 | 이유 |
|------|----|----|------|
| 통계 단위 | 패치 1개 | 최근 14일 창 1개 (하루 1번 05:00 KST 갱신) | DB v7 (db_spec 변경 03) |
| `patch` 쿼리 (`/champions`, 상세) | 있음 | **없음** (보내도 무시) | 창이 1개뿐 |
| 직전 패치 대체 규칙 (2-0, `isFallback`, `fallbackMinGames`) | 있음 | **없음** | 14일 창이라 새 패치 직후 표본 급감이 없음 |
| 통계 응답의 `patch` 객체 | `{data, latest, requested, isFallback, games}` | **`window` 객체** `{days, start, end, games, aggregatedAt, isStale, patches[]}` (2-0) | 어느 기간의 숫자인지, 패치가 어떻게 섞였는지 보여줌 |
| 패치 이름 | 내부 값만 (`16.20`) | `patch`(내부) + **`displayName`**(공개, 메이저 + 10 → `26.20`) | 공개 패치 이름과 맞춤 (사용자 결정) |
| 패치 구성 비율 | 없음 | `window.patches[].share` (백엔드 계산, 소수 2자리) | 두 패치가 섞이는 시기를 투명하게 |
| 집계 멈춤 표시 | 없음 | `window.isStale` (26시간), `/health`의 `stats` | 예약 작업 실패에 알림이 없음 (db_review L7) |
| `/meta` | `latestPatch`, `defaultPatch`, `isFallback`, `patches[]` | `window`. `rules`에 `windowDays`, `staleAfterHours` (`fallbackMinGames` 삭제) | 위와 같음 |
| 오류 `PATCH_NOT_FOUND` | 있음 | **삭제**. `STATS_NOT_FOUND`의 `details.patch` 삭제 | `patch` 쿼리가 없음 |
| `STATS_NOT_READY` 뜻 | 집계된 패치 없음 | 집계된 창 없음 (첫 집계 전) | |
| 읽기 일관성 | (규칙 없음) | 한 응답의 숫자는 모두 한 스냅숏에서 나옴 (1장) | 05:00 집계 커밋 순간 섞임 방지 (db_review L11) |
| 경로 | `/api/v1` | `/api/v1` 그대로 | 아직 이 API를 쓰는 화면이 없음 (back_spec 변경 01 D14) |

---

## 1. 기본 규칙

> 요약: 읽기 전용 GET만 있고, JSON으로 답한다. 숫자 ID만 주므로 이름·이미지는 프론트가 Data Dragon으로 붙인다. 통계는 최근 14일 창 하나이고, 한 응답 안의 숫자는 모두 같은 집계에서 나온다.

| 항목 | 규칙 |
|------|------|
| 기본 URL | 개발: `http://localhost:4000/api/v1` (`API_PORT`, 기본 4000). 프론트는 서버 환경 변수로 기본 URL을 받는다 |
| 버전 | 경로 앞 `/api/v1`. 필드 추가는 같은 버전에서 할 수 있으므로 프론트는 모르는 필드를 무시한다. 백엔드도 모르는 쿼리 파라미터를 무시한다 |
| 메서드 | `GET`만 |
| 형식 | `Content-Type: application/json; charset=utf-8`. 필드 이름은 camelCase |
| 인증 | 없음 (공개 통계). Riot 키·DB 정보는 백엔드에만 있다 |
| 호출 위치 | Next.js 서버 컴포넌트에서 호출 (서버 간). CORS 헤더는 주지 않는다 |
| 비율 | 퍼센트 숫자, 소수 2자리 (`52.31` = 52.31%) |
| 통계 기간 | 최근 14일에 시작한 게임 (`window.start` 포함 ~ `window.end` 제외). DB 예약 작업이 **매일 05:00 KST(20:00 UTC)** 에 다시 집계한다 |
| 패치 | `patch`: 내부 값 `"16.20"` (`^[0-9]+\.[0-9]+$`, Data Dragon 버전에 씀). `displayName`: 화면에 쓰는 공개 이름 `"26.20"` (= 메이저 + 10). **화면에는 `displayName`만 쓴다** |
| 포지션 | `TOP` `JUNGLE` `MIDDLE` `BOTTOM` `UTILITY` (대문자만) |
| 날짜 | ISO 8601 UTC, 밀리초 포함 (`2026-10-14T20:00:00.418Z`) |
| 일관성 | 한 응답의 `window`와 통계 숫자는 같은 집계 스냅숏에서 읽는다 (백엔드가 요청마다 `REPEATABLE READ` 읽기 전용 트랜잭션 1개 사용). 05:00 갱신 순간에도 분모와 개수가 섞이지 않는다 |

---

## 2. 엔드포인트

> 요약: 4개다. 화면마다 한 번 호출로 필요한 데이터를 다 받는다.

| 메서드·경로 | 화면 |
|-------------|------|
| `GET /api/v1/health` | (운영 확인, 집계 상태) |
| `GET /api/v1/meta` | 공통 (통계 기간·패치 구성 표시) |
| `GET /api/v1/champions` | 챔피언 리스트 (포지션별 티어) |
| `GET /api/v1/champions/:championId` | 챔피언 상세 (포지션 + 빌드) |

### 2-0. `window` 객체 (모든 통계 응답 공통)

> 요약: 이 응답의 숫자가 어느 14일의 몇 게임에서 나왔는지, 언제 집계했는지, 집계가 멈췄는지, 패치가 어떻게 섞였는지 알려 준다.

```json
{
  "days": 14,
  "start": "2026-10-01T20:00:00.418Z",
  "end": "2026-10-15T20:00:00.418Z",
  "games": 2481,
  "aggregatedAt": "2026-10-15T20:00:00.418Z",
  "isStale": false,
  "patches": [
    { "patch": "16.20", "displayName": "26.20", "games": 1489, "share": 60.02 },
    { "patch": "16.19", "displayName": "26.19", "games": 992, "share": 39.98 }
  ]
}
```

| 필드 | 타입 | null | 의미 |
|------|------|------|------|
| `window.days` | int | 아니오 | 창 길이(일). 지금은 `14` |
| `window.start` | string | 아니오 | 창 시작 (포함) |
| `window.end` | string | 아니오 | 창 끝 (제외). 예약 작업 실행 시각 |
| `window.games` | int | 아니오 | 창 안 완료 게임 수 (픽률·밴률 분모) |
| `window.aggregatedAt` | string | 아니오 | 이 집계를 만든 시각. 보통 `end`와 같다 |
| `window.isStale` | boolean | 아니오 | 지금 − `aggregatedAt` > **26시간**이면 `true` (하루 1번 집계가 멈춤). 정확히 26시간은 `false` |
| `window.patches[]` | array | 아니오 | 창 안 패치 구성, **최신 패치 먼저**. 1개 이상 |
| `window.patches[].patch` | string | 아니오 | 내부 패치 (`16.20`). Data Dragon 버전 찾기에 쓴다 (5장) |
| `window.patches[].displayName` | string | 아니오 | 공개 이름 = `${메이저 + 10}.${마이너}` (`16.20` → `26.20`, `16.9` → `26.9`) |
| `window.patches[].games` | int | 아니오 | 그 패치 게임 수. 합계 = `window.games` |
| `window.patches[].share` | number | 아니오 | `100 × games / window.games`, 소수 2자리. 반올림 때문에 합이 정확히 `100.00`이 아닐 수 있다 |

- 화면 표시 예: "최근 14일 · 2,481게임 · 26.20 60% / 26.19 40% · 10월 16일 05:00 집계".
- `isStale`이면 예: "통계 갱신이 지연되고 있습니다 (마지막 집계 10월 16일 05:00)". 숫자는 마지막 집계 그대로 보여준다.

---

### 2-1. `GET /api/v1/health`

> 요약: 서버와 DB가 살아 있는지, 집계 상태가 어떤지 확인한다. 화면에서는 쓰지 않는다.

- 파라미터 없음.

```http
GET /api/v1/health
```

```json
{
  "status": "ok",
  "db": "ok",
  "stats": { "state": "fresh", "aggregatedAt": "2026-10-15T20:00:00.418Z" }
}
```

| 필드 | 타입 | null | 의미 |
|------|------|------|------|
| `status` | `"ok"` | 아니오 | 서버 응답 |
| `db` | `"ok"` | 아니오 | DB 조회 성공. 실패하면 `503 DB_UNAVAILABLE` |
| `stats.state` | `"fresh"` \| `"stale"` \| `"empty"` | 아니오 | `fresh`: 26시간 안에 집계됨. `stale`: 26시간 넘게 갱신 안 됨. `empty`: 아직 집계 없음 (첫 집계 전) |
| `stats.aggregatedAt` | string | 예 | 마지막 집계 시각. `empty`면 `null` |

- 집계가 오래돼도(`stale`, `empty`) HTTP는 **200**이다. `/health`는 서버·DB 확인용이고, 집계 상태는 `stats`로만 알린다.
- 캐시: `no-store`.

---

### 2-2. `GET /api/v1/meta`

> 요약: 지금 통계의 기간·게임 수·패치 구성(`window`), 마지막 수집 시각, 화면에 적을 규칙 값을 준다.

- 파라미터 없음.

```http
GET /api/v1/meta
```

```json
{
  "window": {
    "days": 14,
    "start": "2026-10-01T20:00:00.418Z",
    "end": "2026-10-15T20:00:00.418Z",
    "games": 2481,
    "aggregatedAt": "2026-10-15T20:00:00.418Z",
    "isStale": false,
    "patches": [
      { "patch": "16.20", "displayName": "26.20", "games": 1489, "share": 60.02 },
      { "patch": "16.19", "displayName": "26.19", "games": 992, "share": 39.98 }
    ]
  },
  "lastCollectedAt": "2026-10-15T03:41:12.903Z",
  "positions": ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"],
  "rules": {
    "minTierPick": 50,
    "secondaryPositionMinShare": 10,
    "windowDays": 14,
    "staleAfterHours": 26
  }
}
```

| 필드 | 타입 | null | 의미 |
|------|------|------|------|
| `window` | object | 아니오 | 2-0 |
| `lastCollectedAt` | string | 예 | 마지막으로 `done`으로 끝난 수집의 끝난 시각. 없으면 `null`. 수집한 게임은 다음 05:00 집계부터 통계에 들어간다 |
| `positions` | string[] | 아니오 | 포지션 순서 (탭 순서로 사용) |
| `rules.minTierPick` | int | 아니오 | 이 판 수 미만이면 `tier`가 `null` ("표본 부족") |
| `rules.secondaryPositionMinShare` | number | 아니오 | 2순위 포지션 최소 비율(%) |
| `rules.windowDays` | int | 아니오 | 통계 창 길이(일). 표시용 (실제 값은 `window.days`) |
| `rules.staleAfterHours` | int | 아니오 | `isStale` 기준 시간 |

- 집계가 없으면 `503 STATS_NOT_READY` (3장).

---

### 2-3. `GET /api/v1/champions` — 포지션별 티어리스트

> 요약: 그 포지션을 주 포지션으로 쓰는 챔피언을 티어(1→5) → 점수 순으로 준다. 표본이 부족한 챔피언은 `tier: null`로 맨 뒤에 온다.

#### 파라미터 (쿼리)

| 이름 | 필수 | 형식 | 검사 | 예 |
|------|------|------|------|-----|
| `position` | 예 | `TOP` `JUNGLE` `MIDDLE` `BOTTOM` `UTILITY` | 대문자 정확히 일치. 없거나 다르면 400 | `TOP` |

- v1의 `patch` 쿼리는 없다. 보내도 무시한다.

```http
GET /api/v1/champions?position=TOP
```

```json
{
  "window": {
    "days": 14,
    "start": "2026-10-01T20:00:00.418Z",
    "end": "2026-10-15T20:00:00.418Z",
    "games": 2481,
    "aggregatedAt": "2026-10-15T20:00:00.418Z",
    "isStale": false,
    "patches": [
      { "patch": "16.20", "displayName": "26.20", "games": 1489, "share": 60.02 },
      { "patch": "16.19", "displayName": "26.19", "games": 992, "share": 39.98 }
    ]
  },
  "position": "TOP",
  "champions": [
    {
      "rank": 1,
      "championId": 266,
      "tier": 1,
      "tierScore": 53.48,
      "winRate": 52.82,
      "pickRate": 10.00,
      "banRate": 15.64,
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
      "tierScore": 51.832,
      "winRate": 53.01,
      "pickRate": 3.35,
      "banRate": 4.39,
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
      "tierScore": 51.674,
      "winRate": 55.26,
      "pickRate": 1.53,
      "banRate": 2.38,
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
| `window` | object | 아니오 | 2-0 |
| `position` | string | 아니오 | 요청한 포지션 |
| `champions[]` | array | 아니오 | 정렬된 목록. 비어 있을 수 있음 (`[]`) |
| `rank` | int | 아니오 | 1부터 시작하는 표시 순서 (`tier: null` 포함) |
| `championId` | int | 아니오 | Data Dragon `champion.json`의 `key` (예: 266 = Aatrox) |
| `tier` | int (1~5) | **예** | 티어. `null` = 표본 부족 (pick 50 미만). DB 값 그대로 |
| `tierScore` | number | 아니오 | 티어 점수 (소수 3자리, 정렬용 표시값) |
| `winRate` | number | 아니오 | 승률 % |
| `pickRate` | number | 아니오 | 픽률 % (`pick / window.games`) |
| `banRate` | number | 아니오 | 밴률 % (`ban / window.games`, 포지션과 무관, 같은 챔피언은 모든 포지션에서 같은 값) |
| `pick` / `win` / `ban` | int | 아니오 | 이 포지션의 게임 수 / 승리 수 / 밴된 게임 수 |
| `positionShare` | number | 아니오 | 이 챔피언 전체 pick 중 이 포지션의 비율 % |
| `mainPositions` | string[] | 아니오 | 그 챔피언의 주 포지션 1~2개, 많은 순 |

- **목록에 들어가는 챔피언:** 그 포지션이 `mainPositions`에 들어 있는 챔피언만. 주 포지션 = 챔피언별 pick 많은 순 최대 2개, 2순위는 그 챔피언 전체 pick의 10% 이상일 때만.
- **정렬:** `tier` 오름차순(`null`은 맨 뒤) → `tierScore` 내림차순 → `championId` 오름차순.
- **`tier`를 `tierScore`로 다시 계산하지 않는다.** 표시 점수는 반올림 값이고 티어는 반올림 전 점수로 정해져, 경계(예: `53.000`)에서 결과가 다를 수 있다 (db_review L4).
- 숫자는 창 안의 모든 패치를 합친 값이다. 패치별로 나누지 않는다.
- 테스트 수집(약 2,200~2,700게임) 단계에서는 대부분 `tier: null`이 정상이다.

---

### 2-4. `GET /api/v1/champions/:championId` — 챔피언 상세

> 요약: 한 챔피언의 주 포지션(최대 2개)과, 고른 포지션의 통계와 빌드(아이템 전체, 룬·스펠·스킬 상위 2개)를 준다.

#### 파라미터

| 이름 | 위치 | 필수 | 형식 | 검사 | 예 |
|------|------|------|------|------|-----|
| `championId` | 경로 | 예 | 숫자 (Data Dragon `key`) | `^[1-9][0-9]{0,4}$`. 아니면 400 | `23` |
| `position` | 쿼리 | 아니오 | 1장의 포지션 | 대문자 정확히 일치. 안 주면 1순위 주 포지션 | `TOP` |

- v1의 `patch` 쿼리는 없다. 보내도 무시한다.
- 프론트 라우트는 영문 id(`/champions/Tryndamere`)이므로 `champion.json`에서 `key`(`"23"`)를 찾아 부른다.
- `position`을 주면 주 포지션이 아니어도 그 포지션 통계가 있으면 준다 (`isMainPosition: false`).

```http
GET /api/v1/champions/23?position=TOP
```

```json
{
  "window": {
    "days": 14,
    "start": "2026-10-01T20:00:00.418Z",
    "end": "2026-10-15T20:00:00.418Z",
    "games": 2481,
    "aggregatedAt": "2026-10-15T20:00:00.418Z",
    "isStale": false,
    "patches": [
      { "patch": "16.20", "displayName": "26.20", "games": 1489, "share": 60.02 },
      { "patch": "16.19", "displayName": "26.19", "games": 992, "share": 39.98 }
    ]
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
      "tierScore": 51.832,
      "winRate": 53.01,
      "pickRate": 3.35
    },
    {
      "position": "MIDDLE",
      "pick": 11,
      "positionShare": 11.46,
      "tier": null,
      "tierScore": 49.726,
      "winRate": 45.45,
      "pickRate": 0.44
    }
  ],
  "stats": {
    "tier": 2,
    "tierScore": 51.832,
    "winRate": 53.01,
    "pickRate": 3.35,
    "banRate": 4.39,
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
| `window` | object | 아니오 | 2-0 |
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
- **아이템은 프론트가 거른다:** 프론트는 핵심 아이템 3개와 신발을 따로 골라 보여준다(계산 방식은 프론트 범위). 백엔드는 지금처럼 전체 아이템을 pick 순으로 준다.
- `stats.banRate`는 포지션과 무관하다.
- 두 패치가 섞인 창에서는 한 패치에서 없어진 아이템·룬이 함께 나올 수 있다 (5장 버전 참고).

#### 오류

| 상황 | 응답 |
|------|------|
| `championId` 형식 오류, `position` 오류 | `400 INVALID_PARAMETER` |
| 창 안에 이 챔피언 통계가 없음 (새 챔피언, 한 번도 안 나옴, 밴만 됨) | `404 STATS_NOT_FOUND` (`details.championId`) — 프론트는 Data Dragon 정보만으로 상세를 그리고 "통계 없음" 표시 |
| `position`을 줬는데 그 포지션 통계가 없음 | `404 STATS_NOT_FOUND` (`details.championId`, `details.position`) |

```json
{
  "error": {
    "code": "STATS_NOT_FOUND",
    "message": "최근 14일 통계에 이 챔피언의 해당 포지션 통계가 없습니다.",
    "details": { "championId": 23, "position": "JUNGLE" }
  }
}
```

---

### 2-5. `GET /api/v1/summoners/:region/:riotId` — 전적 검색 (프로필 + 랭크 + 최근 매치 20건)

> 요약: `riotId`(`gameName-tagLine`)로 소환사를 찾아 프로필, 랭크 전체, 최근 매치 20건을 준다. **이 엔드포인트에는 `window` 객체가 없다** — 집계 창과 무관하게 Riot에서 그 자리에서 받아온 값이다. DB에 저장하지 않고, API 프로세스 메모리에 60초만 캐시한다(back_spec 변경 03).

#### 파라미터

| 이름 | 위치 | 필수 | 형식 | 검사 | 예 |
|------|------|------|------|------|-----|
| `region` | 경로 | 예 | `kr`만 | 그 밖은 400 (단일 지역만 지원) | `kr` |
| `riotId` | 경로 | 예 | `gameName-tagLine` | **마지막** `-`에서 자름. `tagLine`은 `^[0-9A-Za-z]{2,5}$` | `너희는개다-KR1` |

```http
GET /api/v1/summoners/kr/너희는개다-KR1
```

```json
{
  "summoner": {
    "puuid": "abcd1234…",
    "gameName": "너희는개다",
    "tagLine": "KR1",
    "profileIconId": 4568,
    "summonerLevel": 312
  },
  "leagues": [
    { "queueType": "RANKED_SOLO_5x5", "tier": "EMERALD", "rank": "II", "leaguePoints": 54, "wins": 120, "losses": 110, "hotStreak": false },
    { "queueType": "RANKED_FLEX_SR", "tier": "GOLD", "rank": "I", "leaguePoints": 10, "wins": 8, "losses": 9, "hotStreak": false }
  ],
  "matches": [
    {
      "matchId": "KR_7654321098",
      "gameStartAt": "2026-10-26T11:02:00.000Z",
      "gameDurationSec": 1584,
      "win": true,
      "championId": 23,
      "champLevel": 18,
      "individualPosition": "TOP",
      "kills": 7,
      "deaths": 3,
      "assists": 5,
      "cs": 182,
      "goldEarned": 13500,
      "items": [3006, 3046, 1036, 3031, 1018, 3074],
      "trinket": 3364,
      "summonerSpells": [4, 12],
      "keystone": 8010,
      "participants": {
        "team": [{ "puuid": "…", "championId": 23, "win": true, "gameName": "너희는개다", "tagLine": "KR1" }],
        "enemy": [{ "puuid": "…", "championId": 54, "win": false, "gameName": "눈보라속커피한잔", "tagLine": "KR1" }]
      }
    }
  ]
}
```

#### 필드

| 필드 | 타입 | null | 의미 |
|------|------|------|------|
| `summoner.puuid`·`gameName`·`tagLine`·`profileIconId`·`summonerLevel` | - | 아니오 | account-v1 + summoner-v4 |
| `leagues[]` | array | 아니오 | league-v4 그대로 (큐 종류는 Riot이 주는 대로 — 보통 `RANKED_SOLO_5x5`, `RANKED_FLEX_SR`). 둘 다 없으면 `[]` (언랭크) |
| `matches[]` | array | 아니오 | match-v5 최근 20건(큐 필터 없음), 최신 먼저. 최근 게임이 없으면 `[]`. 일부 매치 상세만 실패해도 나머지로 응답 |
| `matches[].champLevel` | int | 아니오 | 그 게임에서 도달한 챔피언 레벨(`champLevel`, 2026-10-27 추가). 소환사 레벨(`summoner.summonerLevel`)과는 다름 |
| `matches[].cs` | int | 아니오 | `totalMinionsKilled + neutralMinionsKilled` (백엔드가 더해서 줌) |
| `matches[].items` | int[6] | 아니오 | `item0~5`. 빈 칸 0 |
| `matches[].trinket` | int | 아니오 | `item6` |
| `matches[].keystone` | int | 아니오 | `perks.styles[0].selections[0].perk` (핵심 룬 1개만, 트리는 안 줌) |
| `matches[].participants.team`/`enemy` | array[5] | 아니오 | 같은 팀/상대팀. 챔피언 아이콘은 프론트가 Data Dragon |
| `…team[]`/`enemy[].gameName`/`tagLine` | string | **예** | Riot 닉네임#태그 (match-v5 응답에 포함된 `riotIdGameName`/`riotIdTagline`을 그대로 줌, 추가 호출 없음, 2026-10-27 추가). 아주 오래된 매치 등 Riot이 안 주면 둘 다 `null` — 프론트는 "알 수 없는 소환사"로 처리 |

- 캐시: `Cache-Control: no-store` (검색 결과는 거의 실시간이어야 하므로. 2·4장의 `public, max-age=600`은 챔피언 통계 3개에만 해당).
- 타임라인은 부르지 않는다. 스킬 순서는 이 엔드포인트에 없다 (이번 범위 밖).

#### 오류 (3장 형식 그대로)

| HTTP | `code` | 언제 |
|------|--------|------|
| 400 | `INVALID_PARAMETER` | `region`이 `kr`이 아님, `riotId` 형식 오류 |
| 404 | `SUMMONER_NOT_FOUND` | 그 `gameName#tagLine`을 가진 소환사가 없음 |
| 502 | `RIOT_UNAVAILABLE` | Riot API 429·5xx 재시도 소진 |
| 503 | `RIOT_KEY_EXPIRED` | Riot API 키 만료(401/403). **이 요청만** 실패하고 서버는 계속 응답한다 |

```json
{ "error": { "code": "SUMMONER_NOT_FOUND", "message": "해당 소환사를 찾을 수 없습니다." } }
```

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
| 400 | `INVALID_PARAMETER` | 파라미터 형식 오류 (`details.param`, `details.value`). 대상은 `position`, `championId` |
| 404 | `STATS_NOT_FOUND` | 그 챔피언(·포지션) 통계가 창 안에 없음 (`details.championId`, `details.position`) |
| 404 | `NOT_FOUND` | 없는 경로 |
| 503 | `STATS_NOT_READY` | 집계된 창이 없음 (첫 집계 전). `/meta`, `/champions`, 상세가 준다 |
| 503 | `DB_UNAVAILABLE` | DB 연결 실패 |
| 500 | `INTERNAL_ERROR` | 그 밖의 서버 오류. 내부 내용은 응답에 넣지 않음 |
| 404 | `SUMMONER_NOT_FOUND` | 전적 검색(2-5): 그 소환사가 없음 |
| 502 | `RIOT_UNAVAILABLE` | 전적 검색(2-5): Riot API 재시도 소진 |
| 503 | `RIOT_KEY_EXPIRED` | 전적 검색(2-5): Riot API 키 만료. 이 요청만 실패 |

집계 전 응답 예:

```json
{
  "error": {
    "code": "STATS_NOT_READY",
    "message": "아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다."
  }
}
```

- v1의 `PATCH_NOT_FOUND`는 없다.
- 한 번 집계가 생기면 다시 `STATS_NOT_READY`가 되지 않는다 (집계 함수는 0게임이면 실패하고 이전 집계를 남긴다). 집계가 멈추면 `window.isStale`로 알린다.

---

## 4. 캐시

> 요약: 데이터는 하루 1번(05:00 KST) 바뀐다. 성공 응답은 10분 캐시를 허용하고, 실제 캐시는 Next.js의 `revalidate: 3600`이 맡는다.

| 응답 | 헤더 |
|------|------|
| 성공 (`meta`, `champions`, 상세) | `Cache-Control: public, max-age=600` |
| `health`, 모든 오류 | `Cache-Control: no-store` |

- 프론트 권장: `fetch(url, { next: { revalidate: 3600 } })`. 05:00 집계 뒤 최대 약 1시간 안에 새 숫자가 보인다.
- `window.aggregatedAt`이 바뀌면 스냅숏이 바뀐 것이다. 프론트가 더 빨리 반영하고 싶으면 이 값으로 재검증을 판단할 수 있다 (프론트 범위).
- `isStale`은 캐시 때문에 최대 캐시 시간만큼 늦게 바뀔 수 있다 (하루 단위 판단이라 문제없음).
- ETag·304는 이번 버전에 없다.

---

## 5. Data Dragon 매핑 (프론트가 붙이는 것)

> 요약: 백엔드는 숫자 ID만 준다. 아래 표대로 Data Dragon에서 이름·이미지를 찾는다. Data Dragon 버전은 **내부 패치(`patch`)** 로 정하고, 화면 글자는 **`displayName`** 을 쓴다.

| 응답 필드 | Data Dragon 파일 | 찾는 방법 | 비고 |
|-----------|------------------|-----------|------|
| `championId` | `champion.json` | `data[*].key == String(championId)` → 영문 `id`(이미지·라우트), `name` | 예: `23` → `Tryndamere` |
| `builds.items[].itemId` | `item.json` | `data[String(itemId)]` → `name`, `into`(하위 재료 거르기), 이미지 `img/item/{itemId}.png` | 새 패치에서 없어진 아이템은 없을 수 있음 → 아래 버전 참고 |
| `builds.spells[].spellIds[]` | `summoner.json` | `data[*].key == String(spellId)` → 문자열 `id`(`SummonerFlash`), `name` | 예: `4` 점멸, `14` 점화, `6` 유체화, `12` 순간이동, `11` 강타 |
| `builds.runes[].primaryStyle`, `subStyle` | `runesReforged.json` | 최상위 `[].id` | 예: `8000` 정밀, `8100` 지배, `8400` 결의 |
| `builds.runes[].primaryPerks[]`, `subPerks[]` | `runesReforged.json` | `[].slots[].runes[].id` → `name`, `icon` (`/cdn/img/{icon}`) | |
| `builds.runes[].statPerks.*` | **없음** | Data Dragon에 능력치 파편이 없다. 프론트가 작은 표를 둔다 | 예: `5008` 적응형 능력치, `5005` 공격 속도, `5007` 스킬 가속, `5010` 이동 속도, `5011` 체력, `5013` 강인함, `5001` 체력 증가 |
| `builds.skills[].skillOrder` | `champion/{id}.json` | 글자 `Q/W/E/R` → `spells[0..3]` (이름·아이콘) | |
| `window.patches[].patch` | `versions.json` | 내부 패치 `16.20` → Data Dragon 버전 보통 `16.20.1` | `displayName`(`26.20`)으로 Data Dragon을 찾지 않는다 |

- **버전:** 이름·이미지는 최신 버전을 써도 된다. 창이 두 패치에 걸쳐 있으면 옛 패치에만 있던 아이템을 최신 `item.json`에서 못 찾을 수 있으므로, 못 찾으면 `window.patches`의 다른 패치(`{patch}.1`) 버전 `item.json`을 한 번 더 보는 것을 권장한다.
- **패치 표시:** 화면(푸터 포함)에 패치를 적을 때는 `displayName`을 쓴다. Data Dragon 버전 문자열(`16.20.1`)을 그대로 보여주면 공개 이름과 다르다 (프론트 범위에서 정리).
- 백엔드는 Data Dragon을 부르지 않는다.

---

## 6. 변경 기록

| 날짜 | 버전 | 내용 |
|------|------|------|
| 2026-10-14 | v1 (승인) | 엔드포인트 4개 (`health`, `meta`, `champions`, `champions/:championId`), 패치 기준, 직전 패치 대체 |
| 2026-10-15 | v2 초안 | 최근 14일 창: `patch` 쿼리·대체 규칙·`PATCH_NOT_FOUND` 삭제, `window` 객체(`displayName`, `share`, `aggregatedAt`, `isStale`), `/health` `stats`, 한 응답 한 스냅숏 (back_spec 변경 01) |
| 2026-10-15 | v2 (구현 반영) | 백엔드 변경 01 Build 구현. 계약 내용 변경 없음, 상태만 갱신 |
| 2026-10-16 | v2 (문구 정정) | 2-4 아이템 거르기 설명을 프론트 실제 동작(핵심 아이템 3개+신발)에 맞게 고침. 응답 필드·형식은 바뀌지 않음 (back_spec 변경 02) |
| 2026-10-27 | v3 | 2-5 `GET /summoners/:region/:riotId` 추가(전적 검색: 프로필+랭크+최근 매치 20건). `window` 없는 첫 엔드포인트, 캐시 `no-store`. 오류 코드 `SUMMONER_NOT_FOUND`·`RIOT_UNAVAILABLE`·`RIOT_KEY_EXPIRED` 추가 (back_spec 변경 03) |
| 2026-10-27 | v3 (작은 추가) | 2-5 `matches[].participants.team`/`enemy`에 `gameName`/`tagLine`(닉네임#태그) 추가. match-v5 응답에 이미 포함된 `riotIdGameName`/`riotIdTagline`을 그대로 노출(추가 Riot 호출 없음). 사용자 요청("참가자 닉네임 표시 가능한지 확인") |
| 2026-10-27 | v3 (작은 추가) | 2-5 `matches[].champLevel`(그 게임에서 도달한 챔피언 레벨) 추가. `ParticipantDto`에 이미 있던 `champLevel`을 검색한 소환사 쪽에 노출(추가 Riot 호출 없음). 사용자 요청("챔피언 초상화 옆에 레벨 표시") |
