// GET /api/v1/summoners/:region/:riotId (api_contract v2 2-5, back_spec 변경 03)
// window 객체가 없는 유일한 통계형 엔드포인트다 (검색 결과는 거의 실시간, 집계 창과 무관).
import { Router } from 'express';
import type { ApiDeps } from '../app.js';
import { requireParam } from '../errors.js';
import { parseRegionParam, parseRiotIdParam } from '../validate.js';

export function summonersRouter({ summonerSearch }: ApiDeps): Router {
  const r = Router();

  r.get('/summoners/:region/:riotId', async (req, res) => {
    const region = requireParam(parseRegionParam(req.params.region), 'region', req.params.region);
    const { gameName, tagLine } = requireParam(parseRiotIdParam(req.params.riotId), 'riotId', req.params.riotId);
    const result = await summonerSearch(region, gameName, tagLine);
    // 검색 결과는 거의 실시간이어야 하므로 통계 엔드포인트(public, max-age=600)와 다르게 no-store (W-8)
    res.set('Cache-Control', 'no-store').json(result);
  });

  return r;
}
