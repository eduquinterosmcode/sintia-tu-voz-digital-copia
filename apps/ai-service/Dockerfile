FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS builder

WORKDIR /app

# Install dependencies into an isolated venv (uv.lock required for --frozen)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy source and install the project itself
COPY src/ src/
RUN uv sync --frozen --no-dev


FROM python:3.11-slim-bookworm

WORKDIR /app

# Copy venv from builder
COPY --from=builder /app/.venv /app/.venv
COPY src/ src/

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="src"

# Non-root user
RUN useradd --no-create-home --shell /bin/false appuser
USER appuser

# Cloud Run sets PORT env var (default 8080). Respect it.
EXPOSE 8080
CMD uvicorn ai_service.main:app --host 0.0.0.0 --port ${PORT:-8080}
