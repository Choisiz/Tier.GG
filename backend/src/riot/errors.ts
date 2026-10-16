// Riot 호출 오류 분류 (back_spec 6-1)

export class RiotError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly path: string,
  ) {
    super(message);
  }
}

/** 401/403: 키 만료 또는 잘못된 키. 즉시 수집 중단 */
export class RiotKeyExpiredError extends RiotError {
  override name = 'RiotKeyExpiredError';
}

/** 404: 없음. 그 게임/플레이어/페이지만 건너뜀 */
export class RiotNotFoundError extends RiotError {
  override name = 'RiotNotFoundError';
}

/** 400 등 재시도해도 소용없는 응답. 건너뜀 + 오류 로그 */
export class RiotBadRequestError extends RiotError {
  override name = 'RiotBadRequestError';
}

/** 429·5xx·네트워크 오류를 정해진 횟수만큼 재시도해도 실패 */
export class RiotRetryExhaustedError extends RiotError {
  override name = 'RiotRetryExhaustedError';
}
