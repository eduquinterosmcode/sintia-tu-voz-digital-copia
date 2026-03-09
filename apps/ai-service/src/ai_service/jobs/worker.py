"""
Background polling worker.

One worker loop runs inside the FastAPI process via asyncio.create_task().
Multiple concurrent job slots are managed with an asyncio.Semaphore so the
event loop is never blocked and Postgres connections are reused efficiently.

Horizontal scaling: run multiple replicas — SELECT FOR UPDATE SKIP LOCKED
in the repository guarantees no double-processing across instances.
"""
import asyncio
import logging

from ai_service.config import settings
from ai_service.database import AsyncSessionLocal
from ai_service.handlers.registry import registry
from ai_service.jobs.repository import JobRepository

logger = logging.getLogger(__name__)


class JobWorker:
    def __init__(
        self,
        poll_interval: float | None = None,
        concurrency: int | None = None,
    ) -> None:
        self._poll_interval = poll_interval or settings.poll_interval_seconds
        self._sem = asyncio.Semaphore(concurrency or settings.worker_concurrency)

    async def run(self) -> None:
        """Infinite polling loop. Cancelled cleanly on shutdown."""
        logger.info(
            "Worker started (poll_interval=%.1fs, concurrency=%d)",
            self._poll_interval,
            self._sem._value,
        )
        while True:
            try:
                claimed = await self._claim_one()
                if claimed:
                    # Fire-and-forget; semaphore limits parallelism
                    asyncio.create_task(self._process(claimed))
                else:
                    await asyncio.sleep(self._poll_interval)
            except asyncio.CancelledError:
                logger.info("Worker shutting down")
                raise
            except Exception:
                logger.exception("Unexpected error in worker poll loop")
                await asyncio.sleep(self._poll_interval)

    async def _claim_one(self):
        async with AsyncSessionLocal() as db:
            repo = JobRepository(db)
            return await repo.claim_next()

    async def _process(self, job) -> None:
        async with self._sem:
            logger.info(
                "Processing job id=%s type=%s attempt=%d/%d",
                job.id,
                job.job_type,
                job.attempts,
                job.max_attempts,
            )
            try:
                await registry.dispatch(job)
                async with AsyncSessionLocal() as db:
                    await JobRepository(db).mark_completed(job.id)
                logger.info("Job %s completed", job.id)
            except Exception as exc:
                logger.error("Job %s failed: %s", job.id, exc)
                async with AsyncSessionLocal() as db:
                    await JobRepository(db).mark_failed(job.id, str(exc))
