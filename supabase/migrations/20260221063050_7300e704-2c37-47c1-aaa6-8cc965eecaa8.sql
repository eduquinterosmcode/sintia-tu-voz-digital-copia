
-- Recrear la vista SIN security_invoker para que se ejecute con permisos del owner (bypassa RLS)
-- Esto es seguro porque la vista ya excluye system_prompt y output_schema_json
DROP VIEW IF EXISTS public.agent_profiles_public;
CREATE VIEW public.agent_profiles_public AS
  SELECT id, sector_id, role, name, order_index, enabled, created_at
  FROM public.agent_profiles;

-- Dar acceso de lectura a usuarios autenticados
GRANT SELECT ON public.agent_profiles_public TO authenticated;
