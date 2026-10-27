import Image from "next/image";
import AbilityTipContent from "@/components/champions/AbilityTipContent";
import Tooltip from "@/components/common/Tooltip";
import type { SkillOrderSet } from "@/lib/view/builds";

const LEVELS = Array.from({ length: 11 }, (_, i) => i + 1);

/**
 * 스킬 순서 1~11레벨 가로 트랙 (op.gg 스타일, 1순위만).
 * 레벨을 가로 한 줄로 나열하고, 각 칸에 그 레벨에 찍은 스킬 아이콘 1개 + 작은 레벨 숫자를 보여준다.
 * 표 마크업 대신 `<ol>` + `aria-label`을 쓰고, 각 칸의 스크린리더 설명에 "N레벨: 스킬 이름"을 넣는다.
 * 2순위(`set.builds[1]`)는 데이터로 계속 받아오지만 화면에는 쓰지 않는다 (변경 05 결정 3).
 */
export default function SkillOrder({ set }: { set: SkillOrderSet }) {
  const [first] = set.builds;
  if (!first) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        사용 {first.pickRate} · 승률 {first.winRate} · {first.pick}게임
      </p>
      {/* 툴팁 패널이 absolute라 overflow-x-auto 래퍼 안에서는 잘려 안 보인다 → 스크롤 대신 줄바꿈 */}
      <div>
        <ol aria-label="스킬 찍는 순서 1~11레벨" className="flex flex-wrap gap-x-1 gap-y-2 sm:gap-x-2">
          {LEVELS.map((level) => {
            const key = first.order[level - 1];
            const head = set.heads.find((h) => h.key === key);
            return (
              <li key={level} className="flex shrink-0 flex-col items-center gap-1">
                <Tooltip
                  content={
                    head?.description ? (
                      <AbilityTipContent
                        abilityKey={head.key}
                        name={head.name}
                        cooldown={head.cooldown}
                        description={head.description}
                      />
                    ) : undefined
                  }
                  align={level > 6 ? "right" : "left"}
                >
                  <span className="relative block size-6 shrink-0 overflow-hidden rounded-sm bg-surface-2 sm:size-8">
                    {head?.iconUrl ? (
                      <Image
                        src={head.iconUrl}
                        alt=""
                        fill
                        sizes="32px"
                        className="object-cover"
                      />
                    ) : null}
                    <span className="sr-only">
                      {level}레벨: {head?.name ?? key ?? "알 수 없는 스킬"}
                    </span>
                  </span>
                </Tooltip>
                <span aria-hidden="true" className="text-xs font-bold leading-none text-foreground">
                  {key ?? "?"}
                </span>
                <span aria-hidden="true" className="text-[10px] font-semibold leading-none text-muted">
                  {level}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
