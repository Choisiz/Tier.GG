# 공통 관점 조각 (모든 유형)

> 조언 규칙(R1~R5)마다 그 규칙이 무엇을 뜻하고 무엇을 하라는지 풀어 쓴 해설이다 (ai_spec Q3). `role=ALL`이라 어느 유형이든 그 칸에서 같은 규칙이 발동하면 검색된다. 유형 파일에 같은 과목·규칙 조각이 있으면 그쪽이 먼저 쓰인다. 데이터가 말하지 않는 원인은 쓰지 않는다.

### fight.advantage.ALL.bad.R1 오브젝트 싸움 득실 비중이 큰 유형인데 부족했을 때
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=bad, rule=R1
이 유형은 오브젝트 싸움 평가에서 득실, 곧 내가 참여한 싸움에서 우리 팀이 얻은 몫의 비중이 크다. 그 몫이 낮았고 상대 라이너보다도 낮았다면 이 유형이 가장 크게 기여해야 할 곳에서 밀린 것이다. 다음 판에는 오브젝트 싸움에서 우리 팀 몫을 지키는 데 신경 쓴다.

### fight.damage.ALL.bad.R1 딜 비중이 큰 유형인데 부족했을 때
- meta: role=ALL, area=fight, subject=fight.damage, polarity=bad, rule=R1
이 유형은 오브젝트 싸움 평가에서 챔피언 딜 비중의 비중이 크다. 팀 안에서 내가 넣은 챔피언 피해의 몫이 이 유형의 기대치보다 낮았고 상대 라이너보다도 낮았다는 뜻이다. 다음 판에는 싸움에서 챔피언 딜을 넣는 데 신경 쓴다.

### fight.vision.ALL.bad.R1 오브젝트 전 시야 비중이 큰 유형인데 부족했을 때
- meta: role=ALL, area=fight, subject=fight.vision, polarity=bad, rule=R1
이 유형은 오브젝트 싸움 평가에서 오브젝트를 잡기 전 시야의 비중이 크다. 오브젝트 전 시간 동안 내가 두거나 지운 와드가 적었고 상대 라이너보다도 적었다는 뜻이다. 다음 판에는 오브젝트를 잡기 전 시야에 신경 쓴다.

### fight.objective.ALL.bad.R1 오브젝트 막타 비중이 큰 유형인데 부족했을 때
- meta: role=ALL, area=fight, subject=fight.objective, polarity=bad, rule=R1
이 유형은 오브젝트 싸움 평가에서 오브젝트 막타의 비중이 크다. 내가 막타로 챙긴 오브젝트가 적었고 상대 정글보다도 적었다는 뜻이다. 다음 판에는 오브젝트 막타를 챙기는 데 신경 쓴다.

### macro.advantage.ALL.bad.R1 오브젝트 밖 싸움 득실 비중이 큰 유형인데 부족했을 때
- meta: role=ALL, area=macro, subject=macro.advantage, polarity=bad, rule=R1
이 유형은 운영 평가에서 오브젝트 싸움 밖 득실의 비중이 크다. 오브젝트를 두고 싸우지 않는 시간에 내가 참여한 싸움에서 우리 팀 몫이 낮았고 상대 라이너보다도 낮았다는 뜻이다. 다음 판에는 그 시간의 싸움에서 우리 팀 몫을 지키는 데 신경 쓴다.

### macro.side.ALL.bad.R1 사이드 압박 비중이 큰 유형인데 부족했을 때
- meta: role=ALL, area=macro, subject=macro.side, polarity=bad, rule=R1
이 유형은 운영 평가에서 사이드 압박, 곧 분당 포탑 피해량의 비중이 크다. 내가 포탑에 넣은 피해가 적었고 상대 라이너보다도 적었다는 뜻이다. 다음 판에는 포탑에 피해를 넣는 데 신경 쓴다.

### macro.farm.ALL.bad.R1 중후반 파밍 비중이 큰 유형인데 부족했을 때
- meta: role=ALL, area=macro, subject=macro.farm, polarity=bad, rule=R1
이 유형은 운영 평가에서 중후반 파밍, 곧 라인전 이후 분당 CS의 비중이 크다. 라인전이 끝난 뒤 챙긴 미니언과 정글 몹이 적었고 상대 라이너보다도 적었다는 뜻이다. 다음 판에는 중후반 CS를 챙기는 데 신경 쓴다.

### macro.vision.ALL.bad.R1 평소 시야 비중이 큰 유형인데 부족했을 때
- meta: role=ALL, area=macro, subject=macro.vision, polarity=bad, rule=R1
이 유형은 운영 평가에서 오브젝트 전 시간을 뺀 평소 시야의 비중이 크다. 그 시간 동안 내가 두거나 지운 와드가 적었고 상대 라이너보다도 적었다는 뜻이다. 다음 판에는 평소 시야에 신경 쓴다.

### fight.damage.ALL.bad.R2 딜도 적고 내 데스가 상대 득실이 됐을 때 (딜 칸)
- meta: role=ALL, area=fight, subject=fight.damage, polarity=bad, rule=R2
오브젝트 싸움에서 내 딜 비중이 기대치보다 낮았고, 그 싸움에서 내가 죽을 때마다 상대 팀이 득실을 얻었다. 딜로 보탠 것은 적고 데스로 내준 것은 있어서 싸움 기여가 매우 적었다는 뜻이다. 다음 판에는 오브젝트 싸움에서 죽지 않을 위치를 잡는다.

### fight.advantage.ALL.bad.R2 딜도 적고 내 데스가 상대 득실이 됐을 때 (득실 칸)
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=bad, rule=R2
내가 참여한 오브젝트 싸움에서 우리 팀 몫이 낮았고, 그 안에서 내 데스가 상대 팀 득실이 됐다. 딜 비중도 기대치보다 낮아 싸움 기여가 매우 적었다는 뜻이다. 다음 판에는 오브젝트 싸움에서 죽지 않을 위치를 잡는다.

### fight.advantage.ALL.bad.R3 딜은 넣었지만 내 데스로 싸움을 내줬을 때
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=bad, rule=R3
내 딜 비중은 기대치보다 높았지만, 내가 참여한 오브젝트 싸움에서 내 데스가 상대 팀 득실이 되어 우리 팀 몫이 낮아졌다. 딜을 넣고도 죽으면 그 데스가 싸움을 내주는 시작이 되고, 큰 골드 격차가 생긴 장면에서 내가 죽었다면 그 데스가 역전의 시발점이 된다. 다음 판에는 딜을 넣은 뒤 죽지 않는 데 신경 쓴다.

### fight.advantage.ALL.bad.R4 우리 팀이 먼저 죽고 싸움을 졌을 때
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=bad, rule=R4
데이터에는 누가 싸움을 걸었는지가 없고 누가 먼저 죽었는지만 있다. 먼저 죽은 사람이 탱커이고 싸움을 졌다면 혼자 들어갔거나 팀이 따라오지 못한 것으로 보고, 딜러였다면 먼저 잡혀 싸움을 졌다고만 말한다. 해석일 뿐이라 행동 조언은 붙이지 않는다.

### fight.advantage.ALL.good.R4 우리 팀이 먼저 죽었지만 싸움을 이겼을 때
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=good, rule=R4
데이터에는 누가 싸움을 걸었는지가 없고 누가 먼저 죽었는지만 있다. 먼저 죽은 사람이 탱커이고 싸움을 이겼다면 싸움을 연 것으로 보고, 딜러였다면 먼저 잡혔지만 팀이 받아쳐 이겼다고만 말한다. 해석일 뿐이라 행동 조언은 붙이지 않는다.

### macro.solo.ALL.bad.R5 혼자 싸워 죽은 장면이 있을 때
- meta: role=ALL, area=macro, subject=macro.solo, polarity=bad, rule=R5
오브젝트 싸움 밖에서 킬 하나로 끝난 싸움에 내가 죽은 장면이 있고, 단독 킬보다 단독 데스가 많았다. 그 시각과 지역에서 혼자 싸워 상대에게 킬을 내준 것이다. 다음 판에는 그 시각과 지역 같은 상황에서 혼자 싸우지 않는다.
