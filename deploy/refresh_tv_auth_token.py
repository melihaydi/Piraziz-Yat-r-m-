"""
Refreshes the TradingView real-time auth_token and writes it to a file the
backend reads on startup (see market_data.py's _initialize_stream).

Why this exists: TradingView's session-cookie-based auth (sessionid +
sessionid_sign, what borsapy.set_tradingview_auth() uses) is rejected by
TradingView's server when replayed via a plain HTTP client (httpx/requests)
from this server - confirmed by direct testing, is_authenticated always came
back false regardless of how fresh the cookies were. The same exact cookies
DO authenticate successfully through a real (headless) browser engine - this
script uses Playwright/Chromium to load tradingview.com with those cookies
and scrape out the real auth_token a genuine browser session gets, then
hands that token directly to TradingViewStream(auth_token=...), bypassing
borsapy's broken cookie-replay path entirely.

Run via cron every few hours (see deploy/refresh_tv_auth_token.sh) - the
auth_token is a JWT with its own expiry, and the underlying TradingView
session can also be invalidated server-side at any time, so this keeps a
reasonably fresh token available for whenever the backend next (re)starts.
This does NOT force the running backend to reconnect mid-session; the token
is only read at TradingViewStream connect time.

Usage: TV_SESSION=... TV_SESSION_SIGN=... python refresh_tv_auth_token.py <output_path>
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright

AUTH_TOKEN_RE = re.compile(r'"auth_token"\s*:\s*"([^"]+)"')
IS_AUTHENTICATED_RE = re.compile(r"var is_authenticated = (true|false);")


def fetch_auth_token(session: str, session_sign: str) -> str | None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        try:
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
                )
            )
            context.add_cookies([
                {"name": "sessionid", "value": session, "domain": ".tradingview.com", "path": "/"},
                {"name": "sessionid_sign", "value": session_sign, "domain": ".tradingview.com", "path": "/"},
            ])
            page = context.new_page()
            page.goto("https://www.tradingview.com/", wait_until="networkidle", timeout=30000)
            html = page.content()

            auth_match = IS_AUTHENTICATED_RE.search(html)
            if not auth_match or auth_match.group(1) != "true":
                print("Session did not authenticate (is_authenticated != true) - "
                      "TV_SESSION/TV_SESSION_SIGN are likely stale or invalid.", file=sys.stderr)
                return None

            token_match = AUTH_TOKEN_RE.search(html)
            if not token_match:
                print("Authenticated, but no auth_token found in page - "
                      "TradingView may have changed their page structure.", file=sys.stderr)
                return None
            return token_match.group(1)
        finally:
            browser.close()


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: refresh_tv_auth_token.py <output_path>", file=sys.stderr)
        return 2

    output_path = sys.argv[1]
    session = os.environ.get("TV_SESSION")
    session_sign = os.environ.get("TV_SESSION_SIGN")
    if not session or not session_sign:
        print("TV_SESSION/TV_SESSION_SIGN not set - nothing to refresh.", file=sys.stderr)
        return 1

    token = fetch_auth_token(session, session_sign)
    if not token:
        return 1

    # output_path is a Docker bind-mounted single file, not a directory - a
    # write-to-temp-then-os.replace() atomic swap fails there with "Device
    # or resource busy" (you can't rename over an active bind-mount point).
    # A plain truncate+write is fine here: the backend only reads this file
    # once, at its own startup, not on every request, so there's no
    # concurrent-read race worth guarding against.
    with open(output_path, "w") as f:
        f.write(token)
    print(f"Wrote fresh auth_token ({len(token)} chars) to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
