#!/bin/bash
# Runs every 5 minutes via cron on the production VM (see deployment_guide.md).
# Checks the public health endpoint (through Caddy/TLS, so it catches Caddy
# outages too, not just backend crashes) and alerts via Telegram if it's down
# for two consecutive checks - one bad check alone could just be a deploy in
# progress. Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in
# /home/ubuntu/bip/.env; no-ops (silently, just logs) if either is unset.

HEALTH_URL="https://92-5-160-231.sslip.io/health"
STATE_FILE="/home/ubuntu/uptime_check.state"
ENV_FILE="/home/ubuntu/bip/.env"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL")
NOW=$(date '+%Y-%m-%d %H:%M:%S')

if [ "$STATUS" -ge 200 ] && [ "$STATUS" -lt 400 ]; then
    echo "$NOW OK ($STATUS)"
    rm -f "$STATE_FILE" "$STATE_FILE.alerted"
    exit 0
fi

echo "$NOW FAIL ($STATUS)"

if [ -f "$STATE_FILE" ]; then
    # Second consecutive failure - alert once, then go quiet until it
    # recovers (the state file being removed above resets this).
    if [ ! -f "$STATE_FILE.alerted" ]; then
        TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
        CHAT_ID=$(grep -E '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | cut -d= -f2-)
        if [ -n "$TOKEN" ] && [ -n "$CHAT_ID" ]; then
            curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
                -d "chat_id=${CHAT_ID}" \
                -d "text=[BIP] Health check failing (HTTP ${STATUS}) at ${NOW} - ${HEALTH_URL}" \
                > /dev/null
        else
            echo "$NOW - Telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID), skipping alert"
        fi
        touch "$STATE_FILE.alerted"
    fi
else
    touch "$STATE_FILE"
fi
