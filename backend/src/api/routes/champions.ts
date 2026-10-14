// GET /api/v1/champions, GET /api/v1/champions/:championId (api_contract 2-3, 2-4)
import { Router } from 'express';
import { DETAIL_TOP_N } from '../../config/api.js';
import type { Queryable } from '../../db/tx.js';
import {
  itemsFor,
  listPatches,
  runesFor,
  skillsFor,
  spellsFor,
  tierRowsForChampion,
  tierRowsForPatch,
} from '../../repositories/statsRepository.js';
import { cacheOk } from '../cache.js';
import { itemDto, positionTab, runeDto, skillDto, spellDto, statsSummary, tierListItem } from '../dto.js';
import { ApiError, requireParam } from '../errors.js';
import { mainPositions, mainPositionsByChampion } from '../mainPositions.js';
import { selectPatch } from '../patchSelection.js';
import { parseChampionIdParam, parsePatchParam, parsePositionParam } from '../validate.js';

export function championsRouter(db: Queryable): Router {
  const r = Router();

  r.get('/champions', async (req, res) => {
    const position = requireParam(parsePositionParam(req.query.position, true), 'position', req.query.position);
    const requested = requireParam(parsePatchParam(req.query.patch), 'patch', req.query.patch);
    const patch = selectPatch(await listPatches(db), requested);

    // 패치의 모든 줄을 정렬된 순서로 받아, 주 포지션에 이 포지션이 있는 챔피언만 남긴다
    const rows = await tierRowsForPatch(db, patch.data);
    const mains = mainPositionsByChampion(rows);
    const champions = rows
      .filter((x) => x.position === position && (mains.get(x.championId) ?? []).includes(position))
      .map((x, i) => tierListItem(i + 1, x, mains.get(x.championId) ?? []));

    cacheOk(res).json({ patch, position, champions });
  });

  r.get('/champions/:championId', async (req, res) => {
    const championId = requireParam(parseChampionIdParam(req.params.championId), 'championId', req.params.championId);
    const wanted = requireParam(parsePositionParam(req.query.position, false), 'position', req.query.position);
    const requested = requireParam(parsePatchParam(req.query.patch), 'patch', req.query.patch);
    const patch = selectPatch(await listPatches(db), requested);

    const rows = await tierRowsForChampion(db, patch.data, championId); // pick 내림차순
    if (rows.length === 0) {
      throw new ApiError(404, 'STATS_NOT_FOUND', '이 패치에 이 챔피언의 통계가 없습니다.', {
        championId,
        patch: patch.data,
      });
    }
    const mains = mainPositions(rows);
    const position = wanted ?? (mains[0] as string);
    const row = rows.find((x) => x.position === position);
    if (!row) {
      throw new ApiError(404, 'STATS_NOT_FOUND', '이 패치에 이 챔피언의 해당 포지션 통계가 없습니다.', {
        championId,
        position,
        patch: patch.data,
      });
    }

    const key = { patch: patch.data, championId, position };
    const [items, runes, spells, skills] = await Promise.all([
      itemsFor(db, key),
      runesFor(db, key, DETAIL_TOP_N),
      spellsFor(db, key, DETAIL_TOP_N),
      skillsFor(db, key, DETAIL_TOP_N),
    ]);

    cacheOk(res).json({
      patch,
      championId,
      position,
      isMainPosition: mains.includes(position),
      positions: mains.map((p) => positionTab(rows.find((x) => x.position === p) as (typeof rows)[number])),
      stats: statsSummary(row),
      builds: {
        items: items.map(itemDto),
        runes: runes.map(runeDto),
        spells: spells.map(spellDto),
        skills: skills.map(skillDto),
      },
    });
  });

  return r;
}
