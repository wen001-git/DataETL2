# App settings loaded from .env via pydantic-settings.
# FERNET_KEY must never change after first deploy — it encrypts all stored SFTP
# passwords; rotating it makes every saved credential unreadable.
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "mysql+pymysql://etluser:etlpassword@mysql:3306/dataetl2"
    secret_key: str = "dev-secret-key"
    fernet_key: str = ""
    access_token_expire_minutes: int = 480

    # Email alert settings — disabled by default; set ALERT_EMAIL_ENABLED=true in .env to activate
    alert_email_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    alert_to_email: str = ""

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
