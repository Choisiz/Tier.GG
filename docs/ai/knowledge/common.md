# 공통 관점 조각 (모든 유형)

> 유형과 관계없이 쓰는 해석이다. `role=ALL`이라 어느 유형이든 같은 과목·방향이면 검색된다. 유형 파일에 같은 과목 조각이 있으면 그쪽이 먼저 쓰인다.

### laning.gold.ALL.bad.01 라인전 골드가 뒤졌을 때
- meta: role=ALL, area=laning, subject=laning.gold, polarity=bad
라인전 골드가 상대 라이너보다 적으면 CS를 놓쳤거나 데스로 골드를 내준 경우가 많을 수 있다. 비교 시점 전 데스가 그 라인의 상대 포탑 쪽에서 났다면, 다음 판에는 상대 정글이 지도에 보이지 않는 동안 라인 가운데를 넘지 않고 우리 포탑 쪽에서 막타만 챙긴다. 데스 없이 골드가 뒤졌다면 상대와 교환하기보다 미니언 막타를 먼저 친다.

### laning.gold.ALL.good.01 라인전 골드가 앞섰을 때
- meta: role=ALL, area=laning, subject=laning.gold, polarity=good
라인전 골드가 앞섰다면 라인에서 손해 없이 자원을 챙겼다는 뜻일 수 있다. 골드가 앞선 채 귀환했다면, 다음 판에도 귀환 뒤 다음 오브젝트가 나오기 전에 그 오브젝트 쪽 강 입구로 먼저 가서 아군 정글과 함께 자리를 잡는다.

### laning.level.ALL.bad.01 라인전 레벨이 뒤졌을 때
- meta: role=ALL, area=laning, subject=laning.level, polarity=bad
레벨이 상대 라이너보다 낮으면 경험치를 받지 못한 시간이 길었다는 뜻일 수 있다. 비교 시점 전에 데스가 있었다면 그 데스 뒤 라인으로 돌아오는 동안 경험치가 빠졌을 수 있다. 다음 판에는 라인을 비우기 전에 미니언 웨이브를 상대 포탑까지 밀어 두고 움직인다.

### laning.level.ALL.good.01 라인전 레벨이 앞섰을 때
- meta: role=ALL, area=laning, subject=laning.level, polarity=good
레벨이 앞섰다면 라인을 오래 지키며 경험치를 꾸준히 받았다는 뜻일 수 있다. 다음 판에도 상대보다 먼저 레벨이 오른 순간에 상대 정글이 반대편 라인에서 보였다면 그때 바로 짧은 교환을 건다.

### laning.kda.ALL.bad.01 라인전에서 데스가 많았을 때
- meta: role=ALL, area=laning, subject=laning.kda, polarity=bad
라인전 데스가 킬보다 많으면 라인전의 다른 손해도 여기서 시작됐을 수 있다. 데스 지역이 그 라인의 상대 포탑 쪽이고 상대 정글이 관여했다면, 다음 판에는 상대 정글이 보이지 않는 동안 라인 가운데를 넘지 않고 우리 포탑 쪽에서 미니언을 받는다. 상대 정글 없이 잡혔다면 상대의 주요 스킬이 빠진 것을 본 뒤에만 교환을 건다.

### laning.kda.ALL.good.01 라인전 킬 관여가 앞섰을 때
- meta: role=ALL, area=laning, subject=laning.kda, polarity=good
라인전 킬 관여가 데스보다 많았다면 싸울 때와 물러설 때를 잘 고른 것일 수 있다. 다음 판에도 킬을 낸 직후 상대가 부활하기 전까지 그 라인의 상대 포탑을 먼저 치고, 그다음 가까운 오브젝트 쪽 강으로 움직인다.

### fight.advantage.ALL.bad.01 오브젝트 싸움 득실이 낮을 때
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=bad
오브젝트를 잡은 시각 앞뒤 기준 시간 안에 내가 참여한 싸움에서 우리 팀 몫이 낮으면, 싸움이 열리기 전부터 숫자나 위치에서 밀렸을 수 있다. 그 싸움에서 내가 먼저 죽었다면, 다음 판에는 같은 오브젝트가 나오기 전 아군이 모일 때까지 오브젝트 쪽 강 입구 앞에서 기다렸다가 함께 들어간다. 우리 팀 다른 사람이 먼저 죽었다면 그 아군 곁으로 미리 붙어 숫자를 맞춘다.

### macro.solo.ALL.bad.01 혼자 잡히는 데스가 많을 때
- meta: role=ALL, area=macro, subject=macro.solo, polarity=bad
오브젝트 싸움 밖에서 혼자 잡힌 데스는 시야가 없는 곳을 혼자 지나간 순간이었을 수 있다. 데스 지역이 상대 정글이나 강이라면, 다음 판에는 상대 정글이 지도에 보이지 않을 때 그 지역에 혼자 들어가지 않고, 꼭 들어가야 하면 입구에 와드를 먼저 두고 들어간다. 라인에서 잡혔다면 그 라인의 상대 포탑 쪽으로 넘어가지 않는다.

### fight.advantage.ALL.good.01 오브젝트 싸움 득실이 높을 때
- meta: role=ALL, area=fight, subject=fight.advantage, polarity=good
내가 참여한 오브젝트 싸움에서 우리 팀 몫이 높았다면 싸움 전에 아군과 함께 먼저 자리를 잡은 것일 수 있다. 그 싸움에서 상대가 먼저 죽었다면, 다음 판에도 같은 오브젝트 전에 라인을 정리하고 오브젝트 쪽 강 입구에 먼저 도착해 상대가 들어오는 길을 막는다.

### fight.damage.ALL.good.01 교전 딜 비중이 기대보다 높을 때
- meta: role=ALL, area=fight, subject=fight.damage, polarity=good
교전 딜 비중이 유형의 기대보다 높았다면 싸움에 오래 머물며 꾸준히 피해를 넣은 것일 수 있다. 다음 판에도 오브젝트 싸움이 열리면 아군 앞라인 바로 뒤에 서서 가장 가까운 상대부터 공격한다.

### fight.damage.ALL.bad.01 교전 딜 비중이 기대보다 낮을 때
- meta: role=ALL, area=fight, subject=fight.damage, polarity=bad
교전 딜 비중이 유형의 기대보다 낮으면 싸움에 늦게 들어갔거나 싸움 초반에 먼저 쓰러졌을 수 있다. 내가 참여한 싸움에서 내가 먼저 죽었다면 다음 판에는 싸움이 열릴 때 아군 앞라인보다 뒤에 선다. 싸움에 늦었다면 오브젝트가 나오기 전에 근처 라인을 먼저 정리하고 합류한다.

### fight.vision.ALL.good.01 오브젝트 전 시야가 좋을 때
- meta: role=ALL, area=fight, subject=fight.vision, polarity=good
오브젝트를 잡기 전 기준 시간 동안 시야 행동이 많았다면 싸움이 열릴 자리를 미리 밝혀 팀이 정보를 갖고 싸우게 도운 것일 수 있다. 다음 판에도 그 오브젝트 전에 오브젝트 쪽 강 입구에 제어 와드를 두고, 상대 와드를 지운 뒤 아군과 함께 자리를 잡는다.

### fight.vision.ALL.bad.01 오브젝트 전 시야가 낮을 때
- meta: role=ALL, area=fight, subject=fight.vision, polarity=bad
오브젝트를 잡기 전 기준 시간 동안 내 와드가 없었고 그 오브젝트를 상대 팀이 잡았다면, 팀이 싸움 자리를 모른 채 들어갔을 수 있다. 다음 판에는 용이면 아래쪽 강 입구에, 바론이나 전령이면 위쪽 강 입구에 그 기준 시간이 시작되기 전에 제어 와드를 먼저 둔다.

### fight.objective.ALL.good.01 오브젝트 막타를 챙겼을 때
- meta: role=ALL, area=fight, subject=fight.objective, polarity=good
오브젝트 막타를 쳤다면 오브젝트 근처에 제때 있었고 마지막 처치까지 챙긴 것일 수 있다. 다음 판에도 오브젝트 체력이 낮아질 때 오브젝트 바로 옆에 붙어 상대가 막타를 노리고 들어오는 길을 몸으로 막는다.

### fight.objective.ALL.bad.01 오브젝트 막타가 적을 때
- meta: role=ALL, area=fight, subject=fight.objective, polarity=bad
오브젝트 막타가 적고 그 오브젝트를 상대 팀이 잡았다면 오브젝트가 나올 때 다른 곳에 있었을 수 있다. 다음 판에는 그 오브젝트가 다시 나오기 전에 가까운 라인을 먼저 밀어 두고, 오브젝트 쪽 강 입구에 먼저 도착해 아군을 기다린다.

### macro.advantage.ALL.good.01 오브젝트 밖 싸움에서 팀이 앞섰을 때
- meta: role=ALL, area=macro, subject=macro.advantage, polarity=good
오브젝트 싸움 밖에서 내가 참여한 싸움의 우리 팀 몫이 높았다면 숫자가 맞는 싸움을 골라 들어간 것일 수 있다. 다음 판에도 그런 싸움에서 이긴 직후 상대가 부활하기 전에 가장 가까운 상대 포탑을 치거나, 다음 오브젝트 쪽 강에 와드를 둔다.

### macro.advantage.ALL.bad.01 오브젝트 밖 싸움에서 팀이 밀렸을 때
- meta: role=ALL, area=macro, subject=macro.advantage, polarity=bad
오브젝트 싸움 밖에서 내가 참여한 싸움의 우리 팀 몫이 낮으면 숫자가 맞지 않는 싸움에 휘말렸을 수 있다. 그 싸움이 상대 정글이나 강에서 났고 내가 먼저 죽었다면, 다음 판에는 그 지역에 들어가기 전에 입구에 와드를 두고 가장 가까운 아군과 함께 들어간다. 우리 정글에서 났다면 강 쪽 입구에 와드를 먼저 두고 아군 쪽으로 물러서며 싸운다.

### macro.solo.ALL.good.01 혼자 싸운 결과가 좋았을 때
- meta: role=ALL, area=macro, subject=macro.solo, polarity=good
혼자 이긴 싸움이 혼자 잡힌 횟수보다 많았다면 상대를 잡을 수 있는 순간을 잘 고른 것일 수 있다. 다음 판에도 단독 킬을 낸 직후 상대가 부활하기 전까지 그 라인의 상대 포탑을 치거나 가까운 오브젝트로 움직인다.

### macro.side.ALL.good.01 사이드 압박이 좋았을 때
- meta: role=ALL, area=macro, subject=macro.side, polarity=good
포탑 피해가 포지션 기대보다 높았다면 라인을 밀며 상대 포탑을 꾸준히 압박한 것일 수 있다. 다음 판에도 사이드를 밀다가 상대 정글과 미드가 함께 지도에서 사라지면 그 라인의 우리 포탑 쪽으로 바로 물러선다.

### macro.side.ALL.bad.01 사이드 압박이 낮을 때
- meta: role=ALL, area=macro, subject=macro.side, polarity=bad
포탑 피해가 포지션 기대보다 낮으면 라인을 밀어 포탑을 칠 시간이 적었을 수 있다. 다음 판에는 오브젝트 싸움에서 이긴 직후 바로 귀환하지 않고 가장 가까운 상대 포탑부터 친다.

### macro.farm.ALL.good.01 중후반 파밍이 좋았을 때
- meta: role=ALL, area=macro, subject=macro.farm, polarity=good
중후반 분당 CS가 포지션 기대보다 높았다면 싸움 사이 시간을 라인과 캠프로 잘 채운 것일 수 있다. 다음 판에도 다음 오브젝트가 나오기 전에는 그 오브젝트와 가까운 쪽 라인을 골라 파밍한다.

### macro.farm.ALL.bad.01 중후반 파밍이 낮을 때
- meta: role=ALL, area=macro, subject=macro.farm, polarity=bad
중후반 분당 CS가 포지션 기대보다 낮으면 싸움이 없는 시간에 라인이나 캠프를 비워 둔 시간이 길었을 수 있다. 다음 판에는 오브젝트 싸움이 끝나면 정글에 머물지 않고 가장 가까운 라인의 미니언부터 정리한다.

### macro.vision.ALL.good.01 평소 시야가 좋았을 때
- meta: role=ALL, area=macro, subject=macro.vision, polarity=good
오브젝트 시간 밖의 시야 점수가 포지션 기대보다 높았다면 지도에 정보를 꾸준히 깔아 팀이 안전하게 움직이도록 도운 것일 수 있다. 다음 판에도 다음 오브젝트가 나오기 전에 그 오브젝트 쪽 강 입구와 상대 정글 입구에 와드를 둔다.

### macro.vision.ALL.bad.01 평소 시야가 낮을 때
- meta: role=ALL, area=macro, subject=macro.vision, polarity=bad
오브젝트 시간 밖의 시야 점수가 포지션 기대보다 낮으면 와드를 쓰지 않고 남겨 둔 시간이 길었을 수 있다. 다음 판에는 와드 충전이 다 차면 바로 가까운 강 입구에 쓰고, 귀환할 때마다 제어 와드를 하나 사서 우리 정글 입구에 둔다.
