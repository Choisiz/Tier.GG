import type { ReactNode, Ref } from "react";
import type { FeedbackSectionView, FeedbackView } from "@/lib/view/feedback";

/* ───────── 아이콘 (인라인 SVG, 장식용) ───────── */

export function SparkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0">
      <path d="M8 1.5l1.6 4.1 4.1 1.6-4.1 1.6L8 12.9 6.4 8.8 2.3 7.2l4.1-1.6z" fill="currentColor" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="4.8" r=".9" fill="currentColor" />
    </svg>
  );
}

export function WarnIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0">
      <path
        d="M8 1.8l6.6 11.8H1.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 6.2v3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r=".9" fill="currentColor" />
    </svg>
  );
}

function GoodIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4.8 8.2l2.1 2.1 4.3-4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WidenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3">
      <path
        d="M2 6h8M7 3l3 3-3 3M5 3L2 6l3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NarrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3">
      <path
        d="M1 6h3M8 6h3M2 3l3 3-3 3M10 3L7 6l3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 패널 머리말: 제목 + (결과일 때) 챔피언·유형 기준 + 오른쪽 보조 표시 */
export function FeedbackHeading({
  subtitle,
  chip,
  headingRef,
}: {
  subtitle?: string | null;
  chip?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h3
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="flex items-center gap-1.5 text-sm font-bold text-foreground focus:outline-none"
      >
        <span className="text-accent">
          <SparkIcon />
        </span>
        AI 게임 분석
      </h3>
      {subtitle ? <span className="text-xs text-muted">{subtitle}</span> : null}
      {chip ? <span className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">{chip}</span> : null}
    </div>
  );
}

/* ───────── 결과 ───────── */

/** 좋은 점 / 부족한 점 목록. 색 + 아이콘 + 글자로 3중 구분 (10-7) */
function PointList({ kind, items }: { kind: "good" | "bad"; items: string[] }) {
  if (items.length === 0) return null;
  const good = kind === "good";
  const label = good ? "좋은 점" : "부족한 점";
  return (
    <div>
      <p className={`mb-1 flex items-center gap-1 text-xs font-bold ${good ? "text-win" : "text-lose"}`}>
        {good ? <GoodIcon /> : <WarnIcon />}
        <span>{label}</span>
      </p>
      <ul className="space-y-1.5" aria-label={label}>
        {items.map((text, index) => (
          <li
            key={index}
            className={`relative pl-3 text-sm leading-6 text-foreground before:absolute before:top-[11px] before:left-0 before:size-1 before:rounded-full ${
              good ? "before:bg-win" : "before:bg-lose"
            }`}
          >
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionBody({ section }: { section: FeedbackSectionView }) {
  if (section.note) {
    return (
      <p className="flex gap-1.5 text-sm text-muted">
        <InfoIcon />
        {section.note}
      </p>
    );
  }
  if (section.good.length === 0 && section.bad.length === 0) {
    return <p className="text-sm text-muted">이 영역은 특별히 짚을 점이 없었어요.</p>;
  }
  // 둘 다 있으면 sm 이상 2열, 한쪽만 있으면 그쪽만 전체 폭. 빈 쪽 안내는 만들지 않는다
  const both = section.good.length > 0 && section.bad.length > 0;
  return (
    <div className={`grid gap-3 ${both ? "sm:grid-cols-2" : ""}`}>
      <PointList kind="good" items={section.good} />
      <PointList kind="bad" items={section.bad} />
    </div>
  );
}

const TEMPLATE_TEXT = {
  llm_error: { chip: "기본 문장", note: "AI 문장 생성에 실패해 기본 문장으로 보여 드려요." },
  llm_off: { chip: "간단 분석", note: "지금은 AI 문장 없이 판정 결과만 간단히 보여 드려요." },
} as const;

/**
 * ③ 결과 / ④ 템플릿 결과 (변경 10). 상태 없는 표시용.
 * 등급·점수·영역 판정어·개수 요약은 만들지 않는다 (D75).
 */
export default function FeedbackResult({
  matchId,
  view,
  championName,
  headingRef,
}: {
  matchId: string;
  view: FeedbackView;
  championName: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const template = view.templateReason ? TEMPLATE_TEXT[view.templateReason] : null;
  const subtitle = view.roleLabel ? `${championName} · ${view.roleLabel} 기준` : `${championName} 기준`;
  return (
    <div>
      <FeedbackHeading
        subtitle={subtitle}
        headingRef={headingRef}
        chip={
          template ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
              <InfoIcon />
              <span>{template.chip}</span>
            </span>
          ) : null
        }
      />
      {template ? (
        <p className="mt-2 flex gap-1.5 text-xs text-muted">
          <InfoIcon />
          {template.note}
        </p>
      ) : null}

      <div className="mt-3 rounded-lg border-l-2 border-accent bg-surface p-3">
        <p className="mb-1 text-xs font-bold text-accent">한 줄 요약</p>
        <p className="text-sm leading-6">{view.summary}</p>
      </div>

      <div className="mt-3 space-y-3">
        {view.sections.map((section) => {
          const headingId = `fb-${matchId}-${section.key}`;
          return (
            <section
              key={section.key}
              aria-labelledby={headingId}
              className="border-t border-border pt-3 sm:grid sm:grid-cols-[88px_1fr] sm:gap-3"
            >
              <h4 id={headingId} className="mb-2 flex items-baseline gap-2 text-sm font-bold sm:mb-0 sm:block">
                {section.label}
                {section.hint ? (
                  <span className="text-[11px] font-normal text-muted sm:mt-0.5 sm:block">{section.hint}</span>
                ) : null}
              </h4>
              <SectionBody section={section} />
            </section>
          );
        })}

        {view.moments.length > 0 ? (
          <section aria-labelledby={`fb-${matchId}-km`} className="border-t border-border pt-3">
            <h4 id={`fb-${matchId}-km`} className="mb-2 text-sm font-bold">
              결정적 장면{" "}
              <span className="text-[11px] font-normal text-muted">
                골드 격차가 크게 움직인 싸움 {view.moments.length}개
              </span>
            </h4>
            <ol className="space-y-2">
              {view.moments.map((moment, index) => (
                <li
                  key={index}
                  className="flex flex-col gap-1 rounded-md bg-surface p-2.5 sm:flex-row sm:gap-3"
                >
                  {/* 벌어짐/좁혀짐은 격차 크기 변화일 뿐 누가 유리한지가 아니라 승/패 색을 쓰지 않는다 (D74) */}
                  <div className="flex shrink-0 items-center gap-2 sm:w-[132px] sm:flex-col sm:items-start sm:gap-1">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-bold text-accent tabular-nums">
                      <span className="sr-only">게임 시간 </span>
                      {moment.time}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                      {moment.direction === "widened" ? <WidenIcon /> : <NarrowIcon />}
                      {moment.direction === "widened" ? "격차 벌어짐" : "격차 좁혀짐"}
                    </span>
                  </div>
                  <p className="text-sm leading-6">{moment.text}</p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>

      <p className="mt-3 text-[11px] text-muted">
        Riot 경기 기록의 숫자로 판정하고 AI가 문장으로 옮겼어요. 문장은 틀릴 수 있어요.
      </p>
    </div>
  );
}
