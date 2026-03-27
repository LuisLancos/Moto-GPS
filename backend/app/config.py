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
