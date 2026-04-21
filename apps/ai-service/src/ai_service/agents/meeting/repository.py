"""
DB access layer for the meeting analysis agents.

Reads from: meetings, meeting_segments, agent_profiles, sectors.
Writes to:  meeting_analyses, meetings (status updates).
"""
import json
import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ai_service.agents.meeting.schemas import (
    CoordinatorOutput,
    SectorConfig,
    SpecialistConfig,
)

logger = logging.getLogger(__name__)


@dataclass
class MeetingData:
    meeting_id: uuid.UUID
    meeting_title: str
    sector_key: str
    sector_id: uuid.UUID
    org_id: uuid.UUID
    segments: list[dict]


class MeetingRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Reads ─────────────────────────────────────────────────────────────────

    async def fetch_meeting_data(self, meeting_id: uuid.UUID) -> MeetingData:
        """
        Fetch meeting metadata + all transcript segments.
        Raises ValueError if meeting not found or has no segments.
        """
        meeting_row = await self._db.execute(
            text("""
                SELECT m.id, m.title, m.org_id, m.sector_id,
                       s.key AS sector_key
                FROM meetings m
                JOIN sectors s ON s.id = m.sector_id
                WHERE m.id = :meeting_id
            """),
            {"meeting_id": meeting_id},
        )
        meeting = meeting_row.mappings().fetchone()
        if meeting is None:
            raise ValueError(f"Meeting not found: {meeting_id}")

        segments_rows = await self._db.execute(
            text("""
                SELECT segment_index, speaker_label, speaker_name,
                       t_start_sec, t_end_sec, text
                FROM meeting_segments
                WHERE meeting_id = :meeting_id
                ORDER BY t_start_sec ASC
            """),
            {"meeting_id": meeting_id},
        )
        segments = [dict(r) for r in segments_rows.mappings().fetchall()]

        if not segments:
            raise ValueError(f"No transcript segments for meeting {meeting_id}")

        return MeetingData(
            meeting_id=meeting["id"],
            meeting_title=meeting["title"] or "Sin título",
            sector_key=meeting["sector_key"],
            sector_id=meeting["sector_id"],
            org_id=meeting["org_id"],
            segments=segments,
        )

    async def fetch_sector_config(self, sector_id: uuid.UUID) -> SectorConfig:
        """
        Load agent_profiles for a sector and return a typed SectorConfig.
        Raises ValueError if no coordinator is found.
        """
        rows = await self._db.execute(
            text("""
                SELECT ap.name, ap.role, ap.system_prompt,
                       s.key AS sector_key, s.name AS sector_name
                FROM agent_profiles ap
                JOIN sectors s ON s.id = ap.sector_id
                WHERE ap.sector_id = :sector_id
                  AND ap.enabled = true
                ORDER BY ap.order_index ASC
            """),
            {"sector_id": sector_id},
        )
        profiles = rows.mappings().fetchall()

        if not profiles:
            raise ValueError(f"No agent profiles found for sector_id={sector_id}")

        coordinator = next((p for p in profiles if p["role"] == "coordinator"), None)
        if coordinator is None:
            raise ValueError(f"No coordinator in sector_id={sector_id}")

        specialists = [
            SpecialistConfig(name=p["name"], instructions=p["system_prompt"])
            for p in profiles if p["role"] == "specialist"
        ]

        return SectorConfig(
            sector_key=profiles[0]["sector_key"],
            sector_name=profiles[0]["sector_name"],
            coordinator_instructions=coordinator["system_prompt"],
            specialists=specialists,
        )

    # ── Writes ────────────────────────────────────────────────────────────────

    async def update_meeting_status(self, meeting_id: uuid.UUID, status: str) -> None:
        await self._db.execute(
            text("UPDATE meetings SET status = :status WHERE id = :id"),
            {"status": status, "id": meeting_id},
        )
        await self._db.commit()
        logger.info("Meeting %s → status=%s", meeting_id, status)

    async def save_analysis(
        self,
        meeting_data: MeetingData,
        output: CoordinatorOutput,
        created_by: uuid.UUID | None = None,
    ) -> uuid.UUID:
        """
        Insert a new row in meeting_analyses with version auto-incremented.
        Returns the new analysis_id.
        """
        # Get current max version
        ver_row = await self._db.execute(
            text("""
                SELECT COALESCE(MAX(version), 0) AS max_version
                FROM meeting_analyses
                WHERE meeting_id = :meeting_id
            """),
            {"meeting_id": meeting_data.meeting_id},
        )
        max_version = ver_row.scalar_one()
        new_version = max_version + 1

        analysis_json = json.dumps(output.model_dump(mode="json"), ensure_ascii=False)

        row = await self._db.execute(
            text("""
                INSERT INTO meeting_analyses
                    (meeting_id, version, sector_id, analysis_json, created_by)
                VALUES
                    (:meeting_id, :version, :sector_id,
                     CAST(:analysis_json AS jsonb), :created_by)
                RETURNING id
            """),
            {
                "meeting_id": meeting_data.meeting_id,
                "version": new_version,
                "sector_id": meeting_data.sector_id,
                "analysis_json": analysis_json,
                "created_by": created_by,
            },
        )
        await self._db.commit()
        analysis_id = row.scalar_one()
        logger.info(
            "Analysis saved — meeting=%s version=%d id=%s",
            meeting_data.meeting_id,
            new_version,
            analysis_id,
        )
        return analysis_id
