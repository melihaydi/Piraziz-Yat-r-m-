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

    # Payments - a bare hostname, NOT a full URL: iyzipay's SDK passes this
    # straight into http.client.HTTPSConnection(host), which rejects a
    # "https://" prefix (fails DNS resolution on the literal string
    # "https://..."). Confirmed against iyzipay==1.0.46's IyzipayResource.
    # connect(). Switch to "api.iyzipay.com" once ready to take real
    # payments (see payment_service.py's module docstring).
    IYZICO_API_KEY: Optional[str] = None
    IYZICO_SECRET_KEY: Optional[str] = None
    IYZICO_BASE_URL: str = "sandbox-api.iyzipay.com"
    STRIPE_API_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None

    # Notifications
    TELEGRAM_BOT_TOKEN: Optional[str] = None
    TELEGRAM_CHAT_ID: Optional[str] = None
    DISCORD_WEBHOOK_URL: Optional[str] = None

    # Error tracking - unset by default (no Sentry account existed when the
    # lightweight Telegram-alert fallback in core/notify.py was built, see
    # main.py's unhandled_exception_handler). Set SENTRY_DSN in .env to
    # start sending real, deduplicated/stack-traced error reports there;
    # the Telegram alert keeps firing alongside it either way, so no
    # existing behavior is lost by turning this on.
    SENTRY_DSN: Optional[str] = None
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0

    # Email
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None

    # Public web app URL - used to build links inside emails (password
    # reset, email verification, etc.). Defaults to the live Netlify
    # deployment; override in .env for a custom domain.
    FRONTEND_URL: str = "https://pirazizyatirim.netlify.app"

    # Extra browser origins allowed to call this API, comma-separated. The
    # CORS allowlist in main.py matches *.netlify.app by pattern, which
    # stops covering the site the moment it's served from a domain of its
    # own - every API call would then fail the browser's preflight.
    # FRONTEND_URL is allowed automatically, so this is for the additional
    # hostnames that point at the same site (typically the www. variant).
    EXTRA_CORS_ORIGINS: str = ""

    # This backend's OWN public URL - needed for iyzico's checkoutForm
    # callbackUrl (iyzico redirects the buyer's browser back here after
    # payment, as a POST with a `token` - see payment_service.py). Must be
    # a real, internet-reachable HTTPS URL, not localhost, even in a
    # sandbox test.
    BACKEND_PUBLIC_URL: str = "https://92-5-160-231.sslip.io"

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

    def get_cors_origins(self) -> list[str]:
        """Browser origins allowed to call this API, on top of the
        *.netlify.app pattern applied in main.py. Trailing slashes are
        stripped because a browser's Origin header never carries one and
        CORSMiddleware compares the two as plain strings - "https://x.com/"
        in .env would silently match nothing."""
        origins = [
            "http://localhost:3000",      # Next.js development server
            "http://localhost:3001",
            "http://127.0.0.1:3000",
            "http://localhost",           # Production / Nginx
            self.FRONTEND_URL,
        ]
        origins += self.EXTRA_CORS_ORIGINS.split(",")
        seen: dict[str, None] = {}
        for origin in origins:
            cleaned = origin.strip().rstrip("/")
            if cleaned:
                seen[cleaned] = None
        return list(seen)

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
