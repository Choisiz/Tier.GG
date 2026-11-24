# 공통 관점 조각 (모든 유형)

> 조언 규칙(R1~R11)마다 그 규칙이 무엇을 뜻하고 무엇을 하라는지 풀어 쓴 해설이다 (ai_spec Q3). `role=ALL`이라 어느 유형이든 그 칸에서 같은 규칙이 발동하면 검색된다. 유형 파일에 같은 과목·규칙 조각이 있으면 그쪽이 먼저 쓰인다. 데이터가 말하지 않는 원인은 쓰지 않는다.

### fight.advantage.ALL.bad.R1 오브젝트 싸움 득실 비중이 큰 유형인데 부족했을 때
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=bad, rule=R1
이 유형은 오브젝트 싸움 평가에서 득실, 곧 내가 참여한 싸움에서 우리 팀이 얻은 몫의 비중이 크다. 그 몫이 낮았고 상대 라이너보다도 낮았다면 이 유형이 가장 크게 기여해야 할 곳에서 밀린 것이다. 다음 판에는 오브젝트 싸움에서 우리 팀 몫을 지키는 데 신경 쓴다.

### fight.damage.ALL.bad.R1 딜 비중이 큰 유형인데 부족했을 때
- meta: role=ALL, area=fight, subject=fight.damage, polarity=bad, rule=R1
이 유형은 오브젝트 싸움 평가에서 챔피언 딜 비중의 비중이 크다. 팀 안에서 내가 넣은 챔피언 피해의 몫이 포지션 평균보다 낮았고 상대 라이너보다도 낮았다는 뜻이다. 다음 판에는 싸움에서 챔피언 딜을 넣는 데 신경 쓴다.

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
오브젝트 싸움에서 내 딜 비중이 포지션 평균보다 낮았고, 그 싸움에서 내가 죽을 때마다 상대 팀이 득실을 얻었다. 딜로 보탠 것은 적고 데스로 내준 것은 있어서 싸움 기여가 매우 적었다는 뜻이다. 다음 판에는 오브젝트 싸움에서 죽지 않을 위치를 잡는다.

### fight.advantage.ALL.bad.R2 딜도 적고 내 데스가 상대 득실이 됐을 때 (득실 칸)
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=bad, rule=R2
내가 참여한 오브젝트 싸움에서 상대 팀이 득실을 더 많이 얻었고, 그 안에서 내 데스가 상대 팀 득실이 됐다. 딜 비중도 포지션 평균보다 낮아 싸움 기여가 매우 적었다는 뜻이다. 다음 판에는 오브젝트 싸움에서 죽지 않을 위치를 잡는다.

### fight.advantage.ALL.bad.R3 딜은 넣었지만 내 데스로 싸움을 내줬을 때
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=bad, rule=R3
내 딜 비중은 포지션 평균보다 높았지만, 내가 참여한 오브젝트 싸움에서 내 데스가 상대 팀 득실이 되어 상대 팀이 득실을 더 많이 얻었다. 딜을 넣고도 죽으면 그 데스가 싸움을 내주는 시작이 되고, 큰 골드 격차가 생긴 장면에서 내가 죽었다면 그 데스가 역전의 시발점이 된다. 다음 판에는 딜을 넣은 뒤 죽지 않는 데 신경 쓴다.

### fight.advantage.ALL.bad.R4 우리 팀이 먼저 죽고 싸움을 졌을 때
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=bad, rule=R4
데이터에는 누가 싸움을 걸었는지가 없고 누가 먼저 죽었는지만 있다. 먼저 죽은 사람이 탱커이고 싸움을 졌다면 혼자 들어갔거나 팀이 따라오지 못한 것으로 보고, 딜러였다면 먼저 잡혀 싸움을 졌다고만 말한다. 해석일 뿐이라 행동 조언은 붙이지 않는다.

### fight.advantage.ALL.good.R4 우리 팀이 먼저 죽었지만 싸움을 이겼을 때
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=good, rule=R4
데이터에는 누가 싸움을 걸었는지가 없고 누가 먼저 죽었는지만 있다. 내가 죽었어도 그 싸움에서 우리 팀 데스가 나뿐이거나 상대보다 적고, 우리 팀이 잡은 오브젝트의 득실이 내 데스로 내준 득실보다 크면 이득 교환으로 본다. 그 밖에 먼저 죽은 사람이 탱커이고 싸움을 이겼다면 싸움을 연 것으로 보고, 딜러였다면 먼저 잡혔지만 팀이 받아쳐 이겼다고만 말한다. 해석일 뿐이라 행동 조언은 붙이지 않는다.

### macro.solo.ALL.bad.R5 혼자 싸워 죽은 장면이 있을 때
- meta: role=ALL, area=macro, subject=macro.solo, polarity=bad, rule=R5
오브젝트 싸움 밖에서 킬 하나로 끝난 싸움에 내가 죽은 장면이 있고, 단독 킬보다 단독 데스가 많았다. 그 시각과 지역에서 혼자 싸워 상대에게 킬을 내준 것이다. 다음 판에는 그 시각과 지역 같은 상황에서 혼자 싸우지 않는다.

## Q4 라인전·오브젝트 싸움 규칙 (R6~R11)

> 2026-11-19 (ai_spec Q4). 라인전 칸(2-1 성장·2-2 라인 밖 관여·2-3 데스 유형)과 오브젝트 싸움 버티기·제어 와드 규칙의 공통 해설이다. 롤 일반 지식만 쓰고, 판 데이터에 없는 원인(교환 전 체력, 웨이브 상태, 싸움을 건 사람)과 챔피언 상성은 쓰지 않는다.

### laning.deaths.ALL.bad.R6 라인전에서 상대 라이너에게 일대일로 죽었을 때
- meta: role=ALL, area=laning, subject=laning.deaths, polarity=bad, rule=R6
라인전에서 상대 라이너가 어시스트 없이 혼자 나를 잡은 데스다. 죽기 직전 내가 준 피해가 받은 피해보다 훨씬 적었다면 교환이 일방적이었다는 뜻이다. 데이터에는 교환 전 체력이 없어 왜 졌는지는 알 수 없고, 그 시각과 지역에서 상대 라이너와 맞붙어 졌다는 사실만 있다. 다음 판에는 라인전 일대일 교환에 더 집중해서 신경 쓴다.

### laning.deaths.ALL.bad.R7 라인전에서 상대 정글의 갱에 죽었을 때
- meta: role=ALL, area=laning, subject=laning.deaths, polarity=bad, rule=R7
라인전에서 상대 정글이 킬이나 어시스트, 또는 피해로 관여한 데스다. 죽기 전 내가 둔 와드가 없었다면 상대 정글이 오는 길을 미리 보지 못한 상태였다는 뜻이다. 다음 판에는 갱에 당한 그 지역 쪽에 와드를 먼저 둔다.

### laning.growth.ALL.bad.R8 라인전 성장이 상대 라이너보다 뒤졌을 때
- meta: role=ALL, area=laning, subject=laning.growth, polarity=bad, rule=R8
라인전 비교 시점에 골드가 상대 라이너보다 뒤졌고 레벨은 같거나 뒤졌다. 골드 차는 킬과 어시스트로 얻은 골드, 미니언 처치, 포탑 방패에서 생기며, 그중 상대 쪽이 가장 많이 앞선 한 가지를 원인으로 본다. 상대가 킬 골드를 더 얻었다면 상대에게 킬을 내주는 데스에, 미니언 처치가 뒤졌다면 미니언 처치에, 방패가 뒤졌다면 포탑 방패에 신경 쓴다. 레벨이 뒤진 원인이 데스나 라인을 비운 횟수라면 그 횟수에 신경 쓴다. 다음 판에는 그 원인 하나에만 신경 쓴다.

### laning.roam.ALL.bad.R9 상대 라이너가 라인 밖 싸움에 더 많이 참여했을 때
- meta: role=ALL, area=laning, subject=laning.roam, polarity=bad, rule=R9
라인전 동안 상대 라이너가 내 라인을 비우고 다른 라인이나 정글 싸움에서 나보다 많은 킬과 어시스트에 참여했다. 상대가 라인을 비운 시간은 내가 상대 포탑 방패를 깨거나 상대를 따라가 그 싸움에 합류할 수 있는 시간이다. 그 사이 방패를 깼다면 비운 시간을 활용한 것이므로 잘한 점으로 함께 짚는다. 다음 판에는 상대가 라인을 비운 시각에 상대를 따라가거나 상대 포탑 방패를 압박한다.

### fight.damage.ALL.bad.R10 딜러가 오브젝트 싸움 첫 킬 직후 곧바로 죽었을 때 (딜 칸)
- meta: role=ALL, area=fight, subject=fight.damage, polarity=bad, rule=R10
딜러 유형인데 오브젝트 싸움의 첫 킬이 난 직후 곧바로 죽었다. 싸움이 이어지는 동안 살아 있지 못하면 그 싸움에서 넣을 수 있는 딜도 거기서 끝난다. 다음 판에는 오브젝트 싸움에서 죽지 않을 위치를 잡는다.

### fight.advantage.ALL.bad.R10 딜러가 오브젝트 싸움 첫 킬 직후 곧바로 죽었을 때 (득실 칸)
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=bad, rule=R10
딜러 유형인데 내가 참여한 오브젝트 싸움에서 첫 킬 직후 곧바로 죽었다. 내 데스는 상대 팀의 득실이 되고, 남은 싸움은 아군이 한 명 적은 채로 치르게 된다. 다음 판에는 오브젝트 싸움에서 죽지 않을 위치를 잡는다.

### fight.vision.ALL.bad.R11 상대가 잡은 오브젝트 전에 제어 와드가 없었을 때
- meta: role=ALL, area=fight, subject=fight.vision, polarity=bad, rule=R11
상대 팀이 잡은 오브젝트 전 시간 동안 내가 둔 제어 와드가 없었다. 제어 와드는 상대 와드를 드러내고 없애 오브젝트 주변 시야를 지키는 와드다. 다음 판에는 그 오브젝트가 나오기 전에 오브젝트 근처에서 제어 와드를 돌려 상대 와드를 탐지하고 지운다.

### fight.damage.ALL.good.P1 팀에서 챔피언 딜을 가장 많이 넣고 한 시간대 딜 비중이 포지션 평균보다 크게 높았을 때
- meta: role=ALL, area=fight, subject=fight.damage, polarity=good, rule=P1
우리 팀 다섯 명 가운데 게임 전체 챔피언 딜이 가장 많았고, 한 시간대의 팀 내 딜 비중이 포지션 평균보다 크게 높았다. 그 시간대 싸움에서 팀의 주된 피해원이었다는 뜻이다. 칭찬은 게임 전체에서 팀 딜이 가장 많았다는 것과, 어느 시간대였는지와 그때의 비중·포지션 평균을 나눠 짚을 때 설득력이 있다. 딜 비중은 시간대 전체의 누적 값이므로 한 싸움의 순간 딜로 바꿔 말하지 않는다.

### macro.solo.ALL.good.P2 상대를 일대일로 여러 번 잡았을 때
- meta: role=ALL, area=macro, subject=macro.solo, polarity=good, rule=P2
내가 마지막 일격을 넣었고 도운 아군이 없으며, 상대가 죽기 직전에 받은 챔피언 피해도 나에게서만 나왔다면 그 킬은 혼자 따낸 일대일 승리다. 일대일 킬이 여러 번이면 그 판에서 내 챔피언이 상대 챔피언보다 강했던 순간이 되풀이됐다는 뜻이다. 오브젝트 싸움 밖의 단독 킬과는 세는 방법이 달라 일대일 킬 수로만 짚는다.

### fight.damage.ALL.good.P3 후반으로 갈수록 딜 비중이 높아졌을 때
- meta: role=ALL, area=fight, subject=fight.damage, polarity=good, rule=P3
시간대별 팀 내 딜 비중이 후반에 가장 높았고 그때 포지션 평균보다 크게 높았다. 성장이 쌓일수록 싸움에서 맡은 몫이 커졌다는 뜻이다. 라인전이 열세였는데도 후반에 이렇게 바뀌었다면 초반의 손해를 후반 싸움에서 되찾은 것이다. 칭찬은 시간대별 비중의 흐름을 함께 짚는다.

### macro.solo.ALL.good.P3 후반에 상대를 일대일로 여러 번 잡았을 때
- meta: role=ALL, area=macro, subject=macro.solo, polarity=good, rule=P3
게임 후반에도 상대를 일대일로 여러 번 잡았다면 장비와 레벨이 갖춰진 뒤에도 내 챔피언이 상대보다 강했다는 뜻이다. 후반의 킬은 부활 시간이 길어 상대 팀이 한동안 한 명 적은 채로 버텨야 한다. 칭찬은 후반 일대일 킬 수와 그 시각을 함께 짚는다.

### fight.advantage.ALL.good.P4 오브젝트 싸움에 여러 번 참여해 우리 팀이 크게 이겼을 때
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=good, rule=P4
오브젝트를 두고 벌어진 싸움에 여러 번 참여했고 그 싸움들에서 킬과 포탑과 오브젝트로 얻은 득실을 합치면 우리 팀이 크게 앞섰다. 오브젝트 싸움에 꾸준히 함께하며 이기는 쪽에 섰다는 뜻이다. 칭찬은 참여한 싸움 수와 두 팀이 얻은 득실을 함께 짚는다. 득실은 팀 전체의 결과이므로 내 역할은 그 싸움들에서 우리 팀 킬 가운데 내가 관여한 비율과 잡은 상대가 받은 피해 가운데 내 몫으로 더한다.
