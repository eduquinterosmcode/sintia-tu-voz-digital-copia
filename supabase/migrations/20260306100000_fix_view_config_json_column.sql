-- Fix: view_config_json column was tracked as applied but SQL never executed.
-- Using IF NOT EXISTS to make this idempotent.

ALTER TABLE public.sectors ADD COLUMN IF NOT EXISTS view_config_json jsonb;

-- ── building_admin ───────────────────────────────────────────
UPDATE public.sectors
SET view_config_json = '{
  "tabs": [
    {
      "key": "summary",
      "label": "Resumen",
      "icon": "FileText",
      "sections": [
        { "field": "summary",          "type": "text" },
        { "field": "key_points",       "type": "items_list",   "label": "Puntos clave",
          "item": { "text": "point" } },
        { "field": "open_questions",   "type": "string_list",  "label": "Preguntas abiertas" },
        { "field": "confidence_notes", "type": "string_list",  "label": "Notas de confianza" }
      ]
    },
    {
      "key": "decisions",
      "label": "Decisiones",
      "icon": "CheckSquare",
      "sections": [
        { "field": "decisions", "type": "items_list",
          "item": { "text": "decision", "owner": "owner" } }
      ]
    },
    {
      "key": "actions",
      "label": "Acciones",
      "icon": "ListChecks",
      "sections": [
        { "field": "action_items", "type": "items_list",
          "item": { "text": "task", "owner": "owner", "date": "due_date", "badge": "priority" } }
      ]
    },
    {
      "key": "risks",
      "label": "Riesgos",
      "icon": "AlertTriangle",
      "sections": [
        { "field": "risks_alerts", "type": "items_list",
          "item": { "text": "risk", "subtitle": "mitigation", "badge": "severity" } }
      ]
    },
    {
      "key": "responses",
      "label": "Respuestas",
      "icon": "MessageSquare",
      "sections": [
        { "field": "suggested_responses", "type": "items_list",
          "item": { "text": "message", "subtitle": "context" } }
      ]
    }
  ]
}'::jsonb
WHERE key = 'building_admin';

-- ── business ─────────────────────────────────────────────────
UPDATE public.sectors
SET view_config_json = '{
  "tabs": [
    {
      "key": "summary",
      "label": "Resumen",
      "icon": "FileText",
      "sections": [
        { "field": "summary",          "type": "text" },
        { "field": "key_points",       "type": "items_list",   "label": "Puntos clave",
          "item": { "text": "point" } },
        { "field": "open_questions",   "type": "string_list",  "label": "Preguntas abiertas" },
        { "field": "confidence_notes", "type": "string_list",  "label": "Notas de confianza" }
      ]
    },
    {
      "key": "decisions",
      "label": "Decisiones",
      "icon": "CheckSquare",
      "sections": [
        { "field": "decisions", "type": "items_list",
          "item": { "text": "decision", "owner": "owner" } }
      ]
    },
    {
      "key": "actions",
      "label": "Acciones",
      "icon": "ListChecks",
      "sections": [
        { "field": "action_items", "type": "items_list",
          "item": { "text": "task", "owner": "owner", "date": "due_date", "badge": "priority" } }
      ]
    },
    {
      "key": "risks",
      "label": "Riesgos",
      "icon": "AlertTriangle",
      "sections": [
        { "field": "risks_alerts", "type": "items_list",
          "item": { "text": "risk", "subtitle": "mitigation", "badge": "severity" } }
      ]
    },
    {
      "key": "responses",
      "label": "Respuestas",
      "icon": "MessageSquare",
      "sections": [
        { "field": "suggested_responses", "type": "items_list",
          "item": { "text": "message", "subtitle": "context" } }
      ]
    }
  ]
}'::jsonb
WHERE key = 'business';
