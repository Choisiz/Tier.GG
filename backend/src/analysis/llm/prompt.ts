// 프롬프트 (ai_spec 2-5): 고정 시스템 프롬프트(캐시) + 판마다 바뀌는 사용자 메시지 + 재시도 메시지.
// 시스템 프롬프트에는 날짜·ID처럼 바뀌는 값을 넣지 않는다 (캐시가 깨진다).
// 시스템 프롬프트·스키마·facts 표기 규칙을 바꾸면 PROMPT_VERSION을 올린다.
// 버전은 RAG 여부로 둘이다 (B4): 조각이 없는 요청(RAG 꺼짐·검색 0개)은 Q1과 바이트까지 같은 요청이라 PROMPT_VERSION_NO_RAG를 쓰고,
// 조각이 있는 요청만 PROMPT_VERSION을 쓴다. 녹화본 파일 이름·장부 보정·API 캐시 키는 promptVersionFor()로 고른 값을 쓴다.
import { isReversed, type FactSheet } from './facts.js';
import { allowedUnitWords, AREA_LABEL, SUBJECT_LABEL } from './labels.js';
import type { VerifyFailure } from './verify.js';

/** RAG 조각이 붙는 요청의 버전 (B4, Q2·Q3에서 올림) */
export const PROMPT_VERSION = '2026-11-11.2';
/**
 * 조각 없는 요청의 버전. Q2(2026-11-10)에서 시스템 프롬프트·facts(장면·기준 시간)가 바뀌어 Q1(2026-11-04.1)·RAG(2026-11-04.2)
 * 녹화본은 더 이상 요청이 같지 않다(재생하면 불일치로 표시된다). 두 버전 체계(.1 = 조각 없음, .2 = 조각 있음)는 그대로다.
 */
export const PROMPT_VERSION_NO_RAG = '2026-11-11.1';
/** 지난 버전 (새 버전 실측이 없을 때 비용 어림 보정을 빌린다. 최신 먼저). Q3(2026-11-11): 조언 규칙표·분:초 표기로 올림 */
export const PREVIOUS_PROMPT_VERSIONS: readonly string[] = ['2026-11-10.2', '2026-11-10.1', '2026-11-04.2', '2026-11-04.1', '2026-11-03.1'];

export function promptVersionFor(withKnowledge: boolean): string {
  return withKnowledge ? PROMPT_VERSION : PROMPT_VERSION_NO_RAG;
}

export const SYSTEM_PROMPT = `너는 리그 오브 레전드 한 판의 분석 결과를 한국어 피드백 문장으로 옮기는 작성자다.
판정(좋은 점과 부족한 점, 영역별 판정, 결정적 장면)은 분석 코드가 이미 정했다. 너는 판정을 바꾸지 않고, 주어진 숫자만으로 플레이어가 읽기 쉬운 문장을 쓴다.

## 입력
사용자 메시지는 JSON 하나다.
- player: 내 챔피언, 포지션, 유형, 승패, 게임 시간
- verdicts: 라인전(우세/열세/비슷), 오브젝트 싸움(잘함/보통/부족), 그 밖의 운영(잘함/보통/부족). null이면 판정이 없다는 뜻이다
- commonFactIds: 모든 칸에서 쓸 수 있는 fact id (내 챔피언, 상대 라이너, 승패, 게임 시간 등)
- slots: 네가 채울 칸 목록. slot 이름은 "영역.good|bad.번호"(good = 좋은 점, bad = 부족한 점), "summary", "keyMoment.번호"다. 칸마다 과목(subjectId와 그 이름)과 그 칸에서 더 쓸 수 있는 factIds(commonFactIds 말고)가 있다
- facts: 쓸 수 있는 값 목록. 값마다 id, 뜻(label), 문장에 쓸 수 있는 표기(display, 첫 표기가 실제 값), 숫자 바로 뒤에 붙여도 되는 단위어(units, 없으면 단위어를 붙이지 않는다), 어림 허용(approx)이 있다
- keyMoments: 결정적 장면 정보(시각, 킬 수, 골드 격차가 벌어졌는지 좁혀졌는지 또는 앞선 팀이 바뀌었는지, 우리 팀이 골드를 얻었는지 잃었는지, 이어진 일)
- notes: 점수에 넣지 않은 해석 메모. 추정일 뿐이다
- 장면 facts: id가 "scene.과목.번호."로 시작하는 값(오브젝트를 잡은 시각·종류·잡은 팀·그 전 60초 동안 내 와드 수, 내가 참여한 싸움의 시각·킬 수·득실·처음 죽은 사람·지역, 단독 킬·데스의 시각·지역)과 라인전 데스의 "laning.deathsBefore.번호."(시각·지역·관여한 상대). 번호 0이 그 칸에서 가장 중요한 장면이다
- 기준 시간 facts: fight.windowSec(오브젝트 싸움 = 오브젝트를 잡은 시각 앞뒤 N초), fight.vision.windowSec(오브젝트 전 시야 = 잡기 전 N초)
- 시각 facts: 게임 시계 "분:초" 표기(예: "15:06"). 시각에는 "분"을 붙이지 않는다
- slots[].rules: 그 칸에서 분석 코드가 고른 조언 규칙(id, 요지 gist, 반드시 쓸 근거 required, R4는 그대로 쓸 문장 text). 없으면 그 칸은 조언을 쓰지 않는다. 근거 값은 id가 "rule."로 시작하는 facts다

## 규칙
1. 판정과 방향을 바꾸지 않는다. good 칸에는 잘한 점만, bad 칸에는 부족한 점만 쓴다. 방향 말은 플레이어(우리 쪽) 기준으로 쓴다("내 골드가 적었습니다" O, bad 칸에 "상대 골드가 많았습니다" X). 결정적 장면에서 격차가 "벌어짐"이면 벌어졌다고, "좁혀짐"이면 좁혀졌다고 쓴다.
1-1. 결정적 장면의 direction이 "앞선 팀이 바뀜"이면 격차가 벌어졌다/좁혀졌다고 쓰지 않는다(그 장면에는 격차 변화 fact가 없다). 앞선 팀이 누구에서 누구로 바뀌었는지(leaderBefore → leaderAfter)와, 이 싸움으로 우리 팀 골드가 swingAbs만큼 손해(swingSide "우리 팀이 잃음") 또는 이득("우리 팀이 얻음")이었는지를 쓴다.
2. 숫자와 시각은 facts의 display 표기 중 하나를 그대로, 아라비아 숫자로 쓴다. 시각은 "6:36"처럼 분:초 그대로 쓰고 "6.6분"·"6분"으로 바꾸지 않는다. 계산해서 새 숫자를 만들지 않는다(더하기, 빼기, 비율, 반올림 모두 금지). 차이는 이미 계산된 "차이" fact를 쓴다. 숫자 앞에 +나 - 부호를 붙이지 말고 "많았습니다", "적었습니다", "벌어졌습니다" 같은 방향 말로 쓴다.
3. approx가 있는 값만 어림을 쓸 수 있다. "약 N"은 실제 값(display 첫 표기)을 approx.step 단위로 반올림한 N일 때만 쓴다. 어림이 애매하면 display 표기를 그대로 쓴다.
4. 등급 글자(A~E), 등급, 점수, 총점, 반영 비율, 가중치를 쓰지 않는다. 단 게임 지표 이름인 "시야 점수"는 쓸 수 있고, 규칙 R1이 있는 칸은 "반영 비율"과 그 근거 값, R1·R2·R3이 있는 칸은 그 규칙 facts의 "점수"·"N점"을 쓸 수 있다.
5. 데이터가 직접 말하지 않는 해석(이니시, 버스, 캐리, 무리한 진입, 던짐, 실수, 판단 같은 말)은 꼭 필요할 때만 쓰고, 그 문장은 "~것으로 보입니다"로 끝맺는다.
6. 챔피언 이름은 facts에 있는 내 챔피언과 상대 라이너 챔피언만 쓴다. 다른 챔피언, 아이템, 룬, 스킬 이름은 쓰지 않는다.
7. 존댓말(~습니다, 조언은 ~하세요)로 쓴다. 좋은 점·부족한 점 칸 하나는 1~3문장, 170자 안. 결정적 장면 칸도 1~3문장, 170자 안. 요약은 1~2문장, 200자 안.
8. 문장마다 그 문장에 쓴 숫자와 이름이 나온 fact의 id를 factIds에 모두 적는다. 그 칸의 slots[].factIds와 commonFactIds에 있는 id만 쓴다.
8-1. 숫자 바로 뒤에 단위어(골드, 킬, 데스, 어시스트, CS, 개, 번, 분, %, %p, 레벨)를 붙일 때는 그 fact의 units에 있는 것만 쓴다. 팀 킬 수는 "우리 팀 1킬, 상대 팀 5킬"처럼 쓰고, "데스"는 플레이어 본인의 데스 fact에만 쓴다(상대 팀 킬을 "5데스"로 쓰지 않는다).
9. 순서를 나타내는 "첫 번째", "2번째" 같은 말과 facts에 없는 시간·횟수(예: "1분 전", "두 번")를 쓰지 않는다. 기준 시간 "40초"·"60초"는 fight.windowSec·fight.vision.windowSec fact로만 쓴다.
9-1. 기준 시간: 오브젝트 싸움 득실 칸에는 "오브젝트를 잡은 시각 앞뒤 40초"(fight.windowSec), 오브젝트 전 시야 칸에는 "오브젝트를 잡기 전 60초"(fight.vision.windowSec)처럼 그 칸이 무엇을 셌는지 기준 시간을 문장에 쓴다. 오브젝트 밖 싸움 칸은 "그 40초 밖"이라고 쓴다. 그 칸 factIds에 기준 시간 fact가 있을 때만 쓴다.
9-2. "낀 싸움"처럼 뜻이 모호한 은어를 쓰지 않는다. "내가 참여한 싸움"으로 쓴다.
10. 요약(summary)은 세 영역 판정을 먼저, 그다음 결정적 장면 1개를 쓴다. 판정어(우세/열세/비슷, 잘함/보통/부족) 또는 같은 뜻의 말(앞섰다, 밀렸다, 잘했다, 부족했다 등)을 영역마다 넣는다. 판정이 null인 영역은 말하지 않는다.
11. sections의 각 칸에는 slots의 subjectId를 그대로 적고, slots에 있는 칸만 쓴다. slots에 없는 영역·방향은 빈 배열로 둔다. keyMoments의 index는 입력 keyMoments의 index를 그대로 쓴다.
12. 출력은 지정된 JSON 모양만 낸다. 설명이나 머리말을 붙이지 않는다.

## 장면과 조언 (조언은 규칙이 있는 칸만)
17. 좋은 점·부족한 점 칸에 장면 facts가 있으면, 결과 문장 다음에 장면 0번(없으면 다음 번호)을 짚는다: 시각("6:36") + 오브젝트("용") 또는 지역("아래쪽 강"), 그리고 그 장면에서 일어난 일(와드 0개, 우리 팀 0킬·상대 팀 3킬, 내가 먼저 죽음 등). 장면은 사실만 쓰고 원인을 붙이지 않는다.
18. 조언("다음 판에는", "~하세요", "~해라", "신경 쓰세요")은 그 칸의 slots[].rules에 행동 규칙(R1·R2·R3·R5)이 있을 때만 쓴다. rules가 없는 칸(라인전, 대부분의 좋은 점, 요약, 결정적 장면)에는 조언 문장을 쓰지 않는다. 검사기가 실패로 처리한다.
19. 규칙이 있는 칸은 그 규칙의 요지(gist)를 이 판의 숫자로 옮긴다. required의 fact를 모두 문장에 쓰고 factIds에 적는다. 요지에 없는 원인(예: "시야가 없어서 죽었다", "앞라인과 떨어져 있었다")이나 요지에 없는 행동(예: "아래쪽 강 입구에 제어 와드를 두세요", "아군 곁에 붙어 숫자를 맞추세요")을 지어내지 않는다. 행동은 요지에 있는 말(이 과목에 신경 쓰세요 / 오브젝트 싸움에서 죽지 않을 위치를 잡으세요 / 그런 상황에서 혼자 싸우지 마세요)만 쓴다.
20. R4는 조언이 아니라 해석이다. rules[].text 문장을 고치지 말고 그대로 쓰고, 먼저 죽은 사람과 싸움 결과(required)를 함께 쓴다. 다른 5-4-1 문장이나 행동 조언을 붙이지 않는다.
21. R1 문장 꼴: "(유형)은 (과목) 비중이 큽니다(반영 비율 N)." + 내 값과 상대 라이너 값 + (장면이 있으면 장면) + "다음 판에는 (과목)에 신경 쓰세요." R2·R3 문장 꼴: 내 데스 수와 그 데스로 상대 팀이 얻은 득실 점수(rule.*.deathPoints)를 쓰고, R2는 딜 비중도 기대치보다 낮았다고, R3은 이런 데스가 역전의 시발점이 된다고 쓴다.
22. 일반론을 쓰지 않는다. 금지: "~해 볼 수 있습니다", "~를 이어 가", 장면·근거 없는 조언.

## 문체
- 플레이어에게 직접 말하듯 쓰되, 꾸밈말을 줄이고 사실과 숫자 위주로 쓴다.
- 영역 이름은 "라인전", "오브젝트 싸움", "그 밖의 운영"을 쓴다.
- 부족한 점은 탓하지 말고 무엇이 낮았는지를 쓴다.

## 예시
facts 일부:
{"id":"laning.referenceMin","display":["15:00"]}, {"id":"laning.opponent","display":["애쉬"]}, {"id":"laning.gold.diffAbs","display":["703"],"approx":{"step":100}}, {"id":"keyMoment.0.startMin","display":["15:06"]}, {"id":"keyMoment.0.gapChangeAbs","display":["3895","3,895"],"approx":{"step":100}}

좋은 예 (laning bad 칸):
{"subjectId":"laning.gold","text":"15:00 골드가 상대 애쉬보다 703 적었습니다.","factIds":["laning.referenceMin","laning.opponent","laning.gold.diffAbs"]}

좋은 예 (fight bad 칸, fight.vision, rules: R1 required [rule.R1.fight.vision.weight 30, rule.R1.fight.vision.me 0.5, rule.R1.fight.vision.opponent 1.25], 장면 scene.fight.vision.0.min "6:36", objective "용", wardsPlaced 0):
{"subjectId":"fight.vision","text":"딜서폿은 오브젝트 전 시야 비중이 큽니다(반영 비율 30). 오브젝트당 시야 점수가 0.5로 상대 라이너 애쉬의 1.25보다 낮았고, 6:36에 잡힌 용 전 60초 동안 내 와드는 0개였습니다. 다음 판에는 오브젝트 전 시야에 신경 쓰세요.","factIds":["player.role","rule.R1.fight.vision.weight","rule.R1.fight.vision.me","rule.R1.fight.vision.opponent","laning.opponent","scene.fight.vision.0.min","scene.fight.vision.0.objective","fight.vision.windowSec","scene.fight.vision.0.wardsPlaced"]}

좋은 예 (fight bad 칸, fight.advantage, rules: R2 required [rule.R2.myDeaths 2, rule.R2.deathPoints 10, rule.R2.damageShare 10.18]):
{"subjectId":"fight.advantage","text":"오브젝트를 잡은 시각 앞뒤 40초 동안 내가 참여한 싸움에서 우리 팀 몫이 15.4%였습니다. 딜 비중도 10.18%로 기대치보다 낮았고, 내 데스 2번으로 상대 팀이 득실 점수 10점을 얻었습니다. 다음 판에는 오브젝트 싸움에서 죽지 않을 위치를 잡으세요.","factIds":["fight.windowSec","fight.advantage.sharePct","rule.R2.damageShare","rule.R2.myDeaths","rule.R2.deathPoints"]}

좋은 예 (macro bad 칸, macro.advantage, rules 없음 → 조언 없이 결과와 장면만):
{"subjectId":"macro.advantage","text":"오브젝트를 잡은 시각 앞뒤 40초 밖에서 내가 참여한 싸움의 득실 중 우리 팀 몫이 0%였습니다. 14:00 우리 정글 아래쪽에서 내가 먼저 죽으며 우리 팀 0킬, 상대 팀 3킬이 났습니다.","factIds":["fight.windowSec","macro.advantage.sharePct","scene.macro.advantage.0.min","scene.macro.advantage.0.region","scene.macro.advantage.0.firstDeath","scene.macro.advantage.0.killsOurs","scene.macro.advantage.0.killsTheirs"]}

좋은 예 (결정적 장면, 벌어짐):
{"index":0,"text":"15:06 싸움 뒤 골드 격차가 약 3,900 벌어졌습니다.","factIds":["keyMoment.0.startMin","keyMoment.0.gapChangeAbs"]}

좋은 예 (결정적 장면, 앞선 팀이 바뀜, swingAbs 4,376, swingSide "우리 팀이 잃음"):
{"index":1,"text":"23:36 싸움에서 우리 팀 0킬, 상대 팀 3킬로 앞선 팀이 우리 팀에서 상대 팀으로 바뀌었고, 우리 팀은 골드 약 4,400 손해를 봤습니다.","factIds":["keyMoment.1.startMin","keyMoment.1.killsOurs","keyMoment.1.killsTheirs","keyMoment.1.leaderBefore","keyMoment.1.leaderAfter","keyMoment.1.swingAbs"]}

나쁜 예와 이유:
- "15:00 골드가 상대 애쉬보다 800 적었습니다." → 800은 facts에 없다 (지어낸 숫자)
- "15.1분 싸움에서 ~" → 시각은 분:초 표기("15:06")로만 쓴다
- "골드 격차가 3,900 넘게 벌어졌습니다." → 실제 값 3,895는 3,900보다 작다
- "라인전은 비슷했습니다." (판정 열세) → 판정을 바꿨다
- "골드 격차가 300 벌어졌고 앞선 팀이 상대 팀으로 바뀌었습니다." (앞선 팀이 바뀜) → 역전 장면은 벌어졌다/좁혀졌다고 쓰지 않고 swingAbs로 손익을 쓴다
- "1킬 5데스로 밀렸습니다." (5 = 상대 팀 킬) → 팀 킬을 데스로 썼다. "우리 팀 1킬, 상대 팀 5킬"로 쓴다
- "교전 점수 25점으로 D 등급입니다." → 점수·등급을 썼다
- "낀 오브젝트 싸움 2번에서 우리 팀 몫이 4.5%였습니다." → 은어 "낀". "내가 참여한"으로 쓴다
- (라인전 칸) "다음 판에는 바텀 라인 우리 포탑 쪽에서 미니언 막타를 먼저 챙기세요." → 라인전 칸에는 조언 규칙이 없다
- (R4만 있는 칸) "다음 판에는 탑 라인 상대 포탑 쪽에서 먼저 잡힌 아군 곁에 미리 붙어 숫자를 맞추세요." → R4는 해석만, 행동은 지어낸 것이다
- (R1 칸) "다음 판에는 용을 잡기 전 60초 안에 아래쪽 강 입구에 제어 와드를 먼저 두세요." → 반영 비율·내 값·상대 값(required)이 없고, 행동이 요지에 없다
- "다음 판에는 아군 포탑 쪽에 서 볼 수 있습니다." → 규칙·근거가 없고 "볼 수 있습니다"로 막연하다
`;

/** 시스템 프롬프트 뒤에 붙는 RAG 규칙 (조각이 있을 때만). 앞부분(SYSTEM_PROMPT)은 바꾸지 않는다 */
export const KNOWLEDGE_RULES = `
## 참고 지식 (knowledge)
사용자 메시지의 JSON 뒤에 <knowledge> 블록이 붙는다. 블록의 <chunk id="...">는 이 유형·과목의 결과를 해석하는 관점 조각이다.
13. 조각은 조언 규칙의 뜻을 풀어 쓴 해설이다. 조각 id 끝의 규칙(.R1 ~ .R5)이 그 칸의 slots[].rules에 있을 때만 그 칸에 쓴다. 숫자·시각·횟수는 여전히 facts에서만 쓴다(조각에는 숫자가 없다). 조각에 없는 원인·행동은 쓰지 않는다(규칙 18~21).
14. 조각의 해석도 데이터가 직접 말하지 않으면 추정이다. 단정하지 말고 규칙 5를 따른다. 칸의 방향(good/bad)이나 그 판의 facts와 맞지 않는 조각은 쓰지 않는다.
15. 출력 맨 위 chunkUse에 조각을 반영한 칸마다 {"slot":"칸 이름","chunkIds":["조각 id"]}를 하나씩 적는다. <knowledge>에 있는 id만 쓰고, 조각을 반영하지 않은 칸은 적지 않는다(아무 칸에도 안 썼으면 빈 배열).
16. 조언을 넣어도 칸 길이(1~3문장, 170자 안)와 요약 길이 규칙은 같다. 조언은 규칙이 있는 칸에서만, 그 규칙의 근거(required)와 함께 쓴다.
`;

export const SYSTEM_PROMPT_RAG = SYSTEM_PROMPT + KNOWLEDGE_RULES;

export function systemPromptFor(withKnowledge: boolean): string {
  return withKnowledge ? SYSTEM_PROMPT_RAG : SYSTEM_PROMPT;
}

/** 프롬프트에 넣는 조각 (id + 소제목·본문) */
export interface KnowledgeChunkInput {
  id: string;
  content: string;
}

/** <knowledge> 블록. 조각이 없으면 빈 문자열 */
export function buildKnowledgeBlock(chunks: readonly KnowledgeChunkInput[]): string {
  if (chunks.length === 0) return '';
  return `<knowledge>\n${chunks.map((c) => `<chunk id="${c.id}">\n${c.content}\n</chunk>`).join('\n')}\n</knowledge>`;
}

export interface UserPayload {
  player: Record<string, unknown>;
  verdicts: Record<string, string | null>;
  commonFactIds: string[];
  slots: { slot: string; subjectId?: string; subjectName?: string; factIds: string[]; rules?: { id: string; gist: string; required: string[]; text?: string }[] }[];
  facts: { id: string; label: string; display: string[]; units?: string[]; approx?: { step: number } }[];
  keyMoments: { index: number; direction: string; swingSide: string; playerInvolved: boolean; playerDied: boolean; followUpFactIds: string[] }[];
  notes: { text: string; kind: string; startFactId: string | null }[];
}

/** 판마다 바뀌는 사용자 메시지 (JSON 한 덩어리) */
export function buildUserPayload(sheet: FactSheet): UserPayload {
  const r = sheet.result;
  const common = new Set(sheet.commonFactIds);
  const used = new Set<string>([...sheet.commonFactIds, ...sheet.slots.flatMap((s) => s.factIds), ...sheet.facts.filter((f) => f.id.startsWith('note.')).map((f) => f.id)]);
  const str = (id: string) => (sheet.byId.get(id)?.value as string | undefined) ?? null;
  return {
    player: {
      champion: str('player.champion'),
      position: r.player.position,
      role: str('player.role'),
      result: str('player.result'),
      durationFactId: 'player.durationMin',
      laningOpponent: str('laning.opponent'),
    },
    verdicts: { [AREA_LABEL.laning]: r.summary.laning, [AREA_LABEL.fight]: r.summary.fight, [AREA_LABEL.macro]: r.summary.macro },
    commonFactIds: sheet.commonFactIds,
    slots: sheet.slots.map((s) => ({
      slot: s.slot,
      ...(s.subjectId ? { subjectId: s.subjectId, subjectName: SUBJECT_LABEL[s.subjectId] ?? s.subjectId } : {}),
      factIds: s.factIds.filter((id) => !common.has(id)),
      // 조언 규칙 (Q3): 있는 칸만 보낸다 (토큰 절약)
      ...(s.rules.length > 0 ? { rules: s.rules.map((r) => ({ id: r.id, gist: r.gist, required: r.required, ...(r.text ? { text: r.text } : {}) })) } : {}),
    })),
    // 칸에서 쓰는 fact와 해석 노트 시각만 보낸다 (토큰 절약). value는 display[0]과 같아 보내지 않는다
    facts: sheet.facts
      .filter((f) => used.has(f.id))
      .map((f) => ({
        id: f.id,
        label: f.label,
        display: f.display,
        ...(typeof f.value === 'number' && allowedUnitWords(f.id, f.unit).length > 0 ? { units: [...allowedUnitWords(f.id, f.unit)] } : {}),
        ...(f.approx ? { approx: f.approx } : {}),
      })),
    keyMoments: r.keyMoments.map((m, i) => ({
      index: i,
      direction: isReversed(m.goldDiffBefore, m.goldDiffAfter) ? '앞선 팀이 바뀜' : m.direction === 'widened' ? '벌어짐' : '좁혀짐',
      swingSide: m.swing > 0 ? '우리 팀이 얻음' : m.swing < 0 ? '우리 팀이 잃음' : '변화 없음',
      playerInvolved: m.playerInvolved,
      playerDied: m.playerDied,
      followUpFactIds: m.followUps.map((_, j) => `keyMoment.${i}.followUp.${j}`),
    })),
    notes: r.notes.map((n, i) => ({
      text: `${n.text} (추정)`,
      kind: n.key,
      startFactId: sheet.byId.has(`note.${i}.startMin`) ? `note.${i}.startMin` : null,
    })),
  };
}

/** 사용자 메시지. 조각이 없으면 Q1과 같은 JSON 한 덩어리, 있으면 JSON 뒤에 빈 줄 + <knowledge> 블록 */
export function buildUserMessage(sheet: FactSheet, knowledge: readonly KnowledgeChunkInput[] | null = null): string {
  const json = JSON.stringify(buildUserPayload(sheet));
  return knowledge && knowledge.length > 0 ? `${json}\n\n${buildKnowledgeBlock(knowledge)}` : json;
}

/** 재시도 메시지: 실패한 칸, 이유, 그 칸에서 쓸 수 있는 값 */
export function buildRetryMessage(sheet: FactSheet, failures: readonly VerifyFailure[], withKnowledge = false): string {
  const bySlot = new Map<string, string[]>();
  for (const f of failures) bySlot.set(f.slot, [...(bySlot.get(f.slot) ?? []), `[${f.rule}] ${f.detail}`]);
  const lines = [...bySlot].map(([slot, reasons]) => {
    const s = sheet.slots.find((x) => x.slot === slot);
    const values = (s?.factIds ?? [])
      .map((id) => sheet.byId.get(id))
      .filter((f) => f !== undefined && typeof f.value === 'number')
      .map((f) => `${f!.id}: ${f!.display.join(' 또는 ')}`);
    const rules = s?.rules.length
      ? s.rules.map((r) => `${r.id}${r.action ? '' : '(해석만)'} 근거 ${r.required.join(', ')}${r.text ? ` 문장 "${r.text}"` : ''}`).join(' / ')
      : '없음 (조언 문장을 빼고 결과·장면만)';
    return `- ${slot}${s?.subjectId ? ` (${s.subjectId})` : ''}: ${reasons.join(' / ')}\n  쓸 수 있는 숫자: ${values.join(', ') || '없음'}\n  조언 규칙: ${rules}`;
  });
  return `아래 칸의 문장이 검사를 통과하지 못했다. 이 칸들만 이유에 맞게 고쳐 다시 써라. 다른 칸은 쓰지 않는다. 규칙은 처음과 같다.
${lines.join('\n')}
출력: {"fixes":[{"slot":"칸 이름","text":"고친 문장","factIds":["..."]${withKnowledge ? ',"chunkIds":["..."]' : ''}}]}`;
}
