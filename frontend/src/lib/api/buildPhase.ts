import "server-only";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * `next build` 중인지 (변경 01 01-2-5).
 * Next가 빌드 시작 때 `process.env.NEXT_PHASE`를 넣고, 정적 생성 작업 프로세스도 이 값을 물려받는다.
 */
export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
}
