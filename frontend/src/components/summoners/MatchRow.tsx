import Image from "next/image";
import Tooltip from "@/components/common/Tooltip";
import type { MatchView, ParticipantView, SlotView } from "@/lib/view/summoner";

function ItemSlot({ item }: { item: SlotView }) {
  if (!item) {
    return (
      <span
        aria-hidden="true"
        className="size-6 shrink-0 rounded border border-dashed border-border"
      />
    );
  }
  return (
    <Tooltip content={item.description}>
      <span className="relative block size-6 shrink-0 overflow-hidden rounded bg-surface-2">
        {item.iconUrl ? (
          <Image src={item.iconUrl} alt={item.name} fill sizes="24px" className="object-cover" />
        ) : (
          <span className="sr-only">{item.name}</span>
        )}
      </span>
    </Tooltip>
  );
}

function SpellSlot({
  spell,
}: {
  spell: { id: number; name: string; iconUrl?: string; description?: string };
}) {
  return (
    <Tooltip content={spell.description}>
      <span className="relative block size-6 shrink-0 overflow-hidden rounded bg-surface-2">
        {spell.iconUrl ? (
          <Image src={spell.iconUrl} alt={spell.name} fill sizes="24px" className="object-cover" />
        ) : (
          <span className="sr-only">{spell.name}</span>
        )}
      </span>
    </Tooltip>
  );
}

/**
 * 키스톤 룬 + 소속 트리 아이콘. 2026-10-27 사용자 요청으로 스펠과 같은 모양(사각, size-6)으로
 * 바꾸고 스펠과 같은 열에 함께 쌓는다(이전엔 원형+겹친 작은 배지였음).
 */
function RuneSlot({
  iconUrl,
  name,
  description,
  align,
}: {
  iconUrl?: string;
  name: string;
  description?: string;
  align?: "left" | "right";
}) {
  return (
    <Tooltip content={description} align={align}>
      <span className="relative block size-6 shrink-0 overflow-hidden rounded bg-surface-2">
        {iconUrl ? (
          <Image src={iconUrl} alt={name} fill sizes="24px" className="object-contain p-0.5" />
        ) : (
          <span className="sr-only">{name}</span>
        )}
      </span>
    </Tooltip>
  );
}

/** 참가자 5명 세로 1열 (왼쪽=같은 팀, 오른쪽=상대 팀으로 나란히 두기 위함). 닉네임이 있으면 아이콘 옆에 표시 */
function ParticipantIcons({
  label,
  participants,
}: {
  label: string;
  participants: ParticipantView[];
}) {
  return (
    <div className="flex flex-col gap-0.5" aria-label={label}>
      {participants.map((participant, index) => (
        <div key={`${participant.championId}-${index}`} className="flex items-center gap-1">
          <span className="relative block size-5 shrink-0 overflow-hidden rounded-full border border-border bg-surface-2">
            {participant.iconUrl ? (
              <Image
                src={participant.iconUrl}
                alt={participant.name}
                fill
                sizes="20px"
                className="object-cover"
              />
            ) : (
              <span className="sr-only">{participant.name}</span>
            )}
          </span>
          {participant.displayName ? (
            <span className="max-w-20 truncate text-[11px] text-muted">{participant.displayName}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** 매치 1건. 승/패 색은 왼쪽 테두리 + 글자 (D35) */
export default function MatchRow({ match }: { match: MatchView }) {
  const borderClass = match.win ? "border-win" : "border-lose";
  const resultClass = match.win ? "text-win" : "text-lose";

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-lg border-l-4 bg-surface p-3 ${borderClass}`}>
      {/* 결과·포지션·조회시간·플레이타임은 챔피언 초상화보다 왼쪽(2026-10-27) */}
      <div className="w-20 shrink-0 self-start text-xs text-muted">
        <p className={`font-bold ${resultClass}`}>{match.win ? "승리" : "패배"}</p>
        {match.positionLabel ? <p>{match.positionLabel}</p> : null}
        <p>{match.relativeTime}</p>
        <p>{match.duration}</p>
      </div>

      {/* 챔피언(+레벨 배지)+주문·룬(위) + 아이템 6칸+장신구 한 줄(아래, 초상화 밑) 묶음. 너비는 아이템 한 줄(7칸)에 맞춰 늘어난다 */}
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="relative block size-10 shrink-0 overflow-hidden rounded-md bg-surface-2">
            {match.champion.iconUrl ? (
              <Image
                src={match.champion.iconUrl}
                alt={match.champion.name}
                fill
                sizes="40px"
                className="object-cover"
              />
            ) : (
              <span className="sr-only">{match.champion.name}</span>
            )}
            {/* 챔피언 레벨(소환사 레벨과 다름, 2026-10-27 추가) */}
            <span
              aria-hidden="true"
              className="absolute right-0 bottom-0 rounded-tl-md bg-background/90 px-1 text-[10px] leading-4 font-bold text-accent"
            >
              {match.champLevel}
            </span>
          </span>
          <span className="sr-only">{match.champLevel}레벨</span>
          {/* 좌: 소환사 주문 2칸(세로) / 우: 룬 2칸(세로), 2026-10-27 */}
          <div className="flex shrink-0 items-start gap-0.5">
            <div className="flex flex-col gap-0.5">
              {match.summonerSpells.map((spell) => (
                <SpellSlot key={spell.id} spell={spell} />
              ))}
            </div>
            <div className="flex flex-col gap-0.5">
              <RuneSlot
                iconUrl={match.keystone.iconUrl}
                name={match.keystone.name}
                description={match.keystone.description}
              />
              {match.keystone.treeIconUrl ? (
                <RuneSlot
                  iconUrl={match.keystone.treeIconUrl}
                  name={`${match.keystone.name} 트리`}
                  align="right"
                />
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {match.items.map((item, index) => (
            <ItemSlot key={index} item={item} />
          ))}
          <ItemSlot item={match.trinket} />
        </div>
      </div>

      <div className="w-24 shrink-0 text-sm">
        <p className="font-semibold">
          {match.kills} / {match.deaths} / {match.assists}
        </p>
        <p className="text-xs text-muted">{match.kda} KDA</p>
      </div>

      <div className="w-24 shrink-0 text-sm">
        <p>{match.cs} CS</p>
        <p className="text-xs text-muted">{match.csPerMinute} /분</p>
      </div>

      {/* 왼쪽 5(같은 팀) - 오른쪽 5(상대 팀) 세로 두 열로 나란히 */}
      <div className="ml-auto flex items-start gap-2 text-xs">
        <ParticipantIcons label="같은 팀 챔피언" participants={match.team} />
        <span aria-hidden="true" className="self-center text-muted">
          vs
        </span>
        <ParticipantIcons label="상대 팀 챔피언" participants={match.enemy} />
      </div>
    </div>
  );
}
