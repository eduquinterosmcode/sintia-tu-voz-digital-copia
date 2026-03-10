"""
Main API router. Aggregates all sub-routers and enforces SERVICE_API_KEY
authentication on every route except /health.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ai_service.api.audit import router as audit_router
from ai_service.api.health import router as health_router
from ai_service.api.webhooks import router as webhooks_router
from ai_service.config import settings
from ai_service.database import get_db
from ai_service.jobs.models import JobCreate, JobRow
from ai_service.jobs.repository import JobRepository

# ------------------------------------------------------------------
# Auth dependency
# ------------------------------------------------------------------

async def require_api_key(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = f"Bearer {settings.service_api_key}"
    if authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing SERVICE_API_KEY",
        )


# ------------------------------------------------------------------
# Jobs router (protected)
# ------------------------------------------------------------------

jobs_router = APIRouter(
    prefix="/jobs",
    tags=["jobs"],
    dependencies=[Depends(require_api_key)],
)


@jobs_router.post("/", response_model=JobRow, status_code=201)
async def enqueue_job(body: JobCreate, db: AsyncSession = Depends(get_db)):
    return await JobRepository(db).enqueue(body)


@jobs_router.get("/{job_id}", response_model=JobRow)
async def get_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    job = await JobRepository(db).get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ------------------------------------------------------------------
# Root router
# ------------------------------------------------------------------

audit_router_protected = APIRouter(
    dependencies=[Depends(require_api_key)],
)
audit_router_protected.include_router(audit_router)

api_router = APIRouter()
api_router.include_router(health_router)          # no auth
api_router.include_router(webhooks_router)        # auth via x-webhook-secret header
api_router.include_router(jobs_router)            # auth via SERVICE_API_KEY
api_router.include_router(audit_router_protected) # auth via SERVICE_API_KEY
