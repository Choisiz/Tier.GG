// 개발용 명령: 로컬 JSON 파일만 읽어 판정 엔진 결과를 출력한다. Riot·DB·LLM을 부르지 않는다.
// npm run analyze -- --match <파일> --timeline <파일> (--puuid <값> | --participant <1~10>) [--tags <파일>] [--compact]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AnalysisError, analyzeMatch, championTagsFromJson } from '../analysis/index.js';
import type { AnalysisMatch, AnalysisTimeline } from '../analysis/types.js';

const USAGE = `사용법: npm run analyze -- --match <match.json> --timeline <timeline.json> (--puuid <값> | --participant <1~10>)
  --tags <파일>   Data Dragon 챔피언 태그 (기본: test/fixtures/ddragon/champion-tags.json)
  --compact      한 줄 JSON으로 출력
예: npm run analyze -- --match test/fixtures/KR_8437852704.match.json --timeline test/fixtures/KR_8437852704.timeline.json --participant 5`;

const DEFAULT_TAGS = fileURLToPath(new URL('../../test/fixtures/ddragon/champion-tags.json', import.meta.url));

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function main(): number {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        match: { type: 'string' },
        timeline: { type: 'string' },
        puuid: { type: 'string' },
        participant: { type: 'string' },
        tags: { type: 'string' },
        compact: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    console.error(USAGE);
    return 1;
  }
  if (values.help || !values.match || !values.timeline || (!values.puuid && !values.participant)) {
    console.error(USAGE);
    return values.help ? 0 : 1;
  }
  const match = readJson(values.match) as AnalysisMatch;
  const timeline = readJson(values.timeline) as AnalysisTimeline;
  const championTags = championTagsFromJson(readJson(values.tags ?? DEFAULT_TAGS));
  let puuid = values.puuid;
  if (!puuid) {
    const pid = Number(values.participant);
    puuid = match.info.participants.find((p) => p.participantId === pid)?.puuid;
    if (!puuid) {
      console.error(`participantId ${values.participant}가 이 판에 없음`);
      return 1;
    }
  }
  try {
    const result = analyzeMatch({ match, timeline, puuid, championTags });
    console.log(values.compact ? JSON.stringify(result) : JSON.stringify(result, null, 2));
    return 0;
  } catch (e) {
    if (e instanceof AnalysisError) {
      console.error(`분석 불가 (${e.code}): ${e.message}`);
      return 2;
    }
    throw e;
  }
}

process.exitCode = main();
