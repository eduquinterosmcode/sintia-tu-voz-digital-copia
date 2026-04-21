"""
Meeting analysis runner.

Builds the agent team from a SectorConfig and runs the full analysis pipeline:
coordinator (with specialists as tools) → CoordinatorOutput.
"""
import logging

from agents import Runner

from ai_service.agents.meeting.agents import build_coordinator_agent, build_specialist_agent
from ai_service.agents.meeting.context import MeetingContext
from ai_service.agents.meeting.schemas import CoordinatorOutput, SectorConfig

logger = logging.getLogger(__name__)


def _build_prompt(meeting_title: str, sector_name: str) -> str:
    return (
        f"Reunión: {meeting_title}\n"
        f"Sector: {sector_name}\n\n"
        "Analiza esta reunión usando los especialistas disponibles como herramientas. "
        "Llama a cada especialista relevante, revisa sus análisis, y consolida todo "
        "en el reporte final. Usa `search_transcript` para verificar los puntos más "
        "importantes antes de cerrar el análisis."
    )


async def run_analysis(
    segments: list[dict],
    meeting_title: str,
    sector_config: SectorConfig,
) -> CoordinatorOutput:
    """
    Run the full multi-agent analysis pipeline for a meeting.

    Args:
        segments:       All transcript segments as dicts (text, speaker_label, etc.).
        meeting_title:  Meeting title for context.
        sector_config:  Agent profiles loaded from DB for this sector.

    Returns:
        CoordinatorOutput — the consolidated analysis ready to save to meeting_analyses.
    """
    specialists = [
        build_specialist_agent(s.name, s.instructions)
        for s in sector_config.specialists
    ]

    coordinator = build_coordinator_agent(specialists, sector_config.coordinator_instructions)

    context = MeetingContext(
        segments=segments,
        meeting_title=meeting_title,
        sector_name=sector_config.sector_name,
    )

    prompt = _build_prompt(meeting_title, sector_config.sector_name)

    logger.info(
        "Running meeting analysis — sector=%s specialists=%d segments=%d",
        sector_config.sector_key,
        len(specialists),
        len(segments),
    )

    result = await Runner.run(coordinator, input=prompt, context=context)
    output: CoordinatorOutput = result.final_output

    logger.info(
        "Analysis complete — key_points=%d decisions=%d action_items=%d risks=%d",
        len(output.key_points),
        len(output.decisions),
        len(output.action_items),
        len(output.risks_alerts),
    )

    return output
