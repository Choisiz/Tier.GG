# 프론트에서 쓰는 API 리스트

Data Dragon(`https://ddragon.leagueoflegends.com`)에서 프론트엔드가 사용하는 API 목록입니다.

- 아래 URL은 모두 **예시**입니다. 실제 호출 시에는 변수 값을 치환해서 사용합니다.
- API 키는 필요 없습니다.

## 변수 정보

| 변수 | 설명 | 예시 값 |
|------|------|---------|
| `{version}` | 데이터 버전 (`versions.json`의 0번째가 최신) | `15.24.1` |
| `{locale}` | 언어 / 지역 | `ko_KR` |
| `{championId}` | 챔피언 영문 ID (이미지 파일명에 사용) | `Aatrox` |
| `{skinNum}` | 스킨 번호 (기본 스킨 `0`) | `0` |
| `{spellId}` | 챔피언 스킬 ID | `AatroxQ` |
| `{summonerSpellId}` | 소환사 주문 ID | `SummonerFlash` |
| `{itemId}` | 아이템 ID | `3031` |

기본 URL: `https://ddragon.leagueoflegends.com`

---

## 1. 메타 정보

| 항목 | 예시 URL |
|------|----------|
| 버전 정보 | https://ddragon.leagueoflegends.com/api/versions.json |
| 언어 정보 | https://ddragon.leagueoflegends.com/cdn/languages.json |

```
GET /api/versions.json
GET /cdn/languages.json
```

---

## 2. 챔피언

### 데이터

| 항목 | 예시 URL |
|------|----------|
| 챔피언 정보 (전체 목록) | https://ddragon.leagueoflegends.com/cdn/15.24.1/data/ko_KR/champion.json |
| 챔피언 상세 정보 | https://ddragon.leagueoflegends.com/cdn/15.24.1/data/ko_KR/champion/Aatrox.json |

```
GET /cdn/{version}/data/{locale}/champion.json
GET /cdn/{version}/data/{locale}/champion/{championId}.json
```

### 이미지

| 항목 | 예시 URL | 버전 포함 |
|------|----------|-----------|
| 스퀘어 이미지 | https://ddragon.leagueoflegends.com/cdn/15.24.1/img/champion/Aatrox.png | O |
| 로딩 화면 이미지 | https://ddragon.leagueoflegends.com/cdn/img/champion/loading/Aatrox_0.jpg | X |
| 풀 화면(스플래시) 이미지 | https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Aatrox_0.jpg | X |
| 스킬 이미지 | https://ddragon.leagueoflegends.com/cdn/15.24.1/img/spell/AatroxQ.png | O |
| 패시브 이미지 | https://ddragon.leagueoflegends.com/cdn/15.24.1/img/passive/Aatrox_Passive.png | O |

```
GET /cdn/{version}/img/champion/{championId}.png
GET /cdn/img/champion/loading/{championId}_{skinNum}.jpg
GET /cdn/img/champion/splash/{championId}_{skinNum}.jpg
GET /cdn/{version}/img/spell/{spellId}.png
GET /cdn/{version}/img/passive/{passiveImage}.png
```

---

## 3. 소환사 주문 (스펠)

| 항목 | 예시 URL |
|------|----------|
| 스펠 정보 | https://ddragon.leagueoflegends.com/cdn/15.24.1/data/ko_KR/summoner.json |
| 스펠 이미지 | https://ddragon.leagueoflegends.com/cdn/15.24.1/img/spell/SummonerFlash.png |

```
GET /cdn/{version}/data/{locale}/summoner.json
GET /cdn/{version}/img/spell/{summonerSpellId}.png
```

---

## 4. 룬

| 항목 | 예시 URL |
|------|----------|
| 룬 정보 | https://ddragon.leagueoflegends.com/cdn/15.24.1/data/ko_KR/runesReforged.json |

```
GET /cdn/{version}/data/{locale}/runesReforged.json
```

- 룬 이미지는 JSON의 `icon` 필드 값을 `/cdn/img/` 뒤에 붙여 사용합니다. (버전 없음)

```
GET /cdn/img/{icon}
# 예: /cdn/img/perk-images/Styles/Domination/Electrocute/Electrocute.png
```

---

## 5. 아이템

| 항목 | 예시 URL |
|------|----------|
| 아이템 정보 | https://ddragon.leagueoflegends.com/cdn/15.24.1/data/ko_KR/item.json |
| 아이템 이미지 | https://ddragon.leagueoflegends.com/cdn/15.24.1/img/item/3031.png |

```
GET /cdn/{version}/data/{locale}/item.json
GET /cdn/{version}/img/item/{itemId}.png
```

---

## 참고

- **버전 경로가 없는 이미지**: 로딩 화면, 스플래시, 룬 이미지는 `/cdn/img/...`처럼 버전이 들어가지 않습니다.
- **챔피언 ID**: 이미지 URL에는 영문 `id`(`Aatrox`)를 사용합니다. 매치 데이터의 숫자 `championId`(`266`)와는 다르며, `champion.json`의 `key`로 매핑합니다.
- **스펠 ID**: 이미지 URL에는 `SummonerFlash` 같은 문자열 `id`를 사용합니다. 매치 데이터의 숫자 ID는 `summoner.json`의 `key`로 매핑합니다.
- **스킨 번호**: `champion/{championId}.json`의 `skins[].num` 값입니다.
- **로케일**: 한국어 데이터는 `ko_KR`입니다. 이미지에는 로케일 구분이 없습니다.
