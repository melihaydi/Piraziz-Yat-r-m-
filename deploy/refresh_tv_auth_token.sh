#!/bin/bash
# Runs every 3 hours via cron on the production VM (see deployment_guide.md).
# Keeps /home/ubuntu/bip/tv_auth_token.txt fresh with a real TradingView
# auth_token, obtained via a real (headless) browser - see
# refresh_tv_auth_token.py's docstring for why a plain HTTP client can't do
# this. market_data.py reads this file at startup and, if present, hands the
# token straight to TradingViewStream(auth_token=...) instead of relying on
# borsapy's broken cookie-replay auth. Does NOT force the running backend to
# reconnect - only takes effect on the backend's next (re)start.

ENV_FILE="/home/ubuntu/bip/.env"
OUTPUT_FILE="/home/ubuntu/bip/tv_auth_token.txt"
SCRIPT_DIR="/home/ubuntu/bip/deploy"
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright/python:v1.48.0-jammy"

TV_SESSION=$(grep -E '^TV_SESSION=' "$ENV_FILE" | cut -d= -f2-)
TV_SESSION_SIGN=$(grep -E '^TV_SESSION_SIGN=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$TV_SESSION" ] || [ -z "$TV_SESSION_SIGN" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') TV_SESSION/TV_SESSION_SIGN not set in $ENV_FILE, skipping."
    exit 0
fi

touch "$OUTPUT_FILE"

sudo docker run --rm \
    -v "$SCRIPT_DIR/refresh_tv_auth_token.py:/refresh_tv_auth_token.py:ro" \
    -v "$OUTPUT_FILE:/output/tv_auth_token.txt" \
    -e "TV_SESSION=$TV_SESSION" \
    -e "TV_SESSION_SIGN=$TV_SESSION_SIGN" \
    "$PLAYWRIGHT_IMAGE" \
    sh -c "pip install --quiet playwright==1.48.0 && python /refresh_tv_auth_token.py /output/tv_auth_token.txt"
