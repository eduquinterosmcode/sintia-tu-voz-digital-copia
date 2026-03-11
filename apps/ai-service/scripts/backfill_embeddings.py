"""
Backfill embeddings for meeting segments that have embedding = NULL.

Usage:
    cd apps/ai-service
    uv run python scripts/backfill_embeddings.py <meeting_id>

Generates embeddings for all segments of a meeting that don't have one yet
using text-embedding-3-small. Safe to run multiple times (skips segments
that already have embeddings).
"""
import asyncio
import os
import sys

import httpx
from sqlalchemy import text

# Make sure the src package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from ai_service.config import settings  # noqa: E402
from ai_service.database import AsyncSessionLocal  # noqa: E402

os.environ["OPENAI_API_KEY"] = settings.openai_api_key

EMBEDDING_MODEL = "text-embedding-3-small"
BATCH_SIZE = 200


async def fetch_segments_without_embeddings(db, meeting_id: str) -> list[dict]:
    result = await db.execute(
        text("""
            SELECT ms.id, ms.segment_index, ms.text
            FROM meeting_segments ms
            JOIN meeting_transcripts mt ON mt.id = ms.transcript_id
            WHERE ms.meeting_id = :meeting_id
              AND ms.embedding IS NULL
              AND ms.text IS NOT NULL
              AND ms.text <> ''
              AND mt.version = (
                SELECT MAX(version) FROM meeting_transcripts
                WHERE meeting_id = :meeting_id
              )
            ORDER BY ms.segment_index
        """),
        {"meeting_id": meeting_id},
    )
    return [{"id": str(row.id), "index": row.segment_index, "text": row.text} for row in result]


async def generate_embeddings(texts: list[str]) -> list[list[float]]:
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.openai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            json={"model": EMBEDDING_MODEL, "input": texts},
        )
        response.raise_for_status()
        data = response.json()
        sorted_items = sorted(data["data"], key=lambda x: x["index"])
        return [item["embedding"] for item in sorted_items]


async def update_embeddings(db, segments: list[dict], embeddings: list[list[float]]) -> None:
    for seg, emb in zip(segments, embeddings):
        await db.execute(
            text("UPDATE meeting_segments SET embedding = CAST(:emb AS vector) WHERE id = :id"),
            {"emb": str(emb), "id": seg["id"]},
        )
    await db.commit()


async def backfill(meeting_id: str) -> None:
    print(f"Backfilling embeddings for meeting {meeting_id}...")

    async with AsyncSessionLocal() as db:
        segments = await fetch_segments_without_embeddings(db, meeting_id)

    if not segments:
        print("No segments without embeddings found. Already up to date.")
        return

    print(f"Found {len(segments)} segments without embeddings.")
    total_updated = 0

    for i in range(0, len(segments), BATCH_SIZE):
        batch = segments[i : i + BATCH_SIZE]
        texts = [s["text"] for s in batch]

        print(f"  Generating embeddings for segments {i + 1}–{i + len(batch)}...")
        embeddings = await generate_embeddings(texts)

        async with AsyncSessionLocal() as db:
            await update_embeddings(db, batch, embeddings)

        total_updated += len(batch)
        print(f"  OK {total_updated}/{len(segments)} updated")

    print(f"\nDone. {total_updated} segments now have embeddings.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: uv run python scripts/backfill_embeddings.py <meeting_id>")
        sys.exit(1)

    asyncio.run(backfill(sys.argv[1]))
