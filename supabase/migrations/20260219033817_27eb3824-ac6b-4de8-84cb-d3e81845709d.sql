
-- ============================================================
-- SintIA MVP: Full Database Schema (fixed ordering)
-- ============================================================

-- 1) HELPER: updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 2) ORGANIZATIONS
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 3) ORG_MEMBERS
CREATE TABLE public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','member')) DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

-- 4) SECURITY DEFINER: check org membership
CREATE OR REPLACE FUNCTION public.user_has_org_access(_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = _org_id AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.user_is_org_owner(_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = _org_id AND user_id = auth.uid() AND role = 'owner'
  )
$$;

-- 5) SECTORS
CREATE TABLE public.sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;

-- 6) MEETINGS (must exist before meeting_org_id function)
CREATE TABLE public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  sector_id uuid NOT NULL REFERENCES public.sectors(id),
  title text NOT NULL,
  notes text,
  language text NOT NULL DEFAULT 'es-CL',
  status text NOT NULL CHECK (status IN ('draft','uploaded','transcribed','analyzed','error')) DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

-- NOW create the helper that references meetings
CREATE OR REPLACE FUNCTION public.meeting_org_id(_meeting_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT org_id FROM public.meetings WHERE id = _meeting_id
$$;

-- 7) MEETING_AUDIO
CREATE TABLE public.meeting_audio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime_type text,
  duration_sec int,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_audio ENABLE ROW LEVEL SECURITY;

-- 8) MEETING_TRANSCRIPTS
CREATE TABLE public.meeting_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  provider text,
  stt_model text,
  transcript_text text,
  diarization_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.meeting_transcripts ENABLE ROW LEVEL SECURITY;

-- 9) MEETING_SEGMENTS
CREATE TABLE public.meeting_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  transcript_id uuid NOT NULL REFERENCES public.meeting_transcripts(id) ON DELETE CASCADE,
  segment_index int NOT NULL,
  speaker_label text NOT NULL,
  speaker_name text,
  t_start_sec numeric NOT NULL,
  t_end_sec numeric NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_segments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.meeting_segments ADD COLUMN text_search tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', text)) STORED;

CREATE INDEX idx_segments_meeting_tstart ON public.meeting_segments(meeting_id, t_start_sec);
CREATE INDEX idx_segments_meeting_speaker ON public.meeting_segments(meeting_id, speaker_label);
CREATE INDEX idx_segments_text_search ON public.meeting_segments USING GIN(text_search);

-- 10) MEETING_SPEAKERS
CREATE TABLE public.meeting_speakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  speaker_label text NOT NULL,
  speaker_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(meeting_id, speaker_label)
);
ALTER TABLE public.meeting_speakers ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_meeting_speakers_updated_at
  BEFORE UPDATE ON public.meeting_speakers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 11) MEETING_ANALYSES
CREATE TABLE public.meeting_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  sector_id uuid REFERENCES public.sectors(id),
  analysis_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.meeting_analyses ENABLE ROW LEVEL SECURITY;

-- 12) CHAT_MESSAGES
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  evidence_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- 13) AGENT_PROFILES
CREATE TABLE public.agent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id uuid NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('coordinator','specialist')),
  name text NOT NULL,
  order_index int NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  system_prompt text NOT NULL,
  output_schema_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_profiles ENABLE ROW LEVEL SECURITY;

-- 14) USAGE_EVENTS
CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('stt','llm')),
  provider text,
  model text,
  units jsonb,
  cost_estimate_usd numeric,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

-- 15) ORG_PROVIDER_SETTINGS
CREATE TABLE public.org_provider_settings (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'openai',
  llm_model text NOT NULL DEFAULT 'gpt-5.2',
  stt_model text NOT NULL DEFAULT 'gpt-4o-transcribe',
  temperature numeric NOT NULL DEFAULT 0.2,
  max_output_tokens int NOT NULL DEFAULT 1200,
  budget_soft_usd numeric NOT NULL DEFAULT 50,
  budget_hard_usd numeric NOT NULL DEFAULT 200,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.org_provider_settings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_org_provider_settings_updated_at
  BEFORE UPDATE ON public.org_provider_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Organizations
CREATE POLICY "org_members_select" ON public.organizations
  FOR SELECT TO authenticated USING (public.user_has_org_access(id));
CREATE POLICY "org_create" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "org_owner_update" ON public.organizations
  FOR UPDATE TO authenticated USING (public.user_is_org_owner(id));

-- Org Members
CREATE POLICY "om_select" ON public.org_members
  FOR SELECT TO authenticated USING (public.user_has_org_access(org_id));
CREATE POLICY "om_insert_owner" ON public.org_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.user_is_org_owner(org_id));
CREATE POLICY "om_delete_owner" ON public.org_members
  FOR DELETE TO authenticated
  USING (public.user_is_org_owner(org_id) OR user_id = auth.uid());

-- Sectors
CREATE POLICY "sectors_select" ON public.sectors
  FOR SELECT TO authenticated USING (true);

-- Meetings
CREATE POLICY "meetings_select" ON public.meetings
  FOR SELECT TO authenticated USING (public.user_has_org_access(org_id));
CREATE POLICY "meetings_insert" ON public.meetings
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_access(org_id) AND created_by = auth.uid());
CREATE POLICY "meetings_update" ON public.meetings
  FOR UPDATE TO authenticated USING (public.user_has_org_access(org_id));
CREATE POLICY "meetings_delete" ON public.meetings
  FOR DELETE TO authenticated USING (public.user_is_org_owner(org_id));

-- Meeting Audio
CREATE POLICY "audio_select" ON public.meeting_audio
  FOR SELECT TO authenticated USING (public.user_has_org_access(public.meeting_org_id(meeting_id)));
CREATE POLICY "audio_insert" ON public.meeting_audio
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_access(public.meeting_org_id(meeting_id)));

-- Meeting Transcripts
CREATE POLICY "transcripts_select" ON public.meeting_transcripts
  FOR SELECT TO authenticated USING (public.user_has_org_access(public.meeting_org_id(meeting_id)));
CREATE POLICY "transcripts_insert" ON public.meeting_transcripts
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_access(public.meeting_org_id(meeting_id)));

-- Meeting Segments
CREATE POLICY "segments_select" ON public.meeting_segments
  FOR SELECT TO authenticated USING (public.user_has_org_access(public.meeting_org_id(meeting_id)));
CREATE POLICY "segments_insert" ON public.meeting_segments
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_access(public.meeting_org_id(meeting_id)));
CREATE POLICY "segments_update" ON public.meeting_segments
  FOR UPDATE TO authenticated USING (public.user_has_org_access(public.meeting_org_id(meeting_id)));

-- Meeting Speakers
CREATE POLICY "speakers_select" ON public.meeting_speakers
  FOR SELECT TO authenticated USING (public.user_has_org_access(public.meeting_org_id(meeting_id)));
CREATE POLICY "speakers_insert" ON public.meeting_speakers
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_access(public.meeting_org_id(meeting_id)));
CREATE POLICY "speakers_update" ON public.meeting_speakers
  FOR UPDATE TO authenticated USING (public.user_has_org_access(public.meeting_org_id(meeting_id)));

-- Meeting Analyses
CREATE POLICY "analyses_select" ON public.meeting_analyses
  FOR SELECT TO authenticated USING (public.user_has_org_access(public.meeting_org_id(meeting_id)));
CREATE POLICY "analyses_insert" ON public.meeting_analyses
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_access(public.meeting_org_id(meeting_id)));

-- Chat Messages
CREATE POLICY "chat_select" ON public.chat_messages
  FOR SELECT TO authenticated USING (public.user_has_org_access(public.meeting_org_id(meeting_id)));
CREATE POLICY "chat_insert" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_access(public.meeting_org_id(meeting_id)));

-- Agent Profiles
CREATE POLICY "agents_select" ON public.agent_profiles
  FOR SELECT TO authenticated USING (true);

-- Usage Events
CREATE POLICY "usage_select" ON public.usage_events
  FOR SELECT TO authenticated USING (public.user_has_org_access(org_id));
CREATE POLICY "usage_insert" ON public.usage_events
  FOR INSERT TO authenticated WITH CHECK (public.user_has_org_access(org_id));

-- Org Provider Settings
CREATE POLICY "settings_select" ON public.org_provider_settings
  FOR SELECT TO authenticated USING (public.user_has_org_access(org_id));
CREATE POLICY "settings_insert" ON public.org_provider_settings
  FOR INSERT TO authenticated WITH CHECK (public.user_is_org_owner(org_id));
CREATE POLICY "settings_update" ON public.org_provider_settings
  FOR UPDATE TO authenticated USING (public.user_is_org_owner(org_id));

-- ============================================================
-- STORAGE BUCKET
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('meeting-audio', 'meeting-audio', false);

CREATE POLICY "audio_storage_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'meeting-audio');
CREATE POLICY "audio_storage_read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'meeting-audio');
CREATE POLICY "audio_storage_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'meeting-audio');

-- ============================================================
-- SEED: Sectors
-- ============================================================
INSERT INTO public.sectors (key, name, description) VALUES
  ('building_admin', 'Administración de Edificios', 'Apoyo profesional para administración de edificios, comunidades, condominios, proveedores, finanzas, mantenimiento y cumplimiento.'),
  ('business', 'Negocios', 'Apoyo profesional para reuniones de negocios: estrategia, ventas, operaciones, finanzas, RRHH, cumplimiento.');

-- ============================================================
-- SEED: Agent Profiles - Building Admin
-- ============================================================
WITH ba AS (SELECT id FROM public.sectors WHERE key = 'building_admin')
INSERT INTO public.agent_profiles (sector_id, role, name, order_index, enabled, system_prompt, output_schema_json) VALUES
((SELECT id FROM ba), 'coordinator', 'Coordinador Administración de Edificios', 0, true,
 E'You are SintIA Coordinator for the "Administración de Edificios" sector. You work for professionals managing buildings, condominiums, and communities.\nYou must produce strictly valid JSON matching the provided schema.\nGround all important claims in transcript evidence. Each evidence item must reference diarized segments by speaker + timestamps and include a short quote.\nOutput language: Spanish (Chile).\nIf something is uncertain, explicitly mark it and suggest questions to resolve it.\nYou will be given: sector name, meeting title, relevant transcript segments, and a list of specialist agents available.\nFirst decide which specialists to use and why, then consolidate their outputs into the final JSON.',
 '{"sector":"string","meeting_title":"string","summary":"string","key_points":[{"point":"string","evidence":[{"speaker":"string","t_start_sec":0,"t_end_sec":0,"quote":"string"}]}],"decisions":[{"decision":"string","owner":"string|null","evidence":[]}],"action_items":[{"task":"string","owner":"string|null","due_date":"string|null","priority":"low|medium|high","evidence":[]}],"risks_alerts":[{"risk":"string","severity":"low|medium|high","mitigation":"string","evidence":[]}],"open_questions":["string"],"suggested_responses":[{"context":"string","message":"string","evidence":[]}],"confidence_notes":["string"]}'::jsonb),
((SELECT id FROM ba), 'specialist', 'Operaciones y Mantenimiento', 1, true,
 E'You are a specialist agent for SintIA, focused on Operations & Maintenance for building administration.\nFocus: fallas, planes de mantenimiento, proveedores, SLA, urgencias, cronograma.\nOnly use information in the provided diarized transcript segments.\nOutput language: Spanish (Chile). Include evidence citations. Produce strictly valid JSON.',
 '{"specialist_name":"string","findings":[{"title":"string","detail":"string","evidence":[{"speaker":"string","t_start_sec":0,"t_end_sec":0,"quote":"string"}]}],"risks":[{"risk":"string","severity":"low|medium|high","evidence":[]}],"missing_info_questions":["string"]}'::jsonb),
((SELECT id FROM ba), 'specialist', 'Finanzas y Cobranza', 2, true,
 E'You are a specialist agent for SintIA, focused on Finance & Collections for building administration.\nFocus: gastos comunes, morosidad, presupuestos, caja, proyecciones.\nOnly use information in the provided diarized transcript segments.\nOutput language: Spanish (Chile). Include evidence citations. Produce strictly valid JSON.',
 '{"specialist_name":"string","findings":[{"title":"string","detail":"string","evidence":[{"speaker":"string","t_start_sec":0,"t_end_sec":0,"quote":"string"}]}],"risks":[{"risk":"string","severity":"low|medium|high","evidence":[]}],"missing_info_questions":["string"]}'::jsonb),
((SELECT id FROM ba), 'specialist', 'Legal y Cumplimiento', 3, true,
 E'You are a specialist agent for SintIA, focused on Legal & Compliance for building administration.\nFocus: reglamento, contratos, normativas, riesgos legales, actas.\nOnly use information in the provided diarized transcript segments.\nOutput language: Spanish (Chile). Include evidence citations. Produce strictly valid JSON.',
 '{"specialist_name":"string","findings":[{"title":"string","detail":"string","evidence":[{"speaker":"string","t_start_sec":0,"t_end_sec":0,"quote":"string"}]}],"risks":[{"risk":"string","severity":"low|medium|high","evidence":[]}],"missing_info_questions":["string"]}'::jsonb),
((SELECT id FROM ba), 'specialist', 'Comunidad y Comunicación', 4, true,
 E'You are a specialist agent for SintIA, focused on Community & Communication for building administration.\nFocus: conflictos, acuerdos, mensajes a residentes, negociación.\nOnly use information in the provided diarized transcript segments.\nOutput language: Spanish (Chile). Include evidence citations. Produce strictly valid JSON.',
 '{"specialist_name":"string","findings":[{"title":"string","detail":"string","evidence":[{"speaker":"string","t_start_sec":0,"t_end_sec":0,"quote":"string"}]}],"risks":[{"risk":"string","severity":"low|medium|high","evidence":[]}],"missing_info_questions":["string"]}'::jsonb);

-- ============================================================
-- SEED: Agent Profiles - Business
-- ============================================================
WITH bz AS (SELECT id FROM public.sectors WHERE key = 'business')
INSERT INTO public.agent_profiles (sector_id, role, name, order_index, enabled, system_prompt, output_schema_json) VALUES
((SELECT id FROM bz), 'coordinator', 'Coordinador Negocios', 0, true,
 E'You are SintIA Coordinator for the "Negocios" (General Business) sector. You work for professionals in sales, operations, finance, and HR.\nYou must produce strictly valid JSON matching the provided schema.\nGround all important claims in transcript evidence. Each evidence item must reference diarized segments by speaker + timestamps and include a short quote.\nOutput language: Spanish (Chile).\nIf something is uncertain, explicitly mark it and suggest questions to resolve it.\nYou will be given: sector name, meeting title, relevant transcript segments, and a list of specialist agents available.\nFirst decide which specialists to use and why, then consolidate their outputs into the final JSON.',
 '{"sector":"string","meeting_title":"string","summary":"string","key_points":[{"point":"string","evidence":[{"speaker":"string","t_start_sec":0,"t_end_sec":0,"quote":"string"}]}],"decisions":[{"decision":"string","owner":"string|null","evidence":[]}],"action_items":[{"task":"string","owner":"string|null","due_date":"string|null","priority":"low|medium|high","evidence":[]}],"risks_alerts":[{"risk":"string","severity":"low|medium|high","mitigation":"string","evidence":[]}],"open_questions":["string"],"suggested_responses":[{"context":"string","message":"string","evidence":[]}],"confidence_notes":["string"]}'::jsonb),
((SELECT id FROM bz), 'specialist', 'Ventas y Cliente', 1, true,
 E'You are a specialist agent for SintIA, focused on Sales & Client for business meetings.\nFocus: oportunidades, objeciones, próximos pasos, guiones de respuesta.\nOnly use information in the provided diarized transcript segments.\nOutput language: Spanish (Chile). Include evidence citations. Produce strictly valid JSON.',
 '{"specialist_name":"string","findings":[{"title":"string","detail":"string","evidence":[{"speaker":"string","t_start_sec":0,"t_end_sec":0,"quote":"string"}]}],"risks":[{"risk":"string","severity":"low|medium|high","evidence":[]}],"missing_info_questions":["string"]}'::jsonb),
((SELECT id FROM bz), 'specialist', 'Operaciones y Entrega', 2, true,
 E'You are a specialist agent for SintIA, focused on Operations & Delivery for business meetings.\nFocus: riesgos operacionales, responsables, hitos, procesos.\nOnly use information in the provided diarized transcript segments.\nOutput language: Spanish (Chile). Include evidence citations. Produce strictly valid JSON.',
 '{"specialist_name":"string","findings":[{"title":"string","detail":"string","evidence":[{"speaker":"string","t_start_sec":0,"t_end_sec":0,"quote":"string"}]}],"risks":[{"risk":"string","severity":"low|medium|high","evidence":[]}],"missing_info_questions":["string"]}'::jsonb),
((SELECT id FROM bz), 'specialist', 'Finanzas y Pricing', 3, true,
 E'You are a specialist agent for SintIA, focused on Finance & Pricing for business meetings.\nFocus: márgenes, costos, pricing, ROI, presupuestos.\nOnly use information in the provided diarized transcript segments.\nOutput language: Spanish (Chile). Include evidence citations. Produce strictly valid JSON.',
 '{"specialist_name":"string","findings":[{"title":"string","detail":"string","evidence":[{"speaker":"string","t_start_sec":0,"t_end_sec":0,"quote":"string"}]}],"risks":[{"risk":"string","severity":"low|medium|high","evidence":[]}],"missing_info_questions":["string"]}'::jsonb),
((SELECT id FROM bz), 'specialist', 'RRHH y Gestión', 4, true,
 E'You are a specialist agent for SintIA, focused on HR & Management for business meetings.\nFocus: responsabilidades, alineación, cultura, desempeño, acuerdos internos.\nOnly use information in the provided diarized transcript segments.\nOutput language: Spanish (Chile). Include evidence citations. Produce strictly valid JSON.',
 '{"specialist_name":"string","findings":[{"title":"string","detail":"string","evidence":[{"speaker":"string","t_start_sec":0,"t_end_sec":0,"quote":"string"}]}],"risks":[{"risk":"string","severity":"low|medium|high","evidence":[]}],"missing_info_questions":["string"]}'::jsonb);

-- ============================================================
-- AUTO-CREATE ORG on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
BEGIN
  INSERT INTO public.organizations (name)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email, 'Mi Organización'))
  RETURNING id INTO new_org_id;

  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  INSERT INTO public.org_provider_settings (org_id)
  VALUES (new_org_id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
