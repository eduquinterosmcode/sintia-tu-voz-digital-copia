"""
DB access layer for the AnalysisAuditor.

Reads from public.meeting_analyses and public.meeting_segments.
Writes to public.meeting_quality_reports.
All tables live in the same Supabase Postgres instance.
"""
import json
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ai_service.agents.auditor.schemas import AuditReport


@dataclass
class MeetingData:
    analysis_id: uuid.UUID
    analysis_json: dict
    segments: list[dict]


class AuditorRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def fetch_meeting_data(self, meeting_id: uuid.UUID) -> MeetingData:
        """
        Fetch the latest analysis + all segments for a meeting.
        Raises ValueError if no analysis exists yet.
        """
        # Latest analysis for this meeting
        analysis_row = await self._db.execute(
            text("""
                SELECT id, analysis_json
                FROM meeting_analyses
                WHERE meeting_id = :meeting_id
                  AND analysis_json IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1
            """),
            {"meeting_id": meeting_id},
        )
        analysis = analysis_row.mappings().fetchone()
        if analysis is None:
            raise ValueError(f"No completed analysis found for meeting_id={meeting_id}")

        # All segments ordered by time
        segments_rows = await self._db.execute(
            text("""
                SELECT
                    segment_index,
                    speaker_label,
                    speaker_name,
                    t_start_sec,
                    t_end_sec,
                    text
                FROM meeting_segments
                WHERE meeting_id = :meeting_id
                ORDER BY t_start_sec ASC
            """),
            {"meeting_id": meeting_id},
        )
        segments = [dict(r) for r in segments_rows.mappings().fetchall()]

        if not segments:
            raise ValueError(f"No transcript segments found for meeting_id={meeting_id}")

        return MeetingData(
            analysis_id=analysis["id"],
            analysis_json=analysis["analysis_json"],
            segments=segments,
        )

    async def fetch_latest_analysis_id(self, meeting_id: uuid.UUID) -> uuid.UUID | None:
        """Returns the latest analysis_id for use in idempotency_key generation."""
        row = await self._db.execute(
            text("""
                SELECT id FROM meeting_analyses
                WHERE meeting_id = :meeting_id AND analysis_json IS NOT NULL
                ORDER BY created_at DESC LIMIT 1
            """),
            {"meeting_id": meeting_id},
        )
        result = row.mappings().fetchone()
        return result["id"] if result else None

    async def save_report(
        self,
        meeting_id: uuid.UUID,
        analysis_id: uuid.UUID,
        report: AuditReport,
    ) -> uuid.UUID:
        """
        Upsert quality report. If a report for this analysis_id already exists,
        overwrite it (idempotent: running the job twice is safe).
        Returns the report id.
        """
        report_json = json.dumps(
            report.model_dump(mode="json"),
            ensure_ascii=False,
        )
        row = await self._db.execute(
            text("""
                INSERT INTO meeting_quality_reports
                    (meeting_id, analysis_id, confidence_score, report_json)
                VALUES
                    (:meeting_id, :analysis_id, :score, CAST(:report_json AS jsonb))
                ON CONFLICT (analysis_id) DO UPDATE SET
                    confidence_score = EXCLUDED.confidence_score,
                    report_json      = EXCLUDED.report_json,
                    updated_at       = NOW()
                RETURNING id
            """),
            {
                "meeting_id": meeting_id,
                "analysis_id": analysis_id,
                "score": report.confidence_score,
                "report_json": report_json,
            },
        )
        await self._db.commit()
        return row.scalar_one()

    async def get_report(self, meeting_id: uuid.UUID) -> dict | None:
        """Fetch the latest quality report for a meeting (for the GET endpoint)."""
        row = await self._db.execute(
            text("""
                SELECT
                    id, meeting_id, analysis_id,
                    confidence_score, report_json,
                    model_used, created_at, updated_at
                FROM meeting_quality_reports
                WHERE meeting_id = :meeting_id
                ORDER BY created_at DESC
                LIMIT 1
            """),
            {"meeting_id": meeting_id},
        )
        result = row.mappings().fetchone()
        return dict(result) if result else None
