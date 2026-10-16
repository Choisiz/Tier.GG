import Image from "next/image";
import type { SkillOrderSet } from "@/lib/view/builds";

const LEVELS = Array.from({ length: 11 }, (_, i) => i + 1);

/** 스킬 순서 1~11레벨 격자 (1순위) + 2순위 한 줄 */
export default function SkillOrder({ set }: { set: SkillOrderSet }) {
  const [first, second] = set.builds;
  if (!first) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        사용 {first.pickRate} · 승률 {first.winRate} · {first.pick}게임
      </p>
      <table className="border-separate border-spacing-0.5 text-xs">
        <caption className="sr-only">스킬 찍는 순서 1~11레벨</caption>
        <thead>
          <tr>
            <th scope="col" className="sr-only">
              스킬
            </th>
            {LEVELS.map((level) => (
              <th key={level} scope="col" className="w-[22px] font-normal text-muted sm:w-7">
                {level}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {set.heads.map((head) => (
            <tr key={head.key}>
              <th scope="row" className="pr-1 text-left">
                <span className="flex items-center gap-1">
                  {head.iconUrl ? (
                    <Image
                      src={head.iconUrl}
                      alt=""
                      width={20}
                      height={20}
                      className="size-5 rounded-sm"
                    />
                  ) : null}
                  <span className="font-bold text-accent">{head.key}</span>
                  {head.name ? <span className="sr-only">{head.name}</span> : null}
                </span>
              </th>
              {LEVELS.map((level) => {
                const chosen = first.order[level - 1] === head.key;
                return (
                  <td
                    key={level}
                    className={`h-[22px] w-[22px] rounded-sm text-center font-bold sm:h-7 sm:w-7 ${
                      chosen ? "bg-accent text-accent-foreground" : "bg-surface-2"
                    }`}
                  >
                    {chosen ? head.key : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {second ? (
        <p className="text-xs text-muted">
          <span className="font-semibold text-foreground">2순위</span>{" "}
          <span className="font-mono tracking-wider">{second.order.join(" ")}</span> · 사용{" "}
          {second.pickRate} · 승률 {second.winRate}
        </p>
      ) : null}
    </div>
  );
}
