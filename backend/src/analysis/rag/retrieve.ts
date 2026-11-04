// RAG 검색 (ai_spec B4-3, F-5): 엔진이 말하기로 고른 과목마다 관점 조각을 찾는다.
// 1) 과목마다 짧은 질의 문장 → 2) 질의 전체를 임베딩 1번(한 요청)에 → 3) 과목마다 search_rag_chunks(필터 + 뜻 순위)
// → 4) 그 유형 조각을 먼저, 없으면 role=ALL 조각으로 넓힘 → 5) 과목당 2개, 판당 8개, 같은 조각은 한 번.
// DB·임베딩 함수는 주입받는다 (단위 테스트는 가짜). 판정·숫자는 건드리지 않는다.
import { ROLE_LABEL } from '../role.js';
import { MAX_PER_KIND } from '../llm/facts.js';
import { AREA_LABEL, SUBJECT_LABEL, type Area } from '../llm/labels.js';
import type { AnalysisResult, Role } from '../types.js';
import { ROLE_POSITION, roleOfId, type ChunkPolarity, type ChunkPosition, type ChunkRole } from './chunks.js';
import { toVectorLiteral, type EmbedFn } from './voyage.js';

export const RAG_LIMITS = {
  /** 과목당 프롬프트에 넣는 조각 수 */
  perSubject: 2,
  /** 판당 상한 (토큰 비용 상한) */
  perGame: 8,
  /** 과목마다 DB에서 받아 오는 후보 수 (유형 조각을 먼저 고르려고 조금 넉넉히) */
  candidates: 6,
} as const;

/** search_rag_chunks 한 줄 (계약 v9 12-2) */
export interface RagRow {
  id: string;
  source: string;
  area: string;
  subject: string | null;
  polarity: string;
  content: string;
  distance: number;
}

export interface RagSearchParams {
  embedding: readonly number[];
  role: ChunkRole;
  position: ChunkPosition;
  area: Area;
  subjects: string[] | null;
  polarity: ChunkPolarity;
  championId: number | null;
  limit: number;
}

export type SearchFn = (p: RagSearchParams) => Promise<RagRow[]>;

/** pg 풀·클라이언트 모양 (query만) */
export interface RagDb {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export const SEARCH_SQL =
  'SELECT id, source, area, subject, polarity, content, distance FROM search_rag_chunks($1::extensions.vector, $2, $3, $4, $5::text[], $6, $7, $8)';

/** 실제 DB 검색 함수 (계약 v9 12-2) */
export function pgSearch(db: RagDb): SearchFn {
  return async (p) => {
    const { rows } = await db.query(SEARCH_SQL, [
      toVectorLiteral(p.embedding),
      p.role,
      p.position,
      p.area,
      p.subjects,
      p.polarity,
      p.championId,
      p.limit,
    ]);
    return rows.map((r) => {
      const x = r as Record<string, unknown>;
      return {
        id: String(x.id),
        source: String(x.source),
        area: String(x.area),
        subject: x.subject === null ? null : String(x.subject),
        polarity: String(x.polarity),
        content: String(x.content),
        distance: Number(x.distance),
      };
    });
  };
}

/** 검색할 과목 하나 */
export interface RagTarget {
  /** 칸 이름과 같은 꼴: fight.bad.0 */
  key: string;
  area: Area;
  kind: 'good' | 'bad';
  subjectId: string;
  query: string;
}

/** 질의 문장: 유형 + 과목 + 좋음/부족 + 영역 판정 + 승패 (숫자 없이 짧게) */
export function queryText(role: Role, area: Area, subjectId: string, kind: 'good' | 'bad', verdict: string | null, win: boolean): string {
  const parts = [`${ROLE_LABEL[role]} ${SUBJECT_LABEL[subjectId] ?? subjectId} ${kind === 'good' ? '좋음' : '부족'}`];
  if (verdict) parts.push(`${AREA_LABEL[area]} ${verdict}`);
  parts.push(win ? '승리' : '패배');
  return parts.join(', ');
}

/** 엔진 결과에서 검색할 과목들. 칸(facts.ts)과 같은 순서·개수 (영역마다 좋은 점·부족한 점 최대 2개) */
export function ragTargets(result: AnalysisResult): RagTarget[] {
  const out: RagTarget[] = [];
  const verdict: Record<Area, string | null> = { laning: result.summary.laning, fight: result.summary.fight, macro: result.summary.macro };
  // 반영 비율이 큰 교전·운영을 먼저, 그 안에서는 부족한 점을 먼저 (판당 상한에 걸릴 때 앞쪽이 남는다)
  for (const area of ['fight', 'macro', 'laning'] as const) {
    if (area === 'laning' && result.laning === null) continue;
    for (const kind of ['bad', 'good'] as const) {
      result.speakOrder[area][kind].slice(0, MAX_PER_KIND).forEach((subjectId, i) => {
        out.push({
          key: `${area}.${kind}.${i}`,
          area,
          kind,
          subjectId,
          query: queryText(result.player.role, area, subjectId, kind, verdict[area], result.player.win),
        });
      });
    }
  }
  return out;
}

export interface RetrievedChunk {
  id: string;
  content: string;
  distance: number;
}

export interface RagPick {
  key: string;
  subjectId: string;
  ids: string[];
  /** 그 유형 조각이 없어 role=ALL 조각만 썼다 */
  widened: boolean;
}

export interface RetrieveOutcome {
  /** 프롬프트에 넣을 조각 (중복 없음, 최대 perGame개). 0개면 RAG 없이 쓴다 */
  chunks: RetrievedChunk[];
  picks: RagPick[];
  queries: number;
  /** 로그용 한 줄 설명 (숫자·ID만, 키·puuid 없음) */
  notes: string[];
}

export interface RetrieveDeps {
  embed: EmbedFn;
  search: SearchFn;
  limits?: Partial<typeof RAG_LIMITS>;
}

/** 후보 줄에서 과목 하나에 쓸 조각을 고른다: 그 유형 조각을 거리순으로 먼저, 모자라면 ALL 조각으로 채움 */
export function pickForSubject(rows: readonly RagRow[], role: Role, subjectId: string, perSubject: number): { rows: RagRow[]; widened: boolean } {
  const bySubject = rows.filter((r) => r.subject === null || r.subject === subjectId);
  const byDist = [...bySubject].sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1));
  const own = byDist.filter((r) => roleOfId(r.id) === role);
  const all = byDist.filter((r) => roleOfId(r.id) === 'ALL');
  const picked = own.slice(0, perSubject);
  if (picked.length < perSubject) picked.push(...all.slice(0, perSubject - picked.length));
  return { rows: picked, widened: own.length === 0 && picked.length > 0 };
}

export async function retrieveKnowledge(result: AnalysisResult, deps: RetrieveDeps): Promise<RetrieveOutcome> {
  const limits = { ...RAG_LIMITS, ...deps.limits };
  const targets = ragTargets(result);
  const notes: string[] = [];
  if (targets.length === 0) return { chunks: [], picks: [], queries: 0, notes: ['말할 과목 없음'] };

  const vectors = await deps.embed(
    targets.map((t) => t.query),
    'query',
  );
  if (vectors.length !== targets.length) throw new Error(`질의 임베딩 개수 ${vectors.length} ≠ 과목 ${targets.length}`);

  const role = result.player.role;
  const position = ROLE_POSITION[role];
  const rowsPer = await Promise.all(
    targets.map((t, i) =>
      deps.search({
        embedding: vectors[i]!,
        role,
        position,
        area: t.area,
        subjects: [t.subjectId],
        polarity: t.kind,
        championId: null,
        limit: limits.candidates,
      }),
    ),
  );

  const picks: RagPick[] = targets.map((t, i) => {
    const p = pickForSubject(rowsPer[i]!, role, t.subjectId, limits.perSubject);
    if (p.widened) notes.push(`${t.key} ${t.subjectId}: 유형 조각 없음 → ALL 조각`);
    if (p.rows.length === 0) notes.push(`${t.key} ${t.subjectId}: 맞는 조각 없음`);
    return { key: t.key, subjectId: t.subjectId, ids: p.rows.map((r) => r.id), widened: p.widened };
  });

  // 과목마다 1순위부터 돌아가며 담는다 (앞 과목이 상한을 다 쓰지 않게). 같은 조각은 한 번만
  const rowById = new Map<string, RagRow>();
  for (const rows of rowsPer) for (const r of rows) if (!rowById.has(r.id)) rowById.set(r.id, r);
  const chosen: RetrievedChunk[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...picks.map((p) => p.ids.length));
  outer: for (let k = 0; k < depth; k++) {
    for (const p of picks) {
      const id = p.ids[k];
      if (id === undefined || seen.has(id)) continue;
      if (chosen.length >= limits.perGame) break outer;
      seen.add(id);
      const r = rowById.get(id)!;
      chosen.push({ id, content: r.content, distance: r.distance });
    }
  }
  const dropped = new Set(picks.flatMap((p) => p.ids)).size - chosen.length;
  if (dropped > 0) notes.push(`판당 상한 ${limits.perGame}개로 ${dropped}개 뺌`);
  if (chosen.length === 0) notes.push('조각 0개 → RAG 없이 생성');
  return { chunks: chosen, picks, queries: targets.length, notes };
}
