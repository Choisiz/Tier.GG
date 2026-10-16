import Image from "next/image";
import type { CoreItemsView, ItemView } from "@/lib/view/builds";

function ItemRow({ item }: { item: ItemView }) {
  return (
    <li className="flex items-center gap-3">
      <span className="relative block size-9 shrink-0 overflow-hidden rounded-md bg-surface-2">
        <Image src={item.iconUrl} alt={item.name} fill sizes="36px" className="object-cover" />
      </span>
      <span className="min-w-0 text-sm">
        <span className="block truncate font-semibold">{item.name}</span>
        <span className="text-xs text-muted">
          사용 {item.pickRate} · 승률 {item.winRate}
        </span>
      </span>
    </li>
  );
}

/** 많이 완성한 아이템: 핵심 3개 + 신발 1개 (신발 사용률 5% 미만이면 숨김) */
export default function CoreItems({ items }: { items: CoreItemsView }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.core.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>
      {items.boots ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted">신발</p>
          <ul>
            <ItemRow item={items.boots} />
          </ul>
        </div>
      ) : null}
    </div>
  );
}
