/** 스킬 아이콘 `Tooltip`에 넣는 내용: 키·이름 / 재사용 대기시간 / 설명 (스킬 카드와 같은 구성) */
export default function AbilityTipContent({
  abilityKey,
  name,
  cooldown,
  description,
}: {
  abilityKey: string;
  name?: string;
  cooldown?: string;
  description: string;
}) {
  return (
    <>
      <span className="block font-semibold">
        <span className="mr-2 text-accent">{abilityKey}</span>
        {name}
      </span>
      {cooldown ? (
        <span className="block text-muted">재사용 대기시간 {cooldown}초</span>
      ) : null}
      <span className="mt-1 block whitespace-pre-line">{description}</span>
    </>
  );
}
