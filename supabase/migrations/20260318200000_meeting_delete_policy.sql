-- Migration: meeting_delete_policy
-- Permite a usuarios autenticados eliminar reuniones de su org
-- y los archivos de audio asociados en Storage.
-- Sin estas políticas, RLS deniega DELETE por defecto.

-- ── meetings ────────────────────────────────────────────────────────────────
-- Cualquier miembro del org puede eliminar reuniones de ese org.
-- El CASCADE en FKs elimina en cascada: meeting_audio, meeting_transcripts,
-- meeting_segments, meeting_analyses, chat_messages, usage_events,
-- agent_runs, meeting_quality_reports.
CREATE POLICY "meetings_delete_org"
  ON public.meetings
  FOR DELETE TO authenticated
  USING (public.user_has_org_access(org_id));

-- ── Storage: meeting-audio bucket ───────────────────────────────────────────
-- Permite eliminar objetos del bucket cuyo prefijo sea el org_id del usuario.
-- El path de los archivos sigue el patrón: {org_id}/{meeting_id}/{filename}
CREATE POLICY "storage_delete_org_audio"
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND public.user_has_org_access((split_part(name, '/', 1))::uuid)
  );
