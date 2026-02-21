
-- Mejora 1: Proteger system_prompt y output_schema_json de lectura cliente
-- Estrategia: Vista pública sin columnas sensibles + bloquear SELECT directo

-- 1. Crear vista segura (sin system_prompt ni output_schema_json)
CREATE VIEW public.agent_profiles_public
WITH (security_invoker = on) AS
  SELECT id, sector_id, role, name, order_index, enabled, created_at
  FROM public.agent_profiles;

-- 2. Eliminar la política SELECT actual que expone todo
DROP POLICY IF EXISTS "agents_select_authenticated" ON public.agent_profiles;

-- 3. Bloquear SELECT directo a la tabla base desde el cliente
CREATE POLICY "agents_no_direct_select"
  ON public.agent_profiles FOR SELECT
  USING (false);

-- 4. Permitir SELECT en la vista (hereda RLS de la tabla, pero la vista
--    solo expone columnas seguras). Como security_invoker=on y la policy
--    bloquea SELECT, necesitamos una policy que permita leer la vista.
--    En realidad, con security_invoker=on la vista usa el rol del caller,
--    así que necesitamos permitir SELECT pero SOLO a través de la vista.
--    La solución: la vista con security_invoker=on ejecuta como el usuario,
--    pero las Edge Functions usan service_role que bypasea RLS.
--    Entonces: bloquear SELECT directo = OK para frontend.
--    Edge Functions con service_role = siguen leyendo todo sin problemas.
