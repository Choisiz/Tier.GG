// 불변 조건: 두 번째 판 KR_8408851980 + 세나 판 10명 모두 (ai_spec B-3 "두 번째 판")
// + 엔진이 네트워크·DB·환경 변수를 쓰지 않는지 import 검사 (B-4 완료 기준 4)
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { analyzeMatch } from '../../../src/analysis/index.js';
import { areaVerdict } from '../../../src/analysis/score.js';
import type { AnalysisMatch, AnalysisResult, AnalysisTimeline, AreaResult } from '../../../src/analysis/types.js';
import { loadSecond, loadSena, TAGS } from './helpers.js';

function checkArea(name: string, a: AreaResult) {
  const total = Object.values(a.weights).reduce((s, v) => s + v, 0);
  assert.equal(total, 100, `${name} 반영 비율 합`);
  assert.equal(
    a.subjects.reduce((s, x) => s + x.weight, 0),
    100,
    `${name} 과목 비율 합`,
  );
  if (a.total !== null) assert.ok(a.total >= 0 && a.total <= 100, `${name} 총점 ${a.total}`);
  assert.equal(a.verdict, areaVerdict(a.total));
  for (const s of a.subjects) {
    if (s.grade === null) {
      assert.ok(s.reason, `${s.id} 매기지 않은 이유`);
      continue;
    }
    assert.ok(s.score! >= 0 && s.score! <= s.weight, `${s.id} 점수 범위`);
  }
}

function checkAll(match: AnalysisMatch, timeline: AnalysisTimeline): AnalysisResult[] {
  return match.info.participants.map((p) => {
    const r = analyzeMatch({ match, timeline, puuid: p.puuid, championTags: TAGS });
    assert.equal(r.player.participantId, p.participantId);
    checkArea(`${p.participantId} fight`, r.fight);
    checkArea(`${p.participantId} macro`, r.macro);
    assert.ok(r.keyMoments.length <= 3);
    // 말할 과목은 A·B(좋은 점) 또는 D·E(부족한 점)만
    for (const area of ['fight', 'macro'] as const) {
      const grade = (id: string) => r[area].subjects.find((s) => s.id === id)?.grade;
      for (const id of r.speakOrder[area].good) assert.ok(['A', 'B'].includes(grade(id)!), id);
      for (const id of r.speakOrder[area].bad) assert.ok(['D', 'E'].includes(grade(id)!), id);
    }
    return r;
  });
}

describe('두 번째 판 KR_8408851980 (timeline에 스냅샷 없음)', () => {
  const { match, timeline } = loadSecond();
  it('10명 모두 오류 없이 돌고, 총점 0~100, 반영 비율 합 100', () => {
    const rs = checkAll(match, timeline);
    assert.equal(rs.length, 10);
    // 스냅샷이 없어 라인전·딜·결정적 장면은 매기지 않고 경고를 남긴다
    for (const r of rs) {
      assert.equal(r.laning, null);
      assert.equal(r.warnings.length, 1);
    }
  });
});

describe('세나 판 10명 모두', () => {
  const { match, timeline } = loadSena();
  it('오류 없음, 총점 0~100, 반영 비율 합 100, 모두 라인전 판정 있음', () => {
    const rs = checkAll(match, timeline);
    assert.equal(rs.length, 10);
    for (const r of rs) {
      assert.ok(r.laning, `${r.player.participantId} 라인전`);
      assert.ok(r.fight.total !== null && r.macro.total !== null);
    }
    // 같은 판이라 결정적 장면 시각은 10명 모두 같다
    const times = rs.map((r) => r.keyMoments.map((k) => k.startSec).join(','));
    assert.equal(new Set(times).size, 1);
  });
});

describe('엔진 import 검사', () => {
  it('analysis/는 riot·db·repositories·api·collector와 네트워크·파일·환경 변수를 쓰지 않음', () => {
    const dir = fileURLToPath(new URL('../../../src/analysis/', import.meta.url));
    // 2단계(2026-11-03): LLM 문장 단계(llm/**, feedback.ts)는 엔진 밖이라 이 검사에서 뺀다. 그쪽 경계는 llm/misc.test.ts "import 경계"
    const files = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts') && !f.startsWith('llm/') && f !== 'feedback.ts');
    assert.ok(files.length >= 10);
    for (const f of files) {
      const src = readFileSync(`${dir}${f}`, 'utf8');
      const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const i of imports) {
        assert.ok(i.startsWith('./'), `${f}: 엔진 밖 모듈 import 금지 (${i})`);
      }
      assert.ok(!/process\.env|fetch\(/.test(src), `${f}: 환경 변수·네트워크 사용 금지`);
    }
  });
});
