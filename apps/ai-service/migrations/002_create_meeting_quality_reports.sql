-- Migration: 002_create_meeting_quality_reports.sql
-- Quality report produced by the AnalysisAuditor agent.
-- One report per analysis version (FK to meeting_analyses).
-- Run manually: psql $DATABASE_URL -f migrations/002_create_meeting_quality_reports.sql

CREATE TABLE IF NOT EXISTS public.meeting_quality_reports (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id       UUID        NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    analysis_id      UUID        NOT NULL REFERENCES public.meeting_analyses(id) ON DELETE CASCADE,
    confidence_score INT         NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
    report_json      JSONB       NOT NULL,
    model_used       TEXT        NOT NULL DEFAULT 'gpt-4o',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (analysis_id)   -- one report per analysis version; re-analysis → new report
);

COMMENT ON TABLE public.meeting_quality_reports IS
    'Quality audit of a meeting analysis: contradictions, unsupported claims, confidence score.';
COMMENT ON COLUMN public.meeting_quality_reports.analysis_id IS
    'FK to the specific meeting_analyses version this report audits.';
COMMENT ON COLUMN public.meeting_quality_reports.report_json IS
    'Full AuditReport JSON: {contradictions, unsupported_claims, summary}.';

CREATE INDEX IF NOT EXISTS idx_quality_reports_meeting
    ON public.meeting_quality_reports (meeting_id, created_at DESC);

CREATE OR REPLACE FUNCTION quality_reports_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quality_reports_updated_at ON public.meeting_quality_reports;
CREATE TRIGGER trg_quality_reports_updated_at
    BEFORE UPDATE ON public.meeting_quality_reports
    FOR EACH ROW EXECUTE FUNCTION quality_reports_set_updated_at();
