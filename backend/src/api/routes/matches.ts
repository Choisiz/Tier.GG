// GET /api/v1/matches/lane-gold (api_contract 2-6, back_spec 변경 04)
// 전적 검색(2-5)이 준 matchId들의 라인전 15분 골드 격차를 따로 준다(지연 로딩). window 객체 없음.
import { Router } from 'express';
import type { ApiDeps } from '../app.js';
import { requireParam } from '../errors.js';
import { parseMatchIdsParam, parsePuuidParam } from '../validate.js';

export function matchesRouter({ laneGold }: ApiDeps): Router {
  const r = Router();

  r.get('/matches/lane-gold', async (req, res) => {
    const puuid = requireParam(parsePuuidParam(req.query.puuid), 'puuid', req.query.puuid);
    const matchIds = requireParam(parseMatchIdsParam(req.query.matchIds), 'matchIds', req.query.matchIds);
    const result = await laneGold(puuid, matchIds);
    // 서버가 경기별로 6시간 캐시하므로 HTTP 캐시는 쓰지 않는다 (pending이 섞인 응답을 붙잡지 않도록)
    res.set('Cache-Control', 'no-store').json(result);
  });

  return r;
}
