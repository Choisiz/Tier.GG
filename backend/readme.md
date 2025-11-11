사용 가능한 API

- 0. 헬스체크

  - GET http://localhost:5500/healthz

- 1. 티어 → 플레이어 수집 및 저장

  - GET http://localhost:5500/info/tier/puuid
  - 설명: 라이엇 리그 엔트리에서 플레이어를 수집하고 `players` 테이블에 UPSERT
  - 선택 파라미터:
    - queue: 기본값 RANKED_SOLO_5x5
    - page: 기본값 1

- 2. 플레이어 → 매치ID 수집 및 저장

  - GET http://localhost:5500/info/matches/matches10
  - 설명: DB의 `players`(최신순)에서 puuid 목록을 가져와 최근 매치ID를 조회, 중복 제외 후 `player_matches` 저장
  - 쿼리:
    - limit: puuid당 가져올 matchId 개수 (기본 5)
    - puuidLimit: DB에서 읽을 puuid 수 (기본 전체)

- 3. 매치 상세 배치 수집 및 저장
  - GET http://localhost:5500/info/gameInfo/gameInfo
  - 설명: `player_matches`에서 미처리 matchId를 가져와 Riot API 조회 후 `match_details`, `match_defails_ban`, `match_details_perks` 저장
  - 규칙:
    - gameMode가 CLASSIC인 매치만 저장
    - 레이트리미트 적용: 초당 9회, 2분당 100회 미만
  - 쿼리:
    - max: 처리할 최대 매치 수 (기본 0 = 무제한)
    - batchSize: 한 번에 가져올 matchId 개수 (기본 20)
    - puuid: 특정 참가자 데이터만 우선 처리 시 필터 (선택)
