-- Embeddings semánticos para RAG en el chat
-- model: text-embedding-3-small (1536 dimensiones, OpenAI)
--
-- Estrategia de búsqueda en agent-orchestrator (3 niveles):
--   1. Vector similarity (coseno) via match_meeting_segments() — si hay embeddings
--   2. Full-text search (tsvector, config spanish) — fallback para segmentos sin embedding
--   3. Cronológico — último fallback universal
--
-- Los embeddings se generan en stt-transcribe al crear los segmentos.
-- La columna es nullable: reuniones anteriores tendrán NULL hasta que se re-trascriban.

ALTER TABLE meeting_segments
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW index para búsqueda por similitud coseno (pgvector 0.5.0+)
-- Ignora NULLs automáticamente.
CREATE INDEX IF NOT EXISTS meeting_segments_embedding_idx
  ON meeting_segments USING hnsw (embedding vector_cosine_ops);

-- ── RPC function ─────────────────────────────────────────────────────────────
-- Devuelve segmentos ordenados por similitud coseno al query embedding.
-- Llamada desde el Edge Function agent-orchestrator con supabase.rpc().
-- SECURITY DEFINER para que funcione aunque se llame con anon key.

CREATE OR REPLACE FUNCTION match_meeting_segments(
  p_meeting_id      uuid,
  p_transcript_id   uuid,
  p_query_embedding vector(1536),
  p_match_count     int     DEFAULT 20,
  p_min_similarity  float8  DEFAULT 0.3
)
RETURNS TABLE (
  id            uuid,
  segment_index int,
  speaker_label text,
  speaker_name  text,
  t_start_sec   float8,
  t_end_sec     float8,
  text          text,
  similarity    float8
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    id,
    segment_index,
    speaker_label,
    speaker_name,
    t_start_sec,
    t_end_sec,
    text,
    1 - (embedding <=> p_query_embedding) AS similarity
  FROM meeting_segments
  WHERE meeting_id   = p_meeting_id
    AND transcript_id = p_transcript_id
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;
