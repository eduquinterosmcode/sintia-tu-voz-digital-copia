
-- Fix: replace the permissive org_create policy with a restrictive one
DROP POLICY IF EXISTS "org_create" ON public.organizations;
CREATE POLICY "org_create" ON public.organizations FOR INSERT TO authenticated WITH CHECK (false);
