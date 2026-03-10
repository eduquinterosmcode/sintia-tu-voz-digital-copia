"""
Audit endpoints.

POST /audit/{meeting_id}  — enqueue an audit_analysis job (idempotent)
GET  /audit/{meeting_id}  — fetch the latest quality report for a meeting
"""
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ai_service.agents.auditor.repository import AuditorRepository
from ai_service.database import get_db
from ai_service.jobs.models import JobCreate, JobRow
from ai_service.jobs.repository import JobRepository

router = APIRouter(prefix="/audit", tags=["audit"])


@router.post("/{meeting_id}", response_model=JobRow, status_code=202)
async def enqueue_audit(
    meeting_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> JobRow:
    """
    Enqueue an audit_analysis job for the given meeting.

    Fetches the latest analysis_id from DB to build a stable idempotency_key —
    so re-running after a new analysis creates a fresh job, but calling this
    endpoint twice for the same analysis version is a no-op.

    Returns the job row (status=pending or existing status if already queued).
    """
    repo = AuditorRepository(db)
    analysis_id = await repo.fetch_latest_analysis_id(meeting_id)

    if analysis_id is None:
        raise HTTPException(
            status_code=422,
            detail=f"No completed analysis found for meeting_id={meeting_id}. "
                   "Run the main analysis pipeline first.",
        )

    job = await JobRepository(db).enqueue(
        JobCreate(
            idempotency_key=f"audit_analysis:{analysis_id}",
            job_type="audit_analysis",
            payload={"meeting_id": str(meeting_id), "analysis_id": str(analysis_id)},
            priority=1,  # slightly higher than default (0) — audits are fast
            max_attempts=3,
        )
    )
    return job


@router.get("/{meeting_id}", response_model=dict[str, Any])
async def get_audit_report(
    meeting_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Fetch the latest quality report for a meeting.
    Returns 404 if no report exists yet (job may still be pending).
    """
    repo = AuditorRepository(db)
    report = await repo.get_report(meeting_id)

    if report is None:
        raise HTTPException(
            status_code=404,
            detail="No quality report found. Check job status via GET /jobs/{job_id}.",
        )

    # Serialize UUIDs and datetimes for JSON response
    return {
        "id": str(report["id"]),
        "meeting_id": str(report["meeting_id"]),
        "analysis_id": str(report["analysis_id"]),
        "confidence_score": report["confidence_score"],
        "report": report["report_json"],
        "model_used": report["model_used"],
        "created_at": report["created_at"].isoformat(),
        "updated_at": report["updated_at"].isoformat(),
    }
