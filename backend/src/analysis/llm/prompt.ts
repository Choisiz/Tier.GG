// 프롬프트 (ai_spec 2-5): 고정 시스템 프롬프트(캐시) + 판마다 바뀌는 사용자 메시지 + 재시도 메시지.
// 시스템 프롬프트에는 날짜·ID처럼 바뀌는 값을 넣지 않는다 (캐시가 깨진다).
// 시스템 프롬프트·스키마·facts 표기 규칙을 바꾸면 PROMPT_VERSION을 올린다.
// 버전은 RAG 여부로 둘이다 (B4): 조각이 없는 요청(RAG 꺼짐·검색 0개)은 Q1과 바이트까지 같은 요청이라 PROMPT_VERSION_NO_RAG를 쓰고,
// 조각이 있는 요청만 PROMPT_VERSION을 쓴다. 녹화본 파일 이름·장부 보정·API 캐시 키는 promptVersionFor()로 고른 값을 쓴다.
import { isReversed, type FactSheet } from './facts.js';
import { allowedUnitWords, AREA_LABEL, SUBJECT_LABEL } from './labels.js';
import type { VerifyFailure } from './verify.js';

/** RAG 조각이 붙는 요청의 버전 (B4) */
export const PROMPT_VERSION = '2026-11-04.2';
/** 조각 없는 요청의 버전. Q1(2026-11-04.1)과 같은 시스템 프롬프트·스키마·사용자 메시지라 기존 녹화본이 그대로 재생된다 */
export const PROMPT_VERSION_NO_RAG = '2026-11-04.1';

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

## 규칙
1. 판정과 방향을 바꾸지 않는다. good 칸에는 잘한 점만, bad 칸에는 부족한 점만 쓴다. 방향 말은 플레이어(우리 쪽) 기준으로 쓴다("내 골드가 적었습니다" O, bad 칸에 "상대 골드가 많았습니다" X). 결정적 장면에서 격차가 "벌어짐"이면 벌어졌다고, "좁혀짐"이면 좁혀졌다고 쓴다.
1-1. 결정적 장면의 direction이 "앞선 팀이 바뀜"이면 격차가 벌어졌다/좁혀졌다고 쓰지 않는다(그 장면에는 격차 변화 fact가 없다). 앞선 팀이 누구에서 누구로 바뀌었는지(leaderBefore → leaderAfter)와, 이 싸움으로 우리 팀 골드가 swingAbs만큼 손해(swingSide "우리 팀이 잃음") 또는 이득("우리 팀이 얻음")이었는지를 쓴다.
2. 숫자는 facts의 display 표기 중 하나를 그대로, 아라비아 숫자로 쓴다. 계산해서 새 숫자를 만들지 않는다(더하기, 빼기, 비율, 반올림 모두 금지). 차이는 이미 계산된 "차이" fact를 쓴다. 숫자 앞에 +나 - 부호를 붙이지 말고 "많았습니다", "적었습니다", "벌어졌습니다" 같은 방향 말로 쓴다.
3. approx가 있는 값만 어림을 쓸 수 있다. "약 N"은 실제 값(display 첫 표기)을 approx.step 단위로 반올림한 N일 때만 쓴다. 어림이 애매하면 display 표기를 그대로 쓴다.
4. 등급 글자(A~E), 등급, 점수, 총점, 반영 비율, 가중치를 쓰지 않는다. 단 게임 지표 이름인 "시야 점수"는 쓸 수 있다.
5. 데이터가 직접 말하지 않는 해석(이니시, 버스, 캐리, 무리한 진입, 던짐, 실수, 판단 같은 말)은 꼭 필요할 때만 쓰고, 그 문장은 "~것으로 보입니다"로 끝맺는다.
6. 챔피언 이름은 facts에 있는 내 챔피언과 상대 라이너 챔피언만 쓴다. 다른 챔피언, 아이템, 룬, 스킬 이름은 쓰지 않는다.
7. 존댓말(~습니다)로 쓴다. 칸 하나는 1~2문장, 120자 안. 요약은 1~2문장, 200자 안.
8. 문장마다 그 문장에 쓴 숫자와 이름이 나온 fact의 id를 factIds에 모두 적는다. 그 칸의 slots[].factIds와 commonFactIds에 있는 id만 쓴다.
8-1. 숫자 바로 뒤에 단위어(골드, 킬, 데스, 어시스트, CS, 개, 번, 분, %, %p, 레벨)를 붙일 때는 그 fact의 units에 있는 것만 쓴다. 팀 킬 수는 "우리 팀 1킬, 상대 팀 5킬"처럼 쓰고, "데스"는 플레이어 본인의 데스 fact에만 쓴다(상대 팀 킬을 "5데스"로 쓰지 않는다).
9. 순서를 나타내는 "첫 번째", "2번째" 같은 말과 facts에 없는 시간·횟수(예: "60초", "두 번")를 쓰지 않는다.
10. 요약(summary)은 세 영역 판정을 먼저, 그다음 결정적 장면 1개를 쓴다. 판정어(우세/열세/비슷, 잘함/보통/부족) 또는 같은 뜻의 말(앞섰다, 밀렸다, 잘했다, 부족했다 등)을 영역마다 넣는다. 판정이 null인 영역은 말하지 않는다.
11. sections의 각 칸에는 slots의 subjectId를 그대로 적고, slots에 있는 칸만 쓴다. slots에 없는 영역·방향은 빈 배열로 둔다. keyMoments의 index는 입력 keyMoments의 index를 그대로 쓴다.
12. 출력은 지정된 JSON 모양만 낸다. 설명이나 머리말을 붙이지 않는다.

## 문체
- 플레이어에게 직접 말하듯 쓰되, 꾸밈말을 줄이고 사실과 숫자 위주로 쓴다.
- 영역 이름은 "라인전", "오브젝트 싸움", "그 밖의 운영"을 쓴다.
- 부족한 점은 탓하지 말고 무엇이 낮았는지를 쓴다.

## 예시
facts 일부:
{"id":"laning.referenceMin","display":["15"]}, {"id":"laning.opponent","display":["애쉬"]}, {"id":"laning.gold.diffAbs","display":["703"],"approx":{"step":100}}, {"id":"keyMoment.0.startMin","display":["15.1","15"]}, {"id":"keyMoment.0.gapChangeAbs","display":["3895","3,895"],"approx":{"step":100}}

좋은 예 (laning bad 칸):
{"subjectId":"laning.gold","text":"15분 골드가 상대 애쉬보다 703 적었습니다.","factIds":["laning.referenceMin","laning.opponent","laning.gold.diffAbs"]}

좋은 예 (결정적 장면, 벌어짐):
{"index":0,"text":"15분 싸움 뒤 골드 격차가 약 3,900 벌어졌습니다.","factIds":["keyMoment.0.startMin","keyMoment.0.gapChangeAbs"]}

좋은 예 (결정적 장면, 앞선 팀이 바뀜, swingAbs 4,376, swingSide "우리 팀이 잃음"):
{"index":1,"text":"23.6분 싸움에서 우리 팀 0킬, 상대 팀 3킬로 앞선 팀이 우리 팀에서 상대 팀으로 바뀌었고, 우리 팀은 골드 약 4,400 손해를 봤습니다.","factIds":["keyMoment.1.startMin","keyMoment.1.killsOurs","keyMoment.1.killsTheirs","keyMoment.1.leaderBefore","keyMoment.1.leaderAfter","keyMoment.1.swingAbs"]}

나쁜 예와 이유:
- "15분 골드가 상대 애쉬보다 800 적었습니다." → 800은 facts에 없다 (지어낸 숫자)
- "골드 격차가 3,900 넘게 벌어졌습니다." → 실제 값 3,895는 3,900보다 작다
- "라인전은 비슷했습니다." (판정 열세) → 판정을 바꿨다
- "골드 격차가 300 벌어졌고 앞선 팀이 상대 팀으로 바뀌었습니다." (앞선 팀이 바뀜) → 역전 장면은 벌어졌다/좁혀졌다고 쓰지 않고 swingAbs로 손익을 쓴다
- "1킬 5데스로 밀렸습니다." (5 = 상대 팀 킬) → 팀 킬을 데스로 썼다. "우리 팀 1킬, 상대 팀 5킬"로 쓴다
- "교전 점수 25점으로 D 등급입니다." → 점수·등급을 썼다
`;

/** 시스템 프롬프트 뒤에 붙는 RAG 규칙 (조각이 있을 때만). 앞부분(SYSTEM_PROMPT)은 바꾸지 않는다 */
export const KNOWLEDGE_RULES = `
## 참고 지식 (knowledge)
사용자 메시지의 JSON 뒤에 <knowledge> 블록이 붙는다. 블록의 <chunk id="...">는 이 유형·과목의 결과를 해석하는 관점 조각이다.
13. 조각은 해석과 다음 판 조언의 근거로만 쓴다. 숫자·시각·횟수는 여전히 facts에서만 쓴다(조각에는 숫자가 없다). 조각 문장을 그대로 옮기지 말고, 이 판의 칸에 맞는 내용만 골라 짧게 녹인다.
14. 조각의 해석도 데이터가 직접 말하지 않으면 추정이다. 단정하지 말고 규칙 5를 따른다. 칸의 방향(good/bad)이나 그 판의 facts와 맞지 않는 조각은 쓰지 않는다.
15. 출력 맨 위 chunkUse에 조각을 반영한 칸마다 {"slot":"칸 이름","chunkIds":["조각 id"]}를 하나씩 적는다. <knowledge>에 있는 id만 쓰고, 조각을 반영하지 않은 칸은 적지 않는다(아무 칸에도 안 썼으면 빈 배열).
16. 조언을 넣어도 칸 길이(1~2문장, 120자 안)와 요약 길이 규칙은 같다. 조언은 "다음 판에는 ~해 볼 수 있습니다"처럼 부드럽게 쓴다.
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
  slots: { slot: string; subjectId?: string; subjectName?: string; factIds: string[] }[];
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
    return `- ${slot}${s?.subjectId ? ` (${s.subjectId})` : ''}: ${reasons.join(' / ')}\n  쓸 수 있는 숫자: ${values.join(', ') || '없음'}`;
  });
  return `아래 칸의 문장이 검사를 통과하지 못했다. 이 칸들만 이유에 맞게 고쳐 다시 써라. 다른 칸은 쓰지 않는다. 규칙은 처음과 같다.
${lines.join('\n')}
출력: {"fixes":[{"slot":"칸 이름","text":"고친 문장","factIds":["..."]${withKnowledge ? ',"chunkIds":["..."]' : ''}}]}`;
}
