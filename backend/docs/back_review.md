# 백엔드 검토 기록 — 변경 06 (매치 상세 지표) 가벼운 검토

> 검토일: 2026-11-03 (KST)
> 기준: `back_spec.md` 5-10, 결정 G1, `api_contract.md` 2-5
> 방법: 작은 추가(additive)라 가벼운 Review. Build의 typecheck·lint·test(379 통과)는 신뢰하고 재실행하지 않았다. diff와 fixture(KR_8408851980)를 손으로 대조했다. 서버·Riot 호출 없음.
> 이 문서는 가장 최근 검토만 둔다.

## 결론: ✅ 통과 (수정 없음)

## 확인 결과

| 항목 | 결과 |
|------|------|
| 계약 필드 표·예시 ↔ 구현 (이름·타입·null) | ✅ `teamPosition`(빈 값→null), `killParticipation`(기존 함수 재사용, null 가능), `keystone`·`subStyle`(null 가능) 일치 |
| 매핑 | ✅ `isMe` 1명, `cs`=라인+정글, `controlWardsPlaced`=`detectorWardsPlaced`, `teams.team`=검색한 소환사 팀, 팀 킬·골드는 참가자 합, 오브젝트 6종 키 매핑, `bans`에서 -1 제외. fixture 손 대조: 100팀 밴 `64,7,902,101,17`·200팀 `56,234,89,134`(-1 제외), 오브젝트 tower 10/inhibitor 2/dragon 3/horde 2/riftHerald 1, 팀 킬 39, `subStyle` 8000, 킬관여 0.205→21 모두 일치 |
| 하위 호환 | ✅ 기존 필드 변경 없음. 변경 파일은 `dto.ts`·`types.ts`·계약·테스트뿐, `src/analysis`·피드백 변경 0, 다른 엔드포인트 영향 없음 |
| 개인정보 | ✅ 새 필드에 다른 플레이어 puuid 추가 없음. (사실: 기존 `participants.*[].puuid`와 gameName/tagLine이 10명 모두에게 이미 노출됨, 범위 밖) |
| 테스트 | ✅ 의미 있는 단언: fixture 값 직접 대조(합계, 밴, 오브젝트 10/2/3/0/1/2), 방향(200팀 관점), 선택 필드 누락 시 0·null, objectives 누락 시 0 |

## 사소한 메모 (조치 불필요)

- `info.teams` 자체가 없는 매치(`win` 대체 경로 `members[0].win`, 적 팀 ID 대체 100/200)는 테스트하지 않았다. 실제 Riot 응답에는 항상 있어 위험은 낮다.
- 응답 크기 29→102 KB(압축 전)는 결정 G1에서 승인된 대가다.
