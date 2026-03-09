-- Migration: 001_create_jobs_table.sql
-- Durable job queue for ai-service with idempotency and retry support.
-- Run manually: psql $DATABASE_URL -f migrations/001_create_jobs_table.sql

CREATE TABLE IF NOT EXISTS ai_jobs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT        UNIQUE NOT NULL,
    job_type        TEXT        NOT NULL,
    payload         JSONB       NOT NULL DEFAULT '{}',
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'running', 'completed', 'failed', 'dead')),
    priority        INT         NOT NULL DEFAULT 0,
    attempts        INT         NOT NULL DEFAULT 0,
    max_attempts    INT         NOT NULL DEFAULT 3,
    last_error      TEXT,
    run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_jobs IS
    'Durable job queue for ai-service. Workers use SELECT FOR UPDATE SKIP LOCKED to claim rows atomically.';

-- Partial index: only pending/failed rows need to be polled
CREATE INDEX IF NOT EXISTS idx_ai_jobs_queue
    ON ai_jobs (priority DESC, run_at ASC)
    WHERE status IN ('pending', 'failed');

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION ai_jobs_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_jobs_updated_at ON ai_jobs;
CREATE TRIGGER trg_ai_jobs_updated_at
    BEFORE UPDATE ON ai_jobs
    FOR EACH ROW EXECUTE FUNCTION ai_jobs_set_updated_at();
