"""
Durable job queue repository.

Uses SELECT FOR UPDATE SKIP LOCKED so multiple worker instances can run
concurrently against the same Postgres table without double-processing.
Idempotent enqueue via ON CONFLICT DO NOTHING.
"""
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ai_service.jobs.models import JobCreate, JobRow, JobStatus


class JobRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ------------------------------------------------------------------
    # Enqueue
    # ------------------------------------------------------------------

    async def enqueue(self, job: JobCreate) -> JobRow:
        """
        Insert a job row. If idempotency_key already exists, return the
        existing row without modifying it.
        """
        run_at_expr = "NOW()" if job.run_at is None else ":run_at"
        params: dict[str, Any] = {
            "idempotency_key": job.idempotency_key,
            "job_type": job.job_type,
            "payload": _json(job.payload),
            "priority": job.priority,
            "max_attempts": job.max_attempts,
        }
        if job.run_at is not None:
            params["run_at"] = job.run_at

        row = await self._db.execute(
            text(f"""
                INSERT INTO ai_jobs
                    (idempotency_key, job_type, payload, priority, max_attempts, run_at)
                VALUES
                    (:idempotency_key, :job_type, :payload::jsonb, :priority, :max_attempts, {run_at_expr})
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING *
            """),
            params,
        )
        result = row.mappings().fetchone()

        if result is None:
            # Row already existed — fetch it
            existing = await self._db.execute(
                text("SELECT * FROM ai_jobs WHERE idempotency_key = :key"),
                {"key": job.idempotency_key},
            )
            result = existing.mappings().fetchone()

        await self._db.commit()
        return JobRow.model_validate(dict(result))

    # ------------------------------------------------------------------
    # Claim (worker)
    # ------------------------------------------------------------------

    async def claim_next(self) -> JobRow | None:
        """
        Atomically claim one eligible job.
        Eligible = status pending or failed, attempts < max_attempts, run_at <= now.
        Uses SKIP LOCKED so concurrent workers don't block each other.
        Returns None when the queue is empty.
        """
        row = await self._db.execute(
            text("""
                UPDATE ai_jobs
                SET
                    status     = 'running',
                    started_at = NOW(),
                    attempts   = attempts + 1,
                    updated_at = NOW()
                WHERE id = (
                    SELECT id FROM ai_jobs
                    WHERE status IN ('pending', 'failed')
                      AND attempts < max_attempts
                      AND run_at <= NOW()
                    ORDER BY priority DESC, run_at ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING *
            """)
        )
        result = row.mappings().fetchone()
        await self._db.commit()

        if result is None:
            return None
        return JobRow.model_validate(dict(result))

    # ------------------------------------------------------------------
    # Terminal transitions
    # ------------------------------------------------------------------

    async def mark_completed(self, job_id: uuid.UUID) -> None:
        await self._db.execute(
            text("""
                UPDATE ai_jobs
                SET status = 'completed', completed_at = NOW(), updated_at = NOW()
                WHERE id = :id
            """),
            {"id": job_id},
        )
        await self._db.commit()

    async def mark_failed(self, job_id: uuid.UUID, error: str) -> None:
        """
        On failure: if attempts < max_attempts → status='failed' with
        exponential backoff on run_at; otherwise → status='dead'.
        """
        await self._db.execute(
            text("""
                UPDATE ai_jobs
                SET
                    status     = CASE
                                   WHEN attempts >= max_attempts THEN 'dead'
                                   ELSE 'failed'
                                 END,
                    last_error = :error,
                    run_at     = CASE
                                   WHEN attempts >= max_attempts THEN run_at
                                   ELSE NOW() + (POWER(2, attempts) * INTERVAL '1 minute')
                                 END,
                    updated_at = NOW()
                WHERE id = :id
            """),
            {"id": job_id, "error": error},
        )
        await self._db.commit()

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    async def get(self, job_id: uuid.UUID) -> JobRow | None:
        row = await self._db.execute(
            text("SELECT * FROM ai_jobs WHERE id = :id"),
            {"id": job_id},
        )
        result = row.mappings().fetchone()
        return JobRow.model_validate(dict(result)) if result else None


def _json(value: Any) -> str:
    import json
    return json.dumps(value)
