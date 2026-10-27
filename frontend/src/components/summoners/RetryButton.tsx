"use client";

/** 전적 로딩 실패 안내의 [다시 시도] 버튼. 서버 컴포넌트 안에서 다시 요청하도록 새로고침한다 */
export default function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => location.reload()}
      className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-foreground hover:opacity-90"
    >
      다시 시도
    </button>
  );
}
