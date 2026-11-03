import Image from "next/image";
import Link from "next/link";
import Tooltip from "@/components/common/Tooltip";
import type {
  DetailPlayerView,
  DetailTeamView,
  MatchDetailView,
  ObjectiveKey,
  SlotView,
} from "@/lib/view/summoner";

/**
 * 펼친 칸 "상세 기록" 탭 (변경 11). 서버 컴포넌트 — 행 데이터는 이미 MatchView에 있다.
 * 반응형: xl(1280px~)에서는 참가자 1명 = 한 줄 표, 그보다 좁으면 줄을 2단으로 접는다
 * (위: 챔피언·주문/룬·닉네임·KDA, 아래: 아이템·딜·골드·CS·시야). 가로 스크롤을 만들지 않는다.
 */

/* 한 줄 표에서 칸 너비 (머리줄과 같은 값을 써서 열을 맞춘다) */
const COL = {
  kda: "xl:w-[76px]",
  damage: "xl:w-[84px]",
  gold: "xl:w-[48px]",
  cs: "xl:w-[50px]",
  vision: "xl:w-[64px]",
  items: "xl:w-[170px]",
} as const;

function IconBox({
  src,
  alt,
  className,
  sizes,
  contain,
}: {
  src?: string;
  alt: string;
  className: string;
  sizes: string;
  contain?: boolean;
}) {
  return (
    <span className={`relative block shrink-0 overflow-hidden bg-surface-2 ${className}`}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className={contain ? "object-contain p-px" : "object-cover"}
        />
      ) : (
        <span className="sr-only">{alt}</span>
      )}
    </span>
  );
}

function ItemCell({ item }: { item: SlotView }) {
  if (!item) {
    return (
      <span
        aria-hidden="true"
        className="size-[22px] shrink-0 rounded border border-dashed border-border"
      />
    );
  }
  return (
    <Tooltip content={item.description}>
      <IconBox src={item.iconUrl} alt={item.name} className="size-[22px] rounded" sizes="22px" />
    </Tooltip>
  );
}

/* ───────── 팀 머리줄 오브젝트 아이콘 (새 의존성 없이 단순한 SVG) ───────── */

const OBJECTIVE_PATHS: Record<ObjectiveKey, string> = {
  // 포탑: 위가 넓은 기둥
  towers: "M4 2h8v3l-1.5 1.5V13h1.5v1.5H4V13h1.5V6.5L4 5z",
  // 억제기: 이중 원
  inhibitors: "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z",
  // 드래곤: 날개 펼친 모양
  dragons: "M8 3 1.5 6.5 5 7l-1.5 5L8 9l4.5 3L11 7l3.5-.5z",
  // 바론: 뿔 달린 머리
  barons: "M3 2l2 4h6l2-4 1 6-3 6H5L2 8z",
  // 전령: 눈
  heralds: "M8 3.5C4.5 3.5 2 8 2 8s2.5 4.5 6 4.5S14 8 14 8s-2.5-4.5-6-4.5zm0 2.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  // 공허 유충: 작은 점 셋
  grubs: "M4 6.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
};

function TeamHeader({ team }: { team: DetailTeamView }) {
  const resultClass = team.win ? "text-win" : "text-lose";
  const sideLabel = team.side === "team" ? "내 팀" : "상대 팀";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-2 py-2 text-xs">
      <p className="flex items-baseline gap-1.5">
        <span className={`text-sm font-bold ${resultClass}`}>{team.win ? "승리" : "패배"}</span>
        <span className="text-muted">({sideLabel})</span>
      </p>
      <p className="flex gap-3 tabular-nums">
        <span>
          <span className="text-muted">킬</span> {team.kills}
        </span>
        <span>
          <span className="text-muted">골드</span> {team.gold}
        </span>
      </p>
      <ul className="flex flex-wrap items-center gap-x-2.5 gap-y-1" aria-label={`${sideLabel} 오브젝트`}>
        {team.objectives.map((objective) => (
          <li key={objective.key} className="flex items-center gap-0.5 tabular-nums">
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className={`size-3.5 ${team.win ? "fill-win" : "fill-lose"}`}
            >
              <path d={OBJECTIVE_PATHS[objective.key]} fillRule="evenodd" />
            </svg>
            <span className="sr-only">{objective.label}</span>
            <span title={objective.label}>{objective.count}</span>
          </li>
        ))}
      </ul>
      {team.bans.length > 0 ? (
        <div className="flex items-center gap-1 xl:ml-auto">
          <span className="text-muted">밴</span>
          <ul className="flex gap-0.5" aria-label={`${sideLabel} 밴`}>
            {team.bans.map((ban, index) => (
              <li key={`${ban.championId}-${index}`}>
                <IconBox
                  src={ban.iconUrl}
                  alt={ban.name}
                  className="size-5 rounded opacity-70 grayscale"
                  sizes="20px"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** 한 줄 표(xl)일 때만 보이는 열 이름 */
function ColumnLabels() {
  return (
    <div
      aria-hidden="true"
      className="hidden items-center gap-2 px-2 pt-1.5 text-[11px] text-muted xl:flex"
    >
      <span className="min-w-0 flex-1">챔피언 · 닉네임</span>
      <span className={`${COL.kda} text-center`}>KDA</span>
      <span className={COL.damage}>가한 딜 / 받은 딜</span>
      <span className={`${COL.gold} text-right`}>골드</span>
      <span className={`${COL.cs} text-right`}>CS</span>
      <span className={`${COL.vision} text-right`}>시야</span>
      <span className={`${COL.items} pl-2`}>아이템</span>
    </div>
  );
}

function DamageBar({ percent, barClass, label }: { percent: number; barClass: string; label: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={label}>
      <div className={`h-full ${barClass}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function PlayerRow({ player, side }: { player: DetailPlayerView; side: "team" | "enemy" }) {
  const barClass = side === "team" ? "bg-win" : "bg-lose";
  const kdaClass = Number(player.kda) >= 4 ? "text-accent" : "text-muted";
  return (
    <li
      className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 py-1.5 xl:flex-nowrap ${
        player.isMe ? "bg-accent/10 shadow-[inset_3px_0_0_var(--accent)]" : ""
      }`}
      aria-current={player.isMe ? "true" : undefined}
    >
      {/* 위 줄(좁은 화면) / 앞쪽 칸(xl): 챔피언+레벨, 주문·룬, 닉네임, KDA */}
      <div className="flex min-w-0 basis-full items-center gap-2 xl:basis-auto xl:flex-1">
        <span className="relative block shrink-0">
          <IconBox
            src={player.champion.iconUrl}
            alt={player.champion.name}
            className="size-9 rounded-md"
            sizes="36px"
          />
          <span
            aria-hidden="true"
            className="absolute -right-1 -bottom-1 rounded bg-background px-0.5 text-[10px] leading-3.5 font-bold text-accent"
          >
            {player.champLevel}
          </span>
          <span className="sr-only">{player.champLevel}레벨</span>
        </span>
        <div className="grid shrink-0 grid-cols-2 gap-0.5">
          {player.summonerSpells.map((spell) => (
            <Tooltip key={spell.id} content={spell.description}>
              <IconBox src={spell.iconUrl} alt={spell.name} className="size-[17px] rounded-sm" sizes="17px" />
            </Tooltip>
          ))}
          {player.keystone ? (
            <Tooltip content={player.keystone.description} align="right">
              <IconBox
                src={player.keystone.iconUrl}
                alt={player.keystone.name}
                className="size-[17px] rounded-full bg-background"
                sizes="17px"
                contain
              />
            </Tooltip>
          ) : (
            <span aria-hidden="true" className="size-[17px]" />
          )}
          {player.subStyle ? (
            <IconBox
              src={player.subStyle.iconUrl}
              alt={`보조 룬 ${player.subStyle.name}`}
              className="size-[17px] rounded-full bg-background"
              sizes="17px"
              contain
            />
          ) : (
            <span aria-hidden="true" className="size-[17px]" />
          )}
        </div>
        <p className="min-w-0 flex-1 text-xs">
          {player.href ? (
            <Link
              href={player.href}
              className={`block truncate hover:underline focus-visible:outline-2 focus-visible:outline-accent ${
                player.isMe ? "font-bold text-foreground" : "text-foreground"
              }`}
              title={`${player.name}#${player.tagLine}`}
            >
              {player.name}
              <span className="text-muted">#{player.tagLine}</span>
            </Link>
          ) : (
            <span className="block truncate text-muted">{player.name}</span>
          )}
          {player.isMe ? <span className="sr-only">(나)</span> : null}
        </p>
        <div className={`shrink-0 text-right text-xs tabular-nums xl:text-center ${COL.kda}`}>
          <p className="font-semibold">
            {player.kills}/{player.deaths}/{player.assists}
          </p>
          <p className="text-[11px]">
            <span className={kdaClass}>{player.kda}</span>
            <span className="text-muted"> · {player.killParticipation}</span>
          </p>
        </div>
      </div>

      {/* 아래 줄(좁은 화면) / 뒤쪽 칸(xl): 딜·골드·CS·시야·아이템. 더 좁으면 이 안에서 한 번 더 접힌다 */}
      <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1.5 pl-[46px] text-xs tabular-nums xl:basis-auto xl:flex-nowrap xl:gap-x-2 xl:pl-0">
        <div className={`w-[84px] shrink-0 space-y-0.5 ${COL.damage}`}>
          <p className="flex justify-between text-[11px]">
            <span className="sr-only">가한 딜</span>
            <span>{player.damage}</span>
            <span className="sr-only">받은 딜</span>
            <span className="text-muted">{player.damageTaken}</span>
          </p>
          <DamageBar percent={player.damagePercent} barClass={barClass} label={`가한 딜 ${player.damagePercent}%`} />
          <DamageBar
            percent={player.damageTakenPercent}
            barClass="bg-muted"
            label={`받은 딜 ${player.damageTakenPercent}%`}
          />
        </div>
        <p className={`shrink-0 xl:text-right ${COL.gold}`}>
          <span className="text-muted xl:sr-only">골드 </span>
          {player.gold}
        </p>
        <p className={`shrink-0 xl:text-right ${COL.cs}`}>
          <span className="text-muted xl:sr-only">CS </span>
          {player.cs}
          <span className="block text-[11px] text-muted max-xl:inline max-xl:pl-1">{player.csPerMinute}/분</span>
        </p>
        <p className={`shrink-0 xl:text-right ${COL.vision}`}>
          <span className="text-muted xl:sr-only">시야 </span>
          {player.visionScore}
          <span className="sr-only">점, 제어 와드</span>
          <span className="block text-[11px] text-muted max-xl:inline max-xl:pl-1">
            <span aria-hidden="true">제어 </span>
            {player.controlWards}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, 설치/제거</span>
            {player.wardsPlaced}/{player.wardsKilled}
          </span>
        </p>
        <ul
          className={`flex shrink-0 items-center gap-0.5 xl:pl-2 ${COL.items}`}
          aria-label="아이템"
        >
          {player.items.map((item, index) => (
            <li key={index} className="flex">
              <ItemCell item={item} />
            </li>
          ))}
          <li className="ml-0.5 flex">
            <ItemCell item={player.trinket} />
          </li>
        </ul>
      </div>
    </li>
  );
}

function TeamTable({ team }: { team: DetailTeamView }) {
  return (
    <section
      aria-label={team.side === "team" ? "내 팀 상세" : "상대 팀 상세"}
      className={`overflow-hidden rounded-lg border bg-surface ${
        team.win ? "border-win/40" : "border-lose/40"
      }`}
    >
      <TeamHeader team={team} />
      <ColumnLabels />
      <ul className="divide-y divide-border/60">
        {team.players.map((player, index) => (
          <PlayerRow key={`${player.champion.championId}-${index}`} player={player} side={team.side} />
        ))}
      </ul>
    </section>
  );
}

export default function MatchDetail({ detail }: { detail: MatchDetailView }) {
  return (
    <div className="space-y-3">
      {detail.teams.map((team) => (
        <TeamTable key={team.side} team={team} />
      ))}
    </div>
  );
}
