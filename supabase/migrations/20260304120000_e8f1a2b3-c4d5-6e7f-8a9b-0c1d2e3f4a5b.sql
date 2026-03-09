
-- ============================================================
-- Add view_config_json to sectors
--
-- Defines the tab/section structure the frontend uses to render
-- each sector's analysis_json. Keeping it in the DB means new
-- domains (medical, legal, construction…) require zero frontend
-- code changes — only new rows in sectors + agent_profiles.
--
-- Schema of view_config_json:
--   { "tabs": [ TabConfig, … ] }
--
-- TabConfig:
--   { "key": string, "label": string, "icon": string,
--     "sections": [ SectionConfig, … ] }
--
-- SectionConfig:
--   { "field": string,            -- key in analysis_json
--     "type": "text"              -- plain paragraph
--           | "string_list"       -- bulleted list of strings
--           | "items_list",       -- list of objects
--     "label": string?,           -- optional section heading
--     "item": ItemMapping? }      -- required when type = items_list
--
-- ItemMapping:
--   { "text":     string,         -- object field for main text (required)
--     "subtitle": string?,        -- secondary text field
--     "owner":    string?,        -- owner field (renders with 👤)
--     "date":     string?,        -- date field  (renders with 📅)
--     "badge":    string? }       -- badge field; value must be
--                                 --   "high" | "medium" | "low"
--                                 --   renderer maps to color automatically
-- ============================================================

ALTER TABLE public.sectors ADD COLUMN view_config_json jsonb;

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
-- Same coordinator output schema as building_admin for now.
-- When business gets domain-specific fields, only this row changes.
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
