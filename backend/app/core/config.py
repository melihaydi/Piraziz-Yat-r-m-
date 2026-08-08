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

    # Public web app URL - used to build links inside emails (password
    # reset, email verification, etc.). Defaults to the live Netlify
    # deployment; override in .env for a custom domain.
    FRONTEND_URL: str = "https://pirazizyatirim.netlify.app"

    # Web Push (VAPID) - generated once for this app (see core/push.py),
    # baked in as a working default so browser push works out of the box
    # with no extra account/service to sign up for. Unlike SECRET_KEY, a
    # leaked VAPID key pair only lets someone send push notifications
    # impersonating this app to browsers already subscribed to it - low
    # enough severity that a shipped default (rather than requiring every
    # deploy to generate its own) is an acceptable tradeoff here.
    VAPID_PRIVATE_KEY: str = "W220UfduPvFWa1_YqkuiWu45MJ0YDcYQRB-PnsclVH4"
    VAPID_PUBLIC_KEY: str = "BJRydjIkbKT-pe8eI40bROhRg8XlreZu2qCCQRzA-VPoh__Rx-3r-0tjv5ewkMU43yrokPs0hGwKvMeSlqvxxm8"
    VAPID_CLAIM_EMAIL: str = "mailto:melihaydi@gmail.com"

    # TradingView Real-time Data Authentication
    TV_SESSION: Optional[str] = None
    TV_SESSION_SIGN: Optional[str] = None
    # Path to a file kept fresh by deploy/refresh_tv_auth_token.sh - a real
    # auth_token fetched via a real (headless) browser session, since
    # TradingView's server rejects a plain-HTTP-client replay of TV_SESSION/
    # TV_SESSION_SIGN from this server (confirmed by direct testing) even
    # though the same cookies work fine through an actual browser engine.
    # Optional: if unset or the file doesn't exist, falls back to borsapy's
    # own (currently non-functional against TradingView's current site)
    # cookie-based auth, same as before this existed.
    TV_AUTH_TOKEN_FILE: Optional[str] = "/app/tv_auth_token.txt"

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
