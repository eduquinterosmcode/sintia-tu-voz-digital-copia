"""
Webhook endpoint for Supabase Database Webhooks.

Once the service is deployed to Cloud Run, configure a Supabase Database Webhook:
  Table: meeting_analyses
  Event: INSERT
  URL: https://<cloud-run-url>/webhooks/analysis-completed
  HTTP Headers: { "x-webhook-secret": "<WEBHOOK_SECRET>" }

This replaces the Deno→ai_jobs direct insert as the primary trigger for audit jobs.
The Deno upsert in agent-orchestrator remains as a fallback (idempotent — ON CONFLICT DO NOTHING).
"""
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ai_service.config import settings
from ai_service.database import get_db
from ai_service.jobs.models import JobCreate
from ai_service.jobs.repository import JobRepository

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


# ── Auth ─────────────────────────────────────────────────────────────────────

async def require_webhook_secret(
    x_webhook_secret: str | None = Header(None),
) -> None:
    if x_webhook_secret != settings.webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing x-webhook-secret",
        )


# ── Schema ───────────────────────────────────────────────────────────────────

class SupabaseWebhookPayload(BaseModel):
    """Supabase sends { type, table, schema, record, old_record } on DB events."""
    type: str
    table: str
    schema: str
    record: dict[str, Any]
    old_record: dict[str, Any] | None = None


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.post(
    "/analysis-completed",
    dependencies=[Depends(require_webhook_secret)],
    status_code=202,
)
async def analysis_completed(
    payload: SupabaseWebhookPayload,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Called by Supabase when a new row is inserted into meeting_analyses.
    Enqueues an audit_analysis job for the Python worker.
    Returns 202 immediately — the job runs asynchronously.
    """
    if payload.type != "INSERT":
        # Only process inserts; ignore updates/deletes gracefully
        return {"enqueued": False, "reason": f"ignored event type: {payload.type}"}

    analysis_id = payload.record.get("id")
    meeting_id = payload.record.get("meeting_id")

    if not analysis_id or not meeting_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="record must contain id and meeting_id",
        )

    job = await JobRepository(db).enqueue(
        JobCreate(
            idempotency_key=f"audit_analysis:{analysis_id}",
            job_type="audit_analysis",
            payload={"meeting_id": meeting_id, "analysis_id": analysis_id},
            priority=1,
            max_attempts=3,
        )
    )

    return {"enqueued": True, "job_id": str(job.id)}
