"""
Job handler for analyze_meeting jobs.

Registered at import time via @register_handler.
The worker imports ai_service.handlers which re-exports this module.

Job payload schema:
    {
        "meeting_id": "<uuid>"
    }
"""
import logging
import uuid

from ai_service.agents.meeting.repository import MeetingRepository
from ai_service.agents.meeting.runner import run_analysis
from ai_service.database import AsyncSessionLocal
from ai_service.handlers.registry import register_handler
from ai_service.jobs.models import JobRow

logger = logging.getLogger(__name__)


@register_handler("analyze_meeting")
async def handle_analyze_meeting(job: JobRow) -> None:
    meeting_id = uuid.UUID(job.payload["meeting_id"])

    # ── Fetch data (DB session closed before LLM call) ────────────────────────
    async with AsyncSessionLocal() as db:
        repo = MeetingRepository(db)
        await repo.update_meeting_status(meeting_id, "analyzing")
        meeting_data = await repo.fetch_meeting_data(meeting_id)
        sector_config = await repo.fetch_sector_config(meeting_data.sector_id)

    logger.info(
        "Starting analysis — meeting=%s sector=%s specialists=%d segments=%d",
        meeting_id,
        sector_config.sector_key,
        len(sector_config.specialists),
        len(meeting_data.segments),
    )

    # ── Run agents (no DB session held during LLM inference) ─────────────────
    try:
        output = await run_analysis(
            segments=meeting_data.segments,
            meeting_title=meeting_data.meeting_title,
            sector_config=sector_config,
        )
    except Exception:
        async with AsyncSessionLocal() as db:
            await MeetingRepository(db).update_meeting_status(meeting_id, "error")
        raise

    # ── Persist result ────────────────────────────────────────────────────────
    async with AsyncSessionLocal() as db:
        repo = MeetingRepository(db)
        await repo.save_analysis(meeting_data, output)
        await repo.update_meeting_status(meeting_id, "analyzed")

    logger.info("Analysis complete — meeting=%s", meeting_id)
