import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    SECRET_KEY: str = "supersecretjwtkeyforlocaldevelopmentonly12345"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # PostgreSQL
    POSTGRES_USER: str = "bip_user"
    POSTGRES_PASSWORD: str = "bip_password"
    POSTGRES_DB: str = "bip_db"
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: str = "5432"
    DATABASE_URL: Optional[str] = None

    # Redis
    REDIS_HOST: str = "redis"
    REDIS_PORT: str = "6379"
    REDIS_URL: Optional[str] = None

    # API Keys
    GEMINI_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    FINNHUB_API_KEY: Optional[str] = None
    FMP_API_KEY: Optional[str] = None
    ALPHA_VANTAGE_API_KEY: Optional[str] = None
    POLYGON_API_KEY: Optional[str] = None
    TWELVE_DATA_API_KEY: Optional[str] = None
    EVDS_API_KEY: Optional[str] = None

    # Payments
    IYZICO_API_KEY: Optional[str] = None
    IYZICO_SECRET_KEY: Optional[str] = None
    IYZICO_BASE_URL: str = "https://sandbox-api.iyzipay.com"
    STRIPE_API_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None

    # Notifications
    TELEGRAM_BOT_TOKEN: Optional[str] = None
    TELEGRAM_CHAT_ID: Optional[str] = None
    DISCORD_WEBHOOK_URL: Optional[str] = None

    # Email
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None

    # TradingView Real-time Data Authentication
    TV_SESSION: Optional[str] = None
    TV_SESSION_SIGN: Optional[str] = None

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    def get_database_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    def get_redis_url(self) -> str:
        if self.REDIS_URL:
            return self.REDIS_URL
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/0"

settings = Settings()

# SECRET_KEY signs every JWT (see core/security.py) - its hardcoded fallback
# above exists only so local dev works without a .env file. Refuse to boot
# in production with that fallback still in place, since anyone who reads
# this public source code would then be able to forge valid auth tokens for
# any user.
if settings.ENVIRONMENT == "production" and settings.SECRET_KEY == "supersecretjwtkeyforlocaldevelopmentonly12345":
    raise RuntimeError(
        "SECRET_KEY is still the hardcoded development default in a production "
        "environment - set a real random SECRET_KEY in the deploy's .env before starting."
    )
