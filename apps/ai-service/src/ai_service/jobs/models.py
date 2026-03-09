import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class JobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    DEAD = "dead"


class JobCreate(BaseModel):
    idempotency_key: str
    job_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    priority: int = 0
    max_attempts: int = 3
    run_at: datetime | None = None  # None → now()


class JobRow(BaseModel):
    id: uuid.UUID
    idempotency_key: str
    job_type: str
    payload: dict[str, Any]
    status: JobStatus
    priority: int
    attempts: int
    max_attempts: int
    last_error: str | None
    run_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
