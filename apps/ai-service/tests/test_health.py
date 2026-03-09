async def test_health_returns_ok(async_client):
    response = await async_client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_jobs_requires_auth(async_client):
    response = await async_client.post("/jobs/", json={
        "idempotency_key": "test-1",
        "job_type": "test",
    })
    assert response.status_code == 401


async def test_jobs_with_valid_key_passes_auth(async_client):
    # Will fail at DB level (no real DB), not at auth level
    response = await async_client.post(
        "/jobs/",
        json={"idempotency_key": "test-1", "job_type": "test"},
        headers={"Authorization": "Bearer test-key"},
    )
    # 500 is fine here — means auth passed, DB not available in unit tests
    assert response.status_code != 401
