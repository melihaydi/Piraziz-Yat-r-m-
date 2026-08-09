#!/bin/bash
# Daily Postgres backup for the Piraziz Yatirim (BIP) production database.
# Runs via cron (0 3 * * *) - dumps the bip_postgres container's database,
# gzips it, keeps 14 days locally, and optionally ships an encrypted copy
# off the box.
#
# WHY OFF-SITE MATTERS: the local copies live on the same VM as the
# database itself, so they protect against container recreation, a bad
# migration or accidental data loss - but NOT against losing the VM or its
# disk, which would take the database and every backup of it at the same
# time. The off-site block below closes that gap.
#
# The off-site copy is ALWAYS encrypted before it leaves this machine: the
# dump contains real user data (email addresses, bcrypt password hashes,
# portfolios), so it must be unreadable wherever it ends up.
set -euo pipefail

BACKUP_DIR="/home/ubuntu/backups"
RETENTION_DAYS=14
TIMESTAMP=$(date +%F_%H%M)
OUT_FILE="$BACKUP_DIR/bip_${TIMESTAMP}.sql.gz"

# --- Off-site configuration -------------------------------------------
# Deliberately empty by default: nothing leaves this server until a
# destination is set on purpose. To turn it on, set both of these (an
# scp-style target and an SSH key that can write there) and make sure
# PASSPHRASE_FILE exists:
#
#   OFFSITE_TARGET="user@backup-host:/path/to/bip-backups/"
#   OFFSITE_SSH_KEY="/home/ubuntu/.ssh/offsite_backup_key"
#
# KEEP A COPY OF THE PASSPHRASE SOMEWHERE OTHER THAN THIS SERVER. Without
# it the off-site archives are permanently unreadable, which would defeat
# the entire point of having them.
OFFSITE_TARGET="${OFFSITE_TARGET:-}"
OFFSITE_SSH_KEY="${OFFSITE_SSH_KEY:-/home/ubuntu/.ssh/offsite_backup_key}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-/home/ubuntu/.backup_passphrase}"
# ----------------------------------------------------------------------

mkdir -p "$BACKUP_DIR"

docker exec bip_postgres pg_dump -U bip_user bip_db | gzip > "$OUT_FILE"

if [ ! -s "$OUT_FILE" ]; then
  echo "$(date -Iseconds) ERROR: backup produced an empty file: $OUT_FILE" >&2
  rm -f "$OUT_FILE"
  exit 1
fi

find "$BACKUP_DIR" -name "bip_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "bip_*.sql.gz.gpg" -mtime +"$RETENTION_DAYS" -delete

echo "$(date -Iseconds) OK: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# --- Off-site copy ----------------------------------------------------
if [ -z "$OFFSITE_TARGET" ]; then
  echo "$(date -Iseconds) INFO: OFFSITE_TARGET not set - keeping backups on this server only."
  exit 0
fi

if [ ! -f "$PASSPHRASE_FILE" ]; then
  echo "$(date -Iseconds) ERROR: OFFSITE_TARGET is set but $PASSPHRASE_FILE is missing - refusing to send an unencrypted dump off-site." >&2
  exit 1
fi

ENC_FILE="${OUT_FILE}.gpg"
gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase-file "$PASSPHRASE_FILE" \
    --output "$ENC_FILE" "$OUT_FILE"

if [ ! -s "$ENC_FILE" ]; then
  echo "$(date -Iseconds) ERROR: encryption produced an empty file - not sending anything." >&2
  rm -f "$ENC_FILE"
  exit 1
fi

# Only the encrypted file is ever transferred; the plaintext .sql.gz never
# leaves this machine.
scp -q -i "$OFFSITE_SSH_KEY" -o StrictHostKeyChecking=accept-new \
    "$ENC_FILE" "$OFFSITE_TARGET"

echo "$(date -Iseconds) OK: off-site copy sent ($(du -h "$ENC_FILE" | cut -f1) encrypted) -> $OFFSITE_TARGET"
