// RAG 적재 (ai_spec B4-3, F-2): 문서 조각과 DB 행을 비교해 새·바뀜·지울 조각을 고르고, 바뀐 조각만 임베딩해 upsert한다.
// DB는 주입받는다(CLI가 연결 1개를 넘긴다, 트랜잭션은 같은 연결에서). 계약 v9 12-1: 쓰기 함수 없이 INSERT … ON CONFLICT와 DELETE.
import type { KnowledgeChunk } from './chunks.js';
import type { RagDb } from './retrieve.js';
import { estimateEmbedTokens, toVectorLiteral, VOYAGE_MODEL, type EmbedFn } from './voyage.js';

/** DB에 이미 있는 행 (임베딩 벡터는 읽지 않는다) */
export interface StoredChunk {
  id: string;
  source: string;
  position: string;
  role: string;
  area: string;
  subject: string | null;
  polarity: string;
  contentHash: string;
  embeddingModel: string;
}

export interface IngestPlan {
  /** DB에 없는 조각 → 임베딩 + INSERT */
  added: KnowledgeChunk[];
  /** 본문이 바뀌었거나 임베딩 모델이 다른 조각 → 다시 임베딩 + UPDATE */
  changed: KnowledgeChunk[];
  /** 본문은 같고 메타데이터(유형·과목·방향 등)만 바뀐 조각 → 임베딩 없이 UPDATE */
  metaOnly: KnowledgeChunk[];
  unchanged: number;
  /** 문서에서 사라진 DB 조각 ID (--prune일 때만 지운다) */
  removed: string[];
  /** 임베딩할 조각들의 토큰 어림 */
  estTokens: number;
}

export const SELECT_STORED_SQL =
  'SELECT id, source, position, role, area, subject, polarity, content_hash, embedding_model FROM rag_chunk ORDER BY id';

export async function readStored(db: RagDb): Promise<StoredChunk[]> {
  const { rows } = await db.query(SELECT_STORED_SQL);
  return rows.map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: String(x.id),
      source: String(x.source),
      position: String(x.position),
      role: String(x.role),
      area: String(x.area),
      subject: x.subject === null ? null : String(x.subject),
      polarity: String(x.polarity),
      contentHash: String(x.content_hash),
      embeddingModel: String(x.embedding_model),
    };
  });
}

const sameMeta = (c: KnowledgeChunk, s: StoredChunk) =>
  c.source === s.source && c.position === s.position && c.role === s.role && c.area === s.area && c.subject === s.subject && c.polarity === s.polarity;

export function planIngest(local: readonly KnowledgeChunk[], stored: readonly StoredChunk[], model: string = VOYAGE_MODEL): IngestPlan {
  const byId = new Map(stored.map((s) => [s.id, s]));
  const plan: IngestPlan = { added: [], changed: [], metaOnly: [], unchanged: 0, removed: [], estTokens: 0 };
  for (const c of local) {
    const s = byId.get(c.id);
    if (!s) plan.added.push(c);
    else if (s.contentHash !== c.contentHash || s.embeddingModel !== model) plan.changed.push(c);
    else if (!sameMeta(c, s)) plan.metaOnly.push(c);
    else plan.unchanged++;
  }
  const localIds = new Set(local.map((c) => c.id));
  plan.removed = stored.filter((s) => !localIds.has(s.id)).map((s) => s.id);
  plan.estTokens = estimateEmbedTokens([...plan.added, ...plan.changed].map((c) => c.content));
  return plan;
}

export const UPSERT_SQL = `INSERT INTO rag_chunk (id, source, position, role, area, subject, polarity, champion_id, patch, content, content_hash, embedding, embedding_model, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, $10::extensions.vector, $11, now())
ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, position = EXCLUDED.position, role = EXCLUDED.role, area = EXCLUDED.area,
  subject = EXCLUDED.subject, polarity = EXCLUDED.polarity, champion_id = NULL, patch = NULL, content = EXCLUDED.content,
  content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model, updated_at = now()`;

export const UPDATE_META_SQL =
  'UPDATE rag_chunk SET source = $2, position = $3, role = $4, area = $5, subject = $6, polarity = $7, updated_at = now() WHERE id = $1';

export const DELETE_SQL = 'DELETE FROM rag_chunk WHERE id = ANY($1::text[])';

export interface ApplyResult {
  embedded: number;
  upserted: number;
  metaUpdated: number;
  deleted: number;
}

/**
 * 계획대로 쓴다. 임베딩은 트랜잭션 밖에서 먼저 모두 받고(실패하면 DB를 건드리지 않음), 쓰기는 트랜잭션 1개로.
 * prune=false면 removed는 지우지 않는다.
 */
export async function applyIngest(
  db: RagDb,
  plan: IngestPlan,
  embed: EmbedFn,
  o: { prune: boolean; model?: string },
): Promise<ApplyResult> {
  const model = o.model ?? VOYAGE_MODEL;
  const toEmbed = [...plan.added, ...plan.changed];
  const vectors = toEmbed.length > 0 ? await embed(toEmbed.map((c) => c.content), 'document') : [];
  if (vectors.length !== toEmbed.length) throw new Error(`임베딩 개수 ${vectors.length} ≠ 조각 ${toEmbed.length}`);
  const deleting = o.prune ? plan.removed : [];
  await db.query('BEGIN');
  try {
    for (let i = 0; i < toEmbed.length; i++) {
      const c = toEmbed[i]!;
      await db.query(UPSERT_SQL, [c.id, c.source, c.position, c.role, c.area, c.subject, c.polarity, c.content, c.contentHash, toVectorLiteral(vectors[i]!), model]);
    }
    for (const c of plan.metaOnly) await db.query(UPDATE_META_SQL, [c.id, c.source, c.position, c.role, c.area, c.subject, c.polarity]);
    if (deleting.length > 0) await db.query(DELETE_SQL, [deleting]);
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
  return { embedded: toEmbed.length, upserted: toEmbed.length, metaUpdated: plan.metaOnly.length, deleted: deleting.length };
}
