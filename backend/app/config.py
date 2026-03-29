from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    postgres_user: str = "motogps"
    postgres_password: str = "motogps_dev"
    postgres_db: str = "motogps"
    postgres_host: str = "localhost"
    postgres_port: int = 5432

    valhalla_url: str = "http://localhost:8002"
    martin_url: str = "http://localhost:3000"

    backend_url: str = "http://localhost:8000"

    # JWT authentication
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24 hours

    # AI trip planner
    ai_provider: str = "gemini"  # "gemini" or "openai"
    gemini_api_key: str = ""
    openai_api_key: str = ""

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    class Config:
        env_file = "../.env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
