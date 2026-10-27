import RetryButton from "./RetryButton";

/**
 * Riot·서버 연결 실패 안내 (계약 2-5 오류, 4장 상태 처리).
 * production 빌드는 서버 컴포넌트에서 던진 오류의 `message`를 클라이언트로 보내지 않고
 * 가려버리므로(Next 보안 동작, 직접 확인함), error.tsx로 상태를 구분하지 않고 여기서 바로 그린다.
 */
export default function SummonerStatus({
  message,
  showRetry = false,
}: {
  message: string;
  showRetry?: boolean;
}) {
  return (
    <section role="alert" className="flex flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-2xl font-bold">전적을 불러오지 못했습니다</h1>
      <p className="text-muted">{message}</p>
      {showRetry ? <RetryButton /> : null}
    </section>
  );
}
