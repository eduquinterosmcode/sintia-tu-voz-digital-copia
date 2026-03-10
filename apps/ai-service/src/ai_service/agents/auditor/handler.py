"""
Job handler for audit_analysis jobs.

Registered at import time via @register_handler.
The worker imports ai_service.handlers which re-exports this module.

Job payload schema:
    {
        "meeting_id": "<uuid>",
        "analysis_id": "<uuid>"   # optional — fetched from DB if absent
    }
"""
import logging
import uuid

from ai_service.agents.auditor.agent import run_auditor
from ai_service.agents.auditor.repository import AuditorRepository
from ai_service.database import AsyncSessionLocal
from ai_service.handlers.registry import register_handler
from ai_service.jobs.models import JobRow

logger = logging.getLogger(__name__)


@register_handler("audit_analysis")
async def handle_audit_analysis(job: JobRow) -> None:
    meeting_id = uuid.UUID(job.payload["meeting_id"])

    async with AsyncSessionLocal() as db:
        repo = AuditorRepository(db)

        # Fetch analysis + segments from Supabase Postgres
        data = await repo.fetch_meeting_data(meeting_id)

    logger.info(
        "Auditing meeting=%s analysis=%s segments=%d",
        meeting_id,
        data.analysis_id,
        len(data.segments),
    )

    # Run the agent (no DB session held during LLM call)
    report = await run_auditor(
        analysis_json=data.analysis_json,
        segments=data.segments,
    )

    # Persist result
    async with AsyncSessionLocal() as db:
        repo = AuditorRepository(db)
        report_id = await repo.save_report(
            meeting_id=meeting_id,
            analysis_id=data.analysis_id,
            report=report,
        )

    logger.info(
        "Quality report saved — report_id=%s score=%d",
        report_id,
        report.confidence_score,
    )
