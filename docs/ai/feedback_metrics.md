# 게임 피드백 지표 (포지션별)

## 목차

1. 목적
2. 데이터 출처
3. 공통 지표
4. 포지션별 핵심 지표
5. 데이터 한계
6. 실제 판으로 확인한 점
7. 다음 단계

---

## 1. 목적

- 요약: 게임 피드백 기능(기능 1)이 어떤 Riot 데이터를 근거로 쓸 수 있는지 정리한다.
- 이 문서는 지표 후보 목록이다. 실제로 쓸 지표와 판정 기준은 `!ai` Plan에서 확정한다.
- 계산은 코드가 하고, 해석·우선순위는 RAG 문서가 담당한다. LLM은 계산된 값과 검색된 문서만 근거로 쓴다.

## 2. 데이터 출처

- 요약: match-v5 상세 1회 + 타임라인 1회로 한 판 분석에 필요한 값이 모두 나온다.

| 출처 | 엔드포인트 | 내용 | 비고 |
|------|-----------|------|------|
| 상세 | `GET /lol/match/v5/matches/{matchId}` | 플레이어당 기본 필드 156개 + `challenges` 125개 (2026-10-30 확인) | 전적 검색에서 이미 받음 |
| 타임라인 | `GET /lol/match/v5/matches/{matchId}/timeline` | 1분 단위 스냅샷(`participantFrames`) + 이벤트 19종 | 분석 요청 때만 1회 호출 |

- `match/v4/.../by-tournament-code`는 대회용 토너먼트 코드 게임 전용이고 v4는 종료된 버전이라 쓰지 않는다.

### 타임라인 이벤트 (확인된 키)

| 이벤트 | 주요 키 | 피드백 용도 |
|--------|---------|-------------|
| `CHAMPION_KILL` | `timestamp`, `position`, `killerId`, `victimId`, `assistingParticipantIds`, `victimDamageReceived` | 데스 시점·장소·원인(누구에게 얼마나 맞았나) |
| `ELITE_MONSTER_KILL` | `monsterType`, `monsterSubType`, `killerTeamId`, `position` | 용·전령·바론·공허 유충 |
| `BUILDING_KILL` | `buildingType`, `towerType`, `laneType`, `teamId` | 포탑·억제기 손실 |
| `TURRET_PLATE_DESTROYED` | `laneType`, `killerId` | 포탑 방패 |
| `WARD_PLACED` / `WARD_KILL` | `creatorId`/`killerId`, `wardType` | 시야 (위치 없음) |
| `ITEM_PURCHASED` | `itemId`, `participantId` | 제어 와드(2055) 구매 시점, 빌드 순서 |
| `LEVEL_UP`, `SKILL_LEVEL_UP` | `level`, `skillSlot` | 레벨 격차 |

### 1분 스냅샷 (`participantFrames`)

- `totalGold`, `currentGold`, `xp`, `level`, `minionsKilled`, `jungleMinionsKilled`, `position`, `damageStats`, `championStats`

## 3. 공통 지표

- 요약: 모든 포지션에 쓰는 지표. 비교 기준은 맞라인 상대, 내 최근 20게임, 기준치 문서 3가지다.

| 무엇을 보나 | 필드 | 출처 |
|---|---|---|
| 성장 | `challenges.goldPerMinute`, 분당 CS(`totalMinionsKilled` + `neutralMinionsKilled`) | 상세 |
| 맞라인 대비 | `maxCsAdvantageOnLaneOpponent`, `maxLevelLeadLaneOpponent`, `visionScoreAdvantageLaneOpponent` | 상세 challenges |
| 15분 시점 비교 | `totalGold`, `xp`, `level`, CS | 타임라인 스냅샷 |
| 교전 기여 | `killParticipation`, `teamDamagePercentage`, `damagePerMinute` | 상세 challenges |
| 생존 | `deaths`, `totalTimeSpentDead`, `longestTimeSpentLiving` | 상세 |
| 데스 시점·장소·원인 | `CHAMPION_KILL` | 타임라인 |
| 데스 → 손실 연결 | 데스 시각 뒤 60초 안의 `BUILDING_KILL`·`ELITE_MONSTER_KILL` | 타임라인 |
| 시야 | `visionScorePerMinute`, `wardsPlaced`, `wardsKilled`, `controlWardsPlaced` | 상세 |
| 귀환 타이밍 | 분별 `currentGold` (골드를 많이 쥔 채 라인에 남았는지) | 타임라인 |
| 소통 (참고) | `*Pings` 횟수 | 상세 |

## 4. 포지션별 핵심 지표

- 요약: 포지션마다 우선해서 볼 지표. 순서가 곧 우선순위 초안이다.

### 탑 (`TOP`)

| 우선 지표 | 필드 |
|---|---|
| 라인전 우위 | 15분 골드·경험치차, `maxCsAdvantageOnLaneOpponent`, `soloKills` |
| 포탑 압박 | `turretPlatesTaken`, `damageDealtToTurrets`, `kTurretsDestroyedBeforePlatesFall` |
| 탱커 역할 | `damageSelfMitigated`, `damageTakenOnTeamPercentage` |
| 전령 | `riftHeraldTakedowns`, `turretsTakenWithRiftHerald` |

### 정글 (`JUNGLE`)

| 우선 지표 | 필드 |
|---|---|
| 초반 동선 | `jungleCsBefore10Minutes`, `initialCrabCount`, `scuttleCrabKills` |
| 갱 기여 | `takedownsFirstXMinutes`, 초반 킬·데스 이벤트 좌표(어느 라인) |
| 오브젝트 관리 | `dragonTakedowns`, `baronTakedowns`, `epicMonsterKillsWithin30SecondsOfSpawn`, `epicMonsterSteals` |
| 상대 정글 압박 | `enemyJungleMonsterKills`, `moreEnemyJungleThanOpponent`, `buffsStolen` |
| 오브젝트 직전 데스 | 데스 시각과 `ELITE_MONSTER_KILL` 시각 비교 |

### 미드 (`MIDDLE`)

| 우선 지표 | 필드 |
|---|---|
| 라인전 우위 | 15분 골드·경험치차, `laneMinionsFirst10Minutes`, `soloKills` |
| 로밍 | `killsOnOtherLanesEarlyJungleAsLaner`, `getTakedownsInAllLanesEarlyJungleAsLaner` |
| 딜 기여 | `teamDamagePercentage`, `damagePerMinute` |
| 스킬 적중 | `skillshotsHit`, `skillshotsDodged` |

### 원딜 (`BOTTOM`)

| 우선 지표 | 필드 |
|---|---|
| 생존 | `deaths`, 데스 직전 `victimDamageReceived` (일방적으로 잡혔는지) |
| 딜 | `damagePerMinute`, `teamDamagePercentage` |
| 성장 | 분당 CS, `laneMinionsFirst10Minutes`, `goldPerMinute` |
| 포탑 마무리 | `damageDealtToTurrets`, `turretTakedowns` |

### 서포터 (`UTILITY`)

| 우선 지표 | 필드 |
|---|---|
| 시야 | `visionScorePerMinute`, `wardsPlaced`, `wardTakedowns`, `controlWardsPlaced`, `visionScoreAdvantageLaneOpponent` |
| 오브젝트 전 시야 준비 | 제어 와드 구매(`ITEM_PURCHASED` 2055)·설치(`WARD_PLACED` `CONTROL_WARD`) 시각과 용 처치 시각 비교 |
| 보호·군중 제어 | `effectiveHealAndShielding`, `saveAllyFromDeath`, `timeCCingOthers`, `enemyChampionImmobilizations` |
| 교전 기여 | `killParticipation`, 어시 |
| 서폿 퀘스트 | `completeSupportQuestInTime` |

## 5. 데이터 한계

- 요약: "무슨 일이 있었나"는 잡히지만 "왜 그랬나"와 정확한 위치·스킬 타이밍은 없다.

| 한계 | 영향 |
|------|------|
| 와드 이벤트에 좌표 없음 | "어디를 밝혔나"는 모름. "용 전 90초 안에 제어 와드를 설치했나"까지만 판정 |
| 위치는 1분 간격 | 교전 순간 위치 모름. 오브젝트 때 근처에 있었는지는 추정만 |
| 스킬·스펠·핑은 합계만 | `spell1~4Casts`, `summoner1/2Casts`, `*Pings`는 횟수만 있고 시점이 없음 |
| `challenges` 공식 문서 없음 | 이름으로 뜻을 추정. 판에 따라 일부 키가 빠질 수 있음. 쓰기 전에 여러 판으로 검증 |

## 6. 실제 판으로 확인한 점

- 요약: KR_8437852704 (솔로랭크, 23분, 패치 16.21) 한 판으로 확인했다.

| 확인 | 결과 |
|------|------|
| `laningPhaseGoldExpAdvantage` | 15분 골드 −703으로 뒤졌는데 값 0. 숫자 차이가 아니라 0/1 플래그로 보임 → 골드차는 타임라인으로 직접 계산 |
| `controlWardsPlaced` | 양쪽 서포터 모두 0. `WARD_PLACED`의 `CONTROL_WARD` 이벤트도 두 정글(이번 판 8회)만 있어 값이 맞음. 제어 와드 구매(`ITEM_PURCHASED` 2055)도 정글 둘뿐 |
| 용 직전 와드 | `WARD_PLACED`에 `wardType`(`SIGHT_WARD`, `YELLOW_TRINKET`, `CONTROL_WARD` 등)과 시각이 있어 "용 전 90초 안 설치"를 셀 수 있음 |
| 시간대별 딜 | 스냅샷 `damageStats.totalDamageDoneToChampions`가 누적값이라 구간별 딜을 나눌 수 있음 |
| 데스 → 손실 연결 | 15.8분 데스 6초 뒤 바텀 1차 포탑 파괴처럼 타임라인으로 연결 가능 |
| `victimDamageReceived` | 데스 직전 누구에게 얼마나 맞았는지 나옴 (예: 한 명에게 1,161 피해) |

## 7. 다음 단계

1. 포지션별 판정 기준(좋음·보통·아쉬움의 경계) 초안 → 사용자 검토
2. 기준·해석을 RAG 문서 조각으로 작성
3. 피드백 설계: `feedback_design.md`
