"""
Agent factories for meeting analysis.

build_specialist_agent() — creates one specialist with domain tools.
build_coordinator_agent() — creates the coordinator that orchestrates specialists
                            via the Agent-as-Tool pattern.
"""
import re

from agents import Agent

from ai_service.agents.meeting.context import MeetingContext
from ai_service.agents.meeting.schemas import CoordinatorOutput, SpecialistOutput
from ai_service.agents.meeting.tools import get_speaker_turns, search_transcript

_MODEL = "gpt-4o"

_SPECIALIST_SUFFIX = """
Reglas de trabajo:
- Usa `search_transcript` ANTES de afirmar cualquier cosa. Tu análisis debe estar
  respaldado por evidencia directa del transcript — no por suposiciones.
- Usa `get_speaker_turns` cuando necesites entender la posición completa de alguien.
- Cita evidencia con speaker + timestamp + quote en cada finding y riesgo relevante.
- Si algo no se mencionó en la reunión, no lo inventes. Registra la pregunta en
  `missing_info_questions`.
- Output en español (Chile). Sé directo y preciso.
"""

_COORDINATOR_SUFFIX = """
Reglas de trabajo:
- Llama a cada especialista que sea relevante para esta reunión usando sus herramientas.
- Después de recibir sus análisis, usa `search_transcript` para validar o profundizar
  en los puntos más importantes antes de consolidar.
- El output final debe ser coherente — si un especialista identificó un riesgo que
  otro pasó por alto, inclúyelo.
- Elimina duplicados. Fusiona evidencia complementaria.
- Si hay contradicción entre especialistas, anótala en `confidence_notes`.
- Output en español (Chile). `summary` debe ser ejecutivo: 2-4 oraciones.
"""


def _slugify(name: str) -> str:
    """Convert agent name to a valid tool name (snake_case, no spaces)."""
    slug = re.sub(r"[^a-zA-Z0-9\s]", "", name).strip().lower()
    return re.sub(r"\s+", "_", slug)[:64]


def build_specialist_agent(name: str, instructions: str) -> Agent[MeetingContext]:
    """
    Create a specialist agent with transcript search tools.

    Args:
        name:         Display name (e.g. "Ventas y Cliente").
        instructions: Domain-specific system prompt from agent_profiles.system_prompt.
    """
    return Agent[MeetingContext](
        name=name,
        model=_MODEL,
        instructions=instructions + _SPECIALIST_SUFFIX,
        tools=[search_transcript, get_speaker_turns],
        output_type=SpecialistOutput,
    )


def build_coordinator_agent(
    specialists: list[Agent[MeetingContext]],
    instructions: str,
) -> Agent[MeetingContext]:
    """
    Create the coordinator agent that orchestrates specialists as tools.

    Each specialist is exposed as an Agent-as-Tool so the coordinator can
    invoke them selectively and reason over their combined outputs.

    Args:
        specialists:  List of specialist agents built with build_specialist_agent().
        instructions: Coordinator system prompt from agent_profiles.system_prompt.
    """
    specialist_tools = [
        spec.as_tool(
            tool_name=_slugify(spec.name),
            tool_description=(
                f"Specialist agent: {spec.name}. "
                "Call this to get a domain-specific analysis of the meeting transcript."
            ),
        )
        for spec in specialists
    ]

    return Agent[MeetingContext](
        name="Coordinador",
        model=_MODEL,
        instructions=instructions + _COORDINATOR_SUFFIX,
        tools=specialist_tools + [search_transcript, get_speaker_turns],
        output_type=CoordinatorOutput,
    )
