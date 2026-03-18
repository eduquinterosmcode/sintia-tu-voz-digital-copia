-- Migration: security_advisor_fixes
-- Resuelve 3 errores y 3 warnings reportados por Supabase Security Advisor.
-- Safe to run: todos los cambios son aditivos o recrean objetos sin cambiar semántica de negocio.

-- ─────────────────────────────────────────────────────────────────────────────
-- ERROR 1: Security Definer View — public.agent_profiles_public
-- La vista corría con permisos del owner (SECURITY DEFINER implícito).
-- Con security_invoker=true corre como el usuario llamante, respetando RLS.
-- Los Edge Functions usan service_role y siguen funcionando (bypasean RLS).
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.agent_profiles_public;
CREATE VIEW public.agent_profiles_public
WITH (security_invoker = true) AS
  SELECT id, sector_id, role, name, order_index, enabled, created_at
  FROM public.agent_profiles;

GRANT SELECT ON public.agent_profiles_public TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ERROR 2: RLS Disabled — public.ai_jobs
-- Tabla de uso exclusivo interno (service_role / postgres superuser).
-- Se habilita RLS sin políticas de usuario: acceso directo desde cliente queda
-- bloqueado por defecto. service_role y postgres superuser bypasean RLS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- ERROR 3: RLS Disabled — public.meeting_quality_reports
-- Tabla hija de meetings. Se habilita RLS con política SELECT para usuarios
-- autenticados del mismo org, siguiendo el patrón de las demás tablas hija.
-- Writes (INSERT/UPDATE) solo por Python worker vía postgres — sin política
-- de escritura para authenticated (service_role los maneja sin RLS).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.meeting_quality_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quality_reports_select_org"
  ON public.meeting_quality_reports
  FOR SELECT TO authenticated
  USING (public.user_has_org_access(public.meeting_org_id(meeting_id)));

-- ─────────────────────────────────────────────────────────────────────────────
-- WARNING 1b: Function Search Path Mutable — ai_jobs_set_updated_at
-- Función de trigger simple; no referencia tablas, solo opera sobre NEW.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_jobs_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- WARNING 1c: Function Search Path Mutable — quality_reports_set_updated_at
-- Idem: trigger simple sin referencias a tablas.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quality_reports_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- WARNING 1a: Function Search Path Mutable — match_meeting_segments
-- Requiere bloque de transacción explícito para poder usar SET LOCAL y que
-- el parse-time del DDL encuentre el tipo vector (pgvector) en public.
-- El operador <=> y el tipo vector están registrados en el schema public.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

SET LOCAL search_path TO public, extensions;

CREATE OR REPLACE FUNCTION public.match_meeting_segments(
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
SET search_path TO public, extensions
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
  FROM public.meeting_segments
  WHERE meeting_id    = p_meeting_id
    AND transcript_id = p_transcript_id
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

COMMIT;
