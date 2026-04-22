-- Extend meetings.status check constraint to include intermediate processing states.
-- 'transcribing' and 'analyzing' were used in code but never added to the constraint,
-- causing silent failures in Deno (swallowed errors) and hard failures in the Python
-- handler (SQLAlchemy raises CheckViolationError).
ALTER TABLE meetings DROP CONSTRAINT meetings_status_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_status_check
  CHECK (status IN ('draft','uploaded','transcribing','transcribed','analyzing','analyzed','error'));
