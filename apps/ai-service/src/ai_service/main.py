import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from ai_service.api.router import api_router
from ai_service.config import settings
from ai_service.jobs.worker import JobWorker

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
