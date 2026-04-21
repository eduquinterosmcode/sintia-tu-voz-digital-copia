"""
Shared tools available to all meeting analysis agents.

All tools receive MeetingContext via RunContextWrapper and operate on the
transcript segments without holding a DB connection during LLM inference.
"""
from agents import RunContextWrapper, function_tool

from ai_service.agents.meeting.context import MeetingContext


@function_tool
async def search_transcript(
    ctx: RunContextWrapper[MeetingContext],
    query: str,
) -> str:
    """
    Busca en el transcript de la reunión segmentos que contengan evidencia
    relacionada con la consulta. Úsala SIEMPRE antes de afirmar algo sobre
    lo que se dijo en la reunión.

    Args:
        query: Palabra clave, frase o concepto a buscar en el transcript.

    Returns:
        Los segmentos más relevantes con speaker, timestamp y texto.
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
    for s in matches[:10]:
        speaker = s.get("speaker_name") or s.get("speaker_label", "?")
        t = s.get("t_start_sec", 0)
        minutes, seconds = divmod(int(t), 60)
        lines.append(f"[{minutes:02d}:{seconds:02d} — {speaker}]: {s['text']}")

    header = f"{len(matches)} segmento(s) encontrado(s) para '{query}'"
    if len(matches) > 10:
        header += " (mostrando los primeros 10)"
    return header + ":\n\n" + "\n---\n".join(lines)


@function_tool
async def get_speaker_turns(
    ctx: RunContextWrapper[MeetingContext],
    speaker: str,
) -> str:
    """
    Devuelve todos los turnos de palabra de un speaker específico en orden
    cronológico. Útil para entender la posición completa de una persona
    a lo largo de toda la reunión.

    Args:
        speaker: Nombre o label del speaker (ej: "SPEAKER_0", "Juan", "Doctor").
    """
    segments = ctx.context.segments
    speaker_lower = speaker.lower()

    matches = [
        s for s in segments
        if speaker_lower in (s.get("speaker_name") or s.get("speaker_label", "")).lower()
    ]

    if not matches:
        return f"No se encontraron turnos para speaker '{speaker}'."

    lines = []
    for s in matches:
        t = s.get("t_start_sec", 0)
        minutes, seconds = divmod(int(t), 60)
        lines.append(f"[{minutes:02d}:{seconds:02d}]: {s['text']}")

    return f"{len(matches)} turno(s) de '{speaker}':\n\n" + "\n---\n".join(lines)
