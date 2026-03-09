from fastapi import APIRouter
from sqlalchemy import text

from ai_service.database import AsyncSessionLocal

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/health/db")
async def health_db():
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        return {"db": "ok"}
    except Exception as exc:
        from fastapi import Response
        return Response(
            content=f'{{"db":"error","detail":"{exc}"}}',
            status_code=503,
            media_type="application/json",
        )
