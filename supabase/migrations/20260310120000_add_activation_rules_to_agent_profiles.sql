-- Fase 5: activation_rules en agent_profiles
-- Permite configurar condiciones de activación por especialista desde la DB,
-- sin cambios de código para agregar nuevos dominios profesionales.
--
-- Modos soportados:
--   { "mode": "always" }                                        → siempre corre (default cuando es null)
--   { "mode": "keyword", "keywords": ["X"], "min_matches": 1 } → solo si el transcript contiene N keywords
--   { "mode": "segment_count", "min_segments": 20 }            → solo si la reunión tiene >= N segmentos
--
-- Backward-compatible: columna null = siempre activar (igual a "always").

ALTER TABLE agent_profiles
  ADD COLUMN IF NOT EXISTS activation_rules JSONB DEFAULT NULL;

COMMENT ON COLUMN agent_profiles.activation_rules IS
  'Condiciones de activación del especialista. null o mode=always: siempre corre. '
  'mode=keyword: corre si el transcript contiene min_matches de los keywords. '
  'mode=segment_count: corre si la reunión tiene al menos min_segments segmentos.';

-- Ejemplo: para agregar un especialista de riesgos legales que solo corra
-- cuando se mencionen contratos o presupuestos:
--
-- UPDATE agent_profiles
-- SET activation_rules = '{"mode": "keyword", "keywords": ["contrato", "presupuesto", "garantía"], "min_matches": 1}'
-- WHERE name = 'Especialista Legal' AND sector_id = '<uuid>';
