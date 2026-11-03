// 프롬프트 (ai_spec 2-5): 고정 시스템 프롬프트(캐시) + 판마다 바뀌는 사용자 메시지 + 재시도 메시지.
// 시스템 프롬프트에는 날짜·ID처럼 바뀌는 값을 넣지 않는다 (캐시가 깨진다).
// 시스템 프롬프트·스키마·facts 표기 규칙을 바꾸면 PROMPT_VERSION을 올린다.
import type { FactSheet } from './facts.js';
import { AREA_LABEL, SUBJECT_LABEL } from './labels.js';
import type { VerifyFailure } from './verify.js';

export const PROMPT_VERSION = '2026-11-03.1';

export const SYSTEM_PROMPT = `너는 리그 오브 레전드 한 판의 분석 결과를 한국어 피드백 문장으로 옮기는 작성자다.
판정(좋은 점과 부족한 점, 영역별 판정, 결정적 장면)은 분석 코드가 이미 정했다. 너는 판정을 바꾸지 않고, 주어진 숫자만으로 플레이어가 읽기 쉬운 문장을 쓴다.

## 입력
사용자 메시지는 JSON 하나다.
- player: 내 챔피언, 포지션, 유형, 승패, 게임 시간
- verdicts: 라인전(우세/열세/비슷), 오브젝트 싸움(잘함/보통/부족), 그 밖의 운영(잘함/보통/부족). null이면 판정이 없다는 뜻이다
- commonFactIds: 모든 칸에서 쓸 수 있는 fact id (내 챔피언, 상대 라이너, 승패, 게임 시간 등)
- slots: 네가 채울 칸 목록. slot 이름은 "영역.good|bad.번호"(good = 좋은 점, bad = 부족한 점), "summary", "keyMoment.번호"다. 칸마다 과목(subjectId와 그 이름)과 그 칸에서 더 쓸 수 있는 factIds(commonFactIds 말고)가 있다
- facts: 쓸 수 있는 값 목록. 값마다 id, 뜻(label), 문장에 쓸 수 있는 표기(display, 첫 표기가 실제 값), 단위(unit), 어림 허용(approx)이 있다
- keyMoments: 결정적 장면 정보(시각, 킬 수, 골드 격차가 벌어졌는지 좁혀졌는지, 이어진 일)
- notes: 점수에 넣지 않은 해석 메모. 추정일 뿐이다

## 규칙
1. 판정과 방향을 바꾸지 않는다. good 칸에는 잘한 점만, bad 칸에는 부족한 점만 쓴다. 결정적 장면에서 격차가 "벌어짐"이면 벌어졌다고, "좁혀짐"이면 좁혀졌다고 쓴다.
2. 숫자는 facts의 display 표기 중 하나를 그대로, 아라비아 숫자로 쓴다. 계산해서 새 숫자를 만들지 않는다(더하기, 빼기, 비율, 반올림 모두 금지). 차이는 이미 계산된 "차이" fact를 쓴다. 숫자 앞에 +나 - 부호를 붙이지 말고 "많았습니다", "적었습니다", "벌어졌습니다" 같은 방향 말로 쓴다.
3. approx가 있는 값만 어림을 쓸 수 있다. "약 N"은 실제 값(display 첫 표기)을 approx.step 단위로 반올림한 N일 때만 쓴다. 어림이 애매하면 display 표기를 그대로 쓴다.
4. 등급 글자(A~E), 등급, 점수, 총점, 반영 비율, 가중치를 쓰지 않는다. 단 게임 지표 이름인 "시야 점수"는 쓸 수 있다.
5. 데이터가 직접 말하지 않는 해석(이니시, 버스, 캐리, 무리한 진입, 던짐, 실수, 판단 같은 말)은 꼭 필요할 때만 쓰고, 그 문장은 "~것으로 보입니다"로 끝맺는다.
6. 챔피언 이름은 facts에 있는 내 챔피언과 상대 라이너 챔피언만 쓴다. 다른 챔피언, 아이템, 룬, 스킬 이름은 쓰지 않는다.
7. 존댓말(~습니다)로 쓴다. 칸 하나는 1~2문장, 120자 안. 요약은 1~2문장, 200자 안.
8. 문장마다 그 문장에 쓴 숫자와 이름이 나온 fact의 id를 factIds에 모두 적는다. 그 칸의 slots[].factIds와 commonFactIds에 있는 id만 쓴다.
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

나쁜 예와 이유:
- "15분 골드가 상대 애쉬보다 800 적었습니다." → 800은 facts에 없다 (지어낸 숫자)
- "골드 격차가 3,900 넘게 벌어졌습니다." → 실제 값 3,895는 3,900보다 작다
- "라인전은 비슷했습니다." (판정 열세) → 판정을 바꿨다
- "교전 점수 25점으로 D 등급입니다." → 점수·등급을 썼다
`;

export interface UserPayload {
  player: Record<string, unknown>;
  verdicts: Record<string, string | null>;
  commonFactIds: string[];
  slots: { slot: string; subjectId?: string; subjectName?: string; factIds: string[] }[];
  facts: { id: string; label: string; display: string[]; unit?: string; approx?: { step: number } }[];
  keyMoments: { index: number; direction: string; playerInvolved: boolean; playerDied: boolean; followUpFactIds: string[] }[];
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
        ...(f.unit ? { unit: f.unit } : {}),
        ...(f.approx ? { approx: f.approx } : {}),
      })),
    keyMoments: r.keyMoments.map((m, i) => ({
      index: i,
      direction: m.direction === 'widened' ? '벌어짐' : '좁혀짐',
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

export function buildUserMessage(sheet: FactSheet): string {
  return JSON.stringify(buildUserPayload(sheet));
}

/** 재시도 메시지: 실패한 칸, 이유, 그 칸에서 쓸 수 있는 값 */
export function buildRetryMessage(sheet: FactSheet, failures: readonly VerifyFailure[]): string {
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
출력: {"fixes":[{"slot":"칸 이름","text":"고친 문장","factIds":["..."]}]}`;
}
