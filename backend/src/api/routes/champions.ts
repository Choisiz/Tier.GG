// GET /api/v1/champions, GET /api/v1/champions/:championId (api_contract v2 2-3, 2-4)
// 요청 하나의 모든 읽기는 db.snapshot 안에서 차례로 한다 (연결 1개, 변경 01-6-4). patch 쿼리는 무시한다.
import { Router } from 'express';
import { DETAIL_TOP_N } from '../../config/api.js';
import {
  itemsFor,
  readWindow,
  runesFor,
  skillsFor,
  spellsFor,
  tierRows,
  tierRowsForChampion,
} from '../../repositories/statsRepository.js';
import type { ApiDeps } from '../app.js';
import { cacheOk } from '../cache.js';
import { itemDto, positionTab, runeDto, skillDto, spellDto, statsSummary, tierListItem } from '../dto.js';
import { ApiError, requireParam } from '../errors.js';
import { mainPositions, mainPositionsByChampion } from '../mainPositions.js';
import { parseChampionIdParam, parsePositionParam } from '../validate.js';
import { requireWindow, windowDto } from '../window.js';

export function championsRouter({ db, logger, now, warnIfStale }: ApiDeps): Router {
  const r = Router();

  r.get('/champions', async (req, res) => {
    const position = requireParam(parsePositionParam(req.query.position, true), 'position', req.query.position);
    const { win, rows } = await db.snapshot(async (q) => {
      const win = requireWindow(await readWindow(q));
      return { win, rows: await tierRows(q) };
    });

    // 창의 모든 줄을 정렬된 순서로 받아, 주 포지션에 이 포지션이 있는 챔피언만 남긴다
    const mains = mainPositionsByChampion(rows);
    const champions = rows
      .filter((x) => x.position === position && (mains.get(x.championId) ?? []).includes(position))
      .map((x, i) => tierListItem(i + 1, x, mains.get(x.championId) ?? []));

    const t = now();
    warnIfStale(win.aggregatedAt, t);
    cacheOk(res).json({ window: windowDto(win, t, logger), position, champions });
  });

  r.get('/champions/:championId', async (req, res) => {
    const championId = requireParam(parseChampionIdParam(req.params.championId), 'championId', req.params.championId);
    const wanted = requireParam(parsePositionParam(req.query.position, false), 'position', req.query.position);

    const data = await db.snapshot(async (q) => {
      const win = requireWindow(await readWindow(q));
      const rows = await tierRowsForChampion(q, championId); // pick 내림차순
      if (rows.length === 0) {
        throw new ApiError(404, 'STATS_NOT_FOUND', '최근 14일 통계에 이 챔피언의 통계가 없습니다.', { championId });
      }
      const mains = mainPositions(rows);
      const position = wanted ?? (mains[0] as string);
      const row = rows.find((x) => x.position === position);
      if (!row) {
        throw new ApiError(404, 'STATS_NOT_FOUND', '최근 14일 통계에 이 챔피언의 해당 포지션 통계가 없습니다.', {
          championId,
          position,
        });
      }
      const key = { championId, position };
      const items = await itemsFor(q, key);
      const runes = await runesFor(q, key, DETAIL_TOP_N);
      const spells = await spellsFor(q, key, DETAIL_TOP_N);
      const skills = await skillsFor(q, key, DETAIL_TOP_N);
      return { win, rows, mains, position, row, items, runes, spells, skills };
    });

    const t = now();
    warnIfStale(data.win.aggregatedAt, t);
    cacheOk(res).json({
      window: windowDto(data.win, t, logger),
      championId,
      position: data.position,
      isMainPosition: data.mains.includes(data.position),
      positions: data.mains.map((p) => positionTab(data.rows.find((x) => x.position === p) as (typeof data.rows)[number])),
      stats: statsSummary(data.row),
      builds: {
        items: data.items.map(itemDto),
        runes: data.runes.map(runeDto),
        spells: data.spells.map(spellDto),
        skills: data.skills.map(skillDto),
      },
    });
  });

  return r;
}
