-- Migration: search_meetings_rpc
-- RPC para búsqueda full-text entre reuniones (roadmap ítem 6).
-- Busca sobre meeting_segments.text_search (índice GIN existente, config spanish).
-- Devuelve un resultado por reunión: el segmento más relevante + snippet resaltado.
-- Llamada directamente desde el cliente con supabase.rpc().

CREATE OR REPLACE FUNCTION public.search_meetings(
  p_query  text,
  p_org_id uuid
)
RETURNS TABLE (
  meeting_id   uuid,
  title        text,
  created_at   timestamptz,
  status       text,
  sector_name  text,
  sector_key   text,
  snippet      text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT DISTINCT ON (ms.meeting_id)
    m.id           AS meeting_id,
    m.title,
    m.created_at,
    m.status,
    s.name         AS sector_name,
    s.key          AS sector_key,
    ts_headline(
      'spanish',
      ms.text,
      plainto_tsquery('spanish', p_query),
      'MaxWords=20, MinWords=10, ShortWord=3, HighlightAll=false, MaxFragments=1, StartSel=<b>, StopSel=</b>'
    )              AS snippet
  FROM meeting_segments ms
  JOIN meetings m ON m.id = ms.meeting_id
  JOIN sectors  s ON s.id = m.sector_id
  WHERE m.org_id = p_org_id
    AND public.user_has_org_access(p_org_id)
    AND ms.text_search @@ plainto_tsquery('spanish', p_query)
  ORDER BY
    ms.meeting_id,
    ts_rank(ms.text_search, plainto_tsquery('spanish', p_query)) DESC
  LIMIT 20;
$$;
