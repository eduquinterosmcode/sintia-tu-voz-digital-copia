"""
Handler for transcribe_audio jobs.

Triggered by stt-transcribe (Deno) when the audio file exceeds 25 MB.
Downloads the audio from Supabase Storage, splits it into ~10-minute chunks
via ffmpeg, transcribes each chunk with Whisper in series, merges the
segments adjusting timestamps, and saves the result to meeting_transcripts
and meeting_segments (same tables used by the Deno path).

Job payload schema:
    {
        "meeting_id": "<uuid>",
        "storage_path": "<bucket/path/to/file>",
        "mime_type": "<audio/webm|audio/mpeg|...>",
        "language": "es",
        "stt_model": "whisper-1",
        "user_id": "<uuid>"
    }
"""
import asyncio
import json
import logging
import os
import tempfile
import uuid
from pathlib import Path

import httpx
from sqlalchemy import text

from ai_service.config import settings
from ai_service.database import AsyncSessionLocal
from ai_service.handlers.registry import register_handler
from ai_service.jobs.models import JobRow

logger = logging.getLogger(__name__)

CHUNK_DURATION_SEC = 600   # 10 minutes per chunk
OVERLAP_SEC = 5            # overlap between consecutive chunks
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_BATCH_SIZE = 500


# ── ffmpeg helpers ────────────────────────────────────────────────────────────

async def _run_ffmpeg(*args: str) -> None:
    """Run ffmpeg subprocess asynchronously. Raises RuntimeError on failure."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg error: {stderr.decode()[:500]}")


async def _get_duration(path: Path) -> float:
    """Return audio duration in seconds using ffprobe."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await proc.communicate()
    return float(stdout.decode().strip())


# ── Supabase Storage download ─────────────────────────────────────────────────

async def _download_audio(storage_path: str) -> bytes:
    """Download audio from Supabase Storage using the service role key.

    Uses /object/{path} (not /authenticated/) — the authenticated endpoint is for user JWTs.
    Service role key requires both Authorization and apikey headers, matching supabase-js behavior.
    storage_path format: "meeting-audio/org_id/meeting_id/filename.mp3"
    """
    url = f"{settings.supabase_url}/storage/v1/object/{storage_path}"
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "apikey": settings.supabase_service_role_key,
            },
        )
        resp.raise_for_status()
        return resp.content


# ── OpenAI Whisper call ───────────────────────────────────────────────────────

async def _transcribe_chunk(path: Path, language: str) -> dict:
    """Transcribe a single audio chunk with Whisper. Returns verbose_json dict."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        with open(path, "rb") as f:
            resp = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                data={
                    "model": "whisper-1",
                    "language": language.split("-")[0],
                    "response_format": "verbose_json",
                    "timestamp_granularities[]": "segment",
                },
                files={"file": (path.name, f, "audio/mpeg")},
            )
        resp.raise_for_status()
        return resp.json()


# ── Embeddings ────────────────────────────────────────────────────────────────

async def _generate_embeddings(texts: list[str]) -> list[list[float]] | None:
    """Generate embeddings in batches. Returns None on failure (non-fatal)."""
    all_embeddings: list[list[float]] = []
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            for i in range(0, len(texts), EMBEDDING_BATCH_SIZE):
                batch = texts[i : i + EMBEDDING_BATCH_SIZE]
                resp = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                    json={"model": EMBEDDING_MODEL, "input": batch},
                )
                resp.raise_for_status()
                data = resp.json()
                sorted_items = sorted(data["data"], key=lambda x: x["index"])
                all_embeddings.extend(item["embedding"] for item in sorted_items)
        return all_embeddings
    except Exception as exc:
        logger.warning("Embedding generation failed — segments will be saved without embeddings: %s", exc)
        return None


# ── Chunking + merge ──────────────────────────────────────────────────────────

def _build_chunk_windows(total_duration: float) -> list[tuple[float, float]]:
    """
    Return list of (start_sec, duration_sec) for each chunk.
    Each chunk is CHUNK_DURATION_SEC long with OVERLAP_SEC appended at the end
    so Whisper has context for the transition. The first OVERLAP_SEC of each
    non-first chunk is discarded during merge.
    """
    windows = []
    start = 0.0
    while start < total_duration:
        end = min(start + CHUNK_DURATION_SEC + OVERLAP_SEC, total_duration)
        windows.append((start, end - start))
        start += CHUNK_DURATION_SEC
    return windows


def _merge_segments(all_segments: list[dict]) -> list[dict]:
    """
    Sort segments by start time and deduplicate the overlap zones.
    If two consecutive segments start within OVERLAP_SEC of each other,
    keep the later one (it was transcribed with more leading context).
    """
    sorted_segs = sorted(all_segments, key=lambda s: s["start"])
    merged: list[dict] = []
    for seg in sorted_segs:
        if merged and (seg["start"] - merged[-1]["start"]) < OVERLAP_SEC:
            merged[-1] = seg  # replace with the version that has more context
        else:
            merged.append(seg)
    return merged


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _update_meeting_status(db, meeting_id: uuid.UUID, status: str) -> None:
    await db.execute(
        text("UPDATE meetings SET status = :status WHERE id = :meeting_id"),
        {"status": status, "meeting_id": meeting_id},
    )
    await db.commit()


async def _get_latest_transcript_version(db, meeting_id: uuid.UUID) -> int:
    row = await db.execute(
        text("""
            SELECT version FROM meeting_transcripts
            WHERE meeting_id = :meeting_id
            ORDER BY version DESC LIMIT 1
        """),
        {"meeting_id": meeting_id},
    )
    result = row.scalar_one_or_none()
    return (result or 0) + 1


async def _insert_transcript(db, meeting_id: uuid.UUID, version: int,
                              full_text: str, raw_result: dict,
                              stt_model: str, user_id: uuid.UUID) -> uuid.UUID:
    row = await db.execute(
        text("""
            INSERT INTO meeting_transcripts
                (meeting_id, version, provider, stt_model,
                 transcript_text, diarization_json, created_by)
            VALUES
                (:meeting_id, :version, 'openai', :stt_model,
                 :transcript_text, CAST(:diarization_json AS jsonb), :created_by)
            RETURNING id
        """),
        {
            "meeting_id": meeting_id,
            "version": version,
            "stt_model": stt_model,
            "transcript_text": full_text,
            "diarization_json": json.dumps(raw_result, ensure_ascii=False),
            "created_by": user_id,
        },
    )
    await db.commit()
    return row.scalar_one()


async def _insert_segments(db, meeting_id: uuid.UUID, transcript_id: uuid.UUID,
                            segments: list[dict],
                            embeddings: list[list[float]] | None) -> None:
    for idx, seg in enumerate(segments):
        params: dict = {
            "meeting_id": meeting_id,
            "transcript_id": transcript_id,
            "segment_index": idx,
            "speaker_label": seg.get("speaker", f"SPEAKER_{idx % 10}"),
            "t_start_sec": seg["start"],
            "t_end_sec": seg["end"],
            "text": (seg.get("text") or "").strip(),
        }
        if embeddings:
            await db.execute(
                text("""
                    INSERT INTO meeting_segments
                        (meeting_id, transcript_id, segment_index,
                         speaker_label, t_start_sec, t_end_sec, text, embedding)
                    VALUES
                        (:meeting_id, :transcript_id, :segment_index,
                         :speaker_label, :t_start_sec, :t_end_sec, :text,
                         CAST(:embedding AS vector))
                """),
                {**params, "embedding": json.dumps(embeddings[idx])},
            )
        else:
            await db.execute(
                text("""
                    INSERT INTO meeting_segments
                        (meeting_id, transcript_id, segment_index,
                         speaker_label, t_start_sec, t_end_sec, text)
                    VALUES
                        (:meeting_id, :transcript_id, :segment_index,
                         :speaker_label, :t_start_sec, :t_end_sec, :text)
                """),
                params,
            )
    await db.commit()


async def _log_usage(db, meeting_id: uuid.UUID, org_id: uuid.UUID,
                     stt_model: str, duration_sec: float) -> None:
    duration_min = int(duration_sec / 60) + 1
    await db.execute(
        text("""
            INSERT INTO usage_events
                (org_id, meeting_id, kind, provider, model, units, cost_estimate_usd)
            VALUES
                (:org_id, :meeting_id, 'stt', 'openai', :model,
                 CAST(:units AS jsonb), NULL)
        """),
        {
            "org_id": org_id,
            "meeting_id": meeting_id,
            "model": stt_model,
            "units": json.dumps({"duration_sec": duration_sec, "duration_min": duration_min}),
        },
    )
    await db.commit()


# ── Main handler ──────────────────────────────────────────────────────────────

@register_handler("transcribe_audio")
async def handle_transcribe_audio(job: JobRow) -> None:
    payload = job.payload
    meeting_id = uuid.UUID(payload["meeting_id"])
    storage_path = payload["storage_path"]
    language = payload.get("language", "es")
    stt_model = payload.get("stt_model", "whisper-1")
    user_id = uuid.UUID(payload["user_id"])
    org_id = uuid.UUID(payload["org_id"])

    logger.info("Starting chunked transcription — meeting=%s storage_path=%s", meeting_id, storage_path)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # 1. Download audio
        logger.info("Downloading audio from Storage…")
        audio_bytes = await _download_audio(storage_path)
        raw_path = tmp / "original"
        raw_path.write_bytes(audio_bytes)
        logger.info("Downloaded %.1f MB", len(audio_bytes) / 1024 / 1024)

        # 2. Convert to MP3 (normalize format, reduces size)
        mp3_path = tmp / "audio.mp3"
        await _run_ffmpeg(
            "-i", str(raw_path),
            "-vn",                    # no video
            "-ar", "16000",           # 16 kHz — sufficient for speech
            "-ac", "1",               # mono
            "-b:a", "64k",            # 64 kbps
            str(mp3_path),
        )
        total_duration = await _get_duration(mp3_path)
        logger.info("Audio converted — duration=%.1fs", total_duration)

        # 3. Build chunk windows and transcribe each one in series
        windows = _build_chunk_windows(total_duration)
        logger.info("Splitting into %d chunks of ~%ds", len(windows), CHUNK_DURATION_SEC)

        all_segments: list[dict] = []
        full_texts: list[str] = []
        total_whisper_duration = 0.0

        for i, (start, duration) in enumerate(windows):
            chunk_path = tmp / f"chunk_{i:03d}.mp3"
            await _run_ffmpeg(
                "-ss", str(start),
                "-t", str(duration),
                "-i", str(mp3_path),
                "-c", "copy",
                str(chunk_path),
            )

            logger.info("Transcribing chunk %d/%d (start=%.0fs duration=%.0fs)…",
                        i + 1, len(windows), start, duration)
            result = await _transcribe_chunk(chunk_path, language)

            chunk_duration = result.get("duration", duration)
            total_whisper_duration += chunk_duration
            full_texts.append(result.get("text", "").strip())

            # Offset segment timestamps and filter out the leading overlap
            # (segments that fall in the overlap zone of this chunk are already
            # covered by the previous chunk's tail)
            for seg in result.get("segments", []):
                offset_start = seg.get("start", 0) + start
                offset_end = seg.get("end", 0) + start
                # Skip leading overlap zone for non-first chunks
                if i > 0 and offset_start < start + OVERLAP_SEC:
                    continue
                all_segments.append({
                    "start": offset_start,
                    "end": offset_end,
                    "text": (seg.get("text") or "").strip(),
                    "speaker": seg.get("speaker", f"SPEAKER_{seg.get('id', 0) % 10}"),
                })

            # Clean up chunk file to save disk space
            chunk_path.unlink(missing_ok=True)

        # 4. Merge and deduplicate overlap zones
        merged_segments = _merge_segments(all_segments)
        full_text = " ".join(full_texts)
        logger.info("Merge complete — %d segments, %.0fs total", len(merged_segments), total_whisper_duration)

        # 5. Generate embeddings (non-fatal)
        embeddings = await _generate_embeddings([s["text"] for s in merged_segments])
        if embeddings:
            logger.info("Generated %d embeddings", len(embeddings))

        # 6. Persist to DB
        async with AsyncSessionLocal() as db:
            version = await _get_latest_transcript_version(db, meeting_id)

        raw_result = {"text": full_text, "duration": total_whisper_duration, "segments": merged_segments}

        async with AsyncSessionLocal() as db:
            transcript_id = await _insert_transcript(
                db, meeting_id, version, full_text, raw_result,
                stt_model, user_id,
            )

        async with AsyncSessionLocal() as db:
            await _insert_segments(db, meeting_id, transcript_id, merged_segments, embeddings)

        async with AsyncSessionLocal() as db:
            await _log_usage(db, meeting_id, org_id, stt_model, total_whisper_duration)
            await _update_meeting_status(db, meeting_id, "transcribed")

    logger.info(
        "Chunked transcription complete — meeting=%s transcript=%s segments=%d",
        meeting_id, transcript_id, len(merged_segments),
    )
