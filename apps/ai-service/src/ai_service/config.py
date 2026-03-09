from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str

    # OpenAI
    openai_api_key: str

    # Internal auth — static bearer token for Edge Function proxy calls
    service_api_key: str

    # Worker
    poll_interval_seconds: float = 5.0
    worker_concurrency: int = 4

    # App
    log_level: str = "INFO"
    environment: str = "development"

    @field_validator("database_url")
    @classmethod
    def must_be_asyncpg(cls, v: str) -> str:
        if not v.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "DATABASE_URL must use asyncpg driver: postgresql+asyncpg://..."
            )
        return v

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


settings = Settings()
