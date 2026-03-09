import os

import pytest
from httpx import ASGITransport, AsyncClient

# Provide minimal env vars so config.py can be imported without a real .env
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/test")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("SERVICE_API_KEY", "test-key")


@pytest.fixture
async def async_client():
    # Import app after env vars are set
    from ai_service.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client
