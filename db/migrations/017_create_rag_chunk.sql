-- 017: RAG 벡터 저장소 rag_chunk + 검색 함수 search_rag_chunks (db_spec 변경 05, 계약 v9)
-- - 해석 문서 조각과 그 벡터(Voyage AI voyage-4, 1,024차원)만 저장한다. 플레이어 성적 지표는 저장하지 않는다.
-- - pgvector는 Supabase 권장 위치인 extensions 스키마에 둔다.
--   실행기는 search_path를 public(또는 임시 스키마 migration_check), pg_catalog로만 잡으므로
--   vector 타입과 <=> 연산자는 extensions. 접두사로 적는다 (실행기 수정 없이 fresh-check·함수 search_path에서 찾을 수 있게).
-- - 벡터 인덱스(HNSW)는 만들지 않는다: 조각 수백~1,000개는 필터 뒤 순차 거리 계산으로 충분하고,
--   근사 인덱스는 필터와 같이 쓰면 결과가 빠질 수 있다.
-- - 쓰기 함수는 없다. 백엔드 적재기가 서비스 연결로 INSERT … ON CONFLICT (id) DO UPDATE / DELETE 한다.
-- 주의: 테이블·함수에는 public. 접두사를 쓰지 않는다 (fresh-check가 임시 스키마에 적용하므로)

-- 1. 확장 (이미 있으면 그대로)
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- 2. 테이블
CREATE TABLE rag_chunk (
  id              text        NOT NULL,
  source          text        NOT NULL,
  position        text        NOT NULL,
  role            text        NOT NULL,
  area            text        NOT NULL,
  subject         text,
  polarity        text        NOT NULL,
  champion_id     int,
  patch           text,
  content         text        NOT NULL,
  content_hash    text        NOT NULL,
  embedding       extensions.vector(1024) NOT NULL,
  embedding_model text        NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rag_chunk_pkey PRIMARY KEY (id),
  CONSTRAINT rag_chunk_id_check CHECK (id <> ''),
  CONSTRAINT rag_chunk_source_check CHECK (source IN ('perspective', 'champion')),
  CONSTRAINT rag_chunk_position_check
    CHECK (position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'ALL')),
  CONSTRAINT rag_chunk_role_check
    CHECK (role IN ('TOP_TANK', 'TOP_DAMAGE', 'JUNGLE_TANK', 'JUNGLE_DAMAGE', 'MID_TANK', 'MID_DAMAGE',
                    'ADC', 'SUPPORT_TANK', 'SUPPORT_DAMAGE', 'SUPPORT_UTILITY', 'ALL')),
  CONSTRAINT rag_chunk_area_check CHECK (area IN ('laning', 'fight', 'macro', 'general')),
  CONSTRAINT rag_chunk_subject_check CHECK (subject <> ''),
  CONSTRAINT rag_chunk_polarity_check CHECK (polarity IN ('good', 'bad', 'any')),
  CONSTRAINT rag_chunk_champion_id_check CHECK (champion_id > 0),
  CONSTRAINT rag_chunk_champion_source_check CHECK (source <> 'champion' OR champion_id IS NOT NULL),
  CONSTRAINT rag_chunk_patch_check CHECK (patch ~ '^[0-9]+\.[0-9]+$'),
  CONSTRAINT rag_chunk_content_check CHECK (content <> ''),
  CONSTRAINT rag_chunk_content_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT rag_chunk_embedding_model_check CHECK (embedding_model <> '')
);

CREATE INDEX rag_chunk_area_role_idx ON rag_chunk (area, role);

COMMENT ON TABLE rag_chunk IS 'RAG 해석 문서 조각 1개 = 1줄 (문구 + 임베딩). 플레이어 성적 지표는 저장하지 않음. 쓰기는 백엔드 적재기(서비스 연결)만, 읽기는 search_rag_chunks';
COMMENT ON COLUMN rag_chunk.id IS '조각 ID (예: fight.damage.SUPPORT_DAMAGE.bad.01). 적재기가 정함';
COMMENT ON COLUMN rag_chunk.source IS '출처 종류. perspective | champion';
COMMENT ON COLUMN rag_chunk.position IS 'Riot teamPosition. TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY | ALL';
COMMENT ON COLUMN rag_chunk.role IS '엔진 유형 10개 또는 ALL. TOP_TANK | TOP_DAMAGE | JUNGLE_TANK | JUNGLE_DAMAGE | MID_TANK | MID_DAMAGE | ADC | SUPPORT_TANK | SUPPORT_DAMAGE | SUPPORT_UTILITY | ALL';
COMMENT ON COLUMN rag_chunk.area IS '영역. laning | fight | macro | general (general은 모든 영역 검색에 함께 나옴)';
COMMENT ON COLUMN rag_chunk.subject IS '엔진 과목 ID (예: fight.damage). NULL이면 과목 무관 (과목 필터를 걸어도 나옴)';
COMMENT ON COLUMN rag_chunk.polarity IS '방향. good | bad | any (any는 두 방향 모두에 나옴)';
COMMENT ON COLUMN rag_chunk.champion_id IS 'Riot championId. source = champion이면 NOT NULL, 그 챔피언 검색에만 나옴';
COMMENT ON COLUMN rag_chunk.patch IS '해당 패치 (예: 16.21). NULL이면 패치 무관';
COMMENT ON COLUMN rag_chunk.content IS '조각 본문 (LLM에 넘기는 문구)';
COMMENT ON COLUMN rag_chunk.content_hash IS 'content의 sha256 (소문자 16진수 64자). 바뀐 조각만 다시 임베딩';
COMMENT ON COLUMN rag_chunk.embedding IS '임베딩 벡터 1,024차원 (extensions.vector). 거리는 코사인(<=>)';
COMMENT ON COLUMN rag_chunk.embedding_model IS '임베딩 모델 이름 (예: voyage-4)';
COMMENT ON COLUMN rag_chunk.updated_at IS '마지막 적재 시각';

-- 3. RLS 켜기, 정책 없음, anon·authenticated 권한 회수 (004와 같음)
ALTER TABLE rag_chunk ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rag_chunk FROM anon, authenticated;

-- 4. 검색 함수
CREATE OR REPLACE FUNCTION search_rag_chunks(
  p_embedding   extensions.vector(1024),
  p_role        text,
  p_position    text,
  p_area        text,
  p_subjects    text[],
  p_polarity    text,
  p_champion_id int,
  p_limit       int
)
RETURNS TABLE (
  id       text,
  source   text,
  area     text,
  subject  text,
  polarity text,
  content  text,
  distance double precision
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path FROM CURRENT
AS $$
#variable_conflict use_column
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'search_rag_chunks: p_limit은 1~20이어야 합니다: %', coalesce(p_limit::text, 'NULL')
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT r.id, r.source, r.area, r.subject, r.polarity, r.content,
         (r.embedding OPERATOR(extensions.<=>) p_embedding)::double precision AS distance
  FROM rag_chunk r
  WHERE r.role IN (p_role, 'ALL')
    AND r.position IN (p_position, 'ALL')
    AND r.area IN (p_area, 'general')
    AND (p_subjects IS NULL OR r.subject = ANY (p_subjects) OR r.subject IS NULL)
    AND r.polarity IN (p_polarity, 'any')
    AND (r.source <> 'champion' OR r.champion_id = p_champion_id)
  ORDER BY r.embedding OPERATOR(extensions.<=>) p_embedding, r.id
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION search_rag_chunks(extensions.vector, text, text, text, text[], text, int, int) IS 'rag_chunk에서 필터(role IN (p_role, ALL), position IN (p_position, ALL), area IN (p_area, general), p_subjects가 NULL이 아니면 subject = ANY(p_subjects) 또는 subject NULL, polarity IN (p_polarity, any), champion 조각은 champion_id = p_champion_id일 때만)로 거른 뒤 코사인 거리(<=>) 오름차순(같으면 id 순) 상위 p_limit개. p_limit 1~20 (벗어나면 22023). 반환 (id, source, area, subject, polarity, content, distance)';

REVOKE EXECUTE ON FUNCTION search_rag_chunks(extensions.vector, text, text, text, text[], text, int, int) FROM PUBLIC, anon, authenticated;
