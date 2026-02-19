-- Fix agent_profiles: restrict SELECT to authenticated users only
DROP POLICY IF EXISTS "agents_select" ON public.agent_profiles;

CREATE POLICY "agents_select_authenticated"
ON public.agent_profiles
FOR SELECT
TO authenticated
USING (true);
