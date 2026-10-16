import Image from "next/image";
import Tooltip from "@/components/common/Tooltip";
import type { SkillOrderSet } from "@/lib/view/builds";

const LEVELS = Array.from({ length: 11 }, (_, i) => i + 1);

/** 스킬 순서 1~11레벨 격자 (1순위, 레벨 11행 × Q/W/E/R 4열) + 2순위 한 줄 */
export default function SkillOrder({ set }: { set: SkillOrderSet }) {
  const [first, second] = set.builds;
  if (!first) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        사용 {first.pickRate} · 승률 {first.winRate} · {first.pick}게임
      </p>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">스킬 찍는 순서 1~11레벨</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-10 bg-surface font-normal text-muted">
                레벨
              </th>
              {LEVELS.map((level) => (
                <th
                  key={level}
                  scope="col"
                  className="h-7 w-7 text-center font-normal text-muted sm:h-8 sm:w-8"
                >
                  {level}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {set.heads.map((head) => (
              <tr key={head.key}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 w-10 bg-surface text-center font-normal"
                >
                  <Tooltip content={head.description}>
                    <span className="flex flex-col items-center gap-1">
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
                  </Tooltip>
                </th>
                {LEVELS.map((level) => {
                  const chosen = first.order[level - 1] === head.key;
                  return (
                    <td
                      key={level}
                      className={`h-7 w-7 rounded-sm text-center font-bold sm:h-8 sm:w-8 ${
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
      </div>
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
