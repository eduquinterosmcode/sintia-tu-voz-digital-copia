"""
AnalysisAuditor — OpenAI Agents SDK implementation.

Receives the coordinator's analysis_json and the full transcript segments.
Uses search_transcript() as a tool to verify specific claims against the
original transcript before declaring them unsupported.
Produces a structured AuditReport via output_type.
"""
import json
import logging
from dataclasses import dataclass, field

from agents import Agent, RunContextWrapper, Runner, function_tool

from ai_service.agents.auditor.schemas import AuditReport

logger = logging.getLogger(__name__)

_MODEL = "gpt-4o"

_INSTRUCTIONS = """\
Eres un agente auditor de calidad para análisis de reuniones generados por IA.

Tu tarea es revisar críticamente el análisis entregado por el coordinador de agentes \
y producir un reporte de calidad con tres componentes:

1. **Contradicciones**: pares de afirmaciones dentro del análisis que se contradicen \
   entre sí (ej: una decisión que choca con un riesgo identificado).

2. **Claims sin evidencia**: afirmaciones del análisis que no pueden verificarse en el \
   transcript original. Usa la herramienta `search_transcript` para buscar evidencia \
   antes de marcar un claim como sin soporte.

3. **Score de confianza** (0–100): refleja qué tan bien fundamentado está el análisis. \
   Descuenta ~15 puntos por issue de severidad alta, ~8 media, ~3 baja.

Reglas:
- Verifica con `search_transcript` antes de marcar cualquier claim como sin evidencia.
- Si encuentras evidencia parcial, márcalo como `medium` en lugar de `high`.
- Escribe `summary` en español (Chile), 2–4 oraciones, enfocado en los issues más críticos.
- Si el análisis está bien fundamentado y sin contradicciones, el score puede ser >= 85.
- No inventes problemas: solo reporta lo que realmente detectes.
"""


@dataclass
class AuditorContext:
    segments: list[dict] = field(default_factory=list)


@function_tool
async def search_transcript(
    ctx: RunContextWrapper[AuditorContext],
    query: str,
) -> str:
    """
    Busca en el transcript de la reunión segmentos que contengan evidencia
    relacionada con la consulta. Úsala para verificar si un claim del análisis
    aparece realmente en lo que se dijo en la reunión.

    Args:
        query: Palabra clave, frase o concepto a buscar en el transcript.
    """
    segments = ctx.context.segments
    query_lower = query.lower()

    matches = [
        s for s in segments
        if query_lower in s.get("text", "").lower()
    ]

    if not matches:
        return f"Sin resultados para '{query}' en el transcript."

    lines = []
    for s in matches[:8]:  # cap at 8 to avoid flooding the context
        speaker = s.get("speaker_name") or s.get("speaker_label", "?")
        t = s.get("t_start_sec", 0)
        minutes, seconds = divmod(int(t), 60)
        lines.append(f"[{minutes:02d}:{seconds:02d} — {speaker}]: {s['text']}")

    header = f"Encontrados {len(matches)} segmento(s) para '{query}'"
    if len(matches) > 8:
        header += f" (mostrando los primeros 8)"
    return header + ":\n\n" + "\n---\n".join(lines)


def _build_prompt(analysis_json: dict) -> str:
    analysis_str = json.dumps(analysis_json, ensure_ascii=False, indent=2)
    return (
        "Aquí está el análisis del coordinador que debes auditar:\n\n"
        f"```json\n{analysis_str}\n```\n\n"
        "Revisa cada sección (decisiones, acciones, riesgos, etc.) en busca de "
        "contradicciones internas y claims sin respaldo en el transcript. "
        "Usa `search_transcript` cuantas veces necesites para verificar evidencia."
    )


async def run_auditor(
    analysis_json: dict,
    segments: list[dict],
) -> AuditReport:
    """
    Run the AnalysisAuditor agent and return a structured AuditReport.

    Args:
        analysis_json: The coordinator's output from meeting_analyses.analysis_json.
        segments: All meeting_segments rows as dicts (with text, speaker_label, etc.).
    """
    agent: Agent[AuditorContext] = Agent(
        name="AnalysisAuditor",
        model=_MODEL,
        instructions=_INSTRUCTIONS,
        tools=[search_transcript],
        output_type=AuditReport,
    )

    context = AuditorContext(segments=segments)
    prompt = _build_prompt(analysis_json)

    logger.info(
        "Running AnalysisAuditor (segments=%d, analysis_keys=%s)",
        len(segments),
        list(analysis_json.keys()),
    )

    result = await Runner.run(agent, input=prompt, context=context)
    report: AuditReport = result.final_output

    logger.info(
        "AnalysisAuditor complete — score=%d contradictions=%d unsupported=%d",
        report.confidence_score,
        len(report.contradictions),
        len(report.unsupported_claims),
    )

    return report
