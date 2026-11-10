# 딜정글 (JUNGLE_DAMAGE) 관점 조각

> 딜정글은 오브젝트 막타 비중이 크고, 교전 딜도 함께 본다. 운영에서는 파밍과 시야, 득실이 크다.

### fight.objective.JUNGLE_DAMAGE.good.01 딜정글이 오브젝트를 많이 챙겼을 때
- meta: role=JUNGLE_DAMAGE, area=fight, subject=fight.objective, polarity=good
딜정글이 오브젝트 막타를 많이 쳤다면 오브젝트를 빠르게 처치할 힘과 타이밍을 함께 갖춘 것일 수 있다. 다음 판에도 오브젝트 체력이 낮아질 때 강타를 아껴 두고, 상대 정글이 들어올 강 입구에 와드를 먼저 둔다.

### fight.objective.JUNGLE_DAMAGE.bad.01 딜정글의 오브젝트 막타가 적을 때
- meta: role=JUNGLE_DAMAGE, area=fight, subject=fight.objective, polarity=bad
딜정글의 오브젝트 막타가 적고 그 오브젝트를 상대 팀이 잡았다면, 오브젝트 시간에 갱킹이나 파밍으로 다른 곳에 있었을 수 있다. 다음 판에는 그 오브젝트가 다시 나오는 시간에 맞춰 캠프 순서를 거꾸로 짜서, 나오기 전에 오브젝트 쪽 강 입구에 도착한다.

### fight.damage.JUNGLE_DAMAGE.bad.01 딜정글의 교전 딜이 낮을 때
- meta: role=JUNGLE_DAMAGE, area=fight, subject=fight.damage, polarity=bad
딜정글의 딜 비중이 기대보다 낮으면 싸움에 늦게 들어갔거나 오브젝트를 치느라 싸움 딜을 넣지 못했을 수 있다. 다음 판에는 오브젝트를 챙긴 직후 강타가 빠진 채로 오브젝트 옆에 머물지 않고 남은 싸움의 가장 가까운 상대에게 바로 들어간다.

### macro.farm.JUNGLE_DAMAGE.bad.01 딜정글의 중후반 파밍이 낮을 때
- meta: role=JUNGLE_DAMAGE, area=macro, subject=macro.farm, polarity=bad
딜정글의 중후반 분당 CS가 낮으면 캠프가 다시 생긴 뒤에도 챙기지 못한 시간이 길었을 수 있다. 다음 판에는 싸움이 끝나면 우리 정글의 가까운 캠프부터 돌고, 비어 있는 라인 미니언도 함께 챙긴다.

### macro.vision.JUNGLE_DAMAGE.bad.01 딜정글의 평소 시야가 낮을 때
- meta: role=JUNGLE_DAMAGE, area=macro, subject=macro.vision, polarity=bad
딜정글의 평소 시야가 낮으면 상대 정글 위치를 모른 채 동선을 짠 시간이 길었을 수 있다. 다음 판에는 첫 귀환 뒤 상대 정글 입구 중 다음 오브젝트와 가까운 쪽에 와드를 하나 두고, 그 와드에 상대 정글이 보이면 반대편 라인으로 움직인다.
