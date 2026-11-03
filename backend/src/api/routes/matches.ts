// GET /api/v1/matches/lane-gold (api_contract 2-6, back_spec 변경 04)
// 전적 검색(2-5)이 준 matchId들의 라인전 15분 골드 격차를 따로 준다(지연 로딩). window 객체 없음.
// POST /api/v1/matches/:matchId/feedback (api_contract 2-7, back_spec 변경 05): 게임 피드백 분석. 유일한 POST.
import express, { Router, type Request } from 'express';
import { FEEDBACK_BODY_LIMIT } from '../../config/feedback.js';
import type { ApiDeps } from '../app.js';
import { ApiError, requireParam } from '../errors.js';
import { parseMatchIdParam, parseMatchIdsParam, parsePuuidParam } from '../validate.js';

const badBody = () => new ApiError(400, 'INVALID_PARAMETER', '요청 본문은 2KB 이하 JSON 객체여야 합니다.', { param: 'body' });

/** 본문 { puuid } 검사. 모르는 필드는 무시. 오류 details에 puuid·본문 값은 넣지 않는다 */
function readFeedbackBody(req: Request): string {
  if (!req.is('application/json')) throw badBody();
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badBody();
  const parsed = parsePuuidParam((body as { puuid?: unknown }).puuid);
  if (!parsed.ok) throw new ApiError(400, 'INVALID_PARAMETER', parsed.message, { param: 'puuid' });
  return parsed.value;
}

export function matchesRouter({ laneGold, feedback }: ApiDeps): Router {
  const r = Router();

  r.get('/matches/lane-gold', async (req, res) => {
    const puuid = requireParam(parsePuuidParam(req.query.puuid), 'puuid', req.query.puuid);
    const matchIds = requireParam(parseMatchIdsParam(req.query.matchIds), 'matchIds', req.query.matchIds);
    const result = await laneGold(puuid, matchIds);
    // 서버가 경기별로 6시간 캐시하므로 HTTP 캐시는 쓰지 않는다 (pending이 섞인 응답을 붙잡지 않도록)
    res.set('Cache-Control', 'no-store').json(result);
  });

  r.post(
    '/matches/:matchId/feedback',
    // ① 스위치: 꺼져 있으면 본문을 읽기 전에 바로 503 (05-4)
    (_req, _res, next) => {
      if (feedback.unavailable) throw feedback.unavailable;
      next();
    },
    express.json({ limit: FEEDBACK_BODY_LIMIT, type: 'application/json', strict: true }),
    async (req, res) => {
      const matchId = requireParam(parseMatchIdParam(req.params.matchId), 'matchId', req.params.matchId);
      const puuid = readFeedbackBody(req);
      const result = await feedback(matchId, puuid);
      // 서버가 메모리에 캐시하므로 HTTP 캐시는 쓰지 않는다
      res.set('Cache-Control', 'no-store').json(result);
    },
  );

  return r;
}
