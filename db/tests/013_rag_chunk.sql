-- 013: rag_chunk + search_rag_chunks (db_spec 변경 05, 계약 v9). 항상 ROLLBACK.
--   1. 컬럼·타입·NULL 허용·기본값, CHECK 이름, 인덱스 (B-tree (area, role) 1개 + PK, 벡터 인덱스 없음)
--   2. RLS 켜짐·정책 0, anon·authenticated 테이블·함수 권한 없음 + 실제 SET ROLE로 조회·실행 거부 (public 42501)
--   3. CHECK 위반 (허용 값, champion 조각의 champion_id, 해시·패치 형식, 차원 수)
--   4. 검색 필터·거리 순 정렬·p_limit 오류
--   5. 가짜 1,000행 검색 시간과 테이블 크기 기록
-- 테스트용 벡터: v(θ) = [cos θ, sin θ, 0, …] (1,024차원). 질의 v(0)과의 코사인 거리 = 1 - cos θ.
-- 실제 조각과 섞이지 않게 처음에 rag_chunk를 비운다 (트랜잭션 안이라 ROLLBACK된다).

CREATE FUNCTION pg_temp.tv(t double precision) RETURNS extensions.vector
LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY[cos(t), sin(t)] || array_fill(0::double precision, ARRAY[1022]))::real[]::extensions.vector
$$;

DO $$
DECLARE
  v_schema text := current_schema();
  v_cols text;
  v_expected_cols text;
  v_checks text;
  v_n int;
  v_ids text;
  v_dist double precision;
  role_name text;
  v_bad record;
  v_t0 timestamptz;
  v_ms numeric;
  v_plan json;
  v_size text;
  v_toast text;
BEGIN
  DELETE FROM rag_chunk WHERE true;

  -- 1. 구조 --------------------------------------------------------------
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                    || CASE WHEN a.attnotnull THEN ' NN' ELSE '' END
                    || coalesce(' D=' || pg_get_expr(d.adbin, d.adrelid), ''), ', ' ORDER BY a.attnum)
  INTO v_cols
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'rag_chunk'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  v_expected_cols := 'id text NN, source text NN, position text NN, role text NN, area text NN, subject text, '
    || 'polarity text NN, champion_id integer, patch text, content text NN, content_hash text NN, '
    || 'embedding extensions.vector(1024) NN, embedding_model text NN, updated_at timestamp with time zone NN D=now()';
  IF v_cols IS DISTINCT FROM v_expected_cols THEN
    RAISE EXCEPTION '컬럼 불일치: %', v_cols;
  END IF;

  SELECT string_agg(conname, ',' ORDER BY conname) INTO v_checks
  FROM pg_constraint WHERE conrelid = 'rag_chunk'::regclass AND contype = 'c';
  IF v_checks IS DISTINCT FROM 'rag_chunk_area_check,rag_chunk_champion_id_check,rag_chunk_champion_source_check,'
     || 'rag_chunk_content_check,rag_chunk_content_hash_check,rag_chunk_embedding_model_check,rag_chunk_id_check,'
     || 'rag_chunk_patch_check,rag_chunk_polarity_check,rag_chunk_position_check,rag_chunk_role_check,'
     || 'rag_chunk_source_check,rag_chunk_subject_check' THEN
    RAISE EXCEPTION 'CHECK 목록 불일치: %', v_checks;
  END IF;
  IF (SELECT string_agg(a.attname, ',') FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = 'rag_chunk'::regclass AND c.contype = 'p') IS DISTINCT FROM 'id' THEN
    RAISE EXCEPTION 'PK가 (id)가 아님';
  END IF;

  SELECT count(*) INTO v_n FROM pg_indexes WHERE schemaname = v_schema AND tablename = 'rag_chunk';
  IF v_n <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = v_schema AND indexname = 'rag_chunk_area_role_idx'
                      AND indexdef LIKE '%USING btree (area, role)')
     OR EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = v_schema AND tablename = 'rag_chunk'
                  AND (indexdef ILIKE '%hnsw%' OR indexdef ILIKE '%ivfflat%')) THEN
    RAISE EXCEPTION '인덱스 불일치 (기대: rag_chunk_pkey + rag_chunk_area_role_idx btree (area, role), 벡터 인덱스 없음)';
  END IF;
  IF (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector')
     IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION 'vector 확장이 extensions 스키마에 없음';
  END IF;
  RAISE NOTICE '[통과] 구조: 컬럼 14개·타입·NOT NULL·기본값, CHECK 13개, PK (id), 인덱스 pkey + (area, role) btree, 벡터 인덱스 없음, vector 확장 % (extensions)',
    (SELECT extversion FROM pg_extension WHERE extname = 'vector');

  -- 2. 보안 --------------------------------------------------------------
  IF NOT (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid = 'rag_chunk'::regclass) THEN
    RAISE EXCEPTION 'RLS 설정 오류';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'rag_chunk'::regclass) THEN
    RAISE EXCEPTION '정책이 있음';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      RAISE NOTICE '[건너뜀] 역할 % 없음', role_name;
      CONTINUE;
    END IF;
    IF has_table_privilege(role_name, 'rag_chunk', 'SELECT') OR has_table_privilege(role_name, 'rag_chunk', 'INSERT')
       OR has_table_privilege(role_name, 'rag_chunk', 'UPDATE') OR has_table_privilege(role_name, 'rag_chunk', 'DELETE')
       OR has_function_privilege(role_name,
            'search_rag_chunks(extensions.vector, text, text, text, text[], text, int, int)', 'EXECUTE') THEN
      RAISE EXCEPTION '% 가 rag_chunk 또는 search_rag_chunks 권한을 가짐', role_name;
    END IF;
    -- 실제로 그 역할이 되어 시도 (하위 트랜잭션이 끝나면 역할도 되돌아감)
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', role_name);
      PERFORM count(*) FROM rag_chunk;
      RAISE EXCEPTION '% 가 rag_chunk를 조회함', role_name;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;
      -- 임시 스키마(fresh)는 anon에게 스키마 USAGE가 없어 42P01로 먼저 막힌다. public에서는 42501이어야 한다
      WHEN undefined_table THEN IF v_schema = 'public' THEN RAISE; END IF;
    END;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', role_name);
      PERFORM * FROM search_rag_chunks(pg_temp.tv(0), 'ALL', 'ALL', 'general', NULL, 'any', NULL, 5);
      RAISE EXCEPTION '% 가 search_rag_chunks를 실행함', role_name;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;
      WHEN undefined_function THEN IF v_schema = 'public' THEN RAISE; END IF;
    END;
    IF current_user <> session_user THEN RAISE EXCEPTION '역할이 되돌아오지 않음: %', current_user; END IF;
  END LOOP;
  RAISE NOTICE '[통과] 보안: RLS 켜짐·FORCE 아님·정책 0, anon·authenticated 권한 없음, SET ROLE 조회·실행 모두 거부 (public은 42501, 임시 스키마는 스키마 USAGE 없음)';

  -- 3. CHECK 위반 ---------------------------------------------------------
  FOR v_bad IN
    SELECT * FROM (VALUES
      ('source item',          'x1', 'item',        'ALL',  'ALL',      'general', NULL::text, 'any',     NULL::int, NULL::text, repeat('a', 64), '23514'),
      ('position MID',         'x2', 'perspective', 'MID',  'ALL',      'general', NULL,       'any',     NULL,      NULL,       repeat('a', 64), '23514'),
      ('role MID_LANE',        'x3', 'perspective', 'ALL',  'MID_LANE', 'general', NULL,       'any',     NULL,      NULL,       repeat('a', 64), '23514'),
      ('area vision',          'x4', 'perspective', 'ALL',  'ALL',      'vision',  NULL,       'any',     NULL,      NULL,       repeat('a', 64), '23514'),
      ('polarity neutral',     'x5', 'perspective', 'ALL',  'ALL',      'general', NULL,       'neutral', NULL,      NULL,       repeat('a', 64), '23514'),
      ('champion id NULL',     'x6', 'champion',    'ALL',  'ALL',      'general', NULL,       'any',     NULL,      NULL,       repeat('a', 64), '23514'),
      ('champion_id 0',        'x7', 'champion',    'ALL',  'ALL',      'general', NULL,       'any',     0,         NULL,       repeat('a', 64), '23514'),
      ('hash 대문자',          'x8', 'perspective', 'ALL',  'ALL',      'general', NULL,       'any',     NULL,      NULL,       repeat('A', 64), '23514'),
      ('hash 63자',            'x9', 'perspective', 'ALL',  'ALL',      'general', NULL,       'any',     NULL,      NULL,       repeat('a', 63), '23514'),
      ('patch 16',             'xa', 'perspective', 'ALL',  'ALL',      'general', NULL,       'any',     NULL,      '16',       repeat('a', 64), '23514'),
      ('subject 빈 문자열',    'xb', 'perspective', 'ALL',  'ALL',      'general', '',         'any',     NULL,      NULL,       repeat('a', 64), '23514'),
      ('id 빈 문자열',         '',   'perspective', 'ALL',  'ALL',      'general', NULL,       'any',     NULL,      NULL,       repeat('a', 64), '23514')
    ) AS t(label, id, source, position, role, area, subject, polarity, champion_id, patch, content_hash, code)
  LOOP
    BEGIN
      INSERT INTO rag_chunk (id, source, position, role, area, subject, polarity, champion_id, patch, content,
                             content_hash, embedding, embedding_model)
      VALUES (v_bad.id, v_bad.source, v_bad.position, v_bad.role, v_bad.area, v_bad.subject, v_bad.polarity,
              v_bad.champion_id, v_bad.patch, 'c', v_bad.content_hash, pg_temp.tv(0), 'voyage-4');
      RAISE EXCEPTION 'CHECK 위반이 허용됨: %', v_bad.label;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  -- 차원 수 3 → 오류 (pgvector: expected 1024 dimensions)
  BEGIN
    INSERT INTO rag_chunk (id, source, position, role, area, polarity, content, content_hash, embedding, embedding_model)
    VALUES ('xd', 'perspective', 'ALL', 'ALL', 'general', 'any', 'c', repeat('a', 64), '[1,0,0]', 'voyage-4');
    RAISE EXCEPTION '3차원 벡터가 허용됨';
  EXCEPTION WHEN data_exception THEN NULL;
  END;
  BEGIN
    INSERT INTO rag_chunk (id, source, position, role, area, polarity, content, content_hash, embedding_model)
    VALUES ('xe', 'perspective', 'ALL', 'ALL', 'general', 'any', 'c', repeat('a', 64), 'voyage-4');
    RAISE EXCEPTION 'embedding NULL이 허용됨';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  -- 정상 경계값: champion 조각 + champion_id, patch 16.21, 소문자 64자 해시
  INSERT INTO rag_chunk (id, source, position, role, area, subject, polarity, champion_id, patch, content,
                         content_hash, embedding, embedding_model)
  VALUES ('ok', 'champion', 'UTILITY', 'SUPPORT_UTILITY', 'macro', 'macro.vision', 'good', 16, '16.21', 'c',
          encode(sha256('c'::bytea), 'hex'), pg_temp.tv(0), 'voyage-4');
  DELETE FROM rag_chunk WHERE id = 'ok';
  RAISE NOTICE '[통과] CHECK: 허용 값 밖 12건 → 23514, 3차원 → 22000 계열, embedding NULL → 23502, 정상 경계값 1건 저장';

  -- 4. 검색 필터 ---------------------------------------------------------
  -- 질의: SUPPORT_DAMAGE / UTILITY / fight / {fight.damage} / bad / 챔피언 43
  INSERT INTO rag_chunk (id, source, position, role, area, subject, polarity, champion_id, content, content_hash,
                         embedding, embedding_model)
  SELECT t.id, t.source, t.position, t.role, t.area, t.subject, t.polarity, t.champion_id, 'c', repeat('a', 64),
         pg_temp.tv(t.theta), 'voyage-4'
  FROM (VALUES
    ('a01', 'perspective', 'UTILITY', 'SUPPORT_DAMAGE', 'fight',   'fight.damage', 'bad',  NULL::int, 0.10), -- 나옴
    ('a02', 'perspective', 'ALL',     'ALL',            'general', NULL,           'any',  NULL,      0.20), -- 나옴 (ALL·general·과목 NULL·any)
    ('a03', 'perspective', 'UTILITY', 'SUPPORT_DAMAGE', 'fight',   'fight.vision', 'bad',  NULL,      0.05), -- 과목 다름
    ('a04', 'perspective', 'UTILITY', 'SUPPORT_TANK',   'fight',   'fight.damage', 'bad',  NULL,      0.01), -- 유형 다름
    ('a05', 'perspective', 'BOTTOM',  'SUPPORT_DAMAGE', 'fight',   'fight.damage', 'bad',  NULL,      0.02), -- 포지션 다름
    ('a06', 'perspective', 'UTILITY', 'SUPPORT_DAMAGE', 'laning',  'fight.damage', 'bad',  NULL,      0.03), -- 영역 다름
    ('a07', 'perspective', 'UTILITY', 'SUPPORT_DAMAGE', 'fight',   'fight.damage', 'good', NULL,      0.04), -- 방향 다름
    ('a08', 'champion',    'UTILITY', 'SUPPORT_DAMAGE', 'fight',   'fight.damage', 'bad',  43,        0.30), -- 나옴 (같은 챔피언)
    ('a09', 'champion',    'UTILITY', 'SUPPORT_DAMAGE', 'fight',   'fight.damage', 'bad',  99,        0.00), -- 다른 챔피언
    ('a10', 'perspective', 'ALL',     'ALL',            'macro',   NULL,           'any',  NULL,      0.06), -- 영역 다름
    ('a11', 'perspective', 'UTILITY', 'ALL',            'fight',   NULL,           'bad',  NULL,      0.40), -- 나옴 (유형 ALL·과목 NULL)
    ('a12', 'perspective', 'ALL',     'SUPPORT_DAMAGE', 'fight',   'fight.damage', 'any',  NULL,      0.50)  -- 나옴 (포지션 ALL·any)
  ) AS t(id, source, position, role, area, subject, polarity, champion_id, theta);

  SELECT string_agg(s.id, ',' ORDER BY ord) INTO v_ids
  FROM search_rag_chunks(pg_temp.tv(0), 'SUPPORT_DAMAGE', 'UTILITY', 'fight', ARRAY['fight.damage'], 'bad', 43, 20)
       WITH ORDINALITY AS s(id, source, area, subject, polarity, content, distance, ord);
  IF v_ids IS DISTINCT FROM 'a01,a02,a08,a11,a12' THEN RAISE EXCEPTION '기본 필터 결과 %', v_ids; END IF;

  -- 거리 값과 오름차순
  SELECT s.distance INTO v_dist
  FROM search_rag_chunks(pg_temp.tv(0), 'SUPPORT_DAMAGE', 'UTILITY', 'fight', ARRAY['fight.damage'], 'bad', 43, 1) s;
  IF abs(v_dist - (1 - cos(0.10))) > 1e-5 THEN RAISE EXCEPTION 'a01 거리 % <> %', v_dist, 1 - cos(0.10); END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT s.distance, lag(s.distance) OVER (ORDER BY ord) AS prev
      FROM search_rag_chunks(pg_temp.tv(0), 'SUPPORT_DAMAGE', 'UTILITY', 'fight', ARRAY['fight.damage'], 'bad', 43, 20)
           WITH ORDINALITY AS s(id, source, area, subject, polarity, content, distance, ord)
    ) x WHERE x.distance < x.prev) THEN
    RAISE EXCEPTION '거리 오름차순이 아님';
  END IF;

  -- p_subjects NULL → 과목 필터 없음 (a03 추가, 가장 가까움)
  SELECT string_agg(s.id, ',' ORDER BY ord) INTO v_ids
  FROM search_rag_chunks(pg_temp.tv(0), 'SUPPORT_DAMAGE', 'UTILITY', 'fight', NULL, 'bad', 43, 20)
       WITH ORDINALITY AS s(id, source, area, subject, polarity, content, distance, ord);
  IF v_ids IS DISTINCT FROM 'a03,a01,a02,a08,a11,a12' THEN RAISE EXCEPTION 'p_subjects NULL 결과 %', v_ids; END IF;

  -- 여러 과목
  SELECT string_agg(s.id, ',' ORDER BY ord) INTO v_ids
  FROM search_rag_chunks(pg_temp.tv(0), 'SUPPORT_DAMAGE', 'UTILITY', 'fight', ARRAY['fight.damage', 'fight.vision'], 'bad', 43, 20)
       WITH ORDINALITY AS s(id, source, area, subject, polarity, content, distance, ord);
  IF v_ids IS DISTINCT FROM 'a03,a01,a02,a08,a11,a12' THEN RAISE EXCEPTION '과목 2개 결과 %', v_ids; END IF;

  -- p_champion_id NULL → 챔피언 조각 없음 / 99 → a09만
  SELECT string_agg(s.id, ',' ORDER BY ord) INTO v_ids
  FROM search_rag_chunks(pg_temp.tv(0), 'SUPPORT_DAMAGE', 'UTILITY', 'fight', ARRAY['fight.damage'], 'bad', NULL, 20)
       WITH ORDINALITY AS s(id, source, area, subject, polarity, content, distance, ord);
  IF v_ids IS DISTINCT FROM 'a01,a02,a11,a12' THEN RAISE EXCEPTION 'p_champion_id NULL 결과 %', v_ids; END IF;
  SELECT string_agg(s.id, ',' ORDER BY ord) INTO v_ids
  FROM search_rag_chunks(pg_temp.tv(0), 'SUPPORT_DAMAGE', 'UTILITY', 'fight', ARRAY['fight.damage'], 'bad', 99, 20)
       WITH ORDINALITY AS s(id, source, area, subject, polarity, content, distance, ord);
  IF v_ids IS DISTINCT FROM 'a09,a01,a02,a11,a12' THEN RAISE EXCEPTION 'p_champion_id 99 결과 %', v_ids; END IF;

  -- polarity good → a07(good)과 any 조각
  SELECT string_agg(s.id, ',' ORDER BY ord) INTO v_ids
  FROM search_rag_chunks(pg_temp.tv(0), 'SUPPORT_DAMAGE', 'UTILITY', 'fight', ARRAY['fight.damage'], 'good', 43, 20)
       WITH ORDINALITY AS s(id, source, area, subject, polarity, content, distance, ord);
  IF v_ids IS DISTINCT FROM 'a07,a02,a12' THEN RAISE EXCEPTION 'polarity good 결과 %', v_ids; END IF;

  -- 영역 general 질의 → general 조각만 (macro 아님)
  SELECT string_agg(s.id, ',' ORDER BY ord) INTO v_ids
  FROM search_rag_chunks(pg_temp.tv(0), 'TOP_TANK', 'TOP', 'general', NULL, 'any', NULL, 20)
       WITH ORDINALITY AS s(id, source, area, subject, polarity, content, distance, ord);
  IF v_ids IS DISTINCT FROM 'a02' THEN RAISE EXCEPTION 'general 질의 결과 %', v_ids; END IF;

  -- p_limit 2
  SELECT string_agg(s.id, ',' ORDER BY ord) INTO v_ids
  FROM search_rag_chunks(pg_temp.tv(0), 'SUPPORT_DAMAGE', 'UTILITY', 'fight', ARRAY['fight.damage'], 'bad', 43, 2)
       WITH ORDINALITY AS s(id, source, area, subject, polarity, content, distance, ord);
  IF v_ids IS DISTINCT FROM 'a01,a02' THEN RAISE EXCEPTION 'p_limit 2 결과 %', v_ids; END IF;

  -- p_limit 범위 오류 (0, 21, NULL) → 22023
  BEGIN
    PERFORM * FROM search_rag_chunks(pg_temp.tv(0), 'ALL', 'ALL', 'general', NULL, 'any', NULL, 0);
    RAISE EXCEPTION 'p_limit 0 허용됨';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM * FROM search_rag_chunks(pg_temp.tv(0), 'ALL', 'ALL', 'general', NULL, 'any', NULL, 21);
    RAISE EXCEPTION 'p_limit 21 허용됨';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM * FROM search_rag_chunks(pg_temp.tv(0), 'ALL', 'ALL', 'general', NULL, 'any', NULL, NULL);
    RAISE EXCEPTION 'p_limit NULL 허용됨';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM * FROM search_rag_chunks(pg_temp.tv(0), 'ALL', 'ALL', 'general', NULL, 'any', NULL, 1);
  PERFORM * FROM search_rag_chunks(pg_temp.tv(0), 'ALL', 'ALL', 'general', NULL, 'any', NULL, 20);
  RAISE NOTICE '[통과] 검색: 기본 필터 a01,a02,a08,a11,a12 (거리 순, a01 거리 = 1 - cos 0.1), 과목 NULL·2개, 챔피언 NULL·99, 방향 good, 영역 general, p_limit 2, p_limit 0·21·NULL → 22023, 1·20 허용';

  -- 5. 가짜 1,000행 시간·크기 -------------------------------------------
  DELETE FROM rag_chunk WHERE true;
  INSERT INTO rag_chunk (id, source, position, role, area, subject, polarity, champion_id, content, content_hash,
                         embedding, embedding_model)
  SELECT 'perf.' || g,
         CASE WHEN g % 5 = 0 THEN 'champion' ELSE 'perspective' END,
         (ARRAY['TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY','ALL'])[1 + g % 6],
         (ARRAY['TOP_TANK','TOP_DAMAGE','JUNGLE_TANK','JUNGLE_DAMAGE','MID_TANK','MID_DAMAGE','ADC',
                'SUPPORT_TANK','SUPPORT_DAMAGE','SUPPORT_UTILITY','ALL','ALL','ALL'])[1 + g % 13],
         (ARRAY['laning','fight','macro','general'])[1 + g % 4],
         CASE WHEN g % 3 = 0 THEN NULL ELSE 'fight.s' || (g % 7) END,
         (ARRAY['good','bad','any'])[1 + g % 3],
         CASE WHEN g % 5 = 0 THEN 1 + g % 20 END,
         repeat('해석 문서 조각 본문 ', 25),
         encode(sha256(('perf.' || g)::bytea), 'hex'),
         (SELECT array_agg(random() - 0.5) FROM generate_series(1, 1024) AS d WHERE g > 0)::real[]::extensions.vector,
         'voyage-4'
  FROM generate_series(1, 1000) AS g;
  ANALYZE rag_chunk;

  -- 일반 질의 (필터 있음) 50번 평균
  v_t0 := clock_timestamp();
  FOR v_n IN 1..50 LOOP
    PERFORM * FROM search_rag_chunks(pg_temp.tv(v_n * 0.01), 'SUPPORT_DAMAGE', 'UTILITY', 'fight',
                                     ARRAY['fight.s1', 'fight.s2'], 'bad', 5, 8);
  END LOOP;
  v_ms := extract(epoch FROM clock_timestamp() - v_t0) * 1000 / 50;
  RAISE NOTICE '[기록] 1,000행, 필터 질의 search_rag_chunks 50회 평균 % ms (결과 %줄)', round(v_ms, 2),
    (SELECT count(*) FROM search_rag_chunks(pg_temp.tv(0.5), 'SUPPORT_DAMAGE', 'UTILITY', 'fight',
                                            ARRAY['fight.s1', 'fight.s2'], 'bad', 5, 8));

  -- 가장 무거운 경우: 필터 없이 1,000행 전부 거리 계산 (함수 본문과 같은 정렬) EXPLAIN ANALYZE
  EXECUTE $q$EXPLAIN (ANALYZE, FORMAT JSON)
    SELECT r.id, r.embedding OPERATOR(extensions.<=>) pg_temp.tv(0.3) AS distance
    FROM rag_chunk r ORDER BY 2, r.id LIMIT 20$q$ INTO v_plan;
  RAISE NOTICE '[기록] 1,000행 전체 거리 정렬 상위 20 (필터 없음) 실행 % ms, 계획 %',
    v_plan -> 0 ->> 'Execution Time', v_plan -> 0 -> 'Plan' -> 'Plans' -> 0 ->> 'Node Type';

  SELECT pg_size_pretty(pg_total_relation_size('rag_chunk')),
         pg_size_pretty(pg_relation_size((SELECT reltoastrelid FROM pg_class WHERE oid = 'rag_chunk'::regclass)))
  INTO v_size, v_toast;
  RAISE NOTICE '[기록] 1,000행 (본문 약 275자) 테이블 전체 크기 % (TOAST %)', v_size, v_toast;
END $$;
