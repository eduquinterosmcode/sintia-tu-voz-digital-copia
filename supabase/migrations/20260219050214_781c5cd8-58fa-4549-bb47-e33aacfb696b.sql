-- Fix #1: Strict org-scoped storage policies for meeting-audio bucket

-- Drop any existing broad policies
DROP POLICY IF EXISTS "audio_storage_read" ON storage.objects;
DROP POLICY IF EXISTS "audio_storage_upload" ON storage.objects;
DROP POLICY IF EXISTS "audio_storage_delete" ON storage.objects;
DROP POLICY IF EXISTS "audio_storage_read_scoped" ON storage.objects;
DROP POLICY IF EXISTS "audio_storage_insert_scoped" ON storage.objects;
DROP POLICY IF EXISTS "audio_storage_delete_scoped" ON storage.objects;
-- Also drop any other possible names
DROP POLICY IF EXISTS "Allow authenticated uploads to meeting-audio" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated reads from meeting-audio" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from meeting-audio" ON storage.objects;

-- READ: only if user has org access to the meeting that owns the audio
CREATE POLICY "audio_storage_read_scoped"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'meeting-audio'
  AND EXISTS (
    SELECT 1
    FROM public.meeting_audio ma
    JOIN public.meetings m ON m.id = ma.meeting_id
    WHERE ma.storage_path = storage.objects.name
      AND public.user_has_org_access(m.org_id)
  )
);

-- INSERT: only if first path segment is an org_id the user belongs to
CREATE POLICY "audio_storage_insert_scoped"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'meeting-audio'
  AND public.user_has_org_access( (split_part(name, '/', 1))::uuid )
);

-- DELETE: only if first path segment is an org_id the user belongs to
CREATE POLICY "audio_storage_delete_scoped"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'meeting-audio'
  AND public.user_has_org_access( (split_part(name, '/', 1))::uuid )
);