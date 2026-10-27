import Image from "next/image";
import MatchExpandToggle from "@/components/summoners/MatchExpandToggle";
import Tooltip from "@/components/common/Tooltip";
import type { MatchView, ParticipantView, SlotView } from "@/lib/view/summoner";

/** 2026-10-27: 리스트 크기 안에서 아이템·스펠·룬 아이콘을 두 차례 키움 (24px→28px→32px) */
function ItemSlot({ item }: { item: SlotView }) {
  if (!item) {
    return (
      <span
        aria-hidden="true"
        className="size-8 shrink-0 rounded border border-dashed border-border"
      />
    );
  }
  return (
    <Tooltip content={item.description}>
      <span className="relative block size-8 shrink-0 overflow-hidden rounded bg-surface-2">
        {item.iconUrl ? (
          <Image src={item.iconUrl} alt={item.name} fill sizes="32px" className="object-cover" />
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
      <span className="relative block size-8 shrink-0 overflow-hidden rounded bg-surface-2">
        {spell.iconUrl ? (
          <Image src={spell.iconUrl} alt={spell.name} fill sizes="32px" className="object-cover" />
        ) : (
          <span className="sr-only">{spell.name}</span>
        )}
      </span>
    </Tooltip>
  );
}

/**
 * 키스톤 룬 + 소속 트리 아이콘. 2026-10-27 사용자 요청으로 스펠과 같은 모양(사각)으로
 * 바꾸고 스펠과 같은 크기로 쌓는다(이전엔 원형+겹친 작은 배지였음).
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
      <span className="relative block size-8 shrink-0 overflow-hidden rounded bg-surface-2">
        {iconUrl ? (
          <Image src={iconUrl} alt={name} fill sizes="32px" className="object-contain p-0.5" />
        ) : (
          <span className="sr-only">{name}</span>
        )}
      </span>
    </Tooltip>
  );
}

/**
 * 참가자 5명 세로 1열 (왼쪽=같은 팀, 오른쪽=상대 팀으로 나란히 두기 위함). 닉네임이 있으면 이름 칸에 표시.
 * 2026-10-27: 딜량 막대그래프를 닉네임 바로 아래로(아이콘 밑이 아님), 챔피언 아이콘은 "닉네임+막대"
 * 칸과 같은 높이로 늘림(`items-stretch`) — 아이콘이 둘을 아우르는 하나의 상자처럼 보이게 한다.
 * 막대 색: 같은 팀 파랑(`--win`), 상대 팀 빨강(`--lose`)
 */
function ParticipantIcons({
  label,
  participants,
  side,
}: {
  label: string;
  participants: ParticipantView[];
  side: "team" | "enemy";
}) {
  const barClass = side === "team" ? "bg-win" : "bg-lose";
  return (
    <div className="flex flex-col gap-1" aria-label={label}>
      {participants.map((participant, index) => (
        <div key={`${participant.championId}-${index}`} className="flex w-20 items-stretch gap-1">
          <span className="relative block w-5 shrink-0 self-stretch overflow-hidden rounded-full border border-border bg-surface-2">
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
          <div className="min-w-0 flex-1">
            {participant.displayName ? (
              <span className="block max-w-14 truncate text-[11px] text-muted">
                {participant.displayName}
              </span>
            ) : null}
            <div
              className="mt-0.5 h-0.5 w-full overflow-hidden rounded-full bg-surface-2"
              role="img"
              aria-label={`딜량 ${participant.damagePercent}%`}
            >
              <div className={`h-full ${barClass}`} style={{ width: `${participant.damagePercent}%` }} />
            </div>
          </div>
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
    // 모든 칸을 위쪽(items-start)으로 통일해 높이가 들쭉날쭉해 보이지 않게 한다(2026-10-27).
    // 참가자 칸(5줄+딜량 막대)이 가장 길어 기준이 되고, 나머지 칸은 그 위쪽에 맞춰 시작한다.
    <div className={`flex flex-wrap items-start gap-3 rounded-lg border-l-4 bg-surface p-3 ${borderClass}`}>
      {/* 결과·큐 종류·조회시간·플레이타임은 챔피언 초상화보다 왼쪽(2026-10-27). 큐 종류는 포지션 줄을 대신함 */}
      <div className="w-20 shrink-0 text-xs text-muted">
        <p className={`font-bold ${resultClass}`}>{match.win ? "승리" : "패배"}</p>
        <p>{match.queueLabel}</p>
        <p>{match.relativeTime}</p>
        <p>{match.duration}</p>
      </div>

      {/* 챔피언(+레벨 배지)+주문·룬(위) + 아이템 6칸+장신구 한 줄(아래, 초상화 밑) 묶음. 너비는 아이템 한 줄(7칸)에 맞춰 늘어난다 */}
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="relative block size-14 shrink-0 overflow-hidden rounded-md bg-surface-2">
            {match.champion.iconUrl ? (
              <Image
                src={match.champion.iconUrl}
                alt={match.champion.name}
                fill
                sizes="56px"
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
          {/* 2026-10-27: 챔피언+주문·룬 줄이 아이템 줄(7칸)보다 좁아 생기던 빈 공간(아이템 약 3개 분량)에 KDA를 넣는다 */}
          <div className="ml-1 text-sm">
            <p className="font-semibold">
              {match.kills} / {match.deaths} / {match.assists}
            </p>
            <p className="text-xs text-muted">{match.kda} KDA</p>
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
        <p>{match.cs} CS</p>
        <p className="text-xs text-muted">{match.csPerMinute} /분</p>
      </div>

      {/* 왼쪽 5(같은 팀) - 오른쪽 5(상대 팀) 세로 두 열로 나란히 */}
      <div className="ml-auto flex items-start gap-2 text-xs">
        <ParticipantIcons label="같은 팀 챔피언" participants={match.team} side="team" />
        <span aria-hidden="true" className="self-center text-muted">
          vs
        </span>
        <ParticipantIcons label="상대 팀 챔피언" participants={match.enemy} side="enemy" />
      </div>

      {/* 리스트 가장 오른쪽 수직형 아코디언 토글. 펼침 데이터는 아직 없음(2026-10-27) */}
      <MatchExpandToggle />
    </div>
  );
}
