import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from ai_service.api.router import api_router
from ai_service.config import settings
from ai_service.jobs.worker import JobWorker

# Propagate API key to os.environ so the OpenAI SDK (and Agents SDK) can find it.
# pydantic-settings reads .env into settings but does NOT set os.environ.
os.environ.setdefault("OPENAI_API_KEY", settings.openai_api_key)

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Import handlers so @register_handler decorators run at startup
    import ai_service.handlers  # noqa: F401  (side-effect import)

    worker = JobWorker()
    task = asyncio.create_task(worker.run(), name="job-worker")
    logger.info("Application startup complete")
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        logger.info("Application shutdown complete")


app = FastAPI(
    title="SintIA AI Service",
    version="0.1.0",
    lifespan=lifespan,
    # Hide docs in production
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
)

app.include_router(api_router)
