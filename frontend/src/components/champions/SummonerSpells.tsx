import Image from "next/image";
import type { SpellComboView } from "@/lib/view/builds";

/** 소환사 주문 상위 2조합 */
export default function SummonerSpells({ combos }: { combos: SpellComboView[] }) {
  return (
    <ul className="space-y-2">
      {combos.map((combo) => (
        <li key={combo.spells.map((s) => s.id).join("-")} className="flex items-center gap-3">
          <span className="flex shrink-0 gap-1">
            {combo.spells.map((spell) => (
              <span
                key={spell.id}
                className="relative block size-8 overflow-hidden rounded-md bg-surface-2"
              >
                {spell.iconUrl ? (
                  <Image src={spell.iconUrl} alt={spell.name} fill sizes="32px" className="object-cover" />
                ) : (
                  <span className="sr-only">{spell.name}</span>
                )}
              </span>
            ))}
          </span>
          <span className="min-w-0 text-sm">
            <span className="block truncate font-semibold">
              {combo.spells.map((s) => s.name).join(" + ")}
            </span>
            <span className="text-xs text-muted">
              사용 {combo.pickRate} · 승률 {combo.winRate} · {combo.pick}게임
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
